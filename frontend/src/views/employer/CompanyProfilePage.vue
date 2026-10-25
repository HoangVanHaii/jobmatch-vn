<script setup lang="ts">
/**
 * CompanyProfilePage.vue — Giao diện hồ sơ doanh nghiệp (Editorial Corporate).
 * Component cha quản lý trạng thái view/edit và chuyển cảnh.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { MailPlus, X } from 'lucide-vue-next';
import CompanyProfileView from '@/components/employer/CompanyProfileView.vue';
import CompanyProfileForm from '@/components/employer/CompanyProfileForm.vue';
import CompanyProfileSkeleton from '@/components/employer/CompanyProfileSkeleton.vue';
import { useCompanyStore } from '@stores/company';
import { useCompanyMemberStore } from '@stores/companyMember';
import { useAuthStore } from '@stores/auth';
import { useToastStore } from '@stores/toast';
import { useSocket } from '@composables/useSocket';
import { formatDate } from '@/utils/format';
import { EMPTY_PROFILE, type CompanyProfile } from '@/utils/companyProfileUtils';
import type { CompanyInvite } from '@/types/company';

const companyStore = useCompanyStore();
const memberStore = useCompanyMemberStore();
const auth = useAuthStore();
const toast = useToastStore();
const {
  company: profile,
  companyLoading,
  companySaving,
  companyCreating,
  companyNotFound,
  companyLoadError,
  companySaveError,
  companyFieldErrors,
  companyInvites,
  invitesLoading,
  invitesError,
  invitesInitialized,
} = storeToRefs(companyStore);
const hasProfile = computed(() => profile.value !== null);

/* Dọn state cũ của store (lần vào trước / tài khoản trước) ĐỒNG BỘ ở setup —
 * trước render đầu. Nếu để trong onMounted thì frame đầu vẫn đọc state cũ
 * (companyNotFound=true, invitesInitialized=true) và vẽ màn "chưa có công ty"
 * rồi mới về skeleton → chớp khi điều hướng nội bộ. */
companyStore.resetCompanyProfileState();
/** false = luồng tải đầu của lần mount này chưa xong → luôn hiển thị skeleton. */
const pageReady = ref(false);

/** Trạng thái hiển thị duy nhất của trang; mọi nhánh template dựa vào đây. */
const pageState = computed<'loading' | 'error' | 'empty' | 'view' | 'form'>(() => {
  if (!pageReady.value) return 'loading';
  if (isEditing.value) return 'form'; // form tạo (chưa có công ty) hoặc sửa
  if (companyLoadError.value && !profile.value) return 'error';
  if (companyNotFound.value) return invitesInitialized.value ? 'empty' : 'loading';
  if (profile.value) return 'view';
  return 'loading';
});

/* Quyền sửa hồ sơ: owner active HOẶC admin (UX check; BE enforce bằng
 * requireCompanyOwnerOrAdmin). Members cache được fetch khi có company. */
const canEdit = computed<boolean>(() => {
  if (!profile.value || !auth.user) return false;
  if (auth.user.role === 'admin') return true;
  const uid = auth.user.id;
  const list = memberStore.getMembers(profile.value.id);
  const me = list.find((m) => m.userId === uid) ?? null;
  return !!me && me.role === 'owner' && me.status === 'active';
});

watch(
  profile,
  (v) => {
    if (v) void memberStore.fetchList(v.id);
  },
  { immediate: true },
);

const isEditing = ref(false);
/** 'create' khi đang tạo hồ sơ lần đầu (chưa có công ty), 'edit' khi sửa hồ sơ có sẵn. */
const mode = ref<'create' | 'edit'>('edit');
const savedNotice = ref(false);
const savedMessage = ref('Đã lưu thay đổi.');
let savedNoticeTimer: ReturnType<typeof setTimeout> | null = null;
const rootEl = ref<HTMLElement | null>(null);

function startEdit(): void {
  savedNotice.value = false;
  mode.value = 'edit';
  isEditing.value = true;
}

/** Vào form ở chế độ TẠO (chưa có công ty). */
function startCreate(): void {
  savedNotice.value = false;
  mode.value = 'create';
  isEditing.value = true;
}

