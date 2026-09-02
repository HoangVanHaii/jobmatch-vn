/**
 * Candidate service — nghiệp vụ dành riêng cho role='candidate'.
 *
 * Profile flow:
 *   - getProfile: đọc user + user_profiles (LEFT JOIN) → trả shape chuẩn.
 *   - updateProfile: partial update — chỉ field nào gửi lên mới được merge vào
 *     row user_profiles. Empty string → null (clear), object con (location /
 *     social) được merge ở mức key chứ không replace cả block (giữ nguyên
 *     field user chưa gửi).
 *
 * Lưu ý:
 *   - Email là bất biến — không cho update qua endpoint này (user đổi email phải
 *     qua flow OTP riêng).
 *   - Role cũng bất biến — candidate không thể tự nâng cấp lên employer.
 */
import { db } from '../config/database';
import { users, userProfiles } from '../db/schema';
import { eq } from 'drizzle-orm';
import { AppError } from '../middleware/errorHandler';

/** Shape trả về cho FE — flat các field profile, kèm email. */
export interface CandidateProfile {
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
  phone: string | null;
  location: { city?: string; district?: string } | null;
  social: { linkedin?: string; github?: string; portfolio?: string } | null;
  preferences: Record<string, unknown> | null;
}

/** Chuẩn hoá: nếu user gửi chuỗi rỗng → null. Nếu gửi object rỗng → null. */
const normalizeEmpty = (v: unknown): unknown => {
  if (v === undefined) return undefined; // không gửi → giữ nguyên
  if (v === null) return null;
  if (typeof v === 'string') return v.trim() === '' ? null : v.trim();
  if (typeof v === 'object' && v !== null) {
    const entries = Object.entries(v as Record<string, unknown>).filter(
      ([, val]) => val !== undefined,
    );
    if (entries.length === 0) return null;
    const cleaned: Record<string, unknown> = {};
    for (const [k, val] of entries) {
      const n = normalizeEmpty(val);
      if (n !== undefined) cleaned[k] = n;
    }
    return Object.keys(cleaned).length === 0 ? null : cleaned;
  }
  return v;
};

export const candidateService = {
  /**
   * Đọc profile đầy đủ của 1 candidate.
   *
   * - Trả `null` cho các field optional chưa set (fullName/phone/...) — KHÔNG
   *   trả chuỗi rỗng để FE dễ check `v ? ... : <placeholder>`.
   * - location/social/preferences: trả object (hoặc null) — FE render từng key
   *   con.
   */
  getProfile: async (userId: string): Promise<CandidateProfile> => {
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { id: true, email: true },
    });
    if (!user) {
      throw new AppError(404, 'USER_NOT_FOUND', 'Không tìm thấy tài khoản');
    }
    const profile = await db.query.userProfiles.findFirst({
      where: eq(userProfiles.userId, userId),
    });
    return {
      email: user.email,
      fullName: profile?.fullName ?? null,
      avatarUrl: profile?.avatarUrl ?? null,
      phone: profile?.phone ?? null,
      location: (profile?.location as CandidateProfile['location']) ?? null,
      social: (profile?.social as CandidateProfile['social']) ?? null,
      preferences: (profile?.preferences as Record<string, unknown>) ?? null,
    };
  },

  /**
   * Partial update profile — đọc row hiện tại (nếu chưa có thì insert mới),
   * merge các field gửi lên, ghi lại.
   *
   * Cơ chế:
   *   - Input đã validate schema. Mỗi field optional:
   *     + undefined → KHÔNG đụng tới (giữ giá trị cũ).
   *     + null hoặc chuỗi rỗng → set null (clear field).
   *     + string/object có nội dung → set giá trị mới.
   *   - location/social: merge key-by-key. Nếu user chỉ gửi city mà không
   *     gửi district → district cũ được giữ nguyên.
   *
   * Sau update: trả về profile đầy đủ (qua getProfile) để caller không cần
   * GET lại.
   */
  updateProfile: async (
    userId: string,
    input: {
      fullName?: string;
      phone?: string;
      location?: { city?: string; district?: string };
      social?: { linkedin?: string; github?: string; portfolio?: string };
      preferences?: Record<string, unknown>;
    },
  ): Promise<CandidateProfile> => {
    const existing = await db.query.userProfiles.findFirst({
      where: eq(userProfiles.userId, userId),
    });

    /** Build patch object — chỉ chứa các key user thực sự gửi lên. */
    const patch: Record<string, unknown> = {};

    if (input.fullName !== undefined) {
      const v = normalizeEmpty(input.fullName);
      patch.fullName = v === undefined ? undefined : v;
    }
    if (input.phone !== undefined) {
      const v = normalizeEmpty(input.phone);
      patch.phone = v === undefined ? undefined : v;
    }
    if (input.location !== undefined) {
      const v = normalizeEmpty(input.location);
      if (v !== undefined) {
        // Merge với location cũ (nếu có) để partial key update.
        const base = (existing?.location as Record<string, unknown> | null) ?? {};
        patch.location =
          v === null
            ? null
            : { ...base, ...(v as Record<string, unknown>) };
      }
    }
    if (input.social !== undefined) {
      const v = normalizeEmpty(input.social);
      if (v !== undefined) {
        const base = (existing?.social as Record<string, unknown> | null) ?? {};
        patch.social =
          v === null
            ? null
            : { ...base, ...(v as Record<string, unknown>) };
      }
    }
    if (input.preferences !== undefined) {
      patch.preferences = input.preferences ?? null;
    }

    // Nếu tất cả field undefined (input rỗng hoặc chỉ chứa key rỗng) → không
    // cần ghi DB. Trả profile hiện tại luôn.
    const hasAnyUpdate = Object.values(patch).some((v) => v !== undefined);
    if (hasAnyUpdate) {
      if (!existing) {
        // Tạo row mới. Filter ra các key undefined.
        const insertValues = { userId, ...stripUndefined(patch) };
        await db.insert(userProfiles).values(insertValues);
      } else {
        await db
          .update(userProfiles)
          .set(stripUndefined(patch))
          .where(eq(userProfiles.userId, userId));
      }
    }

    return candidateService.getProfile(userId);
  },
};

/** Loại bỏ các key có giá trị undefined trong object (giúp Drizzle bỏ qua). */
const stripUndefined = <T extends Record<string, unknown>>(obj: T): Partial<T> => {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  }
  return out;
};
