-- ============================================================================
-- JobMatch VN — Initial Database Schema
-- Apply this script on first docker-compose up (postgres init container)
-- ============================================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "citext";
CREATE EXTENSION IF NOT EXISTS "vector";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ============================================================================
-- Enums
-- ============================================================================
CREATE TYPE user_role AS ENUM ('candidate', 'employer', 'admin');
CREATE TYPE user_status AS ENUM ('active', 'suspended', 'pending', 'banned');
CREATE TYPE oauth_provider AS ENUM ('google', 'facebook', 'github');
CREATE TYPE job_status AS ENUM ('draft', 'pending', 'live', 'expired', 'closed');
CREATE TYPE job_level AS ENUM ('intern', 'fresher', 'junior', 'mid', 'senior', 'lead', 'manager');
CREATE TYPE job_type AS ENUM ('full-time', 'part-time', 'contract', 'internship', 'freelance');
CREATE TYPE application_status AS ENUM ('pending', 'viewed', 'screening', 'interview', 'offered', 'hired', 'rejected', 'withdrawn');
CREATE TYPE subscription_status AS ENUM ('active', 'expired', 'cancelled', 'pending');
CREATE TYPE payment_status AS ENUM ('pending', 'paid', 'failed', 'refunded');
CREATE TYPE company_status AS ENUM ('active', 'banned', 'removed'); -- company lifecycle
CREATE TYPE company_member_role AS ENUM ('owner', 'member');
CREATE TYPE company_member_status AS ENUM ('active', 'invited', 'inactive');
CREATE TYPE notification_type AS ENUM ('company_invite', 'job_match', 'message', 'system');
CREATE TYPE skill_status AS ENUM ('active', 'deleted'); -- skill soft-delete lifecycle
CREATE TYPE cv_status AS ENUM ('pending', 'parsing', 'ready', 'failed', 'deleted');
CREATE TYPE cv_source AS ENUM ('upload', 'direct');

-- ============================================================================
-- Users
-- ============================================================================
CREATE TABLE users (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email            CITEXT UNIQUE NOT NULL,
  password_hash    TEXT,
  role             user_role NOT NULL,
  status           user_status DEFAULT 'active',
  email_verified_at TIMESTAMPTZ,
  last_login_at    TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now(),
  deleted_at       TIMESTAMPTZ,
  metadata         JSONB DEFAULT '{}'::jsonb
);
CREATE INDEX idx_users_role ON users(role) WHERE deleted_at IS NULL;

CREATE TABLE user_profiles (
  user_id      UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  full_name    TEXT,
  avatar_url   TEXT,
  phone        TEXT,
  location     JSONB,
  social       JSONB,
  preferences  JSONB
);

-- ============================================================================
-- OAuth
-- ============================================================================
CREATE TABLE oauth_accounts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider          oauth_provider NOT NULL,
  provider_user_id  TEXT NOT NULL,
  provider_email    CITEXT,
  access_token      TEXT,
  refresh_token     TEXT,
  token_expires_at  TIMESTAMPTZ,
  scopes            TEXT[],
  raw_profile       JSONB,
  linked_at         TIMESTAMPTZ DEFAULT now(),
  last_used_at      TIMESTAMPTZ,
  UNIQUE(provider, provider_user_id)
);
CREATE INDEX idx_oauth_user ON oauth_accounts(user_id);
CREATE INDEX idx_oauth_provider_email ON oauth_accounts(provider, provider_email);

-- ============================================================================
-- Companies
-- ============================================================================
CREATE TABLE companies (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  slug         TEXT UNIQUE NOT NULL,
  logo_url     TEXT,
  cover_url    TEXT,
  description  TEXT,
  industry     TEXT,
  size_range   TEXT,
  website      TEXT,
  social       JSONB,
  address      JSONB,
  status       company_status NOT NULL DEFAULT 'active',
  created_by   UUID REFERENCES users(id),
  created_at   TIMESTAMPTZ DEFAULT now(),
  metadata     JSONB 
);
CREATE INDEX idx_companies_industry ON companies(industry);
CREATE INDEX idx_companies_metadata ON companies USING GIN (metadata);

-- ============================================================================
-- company_members
-- ============================================================================

