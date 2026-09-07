/**
 * Drizzle enums — match với SQL enum types
 */
import { pgEnum } from 'drizzle-orm/pg-core';

export const userRoleEnum = pgEnum('user_role', ['candidate', 'employer', 'admin']);
export const userStatusEnum = pgEnum('user_status', ['active', 'suspended', 'pending', 'banned']);
export const oauthProviderEnum = pgEnum('oauth_provider', ['google', 'facebook', 'github']);
export const jobStatusEnum = pgEnum('job_status', ['draft', 'pending', 'ai_scanning', 'ai_flagged', 'live', 'expired', 'closed']);
export const jobLevelEnum = pgEnum('job_level', ['intern', 'fresher', 'junior', 'mid', 'senior', 'lead', 'manager']);
export const jobTypeEnum = pgEnum('job_type', ['full-time', 'part-time', 'contract', 'internship', 'freelance']);
export const applicationStatusEnum = pgEnum('application_status', [
  'pending', 'viewed', 'screening', 'interview', 'offered', 'hired', 'rejected', 'withdrawn',
]);
export const subscriptionStatusEnum = pgEnum('subscription_status', ['active', 'expired', 'cancelled', 'pending']);
export const paymentStatusEnum = pgEnum('payment_status', ['pending', 'paid', 'failed', 'cancelled', 'refunded', 'expired']);
export const companyStatusEnum = pgEnum('company_status', ['active', 'banned', 'removed']);
export const companyMemberRoleEnum = pgEnum('company_member_role', ['owner', 'member']);
/**
 * notification_type:
 *   - company_invite: gửi cho user được mời vào company
 *   - job_match: gửi cho candidate khi có job match từ embedding/similarity scan
 *   - message: chat message giữa các user
 *   - system: thông báo hệ thống (vd: payment, quota)
 *   - application_new: gửi cho employer (postedBy) khi có candidate apply job mình
 *     → bắn NGAY khi application insert, không đợi AI matching
 *   - application_match_ready: gửi cho candidate khi AI matching worker hoàn tất
 *     (hoặc skip do quota_exceeded) → FE render điểm + reasoning
 *   - application_withdrawn: gửi cho employer khi candidate rút đơn
 *     (chỉ cho phép khi status=pending|viewed, xem service.application.withdraw)
 *     → employer biết realtime để update pipeline / không chờ candidate nữa.
 *
 * Tham chiếu migration:
 *   0025_notification_type_applications.sql (application_new + application_match_ready)
 *   0026_notification_type_withdraw.sql (application_withdrawn)
 */
export const notificationTypeEnum = pgEnum('notification_type', [
  'company_invite',
  'job_match',
  'message',
  'system',
  'application_new',
  'application_match_ready',
  'application_withdrawn',
]);
export const companyMemberStatusEnum = pgEnum('company_member_status', [
  'pending',
  'active',
  'declined',
  'removed',
  'left',
  'auto_cancelled',
]);
export const skillStatusEnum = pgEnum('skill_status', ['active', 'deleted']);
export const cvStatusEnum = pgEnum('cv_status', [
  'pending',
  'parsing',
  'ready',
  'failed',
  'deleted',
]);
export const cvSourceEnum = pgEnum('cv_source', ['upload', 'direct']);
export const scanVerdictEnum = pgEnum('scan_verdict', ['approved', 'flagged']);
export const flagSeverityEnum = pgEnum('flag_severity', ['block', 'warn']);
