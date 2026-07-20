/**
 * Tool: search_jobs — cho phép chatbot gọi API tìm việc
 */
import type { ToolDefinition } from '../providers/base';

export const searchJobsTool: ToolDefinition = {
  name: 'search_jobs',
  description: 'Tìm kiếm việc làm theo tiêu chí: keyword, location, salary range, job level, job type.',
  parameters: {
    type: 'object',
    properties: {
      keyword: { type: 'string', description: 'Từ khoá (VD: Java Developer, Marketing)' },
      location: { type: 'string', description: 'Địa điểm (VD: HCM, Hà Nội)' },
      salaryMin: { type: 'number', description: 'Lương tối thiểu (VND)' },
      salaryMax: { type: 'number', description: 'Lương tối đa (VND)' },
      jobLevel: { type: 'string', enum: ['intern', 'fresher', 'junior', 'mid', 'senior', 'lead', 'manager'] },
      jobType: { type: 'string', enum: ['full-time', 'part-time', 'contract', 'internship'] },
      limit: { type: 'number', description: 'Số kết quả trả về', default: 10 },
    },
  },
};