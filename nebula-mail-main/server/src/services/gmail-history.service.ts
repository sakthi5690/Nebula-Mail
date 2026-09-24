/**
 * Gmail History Sync Service
 *
 * Processes Gmail History API changes when a Pub/Sub notification arrives.
 * Detects new/changed messages, handles pagination, and manages historyId state.
 *
 * Features:
 * - Incremental sync via Gmail History API
 * - Pagination support for large change sets
 * - Expired/invalid historyId recovery (full resync)
 * - Duplicate notification prevention via processed-historyId dedup set
 * - Returns structured change events for frontend notification
 */

import { GmailClientFactory } from './gmail.service';
import { getStoredHistoryId, updateStoredHistoryId } from './gmail-watch.service';
import { sseManager, type GmailChangeEvent } from './sse-manager';
import type { Request } from 'express';

export interface HistorySyncResult {
  success: boolean;
  email: string;
  messagesAdded: number;
  messagesDeleted: number;
  labelsChanged: number;
  newHistoryId: string;
  fullResyncTriggered: boolean;
  error?: string;
}

// Deduplication: track recently processed historyIds to prevent duplicate processing
const processedHistoryIds = new Map<string, number>(); // historyId -> timestamp
const DEDUP_WINDOW_MS = 10 * 60 * 1000; // 10-minute dedup window

/**
 * Process a history sync for a specific user email triggered by a Pub/Sub notification.
 *
 * @param email - The Gmail address that received the change notification
 * @param notifiedHistoryId - The historyId from the Pub/Sub notification
 * @returns HistorySyncResult with change details
 */
export async function processHistorySync(
  email: string,
  notifiedHistoryId: string
): Promise<HistorySyncResult> {
  // Dedup check: skip if this exact historyId was recently processed
  const dedupeKey = `${email}:${notifiedHistoryId}`;
  const lastProcessed = processedHistoryIds.get(dedupeKey);
  if (lastProcessed && Date.now() - lastProcessed < DEDUP_WINDOW_MS) {
    console.log(`[History Sync] Skipping duplicate notification for ${email}, historyId: ${notifiedHistoryId}`);
    return {
      success: true,
      email,
      messagesAdded: 0,
      messagesDeleted: 0,
      labelsChanged: 0,
      newHistoryId: notifiedHistoryId,
      fullResyncTriggered: false,
    };
  }

  // Get the stored historyId (last known sync point)
  const storedHistoryId = getStoredHistoryId(email);

  if (!storedHistoryId) {
    console.log(`[History Sync] No stored historyId for ${email}, triggering full resync`);
    return performFullResync(email, notifiedHistoryId);
  }

  try {
    // Get authenticated Gmail client
    const mockReq = {
      cookies: { stitch_user_email: email },
      headers: { 'x-user-email': email },
      query: {},
    } as unknown as Request;

    const authContext = await GmailClientFactory.getAuthenticatedClient(mockReq);
    if (!authContext) {
      return {
        success: false,
        email,
        messagesAdded: 0,
        messagesDeleted: 0,
        labelsChanged: 0,
        newHistoryId: storedHistoryId,
        fullResyncTriggered: false,
        error: 'No authenticated Gmail client available',
      };
    }

    const { gmail } = authContext;

    // Fetch history changes with pagination
    let messagesAdded = 0;
    let messagesDeleted = 0;
    let labelsChanged = 0;
    let latestHistoryId = storedHistoryId;
    let pageToken: string | undefined;

    do {
      const historyResponse = await gmail.users.history.list({
        userId: 'me',
        startHistoryId: storedHistoryId,
        historyTypes: ['messageAdded', 'messageDeleted', 'labelAdded', 'labelRemoved'],
        maxResults: 100,
        pageToken,
      });

      const history = historyResponse.data.history || [];

      for (const record of history) {
        if (record.messagesAdded) {
          messagesAdded += record.messagesAdded.length;
        }
        if (record.messagesDeleted) {
          messagesDeleted += record.messagesDeleted.length;
        }
        if (record.labelsAdded) {
          labelsChanged += record.labelsAdded.length;
        }
        if (record.labelsRemoved) {
          labelsChanged += record.labelsRemoved.length;
        }
      }

      // Track the latest historyId from the response
      if (historyResponse.data.historyId) {
        latestHistoryId = historyResponse.data.historyId;
      }

      pageToken = historyResponse.data.nextPageToken || undefined;
    } while (pageToken);

    // Update stored historyId
    updateStoredHistoryId(email, latestHistoryId);

    // Mark as processed for dedup
    processedHistoryIds.set(dedupeKey, Date.now());
    cleanupDedupCache();

    // Persist updated historyId to Supabase
    await persistHistoryId(email, latestHistoryId).catch(() => {
      // Non-critical: in-memory state is the primary source
    });

    const totalChanges = messagesAdded + messagesDeleted + labelsChanged;

    // Notify frontend via SSE if there were actual changes
    if (totalChanges > 0) {
      const changeEvent: GmailChangeEvent = {
        type: 'gmail_change',
        email,
        changes: {
          messagesAdded,
          messagesDeleted,
          labelsChanged,
          historyId: latestHistoryId,
        },
        timestamp: new Date().toISOString(),
      };

      sseManager.notifyUser(email, changeEvent);
    }

    console.log(
      `[History Sync] Sync complete for ${email}: +${messagesAdded} added, -${messagesDeleted} deleted, ~${labelsChanged} label changes. New historyId: ${latestHistoryId}`
    );

    return {
      success: true,
      email,
      messagesAdded,
      messagesDeleted,
      labelsChanged,
      newHistoryId: latestHistoryId,
      fullResyncTriggered: false,
    };
  } catch (err) {
    const error = err as { code?: number; message?: string };

    // Handle expired historyId (404 from Gmail)
    if (error.code === 404) {
      console.warn(
        `[History Sync] HistoryId expired for ${email} (storedHistoryId: ${storedHistoryId}). Performing full resync.`
      );
      return performFullResync(email, notifiedHistoryId);
    }

    console.error(`[History Sync] Error syncing history for ${email}:`, error.message);
    return {
      success: false,
      email,
      messagesAdded: 0,
      messagesDeleted: 0,
      labelsChanged: 0,
      newHistoryId: storedHistoryId,
      fullResyncTriggered: false,
      error: error.message || 'Unknown error during history sync',
    };
  }
}

