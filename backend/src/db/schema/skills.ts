import { pgTable, uuid, text, integer, boolean, primaryKey, index } from 'drizzle-orm/pg-core';
import { users } from './users';
import { jobs } from './jobs';

export const skills = pgTable('skills', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  slug: text('slug').notNull().unique(),
  category: text('category'),
  demandCount: integer('demand_count').default(0).notNull(),
}, (t) => ({
  demandIdx: index('idx_skills_demand').on(t.demandCount),
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