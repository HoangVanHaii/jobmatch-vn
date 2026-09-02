/**
 * Dev-only: ensure test candidate has at least one ready direct CV.
 * For e2e testing of the download flow.
 */
import 'dotenv/config';
import { pool } from '../src/config/database';

const TEST_EMAIL = 'e2e-test@jobmatch.vn';

const sampleParsedData = {
  contact: {
    fullName: 'Nguyễn Văn A',
    title: 'Backend Developer',
    email: 'nguyenvana@example.com',
    phone: '+84 901 234 567',
    location: 'TP. Hồ Chí Minh',
  },
  summary: 'Backend Developer với 4 năm kinh nghiệm xây dựng hệ thống REST API tải cao, tối ưu hiệu năng và clean code.',
  skills: ['Node.js', 'TypeScript', 'PostgreSQL', 'Docker', 'Kubernetes', 'Redis', 'AWS'],
  experiences: [
    {
      company: 'FPT Software',
      position: 'Senior Backend Developer',
      startDate: '2022-01',
      endDate: null,
      description: 'Xây dựng REST API cho hệ thống fintech, tối ưu p95 từ 800ms xuống 180ms, áp dụng caching + query optimization. Quản lý team 4 người.',
    },
    {
      company: 'VNG Corporation',
      position: 'Backend Developer',
      startDate: '2020-06',
      endDate: '2021-12',
      description: 'Phát triển service nội bộ với Express + PostgreSQL + Redis, xử lý 2M req/day. Triển khai CI/CD với GitHub Actions.',
    },
  ],
  educations: [
    {
      school: 'ĐH Bách Khoa Hà Nội',
      major: 'Công nghệ thông tin',
      startYear: '2016',
      endYear: '2020',
    },
  ],
  certificates: [],
  projects: [],
  languages: [],
};

const sampleAiAnalysis = {
  total: 82,
  strengths: [
    'Kinh nghiệm sâu với Node.js và TypeScript',
    'Track record rõ ràng về tối ưu hiệu năng (p95 800ms → 180ms)',
  ],
  weaknesses: [
    'Thiếu chứng chỉ cloud (AWS/GCP)',
  ],
  suggestions: [
    'Thêm chứng chỉ AWS Solutions Architect để tăng điểm cloud',
    'Bổ sung số liệu đo lường cụ thể cho từng project',
  ],
  verificationWarnings: [],
};

const main = async (): Promise<void> => {
  const userRes = await pool.query('SELECT id FROM users WHERE email = $1', [TEST_EMAIL]);
  if (!userRes.rowCount) {
    throw new Error(`Test user ${TEST_EMAIL} not found — run make-test-user.ts first`);
  }
  const candidateId = userRes.rows[0].id;

  const existing = await pool.query(
    `SELECT id FROM cvs WHERE candidate_id = $1 AND source = 'direct' AND status = 'ready' LIMIT 1`,
    [candidateId],
  );

  if (existing.rowCount) {
    console.log(`[OK] Test CV already exists: ${existing.rows[0].id}`);
    console.log(`     candidate_id: ${candidateId}`);
  } else {
    const inserted = await pool.query(
      `INSERT INTO cvs (
        candidate_id, title, source, status, template_id, is_primary,
        parsed_data, ai_analysis, score_updated_at, created_at, updated_at
      ) VALUES ($1, $2, 'direct', 'ready', 1, true, $3::jsonb, $4::jsonb, NOW(), NOW(), NOW())
      RETURNING id`,
      [
        candidateId,
        '[E2E Test] Nguyễn Văn A - Backend Developer',
        JSON.stringify(sampleParsedData),
        JSON.stringify(sampleAiAnalysis),
      ],
    );
    console.log(`[OK] Created ready direct CV for ${TEST_EMAIL}: ${inserted.rows[0].id}`);
  }
  await pool.end();
};

main().catch((e) => { console.error(e); process.exit(1); });