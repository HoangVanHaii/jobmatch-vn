/**
 * Drizzle enums — match với SQL enum types
 */
import { pgEnum } from 'drizzle-orm/pg-core';

export const userRoleEnum = pgEnum('user_role', ['candidate', 'employer', 'admin']);
export const userStatusEnum = pgEnum('user_status', ['active', 'suspended', 'pending', 'banned']);
export const oauthProviderEnum = pgEnum('oauth_provider', ['google', 'facebook', 'github']);
export const jobStatusEnum = pgEnum('job_status', ['draft', 'pending', 'live', 'expired', 'closed']);
export const jobLevelEnum = pgEnum('job_level', ['intern', 'fresher', 'junior', 'mid', 'senior', 'lead', 'manager']);
export const jobTypeEnum = pgEnum('job_type', ['full-time', 'part-time', 'contract', 'internship', 'freelance']);
export const applicationStatusEnum = pgEnum('application_status', [
  'pending', 'viewed', 'screening', 'interview', 'offered', 'hired', 'rejected', 'withdrawn',
]);
export const subscriptionStatusEnum = pgEnum('subscription_status', ['active', 'expired', 'cancelled', 'pending']);
export const paymentStatusEnum = pgEnum('payment_status', ['pending', 'paid', 'failed', 'refunded']);
export const companyStatusEnum = pgEnum('company_status', ['active', 'banned', 'removed']);
export const companyMemberRoleEnum = pgEnum('company_member_role', ['owner', 'member']);
export const companyMemberStatusEnum = pgEnum('company_member_status', ['active', 'invited', 'inactive']);
export const notificationTypeEnum = pgEnum('notification_type', ['company_invite', 'job_match', 'message', 'system']);
export const skillStatusEnum = pgEnum('skill_status', ['active', 'deleted']);