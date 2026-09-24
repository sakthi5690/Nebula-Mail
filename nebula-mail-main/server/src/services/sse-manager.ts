/**
 * Server-Sent Events (SSE) Manager
 *
 * Manages real-time SSE connections between the Express backend and frontend clients.
 * Events are scoped by user email — one user's Gmail updates are never sent to another user.
 *
 * Features:
 * - Multi-session support (multiple tabs/devices per user)
 * - Heartbeat mechanism to keep connections alive (every 30s)
 * - Automatic cleanup of dead connections
 * - Typed event emission
 */

import type { Response } from 'express';

export interface GmailChangeEvent {
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

export interface SSEEvent {
  event: string;
  data: string;
  id?: string;
}

interface SSEClient {
  res: Response;
  email: string;
  connectedAt: number;
  lastHeartbeat: number;
}

class SSEManager {
  private clients: Map<string, SSEClient[]> = new Map();
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private static readonly HEARTBEAT_INTERVAL_MS = 30_000; // 30 seconds
  private static readonly CLIENT_TIMEOUT_MS = 120_000; // 2 minutes without heartbeat ack

  constructor() {
    this.startHeartbeat();
  }

  /**
   * Register a new SSE client connection for a user email.
   * Sets up proper SSE headers and sends initial connection event.
   */
  public addClient(email: string, res: Response): void {
    // Set SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
    });

    // Send initial connection event
    this.sendToResponse(res, {
      event: 'connected',
      data: JSON.stringify({
        message: 'SSE connection established',
        email,
        timestamp: new Date().toISOString(),
      }),
    });

    const client: SSEClient = {
      res,
      email,
      connectedAt: Date.now(),
      lastHeartbeat: Date.now(),
    };

    const existing = this.clients.get(email) || [];
    existing.push(client);
    this.clients.set(email, existing);

    console.log(`[SSE Manager] Client connected for ${email}. Total connections: ${existing.length}`);

    // Handle client disconnect
    res.on('close', () => {
      this.removeClient(email, res);
    });
  }

  /**
   * Remove a specific client connection.
   */
  public removeClient(email: string, res: Response): void {
    const clients = this.clients.get(email);
    if (!clients) return;

    const filtered = clients.filter((c) => c.res !== res);
    if (filtered.length === 0) {
      this.clients.delete(email);
    } else {
      this.clients.set(email, filtered);
    }

    console.log(
      `[SSE Manager] Client disconnected for ${email}. Remaining connections: ${filtered.length}`
    );
  }

  /**
   * Send a Gmail change notification to all connections for a specific user email.
   * Multi-session safe: only the targeted user receives the event.
   */
  public notifyUser(email: string, changeEvent: GmailChangeEvent): void {
    const clients = this.clients.get(email);
    if (!clients || clients.length === 0) {
      console.log(`[SSE Manager] No active connections for ${email}, notification skipped`);
      return;
    }

    const sseEvent: SSEEvent = {
      event: 'gmail_change',
      data: JSON.stringify(changeEvent),
      id: `${changeEvent.changes.historyId}_${Date.now()}`,
    };

    let deliveredCount = 0;
    const deadClients: Response[] = [];

    for (const client of clients) {
      try {
        this.sendToResponse(client.res, sseEvent);
        deliveredCount++;
      } catch {
        deadClients.push(client.res);
      }
    }

    // Cleanup dead connections
    for (const deadRes of deadClients) {
      this.removeClient(email, deadRes);
    }

    console.log(
      `[SSE Manager] Notified ${deliveredCount}/${clients.length} clients for ${email} (historyId: ${changeEvent.changes.historyId})`
    );
  }

  /**
   * Broadcast a generic event to all connected clients (e.g., server shutdown notice).
   */
  public broadcastAll(event: string, data: Record<string, unknown>): void {
    for (const [_email, clients] of this.clients) {
      for (const client of clients) {
        try {
          this.sendToResponse(client.res, {
            event,
            data: JSON.stringify(data),
          });
        } catch {
          // Dead connection — will be cleaned on next heartbeat
        }
      }
    }
  }

  /**
   * Get the number of active connections (for monitoring/status).
   */
  public getConnectionCount(): { total: number; byEmail: Record<string, number> } {
    const byEmail: Record<string, number> = {};
    let total = 0;

    for (const [email, clients] of this.clients) {
      byEmail[email] = clients.length;
      total += clients.length;
    }

    return { total, byEmail };
  }

  /**
   * Check if a user has any active SSE connections.
   */
  public hasActiveConnections(email: string): boolean {
    const clients = this.clients.get(email);
    return Boolean(clients && clients.length > 0);
  }

  /**
   * Start the heartbeat interval to keep connections alive and clean up dead ones.
   */
  private startHeartbeat(): void {
    if (this.heartbeatInterval) return;

    this.heartbeatInterval = setInterval(() => {
      const now = Date.now();
      const deadClients: Array<{ email: string; res: Response }> = [];

      for (const [email, clients] of this.clients) {
        for (const client of clients) {
          // Check if connection is too old without activity
          if (now - client.lastHeartbeat > SSEManager.CLIENT_TIMEOUT_MS) {
            deadClients.push({ email, res: client.res });
            continue;
          }

          // Send heartbeat
          try {
            client.res.write(': heartbeat\n\n');
            client.lastHeartbeat = now;
          } catch {
            deadClients.push({ email, res: client.res });
          }
        }
      }

      // Clean up dead connections
      for (const { email, res } of deadClients) {
        this.removeClient(email, res);
        try {
          res.end();
        } catch {
          // Already closed
        }
      }
    }, SSEManager.HEARTBEAT_INTERVAL_MS);

    // Don't prevent process exit
    if (this.heartbeatInterval.unref) {
      this.heartbeatInterval.unref();
    }
  }

  /**
   * Stop the heartbeat and close all connections (for graceful shutdown).
   */
  public shutdown(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    this.broadcastAll('server_shutdown', { message: 'Server is shutting down' });

    for (const [_email, clients] of this.clients) {
      for (const client of clients) {
        try {
          client.res.end();
        } catch {
          // Already closed
        }
      }
    }

    this.clients.clear();
  }

  /**
   * Write a properly formatted SSE event to a response stream.
   */
  private sendToResponse(res: Response, event: SSEEvent): void {
    let message = '';
    if (event.id) {
      message += `id: ${event.id}\n`;
    }
    message += `event: ${event.event}\n`;
    message += `data: ${event.data}\n\n`;

    res.write(message);
    // Flush if available (for compression middleware)
    if (typeof (res as any).flush === 'function') {
      (res as any).flush();
    }
  }
}

// Singleton instance
export const sseManager = new SSEManager();
