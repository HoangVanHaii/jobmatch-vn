/**
 * Per-type system hints — inject vào system prompt của LLM merge (bước 2).
 *
 * Mỗi ChatType có 1 hint ngắn (1-3 dòng) mô tả CÁCH trả lời section đó.
 * Hints chỉ append cho các section THỰC SỰ có trong prompt — tránh context
 * thừa khi user chỉ hỏi 1 intent.
 *
 * Đây là "thin specialization layer": thay vì viết handler riêng cho mỗi
 * intent, mỗi handler dump data text, LLM merge đọc hints + section để
 * biết cách diễn giải. Ưu điểm: 1 LLM call duy nhất, không phình pipeline.
 *
 * Nguyên tắc viết hint:
 *  - Cho biết section này LÀ GÌ (định nghĩa ngắn).
 *  - Cho biết TRẢ LỜI kiểu gì (format, độ dài, ngôi xưng).
 *  - Cho biết KHÔNG ĐƯỢC làm gì (nếu có ràng buộc đặc biệt).
 */
import type { ChatType } from '../../lib/llm/chatbot/types';

export const TYPE_HINTS: Record<ChatType, string> = {
  // === Data sections (cite=true) ===
  cv: `Section "cv": dữ liệu CV user đã gắn (parsedData dump đủ 8 nhóm: skills, experience, education, projects, certs, languages, contact, summary).
Trích info để trả lời — câu kiểu "tôi có bao nhiêu năm React" → đếm từ experience; "linkedin gì" → đọc data.linkedin.
Multi-CV → đánh số "CV #1", "CV #2". KHÔNG bịa thêm kỹ năng / kinh nghiệm ngoài data.`,

  jd: `Section "jd": dữ liệu Job user đã gắn (title, salary, requirements, skills, deadline, viewsCount, appliesCount).
Nếu có warning "closed" ở đầu section → nhắc user job đã đóng, data dưới đây là bản ghi cũ.
Trả lời câu "lương bao nhiêu", "yêu cầu gì", "còn hạn không", "mấy người apply" đều lấy từ section.
QUAN TRỌNG: Tiêu đề job trong section có dạng markdown link "[Tên job](/jobs/<id>)". Khi diễn giải phải GIỮ NGUYÊN link đó verbatim — không bỏ ngoặc, không đổi sang chữ thường, không ghi "xem tại đây". User cần click được vào job.`,

  cv_jd_match: `Section "cv_jd_match": đã có sẵn JSON scoring từ LLM chấm điểm riêng (matchPercent, strengths, concerns, matchedSkills, missingSkills, rationale).
Diễn giải tự nhiên cho user — bám sát JSON, KHÔNG tự tính lại % hay thêm gap ngoài concerns.
Multi-cặp → đánh số "Cặp #1", "Cặp #2" và xếp theo matchPercent giảm dần.`,

  search: `Section "search": kết quả semantic search top 5 theo câu hỏi user (threshold 0.6 — đã lọc job match yếu).
Trình bày gọn: tiêu đề + lương + địa điểm. Độ tương đồng >0.7 là match tốt, <0.65 yếu.
Nếu section nói "chưa có job phù hợp" → gợi ý user đổi từ khoá (thêm địa điểm / loại hình / mức lương / công nghệ cụ thể).
QUAN TRỌNG: Tiêu đề job trong section là markdown link "[Tên job](/jobs/<id>)". Khi nhắc lại job trong câu trả lời, GIỮ NGUYÊN markdown link đó verbatim — không bỏ ngoặc, không ghi "tại đây". User click được vào tên job để mở chi tiết.`,

  billing_plan: `Section "billing_plan": liệt kê gói hiện có trong DB + gói user đang dùng (nếu có).
Tuyệt đối KHÔNG tự suy diễn khuyến mãi / giảm giá / cam kết ngoài data.
Câu "nên mua gói nào" → liệt kê features để user tự chọn, không khuyến nghị cụ thể.`,

  application: `Section "application": hồ sơ user đã nộp (top 10 gần nhất) — jobTitle, company, status, ngày nộp, viewedAt, aiMatchScore.
- "NTD xem chưa?" → trả từ viewedAt (null = chưa xem).
- "Apply được mấy job?" = số rows.
- "Trạng thái hồ sơ" = status field.`,

  interview: `Section "interview": lịch phỏng vấn sắp tới (top 10) — thời gian, địa điểm/link, status, duration.
Format ngắn gọn (1-2 dòng mỗi lịch). Nếu section rỗng → gợi ý user apply trước rồi NTD sẽ hẹn lịch.`,

  // === Reference sections (cite=false) ===
  account: `Section "account": yêu cầu về tài khoản cá nhân (đổi email, mật khẩu, xoá TK, cài đặt).
KHÔNG xử lý qua chatbot — hướng dẫn liên hệ support@jobmatch.vn hoặc vào Cài đặt → Tài khoản.
Nếu user hỏi câu liên quan bảo mật (mật khẩu, 2FA) → tuyệt đối không tiết lộ info cá nhân.`,

  system_info: `Section "system_info": FAQ cách dùng JobMatch. Hiện CHƯA có data FAQ trong DB → LLM tự trả lời dựa trên knowledge JobMatch chung.
Trả lời ngắn, có bước rõ ràng. Một số thao tác: tải CV ở menu "CV của tôi"; rút hồ sơ ở "Applications"; cập nhật ở "Cài đặt".`,

  general: `Section "general": câu hỏi NGOÀI nghiệp vụ JobMatch (small talk, kiến thức chung, thời tiết, công thức nấu ăn...).
Trả lời tự nhiên, lịch sự. Từ chối nhẹ nhàng nếu vi phạm pháp luật / y tế / tài chính cá nhân (gợi ý user hỏi chuyên gia).
Không tự nhận là chuyên gia y tế / pháp lý / tài chính.`,
};

/**
 * Build phần hint system cho merge LLM. Chỉ include hints cho section
 * THỰC SỰ có trong prompt hiện tại — tránh rác context.
 */
export const buildTypeHintsBlock = (types: ChatType[]): string => {
  const uniq = Array.from(new Set(types));
  if (!uniq.length) return '';
  const lines = uniq
    .map((t) => `- Section ${t}: ${TYPE_HINTS[t]}`)
    .join('\n');
  return `# Hướng dẫn xử lý từng section\n${lines}`;
};
