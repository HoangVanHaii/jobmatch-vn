import { watch, onBeforeUnmount, type Ref } from 'vue';

let lockCount = 0;
let prevBodyOverflow = '';

/**
 * Khóa cuộn trang (body overflow: hidden) khi modal mở.
 * Vì html sử dụng scrollbar-gutter: stable nên không cần bù trừ padding-right (tránh dịch ngang).
 * Thêm class 'scroll-locked' và biến CSS '--scroll-lock-bg' lên html để dải gutter
 * có cùng màu với lớp phủ backdrop, loại bỏ hoàn toàn dải trắng mép phải.
 */
export function lockBodyScroll(backdropBg?: string): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  if (lockCount === 0) {
    prevBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.classList.add('scroll-locked');
    if (backdropBg) {
      document.documentElement.style.setProperty('--scroll-lock-bg', backdropBg);
    }
  }
  lockCount++;
}

/**
 * Mở khóa cuộn trang khi toàn bộ modal đã đóng (lockCount về 0).
 */
export function unlockBodyScroll(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  if (lockCount > 0) {
    lockCount--;
  }
  if (lockCount === 0) {
    document.body.style.overflow = prevBodyOverflow;
    document.documentElement.classList.remove('scroll-locked');
    document.documentElement.style.removeProperty('--scroll-lock-bg');
  }
}

/**
 * Composable quản lý khóa cuộn trang khi modal mở.
 * Hỗ trợ bộ đếm đa modal lồng nhau và tự động dọn dẹp khi component unmount.
 */
export function useScrollLock(isOpen: Ref<boolean>, backdropBg?: string): void {
  let isCurrentlyLocked = false;

  watch(
    isOpen,
    (open) => {
      if (open && !isCurrentlyLocked) {
        lockBodyScroll(backdropBg);
        isCurrentlyLocked = true;
      } else if (!open && isCurrentlyLocked) {
        unlockBodyScroll();
        isCurrentlyLocked = false;
      }
    },
    { immediate: true },
  );

  onBeforeUnmount(() => {
    if (isCurrentlyLocked) {
      unlockBodyScroll();
      isCurrentlyLocked = false;
    }
  });
}
