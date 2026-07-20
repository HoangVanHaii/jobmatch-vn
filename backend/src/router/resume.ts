import { Router } from 'express';
import { auth } from '../middleware/auth';
import { db } from '../config/database';
import { cvs } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { AppError } from '../middleware/errorHandler';
import { aiQueue } from '../config/queue';

export const resumeRouter = Router();
resumeRouter.use(auth);

resumeRouter.get('/', async (req, res, next) => {
  try {
    const rows = await db.query.cvs.findMany({ where: eq(cvs.candidateId, req.user!.userId) });
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
});

resumeRouter.post('/upload', async (req, res, next) => {
  try {
    if (!req.file) throw new AppError(400, 'NO_FILE', 'No file uploaded');
    // TODO: upload to MinIO → file_url
    const [cv] = await db.insert(cvs).values({
      candidateId: req.user!.userId,
      title: req.body.title ?? 'Untitled CV',
      fileType: req.file.mimetype.includes('pdf') ? 'pdf' : 'docx',
    }).returning();
    // Queue parse job
    await aiQueue.add('cv-parse', {
      cvId: cv.id,
      file: { buffer: req.file.buffer.toString('base64'), mimetype: req.file.mimetype },
    });
    res.status(201).json({ success: true, data: cv });
  } catch (err) { next(err); }
});

resumeRouter.get('/:id', async (req, res, next) => {
  try {
    const cv = await db.query.cvs.findFirst({ where: and(eq(cvs.id, req.params.id), eq(cvs.candidateId, req.user!.userId)) });
    if (!cv) throw new AppError(404, 'NOT_FOUND', 'CV not found');
    res.json({ success: true, data: cv });
  } catch (err) { next(err); }
});

resumeRouter.post('/:id/score', async (req, res, next) => {
  try {
    await aiQueue.add('cv-score', { cvId: req.params.id });
    res.json({ success: true, message: 'Scoring queued' });
  } catch (err) { next(err); }
});

resumeRouter.delete('/:id', async (req, res, next) => {
  try {
    await db.delete(cvs).where(and(eq(cvs.id, req.params.id), eq(cvs.candidateId, req.user!.userId)));
    res.json({ success: true });
  } catch (err) { next(err); }
});