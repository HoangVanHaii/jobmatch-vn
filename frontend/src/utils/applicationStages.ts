/**
 * applicationStages — preset stage (sub-stage) gợi ý theo status.
 *
 * Stage là TEXT TỰ DO trong DB (KHÔNG pgEnum — nền tảng đa công ty, mỗi
 * công ty 1 quy trình). Preset chỉ là GỢI Ý ở FE combobox: chuẩn hóa 90%
 * data (tên bám sát tính năng có sẵn — reference-check) mà vẫn cho HR gõ
 * custom. BE không validate theo list này.
 *
 * Tên preset slug-case, khớp với luồng dự kiến:
 *   - iq-test / english-test → luồng AI test (ai_tests + test_assignments;
 *     "AI" chỉ định vai trò SINH ĐỀ/CHẤM — Gemini — không phải nội dung môn)
 *   - reference-check        → luồng reference verification (n8n)
 */
import type { ApplicationStatus } from '@/types/application';

export const STATUS_STAGE_PRESETS: Partial<Record<ApplicationStatus, readonly string[]>> = {
  viewed: ['cv-review'],
  screening: ['iq-test', 'english-test', 'reference-check'],
  interview: ['tech-round', 'hr-round', 'final-round'],
  offered: ['negotiating', 'awaiting-response'],
  // pending: chưa có gì để làm; hired/rejected/withdrawn: terminal → không preset
};
