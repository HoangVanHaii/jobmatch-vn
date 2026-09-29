import 'dotenv/config';
import { db, pool } from '../src/config/database';
import { sql } from 'drizzle-orm';

const check = async (): Promise<void> => {
  const r = await db.execute(sql`SELECT u.email, up.location FROM users u LEFT JOIN user_profiles up ON up.user_id = u.id WHERE u.email = 'candidate@jobmatch.vn'`);
  console.log('Current state candidate@jobmatch.vn:', r.rows);

  await pool.end();
};
check().catch((err) => { console.error(err); process.exit(1); });
