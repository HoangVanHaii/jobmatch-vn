/**
 * Express App — testable, không gọi listen()
 */
import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import { apiRouter } from './router';
import { errorHandler } from './middleware/errorHandler';
import { rateLimiter } from './middleware/rateLimit';
import { logger } from './config/logger';

export const createApp = (): Application => {
  const app = express();

  // Trust proxy nếu chạy sau Nginx/Cloudflare
  app.set('trust proxy', 1);

  // Security
  app.use(helmet());
  app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true,
  }));

  // Body parsers
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

  // Compression + logging
  app.use(compression());
  app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev', {
    stream: { write: (msg) => logger.info(msg.trim()) },
  }));

  // Rate limit
  app.use(rateLimiter);

  // Health check
  app.get('/health', (_req, res) => res.json({ status: 'ok', uptime: process.uptime() }));
  app.get('/ready', (_req, res) => res.json({ status: 'ready' }));

  // API routes
  app.use('/api/v1', apiRouter);

  // 404
  app.use((req, res) => {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: `Route ${req.path} not found` } });
  });

  // Global error handler
  app.use(errorHandler);

  return app;
};