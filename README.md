# JobMatch VN — Sản phẩm nghiên cứu

> **Nền tảng Tuyển dụng & Sắp xếp phỏng vấn tự động (Smart Recruitment)**
> Đề tài: ATS + Auto CV screening + Auto interview scheduling — ứng dụng AI + n8n + Dialogflow CX.

> 🧭 **Mới vào dự án?** Đọc [docs/business-overview.md](docs/business-overview.md) để nắm nghiệp vụ trong 10 phút (bài toán, 3 vai trò, luồng chính, glossary) trước khi code.

## 🎯 Tổng quan 3 Phase (theo yêu cầu GVHD)

| Phase | Mục tiêu | Báo cáo |
|---|---|---|
| **Phase 1** | ATS: web đăng tuyển, ứng viên nộp CV, tìm kiếm theo tiêu chí | Tuần 5 |
| **Phase 2** | Tự động scan CV theo JD, tra cứu GitHub, verify references, ranking | Tuần 9 |
| **Phase 3** | AI test (IQ/English), schedule phỏng vấn + email confirm + reminder | Tuần 15 |

## 🏗️ Tech Stack

- **Backend**: NodeJS 20 + Express 5 + TypeScript
- **Frontend**: Vue 3.4 + TypeScript + Vite 5
- **Database**: PostgreSQL 16 + pgvector + pg_trgm + citext
- **Cache + Queue**: Redis 7 + BullMQ
- **Realtime**: Socket.IO + Redis adapter
- **AI**: OpenAI GPT-4o-mini, DeepSeek, Anthropic Claude, Gemini (multi-provider)
- **Workflow automation**: **n8n** (self-hosted, Docker)
- **Chatbot**: **Dialogflow CX** (Google Cloud)
- **File storage**: MinIO (S3-compatible)
- **Email dev**: MailHog (port 8025)

## 📋 Yêu cầu hệ thống (Prerequisites)

Bắt buộc:
- **Node.js 20+** và npm
- **Git**

