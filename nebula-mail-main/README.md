# Nebula Mail — AI-Driven Email Client

**Nebula Mail** (formerly Stitch Mail) is an enterprise-grade, AI-augmented email client built on the Stitch design system. It combines Google OAuth 2.0, direct Gmail API streaming, Google Cloud Pub/Sub push synchronization, Server-Sent Events (SSE), and a natural language AI Copilot action layer designed for user-in-the-loop productivity.

---

## 1. Project Overview & Problem Statement

Modern email clients present two recurring challenges:
1. **Information Overload & Manual Toil**: Finding specific messages, triaging high-volume inboxes, drafting contextual replies, and navigating between multiple threads requires repetitive manual actions.
2. **Untrusted AI Automation**: While generative AI models excel at text generation, unsupervised email clients that send messages autonomously introduce severe hallucination, miscommunication, and security risks.

**Nebula Mail solves both challenges** by introducing an **AI Copilot Action Layer**:
- The AI interprets natural language commands and emits **deterministic, validated UI actions** (such as populating compose fields, applying advanced search operator queries, or opening contextually relevant threads).
- The user retains **100% final authorization**: AI drafts or actions are pre-filled directly into interactive modals, with strictly **no automatic email dispatching**.
- Mail state stays synchronized in real time via **Google Cloud Pub/Sub** and **Server-Sent Events (SSE)**.

---

## 2. Key Features

- **Google OAuth 2.0 Authentication**:
  - Secure server-side authorization code exchange.
  - HttpOnly session cookies protecting tokens from client-side script access.
  - AES-256 token encryption at rest.
- **Direct Gmail API Integration**:
  - Full inbox and sent mailbox streaming (`threads.list`, `threads.get`).
  - RFC 2822 compliant MIME message composition and sending.
  - Batch history synchronizations via Gmail History API (`history.list`).
- **Real-Time Synchronization (Pub/Sub + SSE)**:
  - Google Cloud Pub/Sub push webhook listener receiving instant notifications on incoming emails and mailbox mutations.
  - Persistent Server-Sent Events (SSE) stream pushing updates to connected clients without manual polling.
  - Automatic watch renewal scheduler handling 7-day Gmail watch expirations.
- **AI Copilot Capabilities**:
  - **AI Compose**: Translates prompts into structured drafts with suggested recipients, subjects, and tailored tones.
  - **AI Search & Filter**: Translates natural language requests into valid Gmail operator queries (e.g., `from:sarah is:unread has:attachment`).
  - **AI Open Email**: Intelligently matches threads by sender, keywords, ordinal positions ("latest", "first", "last"), or contextual history.
  - **AI Context Awareness**: Injects currently active email thread content into AI reasoning for precise reference.
  - **AI Reply & Forward**: Context-aware drafting with recipient prefilling and subject thread management (`Re:`, `Fwd:`).
  - **Strict User-in-the-Loop Safeguard**: AI prepares and populates the compose modal; sending requires explicit human interaction.
- **Stitch Design System (Kinetic Precision)**:
  - Polished dark mode with ambient glassmorphism, responsive navigation, status pills, and keyboard shortcuts.

---

## 3. Architecture & Data Flow

```
                               ┌─────────────────────────────────────────┐
                               │             Nebula Frontend             │
                               │   (Vite + React / TypeScript + CSS)     │
                               └─────────────▲─────────────┬─────────────┘
                                             │             │
                                  SSE Stream │             │ REST / AI Requests
                           (Realtime Events) │             │ (/api/*)
                                             │             ▼
                               ┌─────────────────────────────────────────┐
                               │             Backend Server              │
                               │        (Express / TypeScript / Node)    │
                               └───────▲───────────────┬─────────▲───────┘
                                       │               │         │
                    Pub/Sub Push Hook  │   Gmail API   │         │ AI Invocations
                   (/api/gmail/pubsub) │   (RFC 2822)  │         │ (Gemini/LLM)
                                       │               ▼         │
                       ┌───────────────┴───┐     ┌───────────────┴───────┐
                       │ Google Cloud      │     │ AI Action Layer       │
                       │ - Cloud Pub/Sub   │     │ - Prompt Parser       │
                       │ - Gmail API       │     │ - Schema Validator    │
                       │ - OAuth 2.0       │     │ - Safe Action Model   │
                       └───────────────────┘     └───────────────────────┘
                                       │
                                       ▼
                       ┌─────────────────────────────────────────┐
                       │          Supabase (PostgreSQL)          │
                       │ - Encrypted Token Storage (AES-256)     │
                       │ - Gmail Mailbox Watch States            │
                       │ - App Metadata                          │
                       └─────────────────────────────────────────┘
```

### End-to-End Data Flows:
1. **Authentication Flow**:
   - User initiates Google OAuth via `/api/auth/google`.
   - Google redirects to `/api/auth/callback/google` with an authorization code.
   - The backend exchanges the code for tokens, encrypts the refresh token using AES-256, sets an HttpOnly cookie, and redirects the browser back to the UI.
