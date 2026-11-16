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

function upload(path, cloudPath, buf) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: HOST, port: PORT, path: path + '?cloudPath=' + encodeURIComponent(cloudPath),
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': buf.length }
    }, (res) => {
      let b = '';
      res.on('data', (c) => { b += c; });
      res.on('end', () => { let j = null; try { j = JSON.parse(b); } catch (_) {} resolve({ status: res.statusCode, json: j, body: b }); });
    });
    req.on('error', reject);
    req.write(buf);
    req.end();
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
      ADMIN_CONFIG_DIR: tmpDir,
      MOCK_CLOUDBASE: '1'
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

    // 8. 数据链路（Mock 模式）：集合列表 → 新增文档 → 文档 etag → 乐观锁 409 → 筛选
    const col = await request('GET', '/api/collection?name=demo');
    check('GET /api/collection → 200', col.status === 200, 'got ' + col.status);
    check('集合含 3 条 seed 文档', col.json && col.json.total === 3 && Array.isArray(col.json.docs), JSON.stringify(col.json && col.json.total));
    const added = await request('POST', '/api/collection?name=demo', { name: 'Smoke', n: 9 });
    check('POST /api/collection 新增 → 200 且有 id', added.status === 200 && added.json && !!added.json.id, added.body);
    const d1 = col.json.docs[0], d1id = d1._id;
    const g = await request('GET', '/api/doc?name=demo&id=' + d1id);
    check('GET /api/doc → 200 且返回 etag', g.status === 200 && g.json && typeof g.json.etag === 'string' && g.json.etag.length === 16, g.body);
    const etag = g.json.etag;
    const upd = await request('PUT', '/api/doc?name=demo&id=' + d1id, Object.assign({}, d1, { n: 42, $etag: etag }));
    check('PUT /api/doc 带匹配 etag → 200', upd.status === 200, 'got ' + upd.status);
    const g2 = await request('GET', '/api/doc?name=demo&id=' + d1id);
    check('保存后内容已更新', g2.json && g2.json.doc && g2.json.doc.n === 42);
    const conflict = await request('PUT', '/api/doc?name=demo&id=' + d1id, Object.assign({}, d1, { n: 43, $etag: etag }));
    check('PUT /api/doc 回传旧 etag → 409 并发保护', conflict.status === 409, 'got ' + conflict.status);
    const q = await request('GET', '/api/collection?name=demo&field=n&q=' + encodeURIComponent('^[23]$'));
    check('筛选命中 2 条', q.json && q.json.total === 2, 'got ' + (q.json && q.json.total));
    check('筛选结果不含 n=9', q.json && q.json.docs && q.json.docs.every((d) => d.n !== 9));

    // 9. 存储链路：上传 → 同名 409 → 列表 → 临时 URL → 删除 → walk
    const up1 = await upload('/api/storage/upload', 'smoke/t.txt', Buffer.from('hello smoke'));
    check('POST /api/storage/upload → 200', up1.status === 200, 'got ' + up1.status + ' ' + up1.body);
    const up2 = await upload('/api/storage/upload', 'smoke/t.txt', Buffer.from('again'));
    check('同名路径再传 → 409 去重', up2.status === 409, 'got ' + up2.status);
    const lst = await request('GET', '/api/storage?prefix=smoke/');
    check('存储列表含新文件', lst.json && lst.json.files && lst.json.files.some((f) => f.name === 'smoke/t.txt'), lst.body);
    const urls = await request('POST', '/api/storage/urls', { fileIDs: ['smoke/t.txt'] });
    check('临时 URL 有值', urls.json && urls.json.urls && (urls.json.urls['smoke/t.txt'] || '').startsWith('https://'), urls.body);
    const sdel = await request('POST', '/api/storage/delete', { fileIDs: ['smoke/t.txt'] });
    check('POST /api/storage/delete → 200', sdel.status === 200 && sdel.json && sdel.json.deleted === 1, sdel.body);
    const lst2 = await request('GET', '/api/storage?prefix=smoke/');
    check('删除后列表不含该文件', lst2.json && lst2.json.files && !lst2.json.files.some((f) => f.name === 'smoke/t.txt'));
    const ov = await request('GET', '/api/overview?fresh=1');
    check('overview counts 含 demo（3 seed + 1 新增 = 4）', ov.json && ov.json.counts && ov.json.counts.demo === 4, JSON.stringify(ov.json && ov.json.counts));
    const walk = await request('GET', '/api/storage/walk?prefix=');
    check('GET /api/storage/walk → 200', walk.status === 200, 'got ' + walk.status);

    // 10. 数据库索引：读取（含系统 _id_）→ 创建 → 二次读取 → 删除 → 三次读取
    const ix1 = await request('GET', '/api/collection/indexes?name=demo');
    check('索引读取 → 200 且含系统索引 _id_', ix1.status === 200 && ix1.json && ix1.json.indexes && ix1.json.indexes.some((x) => x.name === '_id_'), ix1.body);
    const ix2 = await request('POST', '/api/collection/indexes?name=demo', { indexName: 'smoke_ix', keys: [{ field: 'name', direction: 'asc' }, { field: 'n', direction: 'desc' }], unique: true });
    check('创建索引 → 200', ix2.status === 200, 'got ' + ix2.status + ' ' + ix2.body);
    const ix3 = await request('GET', '/api/collection/indexes?name=demo');
    check('二次读取含新索引', ix3.json && ix3.json.indexes.some((x) => x.name === 'smoke_ix' && x.unique && x.keys.length === 2), ix3.body);
    const ix4 = await request('DELETE', '/api/collection/indexes?name=demo&index=smoke_ix');
    check('删除索引 → 200', ix4.status === 200, 'got ' + ix4.status + ' ' + ix4.body);
    const ix5 = await request('GET', '/api/collection/indexes?name=demo');
    check('删除后索引列表不含 smoke_ix', ix5.json && ix5.json.indexes && !ix5.json.indexes.some((x) => x.name === 'smoke_ix'), ix5.body);

    // 11. 集合权限（安全规则）：读取 → 改 PRIVATE → CUSTOM → 非法值 400
    const pm1 = await request('GET', '/api/collection/permission?name=demo');
    check('集合权限读取 → 200', pm1.status === 200 && pm1.json && typeof pm1.json.acl === 'string', pm1.body);
    const pm2 = await request('PUT', '/api/collection/permission?name=demo', { acl: 'PRIVATE' });
    check('改集合权限 PRIVATE → 200', pm2.status === 200, 'got ' + pm2.status + ' ' + pm2.body);
    const pm3 = await request('GET', '/api/collection/permission?name=demo');
    check('权限读取回 PRIVATE', pm3.json && pm3.json.acl === 'PRIVATE', pm3.body);
    const pm4 = await request('PUT', '/api/collection/permission?name=demo', { acl: 'CUSTOM', rule: 'auth.uid != null' });
    check('改集合权限 CUSTOM 带规则 → 200', pm4.status === 200, 'got ' + pm4.status + ' ' + pm4.body);
    const pm5 = await request('GET', '/api/collection/permission?name=demo');
    check('CUSTOM 规则回显', pm5.json && pm5.json.acl === 'CUSTOM' && /auth\.uid/.test(pm5.json.rule || ''), pm5.body);
    const pm6 = await request('PUT', '/api/collection/permission?name=demo', { acl: 'CUSTOM' });
    check('CUSTOM 缺规则 → 400', pm6.status === 400, 'got ' + pm6.status);
    const pm7 = await request('PUT', '/api/collection/permission?name=demo', { acl: 'BOGUS' });
    check('非法权限值 → 400', pm7.status === 400, 'got ' + pm7.status);

    // 12. 存储 ACL：读取 → 改 ADMINWRITE → 改 CUSTOM 带规则 → 读取 → 非法 400
    const ac1 = await request('GET', '/api/storage/acl');
    check('存储 ACL 读取 → 200 且 acl 非空', ac1.status === 200 && ac1.json && !!ac1.json.acl, ac1.body);
    const ac2 = await request('PUT', '/api/storage/acl', { acl: 'ADMINWRITE' });
    check('改存储 ACL ADMINWRITE → 200', ac2.status === 200, 'got ' + ac2.status + ' ' + ac2.body);
    const ac3 = await request('GET', '/api/storage/acl');
    check('ACL 读取回 ADMINWRITE', ac3.json && ac3.json.acl === 'ADMINWRITE', ac3.body);
    const ac4 = await request('PUT', '/api/storage/acl', { acl: 'CUSTOM', rule: { read: true, write: 'resource.openid == auth.uid' } });
    check('改存储 ACL CUSTOM 带规则 → 200', ac4.status === 200, 'got ' + ac4.status + ' ' + ac4.body);
    const ac5 = await request('GET', '/api/storage/acl');
    check('CUSTOM ACL 规则回显', ac5.json && ac5.json.acl === 'CUSTOM' && ac5.json.rule && ac5.json.rule.read === true && ac5.json.rule.write === 'resource.openid == auth.uid', ac5.body);
    const ac6 = await request('PUT', '/api/storage/acl', { acl: 'CUSTOM', rule: { read: true } });
    check('CUSTOM ACL 缺 write → 400', ac6.status === 400, 'got ' + ac6.status);
    const ac7 = await request('PUT', '/api/storage/acl', { acl: 'BOGUS' });
    check('非法 ACL 值 → 400', ac7.status === 400, 'got ' + ac7.status);

    // 13. 云函数：列表 → 详情（含触发器）→ 改配置 → 详情回显 → 调用 → 触发器增删 → 删除函数 → 列表清空
    const f1 = await request('GET', '/api/functions');
    check('函数列表 → 200 且含 hello', f1.status === 200 && f1.json && f1.json.functions.some((f) => f.name === 'hello'), f1.body);
    const f2 = await request('GET', '/api/function?name=hello');
    check('函数详情 → 200 且含触发器', f2.status === 200 && f2.json && f2.json.info && f2.json.info.runtime && Array.isArray(f2.json.triggers) && f2.json.triggers.some((t) => t.name === 'timer-hello'), f2.body);
    check('详情含环境变量 FOO=bar（真实 SDK 结构 Environment.Variables）', f2.json && Array.isArray(f2.json.info.envVariables) && f2.json.info.envVariables.some((v) => v.key === 'FOO' && v.value === 'bar'), f2.body);
    const f3 = await request('POST', '/api/function/config?name=hello', { timeout: 5, memorySize: 512 });
    check('改函数配置 → 200', f3.status === 200, 'got ' + f3.status + ' ' + f3.body);
    const f4 = await request('GET', '/api/function?name=hello');
    check('配置回显 timeout=5 / memory=512', f4.json && f4.json.info.timeout === 5 && f4.json.info.memory === 512, f4.body);
    const f5 = await request('POST', '/api/function/invoke?name=hello', { x: 1 });
    check('调用函数 → 200 且 ok/echo', f5.status === 200 && f5.json && f5.json.ok === true && f5.json.result && f5.json.result.echo && f5.json.result.echo.x === 1, f5.body);
    check('调用返回日志与耗时', f5.json && typeof f5.json.log === 'string' && f5.json.log.length > 0 && f5.json.duration > 0, f5.body);
    const f6 = await request('POST', '/api/function/trigger?name=hello', { name: 'smoke_t', type: 'timer', config: '0 0 * * * *' });
    check('创建触发器 → 200', f6.status === 200, 'got ' + f6.status + ' ' + f6.body);
    const f7 = await request('GET', '/api/function?name=hello');
    check('触发器回显 smoke_t', f7.json && f7.json.triggers.some((t) => t.name === 'smoke_t'), f7.body);
    const f8 = await request('DELETE', '/api/function/trigger?name=hello&trigger=smoke_t');
    check('删除触发器 → 200', f8.status === 200, 'got ' + f8.status + ' ' + f8.body);
    const f9 = await request('GET', '/api/function?name=hello');
    check('删除后触发器不含 smoke_t', f9.json && !f9.json.triggers.some((t) => t.name === 'smoke_t'), f9.body);
    const f10 = await request('DELETE', '/api/function?name=hello');
    check('删除函数 → 200', f10.status === 200, 'got ' + f10.status + ' ' + f10.body);
    const f11 = await request('GET', '/api/functions');
    check('删除后列表不含 hello', f11.json && !f11.json.functions.some((f) => f.name === 'hello'), f11.body);
    const f12 = await request('GET', '/api/function?name=hello');
    check('删除后详情 → 500 报错', f12.status === 500, 'got ' + f12.status);

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
