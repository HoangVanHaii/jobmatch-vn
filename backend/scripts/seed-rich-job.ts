/**
 * Seed 1 job "đầy đủ mọi field, text dài" — dùng để demo JobDetailView với data phong phú.
 *
 * Không tạo company/user mới — dùng `e2e-employer@jobmatch.vn` + `acme-vietnam`
 * (đã seed bởi seed-org). Idempotent: skip nếu slug đã tồn tại.
 *
 * Run:  cd backend && npx tsx scripts/seed-rich-job.ts
 */
import 'dotenv/config';
import { db, pool } from '../src/config/database';
import { users, companies, jobs, embeddings } from '../src/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { logger } from '../src/config/logger';
import { buildJobEmbeddingText, upsertJobEmbedding } from '../src/lib/llm/jobEmbedding';

const COMPANY_DESCRIPTION = `Về Acme Vietnam

Acme Vietnam là chi nhánh Đông Nam Á của Acme Group — tập đoàn công nghệ toàn cầu có trụ sở chính tại Singapore, văn phòng đại diện tại 12 quốc gia và hơn 3.500 nhân viên trên toàn thế giới. Chúng tôi xây dựng các sản phẩm fintech, edtech, và SaaS phục vụ hơn 50 triệu người dùng cuối.

Đội ngũ Vietnam (120+ người) tập trung vào Design Systems, AI matching engine cho thị trường lao động, và platform infrastructure. Văn phòng HCM là một trong ba engineering hub chính của tập đoàn — được đầu tư trang thiết bị hiện đại và culture engineering tương đương Singapore/Bangalore.

Văn hóa làm việc

- Transparent: mọi quyết định chiến lược được chia sẻ rõ ràng với toàn team qua monthly all-hands.
- Outcome-driven: chúng tôi đo lường bằng giá trị thực tế mang lại cho user, không phải bằng output.
- Continuous learning: budget $2,000/năm/người cho khóa học, conference, sách — không cần xin phép.
- Async-first: các team cross-region làm việc chủ yếu bằng document và async update, meeting chỉ khi thật sự cần.

Sản phẩm tiêu biểu

- AcmePay: Ví điện tử và payment gateway cho SMEs Đông Nam Á (12M users).
- AcmeLearn: Nền tảng edtech với AI tutor cá nhân hoá (5M users).
- AcmeMatch: AI matching engine cho thị trường tuyển dụng (đang phát triển).`;

const EMPLOYER_EMAIL = 'employer@jobmatch.vn';
const COMPANY_SLUG = 'acme-vietnam';
const SLUG = 'acme-senior-product-designer-accessibility';

const TITLE = 'Senior Product Designer (Accessibility Focus)';
const LEVEL = 'senior' as const;
const TYPE = 'full-time' as const;
const INDUSTRY = 'Information Technology & Services';

