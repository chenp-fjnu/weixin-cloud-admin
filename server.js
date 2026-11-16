/**
 * 云端数据管理台 —— 本地管理服务器
 *
 * 定位：
 *   一个跑在本地的 Web 管理台，用于「查看 + 管理」一个或多个云开发（CloudBase）环境
 *   内的全部资源（顶栏下拉切换，默认环境为 TCB_ENV_ID）：
 *     1) 云数据库所有集合的文档（浏览 / 编辑 / 新增 / 删除）
 *     2) 云存储根目录下的全部文件（目录浏览 / 图片预览 / 上传 / 删除）
 *
 * 技术栈：
 *   - 数据库文档操作   → @cloudbase/node-sdk（与云函数 wx-server-sdk 同套 API）
 *   - 存储目录列举/临时URL/删除 → @cloudbase/manager-node（listDirectoryFiles/getTemporaryUrl/deleteFile）
 *   - 存储上传         → @cloudbase/node-sdk（uploadFile）
 *
 * 安全纪律：
 *   - 默认只绑定 127.0.0.1（本机回环），不对外网暴露。
 *   - 腾讯云密钥（secretId/secretKey）只存在于本进程环境变量，永不下发到浏览器。
 *   - 浏览器 ↔ 本服务走同源 http，本服务再代去 CloudBase，前端零凭证。
 *
 * 环境与凭证来源（优先级：config/environments.json > .env 播种 > 页面「环境配置」随时增删改）：
 *   - 首次启动且无 config/environments.json 时，用 .env 播种：
 *       TCB_ENV_ID     默认云环境 ID
 *       TCB_ENV_IDS    可切换的云环境列表（逗号分隔）
 *       TCB_SECRET_ID / TCB_SECRET_KEY       第 1 个环境的腾讯云凭证
 *       TCB_SECRET_ID_N / TCB_SECRET_KEY_N  第 N 个环境的独立凭证（跨账号场景）
 *   - 之后以 config/environments.json 为准，页面「环境配置」页可增 / 删 / 改 / 测 / 设默认。
 *   - config/ 与 .env 均不入 git（见 .gitignore）。
 *
 * 其它配置：
 *   ADMIN_PORT     端口（默认 8787）
 *   ADMIN_HOST     绑定地址（默认 127.0.0.1，务必保持；对外需自行加鉴权）
 *   ADMIN_TOKEN    可选；设置后所有 /api 请求需带请求头 x-admin-token 匹配
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

// ============ 配置 ============
function loadDotEnv() {
  const file = path.join(__dirname, '.env');
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key && !(key in process.env)) process.env[key] = val;
  }
}
loadDotEnv();

// ============ 多环境注册表（可页面增删改，持久化到 config/environments.json） ============
// 启动时：若存在 config/environments.json 则以其为准；否则用 .env（TCB_ENV_IDS /
// TCB_SECRET_ID[_N]）播种初始列表并落盘。之后页面「环境配置」页的增删改全部写回该文件。
// ADMIN_CONFIG_DIR 可覆盖配置目录（smoke 脚本用临时目录隔离，避免触碰真实配置）
const CONFIG_DIR = process.env.ADMIN_CONFIG_DIR || path.join(__dirname, 'config');
const CONFIG_FILE = path.join(CONFIG_DIR, 'environments.json');
const ENV_ID_RE = /^[a-zA-Z0-9_-]{2,64}$/;
const _envs = { defaultId: '', list: [] }; // list: [{ envId, secretId, secretKey }]

const PORT = parseInt(process.env.ADMIN_PORT || '8787', 10);
const HOST = process.env.ADMIN_HOST || '127.0.0.1';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';

function envIndex(envId) { return _envs.list.findIndex(e => e.envId === envId); }
function envById(envId) { const i = envIndex(envId); return i >= 0 ? _envs.list[i] : null; }
function defaultEnvId() { return _envs.defaultId || (_envs.list.length ? _envs.list[0].envId : ''); }

function persistConfig() {
  try {
    if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify({ version: 1, defaultEnvId: _envs.defaultId, envs: _envs.list }, null, 2));
  } catch (e) { console.error('保存环境配置失败：' + (e.message || e)); }
}

// 首次启动且无 config 文件时，用 .env 播种（兼容旧配置）
function seedFromEnv() {
  const defId = (process.env.TCB_ENV_ID || '').trim();
  let envIds = (process.env.TCB_ENV_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (defId && !envIds.includes(defId)) envIds.unshift(defId);
  const baseId = process.env.TCB_SECRET_ID || '';
  const baseKey = process.env.TCB_SECRET_KEY || '';
  _envs.list = envIds.map((id, idx) => ({
    envId: id,
    secretId: (idx > 0 && process.env['TCB_SECRET_ID_' + (idx + 1)]) || baseId,
    secretKey: (idx > 0 && process.env['TCB_SECRET_KEY_' + (idx + 1)]) || baseKey
  }));
  _envs.defaultId = defId || (_envs.list.length ? _envs.list[0].envId : '');
  persistConfig();
}

function loadConfig() {
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      _envs.list = Array.isArray(data.envs) ? data.envs : [];
      _envs.defaultId = (data.defaultEnvId || '').trim();
      if (_envs.list.length && !envById(_envs.defaultId)) _envs.defaultId = _envs.list[0].envId;
      if (!_envs.list.length) _envs.defaultId = '';
      return;
    } catch (e) {
      console.error('读取环境配置失败，回落到 .env 播种：' + (e.message || e));
    }
  }
  // 无有效 config：.env 有则播种；.env 也空则允许空列表启动（由页面添加）
  if ((process.env.TCB_ENV_ID || '').trim() || (process.env.TCB_ENV_IDS || '').trim()) seedFromEnv();
}
loadConfig();

function secretsFor(envId) {
  const e = envById(envId);
  return e ? { id: e.secretId || '', key: e.secretKey || '' } : { id: '', key: '' };
}
function hasSecrets(envId) {
  const s = secretsFor(envId);
  return !!(s.id && s.key);
}
// 凭证 / 环境变更时清除 SDK 客户端缓存，避免沿用旧密钥构造的实例
function invalidateClient(envId) { if (envId && _clients.has(envId)) _clients.delete(envId); }

// 兜底集合名单（listCollections 接口失败时使用）；通用工具不内置业务集合名，
// 需要时用 KNOWN_COLLECTIONS 环境变量显式覆盖（逗号分隔）
const KNOWN_COLLECTIONS = (process.env.KNOWN_COLLECTIONS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

// ============ 客户端（惰性构造，按 envId 缓存） ============
const _clients = new Map(); // envId -> { tcb, manager }

function assertSecrets(envId) {
  const s = secretsFor(envId);
  if (!s.id || !s.key) {
    throw new AppError('环境 ' + envId + ' 未配置凭证：请打开左侧「环境配置」，填入该环境的腾讯云 SecretId / SecretKey', 'NO_SECRETS');
  }
  return s;
}
function requireSdk(mod) {
  try { return require(mod); }
  catch (e) { throw new AppError('未安装 ' + mod + '，请先在本目录执行 npm install', 'SDK_MISSING'); }
}
function getClient(envId) {
  const s = assertSecrets(envId);
  let c = _clients.get(envId);
  if (!c) {
    const tcb = requireSdk('@cloudbase/node-sdk');
    c = { tcb: tcb.init({ secretId: s.id, secretKey: s.key, env: envId }), manager: null };
    _clients.set(envId, c);
  }
  return c;
}
function getManager(envId) {
  const c = getClient(envId);
  if (!c.manager) {
    const s = secretsFor(envId);
    const M = requireSdk('@cloudbase/manager-node');
    const Ctor = M.default || M;
    c.manager = new Ctor({ secretId: s.id, secretKey: s.key, envId });
  }
  return c.manager;
}
function db(envId) { return getClient(envId).tcb.database(); }

// 概览 TTL 缓存：存储采样（递归 walk 上限 5000 文件）+ 全集合 count 是最重的接口，
// 60s 内同环境重复进入/切环境直接复用；请求带 fresh=1 强制重算（概览页「刷新」按钮）。
const OVERVIEW_TTL_MS = 60 * 1000;
let _ovCache = null; // { envId, at, body }

// 解析并校验本次请求的目标环境（缺省=默认环境；非法 env 直接 4xx 级报错）
function resolveEnv(params) {
  const id = (params.get('env') || '').trim() || defaultEnvId();
  if (!id || !envById(id)) {
    throw new AppError(_envs.list.length ? ('未知云环境：' + id + '（可选：' + _envs.list.map(e => e.envId).join(' / ') + '）') : '尚未配置云环境：请先到「环境配置」页添加', 'BAD_ENV');
  }
  return id;
}

function AppError(msg, code) {
  const e = new Error(msg);
  e.name = 'AppError';
  e.code = code || 'APP';
  return e;
}

// ============ 存储操作 ============
function normFile(f) {
  if (!f) return null;
  const name = f.Key || f.key || f.name || f.cloudPath || '';
  return {
    name: name,
    size: f.Size != null ? Number(f.Size) : (f.size != null ? Number(f.size) : 0),
    lastModified: f.LastModified || f.lastModified || f.time || '',
    etag: f.ETag || f.etag || ''
  };
}

// 列举某前缀下「一级」内容（子目录 + 直属文件）。
// 用 listCurrentDirectory（COS Delimiter 不递归，只拉当前层），替代 listDirectoryFiles 的
// 递归全量遍历——后者在大目录下会把整棵树拉完才返回，导致首屏卡死。
async function storageListOneLevel(prefix, envId) {
  const m = getManager(envId);
  const storage = m.storage;
  let res;
  try { res = await storage.listCurrentDirectory(prefix); }
  catch (e) { throw new AppError('云存储列举失败：' + (e.message || e), 'STORAGE'); }
  const files = (res && res.files || [])
    .map(normFile).filter(Boolean)
    .sort((a, b) => a.name < b.name ? -1 : 1);
  const prefixes = (res && res.directories || [])
    .map(d => { let dp = d || ''; if (dp && !dp.endsWith('/')) dp += '/'; return dp; })
    .filter(Boolean)
    .sort();
  return { files, prefixes };
}

// 递归拉取某前缀下所有文件（用于「概览采样」与「子目录聚合」）
async function storageWalk(prefix, maxFiles, envId) {
  const cap = Math.min(maxFiles || 2000, 5000);
  const m = getManager(envId);
  const storage = m.storage;
  let raw;
  try { raw = await storage.listDirectoryFiles(prefix, cap); }
  catch (e) { throw new AppError('云存储扫描失败：' + (e.message || e), 'STORAGE'); }
  if (raw && raw.Files) raw = raw.Files;
  if (!Array.isArray(raw)) raw = raw || [];
  let p = prefix || '';
  if (p && !p.endsWith('/')) p += '/';
  const out = [];
  const seen = new Set();
  for (const f of raw) {
    const nf = normFile(f);
    if (nf && nf.name && nf.name !== p && !nf.name.endsWith('/') && !seen.has(nf.name)) {
      seen.add(nf.name); out.push(nf);
    }
  }
  return out.slice(0, cap);
}

// 临时 URL / 删除：listDirectoryFiles 返回的 Key 是相对 cloudPath（如 avatar/{openid}/x.jpg），
// manager-node 的 getTemporaryUrl/deleteFile 同样以相对 cloudPath 为参数，直接复用，免 fileID 形态换算。
async function storageTempUrls(cloudPaths, envId) {
  const m = getManager(envId);
  const storage = m.storage;
  const list = cloudPaths.slice(0, 50).map(p => ({ cloudPath: p, maxAge: 7200 }));
  let res;
  try { res = await storage.getTemporaryUrl(list); }
  catch (e) { throw new AppError('获取临时链接失败：' + (e.message || e), 'STORAGE'); }
  const out = {};
  const arr = Array.isArray(res) ? res : (res && res.data) || [];
  // 仅按 fileId 精确映射（不再用数组下标回退：SDK 跳过某项时下标会错位，导致把
  // 某文件的 URL 错配给另一个文件）。fileId 形如 cloud://<env>.<bucket>/<相对路径>。
  arr.forEach(f => {
    const url = f && (f.url || f.URL);
    const rawId = f && (f.fileId || f.fileID || '');
    if (!url || !rawId) return;
    out[rawId] = url;
    const rel = rawId.replace(/^cloud:\/\/[^/]+\//i, '');
    if (rel) out[rel] = url; // 前端使用的相对 cloudPath 形态
  });
  return out;
}

async function storageDelete(cloudPaths, envId) {
  const m = getManager(envId);
  const storage = m.storage;
  const list = Array.from(new Set(cloudPaths)); // 去重；不再静默截断，前端按批 50 个调用
  if (!list.length) return { deleted: 0 };
  try { await storage.deleteFile(list); }
  catch (e) { throw new AppError('删除云文件失败：' + (e.message || e), 'STORAGE'); }
  return { deleted: list.length };
}

async function storageUpload(cloudPath, buffer, envId) {
  const app = getClient(envId);
  const r = await app.uploadFile({ cloudPath: cloudPath, fileContent: buffer });
  return { fileID: (r && r.fileID) || '' };
}

// 日期类型保留：前端整包编辑走 JSON.stringify，Date 值会被序列化为 ISO 字符串（带时区后缀）
// 或 {$date} 包装对象。若 set() 原样落库，Date 字段会退化成 String，之后按该字段排序/时间查询
// 会失效。此处识别这些形态并还原为 Date，让类型与编辑前一致。
// 还原规则（保守，避免误伤业务上刻意用字符串存日期的场景）：
//   1) {$date: X} 包装对象 → Date；
//   2) 带时区后缀的 ISO 串（Z / ±HH:MM / ±HHMM，可带毫秒）→ Date（原生 Date 序列化必然带时区）；
//   3) 字段名含时间语义（created/update/time 等）的 ISO 日期串 → Date。
function timeSemanticsField(name) {
  return /time|date|stamp|created|updated|modified|birthday|birth|At$|^at$|_at$|\btime\b/i.test(name || '');
}
const TZ_SUFFIX_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2}|[+-]\d{4})$/;
function reviveDateValues(v, key) {
  if (v && typeof v === 'object' && !Array.isArray(v) && v.$date != null && typeof v.$date === 'number') return new Date(v.$date);
  if (typeof v === 'string') {
    if (TZ_SUFFIX_RE.test(v)) return new Date(v);
    if (timeSemanticsField(key) && /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?$/.test(v)) return new Date(v);
  }
  if (Array.isArray(v)) return v.map((x, i) => reviveDateValues(x, key));
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v)) out[k] = reviveDateValues(v[k], k);
    return out;
  }
  return v;
}

// 上传路径规范化：去前导 /、拒绝空段与 .. 段（防路径穿越 / 生成非法 cloudPath）
function normCloudPath(p) {
  p = String(p || '').trim().replace(/^\/+/, '');
  if (!p || p.endsWith('/')) throw new AppError('cloudPath 非法：不能为空或仅目录前缀', 'BADPATH');
  const segs = p.split('/');
  if (segs.some(s => !s || s === '.' || s === '..')) throw new AppError('cloudPath 含非法路径段：' + p, 'BADPATH');
  return p;
}

// ============ 数据库操作 ============
async function collectionCount(envId, name, filter) {
  let c = db(envId).collection(name);
  if (filter) c = c.where(filter);
  const r = await c.count();
  return r.total != null ? r.total : 0;
}
async function collectionQuery(envId, name, { skip, limit, sort, sortDir, filter }) {
  let c = db(envId).collection(name);
  if (filter) c = c.where(filter);
  if (sort) c = c.orderBy(sort, sortDir === 'desc' ? 'desc' : 'asc');
  const r = await c.skip(skip || 0).limit(limit || 20).get();
  return (r && r.data) || [];
}
function buildFilter(envId, params) {
  const field = (params.get('field') || '').trim();
  const q = (params.get('q') || '').trim();
  if (!field && !q) return null;
  // 只给搜索词不给字段：过去会静默返回未过滤全量（用户以为搜了其实没搜），
  // 现在明确 400——全字段正则搜索需先确定字段集合，不做模糊兜底
  if (!field) throw new AppError('筛选必须指定字段（在「字段」下拉选择）', 'BADREGEX');
  // 正则长度限制：Mongo 对 regexp 有上限，超长会慢查或报错
  if (q.length > 200) throw new AppError('筛选正则过长（上限 200 字符）', 'BADREGEX');
  // 字段名白名单，避免误构造嵌套/操作符路径
  if (!/^[a-zA-Z0-9_.]+$/.test(field)) throw new AppError('筛选字段名非法：' + field, 'BADREGEX');
  try { return { [field]: db(envId).RegExp({ regexp: q, options: 'i' }) }; }
  catch (e) { throw new AppError('筛选正则非法：' + (e.message || e), 'BADREGEX'); }
}
async function listCollectionNames(envId) {
  try {
    const m = getManager(envId);
    const res = await m.database.listCollections({ MgoLimit: 100 });
    const arr = (res && res.Collections) || [];
    const names = arr.map(x => x.CollectionName || x.TableName || x.Name).filter(Boolean);
    if (names.length) return names;
  } catch (e) { /* 兜底 */ }
  return KNOWN_COLLECTIONS;
}

