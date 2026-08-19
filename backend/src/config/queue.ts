import { Queue } from 'bullmq';
import { redis } from './redis';

const queueOptions = {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: { count: 100, age: 24 * 3600 },
    removeOnFail: { count: 500 },
  },
};

export const emailQueue = new Queue('email', queueOptions);
export const aiQueue = new Queue('ai', queueOptions);
export const indexingQueue = new Queue('indexing', queueOptions);
export const exportQueue = new Queue('export', queueOptions);
export const jobModerationQueue = new Queue('jobModeration', queueOptions);
export const jobEmbeddingQueue = new Queue('jobEmbedding', queueOptions);

export type JobName =
  | 'send-email'
  | 'cv-parse'
  | 'cv-score'
  | 'match-compute'
  | 'jd-generate'
  | 'cover-letter'
  | 'reindex'
  | 'export-csv'
  | 'job-scan'
  | 'embed-job';