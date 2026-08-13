/**
 * Skills types — đồng bộ với backend (skills schema + controller response).
 * Frontend dùng các type này làm contract khi gọi skillsApi.
 *
 * Skills là dữ liệu master do admin quản lý. Skill chỉ có name + slug + status
 * (category / demandCount đã được loại bỏ — xem migration 0007 BE).
 */

/** Soft-delete lifecycle status (enum skill_status ở DB) */
export type SkillStatus = 'active' | 'deleted';

/** Một dòng trong bảng skills */
export interface Skill {
  id: string;
  name: string;
  slug: string;
  status: SkillStatus;
}

/** Payload tạo skill — POST /skills (admin).
 *  Không có status (DB default 'active'). */
export interface CreateSkillPayload {
  name: string;
  slug: string;
}

/** Payload cập nhật — PATCH /skills/:skillId (admin, tất cả field optional). */
export type UpdateSkillPayload = Partial<CreateSkillPayload>;

/** Query GET /skills — admin có thể ?includeDeleted=true để xem cả skill đã soft-delete. */
export interface ListSkillsQuery {
  includeDeleted?: boolean;
}