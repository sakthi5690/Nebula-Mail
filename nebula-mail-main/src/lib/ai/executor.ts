/**
 * Central Frontend AI Action Executor
 * Maps validated AIAction objects directly to existing UI operations in main.ts.
 * Does NOT manipulate raw DOM arbitrarily or run eval.
 */

import {
  AIAction,
  AIExecutionResult,
  ComposeEmailPayload,
  SearchEmailsPayload,
  OpenEmailPayload,
  ReplyEmailPayload,
  ForwardEmailPayload,
  SetFilterPayload,
  NavigatePayload,
} from './actions.types';
import { validateAIAction } from './validator';

/**
 * Interface representing the UI and State Operations provided by main.ts
 */
export interface UIOperations {
  openComposeModal: (prefill?: { recipient?: string; cc?: string; bcc?: string; subject?: string; body?: string }) => void;
  closeComposeModal: () => void;
  openEmailDetail: (id: string) => Promise<void> | void;
  closeEmailDetail: () => void;
  executeSearch: (query: string, pageToken?: string) => Promise<void> | void;
  loadInboxThreads: (pageToken?: string) => Promise<void> | void;
  loadSentThreads: (pageToken?: string) => Promise<void> | void;
  highlightNav: (mailbox: 'inbox' | 'sent') => void;
  getSelectedEmailId: () => string | null;
  getSelectedEmailDetails?: () => { sender?: string; subject?: string } | null;
  applyFilter?: (filterType: string, active: boolean) => void;
}

let uiOps: UIOperations | null = null;

/**
 * Register UI operations adapter. Called once from main.ts.
 */
export function registerUIOperations(operations: UIOperations): void {
  uiOps = operations;
}

/**
 * Safe sanitized logging helper (never logs tokens, auth headers, or raw sensitive credentials)
 */
function logAction(action: AIAction, status: 'STARTING' | 'SUCCESS' | 'FAILED', error?: string): void {
  const safeSummary: Record<string, unknown> = {
    type: action.type,
    status,
    timestamp: new Date().toISOString(),
  };

  if (action.type === 'COMPOSE_EMAIL') {
    safeSummary.payloadSummary = {
      hasRecipient: Boolean(action.payload.to && action.payload.to.length > 0),
      subjectLength: action.payload.subject?.length ?? 0,
      bodyLength: action.payload.body?.length ?? 0,
    };
  } else if (action.type === 'SEARCH_EMAILS') {
    safeSummary.payloadSummary = {
      query: action.payload.query,
      hasFilter: Boolean(action.payload.filter),
    };
  } else if (action.type === 'OPEN_EMAIL') {
    safeSummary.payloadSummary = {
      emailId: action.payload.emailId,
      threadId: action.payload.threadId,
    };
  } else if (action.type === 'REPLY_EMAIL') {
    safeSummary.payloadSummary = {
      hasTargetId: Boolean(action.payload.emailId || action.payload.threadId),
      replyAll: Boolean(action.payload.replyAll),
      bodyLength: action.payload.body?.length ?? 0,
    };
  } else if (action.type === 'FORWARD_EMAIL') {
    safeSummary.payloadSummary = {
      hasTargetId: Boolean(action.payload.emailId || action.payload.threadId),
      recipientCount: action.payload.to?.length ?? 0,
      bodyLength: action.payload.body?.length ?? 0,
    };
  } else if (action.type === 'SET_FILTER') {
    safeSummary.payloadSummary = {
      filterType: action.payload.filterType,
      active: action.payload.active,
    };
  } else if (action.type === 'NAVIGATE') {
    safeSummary.payloadSummary = { destination: action.payload.destination };
  }

  if (error) {
    safeSummary.error = error;
  }

  if (status === 'FAILED') {
    console.error('[AI Action Executor] Action Failed:', safeSummary);
  } else {
    console.info(`[AI Action Executor] [${status}] ${action.type}:`, safeSummary);
  }
}

/**
 * Action Handler: COMPOSE_EMAIL
 */
async function handleComposeEmail(payload: ComposeEmailPayload): Promise<AIExecutionResult> {
  if (!uiOps) {
    throw new Error('UI operations not registered');
  }

  const recipient = payload.to && payload.to.length > 0 ? payload.to.join(', ') : undefined;
  const cc = payload.cc && payload.cc.length > 0 ? payload.cc.join(', ') : undefined;
  const bcc = payload.bcc && payload.bcc.length > 0 ? payload.bcc.join(', ') : undefined;

  // IMPORTANT: The AI only prepares / populates the form in the compose modal.
  // It NEVER invokes send or calls any send endpoint.
  uiOps.openComposeModal({
    recipient,
    cc,
    bcc,
    subject: payload.subject,
    body: payload.body,
  });

  return {
    success: true,
    actionType: 'COMPOSE_EMAIL',
    message: `Compose modal populated${recipient ? ` for ${recipient}` : ''}${payload.subject ? ` with subject "${payload.subject}"` : ''}. Ready for review.`,
    metadata: {
      recipientCount: payload.to?.length ?? 0,
      hasCc: Boolean(cc),
      hasBcc: Boolean(bcc),
      hasSubject: Boolean(payload.subject),
      hasBody: Boolean(payload.body),
      autoSent: false, // Explicit guarantee that auto-send was not triggered
    },
  };
}

