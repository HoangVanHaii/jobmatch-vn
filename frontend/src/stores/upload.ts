/**
 * Upload Pinia store — chỉ chứa logic upload file/ảnh lên MinIO qua /uploads.
 *
 * Phân trách nhiệm (theo pattern skills/cv store):
 *   - `uploadApi`: gọi HTTP, trả AxiosResponse.
 *   - Store này: unwrap + giữ state transient (loading/error/lastResult),
 *     bắt lỗi → message tiếng Việt thân thiện. UI chỉ đọc state + gọi action.
 *
 * Tại sao tách store riềng cho upload (không nhét vào cv store):
 *   - Upload có 2 endpoint với MIME whitelist khác nhau (`/uploads/file`
 *     cho CV PDF/DOCX, `/uploads/image` cho avatar/logo/cover) — API call
 *     dùng ở nhiều view (CreateResumeView, ChatComposer, …), không gắn
 *     với domain CV.
 *   - Tách store giúp reuse cho mọi chỗ cần upload file hoặc image mà
 *     không pull theo cv store (loading/error của CV).
 *
 * Local UI state vẫn giữ ở view (vd `avatarError`, `cvFileUploading`); store
 * chỉ chứa state có thể dùng chung hoặc phục vụ retry logic.
 */
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { uploadApi, type UploadResult } from '@services/upload.api';
import type { ApiResponse } from '@services/upload.api';

/**
 * Trả message lỗi thân thiện từ nhiều nguồn:
 *   - Axios error response (`response.data.error.message`) — từ BE.
 *   - Error thuần (JS Error) — message upload từ uploadApi FE guard.
 *   - Fallback chung.
 */
const extractErrorMessage = (e: unknown): string => {
  const axiosErr = e as { response?: { data?: { error?: { message?: string } } } };
  const fromBe = axiosErr?.response?.data?.error?.message;
  if (fromBe) return fromBe;
  if (e instanceof Error && e.message) return e.message;
  return 'Upload thất bại. Vui lòng thử lại.';
};

export const useUploadStore = defineStore('upload', () => {
  // --- State ---
  const loading = ref(false);
  const error = ref<string | null>(null);
  /** Kết quả upload gần nhất (để caller truy cập url/key ngay nếu cần). */
  const lastResult = ref<UploadResult | null>(null);

  // --- Actions ---

  /**
   * Upload ảnh (avatar/logo/cover) qua POST /uploads/image.
   * MIME whitelist: jpeg/png/webp/gif, ≤5MB — validate cả FE (uploadApi) +
   * BE (multer uploadImage). Trả về UploadResult để caller lấy url.
   *
   * @returns UploadResult nếu thành công, null nếu lỗi.
   */
  const uploadImage = async (
    file: File,
    folder: string = 'avatars',
  ): Promise<UploadResult | null> => {
    loading.value = true;
    error.value = null;
    try {
      const { data } = await uploadApi.uploadImage(file, folder);
      lastResult.value = data.data;
      return data.data;
    } catch (e) {
      error.value = extractErrorMessage(e);
      return null;
    } finally {
      loading.value = false;
    }
  };

  /**
   * Upload file (CV PDF/DOCX/image) qua POST /uploads/file.
   * Whitelist BE: PDF + DOCX + image, ≤10MB.
   *
   * @returns UploadResult nếu thành công, null nếu lỗi.
   */
  const uploadFile = async (
    file: File,
    folder: string = 'cvs',
  ): Promise<UploadResult | null> => {
    loading.value = true;
    error.value = null;
    try {
      const { data } = await uploadApi.uploadFile(file, folder);
      lastResult.value = data.data;
      return data.data;
    } catch (e) {
      error.value = extractErrorMessage(e);
      return null;
    } finally {
      loading.value = false;
    }
  };

  /** Xoá error state (vd sau khi view đóng modal error). */
  const clearError = (): void => {
    error.value = null;
  };

  return {
    // state
    loading, error, lastResult,
    // actions
    uploadImage, uploadFile, clearError,
  };
});
