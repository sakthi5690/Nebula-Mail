# Supabase Setup Guide — Stitch AI-Driven Email Client

This guide explains how to configure your newly created Supabase project to support the Stitch AI-Driven Email Client.

---

## 1. Run Database Schema Migration

1. Open your [Supabase Project Dashboard](https://supabase.com/dashboard).
2. Go to the **SQL Editor** tab on the left navigation bar.
3. Click **"New Query"**.
4. Copy the entire contents of the migration file:
   [`supabase/migrations/20260904000000_init_schema.sql`](file:///c:/Users/priya/Downloads/stitch_ai_driven_email_client/stitch_ai_driven_email_client/supabase/migrations/20260904000000_init_schema.sql)
5. Paste it into the query editor and click **"Run"**.

This will automatically create:
- `user_profiles` (links with Supabase Auth)
- `gmail_accounts` (OAuth connection state and encrypted token fields)
- `gmail_sync_states` (Pub/Sub sync telemetry, history IDs, latency)
- `gmail_watch_subscriptions` (Google Pub/Sub watch expiration tracker)
- `user_preferences` (theme, shortcuts, AI Copilot tone)
- Row Level Security (RLS) policies ensuring users only read their own data
- Realtime publication subscriptions on `gmail_sync_states` and `user_preferences`

---

## 2. Obtain Your Supabase API Credentials

1. In your Supabase Dashboard, navigate to **Project Settings** (gear icon) -> **API**.
2. Copy the following values:
   - **Project URL**
   - **anon (public)** key
   - **service_role (secret)** key

---

## 3. Configure Local Environment Variables

1. Copy `.env.example` to `.env.local`:
   ```bash
   cp .env.example .env.local
   ```
2. Populate the keys:
   ```bash
   # Safe for browser / client:
   VITE_SUPABASE_URL=https://<your-project-id>.supabase.co
   VITE_SUPABASE_ANON_KEY=<your-anon-public-key>

   # Server-side ONLY (never committed, never exposed to client bundle):
   SUPABASE_SERVICE_ROLE_KEY=<your-service-role-secret-key>
   ```

---

## 4. Enable Google OAuth in Supabase (Preparation for Part 5)

1. In Supabase Dashboard, go to **Authentication** -> **Providers**.
2. Select **Google** and toggle it **ON**.
3. (When ready in Part 5): Add your Google Client ID and Google Client Secret.
4. Set the Callback URL from Supabase into your Google Cloud Console Authorized Redirect URIs.

---

## 5. Security & Architectural Invariants Verified

- **Frontend Security**: Browser client only initializes with `VITE_SUPABASE_ANON_KEY`.
- **Server Token Security**: `SUPABASE_SERVICE_ROLE_KEY` and encrypted tokens are isolated in `src/lib/supabase/server.ts` and blocked from client execution.
- **Gmail Source of Truth**: Full email messages, threads, and attachments are NOT stored in Supabase. Supabase exclusively tracks metadata, sync state, and application preferences.
