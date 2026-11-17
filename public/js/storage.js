/* 云端数据管理台 —— 云存储 Tab（ES Module）
   目录浏览（图标面包屑）、图片缩略图（批量临时链接 + 缓存）、文件类型图标、
   目录内筛选/排序、分页（每页条数可选）、悬停单删、文件预览、多选删除、
   单文件/拖拽上传、子目录扫描聚合。 */

import { $, $$, S, apiGet, apiPost, apiPut, apiUpload, toast, esc, ic, fmtSize, fmtDate, showModal, hideModal } from './common.js';

let stSel = new Set();
let stUrlSeq = 0; // 缩略图批量 URL 请求序号：目录切换后丢弃过期结果
const ST_VIEW_KEY = 'wxw-admin-stview'; // 显示方式：grid / list
let stView = 'grid';
function isImage(name) { return /\.(jpe?g|png|webp|gif|bmp|svg)$/i.test(name); }
// 切换显示方式并持久化；list 视图下 #stGrid 加 .list 类走行样式
function setStView(v) {
  stView = v;
  try { localStorage.setItem(ST_VIEW_KEY, v); } catch (e) { /* ignore */ }
  $('#stGrid').classList.toggle('list', v === 'list');
  const g = $('#stViewGrid'), l = $('#stViewList');
  if (g) g.classList.toggle('on', v === 'grid');
  if (l) l.classList.toggle('on', v === 'list');
}

// 文件类型 → 图标名
function fileIcon(name) {
  const ext = (name.match(/\.([^.]+)$/) || [])[1] || '';
  const e = ext.toLowerCase();
  if (isImage(name)) return 'image';
  if (['mp4', 'mov', 'webm', 'avi', 'mkv', 'm4v'].includes(e)) return 'video';
  if (['mp3', 'wav', 'flac', 'm4a', 'ogg', 'aac'].includes(e)) return 'music';
  if (['pdf', 'doc', 'docx', 'txt', 'md', 'rtf'].includes(e)) return 'fileText';
  if (['zip', 'rar', '7z', 'gz', 'tar', 'iso'].includes(e)) return 'archive';
  if (['js', 'ts', 'jsx', 'tsx', 'json', 'html', 'css', 'py', 'sh'].includes(e)) return 'code';
  return 'file';
}
// 当前文件集合：'all' 视图返回全目录平铺列表（已按修改时间倒序，见 loadAllFiles），
// 其余视图返回当前目录列表并做筛选/排序
function stFiltered() {
  if (S.st.sort === 'all') {
    const kw = (S.st.filter || '').trim().toLowerCase();
    let files = S.st.allFiles || [];
    if (kw) files = files.filter(f => f.name.toLowerCase().includes(kw));
    return files;
  }
  const kw = (S.st.filter || '').trim().toLowerCase();
  let files = S.st.files;
  if (kw) files = files.filter(f => f.name.toLowerCase().includes(kw));
  if (S.st.sort === 'size') files = files.slice().sort((a, b) => (b.size || 0) - (a.size || 0));
  else if (S.st.sort === 'date') files = files.slice().sort((a, b) => (b.lastModified || 0) - (a.lastModified || 0));
  else files = files.slice().sort((a, b) => a.name.localeCompare(b.name, 'zh'));
  return files;
}

// 全目录平铺视图：递归扫描当前环境全部文件，按修改时间倒序（新→旧）。
// 云端文件数通常远低于 5000 上限；超限时截断并标注（allTruncated）。
async function loadAllFiles() {
  const base = S.st.prefix || '';
  S.st.allLoadedAt = Date.now();
  S.st.allTruncated = false;
  try {
    const r = await apiGet('/api/storage/walk?prefix=' + encodeURIComponent(base) + '&max=5000');
    if (S.st.sort === 'all') {
      S.st.allFiles = (r.files || []).slice().sort((a, b) => (b.lastModified || '') > (a.lastModified || '') ? 1
        : (b.lastModified || '') < (a.lastModified || '') ? -1 : a.name.localeCompare(b.name, 'zh'));
      S.st.allTruncated = (r.count || 0) >= 5000;
      renderStorage();
    }
  } catch (e) {
    if (S.st.sort === 'all') toast('全目录扫描失败：' + e.message, 'err');
  }
}

