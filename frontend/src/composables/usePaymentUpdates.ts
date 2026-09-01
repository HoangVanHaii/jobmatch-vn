/**
 * usePaymentUpdates — subscribe `payment:updated` WebSocket event cho 1 orderCode.
 *
 * Tận dụng socket hiện có của project (services/socket.ts + backend notificationGateway).
 * KHÔNG tự connect/disconnect socket — lifecycle global do useSocketLifecycle / app-level.
 *
 * Usage:
 *   const { receivedSuccess, receivedFailed, receivedEvent } = usePaymentUpdates(orderCode, {
 *     onPaid: (event) => { ... },
 *     onFailed: (event) => { ... },
 *   });
 *
 * Lưu ý:
 * - Handler chỉ được gọi khi event.orderCode === orderCode truyền vào.
 * - receivedSuccess / receivedFailed là ref 1 chiều: chỉ set true 1 lần, không reset
 *   → caller có thể dùng để stop polling fallback.
 */
import { ref, onMounted, onUnmounted, type Ref } from 'vue';
import { getSocket } from '@services/socket';
import type { PaymentStatus } from '@/types/payment';

/**
 * Event payload mirror với backend `PaymentUpdatedEvent` (backend/src/interface/payment.ts).
 */
export interface PaymentUpdatedEvent {
    orderCode: string;
    status: PaymentStatus;
    subscriptionId: string | null;
    planId: string;
}

type Handlers = {
    onPaid?: (event: PaymentUpdatedEvent) => void;
    onFailed?: (event: PaymentUpdatedEvent) => void;
    onAny?: (event: PaymentUpdatedEvent) => void;
};

export function usePaymentUpdates(
    orderCode: Ref<string | null> | string | null,
    handlers: Handlers = {},
): {
    receivedSuccess: Readonly<Ref<boolean>>;
    receivedFailed: Readonly<Ref<boolean>>;
    receivedEvent: Readonly<Ref<PaymentUpdatedEvent | null>>;
} {
    const receivedSuccess = ref(false);
    const receivedFailed = ref(false);
    const receivedEvent = ref<PaymentUpdatedEvent | null>(null);

    // Resolve orderCode nếu là ref — vẫn capture trong closure, dùng .value lúc chạy.
    const getOrderCode = (): string | null =>
        typeof orderCode === 'string'
            ? orderCode
            : (orderCode?.value ?? null);

    const listener = (event: PaymentUpdatedEvent) => {
        const target = getOrderCode();
        if (!target) return;
        // Chỉ xử lý event đúng orderCode đang theo dõi
        if (event.orderCode !== target) return;

        receivedEvent.value = event;

        if (event.status === 'paid') {
            receivedSuccess.value = true;
            handlers.onPaid?.(event);
            handlers.onAny?.(event);
        } else if (event.status === 'failed') {
            receivedFailed.value = true;
            handlers.onFailed?.(event);
            handlers.onAny?.(event);
        }
        // 'pending' / 'cancelled' không trigger callback — caller tự polling DB nếu cần.
    };

    onMounted(() => {
        const socket = getSocket();
        // Defensive: nếu socket chưa connect (autoConnect:false), vẫn attach listener.
        // Khi socket connect sau, listener đã có sẵn → nhận event luôn.
        socket.on('payment:updated', listener);
    });

    onUnmounted(() => {
        // Cleanup bắt buộc để tránh memory leak / duplicate listener khi remount.
        const socket = getSocket();
        socket.off('payment:updated', listener);
    });

    return {
        receivedSuccess,
        receivedFailed,
        receivedEvent,
    };
}
