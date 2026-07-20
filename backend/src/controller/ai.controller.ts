/**
 * AI controller — chatbot (streaming), CV parse/score, JD gen, cover letter
 */
import { Request, Response, NextFunction } from 'express';
import { chatbotProvider, parsingProvider, generationProvider } from '../config/ai';
import { aiQueue } from '../config/queue';
import { CV_PARSE_SYSTEM_PROMPT, CV_PARSE_USER_PROMPT } from '../ai/prompts/cv_parse.v1';
import { CV_SCORE_SYSTEM_PROMPT, CV_SCORE_USER_PROMPT } from '../ai/prompts/cv_score.v1';
import { CHAT_SYSTEM_PROMPT } from '../ai/prompts/chat_system.v1';
import { searchJobsTool } from '../ai/tools/search_jobs';
import { getSalaryInsightTool } from '../ai/tools/get_salary_insight';
import { logger } from '../config/logger';

const CHAT_TOOLS = [searchJobsTool, getSalaryInsightTool];

export const aiController = {
  /** Streaming chatbot */
  chat: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { messages } = req.body as { messages: Array<{ role: string; content: string }> };
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const fullMessages = [{ role: 'system' as const, content: CHAT_SYSTEM_PROMPT }, ...messages as any];
      const stream = chatbotProvider.streamChat(fullMessages, { tools: CHAT_TOOLS });
      for await (const chunk of stream) {
        res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
      }
      res.write('data: [DONE]\n\n');
      res.end();
    } catch (err) { next(err); }
  },

  /** Parse CV (multipart upload) — queue async */
  parseCv: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.file) return next(new Error('No file uploaded'));
      const job = await aiQueue.add('cv-parse', {
        userId: req.user!.userId,
        file: { buffer: req.file.buffer.toString('base64'), mimetype: req.file.mimetype },
        cvId: req.body.cvId,
      });
      res.json({ success: true, data: { jobId: job.id } });
    } catch (err) { next(err); }
  },

  /** Score CV */
  scoreCv: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { cvData } = req.body as { cvData: Record<string, unknown> };
      const result = await generationProvider.chat(
        [{ role: 'system', content: CV_SCORE_SYSTEM_PROMPT }, { role: 'user', content: CV_SCORE_USER_PROMPT(JSON.stringify(cvData)) }],
        { temperature: 0.3 },
      );
      const score = JSON.parse(result.content);
      res.json({ success: true, data: score });
    } catch (err) { next(err); }
  },

  /** Generate JD */
  generateJd: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { title, industry, level, keywords } = req.body;
      const prompt = `Tạo Job Description cho vị trí "${title}" ngành ${industry} cấp ${level}. Keywords: ${keywords?.join(', ') ?? ''}. Trả về JSON {description, requirements, benefits}.`;
      const result = await generationProvider.chat([{ role: 'user', content: prompt }], { temperature: 0.7 });
      res.json({ success: true, data: JSON.parse(result.content) });
    } catch (err) { next(err); }
  },

  /** Generate cover letter */
  generateCoverLetter: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { cvData, jobDescription } = req.body;
      const prompt = `Viết cover letter 200-300 từ cho ứng viên với CV ${JSON.stringify(cvData)} apply vị trí có JD: ${jobDescription}`;
      const result = await generationProvider.chat([{ role: 'user', content: prompt }], { temperature: 0.7 });
      res.json({ success: true, data: { content: result.content } });
    } catch (err) { next(err); }
  },
};