/**
 * Action Handler: SEARCH_EMAILS
 */
async function handleSearchEmails(payload: SearchEmailsPayload): Promise<AIExecutionResult> {
  if (!uiOps) {
    throw new Error('UI operations not registered');
  }

  let finalQuery = payload.query.trim();

  // If structured filter parameters were provided, append Gmail search operators if not already present
  if (payload.filter) {
    const parts: string[] = [];
    if (payload.filter.from && !finalQuery.includes('from:')) {
      parts.push(`from:${payload.filter.from}`);
    }
    if (payload.filter.to && !finalQuery.includes('to:')) {
      parts.push(`to:${payload.filter.to}`);
    }
    if (payload.filter.subject && !finalQuery.includes('subject:')) {
      parts.push(`subject:${payload.filter.subject}`);
    }
    if (payload.filter.hasAttachment && !finalQuery.includes('has:attachment')) {
      parts.push('has:attachment');
    }
    if (payload.filter.after && !finalQuery.includes('after:')) {
      parts.push(`after:${payload.filter.after}`);
    }
    if (payload.filter.before && !finalQuery.includes('before:')) {
      parts.push(`before:${payload.filter.before}`);
    }
    if (parts.length > 0) {
      finalQuery = finalQuery ? `${finalQuery} ${parts.join(' ')}` : parts.join(' ');
    }
  }

  await uiOps.executeSearch(finalQuery);

  return {
    success: true,
    actionType: 'SEARCH_EMAILS',
    message: `Search executed for query: "${finalQuery}"`,
    metadata: { query: finalQuery },
  };
}

/**
 * Action Handler: OPEN_EMAIL
 * Supports opening by either emailId or threadId.
 * The resolved ID is forwarded to the existing openEmailDetail UI operation.
 */
async function handleOpenEmail(payload: OpenEmailPayload): Promise<AIExecutionResult> {
  if (!uiOps) {
    throw new Error('UI operations not registered');
  }

  // Prefer emailId if provided; fallback to threadId
  const resolvedId = payload.emailId || payload.threadId;
  if (!resolvedId) {
    throw new Error('OPEN_EMAIL requires either emailId or threadId');
  }

  await uiOps.openEmailDetail(resolvedId);

  return {
    success: true,
    actionType: 'OPEN_EMAIL',
    message: `Opened email detail for ${payload.emailId ? 'message' : 'thread'} ID: ${resolvedId}`,
    metadata: {
      emailId: payload.emailId || null,
      threadId: payload.threadId || null,
      resolvedId,
    },
  };
}

/**
 * Action Handler: REPLY_EMAIL
 */
async function handleReplyEmail(payload: ReplyEmailPayload): Promise<AIExecutionResult> {
  if (!uiOps) {
    throw new Error('UI operations not registered');
  }

  const targetId = payload.emailId || payload.threadId || uiOps.getSelectedEmailId();
  const emailDetails = uiOps.getSelectedEmailDetails ? uiOps.getSelectedEmailDetails() : null;

  let recipient = emailDetails?.sender;
  let subject = emailDetails?.subject;
  if (subject && !subject.toLowerCase().startsWith('re:')) {
    subject = `Re: ${subject}`;
  }

  uiOps.openComposeModal({
    recipient: recipient || undefined,
    subject: subject || (targetId ? 'Re: Email' : undefined),
    body: payload.body || '',
  });

  return {
    success: true,
    actionType: 'REPLY_EMAIL',
    message: targetId
      ? `Reply draft prepared for email ${targetId}`
      : 'Reply draft opened in compose modal',
    metadata: {
      targetId: targetId || null,
      replyAll: Boolean(payload.replyAll),
      recipient: recipient || null,
      autoSent: false,
    },
  };
}

/**
 * Action Handler: FORWARD_EMAIL
 */
async function handleForwardEmail(payload: ForwardEmailPayload): Promise<AIExecutionResult> {
  if (!uiOps) {
    throw new Error('UI operations not registered');
  }

  const targetId = payload.emailId || payload.threadId || uiOps.getSelectedEmailId();
  const emailDetails = uiOps.getSelectedEmailDetails ? uiOps.getSelectedEmailDetails() : null;

  const recipient = payload.to && payload.to.length > 0 ? payload.to.join(', ') : undefined;
  const cc = payload.cc && payload.cc.length > 0 ? payload.cc.join(', ') : undefined;
  const bcc = payload.bcc && payload.bcc.length > 0 ? payload.bcc.join(', ') : undefined;

  let subject = emailDetails?.subject;
  if (subject) {
    if (!subject.toLowerCase().startsWith('fwd:')) {
      subject = `Fwd: ${subject}`;
    }
  } else if (targetId) {
    subject = 'Fwd: Email';
  }

  uiOps.openComposeModal({
    recipient,
    cc,
    bcc,
    subject,
    body: payload.body || '',
  });

  return {
    success: true,
    actionType: 'FORWARD_EMAIL',
    message: `Forward draft prepared${recipient ? ` for ${recipient}` : ''}${targetId ? ` (source email: ${targetId})` : ''}. Ready for review.`,
    metadata: {
      targetId: targetId || null,
      recipientCount: payload.to?.length ?? 0,
      autoSent: false,
    },
  };
}

