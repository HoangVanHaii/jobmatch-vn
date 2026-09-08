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
  ListAttachmentsQuery, ListAttachmentsResponse,
  ChatMessageRow, ConversationWithPeer,
  ClientAttachmentMeta, AttachmentWithContext,
} from '../interface/chat';
import { chatMessages, chatAttachments, conversations, conversationDeletions, users, userProfiles as userProfilesTable } from '../db/schema';

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
   * Tạo conversation với peer, hoặc trả về cái đã tồn tại (cùng cặp user).
   * - Normalize pair (userA = LEAST, userB = GREATEST) để tránh duplicate 2 chiều
   *   (xem memory conversations-unique-constraint-caveat).
   * - Không gate theo role (xem memory chat-free-form).
   * - Migration 0034: bỏ jobId — 2 user chỉ có 1 conversation duy nhất bất kể job.
   */
  createOrGet: async (
    currentUserId: string,
    peerUserId: string,
  ): Promise<Conversation> => {
    if (currentUserId === peerUserId) {
      throw new AppError(400, 'INVALID_PEER', 'Cannot create conversation with yourself');
    }

    const [userA, userB] = [currentUserId, peerUserId].sort();

    const existing = await db.query.conversations.findFirst({
      where: and(
        eq(conversations.userA, userA),
        eq(conversations.userB, userB),
      ),
    });
    if (existing) return existing;

    const [created] = await db.insert(conversations).values({
      userA,
      userB,
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

  /**
   * Authz check + resolve cho cả REST controller (mini composer) lẫn
   * socket handler (realtime emit). Trả về `conv` để caller dùng cho
   * broadcast (`userA`/`userB` để tính peerId, tránh query lại).
   *
   * Throw:
   *   - 404 CONVERSATION_NOT_FOUND nếu conv không tồn tại.
   *   - 403 NOT_MEMBER nếu currentUser không phải userA hoặc userB.
   */
  assertMemberAndGetConv: async (
    conversationId: string,
    currentUserId: string,
  ): Promise<{ conv: Conversation }> => {
    const conv = await db.query.conversations.findFirst({
      where: eq(conversations.id, conversationId),
    });
    if (!conv) {
      throw new AppError(404, 'CONVERSATION_NOT_FOUND', 'Conversation not found');
    }
    if (conv.userA !== currentUserId && conv.userB !== currentUserId) {
      throw new AppError(403, 'NOT_MEMBER', 'Bạn không thuộc cuộc hội thoại này');
    }
    // Per-user soft delete gate — nếu user đã xoá conv này → 404 để socket
    // send / REST POST cũng bị chặn (defense in depth; UI đã ẩn khỏi list).
    // Peer không bị ảnh hưởng.
    const deletion = await db.query.conversationDeletions.findFirst({
      where: and(
        eq(conversationDeletions.conversationId, conversationId),
        eq(conversationDeletions.userId, currentUserId),
      ),
    });
    if (deletion) {
      throw new AppError(404, 'CONVERSATION_NOT_FOUND', 'Conversation not found');
    }
    return { conv };
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
      // Per-user soft delete: LEFT JOIN conversation_deletions + filter.
      // `deleted_at IS NULL` (NULL từ LEFT JOIN = user chưa xoá conv này).
      isNull(conversationDeletions.deletedAt),
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
      .leftJoin(
        conversationDeletions,
        and(
          eq(conversationDeletions.conversationId, conversations.id),
          eq(conversationDeletions.userId, currentUserId),
        ),
      )
      .where(and(...conditions))
      .orderBy(sql`${lastMessageAtMs} DESC NULLS LAST`, desc(conversations.id))
      .limit(limit + 1);

    // Sau LEFT JOIN, mỗi row là `{ conversations, conversation_deletions }`.
    // Flat lại thành Conversation[] để code dưới đây giữ nguyên logic.
    const flatRows = rows.map((r) => r.conversations);
    const hasMore = flatRows.length > limit;
    const page = hasMore ? flatRows.slice(0, limit) : flatRows;

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
   * Authz: chỉ member mới được đọc. Đã xoá khỏi sidebar của current user → 404.
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
    // Per-user soft delete: nếu user đã xoá conv này khỏi sidebar của họ → 404.
    // Peer không bị ảnh hưởng — họ vẫn list được messages bình thường.
    const deletion = await db.query.conversationDeletions.findFirst({
      where: and(
        eq(conversationDeletions.conversationId, conversationId),
        eq(conversationDeletions.userId, currentUserId),
      ),
    });
    if (deletion) {
      throw new AppError(404, 'CONVERSATION_NOT_FOUND', 'Conversation not found');
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

    // Batch fetch attachments cho cả page (1 query → Map). Gắn vào row.
    const attachmentsByMessage = await chatService.fetchAttachmentsByMessages(
      page.map((m) => m.id),
    );
    for (const row of items) {
      const att = attachmentsByMessage.get(row.id);
      if (att) row.attachments = att;
    }

    const last = page[page.length - 1];
    const nextCursor = hasMore && last
      ? encodeMessageCursor(last.createdAt, last.id)
      : null;

    return { items, nextCursor, hasMore };
  },

  // ---------------------------------------------------------------------
  // LIST ATTACHMENTS — GET /conversations/:id/attachments
  // ---------------------------------------------------------------------

  /**
   * Tất cả ảnh + file đã chia sẻ trong 1 conversation. Filter optional theo
   * `kind` (image | file) — không truyền = trả cả 2.
   *
   * Authz: giống listMessages — member mới đọc được, soft-delete gate 404.
   *
   * Không paginate: load all 1 lần. Một conversation thường có vài chục
   * attachments (ảnh + file trong vài tháng chat), đủ nhỏ để 1 query.
   *
   * Sort DESC theo (chatMessages.createdAt, chatAttachments.id) — mới nhất
   * trước, attachments cùng message thì order theo insertion id.
   *
   * JOIN attachments ↔ messages (1 query, không N+1). Select các field cần
   * thiết, **không select `key`** để strip ra khỏi response (giống
   * `fetchAttachmentsByMessages`).
   */
  listAttachments: async (
    conversationId: string,
    currentUserId: string,
    query: ListAttachmentsQuery,
  ): Promise<ListAttachmentsResponse> => {
    const conv = await db.query.conversations.findFirst({
      where: eq(conversations.id, conversationId),
    });
    if (!conv) {
      throw new AppError(404, 'CONVERSATION_NOT_FOUND', 'Conversation not found');
    }
    if (conv.userA !== currentUserId && conv.userB !== currentUserId) {
      throw new AppError(403, 'NOT_MEMBER', 'Bạn không thuộc cuộc hội thoại này');
    }
    // Per-user soft delete gate — user đã xoá conv khỏi sidebar của họ → 404.
    const deletion = await db.query.conversationDeletions.findFirst({
      where: and(
        eq(conversationDeletions.conversationId, conversationId),
        eq(conversationDeletions.userId, currentUserId),
      ),
    });
    if (deletion) {
      throw new AppError(404, 'CONVERSATION_NOT_FOUND', 'Conversation not found');
    }

    const rows = await db
      .select({
        messageId: chatAttachments.messageId,
        url: chatAttachments.url,
        mime: chatAttachments.mime,
        sizeBytes: chatAttachments.sizeBytes,
        name: chatAttachments.name,
        width: chatAttachments.width,
        height: chatAttachments.height,
        kind: chatAttachments.kind,
        senderId: chatMessages.senderId,
        createdAt: chatMessages.createdAt,
      })
      .from(chatAttachments)
      .innerJoin(chatMessages, eq(chatMessages.id, chatAttachments.messageId))
      .where(and(
        eq(chatMessages.conversationId, conversationId),
        query.kind ? eq(chatAttachments.kind, query.kind) : undefined,
      ))
      .orderBy(desc(chatMessages.createdAt), desc(chatAttachments.id));

    const items: AttachmentWithContext[] = rows.map((r) => ({
      messageId: r.messageId,
      url: r.url,
      mime: r.mime,
      sizeBytes: r.sizeBytes,
      name: r.name,
      width: r.width,
      height: r.height,
      kind: (r.kind as 'image' | 'file') ?? 'image',
      senderId: r.senderId,
      createdAt: r.createdAt.toISOString(),
    }));

    return { items };
  },

  // ---------------------------------------------------------------------
  // SEND MESSAGE — socket + REST POST /conversations/:id/messages
  // ---------------------------------------------------------------------

  /**
   * Insert message + update conversation.lastMessageAt, all 1 transaction.
   * Caller phải authz check member trước khi gọi.
   *
   * Nếu `data.attachments` có → insert rows vào `chat_attachments` cùng
   * transaction (rollback nếu attachment lỗi). Validation ở đây là
   * defense-in-depth — middleware upload đã whitelist MIME + size, nhưng
   * service vẫn check mime prefix `image/` cho phase 1 (chỉ image).
   *
   * Return `{ message, attachments }`:
   *   - `message`: chat_messages row vừa insert (kèm id, createdAt).
   *   - `attachments`: danh sách meta đã lưu, **đã strip `key`** (chỉ giữ
   *     shape `ClientAttachmentMeta` để broadcast ra client).
   * Caller (controller + socket handler) dùng cả 2 để broadcast.
   */
  saveMessage: async (
    data: MessagePayload,
    senderId: string,
  ): Promise<{ message: Message; attachments: ClientAttachmentMeta[] }> => {
    const result = await db.transaction(async (tx) => {
      const [m] = await tx.insert(chatMessages).values({
        conversationId: data.conversationId,
        senderId: senderId,
        content: data.content,
      }).returning();

      const savedAttachments: ClientAttachmentMeta[] = [];
      if (data.attachments && data.attachments.length > 0) {
        // Validate shape — middleware upload đã whitelist MIME + size theo
        // folder, nhưng service vẫn check để defense-in-depth (tránh bypass
        // bằng cách gọi trực tiếp socket message không qua HTTP).
        for (const a of data.attachments) {
          if (!a.mime) {
            throw new AppError(400, 'INVALID_ATTACHMENT', 'Attachment thiếu mime');
          }
          if (!a.url || !a.key || typeof a.sizeBytes !== 'number' || a.sizeBytes <= 0) {
            throw new AppError(400, 'INVALID_ATTACHMENT', 'Attachment thiếu url/key/sizeBytes');
          }
        }
        await tx.insert(chatAttachments).values(
          data.attachments.map((a) => ({
            messageId: m.id,
            url: a.url,
            key: a.key,
            mime: a.mime,
            sizeBytes: a.sizeBytes,
            name: a.name ?? null,
            width: a.width ?? null,
            height: a.height ?? null,
            kind: (a.kind ?? 'image') as 'image' | 'file',
          })),
        );
        // Echo lại meta (strip `key`) cho caller broadcast.
        for (const a of data.attachments) {
          savedAttachments.push({
            url: a.url,
            mime: a.mime,
            sizeBytes: a.sizeBytes,
            name: a.name ?? null,
            width: a.width ?? null,
            height: a.height ?? null,
            kind: a.kind ?? 'image',
          });
        }
      }

      await tx.update(conversations)
        .set({
          lastMessageAt: m.createdAt,
          lastMessagePreview: m.content.slice(0, 200),
        })
        .where(eq(conversations.id, data.conversationId));
      return { message: m, attachments: savedAttachments };
    });
    return result;
  },

  /**
   * Lấy attachments cho 1 tập message ids (1 query batch thay vì N+1).
   * Service `listMessages` gọi hàm này sau khi fetch messages để gắn kèm.
   *
   * Trả về `Map<messageId, ClientAttachmentMeta[]>` — `key` (S3 path) đã
   * được strip ra, chỉ giữ field public để trả về client.
   * Nếu tập rỗng → trả về Map rỗng.
   */
  fetchAttachmentsByMessages: async (
    messageIds: string[],
  ): Promise<Map<string, ClientAttachmentMeta[]>> => {
    if (messageIds.length === 0) return new Map();
    const rows = await db
      .select({
        messageId: chatAttachments.messageId,
        url: chatAttachments.url,
        mime: chatAttachments.mime,
        sizeBytes: chatAttachments.sizeBytes,
        name: chatAttachments.name,
        width: chatAttachments.width,
        height: chatAttachments.height,
        kind: chatAttachments.kind,
      })
      .from(chatAttachments)
      .where(inArray(chatAttachments.messageId, messageIds));

    const map = new Map<string, ClientAttachmentMeta[]>();
    for (const r of rows) {
      const entry: ClientAttachmentMeta = {
        url: r.url,
        mime: r.mime,
        sizeBytes: r.sizeBytes,
        name: r.name,
        width: r.width,
        height: r.height,
        kind: (r.kind as 'image' | 'file') ?? 'image',
      };
      const arr = map.get(r.messageId);
      if (arr) arr.push(entry);
      else map.set(r.messageId, [entry]);
    }
    return map;
  },

  // ---------------------------------------------------------------------
  // MARK READ — socket + REST POST /conversations/:id/read
  // ---------------------------------------------------------------------
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

  // ---------------------------------------------------------------------
  // SOFT DELETE CONVERSATION — DELETE /conversations/:id
  // ---------------------------------------------------------------------

  /**
   * Per-user soft delete — user "xoá khỏi sidebar của mình" mà không ảnh
   * hưởng tới peer. INSERT idempotent vào `conversation_deletions`.
   *
   * Side effect:
   *  - `list()` filter row này ra (LEFT JOIN + IS NULL) → sidebar biến mất.
   *  - `listMessages()` + `assertMemberAndGetConv()` throw 404 → user không
   *    mở lại được qua URL hoặc gửi tin nhắn mới qua socket.
   *  - Peer KHÔNG bị ảnh hưởng — list() của họ filter theo `user_id` riêng.
   *
   * Lưu ý: KHÔNG xoá chat_messages / chat_attachments. Peer giữ data của họ,
   * conversation vẫn tồn tại cho các lần re-create sau này (createOrGet sẽ
   * trả lại conv cũ, và user sẽ thấy lại lịch sử — chỉ cần xoá row
   * `conversation_deletions` để "un-delete", hiện chưa có UI cho flow này).
   *
   * Authz: caller phải check `userA || userB === currentUserId` trước khi gọi.
   */
  softDeleteConversation: async (
    currentUserId: string,
    conversationId: string,
  ): Promise<void> => {
    // Idempotent UPSERT — gọi nhiều lần vẫn chỉ giữ 1 row.
    // ON CONFLICT DO NOTHING vì PK đã có (user_id, conversation_id).
    await db
      .insert(conversationDeletions)
      .values({
        userId: currentUserId,
        conversationId,
      })
      .onConflictDoNothing();
  },
} as const;