/**
 * useLocations — fetch danh sách tỉnh/thành + quận/huyện VN từ provinces.open-api.vn.
 *
 * Flow (API v1 — provinces.open-api.vn đã đổi version từ /api/p/ sang /api/v1/):
 *   1. Fetch song song:
 *      - `GET /api/v1/p/?depth=2` → list provinces (depth=2 hiện trả `districts: []`).
 *      - `GET /api/v1/d/`         → list ALL districts với field `province_code`.
 *   2. Group districts theo `province_code` → cache `districtsByProvince`.
 *   3. Nếu provinces fetch fail → fallback 3 tỉnh chính (Hà Nội, HCM, Đà Nẵng).
 *      Districts fallback = [] (không có data cứng cho 3 tỉnh này).
 *   4. Cache trong module scope — không gọi lại khi component remount.
 *
 * Lưu ý quan trọng về API version:
 *   - Endpoint cũ `https://provinces.open-api.vn/api/p/?depth=2` → 302 redirect
 *     sang `/api/v1/p/?depth=2`. V1 trả `districts: []` rỗng → phải gọi riêng
 *     `/api/v1/d/` để lấy districts. Nếu chỉ gọi depth=2 thì datalist
 *     "Quận/Huyện" sẽ trống.
 *
 * Trả về shape đơn giản:
 *   Province: { code: number, name: string, shortName: string }
 *   District: { code: number, name: string, provinceCode: number }
 *
 * Match với `JobListQuery.locationCity` ở backend: dùng `shortName` (tiếng Việt
 * đã strip tiền tố "Thành phố"/"Tỉnh") làm filter value, vì dữ liệu
 * job.location.city trong DB đang lưu theo tên ngắn do employer nhập tay.
 *
 * Không cần API key, không cần auth. CORS đã được open-api.vn enable.
 *
 * Lý do fetch districts 1 lần (thay vì lazy theo province):
 *   - Tổng ~700 districts, payload ~80-100KB — chấp nhận được.
 *   - Đơn giản hoá code: 2 fetch song song → đủ data.
 *   - UX: chuyển province → chuyển district ngay, không loading flash.
 */
import { reactive, ref } from 'vue';

export interface LocationItem {
  code: number;
  /** Tên đầy đủ có tiền tố — dùng để hiển thị UI, vd "Thành phố Hà Nội". */
  name: string;
  /** Tên ngắn đã strip tiền tố "Tỉnh"/"Thành phố" — dùng làm filter value gửi
   *  lên backend để match với data job (đa số employer nhập tay theo dạng ngắn). */
  shortName: string;
}

export interface DistrictItem {
  code: number;
  /** Tên đầy đủ có tiền tố — vd "Quận Ba Đình", "Huyện Bình Chánh". */
  name: string;
  /** Province code cha. */
  provinceCode: number;
}

/**
 * Strip tiền tố hành chính phổ biến trong tên tỉnh/thành VN:
 *  - "Thành phố Hà Nội"      → "Hà Nội"
 *  - "Thành phố Hồ Chí Minh" → "Hồ Chí Minh"
 *  - "Tỉnh Hà Giang"         → "Hà Giang"
 * Case-insensitive để cover cả "thành phố"/"Thành Phố"/...
 */
const stripProvincePrefix = (raw: string): string => {
  return raw
    .replace(/^(Thành phố|Thành Phố|Tỉnh|TỈNH|thành phố|tỉnh)\s+/i, '')
    .trim();
};

const FALLBACK_LOCATIONS: LocationItem[] = [
  { code: 1, name: 'Hà Nội', shortName: 'Hà Nội' },
  { code: 79, name: 'Hồ Chí Minh', shortName: 'Hồ Chí Minh' },
  { code: 48, name: 'Đà Nẵng', shortName: 'Đà Nẵng' },
];

const PROVINCES_API_URL = 'https://provinces.open-api.vn/api/v1/p/?depth=2';
const DISTRICTS_API_URL = 'https://provinces.open-api.vn/api/v1/d/';

/* ============================================================================
 * Module-scope state — share giữa mọi consumer, không cần Provide/Inject.
 *
 * - items: danh sách province (Ref → reactive khi mutate).
 * - districtsByProvince: cache districts theo province code (reactive object).
 *   Key = province code, value = DistrictItem[].
 *   Khi fallback chạy → không có key nào → getDistricts() trả [] cho 3 city
 *   fallback, district input vẫn cho free-text.
 * ==========================================================================*/

