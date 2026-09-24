import { google, gmail_v1 } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import type { Request } from 'express';
import { decryptToken } from '../utils/crypto';
import { getSupabaseAdminClient } from '../../../src/lib/supabase/server';
import { googleOAuthService } from './oauth.service';
import type { EmailMessage, EmailThread, EmailParticipant, EmailAttachment } from '../../../src/types';

// In-memory duplicate send cache (prevents duplicate sends within 5 minutes)
interface SentRecord {
  timestamp: number;
  messageId: string;
}
const recentSendsCache = new Map<string, SentRecord>();

/**
 * Server-Side Gmail Client Factory & Operation Service
 * Constructs an authenticated Google Gmail API client using server-held credentials.
 * Keeps Gmail as the sole source of truth for email contents.
 */
export class GmailClientFactory {
  /**
   * Retrieves an authenticated Gmail API client from Express Request context:
   * 1. Checks server session cookie (stitch_session)
   * 2. Checks x-user-email or account query parameters
   * 3. Checks latest active session on server
   * 4. Queries Supabase gmail_accounts table with decrypted refresh tokens
   */
  public static async getAuthenticatedClient(req: Request): Promise<{
    gmail: gmail_v1.Gmail;
    email: string;
  } | null> {
    const sessionId = (req.cookies && req.cookies.stitch_session) || '';
    const userEmail =
      (req.headers['x-user-email'] as string) ||
      (req.query.email as string) ||
      (req.cookies && req.cookies.stitch_user_email) ||
      '';

    // 1. Check in-memory cached session
    let session = sessionId ? googleOAuthService.getCachedSession(sessionId) : undefined;
    if (!session && userEmail) {
      session = googleOAuthService.getCachedSession(userEmail);
    }
    if (!session) {
      session = googleOAuthService.getLatestSession();
    }

    if (session && (session.refreshToken || session.accessToken)) {
      const oauth2Client: OAuth2Client = new google.auth.OAuth2(
        process.env.GMAIL_CLIENT_ID,
        process.env.GMAIL_CLIENT_SECRET,
        process.env.GMAIL_REDIRECT_URI
      );

      oauth2Client.setCredentials({
        refresh_token: session.refreshToken,
        access_token: session.accessToken,
      });

      return {
        gmail: google.gmail({ version: 'v1', auth: oauth2Client }),
        email: session.email,
      };
    }

    // 2. Fallback to Supabase database if available
    try {
      const supabase = getSupabaseAdminClient();
      let query = supabase.from('gmail_accounts').select('*');
      if (userEmail) {
        query = query.eq('email_address', userEmail);
      }
      const { data: accounts, error } = await query.order('updated_at', { ascending: false }).limit(1);

      if (!error && accounts && accounts.length > 0) {
        const account = accounts[0];
        if (account.refresh_token_encrypted) {
          const refreshToken = decryptToken(account.refresh_token_encrypted);
          const accessToken = account.access_token_encrypted
            ? decryptToken(account.access_token_encrypted)
            : undefined;

          const oauth2Client: OAuth2Client = new google.auth.OAuth2(
            process.env.GMAIL_CLIENT_ID,
            process.env.GMAIL_CLIENT_SECRET,
            process.env.GMAIL_REDIRECT_URI
          );

          oauth2Client.setCredentials({
            refresh_token: refreshToken,
            access_token: accessToken,
          });

          return {
            gmail: google.gmail({ version: 'v1', auth: oauth2Client }),
            email: account.email_address,
          };
        }
      }
    } catch {
      // Supabase not configured or no account found
    }

    return null;
  }

  /**
   * Retrieves an authenticated client for a specific account ID in Supabase
   */
  public static async getClientForAccount(accountId: string): Promise<gmail_v1.Gmail> {
    const supabase = getSupabaseAdminClient();

    const { data: account, error } = await supabase
      .from('gmail_accounts')
      .select('*')
      .eq('id', accountId)
      .single();

    if (error || !account) {
      throw new Error(`Gmail account not found for ID: ${accountId}`);
    }

    if (!account.refresh_token_encrypted) {
      throw new Error(`No refresh token available for Gmail account: ${account.email_address}`);
    }

    const refreshToken = decryptToken(account.refresh_token_encrypted);
    const accessToken = account.access_token_encrypted
      ? decryptToken(account.access_token_encrypted)
      : undefined;

    const oauth2Client: OAuth2Client = new google.auth.OAuth2(
      process.env.GMAIL_CLIENT_ID,
      process.env.GMAIL_CLIENT_SECRET,
      process.env.GMAIL_REDIRECT_URI
    );

    oauth2Client.setCredentials({
      refresh_token: refreshToken,
      access_token: accessToken,
    });

    return google.gmail({ version: 'v1', auth: oauth2Client });
  }