async function onSave(updatedProfile: CompanyProfile, logoFile: File | null): Promise<void> {
  const saved =
    mode.value === 'create'
      ? await companyStore.createCompany(updatedProfile)
      : await companyStore.updateCompany(updatedProfile, logoFile);
  if (!saved) return;
  isEditing.value = false;
  savedMessage.value = mode.value === 'create' ? 'Đã tạo hồ sơ doanh nghiệp.' : 'Đã lưu thay đổi.';
  if (mode.value === 'create') mode.value = 'edit'; // các lần sau hoạt động như sửa thường
  savedNotice.value = true;
  if (savedNoticeTimer) clearTimeout(savedNoticeTimer);
  savedNoticeTimer = setTimeout(() => {
    savedNotice.value = false;
  }, 3000);
}

/** Transition view↔edit: reset cuộn trước khi vào mode mới, focus tiêu đề sau. */
function onModeBeforeEnter(): void {
  window.scrollTo(0, 0);
}

function onModeAfterEnter(): void {
  rootEl.value
    ?.querySelector<HTMLElement>('.c3-page-title')
    ?.focus({ preventScroll: true });
}

/* ============================================================================
 * Lời mời tham gia công ty (chỉ hiển thị khi user chưa có công ty)
 *
 * Realtime qua useSocket('notification:new') — match type mới ('company') lẫn
 * type legacy ('company_invite' / 'system') như CompanyTestView. Khi đã có
 * công ty thì bỏ qua mọi update về invite.
 * ==========================================================================*/
const inviteActionId = ref<string | null>(null); // companyId đang accept/decline

async function acceptInvite(invite: CompanyInvite): Promise<void> {
  if (!auth.user || inviteActionId.value) return; // guard double-click
  inviteActionId.value = invite.companyId;
  try {
    const result = await memberStore.acceptInvite(invite.companyId, auth.user.id);
    if (result) {
      toast.success(`Đã chấp nhận lời mời tham gia ${invite.companyName}.`);
      companyStore.dismissInvite(invite.companyId);
      // Vào thẳng chế độ xem công ty sau khi chấp nhận.
      await companyStore.fetchCompany();
    } else {
      // BE đã localize lỗi: 409 đã thuộc công ty khác, invite hết hạn/thu hồi…
      toast.error(memberStore.error ?? 'Không thể chấp nhận lời mời. Lời mời có thể đã hết hạn.');
    }
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Đã có lỗi xảy ra.');
  } finally {
    inviteActionId.value = null;
  }
}

/** Từ chối — chỉ filter local sau khi server xác nhận. */
async function declineInvite(invite: CompanyInvite): Promise<void> {
  if (!auth.user || inviteActionId.value) return;
  inviteActionId.value = invite.companyId;
  try {
    const result = await memberStore.declineMyInvite(invite.companyId, auth.user.id);
    if (result) {
      toast.success(`Đã từ chối lời mời từ ${invite.companyName}.`);
      companyStore.dismissInvite(invite.companyId);
    } else {
      toast.error(memberStore.error ?? 'Không thể từ chối lời mời.');
    }
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Đã có lỗi xảy ra.');
  } finally {
    inviteActionId.value = null;
  }
}

/** Lời mời mới / bị hủy / auto-cancel → đồng bộ danh sách (chỉ khi chưa có công ty). */
function onInviteNotification(n: unknown): void {
  const notif = n as {
    type?: string;
    payload?: { kind?: string; companyId?: string };
  };
  if (!notif) return;
  const type = notif.type;
  const kind = notif.payload?.kind;
  const isCompany = type === 'company';
  const isLegacy = type === 'company_invite' || type === 'system';

  // Invite mới (legacy + type mới) → refetch im lặng (không bật loading toàn khối).
  if (type === 'company_invite' || (isCompany && kind === 'company_invite_sent')) {
    if (companyNotFound.value) void companyStore.fetchInvites(true);
    return;
  }
  // Bị xoá khỏi company / invite bị thu hồi → reload company (phát hiện mất membership).
  if (isCompany || isLegacy) {
    if (kind === 'removed_from_company' || kind === 'invite_cancelled') {
      void companyStore.fetchCompany();
      return;
    }
    // Member khác rời company hiện tại (chỉ khi đang có công ty).
    if (
      kind === 'company_member_left' &&
      typeof notif.payload?.companyId === 'string' &&
      companyStore.current?.id === notif.payload.companyId
    ) {
      void companyStore.fetchCompany();
      return;
    }
    // Invite auto-cancel khi user tạo company mới.
    if (kind === 'invite_auto_cancelled_on_create_company' && companyNotFound.value) {
      void companyStore.fetchInvites(true);
    }
  }
}

