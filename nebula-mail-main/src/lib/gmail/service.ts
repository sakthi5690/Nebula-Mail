import type {
  GmailWatchResponse,
  GmailSyncResult,
} from './types';
import type { EmailMessage, EmailThread } from '../../types';

/**
 * Server-Side Gmail Service Interface
 *
 * Encapsulates all interactions with the Google Gmail REST API.
 * CRITICAL ARCHITECTURAL CONSTRAINTS:
 * 1. Gmail is the SOLE source of truth for email bodies, headers, and threads.
 * 2. OAuth tokens and refresh flows execute exclusively on the server.
 * 3. Supabase stores ONLY synchronization metadata (history IDs, watch expirations, sync latency).
 */
export interface IGmailService {
  /**
   * Generates the Google OAuth authorization URL with required offline access.
   */
  getAuthorizationUrl(state: string): string;

  /**
   * Exchanges an authorization code for access and refresh tokens.
   */
  exchangeCodeForTokens(code: string): Promise<{
    accessToken: string;
    refreshToken: string;
    expiryDate: number;
    email: string;
  }>;

  /**
   * Registers a Google Cloud Pub/Sub topic to watch the user's mailbox for push changes.
   */
  setupWatch(userEmail: string, topicName: string): Promise<GmailWatchResponse>;

  /**
   * Stops the active watch subscription.
   */
  stopWatch(userEmail: string): Promise<void>;

  /**
   * Fetches thread summaries from Gmail (cached ephemerally in server memory or client state, NOT Supabase).
   */
  listThreads(userEmail: string, query?: string, maxResults?: number): Promise<EmailThread[]>;

  /**
   * Fetches full email message content on demand from Gmail.
   */
  getMessage(userEmail: string, messageId: string): Promise<EmailMessage>;

  /**
   * Synchronizes changes given a Pub/Sub history ID push.
   */
  processHistorySync(userEmail: string, startHistoryId: string): Promise<GmailSyncResult>;
}

/**
 * Interface contract verification stub for Gmail service implementation
 */
export class GmailServiceContractStub implements IGmailService {
  getAuthorizationUrl(state: string): string {
    return `https://accounts.google.com/o/oauth2/v2/auth?response_type=code&access_type=offline&prompt=consent&state=${state}`;
  }

  async exchangeCodeForTokens(_code: string) {
    return {
      accessToken: 'stub-access-token',
      refreshToken: 'stub-refresh-token',
      expiryDate: Date.now() + 3600 * 1000,
      email: 'stub@example.com',
    };
  }

  async setupWatch(_userEmail: string, _topicName: string): Promise<GmailWatchResponse> {
    return {
      historyId: '100001',
      expiration: String(Date.now() + 7 * 24 * 3600 * 1000),
    };
  }

  async stopWatch(_userEmail: string): Promise<void> {
    return;
  }

  async listThreads(_userEmail: string, _query?: string, _maxResults?: number): Promise<EmailThread[]> {
    return [];
  }

  async getMessage(_userEmail: string, messageId: string): Promise<EmailMessage> {
    return {
      id: messageId,
      threadId: `thread_${messageId}`,
      sender: { name: 'Sender', email: 'sender@example.com' },
      recipients: [{ name: 'User', email: 'user@example.com' }],
      subject: 'Message Subject',
      snippet: 'Message snippet...',
      receivedAt: new Date().toISOString(),
      isUnread: false,
      isStarred: false,
      labels: ['INBOX'],
      attachments: [],
    };
  }

  async processHistorySync(userEmail: string, startHistoryId: string): Promise<GmailSyncResult> {
    return {
      accountEmail: userEmail,
      syncedMessagesCount: 0,
      newHistoryId: startHistoryId,
      latencyMs: 12,
    };
  }
}
