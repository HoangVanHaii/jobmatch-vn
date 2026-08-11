import bcrypt from 'bcrypt';
import { db } from '../config/database';
import { users, userProfiles } from '../db/schema';
import { eq, isNull, desc } from 'drizzle-orm';
import { AppError } from '../middleware/errorHandler';
import { Profile, User } from '@/interface/user';

export const authService = {
    requestOtp: async (email: string, password: string, role: 'candidate' | 'employer'): Promise<void> => {
        const passwordHash = await bcrypt.hash(password, 12);
        await db.insert(users).values({ email, passwordHash, role, metadata: {} }).returning();
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
    }
};