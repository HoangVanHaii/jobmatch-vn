<script setup lang="ts">
/**
 * CompanyMembersHeader — header trang thành viên: nhận diện công ty (logo,
 * tên, badge owner/member, mô tả, danh sách owner) + card "Thành viên"
 * Lavender (đếm active, nút Mời, avatar preview).
 * Chỉ hiển thị — mọi action (Mời, copy website) được emit lên View.
 */
import { Building2, Crown, Link2, Plus, User as UserIcon } from 'lucide-vue-next';
import type { Company } from '@/types/company';
import type {
  CompanyMember,
  CompanyMemberListCounts,
} from '@/types/companyMember';
import {
  avatarColor,
  displayName,
  initials,
  primaryName,
} from '@/utils/companyMemberDisplay';

defineProps<{
  company: Company;
  counts: CompanyMemberListCounts;
  isOwner: boolean;
  currentUserIsActive: boolean;
  owners: CompanyMember[];
  previewMembers: CompanyMember[];
  previewOverflowCount: number;
}>();

defineEmits<{
  invite: [];
  'copy-website': [];
}>();
</script>

<template>
  <div class="c3-fade grid grid-cols-1 gap-6 lg:grid-cols-[1fr_380px]">
    <!-- ===== Cột trái: nhận diện công ty ===== -->
    <div class="min-w-0">
      <div class="flex items-start gap-5">
        <!-- Logo -->
        <div
          class="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-white md:h-20 md:w-20"
        >
          <img
            v-if="company.logoUrl"
            :src="company.logoUrl"
            :alt="`${company.name} logo`"
            class="h-full w-full object-cover"
          />
          <Building2 v-else :size="28" class="text-slate-400" />
        </div>

        <div class="min-w-0 flex-1">
          <!-- Tên + icon actions -->
          <div class="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
            <h1 class="m-0 truncate text-2xl font-semibold tracking-[-0.01em] text-slate-900 md:text-[28px]">
              {{ company.name }}
            </h1>
            <span
              v-if="isOwner"
              class="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800"
            >
              <Crown :size="11" aria-hidden="true" />
              Bạn là chủ sở hữu
            </span>
            <span
              v-else-if="currentUserIsActive"
              class="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600"
            >
              Bạn là thành viên
            </span>
            <button
              v-if="company.website?.trim()"
              type="button"
              class="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-slate-400 transition-colors duration-150 hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[#5b4eea]/40 motion-reduce:transition-none"
              aria-label="Sao chép website công ty"
              :title="company.website.trim()"
              @click="$emit('copy-website')"
            >
              <Link2 :size="15" aria-hidden="true" />
            </button>
          </div>

          <!-- Meta: thành viên / đang hoạt động -->
          <div class="mt-2.5 flex flex-wrap items-center gap-y-1 text-[13px] text-slate-500">
            <span class="font-medium tabular-nums text-slate-700">{{ counts.all }}</span>&nbsp;thành viên
            <span class="mx-2.5 h-3.5 w-px bg-slate-200" aria-hidden="true" />
            <span class="font-medium tabular-nums text-emerald-700">{{ counts.active }}</span>&nbsp;đang hoạt động
          </div>

          <!-- Mô tả ngắn (nếu có) -->
          <p v-if="company.description" :title="company.description" class="mt-2 line-clamp-2 text-[13px] leading-relaxed text-slate-500">
            {{ company.description }}
          </p>

          <!-- Chủ sở hữu: ẩn khi chính người xem là owner -->
          <div v-if="!isOwner && owners.length > 0" class="mt-3.5 flex flex-wrap items-center gap-x-3 gap-y-2">
            <span class="text-xs text-slate-500">Chủ sở hữu</span>
            <template v-for="(owner, i) in owners" :key="owner.userId">
              <span v-if="i > 0" class="h-5 w-px bg-slate-200" aria-hidden="true" />
              <span class="inline-flex items-center gap-2" :title="displayName(owner)">
                <span
                  class="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full border border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600"
                >
                  <img
                    v-if="owner.user?.avatarUrl"
                    :src="owner.user.avatarUrl"
                    :alt="owner.user.fullName || owner.user.email"
                    class="h-full w-full object-cover"
                  />
                  <span v-else-if="owner.user?.fullName">
                    {{ owner.user.fullName.charAt(0).toUpperCase() }}
                  </span>
                  <UserIcon v-else :size="12" class="text-slate-400" />
                </span>
                <span class="text-[13px] font-medium text-slate-700">{{ primaryName(owner) }}</span>
              </span>
            </template>
          </div>
        </div>
      </div>
    </div>

    <!-- ===== Cột phải: card "Thành viên" ===== -->
    <aside class="min-w-0">
      <div class="rounded-xl border border-[#e9e5ff] bg-[#f8f7ff] p-5 md:p-6">
        <!-- Tiêu đề + nút Mời -->
        <div class="flex items-center justify-between gap-3">
          <div class="flex min-w-0 items-center gap-2.5">
            <h2 class="m-0 text-base font-semibold text-slate-900">Thành viên</h2>
            <span class="h-4 w-px bg-slate-200" aria-hidden="true" />
            <span class="text-[13px] text-slate-500">
              <span class="tabular-nums font-medium">{{ counts.active }}</span> đang hoạt động
            </span>
          </div>
          <button
            v-if="isOwner"
            type="button"
            class="inline-flex h-8 shrink-0 items-center justify-center gap-1 rounded-lg border border-transparent bg-[#5b4eea] px-3 text-[13px] font-medium text-white transition-colors duration-150 hover:bg-[#4839d8] focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[#5b4eea]/40 motion-reduce:transition-none"
            @click="$emit('invite')"
          >
            <Plus :size="14" aria-hidden="true" />
            Mời
          </button>
        </div>

        <!-- Hàng avatar thành viên active (tối đa 4, thừa gộp +N) -->
        <div v-if="previewMembers.length > 0" class="mt-4 flex items-center gap-2">
          <span
            v-for="row in previewMembers"
            :key="row.userId"
            class="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl text-xs font-semibold"
            :class="avatarColor(row)"
            :title="displayName(row)"
            :aria-label="displayName(row)"
          >
            <img
              v-if="row.user?.avatarUrl"
              :src="row.user.avatarUrl"
              :alt="row.user.fullName || row.user.email"
              class="h-full w-full object-cover"
            />
            <template v-else>{{ initials(row) }}</template>
          </span>
          <span
            v-if="previewOverflowCount > 0"
            class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-xs font-semibold text-slate-600"
            :title="`${previewOverflowCount} thành viên khác`"
          >
            +{{ previewOverflowCount }}
          </span>
        </div>
        <p v-else class="mt-4 text-[13px] text-slate-500">Chưa có thành viên active.</p>
      </div>
    </aside>
  </div>
</template>
