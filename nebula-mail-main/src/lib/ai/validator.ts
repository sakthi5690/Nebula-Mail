/**
 * Runtime validator for AI Actions.
 * Guarantees that any action object coming from an AI model or external API
 * strictly adheres to the AIAction union type before execution.
 */

import {
  AIAction,
  AIActionType,
  ComposeEmailPayload,
  SearchEmailsPayload,
  OpenEmailPayload,
  ReplyEmailPayload,
  ForwardEmailPayload,
  SetFilterPayload,
  NavigatePayload,
  NavDestination,
  MailFilterType,
} from './actions.types';

export interface ValidationResult {
  valid: boolean;
  action?: AIAction;
  error?: string;
}

const VALID_ACTION_TYPES: ReadonlySet<string> = new Set<AIActionType>([
  'COMPOSE_EMAIL',
  'SEARCH_EMAILS',
  'OPEN_EMAIL',
  'REPLY_EMAIL',
  'FORWARD_EMAIL',
  'SET_FILTER',
  'NAVIGATE',
]);

const VALID_NAV_DESTINATIONS: ReadonlySet<string> = new Set<NavDestination>([
  'inbox',
  'sent',
  'drafts',
  'starred',
  'trash',
]);

const VALID_FILTER_TYPES: ReadonlySet<string> = new Set<MailFilterType>([
  'all',
  'unread',
  'starred',
  'important',
  'has_attachment',
]);

