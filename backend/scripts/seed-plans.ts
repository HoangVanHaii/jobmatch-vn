/**
 * Seed plans — chèn / cập nhật 5 gói dịch vụ vào bảng `plans`:
 *   3 gói tháng (update từ bộ cũ free/lightt/pro — giữ nguyên UUID):
 *     free          — Free Plan            0đ        / 30 ngày
 *     premium       — Premium Plan         199.000đ  / 30 ngày
 *     professional  — Professional Plan    399.000đ  / 30 ngày
 *   2 gói năm (insert mới, quota cao hơn gói tháng tương ứng ~1.2x;
 *   giá = 10x giá tháng — tặng 2 tháng):
 *     premium-yearly      — Premium Plan      1.990.000đ / 365 ngày
 *     professional-yearly — Professional Plan 3.990.000đ / 365 ngày
 *
 * Cách chạy:
 *   npm run db:seed:plans
 *   # hoặc: tsx scripts/seed-plans.ts
 *
 * Idempotent:
 *  - `onConflictDoUpdate` trên `id` (primary key) → chạy lại vẫn an toàn,
 *    update code/name/price/... cho khớp với code.
 *  - Nếu DB chưa có row nào trong `plans` thì INSERT mới.
 *
 * Schema (xem backend/src/db/schema/billing.ts:5-13):
 *   id            uuid PK
 *   code          text UNIQUE      (vd 'free' | 'premium' | 'professional')
 *   name          text
 *   price_vnd     numeric(15, 0)
 *   duration_days integer
 *   features      jsonb            (Record<string, unknown>)
 *   is_active     boolean          (default true)
 *
 * Lưu ý về UUID cứng:
 *  - 3 ID gói tháng được fix cứng để subscription/payment reference ổn định qua
 *    nhiều lần reseed (tránh orphan reference khi INSERT lại với id mới).
 *  - Nếu muốn reset, xoá row trong `subscriptions` / `payments` trước, hoặc đổi
 *    sang `defaultRandom()` rồi reseed.
 *
 * Tại sao tách file riêng thay vì nhét vào seed.ts:
 *  - seed.ts đang seed skills — chạy độc lập, không phụ thuộc plans.
 *  - Plans là dữ liệu "cố định" (ít khi đổi), tách ra để CI/CD deploy lại
 *    sau migration mà không cần re-seed toàn bộ.
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db, pool } from '../src/config/database';
import { plans } from '../src/db/schema';
import { logger } from '../src/config/logger';

/**
 * Features JSON theo convention backend — `usageLogService.createOrIncrementUsage`
 * resolve quota qua các key: apply, job_post, ai_cv_parsed, ai_cv_analysis,
 * job_generation. Đổi key ở đây cần đổi cả ở service.
 *
 * Drizzle `jsonb` với `$type<Record<string, unknown>>()` yêu cầu index
 * signature → dùng type này (không phải interface khai báo field cụ thể)
 * để TS chấp nhận insert.
 */
type PlanFeatures = Record<string, unknown>;

interface PlanSeed {
  id: string;
  code:
    | 'free'
    | 'premium'
    | 'professional'
    | 'premium-yearly'
    | 'professional-yearly';
  name: string;
  description: string;
  /** Drizzle `numeric(15,0)` chỉ nhận string ở type-level — pg driver convert
   *  sang decimal/string khi bind. Truyền số cũng work runtime nhưng TS reject. */
  priceVnd: string;
  durationDays: number;
  features: PlanFeatures;
  isActive: boolean;
}

/** Mô tả marketing dùng chung cho gói tháng và gói năm cùng tier. */
type TierCode = 'free' | 'premium' | 'professional';

const DESCRIPTIONS: Record<TierCode, string> = {
  free: 'Phù hợp với người mới bắt đầu tìm việc, cung cấp các công cụ cần thiết để hỗ trợ quá trình ứng tuyển và cải thiện CV.',
  premium:
    'Phù hợp với người tìm việc thường xuyên, hỗ trợ bạn sử dụng các công cụ ứng tuyển và tối ưu CV hiệu quả hơn.',
  professional:
    'Phù hợp với người đang tích cực tìm việc và cần sử dụng thường xuyên các công cụ hỗ trợ ứng tuyển và phân tích CV.',
};

