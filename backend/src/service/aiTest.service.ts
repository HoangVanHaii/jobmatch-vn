/**
 * AI Test service — Phase 3
 * Generate + grade IQ/English tests
 */
import crypto from 'crypto';
import { db } from '../config/database';
import { aiTests, testAssignments } from '../db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { generationProvider } from '../config/ai';
import { AI_TEST_IQ_PROMPT, AI_TEST_ENGLISH_PROMPT, AI_TEST_GRADE_PROMPT } from '../ai/prompts/ai_test.v1';
import { n8nService } from './n8n.service';
import { logger } from '../config/logger';

const TEST_EXPIRY_DAYS = 7;
const TEST_DURATION_MIN = 30;

export const aiTestService = {
  /**
   * Generate bộ test IQ/English cho 1 JD
   */
  generate: async (jobId: string, type: 'iq' | 'english', level?: string): Promise<string> => {
    const prompt = type === 'iq' ? AI_TEST_IQ_PROMPT : AI_TEST_ENGLISH_PROMPT(JSON.stringify({ level }));

    const result = await generationProvider.chat(
      [
        { role: 'system', content: prompt },
        { role: 'user', content: 'Sinh 15 câu hỏi test theo schema JSON đã mô tả.' },
      ],
      { temperature: 0.7 },
    );

    const questions = JSON.parse(result.content);
    const totalPoints = questions.reduce((sum: number, q: any) => sum + (q.points ?? 1), 0);

    const [test] = await db.insert(aiTests).values({
      jobId,
      testType: type,
      level: level ?? null,
      questions,
      totalPoints,
      durationMin: TEST_DURATION_MIN,
    }).returning();

    return test.id;
  },

  /**
   * Assign test cho 1 application
   */
  assign: async (applicationId: string, testId: string): Promise<string> => {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + TEST_EXPIRY_DAYS * 24 * 3600 * 1000);

    const [assignment] = await db.insert(testAssignments).values({
      applicationId,
      testId,
      accessToken: token,
      status: 'pending',
      expiresAt,
    }).returning();

    // Gửi email cho ứng viên qua n8n
    await n8nService.trigger('ai_test_assign', {
      applicationId,
      testId,
      takeUrl: `${process.env.FRONTEND_URL}/tests/take/${token}`,
    });

    return token;
  },

  /**
   * Ứng viên lấy câu hỏi (ẩn đáp án)
   */
  getQuestions: async (token: string): Promise<any> => {
    const assignment = await db.query.testAssignments.findFirst({
      where: eq(testAssignments.accessToken, token),
      with: { test: true },
    });
    if (!assignment) throw new Error('Invalid token');
    if (assignment.expiresAt < new Date()) throw new Error('Token expired');

    // Ẩn đáp án đúng
    const questions = (assignment.test!.questions as any[]).map((q) => {
      const { correctAnswer, ...rest } = q;
      return rest;
    });

    return { testId: assignment.testId, duration: assignment.test!.durationMin, questions };
  },

  /**
   * Nộp bài + auto grade
   */
  submit: async (token: string, answers: Record<string, any>): Promise<{ score: number; feedback: any }> => {
    const assignment = await db.query.testAssignments.findFirst({
      where: eq(testAssignments.accessToken, token),
      with: { test: true },
    });
    if (!assignment) throw new Error('Invalid token');

    // Auto-grade
    const questions = assignment.test!.questions as any[];
    let correctCount = 0;
    for (const q of questions) {
      if (q.type === 'multiple_choice') {
        if (answers[q.id] === q.correctAnswer) correctCount++;
      }
      // essay sẽ chấm bằng LLM bên dưới
    }
    let mcScore = (correctCount / questions.filter((q) => q.type === 'multiple_choice').length) * 100;

    // Chấm essay bằng LLM
    let essayFeedback: any = {};
    const essays = questions.filter((q) => q.type === 'essay');
    if (essays.length > 0) {
      const essayRes = await generationProvider.chat(
        [
          { role: 'system', content: AI_TEST_GRADE_PROMPT },
          { role: 'user', content: JSON.stringify({ questions: essays, answers }) },
        ],
        { temperature: 0.3 },
      );
      essayFeedback = JSON.parse(essayRes.content);
    }

    // Tổng hợp score
    const finalScore = Math.round(mcScore * 0.6 + (essayFeedback.overallScore ?? 0) * 0.4);

    // Lưu
    await db.update(testAssignments).set({
      status: 'completed',
      answers,
      score: finalScore.toString(),
      feedback: essayFeedback,
      submittedAt: new Date(),
    }).where(eq(testAssignments.id, assignment.id));

    // Update application
    await db.update(applications).set({
      testScore: finalScore.toString(),
      testTakenAt: new Date(),
    }).where(eq(applications.id, assignment.applicationId));

    logger.info({ assignmentId: assignment.id, score: finalScore }, 'Test submitted');
    return { score: finalScore, feedback: essayFeedback };
  },
};