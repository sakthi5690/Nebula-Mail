import { getSupabaseBrowserClient } from './lib/supabase/client';
import { getClientEnv } from './config/env';
import { frontendGmailApi } from './lib/gmail/api-client';
import type { GmailSyncState, EmailThread, EmailMessage } from './types';
import { registerUIOperations, executeAIAction } from './lib/ai/executor';
import { registerAppStateReader, getAIContext } from './lib/ai/context';
import type { NavDestination } from './lib/ai/actions.types';
import { gmailRealtimeSync, type GmailChangeData } from './lib/gmail/realtime-sync';

/**
 * Stitch AI Mail Client - Main Application Controller
 * Orchestrates:
 * 1. Live Inbox Thread listing via Gmail API
 * 2. Message Detail Fetching & Display
 * 3. Sent Mailbox Listing
 * 4. Email Composition & Duplicate-Safe Sending
 * 5. Full-Text Mailbox Search
 * 6. Google OAuth Authorization & Realtime Telemetry
 * 7. AI Action Architecture & Context Execution
 */

const GMAIL_CONNECTED_KEY = 'stitch_gmail_connected_email';

// State
let currentMailbox: 'inbox' | 'sent' | 'search' = 'inbox';
let currentSearchQuery = '';
let currentNextPageToken: string | undefined = undefined;
let isSending = false;
let selectedEmailId: string | null = null;
let selectedEmailDetails: { sender?: string; subject?: string } | null = null;
let currentVisibleThreads: EmailThread[] = [];

function initializeApp() {
  const env = getClientEnv();
  const client = getSupabaseBrowserClient();

  console.log('[Stitch AI Mail] Initializing client...');

  // 1. Handle OAuth return redirect
  handleOAuthReturn();

  // 2. Restore persisted connection
  restoreGmailConnectionState();

  // 3. Check live backend authentication status & connect UI
  checkLiveAuthAndLoad();

  // 4. Wire DOM interactive triggers
  wireSidebarNavigation();
  wireSearchInput();
  wireComposeModal();
  wireDetailModal();
  wireConnectGmailButton();

  // 5. Register AI Action Layer Operations and App State Reader
  registerUIOperations({
    openComposeModal,
    closeComposeModal,
    openEmailDetail,
    closeEmailDetail,
    executeSearch,
    loadInboxThreads,
    loadSentThreads,
    highlightNav,
    getSelectedEmailId: () => selectedEmailId,
    getSelectedEmailDetails: () => selectedEmailDetails,
    applyFilter: (filterType: string, active: boolean) => {
      if (active) {
        if (filterType === 'unread') executeSearch('is:unread');
        else if (filterType === 'starred') executeSearch('is:starred');
        else if (filterType === 'has_attachment') executeSearch('has:attachment');
        else if (filterType === 'important') executeSearch('is:important');
        else loadInboxThreads();
      } else {
        loadInboxThreads();
      }
    },
  });

  registerAppStateReader({
    getCurrentMailbox: () => (currentMailbox === 'search' ? 'inbox' : (currentMailbox as NavDestination)),
    getCurrentSearchQuery: () => currentSearchQuery || null,
    getSelectedEmailId: () => selectedEmailId,
    isComposeOpen: () => {
      const modal = document.getElementById('composeModal');
      return modal ? modal.style.display !== 'none' : false;
    },
    isDetailOpen: () => {
      const modal = document.getElementById('emailDetailModal');
      return modal ? modal.style.display !== 'none' : false;
    },
    getActiveFilters: () => {
      const filters: string[] = [];
      if (currentSearchQuery.includes('is:unread')) filters.push('unread');
      if (currentSearchQuery.includes('is:starred')) filters.push('starred');
      if (currentSearchQuery.includes('has:attachment')) filters.push('has_attachment');
      if (currentSearchQuery.includes('is:important')) filters.push('important');
      return filters;
    },
    getCurrentDraft: () => {
      const modal = document.getElementById('composeModal');
      if (!modal || modal.style.display === 'none') return undefined;
      const toInput = document.getElementById('composeToInput') as HTMLInputElement | null;
      const ccInput = document.getElementById('composeCcInput') as HTMLInputElement | null;
      const bccInput = document.getElementById('composeBccInput') as HTMLInputElement | null;
      const subjectInput = document.getElementById('composeSubjectInput') as HTMLInputElement | null;
      const bodyInput = document.getElementById('composeBodyInput') as HTMLTextAreaElement | null;
      return {
        to: toInput?.value.trim() || undefined,
        cc: ccInput?.value.trim() || undefined,
        bcc: bccInput?.value.trim() || undefined,
        subject: subjectInput?.value.trim() || undefined,
        body: bodyInput?.value.trim() || undefined,
      };
    },
    getSelectedEmailDetails: () => selectedEmailDetails,
    getSelectedThreadId: () => selectedEmailId,
    getCurrentlyOpenEmailId: () => selectedEmailId,
    getVisibleThreadIds: () => currentVisibleThreads.map((t) => t.id),
    getVisibleThreads: () =>
      currentVisibleThreads.map((t) => ({
        id: t.id,
        sender: t.participants[0]?.name || t.participants[0]?.email || 'Unknown',
        subject: t.subject || '',
        snippet: t.snippet || '',
        date: t.lastMessageTimestamp || '',
        isUnread: t.isUnread || false,
      })),
  });

  // Expose AI execution and context helper in window for testing and developer console
  if (typeof window !== 'undefined') {
    (window as any).__stitch_ai__ = {
      executeAction: executeAIAction,
      getContext: getAIContext,
    };
  }

  // 5. Supabase Realtime Telemetry
  if (env.IS_CONFIGURED) {
    client
      .channel('realtime_sync_telemetry')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'gmail_sync_states' },
        (payload) => {
          const syncState = payload.new as GmailSyncState;
          updateSyncTelemetryUI(syncState);
        }
      )
      .subscribe();
  }

  // 6. Keyboard shortcuts
  setupKeyboardShortcuts();
}

