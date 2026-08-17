
import type { Skill } from './skills';

export type SkillLevel = 1 | 2 | 3 | 4 | 5;

export interface CandidateSkill {
  candidateId: string;
  skillId: string;
  level: SkillLevel | null;
}

export type CandidateSkillWithSkill = CandidateSkill & {
  skill: Skill;
};

export interface CreateCandidateSkillPayload {
  skillId: string;
  level?: SkillLevel;
}

export interface AddCandidateSkillByNamePayload {
  name: string;
  level?: SkillLevel;
}

export type AddCandidateSkillByNameResult =
  | { added: true; row: CandidateSkill }
  | { added: false; reason: 'skill_not_found' | 'duplicate' };

export interface UpdateCandidateSkillPayload {
  level?: SkillLevel;
}
