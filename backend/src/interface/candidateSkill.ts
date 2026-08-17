
import type { candidateSkills } from '../db/schema/candidateSkills';
import type { skills } from '../db/schema/skills';

export type CandidateSkill = typeof candidateSkills.$inferSelect;

export type Skill = typeof skills.$inferSelect;

export type CandidateSkillWithSkill = CandidateSkill & {
  skill: Skill;
};

export interface CreateCandidateSkillInput {
  skillId: string;
  level?: number;
}

export interface AddCandidateSkillByNameInput {
  name: string;
  level?: number;
}

export interface UpdateCandidateSkillInput {
  level?: number;
}

export interface CandidateSkillPairParam {
  candidateId: string;
  skillId: string;
}

export interface CandidateIdParam {
  candidateId: string;
}

/** Response của GET /candidates/:candidateId/skills */
export type ListCandidateSkillsResponse = CandidateSkillWithSkill[];

/** Response của GET /candidates/:candidateId/skills/:skillId */
export type GetCandidateSkillResponse = CandidateSkillWithSkill;

/** Response của POST /candidates/:candidateId/skills */
export type CreateCandidateSkillResponse = CandidateSkill;

/**
 * Response của POST /candidates/:candidateId/skills/by-name.
 * Discriminated union để caller biết lý do skip (không phải error).
 */
export type AddCandidateSkillByNameResponse =
  | { added: true; row: CandidateSkill }
  | { added: false; reason: 'skill_not_found' | 'duplicate' };

/** Response của PATCH /candidates/:candidateId/skills/:skillId */
export type UpdateCandidateSkillResponse = CandidateSkill;

/** Response của DELETE /candidates/:candidateId/skills/:skillId */
export type DeleteCandidateSkillResponse = { id: string };
