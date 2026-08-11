/**
 * One-shot: tạo admin user + in ra access token + refresh token.
 *
 *   cd backend && npx tsx scripts/make-admin.ts
 *
 * Email + password đọc từ biến môi trường, default: admin.test@jobmatch.vn / Admin@123456
 * Nếu user đã tồn tại → chỉ re-login (không tạo mới).
 */
import 'dotenv/config';
import bcrypt from 'bcrypt';
import { eq } from 'drizzle-orm';
import { db, pool } from '../src/config/database';
import { users } from '../src/db/schema';
import { signAccessToken, signRefreshToken } from '../src/utils/jwt';

const EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin.test@jobmatch.vn';
const PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'Admin@123456';

async function main(): Promise<void> {
  let user = await db.query.users.findFirst({ where: eq(users.email, EMAIL) });

  if (!user) {
    const hash = await bcrypt.hash(PASSWORD, 12);
    const [created] = await db
      .insert(users)
      .values({
        email: EMAIL,
        passwordHash: hash,
        role: 'admin',
        metadata: {},
      })
      .returning();
    user = created;
    console.log(`[create] Admin mới: ${EMAIL} / ${PASSWORD}`);
  } else {
    // promote role nếu lỡ là candidate/employer
    if (user.role !== 'admin') {
      await db.update(users).set({ role: 'admin' }).where(eq(users.id, user.id));
      console.log(`[update] Promoted ${EMAIL} từ role=${user.role} → admin`);
    }
    console.log(`[reuse] Đã có admin: ${EMAIL}`);
  }

  const payload = { userId: user.id, role: user.role as 'admin', email: user.email };
  const accessToken = signAccessToken(payload);
  const refreshToken = signRefreshToken(payload);

  console.log('\n========== Copy block dưới vào Postman ==========');
  console.log(JSON.stringify({ userId: user.id, email: user.email, accessToken, refreshToken }, null, 2));
  console.log('=================================================\n');

  await pool.end();
}

main().catch((e) => {
  console.error('make-admin error:', e);
  process.exit(1);
});