// ⚠️ GIÁ TEST — giảm 4x so với giá production để tiện test payment.
// Giá production (trả lại khi deploy thật):
//   premium 199.000 / professional 399.000 / premium-yearly 1.990.000 /
//   professional-yearly 3.990.000 (yearly = 10x monthly, tặng 2 tháng).
const planSeeds: PlanSeed[] = [
  // ===== 3 gói tháng — UUID giữ nguyên từ bộ cũ (free/lightt/pro) =====
  {
    id: 'ae5cd872-6761-441d-be9e-116ea82bcce3',
    code: 'free',
    name: 'Free Plan',
    description: DESCRIPTIONS.free,
    priceVnd: '0',
    durationDays: 30,
    features: {
      apply: 20,
      job_post: 5,
      ai_cv_parsed: 5,
      ai_cv_analysis: 10,
      job_generation: 5,
    },
    isActive: true,
  },
  {
    // Row cũ có code 'lightt' (typo) — seed này sửa lại thành 'premium'.
    id: '451e9023-d441-408c-9c8d-4fcc4143f9fd',
    code: 'premium',
    name: 'Premium Plan',
    description: DESCRIPTIONS.premium,
    priceVnd: '2000',
    durationDays: 30,
    features: {
      apply: 50,
      job_post: 10,
      ai_cv_parsed: 15,
      ai_cv_analysis: 30,
      job_generation: 10,
    },
    isActive: true,
  },
  {
    id: '7e4ad1ce-1547-44f1-8840-ca64d4deb0ab',
    code: 'professional',
    name: 'Professional Plan',
    description: DESCRIPTIONS.professional,
    priceVnd: '3000',
    durationDays: 30,
    features: {
      apply: 100,
      job_post: 30,
      ai_cv_parsed: 30,
      ai_cv_analysis: 60,
      job_generation: 30,
    },
    isActive: true,
  },
  // ===== 2 gói năm — insert mới, quota ≈ 1.2x gói tháng tương ứng =====
  {
    id: '3b7f6a2c-8d41-4e59-9b2a-6c8d0f1e2a3b',
    code: 'premium-yearly',
    name: 'Premium Plan',
    description: DESCRIPTIONS.premium,
    priceVnd: '4000',
    durationDays: 365,
    features: {
      apply: 60,
      job_post: 12,
      ai_cv_parsed: 18,
      ai_cv_analysis: 36,
      job_generation: 12,
    },
    isActive: true,
  },
  {
    id: '5d8e9f0a-1b2c-4d3e-8f4a-7b6c5d4e3f2a',
    code: 'professional-yearly',
    name: 'Professional Plan',
    description: DESCRIPTIONS.professional,
    priceVnd: '5000',
    durationDays: 365,
    features: {
      apply: 120,
      job_post: 36,
      ai_cv_parsed: 36,
      ai_cv_analysis: 72,
      job_generation: 36,
    },
    isActive: true,
  },
];

const seed = async (): Promise<void> => {
  logger.info(`Seeding ${planSeeds.length} plans...`);

  // onConflictDoUpdate trên `id` → cập nhật code/name/price/features/isActive
  // nếu id đã tồn tại. An toàn để chạy lại nhiều lần.
  // QUAN TRỌNG: phải dùng `excluded.<col>` (giá trị mới của INSERT). Nếu dùng
  // `plans.<col>` thì Drizzle sinh `SET col = plans.col` — gán chính nó →
  // no-op ngầm, row cũ không bao giờ được update (bug gốc của script này).
  await db
    .insert(plans)
    .values(planSeeds)
    .onConflictDoUpdate({
      target: plans.id,
      set: {
        code: sql`excluded.code`,
        name: sql`excluded.name`,
        description: sql`excluded.description`,
        priceVnd: sql`excluded.price_vnd`,
        durationDays: sql`excluded.duration_days`,
        features: sql`excluded.features`,
        isActive: sql`excluded.is_active`,
      },
    });

  logger.info(`✅ Seeded ${planSeeds.length} plans`);
  await pool.end();
};

seed().catch((err) => {
  logger.fatal({ err }, 'Plans seed failed');
  process.exit(1);
});
