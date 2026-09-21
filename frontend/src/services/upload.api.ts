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

/** MIME map cho chat attachment non-image — khớp với FILE_MIME ở BE. */
const CHAT_FILE_MIME = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
  'application/zip',
  'application/x-zip-compressed',
] as const;

/** Chuyển byte → KB/MB hiển thị cho user. */
export const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

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
   * Upload ảnh (avatar, logo, cover, chat attachment, ...) — POST /uploads/image.
   * MIME: image/jpeg | image/png | image/webp | image/gif, tối đa 10MB.
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
    if (file.size > 10 * 1024 * 1024) {
      return Promise.reject(new Error('Ảnh tối đa 10MB.'));
    }
    const formData = new FormData();
    formData.append('file', file);
    formData.append('folder', folder);
    return http.post<ApiResponse<UploadResult>>('/uploads/image', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },

  /**
   * Upload attachment cho chat (cả ảnh và file) — wrapper dispatch theo MIME:
   *   - image/*  → POST /uploads/image (folder='chat')
   *   - file khác → POST /uploads/file (folder='chat')
   *
   * Trả về UploadResult + `kind` discriminator để MessageInput quyết định
   * render thumbnail (image) hay file card (file) khi preview.
   *
   * Phase 1 (chat): chỉ hỗ trợ image. Phase 2: mở rộng file (PDF/DOCX/XLSX/ZIP...).
   *
   * @throws Error nếu MIME không nằm trong whitelist.
   */
  uploadChatAttachment: async (
    file: File,
  ): Promise<UploadResult & { kind: 'image' | 'file'; name: string }> => {
    const isImage = file.type.startsWith('image/');
    if (isImage) {
      if (!IMAGE_MIME.includes(file.type as (typeof IMAGE_MIME)[number])) {
        return Promise.reject(
          new Error(`Định dạng ảnh không hỗ trợ (${file.type}). Chỉ chấp nhận JPG, PNG, WEBP, GIF.`),
        );
      }
      const { data } = await uploadApi.uploadImage(file, 'chat');
      return { ...data.data, kind: 'image', name: file.name };
    }
    // Non-image file
    if (!CHAT_FILE_MIME.includes(file.type as (typeof CHAT_FILE_MIME)[number])) {
      return Promise.reject(
        new Error(
          `Loại file không hỗ trợ (${file.type || 'unknown'}). Chỉ chấp nhận PDF, DOC/DOCX, XLS/XLSX, PPT, TXT, CSV, ZIP.`,
        ),
      );
    }
    if (file.size > 10 * 1024 * 1024) {
      return Promise.reject(new Error('File tối đa 10MB.'));
    }
    const { data } = await uploadApi.uploadFile(file, 'chat');
    return { ...data.data, kind: 'file', name: file.name };
  },
};
