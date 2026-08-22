/**
 * Smoke test cho LangChain + LangSmith integration.
 * Chạy: npx tsx src/scripts/test-jobModeration.ts
 * Xem trace: https://smith.langchain.com/o/default/projects/p/jobmatch-vn
 */
import 'dotenv/config';
import { invokeJobModeration } from '../src/lib/llm/index';

// === Prompt inline (tạm thời) — lát sẽ tách ra src/prompts/jobModeration.ts ===
const SYSTEM_PROMPT = `Bạn là hệ thống kiểm duyệt job posting cho thị trường VN.
Nhiệm vụ: phát hiện nội dung vi phạm (phân biệt đối xử, lừa đảo, lộ PII, thô tục).

Quy tắc output: CHỈ trả JSON theo format đã cho, không giải thích.

Severity:
- "block": KHÔNG được đăng — vi phạm pháp luật / lừa đảo / phân biệt đối xử
- "warn": Cảnh báo — chất lượng thấp / lộ thông tin nhạy cảm

Category: discrimination_gender | scam_mlm | pii_leak_post | profanity | low_quality_vague | ...

Field (BẮT BUỘC dùng ENUM tiếng Anh, không phải label tiếng Việt):
- "Tiêu đề" → "title"
- "Mô tả" → "description"
- "Yêu cầu" → "requirements"
Field MUST be exactly one of: 'title' | 'description' | 'requirements'.

Nguyên tắc:
1. Khi nghi ngờ → "flagged" + severity "block" an toàn hơn false positive
2. Trích quote chính xác từ input, đừng paraphrase
3. Nếu không tìm vi phạm → verdict "approved", flags rỗng, score = 0.95+

QUAN TRỌNG: Output CHỈ chứa raw JSON, KHÔNG giải thích trước/sau, KHÔNG dùng markdown code fence.`;

const SAMPLE_JOBS = [
    {
        label: '✅ Clean job (kỳ vọng: approved)',
        prompt: `Tiêu đề: Tuyển Backend Developer
Mô tả: Làm việc với Node.js, PostgreSQL, Redis. Lương 20-30 triệu. Làm tại HCM.
Yêu cầu: 2+ năm kinh nghiệm, biết Docker.`,
    },
    {
        label: '❌ Discriminatory job (kỳ vọng: flagged, discrimination_gender)',
        prompt: `Tiêu đề: Tuyển nhân viên bán hàng
Mô tả: Ưu tiên nữ 18-25t, ngoại hình ưa nhìn. Lương 6-8 triệu + hoa hồng.
Yêu cầu: Tốt nghiệp THPT, không yêu cầu kinh nghiệm. Liên hệ SĐT 0909123456.`,
    },
];

(async () => {
    console.log('🚀 Bắt đầu test LangChain + LangSmith\n');
    console.log(`Project: ${process.env.LANGCHAIN_PROJECT}`);
    console.log(`Model:   ${process.env.GEMINI_CHAT_MODEL}\n`);

    for (const job of SAMPLE_JOBS) {
        console.log(`\n${'='.repeat(60)}`);
        console.log(job.label);
        console.log('='.repeat(60));

        try {
            const start = Date.now();
            const result = await invokeJobModeration(SYSTEM_PROMPT, job.prompt);
            const duration = Date.now() - start;

            console.log(`\n⏱  Latency: ${duration}ms`);
            console.log(`📊 Verdict:  ${result.verdict}`);
            console.log(`📈 Score:    ${result.score}`);
            console.log(`🚩 Flags:    ${result.flags.length}`);
            result.flags.forEach((f, i) => {
                console.log(`   ${i + 1}. [${f.severity}] ${f.category} @ ${f.field}`);
                console.log(`      Quote: "${f.quote.slice(0, 80)}${f.quote.length > 80 ? '...' : ''}"`);
                console.log(`      Reason: ${f.reasoning.slice(0, 100)}`);
            });
        } catch (err: any) {
            console.error(`❌ Error: ${err.message}`);
            if (err.issues) console.error(JSON.stringify(err.issues, null, 2));
        }
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log('✅ Xong. Check trace tại:');
    console.log('   https://smith.langchain.com/o/default/projects/p/jobmatch-vn');
    console.log('   (Đợi 5-10s để trace sync lên LangSmith)');
})();
