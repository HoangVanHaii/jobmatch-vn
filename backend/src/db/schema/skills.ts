import { pgTable, uuid, text, integer, boolean, primaryKey, index } from 'drizzle-orm/pg-core';
import { users } from './users';
import { jobs } from './jobs';
import { skillStatusEnum } from './enums';

export const skills = pgTable('skills', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  slug: text('slug').notNull().unique(),
  status: skillStatusEnum('status').default('active').notNull(),
}, (t) => ({
  statusIdx: index('idx_skills_status').on(t.status),
}));

export const jobSkills = pgTable('job_skills', {
  jobId: uuid('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  skillId: uuid('skill_id').notNull().references(() => skills.id),
  required: boolean('required').default(true),
}, (t) => ({
  pk: primaryKey({ columns: [t.jobId, t.skillId] }),
}));

export const candidateSkills = pgTable('candidate_skills', {
  candidateId: uuid('candidate_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  skillId: uuid('skill_id').notNull().references(() => skills.id),
  level: integer('level'),
}, (t) => ({
  pk: primaryKey({ columns: [t.candidateId, t.skillId] }),
}));