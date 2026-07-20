/**
 * JobMatch VN — Backend Entry
 * Express + Socket.IO + Workers + graceful shutdown
 */
import 'dotenv/config';
import http from 'http';
import { createApp } from './src/app';
import { logger } from './src/config/logger';
import { setupSocket } from './src/socket';
import { connectDatabase, disconnectDatabase } from './src/config/database';
import { disconnectRedis } from './src/config/redis';
import { startWorkers } from './src/jobs';

const PORT = parseInt(process.env.PORT || '5000', 10);

const bootstrap = async (): Promise<void> => {
  await connectDatabase();
  startWorkers();

  const app = createApp();
  const server = http.createServer(app);
  setupSocket(server);

  server.listen(PORT, () => {
    logger.info({ port: PORT, env: process.env.NODE_ENV }, `🚀 JobMatch VN API listening on http://localhost:${PORT}`);
  });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down gracefully');
    server.close(async () => {
      await disconnectDatabase();
      await disconnectRedis();
      logger.info('All connections closed');
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'Uncaught exception');
    void shutdown('uncaughtException');
  });
  process.on('unhandledRejection', (reason) => {
    logger.fatal({ reason }, 'Unhandled rejection');
  });
};

bootstrap().catch((err) => {
  logger.fatal({ err }, 'Bootstrap failed');
  process.exit(1);
});