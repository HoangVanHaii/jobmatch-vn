/**
 * CompanyMember types — đồng bộ với backend (company_members schema + controller response).
 * Frontend dùng các type này làm contract khi gọi companyMemberApi.
 */

/** Role của 1 member trong công ty (enum company_member_role ở DB) */
export type CompanyMemberRole = 'owner' | 'member';

/** Trạng thái membership (enum company_member_status ở DB) */
export type CompanyMemberStatus = 'active' | 'invited' | 'inactive';

/** Một dòng trong bảng company_members */
export interface CompanyMember {
  companyId: string;
  userId: string;
  role: CompanyMemberRole;
  status: CompanyMemberStatus;
  joinedAt: string; // ISO 8601
}

/**
 * Body POST /companies/:id/members — owner thêm member.
 * role CHỈ được là 'member' (Zod middleware khóa literal); status mặc định 'invited'.
 */
export interface AddCompanyMemberPayload {
  userId: string;
  role: CompanyMemberRole;
  status: CompanyMemberStatus;
}

/** Body PATCH /companies/:companyId/members/:userId — đổi role/status */
export interface UpdateCompanyMemberPayload {
  role?: CompanyMemberRole;
  status?: CompanyMemberStatus;
}

/** Body POST /companies/:id/transfer-owner — chuyển ownership */
export interface TransferCompanyOwnerPayload {
  newOwnerUserId: string;
}

/** Response của POST /companies/:id/transfer-owner — atomic swap */
export interface TransferCompanyOwnerResult {
  newOwner: CompanyMember;
  previousOwner: CompanyMember;
}
