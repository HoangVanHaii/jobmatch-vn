# JobMatch VN — PRD (Product Requirements Document)

**Project:** JobMatch VN — Sàn tuyển dụng việc làm tại Việt Nam  
**Version:** 1.0 (Draft)  
**Date:** 2026-07-01  
**Status:** Planning  
**Owner:** Product Team

---

## 1. Executive Summary

JobMatch VN là nền tảng tuyển dụng thông minh kết hợp AI, kết nối ứng viên và nhà tuyển dụng tại Việt Nam. Sản phẩm phân biệt với các sàn hiện có (VietnamWorks, TopCV, ITViec) nhờ **chatbot AI chăm sóc ứng viên 24/7** và **AI matching CV-JD thông minh**, kèm theo mô hình freemium 3 gói (Free / Light / Pro) cho cả ứng viên và nhà tuyển dụng.

**Mục tiêu MVP (6 tháng):** 50,000 MAU, 5,000 job postings/tháng, NPS ≥ 40.

---

## 2. User Personas

### 2.1 Ứng viên (Candidate)
- **Sinh viên mới ra trường** (22-25 tuổi): cần tìm việc làm đầu tiên, ít kinh nghiệm, cần hướng dẫn CV, phỏng vấn
- **Người đi làm 3-5 năm** (25-30 tuổi): muốn đổi việc, tìm cơ hội thăng tiến, cần AI matching chính xác
- **Chuyên gia** (30+ tuổi): tìm vị trí senior/lead, salary cao

### 2.2 Nhà tuyển dụng (Employer)
- **HR cá nhân / Startup nhỏ**: đăng 1-5 jobs/tháng, budget thấp
- **Công ty SME** (10-100 nhân viên): đăng 10-50 jobs/tháng, cần filter ứng viên nhanh
- **Tập đoàn lớn**: đăng 100+ jobs/tháng, cần API tích hợp ATS, branding riêng

---

## 3. Functional Requirements

### 3.1 Core (MVP — bắt buộc)

#### F1. Quản lý tài khoản
- **F1.1** Đăng ký / đăng nhập (email + Google OAuth + Facebook OAuth)
- **F1.2** Xác minh email (verification link, 24h expiry)
- **F1.3** Quên mật khẩu / reset qua email
- **F1.4** Quản lý profile (avatar, thông tin cá nhân, liên hệ)
- **F1.5** Phân quyền 2 role chính: Candidate, Employer

#### F2. Ứng viên
- **F2.1** Tạo / sửa / xóa CV (multi-CV, mỗi CV cho một ngành nghề)
- **F2.2** Upload CV (PDF, DOCX) — parse tự động điền form
- **F2.3** Tìm kiếm việc làm (keyword, location, salary range, industry, job level)
- **F2.4** Filter nâng cao (lương, loại hình, công ty, ngành)
- **F2.5** Apply job (1 click, kèm CV + cover letter)
- **F2.6** Saved jobs (lưu việc để xem sau)
- **F2.7** Job alerts (email notification khi có job mới match profile)
- **F2.8** Lịch sử apply (status: pending / viewed / interviewed / rejected / offered)
- **F2.9** Đánh giá công ty (review, rating 1-5 sao)
- **F2.10** Hồ sơ ẩn danh (ẩn tên + email khi apply)

#### F3. Nhà tuyển dụng
- **F3.1** Company profile (logo, cover, mô tả, địa chỉ, website, social links)
- **F3.2** Xác minh công ty (upload giấy phép kinh doanh, admin duyệt)
- **F3.3** Đăng tin tuyển dụng (rich editor: title, description, requirements, benefits, salary range, deadline)
- **F3.4** Quản lý job posts (draft / pending / live / expired / closed)
- **F3.5** Xem danh sách ứng viên apply (filter: status, score, keyword)
- **F3.6** Ứng viên xem CV (với quyền phù hợp theo plan)
- **F3.7** Bulk actions: invite to interview, reject, save to talent pool
- **F3.8** Applicant tracking system (ATS) cơ bản: stage (new / screening / interview / offer / hired / rejected)
- **F3.9** Gửi email template cho ứng viên (interview invite, rejection)
- **F3.10** Analytics dashboard (views, applies, conversion rate)

