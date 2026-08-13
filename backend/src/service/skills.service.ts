/**
 * Skills service — business logic cho CRUD skills master
 *
 * Skills là dữ liệu master do admin quản lý.
 *
 * Soft delete:
 *   - Bảng `skills` có cột `status` (enum 'active' | 'deleted') — xem
 *     migration 0006_add_status_to_skills.sql.
 *   - delete() UPDATE status='deleted' thay vì DELETE row (giữ audit / restore).
 *   - getAll/getById/getBySlug mặc định filter status='active' (skill đã xóa
 *     trả null / ẩn khỏi list như chưa từng tồn tại — không leak trạng thái).
 *   - Admin có thể truyền `includeDeleted=true` để xem cả skill đã soft-delete.
 *
 * Duplicate protection:
 *   - Database giữ UNIQUE trên `name` và `slug` (kể cả row đã soft-delete →
 *     không thể tạo skill mới trùng identifier với skill đã xóa).
 *   - Service check trước INSERT/UPDATE → AppError 409 rõ ràng (name vs slug).
 *
 * demand_count / category:
 *   - Đã bỏ khỏi bảng (migration 0007). Nếu sau này cần "top demanded skills"
 *     sẽ tính qua COUNT(job_skills) lúc query, không lưu cột cached.
 */

import { db } from "../config/database";
import { skills } from "../db/schema";
import { and, eq, ne, type SQL } from "drizzle-orm";
import { AppError } from "../middleware/errorHandler";
import type {
  CreateSkillInput,
  UpdateSkillInput,
  Skill,
} from "../interface/skills";

const checkNameExists = async ( name: string, excludeId?: string): Promise<void> => {
  const existing = await db.query.skills.findFirst({
    where: and(
      eq(skills.name, name),
      excludeId ? ne(skills.id, excludeId) : undefined,
    ),
    columns: { id: true },
  });

  if (existing) {
    throw new AppError(409, "SKILL_NAME_EXISTS", "Skill name đã tồn tại");
  }
};

const checkSlugExists = async ( slug: string, excludeId?: string): Promise<void> => {
  const existing = await db.query.skills.findFirst({
    where: and(
      eq(skills.slug, slug),
      excludeId ? ne(skills.id, excludeId) : undefined,
    ),
    columns: { id: true },
  });

  if (existing) {
    throw new AppError(409, "SKILL_SLUG_EXISTS", "Skill slug đã tồn tại");
  }
};

export const skillsService = {
  /**
   * Lấy tất cả skills đang active — sort theo name ASC cho dễ tra cứu.
   *
   * @param viewerRole - Khi 'admin' và includeDeleted=true, trả cả skill đã soft-delete.
   */
  getAll: async (
    viewerRole?: string,
    includeDeleted = false,
  ): Promise<Skill[]> => {
    const isAdmin = viewerRole === "admin";
    const where: SQL | undefined =
      isAdmin && includeDeleted
        ? undefined
        : eq(skills.status, "active");

    return db.query.skills.findMany({
      where,
      orderBy: (s, { asc }) => [asc(s.name)],
    });
  },

  /**
   * Chi tiết theo id. Trả null nếu không tồn tại hoặc đã soft-delete
   * (trừ khi viewer là admin và yêu cầu includeDeleted).
   */
  getById: async (
    id: string,
    viewerRole?: string,
    includeDeleted = false,
  ): Promise<Skill | null> => {
    const isAdmin = viewerRole === "admin";
    const where: SQL | undefined =
      isAdmin && includeDeleted
        ? eq(skills.id, id)
        : and(eq(skills.id, id), eq(skills.status, "active"));

    const row = await db.query.skills.findFirst({ where });

    return row ?? null;
  },

  /**
   * Chi tiết theo slug. Trả null nếu không tồn tại hoặc đã soft-delete.
   */
  getBySlug: async (
    slug: string,
    viewerRole?: string,
    includeDeleted = false,
  ): Promise<Skill | null> => {
    const isAdmin = viewerRole === "admin";
    const where: SQL | undefined =
      isAdmin && includeDeleted
        ? eq(skills.slug, slug)
        : and(eq(skills.slug, slug), eq(skills.status, "active"));

    const row = await db.query.skills.findFirst({ where });

    return row ?? null;
  },

  /**
   * Tạo skill mới.
   * status mặc định 'active' (DB default).
   * Check name và slug riêng trước khi INSERT.
   */
  create: async (input: CreateSkillInput): Promise<Skill> => {
    await checkNameExists(input.name);
    await checkSlugExists(input.slug);

    const [row] = await db
      .insert(skills)
      .values({
        name: input.name,
        slug: input.slug,
      })
      .returning();

    if (!row) {
      // Defensive: returning() không trả row nào (vd. trigger suppress RETURNING).
      throw new AppError(500, "SKILL_CREATE_FAILED", "Không thể tạo skill");
    }
    return row;
  },

  /**
   * Cập nhật skill theo id.
   * - Nếu không tồn tại hoặc đã soft-delete → trả null (controller → 404).
   * - Nếu name/slug trùng skill KHÁC → 409 SKILL_NAME_EXISTS / SKILL_SLUG_EXISTS.
   * - status KHÔNG update qua endpoint này (chỉ đổi qua soft delete riêng).
   * - Nếu sau khi strip các field không hợp lệ mà patch rỗng
   *   (client chỉ gửi demandCount/status/...) → trả về skill hiện tại,
   *   KHÔNG gọi UPDATE (tránh drizzle "No values to set" → 500).
   *
   * UPDATE WHERE có cả status='active' để tránh race: nếu giữa findFirst và
   * UPDATE có người khác soft-delete, UPDATE đơn giản match 0 row → 404.
   */
  update: async (id: string, input: UpdateSkillInput): Promise<Skill | null> => {
    // Đảm bảo skill tồn tại và đang active trước khi update (skill đã xóa → null).
    const existing = await db.query.skills.findFirst({
      where: and(eq(skills.id, id), eq(skills.status, "active")),
    });
    if (!existing) return null;

    // Defensive: chỉ cho phép update các field hợp lệ (strip status / demandCount / category).
    const patch: UpdateSkillInput = {};

    if (input.name !== undefined) patch.name = input.name;
    if (input.slug !== undefined) patch.slug = input.slug;

    // Nếu client không gửi field nào hợp lệ → idempotent no-op, trả skill hiện tại.
    // Tránh drizzle .set({}) → Error: No values to set → 500.
    if (patch.name === undefined && patch.slug === undefined) {
      return existing as Skill;
    }

    if (patch.name !== undefined) {
      await checkNameExists(patch.name, id);
    }

    if (patch.slug !== undefined) {
      await checkSlugExists(patch.slug, id);
    }

    const [row] = await db
      .update(skills)
      .set(patch)
      .where(and(eq(skills.id, id), eq(skills.status, "active")))
      .returning();

    return row ?? null;
  },

  /**
   * Soft delete skill theo id.
   * UPDATE status='deleted' thay vì DELETE row (giữ audit / restore).
   * Trả true nếu đánh dấu xóa được, false nếu skill không tồn tại
   * hoặc đã ở trạng thái 'deleted' (idempotent).
   */
  delete: async (id: string): Promise<boolean> => {
    const result = await db
      .update(skills)
      .set({ status: "deleted" })
      .where(and(eq(skills.id, id), eq(skills.status, "active")))
      .returning({ id: skills.id });

    return result.length > 0;
  },
};