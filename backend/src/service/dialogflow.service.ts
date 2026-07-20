/**
 * Dialogflow service — webhook fulfillment cho chatbot
 */
import { db } from '../config/database';
import { applications, jobs, companies } from '../db/schema';
import { eq, desc, sql } from 'drizzle-orm';
import { redis } from '../config/redis';
import { logger } from '../config/logger';

export const dialogflowService = {
  /** Xử lý webhook từ Dialogflow */
  handleWebhook: async (queryResult: any): Promise<string> => {
    const intent = queryResult.intent?.displayName;
    const params = queryResult.parameters ?? {};
    const outputContexts = queryResult.outputContexts ?? [];

    switch (intent) {
      case 'ask_how_to_apply':
        return 'Để apply: 1) Tạo tài khoản, 2) Upload CV, 3) Tìm job phù hợp, 4) Click Apply. Bạn cần hỗ trợ thêm bước nào?';

      case 'ask_company_info': {
        const name = params.company;
        const cacheKey = `company:${name}`;
        const cached = await redis.get(cacheKey);
        if (cached) return cached;

        const company = await db.query.companies.findFirst({
          where: sql`${companies.name} ILIKE ${`%${name}%`}`,
        });
        const reply = company
          ? `${company.name} — ${company.industry}. ${company.description?.slice(0, 200) ?? ''}`
          : `Không tìm thấy công ty "${name}".`;
        await redis.setex(cacheKey, 3600, reply);
        return reply;
      }

      case 'ask_status': {
        // Lấy email từ context
        const emailCtx = outputContexts.find((c: any) => c.name.endsWith('/email_context'));
        const email = emailCtx?.parameters?.email;
        if (!email) return 'Bạn vui lòng cung cấp email để tra cứu trạng thái.';

        const apps = await db.query.applications.findMany({
          where: sql`${applications.candidateId} IN (SELECT id FROM users WHERE email = ${email})`,
          with: { job: { with: { company: true } } },
          orderBy: [desc(applications.appliedAt)],
          limit: 5,
        });
        if (apps.length === 0) return `Email ${email} chưa apply job nào.`;
        return apps.map((a) => `• ${a.job.title} @ ${a.job.company.name}: ${a.status}`).join('\n');
      }

      case 'ask_salary': {
        // Aggregate từ DB
        const position = params.position;
        const location = params.location;
        const cacheKey = `salary:${position}:${location ?? ''}`;
        const cached = await redis.get(cacheKey);
        if (cached) return cached;

        const result = await db.select({
          avg: sql<number>`AVG((${jobs.salaryMin} + ${jobs.salaryMax}) / 2)::int`,
          min: sql<number>`MIN(${jobs.salaryMin})::int`,
          max: sql<number>`MAX(${jobs.salaryMax})::int`,
          count: sql<number>`COUNT(*)::int`,
        }).from(jobs).where(sql`${jobs.title} ILIKE ${`%${position}%`}`);

        if (!result[0]?.count) return `Chưa có data lương cho vị trí "${position}".`;
        const reply = `${position}: trung bình ${(result[0].avg! / 1_000_000).toFixed(0)} triệu, range ${(result[0].min! / 1_000_000).toFixed(0)}-${(result[0].max! / 1_000_000).toFixed(0)} triệu (từ ${result[0].count} jobs).`;
        await redis.setex(cacheKey, 3600, reply);
        return reply;
      }

      case 'ask_skill_required': {
        const jobTitle = params.jobTitle;
        const job = await db.query.jobs.findFirst({
          where: sql`${jobs.title} ILIKE ${`%${jobTitle}%`}`,
          orderBy: [desc(jobs.publishedAt)],
        });
        if (!job) return `Không tìm thấy job "${jobTitle}".`;
        const skills = (job.requiredSkills as string[]) ?? [];
        return `${job.title} yêu cầu: ${skills.join(', ')}. Kinh nghiệm: ${job.experienceYearsMin ?? 'N/A'}-${job.experienceYearsMax ?? 'N/A'} năm.`;
      }

      case 'escalate_to_human':
        return 'Đã tạo yêu cầu hỗ trợ. HR sẽ liên hệ bạn trong 24h. Cảm ơn bạn đã kiên nhẫn!';

      default:
        return 'Xin lỗi, mình chưa hiểu. Bạn có thể hỏi: "làm sao để apply", "lương vị trí X", "công ty Y ở đâu"...';
    }
  },
};