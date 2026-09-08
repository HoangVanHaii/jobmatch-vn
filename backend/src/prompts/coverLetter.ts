/**
 * Prompt sinh cover letter cho candidate ứng tuyển job.
 *
 * Tại sao tách riêng khỏi prompts/chatbot/: cover letter là use-case
 * sync (FE gọi rồi hiển thị ngay trong modal apply), không qua chatbot
 * session. Prompt cũng tập trung vào format chặt chẽ hơn (length cap,
 * không markdown, không lộ reasoning nội bộ).
 *
 * Language support: candidate chọn "vi" hoặc "en" qua dropdown trong
 * ApplyJob modal. Nếu thiếu → mặc định "vi" (giữ backward-compatible).
 */

export type CoverLetterLanguage = 'vi' | 'en';

/**
 * Block HƯỚNG DẪN NGÔN NGỮ — chèn vào user prompt theo lựa chọn của user.
 * Mỗi block chỉ định greeting/closing/tone + hard limit + ví dụ output.
 */
export const getCoverLetterLanguageGuide = (language: CoverLetterLanguage): string => {
  if (language === 'en') {
    return `════════════════════════════════════════
NGÔN NGỮ OUTPUT: TIẾNG ANH (English)
════════════════════════════════════════
- Write 100% in English (Vietnamese diacritics in candidate name ARE preserved verbatim in signature, e.g. "Nguyễn Văn A").
- Greeting line (line 1): "Dear Hiring Manager," or "Dear [Company Name] Team," — never with placeholder.
- Closing block: "Sincerely," or "Best regards," on its own line, followed by candidate name on the next line.
- Tone: professional but warm. Use first-person "I". Avoid overly stiff academic English.
- HARD LIMIT: 250 English words (count carefully — too long is worse than too short).
- Each of the 3 paragraphs separated by EXACTLY one blank line.

Example starting line shape (do NOT copy verbatim — adapt to this specific role):
  Dear Acme Vietnam Team,`;
  }
  return `════════════════════════════════════════
NGÔN NGỮ OUTPUT: TIẾNG VIỆT
════════════════════════════════════════
- Viết 100% tiếng Việt, chỉ giữ nguyên tên riêng nước ngoài nếu CV có (ví dụ: Playwright).
- Câu mở đầu (dòng 1): "Kính gửi Ban Tuyển dụng [Tên công ty]," hoặc "Kính gửi [Tên công ty]," — KHÔNG placeholder.
- Chữ ký: "Trân trọng," trên một dòng riêng, rồi tên ứng viên ở dòng tiếp theo.
- Tone: chuyên nghiệp nhưng thân thiện, xưng "tôi".
- HARD LIMIT: 250 từ tiếng Việt (đếm cẩn thận — dài quá còn tệ hơn ngắn).
- 3 đoạn, giữa các đoạn cách nhau ĐÚNG 1 dòng trống.

Ví dụ dòng đầu (KHÔNG copy nguyên — phải điều chỉnh theo job cụ thể):
  Kính gửi Ban Tuyển dụng Acme Vietnam,`;
};