// ============ HTTP 工具 ============
// 凭证脱敏：只暴露前 6 位 + 后 4 位，中间以 … 代替
function maskSecret(s) {
  s = s || '';
  if (!s) return '';
  if (s.length <= 10) return s.slice(0, 2) + '…';
  return s.slice(0, 6) + '…' + s.slice(-4);
}
function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}
function sendError(res, code, message) { sendJson(res, code, { error: String(message) }); }
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new AppError('请求体过大')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function readJsonBody(req, limit) {
  const buf = await readBody(req, limit || 5 * 1024 * 1024);
  if (!buf.length) return {};
  try { return JSON.parse(buf.toString('utf8')); } catch (e) { throw new AppError('JSON 解析失败: ' + e.message, 'BADJSON'); }
}

// 静态资源
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2'
};
function serveStatic(req, res, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); }
  catch (e) { return sendError(res, 400, 'bad path'); }
  if (rel === '/' || rel === '') rel = '/index.html';
  const publicDir = path.join(__dirname, 'public');
  // path.resolve 归一化后做「前缀 + 分隔符」校验，杜绝 ../ 与兄弟目录（如 public-evil）绕过
  const filePath = path.resolve(publicDir, '.' + rel);
  if (filePath !== publicDir && !filePath.startsWith(publicDir + path.sep)) return sendError(res, 403, 'forbidden');
  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) return sendError(res, 404, 'not found: ' + pathname);
    const etag = '"' + stat.mtimeMs.toString(16) + '-' + stat.size.toString(16) + '"';
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, { 'ETag': etag, 'Cache-Control': 'no-cache' }); return res.end(); }
    fs.readFile(filePath, (err2, data) => {
      if (err2) return sendError(res, 404, 'not found: ' + pathname);
      res.writeHead(200, { 'Content-Type': mime, 'ETag': etag, 'Cache-Control': 'no-cache' });
      res.end(data);
    });
  });
}

