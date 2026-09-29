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
import { verifyMail } from './src/config/mail';
import { startWorkers } from './src/jobs';

const PORT = parseInt(process.env.PORT || '5000', 10);

const bootstrap = async (): Promise<void> => {
  await connectDatabase();
  await verifyMail();
  startWorkers();

  const app = createApp();
  const server = http.createServer(app);
  const io = setupSocket(server);
  /**
   * Expose `io` qua `app.get('io')` để controller REST có thể broadcast
   * realtime (vd `POST /conversations/:id/messages` chạy mini composer).
   * Trước đây chỉ socket handler mới emit được; giờ REST path cùng share
   * helper `broadcastMessageReceived` từ `src/socket/chatBroadcast.ts`.
   */
  app.set('io', io);

  server.listen(PORT, () => {
    logger.info({ port: PORT, env: process.env.NODE_ENV }, `JobMatch VN API listening on http://localhost:${PORT}`);
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

  /**
   * DOH-1 FIX: An toàn hoá 2 handler cuối cùng.
   *
   * Vấn đề trước fix:
   *   - `uncaughtException` handler: gọi `void shutdown(...)` — async function
   *     chạy nền không await. Nếu shutdown() throw (vd disconnectDatabase fail
   *     khi connection đã đứt), promise không ai catch → tiếp tục unhandledRejection.
   *   - `unhandledRejection` handler: chỉ gọi logger.fatal mà KHÔNG bọc try/catch.
   *     Nếu logger throw (vd pino không serialize được reason có circular ref
   *     hoặc non-serializable object) → chính handler throw → escalate thành
   *     uncaughtException → process.exit.
   *
   *   Node.js v15+ default `--unhandled-rejections=throw` → process exit code 1
   *   nếu handler không chặn được. Một exception handler không an toàn làm
   *   crash BE trong khi đáng lẽ chỉ nên log warning.
   *
   * Giải pháp:
   *   1. Wrap toàn bộ logic trong try/catch lồng nhau.
   *   2. Fallback về console.error nếu logger fail (luôn hoạt động).
   *   3. KHÔNG gọi process.exit từ handler này — để Node xử lý graceful shutdown
   *      riêng (chỉ log, vẫn tiếp tục accept request nếu có thể).
   *   4. uncaughtException riêng: vẫn gọi shutdown nhưng BỌC trong try/catch
   *      để nếu shutdown throw thì console.error chứ không recursive crash.
   */
  process.on('uncaughtException', (err) => {
    try {
      logger.fatal({ err }, 'Uncaught exception');
    } catch (logErr) {
      // logger throw — fallback console để không bị mất log hoàn toàn.
      try {
        console.error('[uncaughtException] logger failed:', logErr);
        console.error('[uncaughtException] original error:', err);
      } catch {
        // Tuyệt vọng: console.error cũng throw (gần như không thể).
        // Không làm gì thêm, để Node default behavior xử lý.
      }
    }
    // Trigger graceful shutdown NGOÀI try/catch để nếu shutdown throw
    // cũng không ảnh hưởng phần logging.
    try {
      void shutdown('uncaughtException');
    } catch {
      // shutdown không được await, errors bên trong sẽ vào unhandledRejection.
      // Không cần làm gì thêm ở đây.
    }
  });

  process.on('unhandledRejection', (reason) => {
    try {
      logger.fatal({ reason }, 'Unhandled rejection');
    } catch (logErr) {
      try {
        console.error('[unhandledRejection] logger failed:', logErr);
        console.error('[unhandledRejection] original reason:', reason);
      } catch {
        // ignore
      }
    }
    // QUAN TRỌNG: KHÔNG gọi process.exit ở đây.
    // Node v22: nếu handler register và không throw → process KHÔNG exit (override
    // default `--unhandled-rejections=throw`). Cho phép BE tiếp tục phục vụ
    // request, đồng thời có log để investigate sau.
    //
    // Nếu cần shutdown thật sự, nên qua uncaughtException (sau khi handler
    // log unhandled rejection, có thể tiếp tục xảy ra exception khác sẽ
    // trigger uncaughtException → shutdown).
  });
};

bootstrap().catch((err) => {
  logger.fatal({ err }, 'Bootstrap failed');
  process.exit(1);
});