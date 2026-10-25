<script setup lang="ts">
/**
 * CompanyProfileSkeleton.vue — Skeleton toàn trang cho nhánh loading của
 * CompanyProfilePage. Mô phỏng bố cục CompanyProfileView (hero 2 cột + 3 khối
 * biên tập) để không nhảy layout khi dữ liệu về. Chỉ hình khối + animate-pulse,
 * không dùng c3-fade; tôn trọng prefers-reduced-motion.
 */
</script>

<template>
  <div role="status" aria-busy="true" class="mx-auto max-w-[1240px] px-6 pt-10">
    <span class="sr-only">Đang tải hồ sơ doanh nghiệp</span>

    <!-- Hero: cột trái (nhãn + tiêu đề + mô tả) / card phải (logo + dòng chữ + nút) -->
    <div class="grid grid-cols-1 items-start gap-7 lg:grid-cols-[minmax(0,7fr)_minmax(0,4fr)] lg:gap-16">
      <div class="animate-pulse motion-reduce:animate-none">
        <div class="h-3 w-44 rounded bg-slate-100" />
        <div class="mt-4 h-9 w-[min(28rem,90%)] rounded bg-slate-100" />
        <div class="mt-2.5 h-9 w-[min(22rem,75%)] rounded bg-slate-100" />
        <div class="mt-5 h-4 w-[min(38rem,100%)] rounded bg-slate-100" />
        <div class="mt-2.5 h-4 w-[min(30rem,85%)] rounded bg-slate-100" />
      </div>

      <div class="flex animate-pulse flex-col gap-4 rounded-xl border border-slate-200 bg-white p-5 motion-reduce:animate-none">
        <div class="flex items-center gap-3.5">
          <div class="h-16 w-16 shrink-0 rounded-xl bg-slate-100" />
          <div class="min-w-0 flex-1">
            <div class="h-5 w-3/4 rounded bg-slate-100" />
            <div class="mt-2 h-3.5 w-1/2 rounded bg-slate-100" />
            <div class="mt-1.5 h-3.5 w-2/5 rounded bg-slate-100" />
          </div>
        </div>
        <div class="h-[42px] w-full rounded-lg bg-slate-100" />
      </div>
    </div>

    <!-- 3 khối biên tập: nhãn 4/12 + nội dung 8/12 trên lg, xếp dọc dưới lg -->
    <div class="pb-20 pt-14">
      <template v-for="i in 3" :key="i">
        <hr v-if="i > 1" class="my-11 border-0 border-t border-slate-200" />
        <section class="grid animate-pulse grid-cols-1 gap-5 motion-reduce:animate-none lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)] lg:gap-12">
          <div class="h-6 w-40 rounded bg-slate-100" />
          <div class="flex flex-col gap-2.5">
            <div class="h-4 w-full max-w-[68ch] rounded bg-slate-100" />
            <div class="h-4 w-[85%] rounded bg-slate-100" />
            <div class="h-4 w-[60%] rounded bg-slate-100" />
          </div>
        </section>
      </template>
    </div>
  </div>
</template>
