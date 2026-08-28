# Chatbot JobMatch

> Nghiệp vụ chatbot AI của JobMatch VN — mô tả **cách chatbot hoạt động**, **khả năng và giới hạn**, và **các quyết định thiết kế cần chốt**.

---

## 1. Vài phút tổng quan

Chatbot JobMatch hoạt động tương tự các chatbot AI phổ biến (ChatGPT, Claude…): **user hỏi tự do**, trả lời tự nhiên.

Điểm khác biệt cốt lõi:

- **Context do user tự gắn**: 2 ô cuộn chọn ngay trên UI — chọn job và chọn CV từ danh sách của user. Không phụ thuộc vào URL trang.
- **Multi-intent routing**: mỗi câu hỏi được phân loại (intent) qua LLM bước 1, sau đó gọi prompt template riêng cho từng nhóm chủ đề.
- **Tích hợp dữ liệu thật**: truy vấn jobs/CV/billing/FAQ qua backend JobMatch thay vì dùng kiến thức chung.

### Dùng ở đâu

Chatbot nằm trên **trang riêng** (ví dụ `/chatbot`), giao diện tương tự [chatgpt.com](https://chatgpt.com) — full-page chat, sidebar lịch sử, ô prompt ở dưới.

| Yếu tố | Mô tả |
|---|---|
| **Bối cảnh sử dụng** | Không gắn URL trang; truy cập bằng cách vào route `/chatbot` (candidates & employers đều dùng được). Không có widget chat nổi trên các trang khác. |
| **Context** | Hoàn toàn do user tự gắn qua 2 ô picker ngay trên UI (xem §4): **job** và **CV**. |
| **Bookmarkable** | Trang có URL dạng `/chatbot` hoặc `/chatbot?session=<id>` — user share link session được. |

### Ai dùng

| Đối tượng | Cách dùng |
|---|---|
| Ứng viên | Hỏi về job, JD, CV, hồ sơ đã nộp, gói dịch vụ, cách dùng sàn — hoặc hỏi bất cứ gì |
| Nhà tuyển dụng | Hỏi về cách đăng tin, gói tuyển dụng, thống kê tin, cách dùng employer dashboard |
| Khách chưa đăng nhập | Hỏi giới hạn (không có CV, không xem được tin riêng, không xem billing) |

---

## 2. Phạm vi (cần chốt)

**Trong phạm vi ban đầu:**

- Chat theo phiên có lưu lịch sử (per user; per job khi gắn ngữ cảnh job)
- Gắn context qua 2 picker (CV + job) trên UI — không upload file
- Truy vấn dữ liệu nền: jobs (pgvector + SQL), CV (đã parse), billing plans, FAQs của sàn
- Trả lời bằng tiếng Việt mặc định

**Ngoài phạm vi (chưa có kế hoạch):**

- Tạo nội dung dài (CV, cover letter) — đã có tool riêng
- Giao dịch tài chính — qua payment flow riêng
- Hỗ trợ kỹ thuật account (đổi email, xoá tài khoản) — qua support channel
- Phát nội dung vi phạm / lừa đảo — moderation lớp dưới chặn trước

---

## 3. Luồng xử lý 2 bước

```
┌──────────────────────────────────────────────────────────────────┐
│  Input: câu hỏi + context (jobIds, cvIds                       │
│         do user gắn qua picker) + lịch sử 2–3 lượt gần nhất   │
└──────────────────────────────────────────────────────────────────┘
                          │
                          ▼
        ┌─────────────────────────────────────────┐
        │ BƯỚC 1 — Intent Classification          │
        │ Model nhỏ/nhanh (gemini-flash)         │
        │ Output JSON: { types[], confidence, … }│
        └─────────────────────────────────────────┘
                          │  (route theo type)
                          ▼
        ┌─────────────────────────────────────────┐
        │ BƯỚC 2 — Xử lý theo type               │
        │ Mỗi type 1 prompt template + xử lý    │
        │ trung gian (search, tra cứu, embed...) │
        └─────────────────────────────────────────┘
                          │
                          ▼
              SSE stream câu trả lời
```

### 3.1. Bước 1 — Intent Classification

LLM lần 1 nhận input: câu hỏi raw + context (jobIds, cvIds) + lịch sử ngắn. Trả về JSON structured.

**Schema output — multi-intent, sắp theo độ ưu tiên:**

```json
{
  "types": ["cv_jd_match", "billing_plan"],
  "confidence": 0.92
}
```

Phần tử đầu mảng `types` là intent chính — bước 2 xử lý theo thứ tự (kết hợp kết quả các intent phụ).

**Danh sách type:**

| Type | Ý nghĩa | Ví dụ |
|---|---|---|
| `cv` | Hỏi về nội dung CV user đã gắn vào context | *"CV tôi thiếu gì?"*, *"Mục kinh nghiệm viết tốt chưa?"* |
| `jd` | Hỏi về nội dung job user đã gắn vào context | *"Job này yêu cầu bao nhiêu năm KN?"*, *"Có yêu cầu bằng cấp không?"* |
| `cv_jd_match` | So sánh CV ↔ job trong context | *"CV tôi match job này bao nhiêu %?"*, *"Tôi có đủ yêu cầu không?"* |
| `search` | Tìm job trên sàn | *"Có job backend nào không?"*, *"Tìm job remote cho freshers"* |
| `billing_plan` | Hỏi về gói dịch vụ | *"Gói free có gì?"*, *"Pro có AI score CV không?"*, *"Tôi đang dùng gói gì?"* |
| `application` | Hỏi về hồ sơ đã nộp | *"Hồ sơ tôi nộp tuần trước đang ở đâu?"*, *"Nhà tuyển dụng đã xem chưa?"* |
| `interview` | Hỏi về phỏng vấn / lịch hẹn | *"Lịch phỏng vấn của tôi tuần này?"*, *"Phỏng vấn vòng 2 hỏi gì?"* |
| `account` | Câu hỏi về tài khoản cá nhân (đăng nhập, cài đặt) | *"Đổi email thế nào?"*, *"Xoá tài khoản?"* |
| `system_info` | Hỏi cách dùng sàn (FAQ chung) | *"Làm sao tải CV lên?"*, *"Cách rút hồ sơ?"* |
| `general` | Câu hỏi ngoài nghiệp vụ | *"Thời tiết Hà Nội?"*, *"AI là gì?"* |

> ⚠️ `application`, `interview`, `account`, `system_info` — chưa có schema/data đầy đủ để bước 2 trả lời chính xác. Khi đó fallback `general` cho tới khi nguồn dữ liệu sẵn sàng.

**Confidence & UX khi intent không rõ:**

- Confidence ở giai đoạn này mang tính định tính (LLM tự đánh giá). Ngưỡng không chốt cứng — sẽ **tinh chỉnh trong lúc test dựa trên dữ liệu thật**.
- Khi intent không rõ (model trả `types` rỗng, hoặc model lúng túng) → bot **hỏi lại user** (VD: *"Bạn muốn hỏi về CV, về job, hay về gói dịch vụ?"*).

**Luồng "hỏi lại user":**

- Câu hỏi lại vẫn tính là **1 lượt bình thường trong lịch sử hội thoại** — không có luồng riêng.
- Câu trả lời tiếp theo của user được đưa lại vào **Bước 1 cùng với câu hỏi gốc trước đó** (2 lượt gần nhất: câu hỏi ban đầu + câu trả lời làm rõ) để classify lại.
- Lượt hỏi-lại vẫn **tính vào token budget** như các lượt khác (xem §3.3).

**Cache kết quả intent classification (bước 1):**

- **Có cache** — tránh gọi LLM thừa khi user gửi nhiều câu gần giống nhau trong cùng phiên.
- **Cache key**: `hash(question + context.jobIds + context.cvIds)` trong cùng session. Khi user đổi picker (jobIds/cvIds thay đổi) → key đổi → cache miss → classify lại.
- **TTL đề xuất: 5 phút**. Sau TTL → classify lại để đảm bảo intent cập nhật.
- Lưu in-memory (Map trong service) hoặc Redis — chốt trong lúc implement.

### 3.2. Bước 2 — Xử lý theo type

Bước 2 nhận `types[]` (đã sắp thứ tự ưu tiên) và xử lý theo từng type trong mảng, kết hợp kết quả vào prompt cuối. Mỗi type có cách xử lý trung gian riêng:

| Type | Xử lý trung gian | Prompt template / Output |
|---|---|---|
| `cv` | Đọc `cvs.parsedData` của CV đã gắn trong context | Trả lời dựa trên nội dung CV + câu hỏi |
| `jd` | Đọc row `jobs` của job đã gắn trong context | Trả lời dựa trên nội dung job + câu hỏi |
| `cv_jd_match` | **Embedding similarity** (cosine) → skill overlap/missing | Trả về **match % + liệt kê điểm còn thiếu** (skill, số năm kinh nghiệm…) |
| `search` | **Semantic search** pgvector → top-k job rows | Diễn giải tự nhiên. **Chỉ search theo đúng câu user truyền**, không bổ sung từ profile user |
| `billing_plan` | Tra cứu DB: `SELECT * FROM billing_plans` + `users.subscription_tier` | Bot chỉ biết **số gói hiện có trong hệ thống** + **gói user đang dùng**. Không suy diễn khuyến mãi / cam kết ngoài DB |
| `application` | Tra cứu `applications` của user (status, viewed, response) | Trả lời về hồ sơ user đã nộp |
| `interview` | Tra cứu `interview_schedules` của user | Lịch phỏng vấn, trạng thái, ghi chú |
| `account` | Tra cứu `users` + `account_settings` | Cài đặt cá nhân, đổi email/phone, xoá tài khoản |
| `system_info` | Tra cứu FAQ nội bộ (`system_docs`) | FAQ của sàn. **Chưa có data** — bổ sung sau. |
| `general` | — | Trả lời tự do, không ràng buộc nghiệp vụ |

**Nguyên tắc chung:**

- Các type có truy vấn: câu trả lời **bám data** đã truy vấn. Cần ngoài data → nói rõ là suy luận hoặc fallback `general`.
- `general`: chỉ tuân thủ policy chung (lịch sự, không vi phạm pháp luật).
- Mọi type — output tiếng Việt, format bullet/heading tuỳ nội dung.

**Multi-intent có type mâu thuẫn (data thật vs `general`):**

- Khi `types[]` gồm cả type có truy vấn data (VD `cv_jd_match`) lẫn `general` → LLM bước 2 xử lý **tách riêng theo từng phần** trong câu trả lời:
  - Phần liên quan data thật → **bám đúng dữ liệu đã truy vấn**, không thêm suy diễn.
  - Phần `general` → trả lời **tự do độc lập**.
- Tránh để phần `general` "lây" giọng suy diễn sang phần data thật.

**Fallback lỗi:** hiện **không có fallback** sang model khác. Nếu Gemini lỗi/timeout → trả lỗi thẳng cho user để xử lý thủ công.

### 3.3. Token budget

- **Mỗi session có cap tổng cộng 50.000 token** (cumulative input + output, tính trên cả bước 1 và bước 2).
- Track `totalTokens` trong `ai_chat_sessions` (jsonb metadata) — cộng dồn sau mỗi lượt stream xong.
- **Khi `totalTokens >= 50.000`**: chặn lượt mới, trả thông báo *"Phiên chat đã dùng hết token. Bạn có thể tạo session mới để tiếp tục."*
- **Khi `totalTokens >= 45.000`** (90%): cảnh báo nhẹ trong UI — *"Phiên sắp hết token, cân nhắc tạo phiên mới."*
- Lượt "hỏi lại user" của bước 1 (khi intent không rõ) vẫn tính vào budget như lượt thường.

---

## 4. Ngữ cảnh đầu vào

### 4.1. UI gắn context — 2 ô picker trên trang chatbot

Ngay phía trên ô prompt có **2 ô cuộn chọn** (giống các filter chip), phân quyền theo **dữ liệu của chính user đó**:

#### Ô "Chọn job"

Danh sách job **chia 3 mục rõ ràng**:

| Mục | Nguồn | Hành vi |
|---|---|---|
| **Tất cả job** | `GET /jobs/search` + search input (filter industry/city/level) | Tìm job bất kỳ trên sàn |
| **Job đã lưu** | `saved_jobs` của user | Job user từng bookmark |
| **Job đã ứng tuyển** | `applications` của user | Job user từng apply |

#### Ô "Chọn CV"

- Nguồn: `cvs` table của **user đang đăng nhập**.
- **Mỗi người chỉ được thấy CV của họ** — không public, không xem được CV người khác.

**Multi-select có giới hạn:**

- Cả 2 picker đều multi-select, **tổng số job + CV đã gắn ≤ 3** (đề xuất cap `<4`, sẽ chốt khi test).
- Mỗi lượt chọn → thêm pill. Bỏ chọn → pill biến mất.

**UX khi đạt giới hạn:**

- Khi user đã gắn đủ 3, các item còn lại trong 2 ô picker **disable** (mờ đi, không click được).
- Hiển thị tooltip: *"Bạn chỉ có thể gắn tối đa 3 job/CV cùng lúc. Bỏ chọn bớt để thêm mới."*
- **Không dùng toast lỗi** — picker đã disable sẵn, tránh spam thông báo.

**Nút "Reset context":**

- Có nút riêng để xoá hết job/CV đang gắn trong 1 lần bấm.

**Nguyên tắc quan trọng:**
- Context hoàn toàn do user gắn, hệ thống **không tự suy ra** từ URL hay trang đang xem.
- Mỗi lượt chat dùng đúng context user đã gắn tại thời điểm gửi.
- Cập nhật picker → đổi context cho lượt kế tiếp (không retroactive lượt trước).
- **CV / Job trong picker chỉ là reference (id)** — khi render prompt, backend `SELECT` lại bản ghi tương ứng từ `cvs` / `jobs` table để lấy `parsedData` / facts có sẵn. **Không parse lại file**.

### 4.2. Cấu trúc context mỗi lượt

```
┌─────────────────────────────────────────┐
│ Câu hỏi user (raw text)                │
├─────────────────────────────────────────┤
│ Context do user gắn qua picker         │
│  - jobIds: [uuid, ...]   ──► SELECT jobs.* (parsed) │
│  - cvIds:  [uuid, ...]   ──► SELECT cvs.parsedData  │
├─────────────────────────────────────────┤
│ Subscription tier (nếu cần cho         │
│ billing/intent classification)         │
├─────────────────────────────────────────┤
│ Lịch sử 2–3 lượt gần nhất            │
└─────────────────────────────────────────┘
```

### 4.3. Lưu trữ & persistence

- **Session**: mỗi session của user có context riêng (jsonb `{ jobIds: [], cvIds: [] }`) — thêm/bớt job hoặc CV trên picker sẽ PATCH session. Đây chỉ là **danh sách ID**, không lưu nội dung.
- **Job context**: lúc render prompt, `SELECT * FROM jobs WHERE id = ANY($jobIds)` để lấy row mới nhất.
- **CV context**: tương tự, `SELECT parsed_data FROM cvs WHERE id = ANY($cvIds)`.

**Job trong context bị đóng sau khi user đã gắn:**

- Bot vẫn trả lời dựa trên **snapshot job** lúc render prompt (vẫn SELECT row hiện tại).
- Câu trả lời kèm **thông báo trạng thái hiện tại** của job (VD: *"Job này hiện đã ở trạng thái 'closed' — dưới đây là thông tin lúc bạn gắn vào context"*).

**Persistent context trong session:**

- **Đã chốt**: gắn 1 lần qua picker, **dùng lại cho các lượt sau** cho tới khi user bỏ chọn hoặc bấm Reset.
- Cách làm cụ thể (frontend giữ state + sync xuống backend qua PATCH `session.context`) cần làm rõ trong lúc implement.

---

## 5. Semantic Search (chỉ là 1 nhánh của type `search`)

Semantic search là 1 nhánh xử lý, không phải module tách biệt.

### Quy trình trong nhánh `search`

```
Câu hỏi user
    ↓
1. Embed câu hỏi → 768-dim vector
   (gemini-embedding-001, outputDimensionality=768)
    ↓
2. Query pgvector:
   SELECT jobs + embeddings
   WHERE status='live' AND similarity >= 0.55
   ORDER BY cosine_distance ASC
   LIMIT 5
    ↓
3. Lấy top-k job rows (id, title, company, salary, location…)
    ↓
4. Đưa rows vào prompt LLM, kèm:
   "Chỉ dùng thông tin từ danh sách job dưới,
    không tự thêm job khác, không bịa số liệu ngoài search"
    ↓
5. Stream câu trả lời về client
```

### Tận dụng code hiện có

- [lib/llm/jobEmbedding.ts — `searchSimilarJobs()`](backend/src/lib/llm/jobEmbedding.ts) đã có sẵn, threshold 0.55.
- Schema `embeddings.content_type = 'job'` đã có — không cần migration.

### Edge case

- top-k = 0 (không tìm được) → LLM nói *"Hiện chưa có job phù hợp, bạn thử từ khoá khác"*
- top-k > 5 → giới hạn 5 để prompt không phình

---

## 7. So sánh với chatbot AI thông thường

| Tiêu chí | ChatGPT / Claude | Chatbot JobMatch |
|---|---|---|
| Hỏi tự do, đa chủ đề | Có | Có |
| Trang riêng full-page, sidebar lịch sử chat | Có (chatgpt.com) | **Có — `/chatbot`** |
| Gắn context bằng picker trên UI (job, CV) | Không | **Có — 2 ô cuộn chọn ngay trên trang chat** |
| Truy vấn dữ liệu nghiệp vụ (job, CV, billing) | Không | **Có — semantic search + DB + FAQ** |
| Ngôn ngữ mặc định | Tuỳ setting | Tiếng Việt |

**Điểm khác biệt cốt lõi:** Chatbot JobMatch cho phép user **gắn job & CV vào context qua picker** (multi-select, persistent trong session), rồi truy vấn dữ liệu thật của sàn cho câu trả lời thuộc nghiệp vụ.

---

## 8. Câu hỏi mở / cần chốt

> Các câu dưới đây chưa có câu trả lời chốt. Các quyết định đã chốt được ghi thẳng trong §3, §4, §5.

- [ ] **Persistent context implementation** — frontend giữ state (jobIds/cvIds) trong Pinia store, sync xuống backend bằng PATCH `session.context` mỗi khi user đổi picker — chốt chi tiết timing/optimistic UI.
- [ ] **`system_info`** — bổ sung FAQ nội bộ (`system_docs`) sau khi có data.