// 排序方式切换（name/size/date/all）；'all' 需拉取全目录数据；切换即回第一页
function setStSort(v) {
  S.st.sort = v;
  S.st.page = 1;
  if (v === 'all') loadAllFiles(); else renderStorage();
}

async function loadStorage() {
  stSel = new Set();
  S.st.page = 1; // 切目录/刷新即回第一页
  const loading = $('#stLoading'), body = $('#stBody');
  loading.style.display = ''; body.style.display = 'none';
  $('#stScanPanel').style.display = 'none';
  hideBatchBar(); // 目录切换即失效的选中态，同步收起批量操作条
  loadStorageAcl(); // 存储 ACL 与目录无关，随 Tab 刷新读取
  const p = new URLSearchParams({ prefix: S.st.prefix });
  try {
    const r = await apiGet('/api/storage?' + p.toString());
    S.st.files = r.files; S.st.dirs = r.prefixes; S.st.loadedAt = Date.now();
    loading.style.display = 'none'; body.style.display = 'block';
    renderCrumbs();
    renderStorage();
  } catch (e) {
    loading.style.display = 'none';
    body.style.display = 'block';
    const pg = $('#stPager'); if (pg) pg.style.display = 'none';
    S.st.files = []; S.st.dirs = []; // 清空陈旧数据，避免工具栏残留旧选择计数
    $('#stStats').innerHTML = '';
    $('#stGrid').innerHTML = '<div class="empty">列举失败：' + esc(e.message) + '</div>';
    updateSelCount();
  }
}

function renderCrumbs() {
  const box = $('#stCrumbs'); box.innerHTML = '';
  const parts = S.st.prefix.replace(/\/+$/, '').split('/').filter(Boolean);
  const mk = (label, prefix, cur) => {
    const c = document.createElement('span');
    c.className = 'c' + (cur ? ' cur' : '');
    c.innerHTML = ic(cur ? 'folderOpen' : 'folder') + '<span>' + esc(label) + '</span>';
    if (!cur) c.addEventListener('click', () => { S.st.prefix = prefix; loadStorage(); });
    box.appendChild(c);
  };
  const root = document.createElement('span'); root.className = 'c';
  root.innerHTML = ic('grid') + '<span>根目录</span>';
  root.addEventListener('click', () => { S.st.prefix = ''; loadStorage(); });
  box.appendChild(root);
  let acc = '';
  parts.forEach((seg, i) => {
    const sep = document.createElement('span'); sep.className = 'sep'; sep.textContent = '/'; box.appendChild(sep);
    acc += (acc ? '/' : '') + seg;
    mk(seg, acc + '/', i === parts.length - 1);
  });
  $('#stUp').disabled = S.st.prefix.length <= 1;
}

