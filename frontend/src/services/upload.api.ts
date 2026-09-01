/**
 * Upload API — giao tiếp với backend /uploads (MinIO).
 *
 * Có 2 endpoint riêng biệt trên backend (router/upload.ts), mỗi cái có
 * multer instance riêng với MIME whitelist khác nhau:
 *
 *   POST /uploads/file   — `uploadMiddleware` (PDF/DOCX + image, 10MB).
 *                          Dùng cho CV upload (CreateResumeView mode=upload).
 *   POST /uploads/image  — `uploadImage` (jpeg/png/webp/gif, 5MB).
 *                          Dùng cho avatar / logo / cover — mọi nơi cần
 *                          upload ảnh. Avatar PHẢI dùng cái này; nếu gọi
 *                          sang /uploads/file thì uploadMiddleware sẽ reject
 *                          image/jpeg với 400 INVALID_FILE_TYPE.
 *   DELETE /uploads?key= — xoá theo key (chưa có wrapper — flow hiện không
 *                          cần rollback vì user chọn nhầm file thì xoá file
 *                          pill trong UI là đủ).
 *
 * Folder whitelist (backend): 'images' | 'avatars' | 'logos' | 'covers' |
 * 'cvs' | 'files' | 'general' | 'chat'.
 *   - `folder='cvs'` cho CV upload.
 *   - `folder='avatars'` cho avatar (mặc định của `uploadImage`).
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

/** MIME map cho image upload — khớp với IMAGE_MIME ở backend middleware/upload.ts. */
const IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;

export const uploadApi = {
  /**
   * Upload CV (PDF/DOCX/image, 10MB) — POST /uploads/file.
   * Dùng trong flow "Upload CV" của CreateResumeView (mode=upload).
   */
  uploadFile: (file: File, folder: string = 'cvs') => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('folder', folder);
    return http.post<ApiResponse<UploadResult>>('/uploads/file', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },

  /**
   * Upload ảnh (avatar, logo, cover, ...) — POST /uploads/image.
   * MIME: image/jpeg | image/png | image/webp | image/gif, tối đa 5MB.
   * Folder mặc định 'avatars'.
   *
   * @throws Error message từ backend (vd. "Image type image/svg+xml not
   *   allowed") nếu MIME không nằm trong whitelist.
   */
  uploadImage: (file: File, folder: string = 'avatars') => {
    // FE-side guard để fail-fast với message rõ ràng trước khi tốn 1 round-trip.
    if (!IMAGE_MIME.includes(file.type as (typeof IMAGE_MIME)[number])) {
      return Promise.reject(
        new Error(
          `Định dạng ảnh không hỗ trợ (${file.type}). Chỉ chấp nhận JPG, PNG, WEBP, GIF.`,
        ),
      );
    }
    if (file.size > 5 * 1024 * 1024) {
      return Promise.reject(new Error('Ảnh tối đa 5MB.'));
    }
    const formData = new FormData();
    formData.append('file', file);
    formData.append('folder', folder);
    return http.post<ApiResponse<UploadResult>>('/uploads/image', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
};
