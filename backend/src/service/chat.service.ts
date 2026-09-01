import {
  eq, ne, and, isNull, isNotNull, sql, lte,
  desc, lt, count, inArray, or,
  type SQL,
} from 'drizzle-orm';
import { db } from '../config/database';
import { AppError } from '../middleware/errorHandler';
import {
  Conversation, Message, MessagePayload, ReadPayload,
  ListConversationsQuery, ListConversationsResponse,
  ListMessagesQuery, ListMessagesResponse,
  ChatMessageRow, ConversationWithPeer,
} from '../interface/chat';
import { chatMessages, conversations, users, userProfiles as userProfilesTable } from '../db/schema';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// =========================================================================
// Cursor phân trang stable (X, id) — chống skip/duplicate khi nhiều row
// cùng X. Encode base64url để client truyền qua query param.
//
// Quy ước tên: `X` là sort field (lastMessageAt cho conv list, createdAt cho
// message list). Field này được date_trunc('millisecond', ...) vì:
//   - PG lưu timestamptz ở microsecond (6 chữ số).
//   - JS Date chỉ giữ millisecond (3 chữ số).
//   - Cursor encode bằng JS Date.toISOString() → ms precision.
//   - Nếu so sánh/ sort ở µs mà cursor ở ms → có thể skip/duplicate khi
//     nhiều row cùng ms. Dùng date_trunc để đồng bộ precision.
// =========================================================================

const lastMessageAtMs = sql`date_trunc('millisecond', ${conversations.lastMessageAt})`;
const messageCreatedAtMs = sql`date_trunc('millisecond', ${chatMessages.createdAt})`;

interface ConvCursorPayload { lastMessageAt: string; id: string }
interface MessageCursorPayload { createdAt: string; id: string }

const encodeConvCursor = (lastMessageAt: Date, id: string): string =>
  Buffer.from(JSON.stringify({ lastMessageAt: lastMessageAt.toISOString(), id }), 'utf8').toString('base64url');

const decodeConvCursor = (token: string): { lastMessageAt: Date; id: string } => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
  } catch {
    throw new AppError(400, 'INVALID_CURSOR', 'Cursor không hợp lệ');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new AppError(400, 'INVALID_CURSOR', 'Cursor không hợp lệ');
  }
  const { lastMessageAt, id } = parsed as ConvCursorPayload;
  if (typeof lastMessageAt !== 'string' || typeof id !== 'string' || !UUID_RE.test(id)) {
    throw new AppError(400, 'INVALID_CURSOR', 'Cursor không hợp lệ');
  }
  const date = new Date(lastMessageAt);
  if (Number.isNaN(date.getTime())) {
    throw new AppError(400, 'INVALID_CURSOR', 'Cursor không hợp lệ');
  }
  return { lastMessageAt: date, id };
};

const encodeMessageCursor = (createdAt: Date, id: string): string =>
  Buffer.from(JSON.stringify({ createdAt: createdAt.toISOString(), id }), 'utf8').toString('base64url');

const decodeMessageCursor = (token: string): { createdAt: Date; id: string } => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
  } catch {
    throw new AppError(400, 'INVALID_CURSOR', 'Cursor không hợp lệ');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new AppError(400, 'INVALID_CURSOR', 'Cursor không hợp lệ');
  }
  const { createdAt, id } = parsed as MessageCursorPayload;
  if (typeof createdAt !== 'string' || typeof id !== 'string' || !UUID_RE.test(id)) {
    throw new AppError(400, 'INVALID_CURSOR', 'Cursor không hợp lệ');
  }
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) {
    throw new AppError(400, 'INVALID_CURSOR', 'Cursor không hợp lệ');
  }
  return { createdAt: date, id };
};

