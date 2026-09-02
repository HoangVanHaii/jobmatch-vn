/**
 * Candidate API — endpoints dành riêng cho role='candidate'.
 *
 * Hiện tại: profile (GET/PATCH).
 * Endpoint: GET /candidates/profile, PATCH /candidates/profile
 *
 * Pattern theo các services khác: trả AxiosResponse; caller tự destructure.
 */
import { http } from './http';

/**
 * Shape trả về từ BE — đồng bộ với backend `CandidateProfile`.
 *
 * - email: luôn có (từ bảng users, không qua OAuth claim).
 * - fullName/phone/avatarUrl: string | null (null = chưa set).
 * - location/social/preferences: object | null (null = block chưa có data).
 *   Khi set thì có thể chỉ chứa 1 vài key (vd: { city: 'HCM' }).
 */
export interface CandidateProfile {
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
  phone: string | null;
  location: { city?: string; district?: string } | null;
  social: { linkedin?: string; github?: string; portfolio?: string } | null;
  preferences: Record<string, unknown> | null;
}

/** Payload cho PATCH — tất cả field optional (partial update). */
export interface UpdateCandidateProfilePayload {
  fullName?: string;
  phone?: string;
  location?: { city?: string; district?: string };
  social?: { linkedin?: string; github?: string; portfolio?: string };
  preferences?: Record<string, unknown>;
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
}

export const candidateApi = {
  /** Đọc profile của candidate hiện tại. */
  getProfile: () => http.get<ApiResponse<CandidateProfile>>('/candidates/profile'),

  /**
   * Partial update profile.
   * Chỉ field nào gửi lên mới được update; field undefined → giữ nguyên.
   * Empty string → clear (set null).
   */
  updateProfile: (payload: UpdateCandidateProfilePayload) =>
    http.patch<ApiResponse<CandidateProfile>>('/candidates/profile', payload),
};
