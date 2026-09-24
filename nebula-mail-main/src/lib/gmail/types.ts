/**
 * Gmail API & Pub/Sub Type Definitions
 *
 * Defines the contract for Gmail API integration, OAuth scopes,
 * Pub/Sub real-time push payload, and watch renewal.
 */

export interface GmailOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string[];
}

export const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
];

export interface GmailPubSubPushMessage {
  message: {
    data: string; // Base64-encoded JSON: { emailAddress: string, historyId: string }
    messageId: string;
    publishTime: string;
  };
  subscription: string;
}

export interface GmailPubSubPayload {
  emailAddress: string;
  historyId: string;
}

export interface GmailWatchResponse {
  historyId: string;
  expiration: string; // Millisecond timestamp string
}

export interface GmailSyncResult {
  accountEmail: string;
  syncedMessagesCount: number;
  newHistoryId: string;
  latencyMs: number;
  error?: string;
}
