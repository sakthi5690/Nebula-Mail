/**
 * Gmail Real-Time Sync Client
 *
 * Connects to the backend SSE endpoint to receive real-time Gmail change notifications.
 * Provides automatic reconnection, fallback polling, and tab-focus refresh.
 *
 * Features:
 * - EventSource (SSE) connection with auto-reconnect and exponential backoff
 * - Fallback periodic sync check (every 5 minutes)
 * - Browser tab visibility change detection (refresh on focus)
 * - Typed event callbacks for Gmail changes
 * - Connection state tracking
 */

export interface GmailChangeData {
  type: 'gmail_change';
  email: string;
  changes: {
    messagesAdded: number;
    messagesDeleted: number;
    labelsChanged: number;
    historyId: string;
  };
  timestamp: string;
}

export type GmailChangeCallback = (change: GmailChangeData) => void;
export type ConnectionStateCallback = (state: 'connecting' | 'connected' | 'disconnected' | 'error') => void;

export class GmailRealtimeSync {
  private eventSource: EventSource | null = null;
  private changeCallbacks: GmailChangeCallback[] = [];
  private connectionStateCallbacks: ConnectionStateCallback[] = [];
  private connectionState: 'connecting' | 'connected' | 'disconnected' | 'error' = 'disconnected';

  // Reconnection state
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private baseReconnectDelay = 1000; // 1 second
  private maxReconnectDelay = 60000; // 60 seconds
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  // Fallback polling
  private fallbackInterval: ReturnType<typeof setInterval> | null = null;
  private static readonly FALLBACK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

  // Tab visibility
  private visibilityHandler: (() => void) | null = null;
  private lastRefreshTimestamp = 0;
  private static readonly MIN_REFRESH_GAP_MS = 10_000; // 10 seconds min between refreshes

  private baseUrl: string;

  constructor(baseUrl: string = '/api') {
    this.baseUrl = baseUrl;
  }

  /**
   * Start the real-time sync connection.
   * Connects to SSE endpoint and sets up fallback mechanisms.
   */
  public connect(): void {
    this.connectSSE();
    this.startFallbackPolling();
    this.setupVisibilityHandler();
  }

  /**
   * Disconnect and clean up all resources.
   */
  public disconnect(): void {
    this.disconnectSSE();
    this.stopFallbackPolling();
    this.removeVisibilityHandler();

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /**
   * Register a callback for Gmail change events.
   */
  public onGmailChange(callback: GmailChangeCallback): () => void {
    this.changeCallbacks.push(callback);
    return () => {
      this.changeCallbacks = this.changeCallbacks.filter((cb) => cb !== callback);
    };
  }

  /**
   * Register a callback for connection state changes.
   */
  public onConnectionStateChange(callback: ConnectionStateCallback): () => void {
    this.connectionStateCallbacks.push(callback);
    return () => {
      this.connectionStateCallbacks = this.connectionStateCallbacks.filter((cb) => cb !== callback);
    };
  }

  /**
   * Get the current connection state.
   */
  public getConnectionState(): string {
    return this.connectionState;
  }

  /**
   * Force a manual sync check by calling the backend status endpoint.
   * Useful as a fallback when SSE is unavailable.
   */
  public async checkSyncStatus(): Promise<boolean> {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const connectedEmail = sessionStorage.getItem('stitch_gmail_connected_email');
      if (connectedEmail) {
        headers['x-user-email'] = connectedEmail;
      }

      const res = await fetch(`${this.baseUrl}/gmail/sync/status`, {
        headers,
        credentials: 'include',
      });

      if (!res.ok) return false;

      const status = await res.json();
      return status.realtimeEnabled || false;
    } catch {
      return false;
    }
  }

  // ============================================================================
  // SSE Connection Management
  // ============================================================================

