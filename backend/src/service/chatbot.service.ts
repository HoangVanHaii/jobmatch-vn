import { randomUUID } from 'crypto';
import { db } from '../config/database';
import { aiChatSessions } from '../db/schema';
import { and, eq, desc } from 'drizzle-orm';
import { cvService } from './cv.service';
import { jobService } from './job.service';
import { billingService } from './billing.service';
import { jobApplicationService } from './jobApplication.service';
import { savedJobs as savedJobsTable } from '../db/schema/applications';
import { AppError } from '../middleware/errorHandler';
import { logger } from '../config/logger';
import {
  classifyIntent,
  type ClassifyIntentInput,
  dispatchHandlers,
  streamMergedAnswer,
  jdHandler,
  cvHandler,
  isBudgetExceeded,
  recordUsage,
  type ChatMessage,
  type ChatType,
  type HandlerSection,
  type AttachedJobItem,
  type AttachedCvItem,
} from '../lib/llm/chatbot';

export interface ChatSession {
  id: string;
  userId: string;
  title: string | null;
  messages: ChatMessage[];
  context: {
    jobIds: string[];
    cvIds: string[];
    totalTokens?: number;
    metadata?: Record<string, unknown>;
  };
  attachedJobs?: Array<{
    id: string;
    title: string;
    slug: string | null;
    companyId: string;
    companyName: string | null;
    salaryMin: string | null;
    salaryMax: string | null;
    salaryCurrency: string | null;
    salaryVisible: boolean | null;
    location: { city?: string } | null;
    jobLevel: string | null;
    jobType: string | null;
    status: string;
    publishedAt: Date | null;
  }>;
  attachedCvs?: Array<{
    id: string;
    title: string | null;
    isPrimary: boolean;
    status: string;
    source: string;
    aiAnalysisTotal: number | null;
  }>;
  createdAt: Date;
  updatedAt: Date;
}


export type StreamEvent =
  | { chunk: string }
  | { event: { type: 'types'; types: ChatType[] } }
  | { event: { type: 'done'; sessionId: string; totalTokens: number; usage: { input: number; output: number } } }
  | { event: { type: 'error'; code: string; message: string } }
  | { event: { type: 'budget_exceeded' } }
  | { event: { type: 'busy' } }
  | { event: { type: 'aborted' } };

const inFlightTurns = new Map<string, Promise<void>>();

const HISTORY_WINDOW = 3;

const recentHistory = (all: ChatMessage[]): ChatMessage[] => all.slice(-HISTORY_WINDOW);

const hydrateAttached = async (
  session: ChatSession,
  userId: string,
): Promise<ChatSession> => {
  const jobIds = session.context.jobIds ?? [];
  const cvIds = session.context.cvIds ?? [];

  const [jobs, cvs] = await Promise.all([
    jobIds.length ? jobService.getByIdsPublic(jobIds) : Promise.resolve([]),
    cvIds.length ? cvService.getManyByIds(cvIds, userId) : Promise.resolve([]),
  ]);

  session.attachedJobs = (jobs as unknown as Array<Record<string, unknown>>).map((j) => ({
    id: j.id as string,
    title: j.title as string,
    slug: (j.slug as string | null) ?? null,
    companyId: j.companyId as string,
    companyName: (j.companyName as string | null) ?? null,
    salaryMin: (j.salaryMin as string | null) ?? null,
    salaryMax: (j.salaryMax as string | null) ?? null,
    salaryCurrency: (j.salaryCurrency as string | null) ?? null,
    salaryVisible: (j.salaryVisible as boolean | null) ?? null,
    location: (j.location as { city?: string } | null) ?? null,
    jobLevel: (j.jobLevel as string | null) ?? null,
    jobType: (j.jobType as string | null) ?? null,
    status: j.status as string,
    publishedAt: (j.publishedAt as Date | null) ?? null,
  }));

  session.attachedCvs = (cvs as unknown as Array<Record<string, unknown>>).map((c) => ({
    id: c.id as string,
    title: (c.title as string | null) ?? null,
    isPrimary: Boolean(c.isPrimary),
    status: c.status as string,
    source: c.source as string,
    aiAnalysisTotal: (c.aiAnalysisTotal as number | null) ?? null,
  }));

  return session;
};

