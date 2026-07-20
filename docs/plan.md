# JobMatch VN — Sản phẩm nghiên cứu

**Project:** Nền tảng Tuyển dụng & Sắp xếp phỏng vấn tự động (Smart Recruitment)  
**Version:** 3.0 (Đề tài nghiên cứu chính thức)  
**Date:** 2026-07-10  
**Owner:** Nhóm sinh viên thực hiện nghiên cứu

> **Stack:** Backend NodeJS (Express + TypeScript) · Frontend Vue 3 + TypeScript · Database PostgreSQL + pgvector · AI đa provider (OpenAI, DeepSeek, Anthropic, Gemini) · **n8n** cho workflow tự động hóa · **Dialogflow CX** cho chatbot · Redis · Socket.IO realtime · PayOS (VN).

> **Phạm vi ngành:** Tất cả các ngành (theo yêu cầu mở rộng từ giới hạn CNTT ban đầu của thầy).

---

## 1. Đề tài & Mục tiêu

### 1.1 Đề tài (từ giảng viên hướng dẫn)

> *"Nền tảng Tuyển dụng & Sắp xếp phỏng vấn tự động (Smart Recruitment)"* — gồm 3 phase:
> - **Phase 1:** ATS theo vị trí việc làm (JD) — web đăng tuyển, ứng viên nộp CV, tìm kiếm theo tiêu chí.
> - **Phase 2:** Tự động sàng lọc CV dựa trên JD — scan CV, tra cứu GitHub, verify references, ranking tương thích.
> - **Phase 3:** Lên lịch phỏng vấn & gửi bài test — AI gửi test theo năng lực, schedule phỏng vấn với email confirm + reminder.

### 1.2 Mục tiêu cụ thể

- **Functional:** 1 web hoàn chỉnh phục vụ 3 actor: **Ứng viên**, **Nhà tuyển dụng (HR)**, **Admin**.
- **Automation:** giảm 70% thao tác thủ công của HR nhờ n8n workflow.
- **AI quality:** CV scan chính xác ≥ 85%, ranking score phản ánh đúng ≥ 75% (theo feedback HR).
- **Schedule quality:** ứng viên confirm lịch ≥ 60%, không bị miss slot.
- **Demo:** chạy được end-to-end Phase 1 → 2 → 3 với data mẫu 100 JD + 500 CV.

### 1.3 Phạm vi ngoài

- Không tích hợp thanh toán PayOS (không cần cho đề tài ATS).
- Không cần mobile app — chỉ web responsive.
- Multi-language: tiếng Việt (chính) + tiếng Anh (phụ).

---

## 2. Roadmap 3 Phase (theo yêu cầu báo cáo của thầy)

> Thầy yêu cầu: *"Các bạn hoàn thiện mỗi phase lên lịch báo cáo cho Thầy nhé... (online - offline tùy các bạn)."*

### Timeline đề xuất (16 tuần)

```
Tuần 1–2    : Setup repo, docker, schema DB, auth (email + OAuth)
Tuần 3–4    : Phase 1 — Company/JD CRUD, Search, Apply CV
Tuần 5      : 🟢 BÁO CÁO PHASE 1 (Tuần 5) — demo web tuyển dụng
Tuần 6–8    : Phase 2 — CV scan AI, GitHub lookup, reference verify
Tuần 9      : 🟢 BÁO CÁO PHASE 2 (Tuần 9) — demo auto-screening
Tuần 10–12  : Phase 3 — AI test (IQ/English), Interview scheduler
Tuần 13–14  : Dialogflow chatbot, polish, admin dashboard
Tuần 15     : 🟢 BÁO CÁO PHASE 3 (Tuần 15) — demo full end-to-end
Tuần 16     : Hoàn thiện, fix bug, viết báo cáo, chuẩn bị bảo vệ
```

### Phân công nhóm (4 người gợi ý)

| Thành viên | Phụ trách | Module chính |
|---|---|---|
| **TV1 — Lead Backend** | NodeJS + DB + n8n | Auth, JD/Apply, CV scan pipeline, n8n workflows, scheduler |
| **TV2 — AI/ML** | AI providers + Dialogflow | CV parse/score, AI test (IQ/English), chatbot, embedding |
| **TV3 — Frontend** | Vue 3 + UX | Tất cả views, components, responsive, realtime UI |
| **TV4 — Fullstack + DevOps** | Integration + deploy | GitHub lookup, reference verify, Docker, CI/CD, báo cáo |

---

## 3. Functional Requirements — chi tiết theo 3 Phase

### PHASE 1 — ATS cơ bản (Web tuyển dụng)

> **Mục tiêu:** web cho HR đăng JD, ứng viên nộp CV, tìm kiếm theo tiêu chí.

#### F1. Quản lý tài khoản (3 role)
- **F1.1** Đăng ký / đăng nhập bằng **email + password**.
- **F1.2** Đăng nhập bằng OAuth: **Google**, **Facebook**, **GitHub** (PKCE flow).
- **F1.3** Xác minh email qua OTP (5 phút expiry).
- **F1.4** Phân quyền 3 role: **Candidate**, **Employer** (HR), **Admin**.
- **F1.5** Quên mật khẩu / reset qua email.

#### F2. Ứng viên (Candidate)
- **F2.1** Tạo / sửa / xóa CV (multi-CV).
- **F2.2** Upload CV (PDF, DOCX) — AI bóc tách tự động điền form.
- **F2.3** Tìm kiếm việc làm theo: keyword, location, ngành, cấp bậc, loại hình, salary range.
- **F2.4** Search insight (AI gợi ý lương thị trường, top công ty, kỹ năng hot).
- **F2.5** Apply job 1-click (kèm CV + cover letter).
- **F2.6** Saved jobs, Job alerts (email + realtime).
- **F2.7** Lịch sử apply với status (pending → viewed → screening → interview → offered/rejected).
- **F2.8** Hồ sơ ẩn danh (ẩn tên + email khi apply).
- **F2.9** Đánh giá công ty (review, rating 1–5).

#### F3. Nhà tuyển dụng (Employer / HR)
- **F3.1** Company profile (logo, cover, mô tả, địa chỉ, website, scale, ngành nghề).
- **F3.2** Xác minh công ty (upload giấy phép KD, admin duyệt).
- **F3.3** **JD CRUD** — rich editor với các trường: title, description, **requirements (skills, years of experience, certifications)**, benefits, salary range, deadline, **ngành nghề**, **cấp bậc**, **loại hình (full-time/part-time/contract/internship)**.
- **F3.4** AI sinh JD mẫu (nhập vài keyword → AI sinh JD hoàn chỉnh).
- **F3.5** Quản lý JD (draft → pending → live → expired → closed).
- **F3.6** Xem danh sách ứng viên apply — filter theo: status, score, keyword, location, ngành.
- **F3.7** **Bulk actions**: invite to interview, reject, save to talent pool.
- **F3.8** **ATS pipeline** (kanban) theo stage: `new` → `screening` → `interview` → `offer` → `hired` / `rejected`.
- **F3.9** Gửi email template cho ứng viên (interview invite, rejection, offer) — qua n8n.
- **F3.10** Analytics dashboard (views, applies, conversion rate, time-to-hire).
- **F3.11** **Featured jobs** (lên top — free 1 JD/tháng cho user mới).

