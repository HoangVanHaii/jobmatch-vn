/**
 * useLocations — fetch danh sách tỉnh/thành VN từ provinces.open-api.vn.
 *
 * Flow:
 *   1. Gọi `https://provinces.open-api.vn/api/p/?depth=1` (depth=1 → chỉ lấy
 *      province, không kèm districts/wards → payload nhẹ).
 *   2. Nếu response là array rỗng HOẶC fetch fail → fallback 3 tỉnh chính:
 *      Hà Nội, Hồ Chí Minh, Đà Nẵng.
 *   3. Cache trong module scope — không gọi lại khi component remount.
 *
 * Trả về shape đơn giản:
 *   { code: number, name: string }
 *
 * Match với `JobListQuery.locationCity` ở backend: dùng `name` (tiếng Việt có
 * dấu) làm filter value, vì dữ liệu job.location.city trong DB đang lưu
 * theo tên tiếng Việt.
 *
 * Không cần API key, không cần auth. CORS đã được open-api.vn enable.
 */
import { ref } from 'vue';

export interface LocationItem {
  code: number;
  /** Tên đầy đủ có tiền tố — dùng để hiển thị UI, vd "Thành phố Hà Nội". */
  name: string;
  /** Tên ngắn đã strip tiền tố "Tỉnh"/"Thành phố" — dùng làm filter value gửi
   *  lên backend để match với data job (đa số employer nhập tay theo dạng ngắn). */
  shortName: string;
}

/**
 * Strip tiền tố hành chính phổ biến trong tên tỉnh/thành VN:
 *  - "Thành phố Hà Nội"   → "Hà Nội"
 *  - "Thành phố Hồ Chí Minh" → "Hồ Chí Minh"
 *  - "Tỉnh Hà Giang"      → "Hà Giang"
 * Case-insensitive để cover cả "thành phố"/"Thành Phố"/...
 */
const stripProvincePrefix = (raw: string): string => {
  return raw.replace(/^(Thành phố|Thành Phố|Tỉnh|TỈNH|thành phố|tỉnh)\s+/i, '').trim();
};

const FALLBACK_LOCATIONS: LocationItem[] = [
  { code: 1, name: 'Hà Nội', shortName: 'Hà Nội' },
  { code: 79, name: 'Hồ Chí Minh', shortName: 'Hồ Chí Minh' },
  { code: 48, name: 'Đà Nẵng', shortName: 'Đà Nẵng' },
];

const API_URL = 'https://provinces.open-api.vn/api/p/?depth=1';

const items = ref<LocationItem[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
let inflight: Promise<void> | null = null;

const fetchLocations = async (): Promise<void> => {
  // Dedupe: nếu đang fetch rồi → trả về promise hiện tại.
  if (inflight) return inflight;
  if (items.value.length > 0) return;

  inflight = (async () => {
    loading.value = true;
    error.value = null;
    try {
      const res = await fetch(API_URL, { method: 'GET' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as Array<{ code: number; name: string }>;
      if (!Array.isArray(data) || data.length === 0) {
        // Fallback theo yêu cầu: API trả [] → dùng 3 tỉnh.
        items.value = FALLBACK_LOCATIONS;
        return;
      }
      items.value = data.map((p) => ({
        code: p.code,
        name: p.name,
        shortName: stripProvincePrefix(p.name),
      }));
    } catch (e) {
      // Fallback khi network fail / API down — vẫn cho user dùng được.
      error.value = e instanceof Error ? e.message : 'Không tải được danh sách tỉnh/thành';
      items.value = FALLBACK_LOCATIONS;
    } finally {
      loading.value = false;
      inflight = null;
    }
  })();

  return inflight;
};

export const useLocations = () => ({
  items,
  loading,
  error,
  /** Có thể gọi nhiều lần — chỉ fetch 1 lần nhờ dedupe + cache. */
  fetch: fetchLocations,
});
