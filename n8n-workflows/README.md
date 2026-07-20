# n8n Workflows — JobMatch VN

Thư mục này chứa các workflow JSON của n8n dùng cho Phase 2 (auto-screening) và Phase 3 (interview + AI test).

## Cài đặt n8n

n8n đã có trong `docker-compose.yml`. Sau khi `docker-compose up -d n8n`, truy cập:

```
http://localhost:5678
```

Login lần đầu tạo user admin. Sau đó import từng workflow bên dưới.

## Danh sách Workflows

| File | Webhook | Mục đích |
|---|---|---|
| `01-cv-scan-trigger.json` | `/webhook/cv_scan_trigger` | Trigger khi có application mới → gọi LLM scan |
| `02-auto-reject.json` | `/webhook/auto_reject` | Gửi email reject khi score < 50 |
| `03-reference-verify.json` | `/webhook/reference_verify` | Gửi email xác minh cho người tham chiếu |
| `04-interview-invite.json` | `/webhook/interview_invite` | Gửi email mời phỏng vấn cho ứng viên |
| `05-interview-reminder.json` | `/webhook/interview_reminder` | Cron gửi reminder 24h/2h/15m |
| `06-ai-test-assign.json` | `/webhook/ai_test_assign` | Gửi email link làm bài test |

## Cách import vào n8n

1. Vào n8n UI → **Workflows** → **New**
2. Menu (3 chấm) → **Import from File...** → chọn file JSON
3. Click **Activate** để enable
4. Test bằng cách gọi webhook URL từ backend hoặc Postman

## Cách export từ n8n

Sau khi customize workflow trong UI:
- Menu → **Download** → lưu vào thư mục này để commit vào Git

## Webhook URL chuẩn

Backend gọi n8n qua:
```
${N8N_BASE_URL}/webhook/{workflow_name}
```

Mặc định `N8N_BASE_URL=http://localhost:5678` (xem `.env`).

## Test thử workflow

```bash
curl -X POST http://localhost:5678/webhook/auto_reject \
  -H "Content-Type: application/json" \
  -d '{"applicationId":"abc-123","reason":"Score < 50"}'
```

## Logs

Mọi workflow execution được backend log vào `n8n_workflow_logs` table để debug.