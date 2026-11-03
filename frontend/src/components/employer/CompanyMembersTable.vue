<script setup lang="ts">
/**
 * CompanyMembersTable — vùng hiển thị dữ liệu thành viên: bảng desktop
 * (5 cột), card mobile, empty-row khi 0 kết quả và footer phân trang
 * server-side.
 *
 * Presentation-only: nhận danh sách + trạng thái phân trang qua props,
 * các action nghiệp vụ (đổi trang, xóa bộ lọc, menu hành động trên row)
 * được truyền vào qua `actionsFor` (do View cung cấp theo quyền) hoặc emit
 * lên View. KHÔNG tự gọi API.
 */
import { computed } from "vue";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Crown,
  User as UserIcon,
} from "lucide-vue-next";
import MemberRowMenu from "@components/employer/MemberRowMenu.vue";
import type { CompanyMember } from "@/types/companyMember";
import {
  dateMeta,
  displayName,
  primaryName,
  ROLE_LABELS,
  STATUS_COLORS,
  STATUS_LABELS,
  type RowActionItem,
} from "@/utils/companyMemberDisplay";

const props = defineProps<{
  members: CompanyMember[];
  /** Đang fetch — tbody mờ 60% (pattern isPaysPaging của BillingHistoryView). */
  fetching: boolean;
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  sortKey: "name" | "role" | "status" | "date";
  sortDir: "asc" | "desc";
  animationCycle: number;
  /** Trả về action cho 1 row — do View build theo quyền owner/member. */
  actionsFor: (row: CompanyMember) => RowActionItem[];
}>();

const emit = defineEmits<{
  "page-change": [page: number];
  "clear-filters": [];
  sort: [key: "role" | "status" | "date"];
}>();

const toggleSort = (key: "role" | "status" | "date"): void => {
  // Đổi chiều asc/desc do View quyết định (toggleSort của View).
  emit("sort", key);
};

const rowAnimationClass = computed(() =>
  props.animationCycle % 2 === 0 ? "ml-row-fade-a" : "ml-row-fade-b",
);

/** aria-sort theo trạng thái sort thực tế của cột (a11y — WAI-ARIA). */
const ariaSortFor = (
  key: "role" | "status" | "date",
): "ascending" | "descending" | "none" => {
  if (props.sortKey !== key) return "none";
  return props.sortDir === "asc" ? "ascending" : "descending";
};
</script>

