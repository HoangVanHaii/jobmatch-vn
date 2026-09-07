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
 * POST /conversations/:id/messages — REST sync fallback cho socket.
 *
 * Authz (member-only) + persist + broadcast realtime xem
 * [controller/message.ts:send](src/controller/message.ts). Content validation
 * (empty + max-length) làm inline trong controller để đồng nhất với socket
 * handler `chat:message`. Tái sử dụng helpers từ
 * [socket/chatBroadcast.ts](src/socket/chatBroadcast.ts) để DRY với socket path.
 */
messageRouter.post('/conversations/:id/messages', messageController.send);