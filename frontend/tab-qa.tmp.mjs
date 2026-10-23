import { chromium } from 'playwright';

const CORS = { 'Access-Control-Allow-Origin': 'http://localhost:5173', 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Content-Type': 'application/json' };
const VPS = [[375, 667], [768, 1024], [1024, 768], [1100, 800], [1200, 800], [1440, 900]];
const browser = await chromium.launch();

// Sampler: mỗi frame ghi rect từng nút tab + span nhãn + aside/nav/ol
const SAMPLER = `(() => {
  window.__t0 = performance.now();
  window.__log = [];
  const rec = () => {
    if (performance.now() - window.__t0 > 12000) return;
    const btns = [...document.querySelectorAll('nav[aria-label="Các mục của biểu mẫu"] button')];
    const aside = document.querySelector('aside');
    const ol = document.querySelector('nav[aria-label="Các mục của biểu mẫu"] ol');
    window.__log.push({
      y: Math.round(scrollY),
      active: btns.findIndex(b => b.getAttribute('aria-current') === 'location'),
      btns: btns.map(b => { const r = b.getBoundingClientRect(); return [Math.round(r.x*10)/10, Math.round(r.y*10)/10, Math.round(r.width*10)/10, Math.round(r.height*10)/10]; }),
      spans: btns.map(b => { const s = b.querySelectorAll('span')[1]; return s ? Math.round(s.getBoundingClientRect().height*10)/10 : 0; }),
      aside: aside ? [Math.round(aside.getBoundingClientRect().y*10)/10, Math.round(aside.getBoundingClientRect().width*10)/10, Math.round(aside.getBoundingClientRect().height*10)/10] : null,
      ol: ol ? [Math.round(ol.getBoundingClientRect().height*10)/10, ol.scrollLeft, ol.scrollWidth, ol.clientWidth] : null,
    });
    requestAnimationFrame(rec);
  };
  requestAnimationFrame(rec);
})()`;

async function runScenario(page, name) {
  await page.evaluate(SAMPLER);
  if (name === 'A') {
    const steps = await page.evaluate(() => Math.ceil((document.documentElement.scrollHeight - innerHeight) / 40));
    for (let i = 0; i < steps; i++) { await page.evaluate(() => window.scrollBy(0, 40)); await page.waitForTimeout(40); }
  } else if (name === 'B') {
    for (const i of [0, 4, 2, 0]) { await page.locator('nav[aria-label="Các mục của biểu mẫu"] button').nth(i).click(); await page.waitForTimeout(900); }
  } else if (name === 'C') {
    // Đổi trạng thái active KHÔNG qua cuộn: toggle class font-semibold trên từng nút
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('nav[aria-label="Các mục của biểu mẫu"] button')];
      window.__c = 0;
      const t = () => { window.__c++; btns.forEach((b, i) => { if ((i + window.__c) % 2 === 0) b.classList.add('font-semibold'); else b.classList.remove('font-semibold'); }); if (window.__c < 6) setTimeout(t, 200); };
      t();
    });
    await page.waitForTimeout(1500);
  }
  await page.waitForTimeout(400);
  return page.evaluate(() => window.__log);
}

function analyze(vp, name, log) {
  const issues = [];
  let prev = null;
  for (const f of log) {
    if (prev) {
      const ayDelta = (prev.aside && f.aside) ? f.aside[0] - prev.aside[0] : 0;
      f.btns.forEach((b, i) => {
        const p = prev.btns[i];
        // x/y TƯƠNG ĐỐI (trừ ảnh hưởng cuộn trang/aside) + w/h tuyệt đối
        const rel = [Math.round((b[0] - (f.ol ? f.ol[1] : 0)) - (p[0] - (prev.ol ? prev.ol[1] : 0)))*10/10, Math.round(((b[1] - (f.aside ? f.aside[0] : 0)) - (p[1] - (prev.aside ? prev.aside[0] : 0)))*10)/10];
        for (let k = 2; k < 4; k++) {
          if (Math.abs(b[k] - p[k]) > 0.5) issues.push({ btn: i + 1, prop: ['x', 'y', 'w', 'h'][k], from: p[k], to: b[k], active: f.active + 1 });
        }
        if (Math.abs(rel[1]) > 0.5) issues.push({ btn: i + 1, prop: 'relY', from: rel[1], to: 0, active: f.active + 1, ayDelta: Math.round(ayDelta*10)/10 });
        if (f.spans[i] !== prev.spans[i]) issues.push({ btn: i + 1, prop: 'spanH', from: prev.spans[i], to: f.spans[i], active: f.active + 1 });
      });
      if (prev.aside && f.aside && Math.abs(f.aside[2] - prev.aside[2]) > 0.5) issues.push({ el: 'aside.h', from: prev.aside[2], to: f.aside[2] });
      if (prev.ol && f.ol && Math.abs(f.ol[0] - prev.ol[0]) > 0.5) issues.push({ el: 'ol.h', from: prev.ol[0], to: f.ol[0] });
    }
    prev = f;
  }
  // gộp: chỉ giữ thay đổi khi activeSection đổi hoặc bất kỳ
  const uniq = issues.slice(0, 6);
  return { vp, scenario: name, frames: log.length, issueCount: issues.length, sample: uniq, log };
}

const report = [];
for (const [w, h] of VPS) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  await ctx.route('**/api/**', r => {
    if (r.request().method() === 'OPTIONS') return r.fulfill({ headers: { 'Access-Control-Allow-Origin': 'http://localhost:5173', 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Content-Type': 'application/json' }, status: 204 });
    if (r.request().url().includes('/users/me')) return r.fulfill({ headers: { 'Access-Control-Allow-Origin': 'http://localhost:5173', 'Access-Control-Allow-Credentials': 'true', 'Content-Type': 'application/json' }, body: JSON.stringify({ success: true, data: { id: 'u', email: 'q@t.vn', role: 'employer', status: 'active', fullName: 'QA' } }) });
    return r.fulfill({ headers: { 'Access-Control-Allow-Origin': 'http://localhost:5173', 'Access-Control-Allow-Credentials': 'true', 'Content-Type': 'application/json' }, body: JSON.stringify({ success: true, data: null }) });
  });
  const page = await ctx.newPage();
  await page.addInitScript(() => { localStorage.setItem('access_token', 'f'); localStorage.setItem('refresh_token', 'f'); });
  await page.goto('http://localhost:5173/employer/company3', { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(3200);
  if (page.url().includes('login')) { await page.goto('http://localhost:5173/employer/company3', { waitUntil: 'domcontentloaded' }).catch(() => {}); await page.waitForTimeout(3000); }
  if (page.url().includes('login')) { await page.goto('http://localhost:5173/employer/company3', { waitUntil: 'domcontentloaded' }).catch(() => {}); await page.waitForTimeout(3000); }
  await page.getByRole('button', { name: 'Chỉnh sửa hồ sơ' }).click({ timeout: 12000 });
  await page.waitForTimeout(1100);
  for (const sc of ['A', 'B', 'C']) {
    const log = await runScenario(page, sc);
    report.push(analyze(`${w}x${h}`, sc, log));
  }
  await ctx.close();
}
await browser.close();
console.log(JSON.stringify(report.map(({ vp, scenario, frames, issueCount, sample }) => ({ vp, scenario, frames, issueCount, sample })), null, 1));
