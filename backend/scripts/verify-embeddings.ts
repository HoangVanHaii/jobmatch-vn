/**
 * Verify embeddings table + HNSW index, xóa rows lỗi nếu có.
 * Chạy: npx tsx scripts/verify-embeddings.ts
 */
import 'dotenv/config';
import { Client } from 'pg';

const client = new Client({ connectionString: process.env.DATABASE_URL });

const verify = async (): Promise<void> => {
  await client.connect();

  // 1. Column type
  const col = await client.query(`
    SELECT format_type(atttypid, atttypmod) AS type
    FROM pg_attribute
    WHERE attrelid = 'embeddings'::regclass AND attname = 'vector';
  `);
  console.log('📐 Column type:', col.rows[0]?.type);

  // 2. HNSW index
  const idx = await client.query(`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE tablename = 'embeddings' AND indexname = 'idx_embeddings_hnsw';
  `);
  console.log('🔍 HNSW index:', idx.rows[0] ? '✅ exists' : '❌ MISSING');
  if (idx.rows[0]) console.log('   ', idx.rows[0].indexdef);

  // 3. Row count + bad rows
  const cnt = await client.query(`SELECT COUNT(*)::int AS n FROM embeddings;`);
  console.log('📊 Rows:', cnt.rows[0].n);

  if (cnt.rows[0].n > 0) {
    const bad = await client.query(`
      SELECT COUNT(*)::int AS n FROM embeddings
      WHERE vector IS NULL OR array_length(string_to_array(regexp_replace(vector::text, '[\\[\\]]', '', 'g'), ','), 1) != 768;
    `);
    console.log('⚠️  Bad rows (wrong dim):', bad.rows[0].n);

    const del = await client.query(`DELETE FROM embeddings WHERE content_type = 'job';`);
    console.log('🗑  Deleted job embeddings:', del.rowCount);
  }

  await client.end();
};

verify().catch((err) => { console.error(err); process.exit(1); });