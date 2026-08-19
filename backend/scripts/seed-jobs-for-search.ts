/**
 * Seed jobs mẫu để test search (keyword + semantic).
 *
 * Tạo 25 jobs với nội dung đa dạng (backend / frontend / mobile / data / devops ...),
 * status='live' + embedding sẵn → search thấy ngay.
 *
 * Chạy:  npx tsx scripts/seed-jobs-for-search.ts
 * Reset:  npx tsx scripts/seed-jobs-for-search.ts --reset   (xóa jobs cũ trước)
 */
import 'dotenv/config';
import { db, pool } from '../src/config/database';
import { users, companies, jobs, embeddings } from '../src/db/schema';
import { eq, sql, and } from 'drizzle-orm';
import { logger } from '../src/config/logger';
import { upsertJobEmbedding } from '../src/lib/llm/jobEmbedding';
import bcrypt from 'bcrypt';

// === Config ===
const TEST_USER_EMAIL = 'seed-employer@jobmatch.vn';
const TEST_COMPANY_NAME = 'JobMatch Test Co.';
const SLUG_PREFIX = 'seed-test-';

// === Test data (25 jobs đa dạng) ===
const SAMPLE_JOBS = [
  // BACKEND (5)
  { title: 'Senior Backend Developer (Node.js, NestJS)', level: 'senior', city: 'Hồ Chí Minh', desc: 'Thiết kế và phát triển hệ thống backend cho nền tảng fintech. Làm việc với microservices, message queue, distributed systems.', req: '4+ năm Node.js, thành thạo TypeScript, PostgreSQL, Redis, Kafka, Docker. Kinh nghiệm thiết kế high-throughput API.' },
  { title: 'Backend Engineer Python/Django', level: 'mid', city: 'Hà Nội', desc: 'Phát triển REST API cho hệ thống e-commerce quy mô lớn. Tích hợp payment gateway, shipping, inventory.', req: '2+ năm Python/Django, PostgreSQL, Celery, Redis. Có kinh nghiệm AWS là lợi thế.' },
  { title: 'Junior Java Developer (Spring Boot)', level: 'fresher', city: 'Đà Nẵng', desc: 'Tham gia phát triển core banking system cho khách hàng Nhật Bản. Code review chặt chẽ, mentor 1-1.', req: 'Tốt nghiệp ĐH chuyên ngành CNTT, nắm vững Java core, OOP, SQL. Biết Spring Boot là plus.' },
  { title: 'Golang Backend Engineer', level: 'senior', city: 'Hồ Chí Minh', desc: 'Xây dựng payment processing system xử lý 10K+ TPS. Performance optimization là yếu tố sống còn.', req: '3+ năm Go, hiểu sâu concurrency, goroutine, channel. Kinh nghiệm với gRPC, Protocol Buffers.' },
  { title: 'PHP Laravel Developer', level: 'mid', city: 'Hồ Chí Minh', desc: 'Maintain và phát triển CMS cho 50+ khách hàng doanh nghiệp. Làm việc với team frontend Việt + Nhật.', req: '2+ năm PHP/Laravel, MySQL, Redis. Có khả năng đọc hiểu tiếng Nhật cơ bản.' },

  // FRONTEND (5)
  { title: 'Senior Frontend Engineer (React, Next.js)', level: 'senior', city: 'Hồ Chí Minh', desc: 'Dẫn dắt team frontend xây dựng SaaS dashboard cho enterprise customers. Performance + UX là ưu tiên hàng đầu.', req: '4+ năm React, Next.js, TypeScript. Thành thạo state management (Redux Toolkit, Zustand). Có portfolio cá nhân.' },
  { title: 'Vue.js Developer (Nuxt 3)', level: 'mid', city: 'Hà Nội', desc: 'Phát triển landing page và web app cho khách hàng Nhật. UI/UX design sense tốt.', req: '2+ năm Vue.js, Nuxt 3, TailwindCSS. Có khả năng giao tiếp tiếng Nhật (N3 trở lên).' },
  { title: 'Angular Developer (Remote)', level: 'mid', city: 'Remote', desc: 'Làm việc remote 100% cho công ty fintech Singapore. Build trading platform UI phức tạp.', req: '3+ năm Angular, RxJS, NgRx. Tiếng Anh giao tiếp tốt. Working hours overlap 4h với GMT+8.' },
  { title: 'Fresher Frontend Developer (React)', level: 'fresher', city: 'Hồ Chí Minh', desc: 'Đào tạo bài bản 3 tháng, sau đó làm việc thật với team product.', req: 'Tốt nghiệp ĐH/CĐ, biết React cơ bản. Yêu thích học hỏi, không ngại task khó.' },
  { title: 'Frontend Lead (React + TypeScript)', level: 'lead', city: 'Hà Nội', desc: 'Quản lý team 6-8 người, định hướng kỹ thuật frontend cho product có 2M+ MAU.', req: '5+ năm React, 2+ năm leadership. Kinh nghiệm build design system, CI/CD.' },

  // MOBILE (3)
  { title: 'iOS Developer (Swift, SwiftUI)', level: 'mid', city: 'Hồ Chí Minh', desc: 'Phát triển ứng dụng iOS cho ngân hàng số. App đã có 5M+ downloads trên App Store.', req: '2+ năm Swift, SwiftUI, Combine. Hiểu CoreData, Combine framework.' },
  { title: 'Android Developer (Kotlin, Jetpack Compose)', level: 'mid', city: 'Hồ Chí Minh', desc: 'Làm app e-commerce có 10M+ installs. Modular architecture, multi-module setup.', req: '2+ năm Kotlin, Jetpack Compose, Coroutines, Flow. Kinh nghiệm multi-module.' },
  { title: 'React Native Developer', level: 'mid', city: 'Remote', desc: 'Maintain cross-platform app cho startup Singapore. Codebase mature, có CTO review.', req: '2+ năm React Native, Redux, TypeScript. Tiếng Anh tốt.' },

  // DATA / AI (4)
  { title: 'Data Analyst (SQL, Python, Power BI)', level: 'mid', city: 'Hà Nội', desc: 'Phân tích data khách hàng cho team marketing & product. Dashboard hàng ngày cho C-level.', req: '2+ năm SQL, Python (Pandas), Power BI hoặc Tableau. Tư duy logic, storytelling tốt.' },
  { title: 'Senior Data Engineer (Spark, Airflow)', level: 'senior', city: 'Hồ Chí Minh', desc: 'Xây dựng data lake + data warehouse cho hệ thống 500GB data/ngày.', req: '4+ năm Spark, Airflow, Kafka, BigQuery/Snowflake. Kinh nghiệm data modeling, ETL.' },
  { title: 'Machine Learning Engineer', level: 'mid', city: 'Hồ Chí Minh', desc: 'Phát triển recommendation system cho nền tảng e-commerce. A/B testing framework chuẩn chỉnh.', req: '2+ năm ML, Python, PyTorch/TensorFlow. Có publication trên arxiv là lợi thế.' },
  { title: 'Junior Data Scientist', level: 'fresher', city: 'Hồ Chí Minh', desc: 'Hỗ trợ senior xây dựng predictive model cho churn prediction, fraud detection.', req: 'Tốt nghiệp ĐH ngành CNTT/Toán/Cơ học. Nắm vững statistics, Python, scikit-learn.' },

  // DEVOPS (3)
  { title: 'DevOps Engineer (Kubernetes, AWS)', level: 'senior', city: 'Hồ Chí Minh', desc: 'Quản lý EKS cluster 100+ microservices. CI/CD pipeline với GitOps approach.', req: '4+ năm K8s, AWS (EKS, RDS, S3), Terraform, ArgoCD. On-call rotation 1 tuần/tháng.' },
  { title: 'Site Reliability Engineer (SRE)', level: 'senior', city: 'Hà Nội', desc: 'Đảm bảo SLA 99.99% cho payment system. Chaos engineering, observability stack.', req: '4+ năm Linux, Prometheus, Grafana, ELK. Tư duy automation-first.' },
  { title: 'Junior DevOps (CI/CD focus)', level: 'fresher', city: 'Hồ Chí Minh', desc: 'Hỗ trợ team xây dựng CI/CD pipeline, tối ưu build time từ 20 phút xuống 5 phút.', req: 'Biết Docker cơ bản, Git. Có kinh nghiệm open source là điểm cộng.' },

  // QA + PM + DESIGN (3)
  { title: 'Senior QA Automation Engineer (Playwright)', level: 'senior', city: 'Hồ Chí Minh', desc: 'Xây dựng test framework E2E cho product SaaS. Coverage hiện tại 70% → mục tiêu 90%.', req: '3+ năm Playwright/Cypress, TypeScript. CI/CD integration.' },
  { title: 'Product Manager (B2B SaaS)', level: 'mid', city: 'Hà Nội', desc: 'Định hướng sản phẩm cho doanh nghiệp SME. Roadmap quarterly, discovery liên tục với users.', req: '3+ năm PM B2B SaaS. Kỹ năng data-driven decision, stakeholder management.' },
  { title: 'UI/UX Designer (Figma)', level: 'mid', city: 'Hồ Chí Minh', desc: 'Thiết kế flow cho mobile banking app. Design system chuẩn, specification rõ ràng cho dev.', req: '3+ năm Figma, design system. Portfolio có 3+ case study B2C app.' },
] as const;

