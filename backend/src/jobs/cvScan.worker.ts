/**
 * CV Scan worker — Phase 2
 * Queue scan pipeline cho nhiều application
 */
import { Worker } from 'bullmq';
import { redis } from '../config/redis';
import { logger } from '../config/logger';
import { cvScanService } from '../service/cvScan.service';

export const cvScanWorker = new Worker(
  'ai',
  async (job) => {
    if (job.name === 'cv-scan') {
      const { applicationId } = job.data as { applicationId: string };
      logger.info({ applicationId, jobId: job.id }, 'Worker: CV scan started');
      return cvScanService.scan(applicationId);
    }
    if (job.name === 'cv-scan-bulk') {
      const { applicationIds } = job.data as { applicationIds: string[] };
      await cvScanService.bulkScan(applicationIds);
    }
  },
  { connection: redis, concurrency: 3 },
);

cvScanWorker.on('failed', (job, err) => logger.error({ jobId: job.id, err }, 'CV scan worker failed'));