function renderStorage() {
  const grid = $('#stGrid'); grid.innerHTML = '';
  const allMode = S.st.sort === 'all';
  const { dirs } = S.st;
  const files = stFiltered();
  renderStats(dirs, files, allMode);
  if (!dirs.length && !files.length) {
    const pg = $('#stPager'); if (pg) pg.style.display = 'none';
    grid.innerHTML = '<div class="empty">' + (S.st.filter ? '（无匹配文件，请调整筛选条件）'
      : (allMode ? '（全目录未发现文件）' : '（此目录为空）')) + '</div>';
    updateSelCount();
    return;
  }
  // 分页：每页 N 个文件（目录项始终整层展示，不占页码），页码越界自动收敛
  const pages = Math.max(1, Math.ceil(files.length / S.st.pageSize));
  if (S.st.page > pages) S.st.page = pages;
  const start = (S.st.page - 1) * S.st.pageSize;
  const shown = files.slice(start, start + S.st.pageSize);
  const listMode = stView === 'list';
  if (!allMode) {
    dirs.forEach(d => {
      const name = d.replace(/\/+$/, '').split('/').filter(Boolean).pop() || '目录';
      const it = document.createElement('div'); it.className = 'fitem dir' + (listMode ? ' row' : '');
      it.innerHTML = '<div class="thumb">' + ic('folderOpen') + '</div><div class="nm">' + esc(name) + '</div><div class="meta">目录</div>';
      it.addEventListener('click', () => { S.st.prefix = d; loadStorage(); });
      grid.appendChild(it);
    });
  }
  shown.forEach(f => {
    const base = f.name.split('/').pop();
    const it = document.createElement('div'); it.className = 'fitem' + (listMode ? ' row' : '');
    it.dataset.path = f.name;
    const thumb = document.createElement('div'); thumb.className = 'thumb';
    if (isImage(f.name)) { thumb.innerHTML = '<span class="spin"></span>'; }
    else thumb.innerHTML = ic(fileIcon(f.name));
    const nm = document.createElement('div'); nm.className = 'nm';
    // 全目录视图：文件名后附所属目录，便于定位来源（目录浏览视图只显示文件名）
    nm.textContent = allMode ? (base + '  ·  ' + f.name.slice(0, f.name.length - base.length).replace(/\/+$/, '')) : base;
    const meta = document.createElement('div'); meta.className = 'meta';
    meta.textContent = fmtSize(f.size) + (f.lastModified ? ' · ' + fmtDate(f.lastModified) : '');
    // 悬停操作：预览 + 单删
    const ops = document.createElement('div'); ops.className = 'ops';
    const bPrev = document.createElement('button'); bPrev.className = 'iconbtn'; bPrev.title = '预览';
    bPrev.innerHTML = ic('eye');
    bPrev.addEventListener('click', (e) => { e.stopPropagation(); previewFile(f); });
    const bDel = document.createElement('button'); bDel.className = 'iconbtn'; bDel.title = '删除该文件';
    bDel.innerHTML = ic('trash');
    bDel.addEventListener('click', (e) => { e.stopPropagation(); delFileOne(f.name); });
    ops.append(bPrev, bDel);
    const ck = document.createElement('div'); ck.className = 'ck'; ck.innerHTML = ic('check');
    it.append(thumb, nm, meta, ops, ck);
    it.addEventListener('click', (e) => {
      if (e.target === ck || ck.contains(e.target)) { toggleSel(f.name); return; }
      previewFile(f);
    });
    if (stSel.has(f.name)) it.classList.add('sel');
    grid.appendChild(it);
  });
  if (allMode && S.st.allTruncated) {
    const hint = document.createElement('div');
    hint.className = 'hint warnhint';
    hint.style.gridColumn = '1 / -1';
    hint.textContent = '文件数超过 5000 个，已按修改时间倒序仅展示最新 5000 个；更早的文件请用目录浏览逐层查看。';
    grid.appendChild(hint);
  }
  renderPager(files.length);
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
          img.addEventListener('error', () => { th.innerHTML = ic('file'); }); // 链接失效时兜底，不整块消失
          th.innerHTML = ''; th.appendChild(img);
        } else if (th.querySelector('.spin')) th.innerHTML = ic('image'); // 取 URL 失败：spinner 转成占位，不永久转圈
      });
    });
  }
  updateSelCount();
}

// 统计行：目录浏览视图 = N 个目录 · M 个文件 · 合计大小（仅当前目录直属项）；
// 全目录视图 = M 个文件（全部目录）· 合计大小（上限 5000 截断时标注）
function renderStats(dirs, files, allMode) {
  const el = $('#stStats');
  if (!el) return;
  if (!dirs.length && !files.length) { el.innerHTML = ''; return; }
  const totalSize = files.reduce((s, f) => s + (f.size || 0), 0);
  if (allMode) {
    el.innerHTML = '<span class="sitem">' + ic('scan') + '<b>全部目录</b> · 按修改时间倒序</span>'
      + '<span class="sitem">' + ic('file') + '<b>' + files.length + '</b> 个文件' + (S.st.allTruncated ? '（截断）' : '') + '</span>'
      + (files.length ? '<span class="sitem">' + ic('chart') + '合计 <b>' + fmtSize(totalSize) + '</b></span>' : '');
    return;
  }
  el.innerHTML = '<span class="sitem">' + ic('folderOpen') + '<b>' + dirs.length + '</b> 个目录</span>'
    + '<span class="sitem">' + ic('file') + '<b>' + files.length + '</b> 个文件</span>'
    + (files.length ? '<span class="sitem">' + ic('chart') + '合计 <b>' + fmtSize(totalSize) + '</b></span>' : '');
}