// ============================================================================
// AUTH & SESSION MANAGEMENT
// ============================================================================

function handleOAuthReturn() {
  const params = new URLSearchParams(window.location.search);
  const authSuccess = params.get('auth_success');
  const authEmail = params.get('email');
  const authError = params.get('auth_error');

  if (authSuccess === 'true' && authEmail) {
    console.log(`[Stitch AI Mail] ✅ Gmail OAuth successful for: ${authEmail}`);
    sessionStorage.setItem(GMAIL_CONNECTED_KEY, authEmail);
    showGmailConnected(authEmail);
    window.history.replaceState({}, document.title, '/');
  } else if (authError) {
    console.error(`[Stitch AI Mail] ❌ Gmail OAuth error: ${authError}`);
    window.history.replaceState({}, document.title, '/');
  }
}

function restoreGmailConnectionState() {
  const storedEmail = sessionStorage.getItem(GMAIL_CONNECTED_KEY);
  if (storedEmail) {
    showGmailConnected(storedEmail);
  }
}

async function checkLiveAuthAndLoad() {
  try {
    const authStatus = await frontendGmailApi.getAuthStatus();
    if (authStatus.connected && authStatus.email) {
      sessionStorage.setItem(GMAIL_CONNECTED_KEY, authStatus.email);
      showGmailConnected(authStatus.email);
      loadInboxThreads();
      initializeRealtimeSync();
    } else {
      const stored = sessionStorage.getItem(GMAIL_CONNECTED_KEY);
      if (stored) {
        // Try loading with stored session email in header
        loadInboxThreads();
        initializeRealtimeSync();
      } else {
        renderUnauthenticatedState();
      }
    }
  } catch (err) {
    console.warn('[Stitch AI Mail] Auth status check warning:', err);
    const stored = sessionStorage.getItem(GMAIL_CONNECTED_KEY);
    if (stored) {
      loadInboxThreads();
      initializeRealtimeSync();
    } else {
      renderUnauthenticatedState();
    }
  }
}

function showGmailConnected(email: string) {
  const connectBtn = document.getElementById('connectGmailBtn');
  const connectedStatus = document.getElementById('gmailConnectedStatus');
  const connectedEmail = document.getElementById('gmailConnectedEmail');

  if (connectBtn) connectBtn.style.display = 'none';
  if (connectedStatus) connectedStatus.style.display = 'flex';
  if (connectedEmail) connectedEmail.textContent = email;
}

function wireConnectGmailButton() {
  const connectBtn = document.getElementById('connectGmailBtn');
  if (connectBtn) {
    connectBtn.addEventListener('click', () => {
      frontendGmailApi.initiateGoogleLogin();
    });
  }
}

// ============================================================================
// GMAIL MAILBOX LOADERS & RENDERING (INBOX, SENT, SEARCH)
// ============================================================================

async function loadInboxThreads(pageToken?: string) {
  currentMailbox = 'inbox';
  currentSearchQuery = '';
  const searchInput = document.getElementById('mailSearchInput') as HTMLInputElement | null;
  if (searchInput) searchInput.value = '';
  updateMailboxHeader('Gmail Inbox', 'inbox', 'Live Inbox');

  const loadingEl = document.getElementById('threadListLoading');
  const itemsContainer = document.getElementById('threadListItems');
  const countBadge = document.getElementById('inboxCountBadge');

  if (!pageToken && loadingEl) {
    loadingEl.style.display = 'flex';
    if (itemsContainer) itemsContainer.innerHTML = '';
  }

  try {
    const res = await frontendGmailApi.listInboxThreads({ pageToken, maxResults: 20 });
    if (loadingEl) loadingEl.style.display = 'none';

    currentNextPageToken = res.nextPageToken;
    updatePaginationBar(Boolean(res.nextPageToken), res.threads.length);

    if (countBadge) {
      countBadge.textContent = String(res.threads.length);
    }

    renderThreadList(res.threads, Boolean(pageToken));
  } catch (err: unknown) {
    const error = err as Error;
    console.warn('[Stitch AI Mail] Failed to load inbox threads:', error.message);
    renderErrorOrAuthRequired(error.message);
  }
}

async function loadSentThreads(pageToken?: string) {
  currentMailbox = 'sent';
  updateMailboxHeader('Sent Mailbox', 'send', 'Sent Messages');

  const loadingEl = document.getElementById('threadListLoading');
  const itemsContainer = document.getElementById('threadListItems');

  if (!pageToken && loadingEl) {
    loadingEl.style.display = 'flex';
    if (itemsContainer) itemsContainer.innerHTML = '';
  }

  try {
    const res = await frontendGmailApi.listSentMessages({ pageToken, maxResults: 20 });
    if (loadingEl) loadingEl.style.display = 'none';

    currentNextPageToken = res.nextPageToken;
    updatePaginationBar(Boolean(res.nextPageToken), res.threads.length);

    renderThreadList(res.threads, Boolean(pageToken));
  } catch (err: unknown) {
    const error = err as Error;
    console.warn('[Stitch AI Mail] Failed to load sent threads:', error.message);
    renderErrorOrAuthRequired(error.message);
  }
}

