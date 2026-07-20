/**
 * Dev reset — drop + recreate DB (CHỈ DÙNG CHO DEV)
 */
import 'dotenv/config';
import { pool } from '../src/config/database';
import { logger } from '../src/config/logger';

const reset = async (): Promise<void> => {
  logger.warn('⚠️  Dropping all tables...');
  await pool.query(`
    DROP SCHEMA public CASCADE;
    CREATE SCHEMA public;
    GRANT ALL ON SCHEMA public TO public;
  `);
  logger.info('✅ DB reset. Run migrate + seed next.');
  await pool.end();
};

reset().catch((err) => {
  logger.fatal({ err }, 'Reset failed');
  process.exit(1);
});