// 批量操作条：选中 >0 时出现（工具栏计数之外更醒目的集中操作区）
function hideBatchBar() {
  const bar = $('#stBatchBar');
  if (bar) bar.style.display = 'none';
}
function showBatchBar() {
  const bar = $('#stBatchBar');
  if (!bar) return;
  bar.style.display = 'flex';
  const c = $('#stBatchCount');
  if (c) c.textContent = stSel.size;
}

function toggleSel(name) {
  if (stSel.has(name)) stSel.delete(name); else stSel.add(name);
  $$('#stGrid .fitem').forEach(el => { if (el.dataset.path === name) el.classList.toggle('sel', stSel.has(name)); });
  updateSelCount();
}
function selectAllPage() {
  // 「本页」= 当前页实际渲染的文件（分页后每页 ≤ pageSize 个）；
  // 旧实现选中 S.st.files 全量——渲染 800 个、可能选中几千个，删除确认框又只预览前 20 个，
  // 一点删除就是全目录删除。现只选已渲染项，语义与所见一致。
  const rendered = new Set();
  $$('#stGrid .fitem').forEach(el => { if (el.dataset.path) rendered.add(el.dataset.path); });
  rendered.forEach(n => stSel.add(n));
  $$('#stGrid .fitem').forEach(el => { if (el.dataset.path) el.classList.add('sel'); });
  updateSelCount();
}
// 切环境时由 main.js 调用：复位存储 Tab 状态（模块级状态跨文件不可直接改，必须走封装）
function resetStorage() {
  stSel.clear();
  S.st.prefix = ''; S.st.loadedAt = 0; S.st.filter = ''; S.st.sort = 'name';
  S.st.page = 1; S.st.pageSize = 30;
  S.st.allFiles = []; S.st.allTruncated = false; S.st.allLoadedAt = 0;
  stUrlSeq++; // 使在途缩略图 URL 请求过期
  clearUrlCache();
  _aclSeq++; // 使在途 ACL 请求过期，切环境后不回填旧权限
  const aclBox = $('#stAclBox'); if (aclBox) aclBox.innerHTML = '';
}
function clearSel() {
  stSel = new Set();
  $$('#stGrid .fitem.sel').forEach(el => el.classList.remove('sel'));
  updateSelCount();
}
function updateSelCount() {
  const c = $('#stDelete .stselcount'); if (c) c.textContent = stSel.size;
  $('#stDelete').disabled = stSel.size === 0;
  if (stSel.size > 0) showBatchBar(); else hideBatchBar();
}

// 分页条：上一页/下一页 + 「第 a–b / 共 N 个 · 第 X / Y 页」+ 每页条数下拉
function renderPager(total) {
  const box = $('#stPager');
  if (!box) return;
  if (!total || Math.ceil(total / S.st.pageSize) <= 1) { box.style.display = 'none'; return; }
  box.style.display = 'flex';
  box.innerHTML = '';
  const pages = Math.max(1, Math.ceil(total / S.st.pageSize));
  const start = (S.st.page - 1) * S.st.pageSize + 1;
  const end = Math.min(S.st.page * S.st.pageSize, total);
  const mkBtn = (label, disabled, fn) => {
    const b = document.createElement('button');
    b.className = 'btn sm'; b.textContent = label; b.disabled = disabled;
    b.addEventListener('click', fn);
    box.appendChild(b);
  };
  mkBtn('‹ 上一页', S.st.page <= 1, () => stGoPage(S.st.page - 1));
  mkBtn('下一页 ›', S.st.page >= pages, () => stGoPage(S.st.page + 1));
  const info = document.createElement('span');
  info.className = 'pmeta';
  info.textContent = '第 ' + start + '–' + end + ' / 共 ' + total + ' 个 · 第 ' + S.st.page + ' / ' + pages + ' 页';
  box.appendChild(info);
  const sp = document.createElement('span'); sp.className = 'spacer'; box.appendChild(sp);
  const sel = document.createElement('select');
  sel.title = '每页显示';
  [30, 60, 100, 200].forEach(n => {
    const o = document.createElement('option');
    o.value = String(n); o.textContent = n + ' 个/页';
    if (n === S.st.pageSize) o.selected = true;
    sel.appendChild(o);
  });
  sel.addEventListener('change', () => { S.st.pageSize = +sel.value; S.st.page = 1; renderStorage(); });
  box.appendChild(sel);
}
function stGoPage(p) {
  const pages = Math.max(1, Math.ceil(stFiltered().length / S.st.pageSize));
  S.st.page = Math.min(Math.max(1, p), pages);
  renderStorage();
}

