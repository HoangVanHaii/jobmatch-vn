/**
 * Detect Gemini API rate limit (HTTP 429) từ error của LangChain.
 * LangChain wrap error không đồng nhất — check nhiều chỗ.
 */
export const isRateLimited = (err: unknown): boolean => {
  if (!err || typeof err !== "object") return false;
  const e = err as Record<string, unknown>;

  if (e.status === 429 || e.statusCode === 429) return true;

  const response = e.response as Record<string, unknown> | undefined;
  if (response?.status === 429) return true;

  const msg = String(e.message ?? "");
  if (msg.includes("429") || msg.toLowerCase().includes("rate limit"))
    return true;
  if (msg.includes("RESOURCE_EXHAUSTED")) return true;

  return false;
};

/**
 * Wait với log — dùng cho 429 retry.
 */
export const waitForRateLimit = async (ms: number = 30_000): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};
