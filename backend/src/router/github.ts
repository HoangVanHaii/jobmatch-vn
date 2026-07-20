/**
 * GitHub router — Phase 2
 */
import { Router } from 'express';
import { auth } from '../middleware/auth';
import { githubLookupService } from '../service/githubLookup.service';

export const githubRouter = Router();
githubRouter.use(auth);

// Tra cứu theo username
githubRouter.get('/lookup/:username', async (req, res, next) => {
  try {
    const profile = await githubLookupService.lookup(req.params.username);
    res.json({ success: true, data: profile });
  } catch (err) { next(err); }
});

// Tra cứu từ CV đã parse (lấy URL GitHub trong CV)
githubRouter.get('/lookup/cv/:cvId', async (req, res, next) => {
  try {
    // TODO: query cv.parsedData.github_url
    const cv = { parsedData: { github_url: 'https://github.com/octocat' } };
    const url = (cv.parsedData as any).github_url;
    if (!url) return res.json({ success: true, data: null });
    const profile = await githubLookupService.lookupFromUrl(url);
    res.json({ success: true, data: profile });
  } catch (err) { next(err); }
});

// Force refresh (bypass cache)
githubRouter.post('/refresh/:cvId', async (req, res, next) => {
  try {
    // TODO: clear cache + re-fetch
    res.json({ success: true });
  } catch (err) { next(err); }
});