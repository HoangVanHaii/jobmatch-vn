/**
 * Reference Verification service — Phase 2
 * Gửi email cho người tham chiếu để verify ứng viên
 */
import crypto from 'crypto';
import { db } from '../config/database';
import { referenceVerifications, cvs, applications } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { logger } from '../config/logger';
import { n8nService } from './n8n.service';
import { parsingProvider } from '../config/ai';

const TOKEN_EXPIRY_DAYS = 14;

export const referenceVerifyService = {
  /**
   * Auto-extract references từ CV đã parse (nếu chưa có)
   * LLM detect người tham chiếu trong CV text
   */
  extractFromCV: async (cvId: string): Promise<void> => {
    const cv = await db.query.cvs.findFirst({ where: eq(cvs.id, cvId) });
    if (!cv?.parsedData) return;

    // Nếu CV đã có references thì skip
    const refs = (cv.parsedData as any).references;
    if (refs && Array.isArray(refs) && refs.length > 0) {
      return;
    }

    // LLM extract — dùng prompt simple
    // TODO: add proper prompt
  },

  /**
   * Gửi email verification cho 1 người tham chiếu
   */
  sendVerification: async (referenceId: string): Promise<void> => {
    const ref = await db.query.referenceVerifications.findFirst({ where: eq(referenceVerifications.id, referenceId) });
    if (!ref) throw new Error('Reference not found');

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_DAYS * 24 * 3600 * 1000);

    await db.update(referenceVerifications).set({
      verificationToken: token,
      status: 'sent',
      sentAt: new Date(),
      expiresAt,
    }).where(eq(referenceVerifications.id, referenceId));

    // Gửi email qua n8n workflow
    await n8nService.trigger('reference_verify', {
      referenceId,
      refereeEmail: ref.refereeEmail,
      refereeName: ref.refereeName,
      verifyUrl: `${process.env.FRONTEND_URL}/references/verify?token=${token}`,
    });

    logger.info({ referenceId, referee: ref.refereeEmail }, 'Reference verification email sent');
  },

  /**
   * Người tham chiếu click link → verify hoặc reject
   */
  respond: async (token: string, response: { confirmed: boolean; notes?: string }): Promise<void> => {
    const ref = await db.query.referenceVerifications.findFirst({
      where: eq(referenceVerifications.verificationToken, token),
    });
    if (!ref) throw new Error('Invalid token');
    if (ref.expiresAt && ref.expiresAt < new Date()) throw new Error('Token expired');

    await db.update(referenceVerifications).set({
      status: response.confirmed ? 'verified' : 'failed',
      verifiedAt: new Date(),
      response: response as any,
    }).where(eq(referenceVerifications.id, ref.id));

    logger.info({ referenceId: ref.id, confirmed: response.confirmed }, 'Reference response recorded');
  },

  /**
   * Background job: đánh dấu expired
   */
  markExpired: async (): Promise<void> => {
    // TODO: chạy cron hàng ngày
    const expired = await db.query.referenceVerifications.findMany({
      where: and(eq(referenceVerifications.status, 'sent'), sql`${referenceVerifications.expiresAt} < now()`),
    });
    for (const r of expired) {
      await db.update(referenceVerifications).set({ status: 'expired' }).where(eq(referenceVerifications.id, r.id));
    }
  },
};