const serializeSession = (row: typeof aiChatSessions.$inferSelect): ChatSession => ({
  id: row.id,
  userId: row.userId,
  title: row.title,
  messages: ((row.messages ?? []) as unknown) as ChatMessage[],
  context: ((row.context ?? { jobIds: [], cvIds: [], totalTokens: 0 }) as ChatSession['context']),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

export const chatbotService = {
  createSession: async (userId: string, title?: string | null): Promise<ChatSession> => {
    const [row] = await db
      .insert(aiChatSessions)
      .values({
        userId,
        title: title ?? null,
        messages: [],
        context: { jobIds: [], cvIds: [], totalTokens: 0 },
      })
      .returning();
    if (!row) throw new AppError(500, 'INTERNAL_ERROR', 'Failed to create chat session');
    logger.info({ sessionId: row.id, userId }, '[chatbot] session created');
    return serializeSession(row);
  },

  listSessions: async (userId: string, limit = 20): Promise<ChatSession[]> => {
    const capped = Math.min(Math.max(limit, 1), 50);
    const rows = await db
      .select()
      .from(aiChatSessions)
      .where(eq(aiChatSessions.userId, userId))
      .orderBy(desc(aiChatSessions.updatedAt))
      .limit(capped);
    return rows.map(serializeSession);
  },

  getSession: async (sessionId: string, userId: string): Promise<ChatSession | null> => {
    const [row] = await db
      .select()
      .from(aiChatSessions)
      .where(and(eq(aiChatSessions.id, sessionId), eq(aiChatSessions.userId, userId)))
      .limit(1);
    if (!row) return null;
    return await hydrateAttached(serializeSession(row), userId);
  },

  patchContext: async (
    sessionId: string,
    userId: string,
    patch: { jobIds: string[]; cvIds: string[] },
  ): Promise<ChatSession | null> => {
    const existing = await chatbotService.getSession(sessionId, userId);
    const sessionUserId = existing?.userId ?? userId;
    const [row] = await db
      .update(aiChatSessions)
      .set({
        context: {
          jobIds: patch.jobIds,
          cvIds: patch.cvIds,
          totalTokens: existing?.context.totalTokens ?? 0,
        },
        updatedAt: new Date(),
      })
      .where(
        and(eq(aiChatSessions.id, sessionId), eq(aiChatSessions.userId, sessionUserId)),
      )
      .returning();
    if (!row) return null;
    const session = serializeSession(row);
    return await hydrateAttached(session, sessionUserId);
  },

  resetContext: async (sessionId: string, userId: string): Promise<ChatSession | null> => {
    const existing = await chatbotService.getSession(sessionId, userId);
    if (!existing) return null;
    const [row] = await db
      .update(aiChatSessions)
      .set({
        context: { jobIds: [], cvIds: [], totalTokens: existing.context.totalTokens ?? 0 },
        updatedAt: new Date(),
      })
      .where(eq(aiChatSessions.id, sessionId))
      .returning();
    if (!row) return null;
    const session = serializeSession(row);
    return await hydrateAttached(session, userId);
  },

  appendUserMessage: async (input: {
    sessionId: string;
    userMessage: string;
    attachedJobs: AttachedJobItem[];
    attachedCvs: AttachedCvItem[];
    isFirstUserMessage: boolean;
  }): Promise<void> => {
    const [session] = await db
      .select({
        messages: aiChatSessions.messages,
        title: aiChatSessions.title,
      })
      .from(aiChatSessions)
      .where(eq(aiChatSessions.id, input.sessionId))
      .limit(1);
    if (!session) return;

    const messages = ((session.messages ?? []) as ChatMessage[]).concat([
      {
        role: 'user',
        content: input.userMessage,
        ts: new Date().toISOString(),
        attachedJobs: input.attachedJobs,
        attachedCvs: input.attachedCvs,
      },
    ]);

    const nextTitle =
      input.isFirstUserMessage && !session.title
        ? input.userMessage.trim().slice(0, 50) + (input.userMessage.length > 50 ? '…' : '')
        : session.title;

    await db
      .update(aiChatSessions)
      .set({
        messages,
        title: nextTitle,
        updatedAt: new Date(),
      })
      .where(eq(aiChatSessions.id, input.sessionId));
  },

  appendAssistantMessage: async (input: {
    sessionId: string;
    assistantMessage: string;
    newTotalTokens: number;
  }): Promise<void> => {
    const [session] = await db
      .select({
        messages: aiChatSessions.messages,
        context: aiChatSessions.context,
      })
      .from(aiChatSessions)
      .where(eq(aiChatSessions.id, input.sessionId))
      .limit(1);
    if (!session) return;

    const messages = ((session.messages ?? []) as ChatMessage[]).concat([
      { role: 'assistant', content: input.assistantMessage, ts: new Date().toISOString() },
    ]);

    const currentContext = (session.context ?? {}) as {
      jobIds?: string[];
      cvIds?: string[];
      totalTokens?: number;
    };
    const nextContext = {
      jobIds: currentContext.jobIds ?? [],
      cvIds: currentContext.cvIds ?? [],
      totalTokens: input.newTotalTokens,
    };

    await db
      .update(aiChatSessions)
      .set({
        messages,
        context: nextContext,
        updatedAt: new Date(),
      })
      .where(eq(aiChatSessions.id, input.sessionId));
  },

resolveContextData: async (userId: string, ctx: { jobIds: string[]; cvIds: string[] }) => {
    const [jobs, cvs, plans, subscription] = await Promise.all([
      jobService.getByIdsPublic(ctx.jobIds),
      cvService.getManyByIds(ctx.cvIds, userId),
      billingService.listPlans(),
      billingService.getActiveSubscriptionByUser(userId),
    ]);
    return { jobs, cvs, plans, subscription };
  },

  /**
   * Stream 1 lượt hội thoại.
   * Yield: `{chunk}` cho từng text chunk; `{event}` cho structured event.
   *
   * Concurrent guard: nếu session đang stream → emit busy, không chạy LLM.
   * Budget guard: nếu vượt 50k → emit budget_exceeded, không chạy LLM.
   * Abort signal: req.on('close') phát signal aborted → ngừng yield.
   */
  streamTurn: async function* (
    sessionId: string,
    userId: string,
    userMessage: string,
    jobIds: string[],
    cvIds: string[],
    attachedJobs: AttachedJobItem[],
    attachedCvs: AttachedCvItem[],
    signal: AbortSignal,
  ): AsyncGenerator<StreamEvent, void, void> {
    const traceId = randomUUID();

    const [ownerRow] = await db
      .select({ id: aiChatSessions.id, context: aiChatSessions.context, messages: aiChatSessions.messages })
      .from(aiChatSessions)
      .where(and(eq(aiChatSessions.id, sessionId), eq(aiChatSessions.userId, userId)))
      .limit(1);
    if (!ownerRow) {
      yield { event: { type: 'error', code: 'SESSION_NOT_FOUND', message: 'Session không tồn tại hoặc không thuộc bạn.' } };
      return;
    }

    if (inFlightTurns.has(sessionId)) {
      logger.warn({ traceId, sessionId }, '[chatbot] turn already in flight');
      yield { event: { type: 'busy' } };
      return;
    }

    const prevContext = ((ownerRow.context ?? {}) as {
      jobIds?: string[];
      cvIds?: string[];
      totalTokens?: number;
    });

    await db
      .update(aiChatSessions)
      .set({
        context: {
          jobIds,
          cvIds,
          totalTokens: prevContext.totalTokens ?? 0,
        },
        updatedAt: new Date(),
      })
      .where(eq(aiChatSessions.id, sessionId));

    const totalTokensBefore = prevContext.totalTokens ?? 0;
    if (isBudgetExceeded(totalTokensBefore)) {
      logger.warn({ traceId, sessionId, totalTokensBefore }, '[chatbot] budget exceeded');
      yield { event: { type: 'budget_exceeded' } };
      return;
    }

    let resolveTurn: () => void = () => {};
    const turnDone = new Promise<void>((r) => (resolveTurn = r));
    inFlightTurns.set(sessionId, turnDone);

    // Track giá trị để `appendAssistantMessage` dùng trong finally.
    let newTotalTokens = 0;
    let accAssistant = '';

    try {
      // Persist user message NGAY sau khi acquire lock (trước khi gọi bất kỳ
      // LLM nào). Lý do: nếu user abort giữa chừng, controller break for-await
      // → service generator bị iterator.return() ngay tại yield point. Code
      // sau yield (gồm cả appendAssistantMessage) không chạy. Nhưng user message
      // đã được persist ở đây rồi → không mất. Tương tự intent classify lỗi /
      // budget vượt giữa chừng cũng OK vì check đã qua ở trên.
      const isFirstUserMessage = !((ownerRow.messages ?? []) as ChatMessage[]).some(
        (m: ChatMessage) => m.role === 'user',
      );
      try {
        await chatbotService.appendUserMessage({
          sessionId,
          userMessage,
          attachedJobs,
          attachedCvs,
          isFirstUserMessage,
        });
      } catch (err) {
        logger.error({ traceId, err }, '[chatbot] appendUserMessage failed');
        // Không fail turn — assistant vẫn stream được, chỉ là user message có thể
        // không persist. Trade-off chấp nhận được để tránh UX broken.
      }

      const snapshotIds = { jobIds, cvIds };

      const { jobs, cvs, plans, subscription } = await chatbotService.resolveContextData(userId, snapshotIds);

      const recentMessages = recentHistory((ownerRow.messages ?? []) as ChatMessage[]);

      // --- Bước 1: Intent classification (có cache Redis 5ph)
      const classifyInput: ClassifyIntentInput = {
        sessionId,
        question: userMessage,
        jobIds: snapshotIds.jobIds,
        cvIds: snapshotIds.cvIds,
        recentMessages,
        signal,
        traceId,
      };
      let intent: { types: ChatType[]; confidence: number };
      let intentUsageInput = 0;
      let intentUsageOutput = 0;
      let handlerUsageInput = 0;
      let handlerUsageOutput = 0;
      try {
        const result = await classifyIntent(classifyInput);
        intent = result.intent;
        intentUsageInput = result.usage.input;
        intentUsageOutput = result.usage.output;
      } catch {
        intent = { types: ['general'], confidence: 0 };
      }

      yield { event: { type: 'types', types: intent.types } };

      // --- Bước 2: Dispatch handlers + 1 LLM stream cuối
      const handlerCtx = {
        userId,
        userRole: 'candidate' as string, // phase 1 thống nhất, role-specific sẽ từ req.user
        question: userMessage,
        jobIds: snapshotIds.jobIds,
        cvIds: snapshotIds.cvIds,
        jobs,
        cvs,
        subscription,
        plans,
        recentMessages,
        signal,
        traceId,
        // Mutable sink — handlers gọi LLM riêng (vd. cvMatch scoring) s� ghi
        // usage vào đây. Service cộng vào totalTokens sau khi dispatch xong.
        usageSink: { usage: undefined as { input: number; output: number } | undefined },
      };

      const sections: HandlerSection[] = await dispatchHandlers(handlerCtx, intent.types);

      if (snapshotIds.jobIds.length > 0 && !sections.some((s) => s.label === 'jd')) {
        try {
          const jdSection = await jdHandler(handlerCtx);
          if (jdSection.content.trim().length > 0) {
            sections.unshift(jdSection); // đầu prompt — context quan trọng nhất
            logger.info(
              { traceId, sessionId, jobIds: snapshotIds.jobIds },
              '[chatbot] jdHandler safety-net ran (intent không bao gồm jd)',
            );
          }
        } catch (err) {
          logger.warn({ traceId, err }, '[chatbot] jdHandler safety-net failed');
        }
      }
      if (snapshotIds.cvIds.length > 0 && !sections.some((s) => s.label === 'cv')) {
        try {
          const cvSection = await cvHandler(handlerCtx);
          if (cvSection.content.trim().length > 0) {
            sections.unshift(cvSection);
            logger.info(
              { traceId, sessionId, cvIds: snapshotIds.cvIds },
              '[chatbot] cvHandler safety-net ran (intent không bao gồm cv)',
            );
          }
        } catch (err) {
          logger.warn({ traceId, err }, '[chatbot] cvHandler safety-net failed');
        }
      }

      // Đọc usage từ handler sink — handlers có thể đã gọi LLM riêng
      // (vd. cvMatch chấm điểm bằng LLM). Cộng vào token budget.
      const handlerUsage = handlerCtx.usageSink?.usage;
      if (handlerUsage) {
        handlerUsageInput = handlerUsage.input;
        handlerUsageOutput = handlerUsage.output;
      }

      const usageSink: { usage?: { inputTokens: number; outputTokens: number } } = {};
      const merger = streamMergedAnswer({
        sections,
        history: recentMessages,
        question: userMessage,
        types: intent.types,
        signal,
        traceId,
        usageSink,
      });

      let finalUsage = { input: 0, output: 0 };
      try {
        for await (const text of merger) {
          if (signal.aborted) break;
          if (text) {
            accAssistant += text;
            yield { chunk: text };
          }
        }
      
        const u = usageSink.usage;
        if (u) finalUsage = { input: u.inputTokens, output: u.outputTokens };
        else if (accAssistant.length > 0) {
          logger.warn(
            { traceId, accLen: accAssistant.length, aborted: signal.aborted },
            '[chatbot] merge usageSink empty (likely aborted before finish)',
          );
        }
      } catch (err) {
        logger.error({ traceId, err }, '[chatbot] merge stream failed');
        yield { event: { type: 'error', code: 'STREAM_FAILED', message: 'Có lỗi khi sinh câu trả lời. Bạn thử lại.' } };
        newTotalTokens = recordUsage(totalTokensBefore, {
          input: intentUsageInput + handlerUsageInput,
          output: intentUsageOutput + handlerUsageOutput,
        });
        return;
      }

      if (signal.aborted) {
        yield { event: { type: 'aborted' } };
      }

      newTotalTokens = recordUsage(totalTokensBefore, {
        input: intentUsageInput + handlerUsageInput + finalUsage.input,
        output: intentUsageOutput + handlerUsageOutput + finalUsage.output,
      });

      yield {
        event: {
          type: 'done',
          sessionId,
          totalTokens: newTotalTokens,
          usage: {
            // Tổng input/output của turn (intent + handler + merge) để FE debug.
            input: intentUsageInput + handlerUsageInput + finalUsage.input,
            output: intentUsageOutput + handlerUsageOutput + finalUsage.output,
          },
        },
      };
    } finally {
      // Persist assistant message + token count ở finally — luôn chạy kể cả
      // khi user abort (iterator.return() trigger finally) hoặc exception.
      //
      // Condition `newTotalTokens > 0` loại các early-return path:
      // session_not_found / busy / budget_exceeded đều return TRƯỚC khi vào
      // try block (trước line `inFlightTurns.set`) → finally không chạy cho
      // các path này. Nếu đã vào try block, ít nhất intent classify đã chạy
      // → newTotalTokens > 0 (kể cả classify lỗi fallback 'general' cũng
      // vẫn count usage 0 nếu LLM fail hoàn toàn — defensive check vẫn giữ).
      //
      // Trong try block, không persist trực tiếp — để finally lo cho đồng nhất.
      // Điều này đảm bảo cả normal / aborted / exception path đều persist
      // assistant.
      if (newTotalTokens > 0) {
        try {
          await chatbotService.appendAssistantMessage({
            sessionId,
            assistantMessage: accAssistant,
            newTotalTokens,
          });
        } catch (err) {
          logger.error({ traceId, err }, '[chatbot] appendAssistantMessage failed');
        }
      }
      inFlightTurns.delete(sessionId);
      resolveTurn();
    }
  },

  /**
   * List jobs cho picker theo 3 source:
   *   - all: live jobs (search text optional)
   *   - saved: jobs user đã bookmark (saved_jobs)
   *   - applied: jobs user đã nộp hồ sơ (applications.jobId distinct)
   */
  listJobsPicker: async (
    userId: string,
    source: 'all' | 'saved' | 'applied',
    q?: string,
    limit = 20,
  ): Promise<
    Array<{
      id: string;
      title: string;
      slug: string | null;
      companyId: string;
      companyName: string | null;
      salaryMin: string | null;
      salaryMax: string | null;
      salaryCurrency: string | null;
      salaryVisible: boolean | null;
      location: { city?: string } | null;
      jobLevel: string | null;
      jobType: string | null;
      status: string;
      publishedAt: Date | null;
    }>
  > => {
    const capped = Math.min(Math.max(limit, 1), 50);
    if (source === 'saved') {
      const rows = await db
        .select({
          id: savedJobsTable.jobId,
          savedAt: savedJobsTable.savedAt,
        })
        .from(savedJobsTable)
        .where(eq(savedJobsTable.userId, userId))
        .orderBy(desc(savedJobsTable.savedAt))
        .limit(capped);
      if (!rows.length) return [];
      // Re-load jobs theo ids (status='live' hoặc 'closed' để có đủ data)
      const { jobService } = await import('./job.service');
      const jobs = await jobService.getByIdsPublic(rows.map((r) => r.id));
      const result = jobs.map((j: any) => ({
        id: j.id,
        title: j.title,
        slug: j.slug,
        companyId: j.companyId,
        companyName: null,
        salaryMin: j.salaryMin,
        salaryMax: j.salaryMax,
        salaryCurrency: j.salaryCurrency,
        salaryVisible: j.salaryVisible,
        location: j.location,
        jobLevel: j.jobLevel,
        jobType: j.jobType,
        status: j.status,
        publishedAt: j.publishedAt,
      }));
      return result;
    }
    if (source === 'applied') {
      const ids = await jobApplicationService.listAppliedJobIds(userId);
      if (!ids.length) return [];
      const jobs = await jobService.getByIdsPublic(ids);
      return jobs.map((j: any) => ({
        id: j.id,
        title: j.title,
        slug: j.slug,
        companyId: j.companyId,
        companyName: null,
        salaryMin: j.salaryMin,
        salaryMax: j.salaryMax,
        salaryCurrency: j.salaryCurrency,
        salaryVisible: j.salaryVisible,
        location: j.location,
        jobLevel: j.jobLevel,
        jobType: j.jobType,
        status: j.status,
        publishedAt: j.publishedAt,
      }));
    }
    // source === 'all': live jobs, optional search
    const { data } = await jobService.list(
      {
        search: q,
        page: 1,
        limit: capped,
      } as any,
      undefined,
    );
    return data.map((j) => ({
      id: j.id,
      title: j.title,
      slug: j.slug,
      companyId: j.companyId,
      companyName: null,
      salaryMin: j.salaryMin,
      salaryMax: j.salaryMax,
      salaryCurrency: j.salaryCurrency,
      salaryVisible: j.salaryVisible,
      location: j.location,
      jobLevel: j.jobLevel,
      jobType: j.jobType,
      status: j.status,
      publishedAt: j.publishedAt,
    }));
  },

  /** List CVs của user cho picker (ownership-filtered). */
  listCvsPicker: async (userId: string) => {
    const result = await cvService.list(userId, undefined, 50, 0);
    return result.items.map((cv) => ({
      id: cv.id,
      title: cv.title,
      isPrimary: cv.isPrimary,
      status: cv.status,
      source: cv.source,
      aiAnalysisTotal: cv.aiAnalysisTotal ?? null,
    }));
  },
};
