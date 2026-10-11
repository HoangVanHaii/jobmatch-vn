/**
 * Helper map mã lỗi (error code) sang câu thông báo tiếng Việt thân thiện cho người dùng.
 * Đảm bảo Frontend không bao giờ hiển thị chuỗi tiếng Anh thô từ server hoặc thư viện mạng.
 */

const VIETNAMESE_ACCENT_REGEX =
  /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđĐ]/i;

export const NOTIFICATION_ERROR_CODE_MAP: Record<string, string> = {
  NOTIFICATION_NOT_FOUND: 'Không tìm thấy thông báo',
  VALIDATION_ERROR: 'Dữ liệu không hợp lệ',
  UNAUTHORIZED: 'Bạn cần đăng nhập để thực hiện thao tác này',
  FORBIDDEN: 'Bạn không có quyền thực hiện thao tác này',
  ROUTE_NOT_FOUND: 'Không tìm thấy đường dẫn yêu cầu',
  NOT_FOUND: 'Không tìm thấy đường dẫn yêu cầu',
  INVALID_CURSOR: 'Tham số phân trang không hợp lệ',
  RATE_LIMITED: 'Bạn thao tác quá nhanh, vui lòng thử lại sau',
  OAUTH_RATE_LIMITED: 'Bạn thao tác quá nhanh, vui lòng thử lại sau',
  OTP_RATE_LIMITED: 'Bạn thao tác quá nhanh, vui lòng thử lại sau',
  INTERNAL_ERROR: 'Đã có lỗi xảy ra, vui lòng thử lại sau',
};

export const getNotificationErrorMessage = (
  error: unknown,
  fallbackActionMessage?: string,
): string => {
  if (!error) {
    return fallbackActionMessage || 'Đã có lỗi xảy ra, vui lòng thử lại';
  }

  // 1. Kiểm tra lỗi mạng (Network error / offline / không có response)
  const isNetworkError =
    (error as any)?.isAxiosError &&
    !(error as any)?.response &&
    ((error as any)?.code === 'ERR_NETWORK' ||
      (error as any)?.message?.toLowerCase().includes('network'));

  if (isNetworkError || (error as any)?.message === 'Network Error') {
    return 'Không thể kết nối tới máy chủ, vui lòng kiểm tra mạng và thử lại';
  }

  // 2. Kiểm tra lỗi timeout
  const isTimeout =
    (error as any)?.code === 'ECONNABORTED' ||
    (error as any)?.code === 'ETIMEDOUT' ||
    (error as any)?.message?.toLowerCase().includes('timeout');

  if (isTimeout) {
    return 'Yêu cầu quá thời gian chờ, vui lòng thử lại';
  }

  // 3. Trích xuất error code (ưu tiên response.data.error.code trước e.code để tránh bị AxiosError ERR_BAD_REQUEST che mất mã nghiệp vụ)
  const code: string | undefined =
    (error as any)?.response?.data?.error?.code ||
    (error as any)?.code ||
    (typeof (error as any)?.errorCode === 'string' ? (error as any)?.errorCode : undefined);

  if (code && typeof code === 'string' && NOTIFICATION_ERROR_CODE_MAP[code]) {
    return NOTIFICATION_ERROR_CODE_MAP[code];
  }

  // 4. Trích xuất message từ server (HttpError hoặc Axios response error)
  const serverMessage: string | undefined =
    (error as any)?.response?.data?.error?.message ||
    (typeof (error as any)?.message === 'string' ? (error as any)?.message : undefined);

  // Chỉ dùng serverMessage nếu có chứa ký tự tiếng Việt có dấu và code không nằm trong map
  if (serverMessage && typeof serverMessage === 'string' && VIETNAMESE_ACCENT_REGEX.test(serverMessage)) {
    return serverMessage;
  }

  // 5. Fallback an toàn (tuyệt đối không hiển thị chuỗi tiếng Anh thô ra UI)
  return fallbackActionMessage || 'Đã có lỗi xảy ra, vui lòng thử lại';
};
