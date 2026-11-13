/* 云端数据管理台 —— 前端逻辑
   零依赖原生 JS。三个 Tab：概览 / 云数据库 / 云存储。
   覆盖整个云开发环境的全部集合与全部存储文件。
   所有云访问经本地 server.js 的 /api（同源，零凭证）。 */
'use strict';

// ---------- 基础工具 ----------
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

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
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// ---------- 状态 ----------
const ENV_LS_KEY = 'wxw-admin-env';
const S = {
  env: '',
  activeTab: 'overview',
  overview: null,
  db: { collection: '', page: 1, size: 20, total: 0, docs: [], fields: [], cols: [], sort: '', sortDir: 'asc', q: '', field: '' },
  st: { prefix: '', files: [], dirs: [], loadedAt: 0 }
};
try { S.env = localStorage.getItem(ENV_LS_KEY) || ''; } catch (e) { /* ignore */ }

// ---------- Tab 切换 ----------
function switchTab(name) {
  S.activeTab = name;
  $$('.tab').forEach(t => {
    const on = t.dataset.tab === name;
    t.classList.toggle('active', on);
    t.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  $$('.section').forEach(s => s.classList.toggle('active', s.id === 'sec-' + name));
  if (name === 'overview' && !S.overview) loadOverview();
  if (name === 'db') initDb();
  // 15 秒内重复进入存储 Tab 不重复拉列表（数据新鲜度由 loadedAt 判定）
  if (name === 'storage' && (!S.st.loadedAt || Date.now() - S.st.loadedAt > 15000)) loadStorage();
}
$$('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));

// ---------- 连接状态 & 环境切换 ----------
let _statusTimer = null; // 离线时每 10s 自动重试一次
async function checkStatus() {
  try {
    const s = await api('/api/status');
    initEnvSelect(s.envsStatus || (s.envs || []).map(e => ({ envId: e, hasSecrets: true, ok: true })), s.envId);
    updateConnBadge(s.envsStatus);
    if (_statusTimer) { clearInterval(_statusTimer); _statusTimer = null; }
  } catch (e) {
    $('#connDot').className = 'dot off';
    $('#connText').textContent = '服务未启动';
    if (!_statusTimer) _statusTimer = setInterval(checkStatus, 10000); // server 起来后自动恢复，无需刷新页面
  }
}

function updateConnBadge(envsStatus) {
  const info = (envsStatus || []).find(e => e.envId === S.env);
  const dot = $('#connDot'), txt = $('#connText');
  if (!info) return;
  if (info.ok) { dot.className = 'dot on'; txt.textContent = '已连接'; }
  else if (info.hasSecrets) { dot.className = 'dot off'; txt.textContent = 'SDK 异常'; }
  else { dot.className = 'dot off'; txt.textContent = '该环境未配置凭证'; }
}

// 顶栏环境下拉：服务端下发每个环境的凭证/连通状态填充；缺失凭证的环境标注「未配置凭证」
function initEnvSelect(envsStatus, defaultEnv) {
  const sel = $('#envSelect');
  const ids = envsStatus.map(e => e.envId);
  const cur = (S.env && ids.indexOf(S.env) >= 0) ? S.env : defaultEnv;
  sel.innerHTML = '';
  envsStatus.forEach(e => {
    const o = document.createElement('option');
    o.value = e.envId;
    o.textContent = e.envId + (e.hasSecrets ? '' : '（未配置凭证）');
    sel.appendChild(o);
  });
  sel.value = cur;
  const changed = !!S.env && S.env !== cur;
  S.env = cur;
  try { localStorage.setItem(ENV_LS_KEY, cur); } catch (e) { /* ignore */ }
  sel.onchange = function () { switchEnv(this.value); };
  if (changed) toast('当前环境：' + cur, 'ok');
}

async function switchEnv(envId) {
  if (!envId || envId === S.env) return;
  S.env = envId;
  try { localStorage.setItem(ENV_LS_KEY, envId); } catch (e) { /* ignore */ }
  closeModals(true);
  // 各 tab 数据均为环境级状态：全部重置，当前 tab 重载
  S.overview = null;
  dbInited = false;
  S.db.collection = ''; S.db.page = 1; S.db.docs = []; S.db.cols = [];
  S.db.sort = ''; S.db.q = ''; S.db.field = ''; S.db.fieldsSet = null;
  const qEl = $('#dbQuery'), sortEl = $('#dbSort'), fieldEl = $('#dbField'), sortDirEl = $('#dbSortDir');
  if (qEl) qEl.value = '';
  if (sortEl) sortEl.value = '';
  if (fieldEl) fieldEl.value = '';
  if (sortDirEl) sortDirEl.value = 'asc';
  S.st.prefix = ''; S.st.loadedAt = 0; stSel = new Set();
  loadOverview();
  const tab = S.activeTab || 'overview';
  if (tab === 'db') initDb();
  if (tab === 'storage') loadStorage();
  toast('已切换到环境 ' + envId, 'ok');
}

// ---------- 概览 ----------
// 可选：集合中文标签（key = 集合名，value = 显示名）；未配置的集合直接显示原始集合名
const COL_LABEL = {};

async function loadOverview() {
  const banner = $('#ovBanner');
  try {
    const o = await api('/api/overview');
  S.overview = o;
  S.overview.at = Date.now();
  $('#ovLoading').style.display = 'none';
  $('#ovBody').style.display = 'block';
  $('#ovUpdatedAt').textContent = '统计于 ' + new Date().toLocaleTimeString('zh-CN', { hour12: false });
    // DB 卡片
    const cards = $('#ovCards'); cards.innerHTML = '';
    let total = 0, err = 0;
    for (const name in o.counts) {
      const v = o.counts[name];
      if (v === 'ERR') err++; else total += Number(v) || 0;
      const c = document.createElement('div');
      c.className = 'card click';
      c.innerHTML = '<div class="k">' + esc(COL_LABEL[name] || name) + ' <span class="tag">点击查询</span></div>'
        + '<div class="v">' + (v === 'ERR' ? '—' : v) + '</div>'
        + '<div class="m">collection: ' + esc(name) + '</div>';
      c.addEventListener('click', () => { openCollection(name); });
      cards.appendChild(c);
    }
    $('#ovDbTotal').textContent = '合计 ' + total + (err ? '（' + err + ' 个集合读取失败）' : '');
    // 存储卡片（totalFiles 为 -1 表示采样未计全，展示为「—」而非负数）
    const sc = $('#ovStorageCards'); sc.innerHTML = '';
    const st = o.storage || {};
    const filesShown = (st.totalFiles != null && st.totalFiles >= 0) ? st.totalFiles : '—';
    const dirsShown = (st.topDirs != null && st.topDirs >= 0) ? st.topDirs : '—';
    const stCards = [
      ['顶层目录数', dirsShown, '根目录下一级路径段'],
      ['扫描文件数', filesShown, st.truncated ? '已达采样上限 5000' : '根目录全量采样'],
      ['扫描字节合计', st.totalSize != null ? fmtSize(st.totalSize) : '—', '采样文件体积之和']
    ];
    stCards.forEach((it) => {
      const c = document.createElement('div');
      c.className = 'card';
      c.innerHTML = '<div class="k">' + it[0] + '</div><div class="v" style="font-size:24px">' + esc(it[1]) + '</div><div class="m">' + esc(it[2]) + '</div>';
      sc.appendChild(c);
    });
    if (st.error) {
      banner.className = 'banner show';
      banner.innerHTML = '云存储概览失败：' + esc(st.error);
    } else banner.className = 'banner';
  } catch (e) {
    $('#ovLoading').style.display = 'none';
    banner.className = 'banner show';
    banner.textContent = '概览加载失败：' + e.message;
  }
}

// ---------- 数据库 ----------
// 全环境集合名单的主源是服务端 /api/collections（listCollections）；
// KNOWN_COLS 仅作接口失败时的兜底，留空即可（服务端自身已有兜底名单）。
const KNOWN_COLS = [];

let dbInited = false;
let dbSeq = 0; // 请求序号：快速翻页/切环境时丢弃过期响应，避免旧数据覆盖新数据
async function initDb() {
  const sel = $('#dbCollection');
  if (!dbInited) {
    dbInited = true;
    await loadCollections();
  }
  S.db.collection = sel.value;
  await loadDb();
}

async function loadCollections() {
  const sel = $('#dbCollection');
  let names = null;
  try {
    const r = await api('/api/collections');
    names = r.collections || [];
  } catch (e) { /* 兜底用已知集合 */ }
  if (!names || !names.length) names = KNOWN_COLS;
  sel.innerHTML = '';
  names.forEach(n => { const o = document.createElement('option'); o.value = n; o.textContent = n; sel.appendChild(o); });
  if (!names.length) {
    sel.innerHTML = '<option value="">（该环境暂无集合）</option>';
  }
}

function openCollection(name) {
  switchTab('db');
  const sel = $('#dbCollection');
  if (!Array.from(sel.options).some(o => o.value === name)) {
    const o = document.createElement('option'); o.value = name; o.textContent = name; sel.appendChild(o);
  }
  sel.value = name; S.db.collection = name; S.db.page = 1;
  loadDb();
}

async function loadDb() {
  const name = S.db.collection;
  if (!name) {
    $('#dbBody').innerHTML = '<tr><td colspan="15" class="empty">请先选择集合</td></tr>';
    return;
  }
  // colspan 大于实际列数时浏览器会并入剩余列，不会错位
  const body = $('#dbBody');
  body.innerHTML = '<tr><td colspan="15" class="empty"><span class="spin"></span> 加载中…</td></tr>';
  $('#dbPageInfo').textContent = '加载中…';
  $('#dbCount').textContent = '…';
  const p = new URLSearchParams({ name, page: S.db.page, size: S.db.size });
  if (S.db.q && S.db.field) { p.set('field', S.db.field); p.set('q', S.db.q); }
  if (S.db.sort) { p.set('sort', S.db.sort); p.set('sortDir', S.db.sortDir); }
  const seq = ++dbSeq;
  try {
    const r = await api('/api/collection?' + p.toString());
    if (seq !== dbSeq) return; // 已有更新的请求，丢弃本次过期响应
    S.db.total = r.total; S.db.docs = r.docs;
    fillDbFields(r.docs);
    renderDbTable();
  } catch (e) {
    if (seq !== dbSeq) return;
    body.innerHTML = '<tr><td colspan="15" class="empty">加载失败：' + esc(e.message) + '</td></tr>';
  }
}

// 字段并集跨页累积（S.db.fieldsSet），让「筛选字段」「排序字段」下拉不因翻页丢项
function fillDbFields(docs) {
  const f = $('#dbField'), sortSel = $('#dbSort');
  if (!S.db.fieldsSet) S.db.fieldsSet = new Set(['_id']);
  docs.forEach(d => Object.keys(d).forEach(k => S.db.fieldsSet.add(k)));
  const fields = Array.from(S.db.fieldsSet);
  const prevField = f.value, prevSort = sortSel.value;
  f.innerHTML = '<option value="">（全字段）</option>';
  sortSel.innerHTML = '<option value="">默认</option>';
  fields.forEach(k => {
    const o1 = document.createElement('option'); o1.value = k; o1.textContent = k; f.appendChild(o1);
    const o2 = document.createElement('option'); o2.value = k; o2.textContent = k; sortSel.appendChild(o2);
  });
  if (prevField && S.db.fieldsSet.has(prevField)) f.value = prevField;
  if (prevSort && S.db.fieldsSet.has(prevSort)) sortSel.value = prevSort;
}

// 按当前页文档字段并集动态生成列（_id 恒首列，其余按首次出现顺序）
function fieldColumns(docs) {
  const cols = ['_id'];
  const seen = new Set(cols);
  docs.forEach(d => Object.keys(d).forEach(k => {
    if (!seen.has(k)) { seen.add(k); cols.push(k); }
  }));
  return cols;
}
function cellText(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
  try { return JSON.stringify(v); } catch (e) { return String(v); }
}
// 特定字段的值渲染为徽标（其余列纯文本）
function pillFor(field, value) {
  if (field === 'kind') {
    if (value === 'public') return '<span class="pill pub">公开圈</span>';
    if (value === 'invite') return '<span class="pill inv">私密圈</span>';
  }
  if (field === 'isSquare' && value === true) return '<span class="pill">广场</span>';
  if (field === 'deleted' && value === true) return '<span class="pill" style="background:var(--red-bg);color:var(--red)">已删</span>';
  return null;
}

function renderDbTable() {
  S.db.cols = fieldColumns(S.db.docs);
  // 动态表头：_id + 各字段 + 操作
  $('#dbHead').innerHTML = '<th>_id</th>'
    + S.db.cols.filter(c => c !== '_id').map(c => '<th>' + esc(c) + '</th>').join('')
    + '<th>操作</th>';
  const body = $('#dbBody'); body.innerHTML = '';
  if (!S.db.docs.length) {
    body.innerHTML = '<tr><td colspan="' + (S.db.cols.length + 1) + '" class="empty">（空集合或无匹配）</td></tr>';
  }
  // 先收集本页所有 cloud:// 图片，渲染后一次性批量取临时链接（每格单发 → 一次批量）
  const imgRels = [];
  S.db.docs.forEach(d => {
    const tr = document.createElement('tr');
    S.db.cols.forEach(col => {
      const td = document.createElement('td');
      const pill = pillFor(col, d[col]);
      if (pill) { td.innerHTML = pill; }
      else if (col === '_id') { td.className = 'id'; td.textContent = d[col]; td.title = d[col]; }
      else if (typeof d[col] === 'string' && /^cloud:\/\//.test(d[col]) && isImage(d[col])) {
        // cloud:// 图片（如 imageId）→ 缩略图，本页图片统一批量取临时链接后填充
        td.title = d[col];
        td.innerHTML = '<span class="spin"></span>';
        const rel = d[col].replace(/^cloud:\/\/[^/]+\//i, '');
        td.dataset.rel = rel;
        imgRels.push(rel);
      }
      else {
        const t = cellText(d[col]);
        td.className = 'val'; td.textContent = t;
        if (t) td.title = t; else td.innerHTML = '<span class="muted">—</span>';
      }
      tr.appendChild(td);
    });
    const opCell = document.createElement('td');
    const bView = mkBtn('查看', () => openDoc(d._id));
    const bEdit = mkBtn('编辑', () => openDoc(d._id, true));
    const bDel = mkBtn('删除', () => delDoc(d._id)); bDel.className += ' danger';
    opCell.append(bView, bEdit, bDel);
    tr.appendChild(opCell);
    body.appendChild(tr);
  });
  // 分页信息
  const pages = Math.max(1, Math.ceil(S.db.total / S.db.size));
  $('#dbPageInfo').textContent = '第 ' + S.db.page + ' / ' + pages + ' 页 · 共 ' + S.db.total + ' 条';
  $('#dbPrev').disabled = S.db.page <= 1;
  $('#dbNext').disabled = S.db.page >= pages;
  $('#dbCount').textContent = S.db.total + ' 条文档';
  // 批量填充本页 cloud:// 图片缩略图
  if (imgRels.length) {
    const tok = ++_imgTok;
    resolveUrls(Array.from(new Set(imgRels))).then(map => {
      if (tok !== _imgTok) return; // 表格已重渲染，丢弃过期结果
      $$('td[data-rel]', body).forEach(td => {
        const url = map[td.dataset.rel];
        if (url) {
          td.innerHTML = '';
          const img = document.createElement('img');
          img.className = 'cellimg'; img.src = url; img.alt = '预览';
          img.addEventListener('click', () => previewFile({ name: td.dataset.rel }));
          td.appendChild(img);
        } else td.innerHTML = '<span class="muted">—</span>';
      });
    });
  }
}
let _imgTok = 0; // 表格重渲染令牌：丢弃上一批未完成的图片 URL 填充

function mkBtn(label, fn, cls) {
  const b = document.createElement('button');
  b.className = 'btn sm' + (cls ? ' ' + cls : '');
  b.textContent = label;
  b.addEventListener('click', fn);
  return b;
}

// ---------- 文档查看 / 编辑 / 删除 ----------
let _editing = null; // { name, id }
let _editOrig = ''; // 打开（或进入编辑）时的原始文本，用于未保存检测
function setDocMode(edit) {
  $('#docEdit').style.display = edit ? 'none' : '';
  $('#docSave').style.display = edit ? '' : 'none';
  $('#docText').readOnly = !edit;
  if (edit) _editOrig = $('#docText').value;
}
function docDirty() {
  return !!_editing && $('#docMask').classList.contains('show') && $('#docText').value !== _editOrig;
}
async function openDoc(id, edit) {
  const name = S.db.collection;
  let doc;
  try { doc = (await api('/api/doc?' + new URLSearchParams({ name, id }))).doc; }
  catch (e) { return toast('读取文档失败：' + e.message, 'err'); }
  _editing = { name, id };
  const idShort = id.length > 16 ? id.slice(0, 16) + '…' : id;
  $('#docTitle').textContent = '文档 · ' + name + '（' + idShort + '）';
  $('#docText').value = JSON.stringify(doc, null, 2);
  _editOrig = $('#docText').value;
  setDocMode(!!edit);
  showModal('docMask');
}

function closeModals(force) {
  // 编辑中有未保存修改时拦截（force 用于保存成功/切环境等程序化关闭）
  if (!force && docDirty() && !confirm('当前文档有未保存的修改，确定放弃并关闭？')) return;
  $$('.mask.show').forEach(m => m.classList.remove('show'));
  _editing = null;
}

async function saveDoc() {
  if (!_editing) return;
  let doc;
  try { doc = JSON.parse($('#docText').value); }
  catch (e) { return toast('JSON 非法：' + e.message, 'err'); }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return toast('须为 JSON 对象', 'err');
  const btn = $('#docSave'); btn.disabled = true; btn.textContent = '保存中…';
  try {
    await api('/api/doc?name=' + _editing.name + '&id=' + encodeURIComponent(_editing.id), { method: 'PUT', body: doc });
    toast('已保存', 'ok');
    closeModals(true);
    loadDb();
  } catch (e) {
    toast('保存失败：' + e.message, 'err');
    btn.disabled = false; btn.textContent = '保存修改';
  }
}

let _delBusy = false;
function delDoc(id) {
  if (_delBusy) return;
  if (!confirm('确认删除文档 ' + id + ' ？此操作不可撤销。')) return;
  _delBusy = true;
  api('/api/doc?name=' + S.db.collection + '&id=' + encodeURIComponent(id), { method: 'DELETE' })
    .then(() => { toast('已删除', 'ok'); loadDb(); })
    .catch(e => toast('删除失败：' + e.message, 'err'))
    .finally(() => { _delBusy = false; });
}

// ---------- 模态框通用 ----------
function showModal(id) { $('#' + id).classList.add('show'); }
function hideModal(id) { $('#' + id).classList.remove('show'); }

// ---------- 云存储 ----------
let stSel = new Set();
let stUrlSeq = 0; // 缩略图批量 URL 请求序号：目录切换后丢弃过期结果
function isImage(name) { return /\.(jpe?g|png|webp|gif|bmp|svg)$/i.test(name); }

async function loadStorage() {
  stSel = new Set();
  const loading = $('#stLoading'), body = $('#stBody');
  loading.style.display = ''; body.style.display = 'none';
  $('#stScanPanel').style.display = 'none';
  const p = new URLSearchParams({ prefix: S.st.prefix });
  try {
    const r = await api('/api/storage?' + p.toString());
    S.st.files = r.files; S.st.dirs = r.prefixes; S.st.loadedAt = Date.now();
    loading.style.display = 'none'; body.style.display = 'block';
    renderCrumbs();
    renderStorage();
  } catch (e) {
    loading.style.display = 'none';
    body.style.display = 'block';
    S.st.files = []; S.st.dirs = []; // 清空陈旧数据，避免工具栏残留旧选择计数
    $('#stGrid').innerHTML = '<div class="empty">列举失败：' + esc(e.message) + '</div>';
    updateSelCount();
  }
}

function renderCrumbs() {
  const box = $('#stCrumbs'); box.innerHTML = '';
  const parts = S.st.prefix.replace(/\/+$/, '').split('/').filter(Boolean);
  const mk = (label, prefix, cur) => {
    const c = document.createElement('span');
    c.className = 'c' + (cur ? ' cur' : ''); c.textContent = label;
    if (!cur) c.addEventListener('click', () => { S.st.prefix = prefix; loadStorage(); });
    else c.className = 'c cur';
    box.appendChild(c);
  };
  const root = document.createElement('span'); root.className = 'c'; root.textContent = '根 /';
  root.addEventListener('click', () => { S.st.prefix = ''; loadStorage(); });
  box.appendChild(root);
  let acc = '';
  parts.forEach((seg, i) => {
    const sep = document.createElement('span'); sep.className = 'sep'; sep.textContent = '/'; box.appendChild(sep);
    acc += (acc ? '/' : '') + seg;
    mk(seg, acc + '/', i === parts.length - 1);
  });
  if (S.st.prefix === '') {
    // 空
  }
  $('#stUp').disabled = S.st.prefix.length <= 1;
}

function renderStorage() {
  const grid = $('#stGrid'); grid.innerHTML = '';
  const { dirs, files } = S.st;
  if (!dirs.length && !files.length) {
    grid.innerHTML = '<div class="empty">（此目录为空）</div>';
    updateSelCount();
    return;
  }
  const MAX_RENDER = 800; // 单层文件过多时限制 DOM 量，防止万级文件冻结页面
  const shown = files.slice(0, MAX_RENDER);
  dirs.forEach(d => {
    const name = d.split('/').pop();
    const it = document.createElement('div'); it.className = 'fitem dir';
    it.innerHTML = '<div class="thumb">📁</div><div class="nm">' + esc(name) + '</div><div class="meta">目录</div>';
    it.addEventListener('click', () => { S.st.prefix = d; loadStorage(); });
    grid.appendChild(it);
  });
  shown.forEach(f => {
    const base = f.name.split('/').pop();
    const it = document.createElement('div'); it.className = 'fitem';
    it.dataset.path = f.name;
    const thumb = document.createElement('div'); thumb.className = 'thumb';
    if (isImage(f.name)) { thumb.innerHTML = '<span class="spin"></span>'; }
    else thumb.textContent = '📄';
    const nm = document.createElement('div'); nm.className = 'nm'; nm.textContent = base;
    const meta = document.createElement('div'); meta.className = 'meta';
    meta.textContent = fmtSize(f.size) + (f.lastModified ? ' · ' + fmtDate(f.lastModified) : '');
    const ck = document.createElement('div'); ck.className = 'ck'; ck.textContent = '✓';
    it.append(thumb, nm, meta, ck);
    it.addEventListener('click', (e) => {
      if (e.target === ck || e.target === ck.firstChild) { toggleSel(f.name); return; }
      previewFile(f);
    });
    if (stSel.has(f.name)) it.classList.add('sel');
    grid.appendChild(it);
  });
  if (files.length > MAX_RENDER) {
    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.style.gridColumn = '1 / -1';
    hint.textContent = '本目录文件较多，仅渲染前 ' + MAX_RENDER + ' 个（共 ' + files.length + ' 个）；如需处理其余文件，请进入子目录或用「扫描子目录」定位。';
    grid.appendChild(hint);
  }
  // 本页所有图片一次性批量取临时 URL（旧实现每图一个请求，20 图 = 20 次往返）
  if (shown.some(f => isImage(f.name))) {
    let seq = ++stUrlSeq;
    resolveUrls(shown.filter(f => isImage(f.name)).map(f => f.name)).then(map => {
      if (seq !== stUrlSeq) return; // 目录已切换，丢弃过期结果
      $$('#stGrid .fitem').forEach(it => {
        const th = it.querySelector('.thumb');
        if (!th) return;
        const url = map[it.dataset.path];
        if (url) {
          const img = document.createElement('img');
          img.src = url; img.alt = '';
          img.addEventListener('error', () => { th.textContent = '📄'; }); // 链接失效时兜底，不整块消失
          th.innerHTML = ''; th.appendChild(img);
        } else if (th.querySelector('.spin')) th.textContent = '📄'; // 取 URL 失败：spinner 转成占位，不永久转圈
      });
    });
  }
  updateSelCount();
}

function toggleSel(name) {
  if (stSel.has(name)) stSel.delete(name); else stSel.add(name);
  $$('#stGrid .fitem').forEach(el => { if (el.dataset.path === name) el.classList.toggle('sel', stSel.has(name)); });
  updateSelCount();
}
function selectAllPage() {
  S.st.files.forEach(f => stSel.add(f.name));
  $$('#stGrid .fitem').forEach(el => { if (el.dataset.path) el.classList.add('sel'); });
  updateSelCount();
}
function clearSel() {
  stSel = new Set();
  $$('#stGrid .fitem.sel').forEach(el => el.classList.remove('sel'));
  updateSelCount();
}
function updateSelCount() {
  const c = $('#stDelete .stselcount'); if (c) c.textContent = stSel.size;
  $('#stDelete').disabled = stSel.size === 0;
}

async function resolveUrl(cloudPath) {
  // 复用批量通道与进程内缓存，避免重复请求同一文件的临时链接
  const map = await resolveUrls([cloudPath]);
  return map[cloudPath] || '';
}
// 批量取临时链接：按 50 一批并发请求，进程内缓存（临时链接 2h 有效），返回 { cloudPath: url }
const _urlCache = new Map();
function resolveUrls(cloudPaths) {
  const need = cloudPaths.filter(p => !_urlCache.get(p));
  const chunks = [];
  for (let i = 0; i < need.length; i += 50) chunks.push(need.slice(i, i + 50));
  return Promise.all(chunks.map(chunk => {
    if (!chunk.length) return Promise.resolve({});
    const p = new URLSearchParams({ fileIDs: chunk.join(',') });
    return api('/api/storage/urls?' + p.toString()).then(r => r.urls || {}).catch(() => ({}));
  })).then(results => {
    const fresh = {};
    results.forEach(m => Object.assign(fresh, m));
    Object.entries(fresh).forEach(([k, v]) => { if (v) _urlCache.set(k, v); });
    const map = {};
    cloudPaths.forEach(p => { const u = _urlCache.get(p); if (u) map[p] = u; });
    return map;
  });
}

async function previewFile(f) {
  showModal('fileMask');
  $('#fileTitle').textContent = f.name.split('/').pop();
  const bodyEl = $('#fileBody');
  bodyEl.innerHTML = '<div class="empty"><span class="spin"></span> 获取预览链接…</div>';
  const url = await resolveUrl(f.name);
  let kv = '<div class="kv"><div class="k">路径</div><div class="v">' + esc(f.name) + '</div>';
  if (f.size != null) kv += '<div class="k">大小</div><div class="v">' + fmtSize(f.size) + '</div>';
  if (f.lastModified) kv += '<div class="k">修改时间</div><div class="v">' + esc(fmtDate(f.lastModified)) + '</div>';
  kv += '</div>';
  if (!url) { bodyEl.innerHTML = kv + '<div class="empty">（无法获取预览链接）</div>'; $('#fileOpen').style.display = 'none'; return; }
  if (isImage(f.name)) {
    bodyEl.innerHTML = kv + '<img class="previewimg" src="' + url + '" alt="preview">';
    const imEl = bodyEl.querySelector('.previewimg');
    if (imEl) imEl.addEventListener('error', () => {
      imEl.outerHTML = '<div class="empty">图片加载失败（临时链接可能已过期），请点「刷新」重试</div>';
    });
    $('#fileOpen').href = url; $('#fileOpen').style.display = '';
  } else {
    bodyEl.innerHTML = kv + '<pre class="code">' + esc('非图片文件，请通过「在新标签打开」下载查看。\n临时链接：\n' + url) + '</pre>';
    $('#fileOpen').href = url; $('#fileOpen').style.display = '';
  }
}

async function scanDirs() {
  $('#stScanPanel').style.display = 'block';
  const list = $('#stUserList');
  const base = S.st.prefix || '';
  list.innerHTML = '<div class="empty"><span class="spin"></span> 正在扫描' + (base ? ' <b>' + esc(base) + '</b>' : ' 根目录') + ' …</div>';
  try {
    const r = await api('/api/storage/walk?prefix=' + encodeURIComponent(base) + '&max=5000');
    const map = {};
    (r.files || []).forEach(f => {
      let rel = f.name;
      if (base && rel.startsWith(base)) rel = rel.slice(base.length);
      const first = rel.split('/')[0];
      if (!first) return;
      map[first] = (map[first] || { count: 0, size: 0 });
      map[first].count++; map[first].size += f.size || 0;
    });
    const keys = Object.keys(map).sort();
    list.innerHTML = '';
    if (!keys.length) { list.innerHTML = '<div class="empty">未扫描到任何文件（当前目录为空）</div>'; return; }
    keys.forEach(k => {
      const info = map[k];
      const row = document.createElement('div'); row.className = 'userrow';
      row.innerHTML = '<div class="p">' + esc(base + k + '/') + '</div><div class="muted">' + info.count + ' 文件 · ' + fmtSize(info.size) + '</div>';
      row.addEventListener('click', () => { S.st.prefix = base + k + '/'; loadStorage(); });
      list.appendChild(row);
    });
  } catch (e) {
    list.innerHTML = '<div class="empty">扫描失败：' + esc(e.message) + '</div>';
  }
}

let _delBusySt = false;
async function deleteSelected() {
  const arr = Array.from(stSel);
  if (!arr.length || _delBusySt) return;
  const preview = arr.slice(0, 20).map(x => '· ' + x.split('/').pop()).join('\n') + (arr.length > 20 ? '\n… 等 ' + arr.length + ' 个' : '');
  if (!confirm('确认删除所选 ' + arr.length + ' 个云文件？\n\n' + preview + '\n\n此操作不可撤销。')) return;
  const btn = $('#stDelete'); btn.disabled = true; btn.textContent = '删除中…';
  let ok = 0;
  try {
    // 每批 50 个串行删除，汇总真实删除数（旧实现后端静默截断 50 个但前端报全量，数据不一致）
    for (let i = 0; i < arr.length; i += 50) {
      const r = await api('/api/storage/delete', { method: 'POST', body: { fileIDs: arr.slice(i, i + 50) } });
      ok += (r && r.deleted) || 0;
    }
    toast('已删除 ' + ok + ' 个文件', 'ok');
    loadStorage();
  } catch (e) {
    toast('删除失败：' + e.message + (ok ? '（已成功 ' + ok + ' 个）' : ''), 'err');
    updateSelCount(); // 部分成功时刷新按钮计数，保留已选供重试
  } finally {
    _delBusySt = false;
    btn.textContent = '删除所选（<span class="stselcount"></span>）';
    updateSelCount();
  }
}

// 上传核心：上传单个文件到当前目录，返回是否成功（文件选择器与拖拽共用）
async function uploadOneFile(file) {
  let ext = (file.name.match(/\.[^./]+$/) || [''])[0];
  let base = (file.name.replace(/\.[^./]+$/, '') || 'upload').replace(/[^\w\u4e00-\u9fa5-]/g, '_');
  const cloudPath = S.st.prefix + base + '-' + Date.now() + ext;
  if (!confirm('上传到：\n' + cloudPath + '\n\n确认？')) return false;
  const lbl = $('#stUploadLbl');
  if (lbl.textContent !== '上传文件到当前目录') return false; // 防重复上传
  lbl.textContent = '上传中…';
  try {
    const envParam = S.env ? '&env=' + encodeURIComponent(S.env) : '';
    const resp = await fetch('/api/storage/upload?cloudPath=' + encodeURIComponent(cloudPath) + envParam, { method: 'POST', body: file });
    let data = null; try { data = await resp.json(); } catch (e) {}
    if (!resp.ok) throw new Error((data && data.error) || ('HTTP ' + resp.status));
    toast('已上传：' + (data.fileID || cloudPath), 'ok');
    return true;
  } catch (e) { toast('上传失败：' + e.message, 'err'); return false; }
  finally { lbl.textContent = '上传文件到当前目录'; }
}
async function uploadToCurrent() {
  const input = $('#stUploadFile');
  const file = input.files && input.files[0];
  input.value = '';
  if (!file) return;
  if (await uploadOneFile(file)) loadStorage();
}

// ---------- 事件绑定 & 启动 ----------
function bindEvents() {
  // 概览
  $('#ovRefresh').addEventListener('click', () => {
    $('#ovLoading').style.display = '';
    $('#ovBody').style.display = 'none';
    loadOverview();
  });
  // 连接状态徽章：手动重试
  $('#connBadge').addEventListener('click', () => {
    if (_statusTimer) { clearInterval(_statusTimer); _statusTimer = null; }
    checkStatus();
  });

  // 数据库
  $('#dbCollection').addEventListener('change', function () {
    S.db.collection = this.value; S.db.page = 1;
    S.db.fieldsSet = null; S.db.q = ''; S.db.field = ''; S.db.sort = '';
    $('#dbQuery').value = ''; $('#dbSort').value = '';
    loadDb();
  });
  $('#dbSize').addEventListener('change', function () {
    S.db.size = +this.value; S.db.page = 1; loadDb();
  });
  $('#dbRefresh').addEventListener('click', loadDb);
  $('#dbSearch').addEventListener('click', function () {
    const q = $('#dbQuery').value.trim();
    if (q.length > 200) return toast('搜索表达式过长（≤200 字符）', 'err');
    S.db.field = $('#dbField').value; S.db.q = q; S.db.page = 1;
    loadDb();
  });
  $('#dbQuery').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') $('#dbSearch').click();
  });
  $('#dbSort').addEventListener('change', function () { S.db.sort = this.value; loadDb(); });
  $('#dbSortDir').addEventListener('change', function () { S.db.sortDir = this.value; loadDb(); });
  $('#dbPrev').addEventListener('click', function () { if (S.db.page > 1) { S.db.page--; loadDb(); } });
  $('#dbNext').addEventListener('click', function () { S.db.page++; loadDb(); });
  $('#dbAdd').addEventListener('click', async function () {
    if (!S.db.collection) return toast('请先选择集合', 'err');
    try {
      const res = await api('/api/collection?name=' + encodeURIComponent(S.db.collection), { method: 'POST', body: {} });
      if (!res.id) return toast('已创建，但未返回文档 ID', 'err');
      toast('已创建空文档 ' + res.id, 'ok');
      openDoc(res.id, true);
    } catch (e) { toast('创建失败：' + e.message, 'err'); }
  });

  // 文档模态框
  $('#docEdit').addEventListener('click', () => setDocMode(true)); // 查看 → 直接进入编辑，无需关闭重开
  $('#docSave').addEventListener('click', saveDoc);
  $('#docClose').addEventListener('click', () => closeModals());
  $('#docCopy').addEventListener('click', function () {
    const t = $('#docText').value;
    (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(
      () => toast('已复制', 'ok'), () => toast('复制失败', 'err')
    );
  });

  // 云存储
  $('#stUp').addEventListener('click', function () {
    if (S.st.prefix.length <= 1) return;
    const p = S.st.prefix.replace(/[^/]*$/, '');
    S.st.prefix = p.length > 1 ? p : (p === '/' ? '' : p);
    loadStorage();
  });
  $('#stRefresh').addEventListener('click', loadStorage);
  $('#stScan').addEventListener('click', scanDirs);
  $('#stDelete').addEventListener('click', deleteSelected);
  $('#stUploadFile').addEventListener('change', uploadToCurrent);
  $('#stSelAll').addEventListener('click', selectAllPage);
  $('#stUnselAll').addEventListener('click', clearSel);

  // 拖拽上传：支持多文件，逐个确认并串行上传
  const stPanel = $('#sec-storage .panel');
  let _dragDepth = 0;
  const hasFiles = e => e.dataTransfer && Array.prototype.includes.call(e.dataTransfer.types, 'Files');
  const stSec = $('#sec-storage');
  stSec.addEventListener('dragenter', e => {
    if (!hasFiles(e)) return;
    e.preventDefault(); _dragDepth++; stPanel.classList.add('drop');
  });
  stSec.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
  stSec.addEventListener('dragleave', e => {
    if (!hasFiles(e)) return;
    _dragDepth = Math.max(0, _dragDepth - 1);
    if (!_dragDepth) stPanel.classList.remove('drop');
  });
  stSec.addEventListener('drop', async e => {
    if (!hasFiles(e)) return;
    e.preventDefault(); _dragDepth = 0; stPanel.classList.remove('drop');
    const files = Array.from(e.dataTransfer.files || []);
    if (!files.length) return;
    let anyOk = false;
    for (const f of files) { if (await uploadOneFile(f)) anyOk = true; }
    if (anyOk) loadStorage();
  });

  // 模态框关闭按钮（data-close）
  $$('[data-close]').forEach(el => el.addEventListener('click', () => closeModals()));
  // 点击遮罩空白关闭
  $$('.mask').forEach(m => m.addEventListener('click', (e) => { if (e.target === m) closeModals(); }));
  // ESC 关闭模态框
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModals(); });
}

document.addEventListener('DOMContentLoaded', function () {
  bindEvents();
  checkStatus();
  loadOverview();
});
