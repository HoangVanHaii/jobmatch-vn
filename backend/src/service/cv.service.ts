import { db } from "../config/database";
import { cvs } from "../db/schema";
import { desc, eq, and, ne, sql, inArray, or, ilike } from "drizzle-orm";
import type { CreateCvInput, CreateDirectCvInput, Cv, VerificationWarning, CvDetail, CvStatus, CvSource, ListCvResponse, AiAnalysis, UpdateDirectCvInput, CvFailureReason } from "../interface/cv";
import { notificationGateway } from "../socket/notificationGateway";
import { githubLookupService } from "./githubLookup.service";
import { logger } from "../config/logger";
import { redis } from "../config/redis";
import { cvAnalysisQueue, cvParsingQueue } from "../config/queue";
import { AppError } from "../middleware/errorHandler";



const buildParsedData = (input: CreateDirectCvInput): NonNullable<typeof cvs.$inferSelect.parsedData> => {
  const parsedData: NonNullable<typeof cvs.$inferSelect.parsedData> = {};
  if (input.contact) {
    if (input.contact.name !== undefined) parsedData.name = input.contact.name;
    if (input.contact.email !== undefined) parsedData.email = input.contact.email;
    if (input.contact.phone !== undefined) parsedData.phone = input.contact.phone;
    if (input.contact.portfolio !== undefined) parsedData.portfolio = input.contact.portfolio;
    if (input.contact.github !== undefined) parsedData.github = input.contact.github;
    if (input.contact.linkedin !== undefined) parsedData.linkedin = input.contact.linkedin;
    if (input.contact.facebook !== undefined) parsedData.facebook = input.contact.facebook;
    if (input.contact.avatarUrl !== undefined) parsedData.avatarUrl = input.contact.avatarUrl;
  }
  if (input.summary !== undefined) parsedData.summary = input.summary;
  if (input.education) parsedData.education = input.education as unknown as Record<string, unknown>[];
  if (input.experience) parsedData.experience = input.experience as unknown as Record<string, unknown>[];
  if (input.skills) parsedData.skills = input.skills;
  if (input.languages) parsedData.languages = input.languages as unknown as Record<string, unknown>[];
  if (input.projects) parsedData.projects = input.projects as unknown as Record<string, unknown>[];
  if (input.certifications) parsedData.certifications = input.certifications as unknown as Record<string, unknown>[];
  return parsedData;
};

/**
 * Deep merge `update` vào `target` — RFC 7396 (JSON Merge Patch) semantics.
 * Dùng cho PATCH /cvs/:cvId để chỉ update field user gửi, giữ nguyên các
 * field khác trong parsedData.
 *
 * - Field không có trong `update` → giữ nguyên từ `target`.
 * - `null` trong `update` → xoá field kh�i kết quả.
 * - Primitive (string/number/boolean) → replace.
 * - Object (không phải array) → đệ quy merge.
 * - Array → REPLACE toàn bộ (theo RFC 7396 — không concat).
 * - `undefined` → bỏ qua (giữ giá trị target, không xoá).
 *
 * Không mutate `target` — trả về object mới.
 */
export const deepMerge = (
  target: Record<string, unknown>,
  update: Record<string, unknown>,
): Record<string, unknown> => {
  const result: Record<string, unknown> = { ...target };

  for (const key of Object.keys(update)) {
    const sourceVal = update[key];
    const targetVal = target[key];

    // null = xoá field
    if (sourceVal === null) {
      delete result[key];
      continue;
    }

    // Cả 2 là plain object → đệ quy merge
    if (
      typeof sourceVal === "object" &&
      !Array.isArray(sourceVal) &&
      targetVal !== null &&
      typeof targetVal === "object" &&
      !Array.isArray(targetVal)
    ) {
      result[key] = deepMerge(
        targetVal as Record<string, unknown>,
        sourceVal as Record<string, unknown>,
      );
      continue;
    }

    // undefined → bỏ qua, giữ giá trị target
    if (sourceVal === undefined) {
      continue;
    }

    // Primitive / array → replace
    result[key] = sourceVal;
  }

  return result;
};

