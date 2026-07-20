/**
 * CV Scan service — Phase 2 core
 * Auto-screening CV theo JD bằng AI matching rubric
 */
import { db } from '../config/database';
import { applications, cvs, jobs, referenceVerifications } from '../db/schema';
import { eq } from 'drizzle-orm';
import { parsingProvider, generationProvider } from '../config/ai';
import { CV_SCAN_SYSTEM_PROMPT, CV_SCAN_USER_PROMPT } from '../ai/prompts/cv_scan.v1';
import { githubLookupService } from './githubLookup.service';
import { logger } from '../config/logger';
import { n8nService } from './n8n.service';

export interface ScanBreakdown {
  yearsExp: number;            // 0-25
  requiredSkills: number;      // 0-30
  education: number;           // 0-10
  certifications: number;      // 0-5
  industryHistory: number;     // 0-5
  locationFit: number;         // 0-5
  github: number;              // 0-10
  references: number;          // 0-5
  coverLetter: number;         // 0-5
  total: number;               // 0-100
}

export const cvScanService = {
  /**
   * Chạy scan pipeline cho 1 application
   * - Lấy JD + CV
   * - LLM extract JD requirements
   * - LLM score từng tiêu chí
   * - GitHub lookup
   * - Reference status
   * - Lưu kết quả + trigger auto-reject nếu score < 50
   */
  scan: async (applicationId: string): Promise<{ score: number; reasoning: ScanBreakdown }> => {
    logger.info({ applicationId }, 'Starting CV scan...');

    // 1. Lấy application + CV + JD
    const app = await db.query.applications.findFirst({
      where: eq(applications.id, applicationId),
      with: { job: true, cv: true },
    });
    if (!app || !app.cv) throw new Error('Application or CV not found');

    const jd = app.job;
    const cv = app.cv;

    // 2. LLM score breakdown
    const cvJson = cv.parsedData ?? {};
    const jdReq = {
      requiredSkills: jd.requiredSkills,
      niceToHave: jd.niceToHaveSkills,
      experienceYearsMin: jd.experienceYearsMin,
      experienceYearsMax: jd.experienceYearsMax,
      educationLevel: jd.educationLevel,
      certifications: jd.certifications,
      industryRequired: jd.industryRequired,
      location: jd.location,
      remoteOk: jd.remoteOk,
    };

    const scoreRes = await generationProvider.chat(
      [
        { role: 'system', content: CV_SCAN_SYSTEM_PROMPT },
        { role: 'user', content: CV_SCAN_USER_PROMPT(JSON.stringify(jdReq), JSON.stringify(cvJson), app.coverLetter ?? '') },
      ],
      { temperature: 0.2 },
    );

    const breakdown: ScanBreakdown = JSON.parse(scoreRes.content);

    // 3. GitHub lookup bonus
    const githubUrl = cvJson?.github_url as string | undefined;
    if (githubUrl) {
      const gh = await githubLookupService.lookupFromUrl(githubUrl);
      breakdown.github = gh.exists && gh.has_activity ? 10 : (gh.exists ? 5 : 0);
    }

    // 4. References bonus
    const refs = await db.query.referenceVerifications.findMany({
      where: eq(referenceVerifications.applicationId, applicationId),
    });
    const verifiedRefs = refs.filter((r) => r.status === 'verified').length;
    breakdown.references = Math.min(5, verifiedRefs * 2);

    // 5. Tổng hợp
    breakdown.total = Math.min(100, Math.round(
      breakdown.yearsExp + breakdown.requiredSkills + breakdown.education +
      breakdown.certifications + breakdown.industryHistory + breakdown.locationFit +
      breakdown.github + breakdown.references + breakdown.coverLetter
    ));

    // 6. Lưu kết quả
    let newStatus = app.status;
    if (breakdown.total >= 75) newStatus = 'viewed'; // chuyển sang screening
    else if (breakdown.total < 50) newStatus = 'rejected';

    await db.update(applications).set({
      aiMatchScore: breakdown.total.toString(),
      aiMatchReasoning: breakdown,
      scanCompletedAt: new Date(),
      status: newStatus,
      stage: breakdown.total >= 75 ? 'screening' : app.stage,
    }).where(eq(applications.id, applicationId));

    // 7. Auto-reject qua n8n nếu score < 50
    if (breakdown.total < 50) {
      await n8nService.trigger('auto_reject', { applicationId, reason: breakdown });
    }

    logger.info({ applicationId, score: breakdown.total }, 'CV scan completed');
    return { score: breakdown.total, reasoning: breakdown };
  },

  /**
   * Scan hàng loạt — HR chọn nhiều application
   */
  bulkScan: async (applicationIds: string[]): Promise<void> => {
    for (const id of applicationIds) {
      try { await cvScanService.scan(id); }
      catch (err) { logger.error({ err, id }, 'Bulk scan failed for application'); }
    }
  },
};