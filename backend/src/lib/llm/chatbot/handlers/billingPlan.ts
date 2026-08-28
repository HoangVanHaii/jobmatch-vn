/**
 * Handler cho intent `billing_plan` — liệt kê các gói + gói user đang dùng.
 *
 * Doc §3.2: bot chỉ biết "số gói hiện có + gói user đang dùng" — KHÔNG suy diễn
 * khuyến mãi hay cam kết ngoài DB.
 */
import type { HandlerContext, HandlerSection } from '../types';

const formatVnd = (s: string | number): string => {
  const n = typeof s === 'string' ? Number(s) : s;
  if (!Number.isFinite(n)) return String(s);
  return n.toLocaleString('vi-VN');
};

export const billingPlanHandler = async (ctx: HandlerContext): Promise<HandlerSection> => {
  // Service đã load sẵn plans + subscription; nếu rỗng thì list tự fill.
  const activePlans = ctx.plans ?? [];
  const userSub = ctx.subscription;

  const planBlocks = activePlans.length
    ? activePlans.map((p, i) => {
        const duration = p.durationDays ? `${p.durationDays} ngày` : 'không xác định';
        return `Gói #${i + 1}: "${p.name}" (mã: ${p.code})
  - Giá: ${formatVnd(p.priceVnd)} VNĐ / ${duration}
  - Tính năng: ${Object.keys(p.features ?? {}).length ? JSON.stringify(p.features) : '(chưa mô tả)'}`;
      })
    : ['(Hệ thống chưa có gói nào — sàn đang cập nhật.)'];

  let userBlock: string;
  if (!userSub) {
    userBlock = 'User hiện CHƯA có gói đang hoạt động (chưa mua hoặc gói đã hết hạn).';
  } else {
    const expires = new Date(userSub.expiresAt).toLocaleDateString('vi-VN');
    userBlock = `User đang dùng gói: "${userSub.planName}" (mã: ${userSub.planCode}), hết hạn ${expires}.`;
  }

  return {
    label: 'billing_plan',
    citeData: true,
    content: `Các gói hiện có trong hệ thống:\n${planBlocks.join('\n\n')}\n\n${userBlock}\n\nLưu ý: giá/tính năng lấy từ DB. Không tự suy diễn khuyến mãi hay cam kết ngoài DB.`,
  };
};
