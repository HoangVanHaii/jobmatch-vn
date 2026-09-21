<script setup lang="ts">
/**
 * AdminLayout
 *
 * Shell layout cho mọi page thuộc admin area — mirror EmployerLayout:
 *   - Desktop: sidebar tối (AdminSidebar) + main content sáng
 *   - Mobile: sidebar ẩn mặc định, mở bằng hamburger → overlay trượt từ trái
 *     qua phải với backdrop + nút X. Auto-close khi navigate qua menu link.
 *
 * Vùng content chính giữ theme sáng (bg-gray-50) — chỉ sidebar đổi tông tối.
 */
import { ref } from 'vue';
import { Menu } from 'lucide-vue-next';
import AdminSidebar from '@components/admin/AdminSidebar.vue';

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
    <!-- Backdrop tối phía sau sidebar (mobile only) -->
    <Transition name="fade">
      <div
        v-if="mobileSidebarOpen"
        class="fixed inset-0 z-30 bg-black/40 md:hidden"
        aria-hidden="true"
        @click="closeMobileSidebar"
      />
    </Transition>

    <!--
      AdminSidebar có shadow nhẹ ở border-r để tạo "độ sâu" khi sidebar dark
      gặp content area sáng. Không dùng border-r cứng vì 2 tone (dark/light)
      khác nhau — shadow mượt hơn nhiều.
    -->
    <AdminSidebar :mobile-open="mobileSidebarOpen" @close-mobile="closeMobileSidebar" />

    <!--
      Accent stripe 2px ở top content area — tone indigo (cùng accent với sidebar)
      để "đánh dấu" đây là khu vực admin, liên kết với sidebar về mặt tone.
    -->
    <div class="flex flex-1 flex-col min-w-0 relative">
      <div
        class="pointer-events-none absolute inset-x-0 top-0 h-0.5"
        style="background: linear-gradient(90deg, var(--admin-accent) 0%, transparent 60%);"
      />
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
          JOBMATCH<span class="text-indigo-600">VN</span> Admin
        </h1>
      </header>

      <main class="flex-1 min-w-0">
        <router-view />
      </main>
    </div>
  </div>
</template>
