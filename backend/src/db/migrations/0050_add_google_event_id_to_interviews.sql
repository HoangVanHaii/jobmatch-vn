-- 0050: Thêm google_event_id vào bảng interviews để liên kết với sự kiện Google Calendar
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS google_event_id TEXT;
