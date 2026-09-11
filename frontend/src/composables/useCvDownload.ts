/**
 * useCvDownload — composable chia sẻ logic download CV.
 *
 * Tại sao tách composable (thay vì inline trong CvPreview/MyResumesView):
 *   - Logic download giống hệt ở 2 nơi: modal preview + card kebab menu.
 *   - Duplicate 2 chỗ → 1 fix phải sửa 2 file. Tách ra 1 chỗ duy nhất.
 *   - 2 entry point (preview + menu) cùng gọi `handleDownload(cv)` → toast,
 *     error handling, filename sanitize đồng bộ.
 *
 * 2 actions:
 *   - handleDownload(cv) — smart download:
 *       Direct CV → GET /cvs/:cvId/download-pdf (Bearer auth, blob response).
 *                   BE render vector PDF qua Playwright + Chromium.
 *       Upload CV → GET fileUrl thành blob (BẮT BUỘC), rồi mới anchor download.
 *                   Lý do: `a.download` attribute BỊ TRÌNH DUYỆT BỎ QUA với
 *                   cross-origin URL (pre-signed MinIO, S3, CDN…). Browser
 *                   sẽ mở file trong tab thay vì tải về máy → đúng spec HTML5.
 *                   Dùng raw `fetch()` (không axios) để tránh Authorization
 *                   header → không trigger CORS preflight phức tạp với MinIO.
 *                   URL đã public-read (bucket policy). Blob → createObjectURL
 *                   → same-origin URL → `download` attribute hoạt động.
 *
 *   - handleOpenOriginal(cv) — mở file gốc trong tab mới (chỉ upload).
 *
 * Edge cases xử lý:
 *   - Filename có ký tự `/\\?%*:|"<>` → sanitize thành `-` (Windows path-safe).
 *   - Filename rỗng / null → fallback 'CV'.
 *   - Direct CV không có file gốc → canOpenOriginal = false.
 *   - Playwright render lâu (>30s) → timeout riêng 60s.
 *   - Upload file fetch lâu (10MB + mạng chậm) → timeout 30s.
 *   - Blob URL cleanup → revoke sau 1s để browser kịp start download.
 *   - Fetch upload fail (CORS / 404 / network) → toast.error chung.
 */
import { computed, ref } from 'vue';
import { http } from '@/services/http';
import { useToastStore } from '@stores/toast';
import type { Cv } from '@/types/cv';

/**
 * Throttle state ở MODULE-LEVEL (không phải closure) để share giữa tất cả
 * `useCvDownload()` instances.
 *
 * Lý do: composable được gọi ở 2 nơi (CvPreview modal + MyResumesView kebab
 * menu). Mỗi component instance tạo composable riêng → nếu `lastActionAt`
 * ở closure, mỗi instance có timer riêng → user bypass throttle bằng cách
 * đổi qua lại giữa modal và menu. Lift lên module-level → tất cả instance
 * share cùng state → throttle thực sự chống spam xuyên component.
 *
 * Trade-off: state persist qua route change trong cùng SPA session (cùng
 * JS module instance). Acceptable cho mục đích chống spam. Reset khi user
 * reload page hoặc logout (window object recreated).
 */
const MIN_DOWNLOAD_INTERVAL_MS = 2_000;
let lastActionAt = 0;

