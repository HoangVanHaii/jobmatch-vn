-- 0049: Tạo bảng user_calendar_integrations lưu thông tin kết nối lịch (Google Calendar)
CREATE TABLE IF NOT EXISTS user_calendar_integrations (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider                 TEXT NOT NULL DEFAULT 'google',
  calendar_email           TEXT,
  access_token_encrypted   TEXT,
  refresh_token_encrypted  TEXT NOT NULL,
  token_expires_at         TIMESTAMPTZ,
  scope                    TEXT,
  is_connected             BOOLEAN NOT NULL DEFAULT true,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uniq_user_calendar_provider UNIQUE (user_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_user_calendar_user ON user_calendar_integrations(user_id);