// ============ 路由 ============
const handlers = {
  'GET /api/status': async (req, res, params) => {
    // 逐环境报告：hasSecrets（凭证齐备）+ ok（SDK 构造成功，不发起真实请求）
    const envs = _envs.list.map(e => {
      const envId = e.envId;
      const credsOk = hasSecrets(envId);
      let ok = false, message = '';
      if (credsOk) { try { getClient(envId); ok = true; } catch (err) { message = err.message; } }
      return { envId, hasSecrets: credsOk, ok, message };
    });
    const defId = defaultEnvId();
    const def = envs.find(e => e.envId === defId) || envs[0] || { envId: defId, ok: false };
    return sendJson(res, 200, { ok: !!def.ok, envId: defId, envs: _envs.list.map(e => e.envId), envsStatus: envs, hasSecrets: defId ? hasSecrets(defId) : false, host: HOST, port: PORT, message: def.message || '' });
  },

  // ---------- 环境配置（页面可增删改云环境与凭证） ----------
  'GET /api/environments': async (req, res, params) => {
    // 只下发脱敏信息：SecretId 前 6 后 4，SecretKey 仅报「是否已配置」
    return sendJson(res, 200, {
      defaultEnvId: defaultEnvId(),
      envs: _envs.list.map(e => ({
        envId: e.envId,
        isDefault: e.envId === defaultEnvId(),
        hasSecrets: !!(e.secretId && e.secretKey),
        secretIdMasked: maskSecret(e.secretId),
        secretKeySet: !!e.secretKey
      }))
    });
  },

  'POST /api/environments': async (req, res, params) => {
    let body; try { body = await readJsonBody(req); } catch (e) { return sendError(res, 400, e.message); }
    const envId = String((body && body.envId) || '').trim();
    if (!ENV_ID_RE.test(envId)) return sendError(res, 400, '环境 ID 非法（2-64 位字母 / 数字 / _ / -）');
    if (envById(envId)) return sendError(res, 409, '环境已存在：' + envId);
    const secretId = String((body && body.secretId) || '').trim();
    const secretKey = String((body && body.secretKey) || '').trim();
    if (!secretId || !secretKey) return sendError(res, 400, '请填入 SecretId 与 SecretKey');
    _envs.list.push({ envId, secretId, secretKey });
    if (!_envs.defaultId || (body && body.makeDefault)) _envs.defaultId = envId;
    persistConfig();
    return sendJson(res, 200, { ok: true, envId, defaultEnvId: defaultEnvId() });
  },

  'PUT /api/environments': async (req, res, params) => {
    let body; try { body = await readJsonBody(req); } catch (e) { return sendError(res, 400, e.message); }
    const cur = envById(String((body && body.curEnvId) || '').trim());
    if (!cur) return sendError(res, 404, '环境不存在');
    const newId = String((body && body.envId) || '').trim();
    if (newId && newId !== cur.envId) {
      if (!ENV_ID_RE.test(newId)) return sendError(res, 400, '新环境 ID 非法（2-64 位字母 / 数字 / _ / -）');
      if (envById(newId)) return sendError(res, 409, '环境 ID 已存在：' + newId);
      invalidateClient(cur.envId);
      cur.envId = newId;
      if (_envs.defaultId === cur.envId) _envs.defaultId = newId;
    }
    // 空字符串视为「保持不变」（页面不回显密钥明文，留空 = 不改该项）
    const nid = typeof body.secretId === 'string' ? body.secretId.trim() : null;
    const nk = typeof body.secretKey === 'string' ? body.secretKey.trim() : null;
    if (nid) cur.secretId = nid;
    if (nk) cur.secretKey = nk;
    if (body.makeDefault) _envs.defaultId = cur.envId;
    invalidateClient(newId || cur.envId);
    persistConfig();
    return sendJson(res, 200, { ok: true, envId: cur.envId, defaultEnvId: defaultEnvId() });
  },

  'DELETE /api/environments': async (req, res, params) => {
    const envId = (params.get('env') || '').trim();
    if (!envId) return sendError(res, 400, '缺少 env 参数');
    if (!envById(envId)) return sendError(res, 404, '环境不存在：' + envId);
    _envs.list.splice(envIndex(envId), 1);
    invalidateClient(envId);
    if (_envs.defaultId === envId) _envs.defaultId = _envs.list.length ? _envs.list[0].envId : '';
    persistConfig();
    return sendJson(res, 200, { ok: true, defaultEnvId: defaultEnvId() });
  },

  'PUT /api/environments/default': async (req, res, params) => {
    let body; try { body = await readJsonBody(req); } catch (e) { return sendError(res, 400, e.message); }
    const envId = String((body && body.envId) || '').trim();
    if (!envById(envId)) return sendError(res, 404, '环境不存在：' + envId);
    _envs.defaultId = envId;
    persistConfig();
    return sendJson(res, 200, { ok: true, defaultEnvId: envId });
  },

  'POST /api/environments/test': async (req, res, params) => {
    // 用表单里的凭证（未保存也可测）发起一次轻量 OpenAPI 调用验证有效性
    let body; try { body = await readJsonBody(req); } catch (e) { return sendError(res, 400, e.message); }
    const envId = String((body && body.envId) || '').trim();
    let sid = String((body && body.secretId) || '').trim();
    let skey = String((body && body.secretKey) || '').trim();
    if (!ENV_ID_RE.test(envId)) return sendError(res, 400, '环境 ID 非法');
    if ((!sid || !skey)) {
      // 表单未填（或行内「测试」按钮）：回落用已保存的凭证
      const saved = envById(envId);
      if (saved && saved.secretId && saved.secretKey) { sid = saved.secretId; skey = saved.secretKey; }
    }
    if (!sid || !skey) return sendError(res, 400, '该环境尚无已保存凭证：请先填入 SecretId / SecretKey');
    try {
      const M = requireSdk('@cloudbase/manager-node');
      const Ctor = M.default || M;
      const m = new Ctor({ secretId: sid, secretKey: skey, envId: envId });
      const r = await m.database.listCollections({ MgoLimit: 1 });
      const n = (r && (r.Collections || r.collections)) || [];
      return sendJson(res, 200, { ok: true, message: '凭证有效，可访问环境（集合 ' + (Array.isArray(n) ? n.length : 0) + ' 个起）' });
    } catch (e) {
      const msg = (e && e.message) || String(e);
      const isAuth = /auth|credential|secret|denied|unauthorized|AccessDenied|SignatureFailure|InvalidToken/i.test(msg);
      return sendJson(res, 200, { ok: !isAuth, message: isAuth ? ('凭证校验失败：' + msg) : ('凭证可用（调用提示：' + msg + '）') });
    }
  },

  'GET /api/overview': async (req, res, params) => {
    const envId = resolveEnv(params);
    // TTL 缓存命中直接返回（标注 cached，前端展示「统计于 …（缓存）」）
    if (params.get('fresh') !== '1' && _ovCache && _ovCache.envId === envId && Date.now() - _ovCache.at < OVERVIEW_TTL_MS) {
      return sendJson(res, 200, Object.assign({}, _ovCache.body, { cached: true }));
    }
    const allNames = await listCollectionNames(envId);
    const counts = {};
    const details = [];
    // 并行统计各集合文档数（原为串行 await，N 个集合即 N 次往返）
    await Promise.all(allNames.map(async (name) => {
      try { counts[name] = await collectionCount(envId, name, null); }
      catch (e) { counts[name] = 'ERR'; details.push(name + ': ' + e.message); }
    }));
    // 存储概览：扫描根目录，统计顶层目录数与总文件数
    let storage = { topDirs: 0, totalFiles: -1, totalSize: 0, error: '' };
    try {
      const walk = await storageWalk('', 5000, envId);
      const dirSet = new Set();
      let size = 0;
      for (const f of walk) {
        const first = f.name.split('/')[0];
        if (first) dirSet.add(first);
        size += f.size || 0;
      }
      storage = { topDirs: dirSet.size, totalFiles: walk.length, totalSize: size, truncated: walk.length >= 5000 };
    } catch (e) { storage.error = e.message; }
    const body = { envId, counts: counts, details: details, storage: storage, at: new Date().toISOString(), cached: false };
    _ovCache = { envId, at: Date.now(), body };
    return sendJson(res, 200, body);
  },

  'GET /api/collections': async (req, res, params) => {
    const envId = resolveEnv(params);
    try { return sendJson(res, 200, { collections: await listCollectionNames(envId) }); }
    catch (e) { return sendError(res, 500, e.message); }
  },

  'GET /api/collection': async (req, res, params) => {
    const envId = resolveEnv(params);
    const name = (params.get('name') || '').trim();
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) return sendError(res, 400, '集合名非法');
    const page = Math.max(1, parseInt(params.get('page') || '1', 10));
    const size = Math.min(200, Math.max(1, parseInt(params.get('size') || '20', 10)));
    const sort = (params.get('sort') || '').trim();
    const sortDir = (params.get('sortDir') || 'asc').trim();
    try {
      const filter = buildFilter(envId, params);
      const total = await collectionCount(envId, name, filter);
      const docs = await collectionQuery(envId, name, { skip: (page - 1) * size, limit: size, sort, sortDir, filter });
      return sendJson(res, 200, { name, total, page, size, docs, hasMore: page * size < total });
    } catch (e) {
      if (e && e.name === 'AppError' && e.code === 'BADREGEX') return sendError(res, 400, e.message);
      return sendError(res, 500, e.message);
    }
  },

  'GET /api/doc': async (req, res, params) => {
    const envId = resolveEnv(params);
    const name = (params.get('name') || '').trim();
    const id = (params.get('id') || '').trim();
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) return sendError(res, 400, '集合名非法');
    if (!id) return sendError(res, 400, '缺少文档 _id');
    try {
      const r = await db(envId).collection(name).doc(id).get();
      const doc = (r && (r.data || r.record)) || null;
      return sendJson(res, 200, { doc: Array.isArray(doc) ? (doc[0] || null) : doc });
    } catch (e) { return sendError(res, 500, e.message); }
  },

  'POST /api/collection': async (req, res, params) => {
    const envId = resolveEnv(params);
    const name = (params.get('name') || '').trim();
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) return sendError(res, 400, '集合名非法');
    let body;
    try { body = await readJsonBody(req); } catch (e) { return sendError(res, 400, e.message); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return sendError(res, 400, '请求体须为 JSON 对象');
    const doc = Object.assign({}, body);
    delete doc._id; // 新建不允许指定 _id
    try {
      const r = await db(envId).collection(name).add(doc);
      return sendJson(res, 200, { ok: true, id: (r && (r._id || r.id)) || '' });
    } catch (e) { return sendError(res, 500, e.message); }
  },

  'PUT /api/doc': async (req, res, params) => {
    const envId = resolveEnv(params);
    const name = (params.get('name') || '').trim();
    const id = (params.get('id') || '').trim();
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) return sendError(res, 400, '集合名非法');
    if (!id) return sendError(res, 400, '缺少文档 _id');
    let body;
    try { body = await readJsonBody(req); } catch (e) { return sendError(res, 400, e.message); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return sendError(res, 400, '请求体须为 JSON 对象');
    const doc = Object.assign({}, body);
    delete doc._id; // 整包替换语义（set）：_id 不可变更
    try {
      // 用 set() 整体替换，与前端「编辑整包 JSON」的所见即所得一致；
      // 原 update() 是部分更新，删字段不生效且易留残留字段。
      // set 前还原被 JSON 序列化退化的 Date 值（见 reviveDateValues 说明）。
      await db(envId).collection(name).doc(id).set(reviveDateValues(doc, ''));
      return sendJson(res, 200, { ok: true });
    } catch (e) { return sendError(res, 500, e.message); }
  },

  'DELETE /api/doc': async (req, res, params) => {
    const envId = resolveEnv(params);
    const name = (params.get('name') || '').trim();
    const id = (params.get('id') || '').trim();
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) return sendError(res, 400, '集合名非法');
    if (!id) return sendError(res, 400, '缺少文档 _id');
    try {
      await db(envId).collection(name).doc(id).remove();
      return sendJson(res, 200, { ok: true });
    } catch (e) { return sendError(res, 500, e.message); }
  },

  'GET /api/storage': async (req, res, params) => {
    const envId = resolveEnv(params);
    const prefix = (params.get('prefix') || '').trim();
    try {
      const r = await storageListOneLevel(prefix, envId);
      return sendJson(res, 200, { prefix, files: r.files, prefixes: r.prefixes });
    } catch (e) { return sendError(res, 500, e.message); }
  },

  'POST /api/storage/urls': async (req, res, params) => {
    // POST + JSON 数组：GET 逗号拼 fileIDs 有两个坑——文件名含逗号会被错拆，
    // 且 50 个长路径可能撑爆 URL 长度。env 仍走 query（resolveEnv 统一处理）。
    const envId = resolveEnv(params);
    let body;
    try { body = await readJsonBody(req); } catch (e) { return sendError(res, 400, e.message); }
    const fileIDs = (Array.isArray(body && body.fileIDs) ? body.fileIDs : [])
      .map(s => String(s || '').trim()).filter(Boolean);
    if (!fileIDs.length) return sendError(res, 400, '缺少 fileIDs');
    try { return sendJson(res, 200, { urls: await storageTempUrls(fileIDs, envId) }); }
    catch (e) { return sendError(res, 500, e.message); }
  },

  'POST /api/storage/delete': async (req, res, params) => {
    const envId = resolveEnv(params);
    let body;
    try { body = await readJsonBody(req); } catch (e) { return sendError(res, 400, e.message); }
    const fileIDs = Array.isArray(body && body.fileIDs) ? body.fileIDs : [];
    if (!fileIDs.length) return sendError(res, 400, '缺少 fileIDs');
    try { return sendJson(res, 200, await storageDelete(fileIDs, envId)); }
    catch (e) { return sendError(res, 500, e.message); }
  },

  'POST /api/storage/upload': async (req, res, params) => {
    const envId = resolveEnv(params);
    let cloudPath;
    try { cloudPath = normCloudPath(params.get('cloudPath')); }
    catch (e) { return sendError(res, 400, e.message); }
    const limit = parseInt(process.env.ADMIN_UPLOAD_LIMIT || String(20 * 1024 * 1024), 10);
    let buf;
    try { buf = await readBody(req, limit); } catch (e) { return sendError(res, 400, e.message); }
    if (!buf || !buf.length) return sendError(res, 400, '文件内容为空');
    try { return sendJson(res, 200, await storageUpload(cloudPath, buf, envId)); }
    catch (e) { return sendError(res, 500, e.message); }
  },

  'GET /api/storage/walk': async (req, res, params) => {
    const envId = resolveEnv(params);
    const prefix = (params.get('prefix') || '').trim();
    const maxFiles = Math.min(5000, Math.max(1, parseInt(params.get('max') || '2000', 10)));
    try {
      const files = await storageWalk(prefix, maxFiles, envId);
      return sendJson(res, 200, { prefix, count: files.length, files });
    } catch (e) { return sendError(res, 500, e.message); }
  }
};