export function useCvDownload() {
  const toast = useToastStore();
  const downloading = ref(false);

  /** True nếu CV có fileUrl (upload source) — cho phép mở file gốc. */
  const canOpenOriginal = (cv: Cv | null | undefined): boolean =>
    !!cv && cv.source === 'upload' && !!cv.fileUrl;

  /** Tooltip giải thích tại sao nút bị disable. */
  const openOriginalTooltip = (cv: Cv | null | undefined): string =>
    canOpenOriginal(cv)
      ? 'Mở file gốc trong tab mới'
      : 'CV tạo trực tiếp không có file gốc';

  /** Loại ký tự gây lỗi path trên Windows. */
  const sanitizeFilename = (name: string | null | undefined, ext: string): string => {
    const base = (name || 'CV')
      .replace(/[/\\?%*:|"<>]/g, '-')
      .trim()
      .slice(0, 200) || 'CV';
    return ext ? `${base}.${ext}` : base;
  };

  /** Map MIME → extension (cho filename khi download file gốc upload). */
  const extFromMime = (mime: string | undefined | null): string => {
    if (!mime) return '';
    const m = mime.toLowerCase();
    if (m === 'application/pdf') return 'pdf';
    if (m === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx';
    if (m === 'application/msword') return 'doc';
    if (m === 'image/jpeg') return 'jpg';
    if (m === 'image/png') return 'png';
    if (m === 'image/webp') return 'webp';
    return '';
  };

  /** Trigger browser download từ Blob (object URL là same-origin → `download`
   *  attribute hoạt động). Revoke URL sau 1s để browser kịp start download. */
  const triggerBlobDownload = (blob: Blob, filename: string): void => {
    const url = URL.createObjectURL(blob);
    try {
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  };

  /**
   * Throttle chung cho 3 actions download/open file — dùng 1 biến `lastActionAt`
   * chia sẻ (không phải 3 biến riêng) để user không thể né throttle bằng cách
   * đổi qua lại giữa handleDownload và handleOpenOriginal.
   *
   * Lý do cần throttle ở FE dù BE đã có rate limit:
   *   - `cvDownloadRateLimiter` chỉ chặn BE endpoint `/download-pdf` (direct CV).
   *   - Upload CV download (FE fetch thẳng MinIO) bypass BE hoàn toàn.
   *   - `handleOpenOriginal` (window.open) không qua bất kỳ middleware nào.
   *
   * Throttle window 2s: đủ chặn spam bấm nút liên tục, không ảnh hưởng UX
   * bình thường (user hiếm khi tải/open CV <2s/lần trong flow thật).
   *
   * Trả về `true` nếu BỊ throttle (đã hiện toast) → caller return ngay.
   * Trả về `false` nếu OK → caller tiếp tục logic.
   *
   * Lưu ý: KHÔNG phụ thuộc vào `downloading.value` (chỉ chặn concurrent).
   * User có thể spam tuần tự nhanh → `downloading.value` toggle true/false
   * trong từng tick, không chặn được. Throttle mới giải quyết case này.
   *
   * Module-level state: `useCvDownload()` được gọi ở 2 nơi (modal preview ở
   * CvPreview.vue + kebab menu ở MyResumesView.vue), mỗi component tạo
   * composable instance riêng. Nếu `lastActionAt` là closure variable, mỗi
   * instance có state riêng → user có thể spam bằng cách đổi qua lại giữa
   * modal và menu. Lift lên module-level để MỌI instance share cùng state.
   */
  const checkThrottle = (): boolean => {
    const now = Date.now();
    if (now - lastActionAt < MIN_DOWNLOAD_INTERVAL_MS) {
      toast.warning('Bạn vừa thao tác. Vui lòng đợi vài giây.');
      return true;
    }
    lastActionAt = now;
    return false;
  };

  /**
   * Smart download:
   *   - Direct CV → gọi BE Playwright endpoint, nhận PDF blob, anchor download.
   *   - Upload CV → fetch fileUrl thành blob qua raw `fetch()` (KHÔNG dùng
   *                 axios để tránh thêm Authorization header → CORS preflight
   *                 phức tạp với MinIO). URL đã public qua bucket policy,
   *                 browser gửi request simple (GET + Accept) là đủ. Sau đó
   *                 anchor download từ blob. Bắt buộc fetch blob vì
   *                 `a.download` không work với cross-origin URL.
   *
   * Idempotent: gọi đồng thời lần 2 sẽ bị block bởi `downloading.value`.
   */
  const handleDownload = async (cv: Cv | null | undefined): Promise<void> => {
    if (!cv || downloading.value) return;
    // Throttle check đặt SAU guard `downloading.value` để:
    //   - Nếu đang có download khác chạy → skip throttle, return luôn
    //     (không spam toast warning liên tục trong khi request đang xử lý).
    //   - Nếu rảnh → check throttle 2s, OK thì set `downloading.value = true`.
    if (checkThrottle()) return;
    downloading.value = true;
    try {
      if (cv.source === 'direct') {
        const response = await http.get(`/cvs/${cv.id}/download-pdf`, {
          responseType: 'blob',
          timeout: 60_000, // Playwright render có thể mất 5-30s
        });
        const blob = new Blob([response.data as BlobPart], { type: 'application/pdf' });
        triggerBlobDownload(blob, sanitizeFilename(cv.title, 'pdf'));
        toast.success('Đã tải CV thành PDF.');
      } else if (cv.fileUrl) {
        // Raw fetch — không axios interceptor, không Authorization header.
        // MinIO bucket đã public-read (xem backend/src/service/upload.service.ts)
        // nên GET thuần là đủ. Blob response → same-origin object URL →
        // `a.download` hoạt động → browser tải file về máy thay vì mở tab.
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), 30_000);
        let response: Response;
        try {
          response = await fetch(cv.fileUrl, { signal: controller.signal });
        } finally {
          window.clearTimeout(timeoutId);
        }
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const blob = await response.blob();
        const mime = cv.fileType || blob.type || 'application/octet-stream';
        const ext = extFromMime(mime);
        triggerBlobDownload(blob, sanitizeFilename(cv.title, ext));
        toast.success('Đã tải CV.');
      } else {
        toast.warning('CV này chưa có file để tải.');
      }
    } catch (err) {
      // Phân biệt AbortError (timeout 30s hoặc abort) với lỗi tải thật.
      // Trước fix: timeout abort → AbortError → catch → toast.error "Tải CV
      // thất bại. Vui lòng thử lại." — gây hiểu lầm vì file thực ra đang
      // được tải (hoặc đã tải xong nhưng timeout fire quá sớm). Pattern
      // tương tự đã làm đúng ở useDocxRenderer.
      if ((err as Error)?.name === 'AbortError') {
        // Timeout 30s. Hiện warning thân thiện (KHÔNG dùng error đỏ — user
        // không làm gì sai, chỉ là file/mạng chậm). Có thể silent nếu user
        // tự bấm cancel, nhưng composable không track cancel UI → cứ warning.
        toast.warning(
          'Quá thời gian chờ tải CV (30s). Vui lòng thử lại khi mạng ổn hơn.',
        );
      } else {
        toast.error('Tải CV thất bại. Vui lòng thử lại.');
      }
    } finally {
      downloading.value = false;
    }
  };

  /** Mở file gốc trong tab mới (chỉ upload). */
  const handleOpenOriginal = (cv: Cv | null | undefined): void => {
    const url = cv?.fileUrl;
    if (!url) return;
    // Throttle chung (cùng `lastActionAt` với handleDownload) — chặn spam
    // mở tab liên tục qua đổi qua lại giữa 2 actions.
    if (checkThrottle()) return;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return {
    downloading: computed(() => downloading.value),
    canOpenOriginal,
    openOriginalTooltip,
    handleDownload,
    handleOpenOriginal,
  };
}
