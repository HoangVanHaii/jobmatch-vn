import { db } from '../config/database';
import { notifications } from '../db/schema/notifications';
import { eq, and, lt, desc, isNull, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { notificationGateway } from "../socket/notificationGateway";
import { AppError } from '../middleware/errorHandler';
import type { CreateNotificationInput, ListNotificationsQuery, Notification } from '../interface/notification';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * created_at ở precision millisecond.
 * PG lưu timestamptz với microsecond (6 chữ số), nhưng JS Date — dùng để encode cursor —
 * chỉ giữ millisecond (3 chữ số, TimeClip truncate). Phải so sánh + orderBy CŨNG ở precision
 * ms để cursor stable: tránh skip row khi 2 notification cùng createdAt-ms nhưng khác µs
 * (vd X=...123456, Y=...123100 → cả hai đều .123 ở cursor; so raw thì Y bị skip).
 */
const createdAtMs = sql`date_trunc('millisecond', ${notifications.createdAt})`;

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
        throw new AppError(400, 'INVALID_CURSOR', 'Cursor không hợp lệ');
    }
    if (typeof parsed !== 'object' || parsed === null) {
        throw new AppError(400, 'INVALID_CURSOR', 'Cursor không hợp lệ');
    }
    const { createdAt, id } = parsed as { createdAt?: unknown; id?: unknown };
    if (typeof createdAt !== 'string' || typeof id !== 'string') {
        throw new AppError(400, 'INVALID_CURSOR', 'Cursor không hợp lệ');
    }
    if (!UUID_RE.test(id)) {
        throw new AppError(400, 'INVALID_CURSOR', 'Cursor không hợp lệ');
    }
    const date = new Date(createdAt);
    if (Number.isNaN(date.getTime())) {
        throw new AppError(400, 'INVALID_CURSOR', 'Cursor không hợp lệ');
    }
    return { createdAt: date, id };
};

export const notificationService = {
    /** Insert + emit — strict (throw nếu fail). Cho admin POST (/notifications). */
    create: async (input: CreateNotificationInput) => {
        const [row] = await db
            .insert(notifications)
            .values({
                userId: input.userId,
                type: input.type,
                title: input.title,
                payload: input.payload,
            })
            .returning();
        notificationGateway.emitToUser(input.userId, "notification:new", row);
        return row;
    },
    createInTx: async (
        tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
        input: CreateNotificationInput
    ): Promise<Notification> => {
        const [row] = await tx
            .insert(notifications)
            .values({
                userId: input.userId,
                type: input.type,
                title: input.title,
                payload: input.payload,
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
        const { unread, cursor, limit } = query;

        const conditions: (SQL | undefined)[] = [eq(notifications.userId, userId)];
        if (unread) {
            conditions.push(isNull(notifications.readAt));
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

        return { items, nextCursor };
    },

    markRead: async (id: string, userId: string) => {
        const [row] = await db
            .update(notifications)
            .set({ readAt: new Date() })
            .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
            .returning();
        return row ?? null;
    },
};