#### F4. Admin
- **F4.1** Quản lý users (ban, unban, xem chi tiết).
- **F4.2** Duyệt JD + AI moderation (phát hiện spam).
- **F4.3** Duyệt company verification.
- **F4.4** Báo cáo tổng quan (MAU, JD posted, applications, time-to-hire).
- **F4.5** Quản lý master data: ngành nghề, kỹ năng, địa điểm, cấp bậc.
- **F4.6** Audit log.

#### F5. Realtime & Communication
- **F5.1** **Chat realtime** ứng viên ↔ HR (Socket.IO + typing + read receipt).
- **F5.2** **Notification realtime** (Socket.IO + Web Push + email digest) cho: status change, new message, new match, schedule reminder.
- **F5.3** Follow công ty (nhận update khi đăng JD mới).

---

### PHASE 2 — Tự động sàng lọc CV (Auto-screening)

> **Mục tiêu:** *"Dựa vào JD đã đưa lên, tiến hành 'scan cv' bằng cách đánh giá các tiêu chi trong JD và CV có phù hợp ko. Ví dụ yêu cầu 3 năm kinh nghiệm thì trong CV phải có nội dung >= 3 năm lĩnh vực đó... Tra cứu link github có tồn tại ko? Tra cứu các thông tin người tham chiếu trong CV có xác thực không... Đánh giá xếp hạng tương thích với JD"* — trích yêu cầu của thầy.

#### F6. AI CV Scan theo JD (core Phase 2)

Khi ứng viên apply JD, hệ thống **tự động** chạy scan pipeline:

**F6.1. Trích xuất yêu cầu từ JD** (dùng LLM):
- Kỹ năng bắt buộc (required skills) — VD: `Java, Spring Boot, PostgreSQL`.
- Kỹ năng nice-to-have.
- Số năm kinh nghiệm tối thiểu / tối đa.
- Bằng cấp (Đại học / Cao đẳng / không yêu cầu).
- Chứng chỉ (nếu có trong JD).
- Ngành nghề trước đây (industry history).
- Địa điểm / remote OK.

**F6.2. Scan từng tiêu chí** (so khớp JD ↔ CV):

| Tiêu chí | Cách scan | Điểm tối đa |
|---|---|---|
| **Years of experience** | Parse ngày bắt đầu/kết thúc từng job trong CV → tổng năm theo lĩnh vực → so với JD | 25 |
| **Required skills** | Match từng skill trong JD với `skills[]` trong CV (fuzzy match cho phép viết tắt: `JS` = `JavaScript`) | 30 |
| **Education** | So bằng cấp + chuyên ngành (nếu JD yêu cầu) | 10 |
| **Certifications** | Match chứng chỉ trong CV với JD list | 5 |
| **Industry history** | Parse `experience[].industry` → match với ngành JD | 5 |
| **Location fit** | So location CV vs JD (có remote OK không) | 5 |
| **GitHub profile** (xem F6.3) | Có GitHub + repo count + contribution | 10 |
| **Reference verify** (xem F6.4) | Email người tham chiếu verified | 5 |
| **Cover letter quality** | LLM đánh giá độ liên quan, ngôn ngữ, sự nghiêm túc | 5 |
| **Tổng** | | **100** |

**F6.3. Auto scoring & ranking**:
- Tính `match_score` (0–100) cho từng (candidate, JD).
- Tự động **status transition**:
  - `match_score ≥ 75` → `auto-screening-passed` (chuyển sang stage `screening`).
  - `match_score 50–74` → `auto-screening-review` (HR xem lại).
  - `match_score < 50` → `auto-screening-rejected` (gửi email polite reject tự động qua n8n).
- Lưu `ai_match_reasoning` (JSONB) giải thích điểm từng tiêu chí.

#### F7. GitHub Profile Lookup

**F7.1.** Tự động detect GitHub URL trong CV (regex: `github.com/[a-zA-Z0-9-]+`).
**F7.2.** Kiểm tra GitHub user có tồn tại không (gọi GitHub API: `GET /users/{username}`).
**F7.3.** Lấy thông tin public:
- Số public repos, số followers/following.
- Top 5 repos theo stars (lưu `top_repos` JSONB).
- Contribution count (year) qua GitHub GraphQL.
- Ngôn ngữ lập trình chính (qua repos language).
- Account age (từ `created_at`).

**F7.4.** Đánh giá:
- Tài khoản thật (`has_activity = true` nếu có ≥ 1 repo trong 6 tháng qua).
- Tài khoản "ảo" / spam (no repos, no followers, no activity).
- Cảnh báo HR nếu GitHub không tồn tại hoặc có dấu hiệu giả mạo.

**F7.5.** Cache kết quả GitHub 7 ngày (Redis) để tránh rate limit.

#### F8. Reference Verification

**F8.1.** Tự động detect người tham chiếu trong CV:
- Phần "References" (nếu có).
- Hoặc extract từ LLM với schema: `[{name, email, phone, relationship, company}]`.

**F8.2.** Verify email người tham chiếu:
- Validate format email.
- Check MX record có tồn tại không.
- **Gửi email xác minh** qua n8n workflow:
  - Email chứa link confirm (token 32 char, expire 7 ngày).
  - Người tham chiếu click → xác nhận "Tôi xác nhận [tên ứng viên] đã làm việc tại [công ty] trong [khoảng thời gian]".
  - Lưu `verified_at` + `verification_method`.

**F8.3.** Lưu trạng thái:
- `pending` (chưa gửi email).
- `sent` (đã gửi, chờ confirm).
- `verified` (đã xác nhận).
- `failed` (email bounce / người tham chiếu từ chối).

**F8.4.** Nếu người tham chiếu không phản hồi sau 14 ngày → đánh dấu `expired`, HR tự quyết định.

#### F9. Auto-Reject Email (qua n8n)

**F9.1.** Với `match_score < 50`, tự động:
- Gửi email polite reject (template tiếng Việt + tiếng Anh).
- Lưu email vào `email_logs` để audit.
- Cho phép HR override (mở lại trạng thái `pending`).

**F9.2.** Template email:
- Tiếng Việt: *"Cảm ơn bạn đã quan tâm vị trí [JD title] tại [Company]. Sau khi xem xét, chúng tôi nhận thấy hồ sơ chưa phù hợp... Chúc bạn tìm được cơ hội phù hợp."*
- Có thể tùy biến template trong Admin.

#### F10. HR Dashboard cho Auto-screening

- **F10.1.** Bảng Kanban ATS với filter theo JD, score range, status.
- **F10.2.** Click vào 1 candidate → xem chi tiết:
  - CV parsed + điểm từng tiêu chí.
  - GitHub profile preview (nếu có).
  - Reference status.
  - Match reasoning từ LLM.
- **F10.3.** Nút "Invite to interview" → chuyển sang Phase 3.

---

### PHASE 3 — Lên lịch phỏng vấn & Bài test AI

> **Mục tiêu:** *"AI Gửi bài test theo năng lực qua email (có thể test IQ, test English). Xếp lịch phỏng vấn (gửi email phỏng vấn đến ứng viên -> bắt buộc ứng viên reply confirm lịch trình -> nhắc nhở phỏng vấn)"* — trích yêu cầu của thầy.

#### F11. AI Test (IQ + English)

**F11.1.** Tạo đề thi IQ:
- LLM sinh câu hỏi IQ dạng: logic, pattern, số học, hình ảnh, verbal reasoning.
- Mỗi JD → 1 bộ test riêng (10–20 câu, 30 phút).
- Lưu `ai_tests` (JSONB) với đáp án + điểm.

