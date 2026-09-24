import dotenv from 'dotenv';
// Load environment variables from .env.local or .env immediately before other imports
dotenv.config({ path: '.env.local' });
dotenv.config();

import express, { Request, Response } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import authRoutes from './routes/auth.routes';
import gmailRoutes from './routes/gmail.routes';
import { aiRouter } from './routes/ai.routes';
import { pubsubRouter, syncRouter } from './routes/sync.routes';
import { startWatchRenewalScheduler } from './services/gmail-watch.service';
import { sseManager } from './services/sse-manager';
const app = express();
const PORT = process.env.PORT || process.env.SERVER_PORT || 3001;

// Middleware
app.use(
  cors({
    origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
    credentials: true,
  })
);
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/**
 * Health-Check Endpoint
 * GET /api/health
 */
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'stitch-mail-backend',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
  });
});

// Mount Routes
app.use('/api/auth', authRoutes);
app.use('/api/gmail', gmailRoutes);
app.use('/api/ai', aiRouter);

// Real-Time Sync Routes
app.use('/api/gmail/pubsub', pubsubRouter);
app.use('/api/gmail/sync', syncRouter);

// Global Error Handler
app.use((err: Error, _req: Request, res: Response, _next: express.NextFunction) => {
  console.error('Unhandled server error:', err);
  res.status(500).json({
    error: 'Internal Server Error',
    message: err.message,
  });
});

export function startServer(port: number | string = PORT) {
  const server = app.listen(port, () => {
    console.log(`🚀 Stitch Mail Backend listening on http://localhost:${port}`);
    console.log(`👉 Health Check: http://localhost:${port}/api/health`);
    console.log(`👉 OAuth Auth URL: http://localhost:${port}/api/auth/google`);
    console.log(`👉 OAuth Callback: http://localhost:${port}/api/auth/callback/google`);
    console.log(`👉 SSE Events: http://localhost:${port}/api/gmail/sync/events`);
    console.log(`👉 Pub/Sub Push: http://localhost:${port}/api/gmail/pubsub/push`);

    // Start the Gmail watch renewal scheduler
    startWatchRenewalScheduler();
  });

  // Graceful shutdown
  const gracefulShutdown = () => {
    console.log('\n🛑 Shutting down gracefully...');
    sseManager.shutdown();
    server.close(() => {
      console.log('Server closed.');
      process.exit(0);
    });
  };

  process.on('SIGTERM', gracefulShutdown);
  process.on('SIGINT', gracefulShutdown);

  return server;
}

// Auto-start if executed directly
if (process.env.NODE_ENV !== 'test') {
  startServer();
}

export default app;
