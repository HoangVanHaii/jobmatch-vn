<script setup lang="ts">
/**
 * InterviewsView — Quản lý lịch phỏng vấn của Employer & Tích hợp Lịch Google
 */
import { ref } from 'vue';
import { Calendar, Video, Users, CheckCircle, Clock } from 'lucide-vue-next';
import GoogleCalendarConnectCard from '@/components/employer/GoogleCalendarConnectCard.vue';

const activeTab = ref<'upcoming' | 'past' | 'all'>('upcoming');
</script>

<template>
  <div class="font-poppins min-h-screen bg-gray-50/50 p-5 md:p-8">
    <div class="max-w-7xl mx-auto space-y-6">
      <!-- Page Header -->
      <header class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 class="text-2xl font-bold text-gray-900 tracking-tight">Lịch phỏng vấn</h1>
          <p class="text-sm text-gray-500 mt-1">
            Quản lý các buổi phỏng vấn ứng viên, tự động đồng bộ Google Calendar và tạo phòng họp Google Meet.
          </p>
        </div>
      </header>

      <!-- Google Calendar Integration Section -->
      <section>
        <GoogleCalendarConnectCard />
      </section>

      <!-- Interview Schedule Section -->
      <section class="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-5 border-b border-gray-100">
          <div class="flex items-center gap-2">
            <Calendar class="h-5 w-5 text-primary-600" />
            <h2 class="text-base font-semibold text-gray-900">Danh sách buổi phỏng vấn</h2>
          </div>

          <!-- Tabs -->
          <div class="inline-flex rounded-xl bg-gray-100 p-1 text-xs font-medium text-gray-600">
            <button
              type="button"
              :class="[
                'rounded-lg px-3 py-1.5 transition-all',
                activeTab === 'upcoming' ? 'bg-white text-gray-900 shadow-sm font-semibold' : 'hover:text-gray-900'
              ]"
              @click="activeTab = 'upcoming'"
            >
              Sắp tới
            </button>
            <button
              type="button"
              :class="[
                'rounded-lg px-3 py-1.5 transition-all',
                activeTab === 'past' ? 'bg-white text-gray-900 shadow-sm font-semibold' : 'hover:text-gray-900'
              ]"
              @click="activeTab = 'past'"
            >
              Đã qua
            </button>
            <button
              type="button"
              :class="[
                'rounded-lg px-3 py-1.5 transition-all',
                activeTab === 'all' ? 'bg-white text-gray-900 shadow-sm font-semibold' : 'hover:text-gray-900'
              ]"
              @click="activeTab = 'all'"
            >
              Tất cả
            </button>
          </div>
        </div>

        <!-- Empty State / Upcoming list -->
        <div class="py-12 text-center">
          <div class="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 mb-4">
            <Video class="h-7 w-7" />
          </div>
          <h3 class="text-base font-semibold text-gray-900">Chưa có buổi phỏng vấn nào sắp diễn ra</h3>
          <p class="text-sm text-gray-500 mt-1.5 max-w-md mx-auto">
            Khi duyệt hồ sơ trong mục <span class="font-medium text-gray-700">Đơn ứng tuyển</span>, bạn có thể bấm <span class="font-medium text-primary-600">"Mời Phỏng vấn"</span> để xếp lịch và tạo phòng họp Google Meet tự động.
          </p>
        </div>
      </section>
    </div>
  </div>
</template>