**F11.2.** Tạo đề thi English:
- LLM sinh câu hỏi theo level (A2/B1/B2/C1) tương ứng JD.
- Dạng: reading comprehension, grammar, vocabulary, essay.
- Auto-grade bằng LLM (kèm rubric).

**F11.3.** Gửi bài test qua email (qua n8n):
- Link unique (token 1 lần, expire 7 ngày).
- UI làm bài trên web (no external tool).
- Auto-save progress, submit khi hết giờ.

**F11.4.** Chấm điểm:
- IQ: so đáp án multiple choice → điểm 0–100.
- English: LLM chấm theo rubric → điểm 0–100 + nhận xét.
- Lưu `test_results` JSONB + gửi email cho HR.

**F11.5.** HR quyết định pass/fail dựa trên `test_score` (mặc định threshold 60).

#### F12. Interview Scheduling

**F12.1.** HR tạo interview slot:
- Chọn JD, candidate, interviewer, location/online, thời gian.
- Hệ thống check conflict (interviewer không có 2 slot trùng giờ).
- Sinh Google Meet / Zoom link (optional — tích hợp sau).

**F12.2.** Gửi email phỏng vấn (qua n8n) tới ứng viên:
- Template HTML: thời gian, location/link, tên interviewer, JD.
- 2 nút: **Xác nhận** / **Đề xuất lại lịch**.
- Token unique, link `/interview/confirm?token=...`.

**F12.3. Ứng viên confirm:**
- Click "Xác nhận" → status chuyển `confirmed`, gửi email cho HR.
- Click "Đề xuất lại" → chọn slot khác từ availability của interviewer.

**F12.4. Reminder tự động (qua n8n):**
- **24 giờ trước** phỏng vấn → gửi email nhắc nhở.
- **2 giờ trước** → gửi email + push notification.
- **15 phút trước** → push notification qua web (nếu user online).

**F12.5. Reschedule / Cancel:**
- Ứng viên có thể đề xuất reschedule trước 24h.
- HR có thể cancel bất kỳ lúc nào (gửi email cho ứng viên).

**F12.6. No-show tracking:**
- Sau 30 phút không xuất hiện → status `no_show`, log cho HR.
- HR quyết định reschedule hay reject.

#### F13. Interview Feedback

**F13.1.** Sau phỏng vấn, interviewer điền form:
- Điểm từng tiêu chí (kỹ năng, giao tiếp, culture fit, technical).
- Nhận xét tổng quát.
- Recommendation: `strong_hire` / `hire` / `no_hire` / `strong_no_hire`.

**F13.2.** AI tóm tắt feedback (LLM) → gợi ý offer/letter.

**F13.3.** Tổng hợp vào ATS: stage tiếp theo (`offer` / `rejected`).

#### F14. Offer Letter

- HR tạo offer (lương, start date, benefits).
- Gửi qua n8n email với PDF đính kèm (auto-gen từ template).
- Ứng viên accept/decline bằng nút trong email.

---

## 4. Chatbot (Dialogflow CX)

> **Mục tiêu:** trợ lý AI hỗ trợ ứng viên 24/7 — giảm tải cho HR.

#### F15. Dialogflow CX Agent

**F15.1.** Các intent chính:
- `ask_how_to_apply` — hướng dẫn apply JD.
- `ask_company_info` — thông tin công ty (lấy từ DB qua webhook).
- `ask_status` — hỏi trạng thái application → webhook gọi backend.
- `ask_salary` — gợi ý salary range cho vị trí.
- `ask_skill_required` — yêu cầu kỹ năng cho JD.
- `escalate_to_human` — chuyển sang HR (tạo ticket).

**F15.2.** Webhook fulfillment gọi backend JobMatch:
- `POST /api/v1/dialogflow/webhook` — nhận request từ Dialogflow, gọi service tương ứng, trả response.

**F15.3.** Embed Dialogflow Messenger widget trên web (góc phải dưới).

---

## 5. Yêu cầu phi chức năng

### 5.1 Performance
- **LCP** < 2.5s trên 4G.
- **API p95** < 500ms (CRUD thường); < 5s cho CV scan pipeline.
- **Search** < 1s cho 10K JD (dùng GIN + Redis cache).
- **CV scan end-to-end** < 30s (async qua BullMQ).
- **Realtime** < 200ms trong region.

### 5.2 Security
- HTTPS only.
- JWT (access 15p + refresh 7d) + rotation.
- bcrypt password (cost 12).
- Rate limit (express-rate-limit + Redis): 100 req/min/user.
- OAuth tokens mã hóa AES-256-GCM khi lưu DB.
- Input validation (Zod) cả server + client.
- File upload: validate MIME + size + scan virus (ClamAV optional).
- CSRF cho form non-GET.
- Audit log cho admin actions.

### 5.3 Scalability
- Stateless API → horizontal scale.
- Redis cache + BullMQ queue.
- Read replica Postgres (sau).
- CDN cho static (Cloudflare).

### 5.4 Cache Strategy
| Layer | What | TTL |
|---|---|---|
| Browser | Static assets | ETag |
| Redis | Search results, JD detail, GitHub lookup | 5–60 min |
| Redis | AI embeddings, LLM FAQ responses | 24h |
| Postgres | Materialized view cho dashboard | 1h |

### 5.5 Search Insight (tính năng Phase 1)
- Trả jobs + insight song song.
- Job count + salary median + top skills + top companies.
- Cache 24h (aggregate cuối ngày).

### 5.6 Usability
- Mobile-first responsive.
- WCAG 2.1 AA.
- Tiếng Việt (chính) + English (phụ).
- Onboarding 3 bước cho user mới.

### 5.7 Observability
- Structured logging (pino).
- Sentry error tracking.
- Prometheus metrics: API latency, AI calls, queue depth, scan success rate.
- n8n workflow logs (riêng).

### 5.8 Reliability
- PM2 cluster + auto-restart.
- Postgres backup daily (pg_dump).
- Health check `/health` + `/ready`.
- n8n workflow có retry + error handling.

---

## 6. Kiến trúc hệ thống (đầy đủ)

```
┌─────────────────────────────────────────────────────────────────────┐
│                  Client (Vue 3 + TS + Vite)                         │
│   Router + Pinia + Socket.IO + Dialogflow Messenger                 │
└────────────────────────────────┬────────────────────────────────────┘
                                 │ HTTP REST + Socket.IO
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│              Nginx / Caddy (Reverse Proxy + TLS)                    │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│         Backend (NodeJS + Express + TypeScript)                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ Routes:  /api/v1/{auth, jobs, applications, ai, scan,     │   │
│  │          schedule, dialogflow, admin, ...}                 │   │
│  └─────────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ Services: auth · job · application · cvScan · githubLookup │   │
│  │           referenceVerify · aiTest · scheduler · chatbot   │   │
│  │           notification · email                             │   │
│  └─────────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ AI Layer: OpenAI · DeepSeek · Anthropic · Gemini           │   │
│  │          (multi-provider abstraction)                       │   │
│  └─────────────────────────────────────────────────────────────┘   │
└──┬─────────────────┬──────────────────┬──────────────────┬──────────┘
   │                 │                  │                  │
   ▼                 ▼                  ▼                  ▼
┌─────────┐    ┌──────────┐     ┌────────────┐    ┌────────────────┐
│Postgres │    │  Redis   │     │  BullMQ    │    │  n8n Workflow  │
│+pgvector│    │ cache+   │     │ workers:   │    │  (separate     │
│+JSONB   │    │ queue    │     │ - scan-cv  │    │   service)     │
│+pg_trgm │    │          │     │ - send-mail│    │                │
│         │    │          │     │ - score    │    │ - Email send   │
│         │    │          │     │ - schedule │    │ - Reminder     │
│         │    │          │     │ - reminder │    │ - Reference    │
│         │    │          │     │            │    │   verify email │
└─────────┘    └──────────┘     └────────────┘    └────────────────┘
                       │
                       │ HTTPS (Dialogflow webhook)
                       ▼
              ┌────────────────────┐
              │  Dialogflow CX     │
              │  (chatbot agent)   │
              └────────────────────┘
```

### Workflow n8n (riêng)

```
n8n instance (Docker)
├── Workflow 1: CV Scan Trigger
│   Webhook từ backend → chạy scan pipeline → callback backend với kết quả
├── Workflow 2: Reference Verification
│   Gửi email xác minh → chờ reply → update DB
├── Workflow 3: Interview Reminder
│   Cron job mỗi giờ → check slot sắp tới → gửi email + webhook push
├── Workflow 4: Auto-Reject
│   Trigger khi match_score < 50 → gửi email polite reject
├── Workflow 5: AI Test
│   Trigger khi HR approve → sinh test → gửi email link
└── Workflow 6: Interview Confirmation
    Gửi email → chờ ứng viên click → update status
```

---

## 7. Cơ sở dữ liệu — Schema chi tiết (PostgreSQL)

### 7.1 Nguyên tắc
- **JSONB** cho dữ liệu nặng, schema linh hoạt (CV parsed, AI score, match reasoning, test results, n8n payload).
- **pgvector** cho embedding (CV ↔ JD matching).
- **tsvector** cho full-text search JD title/description.
- **GIN index** cho JSONB cần query.
- **UUID v7** cho PK.
- **Soft delete** với `deleted_at`.

### 7.2 ER tổng quan
```
users ─< user_profiles
users ─< oauth_accounts
users ─< candidates
users ─< employers >── companies
companies ─< jobs ─< job_skills >── skills
candidates ─< cvs
candidates ─< applications >── jobs
candidates ─< saved_jobs
candidates ─< notifications
users ─< chat_messages >── conversations
jobs ─< embeddings (pgvector)
cvs ─< embeddings (pgvector)
jobs ─< interviews >── applications
applications ─< test_results
applications ─< reference_verifications
candidates ─< reference_verifications
audit_logs
```

### 7.3 Bảng chính (key tables)

```sql
-- ============ USERS (multi-role) ============
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         CITEXT UNIQUE NOT NULL,
  password_hash TEXT,
  role          user_role NOT NULL,           -- 'candidate' | 'employer' | 'admin'
  status        user_status DEFAULT 'active',
  email_verified_at TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now(),
  deleted_at    TIMESTAMPTZ,
  metadata      JSONB DEFAULT '{}'::jsonb
);

-- ============ OAUTH ACCOUNTS ============
CREATE TABLE oauth_accounts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider          oauth_provider NOT NULL,    -- 'google' | 'facebook' | 'github'
  provider_user_id  TEXT NOT NULL,
  provider_email    CITEXT,
  access_token      TEXT,                        -- encrypted AES-256-GCM
  refresh_token     TEXT,                        -- encrypted
  token_expires_at  TIMESTAMPTZ,
  scopes            TEXT[],
  raw_profile       JSONB,
  linked_at         TIMESTAMPTZ DEFAULT now(),
  last_used_at      TIMESTAMPTZ,
  UNIQUE(provider, provider_user_id)
);

-- ============ COMPANIES ============
CREATE TABLE companies (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  slug        TEXT UNIQUE NOT NULL,
  logo_url    TEXT,
  cover_url   TEXT,
  description TEXT,
  industry    TEXT,                              -- ngành nghề
  size_range  TEXT,                              -- '1-10', '11-50', '51-200', '201-500', '500+'
  website     TEXT,
  social      JSONB,
  address     JSONB,                             -- {city, district, lat, lng, country}
  verified_at TIMESTAMPTZ,
  verified_by UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ DEFAULT now(),
  metadata    JSONB DEFAULT '{}'::jsonb          -- branding, custom fields
);

-- ============ JOBS (JD) ============
CREATE TABLE jobs (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id             UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  posted_by              UUID NOT NULL REFERENCES users(id),
  title                  TEXT NOT NULL,
  slug                   TEXT,
  description            TEXT NOT NULL,
  requirements           TEXT,
  benefits               TEXT,
  -- Yêu cầu scan tự động (Phase 2)
  required_skills        JSONB DEFAULT '[]'::jsonb,    -- ['Java', 'Spring Boot', ...]
  nice_to_have_skills    JSONB DEFAULT '[]'::jsonb,
  experience_years_min   INT,
  experience_years_max   INT,
  education_level        TEXT,                         -- 'high_school' | 'bachelor' | 'master' | 'phd' | 'none'
  certifications         JSONB DEFAULT '[]'::jsonb,    -- ['AWS Certified', ...]
  industry_required      TEXT,
  job_level              job_level,
  job_type               job_type,
  salary_min             NUMERIC(15,0),
  salary_max             NUMERIC(15,0),
  salary_currency        CHAR(3) DEFAULT 'VND',
  salary_visible         BOOLEAN DEFAULT true,
  location               JSONB,
  remote_ok              BOOLEAN DEFAULT false,
  deadline               TIMESTAMPTZ,
  status                 job_status DEFAULT 'draft',
  featured               BOOLEAN DEFAULT false,
  featured_until         TIMESTAMPTZ,
  views_count            INT DEFAULT 0,
  applies_count          INT DEFAULT 0,
  created_at             TIMESTAMPTZ DEFAULT now(),
  updated_at             TIMESTAMPTZ DEFAULT now(),
  published_at           TIMESTAMPTZ,
  extra_data             JSONB DEFAULT '{}'::jsonb,
  search_tsv             TSVECTOR GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce(title,'')), 'A') ||
    setweight(to_tsvector('simple', coalesce(description,'')), 'B') ||
    setweight(to_tsvector('simple', coalesce(requirements,'')), 'C')
  ) STORED
);
CREATE INDEX idx_jobs_search_tsv ON jobs USING GIN (search_tsv);
CREATE INDEX idx_jobs_required_skills ON jobs USING GIN (required_skills);
CREATE INDEX idx_jobs_status_created ON jobs(status, created_at DESC);

-- ============ CVs ============
CREATE TABLE cvs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title             TEXT NOT NULL,
  file_url          TEXT,
  file_type         TEXT,
  is_primary        BOOLEAN DEFAULT false,
  -- Parse data (JSONB nặng)
  parsed_data       JSONB,                              -- {name, email, phone, education[], experience[], skills[], languages[], projects[], certifications[], references[], github_url}
  ai_score          JSONB,                              -- CV scoring nội chung
  score_updated_at  TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_cvs_parsed_data ON cvs USING GIN (parsed_data);

-- ============ APPLICATIONS (ứng viên apply JD) ============
CREATE TABLE applications (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id        UUID NOT NULL REFERENCES users(id),
  job_id              UUID NOT NULL REFERENCES jobs(id),
  cv_id               UUID REFERENCES cvs(id),
  cover_letter        TEXT,
  status              application_status DEFAULT 'pending',
  stage               TEXT DEFAULT 'new',               -- ATS stage
  -- Phase 2: AI auto-screening
  ai_match_score      NUMERIC(5,2),                      -- 0.00-100.00
  ai_match_reasoning  JSONB,                             -- {criteria: {yearsExp: 25, skills: 30, ...}, summary, gaps, recommendation}
  scan_completed_at   TIMESTAMPTZ,
  -- Phase 3
  test_score          NUMERIC(5,2),
  test_taken_at       TIMESTAMPTZ,
  interview_status    TEXT,                              -- 'pending' | 'confirmed' | 'rescheduled' | 'no_show' | 'completed' | 'cancelled'
  is_anonymous        BOOLEAN DEFAULT false,
  applied_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now(),
  viewed_at           TIMESTAMPTZ,
  metadata            JSONB,
  UNIQUE(candidate_id, job_id)
);
CREATE INDEX idx_applications_job_status ON applications(job_id, status);
CREATE INDEX idx_applications_match_score ON applications(job_id, ai_match_score DESC);

-- ============ REFERENCE VERIFICATIONS (Phase 2) ============
CREATE TABLE reference_verifications (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id      UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  referee_name        TEXT NOT NULL,
  referee_email       CITEXT NOT NULL,
  referee_phone       TEXT,
  relationship        TEXT,                              -- 'manager', 'colleague', 'client'
  company             TEXT,
  duration            TEXT,                              -- '2 years 3 months'
  verification_token  TEXT UNIQUE NOT NULL,              -- 32 char random
  status              reference_status DEFAULT 'pending', -- 'pending' | 'sent' | 'verified' | 'failed' | 'expired'
  sent_at             TIMESTAMPTZ,
  verified_at         TIMESTAMPTZ,
  response            JSONB,                             -- referee reply
  expires_at          TIMESTAMPTZ,                       -- 14 days
  created_at          TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_ref_app ON reference_verifications(application_id);
CREATE INDEX idx_ref_token ON reference_verifications(verification_token);
CREATE INDEX idx_ref_status ON reference_verifications(status, expires_at);

-- ============ AI TESTS (Phase 3) ============
CREATE TABLE ai_tests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id        UUID NOT NULL REFERENCES jobs(id),       -- test riêng cho JD
  test_type     ai_test_type NOT NULL,                   -- 'iq' | 'english'
  level         TEXT,                                   -- A2/B1/B2/C1 for English
  questions     JSONB NOT NULL,                         -- [{id, type, question, options, correctAnswer, points}]
  total_points  INT NOT NULL,
  duration_min  INT NOT NULL,
  passing_score NUMERIC(5,2) DEFAULT 60.00,
  created_at    TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_ai_tests_job ON ai_tests(job_id, test_type);

CREATE TABLE test_assignments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES applications(id),
  test_id       UUID NOT NULL REFERENCES ai_tests(id),
  access_token  TEXT UNIQUE NOT NULL,
  status        test_assignment_status DEFAULT 'pending',-- 'pending' | 'sent' | 'in_progress' | 'completed' | 'expired'
  answers       JSONB,                                   -- user submit
  score         NUMERIC(5,2),
  feedback      JSONB,                                   -- LLM grading result
  sent_at       TIMESTAMPTZ,
  started_at    TIMESTAMPTZ,
  submitted_at  TIMESTAMPTZ,
  expires_at    TIMESTAMPTZ                              -- 7 days
);

-- ============ INTERVIEWS (Phase 3) ============
CREATE TABLE interviews (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id  UUID NOT NULL REFERENCES applications(id),
  interviewer_id  UUID NOT NULL REFERENCES users(id),
  scheduled_at    TIMESTAMPTZ NOT NULL,
  duration_min    INT DEFAULT 60,
  location        TEXT,                                  -- address or 'Online'
  meeting_link    TEXT,                                  -- Google Meet / Zoom
  status          interview_status DEFAULT 'pending',     -- 'pending' | 'confirmed' | 'rescheduled' | 'no_show' | 'completed' | 'cancelled'
  confirmation_token TEXT UNIQUE,
  confirmed_at    TIMESTAMPTZ,
  cancelled_at    TIMESTAMPTZ,
  cancel_reason   TEXT,
  -- Reminders
  reminder_24h_sent BOOLEAN DEFAULT false,
  reminder_2h_sent  BOOLEAN DEFAULT false,
  reminder_15m_sent BOOLEAN DEFAULT false,
  -- Feedback
  feedback        JSONB,                                 -- {scores, comments, recommendation}
  feedback_submitted_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_interviews_scheduled ON interviews(scheduled_at, status);
CREATE INDEX idx_interviews_app ON interviews(application_id);
CREATE INDEX idx_interviews_interviewer ON interviews(interviewer_id, scheduled_at);

-- ============ INTERVIEWER AVAILABILITY ============
CREATE TABLE interviewer_availability (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  interviewer_id  UUID NOT NULL REFERENCES users(id),
  day_of_week     INT,                                   -- 0-6 (Sun-Sat) cho recurring
  start_time      TIME,
  end_time        TIME,
  specific_date   DATE,                                  -- cho 1 ngày cụ thể
  is_recurring    BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- ============ EMBEDDINGS (pgvector) ============
CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE embeddings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_type  TEXT NOT NULL,                           -- 'cv' | 'job'
  content_id    UUID NOT NULL,
  vector        VECTOR(1536) NOT NULL,
  model         TEXT NOT NULL,
  text_hash     CHAR(64) NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE(content_type, content_id, model)
);
CREATE INDEX idx_embeddings_hnsw ON embeddings USING HNSW (vector vector_cosine_ops);

-- ============ GITHUB LOOKUPS (cache) ============
CREATE TABLE github_lookups (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username        TEXT NOT NULL UNIQUE,
  exists          BOOLEAN NOT NULL,
  profile_data    JSONB,                                 -- {name, bio, public_repos, followers, top_repos[], languages{}, created_at, has_recent_activity}
  fetched_at      TIMESTAMPTZ DEFAULT now(),
  expires_at      TIMESTAMPTZ DEFAULT now() + interval '7 days'
);

-- ============ N8N WORKFLOW LOGS ============
CREATE TABLE n8n_workflow_logs (
  id            BIGSERIAL PRIMARY KEY,
  workflow_name TEXT NOT NULL,                           -- 'cv_scan', 'reference_verify', 'interview_reminder', ...
  execution_id  TEXT,
  status        TEXT,                                   -- 'success' | 'failed' | 'running'
  input         JSONB,
  output        JSONB,
  error         JSONB,
  duration_ms   INT,
  triggered_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_n8n_logs_workflow ON n8n_workflow_logs(workflow_name, triggered_at DESC);

-- ============ EMAIL LOGS ============
CREATE TABLE email_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES users(id),
  to_email      TEXT NOT NULL,
  subject       TEXT,
  template      TEXT,                                   -- 'interview_invite', 'auto_reject', 'reference_verify', ...
  provider      TEXT DEFAULT 'n8n',
  provider_msg_id TEXT,
  status        TEXT,                                   -- 'sent' | 'failed' | 'bounced' | 'opened'
  payload       JSONB,
  sent_at       TIMESTAMPTZ DEFAULT now()
);

-- ============ NOTIFICATIONS ============
CREATE TABLE notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,                              -- 'application_status', 'new_message', 'interview_reminder', 'test_assigned'
  title      TEXT NOT NULL,
  body       TEXT,
  data       JSONB,
  read_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_notifications_user_unread ON notifications(user_id, created_at DESC) WHERE read_at IS NULL;

-- ============ CHAT ============
CREATE TABLE conversations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_a          UUID NOT NULL REFERENCES users(id),
  user_b          UUID NOT NULL REFERENCES users(id),
  job_id          UUID REFERENCES jobs(id),
  last_message_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE chat_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id       UUID NOT NULL REFERENCES users(id),
  content         TEXT NOT NULL,
  read_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now(),
  metadata        JSONB
);

-- ============ AUDIT LOG ============
CREATE TABLE audit_logs (
  id          BIGSERIAL PRIMARY KEY,
  actor_id    UUID REFERENCES users(id),
  action      TEXT NOT NULL,
  target_type TEXT,
  target_id   UUID,
  ip          INET,
  user_agent  TEXT,
  diff        JSONB,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- ============ USAGE LOGS (quota tracking) ============
CREATE TABLE usage_logs (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id),
  feature     TEXT NOT NULL,                             -- 'ai_chat', 'cv_scan', 'ai_test', ...
  count       INT DEFAULT 1,
  metadata    JSONB,
  created_at  TIMESTAMPTZ DEFAULT now()
);
```

### 7.4 Vì sao dùng JSONB?
- `users.metadata` — OAuth provider, device tokens, marketing consent.
- `cvs.parsed_data` — CV structure đa dạng (education, experience, skills, projects, references, github_url).
- `jobs.required_skills`, `nice_to_have_skills`, `certifications` — list ngành cụ thể.
- `applications.ai_match_reasoning` — breakdown điểm từng tiêu chí.
- `test_assignments.answers` / `feedback` — câu trả lời + LLM grading.
- `reference_verifications.response` — JSON tự do từ người tham chiếu.
- `interviews.feedback` — interviewer notes.
- `github_lookups.profile_data`, `n8n_workflow_logs.input/output`, `email_logs.payload`.

---

## 8. Tech Stack chi tiết

### 8.1 Backend
| Component | Technology |
|---|---|
| Runtime | NodeJS 20 LTS |
| Framework | Express 5 + TypeScript |
| ORM | Drizzle ORM + Knex (migration) |
| Validation | Zod |
| Auth | JWT (jose), bcrypt, OAuth (passport-google, passport-facebook, passport-github2, PKCE) |
| Realtime | Socket.IO + @socket.io/redis-adapter |
| Queue | BullMQ |
| Cache | ioredis |
| File | Multer + MinIO SDK |
| PDF parse | pdf-parse, mammoth |
| Email | nodemailer + n8n (gửi qua workflow) |
| AI | OpenAI, DeepSeek, Anthropic, Gemini (multi-provider) |
| Vector | pgvector |
| Logging | pino + pino-http |
| Error | Sentry |
| Test | Jest + Supertest |

### 8.2 Frontend
| Component | Technology |
|---|---|
| Framework | Vue 3.4 + Composition API + `<script setup>` |
| Build | Vite 5 + TypeScript 5 |
| Router | Vue Router 4 + guards |
| State | Pinia |
| HTTP | Axios + interceptors (auto refresh) |
| Realtime | socket.io-client |
| UI | Tailwind CSS 4 + shadcn-vue |
| Form | VeeValidate + Zod |
| Chart | ApexCharts |
| i18n | vue-i18n |
| Test | Vitest + Playwright |

### 8.3 Database & Infrastructure
| Component | Technology |
|---|---|
| Database | PostgreSQL 16 + pgvector + pg_trgm + citext |
| Cache + Queue | Redis 7 |
| File storage | MinIO (S3-compatible) |
| **Workflow automation** | **n8n** (Docker, self-hosted) |
| **Chatbot** | **Dialogflow CX** (Google Cloud) |
| Reverse proxy | Nginx / Caddy |
| Process manager | PM2 |
| Containerization | Docker + docker-compose |
| CI/CD | GitHub Actions |
| Monitoring | Sentry + Pino logs + Prometheus |

### 8.4 AI Provider Matrix
| Use case | Primary | Fallback |
|---|---|---|
| CV parse | OpenAI GPT-4o-mini (JSON mode) | Gemini 2.5 Flash |
| CV scan theo JD | OpenAI GPT-4o-mini (structured output) | DeepSeek |
| Embedding | OpenAI text-embedding-3-small | — |
| AI Test generation (IQ/English) | OpenAI GPT-4o-mini | DeepSeek |
| AI Test grading (essay) | OpenAI GPT-4o-mini | Anthropic Claude Haiku |
| Chatbot (FAQ) | Dialogflow CX | — |
| Chatbot (advanced) | OpenAI GPT-4o-mini | — |
| AI cover letter / JD gen | OpenAI GPT-4o-mini | DeepSeek |

---

## 9. API Design

### 9.1 Conventions
- Base: `/api/v1`
- Auth: Bearer JWT
- Pagination: cursor-based
- Errors: `{ success: false, error: { code, message, field? } }`

### 9.2 Phase 1 endpoints
```
AUTH  POST /auth/register /auth/login /auth/refresh /auth/logout
      POST /auth/forgot-password /auth/reset-password
      GET  /auth/oauth/:provider /auth/oauth/:provider/callback
      POST /auth/oauth/:provider/link
      GET  /auth/oauth/accounts
      DELETE /auth/oauth/:provider

USERS GET  /users/me
      PATCH /users/me

JOBS  GET  /jobs (search + filter)
      GET  /jobs/:id
      POST /jobs
      PATCH /jobs/:id
      DELETE /jobs/:id
      POST /jobs/:id/apply

CVs   GET  /cvs
      POST /cvs/upload (multipart → AI parse)
      GET  /cvs/:id
      PATCH /cvs/:id
      DELETE /cvs/:id

APPS  GET  /applications/me
      GET  /applications/:id
      PATCH /applications/:id/status

SEARCH GET /search
      GET /search/insight

ADMIN GET  /admin/stats
      GET  /admin/users
      PATCH /admin/users/:id/ban
      GET  /admin/jobs/pending
      PATCH /admin/jobs/:id/approve

CHAT  GET  /conversations
      GET  /conversations/:id/messages
      POST /conversations/:id/messages

NOTIF GET  /notifications
      PATCH /notifications/:id/read
```

### 9.3 Phase 2 endpoints (Auto-screening)
```
SCAN  POST /scan/run/:applicationId          (chạy scan ngay, hoặc queue)
      GET  /scan/result/:applicationId       (lấy kết quả scan)
      POST /scan/bulk                        (scan nhiều application)

GITHUB GET /github/lookup/:username          (tra cứu GitHub)
      GET  /github/lookup/cv/:cvId           (lookup từ CV đã parse)
      POST /github/refresh/:cvId             (force refresh)

REFERENCES GET    /references/application/:id
           POST   /references/:id/send       (gửi email xác minh)
           GET    /references/verify?token=  (người tham chiếu click link)
           POST   /references/:id/respond    (người tham chiếu xác nhận/từ chối)
```

### 9.4 Phase 3 endpoints (AI Test + Schedule)
```
TESTS POST   /tests/generate                  (HR tạo bộ test cho JD)
      GET    /tests/:id
      POST   /tests/assign                   (gửi cho ứng viên)
      GET    /tests/take/:token              (ứng viên lấy câu hỏi)
      POST   /tests/submit/:token            (nộp bài)
      GET    /tests/result/:assignmentId

SCHEDULE GET  /schedule/availability/:interviewerId
         POST /schedule/interview             (HR tạo slot)
         GET  /schedule/interview/confirm?token=  (ứng viên xác nhận)
         POST /schedule/interview/:id/cancel
         POST /schedule/interview/:id/feedback

DIALOGFLOW POST /dialogflow/webhook
```

---

## 10. Tích hợp n8n — Workflows chi tiết

### 10.1 Kiến trúc n8n

n8n chạy riêng như 1 Docker container. Backend giao tiếp qua webhook:

```
Backend --(POST webhook)--> n8n workflow --> gọi action --> (callback) Backend
```

### 10.2 Workflows

**WF1: CV Scan Trigger**
- Webhook nhận `{applicationId, jobId, cvId}`.
- Gọi backend API để lấy CV parsed + JD requirements.
- Gọi OpenAI API để chấm điểm.
- Tính GitHub lookup.
- Gọi OpenAI để verify references có email.
- Tổng hợp `ai_match_reasoning` + `ai_match_score`.
- Callback backend `PATCH /applications/:id` với kết quả.
- Nếu `score < 50` → trigger WF4 (auto-reject).

**WF2: Reference Verification**
- Webhook nhận `{referenceId, refereeEmail}`.
- Sinh token xác minh 32 char.
- Gửi email qua SMTP với link `/references/verify?token=...`.
- Lưu log vào `n8n_workflow_logs`.

**WF3: Interview Reminder (Cron)**
- Cron mỗi 15 phút.
- Query `interviews` có `scheduled_at` trong 24h/2h/15m tới và chưa gửi reminder.
- Gửi email + push notification qua backend webhook.
- Update `reminder_*_sent = true`.

**WF4: Auto-Reject**
- Webhook nhận `{applicationId, reason}`.
- Render email template (tiếng Việt + Anh).
- Gửi qua SMTP.
- Lưu `email_logs`.
- Update application status = `rejected`.

**WF5: AI Test**
- Webhook nhận `{testId, applicationId}`.
- LLM sinh câu hỏi (IQ hoặc English theo level).
- Sinh access token, link `/tests/take/{token}`.
- Gửi email cho ứng viên.
- Lưu `test_assignments`.

**WF6: Interview Confirmation**
- Webhook nhận `{interviewId, action: 'confirm' | 'reschedule' | 'cancel'}`.
- Cập nhật status.
- Gửi email xác nhận cho HR.
- Nếu reschedule → mở lịch interviewer.

---

## 11. Tích hợp Dialogflow CX

### 11.1 Setup
- Tạo Agent trên Google Cloud Dialogflow CX.
- Enable Webhook fulfillment.
- Public webhook URL: `https://api.jobmatch.vn/api/v1/dialogflow/webhook`.

### 11.2 Intents
| Intent | Training phrases | Webhook action |
|---|---|---|
| `ask_how_to_apply` | "làm sao để apply", "cách nộp CV" | Trả response cố định |
| `ask_company_info` | "công ty X ở đâu", "giới thiệu công ty" | `getCompany(name)` |
| `ask_status` | "trạng thái application của tôi" | `getApplicationStatus(email)` |
| `ask_salary` | "lương vị trí X bao nhiêu" | `getSalaryInsight(position, location)` |
| `ask_skill_required` | "JD cần kỹ năng gì" | `getJobRequirements(jobId)` |
| `escalate_to_human` | "tôi muốn nói chuyện với HR" | Tạo support ticket |

### 11.3 Backend webhook
```typescript
router.post('/dialogflow/webhook', async (req, res) => {
  const intent = req.body.queryResult.intent.displayName;
  const params = req.body.queryResult.parameters;

  switch (intent) {
    case 'ask_company_info': {
      const data = await companyService.getByName(params.company);
      return res.json({ fulfillmentText: data ? `${data.name} - ${data.description}` : 'Không tìm thấy' });
    }
    case 'ask_salary': {
      const insight = await insightService.getSalary(params.position, params.location);
      return res.json({ fulfillmentText: insight });
    }
    // ...
  }
});
```

### 11.4 Embed
- Thêm Dialogflow Messenger widget vào Vue app (script + div).
- Style lại cho phù hợp với JobMatch.

---

## 12. Frontend Structure (mapping từ đồ án cũ)

Đã tạo skeleton đầy đủ tại `d:\metadata\jobmatch-vn\frontend\src\`:

```
src/
├── router/index.ts                # 30+ routes với guards
├── stores/
│   ├── auth.ts                    # login/logout/refresh
│   ├── oauth.ts                   # PKCE flow
│   ├── application.ts             # NEW (cho Phase 2)
│   ├── interview.ts               # NEW (cho Phase 3)
│   ├── notification.ts
│   └── plan.ts
├── services/
│   ├── auth.api.ts
│   ├── auth.oauth.api.ts
│   ├── job.api.ts
│   ├── application.api.ts         # NEW
│   ├── scan.api.ts                # NEW (Phase 2: CV scan)
│   ├── github.api.ts              # NEW (Phase 2)
│   ├── reference.api.ts           # NEW (Phase 2)
│   ├── test.api.ts                # NEW (Phase 3)
│   ├── schedule.api.ts            # NEW (Phase 3)
│   ├── ai.api.ts                  # streaming chatbot
│   └── notification.api.ts
├── composables/
│   ├── useAuth.ts
│   ├── useOAuth.ts
│   ├── useSocket.ts
│   ├── useChat.ts
│   ├── useCVScan.ts               # NEW
│   ├── useInterview.ts            # NEW
│   └── useDebounce.ts
├── components/
│   ├── common/                    # Button, Input, Modal, Toast, Empty
│   ├── layout/                    # Header, Footer, Sidebar
│   ├── auth/                      # OAuthButtons, LoginForm, RegisterForm
│   ├── job/                       # JobCard, JobFilter, JDGenerator
│   ├── candidate/                 # ResumeForm, CVUploadButton
│   ├── employer/                  # JDGeneratorModal, ATSKanban
│   ├── scan/                      # NEW (Phase 2): ScanResultCard, GitHubCard, ReferenceCard
│   ├── test/                      # NEW (Phase 3): TestQuestion, TestTimer
│   ├── schedule/                  # NEW (Phase 3): InterviewSlot, ConfirmDialog
│   ├── chat/                      # ChatWindow, MessageBubble
│   ├── notify/                    # NotificationBell
│   └── ai/                        # ChatbotWidget (Dialogflow + LLM)
└── views/
    ├── HomeView.vue
    ├── JobListView.vue
    ├── JobDetailView.vue
    ├── SearchView.vue
    ├── PricingView.vue            # (có thể bỏ nếu không có payment)
    ├── auth/                      # Login, Register, ForgotPassword, OAuthCallback, Onboarding
    ├── candidate/                 # Dashboard, MyResumes, AppliedJobs, TakeTest (NEW), InterviewStatus (NEW)
    ├── employer/                  # Dashboard, CreateJD, PostedJobs, ApplicationsKanban, ScanResults, ScheduleInterview, TestManagement
    ├── admin/                     # Dashboard, Users, Jobs, Companies
    ├── scan/                      # NEW (Phase 2): ScanDashboard
    ├── test/                      # NEW (Phase 3): TakeTest, TestResult
    ├── schedule/                  # NEW (Phase 3): ConfirmInterview
    ├── chat/
    └── errors/
```

---

## 13. Backend Structure (skeleton đã có)

Tại `d:\metadata\jobmatch-vn\backend\src\`:

```
src/
├── config/                  # env, database, redis, queue, minio, crypto, ai, logger
├── middleware/              # auth, role, validate, rateLimit, quota, upload, socketAuth, auditLog
├── router/                  # 15+ routers (auth, oauth, user, job, application, resume,
│                            #          message, savedJob, notification, search, ai, payment, webhooks, admin,
│                            #          SCAN (NEW), GITHUB (NEW), REFERENCE (NEW), TEST (NEW), SCHEDULE (NEW), DIALOGFLOW (NEW))
├── controller/              # thin glue
├── service/                 # business logic
│   ├── auth.service.ts
│   ├── oauth.service.ts + oauthProviders/{google,facebook,github}.ts
│   ├── job.service.ts
│   ├── application.service.ts
│   ├── cvScan.service.ts          # NEW Phase 2
│   ├── githubLookup.service.ts    # NEW Phase 2
│   ├── referenceVerify.service.ts # NEW Phase 2
│   ├── aiTest.service.ts          # NEW Phase 3
│   ├── interview.service.ts       # NEW Phase 3
│   ├── dialogflow.service.ts      # NEW
│   ├── n8n.service.ts             # NEW (gọi webhook n8n)
│   ├── email.service.ts
│   └── notification.service.ts
├── ai/
│   ├── providers/           # openai, deepseek, gemini, anthropic
│   ├── prompts/             # cv_parse, cv_score, jd_extract, jd_scan, cover_letter, ai_test_iq, ai_test_english (NEW)
│   ├── tools/
│   └── embeddings.ts
├── db/schema/               # 15+ Drizzle schemas
├── jobs/                    # BullMQ workers
│   ├── email.worker.ts
│   ├── cvParse.worker.ts
│   ├── cvScore.worker.ts
│   ├── cvScan.worker.ts            # NEW Phase 2
│   ├── githubLookup.worker.ts      # NEW Phase 2
│   ├── referenceEmail.worker.ts    # NEW Phase 2
│   ├── aiTestGenerate.worker.ts    # NEW Phase 3
│   ├── interviewReminder.worker.ts # NEW Phase 3
│   └── index.ts
├── socket/                  # chat + notification handlers
└── utils/
```

---

## 14. Non-Functional Requirements (tổng hợp)

Đã trình bày ở §5. Tóm tắt:
- **Performance:** LCP < 2.5s, API p95 < 500ms, CV scan < 30s.
- **Security:** JWT + OAuth PKCE + AES-256-GCM + rate limit + audit log.
- **Scalability:** Stateless API + Redis + BullMQ + n8n (tách riêng).
- **Cache:** Multi-layer, embedding cache 7 ngày, GitHub cache 7 ngày.
- **Usability:** Mobile-first + WCAG 2.1 AA + i18n.
- **Observability:** Pino + Sentry + Prometheus.
- **Reliability:** PM2 + Postgres backup + health check.

---

## 15. KPIs (đánh giá sản phẩm nghiên cứu)

| Nhóm | Metric | Target |
|---|---|---|
| **User** | MAU mô phỏng | 1,000 |
| **JD** | JD đăng tải mẫu | 100 |
| **Application** | Apply per JD (trung bình) | ≥ 5 |
| **AI — CV Scan (Phase 2)** | Match accuracy (HR verify) | ≥ 75% |
| **AI — CV Scan** | Auto-reject đúng (>70% HR đồng ý) | ≥ 60% |
| **AI — Test (Phase 3)** | IQ test phân loại đúng | ≥ 70% |
| **AI — Test** | English test correlation với IELTS | ≥ 0.6 |
| **Schedule (Phase 3)** | Confirm rate (ứng viên reply) | ≥ 60% |
| **Schedule** | No-show rate | < 15% |
| **GitHub Lookup** | Tỷ lệ candidate có GitHub | ≥ 30% |
| **GitHub** | Verify thành công (account thật) | ≥ 90% |
| **Reference** | Email deliverability | ≥ 95% |
| **Reference** | Verify rate (người tham chiếu reply) | ≥ 40% |
| **Chatbot** | Dialogflow CSAT | ≥ 4.0/5 |
| **Performance** | LCP | < 2.5s |
| **Performance** | CV scan end-to-end | < 30s |
| **Realtime** | Notification latency | < 1s |
| **n8n** | Workflow success rate | ≥ 95% |

---

## 16. Risks & Mitigation

| Risk | Impact | Probability | Mitigation |
|---|---|---|---|
| AI provider down | High | Medium | Multi-provider + circuit breaker + cache |
| AI cost vượt budget | High | Medium | Per-user quota, smaller models, aggressive cache |
| CV scan sai (false positive/negative) | High | Medium | HR review stage, threshold điều chỉnh, feedback loop |
| GitHub API rate limit | Medium | High | Cache 7 ngày, fallback graceful |
| Reference email bị bounce | Medium | Medium | Validate email format, retry logic, HR manual verify |
| Ứng viên không reply confirm interview | High | High | Reminder 24h/2h/15m, HR manual follow up |
| n8n downtime | High | Low | Self-hosted Docker, monitor, fallback manual email |
| Dialogflow quota | Medium | Low | Google free tier đủ cho demo |
| Cold start (không có data training) | High | High | Rule-based hybrid (scan = AI + rule), collect feedback |
| Bias trong AI test | Medium | High | Diverse question pool, human review |
| Spam JD | Medium | High | AI moderation + report system |
| Data leak (CV) | High | Low | Encrypted at rest, signed URL, strict access control |

---

## 17. Demo & Báo cáo

### 17.1 Báo cáo Phase 1 (Tuần 5)
- Demo: HR đăng JD → ứng viên tìm + apply + nộp CV.
- 10 JD mẫu, 30 CV mẫu.
- Slide: kiến trúc, schema, API list, screenshot.

### 17.2 Báo cáo Phase 2 (Tuần 9)
- Demo: HR xem application → click "Scan" → AI trả điểm + GitHub + reference.
- Auto-reject email qua n8n.
- Slide: scan pipeline, prompt design, matching rubric, edge cases.

### 17.3 Báo cáo Phase 3 (Tuần 15)
- Demo: HR schedule interview → email cho ứng viên → confirm → reminder → feedback.
- AI test: ứng viên làm bài trên web → chấm điểm.
- Slide: scheduler, reminder cron, Dialogflow chatbot, end-to-end flow.

### 17.4 Báo cáo cuối khóa
- Full thesis (PDF).
- Demo video 10 phút end-to-end.
- Source code trên GitHub.

---

## 18. References

- [Dialogflow CX Webhook](https://cloud.google.com/dialogflow/cx/docs/concept/webhook) — webhook fulfillment
- [Dialogflow Integrations](https://cloud.google.com/dialogflow/docs/integrations)
- [n8n Documentation](https://docs.n8n.io/) — workflow automation
- [OpenAI API](https://platform.openai.com/docs)
- [DeepSeek API](https://platform.deepseek.com/docs)
- [pgvector](https://github.com/pgvector/pgvector)
- [Socket.IO Redis adapter](https://socket.io/docs/v4/redis-adapter/)
- Project môn học tham khảo: `C:\Users\hp\JobPortal`