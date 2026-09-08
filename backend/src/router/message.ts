import { Router } from 'express';
import { auth } from '../middleware/auth';
import { messageController } from '../controller/message';

export const messageRouter = Router();
messageRouter.use(auth);
// Mount tại /api/v1/messages
messageRouter.post('/conversations', messageController.create);
messageRouter.get('/conversations', messageController.list);
messageRouter.get('/conversations/:id/messages', messageController.listMessages);
/**
 * GET /conversations/:id/attachments?kind=image|file
 * List toàn bộ ảnh + file trong conversation (load all, không paginate).
 * Filter optional theo kind. Dùng cho side panel "Ảnh & File" ở FE — group
 * by date ở client. Authz: member-only (check trong service).
 */
messageRouter.get('/conversations/:id/attachments', messageController.listAttachments);
/**
 * POST /conversations/:id/messages — REST sync fallback cho socket.
 *
 * Authz (member-only) + persist + broadcast realtime xem
 * [controller/message.ts:send](src/controller/message.ts). Content validation
 * (empty + max-length) làm inline trong controller để đồng nhất với socket
 * handler `chat:message`. Tái sử dụng helpers từ
 * [socket/chatBroadcast.ts](src/socket/chatBroadcast.ts) để DRY với socket path.
 */
messageRouter.post('/conversations/:id/messages', messageController.send);
/**
 * DELETE /conversations/:id — per-user soft delete. User tự xoá khỏi sidebar
 * của mình, KHÔNG ảnh hưởng peer. Xem [controller/message.ts:delete](src/controller/message.ts)
 * để biết lý do không dùng `assertMemberAndGetConv` (cần idempotent).
 */
messageRouter.delete('/conversations/:id', messageController.delete);