#### F4. Admin
- **F4.1** Quản lý users (ban, unban, xem chi tiết)
- **F4.2** Duyệt job posts (kiểm duyệt nội dung, phát hiện spam)
- **F4.3** Duyệt company verification
- **F4.4** Xem báo cáo tổng quan (MAU, jobs posted, applications, revenue)
- **F4.5** Quản lý pricing plans
- **F4.6** Audit log (xem lịch sử admin actions)

### 3.2 Bổ sung (nice-to-have — đợt 2)

- **F5.1** Tin nhắn realtime giữa ứng viên ↔ nhà tuyển dụng (in-app chat)
- **F5.2** Video call tích hợp (Jitsi / Daily.co) cho phỏng vấn online
- **F5.3** Blog / Career tips (SEO content)
- **F5.4** Mobile app (React Native — dùng chung API)
- **F5.5** Public API cho third-party ATS integration
- **F5.6** Multi-language (i18n: vi, en, ja, ko)

---

## 4. AI Features (điểm khác biệt chính)

### 4.1 AI Matching (core)

**Mục tiêu:** Match ứng viên với job posts bằng AI thay vì keyword matching.

**Approach:**
- **Vector embeddings**: dùng embedding model (OpenAI text-embedding-3, Cohere embed-multilingual, hoặc local model) để encode CV + JD thành vector
- **Cosine similarity** để rank top-K matches
- **Re-ranking** bằng LLM: LLM đọc top-10 matches và đánh giá chất lượng (skill match, experience level, location, salary fit)
- **Multi-lingual support**: dùng embedding model hỗ trợ tiếng Việt (multilingual-e5, BGE-M3)

**Cải thiện qua thời gian:**
- Thu thập feedback (ứng viên apply → nhà tuyển dụng accept/reject)
- Train re-ranker theo feedback (fine-tune hoặc prompt engineering)
- A/B test giữa các matching strategies

**Chi phí ước tính (per 1000 active users):**
- Embedding generation: ~$5/tháng (cached aggressively)
- LLM re-ranking: ~$20/tháng (chỉ chạy cho top-10)
- Storage vector: $0 (dùng pgvector local)

### 4.2 CV Parsing & Auto-fill

**Mục tiêu:** User upload PDF/DOCX → AI trích xuất thông tin → auto-fill form.

**Flow:**
1. User upload CV (PDF/DOCX)
2. Backend dùng parser (pdfplumber, python-docx) extract text + tables
3. Gửi text + schema (các field cần extract) cho LLM
4. LLM trả về JSON structured: `{name, email, education, experience, skills, ...}`
5. Frontend hiển thị form pre-filled, user review/edit

**Fallback:** nếu LLM fail hoặc format lạ → dùng regex/heuristic fallback (email regex, phone regex).

**Cải thiện:** user có thể edit → feedback lưu lại → fine-tune prompt theo format hay gặp.

### 4.3 AI Chatbot (chatbox hỗ trợ)

**Đây là tính năng AI nổi bật nhất** — phân biệt với các sàn khác.

**Use cases:**
- **Ứng viên:** trả lời câu hỏi về cách viết CV, cách deal lương, gợi ý công ty, giải thích JD
- **Nhà tuyển dụng:** gợi ý tiêu đề job, JD mẫu, cách filter ứng viên
- **Chung:** FAQ về sàn, tài khoản, billing

