<script setup lang="ts">
/**
 * CompanyMembersSkeleton.vue — Skeleton cho nhánh loading của
 * CompanyMembersView. Mô phỏng bố cục phẳng (hàng công ty + thống kê, cụm
 * điều khiển, danh sách 4 hàng) để không nhảy layout khi dữ liệu về.
 * Chỉ hình khối + animate-pulse, tôn trọng prefers-reduced-motion.
 */
</script>

<template>
  <div role="status" aria-busy="true">
    <span class="sr-only">Đang tải thành viên công ty</span>

    <!-- Hàng nhận diện công ty + thống kê (phẳng) -->
    <div class="flex animate-pulse items-center justify-between gap-8 motion-reduce:animate-none">
      <div class="flex min-w-0 items-center gap-2.5">
        <div class="h-9 w-9 shrink-0 rounded-lg bg-slate-100" />
        <div class="min-w-0">
          <div class="h-4 w-40 rounded bg-slate-100" />
          <div class="mt-1.5 h-3 w-24 rounded bg-slate-100" />
        </div>
      </div>
      <div class="hidden items-center gap-5 md:flex">
        <div class="h-5 w-16 rounded bg-slate-100" />
        <div class="h-5 w-24 rounded bg-slate-100" />
        <div class="h-5 w-20 rounded bg-slate-100" />
      </div>
    </div>

    <!-- Cụm điều khiển: tab + tìm kiếm -->
    <div class="mt-6 flex items-center justify-between border-b border-slate-200 pb-3">
      <div class="flex animate-pulse items-center gap-4 motion-reduce:animate-none">
        <div class="h-3.5 w-16 rounded bg-slate-100" />
        <div class="h-3.5 w-24 rounded bg-slate-100" />
        <div class="h-3.5 w-20 rounded bg-slate-100" />
      </div>
      <div class="h-8 w-52 animate-pulse rounded-lg bg-slate-100 motion-reduce:animate-none" />
    </div>

    <!-- Danh sách thành viên: 4 hàng phẳng, divider mảnh -->
    <div>
      <div
        v-for="i in 4"
        :key="i"
        class="flex items-center gap-3 border-b border-slate-100 px-4 py-4"
      >
        <div class="h-10 w-10 shrink-0 animate-pulse rounded-full bg-slate-100 motion-reduce:animate-none" />
        <div class="min-w-0 flex-1 animate-pulse motion-reduce:animate-none">
          <div class="h-4 w-40 rounded bg-slate-100" />
          <div class="mt-2 h-3 w-52 max-w-full rounded bg-slate-100" />
        </div>
        <div class="hidden h-5 w-16 shrink-0 animate-pulse rounded-full bg-slate-100 md:block motion-reduce:animate-none" />
        <div class="hidden h-5 w-24 shrink-0 animate-pulse rounded-full bg-slate-100 md:block motion-reduce:animate-none" />
        <div class="hidden h-3 w-24 shrink-0 animate-pulse rounded bg-slate-100 md:block motion-reduce:animate-none" />
        <div class="hidden h-8 w-8 shrink-0 animate-pulse rounded-lg bg-slate-100 md:block motion-reduce:animate-none" />
      </div>
    </div>
  </div>
</template>
