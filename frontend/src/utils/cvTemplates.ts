/**
 * cvTemplates — metadata chung của 7 mẫu CV hệ thống (CVTemplate1-7).
 *
 * Dùng bởi builder (CreateResumeView preview pane + preview modal) và mọi
 * chỗ cần liệt kê mẫu với tên hiển thị thật. Tên copy từ `aiTemplateMeta`
 * ở MyResumesView (đừng refactor MyResumesView sang đây trong task này —
 * tránh mở rộng blast radius).
 */
export interface CvTemplateMeta {
  id: number;
  name: string;
  desc: string;
}

export const CV_TEMPLATE_META: CvTemplateMeta[] = [
  { id: 1, name: 'Mustard Editorial', desc: 'Navy/yellow, tên dọc + ảnh chân dung' },
  { id: 2, name: 'Teal Hình Học', desc: 'Góc chữ L teal + avatar viền đen' },
  { id: 3, name: 'Serif Cổ Điển', desc: 'Serif 1 cột, header căn giữa' },
  { id: 4, name: 'Navy Chuyên Nghiệp', desc: 'Thanh navy + header nền xanh nhạt' },
  { id: 5, name: 'Sidebar Cá Tính', desc: 'Sidebar trái xanh + tam giác decor' },
  { id: 7, name: 'Ocean Teal Executive', desc: 'Serif xanh biển, thanh liên hệ ngang' },
] as const;

/** Clamp templateId về đoạn hợp lệ 1..7 (mẫu 6 đã xoá do trùng mẫu 1 nên map về 1). */
export const clampTemplateId = (id: unknown): number => {
  const n = Number(id);
  if (!Number.isInteger(n) || n < 1 || n > 7 || n === 6) return 1;
  return n;
};
