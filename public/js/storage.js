/* 云端数据管理台 —— 云存储 Tab
   目录浏览（图标面包屑）、图片缩略图（批量临时链接 + 缓存）、文件类型图标、
   目录内筛选/排序、悬停单删、文件预览、多选删除、单文件/拖拽上传、子目录扫描聚合。 */
'use strict';

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
// 当前筛选后的文件列表
function stFiltered() {
  const kw = (S.st.filter || '').trim().toLowerCase();
  let files = S.st.files;
  if (kw) files = files.filter(f => f.name.toLowerCase().includes(kw));
  if (S.st.sort === 'size') files = files.slice().sort((a, b) => (b.size || 0) - (a.size || 0));
  else if (S.st.sort === 'date') files = files.slice().sort((a, b) => (b.lastModified || 0) - (a.lastModified || 0));
  else files = files.slice().sort((a, b) => a.name.localeCompare(b.name, 'zh'));
  return files;
}

async function loadStorage() {
  stSel = new Set();
  const loading = $('#stLoading'), body = $('#stBody');
  loading.style.display = ''; body.style.display = 'none';
  $('#stScanPanel').style.display = 'none';
  hideBatchBar(); // 目录切换即失效的选中态，同步收起批量操作条
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
  const { dirs } = S.st;
  const files = stFiltered();
  renderStats(dirs, files);
  if (!dirs.length && !files.length) {
    grid.innerHTML = '<div class="empty">' + (S.st.filter ? '（无匹配文件，请调整筛选条件）' : '（此目录为空）') + '</div>';
    updateSelCount();
    return;
  }
  const MAX_RENDER = 800; // 单层文件过多时限制 DOM 量，防止万级文件冻结页面
  const shown = files.slice(0, MAX_RENDER);
  const listMode = stView === 'list';
  dirs.forEach(d => {
    const name = d.replace(/\/+$/, '').split('/').filter(Boolean).pop() || '目录';
    const it = document.createElement('div'); it.className = 'fitem dir' + (listMode ? ' row' : '');
    it.innerHTML = '<div class="thumb">' + ic('folderOpen') + '</div><div class="nm">' + esc(name) + '</div><div class="meta">目录</div>';
    it.addEventListener('click', () => { S.st.prefix = d; loadStorage(); });
    grid.appendChild(it);
  });
  shown.forEach(f => {
    const base = f.name.split('/').pop();
    const it = document.createElement('div'); it.className = 'fitem' + (listMode ? ' row' : '');
    it.dataset.path = f.name;
    const thumb = document.createElement('div'); thumb.className = 'thumb';
    if (isImage(f.name)) { thumb.innerHTML = '<span class="spin"></span>'; }
    else thumb.innerHTML = ic(fileIcon(f.name));
    const nm = document.createElement('div'); nm.className = 'nm'; nm.textContent = base;
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
          img.addEventListener('error', () => { th.innerHTML = ic('file'); }); // 链接失效时兜底，不整块消失
          th.innerHTML = ''; th.appendChild(img);
        } else if (th.querySelector('.spin')) th.innerHTML = ic('image'); // 取 URL 失败：spinner 转成占位，不永久转圈
      });
    });
  }
  updateSelCount();
}

// 目录统计行：N 个目录 · M 个文件 · 合计大小（仅统计当前目录直属项，不含子目录聚合）
function renderStats(dirs, files) {
  const el = $('#stStats');
  if (!el) return;
  if (!dirs.length && !files.length) { el.innerHTML = ''; return; }
  const totalSize = files.reduce((s, f) => s + (f.size || 0), 0);
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
  if (stSel.size > 0) showBatchBar(); else hideBatchBar();
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
    return apiGet('/api/storage/urls?' + p.toString()).then(r => r.urls || {}).catch(() => ({}));
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
  try {
    // 每批 50 个串行删除，汇总真实删除数（旧实现后端静默截断 50 个但前端报全量，数据不一致）
    for (let i = 0; i < arr.length; i += 50) {
      const r = await apiPost('/api/storage/delete', { fileIDs: arr.slice(i, i + 50) });
      ok += (r && r.deleted) || 0;
    }
    toast('已删除 ' + ok + ' 个文件', 'ok');
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
  if (!S.st.files.some(f => f.name === path)) return;
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
    const envParam = S.env ? '&env=' + encodeURIComponent(S.env) : '';
    const resp = await fetch('/api/storage/upload?cloudPath=' + encodeURIComponent(cloudPath) + envParam, { method: 'POST', body: file });
    let data = null; try { data = await resp.json(); } catch (e) {}
    if (!resp.ok) throw new Error((data && data.error) || ('HTTP ' + resp.status));
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
