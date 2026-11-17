/* E2E：Playwright + 无头 Chromium 验证前端真实渲染与交互。
   未安装 playwright 时打印 SKIPPED 并以 0 退出（不阻塞 npm test）。
   用法：node scripts/e2e.js （前置：npm i -D playwright && npx playwright install chromium） */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const root = path.join(__dirname, '..');
const PORT = 18788;
const HOST = '127.0.0.1';

let pw;
try { pw = require('playwright'); }
catch (_) {
  console.log('SKIPPED 未安装 playwright（npm i -D playwright && npx playwright install chromium 后重跑）');
  process.exit(0);
}

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log('PASS ' + name);
  else { failures++; console.error('FAIL ' + name + (extra ? '  — ' + extra : '')); }
}

function get(p) {
  return new Promise((resolve, reject) => {
    http.get({ host: HOST, port: PORT, path: p }, (res) => {
      let b = '';
      res.on('data', (c) => { b += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: b }));
    }).on('error', reject);
  });
}

(async () => {
  // 1. 隔离环境 + 起 Mock server
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wxw-e2e-'));
  const envId = 'e2e-env';
  fs.writeFileSync(path.join(tmpDir, 'environments.json'), JSON.stringify({
    version: 1,
    defaultEnvId: envId,
    envs: [{ envId, secretId: 'AKIDmock', secretKey: 'mock' }]
  }, null, 2));
  const srv = spawn(process.execPath, [path.join(root, 'server.js')], {
    cwd: root,
    env: Object.assign({}, process.env, {
      ADMIN_PORT: String(PORT),
      ADMIN_HOST: HOST,
      ADMIN_CONFIG_DIR: tmpDir,
      MOCK_CLOUDBASE: '1'
    }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let out = '';
  srv.stdout.on('data', (c) => { out += c; });
  srv.stderr.on('data', (c) => { out += c; });
  let browser;
  try {
    // 2. 等就绪
    const deadline = Date.now() + 8000;
    for (;;) {
      const r = await get('/').catch(() => null);
      if (r && r.status === 200) break;
      if (Date.now() > deadline) throw new Error('server 未就绪：\n' + out.slice(-800));
      await new Promise((res) => setTimeout(res, 150));
    }
    browser = await pw.chromium.launch({ headless: true });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

    // 3. 首页渲染：5 个导航项
    await page.goto('http://' + HOST + ':' + PORT + '/', { waitUntil: 'networkidle' });
    check('导航项渲染（5 个）', (await page.locator('.navitem').count()) === 5, 'got ' + (await page.locator('.navitem').count()));
    const navOrder = await page.locator('.navitem').evaluateAll(items => items.map(item => item.dataset.tab).join(','));
    check('导航顺序（概览 / 数据库 / 存储 / 云函数 / 环境配置）',
      navOrder === 'overview,db,storage,functions,settings', navOrder);

    // 4. 切到数据库页：集合下拉出现 demo，initDb 自动加载后出现 seed 文档行
    await page.click('[data-tab="db"]');
    const opts = await page.locator('#dbCollection option').allTextContents();
    check('集合下拉含 demo', opts.includes('demo'), opts.join(','));
    await page.waitForSelector('#dbBody td:has-text("Alice")', { timeout: 8000 });
    const rows = await page.locator('#dbBody tr').count();
    check('数据库页渲染出文档行（>=3）', rows >= 3, 'got ' + rows);
    check('无 pageerror', errors.length === 0, errors.join(' | ').slice(0, 300));
  } catch (e) {
    failures++;
    console.error('FAIL 异常 ' + (e && e.message) + '\n' + (e && e.stack || ''));
    console.error('[server output]\n' + out.slice(-1000));
  } finally {
    if (browser) { try { await browser.close(); } catch (_) {} }
    if (srv.exitCode === null) { try { srv.kill('SIGTERM'); } catch (_) {} }
    await new Promise((res) => {
      const to = setTimeout(res, 1500);
      if (srv.exitCode !== null) { clearTimeout(to); return res(); }
      srv.once('exit', () => { clearTimeout(to); res(); });
    });
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }
  if (failures) { console.error(failures + ' 项 E2E 断言未通过'); process.exit(1); }
  console.log('E2E 全部通过');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
