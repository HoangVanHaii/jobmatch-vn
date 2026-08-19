/**
 * Apply migration 0009 inline (Docker mount chỉ chạy lần init đầu).
 * Chạy: npx tsx scripts/apply-migration-0009.ts
 */
import 'dotenv/config';
import { Client } from 'pg';
import { logger } from '../src/config/logger';

const client = new Client({
  connectionString: process.env.DATABASE_URL,
});

const apply = async (): Promise<void> => {
  await client.connect();
  logger.info('Applying migration 0009 → vector(3072)');

  // 1. Drop cũ + revert về 768 (override outputDimensionality phía app)
  await client.query(`
    DROP INDEX IF EXISTS idx_embeddings_hnsw;
    ALTER TABLE embeddings ALTER COLUMN vector TYPE vector(768);
    CREATE INDEX IF NOT EXISTS idx_embeddings_hnsw
      ON embeddings USING HNSW (vector vector_cosine_ops);
  `);

  logger.info('✅ Done. Verify:');
  const { rows } = await client.query(`
    SELECT column_name, data_type, udt_name
    FROM information_schema.columns
    WHERE table_name = 'embeddings' AND column_name = 'vector';
  `);
  console.table(rows);

  await client.end();
};

apply().catch((err) => {
  logger.fatal({ err }, 'Migration failed');
  process.exit(1);
});