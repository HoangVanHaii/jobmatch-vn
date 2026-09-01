/**
 * Dev-only: ensure a known test candidate user exists with password "Test@1234".
 * Use this for local e2e testing — NOT for production.
 */
import 'dotenv/config';
import bcrypt from 'bcrypt';
import { pool } from '../src/config/database';

const EMAIL = 'e2e-test@jobmatch.vn';
const PASSWORD = 'Test@1234';

const main = async (): Promise<void> => {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const existing = await pool.query('SELECT id FROM users WHERE email = $1', [EMAIL]);
  if (existing.rowCount && existing.rowCount > 0) {
    // Update password to known value so test is repeatable.
    await pool.query('UPDATE users SET password_hash = $1 WHERE email = $2', [passwordHash, EMAIL]);
    console.log(`[OK] Updated existing user ${EMAIL} → password reset to "${PASSWORD}"`);
    console.log(`     user_id: ${existing.rows[0].id}`);
  } else {
    const inserted = await pool.query(
      `INSERT INTO users (email, password_hash, role, status, created_at, updated_at)
       VALUES ($1, $2, 'candidate', 'active', NOW(), NOW())
       RETURNING id`,
      [EMAIL, passwordHash],
    );
    console.log(`[OK] Created test user ${EMAIL} with password "${PASSWORD}"`);
    console.log(`     user_id: ${inserted.rows[0].id}`);
  }
  await pool.end();
};

main().catch((e) => { console.error(e); process.exit(1); });