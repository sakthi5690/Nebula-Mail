/**
 * Gmail Watch Service
 *
 * Manages Gmail API mailbox watches via Google Cloud Pub/Sub.
 * Handles watch creation, renewal, and expiration tracking.
 *
 * Gmail watches expire after ~7 days. This service:
 * - Creates watches using gmail.users.watch()
 * - Stores watch metadata (historyId, expiration) in Supabase
 * - Schedules automatic renewal before expiration
 * - Falls back to in-memory cache when Supabase is not configured
 */

import { gmail_v1 } from 'googleapis';
import { GmailClientFactory } from './gmail.service';
import type { Request } from 'express';

export interface WatchState {
  email: string;
  historyId: string;
  expiration: number; // Unix timestamp in milliseconds
  topicName: string;
  isActive: boolean;
  createdAt: number;
}

// In-memory watch state cache (for resilience when Supabase is not configured)
const activeWatches = new Map<string, WatchState>();

// Renewal check interval handle
let renewalInterval: ReturnType<typeof setInterval> | null = null;

// Renewal threshold: renew if < 24 hours until expiry
const RENEWAL_THRESHOLD_MS = 24 * 60 * 60 * 1000;
// Check interval: every hour
const RENEWAL_CHECK_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Create a Gmail mailbox watch for the authenticated user.
 * Uses the configured Pub/Sub topic for push notifications.
 */
export async function createWatch(req: Request): Promise<WatchState | null> {
  const topicName = process.env.GMAIL_PUBSUB_TOPIC;
  if (!topicName) {
    console.warn('[Gmail Watch] GMAIL_PUBSUB_TOPIC not configured, skipping watch creation');
    return null;
  }

  const authContext = await GmailClientFactory.getAuthenticatedClient(req);
  if (!authContext) {
    console.warn('[Gmail Watch] No authenticated client available for watch creation');
    return null;
  }

  const { gmail, email } = authContext;

  return createWatchForEmail(gmail, email, topicName);
}

/**
 * Create a Gmail watch for a specific email using an authenticated Gmail client.
 */
export async function createWatchForEmail(
  gmail: gmail_v1.Gmail,
  email: string,
  topicName: string
): Promise<WatchState> {
  try {
    const response = await gmail.users.watch({
      userId: 'me',
      requestBody: {
        topicName,
        labelIds: ['INBOX'],
      },
    });

    const historyId = response.data.historyId || '';
    const expiration = parseInt(response.data.expiration || '0', 10);

    const watchState: WatchState = {
      email,
      historyId,
      expiration,
      topicName,
      isActive: true,
      createdAt: Date.now(),
    };

    // Cache in memory
    activeWatches.set(email, watchState);

    // Persist to Supabase if available
    await persistWatchState(watchState).catch((err) => {
      console.warn('[Gmail Watch] Could not persist watch state to Supabase:', err);
    });

    console.log(
      `[Gmail Watch] Watch created for ${email}. HistoryId: ${historyId}, Expires: ${new Date(expiration).toISOString()}`
    );

    return watchState;
  } catch (err) {
    const error = err as Error;
    console.error(`[Gmail Watch] Failed to create watch for ${email}:`, error.message);
    throw error;
  }
}

/**
 * Renew a Gmail watch before it expires.
 * Effectively creates a new watch (Gmail API doesn't have a separate renew endpoint).
 */
export async function renewWatch(email: string): Promise<WatchState | null> {
  const topicName = process.env.GMAIL_PUBSUB_TOPIC;
  if (!topicName) return null;

  try {
    // Try to get credentials from the GmailClientFactory approach
    // Use a minimal mock request to get the client
    const mockReq = {
      cookies: { stitch_user_email: email },
      headers: { 'x-user-email': email },
      query: {},
    } as unknown as Request;

    const authContext = await GmailClientFactory.getAuthenticatedClient(mockReq);
    if (!authContext) {
      console.warn(`[Gmail Watch] Cannot renew watch for ${email}: no authenticated client`);
      return null;
    }

    return createWatchForEmail(authContext.gmail, email, topicName);
  } catch (err) {
    const error = err as Error;
    console.error(`[Gmail Watch] Failed to renew watch for ${email}:`, error.message);
    return null;
  }
}

