import { Request, Response, NextFunction } from 'express';
import { once } from 'events';
import { chatbotService } from '../service/chatbot.service';
import { logger } from '../config/logger';
import { AppError } from '../middleware/errorHandler';
import type { AttachedJobItem, AttachedCvItem } from '../lib/llm/chatbot';

const sendJson = (res: Response, status: number, payload: unknown) => {
  res.status(status).json(payload);
};

const ok = (res: Response, data: unknown) => sendJson(res, 200, { success: true, data });

export const chatbotController = {
  createSession: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.userId;
      const title = (req.body as { title?: string }).title ?? null;
      const session = await chatbotService.createSession(userId, title);
      return sendJson(res, 201, { success: true, data: session });
    } catch (err) {
      next(err);
    }
  },

  listSessions: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.userId;
      const limit = Number(req.query.limit ?? 20);
      const sessions = await chatbotService.listSessions(userId, limit);
      return ok(res, sessions);
    } catch (err) {
      next(err);
    }
  },

  getSession: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.userId;
      const session = await chatbotService.getSession(req.params.id as string, userId);
      if (!session) throw new AppError(404, 'NOT_FOUND', 'Session không tồn tại hoặc không thuộc bạn.');
      return ok(res, session);
    } catch (err) {
      next(err);
    }
  },

  patchContext: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.userId;
      const body = req.body as { jobIds: string[]; cvIds: string[] };
      console.log(body);
      const session = await chatbotService.patchContext(req.params.id as string, userId, body);
      if (!session) throw new AppError(404, 'NOT_FOUND', 'Session không tồn tại hoặc không thuộc bạn.');
      return ok(res, session);
    } catch (err) {
      next(err);
    }
  },

  resetContext: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.userId;
      const session = await chatbotService.resetContext(req.params.id as string, userId);
      if (!session) throw new AppError(404, 'NOT_FOUND', 'Session không tồn tại hoặc không thuộc bạn.');
      return ok(res, session);
    } catch (err) {
      next(err);
    }
  },

  /**
   * DELETE /chatbot/sessions/:id — xóa 1 session của user.
   * Trả { id } để client xác nhận, hoặc 404 nếu không tồn tại / không thuộc user.
   */
  deleteSession: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.userId;
      const deleted = await chatbotService.deleteSession(req.params.id as string, userId);
      if (!deleted) throw new AppError(404, 'NOT_FOUND', 'Session không tồn tại hoặc không thuộc bạn.');
      return ok(res, { id: req.params.id });
    } catch (err) {
      next(err);
    }
  },

  /**
   * PATCH /chatbot/sessions/:id — đổi title phiên chat.
   * Body: { title: string (1..200) }.
   * Trả về session đã update, hoặc 404 nếu không thuộc user.
   */
  updateSession: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.userId;
      const body = req.body as { title: string };
      const session = await chatbotService.updateSessionTitle(
        req.params.id as string,
        userId,
        body.title,
      );
      if (!session) throw new AppError(404, 'NOT_FOUND', 'Session không tồn tại hoặc không thuộc bạn.');
      return ok(res, session);
    } catch (err) {
      next(err);
    }
  },

  listJobsPicker: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.userId;
      const source = (req.query.source as 'all' | 'saved' | 'applied') ?? 'all';
      const q = (req.query.q as string | undefined) ?? undefined;
      const limit = Number(req.query.limit ?? 20);
      const jobs = await chatbotService.listJobsPicker(userId, source, q, limit);
      return ok(res, jobs);
    } catch (err) {
      next(err);
    }
  },

  listCvsPicker: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.userId;
      const cvs = await chatbotService.listCvsPicker(userId);
      return ok(res, cvs);
    } catch (err) {
      next(err);
    }
  },

  /**
   * POST /chatbot/sessions/:id/turn — SSE streaming turn.
   */
  streamTurn: async (req: Request, res: Response, next: NextFunction) => {
    // Validate trước khi set headers (errors phải trả JSON, không phải SSE)
    const userId = req.user!.userId;
    const body = req.body as {
      message: string;
      jobIds?: string[];
      cvIds?: string[];
      attachedJobs?: unknown[];
      attachedCvs?: unknown[];
    };
    const message = body.message;
    const jobIds = body.jobIds ?? [];
    const cvIds = body.cvIds ?? [];
    const attachedJobs = (body.attachedJobs ?? []) as AttachedJobItem[];
    const attachedCvs = (body.attachedCvs ?? []) as AttachedCvItem[];
    if (!message?.trim()) {
      return next(new AppError(400, 'EMPTY_MESSAGE', 'Câu hỏi không được rỗng.'));
    }

    // Headers + handshake
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // SSE retry hint (preamble)
    res.write('retry: 10000\n\n');

    // Heartbeat
    const heartbeat = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {
        clearInterval(heartbeat);
      }
    }, 15_000);

    // Abort signal khi client disconnect
    const ac = new AbortController();
    const onClose = () => {
      ac.abort();
      clearInterval(heartbeat);
    };
    req.on('close', onClose);

    const writeEvent = async (data: string): Promise<void> => {
      if (ac.signal.aborted || res.writableEnded || res.destroyed) return;
      let ok: boolean;
      try {
        ok = res.write(`data: ${data}\n\n`);
      } catch {
        // res.write throws khi socket đã destroy
        ac.abort();
        return;
      }
      if (!ok && !ac.signal.aborted) {
        try {
          await once(res, 'drain');
        } catch {
          // 'drain' không bao giờ fire trên closed socket → ignore
        }
      }
    };

    try {
      const sessionId = req.params.id as string;
      const stream = chatbotService.streamTurn(
        sessionId,
        userId,
        message.trim(),
        jobIds,
        cvIds,
        attachedJobs,
        attachedCvs,
        ac.signal,
      );
      for await (const item of stream) {
        if (ac.signal.aborted) break;
        if ('chunk' in item) {
          await writeEvent(JSON.stringify({ chunk: item.chunk }));
          continue;
        }
        // event
        const e = item.event;
        await writeEvent(JSON.stringify(e));
        // terminal events → break loop
        if (
          e.type === 'done' ||
          e.type === 'budget_exceeded' ||
          e.type === 'error' ||
          e.type === 'busy' ||
          e.type === 'aborted'
        ) {
          break;
        }
      }
    } catch (err) {
      logger.error({ err, sessionId: req.params.id as string }, '[chatbot.streamTurn] crashed');
      try {
        await writeEvent(
          JSON.stringify({ type: 'error', code: 'STREAM_FAILED', message: 'Có lỗi không mong muốn.' }),
        );
      } catch {
        // ignore — socket có thể đã đóng
      }
    } finally {
      clearInterval(heartbeat);
      req.off('close', onClose);
      try {
        res.write('data: [DONE]\n\n');
      } catch {
        // ignore
      }
      res.end();
    }
  },
};