**Approach:**
- **LLM-based**: GPT-4o-mini (OpenAI) / Claude Haiku (Anthropic) / DeepSeek
- **RAG (Retrieval-Augmented Generation):** index các tài liệu FAQ, job description mẫu, CV mẫu → retrieve context trước khi generate
- **Tools/Function calling:** cho phép chatbot truy vấn DB (vd: "Tìm job IT tại HCM lương > 20tr") → tự gọi API jobs list
- **Multi-turn memory:** nhớ context hội thoại
- **Streaming response:** gõ từng từ một cho UX mượt
- **Human handoff:** nếu confidence thấp → gợi ý chat với nhân viên hỗ trợ

**Safety:**
- Filter câu hỏi không liên quan (off-topic)
- Rate limiting (theo plan)
- Audit log mọi cuộc hội thoại

### 4.4 AI Cover Letter Generator

**Mục tiêu:** Tự sinh cover letter cá nhân hoá cho từng job.

**Approach:**
- Input: CV của ứng viên + JD muốn apply
- Prompt LLM: "Viết cover letter 200-300 từ cho ứng viên X apply vị trí Y, nhấn mạnh kỹ năng phù hợp"
- Output: cover letter draft, user chỉnh sửa trước khi gửi

**Value:** Tăng tỷ lệ apply thành công ~20% (industry data).

### 4.5 AI Job Description Generator

**Mục tiêu:** NTD nhập vài keywords → AI sinh JD hoàn chỉnh.

**Approach:** Template + LLM fill in (responsibilities, requirements, benefits) dựa trên industry + job level.

### 4.6 AI Salary Insights

**Mục tiêu:** Gợi ý mức lương thị trường cho 1 vị trí + location + experience.

**Data:** aggregate anonymized salary data từ job postings + user-reported salaries.

---

## 5. Non-Functional Requirements

### 5.1 Performance
- Page load (LCP) < 2.5s trên 4G
- API response p95 < 500ms
- Search results < 1s cho 100K jobs
- AI matching < 3s end-to-end
- Uptime 99.5%

### 5.2 Security
- HTTPS only
- JWT auth + refresh token rotation
- Rate limiting (theo plan)
- Input validation (server + client)
- SQL injection prevention (ORM only)
- XSS prevention (React escapes by default)
- File upload: virus scan (ClamAV) + size limit + type whitelist
- GDPR/PDPA compliance: data export, account deletion

### 5.3 Scalability
- Horizontal scaling: stateless API servers behind load balancer
- Read replicas cho DB
- Caching layer (Redis) cho search, session
- Queue system (Celery / BullMQ) cho async tasks (email, AI matching)
- CDN cho static assets
- Vector search scale: pgvector → Qdrant/Milvus khi > 1M users

### 5.4 Usability
- Mobile-first responsive design
- WCAG 2.1 AA accessibility
- Multi-language (i18n) — Vietnamese first, English second
- Onboarding flow cho user mới
- Empty states có hướng dẫn rõ ràng
- Error messages thân thiện, gợi ý cách fix

### 5.5 Observability
- Structured logging (JSON)
- Metrics (Prometheus): API latency, AI calls, errors
- Tracing (OpenTelemetry) — distributed across services
- Error tracking (Sentry)
- AI-specific metrics: token usage, cost per call, success rate

### 5.6 Reliability
- Multi-region deployment
- Auto-scaling (CPU > 70% → scale out)
- Database backups (daily + point-in-time recovery)
- Disaster recovery plan (RTO < 4h, RPO < 1h)

---

## 6. Subscription Plans (giới hạn Free / Light / Pro)

### 6.1 Bảng so sánh tổng quan

