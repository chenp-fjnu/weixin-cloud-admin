/* 冒烟测试：用临时配置目录 + 假凭证起一个隔离 server，断言关键行为，全程不触碰真实 config。
   覆盖：静态页 200 / /api/status 200 / 环境列表脱敏（含 …）/ 路径穿越 403 / 环境增删闭环。
   用法：node scripts/smoke.js */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const root = path.join(__dirname, '..');
const PORT = 18787; // 用非常用端口，避免与真实服务冲突
const HOST = '127.0.0.1';

let tmpDir;
let serverProc;
let failures = 0;

function check(name, cond, extra) {
  if (cond) { console.log('PASS ' + name); }
  else { failures++; console.error('FAIL ' + name + (extra ? '  — ' + extra : '')); }
}

function request(method, p, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({
      host: HOST, port: PORT, path: p, method,
      headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}
    }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(buf); } catch (_) { /* 非 JSON */ }
        resolve({ status: res.statusCode, body: buf, json });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function waitForServer(deadlineMs) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    (function attempt() {
      request('GET', '/').then((r) => resolve(r))
        .catch(() => {
          if (Date.now() - started > deadlineMs) return reject(new Error('server 未就绪'));
          setTimeout(attempt, 150);
        });
    })();
  });
}

function killServer() {
  if (serverProc && serverProc.exitCode === null) {
    try { serverProc.kill('SIGTERM'); } catch (_) { /* ignore */ }
  }
}

(async () => {
  // 1. 临时配置目录 + 假凭证
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wxw-smoke-'));
  const envId = 'smoke-env';
  const secretId = 'AKID' + 'x'.repeat(12) + '1234';
  const secretKey = 'smokekey-99887766';
  fs.writeFileSync(path.join(tmpDir, 'environments.json'), JSON.stringify({
    version: 1,
    defaultEnvId: envId,
    envs: [{ envId, secretId, secretKey }]
  }, null, 2));

  // 2. 起隔离 server
  serverProc = spawn(process.execPath, [path.join(root, 'server.js')], {
    cwd: root,
    env: Object.assign({}, process.env, {
      ADMIN_PORT: String(PORT),
      ADMIN_HOST: HOST,
      ADMIN_CONFIG_DIR: tmpDir
    }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let srvOut = '';
  serverProc.stdout.on('data', (c) => { srvOut += c; });
  serverProc.stderr.on('data', (c) => { srvOut += c; });
  serverProc.on('exit', (code) => {
    if (code !== null && code !== 0 && code !== null) console.error('[server exit ' + code + '] ' + srvOut.slice(-800));
  });

  try {
    // 3. 等就绪
    let home;
    try { home = await waitForServer(8000); }
    catch (e) {
      console.error('server 启动失败：\n' + srvOut.slice(-1500));
      process.exit(1);
    }
    check('GET / → 200', home.status === 200, 'got ' + home.status);
    check('GET / 返回 HTML', /<html/i.test(home.body));

    // 4. /api/status
    const st = await request('GET', '/api/status');
    check('GET /api/status → 200', st.status === 200, 'got ' + st.status);
    check('status 含环境', st.json && Array.isArray(st.json.envsStatus) && st.json.envsStatus.some(e => e.envId === envId));

    // 5. /api/environments 脱敏
    const env = await request('GET', '/api/environments');
    check('GET /api/environments → 200', env.status === 200, 'got ' + env.status);
    const raw = JSON.stringify(env.json || {});
    check('凭证脱敏（含 …）', raw.includes('…'), raw.slice(0, 200));
    check('不回显完整 SecretId', !raw.includes(secretId));
    check('不回显完整 SecretKey', !raw.includes(secretKey));

    // 6. 路径穿越：安全不变量是「绝不泄漏 public/ 之外的文件」。
    //    node URL 会归一化点段（/../ → 留在 public 内 → 404）；编码斜杠 %2f 形态才触发前缀 403。
    const safe = (r) => [403, 404].includes(r.status) && !/sendJson|_envs|requireSdk/.test(r.body);
    const t1 = await request('GET', '/../server.js');
    const t2 = await request('GET', '/%2e%2e/server.js');
    const t3 = await request('GET', '/%2e%2e%2fserver.js');
    check('穿越 /../server.js → 403/404 且不泄漏源码', safe(t1), 'got ' + t1.status);
    check('穿越 /%2e%2e/server.js → 403/404 且不泄漏源码', safe(t2), 'got ' + t2.status);
    check('穿越 /%2e%2e%2fserver.js（编码斜杠）→ 403', t3.status === 403, 'got ' + t3.status);
    check('编码斜杠穿越不泄漏源码', !/sendJson|_envs|requireSdk/.test(t3.body));

    // 7. 环境增删闭环：新增 → 校验存在 → 删除 → 校验不存在
    const addId = 'smoke-add';
    const add = await request('POST', '/api/environments', {
      envId: addId, secretId: secretId, secretKey: secretKey
    });
    check('POST /api/environments → 200', add.status === 200, 'got ' + add.status + ' ' + (add.json && add.json.error));
    let after = await request('GET', '/api/environments');
    check('新增后列表含新环境', (after.json && after.json.envs || []).some(e => e.envId === addId));
    const del = await request('DELETE', '/api/environments?env=' + addId);
    check('DELETE /api/environments → 200', del.status === 200, 'got ' + del.status);
    after = await request('GET', '/api/environments');
    check('删除后列表不含新环境', !(after.json && after.json.envs || []).some(e => e.envId === addId));

  } catch (e) {
    failures++;
    console.error('FAIL 异常 ' + (e && e.message) + '\n' + (e && e.stack || ''));
    console.error('[server output]\n' + srvOut.slice(-1500));
  } finally {
    killServer();
    // 等进程退出
    await new Promise((r) => {
      const to = setTimeout(r, 1500);
      if (serverProc.exitCode !== null) { clearTimeout(to); return r(); }
      serverProc.once('exit', () => { clearTimeout(to); r(); });
    });
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  }

  if (failures) { console.error(failures + ' 项冒烟断言未通过'); process.exit(1); }
  console.log('冒烟测试全部通过');
  process.exit(0);
})().catch((e) => { console.error(e); killServer(); process.exit(1); });
