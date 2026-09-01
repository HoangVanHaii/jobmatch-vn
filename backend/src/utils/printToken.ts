/**
 * Print token — HMAC-SHA256 signed token dùng cho Playwright navigate tới
 * `/print/cv/:cvId` mà KHÔNG cần Bearer token.
 *
 * Luồng:
 *   1. User bấm "Tải xuống" → FE gọi `GET /api/v1/cvs/:cvId/download-pdf`
 *      với Bearer token (auth chuẩn).
 *   2. BE xác minh ownership của CV, generate 1 print token (cvId + expiry +
 *      nonce, ký HMAC) có TTL ~120s.
 *   3. BE dùng Playwright navigate tới `${FRONTEND_URL}/print/cv/:cvId?token=...`.
 *   4. Print page gọi public endpoint `GET /api/v1/public/cv-render/:cvId?token=...`
 *      để lấy parsedData + templateId (BE verify chữ ký, không cần Bearer).
 *   5. Print page render, set `data-ready="true"` → Playwright capture PDF.
 *
 * Tại sao KHÔNG dùng JWT access token trong URL:
 *   - JWT là bearer token — lộ là compromise account. URL thường bị log ở
 *     Nginx / CDN / browser history / Referer header → rủi ro cao.
 *   - Print token scope CHỈ cho phép đọc CV render data của đúng 1 cvId,
 *     có TTL ngắn (120s) → compromise cũng chỉ expose 1 CV trong 2 phút.
 *
 * Format: `<payloadB64>.<signatureB64>` — payload = JSON { cvId, exp, nonce }.
 */
import crypto from 'node:crypto';
import { env } from '../config/env';
import { AppError } from '../middleware/errorHandler';

interface PrintTokenPayload {
  /** CV ID mà token authorize. */
  cvId: string;
  /** Expiry — Unix epoch seconds. */
  exp: number;
  /** Random nonce — chống replay + đảm bảo 2 token cho cùng cvId là khác nhau. */
  nonce: string;
}

const b64url = (buf: Buffer): string =>
  buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const b64urlDecode = (s: string): Buffer => {
  // Re-pad nếu thiếu.
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
};

/** Ký HMAC-SHA256 trên payload object → trả về string token. */
export const signPrintToken = (cvId: string): string => {
  const payload: PrintTokenPayload = {
    cvId,
    exp: Math.floor(Date.now() / 1000) + env.PRINT_TOKEN_TTL_SECONDS,
    nonce: crypto.randomBytes(8).toString('hex'),
  };
  const payloadJson = JSON.stringify(payload);
  const payloadB64 = b64url(Buffer.from(payloadJson, 'utf8'));
  const signature = crypto
    .createHmac('sha256', env.PRINT_TOKEN_SECRET)
    .update(payloadB64)
    .digest();
  const sigB64 = b64url(signature);
  return `${payloadB64}.${sigB64}`;
};

/**
 * Verify token + trả về payload.
 * Throw AppError nếu token sai format / sai chữ ký / hết hạn / cvId không khớp.
 */
export const verifyPrintToken = (token: string, expectedCvId: string): PrintTokenPayload => {
  if (typeof token !== 'string' || token.length === 0) {
    throw new AppError(401, 'INVALID_PRINT_TOKEN', 'Print token is missing');
  }
  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) {
    throw new AppError(401, 'INVALID_PRINT_TOKEN', 'Print token format is invalid');
  }
  const payloadB64 = token.slice(0, dot);
  const sigB64 = token.slice(dot + 1);

  // Verify chữ ký TRƯỚC khi parse payload — chống padding oracle / DoS.
  let expectedSig: Buffer;
  let providedSig: Buffer;
  try {
    expectedSig = b64urlDecode(sigB64);
    providedSig = crypto
      .createHmac('sha256', env.PRINT_TOKEN_SECRET)
      .update(payloadB64)
      .digest();
  } catch {
    throw new AppError(401, 'INVALID_PRINT_TOKEN', 'Print token signature is malformed');
  }
  if (
    expectedSig.length !== providedSig.length ||
    !crypto.timingSafeEqual(expectedSig, providedSig)
  ) {
    throw new AppError(401, 'INVALID_PRINT_TOKEN', 'Print token signature is invalid');
  }

  let payload: PrintTokenPayload;
  try {
    const json = b64urlDecode(payloadB64).toString('utf8');
    payload = JSON.parse(json) as PrintTokenPayload;
  } catch {
    throw new AppError(401, 'INVALID_PRINT_TOKEN', 'Print token payload is malformed');
  }
  if (
    typeof payload.cvId !== 'string' ||
    typeof payload.exp !== 'number' ||
    typeof payload.nonce !== 'string'
  ) {
    throw new AppError(401, 'INVALID_PRINT_TOKEN', 'Print token payload is malformed');
  }
  if (payload.cvId !== expectedCvId) {
    throw new AppError(401, 'INVALID_PRINT_TOKEN', 'Print token was issued for a different CV');
  }
  if (payload.exp <= Math.floor(Date.now() / 1000)) {
    throw new AppError(401, 'PRINT_TOKEN_EXPIRED', 'Print token has expired');
  }
  return payload;
};