CREATE TABLE IF NOT EXISTS company_members (
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        company_member_role NOT NULL,
  status      company_member_status NOT NULL DEFAULT 'active',
  joined_at   TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (company_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_company_members_user ON company_members(user_id);

-- ============================================================================
-- Jobs
-- ============================================================================
CREATE TABLE jobs (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id             UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  posted_by              UUID NOT NULL REFERENCES users(id),
  title                  TEXT NOT NULL,
  slug                   TEXT,
  description            TEXT NOT NULL,
  requirements           TEXT,
  benefits               TEXT,
  job_level              job_level,
  job_type               job_type,
  industry               TEXT,
  salary_min             NUMERIC(15,0),
  salary_max             NUMERIC(15,0),
  salary_currency        CHAR(3) DEFAULT 'VND',
  salary_visible         BOOLEAN DEFAULT true,
  location               JSONB,
  remote_ok              BOOLEAN DEFAULT false,
  experience_years_min   INT,
  experience_years_max   INT,
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
  search_tsv             TSVECTOR
    GENERATED ALWAYS AS (
      setweight(to_tsvector('simple', coalesce(title,'')), 'A') ||
      setweight(to_tsvector('simple', coalesce(description,'')), 'B') ||
      setweight(to_tsvector('simple', coalesce(requirements,'')), 'C')
    ) STORED
);
CREATE INDEX idx_jobs_company ON jobs(company_id);
CREATE INDEX idx_jobs_status_created ON jobs(status, created_at DESC);
CREATE INDEX idx_jobs_search_tsv ON jobs USING GIN (search_tsv);
CREATE INDEX idx_jobs_location ON jobs USING GIN (location);
CREATE INDEX idx_jobs_extra_data ON jobs USING GIN (extra_data);

-- ============================================================================
-- Skills
-- ============================================================================
CREATE TABLE skills (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT UNIQUE NOT NULL,
  slug          TEXT UNIQUE NOT NULL,
  status        skill_status NOT NULL DEFAULT 'active'
);
CREATE INDEX idx_skills_status ON skills(status);

CREATE TABLE job_skills (
  job_id    UUID REFERENCES jobs(id) ON DELETE CASCADE,
  skill_id  UUID REFERENCES skills(id),
  required  BOOLEAN DEFAULT true,
  PRIMARY KEY (job_id, skill_id)
);

-- ============================================================================
-- CVs
-- ============================================================================
CREATE TABLE cvs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title             TEXT,
  file_url          TEXT,
  file_type         TEXT,
  is_primary        BOOLEAN NOT NULL DEFAULT false,
  status            cv_status NOT NULL DEFAULT 'pending',
  source            cv_source NOT NULL DEFAULT 'upload',
  template_id       INTEGER,
  parsed_data       JSONB,
  ai_analysis       JSONB,
  score_updated_at  TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);
-- CHECK template_id range (NULL luôn pass qua CHECK trong Postgres)
ALTER TABLE cvs
  ADD CONSTRAINT cvs_template_id_range CHECK (
    template_id IS NULL OR (template_id BETWEEN 1 AND 5)
  );
CREATE INDEX idx_cvs_candidate ON cvs(candidate_id);
CREATE INDEX idx_cvs_parsed_data ON cvs USING GIN (parsed_data);
-- Partial index cho filter CV direct (report / admin query)
CREATE INDEX idx_cvs_source_direct ON cvs(candidate_id) WHERE source = 'direct';

CREATE TABLE candidate_skills (
  candidate_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  skill_id     UUID NOT NULL REFERENCES skills(id),
  level        INT CHECK (level BETWEEN 1 AND 5),
  PRIMARY KEY (candidate_id, skill_id)
);

-- ============================================================================
-- Applications
-- ============================================================================
CREATE TABLE applications (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id        UUID NOT NULL REFERENCES users(id),
  job_id              UUID NOT NULL REFERENCES jobs(id),
  cv_id               UUID REFERENCES cvs(id),
  cover_letter        TEXT,
  status              application_status DEFAULT 'pending',
  stage               TEXT DEFAULT 'new',
  ai_match_score      NUMERIC(5,2),
  ai_match_reasoning  JSONB,
  is_anonymous        BOOLEAN DEFAULT false,
  applied_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now(),
  viewed_at           TIMESTAMPTZ,
  metadata            JSONB,
  UNIQUE(candidate_id, job_id)
);
CREATE INDEX idx_applications_job_status ON applications(job_id, status);
CREATE INDEX idx_applications_candidate ON applications(candidate_id, applied_at DESC);

CREATE TABLE saved_jobs (
  user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id    UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  saved_at  TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (user_id, job_id)
);

-- ============================================================================
-- Embeddings (pgvector)
-- ============================================================================
CREATE TABLE embeddings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_type  TEXT NOT NULL,
  content_id    UUID NOT NULL,
  vector        VECTOR(768) NOT NULL,
  model         TEXT NOT NULL,
  text_hash     CHAR(64) NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE(content_type, content_id, model)
);
CREATE INDEX idx_embeddings_hnsw ON embeddings USING HNSW (vector vector_cosine_ops);
CREATE INDEX idx_embeddings_content ON embeddings(content_type, content_id);

