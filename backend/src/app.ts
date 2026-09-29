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

  // Trust proxy — phải khớp với deployment thực tế.
  //
  // Audit 2026-09-28 follow-up (X-01 FIX): trước đây hardcode `1` → server nghe
  // trực tiếp (không sau proxy thật) vẫn trust XFF → client set
  // `X-Forwarded-For: 9.9.9.9` được coi là IP, tạo bucket rate limit mới → bypass
  // hoàn toàn per-IP rate limit (login brute-force, OTP email-bomb, ...).
  //
  // Sau fix: chỉ trust proxy khi env TRUST_PROXY được set với giá trị hợp lệ.
  // Express `trust proxy` nhận: boolean (true/false), number, string IP, string CIDR,
  // string 'loopback', hoặc array các giá trị trên.
  //
  // Chấp nhận env values:
  //   - "true"       → boolean true
  //   - "false"      → boolean false
  //   - "1"          → number 1 (trust 1 hop)
  //   - "loopback"   → string 'loopback' (trust localhost proxies)
  //   - "10.0.0.0/8" → CIDR string
  //   - "1.2.3.4"    → single IP string
  //   - multiple comma-separated values passed as array
  //
  // Lưu ý production deploy phải set TRUST_PROXY đúng topology (vd 'loopback'
  // nếu chỉ nginx local, '10.0.0.0/8' cho private network).
  {
    const raw = process.env.TRUST_PROXY;
    if (raw === undefined) {
      // Default: không trust XFF (an toàn cho local dev).
      app.set('trust proxy', false);
    } else if (raw === 'true') {
      app.set('trust proxy', true);
    } else if (raw === 'false') {
      app.set('trust proxy', false);
    } else if (/^\d+$/.test(raw)) {
      // Number (số hop trust)
      app.set('trust proxy', parseInt(raw, 10));
    } else {
      // String: IP, CIDR, 'loopback', or comma-separated list
      const parts = raw.split(',').map(s => s.trim()).filter(Boolean);
      app.set('trust proxy', parts.length === 1 ? parts[0] : parts);
    }
  }

  // Security — disable X-Frame-Options để iframe có thể nhúng file PDF/ảnh
  // từ MinIO (cross-origin). CORS ở dưới vẫn bảo vệ API.
  app.use(helmet({ frameguard: false }));
  app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true,
    /**
     * Cache preflight 24h (mặc định cors package chỉ 5s).
     * Vì API không đổi CORS headers thường xuyên → cache lâu giúp giảm 1 round-trip
     * OPTIONS cho mỗi nhóm request cùng signature.
     */
    maxAge: 86400,
  }));

  // Audit 2026-09-28 (Cache-Control fix): set `Cache-Control: no-store` cho
  // TẤT CẢ response dưới `/api/v1/auth/*` để chặn browser/proxy cache response
  // chứa token (login, refresh, OAuth callback), pendingToken OAuth, OTP message,
  // hoặc bất kỳ data auth nhạy cảm nào.
  //
  // ĐẶT TRƯỚC `express.json()` để đảm bảo header đã được set TRƯỚC khi body
  // parser chạy. Nếu đặt sau, khi client gửi malformed JSON → express.json()
  // throw error NGAY LẬP TỨC → middleware này không bao giờ được gọi → error
  // response trả về thiếu Cache-Control header.
  //
  // Chỉ scope vào `/api/v1/auth/*` thay vì all `/api/v1/*` để:
  //   - Không ảnh hưởng các endpoint cacheable khác (vd: job list public).
  //   - Đúng nguyên tắc least-privilege — chỉ chặn cache ở nơi cần.
  //
  // Headers:
  //   - `Cache-Control: no-store, no-cache, must-revalidate, private`
  //     → no-store: tuyệt đối không lưu cache ở bất kỳ tầng nào.
  //     → no-cache + must-revalidate: phải validate với origin trước khi dùng cache.
  //     → private: không cho shared cache (CDN, proxy) lưu.
  //   - `Pragma: no-cache` — backward compat với HTTP/1.0 cache.
  //   - `Expires: 0` — backward compat cho cache cũ.
  app.use('/api/v1/auth', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    next();
  });

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