export const chatService = {
  /**
   * Tạo conversation với peer, hoặc trả về cái đã tồn tại (cùng cặp user + jobId).
   * - Normalize pair (userA = LEAST, userB = GREATEST) để tránh duplicate 2 chiều
   *   (xem memory conversations-unique-constraint-caveat).
   * - Không gate theo role (xem memory chat-free-form).
   */
  createOrGet: async (
    currentUserId: string,
    peerUserId: string,
    jobId?: string | null,
  ): Promise<Conversation> => {
    if (currentUserId === peerUserId) {
      throw new AppError(400, 'INVALID_PEER', 'Cannot create conversation with yourself');
    }

    const [userA, userB] = [currentUserId, peerUserId].sort();

    const existing = await db.query.conversations.findFirst({
      where: and(
        eq(conversations.userA, userA),
        eq(conversations.userB, userB),
        jobId ? eq(conversations.jobId, jobId) : isNull(conversations.jobId),
      ),
    });
    if (existing) return existing;

    const [created] = await db.insert(conversations).values({
      userA,
      userB,
      jobId: jobId ?? null,
    }).returning();

    return created;
  },

  /** Lấy 1 conversation theo id. Throw 404 nếu không tồn tại. */
  getById: async (conversationId: string): Promise<Conversation> => {
    const conv = await db.query.conversations.findFirst({
      where: eq(conversations.id, conversationId),
    });
    if (!conv) {
      throw new AppError(404, 'CONVERSATION_NOT_FOUND', 'Conversation not found');
    }
    return conv;
  },

  // ---------------------------------------------------------------------
  // LIST — GET /conversations
  // ---------------------------------------------------------------------

  /**
   * Danh sách conversation của currentUser, sort lastMessageAt DESC NULLS LAST.
   *
   * Cursor phân trang stable (lastMessageAtMs, id) DESC — dùng date_trunc('millisecond')
   * để khớp precision với JS Date (xem comment helpers).
   *
   * Lưu ý NULL lastMessageAt:
   *   - Page đầu (không có cursor): include cả NULL (sort cuối cùng nhờ NULLS LAST).
   *   - Có cursor: chỉ paginate rows có lastMessageAt không null (cursor so sánh
   *     lastMessageAt với giá trị đã có, NULL bị filter ra).
   */
  list: async (
    currentUserId: string,
    query: ListConversationsQuery,
  ): Promise<ListConversationsResponse> => {
    const limit = Math.min(query.limit ?? 20, 100);

    const conditions: (SQL | undefined)[] = [
      or(
        eq(conversations.userA, currentUserId),
        eq(conversations.userB, currentUserId),
      ),
    ];

    if (query.cursor) {
      const c = decodeConvCursor(query.cursor);
      // Paginated: chỉ rows có lastMessageAt <= cursor (skip NULL)
      conditions.push(
        and(
          isNotNull(conversations.lastMessageAt),
          or(
            lt(lastMessageAtMs, c.lastMessageAt),
            and(eq(lastMessageAtMs, c.lastMessageAt), lt(conversations.id, c.id)),
          ),
        ),
      );
    }

    const rows = await db.select()
      .from(conversations)
      .where(and(...conditions))
      .orderBy(sql`${lastMessageAtMs} DESC NULLS LAST`, desc(conversations.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    // Batch fetch peers (1 query cho cả page)
    const peerIds = Array.from(new Set(
      page.map((c) => (c.userA === currentUserId ? c.userB : c.userA)),
    ));
    const peers = peerIds.length === 0 ? [] : await db.select({
      id: users.id,
      fullName: userProfilesTable.fullName,
      avatarUrl: userProfilesTable.avatarUrl,
      role: users.role,
    })
      .from(users)
      .leftJoin(userProfilesTable, eq(users.id, userProfilesTable.userId))
      .where(inArray(users.id, peerIds));

    const peerMap = new Map(peers.map((p) => [p.id, p]));

    // Per-conv unread count (peer messages chưa đọc)
    const items: ConversationWithPeer[] = await Promise.all(page.map(async (conv) => {
      const peerId = conv.userA === currentUserId ? conv.userB : conv.userA;
      const peer = peerMap.get(peerId) ?? {
        id: peerId,
        fullName: null,
        avatarUrl: null,
        role: 'candidate' as const,
      };

      const [{ count: unreadCount }] = await db
        .select({ count: count() })
        .from(chatMessages)
        .where(and(
          eq(chatMessages.conversationId, conv.id),
          ne(chatMessages.senderId, currentUserId),
          isNull(chatMessages.readAt),
        ));

      return {
        id: conv.id,
        jobId: conv.jobId,
        lastMessageAt: conv.lastMessageAt,
        lastMessagePreview: conv.lastMessagePreview,
        createdAt: conv.createdAt,
        peer,
        unreadCount: Number(unreadCount),
      };
    }));

    const last = page[page.length - 1];
    const nextCursor = hasMore && last?.lastMessageAt
      ? encodeConvCursor(last.lastMessageAt, last.id)
      : null;

    return { items, nextCursor };
  },

  // ---------------------------------------------------------------------
  // LIST MESSAGES — GET /conversations/:id/messages
  // ---------------------------------------------------------------------

  /**
   * Messages trong 1 conversation. Mới nhất trước (client reverse trước khi render).
   * Authz: chỉ member mới được đọc.
   *
   * Cursor phân trang stable (messageCreatedAtMs, id) DESC.
   */
  listMessages: async (
    conversationId: string,
    currentUserId: string,
    query: ListMessagesQuery,
  ): Promise<ListMessagesResponse> => {

    const conv = await db.query.conversations.findFirst({
      where: eq(conversations.id, conversationId),
    });
    if (!conv) {
      throw new AppError(404, 'CONVERSATION_NOT_FOUND', 'Conversation not found');
    }
    if (conv.userA !== currentUserId && conv.userB !== currentUserId) {
      throw new AppError(403, 'NOT_MEMBER', 'Bạn không thuộc cuộc hội thoại này');
    }

    const limit = Math.min(query.limit ?? 50, 200);

    const conditions: (SQL | undefined)[] = [eq(chatMessages.conversationId, conversationId)];
    if (query.cursor) {
      const c = decodeMessageCursor(query.cursor);
      conditions.push(
        or(
          lt(messageCreatedAtMs, c.createdAt),
          and(eq(messageCreatedAtMs, c.createdAt), lt(chatMessages.id, c.id)),
        ),
      );
    }

    const rows = await db.select()
      .from(chatMessages)
      .where(and(...conditions))
      .orderBy(desc(messageCreatedAtMs), desc(chatMessages.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    const items: ChatMessageRow[] = page.map((m) => ({
      id: m.id,
      conversationId: m.conversationId,
      senderId: m.senderId,
      content: m.content,
      readAt: m.readAt?.toISOString() ?? null,
      createdAt: m.createdAt.toISOString(),
      metadata: m.metadata ?? null,
    }));

    const last = page[page.length - 1];
    const nextCursor = hasMore && last
      ? encodeMessageCursor(last.createdAt, last.id)
      : null;

    return { items, nextCursor, hasMore };
  },

  // ---------------------------------------------------------------------
  // SEND MESSAGE — socket + REST POST /conversations/:id/messages
  // ---------------------------------------------------------------------

  /**
   * Insert message + update conversation.lastMessageAt, all 1 transaction.
   * Caller phải authz check member trước khi gọi.
   */
  saveMessage: async (data: MessagePayload, senderId: string): Promise<Message> => {
    const message = await db.transaction(async (tx) => {
      const [m] = await tx.insert(chatMessages).values({
        conversationId: data.conversationId,
        senderId: senderId,
        content: data.content,
      }).returning();
      await tx.update(conversations)
        .set({
          lastMessageAt: m.createdAt,
          lastMessagePreview: m.content.slice(0, 200),
        })
        .where(eq(conversations.id, data.conversationId));
      return m;
    });
    return message;
  },

  // ---------------------------------------------------------------------
  // MARK READ — socket + REST POST /conversations/:id/read
  // ---------------------------------------------------------------------

  /** Set readAt cho message của peer trong conversation. Authz do caller check. */
  markAtRead: async (data: ReadPayload, senderId: string): Promise<Date> => {
    const readAt = new Date();
    await db.transaction(async (tx) => {
      /**
       * So sánh theo createdAt thay vì `lte(chatMessages.id, ...)`. Lý do:
       *   - chatMessages.id là UUID v4 — lexicographic sort KHÔNG tương ứng
       *     thứ tự thời gian (UUID v4 random), nên `id <= X` cho kết quả sai.
       *   - lastReadMessageId là id của 1 message cụ thể — ta look up
       *     createdAt của nó, rồi update tất cả message của PEER có
       *     createdAt <= mốc đó + readAt IS NULL.
       * Fallback khi lastReadMessageId không tồn tại trong DB (rare) → mark tất
       * cả peer messages unread là read (giả định user đã đọc hết).
       */
      let createdAtCmp: SQL | undefined;
      if (data.lastReadMessageId) {
        const target = await tx
          .select({ createdAt: chatMessages.createdAt })
          .from(chatMessages)
          .where(eq(chatMessages.id, data.lastReadMessageId))
          .limit(1);
        if (target.length > 0) {
          createdAtCmp = lte(chatMessages.createdAt, target[0].createdAt);
        } else {
          createdAtCmp = sql`true`;
        }
      } else {
        createdAtCmp = sql`true`;
      }

      const where = and(
        eq(chatMessages.conversationId, data.conversationId),
        ne(chatMessages.senderId, senderId),
        isNull(chatMessages.readAt),
        createdAtCmp,
      );
      await tx.update(chatMessages)
        .set({ readAt })
        .where(where);
    });
    return readAt;
  },
} as const;