const items = ref<LocationItem[]>([]);
const districtsByProvince = reactive<Record<number, DistrictItem[]>>({});
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
      // Fetch song song 2 endpoint — provinces + districts — để giảm latency.
      // Nếu 1 trong 2 fail, Promise.all sẽ reject → fallback ở catch.
      const [provincesRes, districtsRes] = await Promise.all([
        fetch(PROVINCES_API_URL, { method: 'GET' }),
        fetch(DISTRICTS_API_URL, { method: 'GET' }),
      ]);
      if (!provincesRes.ok) throw new Error(`Provinces HTTP ${provincesRes.status}`);
      if (!districtsRes.ok) throw new Error(`Districts HTTP ${districtsRes.status}`);

      const provincesRaw = (await provincesRes.json()) as Array<{
        code: number;
        name: string;
        // districts có thể có hoặc không tùy version API — hiện tại v1 trả [].
        districts?: Array<{ code: number; name: string }>;
      }>;
      const districtsRaw = (await districtsRes.json()) as Array<{
        code: number;
        name: string;
        province_code: number;
      }>;

      if (!Array.isArray(provincesRaw) || provincesRaw.length === 0) {
        items.value = FALLBACK_LOCATIONS;
        return;
      }

      items.value = provincesRaw.map((p) => ({
        code: p.code,
        name: p.name,
        shortName: stripProvincePrefix(p.name),
      }));

      // Group districts theo province_code — O(n) build map.
      // Dù từ /api/v1/d/ district list có thể đã là flat array, cũng merge
      // thêm districts embedded trong provinces (nếu version cũ trả về) để
      // tương thích ngược khi API upgrade xuống depth=2.
      const byProvince: Record<number, DistrictItem[]> = {};
      for (const d of districtsRaw) {
        if (!byProvince[d.province_code]) byProvince[d.province_code] = [];
        byProvince[d.province_code].push({
          code: d.code,
          name: d.name,
          provinceCode: d.province_code,
        });
      }
      // Merge districts từ provinces payload (nếu có, fallback cho API cũ).
      for (const p of provincesRaw) {
        if (!p.districts || p.districts.length === 0) continue;
        const existing = byProvince[p.code] ?? [];
        const existingCodes = new Set(existing.map((d) => d.code));
        for (const d of p.districts) {
          if (existingCodes.has(d.code)) continue;
          existing.push({
            code: d.code,
            name: d.name,
            provinceCode: p.code,
          });
        }
        byProvince[p.code] = existing;
      }

      // Ghi vào reactive cache. Object.assign không reactive → set từng key.
      for (const code of Object.keys(byProvince)) {
        districtsByProvince[Number(code)] = byProvince[Number(code)];
      }
    } catch (e) {
      // Fallback khi network fail / API down — vẫn cho user dùng được
      // province dropdown (3 thành phố chính), district dropdown rỗng.
      error.value =
        e instanceof Error ? e.message : 'Không tải được danh sách tỉnh/thành';
      items.value = FALLBACK_LOCATIONS;
    } finally {
      loading.value = false;
      inflight = null;
    }
  })();

  return inflight;
};

/**
 * Lấy districts cho 1 province. Đồng bộ, không async vì cache đã được populate
 * bởi `fetchLocations()` (depth=2 fetch all upfront). Trả [] nếu:
 *   - Province chưa có trong cache (vd fallback provinces).
 *   - API trả province nhưng districts=null.
 *
 * Trả về reactive array — UI dùng trực tiếp trong computed/template sẽ tự
 * update khi cache thay đổi (vd khi fetch xong).
 */
const getDistricts = (provinceCode: number): DistrictItem[] => {
  return districtsByProvince[provinceCode] ?? [];
};

/**
 * Tìm province theo tên (case-insensitive, match cả name lẫn shortName).
 *
 * Dùng để map user-input city (free-text) → province code → lookup districts.
 * Ví dụ: user nhập "Hà Nội" → match province.code=1 → getDistricts(1).
 */
const findProvinceByName = (raw: string): LocationItem | null => {
  const q = raw.trim().toLowerCase();
  if (!q) return null;
  return (
    items.value.find(
      (p) =>
        p.shortName.toLowerCase() === q || p.name.toLowerCase() === q,
    ) ?? null
  );
};

export const useLocations = () => ({
  /** Reactive danh sách province. */
  items,
  /** Reactive loading state cho initial fetch. */
  loading,
  /** Error message từ lần fetch cuối (null nếu OK). */
  error,
  /** Có thể gọi nhiều lần — chỉ fetch 1 lần nhờ dedupe + cache. */
  fetch: fetchLocations,
  /** Sync getter — districts đã có sẵn trong cache sau khi fetch xong. */
  getDistricts,
  /** Helper: match free-text city name → province record. */
  findProvinceByName,
});

/** Alias cho consumer dễ đọc — `LocationItem` = province. */
export type { LocationItem as ProvinceItem };
