
import { http } from './http';
import type {
  AddCandidateSkillByNamePayload,
  AddCandidateSkillByNameResult,
  CandidateSkill,
  CandidateSkillWithSkill,
  CreateCandidateSkillPayload,
  UpdateCandidateSkillPayload,
} from '@/types/candidateSkill';

export interface ApiResponse<T> {
  success: boolean;
  data: T;
}

export const candidateSkillApi = {

  list: () => http.get<ApiResponse<CandidateSkillWithSkill[]>>('/skills'),

  getById: (skillId: string) =>
    http.get<ApiResponse<CandidateSkillWithSkill>>(`/skills/${skillId}`),
  
  addByName: (payload: AddCandidateSkillByNamePayload) =>
    http.post<ApiResponse<AddCandidateSkillByNameResult>>('/skills/by-name', payload),

  create: (payload: CreateCandidateSkillPayload) =>
    http.post<ApiResponse<CandidateSkill>>('/skills', payload),

  update: (skillId: string, payload: UpdateCandidateSkillPayload) =>
    http.patch<ApiResponse<CandidateSkill>>(`/skills/${skillId}`, payload),

  remove: (skillId: string) =>
    http.delete<ApiResponse<{ id: string }>>(`/skills/${skillId}`),
};