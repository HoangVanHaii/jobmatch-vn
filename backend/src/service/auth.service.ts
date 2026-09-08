import bcrypt from 'bcrypt';
import { db } from '../config/database';
import { users, userProfiles } from '../db/schema';
import { and, asc, desc, eq, ilike, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
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
        agreedAt?: string, // BUG #2 FIX: timestamp khi user đồng ý ToS/Privacy (ISO 8601)
    ): Promise<void> => {
        const passwordHash = await bcrypt.hash(password, 12);
        // BUG #2 FIX: lưu consent metadata vào users.metadata để có audit trail
        // (tuân thủ Nghị định 13/2023 về bảo vệ dữ liệu cá nhân VN).
        // Cấu trúc metadata.consent: { tos: { acceptedAt: ISO }, privacy: { acceptedAt: ISO } }
        const consentMetadata = agreedAt
            ? {
                consent: {
                    tos: { acceptedAt: agreedAt, version: '1.0' },
                    privacy: { acceptedAt: agreedAt, version: '1.0' },
                },
            }
            : {};

        await db.transaction(async (tx) => {
            const [created] = await tx
                .insert(users)
                .values({
                    email,
                    passwordHash,
                    role,
                    status: 'pending', // CRITICAL: phải set explicit — DB default đang là 'active' do migration cũ
                    metadata: consentMetadata,
                })
                .returning({ id: users.id });
            if (!created) {
                throw new AppError(500, 'USER_INSERT_FAILED', 'Failed to create user');
            }
            await tx.insert(userProfiles).values({ userId: created.id, fullName });
        });
    },
    /**
     * D1 FIX: Update user đangở status='pending' (chưa verify) để cho phép
     * user đăng ký lại cùng email. UPDATE thay vì DELETE giữ nguyên user.id
     * ổn định, tránh FK reference broken, đồng thời vẫn preserve fullName mới.
     *
     * Caller PHẢI check trước:
     *  - existing.status === 'pending'
     *  - existing.metadata.oauth_linked rỗng (chưa OAuth)
     *
     * Wrap trong transaction để đảm bảo users + userProfiles update cùng lúc
     * — nếu 1 bên fail, rollback cả2.
     */
    updatePendingUser: async (
        userId: string,
        passwordHash: string,
        role: 'candidate' | 'employer',
        fullName: string,
        agreedAt?: string, // BUG #2 FIX: update consent timestamp khi re-register
    ): Promise<void> => {
        // BUG #2 FIX: giữ consent metadata cũ nếu có, hoặc set mới nếu là lần đầu.
        // Khi re-register, user phải đồng ý lại → cập nhật timestamp mới.
        const existing = await db.query.users.findFirst({
            where: eq(users.id, userId),
            columns: { metadata: true },
        });
        const existingConsent = (existing?.metadata as any)?.consent;
        const newConsentMetadata = agreedAt
            ? {
                consent: {
                    tos: { acceptedAt: agreedAt, version: '1.0' },
                    privacy: { acceptedAt: agreedAt, version: '1.0' },
                },
            }
            : existingConsent
            ? { consent: existingConsent }
            : {};

        await db.transaction(async (tx) => {
            await tx.update(users)
                .set({ passwordHash, role, updatedAt: new Date(), metadata: newConsentMetadata })
                .where(eq(users.id, userId));
            await tx.update(userProfiles)
                .set({ fullName })
                .where(eq(userProfiles.userId, userId));
        });
    },
    verifyEmail: async (email: string): Promise<void> => {
        await db.update(users).set({ emailVerifiedAt: new Date(), status: 'active' }).where(eq(users.email, email));
    },
    verifyPassword: async (email: string, password: string): Promise<any> => {
        const user = await db.query.users.findFirst({ where: eq(users.email, email) });
        if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');

        // OAuth-only user tồn tại nhưng không có local password → báo để user biết
        // cách đăng nhập đúng (qua Google/FB/GitHub). Trước đây throw USER_NOT_FOUND
        // generic → user confused vì "đăng ký rồi mà báo không tồn tại".
        if (!user.passwordHash) {
            throw new AppError(
                400,
                'OAUTH_ONLY_ACCOUNT',
                'Tài khoản này đăng ký qua Google/Facebook/GitHub. Vui lòng đăng nhập bằng phương thức đó.',
            );
        }

        if (user.status !== 'active') {
            if (user.status === 'pending') throw new AppError(403, 'EMAIL_NOT_VERIFIED', 'Email chưa được xác thực. Vui lòng kiểm tra email và nhập mã OTP.');
            throw new AppError(403, 'ACCOUNT_INACTIVE', 'Tài khoản không hoạt động. Vui lòng liên hệ hỗ trợ.');
        }
        if (user.deletedAt) throw new AppError(403, 'ACCOUNT_DELETED', 'Tài khoản đã bị xóa.');
        const isMatch = await bcrypt.compare(password, user.passwordHash);
        if (!isMatch) throw new AppError(401, 'INVALID_CREDENTIALS', 'Email hoặc mật khẩu không đúng.');

        await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
        return user;
    },
    resetPassword: async (email: string, newPassword: string): Promise<void> => {
        // S1 FIX: chặn OAuth-only forgot-password attack.
        // Nếu user đăng ký qua OAuth (Google/FB/GitHub) và CHƯA có local password,
        // KHÔNG cho phép reset qua email → tránh chiếm tài khoản bằng cách
        // biết email + compromise được OTP qua email.
        // User OAuth-only phải đăng nhập bằng provider, hoặc qua flow riêng
        // (set-password sau khi verify OAuth session).
        const existing = await db.query.users.findFirst({ where: eq(users.email, email) });
        if (existing && !existing.passwordHash) {
            throw new AppError(
                400,
                'OAUTH_ONLY_ACCOUNT',
                'Tài khoản này sử dụng đăng nhập qua Google/Facebook/GitHub. Vui lòng đăng nhập bằng phương thức đó, hoặc liên hệ hỗ trợ để đặt mật khẩu mới.',
            );
        }
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
    listUsers: async (params: {
        offset: number;
        limit: number;
        q?: string;
        role?: string;
        status?: string;
        sort?: 'newest' | 'oldest' | 'name-asc' | 'name-desc' | 'recently-active';
    }): Promise<{ data: User[]; total: number }> => {
        // Luôn loại trừ user đã xoá mềm — admin chỉ quản lý active records.
        const conditions: SQL[] = [isNull(users.deletedAt)];

        // Search theo email HOẶC fullName (leftJoin userProfiles đã có sẵn).
        // Dùng ilike = case-insensitive LIKE (Postgres). Không bỏ dấu tiếng Việt
        // — admin muốn search "nguyen" match "Nguyễn" cần extension unaccent.
        if (params.q && params.q.trim()) {
            const like = `%${params.q.trim()}%`;
            conditions.push(
                or(ilike(users.email, like), ilike(userProfiles.fullName, like))!,
            );
        }

        if (params.role) {
            conditions.push(eq(users.role, params.role as 'candidate' | 'employer' | 'admin'));
        }

        if (params.status) {
            conditions.push(
                eq(users.status, params.status as 'active' | 'suspended' | 'pending' | 'banned'),
            );
        }

        // Sort
        let orderBy;
        switch (params.sort) {
            case 'oldest': orderBy = asc(users.createdAt); break;
            case 'email': orderBy = asc(users.email); break;
            case 'newest':
            default: orderBy = desc(users.createdAt); break;
        }

        // Count total (cùng filter) để FE tính số trang chính xác.
        const [{ count: total }] = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(users)
            .leftJoin(userProfiles, eq(users.id, userProfiles.userId))
            .where(and(...conditions));

        // Lấy rows cho trang hiện tại.
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
            .where(and(...conditions))
            .orderBy(orderBy)
            .offset(params.offset)
            .limit(params.limit);

        return { data: rows as User[], total };
    },

    /**
     * Đếm users theo filter (q, role, status) — KHÔNG phân trang.
     * Trả về:
     *   - total      : tổng record match filter
     *   - byRole     : { candidate, employer, admin } — đếm theo role (filter bỏ role)
     *   - byStatus   : { active, suspended, pending, banned } — đếm theo status (filter bỏ status)
     *
     * Mục đích: dùng cho Admin UI hiển thị summary + tab count chính xác dù đang
     * ở trang nào, sort gì, hay pagination nào.
     */
    countUsers: async (params: {
        q?: string;
        role?: string;
        status?: string;
    }): Promise<{
        total: number;
        byRole: Record<'candidate' | 'employer' | 'admin', number>;
        byStatus: Record<'active' | 'suspended' | 'pending' | 'banned', number>;
    }> => {
        // Helper: build base conditions (q + exclude deleted).
        // byRole query: exclude role filter (đếm all roles)
        // byStatus query: exclude status filter (đếm all statuses)
        const baseConditions = (exclude?: 'role' | 'status'): SQL[] => {
            const conds: SQL[] = [isNull(users.deletedAt)];
            if (params.q && params.q.trim()) {
                const like = `%${params.q.trim()}%`;
                conds.push(or(ilike(users.email, like), ilike(userProfiles.fullName, like))!);
            }
            if (exclude !== 'role' && params.role) {
                conds.push(eq(users.role, params.role as 'candidate' | 'employer' | 'admin'));
            }
            if (exclude !== 'status' && params.status) {
                conds.push(
                    eq(users.status, params.status as 'active' | 'suspended' | 'pending' | 'banned'),
                );
            }
            return conds;
        };

        // Total — cùng filter với list
        const [{ count: total }] = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(users)
            .leftJoin(userProfiles, eq(users.id, userProfiles.userId))
            .where(and(...baseConditions()));

        // byRole — đếm theo từng role, filter bỏ role
        const byRoleRows = await db
            .select({ role: users.role, count: sql<number>`count(*)::int` })
            .from(users)
            .leftJoin(userProfiles, eq(users.id, userProfiles.userId))
            .where(and(...baseConditions('role')))
            .groupBy(users.role);

        // byStatus — đếm theo từng status, filter bỏ status
        const byStatusRows = await db
            .select({ status: users.status, count: sql<number>`count(*)::int` })
            .from(users)
            .leftJoin(userProfiles, eq(users.id, userProfiles.userId))
            .where(and(...baseConditions('status')))
            .groupBy(users.status);

        // Khởi tạo đủ 4 key mỗi loại với default 0.
        const byRole: Record<'candidate' | 'employer' | 'admin', number> = {
            candidate: 0,
            employer: 0,
            admin: 0,
        };
        for (const row of byRoleRows) {
            if (row.role === 'candidate' || row.role === 'employer' || row.role === 'admin') {
                byRole[row.role] = row.count;
            }
        }

        const byStatus: Record<'active' | 'suspended' | 'pending' | 'banned', number> = {
            active: 0,
            suspended: 0,
            pending: 0,
            banned: 0,
        };
        for (const row of byStatusRows) {
            if (
                row.status === 'active' || row.status === 'suspended' ||
                row.status === 'pending' || row.status === 'banned'
            ) {
                byStatus[row.status] = row.count;
            }
        }

        return { total, byRole, byStatus };
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