Infrastructure — chọn **1 trong 2 cách**:
- **Cách A (khuyên dùng):** [Docker Desktop](https://www.docker.com/products/docker-desktop/) — chạy Postgres + Redis + MinIO + MailHog + n8n bằng 1 lệnh
- **Cách B (không Docker):** PostgreSQL 16+ (cài thêm extension **pgvector**) + Redis 7+ cài trực tiếp lên máy

> ⚠️ **pgvector bắt buộc** cho AI matching (bảng `embeddings`). Docker dùng image `pgvector/pgvector:pg16` (đã có sẵn). Cài local thì xem [docs/database-setup.md](docs/database-setup.md).

---

## 🚀 Quick Start

Chọn **1 trong 2 cách** dưới đây. Sau khi xong, làm tiếp [Setup n8n](#setup-n8n-workflows) và (tuỳ chọn) [Dialogflow](#setup-dialogflow-cx-optional-cho-phase-1).

### Cách A — Docker cho infrastructure + npm cho app (KHUYÊN DÙNG)

Infra (DB, Redis, MinIO, MailHog, n8n) chạy trong Docker, backend + frontend chạy `npm run dev` trên máy (hot-reload nhanh).

```bash
# 1. Khởi động infrastructure
docker compose up -d

# 2. Backend
cd backend
cp .env.example .env          # điền API keys (OpenAI, GitHub, JWT secrets...) nếu dùng AI
npm install
npm run db:migrate            # apply schema (lần đầu / khi có migration mới)
npm run db:seed               # (tuỳ chọn) seed 46 skills IT
npm run dev                   # API: http://localhost:5000

# 3. Frontend (mở terminal khác)
cd frontend
cp .env.example .env
npm install
npm run dev                   # UI: http://localhost:5173
```

> 💡 Docker mount `backend/src/db/migrations` vào `docker-entrypoint-initdb.d`, nên **schema tự tạo** lần đầu Postgres start. Vẫn chạy `npm run db:migrate` khi thêm migration mới.

### Cách B — Hoàn toàn local (không Docker cho DB)

```bash
# 1. Cài PostgreSQL 16+ (kèm pgvector) + Redis — xem docs/database-setup.md
# 2. Tạo DB + user + schema trong 1 lệnh:
cd backend
./scripts/setup-local-db.sh            # Mac / Linux / WSL / Git Bash
# hoặc PowerShell (Windows):
./scripts/setup-local-db.ps1           # sẽ hỏi password superuser postgres

# 3. Backend
cp .env.example .env
npm install
npm run dev                            # API: http://localhost:5000

# 4. Frontend (terminal khác)
cd ../frontend
cp .env.example .env
npm install
npm run dev                            # UI: http://localhost:5173
```

> Cách B vẫn cần Redis (cho queue + rate-limit). Có thể chạy riêng `docker compose up -d redis` để lấy Redis mà không cần cài local.

### 🔑 Thông tin kết nối database (mặc định)

| Thông số | Giá trị |
|---|---|
| Host / Port | `localhost:5432` |
| Database | `jobmatch_vn` |
| User | `jobmatch` |
| Password | `jobmatch_dev_pwd` |

Connection string (đã có sẵn trong `.env.example`):
`postgresql://jobmatch:jobmatch_dev_pwd@localhost:5432/jobmatch_vn`

> Kết nối DBeaver / TablePlus / pgAdmin bằng thông số trên. Chi tiết + troubleshooting: [docs/database-setup.md](docs/database-setup.md).

### 🌐 Các services khi chạy

| Service | URL | Tài khoản |
|---|---|---|
| Backend API | http://localhost:5000 | — |
| Frontend UI | http://localhost:5173 | — |
| PostgreSQL | localhost:5432 | `jobmatch` / `jobmatch_dev_pwd` |
| Redis | localhost:6379 | — |
| MinIO Console | http://localhost:9001 | `jobmatch_minio` / `jobmatch_minio_pwd` |
| MailHog (email dev) | http://localhost:8025 | — |
| n8n | http://localhost:5678 | chỉ có khi `docker compose up` |

### Setup n8n workflows

1. Truy cập `http://localhost:5678`
2. Tạo admin user
3. Import từng file JSON trong `n8n-workflows/` (qua menu → **Import from File**)
4. Activate workflow

### Setup Dialogflow CX (optional cho Phase 1)

1. Tạo project trên [Google Cloud Console](https://console.cloud.google.com)
2. Enable Dialogflow CX API
3. Tạo Agent với webhook URL: `http://your-domain/api/v1/dialogflow/webhook`
4. Copy Service Account JSON → đặt vào `backend/keys/dialogflow-sa.json`
5. Set `GOOGLE_APPLICATION_CREDENTIALS` trong `.env`

## 📁 Cấu trúc dự án

```
jobmatch-vn/
├── README.md
├── docker-compose.yml          # Postgres + Redis + MinIO + MailHog + n8n
├── backend/                    # NodeJS API
│   ├── server.ts
│   ├── src/
│   │   ├── config/             # env, database, redis, queue, minio, ai, crypto
│   │   ├── middleware/         # auth, role, validate, rateLimit, quota, upload
│   │   ├── router/             # auth, oauth, jobs, applications, scan, github,
│   │   │                       # references, tests, schedule, dialogflow, ...
│   │   ├── controller/
│   │   ├── service/            # business logic
│   │   │   ├── cvScan.service.ts          # Phase 2 core
│   │   │   ├── githubLookup.service.ts    # Phase 2
│   │   │   ├── referenceVerify.service.ts # Phase 2
│   │   │   ├── aiTest.service.ts          # Phase 3
│   │   │   ├── interview.service.ts       # Phase 3
│   │   │   ├── n8n.service.ts            # webhook caller
│   │   │   └── dialogflow.service.ts      # chatbot
│   │   ├── ai/
│   │   │   ├── providers/      # OpenAI, DeepSeek, Gemini, Anthropic
│   │   │   └── prompts/        # cv_parse, cv_score, cv_scan, ai_test
│   │   ├── db/
│   │   │   ├── schema/         # Drizzle schemas (15+ tables)
│   │   │   └── migrations/0000_init.sql  # full schema
│   │   ├── jobs/               # BullMQ workers
│   │   ├── socket/             # realtime
│   │   └── utils/
│   └── scripts/                # setup-local-db (bootstrap), migrate, seed, dev-reset
├── frontend/                   # Vue 3 SPA
│   ├── src/
│   │   ├── router/             # 30+ routes
│   │   ├── stores/             # Pinia: auth, oauth, notification, plan
│   │   ├── services/           # axios + socket.io client
│   │   ├── composables/        # useAuth, useOAuth, useChat, useInsight
│   │   ├── components/
│   │   │   ├── auth/ job/ candidate/ employer/ ai/ chat/ notify/ search/ payment/ admin/
│   │   └── views/
│   └── package.json
├── n8n-workflows/              # 5 workflow JSON (import vào n8n UI)
│   ├── 02-auto-reject.json
│   ├── 03-reference-verify.json
│   ├── 04-interview-invite.json
│   └── 05-interview-reminder.json
└── docs/                       # Tài liệu
    ├── plan.md                 # PRD Markdown
    └── plan.docs               # PRD (mở bằng Word / LibreOffice)
```

## 🤖 n8n Workflows (chi tiết)

| Workflow | Webhook | Trigger | Action |
|---|---|---|---|
| **WF1: CV Scan Trigger** | `/webhook/cv_scan_trigger` | Backend gọi khi application mới | Gọi LLM scan + GitHub + reference → trả điểm |
| **WF2: Auto Reject** | `/webhook/auto_reject` | Score < 50 | Gửi email polite reject |
| **WF3: Reference Verify** | `/webhook/reference_verify` | HR gửi verify | Gửi email cho người tham chiếu |
| **WF4: Interview Invite** | `/webhook/interview_invite` | HR tạo slot | Gửi email mời + nút confirm |
| **WF5: Interview Reminder** | (cron 15min) | Mỗi 15 phút | Gửi reminder 24h/2h/15m |
| **WF6: AI Test Assign** | `/webhook/ai_test_assign` | HR assign test | Gửi email link làm bài |

## 📊 Database Schema (PostgreSQL)

20+ bảng chính:
- `users`, `user_profiles`, `oauth_accounts`
- `companies`, `jobs` (với `required_skills` JSONB)
- `cvs` (với `parsed_data` JSONB)
- `applications` (với `ai_match_reasoning` JSONB)
- `reference_verifications`, `github_lookups` (Phase 2)
- `ai_tests`, `test_assignments`, `interviews`, `interviewer_availability` (Phase 3)
- `n8n_workflow_logs`, `email_logs` (audit)
- `embeddings` (pgvector), `chat_messages`, `notifications`
- `audit_logs`, `usage_logs`, `subscriptions`, `payments`, `plans`

## 📖 Tài liệu

- [docs/business-overview.md](docs/business-overview.md) — **Tổng quan nghiệp vụ** (bài toán, vai trò, luồng, glossary) — đọc đầu tiên
- [docs/plan.md](docs/plan.md) — PRD đầy đủ (Markdown)
- [docs/plan.docs](docs/plan.docs) — PRD (Word / LibreOffice)
- [docs/database-setup.md](docs/database-setup.md) — Hướng dẫn setup database chi tiết (Docker + local, pgvector, troubleshooting)
- [n8n-workflows/README.md](n8n-workflows/README.md) — Hướng dẫn n8n
- [Dialogflow CX Webhook](https://cloud.google.com/dialogflow/cx/docs/concept/webhook)

## 🧪 Test

```bash
# Backend unit + integration
cd backend && npm test

# Backend typecheck
npm run typecheck

# Frontend lint + typecheck
cd frontend && npm run lint && npm run typecheck

# E2E (Playwright)
cd frontend && npm run test:e2e
```

## 👥 Nhóm phát triển

- **TV1 — Lead Backend**: NodeJS + DB + n8n
- **TV2 — AI/ML**: AI providers + Dialogflow
- **TV3 — Frontend**: Vue 3 + UX
- **TV4 — Fullstack + DevOps**: Integration + deploy + báo cáo

## 📅 Timeline (16 tuần)

```
Tuần 1–2    : Setup repo, docker, schema DB, auth
Tuần 3–4    : Phase 1 — Company/JD CRUD, Search, Apply CV
Tuần 5      : 🟢 BÁO CÁO PHASE 1
Tuần 6–8    : Phase 2 — CV scan AI, GitHub, references
Tuần 9      : 🟢 BÁO CÁO PHASE 2
Tuần 10–12  : Phase 3 — AI test, Interview scheduler
Tuần 13–14  : Dialogflow chatbot, polish
Tuần 15     : 🟢 BÁO CÁO PHASE 3
Tuần 16     : Hoàn thiện, báo cáo cuối khóa
```

## 📄 License

Sản phẩm nghiên cứu — chỉ dùng cho mục đích học thuật.