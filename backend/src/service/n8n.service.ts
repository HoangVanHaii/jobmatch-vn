/**
 * n8n service — gọi webhook tới n8n workflow
 */
import axios from 'axios';
import { db } from '../config/database';
import { n8nWorkflowLogs } from '../db/schema';
import { logger } from '../config/logger';

const N8N_BASE_URL = process.env.N8N_BASE_URL || 'http://localhost:5678';

export const n8nService = {
  /**
   * Trigger 1 workflow bằng webhook
   * Workflow name map tới webhook URL: /webhook/{name}
   */
  trigger: async (workflowName: string, payload: Record<string, unknown>): Promise<any> => {
    const start = Date.now();
    const url = `${N8N_BASE_URL}/webhook/${workflowName}`;

    try {
      const res = await axios.post(url, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 30_000,
      });

      // Log success
      await db.insert(n8nWorkflowLogs).values({
        workflowName,
        status: 'success',
        input: payload,
        output: res.data,
        durationMs: Date.now() - start,
      });

      return res.data;
    } catch (err: any) {
      logger.error({ err, workflowName }, 'n8n workflow failed');
      await db.insert(n8nWorkflowLogs).values({
        workflowName,
        status: 'failed',
        input: payload,
        error: { message: err.message, code: err.code } as any,
        durationMs: Date.now() - start,
      });
      throw err;
    }
  },
};