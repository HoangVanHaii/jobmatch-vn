/**
 * useAnimatedCount composable
 *
 * M2 + V2 FIX: Stats counter animation dùng chung cho 4 trang auth
 * (LoginView, RegisterView, OnboardingView, ForgotPasswordView).
 *
 * Trước đây hàm `animateCount` + `setTimeout` bị copy-paste ở 3 file, gây:
 *   - Duplicate code: phải sửa 1 chỗ là sync 3 chỗ.
 *   - Memory leak: `requestAnimationFrame` không cleanup khi unmount → Vue warning
 *     "Set operation on key ... failed: target is readonly" khi callback fire
 *     trên component đã destroy.
 *
 * Hành vi giữ NGUYÊN so với bản copy-paste cũ (không đổi UX):
 *   - 3 giá trị đếm từ 0 → target với stagger 60ms.
 *   - Duration 700ms, easing ease-out quadratic (1 - (1-t)^2).
 *   - Cleanup tự động khi component dùng composable unmount (onUnmounted).
 *
 * @example
 *   const { jobsCount, companiesCount, satisfactionCount } = useAnimatedCount();
 *   template: {{ jobsCount }}K+ / {{ companiesCount }}+ / {{ satisfactionCount }}%
 */
import { ref, onUnmounted, type Ref } from 'vue';

export interface AnimatedCountOptions {
  /** [jobs, companies, satisfaction] — default [12, 850, 96] (đồng bộ 3 trang cũ). */
  targets?: [number, number, number];
  /** Delay giữa 3 lần đếm — default 60ms. */
  staggerMs?: number;
  /** Duration mỗi animation — default 700ms. */
  durationMs?: number;
}

export interface AnimatedCountResult {
  jobsCount: Ref<number>;
  companiesCount: Ref<number>;
  satisfactionCount: Ref<number>;
}

export const useAnimatedCount = (opts: AnimatedCountOptions = {}): AnimatedCountResult => {
  const { targets = [12, 850, 96], staggerMs = 60, durationMs = 700 } = opts;
  const [jobsTarget, companiesTarget, satisfactionTarget] = targets;

  const jobsCount = ref(0);
  const companiesCount = ref(0);
  const satisfactionCount = ref(0);

  // M1 FIX: track TẤT CẢ rafId trong 1 Set (3 animation chạy song song, mỗi
  // cái có thể có nhiều frame). Cleanup onUnmounted cancel hết → không còn
  // warning Vue khi user navigate đi giữa animation.
  const rafIds = new Set<number>();

  const animate = (target: number, setter: (v: number) => void, duration = durationMs): void => {
    const start = performance.now();
    const tick = (now: number): void => {
      const elapsed = now - start;
      const t = Math.min(elapsed / duration, 1);
      const eased = 1 - (1 - t) * (1 - t); // ease-out quadratic
      setter(Math.round(eased * target));
      if (t < 1) {
        rafIds.add(requestAnimationFrame(tick));
      } else {
        setter(target); // đảm bảo kết thúc đúng target
      }
    };
    rafIds.add(requestAnimationFrame(tick));
  };

  // Stagger 0/60/120ms — giữ nguyên timing cũ để không đổi feel.
  animate(jobsTarget, (v) => (jobsCount.value = v));
  setTimeout(() => animate(companiesTarget, (v) => (companiesCount.value = v)), staggerMs);
  setTimeout(() => animate(satisfactionTarget, (v) => (satisfactionCount.value = v)), staggerMs * 2);

  onUnmounted(() => {
    for (const id of rafIds) cancelAnimationFrame(id);
    rafIds.clear();
  });

  return { jobsCount, companiesCount, satisfactionCount };
};