/**
 * Stop a Gmail watch for a specific email.
 */
export async function stopWatch(email: string): Promise<boolean> {
  try {
    const mockReq = {
      cookies: { stitch_user_email: email },
      headers: { 'x-user-email': email },
      query: {},
    } as unknown as Request;

    const authContext = await GmailClientFactory.getAuthenticatedClient(mockReq);
    if (!authContext) return false;

    await authContext.gmail.users.stop({ userId: 'me' });

    activeWatches.delete(email);
    console.log(`[Gmail Watch] Watch stopped for ${email}`);
    return true;
  } catch (err) {
    const error = err as Error;
    console.error(`[Gmail Watch] Failed to stop watch for ${email}:`, error.message);
    return false;
  }
}

/**
 * Get the current watch state for an email.
 */
export function getWatchState(email: string): WatchState | undefined {
  return activeWatches.get(email);
}

/**
 * Get all active watch states.
 */
export function getAllWatchStates(): WatchState[] {
  return Array.from(activeWatches.values());
}

/**
 * Get the stored historyId for an email.
 */
export function getStoredHistoryId(email: string): string | null {
  const watch = activeWatches.get(email);
  return watch?.historyId || null;
}

/**
 * Update the stored historyId for an email (called after history sync).
 */
export function updateStoredHistoryId(email: string, historyId: string): void {
  const watch = activeWatches.get(email);
  if (watch) {
    watch.historyId = historyId;
    activeWatches.set(email, watch);
  }
}

/**
 * Start the automatic watch renewal scheduler.
 * Checks every hour and renews watches that are within 24 hours of expiration.
 */
export function startWatchRenewalScheduler(): void {
  if (renewalInterval) return;

  console.log('[Gmail Watch] Starting watch renewal scheduler (checks every 1 hour)');

  renewalInterval = setInterval(async () => {
    const now = Date.now();

    for (const [email, watch] of activeWatches) {
      if (!watch.isActive) continue;

      const timeUntilExpiry = watch.expiration - now;

      if (timeUntilExpiry < RENEWAL_THRESHOLD_MS) {
        console.log(
          `[Gmail Watch] Watch for ${email} expires in ${Math.round(timeUntilExpiry / 1000 / 60)} minutes — renewing...`
        );

        try {
          await renewWatch(email);
        } catch (err) {
          console.error(`[Gmail Watch] Auto-renewal failed for ${email}:`, err);
        }
      }
    }
  }, RENEWAL_CHECK_INTERVAL_MS);

  // Don't prevent process exit
  if (renewalInterval.unref) {
    renewalInterval.unref();
  }
}

/**
 * Stop the renewal scheduler (for graceful shutdown).
 */
export function stopWatchRenewalScheduler(): void {
  if (renewalInterval) {
    clearInterval(renewalInterval);
    renewalInterval = null;
    console.log('[Gmail Watch] Watch renewal scheduler stopped');
  }
}

/**
 * Persist watch state to Supabase gmail_watch_subscriptions table.
 */
async function persistWatchState(watchState: WatchState): Promise<void> {
  try {
    const { getSupabaseAdminClient } = await import('../../../src/lib/supabase/server');
    const supabase = getSupabaseAdminClient();

    // Look up account_id from email
    const { data: accounts } = await supabase
      .from('gmail_accounts')
      .select('id, user_id')
      .eq('email_address', watchState.email)
      .limit(1);

    if (!accounts || accounts.length === 0) {
      console.warn(`[Gmail Watch] No gmail_accounts row found for ${watchState.email}`);
      return;
    }

    const account = accounts[0];

    await supabase.from('gmail_watch_subscriptions').upsert(
      {
        account_id: account.id,
        user_id: account.user_id,
        topic_name: watchState.topicName,
        history_id: watchState.historyId,
        expiration: new Date(watchState.expiration).toISOString(),
        is_active: watchState.isActive,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'account_id' }
    );

    // Also update sync state historyId
    await supabase
      .from('gmail_sync_states')
      .update({
        last_history_id: watchState.historyId,
        updated_at: new Date().toISOString(),
      })
      .eq('account_id', account.id);
  } catch {
    // Supabase not configured — in-memory cache is the fallback
  }
}