2. **Mail Fetching Flow**:
   - Client calls `/api/gmail/threads`.
   - Backend decrypts user token, invokes Gmail API `threads.list` and `threads.get`, normalizes messages, and streams the result.
3. **Realtime Push Flow**:
   - External email arrives in user's Gmail mailbox.
   - Gmail notifies Google Cloud Pub/Sub topic.
   - Pub/Sub delivers push notification to `/api/gmail/pubsub/push`.
   - Backend queries Gmail History API using stored `historyId`, identifies changes, and broadcasts an SSE event (`/api/gmail/sync/events`).
   - Client UI receives event and updates inbox threads instantly without full page reloads.

---

## 4. AI Action Architecture & Safety Model

### Why Arbitrary Code Execution is Not Used
Nebula Mail rejects unsafe patterns like `eval()` or unconstrained agentic tool calling. Instead, it utilizes a **Strict Action Protocol**:
1. The LLM translates user intent into a typed JSON schema (`AIAction`):
   - `COMPOSE_EMAIL`: `{ to: string[], subject: string, body: string }`
   - `SEARCH_EMAILS`: `{ query: string, filter?: string }`
   - `OPEN_EMAIL`: `{ threadId?: string, emailId?: string }`
   - `REPLY_EMAIL`: `{ threadId: string, to: string[], body: string, replyAll: boolean }`
   - `FORWARD_EMAIL`: `{ threadId: string, to: string[], body: string }`
2. Actions are validated against strict runtime type schemas before execution.
3. If an action is invalid, ambiguous, or lacks context, the system safely falls back to a clarifying message.

### Why the AI Cannot Automatically Send an Email
Sending an email is an irrevocable real-world action. To guarantee safety:
- The backend and frontend explicitly disallow automated dispatch.
- When `COMPOSE_EMAIL`, `REPLY_EMAIL`, or `FORWARD_EMAIL` actions fire, they route into the **UI Compose Modal**, populating the input fields.
- Execution metadata verifies that `autoSent === false`.
- The user must review the drafted content and click **Send**.

---

## 5. Technology Stack

- **Frontend**: HTML5, Vanilla CSS / Stitch Design System Tokens, TypeScript, Vite.
- **Backend**: Node.js, Express, TypeScript, `tsx`.
- **Integrations**: `googleapis` (Gmail v1 & OAuth2), Google Cloud Pub/Sub, `@supabase/supabase-js`.
- **Testing**: Vitest, TSX test runners, Playwright/Browser Subagent test suites.
- **Security**: AES-256 token encryption, `cookie-parser`, CORS, CSRF token validation.

---

## 6. Local Setup Instructions

### Prerequisites
- Node.js (v18.0.0 or higher)
- npm (v9.0.0 or higher)
- Google Cloud Platform account with Gmail API & Pub/Sub enabled
- Supabase project (optional, in-memory fallback included)

### Step 1: Install Dependencies
```bash
git clone <repository-url>
cd stitch_ai_driven_email_client
npm install
```

### Step 2: Configure Environment Variables
Copy `.env.example` to `.env.local`:
```bash
cp .env.example .env.local
```
Fill in the required variables (never commit `.env.local` to Git):
```env
# Frontend (Browser safe)
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key

# Backend (Server-side ONLY)
SERVER_PORT=3001
CLIENT_ORIGIN=http://localhost:5173
GMAIL_CLIENT_ID=your-client-id.apps.googleusercontent.com
GMAIL_CLIENT_SECRET=your-client-secret
GMAIL_REDIRECT_URI=http://localhost:5173/api/auth/callback/google
TOKEN_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
GMAIL_PUBSUB_TOPIC=projects/your-gcp-project/topics/gmail-notifications
AI_API_KEY=your-gemini-or-llm-api-key
NODE_ENV=development
```

### Step 3: Google Cloud & Pub/Sub Setup
1. Enable **Gmail API** and **Cloud Pub/Sub API** in your Google Cloud Console.
2. Create OAuth 2.0 Credentials (Web Application):
   - Authorized Javascript Origin: `http://localhost:5173`
   - Authorized Redirect URI: `http://localhost:5173/api/auth/callback/google`
3. Create a Pub/Sub topic (e.g., `gmail-notifications`) and grant the `Pub/Sub Publisher` role to `gmail-api-push@system.gserviceaccount.com`.

### Step 4: Run Application
Open two terminal windows:

**Terminal 1 (Backend Server):**
```bash
npm run server:dev
# Server listens on http://localhost:3001
```

**Terminal 2 (Frontend Client):**
```bash
npm run dev
# App available at http://localhost:5173
```

---

## 7. Production Deployment

For in-depth deployment architecture, Dockerfiles, cloud environment variable reference, and production checklist, consult [DEPLOYMENT.md](DEPLOYMENT.md).

### Summary:
- **Build**: Run `npm run build` (`tsc && vite build`).
- **Start**: Run `npm run start` (`tsx server/src/index.ts`).
- **Cloud Run / Container Binding**: Backend listens on dynamic `process.env.PORT || 3001`.
- **Reverse Proxy / CORS**: Ensure `CLIENT_ORIGIN` matches the production frontend domain.

