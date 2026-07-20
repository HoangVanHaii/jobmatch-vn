import { Router } from 'express';
import { redis } from '../config/redis';
import { jobRouter } from './job';

export const searchRouter = Router();

searchRouter.use('/', jobRouter);

// Insight panel (cached 24h)
searchRouter.get('/insight', async (req, res, next) => {
  try {
    const keyword = String(req.query.keyword ?? '');
    const cacheKey = `insight:${keyword.toLowerCase()}`;
    const cached = await redis.get(cacheKey);
    if (cached) {
      res.json({ success: true, data: JSON.parse(cached) });
      return;
    }
    // TODO: aggregate from jobs + cvs
    const data = { jobCount: 0, salaryMedian: null, topSkills: [], topCompanies: [] };
    await redis.setex(cacheKey, 24 * 3600, JSON.stringify(data));
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

searchRouter.get('/suggest', async (req, res, next) => {
  try {
    // TODO: autocomplete từ job titles
    res.json({ success: true, data: [] });
  } catch (err) { next(err); }
});