async function executeSearch(query: string, pageToken?: string) {
  const searchInput = document.getElementById('mailSearchInput') as HTMLInputElement | null;

  if (!query.trim()) {
    currentSearchQuery = '';
    if (searchInput) searchInput.value = '';
    loadInboxThreads();
    return;
  }

  currentMailbox = 'search';
  currentSearchQuery = query;
  if (searchInput && searchInput.value !== query) {
    searchInput.value = query;
  }
  updateMailboxHeader(`Search: "${query}"`, 'manage_search', 'Search Results');

  const loadingEl = document.getElementById('threadListLoading');
  const itemsContainer = document.getElementById('threadListItems');

  if (!pageToken && loadingEl) {
    loadingEl.style.display = 'flex';
    if (itemsContainer) itemsContainer.innerHTML = '';
  }

  try {
    const res = await frontendGmailApi.searchMessages(query, { pageToken, maxResults: 20 });
    if (loadingEl) loadingEl.style.display = 'none';

    currentNextPageToken = res.nextPageToken;
    updatePaginationBar(Boolean(res.nextPageToken), res.threads.length);

    renderThreadList(res.threads, Boolean(pageToken));
  } catch (err: unknown) {
    const error = err as Error;
    console.warn('[Stitch AI Mail] Failed to search threads:', error.message);
    renderErrorOrAuthRequired(error.message);
  }
}

function updateMailboxHeader(title: string, icon: string, badge: string) {
  const mailboxTitle = document.getElementById('mailboxTitle');
  const mailboxIcon = document.getElementById('mailboxIcon');
  const mailboxBadge = document.getElementById('mailboxBadge');
  const mailboxSubtitle = document.getElementById('mailboxSubtitle');

  if (mailboxTitle) mailboxTitle.textContent = title;
  if (mailboxIcon) mailboxIcon.textContent = icon;
  if (mailboxBadge) mailboxBadge.textContent = badge;
  if (mailboxSubtitle) mailboxSubtitle.textContent = `Streaming data from Gmail API (Gmail is the source of truth)`;
}

function updatePaginationBar(hasNext: boolean, count: number) {
  const paginationBar = document.getElementById('paginationBar');
  const resultLabel = document.getElementById('resultCountLabel');
  const loadMoreBtn = document.getElementById('loadMoreBtn');

  if (paginationBar) {
    paginationBar.style.display = 'flex';
  }
  if (resultLabel) {
    resultLabel.textContent = `Showing ${count} conversations live from Gmail API`;
  }
  if (loadMoreBtn) {
    loadMoreBtn.style.display = hasNext ? 'inline-flex' : 'none';
  }
}

function renderThreadList(threads: EmailThread[], append: boolean = false) {
  const itemsContainer = document.getElementById('threadListItems');
  if (!itemsContainer) return;

  if (!append) {
    itemsContainer.innerHTML = '';
    currentVisibleThreads = [...threads];
  } else {
    currentVisibleThreads = [...currentVisibleThreads, ...threads];
  }

  if (threads.length === 0 && !append) {
    itemsContainer.innerHTML = `
      <div class="p-12 text-center text-on-surface-variant flex flex-col items-center gap-2">
        <span class="material-symbols-outlined text-outline text-[32px]">inbox</span>
        <p class="text-sm font-medium">No conversations found</p>
        <p class="text-xs text-outline">Your mailbox is up to date.</p>
      </div>
    `;
    return;
  }

  for (const thread of threads) {
    const threadEl = document.createElement('div');
    threadEl.className =
      'p-4 hover:bg-surface-container-low cursor-pointer transition-colors flex items-start gap-3 group';
    threadEl.dataset.threadId = thread.id;

    // Sender initials & display name
    const senderName = thread.participants[0]?.name || thread.participants[0]?.email || 'Unknown';
    const initials = thread.latestSenderInitials || 'GM';
    const unreadDot = thread.isUnread
      ? '<span class="w-2 h-2 rounded-full bg-primary flex-shrink-0"></span>'
      : '';
    const dateFormatted = formatThreadDate(thread.lastMessageTimestamp);

    // Tags
    const tagsHtml = thread.tags
      .slice(0, 3)
      .map(
        (t) =>
          `<span class="px-1.5 py-0.5 rounded bg-surface-container text-on-surface-variant text-[10px] font-medium uppercase">${escapeHtml(
            t
          )}</span>`
      )
      .join(' ');

    threadEl.innerHTML = `
      <div class="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-xs flex-shrink-0">
        ${escapeHtml(initials)}
      </div>
      <div class="flex-1 min-w-0">
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-1.5 min-w-0">
            ${unreadDot}
            <span class="text-sm font-semibold text-on-surface truncate ${thread.isUnread ? 'font-bold' : ''}">
              ${escapeHtml(senderName)}
            </span>
          </div>
          <span class="text-xs font-mono text-outline flex-shrink-0">${escapeHtml(dateFormatted)}</span>
        </div>
        <div class="text-xs font-medium text-on-surface truncate mt-0.5">
          ${escapeHtml(thread.subject || '(No Subject)')}
        </div>
        <p class="text-xs text-on-surface-variant line-clamp-1 mt-0.5">
          ${escapeHtml(thread.snippet || '')}
        </p>
        ${tagsHtml ? `<div class="flex items-center gap-1 mt-1.5">${tagsHtml}</div>` : ''}
      </div>
      <button class="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-surface-container text-outline hover:text-primary transition-all" title="Open Conversation">
        <span class="material-symbols-outlined text-[18px]">chevron_right</span>
      </button>
    `;

    // Clicking an email opens its detail
    threadEl.addEventListener('click', () => {
      openEmailDetail(thread.id);
    });

    itemsContainer.appendChild(threadEl);
  }
}

