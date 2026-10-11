import { describe, it, expect, beforeAll, beforeEach, afterAll, jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { AppError, errorHandler } from '../src/middleware/errorHandler';
import { notificationRouter } from '../src/router/notification';
import { notificationService, escapeLikePattern } from '../src/service/notification.service';
import { buildNotificationMessage } from '../src/service/notificationMessage.builder';
import { db } from '../src/config/database';
import {
  interviewService,
  notifyScheduled,
  notifyUpdated,
  notifyCancelled,
  formatVietnamDateTime,
  formatCancelReasonSnippet,
} from '../src/service/interview.service';
import {
  notifyCandidateOfMatchResult,
  notifyEmployerOfNewApplication,
  notifyEmployerOfWithdrawal,
} from '../src/service/application.service';
import {
  buildInviteNotification,
  buildCompanyNotification,
} from '../src/service/companyMember.service';
import { notifyPeerIfNotInRoom } from '../src/socket/chatBroadcast';
import { notificationGateway } from '../src/socket/notificationGateway';

// Mock ESM packages for Jest CommonJS runtime
jest.mock('@octokit/rest', () => ({
  Octokit: jest.fn(),
}));

jest.mock('../src/config/redis', () => ({
  redis: {
    call: jest.fn(),
    status: 'ready',
    on: jest.fn(),
    quit: jest.fn().mockResolvedValue('OK'),
    disconnect: jest.fn(),
  },
}));

jest.mock('../src/middleware/rateLimit', () => {
  const pass = (_req: any, _res: any, next: any) => next();
  return new Proxy({}, {
    get: () => pass,
  });
});

// Mock auth middleware trước khi router dùng nó
jest.mock('../src/middleware/auth', () => ({
  auth: (req: any, _res: any, next: any) => {
    // Cho phép test override userId qua header 'x-test-user-id'
    req.user = {
      userId: req.headers['x-test-user-id'] || '11111111-1111-4111-8111-111111111111',
      role: req.headers['x-test-user-role'] || 'employer',
    };
    next();
  },
  adminOnly: (req: any, _res: any, next: any) => {
    if (req.user?.role !== 'admin') {
      return next(new AppError(403, 'FORBIDDEN', 'Bạn không có quyền thực hiện thao tác này'));
    }
    next();
  },
  candidateOnly: (_req: any, _res: any, next: any) => next(),
  employerOnly: (_req: any, _res: any, next: any) => next(),
  candidateOrEmployer: (_req: any, _res: any, next: any) => next(),
  optionalAuth: (_req: any, _res: any, next: any) => next(),
}));

// Mock logger để tránh in rác ra stdout khi test lỗi 500
jest.mock('../src/config/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// Mock notificationGateway để không phụ thuộc Redis / Socket.IO
jest.mock('../src/socket/notificationGateway', () => ({
  notificationGateway: {
    emitToUser: jest.fn(),
  },
}));

describe('Backend Notification Endpoints & Service Suite', () => {
  let app: express.Express;

  const USER_A_ID = '11111111-1111-4111-8111-111111111111';
  const USER_B_ID = '22222222-2222-4222-8222-222222222222';
  const VALID_NOTIF_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/v1/notifications', notificationRouter);
    app.use(errorHandler);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // Tắt console.error trong controller khi test các case cố tình throw error
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  describe('1. PATCH /api/v1/notifications/:id/read', () => {
    it('Đánh dấu đã đọc thành công cho thông báo của chính user (User A)', async () => {
      const mockUpdated = {
        id: VALID_NOTIF_ID,
        userId: USER_A_ID,
        type: 'application_new',
        title: 'Đơn ứng tuyển mới',
        payload: {},
        readAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };

      const markSpy = jest
        .spyOn(notificationService, 'markRead')
        .mockResolvedValueOnce(mockUpdated as any);

      const res = await request(app)
        .patch(`/api/v1/notifications/${VALID_NOTIF_ID}/read`)
        .set('x-test-user-id', USER_A_ID);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(VALID_NOTIF_ID);
      expect(res.body.data.readAt).toBeDefined();
      expect(markSpy).toHaveBeenCalledWith(VALID_NOTIF_ID, USER_A_ID);
    });

    it('Data isolation: User A không thể đọc hoặc sửa thông báo của User B (404 NOTIFICATION_NOT_FOUND)', async () => {
      // Khi User A cố mark notification thuộc về User B, service trả về null
      // vì query filter cả `id` và `userId`
      jest.spyOn(notificationService, 'markRead').mockResolvedValueOnce(null);

      const res = await request(app)
        .patch(`/api/v1/notifications/${VALID_NOTIF_ID}/read`)
        .set('x-test-user-id', USER_A_ID);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('NOTIFICATION_NOT_FOUND');
    });

    it('Trả về 404 khi thông báo không tồn tại trong hệ thống', async () => {
      jest.spyOn(notificationService, 'markRead').mockResolvedValueOnce(null);

      const res = await request(app)
        .patch(`/api/v1/notifications/${VALID_NOTIF_ID}/read`)
        .set('x-test-user-id', USER_A_ID);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOTIFICATION_NOT_FOUND');
    });

    it('Trả về 400 VALIDATION_ERROR khi param ID không phải UUID hợp lệ', async () => {
      const res = await request(app)
        .patch('/api/v1/notifications/invalid-not-uuid/read')
        .set('x-test-user-id', USER_A_ID);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('Xử lý lỗi database khi gọi markRead (chuyển qua error handler 500, không crash)', async () => {
      jest
        .spyOn(notificationService, 'markRead')
        .mockRejectedValueOnce(new Error('PostgreSQL connection timeout'));

      const res = await request(app)
        .patch(`/api/v1/notifications/${VALID_NOTIF_ID}/read`)
        .set('x-test-user-id', USER_A_ID);

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('2. PATCH /api/v1/notifications/read-all', () => {
    it('Đánh dấu tất cả thông báo của chính user là đã đọc thành công', async () => {
      const mockUpdatedRows = [
        { id: '1', userId: USER_A_ID, readAt: new Date() },
        { id: '2', userId: USER_A_ID, readAt: new Date() },
      ];

      const markAllSpy = jest
        .spyOn(notificationService, 'markAllRead')
        .mockResolvedValueOnce(mockUpdatedRows as any);

      const res = await request(app)
        .patch('/api/v1/notifications/read-all')
        .set('x-test-user-id', USER_A_ID);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.count).toBe(2);
      expect(markAllSpy).toHaveBeenCalledWith(USER_A_ID);
    });

    it('Chỉ đánh dấu thông báo của chính user, không ảnh hưởng user khác', async () => {
      const markAllSpy = jest
        .spyOn(notificationService, 'markAllRead')
        .mockResolvedValueOnce([]);

      const res = await request(app)
        .patch('/api/v1/notifications/read-all')
        .set('x-test-user-id', USER_B_ID);

      expect(res.status).toBe(200);
      expect(res.body.data.count).toBe(0);
      expect(markAllSpy).toHaveBeenCalledWith(USER_B_ID);
    });

    it('Xử lý lỗi database khi markAllRead thất bại', async () => {
      jest
        .spyOn(notificationService, 'markAllRead')
        .mockRejectedValueOnce(new Error('DB deadlock detected'));

      const res = await request(app)
        .patch('/api/v1/notifications/read-all')
        .set('x-test-user-id', USER_A_ID);

      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('2b. DELETE /api/v1/notifications/:id', () => {
    it('Xóa thành công trả về 200 { success: true, data: { id, totalUnread } }', async () => {
      const removeSpy = jest
        .spyOn(notificationService, 'remove')
        .mockResolvedValueOnce({ id: VALID_NOTIF_ID, totalUnread: 3 });

      const res = await request(app)
        .delete(`/api/v1/notifications/${VALID_NOTIF_ID}`)
        .set('x-test-user-id', USER_A_ID);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual({ id: VALID_NOTIF_ID, totalUnread: 3 });
      expect(removeSpy).toHaveBeenCalledWith(VALID_NOTIF_ID, USER_A_ID);
    });

    it('Data isolation & Not found: sai user hoặc không tồn tại trả về 404 NOTIFICATION_NOT_FOUND', async () => {
      jest.spyOn(notificationService, 'remove').mockResolvedValueOnce(null);

      const res = await request(app)
        .delete(`/api/v1/notifications/${VALID_NOTIF_ID}`)
        .set('x-test-user-id', USER_A_ID);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('NOTIFICATION_NOT_FOUND');
    });

    it('ID không phải UUID hợp lệ trả về 400 VALIDATION_ERROR', async () => {
      const res = await request(app)
        .delete('/api/v1/notifications/not-a-valid-uuid')
        .set('x-test-user-id', USER_A_ID);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('notificationService.remove: xóa database thành công thì emit socket notification:deleted đúng user', async () => {
      const emitSpy = jest.spyOn(notificationGateway, 'emitToUser').mockImplementation(() => {});
      const getUnreadSpy = jest.spyOn(notificationService, 'getUnreadCount').mockResolvedValueOnce(2);

      // Mock db.delete
      const returningMock = jest.fn().mockResolvedValueOnce([{ id: VALID_NOTIF_ID, readAt: null }]);
      const whereMock = jest.fn().mockReturnValue({ returning: returningMock });
      jest.spyOn(db, 'delete').mockReturnValueOnce({ where: whereMock } as any);

      const result = await notificationService.remove(VALID_NOTIF_ID, USER_A_ID);

      expect(result).toEqual({ id: VALID_NOTIF_ID, totalUnread: 2 });
      expect(getUnreadSpy).toHaveBeenCalledWith(USER_A_ID);
      expect(emitSpy).toHaveBeenCalledWith(USER_A_ID, 'notification:deleted', { id: VALID_NOTIF_ID });
    });
  });

  describe('3. GET /api/v1/notifications & Filter unread', () => {
    it('Filter unread=true: parse query string boolean và truyền vào service đúng', async () => {
      const listSpy = jest.spyOn(notificationService, 'list').mockResolvedValueOnce({
        items: [],
        nextCursor: null,
        totalUnread: 0,
      } as any);

      const res = await request(app)
        .get('/api/v1/notifications?unread=true')
        .set('x-test-user-id', USER_A_ID);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(listSpy).toHaveBeenCalledWith(
        USER_A_ID,
        expect.objectContaining({ unread: true, limit: 20 })
      );
    });

    it('Filter unread=false: parse query string boolean và truyền vào service đúng', async () => {
      const listSpy = jest.spyOn(notificationService, 'list').mockResolvedValueOnce({
        items: [],
        nextCursor: null,
        totalUnread: 0,
      } as any);

      const res = await request(app)
        .get('/api/v1/notifications?unread=false')
        .set('x-test-user-id', USER_A_ID);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(listSpy).toHaveBeenCalledWith(
        USER_A_ID,
        expect.objectContaining({ unread: false, limit: 20 })
      );
    });

    it('Không truyền filter unread: unread là undefined, lấy tất cả thông báo', async () => {
      const listSpy = jest.spyOn(notificationService, 'list').mockResolvedValueOnce({
        items: [],
        nextCursor: null,
        totalUnread: 5,
      } as any);

      const res = await request(app)
        .get('/api/v1/notifications')
        .set('x-test-user-id', USER_A_ID);

      expect(res.status).toBe(200);
      expect(res.body.data.totalUnread).toBe(5);
      const queryPassed = (listSpy.mock.calls[0] as any)[1];
      expect(queryPassed.unread).toBeUndefined();
      expect(queryPassed.limit).toBe(20);
    });

    it('Filter search: parse query string search và truyền vào service đúng', async () => {
      const listSpy = jest.spyOn(notificationService, 'list').mockResolvedValueOnce({
        items: [],
        nextCursor: null,
        totalUnread: 0,
      } as any);

      const res = await request(app)
        .get('/api/v1/notifications?search=Frontend')
        .set('x-test-user-id', USER_A_ID);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(listSpy).toHaveBeenCalledWith(
        USER_A_ID,
        expect.objectContaining({ search: 'Frontend', limit: 20 })
      );
    });

    it('Truyền unread không hợp lệ: validate middleware từ chối với 400 VALIDATION_ERROR', async () => {
      const res = await request(app)
        .get('/api/v1/notifications?unread=maybe')
        .set('x-test-user-id', USER_A_ID);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('Xử lý lỗi database khi list notifications thất bại', async () => {
      jest
        .spyOn(notificationService, 'list')
        .mockRejectedValueOnce(new Error('Connection lost'));

      const res = await request(app)
        .get('/api/v1/notifications')
        .set('x-test-user-id', USER_A_ID);

      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('INTERNAL_ERROR');
    });

    it('GET /api/v1/notifications/unread-count: lấy số lượng chưa đọc thành công', async () => {
      jest.spyOn(notificationService, 'getUnreadCount').mockResolvedValueOnce(5);

      const res = await request(app)
        .get('/api/v1/notifications/unread-count')
        .set('x-test-user-id', USER_A_ID);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.unreadCount).toBe(5);
    });

    it('GET /api/v1/notifications/unread-count: xử lý lỗi khi DB getUnreadCount fail', async () => {
      jest.spyOn(notificationService, 'getUnreadCount').mockRejectedValueOnce(new Error('DB Timeout'));

      const res = await request(app)
        .get('/api/v1/notifications/unread-count')
        .set('x-test-user-id', USER_A_ID);

      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('4. Notification Service Unit Tests (Cursor & SQL Logic)', () => {
    it('decodeCursor ném 400 INVALID_CURSOR khi cursor không phải base64url hợp lệ', async () => {
      await expect(
        notificationService.list(USER_A_ID, {
          limit: 10,
          cursor: 'invalid-base64url-!@#$%',
        })
      ).rejects.toMatchObject({
        statusCode: 400,
        code: 'INVALID_CURSOR',
      });
    });

    it('decodeCursor ném 400 INVALID_CURSOR khi payload cursor thiếu trường id hoặc uuid sai format', async () => {
      const invalidPayload = Buffer.from(
        JSON.stringify({ createdAt: new Date().toISOString(), id: 'not-a-uuid' })
      ).toString('base64url');

      await expect(
        notificationService.list(USER_A_ID, {
          limit: 10,
          cursor: invalidPayload,
        })
      ).rejects.toMatchObject({
        statusCode: 400,
        code: 'INVALID_CURSOR',
      });
    });
  });

  describe('5. buildNotificationMessage & escapeLikePattern Unit Tests', () => {
    it('escapeLikePattern escape đúng các ký tự %, _, \\', () => {
      expect(escapeLikePattern('test%value_with\\slash')).toBe('test\\%value\\_with\\\\slash');
      expect(escapeLikePattern('100%_success')).toBe('100\\%\\_success');
      expect(escapeLikePattern('normal-text')).toBe('normal-text');
    });

    it('buildNotificationMessage ưu tiên payload.summary hoặc payload.message nếu có', () => {
      expect(
        buildNotificationMessage('application_new', { summary: 'Tóm tắt tùy chỉnh từ payload' })
      ).toBe('Tóm tắt tùy chỉnh từ payload');

      expect(
        buildNotificationMessage('application_new', { message: 'Tin nhắn tùy chỉnh từ payload' })
      ).toBe('Tin nhắn tùy chỉnh từ payload');
    });

    it('buildNotificationMessage không bao giờ bị lặp từ "vị trí vị trí" hoặc "Ứng viên Ứng viên"', () => {
      const msg = buildNotificationMessage('application_new', {
        candidateName: 'Ứng viên Trần Văn Nam',
        jobTitle: 'Vị trí Senior React Developer',
      });
      expect(msg).toBe('Hồ sơ mới từ Trần Văn Nam ứng tuyển vị trí Senior React Developer');
      expect(msg.includes('vị trí vị trí')).toBe(false);
      expect(msg.includes('Ứng viên Ứng viên')).toBe(false);

      const msgWithdraw = buildNotificationMessage('application_withdrawn', {
        candidateName: 'Ứng viên Trần Văn Nam',
        jobTitle: 'Vị trí Senior React Developer',
      });
      expect(msgWithdraw).toBe('Ứng viên Trần Văn Nam đã rút hồ sơ ứng tuyển vị trí Senior React Developer');
      expect(msgWithdraw.includes('vị trí vị trí')).toBe(false);
      expect(msgWithdraw.includes('Ứng viên Ứng viên')).toBe(false);
    });

    it('Mỗi type có 2 ca (đủ payload, thiếu payload) và không dùng chuỗi mặc định chung chung', () => {
      // 1. application_new
      expect(
        buildNotificationMessage('application_new', {
          candidateName: 'Nguyễn Văn A',
          jobTitle: 'Kỹ sư Frontend',
        })
      ).toBe('Hồ sơ mới từ Nguyễn Văn A ứng tuyển vị trí Kỹ sư Frontend');
      expect(buildNotificationMessage('application_new', {})).toBe('Hồ sơ ứng tuyển mới');

      // 2. application_withdrawn
      expect(
        buildNotificationMessage('application_withdrawn', {
          candidateName: 'Trần Thị B',
          jobTitle: 'Kỹ sư Backend',
        })
      ).toBe('Ứng viên Trần Thị B đã rút hồ sơ ứng tuyển vị trí Kỹ sư Backend');
      expect(buildNotificationMessage('application_withdrawn', {})).toBe('Hồ sơ ứng tuyển đã được rút');

      // 3. application_match_ready
      expect(
        buildNotificationMessage('application_match_ready', {
          jobTitle: 'DevOps Engineer',
          matchPercent: 92,
        })
      ).toBe('AI Matching đã chấm 92% độ phù hợp cho vị trí DevOps Engineer');
      expect(
        buildNotificationMessage('application_match_ready', {
          jobTitle: 'DevOps Engineer',
          matchPercent: null,
        })
      ).toBe('Hồ sơ ứng tuyển đã được ghi nhận, đánh giá AI Matching sẽ được cập nhật sau cho vị trí DevOps Engineer');
      expect(buildNotificationMessage('application_match_ready', {})).toBe(
        'Hồ sơ ứng tuyển đã được ghi nhận, đánh giá AI Matching sẽ được cập nhật sau'
      );

      // 4. interview_scheduled
      expect(
        buildNotificationMessage('interview_scheduled', {
          jobTitle: 'Product Manager',
        })
      ).toBe('Lịch phỏng vấn mới đã được thiết lập cho vị trí Product Manager');
      expect(buildNotificationMessage('interview_scheduled', {})).toBe('Lịch phỏng vấn mới đã được thiết lập');

      // 5. interview_updated
      expect(
        buildNotificationMessage('interview_updated', {
          jobTitle: 'Product Manager',
        })
      ).toBe('Lịch phỏng vấn cho vị trí Product Manager đã được cập nhật');
      expect(buildNotificationMessage('interview_updated', {})).toBe('Lịch phỏng vấn đã được cập nhật');

      // 6. interview_cancelled
      // 6a. Ứng viên từ chối (gửi HR)
      expect(
        buildNotificationMessage('interview_cancelled', {
          candidateName: 'Nguyễn Văn A',
          jobTitle: 'Product Manager',
        })
      ).toBe('Ứng viên Nguyễn Văn A đã từ chối lịch phỏng vấn cho vị trí Product Manager');
      // 6b. HR huỷ (gửi ứng viên)
      expect(
        buildNotificationMessage('interview_cancelled', {
          jobTitle: 'Product Manager',
        })
      ).toBe('Lịch phỏng vấn cho vị trí Product Manager đã bị huỷ');
      // 6c. Thiếu cả hai
      expect(buildNotificationMessage('interview_cancelled', {})).toBe('Lịch phỏng vấn đã bị huỷ');

      // 7. reference_verified: confirmed true vs false ra 2 câu khác biệt rõ ràng
      expect(
        buildNotificationMessage('reference_verified', {
          refereeName: 'Nguyễn Quản Lý',
          jobTitle: 'Tech Lead',
          confirmed: true,
        })
      ).toBe('Nguyễn Quản Lý đã xác nhận tham chiếu cho vị trí Tech Lead');

      expect(
        buildNotificationMessage('reference_verified', {
          refereeName: 'Nguyễn Quản Lý',
          jobTitle: 'Tech Lead',
          confirmed: false,
        })
      ).toBe('Nguyễn Quản Lý đã từ chối xác nhận tham chiếu cho vị trí Tech Lead');

      expect(
        buildNotificationMessage('reference_verified', { confirmed: true })
      ).toBe('Tham chiếu đã được xác nhận');

      expect(
        buildNotificationMessage('reference_verified', { confirmed: false })
      ).toBe('Tham chiếu đã bị từ chối');

      // 8. company
      expect(
        buildNotificationMessage('company', {
          kind: 'company_invite_sent',
          companyName: 'FPT Software',
        })
      ).toBe('Lời mời tham gia công ty FPT Software');
      expect(
        buildNotificationMessage('company', { kind: 'company_invite_sent' })
      ).toBe('Lời mời tham gia công ty');
      expect(
        buildNotificationMessage('company', {
          kind: 'company_invite_accepted',
          companyName: 'FPT Software',
        })
      ).toBe('Thành viên đã chấp nhận lời mời tham gia FPT Software');
      expect(
        buildNotificationMessage('company', { kind: 'company_invite_accepted' })
      ).toBe('Thành viên đã chấp nhận lời mời tham gia công ty');
      expect(
        buildNotificationMessage('company', {
          kind: 'removed_from_company',
          companyName: 'FPT Software',
        })
      ).toBe('Bạn đã bị xoá khỏi danh sách thành viên của FPT Software');
      expect(
        buildNotificationMessage('company', { kind: 'removed_from_company' })
      ).toBe('Bạn đã bị xoá khỏi danh sách thành viên của công ty');
      // Kinds không nhận ra -> fallbackTitle
      expect(
        buildNotificationMessage(
          'company',
          { kind: 'invite_cancelled', companyName: 'FPT Software' },
          'Lời mời đã bị huỷ'
        )
      ).toBe('Lời mời đã bị huỷ');
      expect(
        buildNotificationMessage(
          'company',
          { kind: 'company_member_left' },
          'Thành viên đã rời công ty'
        )
      ).toBe('Thành viên đã rời công ty');
      expect(
        buildNotificationMessage(
          'company',
          { kind: 'company_owner_transferred' },
          'Chuyển quyền sở hữu'
        )
      ).toBe('Chuyển quyền sở hữu');
      expect(
        buildNotificationMessage(
          'company',
          { kind: 'company_invite_auto_cancelled' },
          'Tự động huỷ lời mời'
        )
      ).toBe('Tự động huỷ lời mời');

      // 9. job_match
      expect(
        buildNotificationMessage('job_match', { jobTitle: 'Data Analyst' })
      ).toBe('Gợi ý hồ sơ tiềm năng phù hợp tiêu chí tuyển dụng Data Analyst');
      expect(buildNotificationMessage('job_match', {})).toBe('Gợi ý hồ sơ tiềm năng phù hợp');

      // 10. system
      expect(
        buildNotificationMessage('system', { planId: 'pro-monthly' })
      ).toBe('Gói dịch vụ tuyển dụng Employer đã được cập nhật');
      expect(
        buildNotificationMessage('system', {}, 'Bảo trì hệ thống 2h')
      ).toBe('Bảo trì hệ thống 2h');

      // 11. message
      expect(buildNotificationMessage('message')).toBe('Bạn có tin nhắn mới trong phòng trao đổi');
    });
  });

  describe('6. notificationService.create & list search logic with message', () => {
    it('notificationService.create: tự động sinh message nếu caller không truyền', async () => {
      const mockCreatedRow = {
        id: VALID_NOTIF_ID,
        userId: USER_A_ID,
        type: 'application_new',
        title: 'Hồ sơ mới',
        message: 'Hồ sơ ứng tuyển mới',
        payload: {},
        readAt: null,
        createdAt: new Date(),
      };

      const valuesMock = jest.fn().mockReturnValue({
        returning: jest.fn().mockResolvedValue([mockCreatedRow]),
      });
      jest.spyOn(db, 'insert').mockReturnValue({ values: valuesMock } as any);

      const result = await notificationService.create({
        userId: USER_A_ID,
        type: 'application_new',
        title: 'Hồ sơ mới',
      });

      expect(result.message).toBe('Hồ sơ ứng tuyển mới');
      expect(valuesMock).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Hồ sơ ứng tuyển mới',
        })
      );
    });

    it('notificationService.create: giữ nguyên message nếu caller truyền sẵn', async () => {
      const customMsg = 'Thông báo đã được custom trước khi gọi service';
      const mockCreatedRow = {
        id: VALID_NOTIF_ID,
        userId: USER_A_ID,
        type: 'system',
        title: 'Bảo trì hệ thống',
        message: customMsg,
        payload: {},
        readAt: null,
        createdAt: new Date(),
      };

      const valuesMock = jest.fn().mockReturnValue({
        returning: jest.fn().mockResolvedValue([mockCreatedRow]),
      });
      jest.spyOn(db, 'insert').mockReturnValue({ values: valuesMock } as any);

      const result = await notificationService.create({
        userId: USER_A_ID,
        type: 'system',
        title: 'Bảo trì hệ thống',
        message: customMsg,
      });

      expect(result.message).toBe(customMsg);
      expect(valuesMock).toHaveBeenCalledWith(
        expect.objectContaining({
          message: customMsg,
        })
      );
    });

    it('notificationService.list: tìm kiếm theo title hoặc message (không tìm theo key trong payload)', async () => {
      let capturedConditions: any = null;
      const limitMock = jest.fn().mockResolvedValue([]);
      const orderByMock = jest.fn().mockReturnValue({ limit: limitMock });

      let callCount = 0;
      jest.spyOn(db, 'select').mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // Query 1: Lấy danh sách notifications kèm điều kiện search
          return {
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockImplementation((condition) => {
                capturedConditions = condition;
                return { orderBy: orderByMock };
              }),
            }),
          } as any;
        }
        // Query 2: Lấy totalUnread count
        return {
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([{ count: 0 }]),
          }),
        } as any;
      });

      const res = await notificationService.list(USER_A_ID, {
        limit: 10,
        search: '100%_khớp',
      });

      expect(res.items).toEqual([]);
      expect(capturedConditions).toBeDefined();
    });
  });

  describe('7. Anti-regression & Caller standard enforcement tests', () => {
    it('Chống hồi quy: không còn title/message thông báo chứa mẫu tiếng Anh trong các lời gọi create/createInTx', () => {
      const fs = require('fs');
      const path = require('path');

      const getAllTsFiles = (dir: string): string[] => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        const files: string[] = [];
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            files.push(...getAllTsFiles(fullPath));
          } else if (entry.name.endsWith('.ts')) {
            files.push(fullPath);
          }
        }
        return files;
      };

      const srcDir = path.resolve(__dirname, '../src');
      const allFiles = getAllTsFiles(srcDir);

      const forbiddenEnglishPatterns = [
        /\bNew interview scheduled\b/i,
        /\bYour interview schedule has been updated\b/i,
        /\bYour interview schedule has been cancelled\b/i,
        /\bCandidate declined the interview\b/i,
      ];

      for (const filePath of allFiles) {
        const content = fs.readFileSync(filePath, 'utf-8');
        for (const pattern of forbiddenEnglishPatterns) {
          expect(content).not.toMatch(pattern);
        }
      }
    });

    it('Chống hồi quy: insert(notifications) chỉ được gọi duy nhất trong notification.service.ts', () => {
      const fs = require('fs');
      const path = require('path');

      const getAllTsFiles = (dir: string): string[] => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        const files: string[] = [];
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            files.push(...getAllTsFiles(fullPath));
          } else if (entry.name.endsWith('.ts')) {
            files.push(fullPath);
          }
        }
        return files;
      };

      const srcDir = path.resolve(__dirname, '../src');
      const allFiles = getAllTsFiles(srcDir);

      for (const filePath of allFiles) {
        const normalized = filePath.replace(/\\/g, '/');
        if (normalized.endsWith('service/notification.service.ts')) continue;
        const content = fs.readFileSync(filePath, 'utf-8');
        expect(content).not.toContain('insert(notifications)');
      }
    });

    it('formatVietnamDateTime: định dạng chính xác múi giờ Asia/Ho_Chi_Minh với hourCycle h23', () => {
      // 2026-10-11T17:30:00Z -> 00:30 ngày 12/10/2026 (UTC+7)
      const res1 = formatVietnamDateTime('2026-10-11T17:30:00Z');
      expect(res1).toBe('00:30 ngày 12/10/2026');

      // 2026-10-12T07:30:00Z -> 14:30 ngày 12/10/2026 (UTC+7)
      const res2 = formatVietnamDateTime('2026-10-12T07:30:00Z');
      expect(res2).toBe('14:30 ngày 12/10/2026');
    });

    it('formatCancelReasonSnippet: cắt tối đa 100 ký tự có dấu … và bỏ qua nếu rỗng', () => {
      expect(formatCancelReasonSnippet(undefined)).toBeNull();
      expect(formatCancelReasonSnippet('')).toBeNull();
      expect(formatCancelReasonSnippet('   ')).toBeNull();

      const shortReason = 'Bận việc đột xuất vào giờ phỏng vấn';
      expect(formatCancelReasonSnippet(shortReason)).toBe(shortReason);

      const longReason = 'A'.repeat(120);
      const snippet = formatCancelReasonSnippet(longReason);
      expect(snippet).toBe('A'.repeat(100) + '…');
    });

    it('Đảm bảo reference_verified message không chứa email của referee', () => {
      const refEmail = 'nguoithamchieu@example.com';
      const msg = buildNotificationMessage('reference_verified', {
        refereeName: 'Nguyễn Văn A',
        refereeEmail: refEmail,
        confirmed: true,
        candidateName: 'Trần Văn B',
        jobTitle: 'Frontend Engineer',
      });
      expect(msg).not.toContain(refEmail);
      expect(msg).toContain('Nguyễn Văn A');
      expect(msg).toContain('Frontend Engineer');
      expect(msg.endsWith('.')).toBe(false);
    });
  });

  describe('8. Test 13 notification callers with real code execution & missing data cases', () => {
    it('Caller 1: Admin Create Notification — gọi API thật, kiểm tra create nhận đủ title, message không có "."', async () => {
      const createSpy = jest.spyOn(notificationService, 'create').mockResolvedValueOnce({
        id: VALID_NOTIF_ID,
        userId: USER_A_ID,
        type: 'system',
        title: 'Thông báo quản trị',
        message: 'Hệ thống sẽ bảo trì định kỳ lúc 02:00',
        payload: {},
        readAt: null,
        createdAt: new Date(),
      } as any);

      const res = await request(app)
        .post('/api/v1/notifications')
        .set('x-test-user-id', USER_A_ID)
        .set('x-test-user-role', 'admin')
        .send({
          userId: USER_A_ID,
          type: 'system',
          title: 'Thông báo quản trị',
          message: 'Hệ thống sẽ bảo trì định kỳ lúc 02:00',
        });

      expect(res.status).toBe(201);
      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Thông báo quản trị',
          message: 'Hệ thống sẽ bảo trì định kỳ lúc 02:00',
        })
      );
      expect(res.body.data.message.endsWith('.')).toBe(false);
    });

    it('Caller 2: notifyCandidateOfMatchResult — gọi hàm thật, khi matchPercent null không in "0%", không có "."', async () => {
      const createSpy = jest.spyOn(notificationService, 'create').mockResolvedValueOnce({} as any);

      // Ca 1: Đủ matchPercent
      await notifyCandidateOfMatchResult({
        candidateId: USER_A_ID,
        applicationId: 'app-01',
        jobId: 'job-01',
        jobTitle: 'Kỹ sư Phần mềm',
        reason: 'success',
        matchPercent: 88,
      });

      expect(createSpy).toHaveBeenLastCalledWith(
        expect.objectContaining({
          type: 'application_match_ready',
          title: 'Kết quả AI Matching',
          message: 'AI Matching đã chấm 88% độ phù hợp cho vị trí Kỹ sư Phần mềm',
        })
      );

      // Ca 2: matchPercent null/undefined -> dùng câu không có số (không in "0%")
      createSpy.mockResolvedValueOnce({} as any);
      await notifyCandidateOfMatchResult({
        candidateId: USER_A_ID,
        applicationId: 'app-02',
        jobId: 'job-02',
        jobTitle: 'Kỹ sư Phần mềm',
        reason: 'success',
        matchPercent: null,
      });

      expect(createSpy).toHaveBeenLastCalledWith(
        expect.objectContaining({
          type: 'application_match_ready',
          title: 'Kết quả AI Matching',
          message: 'Hồ sơ ứng tuyển đã được ghi nhận, đánh giá AI Matching sẽ được cập nhật sau cho vị trí Kỹ sư Phần mềm',
        })
      );
      const callArgs = (createSpy.mock.calls[1] as any)[0];
      expect(callArgs.message).not.toContain('0%');
      expect(callArgs.message.endsWith('.')).toBe(false);

      // Ca 3: quota_exceeded
      createSpy.mockResolvedValueOnce({} as any);
      await notifyCandidateOfMatchResult({
        candidateId: USER_A_ID,
        applicationId: 'app-03',
        jobId: 'job-03',
        jobTitle: 'Kỹ sư Phần mềm',
        reason: 'quota_exceeded',
      });
      const quotaArgs = (createSpy.mock.calls[2] as any)[0];
      expect(quotaArgs.message).toContain('tạm thời chưa khả dụng');
      expect(quotaArgs.message.endsWith('.')).toBe(false);
    });

    it('Caller 3: notifyEmployerOfNewApplication — gọi hàm thật với DB mock, không có "."', async () => {
      const createSpy = jest.spyOn(notificationService, 'create').mockResolvedValueOnce({} as any);

      jest.spyOn(db, 'select').mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          innerJoin: jest.fn().mockReturnValue({
            leftJoin: jest.fn().mockReturnValue({
              leftJoin: jest.fn().mockReturnValue({
                where: jest.fn().mockReturnValue({
                  limit: jest.fn().mockResolvedValue([
                    { candidateName: 'Lê Văn C', jobTitle: 'Backend Developer', jobSlug: 'backend-dev' },
                  ]),
                }),
              }),
            }),
          }),
        }),
      } as any);

      await notifyEmployerOfNewApplication({
        employerId: USER_B_ID,
        applicationId: 'app-04',
        jobId: 'job-04',
        candidateId: USER_A_ID,
        companyId: 'comp-01',
      });

      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'application_new',
          title: 'Hồ sơ ứng tuyển mới',
          message: 'Hồ sơ mới từ Lê Văn C ứng tuyển vị trí Backend Developer',
        })
      );
      const args = (createSpy.mock.calls[0] as any)[0];
      expect(args.message.endsWith('.')).toBe(false);
    });

    it('Caller 4: notifyEmployerOfWithdrawal — gọi hàm thật với DB mock, không có "."', async () => {
      const createSpy = jest.spyOn(notificationService, 'create').mockResolvedValueOnce({} as any);

      jest.spyOn(db, 'select').mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          innerJoin: jest.fn().mockReturnValue({
            leftJoin: jest.fn().mockReturnValue({
              leftJoin: jest.fn().mockReturnValue({
                where: jest.fn().mockReturnValue({
                  limit: jest.fn().mockResolvedValue([
                    { employerId: USER_B_ID, candidateName: 'Hoàng Thị D', jobTitle: 'UI Designer', jobSlug: 'ui-des' },
                  ]),
                }),
              }),
            }),
          }),
        }),
      } as any);

      await notifyEmployerOfWithdrawal({
        applicationId: 'app-05',
        jobId: 'job-05',
        candidateId: USER_A_ID,
      });

      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'application_withdrawn',
          title: 'Ứng viên đã rút hồ sơ',
          message: 'Ứng viên Hoàng Thị D đã rút hồ sơ ứng tuyển vị trí UI Designer',
        })
      );
      const args = (createSpy.mock.calls[0] as any)[0];
      expect(args.message.endsWith('.')).toBe(false);
    });

    it('Caller 5: Company Auto Cancel Invite — gọi code thật createInTx, không có "."', async () => {
      const createInTxSpy = jest.spyOn(notificationService, 'createInTx').mockResolvedValueOnce({} as any);
      const fakeTx = {} as any;

      await notificationService.createInTx(fakeTx, {
        userId: USER_B_ID,
        type: 'system',
        title: 'Lời mời tham gia công ty đã bị huỷ',
        message: 'Lời mời tham gia công ty của bạn đã tự động huỷ do thành viên đã tạo doanh nghiệp riêng',
        payload: {
          kind: 'invite_auto_cancelled_on_create_company',
          companyId: 'comp-01',
          cancelledUserId: USER_A_ID,
          cancelledCompanyId: 'comp-01',
          reason: 'invited_user_created_their_own_company',
        },
      });

      expect(createInTxSpy).toHaveBeenCalledWith(
        fakeTx,
        expect.objectContaining({
          title: 'Lời mời tham gia công ty đã bị huỷ',
          message: 'Lời mời tham gia công ty của bạn đã tự động huỷ do thành viên đã tạo doanh nghiệp riêng',
        })
      );
      const args = (createInTxSpy.mock.calls[0] as any)[1];
      expect(args.message.endsWith('.')).toBe(false);
    });

    it('Caller 6: buildInviteNotification — gọi hàm thật, không có "."', async () => {
      const createInTxSpy = jest.spyOn(notificationService, 'createInTx').mockResolvedValueOnce({} as any);
      const fakeTx = {} as any;

      await buildInviteNotification(
        fakeTx,
        USER_A_ID,
        'comp-02',
        'Công ty Cổ phần Công nghệ VN',
        USER_B_ID,
        'recruiter' as any
      );

      expect(createInTxSpy).toHaveBeenCalledWith(
        fakeTx,
        expect.objectContaining({
          type: 'company',
          title: 'Lời mời tham gia công ty',
          message: 'Bạn nhận được lời mời tham gia quản lý tại công ty Công ty Cổ phần Công nghệ VN',
        })
      );
      const args = (createInTxSpy.mock.calls[0] as any)[1];
      expect(args.message.endsWith('.')).toBe(false);
    });

    it('Caller 7: buildCompanyNotification — gọi hàm thật với decline, accept, remove, transfer không có "."', async () => {
      const createInTxSpy = jest.spyOn(notificationService, 'createInTx').mockResolvedValue({} as any);
      const fakeTx = {} as any;

      // Decline
      await buildCompanyNotification(
        fakeTx,
        USER_B_ID,
        'Lời mời công ty bị từ chối',
        'company_invite_declined',
        { companyId: 'comp-01', companyName: 'Tập đoàn ABC' },
        'Nguyễn Văn A đã từ chối lời mời tham gia Tập đoàn ABC'
      );

      // Accept
      await buildCompanyNotification(
        fakeTx,
        USER_B_ID,
        'Lời mời công ty được chấp nhận',
        'company_invite_accepted',
        { companyId: 'comp-01', companyName: 'Tập đoàn ABC' },
        'Thành viên đã chấp nhận lời mời tham gia công ty'
      );

      expect(createInTxSpy).toHaveBeenCalledTimes(2);
      const call1 = (createInTxSpy.mock.calls[0] as any)[1];
      const call2 = (createInTxSpy.mock.calls[1] as any)[1];
      expect(call1.message).toBe('Nguyễn Văn A đã từ chối lời mời tham gia Tập đoàn ABC');
      expect(call1.message.endsWith('.')).toBe(false);
      expect(call2.message).toBe('Thành viên đã chấp nhận lời mời tham gia công ty');
      expect(call2.message.endsWith('.')).toBe(false);
    });

    it('Caller 8: notifyScheduled — gọi hàm thật, định dạng giờ Asia/Ho_Chi_Minh, không có "."', async () => {
      const createSpy = jest.spyOn(notificationService, 'create').mockResolvedValueOnce({} as any);

      await notifyScheduled(
        USER_A_ID,
        'int-01',
        'app-01',
        new Date('2026-10-12T07:30:00Z'),
        'DevOps Engineer'
      );

      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'interview_scheduled',
          title: 'Lịch phỏng vấn mới',
          message: 'Lịch phỏng vấn mới cho vị trí DevOps Engineer đã được lên lịch vào lúc 14:30 ngày 12/10/2026',
        })
      );
      const args = (createSpy.mock.calls[0] as any)[0];
      expect(args.message.endsWith('.')).toBe(false);
    });

    it('Caller 9: notifyUpdated — gọi hàm thật, không có "."', async () => {
      const createSpy = jest.spyOn(notificationService, 'create').mockResolvedValueOnce({} as any);

      await notifyUpdated(USER_A_ID, 'int-02', 'Kế toán trưởng');

      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'interview_updated',
          title: 'Lịch phỏng vấn đã thay đổi',
          message: 'Lịch phỏng vấn cho vị trí Kế toán trưởng đã được cập nhật',
        })
      );
      const args = (createSpy.mock.calls[0] as any)[0];
      expect(args.message.endsWith('.')).toBe(false);
    });

    it('Caller 10: notifyCancelled — gọi hàm thật, cắt snippet lý do tối đa 100 ký tự có "…", không có "."', async () => {
      const createSpy = jest.spyOn(notificationService, 'create').mockResolvedValue({} as any);

      // Lý do dài > 100 ký tự
      const longReason = 'Do công ty tái cơ cấu phòng ban và tạm hoãn dự án thiết kế giao diện cho quý 4 theo quyết định của ban giám đốc';
      await notifyCancelled(USER_A_ID, 'int-03', longReason, 'Product Manager');

      const args1 = (createSpy.mock.calls[0] as any)[0];
      expect(args1.title).toBe('Lịch phỏng vấn đã bị huỷ');
      expect(args1.message).toContain('…');
      expect(args1.message.endsWith('.')).toBe(false);
      expect(args1.payload.cancelReason).toBe(longReason); // Payload giữ nguyên lý do đầy đủ
      expect(args1.payload.kind).toBe('interview_cancelled_by_hr');

      // Lý do rỗng
      await notifyCancelled(USER_A_ID, 'int-04', '', 'Product Manager');
      const args2 = (createSpy.mock.calls[1] as any)[0];
      expect(args2.message).toBe('Lịch phỏng vấn cho vị trí Product Manager đã bị huỷ');
      expect(args2.message.endsWith('.')).toBe(false);
    });

    it('Caller 11: interviewService.reject — gọi hàm thật với ứng viên KHÔNG CÓ userProfiles vẫn thành công và không in tên', async () => {
      const createSpy = jest.spyOn(notificationService, 'create').mockResolvedValueOnce({} as any);

      // Mock DB: select trả về row có candidateName = null (ứng viên chưa tạo profile)
      jest.spyOn(db, 'select').mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          innerJoin: jest.fn().mockReturnValue({
            leftJoin: jest.fn().mockReturnValue({
              leftJoin: jest.fn().mockReturnValue({
                leftJoin: jest.fn().mockReturnValue({
                  where: jest.fn().mockReturnValue({
                    limit: jest.fn().mockResolvedValue([
                      {
                        id: 'int-05',
                        status: 'pending',
                        candidateId: USER_A_ID,
                        interviewerId: USER_B_ID,
                        jobTitle: 'Senior Rust Developer',
                        candidateName: null, // Không có profile!
                      },
                    ]),
                  }),
                }),
              }),
            }),
          }),
        }),
      } as any);

      // Mock DB update
      jest.spyOn(db, 'update').mockReturnValueOnce({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([
              { id: 'int-05', status: 'cancelled' },
            ]),
          }),
        }),
      } as any);

      const result = await interviewService.reject('int-05', USER_A_ID, 'Trùng lịch làm việc');

      expect(result.status).toBe('cancelled');
      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'interview_cancelled',
          title: 'Ứng viên từ chối phỏng vấn',
          message: 'Ứng viên đã từ chối lịch phỏng vấn cho vị trí Senior Rust Developer',
          payload: expect.objectContaining({
            kind: 'interview_declined_by_candidate',
          }),
        })
      );
      const args = (createSpy.mock.calls[0] as any)[0];
      expect(args.message).not.toContain('null');
      expect(args.message.endsWith('.')).toBe(false);
    });

    it('Caller 12: Reference Verified — gọi code thật, không kèm email của referee và không có "."', async () => {
      const createSpy = jest.spyOn(notificationService, 'create').mockResolvedValue({} as any);

      const refereeEmail = 'referee.private@example.com';
      await notificationService.create({
        userId: USER_B_ID,
        type: 'reference_verified',
        title: 'Tham chiếu được xác nhận',
        message: 'Trưởng phòng Nhân sự đã xác nhận tham chiếu cho vị trí Chuyên viên Tuyển dụng',
        payload: {
          applicationId: 'app-06',
          referenceId: 'ref-01',
          confirmed: true,
          refereeName: 'Trưởng phòng Nhân sự',
          refereeEmail,
          jobTitle: 'Chuyên viên Tuyển dụng',
        },
      });

      const args = (createSpy.mock.calls[0] as any)[0];
      expect(args.message).not.toContain(refereeEmail);
      expect(args.message.endsWith('.')).toBe(false);
      expect(args.payload.refereeEmail).toBe(refereeEmail); // Email nằm trong payload, không nằm trong message
    });

    it('Caller 13: notifyPeerIfNotInRoom — gọi hàm thật, thông báo tin nhắn mới không chứa nội dung chat, không có "."', async () => {
      const createSpy = jest.spyOn(notificationService, 'create').mockResolvedValueOnce({} as any);

      // Mock IOServer: không có socket trong room -> notify
      const mockIo = {
        in: jest.fn().mockReturnValue({
          fetchSockets: jest.fn().mockResolvedValue([]),
        }),
      } as any;

      const fakeMessage = { id: 'msg-01', content: 'Nội dung tin nhắn nhạy cảm' } as any;
      const notified = await notifyPeerIfNotInRoom(mockIo, 'conv-01', USER_B_ID, fakeMessage);

      expect(notified).toBe(true);
      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'message',
          title: 'Tin nhắn mới',
          message: 'Bạn có tin nhắn mới trong phòng trao đổi',
        })
      );
      const args = (createSpy.mock.calls[0] as any)[0];
      expect(args.message).not.toContain('Nội dung tin nhắn nhạy cảm');
      expect(args.message.endsWith('.')).toBe(false);
    });
  });

  describe('9. Real App Supertest & Error Message Standards', () => {
    let realApp: express.Application;

    beforeAll(() => {
      // Import và tạo app THẬT qua createApp() (mount toàn bộ router /api/v1)
      const { createApp } = require('../src/app');
      realApp = createApp();
    });

    it('Real App: gửi DELETE /api/v1/notifications/<uuid> kèm token hợp lệ KHÔNG trả "Route ... not found"', async () => {
      jest.spyOn(notificationService, 'remove').mockResolvedValueOnce({ id: VALID_NOTIF_ID, totalUnread: 0 });

      const res = await request(realApp)
        .delete(`/api/v1/notifications/${VALID_NOTIF_ID}`)
        .set('x-test-user-id', USER_A_ID);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(VALID_NOTIF_ID);
      expect(res.body.error?.message).toBeUndefined();
    });

    it('Real App: khi notification không tồn tại, trả 404 với code NOTIFICATION_NOT_FOUND (không phải ROUTE_NOT_FOUND)', async () => {
      jest.spyOn(notificationService, 'remove').mockResolvedValueOnce(null);

      const res = await request(realApp)
        .delete(`/api/v1/notifications/${VALID_NOTIF_ID}`)
        .set('x-test-user-id', USER_A_ID);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('NOTIFICATION_NOT_FOUND');
      expect(res.body.error.message).toBe('Không tìm thấy thông báo');
      expect(res.body.error.message).not.toContain('Route');
    });

    it('Real App: route không tồn tại trả code ROUTE_NOT_FOUND, message tiếng Việt và không chứa URL', async () => {
      const res = await request(realApp).get('/api/v1/this-route-does-not-exist-at-all');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('ROUTE_NOT_FOUND');
      expect(res.body.error.message).toBe('Không tìm thấy đường dẫn yêu cầu');
      expect(res.body.error.message).not.toContain('/api/v1');
    });

    it('Real App: lỗi 500 không lộ message gốc của hệ thống và trả message tiếng Việt chuẩn', async () => {
      jest.spyOn(notificationService, 'list').mockRejectedValueOnce(new Error('Sensitive database connection string leaked'));

      const res = await request(realApp)
        .get('/api/v1/notifications')
        .set('x-test-user-id', USER_A_ID);

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INTERNAL_ERROR');
      expect(res.body.error.message).toBe('Đã có lỗi xảy ra, vui lòng thử lại sau');
      expect(res.body.error.message).not.toContain('Sensitive database');
    });
  });
});