| Feature | **Free** | **Light** (199k/tháng) | **Pro** (599k/tháng) |
|---------|----------|------------------------|----------------------|
| **Ứng viên** |
| Tạo CV | 1 CV | 3 CV | Không giới hạn |
| Apply job / tháng | 10 | 50 | Không giới hạn |
| Saved jobs | 5 | 50 | Không giới hạn |
| Job alerts email | 1 / tuần | Daily | Real-time |
| AI matching score | Cơ bản | Nâng cao | Nâng cao + explain |
| AI cover letter | ❌ | 3 / tháng | Không giới hạn |
| AI chatbot | 5 tin nhắn / ngày | 50 tin nhắn / ngày | Không giới hạn |
| Profile boost (lên top search) | ❌ | ❌ | ✅ 3 lần/tháng |
| Ẩn danh / Private mode | ❌ | ✅ | ✅ |
| Xem ai đã xem CV | ❌ | 10 / tháng | Không giới hạn |
| **Nhà tuyển dụng** |
| Đăng job / tháng | 1 | 10 | Không giới hạn |
| Job duration | 30 ngày | 60 ngày | 90 ngày |
| Featured jobs (lên top) | ❌ | 1 / tháng | 10 / tháng |
| Xem CV ứng viên | 10 / tháng | 100 / tháng | Không giới hạn |
| AI matching (top candidates) | 3 / job | 20 / job | 100 / job |
| AI JD generator | 1 / tháng | 10 / tháng | Không giới hạn |
| Bulk email (gửi cho nhiều ứng viên) | ❌ | 50 / tháng | Không giới hạn |
| Analytics dashboard | Cơ bản | Nâng cao | Nâng cao + export |
| ATS API integration | ❌ | ❌ | ✅ |
| Dedicated support | ❌ | Email | Ưu tiên + Slack |
| Branded careers page | ❌ | ❌ | ✅ |

### 6.2 Quota enforcement

- **Rate limiting** theo plan: token bucket per user per day
- **Soft limits**: gần đạt → notification warning
- **Hard limits**: vượt → block action + upsell modal
- **Grace period**: nếu downgrade plan → giữ features cũ đến cuối kỳ thanh toán

### 6.3 Payment (VN)

- **Provider:** PayOS (VN, hỗ trợ QR ngân hàng nội địa + Visa/Master)
- **Cycle:** monthly / annual (giảm 17% cho annual)
- **Trial:** 7 ngày Pro miễn phí (1 lần/user)
- **Refund:** trong 7 ngày đầu

---

## 7. AI Provider Strategy (chi tiết — phần quan trọng)

### 7.1 Tại sao cần chiến lược AI provider rõ ràng?

AI là **chi phí lớn nhất** trong vận hành (ước tính 30-40% OPEX). Chọn sai provider có thể:
- Cháy budget (rate limit, giá cao)
- Trải nghiệm user kém (latency cao, response sai)
- Vendor lock-in (khó đổi provider)

### 7.2 Phân loại use case theo nhu cầu

| Use case | Latency budget | Throughput | Quality | Cost sensitivity |
|----------|---------------|-----------|---------|------------------|
| Embedding (CV/JD) | 200ms | 10K/day | Medium | High |
| Matching re-rank | 2s | 5K/day | **High** | Medium |
| CV parsing | 5s | 1K/day | **High** | Low (1-time) |
| AI Chatbot | 1s stream | 50K/day | **High** | **High** |
| Cover letter | 3s | 2K/day | High | Low |
| JD generator | 3s | 1K/day | Medium | Low |

→ Mỗi use case có yêu cầu khác nhau → không nên dùng 1 provider duy nhất.

### 7.3 Multi-provider architecture

**Nguyên tắc:** abstraction layer `LLMProvider` interface, swap dễ dàng.

```python
class LLMProvider(Protocol):
    async def chat(messages, **kwargs) -> str: ...
    async def embed(text: str) -> list[float]: ...
    async def stream_chat(messages) -> AsyncIterator[str]: ...
```

### 7.4 Provider stack (recommended)

