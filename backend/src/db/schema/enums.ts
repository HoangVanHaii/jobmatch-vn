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

/**
 * Hiring status — dùng để FE render badge "Urgently Hiring" / "Actively Hiring"
 * trên JobSearchView. Employer set thủ công lúc tạo/sửa job (không auto
 * compute từ deadline/appliesCount).
 *   - urgent : job đang cần tuyển gấp (vd campaign ngắn hạn, deadline nội bộ).
 *   - active : employer tuyên bố đang tuyển tích cực (không phụ thuộc metric).
 *   - normal : mặc định — không render badge urgency.
 *
 * Migration: 0038_add_hiring_status.sql.
 */
export const hiringStatusEnum = pgEnum('hiring_status', ['urgent', 'active', 'normal']);
export const applicationStatusEnum = pgEnum('application_status', [
  'pending', 'viewed', 'screening', 'interview', 'offered', 'hired', 'rejected', 'withdrawn',
]);
export const subscriptionStatusEnum = pgEnum('subscription_status', ['active', 'expired', 'cancelled', 'pending']);
export const paymentStatusEnum = pgEnum('payment_status', ['pending', 'paid', 'failed', 'cancelled', 'refunded', 'expired']);
export const companyStatusEnum = pgEnum('company_status', ['active', 'banned', 'removed']);
export const companyMemberRoleEnum = pgEnum('company_member_role', ['owner', 'member']);

export const notificationTypeEnum = pgEnum('notification_type', [
  'company_invite',         // legacy — xem comment trên
  'company',
  'job_match',
  'message',
  'system',
  'application_new',
  'application_match_ready',
  'application_withdrawn',
  'interview_scheduled',
  'interview_updated',
  'interview_cancelled',
  'reference_verified',
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
  'analyzing',
  'ready',
  'failed',
  'deleted',
]);
export const cvSourceEnum = pgEnum('cv_source', ['upload', 'direct']);
export const scanVerdictEnum = pgEnum('scan_verdict', ['approved', 'flagged']);
export const flagSeverityEnum = pgEnum('flag_severity', ['block', 'warn']);