/** Mất kết nối rồi nối lại → refetch im lặng (fetch đầu có dedupe inflight nên không trùng). */
function onSocketConnect(): void {
  if (companyNotFound.value) void companyStore.fetchInvites(true);
}

useSocket('notification:new', onInviteNotification);
useSocket('connect', onSocketConnect);

onBeforeUnmount(() => {
  if (savedNoticeTimer) clearTimeout(savedNoticeTimer);
});

/** Vào trang: tải tuần tự company → invites (nếu chưa có công ty); mọi đường
 *  (kể cả lỗi) đều kết thúc bằng pageReady = true để thoát skeleton. Refetch
 *  sau đó (socket/reconnect/Thử lại) là silent, không đụng pageReady. */
onMounted(async () => {
  try {
    await companyStore.fetchCompany();
    if (companyStore.companyNotFound) await companyStore.fetchInvites();
  } finally {
    pageReady.value = true;
  }
});
</script>

<template>
  <div ref="rootEl" class="min-h-screen bg-white font-poppins text-slate-900 antialiased">
    <Transition name="c3-mode" mode="out-in" @before-enter="onModeBeforeEnter" @after-enter="onModeAfterEnter">
      <CompanyProfileSkeleton v-if="pageState === 'loading'" />
      <div v-else-if="pageState === 'error'" class="mx-auto max-w-[1240px] px-6 py-10">
        <p class="text-sm text-red-600" role="alert">{{ companyLoadError }}</p>
        <button
          type="button"
          class="mt-3 inline-flex cursor-pointer items-center justify-center rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-[13px] text-slate-700 transition-colors duration-150 hover:border-slate-300 focus:outline-none focus-visible:ring-[3px] focus-visible:ring-blue-600/40 motion-reduce:transition-none"
          @click="companyStore.fetchCompany()"
        >
          Thử lại
        </button>
      </div>
      <div v-else-if="pageState === 'empty'" class="c3-fade mx-auto max-w-[1240px] px-6 py-10">
        <p class="mb-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-blue-600">Hồ sơ doanh nghiệp / 01</p>
        <h1
          tabindex="-1"
          class="c3-page-title m-0 max-w-[18ch] break-words text-[clamp(26px,3.2vw,38px)] font-bold leading-[1.2] tracking-[-0.01em] outline-none"
        >
          Tạo hồ sơ doanh nghiệp
        </h1>
        <p class="mt-3.5 max-w-[56ch] text-[14.5px] leading-[1.7] text-slate-500">
          Bạn chưa có hồ sơ doanh nghiệp. Tạo hồ sơ để giới thiệu thương hiệu,
          văn hóa và cơ hội làm việc đến với ứng viên trên JobMatch VN.
        </p>
        <button
          type="button"
          class="mt-6 inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-transparent bg-[#5b4eea] px-5 py-[11px] text-[13px] font-semibold tracking-[0.04em] text-white transition-colors duration-150 hover:bg-blue-700 focus:outline-none focus-visible:ring-[3px] focus-visible:ring-blue-600/40 motion-reduce:transition-none"
          @click="startCreate"
        >
          Tạo hồ sơ
        </button>

        <!-- Lời mời tham gia công ty đang chờ (realtime qua socket, chỉ khi chưa có công ty) -->
        <section v-if="invitesLoading || invitesError || companyInvites.length > 0" class="mt-10 max-w-[720px]">
          <div class="mb-3 flex items-center gap-2">
            <div class="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50 text-amber-700">
              <MailPlus class="h-4 w-4" />
            </div>
            <div>
              <h2 class="m-0 text-sm font-semibold text-slate-900">
                Lời mời đang chờ
                <span v-if="!invitesLoading && companyInvites.length > 0" class="font-normal text-slate-500">({{ companyInvites.length }})</span>
              </h2>
              <p class="m-0 text-xs text-slate-500">Chấp nhận để tham gia ngay, hoặc từ chối nếu không phù hợp.</p>
            </div>
          </div>

          <!-- Lần tải đầu được che bởi skeleton toàn trang; refetch sau đó im lặng
               nên không cần chữ loading riêng — chỉ hiện lỗi kèm Thử lại. -->
          <p v-if="invitesError" class="m-0 text-[13px] text-red-600" role="alert">
            {{ invitesError }}
            <button
              type="button"
              class="ml-1 cursor-pointer font-medium text-blue-600 underline-offset-2 hover:underline focus:outline-none"
              @click="companyStore.fetchInvites(true)"
            >Thử lại</button>
          </p>
          <ul v-else class="m-0 mt-1 list-none divide-y divide-slate-200 border-t border-slate-200 p-0">
            <li v-for="invite in companyInvites" :key="invite.companyId" class="flex flex-wrap items-center gap-3 py-3">
              <div class="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                <img v-if="invite.companyLogoUrl" :src="invite.companyLogoUrl" :alt="invite.companyName" class="h-full w-full object-cover" />
                <MailPlus v-else class="h-4 w-4 text-slate-500" />
              </div>
              <div class="min-w-0 flex-1">
                <p class="m-0 break-words text-sm font-medium text-slate-900">{{ invite.companyName }}</p>
                <p class="m-0 mt-0.5 text-xs text-slate-500">
                  {{ invite.invitedBy?.fullName || invite.invitedBy?.email || 'Owner' }} · {{ formatDate(invite.invitedAt) }}
                </p>
              </div>
              <button
                type="button"
                class="inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-transparent bg-[#5b4eea] px-4 py-2 text-[12.5px] font-semibold tracking-[0.04em] text-white transition-colors duration-150 hover:bg-blue-700 focus:outline-none focus-visible:ring-[3px] focus-visible:ring-blue-600/40 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
                :disabled="inviteActionId !== null"
                @click="acceptInvite(invite)"
              >
                Chấp nhận
              </button>
              <button
                type="button"
                class="inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-[12.5px] text-slate-700 transition-colors duration-150 hover:border-slate-300 focus:outline-none focus-visible:ring-[3px] focus-visible:ring-blue-600/40 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
                :disabled="inviteActionId !== null"
                @click="declineInvite(invite)"
              >
                <X :size="14" aria-hidden="true" />
                Từ chối
              </button>
            </li>
          </ul>
        </section>
      </div>
      <CompanyProfileView
        v-else-if="pageState === 'view'"
        :profile="profile!"
        :saved-notice="savedNotice"
        :saved-message="savedMessage"
        :can-edit="canEdit"
        @edit="startEdit"
      />
      <CompanyProfileForm
        v-else-if="pageState === 'form'"
        :profile="profile ?? EMPTY_PROFILE"
        :mode="mode"
        :saving="companySaving || companyCreating"
        :server-errors="companyFieldErrors"
        :save-error="companySaveError"
        @save="onSave"
        @cancel="isEditing = false"
      />
      <div v-else class="mx-auto max-w-[1240px] px-6 py-10 text-sm text-slate-500">
        Bạn chưa có hồ sơ doanh nghiệp.
      </div>
    </Transition>
  </div>
