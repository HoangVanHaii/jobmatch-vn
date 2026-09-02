import 'dotenv/config';
import { pool } from '../src/config/database';

const main = async (): Promise<void> => {
  const r = await pool.query("SELECT id, email, role FROM users WHERE role='candidate' LIMIT 5");
  console.log('USERS:', JSON.stringify(r.rows, null, 2));
  const cv = await pool.query("SELECT id, candidate_id, title, source, status, template_id FROM cvs WHERE source='direct' LIMIT 5");
  console.log('CVS:', JSON.stringify(cv.rows, null, 2));
  await pool.end();
};

main().catch((e) => { console.error(e); process.exit(1); });