-- ============================================================================
-- Chat
-- ============================================================================
CREATE TABLE conversations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_a          UUID NOT NULL REFERENCES users(id),
  user_b          UUID NOT NULL REFERENCES users(id),
  job_id          UUID REFERENCES jobs(id),
  last_message_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_a, user_b, job_id)
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
CREATE INDEX idx_chat_messages_convo ON chat_messages(conversation_id, created_at DESC);

-- ============================================================================
-- Notifications
-- ============================================================================
CREATE TABLE notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       notification_type  NOT NULL,
  title      VARCHAR(255) NOT NULL,
  payload    JSONB NOT NULL DEFAULT '{}',
  read_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_notifications_user_created ON notifications(user_id, created_at DESC);
CREATE INDEX idx_notifications_payload ON notifications USING GIN (payload);

-- ============================================================================
-- AI Chat
-- ============================================================================
CREATE TABLE ai_chat_sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT,
  messages    JSONB NOT NULL DEFAULT '[]'::jsonb,
  context     JSONB,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_ai_chat_user ON ai_chat_sessions(user_id, updated_at DESC);
CREATE INDEX idx_ai_chat_messages ON ai_chat_sessions USING GIN (messages);

-- ============================================================================
-- Billing
-- ============================================================================
CREATE TABLE plans (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code          TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  price_vnd     NUMERIC(15,0) NOT NULL,
  duration_days INT NOT NULL,
  features      JSONB NOT NULL,
  is_active     BOOLEAN DEFAULT true
);

CREATE TABLE subscriptions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id),
  plan_id         UUID NOT NULL REFERENCES plans(id),
  status          subscription_status DEFAULT 'active',
  started_at      TIMESTAMPTZ NOT NULL,
  expires_at      TIMESTAMPTZ NOT NULL,
  payos_order_id  TEXT,
  auto_renew      BOOLEAN DEFAULT false,
  created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_subs_user_active ON subscriptions(user_id, expires_at DESC);

CREATE TABLE payments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id),
  subscription_id UUID REFERENCES subscriptions(id),
  amount_vnd      NUMERIC(15,0) NOT NULL,
  payos_txn_id    TEXT,
  status          payment_status,
  raw_response    JSONB,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- ============================================================================
-- Usage + Audit
-- ============================================================================
CREATE TABLE usage_logs (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id),
  feature     TEXT NOT NULL,
  count       INT DEFAULT 1,
  metadata    JSONB,
  created_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_usage_user_feature_period ON usage_logs(user_id, feature, created_at DESC);

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

-- ============================================================================
-- Seed plans
-- ============================================================================
INSERT INTO plans (code, name, price_vnd, duration_days, features) VALUES
  ('free',  'Free',  0,      30, '{"max_cvs":1,"max_apply":10,"ai_chat_per_day":5,"ai_cv_score_per_month":1,"cover_letter_per_month":0,"jd_gen_per_month":0,"featured_per_month":0,"view_cv_per_month":10,"job_post_per_month":1,"job_duration_days":30}'),
  ('light', 'Light', 199000, 30, '{"max_cvs":3,"max_apply":50,"ai_chat_per_day":50,"ai_cv_score_per_month":10,"cover_letter_per_month":3,"jd_gen_per_month":1,"featured_per_month":0,"view_cv_per_month":100,"job_post_per_month":10,"job_duration_days":60,"anonymous_mode":true}'),
  ('pro',   'Pro',   599000, 30, '{"max_cvs":-1,"max_apply":-1,"ai_chat_per_day":-1,"ai_cv_score_per_month":-1,"cover_letter_per_month":-1,"jd_gen_per_month":-1,"featured_per_month":10,"view_cv_per_month":-1,"job_post_per_month":-1,"job_duration_days":90,"anonymous_mode":true,"boost_per_month":3,"branded_page":true,"ats_api":true}')
ON CONFLICT (code) DO NOTHING;

