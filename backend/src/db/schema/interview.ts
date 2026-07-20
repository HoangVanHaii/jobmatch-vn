import { pgTable, uuid, integer, text, boolean, timestamp, jsonb, time, date, index } from 'drizzle-orm/pg-core';
import { applications } from './applications';
import { users } from './users';

export const interviews = pgTable('interviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  applicationId: uuid('application_id').notNull().references(() => applications.id),
  interviewerId: uuid('interviewer_id').notNull().references(() => users.id),
  scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull(),
  durationMin: integer('duration_min').default(60),
  location: text('location'),
  meetingLink: text('meeting_link'),
  status: text('status').default('pending'),
  confirmationToken: text('confirmation_token').unique(),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  cancelReason: text('cancel_reason'),
  reminder24hSent: boolean('reminder_24h_sent').default(false),
  reminder2hSent: boolean('reminder_2h_sent').default(false),
  reminder15mSent: boolean('reminder_15m_sent').default(false),
  feedback: jsonb('feedback').$type<{
    scores: Record<string, number>;
    comments: string;
    recommendation: 'strong_hire' | 'hire' | 'no_hire' | 'strong_no_hire';
  }>(),
  feedbackSubmittedAt: timestamp('feedback_submitted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  scheduledIdx: index('idx_interviews_scheduled').on(t.scheduledAt, t.status),
  appIdx: index('idx_interviews_app').on(t.applicationId),
  interviewerIdx: index('idx_interviews_interviewer').on(t.interviewerId, t.scheduledAt),
}));

export const interviewerAvailability = pgTable('interviewer_availability', {
  id: uuid('id').primaryKey().defaultRandom(),
  interviewerId: uuid('interviewer_id').notNull().references(() => users.id),
  dayOfWeek: integer('day_of_week'), // 0-6
  startTime: time('start_time'),
  endTime: time('end_time'),
  specificDate: date('specific_date'),
  isRecurring: boolean('is_recurring').default(true),
});