/**
 * Seed plans — chèn / cập nhật 3 gói dịch vụ (free, light, pro) vào bảng `plans`.
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
 *   code          text UNIQUE      (vd 'free' | 'light' | 'pro')
 *   name          text
 *   price_vnd     numeric(15, 0)
 *   duration_days integer
 *   features      jsonb            (Record<string, unknown>)
 *   is_active     boolean          (default true)
 *
 * Lưu ý về UUID cứng:
 *  - 3 ID được fix cứng để subscription/payment reference ổn định qua nhiều lần
 *    reseed (tránh orphan reference khi INSERT lại với id mới).
 *  - Nếu muốn reset, xoá row trong `subscriptions` / `payments` trước, hoặc đổi
 *    sang `defaultRandom()` rồi reseed.
 *
 * Tại sao tách file riêng thay vì nhét vào seed.ts:
 *  - seed.ts đang seed skills — chạy độc lập, không phụ thuộc plans.
 *  - Plans là dữ liệu "cố định" (ít khi đổi), tách ra để CI/CD deploy lại
 *    sau migration mà không cần re-seed toàn bộ.
 */
import 'dotenv/config';
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
  code: 'free' | 'light' | 'pro';
  name: string;
  /** Drizzle `numeric(15,0)` chỉ nhận string ở type-level — pg driver convert
   *  sang decimal/string khi bind. Truyền số cũng work runtime nhưng TS reject. */
  priceVnd: string;
  durationDays: number;
  features: PlanFeatures;
  isActive: boolean;
}

const planSeeds: PlanSeed[] = [
  {
    id: 'ae5cd872-6761-441d-be9e-116ea82bcce3',
    code: 'free',
    name: 'free',
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
    id: '7e4ad1ce-1547-44f1-8840-ca64d4deb0ab',
    code: 'pro',
    name: 'pro',
    priceVnd: '2100',
    durationDays: 30,
    features: {
      apply: 100,
      job_post: 30,
      ai_cv_parsed: 30,
      ai_cv_analysis: 50,
      job_generation: 30,
    },
    isActive: true,
  },
  {
    id: '451e9023-d441-408c-9c8d-4fcc4143f9fd',
    code: 'light',
    name: 'light',
    priceVnd: '2000',
    durationDays: 30,
    features: {
      apply: 50,
      job_post: 10,
      ai_cv_parsed: 10,
      ai_cv_analysis: 20,
      job_generation: 10,
    },
    isActive: true,
  },
];

const seed = async (): Promise<void> => {
  logger.info(`Seeding ${planSeeds.length} plans...`);

  // onConflictDoUpdate trên `id` → cập nhật code/name/price/features/isActive
  // nếu id đã tồn tại. An toàn để chạy lại nhiều lần.
  await db
    .insert(plans)
    .values(planSeeds)
    .onConflictDoUpdate({
      target: plans.id,
      set: {
        code: plans.code,
        name: plans.name,
        priceVnd: plans.priceVnd,
        durationDays: plans.durationDays,
        features: plans.features,
        isActive: plans.isActive,
      },
    });

  logger.info(`✅ Seeded ${planSeeds.length} plans`);
  await pool.end();
};

seed().catch((err) => {
  logger.fatal({ err }, 'Plans seed failed');
  process.exit(1);
});