| Use case | Primary | Fallback | Why |
|----------|---------|----------|-----|
| Embedding (CV/JD) | **multilingual-e5-large** (self-hosted) | OpenAI text-embedding-3-small | Cost (free self-hosted) + Vietnamese support |
| Chatbot (real-time) | **DeepSeek** (`deepseek-chat`) | OpenAI GPT-4o-mini | Rẻ nhất cho chat ($0.14/M tokens), tiếng Việt OK |
| CV/JD parsing (batch) | **OpenAI GPT-4o-mini** | Gemini 2.5 Flash | Quality tốt cho structured output, JSON mode |
| Cover letter | OpenAI GPT-4o-mini | DeepSeek | Quality cần thiết |
| JD generator | OpenAI GPT-4o-mini | DeepSeek | Quality cần thiết |

### 7.5 Cost estimation (per 1000 MAU / month)

| Use case | Volume | Cost/provider | Monthly cost |
|----------|--------|--------------|-------------|
| Embedding (multilingual-e5) | 100K vectors | Free (self-hosted on GPU) | $50 (GPU) |
| Chatbot (DeepSeek) | 500K messages | $0.0001/msg | $50 |
| CV parsing (GPT-4o-mini) | 5K CVs × 3 calls = 15K | $0.01/call | $150 |
| Cover letter | 10K | $0.005/call | $50 |
| JD generator | 5K | $0.008/call | $40 |
| Matching re-rank | 20K jobs × top-10 | $0.003/call | $60 |
| **Total** | | | **~$400/month** |

→ Nếu dùng 1 provider (GPT-4 cho tất cả): ~$2,000/month. Tiết kiệm **5x** bằng multi-provider.

### 7.6 Implementation pattern

```python
# config.py
class Settings(BaseSettings):
    LLM_CHATBOT_PROVIDER: str = "deepseek"  # or "openai", "gemini"
    LLM_PARSING_PROVIDER: str = "openai"   # GPT-4o-mini
    EMBEDDING_PROVIDER: str = "local"        # multilingual-e5

# llm_client.py
class LLMClient:
    def __init__(self, provider: str):
        if provider == "deepseek":
            self._client = AsyncOpenAI(
                api_key=settings.DEEPSEEK_API_KEY,
                base_url="https://api.deepseek.com"
            )
        elif provider == "openai":
            self._client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
        # ...
```

**Lợi ích:**
- Mỗi use case dùng provider tối ưu (cost vs quality)
- A/B test dễ dàng (route 10% traffic sang provider mới)
- Failover khi provider down

### 7.7 Embedding strategy

**Recommendation: self-hosted multilingual-e5-large**

**Lý do:**
- Free (chỉ tốn GPU cost, ~$50/tháng cho 1 GPU)
- Hỗ trợ 100+ ngôn ngữ, bao gồm tiếng Việt rất tốt
- Vector 1024-dim, chất lượng cao (top trên MTEB benchmark)
- Privacy: data không rời khỏi server

**Setup:**
- Deploy trên GPU instance (A10G / T4)
- Dùng TEI (Text Embeddings Inference) của HuggingFace
- Hoặc ONNX runtime nếu cần tiết kiệm GPU

**Alternative nếu không có GPU:** OpenAI `text-embedding-3-small` ($0.02/1M tokens) — vẫn rẻ, không cần GPU.

### 7.8 Prompt engineering best practices

- **Version control prompts** (lưu trong Git, không hardcode)
- **Prompt templates** với `{{variables}}` (Jinja2)
- **Few-shot examples** cho mỗi use case (5-10 examples)
- **Output validation**: Pydantic schemas + JSON mode (OpenAI) hoặc structured output
- **Evaluation set**: 50-100 examples cho mỗi task, run regression test trước khi deploy
- **Cost monitoring**: track tokens per call, alert nếu tăng đột biến
- **Caching**: cache responses cho repeated queries (CV parsing cùng file = same output)

### 7.9 Latency optimization

