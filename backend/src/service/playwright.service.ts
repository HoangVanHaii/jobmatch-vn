/**
 * Playwright service — render CV page (URL trỏ tới FE `/print/cv/:cvId`) sang
 * PDF vector bằng headless Chromium.
 *
 * Quyết định thiết kế:
 *   - Singleton browser instance cho toàn bộ server (Chromium ~150MB RAM,
 *     spawn mỗi request sẽ latency cao + leak file descriptors).
 *   - Semaphore giới hạn concurrency (mặc định 2) — mỗi page render ~200-400MB
 *     RAM tuỳ template, đồng thời nhiều request dễ OOM.
 *   - `chromium.launch({ headless: true })` mặc định (Playwright đã bundle sẵn
 *     Chromium khi `playwright install chromium`). Dùng `playwright-core` thay
 *     vì `playwright` để không kéo theo browser binaries khác (firefox/webkit).
 *   - Mỗi request mở 1 page mới + context mới (cookies/localStorage sạch) →
 *     đóng page + context sau khi xong, KHÔNG đóng browser.
 *   - Env `PLAYWRIGHT_EXECUTABLE_PATH` cho phép override binary path (vd khi
 *     deploy trên Alpine/Chromium custom build) — fallback về default của
 *     playwright-core khi không set.
 *
 * Tại sao KHÔNG dùng html2canvas/html2pdf.js:
 *   - Đã thử 5+ lần fix, bug do bản chất capture DOM → canvas không ổn định
 *     với layout hiện tại (position:fixed ancestor, CORS ảnh, canvas trắng,
 *     timing pipeline). Playwright render vector thật, không có nhóm bug này.
 *   - PDF vector in đẹp hơn nhiều so với PNG/JPEG nhúng trong PDF.
 *   - Tailwind + layout hiện tại render y hệt trong Chromium thật.
 */
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { AppError } from '../middleware/errorHandler';

let browserInstance: Browser | null = null;
let browserInitPromise: Promise<Browser> | null = null;

/**
 * Khởi tạo (hoặc trả về) singleton Chromium browser.
 *
 * Trên Node 18+, Playwright đã bundle Chromium qua `playwright-core` package.
 * Nếu browser binary chưa có, cần `npx playwright install chromium` 1 lần
 * (Docker: RUN npx playwright install --with-deps chromium).
 */
const ensureBrowser = async (): Promise<Browser> => {
  if (browserInstance?.isConnected()) return browserInstance;
  if (browserInitPromise) return browserInitPromise;

  browserInitPromise = (async () => {
    const launchOptions: Parameters<typeof chromium.launch>[0] = {
      headless: true,
      args: [
        // Tăng tốc + giảm memory:
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        // Ngăn Chromium download font update online — render CV dùng system fonts.
        '--disable-features=FontAccess',
      ],
    };
    if (env.PLAYWRIGHT_EXECUTABLE_PATH) {
      launchOptions.executablePath = env.PLAYWRIGHT_EXECUTABLE_PATH;
    }
    const browser = await chromium.launch(launchOptions);
    browserInstance = browser;
    logger.info('[playwright] chromium launched');
    // Đóng browser nếu process đang thoát — tránh zombie chromium.
    const shutdown = async () => {
      try {
        if (browser.isConnected()) await browser.close();
      } catch {/* ignore */}
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
    return browser;
  })();

  try {
    return await browserInitPromise;
  } finally {
    browserInitPromise = null;
  }
};

/**
 * Semaphore (counting semaphore) — giới hạn số request PDF render đồng thời.
 *
 * Dùng Promise-based acquire/release pattern. Nếu đã đạt max concurrency, các
 * caller sau phải đợi (FIFO qua promise chain).
 */
class Semaphore {
  private permits: number;
  private waiters: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits -= 1;
      return;
    }
    return new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  release(): void {
    const next = this.waiters.shift();
    if (next) next();
    else this.permits += 1;
  }

  /** Try acquire — return false nếu không có permit available (không block). */
  tryAcquire(): boolean {
    if (this.permits <= 0) return false;
    this.permits -= 1;
    return true;
  }
}

const renderSemaphore = new Semaphore(env.PLAYWRIGHT_MAX_CONCURRENCY);

export interface RenderPdfOptions {
  /** URL đầy đủ cần render (Playwright navigate tới). Đã bao gồm query string
   *  signed token — Playwright KHÔNG cần thêm auth. */
  url: string;
  /** Selector xuất hiện khi CV render xong (data-ready="true"). Mặc định
   *  dùng `[data-ready="true"]` đặt trên <body> của print page. */
  readySelector?: string;
  /** Timeout chờ page ready (ms). Mặc định 15s — render + image load + font. */
  readyTimeoutMs?: number;
  /** Page format cho PDF. Mặc định A4 — override khi layout CV không khớp A4. */
  format?: 'A4' | 'A3' | 'Letter' | 'Legal';
  /** Landscape hay portrait. */
  landscape?: boolean;
  /** In background (màu nền, ảnh). Mặc định true — CV có background trắng/gradient. */
  printBackground?: boolean;
  /** Margin (CSS units) — PDF margins. */
  margin?: {
    top?: string;
    right?: string;
    bottom?: string;
    left?: string;
  };
}