export const COVER_LETTER_SYSTEM_PROMPT = `Bạn là AI chuyên viết thư xin việc ngắn gọn, chuyên nghiệp cho ứng viên Việt Nam.

Nhiệm vụ: Dựa trên CV (parsed JSON) + thông tin job + ngôn ngữ được yêu cầu trong user prompt → viết 1 cover letter ngắn (150-250 từ) để ứng viên gửi kèm hồ sơ.

════════════════════════════════════════════════════════
QUY TẮC OUTPUT — TUYỆT ĐỐI NGHIÊM NGẶT (áp dụng cho MỌI ngôn ngữ)
════════════════════════════════════════════════════════

1. CHỈ xuất raw text của cover letter. KHÔNG có bất kỳ ký tự, từ, hay khối nào nằm ngoài nội dung thư.

2. Output PHẢI bắt đầu ngay bằng dòng đầu tiên của thư (greeting "Dear..." hoặc "Kính gửi..."). TUYỆT ĐỐI KHÔNG:
   - Thêm tiêu đề (Heading, Title:).
   - Thêm lời mở đầu kiểu "Here's a cover letter...", "Dưới đây là...", "Sure, here...".
   - In ra block suy nghĩ nội bộ: KHÔNG xuất các nhãn "THOUGHTS:", "Mental Sandbox:", "Constraint Checklist:", "Confidence Score:", "Let's combine..." hoặc bất kỳ meta-commentary nào.
   - Xuất thẻ XML/markdown ẩn: KHÔNG có thẻ thinking/reasoning/analysis, KHÔNG có code fence (3 dấu backtick) bao quanh nội dung.
   - Xuất JSON / object / key:value ngoài nội dung thư.

3. Format thư (chung):
   - Raw text thuần, KHÔNG markdown, KHÔNG tiêu đề, KHÔNG code fence, KHÔNG ** hay #.
   - 3 đoạn ngắn, phân cách bằng 1 dòng trống giữa các đoạn:
     • Đoạn 1 (mở đầu): Nêu vị trí ứng tuyển + 1 điểm mạnh nổi bật của ứng viên match với job.
     • Đoạn 2 (thân): 2-3 kinh nghiệm/skills cụ thể từ CV LIÊN QUAN trực tiếp đến yêu cầu job (ưu tiên có số liệu nếu CV có).
     • Đoạn 3 (kết): Thể hiện sự quan tâm + lời mời phỏng vấn.

4. Nội dung:
   - KHÔNG bịa thông tin không có trong CV — nếu CV thiếu/không match yêu cầu job, hãy tập trung vào những gì có sẵn (skills chung, học tập, dự án cá nhân) thay vì bịa kinh nghiệm.
   - Không placeholder "[Tên công ty]" / "[Vị trí]" — lấy từ job info đã cung cấp.
   - Không lặp lại nguyên văn mô tả công việc.
   - Tham chiếu tên công ty + vị trí chính xác từ job context.

5. Ngôn ngữ + greeting/closing: tuân theo block "NGÔN NGỮ OUTPUT" trong user prompt. Block đó quy định greeting mở đầu, chữ ký kết thúc, và hard limit (250 từ/words).

6. Kết thúc bằng greeting closing ("Trân trọng," / "Sincerely,") rồi xuống dòng rồi tên ứng viên (lấy từ CV nếu có) — KHÔNG thêm gì sau tên. KHÔNG note / disclaimer / "Note:" / "Lưu ý:" sau chữ ký.

CHỐT: Nếu bạn suy nghĩ nội bộ, hãy giữ nó trong đầu và CHỈ xuất raw text của cover letter. Output cuối cùng của bạn phải là THƯ XIN VIỆC, không có gì khác.`;

/**
 * Build user prompt từ CV (parsed JSON) + job context + ngôn ngữ.
 *
 * @param cv Parsed CV data (cvs.parsedData) — có thể null nếu CV chưa parse xong.
 * @param job Job context tối thiểu cần để viết cover letter phù hợp.
 * @param language 'vi' | 'en' — ngôn ngữ output. Mặc định 'vi' nếu không truyền.
 */
export const buildCoverLetterUserPrompt = (params: {
  cv: Record<string, unknown> | null;
  job: {
    title: string;
    companyName: string | null;
    industry: string | null;
    description: string | null;
    requirements: string | null;
    jobLevel: string | null;
    requiredSkills: string[];
    niceToHaveSkills: string[];
    experienceYearsMin: number | null;
  };
  language?: CoverLetterLanguage;
}): string => {
  const { cv, job, language = 'vi' } = params;
  const langGuide = getCoverLetterLanguageGuide(language);
  const cvSection = cv
    ? `CV của ứng viên (parsed JSON — nội dung có thể là tiếng Việt hoặc tiếng Anh tùy CV):\n${JSON.stringify(cv, null, 2)}\n`
    : 'CV của ứng viên: (chưa có parsed data — viết cover letter tổng quát, KHÔNG bịa thông tin cụ thể).\n';

  return `${langGuide}

THÔNG TIN JOB ỨNG TUYỂN:
- Vị trí: ${job.title}
- Công ty: ${job.companyName ?? '(không rõ)'}
- Ngành: ${job.industry ?? '(không rõ)'}
- Cấp bậc: ${job.jobLevel ?? '(không rõ)'}
- Kinh nghiệm yêu cầu: ${job.experienceYearsMin != null ? `tối thiểu ${job.experienceYearsMin} năm` : '(không yêu cầu cụ thể)'}
- Kỹ năng yêu cầu: ${job.requiredSkills.length ? job.requiredSkills.join(', ') : '(không liệt kê)'}
- Kỹ năng ưu tiên: ${job.niceToHaveSkills.length ? job.niceToHaveSkills.join(', ') : '(không liệt kê)'}
- Mô tả công việc (tóm tắt):
${(job.description ?? '').slice(0, 800)}
- Yêu cầu ứng viên (tóm tắt):
${(job.requirements ?? '').slice(0, 600)}

${cvSection}

YÊU CẦU OUTPUT CUỐI CÙNG:
- ÁP DỤNG greeting + closing + hard limit theo language guide ở trên.
- Chỉ xuất raw text cover letter 3 đoạn, KHÔNG có tiêu đề / heading / suy nghĩ nội bộ / <thinking> / "THOUGHTS:" / markdown fence / lời dẫn / placeholder.
- Bắt đầu ngay bằng greeting ("Kính gửi..." hoặc "Dear...") — đây là dòng ĐẦU TIÊN của output, không có gì phía trước.
- Tên công ty + vị trí phải chính xác từ job context ở trên.`;
};
