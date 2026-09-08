/**
 * Message controller — nhận request (đã auth ở middleware) → gọi service → trả response.
 * Pattern: try/catch + next(err); response { success, data }.
 */
import { Request, Response, NextFunction } from 'express';
import { Server as IOServer } from 'socket.io';
import { chatService } from '../service/chat.service';
import { broadcastMessageReceived, notifyPeerIfNotInRoom } from '../socket/chatBroadcast';
import { AppError } from '../middleware/errorHandler';
import { logger } from '../config/logger';
import type {
  ListConversationsQuery,
  ListMessagesQuery,
  ListAttachmentsQuery,
  SendMessageBody,
} from '../interface/chat';

export const messageController = {
  /**
   * POST /conversations
   * Body: { peerUserId: string }
   * Trả về conversation (cũ nếu tồn tại, mới nếu chưa có).
   *
   * Migration 0034: 2-user unique, bỏ jobId. Endpoint backward-compatible —
   * FE cũ vẫn truyền jobId, BE ignore (Zod schema strict trên unknown → throw).
   * Trong transition, FE sẽ update call sites bỏ jobId.
   */
  create: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { peerUserId } = req.body as {
        peerUserId: string;
      };
      const conv = await chatService.createOrGet(
        req.user!.userId,
        peerUserId,
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

  /**
   * GET /conversations/:id/attachments?kind=image|file
   * Tất cả ảnh + file trong 1 conversation (load all, không paginate).
   * Filter optional theo `kind`. Authz: chỉ member mới đọc được (giống listMessages).
   */
  listAttachments: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id: conversationId } = req.params as { id: string };
      const query = req.query as unknown as ListAttachmentsQuery;
      const result = await chatService.listAttachments(
        conversationId,
        req.user!.userId,
        query,
      );
      res.json({ success: true, data: result });
    } catch (err) {
      console.error('[message.listAttachments] error:', {
        params: req.params,
        query: req.query,
        err,
      });
      next(err);
    }
  },

  /**
   * POST /conversations/:id/messages — REST sync fallback cho socket.
   *
   * Được dùng bởi mini composer ở JobDetailView (không cần socket connected)
   * và làm fallback nếu socket emit fail. Flow giống `chat:message` socket:
   *
   *   1. Validate body (`content`, optional `tempId`).
   *   2. assertMemberAndGetConv — authz + resolve `conv`.
   *   3. saveMessage — INSERT + UPDATE conversation (last_message_at/preview).
   *   4. broadcastMessageReceived — emit `chat:message` + `chat:new` qua cùng
   *      helper socket dùng → DRY.
   *   5. notifyPeerIfNotInRoom — INSERT notification nếu peer không ở room.
   *
   * Response trả `data` = ChatMessageRow (echo cho caller update optimistic UI).
   *
   * Lưu ý: chỉ trả về khi broadcast xong — nếu socket fail vẫn return success
   * (DB đã lưu, peer sẽ nhận qua `chat:new` socket + notification).
   */
  send: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const { id: conversationId } = req.params as { id: string };
      const body = req.body as SendMessageBody;
      const content = (body?.content ?? '').trim();
      // Cho phép gửi file-only: content rỗng OK nếu có attachments.
      const hasAttachments = Array.isArray(body?.attachments) && body!.attachments!.length > 0;
      if (!content && !hasAttachments) {
        res.status(400).json({
          success: false,
          error: { code: 'INVALID_PAYLOAD', message: 'Cần content hoặc attachments' },
        });
        return;
      }
      if (content.length > 5000) {
        res.status(400).json({
          success: false,
          error: { code: 'CONTENT_TOO_LONG', message: 'Tin nhắn quá dài (tối đa 5000 ký tự)' },
        });
        return;
      }

      const { conv } = await chatService.assertMemberAndGetConv(conversationId, userId);

      const { message, attachments } = await chatService.saveMessage(
        { conversationId, content, tempId: body.tempId, attachments: body.attachments },
        userId,
      );

      // Realtime broadcast — cùng logic với socket handler.
      const io = req.app.get('io') as IOServer | undefined;
      if (io) {
        const { peerId } = broadcastMessageReceived(
          io,
          conv,
          message,
          userId,
          body.tempId,
          attachments,
        );
        // Không await — chỉ là best-effort, lỗi chỉ log.
        void notifyPeerIfNotInRoom(io, conversationId, peerId, message).catch((err) =>
          logger.error({ err }, 'chat notify failed'),
        );
      }

      res.status(201).json({
        success: true,
        data: {
          id: message.id,
          conversationId,
          senderId: userId,
          content: message.content,
          readAt: null,
          // createdAt có defaultNow().notNull() ở schema → runtime luôn có.
          // TS mark optional vì derive từ $inferInsert; cast để tránh `?? new Date()`.
          createdAt: message.createdAt!.toISOString(),
          metadata: null,
          tempId: body.tempId,
          attachments: attachments.length > 0 ? attachments : undefined,
        },
      });
    } catch (err) {
      console.error('[message.send] error:', {
        params: req.params,
        body: req.body,
        err,
      });
      next(err);
    }
  },

  /**
   * DELETE /conversations/:id — per-user soft delete.
   *
   * User A "xoá" conv với B → A không thấy conv trong sidebar/list, không thể
   * mở lại qua URL (404), không thể gửi tin nhắn mới qua socket. Peer B
   * KHÔNG bị ảnh hưởng — họ vẫn thấy conv bình thường, vẫn đọc được lịch sử.
   *
   * Authz: phải là userA hoặc userB. Check ownership inline (KHÔNG dùng
   * `assertMemberAndGetConv` vì nó có soft-delete gate → sẽ block idempotent
   * re-delete từ user đã xoá trước đó). Endpoint này idempotent — gọi nhiều
   * lần vẫn 200 OK.
   */
  delete: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const conversationId = req.params.id as string;

      // Ownership check — KHÔNG bao gồm soft-delete gate.
      const conv = await chatService.getById(conversationId);
      if (conv.userA !== userId && conv.userB !== userId) {
        throw new AppError(403, 'NOT_MEMBER', 'Bạn không thuộc cuộc hội thoại này');
      }

      await chatService.softDeleteConversation(userId, conversationId);
      res.json({ success: true });
    } catch (err) {
      console.error('[message.delete] error:', {
        params: req.params,
        err,
      });
      next(err);
    }
  },
};