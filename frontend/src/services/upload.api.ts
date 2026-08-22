/**
 * Upload API — giao tiếp với backend /uploads (MinIO).
 *
 * Luồng: client chọn file → POST multipart /uploads/file → backend đẩy
 * lên MinIO qua multer → trả public URL. Nơi gọi (vd. CreateResumeView)
 * dùng `url` để gán vào payload khi tạo CV (source='upload').
 *
 * Endpoint backend (router/upload.ts):
 *   POST   /uploads/file          multipart, field `file` (PDF/DOCX/image, 10MB)
 *   DELETE /uploads?key=...       xoá theo key (chưa có wrapper — flow hiện
 *                                 không cần rollback vì user chọn nhầm file
 *                                 thì xoá file pill trong UI là đủ).
 *
 * Folder whitelist (backend): 'images' | 'avatars' | 'logos' | 'covers' |
 * 'cvs' | 'files' | 'general' | 'chat'. Dùng `folder='cvs'` khi upload CV.
 */
import { http } from './http';

export interface UploadResult {
  url: string;
  key: string;
  mime: string;
  size: number;
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
}

export const uploadApi = {
  /** Upload file (PDF/DOCX/image, 10MB) — folder optional, default 'cvs'. */
  uploadFile: (file: File, folder: string = 'cvs') => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('folder', folder);
    return http.post<ApiResponse<UploadResult>>('/uploads/file', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
};
