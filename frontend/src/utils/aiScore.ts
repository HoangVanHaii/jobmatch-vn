/**
 * aiScore — utility hiển thị nhãn xếp hạng điểm AI (0–100).
 *
 * Tại sao tách utility (không inline trong component):
 *   - Dùng ở 2 chỗ:
 *     1. [CvAiAnalysisView.vue](../components/cv/CvAiAnalysisView.vue) — modal phân tích
 *     2. [MyResumesView.vue](../views/candidate/MyResumesView.vue) — pill điểm
 *        inline trên card CV (cùng tone class)
 *   - Domain logic, không phải UI → đặt ở utils/.
 *   - Khi đổi threshold (vd 80 thay vì 85 cho "Xuất sắc") → sửa 1 chỗ.
 */

export interface ScoreLabel {
  label: string;
  /** Tailwind classes cho pill (text/bg/ring). */
  tone: string;
}

/**
 * Map score 0–100 → nhãn + tone.
 *
 * 4 mức (UX đỡ nhạt so với 3):
 *   - ≥ 85 → Xuất sắc  (emerald)
 *   - ≥ 70 → Tốt        (primary)
 *   - ≥ 50 → Trung bình (amber)
 *   - < 50 → Cần cải thiện (red)
 */
export const scoreLabel = (score: number): ScoreLabel => {
  if (score >= 85) return { label: 'Xuất sắc', tone: 'text-emerald-700 bg-emerald-50 ring-emerald-200/70' };
  if (score >= 70) return { label: 'Tốt', tone: 'text-primary-700 bg-primary-50 ring-primary-200/70' };
  if (score >= 50) return { label: 'Trung bình', tone: 'text-amber-700 bg-amber-50 ring-amber-200/70' };
  return { label: 'Cần cải thiện', tone: 'text-red-700 bg-red-50 ring-red-200/70' };
};