const DESCRIPTION = `Về vị trí

Chúng tôi đang tìm kiếm một Senior Product Designer có tâm huyết với accessibility để gia nhập đội ngũ Design Systems của Acme Vietnam. Đây là cơ hội hiếm có để bạn xây dựng nền tảng design ảnh hưởng đến hơn 2 triệu người dùng mỗi tháng trên toàn Đông Nam Á — bao gồm các nhóm người dùng yếu thế như người khiếm thị, người cao tuổi, và người dùng thiết bị di động cấu hình thấp.

Bạn sẽ làm việc trực tiếp với đội ngũ Engineering, Accessibility Specialists, và Product Managers để thiết lập các nguyên tắc accessibility từ giai đoạn khám phá (Discovery) cho đến khi release. Vai trò này không chỉ yêu cầu đôi tay thiết kế điêu luyện mà còn đòi hỏi tư duy hệ thống (systems thinking), khả năng truyền đạt rõ ràng, và sự kiên nhẫn trong việc mentorship các designer khác.

Trách nhiệm chính

1. Thiết lập và phát triển các nguyên tắc, tiêu chuẩn, và best practices về accessibility cho toàn bộ product suite — bao gồm web, iOS, Android, và email.
2. Đánh giá (audit) và tái cấu trúc các flow hiện hữu để đạt WCAG 2.2 Level AA trở lên; xây dựng roadmap ưu tiên dựa trên impact vs. effort.
3. Xây dựng & duy trì Design System với các component tích hợp sẵn accessibility primitives (focus management, ARIA labels, keyboard navigation, color contrast).
4. Phối hợp với đội ngũ User Research để tổ chức các buổi usability testing với người dùng khuyết tật — ghi nhận pain points và đề xuất giải pháp thiết kế.
5. Mentor 2-3 mid-level designer về accessibility mindset; dẫn dắt workshop nội bộ mỗi quý để nâng cao awareness toàn team.
6. Đại diện team Design trong các cuộc họp với Engineering Leadership, đóng góp vào product roadmap từ góc nhìn inclusive design.
7. Viết documentation (patterns library, decision records) để đảm bảo kiến thức không bị "bus factor" rủi ro.

Bạn sẽ thành công nếu

- Bạn có portfolio thể hiện được quá trình thiết kế từ research → wireframe → high-fidelity, đặc biệt với các case study có đề cập đến accessibility hoặc inclusive design.
- Bạn có khả năng đọc hiểu và áp dụng WCAG 2.1/2.2, ARIA Authoring Practices, và các tiêu chuẩn liên quan.
- Bạn đã từng làm việc với screen reader (NVDA, VoiceOver, TalkBack) và hiểu rõ cách người dùng tương tác với assistive technology.
- Bạn có khả năng thuyết trình và viết documentation rõ ràng bằng tiếng Anh (Tiếng Việt là lợi thế nhưng không bắt buộc).
- Bạn yêu thích làm việc với engineer — không ngại thảo luận về implementation constraints và đề xuất giải pháp thực tế.

Môi trường làm việc

- Hybrid: 2-3 ngày onsite tại văn phòng TP.HCM (Quận 1), các ngày còn lại làm remote. Có hỗ trợ setup home office (laptop, màn hình, bàn ghế ergonomic).
- Team 12 designer, phân chia theo product tribe. Bạn sẽ làm việc chéo với cả 3 tribe để đảm bảo tính nhất quán.
- Công cụ: Figma (primary), Notion (documentation), Maze (usability testing), Storybook (component preview).
- On-call design review: 1 tuần/quý, nhẹ nhàng — chủ yếu là review pull request từ engineering.

Cơ hội phát triển

- Được đi công tác 2-3 lần/năm để tham dự các hội nghị accessibility (CSUN, axe-con, A11yTO) — công ty tài trợ 100% chi phí.
- Budget cá nhân $2,000/năm cho sách, khóa học, hoặc conference liên quan.
- Lộ trình thăng tiến rõ ràng: Senior → Staff → Principal Designer trong vòng 3-5 năm nếu đạt performance tốt.`;

const REQUIREMENTS = `Yêu cầu bắt buộc

- 4+ năm kinh nghiệm Product Design ở môi trường product tech (SaaS, fintech,
  hoặc edtech).
- Portfolio có ít nhất 3 case study end-to-end (research → ship), trong đó
  tối thiểu 1 case có đề cập đến accessibility hoặc người dùng khuyết tật.
- Thành thạo Figma ở mức advanced — auto-layout, variants, design tokens,
  component properties, và plugin workflow.
- Có kinh nghiệm làm việc với engineering team hiểu biết về HTML/CSS/JS ở mức
  có thể review pull request và đề xuất giải pháp accessible markup.
- Tiếng Anh giao tiếp tốt (B2 trở lên) — bạn sẽ làm việc trực tiếp với 3
  stakeholder người Singapore và 1 partner ở Úc.

Yêu cầu ưu tiên (nice-to-have)

- Đã từng xây dựng hoặc maintain design system phục vụ 50+ designer.
- Có kinh nghiệm dạy, mentor, hoặc viết blog/article về design.
- Background trong Psychology, Cognitive Science, hoặc HCI (Master trở lên
  là điểm cộng lớn).
- Đã từng làm việc với các tiêu chuẩn quốc tế: WCAG, EN 301 549, Section 508.
- Kinh nghiệm motion design hoặc prototyping animation (Principle, Rive,
  After Effects).
- Có khả năng đọc code React/Vue cơ bản để giao tiếp hiệu quả với engineer.

Quy trình phỏng vấn

1. Screening call 30 phút với HR (30 phút) — giới thiệu công ty, hiểu về bạn.
2. Portfolio review 60 phút với Design Manager — walk through 2 case study bạn
   chọn, tập trung vào quá trình tư duy và trade-off.
3. Design exercise take-home (4-6 giờ, có bù 2 triệu VND): thiết kế flow
   onboarding cho người dùng khiếm thị trên mobile app.
4. Onsite interview 4 giờ: gồm 3 round (system design, collaboration scenario,
   và accessibility deep-dive với Senior Engineer).
5. Founder chat 30 phút — final round, thảo luận về culture fit và expectation.`;

