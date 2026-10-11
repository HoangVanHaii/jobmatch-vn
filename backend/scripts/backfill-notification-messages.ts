/**
 * Backfill script: Cập nhật cột `message` cho các dòng cũ trong bảng `notifications` (message IS NULL).
 * Chạy theo lô (500 dòng/lô), idempotent.
 *
 * Cách chạy:
 *   cd backend
 *   npx tsx scripts/backfill-notification-messages.ts [--dry-run]
 */
import 'dotenv/config';
import { pool, db } from '../src/config/database';
import { notifications } from '../src/db/schema/notifications';
import { isNull, eq, gt, and, asc } from 'drizzle-orm';
import { buildNotificationMessage } from '../src/service/notificationMessage.builder';
import { logger } from '../src/config/logger';

const BATCH_SIZE = 500;
const isDryRun = process.argv.includes('--dry-run');

/**
 * Đánh giá xem câu message sinh ra có đủ dữ liệu hay là fallback quá chung chung.
 * Nếu payload rỗng mà title tiếng Việt có nghĩa -> dùng title.
 * Nếu không đủ cơ sở để sinh câu có nghĩa -> trả về null để giữ nguyên message NULL.
 */
function resolveBackfillMessage(
  type: string,
  payload: Record<string, unknown>,
  title: string
): string | null {
  const p = payload ?? {};
  const hasPayloadData = Object.keys(p).length > 0 &&
    (Boolean(p.candidateName) || Boolean(p.jobTitle) || Boolean(p.companyName) || Boolean(p.conversationId) || Boolean(p.summary) || Boolean(p.message));

  const built = buildNotificationMessage(type, p, title);

  // Nếu câu sinh ra chỉ là nhãn chung chung do thiếu dữ liệu
  const isGeneric =
    built === 'Hồ sơ ứng tuyển mới' ||
    built === 'Hồ sơ ứng tuyển đã được rút' ||
    built === 'Lịch phỏng vấn mới đã được thiết lập' ||
    built === 'Lịch phỏng vấn đã được cập nhật' ||
    built === 'Lịch phỏng vấn đã bị huỷ' ||
    built === 'Thông báo';

  if (isGeneric) {
    // Nếu title có độ dài và ý nghĩa tiếng Việt cụ thể hơn, ưu tiên title
    if (title && title.trim() && !/^new\s+interview|^your\s+interview/i.test(title)) {
      return title.trim();
    }
    // Ngược lại, nếu payload quá thiếu dữ liệu, để NULL để FE dùng fallback giao diện
    if (!hasPayloadData) {
      return null;
    }
  }

  return built.trim() || null;
}

async function backfill(): Promise<void> {
  logger.info(`Bắt đầu chạy backfill notification messages (Chế độ: ${isDryRun ? 'DRY-RUN' : 'LIVE'})...`);

  let totalScanned = 0;
  let totalWouldUpdate = 0;
  let totalWouldSkip = 0;
  let lastId: string | null = null;
  const sampleRows: Array<{
    type: string;
    title: string;
    payloadKeys: string[];
    predictedMessage: string;
  }> = [];

  let batchIndex = 0;

  try {
    while (true) {
      batchIndex++;
      // Keyset pagination: duyệt theo id > lastId (ASC) để không bị kẹt khi skip và dừng sạch
      const conditions = [isNull(notifications.message)];
      if (lastId) {
        conditions.push(gt(notifications.id, lastId));
      }

      const rows = await db
        .select({
          id: notifications.id,
          type: notifications.type,
          title: notifications.title,
          payload: notifications.payload,
        })
        .from(notifications)
        .where(and(...conditions))
        .orderBy(asc(notifications.id))
        .limit(BATCH_SIZE);

      if (rows.length === 0) {
        break;
      }

      lastId = rows[rows.length - 1].id;
      totalScanned += rows.length;

      if (isDryRun) {
        for (const row of rows) {
          const payload = (row.payload as Record<string, unknown>) ?? {};
          const msg = resolveBackfillMessage(row.type, payload, row.title);
          if (msg !== null) {
            totalWouldUpdate++;
          } else {
            totalWouldSkip++;
          }

          if (sampleRows.length < 20) {
            sampleRows.push({
              type: row.type,
              title: row.title,
              payloadKeys: Object.keys(payload),
              predictedMessage: msg ?? '(NULL - giữ nguyên)',
            });
          }
        }

        logger.info(`Đã quét lô #${batchIndex}: ${rows.length} dòng (lastId=${lastId})...`);
      } else {
        logger.info(`Đang cập nhật lô #${batchIndex} (${rows.length} dòng, lastId=${lastId})...`);

        await db.transaction(async (tx) => {
          for (const row of rows) {
            const payload = (row.payload as Record<string, unknown>) ?? {};
            const msg = resolveBackfillMessage(row.type, payload, row.title);
            if (msg !== null) {
              await tx
                .update(notifications)
                .set({ message: msg })
                .where(eq(notifications.id, row.id));
              totalWouldUpdate++;
            } else {
              totalWouldSkip++;
            }
          }
        });

        logger.info(`Đã cập nhật xong lô #${batchIndex}. Luỹ kế cập nhật: ${totalWouldUpdate}, bỏ qua: ${totalWouldSkip}`);
      }
    }

    if (isDryRun) {
      console.log('\n===== KẾT QUẢ DRY-RUN (TỐI ĐA 20 DÒNG MẪU) =====');
      console.table(sampleRows);
      console.log('=================================================');
      logger.info(`[DRY-RUN TỔNG KẾT] Tổng dòng quét: ${totalScanned} | Dự kiến cập nhật: ${totalWouldUpdate} | Bỏ qua (NULL): ${totalWouldSkip}`);
    } else {
      logger.info(`[HOÀN TẤT] Tổng dòng: ${totalScanned} | Đã cập nhật: ${totalWouldUpdate} | Bỏ qua (NULL): ${totalWouldSkip}`);
    }
  } catch (error) {
    logger.error({ error }, 'Lỗi trong quá trình chạy backfill notification messages');
    throw error;
  } finally {
    await pool.end();
  }
}

backfill().catch((err) => {
  console.error(err);
  process.exit(1);
});
