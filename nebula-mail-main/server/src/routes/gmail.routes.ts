import { Router, Request, Response } from 'express';
import { GmailClientFactory } from '../services/gmail.service';

const router = Router();

/**
 * GET /api/gmail/status
 * Health and configuration check for Gmail service
 */
router.get('/status', (_req: Request, res: Response) => {
  const isConfigured = Boolean(
    process.env.GMAIL_CLIENT_ID &&
      process.env.GMAIL_CLIENT_SECRET &&
      !process.env.GMAIL_CLIENT_ID.includes('your-google-client-id')
  );

  return res.json({
    service: 'Gmail API Access Layer',
    configured: isConfigured,
    redirectUri: process.env.GMAIL_REDIRECT_URI || 'http://localhost:5173/api/auth/callback/google',
    sourceOfTruth: 'Gmail API (Messages not stored statically in database)',
  });
});

/**
 * 1. GET /api/gmail/threads
 * List Gmail threads/messages for the Inbox.
 * Support pagination (pageToken, maxResults).
 * Return normalized data suitable for the existing Inbox UI.
 */
router.get('/threads', async (req: Request, res: Response) => {
  try {
    const authContext = await GmailClientFactory.getAuthenticatedClient(req);
    if (!authContext) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'No authenticated Gmail account found. Please connect your Gmail account via /api/auth/google',
      });
    }

    const { gmail } = authContext;
    const pageToken = (req.query.pageToken as string) || undefined;
    const maxResults = Math.min(parseInt((req.query.maxResults as string) || '20', 10), 50);

    // List threads matching Inbox label
    const listRes = await gmail.users.threads.list({
      userId: 'me',
      q: 'label:INBOX',
      maxResults,
      pageToken,
    });

    const threadSummaries = listRes.data.threads || [];
    const nextPageToken = listRes.data.nextPageToken || undefined;
    const resultSizeEstimate = listRes.data.resultSizeEstimate || 0;

    // Fetch full thread details in parallel (capped at maxResults)
    const threadPromises = threadSummaries.map(async (t) => {
      try {
        const fullThread = await gmail.users.threads.get({
          userId: 'me',
          id: t.id!,
          format: 'metadata',
          metadataHeaders: ['Subject', 'From', 'To', 'Date'],
        });
        return GmailClientFactory.normalizeGmailThread(fullThread.data);
      } catch (threadError) {
        console.warn(`Failed to fetch thread details for ${t.id}:`, threadError);
        return null;
      }
    });

    const resolved = await Promise.all(threadPromises);
    const normalizedThreads = resolved.filter((item): item is NonNullable<typeof item> => item !== null);

    return res.json({
      threads: normalizedThreads,
      nextPageToken,
      resultSizeEstimate,
    });
  } catch (err: unknown) {
    const error = err as Error;
    console.error('Error fetching Gmail threads:', error);
    return res.status(500).json({
      error: 'Failed to retrieve Gmail threads',
      message: error.message,
    });
  }
});

/**
 * 2. GET /api/gmail/messages/:id
 * Fetch a specific Gmail message.
 * Return sender, recipients, subject, date, body/snippet, read/unread state, and Gmail message ID.
 * Handle missing/invalid IDs safely.
 */
router.get('/messages/:id', async (req: Request, res: Response) => {
  const paramId = req.params.id;
  const messageId = Array.isArray(paramId) ? paramId[0] : paramId;

  if (!messageId || typeof messageId !== 'string' || messageId.trim() === '' || messageId === 'undefined') {
    return res.status(400).json({
      error: 'Invalid message ID',
      message: 'A valid Gmail message ID must be provided in the route path',
    });
  }

  try {
    const authContext = await GmailClientFactory.getAuthenticatedClient(req);
    if (!authContext) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'No authenticated Gmail account found. Please connect your Gmail account via /api/auth/google',
      });
    }

    const { gmail } = authContext;

    const response = await gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full',
    });

    if (!response.data) {
      return res.status(404).json({
        error: 'Message not found',
        message: `No Gmail message found with ID: ${messageId}`,
      });
    }

    const normalized = GmailClientFactory.normalizeGmailMessage(response.data);
    return res.json(normalized);
  } catch (err: unknown) {
    const error = err as { code?: number; message?: string };
    console.error(`Error fetching message ${messageId}:`, error);

    if (error.code === 404) {
      return res.status(404).json({
        error: 'Message not found',
        message: `Gmail message with ID "${messageId}" was not found`,
      });
    }

    return res.status(500).json({
      error: 'Failed to fetch Gmail message',
      message: error.message || 'Unknown error occurred while contacting Gmail API',
    });
  }
});

/**
 * 3. GET /api/gmail/sent
 * Fetch messages from the Sent mailbox.
 * Return normalized data for the existing Sent UI.
 */
