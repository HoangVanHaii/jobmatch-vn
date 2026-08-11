/**
 * Migration runner — apply new SQL files in src/db/migrations
 *
 * Tracks applied migrations in `schema_migrations` table so each file
 * only runs once. New SQL files are picked up automatically on next run.
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { pool } from '../src/config/database';
import { logger } from '../src/config/logger';

const MIGRATIONS_DIR = path.join(__dirname, '../src/db/migrations');

const ensureTrackingTable = async (): Promise<void> => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
};

const getApplied = async (): Promise<Set<string>> => {
  const { rows } = await pool.query<{ filename: string }>(
    'SELECT filename FROM schema_migrations',
  );
  return new Set(rows.map((r) => r.filename));
};

const markApplied = async (filename: string): Promise<void> => {
  await pool.query(
    'INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING',
    [filename],
  );
};

const migrate = async (): Promise<void> => {
  await ensureTrackingTable();
  const applied = await getApplied();

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const pending = files.filter((f) => !applied.has(f));

  if (pending.length === 0) {
    logger.info('✅ No new migrations to apply.');
    await pool.end();
    return;
  }

  for (const file of pending) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    const client = await pool.connect();
    try {
      logger.info({ file }, 'Applying migration...');
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations (filename) VALUES ($1)',
        [file],
      );
      await client.query('COMMIT');
      logger.info({ file }, '✅ Applied');
    } catch (err) {
      await client.query('ROLLBACK');
      logger.fatal({ err, file }, '❌ Migration failed, rolled back');
      throw err;
    } finally {
      client.release();
    }
  }

  logger.info(`✅ Applied ${pending.length} new migration(s).`);
  await pool.end();
};

migrate().catch((err) => {
  logger.fatal({ err }, 'Migration failed');
  process.exit(1);
});
