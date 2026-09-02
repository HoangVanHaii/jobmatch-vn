import bcrypt from 'bcrypt';
import { db } from '../config/database';
import { users, userProfiles } from '../db/schema';
import { and, eq, isNull, desc, ne, ilike } from 'drizzle-orm';
import { AppError } from '../middleware/errorHandler';
import { Profile, User } from '@/interface/user';

/**
 * Kết quả search user — chỉ chứa field cần cho chat UI: id, fullName, avatarUrl, role.
 * Không leak email/status/metadata.
 */
export interface UserSearchResult {
  id: string;
  fullName: string | null;
  avatarUrl: string | null;
  role: 'candidate' | 'employer' | 'admin';
}

export const authService = {
    /**
     * Tạo user mới + user_profile trong CÙNG transaction.
     *
     * Vì sao phải transaction:
     *   - Ghi vào 2 bảng (users + user_profiles). Nếu insert user xong rồi insert
     *     userProfile fail (vd: DB mất kết nối, FK violation) → user tồn tại
     *     nhưng profile rỗng → user phải nhập lại fullName ở onboarding.
     *   - Transaction đảm bảo cả 2 row cùng commit hoặc cùng rollback.
     *
     * Lưu ý:
     *   - Email-uniqueness đã được controller check trước khi gọi (throw 409 nếu
     *     trùng). Vẫn có race condition giữa 2 request đồng thời cùng email —
     *     nhưng unique constraint ở DB sẽ văng lỗi 23505 và transaction rollback
     *     sạch, không để lại row mồ côi.
     */
    requestOtp: async (
        email: string,
        password: string,
        fullName: string,
        role: 'candidate' | 'employer',
    ): Promise<void> => {
        const passwordHash = await bcrypt.hash(password, 12);
        await db.transaction(async (tx) => {
            const [created] = await tx
                .insert(users)
                .values({ email, passwordHash, role, metadata: {} })
                .returning({ id: users.id });
            if (!created) {
                throw new AppError(500, 'USER_INSERT_FAILED', 'Failed to create user');
            }
            await tx.insert(userProfiles).values({ userId: created.id, fullName });
        });
    },
    verifyEmail: async (email: string): Promise<void> => {
        await db.update(users).set({ emailVerifiedAt: new Date(), status: 'active' }).where(eq(users.email, email));
    },
    verifyPassword: async (email: string, password: string): Promise<any> => {
        const user = await db.query.users.findFirst({ where: eq(users.email, email) });
        if (!user || !user.passwordHash) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
        if (user.status !== 'active') {
            if (user.status === 'pending') throw new AppError(403, 'EMAIL_NOT_VERIFIED', 'Email not verified');
            throw new AppError(403, 'ACCOUNT_INACTIVE', 'Account is not active');
        }
        if (user.deletedAt) throw new AppError(403, 'ACCOUNT_DELETED', 'Account has been deleted');
        const isMatch = await bcrypt.compare(password, user.passwordHash);
        if (!isMatch) throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');

        await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
        return user;
    },
    resetPassword: async (email: string, newPassword: string): Promise<void> => {
        const passwordHash = await bcrypt.hash(newPassword, 12);
        await db.update(users).set({ passwordHash }).where(eq(users.email, email));
    },
    /**
     * Đổi mật khẩu cho user đang đăng nhập (route POST /auth/change-password).
     *
     * Flow:
     *   1. Lookup user theo userId — lấy passwordHash hiện tại.
     *   2. Verify `currentPassword` khớp passwordHash qua bcrypt — chống token
     *      bị đánh cắp tự ý đổi mật khẩu mà không biết mật khẩu cũ.
     *   3. Reject nếu newPassword trùng currentPassword — tránh "đổi" nhưng
     *      không thay đổi (UX nhầm lẫn).
     *   4. Hash newPassword (bcrypt cost 12 — đồng bộ với các flow khác) + update.
     *
     * Errors:
     *   - 404 USER_NOT_FOUND: userId không tồn tại (token lỗi thời / user bị xoá).
     *   - 401 INVALID_PASSWORD: currentPassword không khớp.
     *   - 400 SAME_PASSWORD: newPassword === currentPassword.
     */
    changePassword: async (
        userId: string,
        currentPassword: string,
        newPassword: string,
    ): Promise<void> => {
        const user = await db.query.users.findFirst({
            where: eq(users.id, userId),
            columns: { passwordHash: true },
        });
        if (!user || !user.passwordHash) {
            throw new AppError(404, 'USER_NOT_FOUND', 'Không tìm thấy tài khoản');
        }

        const isMatch = await bcrypt.compare(currentPassword, user.passwordHash);
        if (!isMatch) {
            throw new AppError(401, 'INVALID_PASSWORD', 'Mật khẩu hiện tại không đúng');
        }

        if (currentPassword === newPassword) {
            throw new AppError(400, 'SAME_PASSWORD', 'Mật khẩu mới phải khác mật khẩu hiện tại');
        }

        const passwordHash = await bcrypt.hash(newPassword, 12);
        await db.update(users).set({ passwordHash }).where(eq(users.id, userId));
    },
    changeAvatar: async (userId: string, avatarUrl: string): Promise<void> => {
        const userProfile = await db.query.userProfiles.findFirst({ where: eq(userProfiles.userId, userId) });
        if (!userProfile) {
            await db.insert(userProfiles).values({ userId, avatarUrl });
        } else {
            await db.update(userProfiles).set({ avatarUrl }).where(eq(userProfiles.userId, userId));
        }
    },
    upsertProfile: async (userId: string, profileData: any): Promise<void> => {
        const userProfile = await db.query.userProfiles.findFirst({ where: eq(userProfiles.userId, userId) });
        if (!userProfile) {
            await db.insert(userProfiles).values({ userId, ...profileData });
        } else {
            await db.update(userProfiles).set(profileData).where(eq(userProfiles.userId, userId));
        }
    },
    getProfile: async (userId: string): Promise<Profile | null> => {
        const email = await db.query.users.findFirst({ where: eq(users.id, userId), columns: { email: true } });
        if (!email) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
        const profile = await db.query.userProfiles.findFirst({ where: eq(userProfiles.userId, userId) });
        return { email: email?.email, ...profile } as Profile | null;
    },
    getUserById: async (userId: string): Promise<User | null> => {
        const user = await db.query.users.findFirst({
            where: eq(users.id, userId),
            columns: {
                id: true,
                email: true,
                role: true,
                status: true,
                createdAt: true,
                updatedAt: true,
                deletedAt: true,
                metadata: true,
                passwordHash: false,
            },
        });

        if (!user) return null;

        const profile = await db.query.userProfiles.findFirst({
            where: eq(userProfiles.userId, userId),
            columns: {
                avatarUrl: true,
            },
        });

        return {
            ...user,
            avatarUrl: profile?.avatarUrl,
        } as User | null;
    },
    getUserByEmail: async (email: string): Promise<User | null> => {
        const user = await db.query.users.findFirst({
            where: eq(users.email, email),
            columns: {
                id: true,
                email: true,
                role: true,
                status: true,
                createdAt: true,
                updatedAt: true,
                deletedAt: true,
                metadata: true,
                passwordHash: false,
            },
        });

        if (!user) return null;

        const profile = await db.query.userProfiles.findFirst({
            where: eq(userProfiles.userId, user.id),
            columns: {
                avatarUrl: true,
            },
        });

        return {
            ...user,
            avatarUrl: profile?.avatarUrl,
        } as User | null;
    },
    softDeleteAccount: async (userId: string): Promise<void> => {
        await db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, userId));
    },
    listUsers: async (offset: number, limit: number): Promise<User[]> => {
        const rows = await db
            .select({
                id: users.id,
                email: users.email,
                role: users.role,
                status: users.status,
                avatarUrl: userProfiles.avatarUrl,
                createdAt: users.createdAt,
                updatedAt: users.updatedAt,
                deletedAt: users.deletedAt,
                metadata: users.metadata,
            })
            .from(users)
            .leftJoin(userProfiles, eq(users.id, userProfiles.userId))
            .orderBy(desc(users.createdAt))
            .offset(offset)
            .limit(limit);

        return rows as User[];
    },
    changeUserStatus: async (userId: string, status: 'active' | 'suspended' | 'pending' | 'banned'): Promise<void> => {
        await db.update(users).set({ status }).where(eq(users.id, userId));
    },
    /**
     * Search user theo fullName — dùng cho chat sidebar để user tìm người để nhắn.
     *
     * Filter:
     *   - fullName ILIKE '%q%' (case-insensitive substring)
     *   - exclude self (không tự search ra chính mình)
     *   - chỉ status='active' (loại pending/suspended/banned)
     *   - deletedAt IS NULL (loại soft-deleted)
     *
     * Return: id, fullName, avatarUrl, role — KHÔNG leak email/status/metadata.
     */
    searchUsers: async (currentUserId: string, q: string, limit: number): Promise<UserSearchResult[]> => {
        const rows = await db
            .select({
                id: users.id,
                fullName: userProfiles.fullName,
                avatarUrl: userProfiles.avatarUrl,
                role: users.role,
            })
            .from(users)
            .leftJoin(userProfiles, eq(users.id, userProfiles.userId))
            .where(
                and(
                    ne(users.id, currentUserId),
                    isNull(users.deletedAt),
                    eq(users.status, 'active'),
                    ilike(userProfiles.fullName, `%${q}%`),
                ),
            )
            .orderBy(userProfiles.fullName)
            .limit(limit);

        return rows as UserSearchResult[];
    },
};