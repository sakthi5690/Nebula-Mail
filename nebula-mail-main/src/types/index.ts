import type { Database } from './database.types';

// Table Row Shortcuts
export type UserProfile = Database['public']['Tables']['user_profiles']['Row'];
export type GmailAccount = Database['public']['Tables']['gmail_accounts']['Row'];
export type GmailSyncState = Database['public']['Tables']['gmail_sync_states']['Row'];
export type GmailWatchSubscription = Database['public']['Tables']['gmail_watch_subscriptions']['Row'];
export type UserPreferences = Database['public']['Tables']['user_preferences']['Row'];

// Safe Public Account View (tokens stripped for frontend consumption)
export type SafeGmailAccount = Omit<
  GmailAccount,
  'access_token_encrypted' | 'refresh_token_encrypted'
>;

// Live Pub/Sub Telemetry Event for UI State Tree
export interface PubSubTelemetryEvent {
  ackId: string;
  historyId: string;
  sizeBytes: number;
  latencyMs: number;
  timestamp: string;
  event: 'sync_ack' | 'watch_renew' | 'ui_state_mutation' | 'error';
}

// Gmail In-Memory Ephemeral Model (Gmail is the source of truth, not stored statically in DB)
export interface EmailParticipant {
  name: string;
  email: string;
}

export interface EmailAttachment {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

export interface EmailMessage {
  id: string;
  threadId: string;
  sender: EmailParticipant;
  recipients: EmailParticipant[];
  subject: string;
  snippet: string;
  bodyHtml?: string;
  bodyPlain?: string;
  receivedAt: string;
  isUnread: boolean;
  isStarred: boolean;
  labels: string[];
  attachments: EmailAttachment[];
}

export interface EmailThread {
  id: string;
  subject: string;
  snippet: string;
  lastMessageTimestamp: string;
  messageCount: number;
  isUnread: boolean;
  isStarred: boolean;
  tags: string[];
  participants: EmailParticipant[];
  latestSenderInitials: string;
}

// AI Copilot Action & Function Calling Types
export type CopilotActionType =
  | 'filter_mail'
  | 'open_compose'
  | 'populate_draft'
  | 'summarize_thread'
  | 'generate_reply'
  | 'mark_read';

export interface CopilotActionPayload {
  action: CopilotActionType;
  params: Record<string, unknown>;
  confidence?: number;
  explanation?: string;
}
