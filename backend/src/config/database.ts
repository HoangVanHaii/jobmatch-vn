/**
 * Postgres connection — pg.Pool + Drizzle ORM
 */
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { env } from './env';
import { logger } from './logger';
import * as schema from '../db/schema';

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  min: 2,
  max: 10,
  connectionTimeoutMillis: 10000, // 10 giây

  idleTimeoutMillis: 30000, // 30 giây

  maxLifetimeSeconds: 300, // 5 phút
});

pool.on('error', (err) => {
  logger.error({ err }, 'Unexpected error on idle Postgres client');
});

export const db = drizzle(pool, { schema });

export const connectDatabase = async (): Promise<void> => {
  try {
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
    logger.info('Database connected');
  } catch (err) {
    logger.fatal({ err }, 'Database connection failed');
    process.exit(1);
  }
};

export const disconnectDatabase = async (): Promise<void> => {
  await pool.end();
  logger.info('Database disconnected');
};