/**
 * Perform a full resync when the stored historyId is expired or unavailable.
 * Clears the old historyId, gets a fresh one via profile, and notifies the frontend
 * to reload the entire mailbox.
 */
async function performFullResync(
  email: string,
  notifiedHistoryId: string
): Promise<HistorySyncResult> {
  try {
    const mockReq = {
      cookies: { stitch_user_email: email },
      headers: { 'x-user-email': email },
      query: {},
    } as unknown as Request;

    const authContext = await GmailClientFactory.getAuthenticatedClient(mockReq);
    if (!authContext) {
      return {
        success: false,
        email,
        messagesAdded: 0,
        messagesDeleted: 0,
        labelsChanged: 0,
        newHistoryId: notifiedHistoryId,
        fullResyncTriggered: true,
        error: 'No authenticated client for full resync',
      };
    }

    // Get current profile to obtain fresh historyId
    const profile = await authContext.gmail.users.getProfile({ userId: 'me' });
    const freshHistoryId = profile.data.historyId || notifiedHistoryId;

    // Update stored historyId
    updateStoredHistoryId(email, freshHistoryId);

    // Persist to Supabase
    await persistHistoryId(email, freshHistoryId).catch(() => {});

    // Notify frontend to do a full refresh
    const changeEvent: GmailChangeEvent = {
      type: 'gmail_change',
      email,
      changes: {
        messagesAdded: -1, // -1 signals full resync needed
        messagesDeleted: 0,
        labelsChanged: 0,
        historyId: freshHistoryId,
      },
      timestamp: new Date().toISOString(),
    };

    sseManager.notifyUser(email, changeEvent);

    console.log(`[History Sync] Full resync completed for ${email}. New historyId: ${freshHistoryId}`);

    return {
      success: true,
      email,
      messagesAdded: 0,
      messagesDeleted: 0,
      labelsChanged: 0,
      newHistoryId: freshHistoryId,
      fullResyncTriggered: true,
    };
  } catch (err) {
    const error = err as Error;
    console.error(`[History Sync] Full resync failed for ${email}:`, error.message);
    return {
      success: false,
      email,
      messagesAdded: 0,
      messagesDeleted: 0,
      labelsChanged: 0,
      newHistoryId: notifiedHistoryId,
      fullResyncTriggered: true,
      error: error.message,
    };
  }
}

/**
 * Persist the historyId to Supabase gmail_sync_states.
 */
async function persistHistoryId(email: string, historyId: string): Promise<void> {
  try {
    const { getSupabaseAdminClient } = await import('../../../src/lib/supabase/server');
    const supabase = getSupabaseAdminClient();

    const { data: accounts } = await supabase
      .from('gmail_accounts')
      .select('id')
      .eq('email_address', email)
      .limit(1);

    if (accounts && accounts.length > 0) {
      await supabase
        .from('gmail_sync_states')
        .update({
          last_history_id: historyId,
          last_synced_at: new Date().toISOString(),
          status: 'active',
          updated_at: new Date().toISOString(),
        })
        .eq('account_id', accounts[0].id);
    }
  } catch {
    // Supabase not configured — history tracked in memory
  }
}

/**
 * Check if a historyId has been recently processed (for external dedup checks).
 */
export function isHistoryIdProcessed(email: string, historyId: string): boolean {
  const dedupeKey = `${email}:${historyId}`;
  const lastProcessed = processedHistoryIds.get(dedupeKey);
  return Boolean(lastProcessed && Date.now() - lastProcessed < DEDUP_WINDOW_MS);
}

/**
 * Clean up old entries from the dedup cache.
 */
function cleanupDedupCache(): void {
  const now = Date.now();
  for (const [key, timestamp] of processedHistoryIds) {
    if (now - timestamp > DEDUP_WINDOW_MS) {
      processedHistoryIds.delete(key);
    }
  }
}
