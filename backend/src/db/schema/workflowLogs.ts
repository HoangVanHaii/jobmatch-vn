import { pgTable, bigserial, text, jsonb, integer, timestamp, index } from 'drizzle-orm/pg-core';

export const n8nWorkflowLogs = pgTable('n8n_workflow_logs', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  workflowName: text('workflow_name').notNull(),
  executionId: text('execution_id'),
  status: text('status'),
  input: jsonb('input').$type<Record<string, unknown>>(),
  output: jsonb('output').$type<Record<string, unknown>>(),
  error: jsonb('error').$type<{ message?: string; code?: string }>(),
  durationMs: integer('duration_ms'),
  triggeredAt: timestamp('triggered_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  workflowIdx: index('idx_n8n_logs_workflow').on(t.workflowName, t.triggeredAt),
}));

export const emailLogs = pgTable('email_logs', {
  id: text('id').primaryKey(),
  userId: text('user_id'),
  toEmail: text('to_email').notNull(),
  subject: text('subject'),
  template: text('template'),
  provider: text('provider').default('n8n'),
  providerMsgId: text('provider_msg_id'),
  status: text('status'),
  payload: jsonb('payload').$type<Record<string, unknown>>(),
  sentAt: timestamp('sent_at', { withTimezone: true }).defaultNow().notNull(),
});