  // ============================================================================
  // NORMALIZATION & DATA TRANSFORMATION UTILITIES
  // ============================================================================

  /**
   * Parses RFC 822 email address string like "John Doe <john@example.com>"
   */
  public static parseParticipant(raw: string = ''): EmailParticipant {
    const trimmed = raw.trim();
    if (!trimmed) {
      return { name: 'Unknown', email: '' };
    }

    const match = trimmed.match(/^(?:"?([^"]*)"?\s)?<?([^>]+@[^>]+)>?$/);
    if (match) {
      const name = match[1]?.trim() || match[2].split('@')[0];
      return { name, email: match[2].trim() };
    }

    return { name: trimmed.split('@')[0] || trimmed, email: trimmed };
  }

  /**
   * Parses comma-separated participant list
   */
  public static parseParticipantList(raw: string = ''): EmailParticipant[] {
    if (!raw.trim()) return [];
    return raw.split(',').map((p) => this.parseParticipant(p.trim())).filter((p) => p.email);
  }

  /**
   * Extracts headers from Gmail Message Payload
   */
  public static extractHeaders(headers?: gmail_v1.Schema$MessagePartHeader[]) {
    const headerMap: Record<string, string> = {};
    if (headers) {
      for (const h of headers) {
        if (h.name && h.value) {
          headerMap[h.name.toLowerCase()] = h.value;
        }
      }
    }

    return {
      subject: headerMap['subject'] || '(No Subject)',
      from: this.parseParticipant(headerMap['from'] || ''),
      to: this.parseParticipantList(headerMap['to'] || ''),
      date: headerMap['date'] || new Date().toISOString(),
    };
  }

  /**
   * Decodes Base64URL string to UTF-8
   */
  public static decodeBase64Url(base64url: string): string {
    try {
      const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
      return Buffer.from(base64, 'base64').toString('utf8');
    } catch {
      return '';
    }
  }

  /**
   * Recursively extracts plain/html message body & attachments from MIME parts
   */
  public static extractBodyAndAttachments(payload?: gmail_v1.Schema$MessagePart): {
    bodyHtml?: string;
    bodyPlain?: string;
    attachments: EmailAttachment[];
  } {
    let bodyHtml: string | undefined;
    let bodyPlain: string | undefined;
    const attachments: EmailAttachment[] = [];

    const walk = (part?: gmail_v1.Schema$MessagePart) => {
      if (!part) return;

      if (part.filename && part.body && part.body.attachmentId) {
        attachments.push({
          id: part.body.attachmentId,
          filename: part.filename,
          mimeType: part.mimeType || 'application/octet-stream',
          sizeBytes: part.body.size || 0,
        });
      }

      if (part.mimeType === 'text/html' && part.body?.data && !bodyHtml) {
        bodyHtml = this.decodeBase64Url(part.body.data);
      } else if (part.mimeType === 'text/plain' && part.body?.data && !bodyPlain) {
        bodyPlain = this.decodeBase64Url(part.body.data);
      }

      if (part.parts && part.parts.length > 0) {
        for (const child of part.parts) {
          walk(child);
        }
      }
    };

    walk(payload);

    return { bodyHtml, bodyPlain, attachments };
  }

  /**
   * Normalizes a raw Gmail API message to Stitch EmailMessage format
   */
  public static normalizeGmailMessage(msg: gmail_v1.Schema$Message): EmailMessage {
    const { subject, from, to, date } = this.extractHeaders(msg.payload?.headers);
    const { bodyHtml, bodyPlain, attachments } = this.extractBodyAndAttachments(msg.payload);
    const labels = msg.labelIds || [];

    return {
      id: msg.id || '',
      threadId: msg.threadId || '',
      sender: from,
      recipients: to,
      subject,
      snippet: msg.snippet || '',
      bodyHtml,
      bodyPlain: bodyPlain || msg.snippet || '',
      receivedAt: date,
      isUnread: labels.includes('UNREAD'),
      isStarred: labels.includes('STARRED'),
      labels,
      attachments,
    };
  }

