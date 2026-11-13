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
 * 凭证来源（优先级：process.env > .env 文件）：
 *   TCB_ENV_ID     默认云环境 ID（必填，云开发控制台获取）
 *   TCB_ENV_IDS    可选；逗号分隔的可切换环境列表（默认=仅 TCB_ENV_ID）
 *   TCB_SECRET_ID  腾讯云 SecretId（须能访问列表中所有云环境；不同环境若分属不同账号需自行保证）
 *   TCB_SECRET_KEY 腾讯云 SecretKey
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

// ============ 多环境注册表 ============
// 默认环境 = TCB_ENV_ID（保持旧配置兼容）；TCB_ENV_IDS 提供可切换的完整列表。
const DEFAULT_ENV_ID = (process.env.TCB_ENV_ID || '').trim();
if (!DEFAULT_ENV_ID) {
  console.error('启动失败：未配置 TCB_ENV_ID（默认云环境 ID 必填，参见 .env.example）');
  process.exit(1);
}
const ENV_LIST = (process.env.TCB_ENV_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
if (!ENV_LIST.length || !ENV_LIST.includes(DEFAULT_ENV_ID)) ENV_LIST.unshift(DEFAULT_ENV_ID);
const SECRET_ID = process.env.TCB_SECRET_ID || '';
const SECRET_KEY = process.env.TCB_SECRET_KEY || '';
const PORT = parseInt(process.env.ADMIN_PORT || '8787', 10);
const HOST = process.env.ADMIN_HOST || '127.0.0.1';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';

// 每个环境可单独配置凭证（跨账号场景）：TCB_SECRET_ID_N / TCB_SECRET_KEY_N（N=环境在
// TCB_ENV_IDS 中的位置序号，第 2 个环境即 TCB_SECRET_ID_2）；未配置时回落默认
// TCB_SECRET_ID / TCB_SECRET_KEY。
function secretsFor(envId) {
  const idx = ENV_LIST.indexOf(envId);
  if (idx > 0) {
    const id = process.env['TCB_SECRET_ID_' + (idx + 1)] || '';
    const key = process.env['TCB_SECRET_KEY_' + (idx + 1)] || '';
    if (id && key) return { id, key };
  }
  return { id: SECRET_ID, key: SECRET_KEY };
}
function hasSecrets(envId) {
  const s = secretsFor(envId);
  return !!(s.id && s.key);
}

// 兜底集合名单（listCollections 接口失败时使用）；可用 KNOWN_COLLECTIONS 环境变量覆盖（逗号分隔）
const KNOWN_COLLECTIONS = (process.env.KNOWN_COLLECTIONS ||
  'wardrobe_items,wardrobe_user_profiles,wardrobe_app_config,wardrobe_circles,' +
  'wardrobe_circle_items,wardrobe_circle_outfits,wardrobe_reports'
).split(',').map(s => s.trim()).filter(Boolean);

// ============ 客户端（惰性构造，按 envId 缓存） ============
const _clients = new Map(); // envId -> { tcb, manager }

function assertSecrets(envId) {
  const s = secretsFor(envId);
  if (!s.id || !s.key) {
    const idx = ENV_LIST.indexOf(envId);
    const hint = idx > 0
      ? '环境 ' + envId + ' 未配置独立凭证（.env 填 TCB_SECRET_ID_' + (idx + 1) + ' / TCB_SECRET_KEY_' + (idx + 1) + '），且默认 TCB_SECRET_ID / TCB_SECRET_KEY 也缺失'
      : '未配置腾讯云凭证：请在 .env 填入 TCB_SECRET_ID 与 TCB_SECRET_KEY 后重启服务';
    throw new AppError(hint, 'NO_SECRETS');
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

// 解析并校验本次请求的目标环境（缺省=默认环境；非法 env 直接 4xx 级报错）
function resolveEnv(params) {
  const id = (params.get('env') || '').trim() || DEFAULT_ENV_ID;
  if (!ENV_LIST.includes(id)) {
    throw new AppError('未知云环境：' + id + '（可选：' + ENV_LIST.join(' / ') + '）', 'BAD_ENV');
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

// 列举某前缀下「一级」内容（子目录 + 直属文件）。listDirectoryFiles 递归返回该前缀下对象，
// 这里按首个路径段聚合成子目录，剩余作为本层文件。
async function storageListOneLevel(prefix, limit, envId) {
  const m = getManager(envId);
  const storage = m.storage;
  let raw;
  try { raw = await storage.listDirectoryFiles(prefix, limit || 1000); }
  catch (e) { throw new AppError('云存储列举失败：' + (e.message || e), 'STORAGE'); }
  if (raw && raw.Files) raw = raw.Files;
  if (!Array.isArray(raw)) raw = raw || [];
  let p = prefix || '';
  if (p && !p.endsWith('/')) p += '/';
  const files = [];
  const dirSet = new Set();
  for (const f of raw) {
    const name = f.Key || f.key || '';
    if (!name || name === p) continue; // 跳过目录本身
    if (name.endsWith('/')) { dirSet.add(name); continue; }
    const rest = name.slice(p.length);
    const slash = rest.indexOf('/');
    if (slash > 0) dirSet.add(p + rest.slice(0, slash)); // 子目录
    else { const nf = normFile(f); if (nf) files.push(nf); }
  }
  files.sort((a, b) => a.name < b.name ? -1 : 1);
  return { files, prefixes: Array.from(dirSet).sort() };
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
  arr.forEach((f, i) => {
    const url = f && (f.url || f.URL);
    if (!url) return;
    const rawId = f.fileId || f.fileID || '';
    if (rawId) out[rawId] = url;
    // 响应的 fileId 是 cloud://<env>.<bucket>/<相对路径> 形态，剥掉前缀即前端使用的相对 cloudPath
    const rel = rawId.replace(/^cloud:\/\/[^/]+\//i, '');
    if (rel && cloudPaths.includes(rel)) out[rel] = url;
    else { const req = list[i] && list[i].cloudPath; if (req) out[req] = url; }
  });
  return out;
}

async function storageDelete(cloudPaths, envId) {
  const m = getManager(envId);
  const storage = m.storage;
  const list = cloudPaths.slice(0, 50);
  try { await storage.deleteFile(list); }
  catch (e) { throw new AppError('删除云文件失败：' + (e.message || e), 'STORAGE'); }
  return { deleted: list.length };
}

async function storageUpload(cloudPath, buffer, envId) {
  const app = getClient(envId);
  const r = await app.uploadFile({ cloudPath: cloudPath, fileContent: buffer });
  return { fileID: (r && r.fileID) || '' };
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
  if (!field || !q) return null;
  try { return { [field]: db(envId).RegExp({ regexp: q, options: 'i' }) }; }
  catch (e) { return null; }
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
function serveStatic(res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const filePath = path.join(__dirname, 'public', rel);
  if (!filePath.startsWith(path.join(__dirname, 'public'))) return sendError(res, 403, 'forbidden');
  fs.readFile(filePath, (err, data) => {
    if (err) return sendError(res, 404, 'not found: ' + pathname);
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

// ============ 路由 ============
const handlers = {
  'GET /api/status': async (req, res, params) => {
    // 逐环境报告：hasSecrets（凭证齐备）+ ok（SDK 构造成功，不发起真实请求）
    const envs = ENV_LIST.map(envId => {
      const credsOk = hasSecrets(envId);
      let ok = false, message = '';
      if (credsOk) { try { getClient(envId); ok = true; } catch (e) { message = e.message; } }
      return { envId, hasSecrets: credsOk, ok, message };
    });
    const def = envs.find(e => e.envId === DEFAULT_ENV_ID) || envs[0] || { envId: DEFAULT_ENV_ID, ok: false };
    return sendJson(res, 200, { ok: !!def.ok, envId: DEFAULT_ENV_ID, envs: ENV_LIST, envsStatus: envs, hasSecrets: hasSecrets(DEFAULT_ENV_ID), host: HOST, port: PORT, message: def.message || '' });
  },

  'GET /api/overview': async (req, res, params) => {
    const envId = resolveEnv(params);
    const allNames = await listCollectionNames(envId);
    const counts = {};
    const details = [];
    for (const name of allNames) {
      try { counts[name] = await collectionCount(envId, name, null); }
      catch (e) { counts[name] = 'ERR'; details.push(name + ': ' + e.message); }
    }
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
    return sendJson(res, 200, { envId, counts: counts, details: details, storage: storage });
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
    const filter = buildFilter(envId, params);
    try {
      const total = await collectionCount(envId, name, filter);
      const docs = await collectionQuery(envId, name, { skip: (page - 1) * size, limit: size, sort, sortDir, filter });
      return sendJson(res, 200, { name, total, page, size, docs, hasMore: page * size < total });
    } catch (e) { return sendError(res, 500, e.message); }
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
    try {
      await db(envId).collection(name).doc(id).update(body);
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
    const maxKeys = Math.min(1000, Math.max(1, parseInt(params.get('maxKeys') || '1000', 10)));
    try {
      const r = await storageListOneLevel(prefix, maxKeys, envId);
      return sendJson(res, 200, { prefix, files: r.files, prefixes: r.prefixes });
    } catch (e) { return sendError(res, 500, e.message); }
  },

  'GET /api/storage/urls': async (req, res, params) => {
    const envId = resolveEnv(params);
    const fileIDs = (params.get('fileIDs') || '').split(',').map(s => s.trim()).filter(Boolean);
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
    const cloudPath = (params.get('cloudPath') || '').trim();
    if (!cloudPath) return sendError(res, 400, '缺少 cloudPath');
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
    return serveStatic(res, pathname);
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

server.listen(PORT, HOST, () => {
  const has = !!(SECRET_ID && SECRET_KEY);
  console.log('==========================================================');
  console.log('  云端数据管理台（多环境）');
  console.log('  本地访问: http://' + HOST + ':' + PORT + '/');
  console.log('  云环境 : ' + ENV_LIST.join('  |  ') + '（默认 ' + DEFAULT_ENV_ID + '）');
  console.log('  凭证   : ' + (has ? '已配置' : '未配置（请在 .env 填入 TCB_SECRET_ID / TCB_SECRET_KEY）'));
  console.log('==========================================================');
});
