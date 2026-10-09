/**
 * Integration test — apply trùng trả 409 ALREADY_APPLIED (TASK 2 — M-01).
 *
 * Trước fix: drizzle 0.45 bọc pg error trong DrizzleQueryError → check
 * err.code miss → 500 INTERNAL_ERROR thay vì 409.
 *
 * Side-effect với DB dev: mỗi lần chạy tạo đúng 1 application thật (lần POST
 * đầu) + tiêu 1 quota ai_cv_match của candidate fixture. KHÔNG xoá sau test
 * (application là dữ liệu hợp lệ; xoá có thể race với cvMatch worker).
 * Không tìm được cặp (job live, cv ready) chưa apply → skip toàn describe.
 */
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { and, eq } from 'drizzle-orm';
import { createApp } from '../app';
import { db } from '../config/database';
import { env } from '../config/env';
import { applications, cvs, jobs, users } from '../db/schema';

jest.mock('@octokit/rest', () => ({ Octokit: class {} }));

const app = createApp();

describe('POST /applications — apply trùng (M-01)', () => {
  it('lần 2 trả 409 ALREADY_APPLIED (không phải 500)', async () => {
    // 1. Fixture: candidate có ít nhất 1 CV ready + 1 job live chưa apply bằng CV đó.
    const [candidate] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.role, 'candidate'))
      .limit(1);
    if (!candidate) return; // thiếu fixture

    const candidateCvs = await db
      .select({ id: cvs.id })
      .from(cvs)
      .where(and(eq(cvs.candidateId, candidate.id), eq(cvs.status, 'ready')));
    if (candidateCvs.length === 0) return;

    const [job] = await db.select({ id: jobs.id }).from(jobs).where(eq(jobs.status, 'live')).limit(1);
    if (!job) return;

    const appliedCvIds = (await db
      .select({ cvId: applications.cvId })
      .from(applications)
      .where(eq(applications.jobId, job.id))).map((r) => r.cvId);
    const freeCv = candidateCvs.find((c) => !appliedCvIds.includes(c.id));
    if (!freeCv) return; // candidate đã apply job này bằng mọi CV → skip

    const token = jwt.sign(
      { userId: candidate.id, role: 'candidate', email: 'dup-apply-test@local' },
      env.JWT_ACCESS_SECRET,
      { expiresIn: '15m' },
    );
    const post = () =>
      request(app)
        .post('/api/v1/applications')
        .set('Authorization', `Bearer ${token}`)
        .send({ jobId: job.id, cvId: freeCv.id });

    // 2. Lần 1 → 201.
    const first = await post();
    expect(first.status).toBe(201);
    expect(first.body.data.status).toBe('pending');

    // 3. Lần 2 (trùng cvId+jobId) → 409 ALREADY_APPLIED.
    const second = await post();
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('ALREADY_APPLIED');

    // 4. DB chỉ có đúng 1 row cho cặp (cvId, jobId).
    const rows = await db
      .select({ id: applications.id })
      .from(applications)
      .where(and(eq(applications.jobId, job.id), eq(applications.cvId, freeCv.id)));
    expect(rows).toHaveLength(1);
  });
});
