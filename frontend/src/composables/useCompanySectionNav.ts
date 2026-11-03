/**
 * useCompanySectionNav.ts — Quản lý cuộn trang, sticky header, và scroll-spy
 * cho 5 section trong form chỉnh sửa hồ sơ công ty.
 */
import { nextTick, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue';

export interface EditSection {
  id: string;
  label: string;
}

export const editSections: EditSection[] = [
  { id: 'sec-brand', label: 'Nhận diện thương hiệu' },
  { id: 'sec-general', label: 'Thông tin chung' },
  { id: 'sec-address', label: 'Địa chỉ' },
  { id: 'sec-about', label: 'Giới thiệu' },
  { id: 'sec-social', label: 'Mạng xã hội' },
];

export function useCompanySectionNav(
  rootEl: Ref<HTMLElement | null>,
  headerEl: Ref<HTMLElement | null>,
) {
  const activeSection = ref<string>(editSections[0].id);
  const isStuck = ref(false);

  let headerResizeObserver: ResizeObserver | null = null;
  const lgMq = window.matchMedia('(min-width: 1024px)');

  let spyRaf = 0;
  let spyLockUntil = 0;

  /**
   * Đồng bộ layout cuộn theo chiều cao header đo thực tế:
   * - Đọc computed position của header: chỉ cộng offset khi header đang "sticky"
   *   (≥lg). Dưới lg header tĩnh → h = 0, section dừng ngay dưới mép trên.
   * - Ghi CSS var --c3-header-h lên root (dùng cho aside sticky + min-height
   *   section 05).
   * - Set scroll-margin-top cho 5 section qua rootEl.querySelector (không dùng
   *   document.getElementById để an toàn khi render nhiều instance).
   */
  function syncSectionScrollMargin(): void {
    const root = rootEl.value;
    const header = headerEl.value;
    if (!root || !header) return;
    const sticky = getComputedStyle(header).position === 'sticky';
    const h = sticky ? header.getBoundingClientRect().height : 0;
    root.style.setProperty('--c3-header-h', `${Math.round(h)}px`);
    for (const s of editSections) {
      root
        .querySelector<HTMLElement>(`#${s.id}`)
        ?.style.setProperty('scroll-margin-top', `${Math.round(h + 16)}px`);
    }
  }

  watch(headerEl, (el) => {
    headerResizeObserver?.disconnect();
    headerResizeObserver = null;
    if (el) {
      headerResizeObserver = new ResizeObserver(syncSectionScrollMargin);
      headerResizeObserver.observe(el);
    }
  });

  function onScrollSpy(): void {
    if (spyRaf) return;
    spyRaf = requestAnimationFrame(() => {
      spyRaf = 0;
      isStuck.value = window.scrollY > 8;
      if (Date.now() < spyLockUntil) return; // đang khóa spy sau khi bấm mục lục
      const header = headerEl.value;
      const sticky = header ? getComputedStyle(header).position === 'sticky' : false;
      const headerBottom = sticky && header ? header.getBoundingClientRect().bottom : 0;
      let current = editSections[0].id;
      for (const s of editSections) {
        const el = rootEl.value?.querySelector(`#${s.id}`);
        if (el && el.getBoundingClientRect().top <= headerBottom + 24) current = s.id;
        else break;
      }
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) {
        current = editSections[editSections.length - 1].id;
      }
      activeSection.value = current;
    });
  }

  function unlockSpyOnScrollEnd(): void {
    spyLockUntil = 0;
  }

  function scrollToSection(id: string): void {
    activeSection.value = id;
    const el = rootEl.value?.querySelector<HTMLElement>(`#${id}`);
    if (!el) return;
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    spyLockUntil = Date.now() + 800;
    // Section 01 nằm ngay đầu trang (vị trí lúc vừa vào chế độ sửa, scrollY = 0):
    // về thẳng top 0 thay vì tính offset, tránh lệch 20px do mt-9 của tiêu đề.
    if (id === editSections[0].id) {
      window.scrollTo({ top: 0, behavior: prefersReduced ? 'auto' : 'smooth' });
    } else {
      const header = headerEl.value;
      const sticky = header ? getComputedStyle(header).position === 'sticky' : false;
      const headerH = sticky && header ? header.getBoundingClientRect().height : 0;
      const top = el.getBoundingClientRect().top + window.scrollY - (headerH + 16);
      window.scrollTo({ top, behavior: prefersReduced ? 'auto' : 'smooth' });
    }
    // Chuyển focus vào tiêu đề section (a11y bàn phím / screen reader).
    el.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
  }

  watch(activeSection, async () => {
    if (lgMq.matches) return;
    await nextTick();
    const nav = rootEl.value?.querySelector('nav[aria-label="Các mục của biểu mẫu"]');
    const ol = nav?.querySelector('ol');
    const btn = ol?.querySelector<HTMLElement>('button[aria-current="location"]');
    if (!ol || !btn) return;
    const olRect = ol.getBoundingClientRect();
    const btnRect = btn.getBoundingClientRect();
    if (btnRect.left < olRect.left) {
      ol.scrollLeft -= Math.round(olRect.left - btnRect.left);
    } else if (btnRect.right > olRect.right) {
      ol.scrollLeft += Math.round(btnRect.right - olRect.right);
    }
  });

  onMounted(() => {
    lgMq.addEventListener('change', syncSectionScrollMargin);
    document.addEventListener('scrollend', unlockSpyOnScrollEnd, { passive: true });
    window.addEventListener('scroll', onScrollSpy, { passive: true });
    window.addEventListener('resize', onScrollSpy);
    onScrollSpy();
  });

  onBeforeUnmount(() => {
    headerResizeObserver?.disconnect();
    headerResizeObserver = null;
    lgMq.removeEventListener('change', syncSectionScrollMargin);
    document.removeEventListener('scrollend', unlockSpyOnScrollEnd);
    window.removeEventListener('scroll', onScrollSpy);
    window.removeEventListener('resize', onScrollSpy);
    if (spyRaf) cancelAnimationFrame(spyRaf);
  });

  return {
    editSections,
    activeSection,
    isStuck,
    scrollToSection,
  };
}

