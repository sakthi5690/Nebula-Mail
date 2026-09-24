# Real-Time Gmail Sync Setup Guide

This guide explains how to configure Google Cloud Pub/Sub for real-time Gmail push notifications in the Stitch AI Mail Client.

## Overview

The real-time sync architecture follows this flow:

```
Gmail Mailbox Change
  → Gmail API Watch (users.watch)
  → Google Cloud Pub/Sub Topic
  → Pub/Sub Push Subscription → POST /api/gmail/pubsub/push
  → Gmail History API (incremental sync)
  → SSE Notification → Frontend Auto-Refresh
```

## Prerequisites

- Google Cloud Project with Gmail API enabled
- Google Cloud Pub/Sub API enabled
- A Gmail OAuth account connected to Stitch

## Step 1: Create a Pub/Sub Topic

1. Go to [Google Cloud Console → Pub/Sub](https://console.cloud.google.com/cloudpubsub)
2. Click **Create Topic**
3. Topic ID: `gmail-notifications` (or any name you prefer)
4. Full topic name will be: `projects/YOUR_PROJECT_ID/topics/gmail-notifications`

### Grant Gmail Publish Permissions

Gmail needs permission to publish to your topic. Grant the `Pub/Sub Publisher` role to the Gmail service account:

```bash
gcloud pubsub topics add-iam-policy-binding gmail-notifications \
  --member="serviceAccount:gmail-api-push@system.gserviceaccount.com" \
  --role="roles/pubsub.publisher"
```

## Step 2: Create a Pub/Sub Push Subscription

1. In the Pub/Sub console, select your topic
2. Click **Create Subscription**
3. Subscription ID: `gmail-sub`
4. Delivery type: **Push**
5. Push endpoint URL: `https://YOUR_DOMAIN/api/gmail/pubsub/push`
6. For local development, you'll need a tunnel (see below)

Full subscription name: `projects/YOUR_PROJECT_ID/subscriptions/gmail-sub`

## Step 3: Configure Environment Variables

Add these to your `.env.local`:

```env
# Google Cloud Pub/Sub Topic for Gmail push notifications
GMAIL_PUBSUB_TOPIC=projects/YOUR_PROJECT_ID/topics/gmail-notifications
GMAIL_PUBSUB_SUBSCRIPTION=projects/YOUR_PROJECT_ID/subscriptions/gmail-sub
```

> **Security**: Never commit actual values to version control. These are configuration references, not secrets.

## Step 4: Create a Gmail Watch

After the server is running and a user is authenticated:

```bash
# Create a watch via the API
curl -X POST http://localhost:3001/api/gmail/sync/watch \
  -H "Content-Type: application/json" \
  -H "x-user-email: YOUR_EMAIL" \
  --cookie "stitch_session=YOUR_SESSION_ID"
```

Or use the frontend — the watch is created automatically when real-time sync initializes.

### Watch Expiration

- Gmail watches expire after approximately **7 days**
- The server automatically checks for expiring watches **every hour**
- Watches are renewed when they have **less than 24 hours** until expiration

## Step 5: Verify Real-Time Sync

Check the sync status endpoint:

```bash
curl http://localhost:3001/api/gmail/sync/status
```

Expected response:
```json
{
  "realtimeEnabled": true,
  "pubsubConfigured": true,
  "watches": [
    {
      "email": "user@gmail.com",
      "historyId": "12345",
      "expiration": "2026-09-12T00:00:00.000Z",
      "expiresInHours": 168,
      "isActive": true
    }
  ],
  "sseConnections": { "total": 1, "byEmail": { "user@gmail.com": 1 } },
  "serverTimestamp": "2026-09-05T06:00:00.000Z"
}
```

## Local Development

### Without Pub/Sub (Fallback Mode)

If you don't configure Pub/Sub, the application still works using **fallback mechanisms**:

1. **Periodic polling**: Every 5 minutes, the frontend checks for changes
2. **Tab focus refresh**: When you switch back to the tab, the current view is refreshed
3. **Manual refresh**: The refresh button in the UI always works

No additional setup is needed for fallback mode.

### With Pub/Sub (Full Real-Time)

For local development with real-time push, you need to expose your local server to the internet:

1. **Use ngrok or similar tunnel**:
   ```bash
   ngrok http 3001
   ```

2. **Update your Pub/Sub subscription** push endpoint to the ngrok URL:
   ```
   https://YOUR_NGROK_ID.ngrok.io/api/gmail/pubsub/push
   ```

3. **Set environment variables** in `.env.local`

4. **Start the server and create a watch**

## Architecture Details

### Server-Sent Events (SSE)

The frontend connects to `GET /api/gmail/sync/events` using the `EventSource` API. This provides:
- Real-time event delivery from server to client
- Automatic reconnection with exponential backoff
- No additional dependencies (built into browsers)
- User-scoped events (multi-session safe)

### History API Sync

When a Pub/Sub notification arrives:
1. The backend retrieves the stored `historyId` for the user
2. Calls `gmail.users.history.list()` to get incremental changes
3. Processes all pages of changes
4. Updates the stored `historyId`
5. Notifies the frontend via SSE

If the `historyId` has expired (Gmail returns 404), the system automatically:
1. Gets a fresh `historyId` from the user's profile
2. Notifies the frontend to do a full mailbox refresh
3. No crash or data loss occurs

### Duplicate Prevention

- Each `historyId` is tracked in a time-bounded dedup cache (10 minutes)
- Duplicate Pub/Sub notifications are detected and skipped
- Frontend refreshes are throttled (minimum 10 seconds between refreshes)

### Security

- No OAuth tokens, refresh tokens, or secrets are exposed via SSE
- Pub/Sub subscription validation checks the subscription name
- SSE connections require authenticated user email
- No email bodies or credentials are logged

## Troubleshooting

### SSE Connection Fails
- Ensure the server is running on the expected port
- Check that cookies are being sent (credentials: include)
- Verify the user email is in the session

### Watch Creation Fails
- Ensure `GMAIL_PUBSUB_TOPIC` is set correctly
- Verify the Gmail API has Pub/Sub permissions
- Check that the authenticated user has a valid refresh token

### No Real-Time Updates
- Verify the Pub/Sub push subscription is active
- Check the server logs for incoming push notifications
- Ensure the watch hasn't expired (check `/api/gmail/sync/status`)

### History Sync Errors
- If historyId is expired, a full resync is triggered automatically
- Check server logs for `[History Sync]` messages
- Verify the Gmail API quota hasn't been exceeded