- **Streaming responses** cho chatbot (TTFT < 200ms)
- **Async parallel calls**: gọi embedding + LLM song song khi có thể
- **Speculative execution**: với cache hit, return ngay lập tức
- **Model size trade-off**: dùng `gpt-4o-mini` thay vì `gpt-4o` cho chatbot (rẻ hơn 30x, latency thấp hơn)
- **Edge caching**: cache common queries ở CDN edge (Cloudflare Workers)

### 7.10 Safety & quality

- **Input validation**: block PII (email, phone) trong prompts nếu không cần
- **Output validation**: Pydantic schema → reject malformed responses
- **Hallucination detection**: cho CV parsing, cross-check với regex/heuristic
- **Bias monitoring**:定期 audit AI outputs cho gender/age bias
- **Human-in-the-loop**: critical decisions (X) cần human approve
- **Rate limiting per user**: prevent abuse (1 user spam AI)

### 7.11 Monitoring & observability

**Metrics cần track:**
- `llm_calls_total{provider, model, use_case}` (counter)
- `llm_tokens_total{provider, model, direction=in/out}` (counter)
- `llm_latency_seconds{provider, model, use_case}` (histogram)
- `llm_cost_dollars_total{provider, model}` (counter — for billing alerts)
- `llm_errors_total{provider, model, error_type}` (counter)
- `llm_quality_score{use_case}` (gauge — from eval set)

**Alerts:**
- Daily cost > budget → email admin
- Error rate > 5% → Slack alert
- Latency p95 > 2s → warning
- Quality score drop > 10% → notify product team

**Tools:**
- **LangSmith** hoặc **LangFuse** cho LLM tracing
- **OpenLLMetry** cho OpenTelemetry instrumentation
- **Custom dashboards** (Grafana) cho cost tracking

### 7.12 Cost control (rất quan trọng cho sustainability)

**Per-user limits (theo plan):**
- Free: 10 AI calls/day
- Light: 100 AI calls/day
- Pro: unlimited (but rate-limited per minute)

**Rate limits (prevent abuse):**
- 5 calls/minute per user (regardless of plan)
- 1000 calls/hour per IP (prevent bot)

**Cost budgets (organizational):**
- Monthly budget cap (alert at 80%, hard stop at 100%)
- Per-use-case budget (e.g. chatbot $200/month, CV parsing $100/month)
- A/B test budgets (small initial budget, scale if successful)

**Optimization:**
- Cache common responses (24h TTL)
- Use smaller models where possible
- Batch operations (process 10 CVs in 1 call instead of 10 calls)
- Prompt compression (shorter system prompt, examples only when needed)

### 7.13 Roadmap AI features

**Giai đoạn 1 (MVP, 0-3 tháng):**
- AI matching (vector + re-rank)
- CV parsing & auto-fill
- AI chatbot (FAQ + tool calling)
- AI cover letter generator

**Giai đoạn 2 (3-6 tháng):**
- AI JD generator
- AI salary insights
- Personalized job recommendations (collaborative filtering)
- Interview prep (AI mock interview)

**Giai đoạn 3 (6-12 tháng):**
- Voice AI (phỏng vấn voice)
- AI screening call (auto schedule, transcribe, score)
- Predictive analytics (ứng viên nào sẽ accept offer)
- Auto-negotiate salary range

---

## 8. Tech Stack

### 8.1 Frontend
- **React 18 + TypeScript + Vite** (build nhanh, DX tốt)
- **Tailwind CSS** + shadcn/ui (UI components)
- **TanStack Query** (server state)
- **Zustand** (client state)
- **React Router v6** (routing)
- **Axios** (HTTP)
- **react-markdown** (cho AI chatbot response)

### 8.2 Backend
- **Python 3.12 + FastAPI** (async, fast, auto OpenAPI docs)
- **SQLAlchemy 2.0** (async ORM)
- **Alembic** (migrations)
- **Pydantic v2** (validation)
- **Celery + Redis** (background tasks: email, AI matching, exports)
- **Structlog** (logging)
- **Sentry** (error tracking)