function renderUnauthenticatedState() {
  const loadingEl = document.getElementById('threadListLoading');
  if (loadingEl) {
    loadingEl.style.display = 'flex';
    loadingEl.innerHTML = `
      <span class="material-symbols-outlined text-primary text-[36px]">lock</span>
      <h3 class="text-base font-bold text-on-surface">Connect Your Gmail Account</h3>
      <p class="text-xs text-on-surface-variant max-w-sm">
        Authorize AetherMail with read and send permissions. Your credentials and tokens are strictly stored on the backend server.
      </p>
      <button id="inlineConnectBtn" class="mt-2 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary hover:bg-primary-container text-on-primary text-xs font-semibold shadow-md transition-all" type="button">
        <span class="material-symbols-outlined text-[16px]">link</span>
        <span>Connect via Google OAuth</span>
      </button>
    `;
    const inlineConnectBtn = document.getElementById('inlineConnectBtn');
    if (inlineConnectBtn) {
      inlineConnectBtn.addEventListener('click', () => frontendGmailApi.initiateGoogleLogin());
    }
  }
}

function renderErrorOrAuthRequired(message: string) {
  const loadingEl = document.getElementById('threadListLoading');
  if (loadingEl) {
    loadingEl.style.display = 'flex';
    loadingEl.innerHTML = `
      <span class="material-symbols-outlined text-outline text-[32px]">cloud_off</span>
      <h3 class="text-sm font-bold text-on-surface">Gmail Connection</h3>
      <p class="text-xs text-on-surface-variant max-w-sm">${escapeHtml(message)}</p>
      <button id="retryConnectBtn" class="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-on-primary text-xs font-medium" type="button">
        <span class="material-symbols-outlined text-[16px]">refresh</span>
        <span>Connect Gmail</span>
      </button>
    `;
    const retryBtn = document.getElementById('retryConnectBtn');
    if (retryBtn) {
      retryBtn.addEventListener('click', () => frontendGmailApi.initiateGoogleLogin());
    }
  }
}

// ============================================================================
// EMAIL DETAIL VIEW MODAL
// ============================================================================

async function openEmailDetail(messageOrThreadId: string, isBackgroundRefresh: boolean = false) {
  const modal = document.getElementById('emailDetailModal');
  const subjectEl = document.getElementById('detailSubject');
  const senderNameEl = document.getElementById('detailSenderName');
  const senderEmailEl = document.getElementById('detailSenderEmail');
  const senderAvatar = document.getElementById('detailSenderAvatar');
  const recipientsEl = document.getElementById('detailRecipients');
  const dateEl = document.getElementById('detailDate');
  const bodyEl = document.getElementById('detailBodyContent');
  const labelsEl = document.getElementById('detailLabels');
  const attachmentsContainer = document.getElementById('detailAttachmentsContainer');
  const attachmentsList = document.getElementById('detailAttachmentsList');

  if (!modal) return;

  selectedEmailId = messageOrThreadId;

  // Show modal in loading state if not a background refresh
  modal.style.display = 'flex';
  if (!isBackgroundRefresh) {
    if (subjectEl) subjectEl.textContent = 'Loading conversation...';
    if (bodyEl) bodyEl.innerHTML = '<div class="flex items-center gap-2 text-outline"><span class="material-symbols-outlined animate-spin text-[18px]">progress_activity</span><span>Fetching from Gmail API...</span></div>';
  }

  try {
    const msg: EmailMessage = await frontendGmailApi.getMessage(messageOrThreadId);
    selectedEmailDetails = {
      sender: msg.sender.email,
      subject: msg.subject,
    };

    if (subjectEl) subjectEl.textContent = msg.subject || '(No Subject)';
    if (senderNameEl) senderNameEl.textContent = msg.sender.name || msg.sender.email;
    if (senderEmailEl) senderEmailEl.textContent = `<${msg.sender.email}>`;
    if (senderAvatar) {
      const initial = (msg.sender.name || msg.sender.email || 'U')[0].toUpperCase();
      senderAvatar.textContent = initial;
    }
    if (recipientsEl) {
      recipientsEl.textContent = msg.recipients.map((r) => r.name || r.email).join(', ') || 'Me';
    }
    if (dateEl) {
      dateEl.textContent = new Date(msg.receivedAt).toLocaleString();
    }

    // Render body safely with enhanced XSS protection
    if (bodyEl) {
      if (msg.bodyHtml) {
        // Strip script tags, event handler attributes (onload, onerror, onclick, etc.), and javascript: URIs
        const sanitized = msg.bodyHtml
          .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
          .replace(/\son\w+\s*=\s*(["'][^"']*["']|[^\s>]+)/gi, '')
          .replace(/href\s*=\s*(["']\s*javascript:[^"']*["']|javascript:[^\s>]+)/gi, 'href="#"');
        bodyEl.innerHTML = sanitized;
      } else {
        bodyEl.textContent = msg.bodyPlain || msg.snippet || '(No content)';
      }
    }

    // Render labels
    if (labelsEl) {
      labelsEl.innerHTML = msg.labels
        .filter((l) => !['INBOX', 'UNREAD'].includes(l))
        .map(
          (l) =>
            `<span class="px-2 py-0.5 rounded bg-surface-container-high text-outline font-mono text-[10px] uppercase font-bold">${escapeHtml(
              l
            )}</span>`
        )
        .join(' ');
    }

    // Attachments
    if (attachmentsContainer && attachmentsList) {
      if (msg.attachments && msg.attachments.length > 0) {
        attachmentsContainer.style.display = 'block';
        attachmentsList.innerHTML = msg.attachments
          .map(
            (att) => `
            <div class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-container text-on-surface text-xs border border-surface-container-high">
              <span class="material-symbols-outlined text-[16px] text-primary">attachment</span>
              <span class="font-medium truncate max-w-[200px]">${escapeHtml(att.filename)}</span>
              <span class="text-outline text-[10px]">(${Math.round(att.sizeBytes / 1024)} KB)</span>
            </div>
          `
          )
          .join('');
      } else {
        attachmentsContainer.style.display = 'none';
      }
    }

    // Wire Reply button from detail
    const replyBtn = document.getElementById('replyFromDetailBtn');
    if (replyBtn) {
      replyBtn.onclick = () => {
        closeEmailDetail();
        openComposeModal({
          recipient: msg.sender.email,
          subject: msg.subject.startsWith('Re:') ? msg.subject : `Re: ${msg.subject}`,
          body: `\n\n--- On ${new Date(msg.receivedAt).toLocaleString()}, ${msg.sender.email} wrote ---\n> ${msg.snippet}`,
        });
      };
    }

    // Wire Forward button from detail
    const forwardBtn = document.getElementById('forwardFromDetailBtn');
    if (forwardBtn) {
      forwardBtn.onclick = () => {
        closeEmailDetail();
        openComposeModal({
          subject: msg.subject.startsWith('Fwd:') ? msg.subject : `Fwd: ${msg.subject}`,
          body: `\n\n---------- Forwarded message ---------\nFrom: <${msg.sender.email}>\nDate: ${new Date(msg.receivedAt).toLocaleString()}\nSubject: ${msg.subject}\n\n${msg.snippet || ''}`,
        });
      };
    }
  } catch (err: unknown) {
    const error = err as Error;
    console.error('[Stitch AI Mail] Failed to load message detail:', error);
    if (bodyEl) {
      bodyEl.innerHTML = `<div class="text-error text-xs p-4 rounded-lg bg-error-container/20">Error loading message details: ${escapeHtml(
        error.message
      )}</div>`;
    }
  }
}

