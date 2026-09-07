import { Request, Response, NextFunction } from 'express';
import { candidateService } from '../service/candidate.service';
import { generateCoverLetter } from '../lib/llm/coverLetter';
import { db } from '../config/database';
import { cvs, jobs, companies } from '../db/schema';
import { eq } from 'drizzle-orm';
import { AppError } from '../middleware/errorHandler';
import type { GenerateCoverLetterBody } from '../middleware/coverLetter';

export const candidateController = {
  getProfile: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const data = await candidateService.getProfile(userId);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  updateProfile: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const data = await candidateService.updateProfile(userId, req.body);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  generateCoverLetter: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const { jobId, cvId, language } = req.body as GenerateCoverLetterBody;

      // 1. Resolve job + company.
      const [jobRow] = await db
        .select({
          id: jobs.id,
          title: jobs.title,
          industry: jobs.industry,
          description: jobs.description,
          requirements: jobs.requirements,
          jobLevel: jobs.jobLevel,
          requiredSkills: jobs.requiredSkills,
          niceToHaveSkills: jobs.niceToHaveSkills,
          experienceYearsMin: jobs.experienceYearsMin,
          companyName: companies.name,
        })
        .from(jobs)
        .leftJoin(companies, eq(companies.id, jobs.companyId))
        .where(eq(jobs.id, jobId))
        .limit(1);
      if (!jobRow) throw new AppError(404, 'JOB_NOT_FOUND', 'Job không tồn tại');

      let cvParsedData: Record<string, unknown> | null = null;
      if (cvId) {
        const [cv] = await db
          .select({
            candidateId: cvs.candidateId,
            parsedData: cvs.parsedData,
          })
          .from(cvs)
          .where(eq(cvs.id, cvId))
          .limit(1);
        if (!cv) throw new AppError(404, 'CV_NOT_FOUND', 'CV không tồn tại');
        if (cv.candidateId !== userId) {
          throw new AppError(403, 'CV_FORBIDDEN', 'CV không thuộc về bạn');
        }
        cvParsedData = (cv.parsedData ?? null) as Record<string, unknown> | null;
      }

      // 3. Call LLM.
      const result = await generateCoverLetter({
        cv: cvParsedData,
        language,
        job: {
          title: jobRow.title,
          companyName: jobRow.companyName,
          industry: jobRow.industry,
          description: jobRow.description,
          requirements: jobRow.requirements,
          jobLevel: jobRow.jobLevel,
          requiredSkills: jobRow.requiredSkills ?? [],
          niceToHaveSkills: jobRow.niceToHaveSkills ?? [],
          experienceYearsMin: jobRow.experienceYearsMin,
        },
      });

      res.json({ success: true, data: { content: result.content } });
    } catch (err) {
      next(err);
    }
  },
};
