/**
 * Gmail Sync Routes
 *
 * Handles:
 * 1. POST /api/gmail/pubsub/push — Pub/Sub push endpoint for Gmail notifications
 * 2. GET /api/gmail/sync/events — SSE endpoint for real-time frontend notifications
 * 3. POST /api/gmail/sync/watch — Manual watch creation
 * 4. GET /api/gmail/sync/status — Sync status endpoint
 */

import { Router, Request, Response } from 'express';
import { processHistorySync, isHistoryIdProcessed } from '../services/gmail-history.service';
import { createWatch, getAllWatchStates } from '../services/gmail-watch.service';
import { sseManager } from '../services/sse-manager';
import type { GmailPubSubPushMessage, GmailPubSubPayload } from '../../../src/lib/gmail/types';

// ============================================================================
// Pub/Sub Push Router
// ============================================================================

export const pubsubRouter = Router();

/**
 * POST /api/gmail/pubsub/push
 *
 * Google Cloud Pub/Sub push endpoint.
 * Receives notifications when a Gmail mailbox changes.
 *
 * Flow:
 * 1. Validate the incoming Pub/Sub message structure
 * 2. Decode the base64 data field → { emailAddress, historyId }
 * 3. Call processHistorySync() for the affected user
 * 4. Return 200 to acknowledge (prevents Pub/Sub retries)
 */
pubsubRouter.post('/push', async (req: Request, res: Response) => {
  try {
    const body = req.body as GmailPubSubPushMessage;

    // Validate Pub/Sub message structure
    if (!body || !body.message || !body.message.data) {
      console.warn('[Pub/Sub Push] Malformed payload received — missing message.data');
      return res.status(400).json({
        error: 'Malformed Pub/Sub payload',
        message: 'Expected { message: { data: string } }',
      });
    }

    // Validate subscription if configured
    const expectedSubscription = process.env.GMAIL_PUBSUB_SUBSCRIPTION;
    if (expectedSubscription && body.subscription && body.subscription !== expectedSubscription) {
      console.warn(
        `[Pub/Sub Push] Unexpected subscription: ${body.subscription} (expected: ${expectedSubscription})`
      );
      return res.status(403).json({
        error: 'Unauthorized subscription',
      });
    }

    // Decode base64 data
    let payload: GmailPubSubPayload;
    try {
      const decoded = Buffer.from(body.message.data, 'base64').toString('utf8');
      payload = JSON.parse(decoded);
    } catch {
      console.warn('[Pub/Sub Push] Failed to decode message data');
      return res.status(400).json({
        error: 'Invalid message data',
        message: 'Could not decode base64 data field',
      });
    }

    // Validate decoded payload
    if (!payload.emailAddress || !payload.historyId) {
      console.warn('[Pub/Sub Push] Decoded payload missing required fields');
      return res.status(400).json({
        error: 'Invalid notification payload',
        message: 'Missing emailAddress or historyId',
      });
    }

    // Check for duplicate processing
    if (isHistoryIdProcessed(payload.emailAddress, payload.historyId)) {
      console.log(
        `[Pub/Sub Push] Duplicate notification skipped for ${payload.emailAddress}, historyId: ${payload.historyId}`
      );
      return res.status(200).json({ status: 'duplicate', skipped: true });
    }

    console.log(
      `[Pub/Sub Push] Processing notification for ${payload.emailAddress}, historyId: ${payload.historyId}`
    );

    // Process history sync asynchronously but acknowledge immediately
    // This prevents Pub/Sub from retrying while we process
    processHistorySync(payload.emailAddress, payload.historyId)
      .then((result) => {
        if (result.success) {
          console.log(
            `[Pub/Sub Push] History sync completed for ${payload.emailAddress}: +${result.messagesAdded} added, -${result.messagesDeleted} deleted`
          );
        } else {
          console.warn(
            `[Pub/Sub Push] History sync failed for ${payload.emailAddress}: ${result.error}`
          );
        }
      })
      .catch((err) => {
        console.error('[Pub/Sub Push] Unhandled error during history sync:', err);
      });

    // Acknowledge receipt to Pub/Sub (always 200 to prevent retries)
    return res.status(200).json({
      status: 'accepted',
      email: payload.emailAddress,
      historyId: payload.historyId,
    });
  } catch (err) {
    const error = err as Error;
    console.error('[Pub/Sub Push] Unhandled error:', error.message);
    // Still return 200 to prevent infinite Pub/Sub retries
    return res.status(200).json({
      status: 'error',
      message: 'Internal error processing notification',
    });
  }
});

// ============================================================================
// Sync Management Router
// ============================================================================

export const syncRouter = Router();

/**
 * GET /api/gmail/sync/events
 *
 * Server-Sent Events (SSE) endpoint.
 * Clients connect here to receive real-time Gmail change notifications.
 *
 * - Authenticates via session cookie / x-user-email header
 * - Registers connection in SSE manager
 * - Sends heartbeat to keep connection alive
 * - Scoped to authenticated user only
 */
syncRouter.get('/events', (req: Request, res: Response) => {
  // Identify the user
  const email =
    (req.headers['x-user-email'] as string) ||
    (req.cookies && req.cookies.stitch_user_email) ||
    '';

  if (!email) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'No authenticated user email found for SSE connection',
    });
  }

  // Register SSE client — headers and initial event are sent by the manager
  sseManager.addClient(email, res);

  // The response stays open; Express won't end it.
  // Cleanup happens on 'close' event in the SSE manager.
});

/**
 * POST /api/gmail/sync/watch
 *
 * Create or renew a Gmail mailbox watch for the authenticated user.
 * Returns watch state including historyId and expiration.
 */
syncRouter.post('/watch', async (req: Request, res: Response) => {
  try {
    const watchState = await createWatch(req);

    if (!watchState) {
      return res.status(400).json({
        error: 'Watch creation failed',
        message:
          'Could not create Gmail watch. Ensure GMAIL_PUBSUB_TOPIC is configured and user is authenticated.',
      });
    }

    return res.json({
      success: true,
      watch: {
        email: watchState.email,
        historyId: watchState.historyId,
        expiration: new Date(watchState.expiration).toISOString(),
        expiresInHours: Math.round((watchState.expiration - Date.now()) / 1000 / 60 / 60),
        isActive: watchState.isActive,
      },
    });
  } catch (err) {
    const error = err as Error;
    console.error('[Sync Watch] Error creating watch:', error.message);
    return res.status(500).json({
      error: 'Failed to create Gmail watch',
      message: error.message,
    });
  }
});

/**
 * GET /api/gmail/sync/status
 *
 * Returns current sync and watch status.
 * Used by the frontend for health checks and fallback polling.
 */
syncRouter.get('/status', (_req: Request, res: Response) => {
  const watches = getAllWatchStates();
  const connections = sseManager.getConnectionCount();

  const pubsubConfigured = Boolean(
    process.env.GMAIL_PUBSUB_TOPIC && process.env.GMAIL_PUBSUB_SUBSCRIPTION
  );

  return res.json({
    realtimeEnabled: pubsubConfigured,
    pubsubConfigured,
    watches: watches.map((w) => ({
      email: w.email,
      historyId: w.historyId,
      expiration: new Date(w.expiration).toISOString(),
      expiresInHours: Math.max(0, Math.round((w.expiration - Date.now()) / 1000 / 60 / 60)),
      isActive: w.isActive,
    })),
    sseConnections: connections,
    serverTimestamp: new Date().toISOString(),
  });
});