function closeEmailDetail() {
  selectedEmailId = null;
  selectedEmailDetails = null;
  const modal = document.getElementById('emailDetailModal');
  if (modal) modal.style.display = 'none';
}

function wireDetailModal() {
  const closeBtn = document.getElementById('closeDetailBtn');
  if (closeBtn) {
    closeBtn.addEventListener('click', closeEmailDetail);
  }

  // Close on escape key
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeEmailDetail();
      closeComposeModal();
    }
  });
}

// ============================================================================
// COMPOSE MODAL & EMAIL DISPATCH
// ============================================================================

function openComposeModal(prefill?: {
  recipient?: string;
  cc?: string;
  bcc?: string;
  subject?: string;
  body?: string;
}) {
  const modal = document.getElementById('composeModal');
  const toInput = document.getElementById('composeToInput') as HTMLInputElement | null;
  const ccRow = document.getElementById('composeCcRow');
  const ccInput = document.getElementById('composeCcInput') as HTMLInputElement | null;
  const bccRow = document.getElementById('composeBccRow');
  const bccInput = document.getElementById('composeBccInput') as HTMLInputElement | null;
  const subjectInput = document.getElementById('composeSubjectInput') as HTMLInputElement | null;
  const bodyInput = document.getElementById('composeBodyInput') as HTMLTextAreaElement | null;
  const alertEl = document.getElementById('composeAlert');

  if (!modal) return;
  modal.style.display = 'flex';

  if (alertEl) alertEl.style.display = 'none';

  if (toInput && prefill?.recipient !== undefined) toInput.value = prefill.recipient;
  if (ccInput && prefill?.cc !== undefined) {
    ccInput.value = prefill.cc;
    if (ccRow && prefill.cc) ccRow.style.display = 'flex';
  }
  if (bccInput && prefill?.bcc !== undefined) {
    bccInput.value = prefill.bcc;
    if (bccRow && prefill.bcc) bccRow.style.display = 'flex';
  }
  if (subjectInput && prefill?.subject !== undefined) subjectInput.value = prefill.subject;
  if (bodyInput && prefill?.body !== undefined) bodyInput.value = prefill.body;

  // Focus appropriately
  if (toInput && (!toInput.value || !toInput.value.trim())) {
    toInput.focus();
  } else if (subjectInput && (!subjectInput.value || !subjectInput.value.trim())) {
    subjectInput.focus();
  } else if (bodyInput) {
    bodyInput.focus();
  }
}

function closeComposeModal() {
  const modal = document.getElementById('composeModal');
  if (modal) modal.style.display = 'none';
}