-- ============================================================================
-- PHASE 2 — Reference verifications, GitHub lookups
-- ============================================================================
CREATE TABLE reference_verifications (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id      UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  referee_name        TEXT NOT NULL,
  referee_email       CITEXT NOT NULL,
  referee_phone       TEXT,
  relationship        TEXT,
  company             TEXT,
  duration            TEXT,
  verification_token  TEXT UNIQUE NOT NULL,
  status              TEXT DEFAULT 'pending',
  sent_at             TIMESTAMPTZ,
  verified_at         TIMESTAMPTZ,
  response            JSONB,
  expires_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_ref_app ON reference_verifications(application_id);
CREATE INDEX idx_ref_token ON reference_verifications(verification_token);
CREATE INDEX idx_ref_status ON reference_verifications(status, expires_at);

CREATE TABLE github_lookups (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username      TEXT NOT NULL UNIQUE,
  exists        BOOLEAN NOT NULL,
  profile_data  JSONB,
  fetched_at    TIMESTAMPTZ DEFAULT now(),
  expires_at    TIMESTAMPTZ DEFAULT now() + interval '7 days'
);

-- ============================================================================
-- PHASE 3 — AI tests, interviews
-- ============================================================================
CREATE TABLE ai_tests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id        UUID NOT NULL,
  test_type     TEXT NOT NULL,
  level         TEXT,
  questions     JSONB NOT NULL,
  total_points  INT NOT NULL,
  duration_min  INT NOT NULL,
  passing_score NUMERIC(5,2) DEFAULT 60.00,
  created_at    TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_ai_tests_job ON ai_tests(job_id, test_type);

CREATE TABLE test_assignments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id  UUID NOT NULL REFERENCES applications(id),
  test_id         UUID NOT NULL REFERENCES ai_tests(id),
  access_token    TEXT UNIQUE NOT NULL,
  status          TEXT DEFAULT 'pending',
  answers         JSONB,
  score           NUMERIC(5,2),
  feedback        JSONB,
  sent_at         TIMESTAMPTZ,
  started_at      TIMESTAMPTZ,
  submitted_at    TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ
);

CREATE TABLE interviews (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id        UUID NOT NULL REFERENCES applications(id),
  interviewer_id        UUID NOT NULL REFERENCES users(id),
  scheduled_at          TIMESTAMPTZ NOT NULL,
  duration_min          INT DEFAULT 60,
  location              TEXT,
  meeting_link          TEXT,
  status                TEXT DEFAULT 'pending',
  confirmation_token    TEXT UNIQUE,
  confirmed_at          TIMESTAMPTZ,
  cancelled_at          TIMESTAMPTZ,
  cancel_reason         TEXT,
  reminder_24h_sent     BOOLEAN DEFAULT false,
  reminder_2h_sent      BOOLEAN DEFAULT false,
  reminder_15m_sent     BOOLEAN DEFAULT false,
  feedback              JSONB,
  feedback_submitted_at TIMESTAMPTZ,
  created_at            TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_interviews_scheduled ON interviews(scheduled_at, status);
CREATE INDEX idx_interviews_app ON interviews(application_id);
CREATE INDEX idx_interviews_interviewer ON interviews(interviewer_id, scheduled_at);

CREATE TABLE interviewer_availability (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  interviewer_id  UUID NOT NULL REFERENCES users(id),
  day_of_week     INT,
  start_time      TIME,
  end_time        TIME,
  specific_date   DATE,
  is_recurring    BOOLEAN DEFAULT true
);

-- ============================================================================
-- Workflow + email logs
-- ============================================================================
CREATE TABLE n8n_workflow_logs (
  id            BIGSERIAL PRIMARY KEY,
  workflow_name TEXT NOT NULL,
  execution_id  TEXT,
  status        TEXT,
  input         JSONB,
  output        JSONB,
  error         JSONB,
  duration_ms   INT,
  triggered_at  TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_n8n_logs_workflow ON n8n_workflow_logs(workflow_name, triggered_at DESC);

CREATE TABLE email_logs (
  id              TEXT PRIMARY KEY,
  user_id         TEXT,
  to_email        TEXT NOT NULL,
  subject         TEXT,
  template        TEXT,
  provider        TEXT DEFAULT 'n8n',
  provider_msg_id TEXT,
  status          TEXT,
  payload         JSONB,
  sent_at         TIMESTAMPTZ DEFAULT now()
);

-- Add scan/test/interview fields to applications
ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS scan_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS test_score NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS test_taken_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS interview_status TEXT;

-- Add required_skills + nice_to_have + education_level to jobs
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS required_skills JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS nice_to_have_skills JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS experience_years_min INT,
  ADD COLUMN IF NOT EXISTS experience_years_max INT,
  ADD COLUMN IF NOT EXISTS education_level TEXT,
  ADD COLUMN IF NOT EXISTS certifications JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS industry_required TEXT;

CREATE INDEX IF NOT EXISTS idx_jobs_required_skills ON jobs USING GIN (required_skills);
CREATE INDEX IF NOT EXISTS idx_applications_match_score ON applications(job_id, ai_match_score DESC);