async function resolveUrl(cloudPath) {
  // 复用批量通道与进程内缓存，避免重复请求同一文件的临时链接
  const map = await resolveUrls([cloudPath]);
  return map[cloudPath] || '';
}
// 批量取临时链接：按 50 一批并发请求，进程内缓存（临时链接 2h 有效，缓存 1.8h 提前失效），返回 { cloudPath: url }
const _urlCache = new Map();
const _URL_TTL = 1.8 * 60 * 60 * 1000;
function _urlFresh(p) {
  const e = _urlCache.get(p);
  if (!e) return '';
  if (Date.now() - e.at > _URL_TTL) { _urlCache.delete(p); return ''; }
  return e.url;
}
function clearUrlCache() { _urlCache.clear(); }
function resolveUrls(cloudPaths) {
  const need = cloudPaths.filter(p => !_urlFresh(p));
  const chunks = [];
  for (let i = 0; i < need.length; i += 50) chunks.push(need.slice(i, i + 50));
  let failedBatches = 0;
  return Promise.all(chunks.map(chunk => {
    if (!chunk.length) return Promise.resolve({});
    // 后端已改为 POST（URL 过长会被截断，且避免 100+ 字符的 query 串）
    return apiPost('/api/storage/urls', { fileIDs: chunk }).then(r => r.urls || {}).catch(() => {
      failedBatches++;
      return {};
    });
  })).then(results => {
    const fresh = {};
    results.forEach(m => Object.assign(fresh, m));
    Object.entries(fresh).forEach(([k, v]) => { if (v) _urlCache.set(k, { url: v, at: Date.now() }); });
    const map = {};
    cloudPaths.forEach(p => { const u = _urlFresh(p); if (u) map[p] = u; });
    // 批次失败不再静默吞掉：明确提示哪些图可能没有预览（原实现 catch 后 {}，
    // 用户只看到占位图标，无法区分「无权限」还是「网络失败」）
    if (failedBatches) toast('部分临时链接获取失败（' + failedBatches + ' 批），相关图片暂无法预览，可点「刷新」重试', 'err');
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
    const r = await apiGet('/api/storage/walk?prefix=' + encodeURIComponent(base) + '&max=5000');
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

// ---------- 删除（批量 / 单个共用核心） ----------
let _delBusySt = false;
function resetDeleteBtn() {
  const btn = $('#stDelete');
  btn.innerHTML = ic('trash') + '删除所选（<span class="stselcount">0</span>）';
  btn.disabled = true;
}
async function doDelete(arr) {
  _delBusySt = true;
  const btn = $('#stDelete'); btn.disabled = true;
  let ok = 0;
  let _delFail = false;
  try {
    // 每批 50 个串行删除，汇总真实删除数（旧实现后端静默截断 50 个但前端报全量，数据不一致）
    for (let i = 0; i < arr.length; i += 50) {
      const batch = arr.slice(i, i + 50);
      try {
        const r = await apiPost('/api/storage/delete', { fileIDs: batch });
        ok += (r && r.deleted) || 0;
        // 本批成功：从已选集合移除，失败重试时不会重复删，计数也准确
        batch.forEach(p => stSel.delete(p));
        updateSelCount();
      } catch (e) {
        // 单批失败：保留该批在 stSel 中供重试，继续尝试后续批次
        _delFail = true;
      }
    }
    if (_delFail) {
      toast('已删除 ' + ok + ' 个，部分批次失败，失败文件仍保持选中可重试', 'err');
    } else {
      toast('已删除 ' + ok + ' 个文件', 'ok');
    }
    loadStorage();
  } catch (e) {
    toast('删除失败：' + e.message + (ok ? '（已成功 ' + ok + ' 个）' : ''), 'err');
    updateSelCount(); // 部分成功时刷新按钮计数，保留已选供重试
  } finally {
    _delBusySt = false;
    resetDeleteBtn();
    updateSelCount();
  }
}
function deleteSelected() {
  const arr = Array.from(stSel);
  if (!arr.length || _delBusySt) return;
  const preview = arr.slice(0, 20).map(x => '· ' + x.split('/').pop()).join('\n') + (arr.length > 20 ? '\n… 等 ' + arr.length + ' 个' : '');
  if (!confirm('确认删除所选 ' + arr.length + ' 个云文件？\n\n' + preview + '\n\n此操作不可撤销。')) return;
  doDelete(arr);
}
function delFileOne(path) {
  if (_delBusySt) return;
  // all 视图下当前文件在 allFiles 中，S.st.files 只是当前目录直属项，不能据此判存在
  const cur = S.st.sort === 'all' ? (S.st.allFiles || []) : S.st.files;
  if (!cur.some(f => f.name === path)) return;
  if (!confirm('确认删除云文件 ' + path + ' ？此操作不可撤销。')) return;
  doDelete([path]);
}

// 上传核心：上传单个文件到当前目录，返回是否成功（文件选择器与拖拽共用）
async function uploadOneFile(file) {
  let ext = (file.name.match(/\.[^./]+$/) || [''])[0];
  let base = (file.name.replace(/\.[^./]+$/, '') || 'upload').replace(/[^\w\u4e00-\u9fa5-]/g, '_');
  const cloudPath = S.st.prefix + base + '-' + Date.now() + ext;
  if (!confirm('上传到：\n' + cloudPath + '\n\n确认？')) return false;
  const lbl = $('#stUploadLbl');
  if (lbl.textContent !== '上传文件') return false; // 防重复上传
  lbl.textContent = '上传中…';
  try {
    // 统一走 common 的 api 封装（自动追加 env 参数、统一错误提示）
    const data = await apiUpload('/api/storage/upload?cloudPath=' + encodeURIComponent(cloudPath), file);
    toast('已上传：' + (data.fileID || cloudPath), 'ok');
    return true;
  } catch (e) { toast('上传失败：' + e.message, 'err'); return false; }
  finally { lbl.textContent = '上传文件'; }
}
async function uploadToCurrent() {
  const input = $('#stUploadFile');
  const file = input.files && input.files[0];
  input.value = '';
  if (!file) return;
  if (await uploadOneFile(file)) loadStorage();
}

// ---------- 模块导出 ----------
// ---------- 存储 ACL（权限） ----------
// 五档：READONLY 只读 / PRIVATE 私有 / ADMINWRITE 管理写 / ADMINONLY 仅管理 / CUSTOM 自定义规则
const ACL_PRESETS = [
  { v: 'READONLY', t: '只读（READONLY）· 所有用户可读，仅创建者和管理员可写' },
  { v: 'PRIVATE', t: '私有（PRIVATE）· 仅创建者及管理员可读写' },
  { v: 'ADMINWRITE', t: '管理写（ADMINWRITE）· 所有用户可读，仅管理员可写' },
  { v: 'ADMINONLY', t: '仅管理（ADMINONLY）· 仅管理员可读写' },
  { v: 'CUSTOM', t: '自定义（CUSTOM）· 按安全规则表达式' }
];
let _aclSeq = 0;

async function loadStorageAcl() {
  const box = $('#stAclBox');
  if (!box) return;
  const seq = ++_aclSeq;
  box.innerHTML = '<span class="muted">读取中…</span>';
  try {
    const r = await apiGet('/api/storage/acl');
    if (seq !== _aclSeq) return;
    renderStorageAcl(r.acl || '', r.rule || null);
  } catch (e) {
    if (seq !== _aclSeq) return;
    box.innerHTML = '<span class="muted">读取失败：' + esc(e.message) + '</span>';
  }
}

function renderStorageAcl(acl, rule) {
  const box = $('#stAclBox');
  const presetOpts = ACL_PRESETS.map(p =>
    '<option value="' + p.v + '"' + (p.v === acl ? ' selected' : '') + '>' + esc(p.t) + '</option>').join('');
  const isCustom = acl === 'CUSTOM';
  // 规则解析：rule 为 {read, write} 两字段（各为 boolean 或表达式字符串）
  let readV = '', writeV = '';
  if (rule && typeof rule === 'object') {
    readV = rule.read == null ? '' : (typeof rule.read === 'boolean' ? String(rule.read) : String(rule.read));
    writeV = rule.write == null ? '' : (typeof rule.write === 'boolean' ? String(rule.write) : String(rule.write));
  }
  box.innerHTML =
    '<div class="panel" style="margin:0 0 16px;padding:14px 16px">' +
      '<div class="pagehead" style="margin:0 0 12px"><div><h2 style="margin:0">存储权限（ACL）</h2>' +
      '<div class="sub">环境级云存储读写权限 · 影响当前环境全部文件的应用端访问</div></div></div>' +
      '<p class="hint">READONLY / PRIVATE / ADMINWRITE / ADMINONLY 是整个环境的默认权限。平台没有独立的目录 ACL；需要按敏感目录细分时，选择 CUSTOM 并在规则中加入 <code>resource.path</code> 条件。</p>' +

      '<h2 class="sect">权限设置<span class="ln"></span></h2>' +
      '<div style="display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap">' +
        '<label class="fld" style="margin:0;min-width:340px"><span>权限预设</span><select id="stAclSel" style="width:100%">' + presetOpts + '</select></label>' +
        '<button class="btn sm" id="stAclSave">保存权限</button>' +
      '</div>' +
      '<div id="stAclRuleWrap" style="display:' + (isCustom ? 'block' : 'none') + ';margin-top:12px">' +
        '<label class="fld" style="margin:0"><span>read 规则表达式</span>' +
          '<textarea class="code" id="stAclRead" style="width:100%;min-height:56px;font-size:12px" spellcheck="false" placeholder="true / false 或 如 resource.openid == auth.uid">' + esc(readV) + '</textarea>' +
          '<span class="fdesc">true=恒允许 · false=恒拒绝 · 其余为安全规则表达式</span></label>' +
        '<label class="fld" style="margin:8px 0 0"><span>write 规则表达式</span>' +
          '<textarea class="code" id="stAclWrite" style="width:100%;min-height:56px;font-size:12px" spellcheck="false" placeholder="true / false 或 如 resource.openid == auth.uid">' + esc(writeV) + '</textarea>' +
          '<span class="fdesc">可引用 <code>auth.uid</code> / <code>resource.openid</code> / <code>resource.path</code> 等。示例：<code>/^private\\//.test(resource.path) &amp;&amp; resource.openid == auth.uid</code></span></label>' +
        '<p class="hint" style="margin:8px 0 0">CUSTOM 会替代上方预设，read 和 write 是覆盖整个环境的完整规则，不是单独的目录覆盖。设置路径条件时，请同时考虑其他路径的访问策略；保存前检查规则，避免误开放文件。</p>' +
      '</div>' +
    '</div>';
  $('#stAclSel').addEventListener('change', function () {
    $('#stAclRuleWrap').style.display = this.value === 'CUSTOM' ? 'block' : 'none';
  });
  $('#stAclSave').addEventListener('click', saveStorageAcl);
}

async function saveStorageAcl() {
  const acl = $('#stAclSel').value;
  const body = { acl };
  if (acl === 'CUSTOM') {
    const read = $('#stAclRead').value.trim();
    const write = $('#stAclWrite').value.trim();
    if (!read || !write) return toast('自定义规则须填写 read 与 write', 'err');
    body.rule = { read: parseAclVal(read), write: parseAclVal(write) };
  }
  if (!confirm('确认将环境存储权限改为 ' + acl + ' ？此操作影响整个环境的文件读写。')) return;
  const btn = $('#stAclSave'); btn.disabled = true; btn.textContent = '保存中…';
  try {
    await apiPut('/api/storage/acl', body);
    toast('存储权限已保存', 'ok');
    loadStorageAcl();
  } catch (e) {
    toast('保存失败：' + e.message, 'err');
    btn.disabled = false; btn.textContent = '保存权限';
  }
}

// read/write 值解析：true / false 字符串转布尔，其余原样作为表达式
function parseAclVal(v) {
  if (v === 'true') return true;
  if (v === 'false') return false;
  return v;
}

export {
  isImage, setStView, setStSort, loadAllFiles, loadStorage, renderStorage, renderPager, stGoPage, resolveUrls, resolveUrl, previewFile,
  scanDirs, deleteSelected, delFileOne, uploadOneFile, uploadToCurrent, selectAllPage,
  clearSel, resetStorage, resetDeleteBtn, hideBatchBar, clearUrlCache, ST_VIEW_KEY,
  loadStorageAcl
};
