
BEGIN;

-- Thêm cột last_message_preview vào conversations.
-- DO block để idempotent — chạy nhiều lần không lỗi.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'conversations'
      AND column_name = 'last_message_preview'
  ) THEN
    ALTER TABLE conversations
      ADD COLUMN last_message_preview TEXT;
  END IF;
END $$;

COMMIT;
