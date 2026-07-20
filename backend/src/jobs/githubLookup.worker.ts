/**
 * GitHub Lookup worker — Phase 2
 * Background fetch GitHub profile (tránh block request)
 */
import { Worker } from 'bullmq';
import { redis } from '../config/redis';
import { logger } from '../config/logger';
import { githubLookupService } from '../service/githubLookup.service';

export const githubLookupWorker = new Worker(
  'ai',
  async (job) => {
    if (job.name === 'github-lookup') {
      const { username, cvId } = job.data as { username: string; cvId?: string };
      logger.info({ username }, 'Worker: GitHub lookup');
      const profile = await githubLookupService.lookup(username);
      // TODO: update cv.parsedData.githubProfile
      return profile;
    }
  },
  { connection: redis, concurrency: 5 },
);

githubLookupWorker.on('failed', (job, err) => logger.error({ jobId: job.id, err }, 'GitHub lookup failed'));