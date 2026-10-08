/**
 * Reference verification API client.
 *
 *   Employer (auth):
 *   - GET  /references/application/:applicationId        list referees + verifications
 *   - POST /references/application/:applicationId/send   gửi email xác minh qua n8n
 *
 *   Public (referee — token trong URL, KHÔNG auth):
 *   - GET  /references/public/:token          info render form
 *   - POST /references/public/:token/submit   confirm/decline
 *
 * Pattern giống application.api.ts: trả AxiosResponse, caller tự unwrap `data.data`.
 */
import { http } from './http';

export interface ApiResponse<T> {
  success: boolean;
  data: T;
}

/** Referee LLM extract từ CV (cvs.parsed_data.references) — template để HR chọn gửi. */
export interface CvReferenceSource {
  name: string;
  email?: string;
  phone?: string;
  relationship?: string;
  company?: string;
  position?: string;
}

export interface ReferenceVerificationRow {
  id: string;
  refereeName: string;
  refereeEmail: string;
  relationship: string | null;
  company: string | null;
  status: string; // pending | sent | verified | failed
  sentAt: string | null;
  verifiedAt: string | null;
  expiresAt: string | null;
  response: { confirmed: boolean; notes?: string } | null;
}

export interface ReferenceListResult {
  source: CvReferenceSource[];
  verifications: ReferenceVerificationRow[];
}

export interface SentVerification {
  id: string;
  status: string;
  expiresAt: string;
}

export interface PublicReferenceInfo {
  refereeName: string;
  candidateName: string;
  jobTitle: string;
  relationship: string | null;
  company: string | null;
  status: string;
  expired: boolean;
  expiresAt: string | null;
}

export interface SubmitResult {
  status: 'verified' | 'failed';
  verifiedAt: string;
}

export const referenceApi = {
  /** GET /references/application/:id — HR xem referees của application. */
  listForApplication: (applicationId: string) =>
    http.get<ApiResponse<ReferenceListResult>>(`/references/application/${applicationId}`),

  /** POST /references/application/:id/send — HR gửi email xác minh 1 referee. */
  send: (
    applicationId: string,
    body: { refereeName: string; refereeEmail: string; relationship?: string; company?: string },
  ) => http.post<ApiResponse<SentVerification>>(`/references/application/${applicationId}/send`, body),

  /** GET /references/public/:token — referee mở link (public). */
  getByToken: (token: string) =>
    http.get<ApiResponse<PublicReferenceInfo>>(`/references/public/${token}`),

  /** POST /references/public/:token/submit — referee xác nhận/từ chối (public). */
  submit: (token: string, body: { confirmed: boolean; notes?: string }) =>
    http.post<ApiResponse<SubmitResult>>(`/references/public/${token}/submit`, body),
};
