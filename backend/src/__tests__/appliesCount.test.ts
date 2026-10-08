/**
 * Integration test — applies_count tăng cùng transaction với INSERT
 * application (TASK 3 — M-02).
 *
 * Side-effect DB dev: mỗi lần chạy tạo 1 application thật + tiêu 1 quota
 * ai_cv_match (giống duplicateApply.test.ts, ghi chú chi tiết ở đó).
 * Không có cặp (job live, cv ready) chưa apply → skip.
 */
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { and, eq, sql } from 'drizzle-orm';
import { createApp } from '../app';
import { db } from '../config/database';
import { env } from '../config/env';
import { applications, cvs, jobs, users } from '../db/schema';

jest.mock('@octokit/rest', () => ({ Octokit: class {} }));

const app = createApp();

const countApplications = async (jobId: string): Promise<number> => {
  const [row] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(applications)
    .where(eq(applications.jobId, jobId));
  return row?.c ?? 0;
};

describe('applies_count (M-02)', () => {
  it('apply thành công → +1; apply trùng 409 → giữ nguyên', async () => {
    // 1. Fixture: cặp (job live, cv ready) chưa apply.
    const [candidate] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.role, 'candidate'))
      .limit(1);
    if (!candidate) return;

    const candidateCvs = await db
      .select({ id: cvs.id })
      .from(cvs)
      .where(and(eq(cvs.candidateId, candidate.id), eq(cvs.status, 'ready')));
    if (candidateCvs.length === 0) return;

    const [job] = await db
      .select({ id: jobs.id })
      .from(jobs)
      .where(eq(jobs.status, 'live'))
      .limit(1);
    if (!job) return;

    const appliedCvIds = (await db
      .select({ cvId: applications.cvId })
      .from(applications)
      .where(eq(applications.jobId, job.id))).map((r) => r.cvId);
    const freeCv = candidateCvs.find((c) => !appliedCvIds.includes(c.id));
    if (!freeCv) return;

    const appliedBefore = await countApplications(job.id);
    const [jobBefore] = await db
      .select({ appliesCount: jobs.appliesCount })
      .from(jobs)
      .where(eq(jobs.id, job.id));

    const token = jwt.sign(
      { userId: candidate.id, role: 'candidate', email: 'applies-count-test@local' },
      env.JWT_ACCESS_SECRET,
      { expiresIn: '15m' },
    );
    const post = () =>
      request(app)
        .post('/api/v1/applications')
        .set('Authorization', `Bearer ${token}`)
        .send({ jobId: job.id, cvId: freeCv.id });

    // 2. Apply lần 1 → 201, applies_count tăng đúng +1 và khớp count thực tế.
    const first = await post();
    expect(first.status).toBe(201);

    const [jobAfter] = await db
      .select({ appliesCount: jobs.appliesCount })
      .from(jobs)
      .where(eq(jobs.id, job.id));
    expect(jobAfter.appliesCount).toBe((jobBefore?.appliesCount ?? 0) + 1);
    expect(jobAfter.appliesCount).toBe(appliedBefore + 1);

    // 3. Apply trùng → 409, applies_count KHÔNG tăng.
    const second = await post();
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('ALREADY_APPLIED');

    const [jobFinal] = await db
      .select({ appliesCount: jobs.appliesCount })
      .from(jobs)
      .where(eq(jobs.id, job.id));
    expect(jobFinal.appliesCount).toBe(jobAfter.appliesCount);
  });
});
