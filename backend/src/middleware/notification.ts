import { z } from 'zod';
import { validate } from './validate';

// 7 giá trị enum — match với backend pgEnum ('notification_type').
//
// 'company_invite' giữ lại để validator chấp nhận tạo notification legacy
// (rows cũ trước migration 0032); admin endpoint giờ sẽ dùng type='company'
// + payload.kind='company_invite_sent' thay thế.
// 'company' là type chính cho toàn bộ company-member lifecycle (10 kind).
// 'system' để dành cho payment/quota tương lai.
export const createNotificationSchema = z.object({
    userId: z.string().uuid(),
    type: z.enum([
      'company_invite',           // legacy
      'company',                  // mới — tất cả company-member events
      'job_match',
      'message',
      'system',
      'application_new',
      'application_match_ready',
      'application_withdrawn',
    ]),
    title: z.string().min(1).max(255),
    payload: z.record(z.unknown()).optional().default({}),
});

export const listNotificationsQuerySchema = z.object({
  unread: z
    .union([z.literal("true"), z.literal("false")])
    .optional()
    .transform((v) => v === "true"),
  cursor: z.string().min(1).optional(),
  limit: z
    .string()
    .optional()
    .transform((v) => {
      if (!v) return 20;

      const parsed = Number(v);
      if (!Number.isInteger(parsed) || parsed < 1) {
        return 20;
      }

      return Math.min(parsed, 59);
    }),
});

export const notificationIdParamSchema = z.object({
    id: z.string().uuid(),  
})

export const validateCreateNotification = validate(createNotificationSchema, 'body');
export const validateListNotificationsQuery = validate(listNotificationsQuerySchema, 'query');
export const validateNotificationIdParam = validate(notificationIdParamSchema, 'params');
