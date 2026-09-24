/**
 * Shared AI Action Models and Types
 * Defines the strict, validated action types that the AI system can issue
 * to control the Stitch email application.
 */

export type AIActionType =
  | 'COMPOSE_EMAIL'
  | 'SEARCH_EMAILS'
  | 'OPEN_EMAIL'
  | 'REPLY_EMAIL'
  | 'FORWARD_EMAIL'
  | 'SET_FILTER'
  | 'NAVIGATE';

export interface ComposeEmailPayload {
  to?: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  body?: string;
}

export interface SearchEmailsFilter {
  from?: string;
  to?: string;
  subject?: string;
  hasAttachment?: boolean;
  after?: string;
  before?: string;
}

export interface SearchEmailsPayload {
  query: string;
  filter?: SearchEmailsFilter;
}

export interface OpenEmailPayload {
  emailId?: string;
  threadId?: string;
}

export interface ReplyEmailPayload {
  emailId?: string;
  threadId?: string;
  replyAll?: boolean;
  body?: string;
}

export interface ForwardEmailPayload {
  emailId?: string;
  threadId?: string;
  to?: string[];
  cc?: string[];
  bcc?: string[];
  body?: string;
}

export type MailFilterType = 'all' | 'unread' | 'starred' | 'important' | 'has_attachment';

export interface SetFilterPayload {
  filterType: MailFilterType;
  active: boolean;
}

export type NavDestination = 'inbox' | 'sent' | 'drafts' | 'starred' | 'trash';

export interface NavigatePayload {
  destination: NavDestination;
  pageToken?: string;
}

export interface ComposeEmailAction {
  type: 'COMPOSE_EMAIL';
  payload: ComposeEmailPayload;
}

export interface SearchEmailsAction {
  type: 'SEARCH_EMAILS';
  payload: SearchEmailsPayload;
}

export interface OpenEmailAction {
  type: 'OPEN_EMAIL';
  payload: OpenEmailPayload;
}

export interface ReplyEmailAction {
  type: 'REPLY_EMAIL';
  payload: ReplyEmailPayload;
}

export interface ForwardEmailAction {
  type: 'FORWARD_EMAIL';
  payload: ForwardEmailPayload;
}

export interface SetFilterAction {
  type: 'SET_FILTER';
  payload: SetFilterPayload;
}

export interface NavigateAction {
  type: 'NAVIGATE';
  payload: NavigatePayload;
}

export type AIAction =
  | ComposeEmailAction
  | SearchEmailsAction
  | OpenEmailAction
  | ReplyEmailAction
  | ForwardEmailAction
  | SetFilterAction
  | NavigateAction;

/**
 * Result returned by the central action executor
 */
export interface AIExecutionResult {
  success: boolean;
  actionType: AIActionType;
  message: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Snapshot of application state sent to the AI for contextual commands
 */
export interface AIContextState {
  currentMailbox: NavDestination;
  currentSearchQuery: string | null;
  selectedEmailId: string | null;
  selectedThreadId?: string | null;
  currentlyOpenEmailId?: string | null;
  selectedEmailDetails?: { sender?: string; subject?: string } | null;
  visibleThreadIds?: string[];
  visibleThreads?: Array<{
    id: string;
    sender?: string;
    subject?: string;
    snippet?: string;
    date?: string;
    isUnread?: boolean;
  }>;
  isComposeOpen: boolean;
  isDetailOpen: boolean;
  activeFilters: string[];
  currentDraft?: {
    to?: string;
    cc?: string;
    bcc?: string;
    subject?: string;
    body?: string;
  };
  timestamp: number;
}

/**
 * Request payload for POST /api/ai/command
 */
export interface AICommandRequest {
  prompt: string;
  context?: Partial<AIContextState>;
}

/**
 * Successful response from POST /api/ai/command
 */
export interface AICommandSuccessResponse {
  success: true;
  action: AIAction;
  explanation: string;
}

/**
 * Error response from POST /api/ai/command
 */
export interface AICommandErrorResponse {
  success: false;
  error: string;
  details?: unknown;
}

export type AICommandResponse = AICommandSuccessResponse | AICommandErrorResponse;