  /**
   * Normalizes a raw Gmail API thread to Stitch EmailThread format
   */
  public static normalizeGmailThread(thread: gmail_v1.Schema$Thread): EmailThread {
    const messages = thread.messages || [];
    const latestMsg = messages.length > 0 ? messages[messages.length - 1] : undefined;

    let subject = '(No Subject)';
    let snippet = thread.snippet || '';
    let lastDate = new Date().toISOString();
    let isUnread = false;
    let isStarred = false;
    const participants: EmailParticipant[] = [];
    const tags: string[] = [];

    for (const msg of messages) {
      const labels = msg.labelIds || [];
      if (labels.includes('UNREAD')) isUnread = true;
      if (labels.includes('STARRED')) isStarred = true;

      for (const lbl of labels) {
        if (!['INBOX', 'UNREAD', 'STARRED', 'SENT', 'CATEGORY_PERSONAL'].includes(lbl)) {
          if (!tags.includes(lbl)) tags.push(lbl);
        }
      }

      const headers = msg.payload?.headers;
      if (headers) {
        const { from, subject: sub, date } = this.extractHeaders(headers);
        if (sub && subject === '(No Subject)') subject = sub;
        if (date) lastDate = date;
        if (from.email && !participants.some((p) => p.email === from.email)) {
          participants.push(from);
        }
      }
    }

    if (latestMsg?.snippet) {
      snippet = latestMsg.snippet;
    }

    const latestParticipant = participants[participants.length - 1] || { name: 'Unknown', email: '' };
    const latestSenderInitials = latestParticipant.name
      ? latestParticipant.name
          .split(' ')
          .map((n) => n[0])
          .join('')
          .substring(0, 2)
          .toUpperCase()
      : 'U';

    return {
      id: thread.id || '',
      subject,
      snippet,
      lastMessageTimestamp: lastDate,
      messageCount: messages.length || 1,
      isUnread,
      isStarred,
      tags,
      participants,
      latestSenderInitials,
    };
  }

  // ============================================================================
  // EMAIL SENDING & DEDUPLICATION LOGIC
  // ============================================================================

  /**
   * Constructs an RFC 2822 base64url encoded message payload
   */
  public static createRfc2822Message(params: {
    to: string;
    subject: string;
    body: string;
    fromEmail?: string;
  }): string {
    const { to, subject, body, fromEmail } = params;

    const emailLines: string[] = [];
    if (fromEmail) {
      emailLines.push(`From: ${fromEmail}`);
    }
    emailLines.push(`To: ${to}`);
    emailLines.push(`Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`);
    emailLines.push('MIME-Version: 1.0');
    emailLines.push('Content-Type: text/html; charset=UTF-8');
    emailLines.push('Content-Transfer-Encoding: 7bit');
    emailLines.push('');
    // Replace newlines with <br/> if not already HTML
    const formattedBody = body.includes('<') && body.includes('>') ? body : body.replace(/\n/g, '<br/>');
    emailLines.push(formattedBody);

    const emailRaw = emailLines.join('\r\n');
    return Buffer.from(emailRaw)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  /**
   * Sends an email via Gmail API with duplicate send prevention
   */
  public static async sendEmail(
    gmail: gmail_v1.Gmail,
    params: {
      recipient: string;
      subject: string;
      body: string;
      fromEmail?: string;
      idempotencyKey?: string;
    }
  ): Promise<{ messageId: string; threadId: string }> {
    const { recipient, subject, body, fromEmail, idempotencyKey } = params;

    // Deduplication Key: explicit key or content fingerprint
    const dedupeKey =
      idempotencyKey || `${recipient}:${subject}:${body.trim().substring(0, 100)}`;

    const existing = recentSendsCache.get(dedupeKey);
    const now = Date.now();
    // 5-minute deduplication window
    if (existing && now - existing.timestamp < 300000) {
      console.warn(`[Gmail API] Prevented duplicate send within 5m window for key: ${dedupeKey}`);
      return {
        messageId: existing.messageId,
        threadId: '',
      };
    }

    const raw = this.createRfc2822Message({
      to: recipient,
      subject,
      body,
      fromEmail,
    });

    const response = await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw,
      },
    });

    const messageId = response.data.id || '';
    const threadId = response.data.threadId || '';

    // Cache successful send
    recentSendsCache.set(dedupeKey, {
      timestamp: now,
      messageId,
    });

    // Cleanup cache entries older than 10 minutes
    for (const [key, val] of recentSendsCache.entries()) {
      if (now - val.timestamp > 600000) {
        recentSendsCache.delete(key);
      }
    }

    return { messageId, threadId };
  }
}