/**
 * Action Handler: SET_FILTER
 */
async function handleSetFilter(payload: SetFilterPayload): Promise<AIExecutionResult> {
  if (!uiOps) {
    throw new Error('UI operations not registered');
  }

  if (uiOps.applyFilter) {
    uiOps.applyFilter(payload.filterType, payload.active);
  } else {
    // Graceful fallback to search operator if custom filter handler not attached
    if (payload.active) {
      if (payload.filterType === 'unread') {
        await uiOps.executeSearch('is:unread');
      } else if (payload.filterType === 'starred') {
        await uiOps.executeSearch('is:starred');
      } else if (payload.filterType === 'has_attachment') {
        await uiOps.executeSearch('has:attachment');
      } else if (payload.filterType === 'important') {
        await uiOps.executeSearch('is:important');
      } else {
        await uiOps.loadInboxThreads();
      }
    } else {
      await uiOps.loadInboxThreads();
    }
  }

  return {
    success: true,
    actionType: 'SET_FILTER',
    message: `Filter "${payload.filterType}" set to ${payload.active ? 'active' : 'inactive'}`,
    metadata: { filterType: payload.filterType, active: payload.active },
  };
}

/**
 * Action Handler: NAVIGATE
 */
async function handleNavigate(payload: NavigatePayload): Promise<AIExecutionResult> {
  if (!uiOps) {
    throw new Error('UI operations not registered');
  }

  const { destination, pageToken } = payload;

  if (destination === 'inbox') {
    uiOps.highlightNav('inbox');
    await uiOps.loadInboxThreads(pageToken);
  } else if (destination === 'sent') {
    uiOps.highlightNav('sent');
    await uiOps.loadSentThreads(pageToken);
  } else if (destination === 'drafts') {
    await uiOps.executeSearch('in:draft', pageToken);
  } else if (destination === 'starred') {
    await uiOps.executeSearch('is:starred', pageToken);
  } else if (destination === 'trash') {
    await uiOps.executeSearch('in:trash', pageToken);
  } else {
    throw new Error(`Unsupported navigation destination: ${String(destination)}`);
  }

  return {
    success: true,
    actionType: 'NAVIGATE',
    message: `Navigated to ${destination}${pageToken ? ` (page: ${pageToken})` : ''}`,
    metadata: { destination, pageToken: pageToken || null },
  };
}

/**
 * Main Central Action Executor.
 * Validates, logs, and dispatches an action to the corresponding UI operation.
 */
export async function executeAIAction(rawAction: unknown): Promise<AIExecutionResult> {
  const validation = validateAIAction(rawAction);
  if (!validation.valid || !validation.action) {
    const errorMsg = validation.error || 'Action validation failed';
    const fallbackType = (rawAction as { type?: unknown })?.type;
    console.error('[AI Action Executor] Validation error:', errorMsg, rawAction);
    return {
      success: false,
      actionType: typeof fallbackType === 'string' ? (fallbackType as any) : 'NAVIGATE',
      message: 'Action rejected by validator',
      error: errorMsg,
    };
  }

  const action = validation.action;
  logAction(action, 'STARTING');

  try {
    let result: AIExecutionResult;

    switch (action.type) {
      case 'COMPOSE_EMAIL':
        result = await handleComposeEmail(action.payload);
        break;
      case 'SEARCH_EMAILS':
        result = await handleSearchEmails(action.payload);
        break;
      case 'OPEN_EMAIL':
        result = await handleOpenEmail(action.payload);
        break;
      case 'REPLY_EMAIL':
        result = await handleReplyEmail(action.payload);
        break;
      case 'FORWARD_EMAIL':
        result = await handleForwardEmail(action.payload);
        break;
      case 'SET_FILTER':
        result = await handleSetFilter(action.payload);
        break;
      case 'NAVIGATE':
        result = await handleNavigate(action.payload);
        break;
      default:
        throw new Error(`Unhandled action type in executor: ${(action as any).type}`);
    }

    logAction(action, 'SUCCESS');
    return result;
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logAction(action, 'FAILED', errorMsg);
    return {
      success: false,
      actionType: action.type,
      message: `Failed to execute ${action.type}`,
      error: errorMsg,
    };
  }
}