// ============ 服务器 ============
const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://localhost');
    const pathname = u.pathname;
    const method = req.method.toUpperCase();

    if (ADMIN_TOKEN && pathname.startsWith('/api')) {
      const tok = req.headers['x-admin-token'] || u.searchParams.get('token');
      if (tok !== ADMIN_TOKEN) return sendError(res, 401, '未授权：x-admin-token 不匹配');
    }

    if (pathname.startsWith('/api/')) {
      const h = handlers[method + ' ' + pathname];
      if (!h) return sendError(res, 404, 'no handler: ' + method + ' ' + pathname);
      return await h(req, res, u.searchParams);
    }
    return serveStatic(req, res, pathname);
  } catch (e) {
    const isApp = e && e.name === 'AppError';
    let code;
    if (isApp) code = (e.code === 'NO_SECRETS' || e.code === 'SDK_MISSING') ? 503
      : (e.code === 'BAD_ENV' || e.code === 'BADJSON') ? 400 : 500;
    else code = 500;
    if (!res.headersSent) sendError(res, code, (e && e.message) || 'internal error');
    else { try { res.end(); } catch (_) {} }
  }
});

// 兜底保护：handler 内已有 try/catch，这里拦截 handler 之外的意外（SDK 内部异步回调等）。
// unhandledRejection 只记录不退出；uncaughtException 记录后退出，避免进程带病运行。
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason instanceof Error ? reason.stack : reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err && err.stack ? err.stack : err);
  try { process.exit(1); } catch (_) {}
});

