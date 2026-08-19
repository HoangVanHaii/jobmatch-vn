/**
 * Message controller — nhận request (đã auth ở middleware) → gọi service → trả response.
 * Pattern: try/catch + next(err); response { success, data }.
 */
import { Request, Response, NextFunction } from 'express';
import { chatService } from '../service/chat.service';
import type {
  ListConversationsQuery,
  ListMessagesQuery,
} from '../interface/chat';

export const messageController = {
  /**
   * POST /conversations
   * Body: { peerUserId: string, jobId?: string | null }
   * Trả về conversation (cũ nếu tồn tại, mới nếu chưa có).
   */
  create: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { peerUserId, jobId } = req.body as {
        peerUserId: string;
        jobId?: string | null;
      };
      const conv = await chatService.createOrGet(
        req.user!.userId,
        peerUserId,
        jobId,
      );
      res.status(201).json({ success: true, data: conv });
    } catch (err) {
      console.error('[message.create] error:', { body: req.body, err });
      next(err);
    }
  },

  /**
   * GET /conversations?cursor=&limit=
   * List conversations của current user, kèm peer + unread count.
   */
  list: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = req.query as unknown as ListConversationsQuery;
      const result = await chatService.list(req.user!.userId, query);
      res.json({ success: true, data: result });
    } catch (err) {
      console.error('[message.list] error:', { query: req.query, err });
      next(err);
    }
  },

  /**
   * GET /conversations/:id/messages?cursor=&limit=
   * Authz: chỉ member mới đọc được.
   */
  listMessages: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id: conversationId } = req.params as { id: string };
      const query = req.query as unknown as ListMessagesQuery;
      const result = await chatService.listMessages(
        conversationId,
        req.user!.userId,
        query,
      );
      res.json({ success: true, data: result });
    } catch (err) {
      console.error('[message.listMessages] error:', {
        params: req.params,
        query: req.query,
        err,
      });
      next(err);
    }
  },
};