### 8.3 AI/ML
- **OpenAI API** (GPT-4o-mini, embeddings)
- **DeepSeek API** (chatbot, cost-effective)
- **HuggingFace multilingual-e5-large** (self-hosted embeddings)
- **pgvector** (vector DB, dùng chung Postgres)
- **LangFuse / LangSmith** (LLM tracing)

### 8.4 Infrastructure
- **Frontend:** Vercel / Cloudflare Pages
- **Backend:** AWS ECS Fargate / GCP Cloud Run
- **Database:** AWS RDS Postgres (pgvector enabled) / Supabase
- **Cache + Queue:** AWS ElastiCache (Redis) / Upstash
- **Storage:** AWS S3 / Cloudflare R2 (CV files, company logos)
- **Email:** AWS SES / SendGrid
- **Payment:** PayOS (VN)
- **CDN:** Cloudflare
- **Monitoring:** Grafana + Loki + Prometheus / Datadog

### 8.5 DevOps
- **GitHub Actions**: CI/CD
- **Docker + Docker Compose**: local dev
- **Terraform / Pulumi**: IaC
- **Kubernetes** (khi scale lớn)

---

## 9. Data Model (high-level)

### 9.1 Core tables
- `users` (id, email, password_hash, role, status, created_at, ...)
- `user_profiles` (user_id, full_name, avatar, phone, location, ...)
- `companies` (id, name, slug, logo, cover, description, verified, ...)
- `jobs` (id, company_id, title, description, requirements, salary_min/max, location, ...)
- `applications` (id, user_id, job_id, cv_id, status, applied_at, ...)
- `cvs` (id, user_id, file_url, parsed_data JSONB, ...)
- `saved_jobs` (user_id, job_id, ...)
- `conversations` (AI chat history)
- `payments` / `subscriptions` (PayOS integration)
- `audit_logs`

### 9.2 AI tables
- `embeddings` (id, content_type, content_id, vector VECTOR(1024), ...)
- `ai_chat_history` (user_id, messages JSONB, tool_calls JSONB, ...)
- `ai_match_scores` (user_id, job_id, score, reasoning, ...)

### 9.3 Indexes
- `pgvector` index (HNSW) trên `embeddings.vector` cho similarity search
- B-tree trên `jobs.company_id`, `jobs.status`, `jobs.created_at`
- Full-text search (tsvector) trên `jobs.title`, `jobs.description`
- Composite index `(user_id, job_id)` trên `applications`

---

## 10. API Design (high-level)

### 10.1 REST conventions
- Base path: `/api/v1`
- Auth: Bearer JWT trong `Authorization` header
- Pagination: `?page=1&limit=20` hoặc cursor-based
- Errors: `{detail, error_code, field?, retry_after?}`
- Rate limit: `X-RateLimit-*` headers

### 10.2 Key endpoints
- `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`
- `GET /jobs?search=...&location=...&page=1`
- `POST /jobs/{id}/apply` (multipart với CV)
- `GET /jobs/{id}/matches` (AI matching top candidates — for employer)
- `GET /candidates?skills=...&location=...` (search ứng viên)
- `POST /ai/chat` (chatbot streaming response)
- `POST /ai/cv/parse` (multipart upload CV → JSON)
- `POST /ai/cover-letter` (CV + JD → text)
- `GET /subscriptions/plans`, `POST /subscriptions/checkout` (PayOS)
- `GET /me/usage` (current usage vs limits)

---

## 11. Roadmap (3 giai đoạn, 12 tháng)

### Giai đoạn 1 — MVP (Tháng 1-3)
- ✅ Core features (F1, F2, F3 cơ bản)
- ✅ AI: matching cơ bản (vector), CV parsing, chatbot FAQ
- ✅ Subscription: Free / Light / Pro (PayOS)
- ✅ Beta với 1000 users, 50 employers

