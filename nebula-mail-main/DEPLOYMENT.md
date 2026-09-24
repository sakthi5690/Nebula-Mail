# Nebula Mail - Production Deployment Guide

This document outlines the end-to-end production architecture, environment configuration, Google Cloud Console setup, and step-by-step deployment instructions for **Nebula Mail (Stitch AI-Driven Email Client)**.

---

## 1. Production Architecture Overview

The Nebula Mail application is designed for cloud-native deployment with strict separation between client assets and backend orchestration:

```
                  ┌─────────────────────────────────────────────────────────┐
                  │                      User Browser                       │
                  └───────────────┬─────────────────────────▲───────────────┘
                                  │                         │
                   Static Assets  │          SSE Events /   │  REST API Calls
                   (HTML/JS/CSS)  │          OAuth Callback │  (/api/*)
                                  ▼                         │
                  ┌────────────────────────┐       ┌────────┴────────────────┐
                  │   Frontend Host        │       │   Backend Server        │
                  │   (Vercel / Cloudflare │       │   (Cloud Run / Render / │
                  │    Pages / Netlify)    │       │    Railway / AWS ECS)   │
                  └────────────────────────┘       └───────▲─────────┬───────┘
                                                           │         │
                                             Pub/Sub Push  │         │ OAuth / Gmail API
                                             Webhook       │         ▼
                                            ┌──────────────┴───────────────┐
                                            │      Google Cloud Platform   │
                                            │  - Cloud Pub/Sub Topic & Sub │
                                            │  - Gmail API (Users & Watch) │
                                            │  - Google OAuth 2.0 Client   │
                                            └──────────────┬───────────────┘
                                                           │
                                                           ▼
                                            ┌──────────────────────────────┐
                                            │      Supabase Cloud          │
                                            │  - PostgreSQL DB             │
                                            │  - Encrypted Token Storage   │
                                            │  - Application Metadata      │
                                            └──────────────────────────────┘
```

### Key Deployment Characteristics:
1. **Frontend**: Vite SPA built as static bundles (`dist/`) deployable to any CDN / Static Site Host.
2. **Backend**: Express TypeScript server executing on Node.js 18+ / 20+, listening on `PORT` (or `SERVER_PORT`) with `0.0.0.0` cloud binding.
3. **Realtime**: Server-Sent Events (`/api/gmail/sync/events`) maintains persistent streaming connections with isolated per-user/session channels and heartbeat keep-alives.
4. **Push Webhooks**: Public HTTPS route (`/api/gmail/pubsub/push`) receives encrypted Base64 notifications from GCP Pub/Sub.

---

## 2. Production Environment Variables

All sensitive credentials remain strictly **server-side**. Frontend variables use the safe public `VITE_` prefix for browser access.

### Frontend Environment Variables (`.env.production` or Host Dashboard)
| Variable | Required | Description | Example / Notes |
|---|:---:|---|---|
| `VITE_SUPABASE_URL` | Optional | Supabase Project URL for client-side metadata | `https://[project-id].supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Optional | Public anonymous key (Safe for browser client) | `eyJhbGciOi...` |
| `VITE_API_URL` | Optional | Custom backend origin if frontend is hosted on separate domain without reverse proxy | `https://api.yourdomain.com` (Defaults to relative `/api`) |

> [!NOTE]
> No OAuth secrets, service role keys, or token encryption keys are ever bundled into the client build.

---

### Backend Environment Variables (Cloud Run / Render / Railway Secrets)
| Variable | Required | Category | Description |
|---|:---:|---|---|
| `PORT` | Yes | Server | Port assigned dynamically by cloud host (e.g., 8080, 3001) |
| `NODE_ENV` | Yes | Server | Set to `production` |
| `CLIENT_ORIGIN` | Yes | CORS / Redirects | Production frontend URL, e.g. `https://nebula-mail.yourdomain.com` |
| `GMAIL_CLIENT_ID` | Yes | OAuth 2.0 | Google Cloud OAuth Client ID |
| `GMAIL_CLIENT_SECRET` | Yes | OAuth 2.0 | Google Cloud OAuth Client Secret (Keep Private) |
| `GMAIL_REDIRECT_URI` | Yes | OAuth 2.0 | Full production callback URL: `https://api.yourdomain.com/api/auth/callback/google` |
| `TOKEN_ENCRYPTION_KEY` | Yes | Security | 32-byte (64 hex character) key used for AES-256 token encryption at rest |
| `GMAIL_PUBSUB_TOPIC` | Yes | Pub/Sub | Topic path: `projects/[GCP-PROJECT-ID]/topics/[TOPIC-NAME]` |
| `GMAIL_PUBSUB_SUBSCRIPTION` | Optional | Pub/Sub | Subscription path: `projects/[GCP-PROJECT-ID]/subscriptions/[SUB-NAME]` |
| `SUPABASE_SERVICE_ROLE_KEY` | Optional | Database | Supabase secret key for server-side persistence & watch states |
| `DATABASE_URL` | Optional | Database | Direct PostgreSQL connection string for migrations |
| `AI_API_KEY` | Optional | AI Copilot | Gemini / Claude / OpenAI API Key for AI action generation |
| `AI_MODEL_NAME` | Optional | AI Copilot | Model name (defaults to `gemini-2.5-flash`) |

