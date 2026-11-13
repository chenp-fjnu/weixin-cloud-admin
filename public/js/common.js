/* 云端数据管理台 —— 公共工具与全局状态
   零依赖原生 JS。DOM 简写、统一 API 请求、格式/转义工具、全局状态 S。
   引入顺序：common → overview → db → storage → main（无构建步骤，纯全局作用域）。 */
'use strict';

// ---------- DOM 简写 ----------
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

// ---------- Toast ----------
function toast(msg, type) {
  const box = $('#toasts');
  while (box.children.length >= 4) box.firstChild.remove(); // 防连续报错时 toast 无限堆叠
  const el = document.createElement('div');
  el.className = 'toast' + (type ? ' ' + type : '');
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = '.3s'; }, 2600);
  setTimeout(() => el.remove(), 3000);
}

// ---------- API 请求（同源零凭证，服务端代去 CloudBase） ----------
async function api(path, opts) {
  opts = opts || {};
  const headers = Object.assign({}, opts.headers || {});
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (!/[?&]env=/.test(path) && S.env) path += (path.includes('?') ? '&' : '?') + 'env=' + encodeURIComponent(S.env);
  let res;
  try {
    res = await fetch(path, {
      method: opts.method || 'GET',
      headers,
      body: opts.body !== undefined ? (typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body)) : undefined
    });
  } catch (e) {
    throw new Error('无法连接本地服务：请确认 server 已启动（当前为离线状态，可点右上角状态徽章重试）');
  }
  let data = null;
  try { data = await res.json(); } catch (e) {}
  if (!res.ok) throw new Error((data && data.error) || ('HTTP ' + res.status));
  return data;
}
// 常用方法薄封装：各 Tab 模块按动词直调，method/headers/body 拼装收敛在这里
const apiGet = (path) => api(path);
const apiPost = (path, body) => api(path, { method: 'POST', body });
const apiPut = (path, body) => api(path, { method: 'PUT', body });
const apiDelete = (path) => api(path, { method: 'DELETE' });

// ---------- 格式化 ----------
function fmtSize(n) {
  n = Number(n) || 0;
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
  return (n / 1073741824).toFixed(2) + ' GB';
}
function fmtDate(s) {
  if (!s) return '';
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleString('zh-CN', { hour12: false });
}
// 把「时间语义」字段值（ISO 字符串 / 秒级 / 毫秒级时间戳 / CloudBase {$date} 包装）
// 统一格式化为可读的本地时间；非时间值返回 null，交由调用方原样渲染。
// 用「字段名含时间语义」+「值落在当代时间戳范围」双重判断，避免把普通数字/ID 误当时间。
function isTimeField(name) {
  return /time|date|stamp|created|updated|modified|_at$|^at$|At$|birthday|birth/i.test(name);
}
// 当代时间戳范围：秒级 ~2001~2099，毫秒级同区间。中间灰区不判为时间，降低误伤。
function tsToNum(v) {
  if (typeof v === 'number' && Number.isFinite(v)) {
    if (v >= 1e9 && v < 4.1e9) return v * 1000;      // 秒级 → 毫秒
    if (v >= 1e12 && v < 4.1e13) return v;            // 毫秒级
    return null;
  }
  return null;
}
function fmtTimeValue(col, v) {
  // ISO 8601 字符串 → 基本可确定是日期，直接格式化
  if (typeof v === 'string') {
    const s = v.trim();
    if (/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(s)) {
      const d = new Date(s);
      if (!isNaN(d.getTime())) return d.toLocaleString('zh-CN', { hour12: false });
    }
    return null;
  }
  // 数字时间戳：仅当字段名含时间语义时转换，避免误伤普通数字
  if (typeof v === 'number' && isTimeField(col)) {
    const ms = tsToNum(v);
    if (ms != null) { const d = new Date(ms); if (!isNaN(d.getTime())) return d.toLocaleString('zh-CN', { hour12: false }); }
  }
  // CloudBase 日期包装对象 {"$date": ...}（SDK 反序列化后通常已是 Date，此为兜底）
  if (v && typeof v === 'object' && v.$date != null) {
    const d = new Date(Number(v.$date));
    if (!isNaN(d.getTime())) return d.toLocaleString('zh-CN', { hour12: false });
  }
  return null;
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// ---------- 全局状态 ----------
const ENV_LS_KEY = 'wxw-admin-env';
const S = {
  env: '',
  activeTab: 'overview',
  overview: null,
  db: { collection: '', page: 1, size: 20, total: 0, docs: [], fields: [], cols: [], sort: '', sortDir: 'desc', q: '', field: '' },
  st: { prefix: '', files: [], dirs: [], loadedAt: 0 }
};
try { S.env = localStorage.getItem(ENV_LS_KEY) || ''; } catch (e) { /* ignore */ }

// ---------- 模态框通用 ----------
function showModal(id) { $('#' + id).classList.add('show'); }
function hideModal(id) { $('#' + id).classList.remove('show'); }
