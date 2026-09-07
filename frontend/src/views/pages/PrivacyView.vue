<script setup lang="ts">
/**
 * PrivacyView — Chính sách bảo mật (placeholder).
 *
 * TODO: Thay bằng nội dung thật được duyệt bởi Legal team trước khi ship production.
 * Hiện tại chỉ là placeholder để user click từ consent checkbox không bị 404.
 */
</script>

<template>
  <div class="min-h-screen bg-slate-50 py-12 px-4">
    <div class="mx-auto max-w-3xl bg-white rounded-2xl shadow-sm p-8 sm:p-10">
      <h1 class="text-2xl sm:text-3xl font-bold text-slate-900 mb-2">Chính sách bảo mật</h1>
      <p class="text-sm text-slate-500 mb-8">Cập nhật lần cuối: 01/01/2026</p>

      <section class="space-y-4 text-slate-700 leading-relaxed">
        <h2 class="text-lg font-semibold text-slate-900 mt-6">1. Thông tin chúng tôi thu thập</h2>
        <p>
          Khi bạn đăng ký tài khoản, chúng tôi thu thập: email, họ tên, vai trò (ứng viên/nhà tuyển dụng),
          và thông tin hồ sơ bạn tự cung cấp. Khi đăng nhập bằng Google/Facebook/GitHub, chúng tôi nhận
          email và tên hiển thị từ nhà cung cấp.
        </p>

        <h2 class="text-lg font-semibold text-slate-900 mt-6">2. Mục đích sử dụng</h2>
        <p>
          Thông tin được dùng để: (a) cung cấp dịch vụ kết nối việc làm; (b) xác thực tài khoản; (c) gửi
          thông báo quan trọng (OTP, cập nhật bảo mật); (d) cải thiện sản phẩm.
        </p>

        <h2 class="text-lg font-semibold text-slate-900 mt-6">3. Bảo mật</h2>
        <p>
          Mật khẩu được mã hoá bằng bcrypt. Token phiên đăng nhập có thời hạn và có thể thu hồi.
          Hệ thống ghi log mọi hành động nhạy cảm (đăng nhập, đổi mật khẩu, đăng xuất).
        </p>

        <h2 class="text-lg font-semibold text-slate-900 mt-6">4. Quyền của bạn</h2>
        <p>
          Theo Nghị định 13/2023 về bảo vệ dữ liệu cá nhân, bạn có quyền: truy cập, chỉnh sửa, xóa
          dữ liệu cá nhân. Liên hệ <a href="mailto:privacy@jobmatch.vn" class="text-primary-600 underline">privacy@jobmatch.vn</a>
          để thực hiện quyền.
        </p>

        <h2 class="text-lg font-semibold text-slate-900 mt-6">5. Liên hệ</h2>
        <p>Email: <a href="mailto:privacy@jobmatch.vn" class="text-primary-600 underline">privacy@jobmatch.vn</a></p>
      </section>

      <div class="mt-10 pt-6 border-t border-slate-200">
        <RouterLink to="/register" class="text-sm text-primary-600 hover:text-primary-700 font-medium">
          ← Quay lại đăng ký
        </RouterLink>
      </div>
    </div>
  </div>
</template>
