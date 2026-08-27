<script setup lang="ts">
/**
 * ChatbotAttachmentMenu
 *
 * Icon Paperclip cạnh input box. Click → popover menu 2 options:
 *   - "Thêm Job"
 *   - "Thêm CV"
 *
 * Click option → mở dropdown tương ứng.
 * Trong dropdown user chọn N items → bấm "Đính kèm xong" → emit `commit` với
 * full array → parent replace jobIds/cvIds + đóng dropdown.
 */
import { computed, ref, watch } from 'vue';
import { Paperclip, Briefcase, FileText } from 'lucide-vue-next';
import { onClickOutside, onKeyStroke } from '@vueuse/core';
import { useChatbotStore } from '@stores/chatbot';
import ChatbotJobPickerDropdown from './ChatbotJobPickerDropdown.vue';
import ChatbotCvPickerDropdown from './ChatbotCvPickerDropdown.vue';

const store = useChatbotStore();

type View = 'menu' | 'job' | 'cv' | null;
const view = ref<View>(null);

const rootEl = ref<HTMLElement | null>(null);
const isLocked = computed(() => store.isStreaming);
const totalContext = computed(() => store.jobIds.length + store.cvIds.length);
const lockedTooltip = 'Đang chờ phản hồi — bấm "Dừng" phía dưới để đổi job/CV.';

const open = (): void => {
  if (isLocked.value) return;
  view.value = 'menu';
};

const close = (): void => {
  view.value = null;
};

const chooseJob = (): void => {
  view.value = 'job';
};

const chooseCv = (): void => {
  view.value = 'cv';
};

/** Khi user confirm trong JobPickerDropdown: thay thế jobIds bằng array items mới. */
const onCommitJobs = async (items: Parameters<typeof store.attachJobs>[0]): Promise<void> => {
  await store.attachJobs(items);
  close();
};

const onCommitCvs = async (items: Parameters<typeof store.attachCvs>[0]): Promise<void> => {
  await store.attachCvs(items);
  close();
};

onClickOutside(rootEl, () => close());
onKeyStroke('Escape', () => close());

watch(isLocked, (locked) => {
  if (locked) close();
});
</script>

<template>
  <div ref="rootEl" class="relative">
    <button
      type="button"
      class="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-gray-500 transition hover:bg-gray-100 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-40"
      :disabled="isLocked"
      :title="isLocked ? lockedTooltip : 'Đính kèm job hoặc CV'"
      aria-label="Đính kèm job hoặc CV"
      @click="open"
    >
      <Paperclip class="h-4 w-4" />
    </button>

    <!-- Menu: 2 options -->
    <div
      v-if="view === 'menu'"
      class="absolute bottom-12 left-0 z-20 w-56 rounded-lg border border-gray-200 bg-white p-1 shadow-lg ring-1 ring-black/5"
    >
      <button
        type="button"
        class="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
        @click="chooseJob"
      >
        <Briefcase class="h-4 w-4 text-blue-600" />
        <span>Thêm Job</span>
      </button>
      <button
        type="button"
        class="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
        @click="chooseCv"
      >
        <FileText class="h-4 w-4 text-purple-600" />
        <span>Thêm CV</span>
      </button>
    </div>

    <!-- Job dropdown -->
    <div
      v-else-if="view === 'job'"
      class="absolute bottom-12 left-0 z-20 rounded-lg border border-gray-200 bg-white p-3 shadow-lg ring-1 ring-black/5"
    >
      <ChatbotJobPickerDropdown
        :selected-ids="store.jobIds"
        :total-context="totalContext"
        :locked="isLocked"
        :locked-tooltip="lockedTooltip"
        @commit="onCommitJobs"
      />
    </div>

    <!-- CV dropdown -->
    <div
      v-else-if="view === 'cv'"
      class="absolute bottom-12 left-0 z-20 rounded-lg border border-gray-200 bg-white p-3 shadow-lg ring-1 ring-black/5"
    >
      <ChatbotCvPickerDropdown
        :selected-ids="store.cvIds"
        :total-context="totalContext"
        :locked="isLocked"
        :locked-tooltip="lockedTooltip"
        @commit="onCommitCvs"
      />
    </div>
  </div>
</template>