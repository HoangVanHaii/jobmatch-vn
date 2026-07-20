/**
 * Tool: get_salary_insight
 */
import type { ToolDefinition } from '../providers/base';

export const getSalaryInsightTool: ToolDefinition = {
  name: 'get_salary_insight',
  description: 'Lấy thông tin mức lương trung bình cho vị trí + location + experience.',
  parameters: {
    type: 'object',
    properties: {
      position: { type: 'string', description: 'Vị trí (VD: Backend Developer)' },
      location: { type: 'string', description: 'Địa điểm' },
      yearsOfExperience: { type: 'number', description: 'Số năm kinh nghiệm' },
    },
    required: ['position'],
  },
};