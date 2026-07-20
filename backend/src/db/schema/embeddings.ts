import { pgTable, uuid, text, timestamp, customType, unique, index } from 'drizzle-orm/pg-core';

// pgvector type
const vector = customType<{ data: number[]; driverData: string }>({
  dataType() { return 'vector(1536)'; },
  toDriver(value: number[]) { return `[${value.join(',')}]`; },
  fromDriver(value: string) {
    return value.slice(1, -1).split(',').map(Number);
  },
});

export const embeddings = pgTable('embeddings', {
  id: uuid('id').primaryKey().defaultRandom(),
  contentType: text('content_type').notNull(),
  contentId: uuid('content_id').notNull(),
  vector: vector('vector').notNull(),
  model: text('model').notNull(),
  textHash: text('text_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  uniqContent: unique('uniq_embedding_content').on(t.contentType, t.contentId, t.model),
  contentIdx: index('idx_embeddings_content').on(t.contentType, t.contentId),
}));