/**
 * Seed 5 CV direct (1 mẫu / templateId 1-5) cho mỗi candidate.
 *
 * Mục đích: MyResumesView render CV THẬT trên thumbnail → cần parsedData đầy đủ
 * + ai_analysis để hiện AI score pill, không phụ thuộc worker/Gemini/quota.
 *
 * Chạy:   npx tsx scripts/seed-cvs.ts
 *         npx tsx scripts/seed-cvs.ts --email=candidate@example.com   (chỉ 1 user)
 *
 * Idempotent: skip theo (candidateId, title) với title prefix "[Mẫu] ".
 * Chạy nhiều lần an toàn — không duplicate.
 *
 * Primary invariant: nếu candidate CHƯA có CV primary (status<>'deleted'),
 * set mẫu template 1 làm primary. Không động vào primary đã có (CV thật của user).
 */
import 'dotenv/config';
import { db, pool } from '../src/config/database';
import { users, cvs } from '../src/db/schema';
import { and, eq, like, sql } from 'drizzle-orm';
import { logger } from '../src/config/logger';

const SEED_TITLE_PREFIX = '[Mẫu] ';

type SeedPersona = {
  templateId: 1 | 2 | 3 | 4 | 5;
  title: string;
  score: number;
  parsed: NonNullable<typeof cvs.$inferSelect.parsedData>;
};