const BENEFITS = `Chế độ lương & thưởng

- Mức lương: $2,500 – $3,800 gross/tháng (tương đương 65 – 100 triệu VND),
  tuỳ theo kinh nghiệm và năng lực. Review lương 2 lần/năm (tháng 4 và tháng 10).
- Bonus hiệu suất: 10-15% annual salary dựa trên KPI cá nhân + công ty.
- Stock options (ESOP) sau 1 năm làm việc — vesting 4 năm, cliff 1 năm.
- 13th month salary (tháng lương thứ 13) theo quy định pháp luật VN.
- Đóng BHXH, BHYT, BHTN đầy đủ theo quy định; ngoài ra có bảo hiểm sức khoẻ
  private (PVI Care) cho cả gia đình — công ty chi trả 100% premium.

Phúc lợi nhân viên

- 15 ngày phép năm + 5 ngày phép ốm có lương (sau 6 tháng).
- 12 ngày WFH/tháng (sau thời gian thử việc), không cần xin phép.
- Cấp MacBook Pro 16" M3 Max + màn hình LG UltraFine 5K + bàn ghế ergonomic
  (chọn từ catalog OKA hoặc tương đương).
- Budget home office setup $1,000 (one-time) cho nhân viên mới.
- Cấp membership LinkedIn Learning ($30/tháng) và Coursera Plus ($60/năm).
- Bữa trưa miễn phí tại văn phòng (cơm văn phòng + salad bar) — $5/ngày budget.
- Snack, cà phê, beer fridge thoải mái tại pantry.

Hoạt động team & văn hoá

- Company offsite 2 lần/năm (3-4 ngày, địa điểm thay đổi: Đà Lạt, Phú Quốc,
  Bangkok, ...).
- Team building monthly (budget $50/người).
- Design guild weekly — sharing session nội bộ + guest speaker mỗi tháng.
- Wellness program: ứng dụng Headspace + $50/tháng cho gym/yoga bất kỳ.
- Pet-friendly office (chó/mèo đều welcome sau khi đăng ký với HR).

Chương trình phát triển

- Lộ trình thăng tiến rõ ràng: Senior → Staff → Principal Designer trong 3-5 năm.
- Budget $2,000/năm cho cá nhân (sách, khoá học, conference).
- Sponsorship đi conference accessibility 2-3 lần/năm (CSUN, axe-con, A11yTO).
- Chương trình mentorship chéo với senior ở team khác (Engineering, Product).
- Cơ hội luân chuyển nội bộ sau 18 tháng nếu muốn thử sức với team khác.`;

const REQUIRED_SKILLS = [
  'Product Design',
  'Figma',
  'Design Systems',
  'Accessibility (WCAG 2.2)',
  'User Research',
  'Prototyping',
  'Wireframing',
  'Information Architecture',
];

const NICE_TO_HAVE_SKILLS = [
  'Motion Design',
  'HTML/CSS',
  'React',
  'Storybook',
  'Usability Testing',
  'Inclusive Design',
];

