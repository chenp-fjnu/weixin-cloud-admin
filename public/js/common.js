/* 云端数据管理台 —— 公共工具与全局状态
   零依赖原生 JS。图标库、DOM 简写、统一 API 请求、格式/转义工具、主题、全局状态 S。
   引入顺序：common → overview → db → storage → main（无构建步骤，纯全局作用域）。 */
'use strict';

// ---------- 图标库（线性 SVG，stroke 继承 currentColor） ----------
const ICONS = {
  cloud: '<path d="M6.5 19a4.5 4.5 0 0 1-.42-8.98 6.5 6.5 0 0 1 12.62-1.2A5.5 5.5 0 0 1 17.5 19h-11z"/>',
  grid: '<rect x="3" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5"/>',
  db: '<ellipse cx="12" cy="5.5" rx="8" ry="3"/><path d="M4 5.5v13c0 1.66 3.58 3 8 3s8-1.34 8-3v-13"/><path d="M4 12c0 1.66 3.58 3 8 3s8-1.34 8-3"/>',
  folder: '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h3.6a2 2 0 0 1 1.6.8l1.2 1.6h6.6A2.5 2.5 0 0 1 19 10.5v6a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 3 16.5v-9z"/>',
  folderOpen: '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h3.6a2 2 0 0 1 1.6.8l1.2 1.6h4.6A2.5 2.5 0 0 1 19 9.9V12"/><path d="M3 7.5V12c0 1.4 1.1 2.5 2.5 2.5L18 12h1v3a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 3 15z"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.64-6.36L21 8"/><path d="M21 3v5h-5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M4 7h16"/><path d="M9.5 7V4.5A1.5 1.5 0 0 1 11 3h2a1.5 1.5 0 0 1 1.5 1.5V7"/><path d="M6.5 7l.8 12a2 2 0 0 0 2 1.9h5.4a2 2 0 0 0 2-1.9L17.5 7"/><path d="M10 11v6M14 11v6"/>',
  upload: '<path d="M12 16V4m0 0 4.5 4.5M12 4 7.5 8.5"/><path d="M4 16.5V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2.5"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  edit: '<path d="M14.5 5.5 18.5 9.5 8 20H4v-4L14.5 5.5z"/><path d="M12.5 7.5l4 4"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  up: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  back: '<path d="M19 12H5m0 0 6 6m-6-6 6-6"/>',
  arrowR: '<path d="M9 6l6 6-6 6"/>',
  scan: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/><path d="M8.5 11h5M11 8.5v5"/>',
  sun: '<circle cx="12" cy="12" r="4.5"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/>',
  moon: '<path d="M20.5 14.5A8.5 8.5 0 1 1 9.5 3.5a7 7 0 0 0 11 11z"/>',
  chevR: '<path d="M9 6l6 6-6 6"/>',
  list: '<path d="M9 6h12M9 12h12M9 18h12"/><path d="M4.2 6h.01M4.2 12h.01M4.2 18h.01"/>',
  file: '<path d="M13.5 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5L13.5 3z"/><path d="M13.5 3v5.5H19"/>',
  fileText: '<path d="M13.5 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5L13.5 3z"/><path d="M13.5 3v5.5H19"/><path d="M9 13h6M9 16.5h4"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M21 15.5 16 10.5 5.5 18"/>',
  video: '<rect x="3" y="5.5" width="13" height="13" rx="2"/><path d="M16 10.5 21 8v8l-5-2.5"/>',
  music: '<path d="M9 18.5V6l10-2v12.5"/><circle cx="6.5" cy="18.5" r="2.5"/><circle cx="16.5" cy="16.5" r="2.5"/>',
  archive: '<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8"/><path d="M10 12.5h4"/>',
  code: '<path d="M8.5 7 4 12l4.5 5M15.5 7 20 12l-4.5 5"/>',
  chart: '<path d="M4 20h16"/><path d="M7 20v-6M12 20V6M17 20v-9"/>',
  warning: '<path d="M12 4 2.5 20h19L12 4z"/><path d="M12 10v4.5"/><path d="M12 17.4v.2"/>'
};
// 注入图标：<span class="ni"></span> 自动替换为 SVG（供 HTML 静态占位符使用）
function ic(name, attrs) {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"' + (attrs || '') + '>' + (ICONS[name] || '') + '</svg>';
}
// 页面加载时给所有带 data-ic 的占位符填充图标（图标名 = data-ic 属性值；data-big 放大至 24px）
function initIcons() {
  document.querySelectorAll('[data-ic]').forEach(el => {
    el.outerHTML = ic(el.getAttribute('data-ic'), el.hasAttribute('data-big') ? ' width="24" height="24"' : '');
  });
}

// ---------- DOM 简写 ----------
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

// ---------- Toast ----------
function toast(msg, type) {
  const box = $('#toasts');
  while (box.children.length >= 4) box.firstChild.remove(); // 防连续报错时 toast 无限堆叠
  const el = document.createElement('div');
  el.className = 'toast' + (type ? ' ' + type : '');
  const name = type === 'ok' ? 'check' : type === 'err' ? 'warning' : 'info';
  el.innerHTML = ic(name) + '<span>' + esc(msg) + '</span>';
  box.appendChild(el);
  setTimeout(() => el.classList.add('bye'), 2600);
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
    throw new Error('无法连接本地服务：请确认 server 已启动（当前为离线状态，可点左侧「服务状态」重试）');
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
function fmtNum(n) {
  n = Number(n);
  if (!Number.isFinite(n)) return '0';
  return n.toLocaleString('en-US');
}
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

// ---------- 主题（浅色 / 深色，localStorage 持久化，默认跟随系统） ----------
const THEME_LS_KEY = 'wxw-admin-theme';
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  const btn = $('#themeBtn');
  if (btn) {
    btn.querySelector('.ti').innerHTML = ic(t === 'dark' ? 'sun' : 'moon');
    btn.querySelector('.txt').textContent = t === 'dark' ? '浅色模式' : '深色模式';
  }
}
function toggleTheme() {
  const t = (document.documentElement.getAttribute('data-theme') === 'dark') ? 'light' : 'dark';
  applyTheme(t);
  try { localStorage.setItem(THEME_LS_KEY, t); } catch (e) { /* ignore */ }
}

// ---------- 全局状态 ----------
const ENV_LS_KEY = 'wxw-admin-env';
const S = {
  env: '',
  activeTab: 'overview',
  overview: null,
  db: { collection: '', page: 1, size: 20, total: 0, docs: [], fields: [], cols: [], sort: '', sortDir: 'desc', q: '', field: '' },
  st: { prefix: '', files: [], dirs: [], loadedAt: 0, filter: '', sort: 'name' }
};
try { S.env = localStorage.getItem(ENV_LS_KEY) || ''; } catch (e) { /* ignore */ }

// ---------- 复制文本（clipboard API 优先，降级 execCommand） ----------
function copyText(t) {
  if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(t);
  return new Promise((res, rej) => {
    const ta = document.createElement('textarea');
    ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.focus(); ta.select();
    try { document.execCommand('copy') ? res() : rej(new Error('copy')); }
    catch (e) { rej(e); } finally { ta.remove(); }
  });
}

// ---------- 模态框通用 ----------
function showModal(id) { $('#' + id).classList.add('show'); }
function hideModal(id) { $('#' + id).classList.remove('show'); }