const SEED_PERSONAS: SeedPersona[] = [
  {
    templateId: 1,
    title: 'Backend Developer (Node.js)',
    score: 86,
    parsed: {
      name: 'Nguyễn Văn A',
      email: 'nguyenvana@example.com',
      phone: '+84 912 345 678',
      github: 'https://github.com/nguyenvana',
      linkedin: 'https://linkedin.com/in/nguyenvana',
      summary:
        'Backend developer 3 năm kinh nghiệm Node.js/TypeScript, tập trung API hiệu năng cao và hệ thống hàng đợi.',
      education: [
        { school: 'ĐH Bách Khoa Hà Nội', degree: 'Cử nhân', major: 'Khoa học máy tính', startYear: 2016, endYear: 2020, description: 'GPA 3.4/4.0' },
      ],
      experience: [
        { company: 'FPT Software', position: 'Backend Developer', startDate: '01/2021', endDate: null, description: 'Xây dựng REST API cho hệ thống fintech, tối ưu p95 từ 800ms xuống 180ms.' },
        { company: 'VNG', position: 'Junior Developer', startDate: '06/2020', endDate: '12/2020', description: 'Phát triển service nội bộ với Express + PostgreSQL.' },
      ],
      skills: ['Node.js', 'TypeScript', 'PostgreSQL', 'Redis', 'Docker', 'BullMQ'],
      languages: [{ language: 'Tiếng Anh', proficiency: 'TOEIC 800' }],
      projects: [{ name: 'JobMatch Queue Worker', description: 'Worker BullMQ xử lý 50K job/ngày.', link: 'https://github.com/nguyenvana/queue-worker' }],
      certifications: [{ name: 'AWS Certified Developer', issuer: 'Amazon', date: '2023' }],
    },
  },
  {
    templateId: 2,
    title: 'Frontend Developer (Vue 3)',
    score: 78,
    parsed: {
      name: 'Trần Thị B',
      email: 'tranthib@example.com',
      phone: '+84 909 111 222',
      github: 'https://github.com/tranthib',
      portfolio: 'https://tranthib.dev',
      summary: 'Frontend developer yêu thích Vue ecosystem, 2 năm kinh nghiệm xây dựng SaaS dashboard và design system.',
      education: [{ school: 'ĐH CNTT (UIT)', degree: 'Cử nhân', major: 'Kỹ thuật phần mềm', startYear: 2017, endYear: 2021, description: 'Chuyên ngành Kỹ thuật phần mềm' }],
      experience: [
        { company: 'Tiki', position: 'Frontend Developer', startDate: '03/2022', endDate: null, description: 'Phát triển seller dashboard với Vue 3 + Pinia, tăng conversion 12%.' },
        { company: 'VNG', position: 'Frontend Intern', startDate: '09/2021', endDate: '02/2022', description: 'Maintain component library nội bộ.' },
      ],
      skills: ['Vue 3', 'Pinia', 'TypeScript', 'Vite', 'Tailwind CSS', 'Vitest'],
      projects: [{ name: 'JobMatch Candidate Portal', description: 'SPA Vue 3 + Vite, render 1000+ CV mượt mà.', link: 'https://github.com/tranthib/cv-portal' }],
      certifications: [{ name: 'Vue 3 Certified Developer', issuer: 'Vue School', date: '2024' }],
    },
  },
  {
    templateId: 3,
    title: 'Data Analyst',
    score: 64,
    parsed: {
      name: 'Lê Văn C',
      email: 'levanc@example.com',
      phone: '+84 988 777 666',
      summary: 'Data Analyst 2 năm kinh nghiệm SQL + BI, thích kể chuyện bằng dữ liệu.',
      education: [{ school: 'ĐH Kinh tế Quốc dân', degree: 'Cử nhân', major: 'Tài chính - Ngân hàng', startYear: 2018, endYear: 2022, description: 'Chuyên ngành phân tích tài chính' }],
      experience: [
        { company: 'Masan Group', position: 'Data Analyst', startDate: '02/2023', endDate: null, description: 'Xây dựng báo cáo tự động cho sales team, tiết kiệm 20h/tuần.' },
      ],
      skills: ['SQL', 'Python', 'Power BI', 'Excel', 'Tableau'],
      projects: [{ name: 'Sales Funnel Dashboard', description: 'Power BI dashboard theo dõi funnel 5 stages, refresh 4h/lần.' }],
      certifications: [{ name: 'Google Data Analytics', issuer: 'Coursera', date: '2023' }],
    },
  },
  {
    templateId: 4,
    title: 'DevOps Engineer',
    score: 91,
    parsed: {
      name: 'Phạm Thị D',
      email: 'phamthid@example.com',
      phone: '+84 901 234 567',
      github: 'https://github.com/phamthid',
      linkedin: 'https://linkedin.com/in/phamthid',
      summary: 'DevOps engineer 4 năm kinh nghiệm Kubernetes + AWS, xây platform cho 50+ microservices.',
      education: [{ school: 'ĐH Bách Khoa TP.HCM', degree: 'Kỹ sư', major: 'Điện - Điện tử', startYear: 2015, endYear: 2019, description: 'Chuyên ngành Viễn thông' }],
      experience: [
        { company: 'VinAI', position: 'Senior DevOps', startDate: '06/2021', endDate: null, description: 'Thiết kế platform GPU cho ML training, giảm cost 35%.' },
        { company: 'MoMo', position: 'DevOps Engineer', startDate: '01/2020', endDate: '05/2021', description: 'Migrate on-prem sang AWS EKS, zero downtime.' },
      ],
      skills: ['Kubernetes', 'AWS', 'Terraform', 'Docker', 'Helm', 'Prometheus', 'Grafana', 'GitOps'],
      projects: [{ name: 'Multi-region EKS platform', description: 'Terraform + ArgoCD quản lý 3 region AWS.', link: 'https://github.com/phamthid/eks-platform' }],
      certifications: [
        { name: 'CKA', issuer: 'CNCF', date: '2022' },
        { name: 'AWS Solutions Architect Pro', issuer: 'Amazon', date: '2023' },
      ],
    },
  },
  {
    templateId: 5,
    title: 'UI/UX Designer',
    score: 55,
    parsed: {
      name: 'Đỗ Văn E',
      email: 'dovane@example.com',
      phone: '+84 977 888 999',
      portfolio: 'https://dovane.design',
      summary: 'UI/UX Designer 1.5 năm, đam mê design system + accessibility.',
      education: [{ school: 'ĐH Kiến trúc Hà Nội', degree: 'Cử nhân', major: 'Thiết kế đồ hoạ', startYear: 2019, endYear: 2023, description: 'Chuyên ngành Thiết kế số' }],
      experience: [{ company: 'FPT Software', position: 'UI/UX Designer', startDate: '08/2023', endDate: null, description: 'Thiết kế UI cho 3 mobile app fintech.' }],
      skills: ['Figma', 'Sketch', 'After Effects', 'Prototyping', 'Design System'],
      projects: [{ name: 'Fintech Mobile Redesign', description: 'Redesign UX flow on boarding, giảm drop-off 25%.' }],
      certifications: [{ name: 'Google UX Design', issuer: 'Coursera', date: '2024' }],
    },
  },
];

