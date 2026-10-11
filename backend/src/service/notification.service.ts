import { db } from '../config/database';
import { notifications } from '../db/schema/notifications';
import { eq, and, lt, desc, isNull, isNotNull, or, sql, ilike } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { notificationGateway } from "../socket/notificationGateway";
import { AppError } from '../middleware/errorHandler';
import type { CreateNotificationInput, ListNotificationsQuery, Notification } from '../interface/notification';
import { buildNotificationMessage } from './notificationMessage.builder';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Escape các ký tự đặc biệt của SQL LIKE (%, _, \) để chống wildcard injection */
export const escapeLikePattern = (input: string): string =>
    input.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');

/**
 * created_at ở precision millisecond.
 * PG lưu timestamptz với microsecond (6 chữ số), nhưng JS Date — dùng để encode cursor —
 * chỉ giữ millisecond (3 chữ số, TimeClip truncate). Phải so sánh + orderBy CŨNG ở precision
 * ms để cursor stable: tránh skip row khi 2 notification cùng createdAt-ms nhưng khác µs
 * (vd X=...123456, Y=...123100 → cả hai đều .123 ở cursor; so raw thì Y bị skip).
 */
const createdAtMs = sql`date_trunc('millisecond', ${notifications.createdAt}, 'UTC')`;

/**
 * Cursor phân trang stable (createdAt, id) — chống skip/duplicate khi nhiều
 * notification cùng createdAt. Encode base64url để client truyền qua query param.
 */
const encodeCursor = (createdAt: Date, id: string): string =>
    Buffer.from(JSON.stringify({ createdAt: createdAt.toISOString(), id })).toString('base64url');

const decodeCursor = (token: string): { createdAt: Date; id: string } => {
    let parsed: unknown;
    try {
        parsed = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
    } catch {
        throw new AppError(400, 'INVALID_CURSOR', 'Tham số phân trang không hợp lệ');
    }
    if (typeof parsed !== 'object' || parsed === null) {
        throw new AppError(400, 'INVALID_CURSOR', 'Tham số phân trang không hợp lệ');
    }
    const { createdAt, id } = parsed as { createdAt?: unknown; id?: unknown };
    if (typeof createdAt !== 'string' || typeof id !== 'string') {
        throw new AppError(400, 'INVALID_CURSOR', 'Tham số phân trang không hợp lệ');
    }
    if (!UUID_RE.test(id)) {
        throw new AppError(400, 'INVALID_CURSOR', 'Tham số phân trang không hợp lệ');
    }
    const date = new Date(createdAt);
    if (Number.isNaN(date.getTime())) {
        throw new AppError(400, 'INVALID_CURSOR', 'Tham số phân trang không hợp lệ');
    }
    return { createdAt: date, id };
};

