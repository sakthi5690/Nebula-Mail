/**
 * Frontend Gmail API Client
 *
 * Exclusively calls backend endpoints.
 * Never performs direct OAuth token exchange or accesses secret credentials.
 */

import type { EmailMessage, EmailThread } from '../../types';

export interface BackendHealthResponse {
  status: string;
  service: string;
  timestamp: string;
  uptime: number;
  environment: string;
}

export interface GmailConfigStatus {
  service: string;
  configured: boolean;
  redirectUri: string;
  sourceOfTruth: string;
}

export interface AuthStatusResponse {
  connected: boolean;
  email?: string;
  userId?: string;
  message: string;
}

export interface ThreadsResponse {
  threads: EmailThread[];
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

export interface SendEmailPayload {
  recipient: string;
  subject: string;
  body: string;
  idempotencyKey?: string;
}

export interface SendEmailResponse {
  success: boolean;
  messageId: string;
  threadId: string;
  recipient: string;
  subject: string;
  timestamp: string;
}

export interface SearchResponse {
  threads: EmailThread[];
  query: string;
  nextPageToken?: string;
  resultSizeEstimate?: number;
  totalMatches: number;
  message?: string;
}

export class FrontendGmailApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = '/api') {
    this.baseUrl = baseUrl;
  }

  /**
   * Helper to build request headers with credentials
   */
  private getHeaders(): HeadersInit {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    const connectedEmail = sessionStorage.getItem('stitch_gmail_connected_email');
    if (connectedEmail) {
      headers['x-user-email'] = connectedEmail;
    }
    return headers;
  }

  /**
   * Checks backend health
   */
  public async getHealth(): Promise<BackendHealthResponse> {
    const res = await fetch(`${this.baseUrl}/health`);
    if (!res.ok) throw new Error(`Health check failed: ${res.statusText}`);
    return res.json();
  }

  /**
   * Checks Gmail API layer configuration status
   */
  public async getGmailStatus(): Promise<GmailConfigStatus> {
    const res = await fetch(`${this.baseUrl}/gmail/status`);
    if (!res.ok) throw new Error(`Status check failed: ${res.statusText}`);
    return res.json();
  }

  /**
   * Checks if user has an active authenticated Gmail session
   */
  public async getAuthStatus(): Promise<AuthStatusResponse> {
    const res = await fetch(`${this.baseUrl}/auth/status`, {
      headers: this.getHeaders(),
      credentials: 'include',
    });
    if (!res.ok) throw new Error(`Auth status check failed: ${res.statusText}`);
    return res.json();
  }

  /**
   * Initiates Google OAuth flow by redirecting browser to backend authorization endpoint
   */
  public initiateGoogleLogin(userId?: string): void {
    const target = userId
      ? `${this.baseUrl}/auth/google?userId=${encodeURIComponent(userId)}`
      : `${this.baseUrl}/auth/google`;
    window.location.href = target;
  }

  /**
   * 1. GET /api/gmail/threads
   * Lists threads for the Inbox with optional pagination
   */
  public async listInboxThreads(params?: {
    pageToken?: string;
    maxResults?: number;
  }): Promise<ThreadsResponse> {
    const query = new URLSearchParams();
    if (params?.pageToken) query.set('pageToken', params.pageToken);
    if (params?.maxResults) query.set('maxResults', params.maxResults.toString());

    const qs = query.toString() ? `?${query.toString()}` : '';
    const res = await fetch(`${this.baseUrl}/gmail/threads${qs}`, {
      headers: this.getHeaders(),
      credentials: 'include',
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(err.message || 'Failed to fetch inbox threads');
    }
    return res.json();
  }

  /**
   * 2. GET /api/gmail/messages/:id
   * Fetches full detail of a specific message
   */
  public async getMessage(id: string): Promise<EmailMessage> {
    const res = await fetch(`${this.baseUrl}/gmail/messages/${encodeURIComponent(id)}`, {
      headers: this.getHeaders(),
      credentials: 'include',
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(err.message || `Failed to fetch message: ${id}`);
    }
    return res.json();
  }

  /**
   * 3. GET /api/gmail/sent
   * Fetches messages/threads from the Sent mailbox
   */
  public async listSentMessages(params?: {
    pageToken?: string;
    maxResults?: number;
  }): Promise<ThreadsResponse> {
    const query = new URLSearchParams();
    if (params?.pageToken) query.set('pageToken', params.pageToken);
    if (params?.maxResults) query.set('maxResults', params.maxResults.toString());

    const qs = query.toString() ? `?${query.toString()}` : '';
    const res = await fetch(`${this.baseUrl}/gmail/sent${qs}`, {
      headers: this.getHeaders(),
      credentials: 'include',
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(err.message || 'Failed to fetch sent messages');
    }
    return res.json();
  }

  /**
   * 4. POST /api/gmail/send
   * Sends an email via Gmail API
   */
  public async sendEmail(payload: SendEmailPayload): Promise<SendEmailResponse> {
    const res = await fetch(`${this.baseUrl}/gmail/send`, {
      method: 'POST',
      headers: this.getHeaders(),
      credentials: 'include',
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(err.message || 'Failed to send email');
    }
    return res.json();
  }

  /**
   * 5. GET /api/gmail/search
   * Performs full-text / operator search on Gmail
   */
  public async searchMessages(
    queryText: string,
    params?: { pageToken?: string; maxResults?: number }
  ): Promise<SearchResponse> {
    const query = new URLSearchParams({ q: queryText });
    if (params?.pageToken) query.set('pageToken', params.pageToken);
    if (params?.maxResults) query.set('maxResults', params.maxResults.toString());

    const res = await fetch(`${this.baseUrl}/gmail/search?${query.toString()}`, {
      headers: this.getHeaders(),
      credentials: 'include',
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(err.message || 'Failed to search messages');
    }
    return res.json();
  }

  /**
   * 6. GET /api/gmail/sync/status
   * Checks real-time sync status (watch state, SSE connections)
   */
  public async getSyncStatus(): Promise<{
    realtimeEnabled: boolean;
    pubsubConfigured: boolean;
    watches: Array<{
      email: string;
      historyId: string;
      expiration: string;
      expiresInHours: number;
      isActive: boolean;
    }>;
    sseConnections: { total: number; byEmail: Record<string, number> };
    serverTimestamp: string;
  }> {
    const res = await fetch(`${this.baseUrl}/gmail/sync/status`, {
      headers: this.getHeaders(),
      credentials: 'include',
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(err.message || 'Failed to get sync status');
    }
    return res.json();
  }

  /**
   * 7. POST /api/gmail/sync/watch
   * Creates or renews a Gmail mailbox watch
   */
  public async createWatch(): Promise<{
    success: boolean;
    watch: {
      email: string;
      historyId: string;
      expiration: string;
      expiresInHours: number;
      isActive: boolean;
    };
  }> {
    const res = await fetch(`${this.baseUrl}/gmail/sync/watch`, {
      method: 'POST',
      headers: this.getHeaders(),
      credentials: 'include',
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(err.message || 'Failed to create watch');
    }
    return res.json();
  }
}

export const frontendGmailApi = new FrontendGmailApiClient();

