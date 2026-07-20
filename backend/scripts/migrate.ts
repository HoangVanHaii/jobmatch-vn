/**
 * Migration runner — apply SQL files in src/db/migrations
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { pool } from '../src/config/database';
import { logger } from '../src/config/logger';

const MIGRATIONS_DIR = path.join(__dirname, '../src/db/migrations');

const migrate = async (): Promise<void> => {
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    logger.info({ file }, 'Applying migration...');
    await pool.query(sql);
  }
  logger.info(`✅ Applied ${files.length} migration(s)`);
  await pool.end();
};

migrate().catch((err) => {
  logger.fatal({ err }, 'Migration failed');
  process.exit(1);
});