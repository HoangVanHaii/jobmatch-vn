/**
 * Mockup data cho JobDetailView — hard-coded constants vì chưa có API backend.
 *
 * Theo plan đã duyệt:
 *   - APPLICANTS_CHART_DATA: applicants theo ngày (10 ngày gần nhất) — render SVG chart
 *   - APPLICANTS_REGION_DATA: phân bố region của applicants (right sidebar)
 *   - MOCK_KEY_RESPONSIBILITIES: responsibilities hiển thị khi job.requirements rỗng
 *   - MOCK_SCOPE_CRITERIA: 3 tiêu chí "Experience / Industry / Skills" — fallback
 *     khi AI match score chưa có breakdown per-criterion thật (BE chỉ trả
 *     `aiMatchScore` 0-100 + `aiMatchReasoning` jsonb).
 *
 * Khi backend bổ sung API analytics (applicants-over-time, by-region, criterion
 * breakdown) → xoá các constant này và thay bằng call API thật.
 */

/** 1 điểm dữ liệu cho chart applicants theo ngày. */
export interface ApplicantsChartPoint {
  /** Label trên trục X — format DD/MM (mockup). */
  date: string;
  /** Số applicants của ngày đó. */
  count: number;
}

/** Dữ liệu chart + peak highlight. */
export const APPLICANTS_CHART_DATA: {
  series: ApplicantsChartPoint[];
  /** Điểm peak — dùng vẽ dot + tooltip dark ở mockup. */
  peak: ApplicantsChartPoint;
} = {
  series: [
    { date: '11/08', count: 18 },
    { date: '12/08', count: 22 },
    { date: '13/08', count: 28 },
    { date: '14/08', count: 35 },
    { date: '15/08', count: 50 },
    { date: '16/08', count: 12 },
    { date: '17/08', count: 78 },
    { date: '18/08', count: 100 },
    { date: '19/08', count: 65 },
    { date: '20/08', count: 42 },
  ],
  peak: { date: '18/08', count: 100 },
};

/** 1 quốc gia trong bảng "Applicants region" — KHÔNG còn dùng, giữ lại cho
 *  reference / future re-use. JobDetailView bỏ section này; nếu sau muốn
 *  hiển thị lại, BE cần trả applicants-region stats thật. */
export interface ApplicantsRegionItem {
  country: string;
  /** Emoji flag — render trực tiếp, không cần library. */
  flag: string;
  /** Phần trăm 0-100. */
  percent: number;
}

/** @deprecated — section "Applicants region" đã bỏ khỏi JobDetailView. */
export const APPLICANTS_REGION_DATA: ApplicantsRegionItem[] = [
  { country: 'United Kingdom', flag: '🇬🇧', percent: 40 },
  { country: 'United States',   flag: '🇺🇸', percent: 32 },
  { country: 'Belgium',         flag: '🇧🇪', percent: 30 },
  { country: 'Canada',          flag: '🇨🇦', percent: 27 },
  { country: 'Bangladesh',      flag: '🇧🇩', percent: 25 },
  { country: 'Scotland',        flag: '🏴󠁧󠁢󠁳󠁣󠁴󠁿', percent: 10 },
];

/**
 * Key Responsibilities — fallback khi job.requirements rỗng. Mockup hiển thị
 * 4 bullet mẫu để layout cân đối. Khi requirements có giá trị → dùng thật.
 */
export const MOCK_KEY_RESPONSIBILITIES: string[] = [
  'Integrate accessibility best practices throughout the design process.',
  'Support design through partnership, documentation, and resources to help them refine work that balances design fidelity, technical feasibility, and accessibility.',
  'Review and evaluate audits and designs of other members of the team to ensure accuracy.',
  'Partner closely with our user experience research team to identify opportunities to improve product offerings or create new ones.',
];

/** 1 tiêu chí trong card "Your Scope". */
export interface ScopeCriterion {
  label: string;
  /** 0-100. */
  percent: number;
  /** Hex color cho bar + badge bg/15 (suffix). */
  color: string;
}

/**
 * 3 tiêu chí breakdown cho card "Your Scope" — mockup dùng 100%/60%/45%.
 *
 * Backend hiện chỉ trả `aiMatchScore` (tổng) + `aiMatchReasoning` jsonb. Nếu
 * reasoning có keys (matchedSkills, missingSkills, ...) có thể map ra %
 * tương ứng sau. Hiện tại dùng fallback 3-criterion này cho tất cả job đã
 * apply + có aiMatchScore.
 */
export const MOCK_SCOPE_CRITERIA: ScopeCriterion[] = [
  { label: 'Experience Level',    percent: 100, color: '#10B981' }, // success green
  { label: 'Industry Experience', percent: 60,  color: '#8B5CF6' }, // purple
  { label: 'Skills',              percent: 45,  color: '#F59E0B' }, // warn amber
];