---

## 3. Google Cloud Console Configuration

### A. OAuth 2.0 Client Credentials
1. Go to **Google Cloud Console** -> **APIs & Services** -> **Credentials**.
2. Select your OAuth 2.0 Client ID (Web Application).
3. Under **Authorized JavaScript origins**, add:
   - `https://your-frontend-domain.com`
   - `https://api.your-backend-domain.com`
4. Under **Authorized redirect URIs**, add:
   - `https://api.your-backend-domain.com/api/auth/callback/google`
   - (If using a reverse proxy where frontend serves `/api`): `https://your-frontend-domain.com/api/auth/callback/google`
5. Save changes.

### B. OAuth Consent Screen
1. Set User Type to **External** (or **Internal** if using Google Workspace).
2. Configure application name, support email, and developer contact.
3. Add Scopes:
   - `https://www.googleapis.com/auth/gmail.readonly`
   - `https://www.googleapis.com/auth/gmail.send`
   - `https://www.googleapis.com/auth/gmail.modify`
   - `https://www.googleapis.com/auth/userinfo.email`
   - `https://www.googleapis.com/auth/userinfo.profile`
4. If in "Testing" publishing status, add all tester Google account emails under **Test users**.

### C. Google Cloud Pub/Sub Setup
1. Go to **Pub/Sub** -> **Topics** -> Create Topic (e.g. `gmail-notifications`).
2. Add the Gmail API Service Account as a Publisher:
   - Click Topic -> **Permissions** -> **Add Principal**.
   - Principal: `gmail-api-push@system.gserviceaccount.com`
   - Role: `Pub/Sub Publisher` (`roles/pubsub.publisher`).
3. Create a **Push Subscription**:
   - Subscription ID: `gmail-notifications-push`
   - Delivery Type: **Push**
   - Push Endpoint: `https://api.your-backend-domain.com/api/gmail/pubsub/push`
   - Enable payload unwrapping: unchecked (server handles standard Pub/Sub message wrapping).
   - Set Ack deadline to `30 seconds`.

---

## 4. Supabase Database Configuration

Ensure the following tables are present for persistent user state, watch renewal, and sync tracking:

```sql
-- Watch state tracking
create table if not exists public.gmail_watches (
  email text primary key,
  history_id text not null,
  expiration bigint not null,
  topic_name text not null,
  is_active boolean default true,
  updated_at timestamp with time zone default now()
);

-- User tokens (encrypted)
create table if not exists public.user_tokens (
  email text primary key,
  tokens_encrypted text not null,
  updated_at timestamp with time zone default now()
);
```

---

## 5. Deployment Options & Step-by-Step Execution

### Option 1: Unified Cloud Run / Docker Container (Recommended)
You can deploy the Node/TypeScript backend as a Docker container.

#### `Dockerfile`:
```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json tsconfig*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server ./server
COPY --from=builder /app/src ./src
COPY --from=builder /app/tsconfig.json ./tsconfig.json
EXPOSE 8080
CMD ["npx", "tsx", "server/src/index.ts"]
```

Deploy using Google Cloud CLI:
```bash
gcloud run deploy nebula-mail-backend \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars="NODE_ENV=production,PORT=8080,CLIENT_ORIGIN=https://nebula-mail.web.app"
```

### Option 2: Render / Railway / Heroku (Backend) + Vercel (Frontend)
1. **Backend**:
   - Build Command: `npm ci`
   - Start Command: `npm run start`
   - Configure environment variables in the service dashboard.
2. **Frontend**:
   - Build Command: `npm run build`
   - Output Directory: `dist`
   - Configure `VITE_API_URL` pointing to the live backend URL.

---

## 6. Post-Deployment Verification Checklist

1. **Backend Health Check**:
   - Request `GET https://api.yourdomain.com/api/health`
   - Verify `{"status": "ok", "service": "stitch-mail-backend", "environment": "production"}`.
2. **OAuth Flow**:
   - Click "Connect Live Gmail" in the frontend.
   - Authorize Google account.
   - Verify browser redirects to `https://yourdomain.com/?auth_success=true&email=...` with valid session cookie.
3. **SSE Connection**:
   - Inspect browser network panel for `GET /api/gmail/sync/events`.
   - Verify HTTP status `200` with `Content-Type: text/event-stream` and periodic `:heartbeat` events.
4. **Gmail Watch Registration**:
   - Call `/api/gmail/pubsub/watch` or verify auto-watch creation on initial login.
   - Verify watch status indicates `active: true` with expiration ~7 days in the future.
5. **Realtime Pub/Sub Webhook**:
   - Send a test email from an external account to the connected Gmail inbox.
   - Verify Google Pub/Sub sends POST to `/api/gmail/pubsub/push`.
   - Verify backend logs: `[PubSub Push] Processing notification for: user@domain.com, historyId: ...`.
   - Verify UI updates in real-time with incoming message notification.
6. **AI Action Verification**:
   - Test AI Search (`from:support is:unread`).
   - Test AI Compose / AI Reply / AI Forward modal prefilling.
   - Confirm draft is generated without automatic dispatch.
