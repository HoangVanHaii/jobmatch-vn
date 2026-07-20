/**
 * Scan router — Phase 2
 */
import { Router } from 'express';
import { auth, employerOnly, adminOnly } from '../middleware/auth';
import { cvScanService } from '../service/cvScan.service';

export const scanRouter = Router();
scanRouter.use(auth, employerOnly);

// Chạy scan cho 1 application
scanRouter.post('/run/:applicationId', async (req, res, next) => {
  try {
    const result = await cvScanService.scan(req.params.applicationId);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

// Lấy kết quả scan
scanRouter.get('/result/:applicationId', async (req, res, next) => {
  try {
    // TODO: query ai_match_score + ai_match_reasoning
    res.json({ success: true, data: null });
  } catch (err) { next(err); }
});

// Scan hàng loạt
scanRouter.post('/bulk', async (req, res, next) => {
  try {
    const { applicationIds } = req.body as { applicationIds: string[] };
    await cvScanService.bulkScan(applicationIds);
    res.json({ success: true, message: `Scanning ${applicationIds.length} applications in background` });
  } catch (err) { next(err); }
});