/**
 * Company service — business logic cho CRUD + lifecycle status
 */
import { db } from '../config/database';
import { companies, jobs } from '../db/schema';
import { eq, and, ilike, desc, count } from 'drizzle-orm';
import type { Company, CompanyStatus } from '../interface/company';
import { AppError } from '../middleware/errorHandler';
import type {
  CreateCompanyInput,
  UpdateCompanyInput,
  ListCompaniesQuery,
} from '../interface/company';
import { companyMemberService } from './companyMember.service';

/**
 * Tạo slug thân thiện URL + hỗ trợ tiếng Việt có dấu.
 * "Công ty FPT" -> "cong-ty-fpt"
 */
const slugify = (str: string): string =>
  str
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // bỏ dấu thanh (combining diacritical marks)
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s-]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** Sinh slug không trùng; nếu name không còn ký tự latin thì fallback */
const uniqueSlug = async (name: string): Promise<string> => {
  const base = slugify(name) || `cty-${Date.now()}`;
  let slug = base;
  let n = 1;
  // eslint-disable-next-line no-await-in-loop
  while (
    await db.query.companies.findFirst({
      where: eq(companies.slug, slug),
      columns: { id: true },
    })
  ) {
    n += 1;
    slug = `${base}-${n}`;
  }
  return slug;
};

/** Gắn thêm danh sách job đang live cho trang profile công ty */
const withLiveJobs = async (company: Company) => {
  const companyJobs = await db.query.jobs.findMany({
    where: and(eq(jobs.companyId, company.id), eq(jobs.status, 'live')),
    orderBy: [desc(jobs.publishedAt)],
    limit: 10,
    columns: {
      id: true,
      title: true,
      slug: true,
      jobLevel: true,
      jobType: true,
      salaryMin: true,
      salaryMax: true,
      location: true,
      publishedAt: true,
    },
  });
  return { ...company, jobs: companyJobs };
};

export const companyService = {
  /**
   * List + search/filter + phân trang.
   * Mặc định chỉ trả về company `active` (ẩn banned/removed khỏi public);
   * admin có thể truyền ?status để xem nhóm khác.
   */
  list: async (q: ListCompaniesQuery, viewerRole?: string) => {
    const { search, industry, sizeRange, status, page, limit } = q;

    const effectiveStatus = viewerRole === 'admin' ? (status ?? 'active') : 'active';

    const conditions = [];
    if (search) conditions.push(ilike(companies.name, `%${search}%`));
    if (industry) conditions.push(eq(companies.industry, industry));
    if (sizeRange) conditions.push(eq(companies.sizeRange, sizeRange));
    conditions.push(eq(companies.status, effectiveStatus));
    const where = and(...conditions);

    const offset = (page - 1) * limit;
    const [rows, countRes] = await Promise.all([
      db.query.companies.findMany({
        where,
        orderBy: [desc(companies.createdAt)],
        limit,
        offset,
      }),
      db.select({ count: count() }).from(companies).where(where),
    ]);

    const total = Number(countRes[0]?.count ?? 0);
    return { items: rows, total, page, limit };
  },

  /** Chi tiết theo id + jobs liên quan */
  getById: async (id: string) => {
    const company = await db.query.companies.findFirst({ where: eq(companies.id, id) });
    if (!company) return null;
    return withLiveJobs(company);
  },

  /** Chi tiết theo slug + jobs liên quan */
  getBySlug: async (slug: string) => {
    const company = await db.query.companies.findFirst({ where: eq(companies.slug, slug) });
    if (!company) return null;
    return withLiveJobs(company);
  },

  /** Tạo công ty mới — slug tự sinh, status mặc định 'active', createdBy từ user đăng nhập.
   *  Đồng thời insert user tạo thành owner (role=owner, status=active) trong company_members
   *  trong cùng 1 transaction (atomic: insert company fail → không insert member).
   */
  create: async (input: CreateCompanyInput, userId: string): Promise<Company> => {
    const existing = await companyMemberService.getMembership(userId);
    if (existing) {
      throw new AppError(409, 'ALREADY_IN_COMPANY', 'Bạn đã thuộc một công ty khác, không thể tạo công ty mới');
    }
    
    const slug = await uniqueSlug(input.name);
    return db.transaction(async (tx) => {
      const [company] = await tx
        .insert(companies)
        .values({
          name: input.name,
          slug,
          logoUrl: input.logoUrl,
          coverUrl: input.coverUrl,
          description: input.description,
          industry: input.industry,
          sizeRange: input.sizeRange,
          website: input.website,
          social: input.social,
          address: input.address,
          metadata: input.metadata ?? {},
          createdBy: userId,
        })
        .returning();
      // Tự thêm user tạo làm owner active (cùng tx → atomic với company)
        await companyMemberService.addOwner(tx, company.id, userId);
      return company;
    });
  },

  /** Cập nhật (slug giữ nguyên để không gãy link cũ) */
  update: async (id: string, input: UpdateCompanyInput): Promise<Company | null> => {
    const [company] = await db
      .update(companies)
      .set(input)
      .where(eq(companies.id, id))
      .returning();
    return company ?? null;
  },

  /** Admin đổi lifecycle status (active / banned / removed) */
  updateStatus: async (id: string, status: CompanyStatus): Promise<Company | null> => {
    const [company] = await db
      .update(companies)
      .set({ status })
      .where(eq(companies.id, id))
      .returning();
    return company ?? null;
  },
};