---

## 8. Verified Test Results & Audit Summary

Across Parts 1–14, all test suites, typechecks, and production builds were executed and verified:

| Test Suite / Step | Tests Run | Result | Coverage Area |
|---|:---:|:---:|---|
| **Vitest (`npm test`)** | 22 | **PASS (22/22)** | SSE Manager, Pub/Sub webhook parsing, Action dispatching |
| **AI Actions (`ai-actions.test.ts`)** | 31 | **PASS (31/31)** | Schema validation, type guards, action safety |
| **AI Compose (`ai-compose.test.ts`)** | 27 | **PASS (27/27)** | Natural language drafting, recipient extraction |
| **AI Search (`ai-search.test.ts`)** | 22 | **PASS (22/22)** | Operator query mapping (`from:`, `is:unread`, `has:attachment`) |
| **AI Open Email (`ai-open-email.test.ts`)** | 33 | **PASS (33/33)** | Thread ID heuristics, ordinal matching, empty list guards |
| **AI Reply/Forward (`ai-reply-forward.test.ts`)** | 33 | **PASS (33/33)** | Thread preservation, `Re:`/`Fwd:`, strict **NO AUTO-SEND** |
| **Total Automated Tests (`npm run test:all`)** | **168** | **168/168 PASSED** | End-to-end integration & copilot validation |
| **TypeScript Typecheck (`npm run typecheck`)** | - | **0 Errors** | Strict TypeScript compilation (`tsc --noEmit`) |
| **Production Build (`npm run build`)** | - | **SUCCESS** | Clean bundle generation (`dist/`) in ~1.47s |

---

## 9. Security Architecture

- **Server-Side Token Storage**: OAuth client secret and refresh tokens never touch client-side storage or browser bundles.
- **AES-256 Token Encryption**: Tokens at rest are encrypted using `TOKEN_ENCRYPTION_KEY`.
- **HttpOnly Cookies**: Authentication cookies are protected with `httpOnly: true`, `sameSite: 'lax'`, and `secure: true` in production.
- **Zero Client Bundle Leaks**: Verified zero private keys or secret variables exist in `dist/assets/*.js`.
- **Pub/Sub Webhook Security**: Handlers validate Pub/Sub payload envelopes and sanitize user email mapping.
- **SSE User Isolation**: Server-Sent Events are partitioned by authenticated user ID; messages are never cross-broadcasted.

---

## 10. Screenshots & UI Demonstration

| View | Description | Key Elements |
|---|---|---|
| **Live Gmail Inbox** | Primary mailbox view with real-time stream | Thread badges, unread indicators, real-time sync pill |
| **Email Detail View** | Full email reading pane | Sender details, timestamp, body renderer, quick reply |
| **Compose Modal** | Standard compose dialog | Recipient input, subject, body editor, manual send button |
| **AI Action Bar / Copilot** | Floating AI prompt input | Natural language input, prompt suggestions, action preview |
| **AI Compose in Action** | Pre-filling email drafts | Auto-populated recipient, subject, and customized tone |
| **AI Search & Operators** | Live filtering via Gmail queries | Filter bar displaying parsed query operators |
| **Realtime Sync Notification** | Visual toast when incoming email arrives | Realtime banner, instant list update without page refresh |

---

## 11. Demo Video Workflow Guide******
video link:https://drive.google.com/file/d/1akRrfLKA30s0rnEVOhmhhMrqztckMslK/view?usp=sharing


For the submission demo recording, follow this 10-step flow:
1. **Login with Google**: Demonstrate clicking "Connect Live Gmail" and completing Google OAuth consent.
2. **Inbox Loading**: Display the inbox populating directly from Gmail API.
3. **Open Email**: Click an email thread to open the full message detail view.
4. **Manual Compose**: Open compose modal, enter details, and preview message formatting.
5. **AI Compose**: Enter a prompt such as *"Draft a quick meeting follow-up to Alex thanking him for the update"* and show the modal auto-filling.
6. **AI Search & Filter**: Type *"Show unread emails with attachments"* and show the live filter query applied.
7. **AI Open Email**: Enter *"Open the latest email"* or *"Open the invoice from billing"* and observe the email opening.
8. **AI Reply**: With an email open, enter *"Reply saying I will attend tomorrow's meeting"* and show the reply draft pre-filled with `Re:`.
9. **AI Forward**: With an email open, enter *"Forward this to team@example.com with note: please review"* and observe the forward draft.
10. **Real-time Synchronization**: Send an email to the inbox from an external client; demonstrate the notification appearing and thread displaying instantly via Pub/Sub and SSE.

---

## 12. Future Improvements & Roadmap

- **Multi-Account Support**: Unified inbox handling multiple connected Google or IMAP accounts.
- **Attachment Handling**: Uploading and downloading attachments directly through Gmail API.
- **Offline Mode & IndexedDB**: Local caching of threads for offline browsing with optimistic updates.
- **Fine-Grained AI Summarization**: On-demand summarization for long conversation threads.
- **Custom AI Action Workflows**: User-defined macros (e.g., triage labels, automated drafts based on priority).