function isObject(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

function isStringArray(val: unknown): val is string[] {
  return Array.isArray(val) && val.every((item) => typeof item === 'string');
}

/**
 * Validate COMPOSE_EMAIL payload
 */
function validateComposePayload(payload: unknown): { valid: boolean; payload?: ComposeEmailPayload; error?: string } {
  if (!isObject(payload)) {
    return { valid: false, error: 'COMPOSE_EMAIL payload must be an object' };
  }

  const { to, cc, bcc, subject, body } = payload;

  if (to !== undefined && !isStringArray(to)) {
    return { valid: false, error: 'COMPOSE_EMAIL: "to" must be an array of strings' };
  }
  if (cc !== undefined && !isStringArray(cc)) {
    return { valid: false, error: 'COMPOSE_EMAIL: "cc" must be an array of strings' };
  }
  if (bcc !== undefined && !isStringArray(bcc)) {
    return { valid: false, error: 'COMPOSE_EMAIL: "bcc" must be an array of strings' };
  }
  if (subject !== undefined && typeof subject !== 'string') {
    return { valid: false, error: 'COMPOSE_EMAIL: "subject" must be a string' };
  }
  if (body !== undefined && typeof body !== 'string') {
    return { valid: false, error: 'COMPOSE_EMAIL: "body" must be a string' };
  }

  return {
    valid: true,
    payload: {
      to: to as string[] | undefined,
      cc: cc as string[] | undefined,
      bcc: bcc as string[] | undefined,
      subject: subject as string | undefined,
      body: body as string | undefined,
    },
  };
}

/**
 * Validate SEARCH_EMAILS payload
 */
function validateSearchPayload(payload: unknown): { valid: boolean; payload?: SearchEmailsPayload; error?: string } {
  if (!isObject(payload)) {
    return { valid: false, error: 'SEARCH_EMAILS payload must be an object' };
  }

  const { query, filter } = payload;
  if (typeof query !== 'string') {
    return { valid: false, error: 'SEARCH_EMAILS: "query" is required and must be a string' };
  }

  if (filter !== undefined) {
    if (!isObject(filter)) {
      return { valid: false, error: 'SEARCH_EMAILS: "filter" must be an object if provided' };
    }
    if (filter.from !== undefined && typeof filter.from !== 'string') {
      return { valid: false, error: 'SEARCH_EMAILS filter: "from" must be a string' };
    }
    if (filter.to !== undefined && typeof filter.to !== 'string') {
      return { valid: false, error: 'SEARCH_EMAILS filter: "to" must be a string' };
    }
    if (filter.subject !== undefined && typeof filter.subject !== 'string') {
      return { valid: false, error: 'SEARCH_EMAILS filter: "subject" must be a string' };
    }
    if (filter.hasAttachment !== undefined && typeof filter.hasAttachment !== 'boolean') {
      return { valid: false, error: 'SEARCH_EMAILS filter: "hasAttachment" must be a boolean' };
    }
    if (filter.after !== undefined && typeof filter.after !== 'string') {
      return { valid: false, error: 'SEARCH_EMAILS filter: "after" must be a string' };
    }
    if (filter.before !== undefined && typeof filter.before !== 'string') {
      return { valid: false, error: 'SEARCH_EMAILS filter: "before" must be a string' };
    }
  }

  return {
    valid: true,
    payload: {
      query,
      filter: filter as SearchEmailsPayload['filter'],
    },
  };
}

/**
 * Validate OPEN_EMAIL payload
 */
function validateOpenEmailPayload(payload: unknown): { valid: boolean; payload?: OpenEmailPayload; error?: string } {
  if (!isObject(payload)) {
    return { valid: false, error: 'OPEN_EMAIL payload must be an object' };
  }

  const { emailId, threadId } = payload;

  if (!emailId && !threadId) {
    return { valid: false, error: 'OPEN_EMAIL: either "emailId" or "threadId" is required' };
  }

  if (emailId !== undefined && (typeof emailId !== 'string' || emailId.trim().length === 0)) {
    return { valid: false, error: 'OPEN_EMAIL: "emailId" must be a non-empty string if provided' };
  }

  if (threadId !== undefined && (typeof threadId !== 'string' || threadId.trim().length === 0)) {
    return { valid: false, error: 'OPEN_EMAIL: "threadId" must be a non-empty string if provided' };
  }

  return {
    valid: true,
    payload: {
      emailId: typeof emailId === 'string' ? emailId.trim() : undefined,
      threadId: typeof threadId === 'string' ? threadId.trim() : undefined,
    },
  };
}

/**
 * Validate REPLY_EMAIL payload
 */
function validateReplyEmailPayload(payload: unknown): { valid: boolean; payload?: ReplyEmailPayload; error?: string } {
  if (!isObject(payload)) {
    return { valid: false, error: 'REPLY_EMAIL payload must be an object' };
  }

  const { emailId, threadId, replyAll, body } = payload;

  if (emailId !== undefined && typeof emailId !== 'string') {
    return { valid: false, error: 'REPLY_EMAIL: "emailId" must be a string if provided' };
  }
  if (threadId !== undefined && typeof threadId !== 'string') {
    return { valid: false, error: 'REPLY_EMAIL: "threadId" must be a string if provided' };
  }
  if (replyAll !== undefined && typeof replyAll !== 'boolean') {
    return { valid: false, error: 'REPLY_EMAIL: "replyAll" must be a boolean if provided' };
  }
  if (body !== undefined && typeof body !== 'string') {
    return { valid: false, error: 'REPLY_EMAIL: "body" must be a string if provided' };
  }

  return {
    valid: true,
    payload: {
      emailId: emailId as string | undefined,
      threadId: threadId as string | undefined,
      replyAll: replyAll as boolean | undefined,
      body: body as string | undefined,
    },
  };
}

/**
 * Validate FORWARD_EMAIL payload
 */
function validateForwardEmailPayload(payload: unknown): { valid: boolean; payload?: ForwardEmailPayload; error?: string } {
  if (!isObject(payload)) {
    return { valid: false, error: 'FORWARD_EMAIL payload must be an object' };
  }

  const { emailId, threadId, to, cc, bcc, body } = payload;

  if (emailId !== undefined && typeof emailId !== 'string') {
    return { valid: false, error: 'FORWARD_EMAIL: "emailId" must be a string if provided' };
  }
  if (threadId !== undefined && typeof threadId !== 'string') {
    return { valid: false, error: 'FORWARD_EMAIL: "threadId" must be a string if provided' };
  }
  if (to !== undefined && !isStringArray(to)) {
    return { valid: false, error: 'FORWARD_EMAIL: "to" must be an array of strings' };
  }
  if (cc !== undefined && !isStringArray(cc)) {
    return { valid: false, error: 'FORWARD_EMAIL: "cc" must be an array of strings' };
  }
  if (bcc !== undefined && !isStringArray(bcc)) {
    return { valid: false, error: 'FORWARD_EMAIL: "bcc" must be an array of strings' };
  }
  if (body !== undefined && typeof body !== 'string') {
    return { valid: false, error: 'FORWARD_EMAIL: "body" must be a string if provided' };
  }

  return {
    valid: true,
    payload: {
      emailId: emailId as string | undefined,
      threadId: threadId as string | undefined,
      to: to as string[] | undefined,
      cc: cc as string[] | undefined,
      bcc: bcc as string[] | undefined,
      body: body as string | undefined,
    },
  };
}

/**
 * Validate SET_FILTER payload
 */
function validateSetFilterPayload(payload: unknown): { valid: boolean; payload?: SetFilterPayload; error?: string } {
  if (!isObject(payload)) {
    return { valid: false, error: 'SET_FILTER payload must be an object' };
  }

  const { filterType, active } = payload;

  if (typeof filterType !== 'string' || !VALID_FILTER_TYPES.has(filterType)) {
    return {
      valid: false,
      error: `SET_FILTER: "filterType" must be one of [${Array.from(VALID_FILTER_TYPES).join(', ')}]`,
    };
  }

  if (typeof active !== 'boolean') {
    return { valid: false, error: 'SET_FILTER: "active" must be a boolean' };
  }

  return {
    valid: true,
    payload: {
      filterType: filterType as MailFilterType,
      active,
    },
  };
}

/**
 * Validate NAVIGATE payload
 */
function validateNavigatePayload(payload: unknown): { valid: boolean; payload?: NavigatePayload; error?: string } {
  if (!isObject(payload)) {
    return { valid: false, error: 'NAVIGATE payload must be an object' };
  }

  const { destination, pageToken } = payload;

  if (typeof destination !== 'string' || !VALID_NAV_DESTINATIONS.has(destination)) {
    return {
      valid: false,
      error: `NAVIGATE: "destination" must be one of [${Array.from(VALID_NAV_DESTINATIONS).join(', ')}]`,
    };
  }

  if (pageToken !== undefined && typeof pageToken !== 'string') {
    return { valid: false, error: 'NAVIGATE: "pageToken" must be a string if provided' };
  }

  return {
    valid: true,
    payload: {
      destination: destination as NavDestination,
      pageToken: pageToken as string | undefined,
    },
  };
}

/**
 * Main runtime validator for any candidate AIAction
 */
export function validateAIAction(raw: unknown): ValidationResult {
  if (!isObject(raw)) {
    return { valid: false, error: 'Action must be an object' };
  }

  const { type, payload } = raw;

  if (typeof type !== 'string' || !VALID_ACTION_TYPES.has(type)) {
    return {
      valid: false,
      error: `Invalid action type "${String(type)}". Must be one of [${Array.from(VALID_ACTION_TYPES).join(', ')}]`,
    };
  }

  switch (type as AIActionType) {
    case 'COMPOSE_EMAIL': {
      const res = validateComposePayload(payload);
      if (!res.valid || !res.payload) return { valid: false, error: res.error };
      return { valid: true, action: { type: 'COMPOSE_EMAIL', payload: res.payload } };
    }
    case 'SEARCH_EMAILS': {
      const res = validateSearchPayload(payload);
      if (!res.valid || !res.payload) return { valid: false, error: res.error };
      return { valid: true, action: { type: 'SEARCH_EMAILS', payload: res.payload } };
    }
    case 'OPEN_EMAIL': {
      const res = validateOpenEmailPayload(payload);
      if (!res.valid || !res.payload) return { valid: false, error: res.error };
      return { valid: true, action: { type: 'OPEN_EMAIL', payload: res.payload } };
    }
    case 'REPLY_EMAIL': {
      const res = validateReplyEmailPayload(payload);
      if (!res.valid || !res.payload) return { valid: false, error: res.error };
      return { valid: true, action: { type: 'REPLY_EMAIL', payload: res.payload } };
    }
    case 'FORWARD_EMAIL': {
      const res = validateForwardEmailPayload(payload);
      if (!res.valid || !res.payload) return { valid: false, error: res.error };
      return { valid: true, action: { type: 'FORWARD_EMAIL', payload: res.payload } };
    }
    case 'SET_FILTER': {
      const res = validateSetFilterPayload(payload);
      if (!res.valid || !res.payload) return { valid: false, error: res.error };
      return { valid: true, action: { type: 'SET_FILTER', payload: res.payload } };
    }
    case 'NAVIGATE': {
      const res = validateNavigatePayload(payload);
      if (!res.valid || !res.payload) return { valid: false, error: res.error };
      return { valid: true, action: { type: 'NAVIGATE', payload: res.payload } };
    }
    default:
      return { valid: false, error: `Unhandled action type "${String(type)}"` };
  }
}

/**
 * Type guard for AIAction
 */
export function isAIAction(value: unknown): value is AIAction {
  return validateAIAction(value).valid;
}