export const cvService = {
  /**
   * Upload CV: client đã upload file lên MinIO, gửi URL + mime về đây.
   * - source='upload', templateId=null.
   * - status='pending' (default) — worker sẽ chuyển sang 'parsing' → 'ready' / 'failed'.
   */
  upload: async (input: CreateCvInput, candidateId: string): Promise<Cv> => {
    const [cv] = await db
      .insert(cvs)
      .values({
        candidateId,
        title: input.title,
        fileUrl: input.fileUrl,
        fileType: input.fileType,
        isPrimary: input.isPrimary ?? false,
          source: "upload",
        status: "parsing"
      })
      .returning();
    await cvParsingQueue.add("cv-parse", { cvId: cv.id });

    return cv;
  },

  /**
   * List CVs của candidate (ẩn status='deleted'), sort primary trước.
   * Có phân trang: trả về `items` (full Cv row) + `total` (tổng khớp filter).
   *
   * Tên hàm `getListDetail` thay cho `list` cũ: response là FULL row (parsedData +
   * ai_analysis) chứ không phải slim ListCv — FE render CV thật trên thumbnail
   * card mà không phải gọi thêm GET /cvs/:cvId.
   *
   * @param source — optional filter: 'upload' | 'direct'. Bỏ trống → trả cả 2 loại.
   * @param q — optional từ khoá tìm tiêu đề (case-insensitive ILIKE).
   *   Title NULL sẽ được loại khỏi kết quả search (đúng kỳ vọng UX — không
   *   trả CV "chưa đặt tên" khi user gõ vào ô tìm kiếm).
   * @param limit — số row tối đa trên 1 trang (default 10, 1..100).
   * @param offset — bỏ qua N row đầu (default 0, >=0).
   */
  getListDetail: async (
    candidateId: string,
    source?: CvSource,
    limit: number = 10,
    offset: number = 0,
    q?: string,
  ): Promise<ListCvResponse> => {
    const whereClauses = [
      eq(cvs.candidateId, candidateId),
      ne(cvs.status, "deleted"),
    ];
    if (source) {
      whereClauses.push(eq(cvs.source, source));
    }
    if (q) {
      // ILIKE title — case-insensitive, %...% để match substring. Cột `title`
      // nullable, nên thêm IS NOT NULL để title=NULL không bị match do
      // NULL ILIKE '%q%' = NULL (treated as false in AND).
      whereClauses.push(ilike(cvs.title, `%${q}%`));
      whereClauses.push(sql`${cvs.title} IS NOT NULL`);
    }
    const whereExpr = and(...whereClauses);

    // Items của trang hiện tại — FULL Cv row (parsedData + ai_analysis luôn có).
    const items = await db
      .select()
      .from(cvs)
      .where(whereExpr)
      .orderBy(desc(cvs.isPrimary), desc(cvs.createdAt))
      .limit(limit)
      .offset(offset);

    // Tổng số CV khớp filter (không phụ thuộc limit/offset).
    const [{ count }] = await db
      .select({ count: sql<number>`cast(count(*) as integer)` })
      .from(cvs)
      .where(whereExpr);

    return { items, total: count };
  },

  /**
   * Lấy nhiều CV theo id, scoped theo candidateId.
   * Dùng cho chatbot picker context — chỉ trả CV thuộc user, status='ready', bỏ 'deleted'.
   * Nếu cvIds rỗng hoặc tất cả không khớp owner → trả [].
   */
  getManyByIds: async (cvIds: string[], candidateId: string): Promise<Cv[]> => {
    if (!cvIds.length) return [];
    const rows = await db
      .select()
      .from(cvs)
      .where(
        and(
          inArray(cvs.id, cvIds),
          eq(cvs.candidateId, candidateId),
          ne(cvs.status, "deleted"),
          eq(cvs.status, "ready"),
        ),
      );
    return rows;
  },

  /**
   * GET /cvs/:cvId — trả về toàn bộ row (1 endpoint duy nhất).
   * Bao gồm: summary fields + parsedData + aiAnalysis + scoreUpdatedAt.
   *
   * Vài field nullable tùy `source`:
   * - fileUrl/fileType: NULL với direct CV; có với upload CV.
   * - templateId: NULL với upload CV; có (1-5) với direct CV.
   * - parsedData: NULL khi upload CV đang pending/parsing/failed; có khi 'ready'.
   * - aiAnalysis/scoreUpdatedAt: NULL khi upload CV chưa analyze, hoặc luôn NULL với direct.
   *
   * Trả null nếu không tồn tại / không thuộc candidate / đã soft-delete.
   */
  getDetail: async (
    candidateId: string,
    cvId: string,
  ): Promise<CvDetail | null> => {
    const [row] = await db
      .select()
      .from(cvs)
      .where(
        and(
          eq(cvs.id, cvId),
          eq(cvs.candidateId, candidateId),
          ne(cvs.status, "deleted"),
        ),
      )
      .limit(1);

    return row ?? null;
  },

  /**
   * GET /cvs/:cvId/render-data — public endpoint (Bearer không bắt buộc),
   * authorize qua HMAC signed token trong query string.
   *
   * Mục đích: Playwright server-side (Chromium headless) navigate tới FE
   * `/print/cv/:cvId?token=...`, print page gọi endpoint này để lấy data
   * tối thiểu cần render CV, không expose Bearer token ra URL.
   *
   * KHÔNG filter theo candidateId — token đã scope chỉ authorize 1 cvId,
   * và ownership đã verify ở downloadPdf (caller phải có Bearer + ownership
   * mới nhận được token). Nếu filter candidateId ở đây → phải truyền
   * candidateId qua token payload, tăng attack surface.
   *
   * Chỉ trả field cần thiết để render CV (id, title, source, templateId,
   * parsedData). KHÔNG trả fileUrl/ai_analysis/cv.fileType/candidateId.
   *
   * Trả null nếu không tồn tại / đã soft-delete (controller sẽ throw 404).
   */
  getRenderData: async (
    cvId: string,
  ): Promise<{
    id: string;
    title: string | null;
    source: CvSource;
    templateId: number | null;
    parsedData: NonNullable<typeof cvs.$inferSelect.parsedData> | null;
  } | null> => {
    const [row] = await db
      .select({
        id: cvs.id,
        title: cvs.title,
        source: cvs.source,
        templateId: cvs.templateId,
        parsedData: cvs.parsedData,
      })
      .from(cvs)
      .where(and(eq(cvs.id, cvId), ne(cvs.status, "deleted")))
      .limit(1);
    return row ?? null;
  },

  /**
   * Set primary: trong transaction:
   * 1. Verify CV thuộc về candidate + chưa deleted.
   * 2. Reset tất cả CV của candidate về isPrimary=false.
   * 3. Set CV này về isPrimary=true.
   */
  setPrimary: async (candidateId: string, cvId: string): Promise<Cv | null> => {
    return db.transaction(async (tx) => {
      const [target] = await tx
        .select({ id: cvs.id })
        .from(cvs)
        .where(
          and(
            eq(cvs.id, cvId),
            eq(cvs.candidateId, candidateId),
            ne(cvs.status, "deleted"),
          ),
        )
        .limit(1);
      if (!target) return null;
      await tx
        .update(cvs)
        .set({ isPrimary: false })
        .where(and(eq(cvs.candidateId, candidateId), eq(cvs.isPrimary, true)));
      const [updated] = await tx
        .update(cvs)
        .set({ isPrimary: true })
        .where(eq(cvs.id, cvId))
        .returning();

      return updated ?? null;
    });
  },

  /**
   * Tạo CV direct: lưu toàn bộ form data vào parsedData jsonb.
   * - source='direct', templateId bắt buộc (1-5, validate ở Zod + DB CHECK).
   * - status='ready' ngay (không qua worker).
   * - Nếu isPrimary=true: transaction reset isPrimary của các CV khác trước
   *   (giữ invariant "chỉ 1 CV primary").
   */
  create: async (
    candidateId: string,
    input: CreateDirectCvInput,
  ): Promise<Cv> => {
    const parsedData = buildParsedData(input);
    const baseValues = {
      candidateId,
      title: input.title,
      templateId: input.templateId,
      parsedData,
      source: "direct" as const,
      status: "ready" as const,
    };

    if (input.isPrimary === true) {
      return db.transaction(async (tx) => {
        await tx
          .update(cvs)
          .set({ isPrimary: false })
          .where(
            and(eq(cvs.candidateId, candidateId), eq(cvs.isPrimary, true)),
          );
        const [cv] = await tx
          .insert(cvs)
          .values({ ...baseValues, isPrimary: true })
          .returning();

        return cv;
      });
    }

    const [cv] = await db
      .insert(cvs)
      .values({ ...baseValues, isPrimary: false })
      .returning();

    return cv;
  },

  /**
   * Trigger lại CV analysis — enqueue job vào cvAnalysisQueue.
   *
   * Dùng khi user bấm "Phân tích" trên CV đã parsed (status='ready') hoặc
   * muốn retry sau khi status='failed'. Worker sẽ pick up và chạy LLM analysis.
   *
   * Validate:
   *   - CV phải thuộc candidate + chưa soft-delete.
   *   - CV phải đã có parsedData (chưa parse → throw).
   *   - Status KHÔNG được là 'parsing' (đang chạy rồi, tránh duplicate job).
   *
   * Sau khi enqueue, đổi status='pending' để worker (check pending || parsing)
   * pick up được.
   *
   * Lưu ý: KHÔNG tính quota ở đây — quota reserve trong worker (cvAnalysis.worker.ts)
   * sau khi nhận job. Lý do: nếu quota hết, worker tự mark failed + emit socket,
   * user không cần API trả 402 rồi mới biết.
   */
  triggerAnalysis: async (
    candidateId: string,
    cvId: string,
  ): Promise<Cv> => {
    const cv = await db.query.cvs.findFirst({
      where: and(
        eq(cvs.id, cvId),
        eq(cvs.candidateId, candidateId),
        ne(cvs.status, "deleted"),
      ),
    });

    if (!cv) {
      throw new AppError(404, "CV_NOT_FOUND", "CV not found or already deleted");
    }

    if (!cv.parsedData) {
      throw new AppError(
        400,
        "CV_NOT_PARSED",
        "CV chưa được parse. Vui lòng đợi parse xong hoặc upload lại.",
      );
    }

    if (cv.status === "parsing") {
      throw new AppError(
        409,
        "ALREADY_PROCESSING",
        "CV đang được phân tích. Vui lòng đợi.",
      );
    }

    await cvService.changeStatus(candidateId, cvId, "parsing");
    
    // Enqueue job.
    await cvAnalysisQueue.add("cv-analysis", { cvId });

    return { ...cv, status: "parsing" };
  },

  update: async (
    candidateId: string,
    cvId: string,
    input: UpdateDirectCvInput,
  ): Promise<Cv | null> => {
    return db.transaction(async (tx) => {
      // 1. Verify ownership + source.
      const [target] = await tx
        .select({ id: cvs.id, source: cvs.source })
        .from(cvs)
        .where(
          and(
            eq(cvs.id, cvId),
            eq(cvs.candidateId, candidateId),
            ne(cvs.status, "deleted"),
          ),
        )
        .limit(1);

      if (!target) return null;
      if (target.source !== "direct") {
        throw new AppError(
          400,
          "INVALID_SOURCE",
          "Cannot update upload CV via this endpoint",
        );
      }

      // 2. Nếu user gửi parsedData → load existing + deep merge (RFC 7396).
      // Nếu không gửi → giữ nguyên parsedData trong DB.
      let mergedParsedData: NonNullable<
        typeof cvs.$inferSelect.parsedData
      > | undefined;

      if (input.parsedData !== undefined) {
        const [existing] = await tx
          .select({ parsedData: cvs.parsedData })
          .from(cvs)
          .where(eq(cvs.id, cvId))
          .limit(1);

        mergedParsedData = deepMerge(
          (existing?.parsedData ?? {}) as Record<string, unknown>,
          input.parsedData as unknown as Record<string, unknown>,
        ) as NonNullable<typeof cvs.$inferSelect.parsedData>;
      }

      // 3. Build SET fields — luôn reset status/ai_analysis/scoreUpdatedAt vì
      // content (có thể) đã đổi, analysis cũ stale.
      const setFields: Partial<typeof cvs.$inferInsert> = {
        status: "parsing",
        ai_analysis: null,
        scoreUpdatedAt: null,
        updatedAt: new Date(),
      };
      if (input.title !== undefined) {
        setFields.title = input.title;
      }
      if (mergedParsedData !== undefined) {
        setFields.parsedData = mergedParsedData;
      }

      const [updated] = await tx
        .update(cvs)
        .set(setFields)
        .where(eq(cvs.id, cvId))
        .returning();

      if (!updated) return null;

      return updated;
    });
  },
  softDelete: async (cvId: string, candidateId: string): Promise<Cv | null> => {
    return db.transaction(async (tx) => {
      const [target] = await tx
        .select({ id: cvs.id, isPrimary: cvs.isPrimary })
        .from(cvs)
        .where(
          and(
            eq(cvs.id, cvId),
            eq(cvs.candidateId, candidateId),
            ne(cvs.status, "deleted"),
          ),
        )
        .limit(1);
      if (!target) return null;

      const [deleted] = await tx
        .update(cvs)
        .set({ status: "deleted", updatedAt: new Date() })
        .where(eq(cvs.id, cvId))
        .returning();

      if (target.isPrimary) {
        const [nextPrimary] = await tx
          .select({ id: cvs.id })
          .from(cvs)
          .where(
            and(
              eq(cvs.candidateId, candidateId),
              ne(cvs.status, "deleted"),
              ne(cvs.id, cvId),
            ),
          )
          .orderBy(desc(cvs.createdAt))
          .limit(1);
        if (nextPrimary) {
          await tx
            .update(cvs)
            .set({ isPrimary: true })
            .where(eq(cvs.id, nextPrimary.id));
        }
      }
      return deleted ?? null;
    });
  },
  /**
 * Đổi status của CV, đồng thời (optional) set/reset `failure_reason`.
 *
 * Quy tắc:
 *   - newStatus === 'failed' + reason được truyền → lưu reason vào DB + emit socket kèm reason.
 *   - newStatus !== 'failed' (pending/parsing/ready/deleted) → reset failure_reason = NULL.
 *     Lý do: CV thành công hoặc restart lại từ đầu → không còn lý do fail cũ.
 *
 * @param reason - Bắt buộc khi newStatus='failed'. Optional ở các status khác.
 */
changeStatus: async (
    candidateId: string,
    cvId: string,
    newStatus: CvStatus,
    reason: CvFailureReason | null = null,
): Promise<boolean> => {
    // Quy tắc set `failureReason`:
    //   - newStatus='failed'  → giữ `reason` (lý do fail thật).
    //   - newStatus != 'failed' VÀ reason='quota_exceeded' → VẪN set reason.
    //     Lý do: khi worker revert status='ready' vì quota hết, CV vẫn ở
    //     trạng thái dùng được (điểm cũ được giữ) nhưng FE cần biết "lần
    //     analyze cuối bị quota" để hiện banner — kể cả khi user reload
    //     trang (state mất, DB persist). Banner sẽ tự xoá khi user trigger
    //     analyze lại thành công (changeAnalysisAsReady set null).
    //   - newStatus != 'failed' VÀ reason khác → null (clear).
    //
    // Semantic: `failureReason` thực ra là "last operation reason" — hầu hết
    // các reason chỉ hợp lệ khi status='failed', nhưng 'quota_exceeded' là
    // exception vì có thể coexist với status='ready' (CV vẫn dùng được với
    // điểm cũ). Xem CvFailureReason JSDoc trong interface/cv.ts.
    const failureReason =
        newStatus === "failed" || reason === "quota_exceeded"
            ? reason
            : null;

    const [updated] = await db
        .update(cvs)
        .set({
            status: newStatus,
            failureReason,
            updatedAt: new Date(),
        })
        .where(and(eq(cvs.id, cvId), ne(cvs.status, "deleted")))
        .returning({ id: cvs.id });
    if (!updated) return false;

    notificationGateway.emitToUser(candidateId, "cv:status-changed", {
        cvId,
        status: newStatus,
        failureReason,
    });
    return true;
},

  changeAnalysisAsNotCv: async (
    candidateId: string,
    cvId: string,
  ): Promise<boolean> => {
    const [updated] = await db
      .update(cvs)
      .set({
        ai_analysis: {
          isCv: false,
          total: 0,
          strengths: [],
          weaknesses: [],
          suggestions: [],
          verificationWarnings: [],
        },
        status: "failed",
        failureReason: "not_a_cv",
        updatedAt: new Date(),
      })
      .where(and(eq(cvs.id, cvId), ne(cvs.status, "deleted")))
      .returning({ id: cvs.id });
    if (!updated) return false;

    notificationGateway.emitToUser(candidateId, "cv:status-changed", {
      cvId,
      status: "failed",
      failureReason: "not_a_cv",
    });
    return true;
  },
  changeAnalysisAsReady: async (
    candidateId: string,
    cvId: string,
    analysis: AiAnalysis,
  ): Promise<boolean> => {
    const [updated] = await db
      .update(cvs)
      .set({
        ai_analysis: analysis,
        status: "ready",
        failureReason: null, // reset — CV thành công, không còn lý do fail
        scoreUpdatedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(cvs.id, cvId), ne(cvs.status, "deleted")))
      .returning({ id: cvs.id });
    if (!updated) return false;

    notificationGateway.emitToUser(candidateId, "cv:status-changed", {
      cvId,
      status: "ready",
      failureReason: null,
    });
    return true;
  },
  saveParseData: async (
    cvId: string,
    title: string,
    data: NonNullable<typeof cvs.$inferSelect.parsedData>,
  ): Promise<Cv | null> => {
    const [row] = await db
      .update(cvs)
      .set({
        title,
        parsedData: data,
      })
      .where(and(eq(cvs.id, cvId), ne(cvs.status, "deleted")))
      .returning();

    if (!row) return null;
    return row;
  },
  validateGithubUrl: async (
    url: string,
  ): Promise<VerificationWarning | null> => {
    const GITHUB_URL_RE = /^(https?:\/\/)?(www\.)?github\.com\/[A-Za-z0-9-]+\/?$/i;
    if (!GITHUB_URL_RE.test(url)) {
      return {
        type: "github",
        url,
        message:
          "Đường link GitHub không đúng định dạng. Vui lòng kiểm tra lại!",
      };
    }
    try {
      const exists = await githubLookupService.lookup(url);

      if (exists) return null;

      return {
        type: "github",
        url,
        message:
          "Không tìm thấy tài khoản GitHub này. Vui lòng kiểm tra lại đường dẫn.",
      } as VerificationWarning;
    } catch {
      return null;
    }
  },

  validateLinkedinUrl: async (
    url: string,
  ): Promise<VerificationWarning | null> => {
    const LINKEDIN_URL_RE = /^(https?:\/\/)?(www\.)?linkedin\.com\/in\/[A-Za-z0-9-]+\/?$/i;
    if (!LINKEDIN_URL_RE.test(url)) {
      return {
        type: "linkedin",
        url,
        message: "Đường link này không đúng định dạng. Vui lòng kiểm tra lại!",
      } as VerificationWarning;
    }
    return null;
  },
  buildVerificationWarnings: async (
    parsedData: NonNullable<typeof cvs.$inferSelect.parsedData>,
  ): Promise<VerificationWarning[]> => {
    const warnings: VerificationWarning[] = [];
    if (parsedData.github) {
      const w = await cvService.validateGithubUrl(parsedData.github);
      if (w) warnings.push(w);
    }
    if (parsedData.linkedin) {
      const w = await cvService.validateLinkedinUrl(parsedData.linkedin);
      if (w) warnings.push(w);
    }
    return warnings;
  },
};
