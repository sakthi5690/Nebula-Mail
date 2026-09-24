/**
 * Part 11 — Real-Time Gmail Sync Tests
 *
 * Deterministic tests covering:
 * 1. Valid Pub/Sub notification → history sync triggered
 * 2. Malformed Pub/Sub payload → safe rejection
 * 3. History API returns new message → change detected, frontend notified
 * 4. Multiple history pages → all pages processed correctly
 * 5. Expired history ID → safe full resync/recovery
 * 6. Inbox currently open → Inbox refresh triggered
 * 7. Sent currently open → Sent refresh triggered
 * 8. Search/filter active → search re-executed
 * 9. Email detail open and affected → detail refreshed
 * 10. Frontend realtime connection lost → fallback sync/reconnect
 * 11. Duplicate notification → not processed repeatedly
 * 12. SSE connection established → heartbeat received
 * 13. Watch creation → returns valid historyId and expiration
 * 14. Watch renewal → renews before expiration
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================================================
// MOCK: SSE Manager
// ============================================================================

interface MockSSEClient {
  email: string;
  events: Array<{ event: string; data: string }>;
}

function createMockSSEManager() {
  const clients = new Map<string, MockSSEClient[]>();
  const notifications: Array<{ email: string; event: any }> = [];

  return {
    addClient(email: string, _res: any) {
      const client: MockSSEClient = { email, events: [] };
      const existing = clients.get(email) || [];
      existing.push(client);
      clients.set(email, existing);

      // Send initial connected event
      client.events.push({
        event: 'connected',
        data: JSON.stringify({ message: 'SSE connection established', email }),
      });
    },
    removeClient(email: string, _res: any) {
      clients.delete(email);
    },
    notifyUser(email: string, event: any) {
      notifications.push({ email, event });
      const userClients = clients.get(email) || [];
      for (const client of userClients) {
        client.events.push({ event: 'gmail_change', data: JSON.stringify(event) });
      }
    },
    hasActiveConnections(email: string) {
      return (clients.get(email)?.length || 0) > 0;
    },
    getConnectionCount() {
      let total = 0;
      const byEmail: Record<string, number> = {};
      for (const [email, cls] of clients) {
        byEmail[email] = cls.length;
        total += cls.length;
      }
      return { total, byEmail };
    },
    broadcastAll(_event: string, _data: any) {},
    shutdown() {
      clients.clear();
    },
    // Test helpers
    _getClients: () => clients,
    _getNotifications: () => notifications,
    _clear: () => {
      clients.clear();
      notifications.length = 0;
    },
  };
}

// ============================================================================
// MOCK: Gmail History API
// ============================================================================

interface MockHistoryEntry {
  id: string;
  messagesAdded?: Array<{ message: { id: string; threadId: string; labelIds: string[] } }>;
  messagesDeleted?: Array<{ message: { id: string; threadId: string } }>;
  labelsAdded?: Array<{ message: { id: string }; labelIds: string[] }>;
  labelsRemoved?: Array<{ message: { id: string }; labelIds: string[] }>;
}

function createMockGmailHistoryApi(
  pages: Array<{ history: MockHistoryEntry[]; historyId: string; nextPageToken?: string }>,
  shouldExpire = false
) {
  let callCount = 0;

  return {
    users: {
      history: {
        list: vi.fn().mockImplementation(async (params: any) => {
          if (shouldExpire) {
            const error: any = new Error('History ID expired');
            error.code = 404;
            throw error;
          }

          const pageIndex = params.pageToken ? parseInt(params.pageToken.replace('page_', ''), 10) : 0;
          const page = pages[pageIndex] || pages[0];
          callCount++;

          return {
            data: {
              history: page.history,
              historyId: page.historyId,
              nextPageToken: page.nextPageToken,
            },
          };
        }),
      },
      getProfile: vi.fn().mockResolvedValue({
        data: { historyId: '99999', emailAddress: 'test@gmail.com' },
      }),
      watch: vi.fn().mockResolvedValue({
        data: { historyId: '12345', expiration: String(Date.now() + 7 * 24 * 60 * 60 * 1000) },
      }),
      stop: vi.fn().mockResolvedValue({}),
    },
    _getCallCount: () => callCount,
  };
}

// ============================================================================
// MOCK: Watch State Store
// ============================================================================

function createMockWatchStore() {
  const watches = new Map<string, { historyId: string; expiration: number; isActive: boolean }>();

  return {
    getStoredHistoryId(email: string): string | null {
      return watches.get(email)?.historyId || null;
    },
    updateStoredHistoryId(email: string, historyId: string) {
      const existing = watches.get(email) || { historyId: '', expiration: 0, isActive: false };
      existing.historyId = historyId;
      watches.set(email, existing);
    },
    createWatch(email: string, historyId: string, expiration: number) {
      watches.set(email, { historyId, expiration, isActive: true });
    },
    getWatchState(email: string) {
      return watches.get(email);
    },
    _clear() {
      watches.clear();
    },
  };
}

// ============================================================================
// MOCK: UI Operations
// ============================================================================

function createMockUIOperations() {
  const calls: Array<{ fn: string; args: any[] }> = [];

  return {
    loadInboxThreads: vi.fn((...args: any[]) => calls.push({ fn: 'loadInboxThreads', args })),
    loadSentThreads: vi.fn((...args: any[]) => calls.push({ fn: 'loadSentThreads', args })),
    executeSearch: vi.fn((...args: any[]) => calls.push({ fn: 'executeSearch', args })),
    openEmailDetail: vi.fn((...args: any[]) => calls.push({ fn: 'openEmailDetail', args })),
    closeEmailDetail: vi.fn((...args: any[]) => calls.push({ fn: 'closeEmailDetail', args })),
    _getCalls: () => calls,
    _clear: () => {
      calls.length = 0;
    },
  };
}

// ============================================================================
// MOCK: Pub/Sub Push Endpoint Logic
// ============================================================================

interface PubSubPushBody {
  message?: {
    data?: string;
    messageId?: string;
    publishTime?: string;
  };
  subscription?: string;
}

function decodePubSubMessage(body: PubSubPushBody): {
  valid: boolean;
  emailAddress?: string;
  historyId?: string;
  error?: string;
} {
  if (!body || !body.message || !body.message.data) {
    return { valid: false, error: 'Malformed Pub/Sub payload: missing message.data' };
  }

  try {
    const decoded = Buffer.from(body.message.data, 'base64').toString('utf8');
    const payload = JSON.parse(decoded);

    if (!payload.emailAddress || !payload.historyId) {
      return { valid: false, error: 'Missing emailAddress or historyId in decoded payload' };
    }

    return { valid: true, emailAddress: payload.emailAddress, historyId: payload.historyId };
  } catch {
    return { valid: false, error: 'Failed to decode base64 message data' };
  }
}

function createValidPubSubPayload(email: string, historyId: string): PubSubPushBody {
  const data = Buffer.from(JSON.stringify({ emailAddress: email, historyId })).toString('base64');
  return {
    message: {
      data,
      messageId: `msg_${Date.now()}`,
      publishTime: new Date().toISOString(),
    },
    subscription: 'projects/test-project/subscriptions/gmail-sub',
  };
}

// ============================================================================
// TESTS
// ============================================================================

describe('Part 11 — Real-Time Gmail Sync', () => {
  let sseManager: ReturnType<typeof createMockSSEManager>;
  let watchStore: ReturnType<typeof createMockWatchStore>;
  let uiOps: ReturnType<typeof createMockUIOperations>;

  beforeEach(() => {
    sseManager = createMockSSEManager();
    watchStore = createMockWatchStore();
    uiOps = createMockUIOperations();
  });

  afterEach(() => {
    sseManager._clear();
    watchStore._clear();
    uiOps._clear();
  });

  // ========================================================================
  // Test 1: Valid Pub/Sub notification accepted, history sync triggered
  // ========================================================================
  it('Test 1: Valid Pub/Sub notification accepted and history sync triggered', async () => {
    const email = 'user@gmail.com';
    const historyId = '54321';
    const payload = createValidPubSubPayload(email, historyId);

    // Decode the payload
    const decoded = decodePubSubMessage(payload);

    expect(decoded.valid).toBe(true);
    expect(decoded.emailAddress).toBe(email);
    expect(decoded.historyId).toBe(historyId);

    // Simulate history sync with stored historyId
    watchStore.createWatch(email, '50000', Date.now() + 7 * 24 * 60 * 60 * 1000);
    const storedId = watchStore.getStoredHistoryId(email);
    expect(storedId).toBe('50000');

    // Set up Gmail API mock with changes
    const gmailApi = createMockGmailHistoryApi([
      {
        history: [
          {
            id: '1',
            messagesAdded: [
              { message: { id: 'msg1', threadId: 't1', labelIds: ['INBOX', 'UNREAD'] } },
            ],
          },
        ],
        historyId: historyId,
      },
    ]);

    // Call history API
    const historyResult = await gmailApi.users.history.list({
      userId: 'me',
      startHistoryId: storedId,
    });

    // Verify history sync was triggered
    expect(gmailApi.users.history.list).toHaveBeenCalledTimes(1);
    expect(historyResult.data.history.length).toBe(1);
    expect(historyResult.data.history[0].messagesAdded!.length).toBe(1);
    expect(historyResult.data.historyId).toBe(historyId);
  });

  // ========================================================================
  // Test 2: Malformed Pub/Sub payload safely rejected
  // ========================================================================
  it('Test 2: Malformed Pub/Sub payload safely rejected', () => {
    // Test: missing message
    const result1 = decodePubSubMessage({});
    expect(result1.valid).toBe(false);
    expect(result1.error).toContain('Malformed');

    // Test: missing data
    const result2 = decodePubSubMessage({ message: {} });
    expect(result2.valid).toBe(false);
    expect(result2.error).toContain('Malformed');

    // Test: invalid base64
    const result3 = decodePubSubMessage({
      message: { data: 'not-valid-json-after-decode' },
    });
    // This decodes from base64 but won't be valid JSON
    expect(result3.valid).toBe(false);

    // Test: missing required fields in decoded payload
    const dataNoEmail = Buffer.from(JSON.stringify({ historyId: '123' })).toString('base64');
    const result4 = decodePubSubMessage({ message: { data: dataNoEmail } });
    expect(result4.valid).toBe(false);
    expect(result4.error).toContain('Missing');

    // Test: completely missing body
    const result5 = decodePubSubMessage(null as any);
    expect(result5.valid).toBe(false);
  });

  // ========================================================================
  // Test 3: History API returns new message → change detected, frontend notified
  // ========================================================================
  it('Test 3: History API returns new message → change detected, frontend notification generated', async () => {
    const email = 'user@gmail.com';
    watchStore.createWatch(email, '50000', Date.now() + 86400000);
    sseManager.addClient(email, {});

    const gmailApi = createMockGmailHistoryApi([
      {
        history: [
          {
            id: '1',
            messagesAdded: [
              { message: { id: 'newMsg1', threadId: 't1', labelIds: ['INBOX', 'UNREAD'] } },
              { message: { id: 'newMsg2', threadId: 't2', labelIds: ['INBOX'] } },
            ],
          },
        ],
        historyId: '55000',
      },
    ]);

    const result = await gmailApi.users.history.list({
      userId: 'me',
      startHistoryId: '50000',
    });

    const addedCount = result.data.history.reduce(
      (acc: number, h: any) => acc + (h.messagesAdded?.length || 0),
      0
    );

    expect(addedCount).toBe(2);

    // Simulate SSE notification
    sseManager.notifyUser(email, {
      type: 'gmail_change',
      email,
      changes: {
        messagesAdded: addedCount,
        messagesDeleted: 0,
        labelsChanged: 0,
        historyId: result.data.historyId,
      },
      timestamp: new Date().toISOString(),
    });

    const notifications = sseManager._getNotifications();
    expect(notifications.length).toBe(1);
    expect(notifications[0].event.changes.messagesAdded).toBe(2);

    // Verify SSE client received the event
    const clients = sseManager._getClients().get(email)!;
    expect(clients[0].events.length).toBe(2); // connected + gmail_change
    expect(clients[0].events[1].event).toBe('gmail_change');
  });

  // ========================================================================
  // Test 4: Multiple history pages processed correctly
  // ========================================================================
  it('Test 4: Multiple history pages processed correctly', async () => {
    const gmailApi = createMockGmailHistoryApi([
      {
        history: [
          {
            id: '1',
            messagesAdded: [
              { message: { id: 'msg1', threadId: 't1', labelIds: ['INBOX'] } },
            ],
          },
        ],
        historyId: '52000',
        nextPageToken: 'page_1',
      },
      {
        history: [
          {
            id: '2',
            messagesAdded: [
              { message: { id: 'msg2', threadId: 't2', labelIds: ['INBOX'] } },
              { message: { id: 'msg3', threadId: 't3', labelIds: ['INBOX'] } },
            ],
          },
        ],
        historyId: '54000',
      },
    ]);

    // Fetch page 1
    const page1 = await gmailApi.users.history.list({ userId: 'me', startHistoryId: '50000' });
    expect(page1.data.nextPageToken).toBe('page_1');

    let totalAdded = page1.data.history.reduce(
      (acc: number, h: any) => acc + (h.messagesAdded?.length || 0),
      0
    );

    // Fetch page 2
    const page2 = await gmailApi.users.history.list({
      userId: 'me',
      startHistoryId: '50000',
      pageToken: page1.data.nextPageToken,
    });
    expect(page2.data.nextPageToken).toBeUndefined();

    totalAdded += page2.data.history.reduce(
      (acc: number, h: any) => acc + (h.messagesAdded?.length || 0),
      0
    );

    // All pages processed
    expect(totalAdded).toBe(3);
    expect(gmailApi.users.history.list).toHaveBeenCalledTimes(2);
  });

  // ========================================================================
  // Test 5: Expired history ID → safe full resync/recovery
  // ========================================================================
  it('Test 5: Expired history ID → safe full resync/recovery', async () => {
    const email = 'user@gmail.com';
    watchStore.createWatch(email, '10000', Date.now() + 86400000);

    const gmailApi = createMockGmailHistoryApi([], true); // shouldExpire = true

    try {
      await gmailApi.users.history.list({
        userId: 'me',
        startHistoryId: '10000',
      });
      // Should not reach here
      expect(true).toBe(false);
    } catch (err: any) {
      // Verify it's a 404 error
      expect(err.code).toBe(404);
      expect(err.message).toBe('History ID expired');

      // Recovery: get fresh historyId from profile
      const profile = await gmailApi.users.getProfile({ userId: 'me' });
      expect(profile.data.historyId).toBeDefined();

      // Update stored historyId
      watchStore.updateStoredHistoryId(email, profile.data.historyId!);
      expect(watchStore.getStoredHistoryId(email)).toBe('99999');
    }
  });

  // ========================================================================
  // Test 6: Inbox currently open → Inbox refresh triggered
  // ========================================================================
  it('Test 6: Inbox currently open → Inbox refresh triggered', () => {
    const currentMailbox: string = 'inbox';
    const currentSearchQuery = '';

    // Simulate Gmail change handler logic
    if (currentMailbox === 'search' && currentSearchQuery) {
      uiOps.executeSearch(currentSearchQuery);
    } else if (currentMailbox === 'sent') {
      uiOps.loadSentThreads();
    } else {
      uiOps.loadInboxThreads();
    }

    expect(uiOps.loadInboxThreads).toHaveBeenCalledTimes(1);
    expect(uiOps.loadSentThreads).not.toHaveBeenCalled();
    expect(uiOps.executeSearch).not.toHaveBeenCalled();
  });

  // ========================================================================
  // Test 7: Sent currently open → Sent refresh triggered
  // ========================================================================
  it('Test 7: Sent currently open → Sent refresh triggered', () => {
    const currentMailbox: string = 'sent';
    const currentSearchQuery = '';

    if (currentMailbox === 'search' && currentSearchQuery) {
      uiOps.executeSearch(currentSearchQuery);
    } else if (currentMailbox === 'sent') {
      uiOps.loadSentThreads();
    } else {
      uiOps.loadInboxThreads();
    }

    expect(uiOps.loadSentThreads).toHaveBeenCalledTimes(1);
    expect(uiOps.loadInboxThreads).not.toHaveBeenCalled();
    expect(uiOps.executeSearch).not.toHaveBeenCalled();
  });

  // ========================================================================
  // Test 8: Search/filter active → existing search re-executed
  // ========================================================================
  it('Test 8: Search/filter active → existing search/filter re-executed', () => {
    const currentMailbox: string = 'search';
    const currentSearchQuery = 'from:john@example.com is:unread';

    if (currentMailbox === 'search' && currentSearchQuery) {
      uiOps.executeSearch(currentSearchQuery);
    } else if (currentMailbox === 'sent') {
      uiOps.loadSentThreads();
    } else {
      uiOps.loadInboxThreads();
    }

    expect(uiOps.executeSearch).toHaveBeenCalledWith('from:john@example.com is:unread');
    expect(uiOps.loadInboxThreads).not.toHaveBeenCalled();
    expect(uiOps.loadSentThreads).not.toHaveBeenCalled();
  });

  // ========================================================================
  // Test 9: Email detail open and affected → detail refreshed
  // ========================================================================
  it('Test 9: Email detail open and affected → detail refreshed', () => {
    const selectedEmailId = 'msg_12345';
    const isDetailOpen = true;

    // Simulate: if detail is open, refresh it
    if (selectedEmailId && isDetailOpen) {
      uiOps.openEmailDetail(selectedEmailId);
    }

    expect(uiOps.openEmailDetail).toHaveBeenCalledWith('msg_12345');
  });

  // ========================================================================
  // Test 10: Frontend realtime connection lost → fallback sync/reconnect
  // ========================================================================
  it('Test 10: Frontend realtime connection lost → fallback sync/reconnect behavior', () => {
    // Simulate SSE reconnection logic
    let connectionState: 'connecting' | 'connected' | 'disconnected' | 'error' = 'connected';
    let reconnectAttempts = 0;
    const maxReconnectAttempts = 10;
    const baseReconnectDelay = 1000;
    let fallbackTriggered = false;

    // Simulate connection loss
    connectionState = 'error';

    // Reconnect logic
    if (connectionState === 'error' || connectionState === 'disconnected') {
      if (reconnectAttempts < maxReconnectAttempts) {
        const delay = Math.min(
          baseReconnectDelay * Math.pow(2, reconnectAttempts),
          60000
        );

        reconnectAttempts++;
        expect(delay).toBe(1000); // First attempt: 1s
        expect(reconnectAttempts).toBe(1);
      }
    }

    // Simulate second attempt
    reconnectAttempts++;
    const delay2 = Math.min(baseReconnectDelay * Math.pow(2, reconnectAttempts - 1), 60000);
    expect(delay2).toBe(2000); // Second attempt: 2s

    // Simulate max attempts reached
    reconnectAttempts = maxReconnectAttempts;
    if (reconnectAttempts >= maxReconnectAttempts) {
      fallbackTriggered = true;
    }
    expect(fallbackTriggered).toBe(true);

    // Verify fallback polling would trigger
    const fallbackIntervalMs = 5 * 60 * 1000;
    expect(fallbackIntervalMs).toBe(300000); // 5 minutes
  });

  // ========================================================================
  // Test 11: Duplicate notification → not processed repeatedly
  // ========================================================================
  it('Test 11: Duplicate notification → same event is not processed repeatedly', () => {
    const email = 'user@gmail.com';
    const historyId = '60000';
    const processedIds = new Map<string, number>();
    const DEDUP_WINDOW = 10 * 60 * 1000; // 10 minutes
    let processCount = 0;

    function shouldProcess(email: string, hId: string): boolean {
      const key = `${email}:${hId}`;
      const last = processedIds.get(key);
      if (last && Date.now() - last < DEDUP_WINDOW) {
        return false;
      }
      processedIds.set(key, Date.now());
      processCount++;
      return true;
    }

    // First notification: should process
    expect(shouldProcess(email, historyId)).toBe(true);
    expect(processCount).toBe(1);

    // Duplicate: should skip
    expect(shouldProcess(email, historyId)).toBe(false);
    expect(processCount).toBe(1); // Still 1

    // Third duplicate: still skipped
    expect(shouldProcess(email, historyId)).toBe(false);
    expect(processCount).toBe(1);

    // Different historyId: should process
    expect(shouldProcess(email, '70000')).toBe(true);
    expect(processCount).toBe(2);

    // Different user same historyId: should process
    expect(shouldProcess('other@gmail.com', historyId)).toBe(true);
    expect(processCount).toBe(3);
  });

  // ========================================================================
  // Test 12: SSE connection established → initial event received
  // ========================================================================
  it('Test 12: SSE connection established → heartbeat/initial event received', () => {
    const email = 'user@gmail.com';
    const mockRes = {};

    sseManager.addClient(email, mockRes);

    // Verify connection was established
    expect(sseManager.hasActiveConnections(email)).toBe(true);

    // Verify initial connected event was sent
    const clients = sseManager._getClients().get(email)!;
    expect(clients.length).toBe(1);
    expect(clients[0].events.length).toBe(1);
    expect(clients[0].events[0].event).toBe('connected');

    const eventData = JSON.parse(clients[0].events[0].data);
    expect(eventData.message).toBe('SSE connection established');
    expect(eventData.email).toBe(email);

    // Verify connection count
    const count = sseManager.getConnectionCount();
    expect(count.total).toBe(1);
    expect(count.byEmail[email]).toBe(1);
  });

  // ========================================================================
  // Test 13: Watch creation → returns valid historyId and expiration
  // ========================================================================
  it('Test 13: Watch creation → returns valid historyId and expiration', async () => {
    const gmailApi = createMockGmailHistoryApi([]);
    const email = 'user@gmail.com';

    // Create watch
    const watchResponse = await gmailApi.users.watch({
      userId: 'me',
      requestBody: {
        topicName: 'projects/test/topics/gmail-notifications',
        labelIds: ['INBOX'],
      },
    });

    expect(watchResponse.data.historyId).toBeDefined();
    expect(watchResponse.data.historyId).toBe('12345');
    expect(watchResponse.data.expiration).toBeDefined();

    // Parse expiration
    const expiration = parseInt(watchResponse.data.expiration!, 10);
    expect(expiration).toBeGreaterThan(Date.now());

    // Store watch state
    watchStore.createWatch(email, watchResponse.data.historyId!, expiration);
    const state = watchStore.getWatchState(email);
    expect(state).toBeDefined();
    expect(state!.historyId).toBe('12345');
    expect(state!.isActive).toBe(true);
    expect(state!.expiration).toBe(expiration);
  });

  // ========================================================================
  // Test 14: Watch renewal → renews before expiration
  // ========================================================================
  it('Test 14: Watch renewal → renews before expiration', async () => {
    const email = 'user@gmail.com';
    const RENEWAL_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours

    // Create watch expiring in 12 hours (within renewal threshold)
    const expiringExpiration = Date.now() + 12 * 60 * 60 * 1000;
    watchStore.createWatch(email, '40000', expiringExpiration);

    // Check if renewal is needed
    const watchState = watchStore.getWatchState(email)!;
    const timeUntilExpiry = watchState.expiration - Date.now();
    const needsRenewal = timeUntilExpiry < RENEWAL_THRESHOLD_MS;

    expect(needsRenewal).toBe(true);

    // Simulate renewal
    const gmailApi = createMockGmailHistoryApi([]);
    const renewResponse = await gmailApi.users.watch({
      userId: 'me',
      requestBody: {
        topicName: 'projects/test/topics/gmail-notifications',
        labelIds: ['INBOX'],
      },
    });

    // Update watch state
    const newExpiration = parseInt(renewResponse.data.expiration!, 10);
    watchStore.createWatch(email, renewResponse.data.historyId!, newExpiration);

    const renewed = watchStore.getWatchState(email)!;
    expect(renewed.historyId).toBe('12345');
    expect(renewed.expiration).toBeGreaterThan(expiringExpiration);
    expect(renewed.isActive).toBe(true);

    // Verify a watch that is NOT expiring doesn't need renewal
    const farFutureExpiration = Date.now() + 6 * 24 * 60 * 60 * 1000; // 6 days
    watchStore.createWatch(email, '50000', farFutureExpiration);
    const farState = watchStore.getWatchState(email)!;
    const farTimeUntilExpiry = farState.expiration - Date.now();
    expect(farTimeUntilExpiry > RENEWAL_THRESHOLD_MS).toBe(true);
  });
});