router.get('/sent', async (req: Request, res: Response) => {
  try {
    const authContext = await GmailClientFactory.getAuthenticatedClient(req);
    if (!authContext) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'No authenticated Gmail account found. Please connect your Gmail account via /api/auth/google',
      });
    }

    const { gmail } = authContext;
    const pageToken = (req.query.pageToken as string) || undefined;
    const maxResults = Math.min(parseInt((req.query.maxResults as string) || '20', 10), 50);

    const listRes = await gmail.users.threads.list({
      userId: 'me',
      q: 'label:SENT',
      maxResults,
      pageToken,
    });

    const threadSummaries = listRes.data.threads || [];
    const nextPageToken = listRes.data.nextPageToken || undefined;
    const resultSizeEstimate = listRes.data.resultSizeEstimate || 0;

    const threadPromises = threadSummaries.map(async (t) => {
      try {
        const fullThread = await gmail.users.threads.get({
          userId: 'me',
          id: t.id!,
          format: 'metadata',
          metadataHeaders: ['Subject', 'From', 'To', 'Date'],
        });
        return GmailClientFactory.normalizeGmailThread(fullThread.data);
      } catch (threadError) {
        console.warn(`Failed to fetch sent thread details for ${t.id}:`, threadError);
        return null;
      }
    });

    const resolved = await Promise.all(threadPromises);
    const normalizedThreads = resolved.filter((item): item is NonNullable<typeof item> => item !== null);

    return res.json({
      threads: normalizedThreads,
      nextPageToken,
      resultSizeEstimate,
    });
  } catch (err: unknown) {
    const error = err as Error;
    console.error('Error fetching sent messages:', error);
    return res.status(500).json({
      error: 'Failed to retrieve sent messages',
      message: error.message,
    });
  }
});

/**
 * 4. POST /api/gmail/send
 * Accept recipient, subject, and body.
 * Validate the input.
 * Send through the Gmail API.
 * Return success only after Gmail confirms the send.
 * Prevent accidental duplicate sends.
 */
router.post('/send', async (req: Request, res: Response) => {
  const { recipient, subject, body, idempotencyKey } = req.body || {};

  // Input validations
  if (!recipient || typeof recipient !== 'string' || !recipient.includes('@')) {
    return res.status(400).json({
      error: 'Invalid recipient',
      message: 'A valid recipient email address is required (e.g. user@example.com)',
    });
  }

  if (!subject || typeof subject !== 'string' || subject.trim() === '') {
    return res.status(400).json({
      error: 'Missing subject',
      message: 'Subject line cannot be empty',
    });
  }

  if (body === undefined || body === null || (typeof body === 'string' && body.trim() === '')) {
    return res.status(400).json({
      error: 'Missing body',
      message: 'Message body cannot be empty',
    });
  }

  try {
    const authContext = await GmailClientFactory.getAuthenticatedClient(req);
    if (!authContext) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'No authenticated Gmail account found. Please connect your Gmail account via /api/auth/google',
      });
    }

    const { gmail, email } = authContext;

    // Send through Gmail API with duplicate prevention
    const { messageId, threadId } = await GmailClientFactory.sendEmail(gmail, {
      recipient: recipient.trim(),
      subject: subject.trim(),
      body: String(body),
      fromEmail: email,
      idempotencyKey,
    });

    return res.status(200).json({
      success: true,
      messageId,
      threadId,
      recipient: recipient.trim(),
      subject: subject.trim(),
      timestamp: new Date().toISOString(),
    });
  } catch (err: unknown) {
    const error = err as Error;
    console.error('Error sending message via Gmail API:', error);
    return res.status(500).json({
      error: 'Failed to send email via Gmail API',
      message: error.message,
    });
  }
});

/**
 * 5. GET /api/gmail/search
 * Accept a Gmail search query (q).
 * Return matching messages/threads.
 * Validate the query and handle empty results.
 */
router.get('/search', async (req: Request, res: Response) => {
  const query = (req.query.q as string) || '';

  if (!query || query.trim() === '') {
    return res.status(400).json({
      error: 'Missing search query',
      message: 'Query parameter "q" is required and cannot be empty',
    });
  }

  try {
    const authContext = await GmailClientFactory.getAuthenticatedClient(req);
    if (!authContext) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'No authenticated Gmail account found. Please connect your Gmail account via /api/auth/google',
      });
    }

    const { gmail } = authContext;
    const pageToken = (req.query.pageToken as string) || undefined;
    const maxResults = Math.min(parseInt((req.query.maxResults as string) || '20', 10), 50);

    const searchRes = await gmail.users.threads.list({
      userId: 'me',
      q: query.trim(),
      maxResults,
      pageToken,
    });

    const threadSummaries = searchRes.data.threads || [];
    const nextPageToken = searchRes.data.nextPageToken || undefined;
    const resultSizeEstimate = searchRes.data.resultSizeEstimate || 0;

    if (threadSummaries.length === 0) {
      return res.json({
        threads: [],
        query: query.trim(),
        totalMatches: 0,
        message: 'No matching conversations found',
      });
    }

    const threadPromises = threadSummaries.map(async (t) => {
      try {
        const fullThread = await gmail.users.threads.get({
          userId: 'me',
          id: t.id!,
          format: 'metadata',
          metadataHeaders: ['Subject', 'From', 'To', 'Date'],
        });
        return GmailClientFactory.normalizeGmailThread(fullThread.data);
      } catch (threadError) {
        console.warn(`Failed to fetch search result thread details for ${t.id}:`, threadError);
        return null;
      }
    });

    const resolved = await Promise.all(threadPromises);
    const normalizedThreads = resolved.filter((item): item is NonNullable<typeof item> => item !== null);

    return res.json({
      threads: normalizedThreads,
      query: query.trim(),
      nextPageToken,
      resultSizeEstimate,
      totalMatches: normalizedThreads.length,
    });
  } catch (err: unknown) {
    const error = err as Error;
    console.error(`Error searching Gmail with query "${query}":`, error);
    return res.status(500).json({
      error: 'Failed to search Gmail',
      message: error.message,
    });
  }
});

export default router;
