/**
 * File-type icon/color helper — map MIME → Lucide icon + Tailwind color.
 *
 * Dùng cho:
 *   - MessageInput preview (pending upload) — iconForMime + colorForMime
 *   - MessageList render (đã gửi) — cùng map → đồng bộ visual
 *
 * Icon: Lucide-vue-next component (import ở component rồi truyền vào hàm).
 * Color: Tailwind class, KHÔNG động vào `class:` vì Tailwind cần full class
 *   string ở build time (purge CSS). Consumer compose: `${colorForMime(...)}`.
 */
import {
  FileText,
  FileSpreadsheet,
  FilePieChart,
  FileArchive,
  File as FileIcon,
  FileCode,
} from 'lucide-vue-next';
import type { Component } from 'vue';

export interface FileIconInfo {
  icon: Component;
  color: string;
  label: string;
}

/**
 * Map MIME → icon component + màu + label.
 *
 * Màu theo convention:
 *   - PDF: red (Adobe)
 *   - Word/DOC: blue (Microsoft Word)
 *   - Excel/XLS: green (Microsoft Excel)
 *   - PowerPoint/PPT: orange (Microsoft PowerPoint)
 *   - ZIP/archive: yellow
 *   - Text/CSV: gray
 *   - Khác: gray (File mặc định)
 */
export const fileIconInfo = (mime: string, name?: string | null): FileIconInfo => {
  // Match theo MIME trước (chính xác nhất)
  if (mime === 'application/pdf') {
    return { icon: FileText, color: 'text-red-500', label: 'PDF' };
  }
  if (
    mime === 'application/msword' ||
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    return { icon: FileText, color: 'text-blue-500', label: 'DOC' };
  }
  if (
    mime === 'application/vnd.ms-excel' ||
    mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ) {
    return { icon: FileSpreadsheet, color: 'text-emerald-500', label: 'XLS' };
  }
  if (
    mime === 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ) {
    return { icon: FilePieChart, color: 'text-orange-500', label: 'PPT' };
  }
  if (mime === 'application/zip' || mime === 'application/x-zip-compressed') {
    return { icon: FileArchive, color: 'text-yellow-500', label: 'ZIP' };
  }
  if (mime.startsWith('text/')) {
    return { icon: FileText, color: 'text-gray-500', label: mime === 'text/csv' ? 'CSV' : 'TXT' };
  }
  if (mime.startsWith('application/json') || mime.includes('xml')) {
    return { icon: FileCode, color: 'text-amber-500', label: 'CODE' };
  }

  // Fallback theo extension (khi MIME không nhận diện — vd. file lạ)
  const ext = (name ?? '').split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'pdf': return { icon: FileText, color: 'text-red-500', label: 'PDF' };
    case 'doc':
    case 'docx': return { icon: FileText, color: 'text-blue-500', label: 'DOC' };
    case 'xls':
    case 'xlsx': return { icon: FileSpreadsheet, color: 'text-emerald-500', label: 'XLS' };
    case 'ppt':
    case 'pptx': return { icon: FilePieChart, color: 'text-orange-500', label: 'PPT' };
    case 'zip':
    case 'rar':
    case '7z': return { icon: FileArchive, color: 'text-yellow-500', label: 'ZIP' };
    case 'txt':
    case 'md': return { icon: FileText, color: 'text-gray-500', label: 'TXT' };
    case 'csv': return { icon: FileSpreadsheet, color: 'text-gray-500', label: 'CSV' };
    case 'json':
    case 'xml':
    case 'html': return { icon: FileCode, color: 'text-amber-500', label: 'CODE' };
    default: return { icon: FileIcon, color: 'text-gray-500', label: 'FILE' };
  }
};