const slugify = (s: string): string =>
  s.toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);

// === Main ===
const seed = async (): Promise<void> => {
  const isReset = process.argv.includes('--reset');

  logger.info(`🌱 Bắt đầu seed ${SAMPLE_JOBS.length} jobs...`);

  // 1. Reset nếu có flag
  if (isReset) {
    logger.info('🗑  Reset: xóa jobs + embeddings cũ (slug prefix)');
    await db.delete(embeddings).where(
      and(
        eq(embeddings.contentType, 'job'),
        sql`${embeddings.contentId} IN (SELECT id FROM jobs WHERE slug LIKE ${SLUG_PREFIX + '%'})`,
      ),
    );
    await db.delete(jobs).where(sql`${jobs.slug} LIKE ${SLUG_PREFIX + '%'}`);
  }

  // 2. Lấy test user (tạo nếu chưa có)
  let userId: string;
  const [existingUser] = await db
    .select()
    .from(users)
    .where(eq(users.email, TEST_USER_EMAIL))
    .limit(1);
  if (existingUser) {
    userId = existingUser.id;
    logger.info(`♻️  Reuse user: ${TEST_USER_EMAIL}`);
  } else {
    const passwordHash = await bcrypt.hash('Test@1234', 10);
    const [u] = await db.insert(users).values({
      email: TEST_USER_EMAIL,
      passwordHash,
      role: 'employer',
      status: 'active',
      emailVerifiedAt: new Date(),
    }).returning();
    userId = u.id;
    logger.info(`👤 Created user: ${TEST_USER_EMAIL}`);
  }

  // 3. Lấy test company (tạo nếu chưa có)
  let companyId: string;
  const [existingCompany] = await db
    .select()
    .from(companies)
    .where(eq(companies.name, TEST_COMPANY_NAME))
    .limit(1);
  if (existingCompany) {
    companyId = existingCompany.id;
    logger.info(`♻️  Reuse company: ${TEST_COMPANY_NAME}`);
  } else {
    const [c] = await db.insert(companies).values({
      name: TEST_COMPANY_NAME,
      slug: 'jobmatch-test-co',
      industry: 'IT - Phần mềm',
      sizeRange: '50-100',
      website: 'https://jobmatch.vn',
      status: 'active',
      createdBy: userId,
    }).returning();
    companyId = c.id;
    logger.info(`🏢 Created company: ${TEST_COMPANY_NAME}`);
  }

  // 4. Insert jobs + embed
  let insertedCount = 0;
  let skippedCount = 0;
  let embeddedCount = 0;

  for (const sample of SAMPLE_JOBS) {
    const slug = SLUG_PREFIX + slugify(sample.title);

    // Skip nếu đã tồn tại
    const [existing] = await db
      .select({ id: jobs.id })
      .from(jobs)
      .where(eq(jobs.slug, slug))
      .limit(1);
    if (existing) {
      skippedCount++;
      continue;
    }

    // Insert
    const [job] = await db
      .insert(jobs)
      .values({
        companyId,
        postedBy: userId,
        title: sample.title,
        slug,
        description: sample.desc,
        requirements: sample.req,
        jobLevel: sample.level,
        jobType: 'full-time',
        industry: 'IT - Phần mềm',
        salaryCurrency: 'VND',
        salaryVisible: true,
        location: { city: sample.city },
        remoteOk: sample.city === 'Remote',
        experienceYearsMin: sample.level === 'fresher' ? 0 : sample.level === 'mid' ? 1 : sample.level === 'senior' ? 2 : 4,
        status: 'live', // Live luôn để search thấy ngay
        publishedAt: new Date(),
        viewsCount: Math.floor(Math.random() * 500),
        appliesCount: Math.floor(Math.random() * 50),
      })
      .returning();

    insertedCount++;

    // Embed in-process (nhanh hơn đợi worker)
    try {
      const text = [
        `Tiêu đề: ${sample.title}`,
        `Mô tả: ${sample.desc}`,
        `Yêu cầu: ${sample.req}`,
        `Ngành: IT - Phần mềm`,
        `Địa điểm: ${sample.city}`,
      ].join('\n');
      const result = await upsertJobEmbedding(job.id, text);
      if (result.inserted) embeddedCount++;
      logger.info(`   ✅ Embedded: ${sample.title.slice(0, 50)}...`);
    } catch (err: any) {
      logger.warn({ err: err.message, jobId: job.id }, `   ⚠️  Embed failed (job vẫn search được bằng keyword)`);
    }

    // Sleep nhẹ để không rate-limit Gemini
    await new Promise((r) => setTimeout(r, 300));
  }

  logger.info(
    `\n🎉 Xong! Inserted: ${insertedCount}, Skipped: ${skippedCount}, Embedded: ${embeddedCount}/${insertedCount}`,
  );
  logger.info(`\n📌 Test queries:`);
  logger.info(`   - Keyword:    GET /api/v1/jobs/search?keyword=nodejs+backend`);
  logger.info(`   - Semantic:   GET /api/v1/jobs/search/semantic?query=lập+trình+viên+backend+NodeJS`);
  logger.info(`   - List:       GET /api/v1/jobs`);

  await pool.end();
};

seed().catch((err) => {
  logger.fatal({ err }, 'Seed failed');
  process.exit(1);
});