</template>

<style>
/* CSS không dùng scoped để áp dụng xuyên suốt component con mà không nhân bản:
   transition classes cho notice, keyframes stagger c3-fade và transition view/edit. */
.notice-enter-active,
.notice-leave-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
}
.notice-enter-from,
.notice-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

/* Stagger fade-up khi trang xuất hiện — CSS thuần nên không phụ thuộc JS,
   nội dung không bao giờ bị kẹt ở trạng thái ẩn. */
.c3-fade {
  animation: c3-fade-up 0.35s cubic-bezier(0.22, 1, 0.36, 1) both;
}
.c3-d1 {
  animation-delay: 60ms;
}
.c3-d2 {
  animation-delay: 120ms;
}
.c3-d3 {
  animation-delay: 180ms;
}
@keyframes c3-fade-up {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    /* `none` (không phải translateY(0)) để fill-mode `both` không giữ lại một
       transform vĩnh viễn — transform tồn dư trên header/aside/form tạo
       containing block và làm lệch hành vi sticky bên trong chúng. */
    transform: none;
  }
}

/* Chuyển đổi view <-> edit: fade + translateY nhẹ, out-in để không nhảy layout */
.c3-mode-enter-active,
.c3-mode-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}
.c3-mode-enter-from {
  opacity: 0;
  transform: translateY(8px);
}
.c3-mode-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .c3-fade {
    animation: none;
  }
  .c3-mode-enter-active,
  .c3-mode-leave-active,
  .notice-enter-active,
  .notice-leave-active {
    transition: none;
  }
}
</style>