<template>
  <!-- ===== Desktop table — 5 cột (Vai trò + Ngày tách riêng) ===== -->
  <div class="hidden overflow-x-auto md:block">
    <table class="w-full table-fixed text-sm">
      <colgroup>
        <col class="w-[44%]" />
        <col class="w-[12%]" />
        <col class="w-[18%]" />
        <col class="w-[16%]" />
        <col class="w-[10%]" />
      </colgroup>
      <thead class="border-b border-slate-200">
        <tr
          class="text-left text-[11px] uppercase tracking-wider font-medium text-slate-600"
        >
          <th scope="col" class="px-4 py-2.5 font-medium">Thành viên</th>
          <th
            scope="col"
            class="px-4 py-2.5 font-medium"
            :aria-sort="ariaSortFor('role')"
          >
            <button
              type="button"
              class="inline-flex cursor-pointer items-center gap-1 transition-colors duration-150 hover:text-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5b4eea]/40 motion-reduce:transition-none"
              :class="sortKey === 'role' ? 'text-slate-700' : ''"
              @click="toggleSort('role')"
            >
              Vai trò
              <ArrowUp
                v-if="sortKey === 'role' && sortDir === 'asc'"
                :size="12"
                stroke-width="2.5"
                class="text-slate-900"
                aria-hidden="true"
              />
              <ArrowDown
                v-else-if="sortKey === 'role'"
                :size="12"
                stroke-width="2.5"
                class="text-slate-900"
                aria-hidden="true"
              />
              <ArrowUpDown
                v-else
                :size="11"
                class="text-slate-400"
                aria-hidden="true"
              />
            </button>
          </th>
          <th
            scope="col"
            class="px-4 py-2.5 font-medium"
            :aria-sort="ariaSortFor('status')"
          >
            <button
              type="button"
              class="inline-flex cursor-pointer items-center gap-1 transition-colors duration-150 hover:text-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5b4eea]/40 motion-reduce:transition-none"
              :class="sortKey === 'status' ? 'text-slate-700' : ''"
              @click="toggleSort('status')"
            >
              Trạng thái
              <ArrowUp
                v-if="sortKey === 'status' && sortDir === 'asc'"
                :size="12"
                stroke-width="2.5"
                class="text-slate-900"
                aria-hidden="true"
              />
              <ArrowDown
                v-else-if="sortKey === 'status'"
                :size="12"
                stroke-width="2.5"
                class="text-slate-900"
                aria-hidden="true"
              />
              <ArrowUpDown
                v-else
                :size="11"
                class="text-slate-400"
                aria-hidden="true"
              />
            </button>
          </th>
          <th
            scope="col"
            class="px-4 py-2.5 font-medium"
            :aria-sort="ariaSortFor('date')"
          >
            <button
              type="button"
              class="inline-flex cursor-pointer items-center gap-1 transition-colors duration-150 hover:text-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5b4eea]/40 motion-reduce:transition-none"
              :class="sortKey === 'date' ? 'text-slate-700' : ''"
              @click="toggleSort('date')"
            >
              Ngày
              <ArrowUp
                v-if="sortKey === 'date' && sortDir === 'asc'"
                :size="12"
                stroke-width="2.5"
                class="text-slate-900"
                aria-hidden="true"
              />
              <ArrowDown
                v-else-if="sortKey === 'date'"
                :size="12"
                stroke-width="2.5"
                class="text-slate-900"
                aria-hidden="true"
              />
              <ArrowUpDown
                v-else
                :size="11"
                class="text-slate-400"
                aria-hidden="true"
              />
            </button>
          </th>
          <th scope="col" class="px-4 py-2.5 text-right font-medium">
            Thao tác
          </th>
        </tr>
      </thead>
      <!-- Khi đổi tab/trang/search, hàng cũ patch tại chỗ (không remount).
           Cờ `fetching` làm mờ tbody trong lúc chờ response (pattern
           `isPaysPaging` của BillingHistoryView): báo hiệu dữ liệu đang
           thay thế, không giật layout. -->
      <tbody
        class="transition-opacity duration-150 divide-y divide-slate-100"
        :class="{ 'opacity-60': fetching }"
      >
        <!-- Kết quả lọc/search rỗng — giữ cả khi đang loading: nếu ẩn theo
             `!loading` thì row biến mất ngay → tbody co 0 rồi giãn khi
             response về = nháy. -->
        <tr v-if="members.length === 0">
          <!-- py-6 (không py-12): empty row cao ≈ một hàng data (63px) →
               chuyển 0↔có kết quả không làm tbody co/giãn đột ngột. -->
          <td colspan="5" class="px-4 py-6 text-center">
            <p class="m-0 text-sm text-slate-500">
              Không có thành viên phù hợp
            </p>
            <button
              type="button"
              class="mt-2 inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[13px] text-slate-700 transition-colors duration-150 hover:border-slate-300 focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[#5b4eea]/40 motion-reduce:transition-none"
              @click="$emit('clear-filters')"
            >
              Xóa bộ lọc
            </button>
          </td>
        </tr>
        <tr
          v-for="(row, i) in members"
          :key="row.userId"
          :class="[
            'ml-row',
            rowAnimationClass,
            'transition',
            'hover:bg-slate-50/60',
          ]"
          :style="{ animationDelay: `${i * 60}ms` }"
        >
          <!-- Thành viên (+ vai trò) -->
          <td class="px-4 py-2.5 align-middle">
            <div class="flex min-w-0 items-center gap-3">
              <div
                class="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-slate-200 bg-slate-50 text-sm font-semibold text-slate-600"
              >
                <img
                  v-if="row.user?.avatarUrl"
                  :src="row.user.avatarUrl"
                  :alt="row.user.fullName || row.user.email"
                  class="h-full w-full object-cover"
                />
                <span v-else-if="row.user?.fullName">
                  {{ row.user.fullName.charAt(0).toUpperCase() }}
                </span>
                <UserIcon v-else :size="15" class="text-slate-400" />
              </div>
              <div class="min-w-0 flex-1">
                <p class="m-0 truncate text-sm font-medium text-slate-900">
                  {{ primaryName(row) }}
                </p>
                <p class="m-0 mt-0.5 truncate text-[12.5px] text-slate-500">
                  {{ row.user?.email ?? `ID: ${row.userId.slice(0, 8)}…` }}
                </p>
              </div>
            </div>
          </td>

          <!-- Vai trò: badge owner / text member -->
          <td class="px-4 py-2.5 align-middle">
            <span
              v-if="row.role === 'owner' && row.status === 'active'"
              class="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800"
            >
              <Crown :size="11" aria-hidden="true" />
              {{ ROLE_LABELS.owner }}
            </span>
            <span v-else class="text-[13px] text-slate-500">{{
              ROLE_LABELS.member
            }}</span>
          </td>

          <!-- Trạng thái: ô vuông màu + text bên cạnh -->
          <td class="px-4 py-2.5 align-middle">
            <span
              class="inline-flex items-center gap-2 text-xs font-medium"
              :style="{ color: STATUS_COLORS[row.status] }"
            >
              <span
                class="h-2.5 w-2.5 rounded-[2px] shrink-0"
                :style="{ backgroundColor: STATUS_COLORS[row.status] }"
                aria-hidden="true"
              ></span>
              <span>{{ STATUS_LABELS[row.status] }}</span>
            </span>
          </td>

          <!-- Ngày: nhãn theo trạng thái + ngày ngắn (giờ đầy đủ trong title) -->
          <td class="px-4 py-2.5 align-middle">
            <span
              class="text-[13px] text-slate-500"
              :title="dateMeta(row).title"
            >
              {{ dateMeta(row).label }} {{ dateMeta(row).short }}
            </span>
          </td>

          <!-- Thao tác — menu "⋯" do View cung cấp theo quyền -->
          <td class="px-4 py-3 text-right align-middle">
            <MemberRowMenu
              v-if="actionsFor(row).length > 0"
              :label="displayName(row)"
              :items="actionsFor(row)"
            />
          </td>
        </tr>
      </tbody>
    </table>
  </div>

  <!-- Mobile cards -->
  <div class="divide-y divide-slate-100 md:hidden">
    <div
      v-for="(row, i) in members"
      :key="row.userId"
      :class="['ml-row', rowAnimationClass, 'space-y-2', 'p-4']"
      :style="{ animationDelay: `${i * 60}ms` }"
    >
      <div class="flex items-start gap-3">
        <div
          class="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-slate-200 bg-slate-50 text-sm font-semibold text-slate-600"
        >
          <img
            v-if="row.user?.avatarUrl"
            :src="row.user.avatarUrl"
            :alt="row.user.fullName || row.user.email"
            class="h-full w-full object-cover"
          />
          <span v-else-if="row.user?.fullName">
            {{ row.user.fullName.charAt(0).toUpperCase() }}
          </span>
          <UserIcon v-else :size="15" class="text-slate-400" />
        </div>
        <div class="min-w-0 flex-1">
          <p class="m-0 truncate text-sm font-medium text-slate-900">
            {{ primaryName(row) }}
          </p>
          <p class="m-0 mt-0.5 truncate text-[12.5px] text-slate-500">
            {{ row.user?.email ?? `ID: ${row.userId.slice(0, 8)}…` }}
          </p>
        </div>
        <MemberRowMenu
          v-if="actionsFor(row).length > 0"
          :label="displayName(row)"
          :items="actionsFor(row)"
        />
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <span
          v-if="row.role === 'owner' && row.status === 'active'"
          class="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800"
        >
          <Crown :size="11" aria-hidden="true" />
          {{ ROLE_LABELS.owner }}
        </span>
        <span
          class="inline-flex items-center gap-2 text-[11px] font-medium"
          :style="{ color: STATUS_COLORS[row.status] }"
        >
          <span
            class="h-2.5 w-2.5 rounded-[2px] shrink-0"
            :style="{ backgroundColor: STATUS_COLORS[row.status] }"
            aria-hidden="true"
          ></span>
          <span>{{ STATUS_LABELS[row.status] }}</span>
        </span>
        <span class="text-[11px] text-slate-500" :title="dateMeta(row).title">
          {{ dateMeta(row).label }} {{ dateMeta(row).short }}
        </span>
        <span
          v-if="!(row.role === 'owner' && row.status === 'active')"
          class="text-[11px] text-slate-500"
        >
          · {{ ROLE_LABELS.member }}
        </span>
      </div>
    </div>
    <!-- Kết quả lọc/search rỗng (mobile) — giữ cả khi loading, lý do như desktop -->
    <div v-if="members.length === 0" class="px-4 py-6 text-center">
      <p class="m-0 text-sm text-slate-500">Không có thành viên phù hợp</p>
      <button
        type="button"
        class="mt-2 inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[13px] text-slate-700 transition-colors duration-150 hover:border-slate-300 focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[#5b4eea]/40 motion-reduce:transition-none"
        @click="$emit('clear-filters')"
      >
        Xóa bộ lọc
      </button>
    </div>
  </div>

  <!-- ===== Phân trang server-side (ẩn khi chỉ 1 trang) ===== -->
  <div
    v-if="total > pageSize"
    class="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-4 py-3"
  >
    <p class="m-0 text-[13px] text-slate-500">
      Hiển thị {{ (page - 1) * pageSize + 1 }}–{{
        Math.min(page * pageSize, total)
      }}
      trong {{ total }} thành viên
    </p>
    <div class="flex items-center gap-2">
      <button
        type="button"
        class="inline-flex h-8 cursor-pointer items-center rounded-lg border border-slate-200 bg-white px-3 text-[13px] text-slate-700 transition-colors duration-150 hover:border-slate-300 focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[#5b4eea]/40 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
        :disabled="page <= 1"
        @click="$emit('page-change', page - 1)"
      >
        Trước
      </button>
      <span class="text-[13px] text-slate-600"
        >Trang {{ page }} / {{ totalPages }}</span
      >
      <button
        type="button"
        class="inline-flex h-8 cursor-pointer items-center rounded-lg border border-slate-200 bg-white px-3 text-[13px] text-slate-700 transition-colors duration-150 hover:border-slate-300 focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[#5b4eea]/40 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
        :disabled="page >= totalPages"
        @click="$emit('page-change', page + 1)"
      >
        Sau
      </button>
    </div>
  </div>
</template>
