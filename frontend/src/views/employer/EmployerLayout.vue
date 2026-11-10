<script setup lang="ts">
import { ref } from "vue";
import type { RouteLocationNormalizedLoaded } from "vue-router";
import { Menu } from "lucide-vue-next";
import EmployerSidebar from "@components/employer/EmployerSidebar.vue";

const mobileSidebarOpen = ref(false);

const openMobileSidebar = (): void => {
  mobileSidebarOpen.value = true;
};
const closeMobileSidebar = (): void => {
  mobileSidebarOpen.value = false;
};

/**
 * Phân biệt Route Transition và Content Transition:
 * Khi chuyển giữa các slug trong Job Detail (Next/Prev job), key giữ nguyên 'employer-job-detail'
 * để KHÔNG remount component ngoài cùng và KHÔNG chạy lại page entrance animation.
 */
const getRouteKey = (route: RouteLocationNormalizedLoaded): string => {
  if (route.name === 'employer-job-detail') {
    return 'employer-job-detail';
  }
  return route.fullPath;
};
</script>

<template>
  <div class="flex min-h-screen bg-gray-50 font-poppins">
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

    <EmployerSidebar
      :mobile-open="mobileSidebarOpen"
      @close-mobile="closeMobileSidebar"
    />

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
        <div class="text-sm font-semibold tracking-tight text-gray-900">
          JOBMATCH<span class="text-primary-600">VN</span>
        </div>
      </header>

      <main class="flex-1 min-w-0">
        <router-view v-slot="{ Component, route }">
          <Transition name="page-fade" mode="out-in">
            <component :is="Component" :key="getRouteKey(route)" />
          </Transition>
        </router-view>
      </main>
    </div>
  </div>
</template>

<style>
/* Page Transition đồng bộ cho các trang Employer - Phong cách SaaS cao cấp */
.page-fade-enter-active {
  transition: opacity 0.22s cubic-bezier(0.22, 1, 0.36, 1),
              transform 0.22s cubic-bezier(0.22, 1, 0.36, 1);
}

.page-fade-leave-active {
  transition: opacity 0.12s ease-out;
}

.page-fade-enter-from {
  opacity: 0;
  transform: translateY(5px);
}

.page-fade-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .page-fade-enter-active,
  .page-fade-leave-active {
    transition: none !important;
    transform: none !important;
  }
}
</style>