// 启动前校验：非本机回环地址且未配置 ADMIN_TOKEN 时拒绝启动，避免误配置对外暴露导致裸奔
{
  const loopback = HOST === '127.0.0.1' || HOST === 'localhost' || HOST === '::1' || HOST === '0:0:0:0:0:0:0:1';
  if (!ADMIN_TOKEN && !loopback) {
    console.error('==========================================================');
    console.error('  [FATAL] ADMIN_HOST=' + HOST + '（非本机回环）但未配置 ADMIN_TOKEN');
    console.error('  对外暴露会让任意访问者增删改云数据。请先设置 ADMIN_TOKEN，');
    console.error('  或将 ADMIN_HOST 改回 127.0.0.1。');
    console.error('==========================================================');
    process.exit(1);
  }
}

server.listen(PORT, HOST, () => {
  const anySecret = _envs.list.some(e => hasSecrets(e.envId));
  console.log('==========================================================');
  console.log('  云端数据管理台（多环境）');
  console.log('  本地访问: http://' + HOST + ':' + PORT + '/');
  console.log('  云环境 : ' + (_envs.list.map(e => e.envId).join('  |  ') || '（尚未配置，请到「环境配置」页添加）')
    + (_envs.list.length ? '（默认 ' + defaultEnvId() + '）' : ''));
  console.log('  凭证   : ' + (anySecret ? '已配置' : '未配置（请在「环境配置」页填入）'));
  console.log('==========================================================');
});