function wireComposeModal() {
  const composeBtn = document.getElementById('composeBtn');
  const openComposeFloatingBtn = document.getElementById('openComposeFloatingBtn');
  const aiComposeTriggerBtn = document.getElementById('aiComposeTriggerBtn');
  const aiModalPromptInput = document.getElementById('aiComposeModalPromptInput') as HTMLInputElement | null;
  const aiModalSubmitBtn = document.getElementById('aiComposeModalSubmitBtn');
  const toggleCcBtn = document.getElementById('toggleCcBtn');
  const toggleBccBtn = document.getElementById('toggleBccBtn');
  const ccRow = document.getElementById('composeCcRow');
  const bccRow = document.getElementById('composeBccRow');
  const closeBtn = document.getElementById('closeComposeBtn');
  const discardBtn = document.getElementById('discardDraftBtn');
  const form = document.getElementById('composeForm') as HTMLFormElement | null;

  if (composeBtn) composeBtn.addEventListener('click', () => openComposeModal());
  if (openComposeFloatingBtn) openComposeFloatingBtn.addEventListener('click', () => openComposeModal());
  if (closeBtn) closeBtn.addEventListener('click', closeComposeModal);
  if (discardBtn) discardBtn.addEventListener('click', closeComposeModal);

  // CC / BCC Toggles
  if (toggleCcBtn && ccRow) {
    toggleCcBtn.addEventListener('click', () => {
      const isVisible = ccRow.style.display !== 'none';
      ccRow.style.display = isVisible ? 'none' : 'flex';
      if (!isVisible) {
        const ccInput = document.getElementById('composeCcInput') as HTMLInputElement | null;
        ccInput?.focus();
      }
    });
  }

  if (toggleBccBtn && bccRow) {
    toggleBccBtn.addEventListener('click', () => {
      const isVisible = bccRow.style.display !== 'none';
      bccRow.style.display = isVisible ? 'none' : 'flex';
      if (!isVisible) {
        const bccInput = document.getElementById('composeBccInput') as HTMLInputElement | null;
        bccInput?.focus();
      }
    });
  }

  // AI Compose Prompt Handler (Modal Bar or Sidebar Trigger)
  const handleAIComposePrompt = async (promptText: string) => {
    if (!promptText || !promptText.trim()) return;
    showComposeAlert('AI is generating draft...', 'success');

    try {
      // Call backend AI command endpoint via frontend client
      const { frontendAICommandClient } = await import('./lib/ai/client');
      const result = await frontendAICommandClient.sendCommand(promptText.trim());

      if (result.action.type === 'COMPOSE_EMAIL') {
        const payload = result.action.payload;
        openComposeModal({
          recipient: payload.to && payload.to.length > 0 ? payload.to.join(', ') : undefined,
          cc: payload.cc && payload.cc.length > 0 ? payload.cc.join(', ') : undefined,
          bcc: payload.bcc && payload.bcc.length > 0 ? payload.bcc.join(', ') : undefined,
          subject: payload.subject,
          body: payload.body,
        });
        showComposeAlert(result.explanation || 'Draft updated with AI assistance. Review before sending.', 'success');
      } else {
        showComposeAlert('Received non-compose action: ' + result.action.type, 'error');
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      showComposeAlert(errorMsg, 'error');
    }
  };

  if (aiModalSubmitBtn && aiModalPromptInput) {
    aiModalSubmitBtn.addEventListener('click', () => {
      const prompt = aiModalPromptInput.value.trim();
      if (prompt) {
        handleAIComposePrompt(prompt);
      }
    });
    aiModalPromptInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const prompt = aiModalPromptInput.value.trim();
        if (prompt) {
          handleAIComposePrompt(prompt);
        }
      }
    });
  }

  // Sidebar "Ask AI to Compose" button
  if (aiComposeTriggerBtn) {
    aiComposeTriggerBtn.addEventListener('click', () => {
      openComposeModal();
      if (aiModalPromptInput) {
        aiModalPromptInput.focus();
        showComposeAlert('Enter your natural-language instructions above.', 'success');
      }
    });
  }

  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (isSending) return;

      const toInput = document.getElementById('composeToInput') as HTMLInputElement | null;
      const subjectInput = document.getElementById('composeSubjectInput') as HTMLInputElement | null;
      const bodyInput = document.getElementById('composeBodyInput') as HTMLTextAreaElement | null;
      const sendBtn = document.getElementById('sendEmailSubmitBtn') as HTMLButtonElement | null;
      const sendBtnLabel = document.getElementById('sendBtnLabel');

      const recipient = toInput?.value.trim() || '';
      const subject = subjectInput?.value.trim() || '';
      const body = bodyInput?.value.trim() || '';

      // Validate inputs
      if (!recipient || !recipient.includes('@')) {
        showComposeAlert('Please enter a valid recipient email address', 'error');
        return;
      }
      if (!subject) {
        showComposeAlert('Please enter an email subject line', 'error');
        return;
      }
      if (!body) {
        showComposeAlert('Message body cannot be empty', 'error');
        return;
      }

      // Enter loading state
      isSending = true;
      if (sendBtn) sendBtn.disabled = true;
      if (sendBtnLabel) sendBtnLabel.textContent = 'Sending via Gmail...';

      // Duplicate prevention idempotency key
      const idempotencyKey = `send_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

      try {
        const res = await frontendGmailApi.sendEmail({
          recipient,
          subject,
          body,
          idempotencyKey,
        });

        console.log('[Stitch AI Mail] ✅ Email sent successfully via Gmail API:', res);
        showComposeAlert(`Email sent! Gmail Message ID: ${res.messageId.substring(0, 10)}...`, 'success');

        // Reset form and close after delay
        setTimeout(() => {
          form.reset();
          closeComposeModal();
          isSending = false;
          if (sendBtn) sendBtn.disabled = false;
          if (sendBtnLabel) sendBtnLabel.textContent = 'Send Email';

          // Refresh Sent mailbox if currently viewing it
          if (currentMailbox === 'sent') {
            loadSentThreads();
          }
        }, 1200);
      } catch (err: unknown) {
        const error = err as Error;
        console.error('[Stitch AI Mail] Failed to send email:', error);
        showComposeAlert(`Send failed: ${error.message}`, 'error');
        isSending = false;
        if (sendBtn) sendBtn.disabled = false;
        if (sendBtnLabel) sendBtnLabel.textContent = 'Send Email';
      }
    });
  }
}

function showComposeAlert(msg: string, type: 'error' | 'success') {
  const alertEl = document.getElementById('composeAlert');
  if (!alertEl) return;
  alertEl.style.display = 'block';
  alertEl.textContent = msg;

  if (type === 'error') {
    alertEl.className = 'px-3 py-2 rounded-lg text-xs font-medium bg-error-container text-on-error-container';
  } else {
    alertEl.className = 'px-3 py-2 rounded-lg text-xs font-medium bg-tertiary-container/20 text-tertiary font-semibold';
  }
}

// ============================================================================
// NAVIGATION & SEARCH WIRING
// ============================================================================

function wireSidebarNavigation() {
  const inboxBtn = document.getElementById('inboxNavBtn');
  const sentBtn = document.getElementById('sentNavBtn');
  const refreshBtn = document.getElementById('refreshMailboxBtn');
  const loadMoreBtn = document.getElementById('loadMoreBtn');

  if (inboxBtn) {
    inboxBtn.addEventListener('click', (e) => {
      e.preventDefault();
      highlightNav('inbox');
      loadInboxThreads();
    });
  }

  if (sentBtn) {
    sentBtn.addEventListener('click', (e) => {
      e.preventDefault();
      highlightNav('sent');
      loadSentThreads();
    });
  }

  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      if (currentMailbox === 'sent') {
        loadSentThreads();
      } else if (currentMailbox === 'search') {
        executeSearch(currentSearchQuery);
      } else {
        loadInboxThreads();
      }
    });
  }

  const starredBtn = document.getElementById('starredNavBtn');
  const draftsBtn = document.getElementById('draftsNavBtn');
  const archiveBtn = document.getElementById('archiveNavBtn');
  const trashBtn = document.getElementById('trashNavBtn');
  const copilotHeaderBtn = document.getElementById('copilotHeaderBtn');

  if (starredBtn) {
    starredBtn.addEventListener('click', (e) => {
      e.preventDefault();
      executeSearch('is:starred');
    });
  }

  if (draftsBtn) {
    draftsBtn.addEventListener('click', (e) => {
      e.preventDefault();
      executeSearch('in:draft');
    });
  }

  if (archiveBtn) {
    archiveBtn.addEventListener('click', (e) => {
      e.preventDefault();
      executeSearch('-in:inbox -in:trash -in:spam');
    });
  }

  if (trashBtn) {
    trashBtn.addEventListener('click', (e) => {
      e.preventDefault();
      executeSearch('in:trash');
    });
  }

  if (copilotHeaderBtn) {
    copilotHeaderBtn.addEventListener('click', () => {
      const searchInput = document.getElementById('mailSearchInput');
      if (searchInput) {
        searchInput.focus();
      }
    });
  }

  if (loadMoreBtn) {
    loadMoreBtn.addEventListener('click', () => {
      if (currentNextPageToken) {
        if (currentMailbox === 'sent') {
          loadSentThreads(currentNextPageToken);
        } else if (currentMailbox === 'search') {
          executeSearch(currentSearchQuery, currentNextPageToken);
        } else {
          loadInboxThreads(currentNextPageToken);
        }
      }
    });
  }
}

function highlightNav(mailbox: 'inbox' | 'sent') {
  const inboxBtn = document.getElementById('inboxNavBtn');
  const sentBtn = document.getElementById('sentNavBtn');

  const activeClass = 'bg-primary-container text-on-primary font-semibold';
  const inactiveClass = 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface';

  if (mailbox === 'inbox') {
    inboxBtn?.setAttribute('class', `flex items-center justify-between px-space-sm py-1.5 rounded-lg ${activeClass} text-sm cursor-pointer`);
    sentBtn?.setAttribute('class', `flex items-center justify-between px-space-sm py-1.5 rounded-lg ${inactiveClass} transition-all text-sm cursor-pointer`);
  } else {
    sentBtn?.setAttribute('class', `flex items-center justify-between px-space-sm py-1.5 rounded-lg ${activeClass} text-sm cursor-pointer`);
    inboxBtn?.setAttribute('class', `flex items-center justify-between px-space-sm py-1.5 rounded-lg ${inactiveClass} transition-all text-sm cursor-pointer`);
  }
}

function wireSearchInput() {
  const searchInput = document.getElementById('mailSearchInput') as HTMLInputElement | null;
  const searchBtn = document.getElementById('mailSearchBtn');

  if (searchInput) {
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        executeSearch(searchInput.value);
      }
    });
  }

  if (searchBtn && searchInput) {
    searchBtn.addEventListener('click', () => {
      executeSearch(searchInput.value);
    });
  }
}

// ============================================================================
// REAL-TIME GMAIL SYNC
// ============================================================================

let realtimeSyncInitialized = false;

function initializeRealtimeSync() {
  if (realtimeSyncInitialized) return;
  realtimeSyncInitialized = true;

  console.log('[Stitch AI Mail] Initializing real-time Gmail sync...');

  // Subscribe to Gmail change events
  gmailRealtimeSync.onGmailChange((change: GmailChangeData) => {
    handleGmailChange(change);
  });

  // Track connection state for UI feedback
  gmailRealtimeSync.onConnectionStateChange((state) => {
    console.log(`[Stitch AI Mail] Realtime sync: ${state}`);
    updateSyncIndicator(state);
  });

  // Connect to SSE
  gmailRealtimeSync.connect();
}

/**
 * Smart refresh handler: refreshes the affected UI based on current view state.
 * Preserves current mailbox, search query, filters, and selected thread.
 */
function handleGmailChange(change: GmailChangeData) {
  const totalChanges = change.changes.messagesAdded + change.changes.messagesDeleted + change.changes.labelsChanged;
  const isFullResync = change.changes.messagesAdded === -1;

  console.log(
    `[Stitch AI Mail] Gmail change detected: +${change.changes.messagesAdded} added, -${change.changes.messagesDeleted} deleted, ~${change.changes.labelsChanged} labels`
  );

  // Show toast notification
  if (totalChanges > 0 || isFullResync) {
    showSyncToast(
      isFullResync
        ? 'Mailbox synced — refreshing...'
        : `${change.changes.messagesAdded} new message${change.changes.messagesAdded !== 1 ? 's' : ''} received`
    );
  }

  // Smart refresh based on current view
  if (currentMailbox === 'search' && currentSearchQuery) {
    // Re-run the existing search/filter
    executeSearch(currentSearchQuery);
  } else if (currentMailbox === 'sent') {
    // Refresh Sent threads
    loadSentThreads();
  } else {
    // Default: refresh Inbox
    loadInboxThreads();
  }

  // If email detail is open, refresh it smoothly in background
  if (selectedEmailId) {
    const detailModal = document.getElementById('emailDetailModal');
    if (detailModal && detailModal.style.display !== 'none') {
      openEmailDetail(selectedEmailId, true);
    }
  }
}

function showSyncToast(message: string) {
  // Use existing toast or create a temporary one
  let toastEl = document.getElementById('syncToast');
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.id = 'syncToast';
    toastEl.style.cssText = `
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: var(--md-sys-color-tertiary-container, #004d40);
      color: var(--md-sys-color-on-tertiary-container, #fff);
      padding: 10px 20px;
      border-radius: 12px;
      font-size: 13px;
      font-weight: 500;
      box-shadow: 0 4px 12px rgba(0,0,0,0.25);
      z-index: 10000;
      opacity: 0;
      transform: translateY(10px);
      transition: opacity 0.3s ease, transform 0.3s ease;
      pointer-events: none;
      display: flex;
      align-items: center;
      gap: 8px;
    `;
    document.body.appendChild(toastEl);
  }

  toastEl.innerHTML = `
    <span class="material-symbols-outlined" style="font-size: 18px;">sync</span>
    <span>${message}</span>
  `;
  toastEl.style.opacity = '1';
  toastEl.style.transform = 'translateY(0)';

  setTimeout(() => {
    toastEl!.style.opacity = '0';
    toastEl!.style.transform = 'translateY(10px)';
  }, 4000);
}

function updateSyncIndicator(state: 'connecting' | 'connected' | 'disconnected' | 'error') {
  const indicator = document.getElementById('realtimeSyncIndicator');
  if (!indicator) return;

  const colors: Record<string, string> = {
    connecting: 'var(--md-sys-color-tertiary, #ffa726)',
    connected: 'var(--md-sys-color-primary, #4caf50)',
    disconnected: 'var(--md-sys-color-outline, #9e9e9e)',
    error: 'var(--md-sys-color-error, #f44336)',
  };

  indicator.style.backgroundColor = colors[state] || colors.disconnected;
  indicator.title = `Real-time sync: ${state}`;
}

// ============================================================================
// HELPERS & SHORTCUTS
// ============================================================================

function updateSyncTelemetryUI(syncState: GmailSyncState) {
  const toastNotification = document.getElementById('toastNotification');
  if (toastNotification && syncState.status === 'active') {
    toastNotification.style.display = 'flex';
  }
}

function setupKeyboardShortcuts() {
  window.addEventListener('keydown', (e) => {
    // ⌘K or Ctrl+K for search
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      const searchInput = document.getElementById('mailSearchInput');
      if (searchInput) searchInput.focus();
    }

    // C key for Compose
    if (e.key.toLowerCase() === 'c' && !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) {
      e.preventDefault();
      openComposeModal();
    }
  });
}

function formatThreadDate(isoOrString: string): string {
  try {
    const d = new Date(isoOrString);
    if (isNaN(d.getTime())) return isoOrString;

    const now = new Date();
    const isToday =
      d.getDate() === now.getDate() &&
      d.getMonth() === now.getMonth() &&
      d.getFullYear() === now.getFullYear();

    if (isToday) {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  } catch {
    return isoOrString;
  }
}

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Run on DOM ready
if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApp);
  } else {
    initializeApp();
  }
}

export {
  initializeApp,
  openComposeModal,
  closeComposeModal,
  openEmailDetail,
  closeEmailDetail,
  executeSearch,
  loadInboxThreads,
  loadSentThreads,
  highlightNav,
};
