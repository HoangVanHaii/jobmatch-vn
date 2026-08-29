<script setup lang="ts">
/**
 * CandidateLayout
 *
 * Shell layout cho mọi page thuộc candidate area:
 *   - Desktop: sidebar trái (w-60 / w-16 collapsed) + main content
 *   - Mobile: sidebar ẩn mặc định, mở bằng hamburger → overlay trượt từ trái
 *     qua phải với backdrop + nút X. Auto-close khi navigate qua menu link.
 */
import { ref } from 'vue';
import { Menu } from 'lucide-vue-next';
import CandidateSidebar from '@components/candidate/CandidateSidebar.vue';

const mobileSidebarOpen = ref(false);

const openMobileSidebar = (): void => {
  mobileSidebarOpen.value = true;
};
const closeMobileSidebar = (): void => {
  mobileSidebarOpen.value = false;
};
</script>

<template>
  <div class="flex min-h-screen bg-gray-50">
    <!--
      Backdrop tối phía sau sidebar (mobile only). Click để đóng sidebar.
      Transition fade đồng bộ với slide-in của sidebar.
    -->
    <Transition name="fade">
      <div
        v-if="mobileSidebarOpen"
        class="fixed inset-0 z-30 bg-black/40 md:hidden"
        aria-hidden="true"
        @click="closeMobileSidebar"
      />
    </Transition>

    <CandidateSidebar :mobile-open="mobileSidebarOpen" @close-mobile="closeMobileSidebar" />

    <!--
      Right column: mobile top bar (hamburger + brand) + main content.
      Trên md+ top bar ẩn, main chiếm toàn bộ phần còn lại.
    -->
    <div class="flex flex-1 flex-col min-w-0">
      <header
        class="flex items-center gap-2 border-b border-gray-200 bg-white px-4 py-3 md:hidden"
      >
        <button
          type="button"
          class="inline-flex h-9 w-9 items-center justify-center rounded-md text-gray-700 transition hover:bg-gray-100"
          title="Mở menu"
          aria-label="Mở menu"
          @click="openMobileSidebar"
        >
          <Menu class="h-5 w-5" />
        </button>
        <h1 class="text-sm font-semibold tracking-tight text-gray-900">
          JOBMATCH<span class="text-primary-600">VN</span>
        </h1>
      </header>

      <main class="flex-1 min-w-0">
        <router-view />
      </main>
    </div>
  </div>
</template>