const parseArgs = () => {
  const emailFlag = process.argv.find((a) => a.startsWith('--email='));
  return {
    email: emailFlag ? emailFlag.split('=')[1] : undefined,
  };
};

async function seed(): Promise<void> {
  const args = parseArgs();

  // 1. Resolve candidates
  const candidates = args.email
    ? await db
        .select()
        .from(users)
        .where(and(eq(users.email, args.email), eq(users.role, 'candidate')))
        .limit(1)
    : await db
        .select()
        .from(users)
        .where(and(eq(users.role, 'candidate'), sql`${users.deletedAt} IS NULL`))
        .limit(50);

  if (!candidates.length) {
    logger.warn({ email: args.email }, 'No candidates found. Nothing to seed.');
    return;
  }
  logger.info({ count: candidates.length, email: args.email ?? 'ALL' }, 'Seeding CVs for candidates');

  let inserted = 0;
  let skipped = 0;
  let primaryPromoted = 0;

  for (const candidate of candidates) {
    // Existing seed titles for this candidate (idempotency check)
    const existing = await db
      .select({ title: cvs.title })
      .from(cvs)
      .where(and(eq(cvs.candidateId, candidate.id), like(cvs.title, `${SEED_TITLE_PREFIX}%`)));
    const existingTitles = new Set(existing.map((r) => r.title));

    for (const persona of SEED_PERSONAS) {
      const fullTitle = `${SEED_TITLE_PREFIX}${persona.title}`;
      if (existingTitles.has(fullTitle)) {
        skipped++;
        continue;
      }
      await db.insert(cvs).values({
        candidateId: candidate.id,
        title: fullTitle,
        fileUrl: null,
        fileType: null,
        source: 'direct',
        templateId: persona.templateId,
        status: 'ready', // bỏ qua worker/quota — sẵn sàng render ngay
        isPrimary: false, // sẽ set sau nếu candidate chưa có primary
        parsedData: persona.parsed,
        ai_analysis: {
          isCv: true,
          total: persona.score,
          strengths: ['Kinh nghiệm rõ ràng, có số liệu định lượng', 'Kỹ năng khớp JD phổ biến'],
          weaknesses: ['Thiếu mục tiêu nghề nghiệp dài hạn'],
          suggestions: ['Bổ sung kết quả đo lường được cho từng dự án'],
          verificationWarnings: [],
        },
        scoreUpdatedAt: new Date(),
        failureReason: null,
      });
      inserted++;
    }

    // Primary invariant: nếu candidate chưa có primary (status<>'deleted'),
    // promote mẫu template 1 (Backend Developer) làm primary.
    const primaryRows = await db
      .select({ id: cvs.id })
      .from(cvs)
      .where(and(eq(cvs.candidateId, candidate.id), eq(cvs.isPrimary, true), sql`${cvs.status} <> 'deleted'`))
      .limit(1);

    if (primaryRows.length === 0) {
      const tpl1 = await db
        .select({ id: cvs.id })
        .from(cvs)
        .where(and(eq(cvs.candidateId, candidate.id), eq(cvs.templateId, 1), like(cvs.title, `${SEED_TITLE_PREFIX}%`)))
        .limit(1);
      if (tpl1.length) {
        await db.update(cvs).set({ isPrimary: true, updatedAt: new Date() }).where(eq(cvs.id, tpl1[0].id));
        primaryPromoted++;
      }
    }
  }

  logger.info(
    { inserted, skipped, primaryPromoted, candidates: candidates.length },
    'Seed CVs complete',
  );
  logger.info('Verify: GET /api/v1/cvs?limit=8 — expect 5+ cards per candidate with different templates');
}

seed()
  .catch((err) => {
    logger.fatal({ err }, 'seed-cvs failed');
    process.exit(1);
  })
  .finally(() => pool.end());