### Giai đoạn 2 — Polish (Tháng 4-6)
- ✅ Real-time chat (F5.1), video call (F5.2)
- ✅ AI: cover letter, JD generator, salary insights
- ✅ Mobile-responsive tốt hơn
- ✅ Analytics dashboard nâng cao
- ✅ Marketing launch

### Giai đoạn 3 — Scale (Tháng 7-12)
- ✅ Mobile app (React Native)
- ✅ AI: voice interview, predictive analytics
- ✅ Multi-language (en, ja, ko)
- ✅ ATS API integration
- ✅ Series A fundraising

---

## 12. Success Metrics (KPIs)

### 12.1 User metrics
- MAU (Monthly Active Users)
- DAU/MAU ratio (stickiness) — target > 20%
- Registration completion rate — target > 60%
- Email verification rate — target > 80%
- CV completion rate (start → submit) — target > 70%

### 12.2 Engagement
- Avg jobs viewed per session — target > 5
- Apply rate (apply/view) — target > 10%
- Time to first application (signup → first apply) — target < 5 min
- Chatbot usage (MAU % using chatbot) — target > 30%

### 12.3 Business
- Free → Light conversion rate — target > 5%
- Light → Pro conversion rate — target > 15%
- MRR (Monthly Recurring Revenue)
- CAC (Customer Acquisition Cost) < 100k VND
- LTV (Lifetime Value) > 3M VND (LTV/CAC > 30)

### 12.4 AI quality
- AI matching acceptance rate (ứng viên apply job được match) — target > 50%
- Chatbot CSAT (Customer Satisfaction) — target > 4.0/5
- CV parsing accuracy (manual verify) — target > 90%
- AI cost per user per month — target < $0.50

---

## 13. Risks & Mitigation

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| AI provider down | High | Medium | Multi-provider + circuit breaker |
| Lạm phát chi phí AI | High | Medium | Per-user limits, cost alerts, smaller models |
| Bias trong matching | Medium | High | Regular audit, diverse training data |
| Data leak (CV) | High | Low | Encryption at rest + transit, strict access control |
| Spam job posts | Medium | High | AI content moderation + report system |
| Competitor (TopCV, VietnamWorks) | High | High | Differentiation qua AI features, niche focus |
| Cold start (no data for matching) | High | High | Hybrid: rule-based + AI; collect data actively |
| Regulatory change (VN PDPA) | Medium | Medium | Legal review quarterly |

---

## 14. Team & Timeline

### 14.1 Team (initial 5 người)
- 1 Product Manager / Tech Lead
- 2 Backend Engineers (Python/AI)
- 1 Frontend Engineer (React)
- 1 DevOps / SRE part-time
- (+ 1 Designer part-time)

### 14.2 Milestones (3 tháng MVP)
- **Tháng 1:** Setup infra, core features (auth, profiles, jobs CRUD)
- **Tháng 2:** Search, apply flow, payments (PayOS), subscription plans
- **Tháng 3:** AI features (matching, CV parsing, chatbot), polish, beta launch

---

## 15. Appendix

### 15.1 Glossary
- **CV:** Curriculum Vitae
- **JD:** Job Description
- **ATS:** Applicant Tracking System
- **MAU/DAU:** Monthly/Daily Active Users
- **NPS:** Net Promoter Score
- **PDPA:** Personal Data Protection Act (VN)
- **LLM:** Large Language Model
- **RAG:** Retrieval-Augmented Generation
- **pgvector:** Postgres extension for vector similarity search

### 15.2 References
- [AIFA PRD (parent project) — internal]
- [VietnamWorks competitor analysis](https://www.vietnamworks.com)
- [TopCV pricing page](https://www.topcv.vn)
- [OpenAI API docs](https://platform.openai.com/docs)
- [DeepSeek docs](https://platform.deepseek.com/docs)
- [HuggingFace multilingual-e5](https://huggingface.co/intfloat/multilingual-e5-large)
- [PayOS docs](https://docs.payos.vn)
