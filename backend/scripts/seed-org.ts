/**
 * Dev-only seed: tạo user + company + company_member mẫu để test e2e.
 *
 * Seed:
 *   - 1 candidate:   e2e-candidate@jobmatch.vn  / Test@1234
 *   - 1 employer:    e2e-employer@jobmatch.vn   / Test@1234
 *   - 1 company:     "Acme Vietnam" (slug: acme-vietnam)
 *   - 1 membership:  employer là owner của company
 *
 * Idempotent — chạy nhiều lần OK, không tạo duplicate.
 *
 * Run: cd backend && npm run db:seed:org
 */
import 'dotenv/config';
import bcrypt from 'bcrypt';
import { pool } from '../src/config/database';

interface SeedUser {
  email: string;
  role: 'candidate' | 'employer';
  fullName: string;
}

const CANDIDATE: SeedUser = {
  email: 'e2e-candidate@jobmatch.vn',
  role: 'candidate',
  fullName: 'Nguyễn Văn Candidate',
};

const EMPLOYER: SeedUser = {
  email: 'e2e-employer@jobmatch.vn',
  role: 'employer',
  fullName: 'Trần Thị Employer',
};

const COMPANY = {
  name: 'Acme Vietnam',
  slug: 'acme-vietnam',
  industry: 'Information Technology',
  sizeRange: '50-100',
};

const PASSWORD = 'Test@1234';

const upsertUser = async (
  u: SeedUser,
  passwordHash: string,
): Promise<string> => {
  const existing = await pool.query<{ id: string }>(
    'SELECT id FROM users WHERE email = $1',
    [u.email],
  );

  if (existing.rowCount && existing.rowCount > 0) {
    await pool.query(
      `UPDATE users
       SET password_hash = $1, role = $2, status = 'active', updated_at = NOW()
       WHERE email = $3`,
      [passwordHash, u.role, u.email],
    );
    // Refresh profile name too.
    await pool.query(
      `INSERT INTO user_profiles (user_id, full_name)
       VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET full_name = EXCLUDED.full_name`,
      [existing.rows[0].id, u.fullName],
    );
    return existing.rows[0].id;
  }

  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, role, status, email_verified_at, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', NOW(), NOW(), NOW())
     RETURNING id`,
    [u.email, passwordHash, u.role],
  );
  const userId = inserted.rows[0].id;
  await pool.query(
    `INSERT INTO user_profiles (user_id, full_name) VALUES ($1, $2)`,
    [userId, u.fullName],
  );
  return userId;
};

const upsertCompany = async (createdBy: string): Promise<string> => {
  const existing = await pool.query<{ id: string }>(
    'SELECT id FROM companies WHERE slug = $1',
    [COMPANY.slug],
  );

  if (existing.rowCount && existing.rowCount > 0) {
    await pool.query(
      `UPDATE companies
       SET name = $1, industry = $2, size_range = $3, status = 'active'
       WHERE slug = $4`,
      [COMPANY.name, COMPANY.industry, COMPANY.sizeRange, COMPANY.slug],
    );
    return existing.rows[0].id;
  }

  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO companies (name, slug, industry, size_range, status, created_by)
     VALUES ($1, $2, $3, $4, 'active', $5)
     RETURNING id`,
    [COMPANY.name, COMPANY.slug, COMPANY.industry, COMPANY.sizeRange, createdBy],
  );
  return inserted.rows[0].id;
};

const ensureMembership = async (
  companyId: string,
  userId: string,
): Promise<void> => {
  await pool.query(
    `INSERT INTO company_members (company_id, user_id, role, status)
     VALUES ($1, $2, 'owner', 'active')
     ON CONFLICT (company_id, user_id)
     DO UPDATE SET role = 'owner', status = 'active'`,
    [companyId, userId],
  );
};

const main = async (): Promise<void> => {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  const candidateId = await upsertUser(CANDIDATE, passwordHash);
  console.log(`[OK] candidate  ${CANDIDATE.email}  →  ${candidateId}`);

  const employerId = await upsertUser(EMPLOYER, passwordHash);
  console.log(`[OK] employer   ${EMPLOYER.email}  →  ${employerId}`);

  const companyId = await upsertCompany(employerId);
  console.log(`[OK] company    ${COMPANY.name} (slug=${COMPANY.slug})  →  ${companyId}`);

  await ensureMembership(companyId, employerId);
  console.log(`[OK] membership employer → owner of company`);

  console.log(`\nAll users password: "${PASSWORD}"`);
  await pool.end();
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