async function main(): Promise<void> {
  const [employer] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, EMPLOYER_EMAIL))
    .limit(1);
  if (!employer) {
    throw new Error(
      `Không tìm thấy employer ${EMPLOYER_EMAIL}. Chạy 'npm run db:seed:org' trước.`,
    );
  }

  const [company] = await db
    .select({ id: companies.id })
    .from(companies)
    .where(eq(companies.slug, COMPANY_SLUG))
    .limit(1);
  if (!company) {
    throw new Error(
      `Không tìm thấy company ${COMPANY_SLUG}. Chạy 'npm run db:seed:org' trước.`,
    );
  }

  // Enrich company fields — đảm bảo Company tab trong JobDetailView có data đầy đủ.
  await db.execute(sql`
    UPDATE companies SET
      logo_url = 'https://logo.clearbit.com/acme.com',
      description = ${COMPANY_DESCRIPTION},
      industry = 'Information Technology & Services',
      size_range = '100-500',
      website = 'https://acme.com/vn',
      social = ${sql.raw(`'{"linkedin":"https://linkedin.com/company/acme-vietnam","github":"https://github.com/acme-vietnam","twitter":"https://twitter.com/acme_vn"}'::jsonb`)},
      address = ${sql.raw(`'{"city":"Hồ Chí Minh","district":"Quận 1","address":"Tầng 15, Tòa nhà Bitexco Financial Tower, 2 Hải Triều","country":"Vietnam","lat":10.7717,"lng":106.7009}'::jsonb`)},
      metadata = ${sql.raw(`'{"founded":2018,"teamSize":120,"hq":"Singapore","culture":["async-first","transparent","outcome-driven"]}'::jsonb`)}
    WHERE id = ${company.id}
  `);

  // Idempotent — skip nếu slug đã tồn tại.
  const [existing] = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(eq(jobs.slug, SLUG))
    .limit(1);

  if (existing) {
    logger.info({ slug: SLUG, jobId: existing.id }, 'Seed: job đã tồn tại, skip');
    return;
  }

  const now = new Date();
  const deadline = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // +30 ngày

  const [created] = await db
    .insert(jobs)
    .values({
      companyId: company.id,
      postedBy: employer.id,
      title: TITLE,
      slug: SLUG,
      description: DESCRIPTION,
      requirements: REQUIREMENTS,
      benefits: BENEFITS,
      jobLevel: LEVEL,
      jobType: TYPE,
      industry: INDUSTRY,
      salaryMin: '25000000', // 25 triệu VND
      salaryMax: '38000000', // 38 triệu VND
      salaryCurrency: 'VND',
      salaryVisible: true,
      location: {
        city: 'Hồ Chí Minh',
        district: 'Quận 1',
        address: 'Văn phòng Acme, Tầng 15, Tòa nhà Bitexco',
        lat: 10.7717,
        lng: 106.7009,
      },
      remoteOk: true,
      experienceYearsMin: 4,
      experienceYearsMax: 8,
      requiredSkills: REQUIRED_SKILLS,
      niceToHaveSkills: NICE_TO_HAVE_SKILLS,
      deadline,
      status: 'live',
      featured: true,
      featuredUntil: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000),
      viewsCount: 1847,
      appliesCount: 154,
      publishedAt: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
      extraData: {
        perks: ['ESOP', 'WFH', 'MacBook Pro'],
        hiringManagerName: 'Trần Thị Mai',
        hiringManagerEmail: 'mai.tran@acme.vn',
        teamSize: 12,
        reportsTo: 'Design Director',
      },
    })
    .returning({ id: jobs.id });

  if (!created) throw new Error('Insert job failed');

  // Update searchTsv + embedding cho search.
  const embedText = buildJobEmbeddingText({
    title: TITLE,
    description: DESCRIPTION,
    requirements: REQUIREMENTS,
    requiredSkills: REQUIRED_SKILLS,
    niceToHaveSkills: NICE_TO_HAVE_SKILLS,
    benefits: BENEFITS,
    industry: INDUSTRY,
    location: {
      city: 'Hồ Chí Minh',
      district: 'Quận 1',
      address: 'Văn phòng Acme, Tầng 15, Tòa nhà Bitexco',
    },
  });
  await upsertJobEmbedding(created.id, embedText);

  logger.info(
    {
      jobId: created.id,
      slug: SLUG,
      title: TITLE,
      descriptionChars: DESCRIPTION.length,
      requirementsChars: REQUIREMENTS.length,
      benefitsChars: BENEFITS.length,
    },
    'Seed: job đầy đủ field đã tạo',
  );
}

main()
  .catch((err) => {
    logger.error({ err }, 'Seed rich job failed');
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });
