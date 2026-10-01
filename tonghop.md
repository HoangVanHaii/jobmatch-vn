# JobMatch VN — Tổng hợp chức năng hệ thống (reverse-engineer từ source code)

> Tài liệu dựng lại HOÀN TOÀN từ source code thực tế (backend + frontend + DB schema + workers), KHÔNG dựa vào README/docs. Mỗi tính năng kèm bằng chứng `file:hàm/route`. Trạng thái: **Hoàn thiện** / **Một phần** / **Chỉ là khung (stub)** / **Không được sử dụng**.

---

## 1. Tổng quan dự án

- **Mục đích (suy từ code):** nền tảng tuyển dụng việc làm Việt Nam — ứng viên tìm việc, tạo/tải CV, ứng tuyển; nhà tuyển dụng quản lý công ty, đăng tin (có AI kiểm duyệt), xử lý hồ sơ; có AI (Gemini) phân tích CV, chấm độ khớp CV–việc, chatbot; bán gói dịch vụ qua PayOS.
- **Backend:** Node.js + Express 5 + TypeScript (`backend/server.ts`, `backend/src/app.ts`); PostgreSQL + pgvector qua Drizzle ORM (`backend/src/db/schema/`); Redis + BullMQ workers (`backend/src/jobs/`, `backend/src/config/queue.ts`); MinIO lưu tệp; Socket.IO (+ Redis adapter); Nodemailer (SMTP); Playwright render PDF.
- **AI:** Google Gemini duy nhất — model `gemini-2.5-flash`, embedding `gemini-embedding-001` 768 chiều (`backend/src/config/env.ts:44-50`, `backend/src/lib/llm/client.ts`).
- **Thanh toán:** PayOS (`@payos/node`, env `PAYOS_*` bắt buộc — `backend/src/config/env.ts:70-76`).
- **Frontend:** Vue 3 + Vite + Pinia + Vue Router + Tailwind + Socket.IO client + Leaflet (bản đồ) + ApexCharts (`frontend/package.json`); guard phân quyền theo role ở `frontend/src/router/index.ts:197-214`.
- **Hạ tầng dev:** docker-compose: postgres (pgvector), redis, minio, mailhog, n8n (`docker-compose.yml`).
- **API:** mọi route gắn dưới `/api/v1` (`backend/src/router/index.ts:34-60`); role: `candidate | employer | admin` (`backend/src/db/schema/enums.ts:6`).

---

## 2. Danh sách Actor

| Actor | Cách xác định trong code | Mô tả |
|---|---|---|
| Khách (chưa đăng nhập) | Route public `/login`, `/register`, `/verify-otp`, `/forgot-password`, `/terms`, `/privacy`, `/select-role`, `/auth/callback/:provider`, `/print/cv/:cvId` (frontend/src/router/index.ts); API `optionalAuth` (backend/src/middleware/auth.ts:38) | Xem tin việc đang `live`, tìm kiếm, đăng ký, đăng nhập |
| Ứng viên (Candidate) | `user_role='candidate'`; guard `candidateOnly` (middleware/role.ts), route `/candidate/*` meta role (frontend/src/router/index.ts:53-95) | Quản lý hồ sơ/CV, tìm & ứng tuyển việc, nhắn tin, chatbot, mua gói |
| Nhà tuyển dụng (Employer) | `user_role='employer'`; guard `employerOnly`; route `/employer/*`; thêm vai trò trong công ty: `owner`/`member` (enums.ts:30 companyMemberRoleEnum) | Quản lý công ty & thành viên, đăng tin, xử lý hồ sơ, mua gói |
| Quản trị viên (Admin) | `user_role='admin'`; guard `adminOnly`; route `/admin/*` | Quản lý người dùng, tin đăng, công ty, gói; xem thống kê |
| Hệ thống (bổ trợ) | BullMQ workers khởi động tại `backend/src/jobs/index.ts:18-46`; webhook PayOS (`backend/src/router/webhooks.ts:33`) | Tự động: parse/phân tích CV, chấm match, kiểm duyệt tin, embedding, hết hạn tin, nhắc phỏng vấn (stub), hết hạn payment |

---

## 3. Danh sách tính năng theo module

### M1. Xác thực & tài khoản

| Mã | Tính năng & mô tả | Actor | Trạng thái | Bằng chứng |
|---|---|---|---|---|
| FR-01 | **Đăng ký tài khoản** — chọn role (candidate/employer), nhập họ tên/email/mật khẩu (≥8 ký tự, hoa+thường+số), bắt buộc đồng ý điều khoản; tài khoản tạo ở trạng thái `pending`, phải nhập OTP gửi qua email (hạn 5 phút) mới thành `active` | Khách | Hoàn thiện | `POST /auth/register/request-otp|verify-otp|resend-otp` (router/auth.ts:27-56, controller/auth.controller.ts:35-216, service/auth.service.ts:58-193, service/otp.service.ts); FE `RegisterView.vue`, `VerifyOtpView.vue` |
| FR-02 | **Đăng nhập bằng email/mật khẩu** — trả cặp access token (15 phút) + refresh token (7 ngày, rotation single-use, jti lưu Redis); chặn tài khoản chưa xác thực/bị cấm | Mọi actor | Hoàn thiện | `POST /auth/login` (auth.controller.ts:218, rate limit 10/5 phút), `POST /auth/refresh` (utils/jwt.ts:35-100); FE `LoginView.vue` |
| FR-03 | **Đăng nhập/đăng ký bằng Google, Facebook, GitHub (OAuth)** — flow initiate/callback có state + PKCE; user mới chọn role ở bước hoàn tất; có thể liên kết/hủy liên kết provider. Lưu ý: Facebook luôn coi email chưa xác thực → user mới qua Facebook vẫn phải nhập OTP | Khách, mọi actor | Hoàn thiện | `POST /auth/oauth/:provider|callback|complete`, `GET/DELETE /auth/oauth/accounts` (router/auth.oauth.ts, service/oauth.service.ts:340-540, oauthProviders/google|facebook|github.ts); FE `OAuthCallbackView.vue`, `OnboardingView.vue` |
| FR-04 | **Quên mật khẩu & đặt lại bằng OTP** — chống dò email (luôn trả 200, chuẩn hóa thời gian phản hồi); mật khẩu mới theo chính sách độ phức tạp | Khách | Hoàn thiện | `POST /auth/forgot-password`, `POST /auth/reset-password` (auth.controller.ts:260-323, auth.service.ts:262-306); FE `ForgotPasswordView.vue` (3 bước) |
| FR-05 | **Đổi mật khẩu** — xác nhận mật khẩu hiện tại, chặn đặt lại mật khẩu cũ (không thu hồi session cũ) | Mọi actor có mật khẩu | Hoàn thiện | `POST /auth/change-password` (auth.service.ts:323-347); FE `ChangePasswordModal.vue` |
| FR-06 | **Đăng xuất** — thu hồi refresh token (idempotent) | Mọi actor | Hoàn thiện | `POST /auth/logout` (auth.controller.ts:252, utils/jwt.ts:102-105) |
| FR-07 | **Xem thông tin tài khoản hiện tại** — email, role, trạng thái, tên, avatar, hasPassword, danh sách provider đã liên kết | Mọi actor | Hoàn thiện | `GET /users/me` (router/user.ts:40-80); FE `stores/auth.ts fetchMe` |
| FR-08 | **Cập nhật hồ sơ dùng chung** (`POST /auth/upsert-profile`, mọi role) — nhận fullName/phone/location/social | Mọi actor | Một phần | Router không gắn validate, service cast `any` (auth.controller.ts:362, auth.service.ts:356-363); key `preference` lệch cột `preferences` |
| FR-09 | **Đổi ảnh đại diện** — tải ảnh lên MinIO rồi lưu URL vào profile | Mọi actor | Hoàn thiện | `POST /uploads/image` (router/upload.ts:52) + `POST /auth/change-avatar` (auth.controller.ts:337) |
| FR-10 | **Tự xóa tài khoản** — soft delete (`deletedAt`); refresh token về sau sẽ bị chặn | Mọi actor | Hoàn thiện | `PUT /auth/soft-delete` (auth.service.ts:430-432) |
| FR-11 | **Tìm người dùng để bắt đầu nhắn tin** — tìm theo tên, loại trừ mình, chỉ trả id/tên/avatar/role | Mọi actor | Hoàn thiện | `GET /users/search` (router/user.ts:105-115, auth.service.ts:608-630); FE `services/user.api.ts` |

### M2. Hồ sơ ứng viên

| Mã | Tính năng & mô tả | Actor | Trạng thái | Bằng chứng |
|---|---|---|---|---|
| FR-12 | **Quản lý hồ sơ ứng viên** — ảnh đại diện/ảnh bìa, họ tên, SĐT, ngày sinh, học vấn/công việc, địa chỉ (tỉnh-huyện + tọa độ + bản đồ), mạng xã hội; thanh % hoàn thiện hồ sơ. FE dùng open-api tỉnh/huyện VN + Photon geocoding | Candidate | Hoàn thiện | `GET/PATCH /candidates/profile` (router/candidate.ts, service/candidate.service.ts:74-213, validate middleware/user.ts:172-217); FE `ProfileView.vue` (2395 dòng, gọi API 13 điểm) |

### M3. Kỹ năng

| Mã | Tính năng & mô tả | Actor | Trạng thái | Bằng chứng |
|---|---|---|---|---|
| FR-13 | **Quản lý danh mục kỹ năng** — admin thêm/sửa/xóa mềm skill; mọi người đọc để autocomplete. Backend hoàn thiện, trang admin `SkillsView` là placeholder | Admin (đọc: mọi người) | Một phần | `GET/POST/PATCH/DELETE /skills` (router/skills.ts, service/skills.service.ts:34-209); FE `admin/SkillsView.vue` placeholder |
| FR-14 | **Gắn kỹ năng vào hồ sơ ứng viên** — thêm skill theo tên (`/skills/by-name`, chỉ nhận skill đã có trong danh mục), tự gắn khi AI đọc CV; đặt mức 1-5, sửa, xóa. API + store có đủ nhưng 5/6 route bị route admin che (cùng prefix `/skills`, mount trước) và store không được component nào dùng | Candidate | Một phần | `POST /skills/by-name` hoạt động (candidateSkill.service.ts:199-242, được gọi từ pipeline parse CV — cv.service.ts); shadowing: router/index.ts:53,56 mount 2 router cùng `/skills`; `stores/candidateSkill.ts` không có caller |

### M4. CV (Curriculum Vitae)

| Mã | Tính năng & mô tả | Actor | Trạng thái | Bằng chứng |
|---|---|---|---|---|
| FR-15 | **Tạo CV bằng trình soạn thảo** — form đầy đủ (học vấn, kinh nghiệm, kỹ năng, ngôn ngữ, dự án, chứng chỉ), chọn 1 trong 5 template, xem trước trực tiếp; lưu là CV nguồn `direct`, sẵn sàng ngay | Candidate | Hoàn thiện | `POST /cvs/direct` (router/cv.ts:56, service/cv.service.ts:329, validate middleware/cv.ts:91-95, `templateId` 1..5); FE `CreateResumeView.vue` + `components/cv/templates/CVTemplate1..5.vue` |
| FR-16 | **Quản lý CV** — danh sách (lọc nguồn upload/direct, tìm theo tiêu đề, phân trang), xem trước (DOCX render/pdf), đặt CV chính, xóa mềm (tự chuyển CV chính nếu CV chính bị xóa) | Candidate | Hoàn thiện | `GET /cvs`, `GET /cvs/:id`, `PATCH /cvs/:id/primary`, `DELETE /cvs/:id` (service/cv.service.ts:154-320, 591-634); FE `MyResumesView.vue`, `useDocxRenderer.ts` |
| FR-17 | **Tải CV file lên (PDF/DOCX) và AI tự đọc nội dung** — upload qua MinIO (≤10MB, whitelist định dạng), hệ thống trích xuất text (pdf-parse/mammoth) rồi Gemini trích cấu trúc CV; trạng thái xử lý realtime qua socket (`parsing → ready/failed` kèm lý do) | Candidate | Hoàn thiện | `POST /cvs/upload` (router/cv.ts:34, service/cv.service.ts:121) + worker `jobs/cvParse.worker.ts:126` (queue `cvParsing`); upload: `POST /uploads/file` (service/upload.service.ts:168) |
| FR-18 | **AI phân tích, chấm điểm CV** — điểm tổng 0-100, điểm mạnh/yếu, gợi ý; xác minh link GitHub (gọi thật GitHub API) và LinkedIn; có thể chạy lại thủ công hoặc tự chạy sau mỗi lần sửa CV builder | Candidate | Hoàn thiện | `POST /cvs/:id/analyze` (router/cv.ts:60), worker `jobs/cvAnalysis.worker.ts:21`, `cvService.buildVerificationWarnings` (cv.service.ts:802-815, githubLookup.service.ts:19-40); FE `CvAiAnalysisView.vue` |
| FR-19 | **Xuất CV ra PDF** — server render bằng headless Chromium qua trang in chuyên biệt (token HMAC hạn 120 giây), giới hạn 5 lần/phút; chỉ áp dụng CV builder | Candidate | Hoàn thiện | `GET /cvs/:cvId/download-pdf` (controller/cv.controller.ts:229), `GET /cvs/:cvId/render-data` (router/cv.ts:30, utils/printToken.ts), service/playwright.service.ts:159; FE `CvPrintView.vue`, `useCvDownload.ts` |

### M5. Việc làm — phía nhà tuyển dụng

| Mã | Tính năng & mô tả | Actor | Trạng thái | Bằng chứng |
|---|---|---|---|---|
| FR-20 | **Đăng tin tuyển dụng** — đầy đủ trường (tiêu đề, mô tả, yêu cầu, kỹ năng ≤50, mức lương, địa điểm, hạn nộp, loại/cấp bậc, remote, ngành, badge tuyển gấp); tạo mặc định `draft` | Employer | Hoàn thiện | `POST /jobs` (router/job.ts:55-62, service/job.service.ts:566-586, validate middleware/job.ts:122-154); FE `CreateJobModal.vue` |
| FR-21 | **AI hỗ trợ viết bản mô tả công việc** — sinh JD nháp từ từ khóa (đồng bộ, trả về để employer sửa; tốn hạn mức `job_generation`, hết → lỗi 402) | Employer | Hoàn thiện | `POST /jobs/generate` (router/job.ts:64-71, service/job.service.ts:521-564, lib/llm/jobGeneration.ts) |
| FR-22 | **Sửa / đóng / mở lại tin** — sửa mọi trường (đổi nội dung chính thì tự chạy lại embedding); xóa = chuyển `closed`; mở lại chỉ từ `closed` → `draft` | Employer | Hoàn thiện | `PATCH /jobs/:id`, `DELETE /jobs/:id`, `POST /jobs/:id/reopen` (router/job.ts:73-101, service/job.service.ts:588-648); FE `EditJobModal.vue` |
| FR-23 | **Gửi kiểm duyệt tự động bằng AI & xem kết quả quét** — submit → `ai_scanning` → Gemini chấm nội dung (phân biệt đối xử, lừa đảo, PII, chất lượng thấp… tham chiếu Bộ luật LĐ 2019) → `live` (tự tạo embedding) hoặc `ai_flagged` kèm danh sách vi phạm (mức độ, trích dẫn, gợi ý, điều luật); xem kết quả quét; sửa rồi submit lại | Employer | Hoàn thiện | `POST /jobs/:id/submit`, `GET /jobs/:id/scan-result` (router/job.ts:126-152, service/job.service.ts:449-495), worker `jobs/jobModeration.worker.ts:15-138`, bảng `job_ai_scans`/`job_ai_flags`; FE `employer/JobDetailView.vue` |
| FR-24 | **Quản lý danh sách tin của công ty** — mọi trạng thái, tìm + 6 bộ lọc (trạng thái, nơi, loại, cấp bậc, remote, ngành), phân trang | Employer | Hoàn thiện | `GET /jobs/company` (router/job.ts:29, service/job.service.ts:101-224); FE `PostedJobsView.vue` |
| FR-25 | **Tin tự hết hạn theo hạn nộp** — cron hằng ngày 0h chuyển tin `live` quá hạn nộp sang `expired` | Hệ thống | Hoàn thiện | `jobs/jobExpiry.worker.ts:14-49` (cron `0 0 * * *`, Asia/Ho_Chi_Minh) |
| FR-26 | **Biểu đồ lượt ứng tuyển theo ngày** — chuỗi N ngày (1-90, mặc định 10) kèm đỉnh và tổng; FE có dữ liệu mẫu thay thế khi chưa có số liệu | Employer, mọi người xem | Hoàn thiện | `GET /jobs/:id/applicants-over-time` (router/job.ts:117-123, service/job.service.ts:677-730); FE `candidate/JobDetailView.vue:620` (fallback `utils/jobMockup.ts`) |
| FR-27 | **Xuất danh sách ứng viên ra CSV** — hàng đợi bất đồng bộ, file lưu MinIO, báo xong qua socket `export:done`. Backend hoàn thiện nhưng FE chưa có nút gọi | Employer | Một phần | `POST /jobs/:id/export` (router/job.ts:154-160, service/job.service.ts:759-768), worker `jobs/export.worker.ts:35`; FE không có caller (grep toàn bộ `frontend/src`) |

### M6. Tìm kiếm & xem việc làm

| Mã | Tính năng & mô tả | Actor | Trạng thái | Bằng chứng |
|---|---|---|---|---|
| FR-28 | **Tìm kiếm việc làm theo từ khóa** — full-text PostgreSQL (tsvector, tiền tố từng từ), chỉ tin `live`, kèm điểm xếp hạng | Khách, mọi actor | Hoàn thiện | `GET /jobs/search` (router/job.ts:26, service/job.service.ts:378-446) |
| FR-29 | **Danh sách việc làm + bộ lọc + sắp xếp + phân trang** — lọc: từ khóa, tỉnh, loại, cấp bậc, khoảng lương (overlap), remote, ngành; sắp xếp mới nhất/cũ nhất/lượt xem/lượt ứng tuyển | Khách, mọi actor | Hoàn thiện | `GET /jobs` (router/job.ts:36, service/job.service.ts:101-224); FE `candidate/JobsView.vue` (1420 dòng) |
| FR-30 | **Xem chi tiết việc làm** — theo id/slug, tự tăng lượt xem, kèm thông tin công ty + bản đồ (Leaflet/OSM), đánh giá; ứng viên xem được trạng thái ứng tuyển của mình theo slug | Khách, mọi actor | Hoàn thiện | `GET /jobs/:id`, `GET /jobs/by-slug/:slug`, `GET /jobs/by-slug/:slug/application-status` (router/job.ts:39-53, service/job.service.ts:328-376); FE `candidate/JobDetailView.vue` (tab công ty + `CompanyMap.vue`) |
| FR-31 | **Tìm kiếm ngữ nghĩa bằng AI (vector)** — embedding 768 chiều (gemini-embedding-001, dedup theo hash nội dung), tìm cosine similarity có lọc tỉnh/cấp/loại. Đang được chatbot dùng nội bộ; endpoint công khai chưa có UI gọi | Hệ thống; (endpoint: mọi actor) | Hoàn thiện | Worker `jobs/jobEmbedding.worker.ts`, `lib/llm/jobEmbedding.ts:100-254` (`searchSimilarJobs`), endpoint `GET /jobs/search/semantic` (router/job.ts:25) — FE `jobApi.semanticSearch` không có caller; chatbot `handlers/search.ts:15-64` gọi thẳng service |
| FR-32 | **Dữ liệu cho bộ lọc** — danh sách ngành, tỉnh/tp, loại công việc, cấp bậc, khoảng lương của tin đang tuyển | Khách, mọi actor | Hoàn thiện | `GET /jobs/industries|cities|job-types|job-levels|salary-range` (router/job.ts:19-24, service/job.service.ts:231-326) |
| FR-33 | **Insight thị trường theo từ khóa** (số việc, lương trung vị, skill/công ty nổi bật) — endpoint trả dữ liệu 0 cứng, có cache Redis; panel UI tương ứng là code chết | — | Chỉ là khung (stub) | `GET /search/insight` (router/search.ts:10-24, comment "TODO: aggregate"); FE `components/search/InsightPanel.vue` chỉ được import bởi view đã bỏ route |
| FR-34 | **Gợi ý từ khóa tìm kiếm** — endpoint trả mảng rỗng (TODO autocomplete) | — | Chỉ là khung (stub) | `GET /search/suggest` (router/search.ts:26-31) |

### M7. Ứng tuyển (Application)

| Mã | Tính năng & mô tả | Actor | Trạng thái | Bằng chứng |
|---|---|---|---|---|
| FR-35 | **Ứng tuyển việc làm** — bắt buộc chọn 1 CV; chụp bản chụp (snapshot) CV vào đơn tại thời điểm nộp; có thể viết thư giới thiệu (tùy chọn sinh thư bằng AI vi/en); mỗi cặp CV–việc chỉ nộp 1 lần; thông báo employer | Candidate | Hoàn thiện | `POST /applications` (router/application.ts:49-54, service/application.service.ts:160-224, snapshot: 63-90); FE `components/job/ApplyJob.vue` (gọi `aiApi.generateCoverLetter` → `POST /candidates/me/cover-letter`, lib/llm/coverLetter.ts) |
| FR-36 | **AI chấm độ khớp CV–Việc** — khi ứng viên nộp đơn và khi employer bấm chấm lại: điểm % + kỹ năng khớp/thiếu + lý do, cập nhật realtime qua socket. **Caveat:** key hạn mức `ai_cv_match` không có trong tính năng của cả 3 gói seed → luôn bị bỏ qua với lý do `quota_exceeded` cho tới khi sửa dữ liệu gói | Hệ thống; Employer (chấm lại) | Một phần | Worker `jobs/cvMatch.worker.ts:20-300` (queue `cvMatch`), `POST /applications/:id/recompute-match` (service:717-842); seed gói thiếu key: `scripts/seed-plans.ts:61-107` + `plan.service.ts:16-22` |
| FR-37 | **Theo dõi đơn đã ứng tuyển & rút đơn** — danh sách có lọc/trang, badge điểm AI cập nhật realtime, panel chi tiết (lý do AI, CV, thư); rút đơn chỉ khi `pending`/`viewed` | Candidate | Hoàn thiện | `GET /applications/me`, `PATCH /applications/:id/withdraw` (service:299-354, 876-955); FE `AppliedJobsView.vue`, `ApplicationDetailPanel.vue` |
| FR-38 | **Employer xem & chuyển trạng thái hồ sơ** — pipeline `pending → viewed → screening → interview → offered → hired/rejected` (không ràng buộc bước chuyển); tự ghi thời điểm đã xem; xem/tải CV ứng viên; chấm lại AI. **Caveat:** tin đã đóng/hết hạn thì API xem/đổi trạng thái đơn báo lỗi 400 (do dùng lại hàm kiểm tra tin `live`) | Employer | Hoàn thiện | `GET /applications/job/:jobId`, `PATCH /applications/:id/status` (service:438-504, 614-686); caveat: service/application.service.ts:444, 637 gọi `assertJobIsApplyable`; FE `employer/ApplicationsView.vue` |
| FR-39 | **Employer xem toàn bộ hồ sơ theo công ty** — gộp từ các membership `active`, lọc trạng thái/job, phân trang | Employer | Hoàn thiện | `GET /applications/company` (router/application.ts:105-110, service:518-604) |

### M8. Đánh giá & lưu việc

| Mã | Tính năng & mô tả | Actor | Trạng thái | Bằng chứng |
|---|---|---|---|---|
| FR-40 | **Đánh giá việc làm (rating 1-5 + nhận xét)** — chỉ ứng viên đã từng ứng tuyển mới được đánh giá; mỗi người 1 đánh giá (cập nhật được); hiển thị điểm trung bình trên tin | Candidate | Hoàn thiện | `GET/POST /jobs/:id/feedbacks`, `GET /jobs/:id/feedbacks/me` (router/job.ts:175-197, service/jobFeedback.service.ts:13-169); FE `candidate/JobDetailView.vue:894-924` |
| FR-41 | **Lưu việc / bỏ lưu + danh sách việc đã lưu** — tìm kiếm, 4 bộ lọc (loại, cấp bậc, remote, ngành), phân trang; danh sách id cho nút lưu nhanh | Mọi actor đã đăng nhập (UI ở candidate) | Hoàn thiện | `GET/POST /saved-jobs`, `DELETE /saved-jobs/:jobId`, `GET /saved-jobs/ids` (router/savedJob.ts, service/savedJob.service.ts:28-132); FE `SavedJobsView.vue` |

### M9. Công ty & thành viên

| Mã | Tính năng & mô tả | Actor | Trạng thái | Bằng chứng |
|---|---|---|---|---|
| FR-42 | **Tạo công ty** — tự sinh slug không dấu, chống trùng; người tạo thành owner `active`; tự hủy các lời mời pending khác của mình | Employer, Admin | Hoàn thiện | `POST /companies` (router/company.ts:21-30, service/company.service.ts:132-196) |
| FR-43 | **Cập nhật thông tin công ty** — tên (giữ nguyên slug), logo/ảnh bìa (upload MinIO), mô tả, website, địa chỉ + tọa độ, mạng xã hội; chỉ owner `active` hoặc admin | Employer (owner) | Hoàn thiện | `PATCH /companies/:id` (middleware/companyMember.ts:69-111, service/company.service.ts:210); FE `CompanyView.vue` + `ImageUploadField.vue` |
| FR-44 | **Xem thông tin công ty** — theo id/slug (ẩn công ty bị cấm với người thường), kèm tối đa 10 tin `live`; FE nhúng trang công ty (mockup) + bản đồ | Khách, mọi actor | Hoàn thiện | `GET /companies/:id`, `GET /companies/by-slug/:slug` (controller/company.controller.ts:30-62, service:55-116); FE nhúng `TechNovaMockupView.vue` trong tab công ty |
| FR-45 | **Mời thành viên qua email** — owner mời theo email + vai trò (owner/member); kiểm tra: người được mời phải là employer `active`, không đang thuộc công ty khác, chưa có lời mời; hỗ trợ mời lại người từng từ chối | Employer (owner) | Hoàn thiện | `POST /companies/:companyId/members/invite` (router/companyMember.ts:80-86, service/companyMember.service.ts:285-484) |
| FR-46 | **Chấp nhận / từ chối lời mời** — chỉ tự mình chấp nhận; khi chấp nhận: hủy tự động mọi lời mời pending khác; thông báo cho owner | Employer | Hoàn thiện | `POST .../members/:userId/accept|decline` (router/companyMember.ts:93-106, service:492-710); FE `CompanyView.vue`, `CompanyMembersView.vue` |
| FR-47 | **Xóa thành viên / hủy lời mời / rời công ty / chuyển quyền sở hữu** — chặn xóa/rời owner cuối; chuyển quyền atomic (hạ cấp người old, nâng cấp người mới) và thông báo toàn bộ thành viên | Employer (owner) | Hoàn thiện | `DELETE .../members/:userId`, `POST .../leave`, `POST /companies/:id/transfer-owner` (router/companyMember.ts:111-140, service:732-1139) |
| FR-48 | **Xem danh sách thành viên & lời mời của tôi** — owner thấy mọi trạng thái, member thường chỉ thấy `active`; trang riêng cho lời mời đang chờ | Employer | Hoàn thiện | `GET /:companyId/members`, `GET /companies/me/invitations` (router/companyMember.ts:38-74, service:1149-1273) |
| FR-49 | **Admin cấm/khôi phục công ty** — đổi trạng thái `active|banned|removed`. Backend xong; trang admin `CompaniesView` là placeholder | Admin | Một phần | `PATCH /companies/:id/status` (router/company.ts:36, service:220); FE `admin/CompaniesView.vue` placeholder |

### M10. Nhắn tin thời gian thực

| Mã | Tính năng & mô tả | Actor | Trạng thái | Bằng chứng |
|---|---|---|---|---|
| FR-50 | **Nhắn tin 1-1 thời gian thực** — tạo hội thoại với bất kỳ user nào (không phân vai, 2 người chỉ có 1 hội thoại), gửi text (≤5000 ký tự) và file/ảnh (upload MinIO), hiển thị "đang gõ", xác nhận đã đọc (✓✓), đếm chưa đọc, xem lại ảnh/file đã gửi, xóa hội thoại phía mình (bên kia không ảnh hưởng); nhanh (quick chat) từ trang việc làm. FE còn mục "Nhóm" tĩnh (không có API) | Mọi actor đã đăng nhập | Hoàn thiện | REST `router/message.ts` + service/chat.service.ts (96-656); socket `socket/chat.handler.ts` (`chat:join/message/typing/read`), `socket/chatBroadcast.ts`; FE `ChatView.vue`, `useChat.ts` |

### M11. Thông báo

| Mã | Tính năng & mô tả | Actor | Trạng thái | Bằng chứng |
|---|---|---|---|---|
| FR-51 | **Thông báo realtime + danh sách + đánh dấu đã đọc** — chuông thông báo toàn cục, badge số chưa đọc, bấm để chuyển trang theo loại; 9 loại đang phát thật (thành viên công ty, tin nhắn, hồ sơ mới, match sẵn sàng, rút đơn, phỏng vấn tạo/sửa/hủy); 2 loại trong enum chưa được phát (`job_match`, `system`) | Mọi actor | Hoàn thiện | `GET /notifications`, `PATCH /notifications/:id/read` (router/notification.ts, service/notification.service.ts:93-145); gateway `socket/notificationGateway.ts`; FE `NotificationBell.vue`, `stores/notification.ts` |

### M12. Chatbot AI

| Mã | Tính năng & mô tả | Actor | Trạng thái | Bằng chứng |
|---|---|---|---|---|
| FR-52 | **Chatbot AI tư vấn đa mục đích (streaming SSE)** — 10 loại ý định: phân tích CV, phân tích tin tuyển dụng, chấm khớp CV↔Việc (gọi LLM riêng từng cặp, ≤3×3), tìm việc bằng câu hỏi tự nhiên (semantic), hỏi gói/hạn mức, tra hồ sơ đã ứng tuyển, tra lịch phỏng vấn, hướng dẫn tài khoản (trả sẵn), thông tin hệ thống (trả sẵn), trò chuyện chung; đính kèm tối đa 3 việc + 3 CV vào ngữ cảnh; quản lý phiên (đổi tên, reset ngữ cảnh, xóa); giới hạn 10 lượt/phút, ngân sách 50k token/phiên. UI chỉ có cho candidate (backend cho phép cả employer) | Candidate | Hoàn thiện | `router/chatbot.ts` (mount `/chatbot`), `service/chatbot.service.ts:313-576` (streamTurn), `lib/llm/chatbot/handlers/*` (dispatcher.ts:18-29), `intentClassification.ts:37-105`; FE `ChatbotView.vue`, `components/chatbot/*` |

### M13. Gói dịch vụ, hạn mức & thanh toán

| Mã | Tính năng & mô tả | Actor | Trạng thái | Bằng chứng |
|---|---|---|---|---|
| FR-53 | **Xem gói dịch vụ** — danh sách gói đang hoạt động (cần đăng nhập); seed 3 gói: free 0đ, light 2.000đ, pro 2.100đ / 30 ngày với hạn mức apply, job_post, AI | Mọi actor | Hoàn thiện | `GET /plans`, `GET /plans/:id` (router/plan.ts, service/plan.service.ts:32-78); seed `scripts/seed-plans.ts:61-107`; FE `PricingView.vue` |
| FR-54 | **Xem hạn mức đã dùng / còn lại của gói** — đếm ứng tuyển, tin đăng + tổng lượt/token của từng tính năng AI trong kỳ gói; hiện `unlimited` với limit -1; tự gia hạn lại gói Free hết hạn | Mọi actor | Hoàn thiện | `GET /plans/me`, `GET /plans/me/usage` (service/plan.service.ts:252-471) |
| FR-55 | **Mua gói qua chuyển khoản QR (PayOS)** — tạo phiên thanh toán (mã đơn unique, chữ ký HMAC), FE hiển thị mã QR VietQR + link checkout; xác nhận qua webhook PayOS có kiểm tra chữ ký SDK, idempotent; cập nhật realtime qua socket `payment:updated` | Candidate, Employer | Hoàn thiện | `POST /payments` (service/payment.service.ts:151, createPayOSPaymentLink:691-754), `POST /webhooks/payos` (router/webhooks.ts:33-58, handlePayOSWebhook:341-442); FE `PaymentQRModal.vue`, `usePaymentUpdates.ts` |
| FR-56 | **Hủy thanh toán đang chờ** — chỉ khi `pending`; gọi hủy phía PayOS (lỗi PayOS vẫn hủy trong DB); phiên chờ quá 24h tự chuyển `expired` | Candidate, Employer | Hoàn thiện | `POST /payments/:id/cancel` (service:459-603), cleanup `cleanupStalePendingPayments` (service:54-118); FE `PaymentDetailModal.vue` |
| FR-57 | **Kích hoạt gói khi thanh toán thành công (subscription)** — tạo subscription mới (hủy các gói active cũ), hết hạn kiểu lazy (tự đồng bộ khi truy vấn); người không có gói trả phí tự được cấp gói Free (kỳ mới reset hạn mức) | Hệ thống; Candidate, Employer | Hoàn thiện | `subscriptionService.create` (service/subscription.service.ts:147-186, gọi trong tx webhook), `refreshFreeSubscriptionForUser` (225-324), lazy `syncExpiredStatus` (59-84); FE `BillingSuccessView.vue`, `BillingCancelView.vue` |
| FR-58 | **Admin quản lý gói dịch vụ** — thêm/sửa/xóa mềm gói (chặn xóa khi còn subscription active). Backend xong; UI admin `PlansView` là placeholder (store FE đã có sẵn) | Admin | Một phần | `POST/PATCH/DELETE /plans` (router/plan.ts:50-56, service:82-204); FE `admin/PlansView.vue` placeholder |
| FR-59 | **Admin tra cứu & chỉnh sửa subscription/payment** — xem tất cả payment (ưu tiên đã trả), xem subscription theo filter, sửa gia hạn/hủy/bật autoRenew (CS tool). Backend xong; UI admin `PaymentsView`/`SubscriptionsView` là placeholder | Admin | Một phần | `GET /payments` (admin, service:276-321), `GET /subscriptions`, `PATCH /subscriptions/:id` (router/subscription.ts:44-60, service:588-681); FE placeholders |

### M14. Phỏng vấn (Interview)

| Mã | Tính năng & mô tả | Actor | Trạng thái | Bằng chứng |
|---|---|---|---|---|
| FR-60 | **Quản lý lịch phỏng vấn** — employer/admin tạo lịch cho 1 hồ sơ (thời gian tương lai, địa điểm XOR link họp), sửa/hủy; ứng viên xác nhận hoặc từ chối; interviewer ghi feedback (điểm, đề xuất strong_hire…no_hire) → chuyển `completed`; thông báo + socket từng bước. Backend hoàn thiện nhưng trang employer `InterviewsView` là placeholder → chưa dùng được end-to-end qua UI | Employer, Candidate | Một phần | `router/interview.ts` (POST ``, GET, PUT `/:id`, `/cancel`, `/feedback`; candidate `/candidate/my`, `/confirm`, `/reject` — service/interview.service.ts:147-545); FE `employer/InterviewsView.vue` placeholder |
| FR-61 | **Tự động nhắc lịch phỏng vấn (24h/2h/15m)** — cron 15 phút chạy nhưng handler rỗng (lời gọi `sendReminders` bị comment và hàm không tồn tại) | Hệ thống | Chỉ là khung (stub) | `jobs/interviewReminder.worker.ts:10-19`, lịch ở `jobs/index.ts:33-38`; cột `reminder24hSent/2h/15m` không được đọc/ghi |

### M15. Quản trị hệ thống (Admin)

| Mã | Tính năng & mô tả | Actor | Trạng thái | Bằng chứng |
|---|---|---|---|---|
| FR-62 | **Quản lý người dùng** — danh sách (tìm theo email/tên, lọc role/trạng thái, sắp xếp), đếm theo nhóm, xem chi tiết (provider OAuth), khóa/mở (`active|suspended|pending|banned`), xóa mềm. Không có chức năng đổi role | Admin | Hoàn thiện | `router/admin/user.ts` (GET list/counts/:id, PATCH status, DELETE — service/auth.service.ts:370-596); FE `admin/UsersListView.vue` (741 dòng, thật) |
| FR-63 | **Quản lý tin tuyển dụng** — danh sách mọi trạng thái (tìm + 7 lọc), đếm theo trạng thái, xem chi tiết, đổi trạng thái bất kỳ (công cụ duyệt/đóng thủ công); ép quét AI lại 1 tin | Admin | Hoàn thiện | `router/admin/job.ts` (GET list/counts/:id, PATCH `/:id/status` — service/job.service.ts:798-930), `POST /jobs/:id/resubmit` adminOnly (router/job.ts:136-143); FE `admin/AllJobsView.vue` (885 dòng, thật) |
| FR-64 | **Dashboard thống kê admin** — endpoint chỉ đếm 3 số (user, job, company); trang dashboard FE là placeholder (không chart) | Admin | Một phần | `GET /admin/stats` (router/admin.ts:15-22); FE `admin/DashboardView.vue` placeholder |
| FR-65 | **Nhật ký kiểm tra (audit log)** — ghi hành động nhạy cảm (đăng ký, login, đổi mật khẩu, xóa tài khoản, OAuth) vào bảng `audit_logs`. Không có API đọc, không gắn cho admin/payment; trang LogsView placeholder | Hệ thống | Một phần | middleware/auditLog.ts:9-26, gắn tại router/auth.ts:30-76 + auth.oauth.ts:20-27; FE `admin/LogsView.vue` placeholder |

### M16. Nền tảng chung

| Mã | Tính năng & mô tả | Actor | Trạng thái | Bằng chứng |
|---|---|---|---|---|
| FR-66 | **Tải lên tệp/ảnh** — lưu MinIO theo thư mục người dùng (images/avatars/logos/covers/cvs/files/general/chat), whitelist MIME (pdf, doc(x), xls(x), pptx, txt, csv, zip, ảnh), ≤10MB; xóa được file của chính mình | Mọi actor | Hoàn thiện | `POST /uploads/file`, `POST /uploads/image`, `DELETE /uploads?key=` (router/upload.ts, service/upload.service.ts:126-193, middleware/upload.ts:12-60) |
| FR-67 | **Trang điều khoản sử dụng & chính sách bảo mật** — route `/terms`, `/privacy` hiển thị được; nội dung là placeholder | Khách | Chỉ là khung (stub) | FE `views/pages/TermsView.vue` (46 dòng), `PrivacyView.vue` (54 dòng, tự ghi "TODO thay nội dung Legal") |

---

## 4. Danh sách Use Case

| Mã | Use case | Actor | Mô tả ngắn | FR liên quan |
|---|---|---|---|---|
| UC-01 | Đăng ký tài khoản (OTP email) | Khách | Chọn vai trò, tạo tài khoản, xác thực email bằng OTP | FR-01 |
| UC-02 | Đăng nhập | Khách | Đăng nhập email/mật khẩu, nhận token | FR-02, FR-06 |
| UC-03 | Đăng nhập/đăng ký bằng mạng xã hội | Khách | OAuth Google/Facebook/GitHub, chọn vai trò lần đầu, liên kết tài khoản | FR-03 |
| UC-04 | Khôi phục mật khẩu | Mọi actor | Quên mật khẩu → OTP → đặt lại | FR-04 |
| UC-05 | Quản lý tài khoản cá nhân | Mọi actor | Đổi mật khẩu, đổi avatar, cập nhật hồ sơ chung, tự xóa tài khoản | FR-05, FR-07..FR-10 |
| UC-06 | Tạo & quản lý CV | Candidate | Soạn CV 5 template, quản lý danh sách, đặt CV chính, xuất PDF | FR-15, FR-16, FR-19 |
| UC-07 | Tải CV lên & AI đọc CV | Candidate | Upload PDF/DOCX, hệ thống tự trích xuất nội dung | FR-17, FR-66 |
| UC-08 | Xem AI phân tích CV | Candidate | Điểm, mạnh/yếu, gợi ý, cảnh báo link | FR-18 |
| UC-09 | Quản lý hồ sơ ứng viên | Candidate | Cập nhật thông tin, địa chỉ + bản đồ, mạng xã hội | FR-12 |
| UC-10 | Tìm kiếm việc làm | Khách, Candidate | Từ khóa, bộ lọc, sắp xếp, xem chi tiết | FR-28..FR-32 |
| UC-11 | Lưu việc làm | Candidate | Lưu/bỏ lưu, xem danh sách đã lưu | FR-41 |
| UC-12 | Ứng tuyển việc làm | Candidate | Chọn CV, thư giới thiệu (AI), nộp đơn | FR-35 |
| UC-13 | Theo dõi & rút hồ sơ | Candidate | Xem trạng thái, kết quả AI match, rút đơn | FR-36, FR-37 |
| UC-14 | Đánh giá việc làm | Candidate | Rating + nhận xét sau khi ứng tuyển | FR-40 |
| UC-15 | Nhắn tin với đối tác | Mọi actor đã đăng nhập | Tạo hội thoại, chat realtime, gửi file | FR-50, FR-11 |
| UC-16 | Tư vấn qua chatbot AI | Candidate | Hỏi đáp về CV, việc làm, độ khớp CV–việc, gói cước | FR-52, FR-31 |
| UC-17 | Tạo & quản lý công ty | Employer | Tạo công ty, cập nhật thông tin | FR-42, FR-43 |
| UC-18 | Quản lý thành viên công ty | Employer (owner) | Mời, chấp nhận, xóa, rời, chuyển quyền | FR-45..FR-48 |
| UC-19 | Đăng tin tuyển dụng | Employer | Tạo tin (AI viết JD), sửa, đóng, mở lại | FR-20..FR-22 |
| UC-20 | Kiểm duyệt tin bằng AI | Employer | Submit quét, xem kết quả, sửa và gửi lại | FR-23 |
| UC-21 | Xử lý hồ sơ ứng tuyển | Employer | Xem, đổi trạng thái, chấm lại AI, xuất CSV | FR-27, FR-36, FR-38, FR-39 |
| UC-22 | Quản lý lịch phỏng vấn | Employer, Candidate | Tạo/hủy lịch, xác nhận, feedback | FR-60 |
| UC-23 | Mua gói dịch vụ | Candidate, Employer | Xem gói, thanh toán QR PayOS, theo dõi subscription | FR-53..FR-57 |
| UC-24 | Theo dõi hạn mức sử dụng | Candidate, Employer | Xem quota còn lại theo gói | FR-54 |
| UC-25 | Nhận thông báo | Mọi actor | Thông báo realtime, đánh dấu đã đọc | FR-51 |
| UC-26 | Quản lý người dùng | Admin | Tìm, khóa/mở, xóa người dùng | FR-62 |
| UC-27 | Quản lý tin tuyển dụng | Admin | Xem, đổi trạng thái, ép quét AI | FR-63 |
| UC-28 | Quản lý công ty | Admin | Cấm/khôi phục công ty | FR-49 |
| UC-29 | Quản lý gói dịch vụ & thanh toán | Admin | CRUD gói, tra cứu subscription/payment | FR-58, FR-59 |

### Chi tiết use case quan trọng

#### UC-01 — Đăng ký tài khoản
- **Tiền điều kiện:** email chưa tồn tại trong hệ thống (hoặc chỉ tồn tại như tài khoản đã liên kết OAuth); đồng ý điều khoản.
- **Luồng chính:** 1. Người dùng mở `/register`, chọn vai trò (candidate/employer), nhập họ tên, email, mật khẩu (≥8 ký tự, có chữ hoa/thường/số), tick đồng ý điều khoản. 2. Hệ thống kiểm tra email, băm mật khẩu (bcrypt cost 12), tạo tài khoản `pending` + hồ sơ, gửi OTP 6 số qua email (hạn 5 phút). 3. Người dùng nhập OTP tại `/verify-otp` (gửi lại được, chờ 60 giây). 4. Hệ thống xác minh OTP, đặt `emailVerifiedAt`, chuyển `active`; người dùng đăng nhập bình thường.
- **Luồng ngoại lệ:** email đã tồn tại → `409 EMAIL_TAKEN` (đã liên kết OAuth → `409 OAUTH_ONLY_ACCOUNT`); 2 request cùng lúc → `409 REGISTRATION_IN_PROGRESS`; gửi mail lỗi → xóa tài khoản vừa tạo và báo lỗi; nhập sai OTP ≥5 lần → `429` (phải gửi lại mã); OTP hết hạn → `400 OTP_EXPIRED`; tài khoản bị cấm/đình chỉ → `403` khi xác thực.

#### UC-06 — Tạo CV bằng trình soạn thảo & xuất PDF
- **Tiền điều kiện:** đã đăng nhập với vai trò candidate.
- **Luồng chính:** 1. Vào `/candidate/resumes/new`, điền thông tin (học vấn, kinh nghiệm, kỹ năng — gợi ý từ danh mục kỹ năng, dự án, chứng chỉ). 2. Chọn 1/5 template, xem trước trực tiếp. 3. Lưu (`POST /cvs/direct`) → CV `ready`. 4. Mỗi lần sửa (`PATCH /cvs/:id`) hệ thống tự chạy lại phân tích AI (trạng thái `analyzing → ready` đẩy realtime qua socket). 5. "Tải PDF": server cấp token HMAC (hạn 120s), headless Chromium mở trang in chuyên biệt và trả file A4 (≤5 lần/phút).
- **Luồng ngoại lệ:** template ngoài 1..5 → `400`; CV nguồn upload không xuất PDF server được (chỉ tải file gốc); CV đang `parsing`/`analyzing` → `409 ALREADY_PROCESSING`; sửa CV người khác → `404`; hết hạn mức `ai_cv_analysis` → giữ điểm cũ + cảnh báo qua socket `cv:quota-warning`; hết hạn mức parse khi upload → CV `failed` lý do `quota_exceeded`.

#### UC-12 — Ứng tuyển việc làm
- **Tiền điều kiện:** candidate đã đăng nhập; tin đang `live`; còn thời hạn nộp; có ít nhất 1 CV; chưa nộp CV này cho tin này.
- **Luồng chính:** 1. Xem tin → "Ứng tuyển". 2. Chọn CV (danh sách CV `ready`), viết thư giới thiệu (tùy chọn, có thể bấm AI sinh thư vi/en). 3. Xác nhận → hệ thống chụp snapshot CV vào đơn, đặt `pending`, thông báo employer, xếp hàng AI chấm khớp. 4. Kết quả AI (điểm %, kỹ năng khớp/thiếu, lý do) đẩy về realtime qua socket `application:match-ready`.
- **Luồng ngoại lệ:** tin không `live` → `400 JOB_NOT_APPLYABLE`; quá hạn nộp → `400 JOB_EXPIRED`; trùng CV+tin → `409 ALREADY_APPLIED`; CV không thuộc mình → `403`; thiếu CV → `400`; rút đơn ngoài `pending`/`viewed` → `409 CANNOT_WITHDRAW` (đã rút → idempotent); hết hạn mức AI match của candidate → đơn vẫn nộp, ghi nhận `quota_exceeded` (theo dữ liệu gói seed hiện tại thì luôn rơi vào nhánh này — xem mục 6).

#### UC-19 — Đăng tin tuyển dụng & kiểm duyệt AI
- **Tiền điều kiện:** employer đã đăng nhập; có công ty (không thì UI bắt tạo công ty trước); còn hạn mức `job_post` (hết vẫn đăng được nhưng bỏ qua quét AI).
- **Luồng chính:** 1. `/employer/jobs` → "Tạo tin", điền form (có thể bấm AI sinh JD từ từ khóa — tốn hạn mức `job_generation`). 2. Lưu bản nháp. 3. "Submit" → `ai_scanning`, worker Gemini quét nội dung (phân biệt đối xử, lừa đảo, PII, chất lượng — tham chiếu Bộ luật LĐ 2019). 4. Duyệt đạt → `live` + tự tạo embedding cho tìm kiếm; bị gắn cờ → `ai_flagged` kèm danh sách vi phạm (mức độ block/warn, trích dẫn, gợi ý sửa, điều luật). 5. Xem kết quả quét, sửa nội dung, submit lại.
- **Luồng ngoại lệ:** hết hạn mức `job_post` → tin vẫn `live`, verdict `skipped` (không quét AI); LLM lỗi hết retry → hoàn hạn mức; tạo/sửa tin với `status='live'` trực tiếp → **bỏ qua kiểm duyệt AI** (không có chặn trong code); hết hạn nộp → cron hằng ngày chuyển `expired`; đóng tin → `closed`, mở lại → `draft` (phải submit lại để quét AI); admin có thể ép quét lại hoặc đổi trạng thái thủ công.

#### UC-21 — Xử lý hồ sơ ứng tuyển (Employer)
- **Tiền điều kiện:** employer là người đăng tin (ownership theo `postedBy`, thành viên khác công ty không thao tác được); hồ sơ tồn tại.
- **Luồng chính:** 1. `/employer/applications` — danh sách công ty, chia 2 cột đã/chưa có điểm AI, lọc trạng thái, tìm kiếm. 2. Mở chi tiết: điểm AI + lý do, xem/tải CV (snapshot), thư giới thiệu. 3. Đổi trạng thái pipeline (`pending → viewed → screening → interview → offered → hired/rejected`) → candidate nhận socket + thông báo. 4. Tùy chọn: bấm chấm lại AI (`recompute-match`).
- **Luồng ngoại lệ:** tin đã đóng/hết hạn → API xem/đổi trạng thái trả `400 JOB_NOT_APPLYABLE` (hành vi hiện có của code); không sở hữu tin → `403` (xem chi tiết trả `404` để không lộ); chấm lại khi không có snapshot CV → `400 NO_CV_SNAPSHOT`; queue chết → `503 QUEUE_UNAVAILABLE`.

#### UC-23 — Mua gói dịch vụ qua PayOS
- **Tiền điều kiện:** đã đăng nhập (candidate/employer); gói đang hoạt động.
- **Luồng chính:** 1. `/pricing` — so sánh 3 gói, xem hạn mức theo vai trò. 2. Chọn gói; nếu đang có gói trả phí active → xác nhận (gói mới sẽ thay thế gói cũ, không cộng dồn ngày). 3. `POST /payments` → PayOS tạo link + mã QR VietQR → modal hiển thị QR + nút mở trang checkout. 4. Webhook PayOS (kiểm tra chữ ký) xác nhận → payment `paid`, tạo subscription mới (hủy gói active cũ), đẩy socket `payment:updated` → trang success.
- **Luồng ngoại lệ:** sai chữ ký webhook → bỏ qua (vẫn trả 200 để PayOS không retry); webhook trùng → idempotent; phiên chờ quá 24h → tự `expired` (khi truy vấn); người dùng hủy → `cancelled` (chỉ khi pending); PayOS lỗi → `502 PAYOS_API_ERROR`; lần đầu xem gói mà gói Free chưa seed → lỗi 500 `FREE_PLAN_NOT_CONFIGURED`.

#### UC-18 — Quản lý thành viên công ty
- **Tiền điều kiện:** người mời là owner `active` của công ty; người được mời đã có tài khoản với vai trò employer, trạng thái `active`, không đang thuộc công ty khác.
- **Luồng chính:** 1. `/employer/company/members` → mời theo email + vai trò (owner/member). 2. Người được mời nhận thông báo + thấy lời mời trong trang Công ty. 3. Chấp nhận → chuyển `active`, tự động hủy các lời mời pending khác; hoặc Từ chối. 4. Owner có thể xóa thành viên/hủy lời mời, thành viên có thể tự rời; chuyển quyền sở hữu (atomic, hạ/nâng vai trò, thông báo mọi thành viên).
- **Luồng ngoại lệ:** email chưa đăng ký → `404 USER_NOT_FOUND`; là candidate → `400 USER_NOT_EMPLOYER`; đang ở công ty khác → `409 USER_ACTIVE_ELSEWHERE`; đã pending/active → `409`; chấp nhận hộ người khác → `403`; xóa/rời làm mất owner cuối → `400`; chuyển quyền cho chính mình/người không active/đã là owner → `400`; người từng từ chối/bị xóa có thể được mời lại (row được tái sử dụng).

---

## 5. Tính năng dở dang / code chết

### Backend

| # | Phát hiện | Bằng chứng |
|---|---|---|
| 1 | Router `/resumes` là bản CV cũ, hỏng: upload đọc `req.file` nhưng không gắn multer → luôn 400; enqueue job `cv-parse`/`cv-score` lên queue `ai` mà không worker nào nghe queue này → toàn bộ luồng chết; FE không gọi router này | `backend/src/router/resume.ts:19-50`; worker thật nghe queue `cvParsing` (`jobs/cvParse.worker.ts:51`) |
| 2 | `PATCH /users/me` stub — chỉ cập nhật `updatedAt`, không lưu gì client gửi (`// TODO: validate input`) | `backend/src/router/user.ts:82-88` |
| 3 | `GET /users/me/usage` stub — trả `{}` cứng (FE có khai báo `authApi.usage` nhưng không nơi nào gọi) | `backend/src/router/user.ts:90-95`; `frontend/src/services/auth.api.ts:67` |
| 4 | `GET /candidates/jobs/recommended` stub — trả mảng rỗng, comment "placeholder Phase 3" | `backend/src/router/candidate.ts:52` |
| 5 | `GET /jobs/:id/matches` stub — check ownership rồi trả `[]` | `backend/src/service/job.service.ts:657-665` |
| 6 | `GET /search/insight` trả 0 cứng; `GET /search/suggest` trả `[]` | `backend/src/router/search.ts:10-31` |
| 7 | `PATCH /admin/jobs/:id/approve` stub TODO (không đụng DB); `GET /admin/jobs/pending` bị route `/:id` che (gọi sẽ 500) | `backend/src/router/admin.ts:25-37`; `router/admin/job.ts` đăng ký trước tại `admin.ts:12` |
| 8 | `middleware/quota.ts` — `checkQuota` cho qua tất cả (`// TODO`), không gắn vào route nào; hạn mức thực tế chỉ enforce trong worker AI | `backend/src/middleware/quota.ts:10-18` |
| 9 | Router `/employers` — profile/analytics trả JSON cứng | `backend/src/router/employer.ts:7-9` |
| 10 | n8n chết hoàn toàn: `n8nService` không được import/gọi từ đâu; bảng `n8n_workflow_logs`, `email_logs` không code nào ghi/đọc (workflow JSON trong `n8n-workflows/` không nối code) | `backend/src/service/n8n.service.ts:11-48`; `db/schema/workflowLogs.ts` |
| 11 | Schema chết: `ai_tests` + `test_assignments` (bài test IQ/Tiếng Anh chưa build), `github_lookups` (cache không dùng), `interviewer_availability`, `jobs.featured/featuredUntil`, import `jobSkills` còn sót dù bảng đã DROP (migration 0009) | `db/schema/AiTest.ts`, `github.ts`, `interview.ts:34-41`, `jobs.ts:35-36`, `skills.ts:14` |
| 12 | Queue chết: `emailQueue`, `indexingQueue` định nghĩa nhưng không worker/service dùng | `backend/src/config/queue.ts:14-16` |
| 13 | Nhắc phỏng vấn stub — cron chạy nhưng handler rỗng, `sendReminders` không tồn tại | `jobs/interviewReminder.worker.ts:10-19` |
| 14 | Hạn mức AI match lỗi cấu hình dữ liệu: key `ai_cv_match` không có trong `features` của 3 gói seed → `resolveFeatureLimit` trả 0 → luôn `quota_exceeded` | `scripts/seed-plans.ts:61-107`, `plan.service.ts:16-22`, `jobs/cvMatch.worker.ts:112-120` |
| 15 | Enum chết: payment `refunded` (không có flow hoàn tiền), subscription `pending`, job `pending` (không bao giờ được set tự động), notification `job_match`/`system` (không nơi nào emit) | `db/schema/enums.ts:9,27,28,68-80` |
| 16 | Zod tạo notification thiếu 3 loại interview (admin không tạo được notification phỏng vấn qua API); body transfer-owner không có schema validate | `middleware/notification.ts:13-22`; `router/companyMember.ts:135-140` |
| 17 | Audit log chỉ gắn cho route auth, không có API đọc | `middleware/auditLog.ts`, `router/auth.ts:30-76` |
| 18 | `POST /auth/upsert-profile` không có validate; key `preference` (số ít) lệch cột `preferences` | `auth.controller.ts:362`, `auth.service.ts:356-363` |
| 19 | Nhờ hỏng phân quyền đáng chú ý (chức năng chạy nhưng sai logic): tạo job không kiểm tra membership công ty; tạo/sửa job cho phép đặt `status='live'` bỏ qua AI scan; submit không kiểm tra trạng thái nguồn (check bị comment); đếm lượt xem tăng cả với khách | `job.service.ts:566-586`, `455-457`, `328-361`; `middleware/job.ts:177` |

### Frontend

| # | Phát hiện | Bằng chứng |
|---|---|---|
| 20 | 4 view công khai chết (route bị comment): `HomeView`, `JobListView`, `JobDetailView` (gốc), `SearchView` + 3 component chỉ chúng dùng (`SearchBar`, `InsightPanel`, `JobFilter`) → truy cập `/` rơi vào 404 | `frontend/src/router/index.ts:10,42-44` |
| 21 | `ChatbotWidget.vue` chết (import bị comment) + 4 hàm API gọi endpoint `/ai/*` không tồn tại ở backend (`ai/chat`, `ai/cv/parse`, `ai/cv/score`, `ai/jd/generate`) → 404 nếu gọi | `components/ai/ChatbotWidget.vue`, `App.vue:39`, `services/ai.api.ts:10-46` |
| 22 | `useQuota` composable không được import ở đâu; `jobApi.apply` (POST `/jobs/apply` — endpoint không tồn tại), `jobApi.semanticSearch` không caller | `composables/useQuota.ts`, `services/job.api.ts` |
| 23 | `JobSearchView` trùng 100% `JobsView` (chênh 1 dòng tiêu đề), route `/candidate/job-search` vẫn hoạt động | `views/candidate/JobSearchView.vue` vs `JobsView.vue` |
| 24 | `MockupResumeView` (`/candidate/test5`) là mockup danh sách CV + modal upload giả (setInterval, tự khai "Upload là MOCK"); sidebar không có link tới | `views/candidate/MockupResumeView.vue`, `components/upload/UploadFilesDialog.vue:12-13` |
| 25 | 3 route mockup employer: `/employer/test` (khung UI ứng viên, đổ data thật một phần), `/employer/test2` (pricing tĩnh), `/employer/test3` (landing công ty, data thật một phần); `mockup.html` tĩnh không route | `views/employer/ApplicationMockupView.vue`, `PlanMockupView.vue`, `TechNovaMockupView.vue`, `mockup.html` |
| 26 | 10/12 trang admin là placeholder "đang phát triển" (dashboard, companies, reports, plans, subscriptions, payments, skills, notifications, settings, logs) dù backend + store của plans/skills/notifications đã sẵn sàng | `views/admin/*.vue` (mỗi file 13-16 dòng) |
| 27 | 2 trang employer placeholder: `InterviewsView`, `SettingsView` | `views/employer/InterviewsView.vue` (23 dòng), `SettingsView.vue` (22 dòng) |
| 28 | Store kỹ năng ứng viên (`candidateSkill`) không được component nào dùng; 5/6 route backend tương ứng bị che bởi router admin | `stores/candidateSkill.ts` (0 caller), `backend/src/router/index.ts:53,56` |
| 29 | Chọn ngôn ngữ vi/en trong Settings chỉ đổi UI cục bộ, không có i18n backend (vue-i18n có trong package.json nhưng không dùng) | `views/candidate/SettingsView.vue`; grep `vue-i18n|createI18n` = 0 |
| 30 | Dữ liệu mẫu fallback trong trang chi tiết việc làm: biểu đồ ứng tuyển, "trách nhiệm chính", tiêu chí scope hiển thị dữ liệu cứng khi API rỗng | `utils/jobMockup.ts`, `views/candidate/JobDetailView.vue:620,800` |
| 31 | ANTHROPIC_API_KEY khai báo trong env nhưng không code nào dùng | `backend/src/config/env.ts:46` |

---

## 6. Cần xác nhận

1. **Hạn mức AI match (`ai_cv_match`) không có trong 3 gói seed** → với dữ liệu hiện tại, chấm điểm khớp CV–Việc luôn bị bỏ qua. Đây là dữ liệu dev hay dự kiến chạy thật? Có cần đưa key này vào `plans.features` không?
2. **Giá gói seed (free 0đ / light 2.000đ / pro 2.100đ / 30 ngày)** — là giá thật hay giá test?
3. **Tạo job không kiểm tra người tạo có thuộc công ty**, và client có thể tạo/sửa tin với `status='live'` trực tiếp (bỏ qua kiểm duyệt AI) — đây là chủ đích hay lỗ hổng cần sửa trước khi báo cáo?
4. **Phỏng vấn (FR-60/61)**: backend đầy đủ nhưng UI employer là placeholder và reminder rỗng — tính năng này có tính vào phạm vi hệ thống hiện tại không?
5. **Trang chủ công khai**: route `/` (HomeView) đã bị comment — hệ thống cố ý vào thẳng `/login`, hay landing page sắp làm lại?
6. **`JobSearchView` trùng `JobsView`** — route nào là chính thức (`/candidate/job-search` hay `/candidate/viec-lam`)?
7. **OAuth Facebook luôn coi email chưa xác thực** (hardcode `emailVerified=false`) → mọi user mới qua Facebook đều phải nhập OTP — chủ đích?
8. **Chatbot chỉ có UI cho candidate** trong khi backend cho phép cả employer — có kế hoạch bật cho employer không?
9. **Các trang adminPlans/Skills/Notifications**: backend + store đã xong, chỉ thiếu trang UI — có tính là "một phần" như trong báo cáo này hay sẽ hoàn thiện trước khi nộp?
10. **Quota `apply` (số lần ứng tuyển) hiện chỉ hiển thị, backend không chặn khi nộp đơn** — có cần chặn thật không?

---

## 7. Thống kê

| Chỉ số | Số lượng |
|---|---|
| Số actor | **4** (Khách, Candidate, Employer, Admin) + 1 hệ thống bổ trợ (workers/AI/PayOS) |
| Số tính năng (FR) | **67** |
| — Hoàn thiện | **52** |
| — Một phần | **11** (FR-08, 13, 14, 27, 36, 49, 58, 59, 60, 64, 65) |
| — Chỉ là khung (stub) | **4** (FR-33, 34, 61, 67) |
| — Không được sử dụng | **0** (các code chết không đưa vào FR, liệt kê ở mục 5 — 31 mục) |
| Số use case | **29** (chi tiết 7 use case quan trọng nhất) |
