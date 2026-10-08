<script setup lang="ts">
/**
 * TechNovaMockupView — TechNova landing page (Company profile).
 *
 * Sections:
 *   - Top nav (logo + menu + Contact Us button)
 *   - Hero (badge + 2-line heading + sub + 2 CTA + trust avatars)
 *   - Building image card with overlay badge
 *   - Why choose (3 cards: Product Strategy / UI-UX / Dev-Ready Delivery)
 *   - "Where Strategy Meets Technology" closing section
 *
 * Wiring:
 *   - Company name/logo/description/industry ← companyApi.getById
 *   - Trust avatars ← companyMemberApi.list (top 3 members)
 */
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import {
  ArrowRight,
  Github,
  Twitter,
  Linkedin,
  Facebook,
  Instagram,
  Youtube,
  Globe,
} from 'lucide-vue-next'
import { companyApi } from '@services/company.api'
import { companyMemberApi } from '@services/companyMember.api'
import type { Company } from '@/types/company'
import type { PublicCompanyMember } from '@/types/companyMember'

const props = defineProps<{
  /** Optional companyId từ parent — ưu tiên hơn query param + getMyCompany fallback. */
  companyId?: string | null
}>()

const route = useRoute()

// ===== State =====
const company = ref<Company | null>(null)
const members = ref<PublicCompanyMember[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

/** Lấy companyId theo thứ tự: prop → ?companyId=... → fallback company của user hiện tại. */
const resolveCompanyId = async (): Promise<string | null> => {
  if (props.companyId) return props.companyId;
  const queryId = route.query.companyId;
  if (typeof queryId === 'string' && queryId.length > 0) return queryId;
  // Fallback: company của user đang login (qua getMyCompany trả slim { id, role }).
  try {
    const { data } = await companyApi.getMyCompany();
    return data.data?.id ?? null;
  } catch {
    return null;
  }
};

let fetchSeq = 0;
const fetchCompany = async (id: string): Promise<void> => {
  const seq = ++fetchSeq;
  loading.value = true;
  error.value = null;
  try {
    // Gọi company trước, members sau — để error company không block load members.
    const companyRes = await companyApi.getById(id);
    if (seq !== fetchSeq) return; // fetch mới hơn đã bắt đầu — bỏ kết quả stale
    company.value = companyRes.data.data;
  } catch (e: unknown) {
    if (seq !== fetchSeq) return;
    error.value = e instanceof Error ? e.message : 'Không tải được thông tin công ty';
    company.value = null;
  }
  try {
    const membersRes = await companyMemberApi.listPublic(id);
    if (seq !== fetchSeq) return;
    members.value = membersRes.data.data ?? [];
  } catch (e: unknown) {
    if (seq !== fetchSeq) return;
    // Không fail toàn bộ — chỉ set rỗng, vẫn hiển thị company info.
    members.value = [];
  } finally {
    // Chỉ fetch mới nhất được tắt loading — tránh fetch cũ kẹt skeleton
    if (seq === fetchSeq) loading.value = false;
  }
};

onMounted(async () => {
  const id = await resolveCompanyId();
    if (id) await fetchCompany(id);
  
});

// Re-fetch khi prop companyId đổi (vd parent truyền sang job khác)
watch(
  () => props.companyId,
  async (newId) => {
    if (newId) await fetchCompany(newId);
  },
);

/** Trust row — chỉ member active có user info; hiển thị tối đa 3 avatar. */
/** Server đã lọc chỉ member active — FE cắt tối đa 3 avatar + đếm +N. */
const visibleMembers = computed(() => members.value.slice(0, 3));
const extraMembers = computed(() =>
  Math.max(0, members.value.length - visibleMembers.value.length),
);

/** Sub copy: ưu tiên description từ company, fallback text mặc định. */
const heroSub = computed(() => {
  const desc = company.value?.description?.trim();
  if (desc) return desc;
  return 'Chúng tôi xây dựng các sản phẩm số và giải pháp công nghệ có khả năng mở rộng, phù hợp với nhu cầu kinh doanh của bạn — từ chiến lược, thiết kế đến phát triển.';
});

/** Ngưỡng cắt description + toggle "see more" / "see less". */
const DESC_TRUNCATE_AT = 220;
const descExpanded = ref(false);

const displayDesc = computed(() => {
  const text = heroSub.value;
  if (descExpanded.value || text.length <= DESC_TRUNCATE_AT) return text;
  return `${text.slice(0, DESC_TRUNCATE_AT).trimEnd()}…`;
});

const canToggleDesc = computed(() => heroSub.value.length > DESC_TRUNCATE_AT);

const toggleDesc = (): void => {
  descExpanded.value = !descExpanded.value;
};

/** Company name hiển thị — fallback "TechNova" nếu chưa load. */
const companyName = computed(() => company.value?.name ?? 'TechNova');

/** Logo URL — fallback icon gradient. */
const logoUrl = computed(() => company.value?.logoUrl ?? null)

/** Ngày thành lập đầy đủ từ createdAt (ISO), vd "15 tháng 3, 2026". Trả về '' nếu invalid. */
const foundedDate = computed(() => {
  const iso = company.value?.createdAt;
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('vi-VN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
});

/** Domain từ URL website — bỏ protocol để hiển thị gọn. */
const websiteDomain = computed(() => {
  const url = company.value?.website?.trim();
  if (!url) return '';
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
});

const websiteHref = computed(() => {
  const url = company.value?.website?.trim();
  if (!url) return '';
  return url.startsWith('http') ? url : `https://${url}`;
});;

// ===== Static UI data (mock features — không có API) =====
// (Đã thay bằng loop company.jobs — features array deprecated, có thể xoá.)

/** Format salary string từ BE (numeric string) thành "120 triệu" hoặc "$2,000". */
const formatSalary = (raw: string): string => {
  if (!raw) return '';
  const n = Number(raw);
  if (Number.isNaN(n) || n === 0) return 'Thỏa thuận';
  // BE trả VND (số lớn) → format triệu/tỷ; nếu < 10,000 → USD
  if (n < 10_000) {
    return `$${n.toLocaleString('en-US')}`;
  }
  if (n >= 1_000_000_000) {
    return `${(n / 1_000_000_000).toFixed(1)} tỷ`;
  }
  return `${Math.round(n / 1_000_000)} triệu`;
};

/** Lấy city/district từ location object (flexible shape). */
const jobLocation = (loc: unknown): string => {
  if (!loc || typeof loc !== 'object') return '';
  const o = loc as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof o.city === 'string' && o.city) parts.push(o.city);
  if (typeof o.district === 'string' && o.district) parts.push(o.district);
  return parts.join(', ');
};

/** Toggle "Xem thêm" — hiển thị 5 jobs đầu hoặc tất cả. */
const showAllJobs = ref(false);

/** Danh sách job an toàn (rỗng nếu company/jobs null) — dùng cho v-for + length checks. */
const jobsList = computed(() => company.value?.jobs ?? []);

/** "Liên hệ với chúng tôi" → báo parent mở popover nhắn nhanh (như tab Tổng quan). */
const emit = defineEmits<{ (e: 'openChat'): void }>();

/** "Khám phá dự án" → cuộn xuống section danh sách job. */
const jobsSectionEl = ref<HTMLElement | null>(null);
const scrollToJobs = (): void => {
  jobsSectionEl.value?.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

/** Normalize URL: thêm https:// nếu thiếu protocol. */
const normalizeUrl = (url: string): string => {
  if (!url) return '#';
  return url.startsWith('http') ? url : `https://${url}`;
};

/** Check address có dữ liệu hiển thị được không. */
const hasAddress = (addr: unknown): boolean => {
  if (!addr || typeof addr !== 'object') return false;
  const o = addr as Record<string, unknown>;
  return Boolean(o.address || o.city || o.district);
};

/** Render address object thành text hiển thị (address + city + district). */
const addressText = (addr: unknown): string => {
  if (!addr || typeof addr !== 'object') return '';
  const o = addr as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof o.address === 'string' && o.address) parts.push(o.address);
  if (typeof o.district === 'string' && o.district) parts.push(o.district);
  if (typeof o.city === 'string' && o.city) parts.push(o.city);
  return parts.join(', ');
};

/** Map tên platform (key trong company.social) → lucide icon component. */
const socialIcon = (platform: string) => {
  const p = platform.toLowerCase();
  if (p.includes('github')) return Github;
  if (p.includes('twitter') || p === 'x') return Twitter;
  if (p.includes('linkedin')) return Linkedin;
  if (p.includes('facebook')) return Facebook;
  if (p.includes('instagram')) return Instagram;
  if (p.includes('youtube')) return Youtube;
  return Globe;
};

/** Lấy lat/lng từ address object (nếu có). */
const addressCoords = computed<{ lat: number; lng: number } | null>(() => {
  const addr = company.value?.address;
  if (!addr || typeof addr !== 'object') return null;
  const o = addr as Record<string, unknown>;
  const lat = typeof o.lat === 'number' ? o.lat : Number(o.lat);
  const lng = typeof o.lng === 'number' ? o.lng : Number(o.lng);
  if (Number.isNaN(lat) || Number.isNaN(lng) || (lat === 0 && lng === 0)) {
    return null;
  }
  return { lat, lng };
});

/** Build URL embed OpenStreetMap (bbox quanh marker ~0.005 độ). */
const osmEmbedUrl = computed(() => {
  const c = addressCoords.value;
  if (!c) return '';
  const pad = 0.005;
  const bbox = [
    c.lng - pad,
    c.lat - pad,
    c.lng + pad,
    c.lat + pad,
  ].join(',');
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${c.lat},${c.lng}`;
});
</script>

<template>
  <div class="font-poppins bg-white">
    <!-- ============== SKELETON (đang tải) ============== -->
    <template v-if="loading">
      <!-- Hero skeleton — cùng grid với hero thật để không layout shift -->
      <section class="mx-auto max-w-[1400px] pt-4 pb-6 lg:px-6">
        <div class="grid grid-cols-1 items-center gap-8 lg:grid-cols-[1fr_360px]">
          <div class="animate-pulse">
            <div class="h-5 w-40 rounded bg-slate-200" />

            <div class="mt-3 space-y-2">
              <div class="h-3 w-full max-w-xl rounded bg-slate-100" />
              <div class="h-3 w-5/6 max-w-lg rounded bg-slate-100" />
              <div class="h-3 w-2/3 max-w-md rounded bg-slate-100" />
            </div>

            <div class="mt-4 flex gap-4">
              <div class="h-3 w-20 rounded bg-slate-100" />
              <div class="h-3 w-24 rounded bg-slate-100" />
              <div class="h-3 w-28 rounded bg-slate-100" />
            </div>

            <div class="mt-4 flex gap-3">
              <div class="h-9 w-36 rounded-md bg-slate-200" />
              <div class="h-9 w-28 rounded-md bg-slate-100" />
            </div>

            <div class="mt-5 flex items-center gap-3">
              <div class="flex -space-x-2">
                <div class="h-8 w-8 rounded-full bg-slate-200" />
                <div class="h-8 w-8 rounded-full bg-slate-200" />
                <div class="h-8 w-8 rounded-full bg-slate-200" />
              </div>

              <div class="h-3 w-48 rounded bg-slate-100" />
            </div>
          </div>

          <div class="mx-auto w-full max-w-[320px] animate-pulse">
            <div class="aspect-square w-full rounded-xl bg-slate-100" />
          </div>
        </div>
      </section>

      <!-- Jobs + sidebar skeleton -->
      <section class="bg-slate-50/60 py-6">
        <div class="mx-auto max-w-[1400px] lg:px-6">
          <div class="animate-pulse">
            <div class="h-5 w-48 rounded bg-slate-200" />
            <div class="mt-3 h-3 w-80 max-w-full rounded bg-slate-100" />
          </div>

          <div class="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div class="animate-pulse lg:col-span-2">
              <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div
                  v-for="i in 4"
                  :key="`job-skeleton-${i}`"
                  class="rounded-md border border-slate-200 bg-white p-4"
                >
                  <div class="animate-pulse">
                    <div class="h-4 w-3/4 rounded bg-slate-200" />

                    <div class="mt-2 flex gap-2">
                      <div class="h-5 w-16 rounded-full bg-slate-100" />
                      <div class="h-5 w-20 rounded-full bg-slate-100" />
                    </div>

                    <div class="mt-2 h-3 w-28 rounded bg-slate-100" />

                    <div class="mt-2 flex justify-between">
                      <div class="h-3 w-24 rounded bg-slate-100" />
                      <div class="h-3 w-16 rounded bg-slate-100" />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <aside class="animate-pulse space-y-4">
              <div class="rounded-md border border-slate-200 bg-white p-4">
                <div class="mb-3 h-3 w-32 rounded bg-slate-200" />

                <div class="space-y-2">
                  <div class="h-8 rounded-lg bg-slate-100" />
                  <div class="h-8 rounded-lg bg-slate-100" />
                  <div class="h-8 rounded-lg bg-slate-100" />
                </div>
              </div>

              <div class="rounded-md border border-slate-200 bg-white p-4">
                <div class="mb-3 h-3 w-20 rounded bg-slate-200" />

                <div class="space-y-2">
                  <div class="h-3 w-full rounded bg-slate-100" />
                  <div class="h-3 w-4/5 rounded bg-slate-100" />
                </div>

                <div class="mt-3 h-48 rounded-lg bg-slate-100" />
              </div>
            </aside>
          </div>
        </div>
      </section>
    </template>

    <template v-else>
    <!-- ============== TOP NAV ============== -->
   

    <!-- ============== HERO ============== -->
    <section class="mx-auto max-w-[1400px] pt-4 pb-6 lg:px-6">
      <div class="grid grid-cols-1 items-center gap-8 lg:grid-cols-[1fr_360px]">
        <!-- Left: copy -->
        <div>
          <!-- Heading -->
          <h1 class="text-[15.5px] font-semibold tracking-tight text-slate-900">
            {{ companyName }}
          </h1>

          <!-- Sub copy -->
          <p class="mt-3 text-[12.5px] leading-[1.55] text-slate-500">
            {{ displayDesc }}

            <button
              v-if="canToggleDesc"
              type="button"
              class="ml-1 font-medium text-blue-600 hover:underline focus:outline-none"
              @click="toggleDesc"
            >
              {{ descExpanded ? '...see less' : '...see more' }}
            </button>
          </p>

          <!-- Company info row -->
          <div
            v-if="
              company?.sizeRange || foundedDate || company?.website || company?.industry
            "
            class="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] text-slate-500"
          >
            <span v-if="company?.industry">{{ company.industry }}</span>
            <span v-if="company?.sizeRange" class="inline-flex items-center gap-1.5">
              <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-5a4 4 0 11-8 0 4 4 0 018 0zm6 0a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>

              {{ company.sizeRange }}
            </span>

            <span v-if="foundedDate" class="inline-flex items-center gap-1.5">
              <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>

              {{ foundedDate }}
            </span>

            <a
              v-if="websiteDomain"
              :href="websiteHref"
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex items-center gap-1.5 text-blue-600 hover:underline"
            >
              <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
              </svg>

              {{ websiteDomain }}
            </a>
          </div>

          <!-- CTA buttons -->
          <div class="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              class="inline-flex items-center gap-2 rounded-md bg-blue-600 px-3.5 py-2 text-[12.5px] font-medium text-white transition hover:bg-blue-700"
              @click="emit('openChat')"
            >
              Liên hệ với chúng tôi

              <ArrowRight :size="14" />
            </button>

            <button
              type="button"
              class="rounded-md border border-slate-200 bg-white px-3.5 py-[7px] text-[12.5px] font-medium text-slate-700 transition hover:bg-slate-50"
              @click="scrollToJobs"
            >
              Khám phá dự án
            </button>
          </div>

          <!-- Trust -->
          <div v-if="visibleMembers.length > 0" class="mt-5 flex items-center gap-3">
            <div class="flex -space-x-2">
              <template v-for="m in visibleMembers" :key="m.id">
                <div
                  class="relative h-8 w-8 shrink-0 overflow-hidden rounded-full border-2 border-white bg-blue-600"
                  :title="m.fullName ?? ''"
                >
                  <img
                    v-if="m.avatarUrl"
                    :src="m.avatarUrl"
                    :alt="m.fullName ?? ''"
                    class="h-full w-full object-cover"
                  />

                  <span
                    v-else
                    class="absolute inset-0 flex items-center justify-center text-[10px] font-semibold text-white"
                  >
                    {{ (m.fullName ?? '?').charAt(0).toUpperCase() }}
                  </span>
                </div>
              </template>

              <div
                v-if="extraMembers > 0"
                class="flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-blue-600 text-[10px] font-semibold text-white"
              >
                +{{ extraMembers }}
              </div>
            </div>

            <p class="text-[11px] text-slate-500">
              {{ members.length }} thành viên đang làm việc tại {{ companyName }}
            </p>
          </div>
        </div>

        <!-- Right: image card -->
        <div class="relative">
          <div class="mx-auto max-w-[320px] overflow-hidden rounded-xl bg-slate-100 shadow-xl">
            <img
              v-if="logoUrl"
              :src="logoUrl"
              :alt="companyName"
              class="aspect-square w-full object-cover"
            />

            <div
              v-else
              class="flex aspect-[5/4] w-full items-center justify-center bg-gradient-to-br from-blue-500 to-purple-600 text-6xl font-bold text-white"
            >
              {{ companyName.charAt(0).toUpperCase() }}
            </div>
          </div>

        </div>
      </div>
    </section>

    <!-- ============== WHY CHOOSE ============== -->
    <section ref="jobsSectionEl" class="bg-slate-50/60 py-6">
      <div class="mx-auto max-w-[1400px] lg:px-6">
        <div>
          <h2 class="text-[15.5px] font-semibold tracking-tight text-slate-900">
            Khám phá {{ companyName }}
          </h2>

          <p class="mt-3 max-w-xl text-sm text-slate-500">
            Các vị trí đang tuyển dụng tại {{ companyName }} — cập nhật trực tiếp từ hệ thống.
          </p>
        </div>

        <div class="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <!-- LEFT: jobs -->
          <div class="lg:col-span-2">
            <!-- Empty state -->
            <div
              v-if="!company?.jobs || company.jobs.length === 0"
              class="rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-12 text-center"
            >
              <p class="text-[12.5px] leading-[1.55] text-slate-500">
                Hiện chưa có bài đăng tuyển dụng nào.
              </p>
            </div>

            <!-- Jobs grid -->
            <div v-else class="grid grid-cols-1 gap-3 md:grid-cols-2">
              <article
                v-for="job in showAllJobs ? jobsList : jobsList.slice(0, 6)"
                :key="job.id"
                class="rounded-md border border-slate-200 bg-white p-4 transition hover:border-blue-300 hover:shadow-md"
              >
                <h3 class="text-sm font-semibold text-slate-900">
                  {{ job.title }}
                </h3>

                <div class="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span
                    v-if="job.jobLevel"
                    class="rounded-full bg-blue-50 px-2 py-0.5 font-medium text-blue-600"
                  >
                    {{ job.jobLevel }}
                  </span>

                  <span
                    v-if="job.jobType"
                    class="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-600"
                  >
                    {{ job.jobType }}
                  </span>
                </div>

                <p
                  v-if="job.salaryMin || job.salaryMax"
                  class="mt-2 text-[12.5px] font-semibold text-slate-700"
                >
                  {{
                    job.salaryMin && job.salaryMax
                      ? `${formatSalary(job.salaryMin)} - ${formatSalary(job.salaryMax)}`
                      : formatSalary(job.salaryMin ?? job.salaryMax ?? '')
                  }}
                </p>

                <div
                  v-if="jobLocation(job.location) || job.slug"
                  class="mt-2 flex items-center justify-between gap-2"
                >
                  <p
                    v-if="jobLocation(job.location)"
                    class="text-[11px] text-slate-500"
                  >
                    📍 {{ jobLocation(job.location) }}
                  </p>

                  <a
                    v-if="job.slug"
                    :href="`/jobs/${job.slug}`"
                    class="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-blue-600 hover:underline"
                  >
                    Xem chi tiết

                    <ArrowRight :size="12" />
                  </a>
                </div>
              </article>
            </div>

            <!-- Xem thêm / Thu gọn -->
            <div
              v-if="jobsList.length > 6"
              class="mt-5 flex justify-center"
            >
              <button
                type="button"
                class="rounded-md border border-slate-200 bg-white px-3.5 py-[7px] text-[12.5px] font-medium text-slate-700 transition hover:bg-slate-50"
                @click="showAllJobs = !showAllJobs"
              >
                {{ showAllJobs ? 'Thu gọn' : `Xem thêm (${jobsList.length - 6})` }}
              </button>
            </div>
          </div>

          <!-- RIGHT: social + address sidebar -->
          <aside class="space-y-4">
            <!-- Social links -->
            <div
              v-if="company?.social && Object.keys(company.social).length > 0"
              class="rounded-md border border-slate-200 bg-white p-4"
            >
              <h3 class="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
                Liên kết mạng xã hội
              </h3>

              <div class="flex flex-col gap-2">
                <a
                  v-for="(url, platform) in company.social"
                  :key="platform"
                  :href="normalizeUrl(url)"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="inline-flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2 text-[12.5px] text-slate-700 transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-600"
                >
                  <span class="flex items-center gap-2">
                    <component
                      :is="socialIcon(platform)"
                      :size="16"
                      class="text-slate-500"
                    />

                    <span class="font-medium capitalize">{{ platform }}</span>
                  </span>

                  <svg
                    class="h-3 w-3"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    stroke-width="2"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                    />
                  </svg>
                </a>
              </div>
            </div>

            <!-- Address -->
            <div
              v-if="company?.address && hasAddress(company.address)"
              class="rounded-md border border-slate-200 bg-white p-4"
            >
              <h3 class="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
                Địa chỉ
              </h3>

              <div class="flex items-start gap-2 text-[12.5px] text-slate-700">
                <svg
                  class="mt-0.5 h-4 w-4 shrink-0 text-slate-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
                  />

                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                </svg>

                <p class="leading-[1.55]">
                  {{ addressText(company.address) }}
                </p>
              </div>

              <!-- OpenStreetMap preview (nếu có lat/lng) -->
              <div
                v-if="osmEmbedUrl"
                class="mt-3 overflow-hidden rounded-lg border border-slate-200"
              >
                <iframe
                  :src="osmEmbedUrl"
                  class="h-48 w-full"
                  style="border: 0"
                  loading="lazy"
                  referrerpolicy="no-referrer-when-downgrade"
                  title="OpenStreetMap preview"
                />
              </div>
            </div>
          </aside>
        </div>
      </div>
    </section>
    </template>
  </div>
</template>