  private connectSSE(): void {
    if (this.eventSource) {
      this.disconnectSSE();
    }

    const connectedEmail = sessionStorage.getItem('stitch_gmail_connected_email');
    if (!connectedEmail) {
      console.log('[Realtime Sync] No connected email, skipping SSE connection');
      return;
    }

    this.updateConnectionState('connecting');

    // Build SSE URL with user email header workaround
    // EventSource doesn't support custom headers, so we use query params as fallback
    const sseUrl = `${this.baseUrl}/gmail/sync/events`;

    try {
      this.eventSource = new EventSource(sseUrl, { withCredentials: true });

      this.eventSource.addEventListener('connected', (event: MessageEvent) => {
        console.log('[Realtime Sync] SSE connected:', event.data);
        this.reconnectAttempts = 0;
        this.updateConnectionState('connected');
      });

      this.eventSource.addEventListener('gmail_change', (event: MessageEvent) => {
        try {
          const changeData: GmailChangeData = JSON.parse(event.data);
          console.log('[Realtime Sync] Gmail change received:', changeData);
          this.notifyChangeCallbacks(changeData);
        } catch (err) {
          console.warn('[Realtime Sync] Failed to parse gmail_change event:', err);
        }
      });

      this.eventSource.addEventListener('server_shutdown', () => {
        console.log('[Realtime Sync] Server shutdown notification received');
        this.updateConnectionState('disconnected');
      });

      this.eventSource.onerror = () => {
        console.warn('[Realtime Sync] SSE connection error');
        this.updateConnectionState('error');
        this.disconnectSSE();
        this.scheduleReconnect();
      };
    } catch (err) {
      console.warn('[Realtime Sync] Failed to create EventSource:', err);
      this.updateConnectionState('error');
      this.scheduleReconnect();
    }
  }

  private disconnectSSE(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.warn('[Realtime Sync] Max reconnect attempts reached, relying on fallback polling');
      this.updateConnectionState('disconnected');
      return;
    }

    // Exponential backoff with jitter
    const delay = Math.min(
      this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts) + Math.random() * 1000,
      this.maxReconnectDelay
    );

    this.reconnectAttempts++;
    console.log(
      `[Realtime Sync] Reconnecting in ${Math.round(delay / 1000)}s (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`
    );

    this.reconnectTimer = setTimeout(() => {
      this.connectSSE();
    }, delay);
  }

  // ============================================================================
  // Fallback Polling
  // ============================================================================

  private startFallbackPolling(): void {
    if (this.fallbackInterval) return;

    this.fallbackInterval = setInterval(() => {
      // Only poll if SSE is not connected
      if (this.connectionState !== 'connected') {
        console.log('[Realtime Sync] Fallback poll: triggering sync check');
        this.triggerFallbackRefresh();
      }
    }, GmailRealtimeSync.FALLBACK_INTERVAL_MS);
  }

  private stopFallbackPolling(): void {
    if (this.fallbackInterval) {
      clearInterval(this.fallbackInterval);
      this.fallbackInterval = null;
    }
  }

  private triggerFallbackRefresh(): void {
    const now = Date.now();
    if (now - this.lastRefreshTimestamp < GmailRealtimeSync.MIN_REFRESH_GAP_MS) {
      return; // Throttle refreshes
    }

    this.lastRefreshTimestamp = now;

    // Emit a synthetic change event to trigger UI refresh
    const syntheticChange: GmailChangeData = {
      type: 'gmail_change',
      email: sessionStorage.getItem('stitch_gmail_connected_email') || '',
      changes: {
        messagesAdded: -1, // -1 signals a general refresh
        messagesDeleted: 0,
        labelsChanged: 0,
        historyId: 'fallback',
      },
      timestamp: new Date().toISOString(),
    };

    this.notifyChangeCallbacks(syntheticChange);
  }

  // ============================================================================
  // Tab Visibility Handler
  // ============================================================================

  private setupVisibilityHandler(): void {
    this.visibilityHandler = () => {
      if (document.visibilityState === 'visible') {
        console.log('[Realtime Sync] Tab became visible, checking for updates');

        // Reconnect SSE if disconnected
        if (this.connectionState !== 'connected' && this.connectionState !== 'connecting') {
          this.reconnectAttempts = 0; // Reset reconnect counter
          this.connectSSE();
        }

        // Trigger a refresh
        this.triggerFallbackRefresh();
      }
    };

    document.addEventListener('visibilitychange', this.visibilityHandler);
  }

  private removeVisibilityHandler(): void {
    if (this.visibilityHandler) {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
      this.visibilityHandler = null;
    }
  }

  // ============================================================================
  // Internal Helpers
  // ============================================================================

  private updateConnectionState(state: 'connecting' | 'connected' | 'disconnected' | 'error'): void {
    this.connectionState = state;
    for (const cb of this.connectionStateCallbacks) {
      try {
        cb(state);
      } catch {
        // Ignore callback errors
      }
    }
  }

  private notifyChangeCallbacks(change: GmailChangeData): void {
    for (const cb of this.changeCallbacks) {
      try {
        cb(change);
      } catch (err) {
        console.warn('[Realtime Sync] Error in change callback:', err);
      }
    }
  }
}

// Singleton instance
export const gmailRealtimeSync = new GmailRealtimeSync();
