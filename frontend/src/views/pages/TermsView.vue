<script setup lang="ts">
/**
 * TermsView — Điều khoản sử dụng (placeholder).
 *
 * TODO: Thay bằng nội dung thật được duyệt bởi Legal team trước khi ship production.
 * Hiện tại chỉ là placeholder để user click từ consent checkbox không bị 404.
 */
</script>

<template>
  <div class="min-h-screen bg-slate-50 py-12 px-4">
    <div class="mx-auto max-w-3xl bg-white rounded-2xl shadow-sm p-8 sm:p-10">
      <h1 class="text-2xl sm:text-3xl font-bold text-slate-900 mb-2">Điều khoản sử dụng</h1>
      <p class="text-sm text-slate-500 mb-8">Cập nhật lần cuối: 01/01/2026</p>

      <section class="space-y-4 text-slate-700 leading-relaxed">
        <h2 class="text-lg font-semibold text-slate-900 mt-6">1. Giới thiệu</h2>
        <p>
          JobMatch VN là nền tảng kết nối ứng viên và nhà tuyển dụng tại Việt Nam. Bằng việc
          tạo tài khoản và sử dụng dịch vụ, bạn đồng ý tuân thủ các điều khoản dưới đây.
        </p>

        <h2 class="text-lg font-semibold text-slate-900 mt-6">2. Tài khoản người dùng</h2>
        <p>
          Bạn chịu trách nhiệm bảo mật thông tin đăng nhập và mọi hoạt động dưới tài khoản của mình.
          Vui lòng sử dụng mật khẩu mạnh (ít nhất 8 ký tự, gồm chữ hoa, chữ thường và số).
        </p>

        <h2 class="text-lg font-semibold text-slate-900 mt-6">3. Quyền và nghĩa vụ</h2>
        <p>
          Người dùng có quyền tạo hồ sơ, ứng tuyển công việc (ứng viên) hoặc đăng tin tuyển dụng
          (nhà tuyển dụng). Mọi nội dung đăng tải phải tuân thủ pháp luật Việt Nam.
        </p>

        <h2 class="text-lg font-semibold text-slate-900 mt-6">4. Liên hệ</h2>
        <p>Mọi thắc mắc vui lòng liên hệ: <a href="mailto:support@jobmatch.vn" class="text-primary-600 underline">support@jobmatch.vn</a></p>
      </section>

      <div class="mt-10 pt-6 border-t border-slate-200">
        <RouterLink to="/register" class="text-sm text-primary-600 hover:text-primary-700 font-medium">
          ← Quay lại đăng ký
        </RouterLink>
      </div>
    </div>
  </div>
</template>
