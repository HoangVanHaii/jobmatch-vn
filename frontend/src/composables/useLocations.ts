/**
 * useLocations — fetch danh sách tỉnh/thành + quận/huyện VN từ provinces.open-api.vn,
 * tích hợp sẵn cơ sở dữ liệu vnLocations.json (63 tỉnh/thành, 696 quận/huyện)
 * làm dữ liệu khởi tạo và fallback bền vững.
 */
import { reactive, ref } from 'vue';
import vnLocationsData from '../data/vnLocations.json';

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
    .replace(/^(Thành phố|Thành Phố|Tỉnh|TỈNH|thành phố|tỉnh)s+/i, '')
    .trim();
};

const PROVINCES_API_URL = 'https://provinces.open-api.vn/api/v1/p/?depth=2';
const DISTRICTS_API_URL = 'https://provinces.open-api.vn/api/v1/d/';

/* ============================================================================
 * Module-scope state — khởi tạo sẵn toàn bộ 63 tỉnh/thành và 696 quận/huyện
 * từ cơ sở dữ liệu vnLocations.json để đảm bảo UI luôn có dữ liệu đầy đủ 100%,
 * không bao giờ bị rơi vào tình trạng thiếu tỉnh hoặc rỗng quận.
 * ==========================================================================*/

const initialDistrictsMap: Record<number, DistrictItem[]> = {};
for (const d of vnLocationsData.districts) {
  if (!initialDistrictsMap[d.provinceCode]) {
    initialDistrictsMap[d.provinceCode] = [];
  }
  initialDistrictsMap[d.provinceCode].push(d);
}

const items = ref<LocationItem[]>(vnLocationsData.provinces);
const districtsByProvince = reactive<Record<number, DistrictItem[]>>(initialDistrictsMap);
const loading = ref(false);
const error = ref<string | null>(null);
let inflight: Promise<void> | null = null;

const fetchLocations = async (): Promise<void> => {
  // Dedupe: nếu đang fetch rồi → trả về promise hiện tại.
  if (inflight) return inflight;

  inflight = (async () => {
    loading.value = true;
    error.value = null;
    try {
      // Fetch song song 2 endpoint — provinces + districts từ open-api.vn
      const [provincesRes, districtsRes] = await Promise.all([
        fetch(PROVINCES_API_URL, { method: 'GET' }),
        fetch(DISTRICTS_API_URL, { method: 'GET' }),
      ]);
      if (!provincesRes.ok) throw new Error(`Provinces HTTP ${provincesRes.status}`);
      if (!districtsRes.ok) throw new Error(`Districts HTTP ${districtsRes.status}`);

      const provincesRaw = (await provincesRes.json()) as Array<{
        code: number;
        name: string;
        districts?: Array<{ code: number; name: string }>;
      }>;
      const districtsRaw = (await districtsRes.json()) as Array<{
        code: number;
        name: string;
        province_code: number;
      }>;

      if (Array.isArray(provincesRaw) && provincesRaw.length > 0) {
        items.value = provincesRaw.map((p) => ({
          code: p.code,
          name: p.name,
          shortName: stripProvincePrefix(p.name),
        }));
      }

      if (Array.isArray(districtsRaw) && districtsRaw.length > 0) {
        const byProvince: Record<number, DistrictItem[]> = {};
        for (const d of districtsRaw) {
          if (!byProvince[d.province_code]) byProvince[d.province_code] = [];
          byProvince[d.province_code].push({
            code: d.code,
            name: d.name,
            provinceCode: d.province_code,
          });
        }
        for (const code of Object.keys(byProvince)) {
          districtsByProvince[Number(code)] = byProvince[Number(code)];
        }
      }
    } catch (e) {
      console.warn('[useLocations] Fetch external API failed, using built-in locations database:', e);
      error.value = e instanceof Error ? e.message : 'Không tải được từ API ngoài';
    } finally {
      loading.value = false;
      inflight = null;
    }
  })();

  return inflight;
};

/**
 * Lấy districts cho 1 province. Trả về reactive array danh sách quận/huyện.
 */
const getDistricts = (provinceCode: number): DistrictItem[] => {
  return districtsByProvince[provinceCode] ?? [];
};

/**
 * Tìm province theo tên (case-insensitive, match cả name lẫn shortName).
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
  /** Reactive danh sách province (toàn bộ 63 tỉnh thành). */
  items,
  /** Reactive loading state cho initial fetch. */
  loading,
  /** Error message từ lần fetch cuối (null nếu OK). */
  error,
  /** Có thể gọi nhiều lần — tự động sync từ API ngoài. */
  fetch: fetchLocations,
  /** Sync getter — luôn có dữ liệu đầy đủ 696 quận huyện. */
  getDistricts,
  /** Helper: match free-text city name → province record. */
  findProvinceByName,
});

/** Alias cho consumer dễ đọc — LocationItem = province. */
export type { LocationItem as ProvinceItem };