export const notificationService = {
    /** Insert + emit — strict (throw nếu fail). Cho admin POST (/notifications). */
    create: async (input: CreateNotificationInput) => {
        const message = input.message?.trim() || buildNotificationMessage(input.type, input.payload ?? {}, input.title);
        const [row] = await db
            .insert(notifications)
            .values({
                userId: input.userId,
                type: input.type,
                title: input.title,
                message,
                payload: input.payload ?? {},
            })
            .returning();
        notificationGateway.emitToUser(input.userId, "notification:new", row);
        return row;
    },
    createInTx: async (
        tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
        input: CreateNotificationInput
    ): Promise<Notification> => {
        const message = input.message?.trim() || buildNotificationMessage(input.type, input.payload ?? {}, input.title);
        const [row] = await tx
            .insert(notifications)
            .values({
                userId: input.userId,
                type: input.type,
                title: input.title,
                message,
                payload: input.payload ?? {},
            })
            .returning();
        return row;
    },

    /** Emit socket — gọi SAU khi tx đã commit (socket không rollback được). */
    emit: (row: Notification): void => {
        notificationGateway.emitToUser(row.userId, 'notification:new', row);
    },

    /**
     * List notification của user, cursor phân trang stable (createdAt DESC, id DESC).
     * Cursor = base64url(JSON{createdAt, id}) → không skip/duplicate khi trùng createdAt.
     * Lấy limit+1 để xác định hasMore; nextCursor = encode item cuối của page hiện tại.
     * Cursor hỏng → throw AppError 400 (không query sai).
     */
    list: async (userId: string, query: ListNotificationsQuery) => {
        const { unread, cursor, limit, search } = query;

        const conditions: (SQL | undefined)[] = [eq(notifications.userId, userId)];
        if (unread === true) {
            conditions.push(isNull(notifications.readAt));
        } else if (unread === false) {
            conditions.push(isNotNull(notifications.readAt));
        }
        if (search && search.trim()) {
            const escaped = escapeLikePattern(search.trim());
            const s = `%${escaped}%`;
            conditions.push(
                or(
                    ilike(notifications.title, s),
                    ilike(notifications.message, s),
                ),
            );
        }
        if (cursor) {
            const c = decodeCursor(cursor);
            // createdAt(ms) < c.createdAt HOẶC (createdAt(ms) = c.createdAt AND id < c.id)
            // → cursor stable, không skip/duplicate. Dùng createdAtMs (date_trunc ms) để
            // cùng precision với cursor: PG lưu µs, JS Date chỉ ms (xem comment createdAtMs).
            conditions.push(
                or(
                    lt(createdAtMs, c.createdAt),
                    and(eq(createdAtMs, c.createdAt), lt(notifications.id, c.id)),
                ),
            );
        }
        const rows = await db
            .select()
            .from(notifications)
            .where(and(...conditions))
            .orderBy(desc(createdAtMs), desc(notifications.id))
            .limit(limit + 1);

        const hasMore = rows.length > limit;
        const items = hasMore ? rows.slice(0, limit) : rows;
        const last = items[items.length - 1];
        const nextCursor = hasMore && last ? encodeCursor(last.createdAt, last.id) : null;

        // Tổng chưa đọc — luôn query với điều kiện gốc (userId + readAt IS NULL),
        // ĐỘC LẬP với filter `unread` trong query. FE cần con số này cho bell badge
        // bất kể người dùng có filter unread=true hay không.
        //
        // 1 query thêm vào list, tốn ~1ms với row count < 1M. Có thể tối ưu bằng
        // window function hoặc tăng cache sau nếu cần.
        const [{ count: totalUnread }] = await db
            .select({ count: sql<number>`COUNT(*)::int` })
            .from(notifications)
            .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));

        return { items, nextCursor, totalUnread: totalUnread ?? 0 };
    },

    markRead: async (id: string, userId: string) => {
        const [row] = await db
            .update(notifications)
            .set({ readAt: new Date() })
            .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
            .returning();
        return row ?? null;
    },

    markAllRead: async (userId: string) => {
        const rows = await db
            .update(notifications)
            .set({ readAt: new Date() })
            .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
            .returning();
        return rows;
    },

    getUnreadCount: async (userId: string): Promise<number> => {
        const [result] = await db
            .select({ count: sql<number>`COUNT(*)::int` })
            .from(notifications)
            .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
        return result?.count ?? 0;
    },

    /**
     * Xóa 1 notification của user (Hard delete).
     * Trả về null nếu không tìm thấy hoặc notification không thuộc về userId (404 isolation).
     * Khi xóa thành công, tính lại totalUnread từ DB và emit socket notification:deleted.
     */
    remove: async (id: string, userId: string): Promise<{ id: string; totalUnread: number } | null> => {
        const [deleted] = await db
            .delete(notifications)
            .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
            .returning({ id: notifications.id, readAt: notifications.readAt });

        if (!deleted) {
            return null;
        }

        const totalUnread = await notificationService.getUnreadCount(userId);
        notificationGateway.emitToUser(userId, 'notification:deleted', { id: deleted.id });
        return { id: deleted.id, totalUnread };
    },
};
