/**
 * Repro trắng trang khi vào /candidate/resumes/:cvId/edit
 *
 * Catch:
 *   - console.error / console.warn
 *   - pageerror (uncaught exception)
 *   - requestfailed (network)
 *   - response lỗi 4xx/5xx
 *   - DOM body innerHTML khi page load xong (xem có gì render không)
 *
 * Nếu thấy trang trắng → screenshot + page.content()
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const FE = 'http://localhost:5173';
const BE = 'http://localhost:5000';
const CV_ID = process.argv[2];
if (!CV_ID) {
  console.error('Usage: node blankPage.repro.mjs <cvId>');
  process.exit(1);
}

const log = (label, payload) => {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[${ts}] ${label}:`, typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2));
};

const main = async () => {
  const browser = await chromium.launch({
    headless: true,
    channel: undefined,
    executablePath: 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe',
  });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();

  const consoleEvents = [];
  const pageErrors = [];
  const networkFails = [];
  const responses4xx5xx = [];

  page.on('console', (msg) => {
    consoleEvents.push({ type: msg.type(), text: msg.text() });
    log(`console.${msg.type()}`, msg.text());
  });

  page.on('pageerror', (err) => {
    pageErrors.push({ name: err.name, message: err.message, stack: err.stack });
    log('PAGE ERROR', { name: err.name, message: err.message, stack: err.stack });
  });

  page.on('requestfailed', (req) => {
    networkFails.push({ url: req.url(), failure: req.failure()?.errorText });
    log('REQUEST FAILED', { url: req.url(), failure: req.failure()?.errorText });
  });

  page.on('response', (resp) => {
    const status = resp.status();
    if (status >= 400) {
      responses4xx5xx.push({ url: resp.url(), status });
      log(`HTTP ${status}`, resp.url());
    }
  });

  // 1. Login qua API trực tiếp (bypass UI login flow).
  log('STEP 1', 'Login API → set localStorage token');
  const loginResp = await page.request.post(`${BE}/api/v1/auth/login`, {
    data: { email: 'e2e-test@jobmatch.vn', password: 'Test@1234' },
  });
  const loginJson = await loginResp.json();
  if (!loginJson.success) {
    log('LOGIN FAIL', loginJson);
    process.exit(1);
  }
  const token = loginJson.data.accessToken;
  await page.addInitScript((t) => {
    localStorage.setItem('access_token', t);
    localStorage.setItem('refresh_token', 'dummy');
  }, token);
  log('STEP 1 DONE', 'token set in localStorage');

  // 2. Verify FE có đọc token không — load trang chủ trước.
  log('STEP 2', 'Navigate to /candidate/resumes list để confirm session');
  await page.goto(`${FE}/candidate/resumes`, { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(1000);
  const listUrl = page.url();
  log('STEP 2 URL', listUrl);
  const bodyAfterList = await page.evaluate(() => document.body.innerText.slice(0, 300));
  log('STEP 2 BODY', bodyAfterList);

  // 3. Navigate tới URL trắng trang.
  log('STEP 3', `Navigate to /candidate/resumes/${CV_ID}/edit`);
  pageErrors.length = 0;
  consoleEvents.length = 0;
  await page.goto(`${FE}/candidate/resumes/${CV_ID}/edit`, {
    waitUntil: 'domcontentloaded',
    timeout: 15000,
  });
  await page.waitForTimeout(2000);

  const finalUrl = page.url();
  log('STEP 3 URL', finalUrl);
  const bodyInner = await page.evaluate(() => document.body.innerHTML);
  const bodyText = await page.evaluate(() => document.body.innerText);
  log('STEP 3 BODY TEXT', bodyText.slice(0, 500));
  log('STEP 3 BODY HTML LEN', bodyInner.length);

  // 4. Chụp screenshot.
  const outDir = path.resolve('tests/debug');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const screenshotPath = path.join(outDir, `blank-${Date.now()}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  log('SCREENSHOT', screenshotPath);

  // 5. Tóm tắt.
  log('===== SUMMARY =====', '');
  log('pageErrors', pageErrors.length);
  log('consoleErrors', consoleEvents.filter((e) => e.type === 'error').length);
  log('consoleWarns', consoleEvents.filter((e) => e.type === 'warning').length);
  log('networkFails', networkFails.length);
  log('4xx5xx', responses4xx5xx.length);

  // 6. In raw body HTML nếu có.
  fs.writeFileSync(path.join(outDir, `body-${Date.now()}.html`), bodyInner);
  log('BODY HTML WRITTEN', '');

  await browser.close();
};

main().catch((e) => {
  console.error('SCRIPT CRASH:', e);
  process.exit(1);
});
