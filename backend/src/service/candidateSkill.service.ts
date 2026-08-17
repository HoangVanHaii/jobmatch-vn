import { sql, and, eq } from "drizzle-orm";
import { db } from "../config/database";
import { candidateSkills, skills } from "../db/schema";
import { AppError } from "../middleware/errorHandler";
import type {
  AddCandidateSkillByNameInput,
  CandidateSkillWithSkill,
  CreateCandidateSkillInput,
  UpdateCandidateSkillInput,
} from "../interface/candidateSkill";

/**
 * Kết quả trả về từ `addByName` — discriminated union để caller
 * biết lý do skip (KHÔNG phải error, chỉ là "không insert được").
 */
export type AddCandidateSkillByNameResult =
  | { added: true; row: typeof candidateSkills.$inferSelect }
  | { added: false; reason: "skill_not_found" | "duplicate" };

export const candidateSkillService = {
  /**
   * Tạo candidate_skill thủ công (biết sẵn skillId).
   * - skillId phải tồn tại trong bảng skills (FK enforce ở DB, nhưng check
   *   trước ở service để trả AppError 404 rõ ràng thay vì 500).
   * - Nếu (candidateId, skillId) đã tồn tại → 409 CANDIDATE_SKILL_EXISTS.
   *
   * Race-safe: dùng `INSERT ... ON CONFLICT DO NOTHING RETURNING *` thay vì
   * SELECT-then-INSERT. Hai request đồng thời cùng (candidateId, skillId):
   *   - Request A: insert thành công, returning 1 row → 201.
   *   - Request B: ON CONFLICT DO NOTHING → returning rỗng → 409 rõ ràng.
   * Trước kia SELECT-then-INSERT, request B có thể pass SELECT, fail INSERT
   * với 23505 unique_violation → Drizzle throw raw → 500.
   *
   * candidateId FK: caller (router) đã enforce ownership — JWT userId === :candidateId
   * hoặc admin. Trong thực tế candidateId luôn tồn tại trong users. Nếu không,
   * Postgres FK raise 23503 → Drizzle throw → errorHandler sẽ trả 500.
   */
  create: async (
    candidateId: string,
    input: Omit<CreateCandidateSkillInput, "candidateId">,
  ): Promise<typeof candidateSkills.$inferSelect> => {
    const { skillId, level } = input;

    // 1) Đảm bảo skill tồn tại (và đang active) — trả 404 rõ ràng thay vì 500 FK.
    const skill = await db.query.skills.findFirst({
      where: and(eq(skills.id, skillId), eq(skills.status, "active")),
      columns: { id: true },
    });
    if (!skill) {
      throw new AppError(404, "SKILL_NOT_FOUND", "Skill not found");
    }

    // 2) Idempotent INSERT. Race-safe: ON CONFLICT DO NOTHING convert unique
    //    violation 23505 thành "no row returned" thay vì throw.
    const [row] = await db
      .insert(candidateSkills)
      .values({ candidateId, skillId, level })
      .onConflictDoNothing({
        target: [candidateSkills.candidateId, candidateSkills.skillId],
      })
      .returning();

    if (!row) {
      // Conflict xảy ra → row đã tồn tại. Trả 409 rõ ràng.
      throw new AppError(
        409,
        "CANDIDATE_SKILL_EXISTS",
        "Candidate đã có skill này",
      );
    }
    return row;
  },

  /**
   * Lấy tất cả skills ACTIVE của một candidate — JOIN với bảng skills để trả
   * về luôn name/slug/status cho client.
   *
   * Filter `skills.status='active'` để soft-deleted skills không hiện trong
   * candidate profile. Nếu admin cần xem cả soft-deleted, dùng `getOne` cho
   * từng row hoặc extend thêm `includeDeleted=true` (chưa implement).
   *
   * Sort theo skill.name ASC cho ổn định giữa các lần gọi.
   */
  listByCandidate: async (
    candidateId: string,
  ): Promise<CandidateSkillWithSkill[]> => {
    return db
      .select({
        candidateId: candidateSkills.candidateId,
        skillId: candidateSkills.skillId,
        level: candidateSkills.level,
        skill: skills,
      })
      .from(candidateSkills)
      .innerJoin(skills, eq(candidateSkills.skillId, skills.id))
      .where(
        and(
          eq(candidateSkills.candidateId, candidateId),
          eq(skills.status, "active"),
        ),
      )
      .orderBy(sql`${skills.name} ASC`) as unknown as CandidateSkillWithSkill[];
  },

  /**
   * Lấy 1 candidate_skill theo (candidateId, skillId) — JOIN skill.
   * Trả null nếu không tồn tại (controller → 404).
   */
  getOne: async (
    candidateId: string,
    skillId: string,
  ): Promise<CandidateSkillWithSkill | null> => {
    const [row] = await db
      .select({
        candidateId: candidateSkills.candidateId,
        skillId: candidateSkills.skillId,
        level: candidateSkills.level,
        skill: skills,
      })
      .from(candidateSkills)
      .innerJoin(skills, eq(candidateSkills.skillId, skills.id))
      .where(
        and(
          eq(candidateSkills.candidateId, candidateId),
          eq(candidateSkills.skillId, skillId),
        ),
      )
      .limit(1);

    return (row as unknown as CandidateSkillWithSkill | undefined) ?? null;
  },

  /**
   * Cập nhật level cho 1 candidate_skill.
   * Trả null nếu không tồn tại (controller → 404).
   * Nếu body rỗng (không gửi level) → trả row hiện tại (idempotent no-op).
   */
  update: async (
    candidateId: string,
    skillId: string,
    input: UpdateCandidateSkillInput,
  ): Promise<typeof candidateSkills.$inferSelect | null> => {
    // Đảm bảo (candidateId, skillId) tồn tại trước khi update.
    const existing = await db.query.candidateSkills.findFirst({
      where: and(
        eq(candidateSkills.candidateId, candidateId),
        eq(candidateSkills.skillId, skillId),
      ),
    });
    if (!existing) return null;

    // Patch rỗng → idempotent no-op, trả row hiện tại.
    if (input.level === undefined) return existing;

    const [row] = await db
      .update(candidateSkills)
      .set({ level: input.level })
      .where(
        and(
          eq(candidateSkills.candidateId, candidateId),
          eq(candidateSkills.skillId, skillId),
        ),
      )
      .returning();

    return row ?? null;
  },

  /**
   * Xoá 1 candidate_skill.
   * Trả true nếu xoá được, false nếu không tồn tại (controller → 404).
   */
  remove: async (candidateId: string, skillId: string): Promise<boolean> => {
    const result = await db
      .delete(candidateSkills)
      .where(
        and(
          eq(candidateSkills.candidateId, candidateId),
          eq(candidateSkills.skillId, skillId),
        ),
      )
      .returning({ skillId: candidateSkills.skillId });

    return result.length > 0;
  },

  /**
   * Add skill theo tên (lookup + insert idempotent).
   * Dùng khi parse CV ra tên skill mà chưa biết id — workflow upload CV.
   *
   * Logic:
   *   1) Lookup skill — case-insensitive equality (PostgreSQL).
   *      Dùng LOWER() thay vì ILIKE để an toàn với input chứa wildcards.
   *      Filter `status='active'` để nhất quán với `create()`: skill đã
   *      soft-delete coi như không tồn tại → trả `skill_not_found`.
   *   2) Insert. ON CONFLICT DO NOTHING idempotent — chạy lại nhiều lần
   *      c�ng không lỗi (vd. retry worker hoặc user upload cùng CV 2 lần).
   */
  addByName: async (
    candidateId: string,
    input: AddCandidateSkillByNameInput,
  ): Promise<AddCandidateSkillByNameResult> => {
    const { name: skillName, level } = input;
    return db.transaction(async (tx) => {
      // 1) Lookup skill — case-insensitive equality (PostgreSQL) + chỉ active.
      //    Dùng LOWER() thay vì ilike để an toàn với input chứa wildcards.
      const [skill] = await tx
        .select({ id: skills.id })
        .from(skills)
        .where(
          and(
            sql`LOWER(${skills.name}) = LOWER(${skillName})`,
            eq(skills.status, "active"),
          ),
        )
        .limit(1);

      if (!skill) {
        return { added: false, reason: "skill_not_found" };
      }

      // 2) Insert. ON CONFLICT DO NOTHING idempotent — chạy lại nhiều lần
      //    cũng không lỗi (vd. retry worker hoặc user upload cùng CV 2 lần).
      const inserted = await tx
        .insert(candidateSkills)
        .values({
          candidateId,
          skillId: skill.id,
          level,
        })
        .onConflictDoNothing({
          target: [candidateSkills.candidateId, candidateSkills.skillId],
        })
        .returning();

      if (inserted.length === 0) {
        return { added: false, reason: "duplicate" };
      }

      return { added: true, row: inserted[0] };
    });
  },

  addByNameFromCV: async (
    candidateId: string,
    input: AddCandidateSkillByNameInput,
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  ): Promise<AddCandidateSkillByNameResult> => {
    const { name: skillName, level } = input;

    // 1) Lookup skill — case-insensitive + chỉ status='active'.
    const [skill] = await tx
      .select({ id: skills.id })
      .from(skills)
      .where(
        and(
          sql`LOWER(${skills.name}) = LOWER(${skillName})`,
          eq(skills.status, "active"),
        ),
      )
      .limit(1);

    if (!skill) {
      return { added: false, reason: "skill_not_found" };
    }

    // 2) Insert idempotent — ON CONFLICT DO NOTHING.
    //    Nếu caller retry (cùng CV upload 2 lần) → không lỗi.
    const inserted = await tx
      .insert(candidateSkills)
      .values({
        candidateId,
        skillId: skill.id,
        level,
      })
      .onConflictDoNothing({
        target: [candidateSkills.candidateId, candidateSkills.skillId],
      })
      .returning();

    if (inserted.length === 0) {
      return { added: false, reason: "duplicate" };
    }

    return { added: true, row: inserted[0] };
  },
};