/**
 * Render URL → PDF Buffer.
 *
 * Flow:
 *   1. Acquire semaphore slot (block nếu đầy).
 *   2. Launch (hoặc reuse) singleton browser.
 *   3. newContext() → newPage() với viewport rộng (1280×900) để Tailwind
 *      responsive breakpoints không trigger mobile layout.
 *   4. page.goto(url, { waitUntil: 'networkidle' }) — đợi mọi request done.
 *   5. waitForSelector('[data-ready="true"]', { timeout }) — FE print page
 *      set attribute này khi DOM render + fonts + ảnh load xong.
 *   6. Đợi thêm 1 frame để layout settle (CSS transitions có thể chưa xong).
 *   7. page.pdf(options) → Buffer.
 *   8. Đóng page + context (giải phóng memory).
 *   9. Release semaphore.
 */
export const renderUrlToPdf = async (options: RenderPdfOptions): Promise<Buffer> => {
  await renderSemaphore.acquire();
  let context: BrowserContext | null = null;
  try {
    const browser = await ensureBrowser();
    context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      // Không cần user agent giả lập — Chromium default là OK.
      // deviceScaleFactor: 2 để PDF render sắc nét (CSS pixel × 2 = physical pixel).
      deviceScaleFactor: 2,
    });
    const page: Page = await context.newPage();

    // Catch page errors để surface trong AppError thay vì treo Playwright timeout.
    // Dùng wrapper class để track error xuyên qua async callback (TS narrowing
    // không theo side-effect của page.on callback).
    const errorCapture = { current: null as Error | null };
    page.on('pageerror', (err: Error) => {
      errorCapture.current = err;
      logger.error(`[playwright] page error: ${err.message}`);
    });

    try {
      await page.goto(options.url, {
        waitUntil: 'networkidle',
        timeout: 30_000,
      });

      const readySel = options.readySelector ?? '[data-ready="true"]';
      const readyTimeout = options.readyTimeoutMs ?? 15_000;
      await page.waitForSelector(readySel, {
        timeout: readyTimeout,
        state: 'attached',
      });
      if (errorCapture.current) {
        throw new AppError(
          502,
          'PRINT_PAGE_RENDER_ERROR',
          `Print page error: ${errorCapture.current.message}`,
        );
      }

      // Đợi thêm 1 frame + fonts ready để chắc chắn layout settle.
      // Dùng string expression thay vì function — Playwright evaluate chạy
      // trong browser context nên code này cần DOM globals (document, requestAnimationFrame)
      // mà tsconfig BE không có `lib: ["dom"]`. String form bypass TS type check.
      await page.evaluate(`(async () => {
        if (document.fonts && document.fonts.ready) {
          await document.fonts.ready;
        }
        await new Promise((resolve) => requestAnimationFrame(() => resolve()));
      })()`);

      const pdfBuffer = await page.pdf({
        format: options.format ?? 'A4',
        landscape: options.landscape ?? false,
        printBackground: options.printBackground ?? true,
        margin: options.margin ?? {
          top: '0',
          right: '0',
          bottom: '0',
          left: '0',
        },
        // PreferCSSPageSize: nếu CV HTML có @page CSS → dùng size đó.
        // (Hiện tại CV templates không set, để false để dùng format option.)
        preferCSSPageSize: false,
      });

      return pdfBuffer;
    } finally {
      // Đóng page + context — KHÔNG đóng browser (singleton, dùng lại).
      try {
        await page.close();
      } catch {/* ignore */}
    }
  } catch (err) {
    if (err instanceof AppError) throw err;
    logger.error(`[playwright] render failed: ${err instanceof Error ? err.message : String(err)}`);
    throw new AppError(
      502,
      'PDF_RENDER_FAILED',
      err instanceof Error ? err.message : 'Failed to render CV to PDF',
    );
  } finally {
    if (context) {
      try {
        await context.close();
      } catch {/* ignore */}
    }
    renderSemaphore.release();
  }
};

/**
 * Đóng browser — gọi khi server shutdown (graceful).
 * Hiện tại SIGINT/SIGTERM đã đăng ký trong ensureBrowser(), nhưng export
 * để script (jest teardown, custom shutdown hook) có thể gọi.
 */
export const closeBrowser = async (): Promise<void> => {
  if (!browserInstance) return;
  if (!browserInstance.isConnected()) {
    browserInstance = null;
    return;
  }
  try {
    await browserInstance.close();
  } finally {
    browserInstance = null;
  }
};
