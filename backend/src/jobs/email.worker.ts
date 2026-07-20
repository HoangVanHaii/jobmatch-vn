/**
 * BullMQ worker — transactional email
 */
import { Worker } from 'bullmq';
import { redis } from '../config/redis';
import { logger } from '../config/logger';
import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '1025', 10),
  secure: false,
  auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
});

export const emailWorker = new Worker(
  'email',
  async (job) => {
    if (job.name !== 'send-email') return;
    const { to, subject, html } = job.data as { to: string; subject: string; html: string };
    await transporter.sendMail({ from: process.env.SMTP_FROM, to, subject, html });
    logger.info({ to, subject }, 'Email sent');
  },
  { connection: redis, concurrency: 5 },
);

emailWorker.on('failed', (job, err) => logger.error({ jobId: job.id, err }, 'Email failed'));