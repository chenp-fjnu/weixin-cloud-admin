/* 云端数据管理台 —— 云数据库 Tab + 文档查看/编辑模态框
   集合下拉、分页/筛选/排序、表格渲染（业务字段 + 行点击 + cloud:// 图片批量临时链接）、文档 CRUD。
   openCollection 供概览卡片点击跳转调用（见 overview.js）。 */
'use strict';

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
    const r = await apiGet('/api/collections');
    names = r.collections || [];
  } catch (e) { /* 兜底用已知集合 */ }
  if (!names || !names.length) names = KNOWN_COLS;
  sel.innerHTML = '';
  names.forEach(n => { const o = document.createElement('option'); o.value = n; o.textContent = n; sel.appendChild(o); });
  if (!names.length) {
    sel.innerHTML = '<option value="">（该环境暂无集合）</option>';
  }
}

async function openCollection(name) {
  // 手动切换 Tab UI（不经过 switchTab，避免其内部 fire-and-forget 的 initDb 与此处产生竞态）
  setNav('db');

  // 确保集合列表加载完毕后再设置值（loadCollections 会重建 <select>，必须先等它完成）
  if (!dbInited) {
    dbInited = true;
    await loadCollections();
  }

  const sel = $('#dbCollection');
  if (!Array.from(sel.options).some(o => o.value === name)) {
    const o = document.createElement('option'); o.value = name; o.textContent = name; sel.appendChild(o);
  }
  sel.value = name;
  S.db.collection = name;
  S.db.page = 1;
  await loadDb();
}

async function loadDb() {
  const name = S.db.collection;
  if (!name) {
    $('#dbBody').innerHTML = '<tr><td colspan="15" class="empty">请先选择集合</td></tr>';
    return;
  }
  // 加载骨架屏：按上一轮列数（无则 6 列）生成微光占位行，避免空白跳变
  const body = $('#dbBody');
  body.innerHTML = dbSkeletonRows();
  $('#dbPageInfo').textContent = '加载中…';
  $('#dbCount').textContent = '加载中…';
  // 排序：用户显式选了字段 → 用所选 + 所选方向；否则（「默认」）→ 自动按时间字段倒序
  const auto = pickTimeField(S.db.fieldsSet);
  const sort = S.db.sort || auto || '';
  const sortDir = S.db.sortDir;
  const p = new URLSearchParams({ name, page: S.db.page, size: S.db.size });
  if (S.db.q && S.db.field) { p.set('field', S.db.field); p.set('q', S.db.q); }
  if (sort) { p.set('sort', sort); p.set('sortDir', sortDir); }
  const seq = ++dbSeq;
  try {
    const r = await apiGet('/api/collection?' + p.toString());
    if (seq !== dbSeq) return; // 已有更新的请求，丢弃本次过期响应
    S.db.total = r.total; S.db.docs = r.docs;
    fillDbFields(r.docs);
    // 首屏：本页已能识别时间字段，而本次请求未带默认排序（auto 尚为空）→ 重查一次以按时间倒序
    const nowAuto = pickTimeField(S.db.fieldsSet);
    if (!S.db.sort && nowAuto && auto !== nowAuto) { loadDb(); return; }
    // 方向下拉反映本次生效的排序方向；默认（自动）模式下置灰，仅手动选字段后可切换
    const dirEl = $('#dbSortDir'); if (dirEl) { dirEl.value = sortDir; dirEl.disabled = !S.db.sort; }
    renderDbTable();
  } catch (e) {
    if (seq !== dbSeq) return;
    body.innerHTML = '<tr><td colspan="15" class="empty">加载失败：' + esc(e.message) + '</td></tr>';
  }
}

// 加载骨架行：列宽伪随机，避免整齐划一；列数跟随上一轮实际列数（上限 8 列防过宽）
function dbSkeletonRows() {
  const nCols = Math.max(3, Math.min(8, (S.db.cols && S.db.cols.length) || 6));
  let rows = '';
  for (let r = 0; r < 6; r++) {
    let tds = '';
    for (let c = 0; c < nCols; c++) {
      const w = 38 + ((r * 17 + c * 29) % 58);
      tds += '<td class="val"><span class="skl" style="height:11px;width:' + w + '%"></span></td>';
    }
    tds += '<td class="opcell"><span class="skl" style="height:11px;width:104px"></span></td>';
    rows += '<tr class="skltr">' + tds + '</tr>';
  }
  return rows;
}

// 点击列头排序：同列再次点击切换方向，其余情况按该列降序；回到第 1 页并同步排序下拉
function sortByCol(col) {
  if (S.db.sort === col) S.db.sortDir = S.db.sortDir === 'asc' ? 'desc' : 'asc';
  else { S.db.sort = col; S.db.sortDir = 'desc'; }
  S.db.page = 1;
  const sortSel = $('#dbSort');
  if (sortSel) sortSel.value = col; // 选项由 fillDbFields 在响应后按 fieldsSet 重建并回填
  const dirEl = $('#dbSortDir');
  if (dirEl) dirEl.value = S.db.sortDir;
  loadDb();
}

// 筛选 / 排序状态 chip：当前生效的筛选与显式排序一目了然，× 可一键清除单项
function renderDbChips() {
  const box = $('#dbChips');
  if (!box) return;
  box.innerHTML = '';
  const mk = (text, onX) => {
    const c = document.createElement('span');
    c.className = 'chip';
    const t = document.createElement('span'); t.className = 'ct'; t.textContent = text;
    const x = document.createElement('button'); x.className = 'cx'; x.textContent = '×'; x.title = '清除';
    x.addEventListener('click', () => onX());
    c.append(t, x);
    box.appendChild(c);
  };
  if (S.db.q && S.db.field) {
    mk('筛选 · ' + S.db.field + ' 匹配 ' + S.db.q, () => {
      S.db.q = ''; S.db.field = ''; S.db.page = 1;
      $('#dbQuery').value = ''; $('#dbField').value = '';
      loadDb();
    });
  }
  if (S.db.sort) {
    mk('排序 · ' + S.db.sort + '（' + (S.db.sortDir === 'asc' ? '升序' : '降序') + '）', () => {
      S.db.sort = ''; S.db.sortDir = 'desc';
      const sel = $('#dbSort'); if (sel) sel.value = '';
      const dirEl = $('#dbSortDir'); if (dirEl) dirEl.value = 'desc';
      loadDb();
    });
  }
  box.style.display = box.children.length ? 'flex' : 'none';
}

// 字段并集跨页累积（S.db.fieldsSet），让「筛选字段」「排序字段」下拉不因翻页丢项。
// 系统/内部字段（_id、_openid 等）不进入下拉，也不进表格列。
function fillDbFields(docs) {
  const f = $('#dbField'), sortSel = $('#dbSort');
  if (!S.db.fieldsSet) S.db.fieldsSet = new Set();
  docs.forEach(d => Object.keys(d).forEach(k => { if (!isSystemField(k)) S.db.fieldsSet.add(k); }));
  const fields = Array.from(S.db.fieldsSet);
  const prevField = f.value;
  f.innerHTML = '<option value="">（全字段）</option>';
  sortSel.innerHTML = '<option value="">默认（时间倒序）</option>';
  fields.forEach(k => {
    const o1 = document.createElement('option'); o1.value = k; o1.textContent = k; f.appendChild(o1);
    const o2 = document.createElement('option'); o2.value = k; o2.textContent = k; sortSel.appendChild(o2);
  });
  if (prevField && S.db.fieldsSet.has(prevField)) f.value = prevField;
  // 排序下拉：保留用户显式选择；未显式选（值为空）时回落到「默认」
  if (S.db.sort && S.db.fieldsSet.has(S.db.sort)) sortSel.value = S.db.sort;
  else sortSel.value = '';
}

// 系统/内部字段：以下划线开头（_id、_openid 等），不进筛选/排序下拉（_id 单独作为只读列展示）
function isSystemField(k) { return typeof k === 'string' && k.indexOf('_') === 0; }
// 从字段并集里挑出最可能的「时间」字段，用于默认排序；找不到返回 ''
// 入参兼容数组与 Set（S.db.fieldsSet 运行时是 Set，Set 无 indexOf，须先归一化）
function pickTimeField(fields) {
  const keys = Array.isArray(fields) ? fields : (fields && fields instanceof Set ? Array.from(fields) : []);
  const pref = ['createdAt', 'createTime', 'created_at', 'create_time', 'updatedAt', 'updateTime',
    'updated_at', 'update_time', 'time', 'timestamp', 'date', 'publishTime', 'publishAt', 'created'];
  for (let i = 0; i < pref.length; i++) if (keys.indexOf(pref[i]) >= 0) return pref[i];
  for (let i = 0; i < keys.length; i++) if (!isSystemField(keys[i]) && isTimeField(keys[i])) return keys[i];
  return '';
}

// 表格列：排除系统字段，按当前页首次出现顺序动态生成
function fieldColumns(docs) {
  const cols = [];
  const seen = new Set();
  docs.forEach(d => Object.keys(d).forEach(k => {
    if (isSystemField(k)) return;
    if (!seen.has(k)) { seen.add(k); cols.push(k); }
  }));
  return cols;
}
function cellText(col, v) {
  if (v === null || v === undefined) return '';
  // 时间值优先格式化为可读时间（ISO 字符串 / 时间语义字段的秒级 / 毫秒级时间戳）
  const time = fmtTimeValue(col, v);
  if (time) return time;
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
  if (field === 'deleted' && value === true) return '<span class="pill" style="background:var(--danger-bg);color:var(--danger)">已删</span>';
  return null;
}

function renderDbTable() {
  S.db.cols = fieldColumns(S.db.docs);
  const totalCols = S.db.cols.length + 1; // 操作列
  renderDbChips();
  // 页头副标题：文档总数
  $('#dbCount').textContent = S.db.docs.length ? ('共 ' + fmtNum(S.db.total) + ' 条文档 · 当前集合 ' + S.db.collection) : ('集合 ' + S.db.collection + ' 无文档');
  // 动态表头：业务字段（已剔除 _id / _openid 等系统字段）+ 操作
  // 列头可点击排序：当前排序列高亮并显示方向箭头（▲ 升序 / ▼ 降序）
  const effSort = S.db.sort || pickTimeField(S.db.fieldsSet) || '';
  const effDir = S.db.sortDir;
  $('#dbHead').innerHTML = S.db.cols.map(c => {
    const on = effSort === c;
    const arrow = on ? (effDir === 'asc' ? '▲' : '▼') : ''; // ▲ 升序 / ▼ 降序
    return '<th class="sortable' + (on ? ' on' : '') + '" data-col="' + esc(c) + '" title="点击按 ' + esc(c) + ' 排序">' +
      esc(c) + '<span class="sar">' + arrow + '</span></th>';
  }).join('') + '<th class="opcell">操作</th>';
  $$('#dbHead th.sortable').forEach(th => th.addEventListener('click', () => sortByCol(th.dataset.col)));
  const body = $('#dbBody'); body.innerHTML = '';
  if (!S.db.docs.length) {
    body.innerHTML = '<tr><td colspan="' + totalCols + '" class="empty">（空集合或无匹配）</td></tr>';
    updatePager(0);
    return;
  }
  // 先收集本页所有 cloud:// 图片，渲染后一次性批量取临时链接（每格单发 → 一次批量）
  const imgRels = [];
  S.db.docs.forEach(d => {
    const tr = document.createElement('tr');
    S.db.cols.forEach(col => {
      const td = document.createElement('td');
      const pill = pillFor(col, d[col]);
      if (pill) { td.innerHTML = pill; }
      else if (typeof d[col] === 'string' && /^cloud:\/\//.test(d[col]) && isImage(d[col])) {
        // cloud:// 图片（如 imageId）→ 缩略图，本页图片统一批量取临时链接后填充
        td.title = d[col];
        td.innerHTML = '<span class="spin"></span>';
        const rel = d[col].replace(/^cloud:\/\/[^/]+\//i, '');
        td.dataset.rel = rel;
        imgRels.push(rel);
      }
      else {
        const t = cellText(col, d[col]);
        td.className = 'val'; td.textContent = t;
        if (t) td.title = t; else td.innerHTML = '<span class="muted">—</span>';
      }
      tr.appendChild(td);
    });
    const opCell = document.createElement('td');
    opCell.className = 'opcell';
    const bView = mkBtn('查看', () => openDoc(d._id), 'ghost');
    const bEdit = mkBtn('编辑', () => openDoc(d._id, true), 'ghost');
    const bDel = mkBtn('删除', () => delDoc(d._id), 'danger ghost'); bDel.title = '删除该文档';
    opCell.append(bView, bEdit, bDel);
    tr.appendChild(opCell);
    // 行点击 → 查看文档；操作列点击不冒泡
    tr.addEventListener('click', (e) => {
      if (opCell.contains(e.target)) return;
      openDoc(d._id);
    });
    body.appendChild(tr);
  });
  // 分页信息
  const pages = Math.max(1, Math.ceil(S.db.total / S.db.size));
  updatePager(pages);
  $('#dbPageInfo').textContent = '第 ' + S.db.page + ' / ' + pages + ' 页 · 共 ' + fmtNum(S.db.total) + ' 条';
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
          img.addEventListener('click', (e) => { e.stopPropagation(); previewFile({ name: td.dataset.rel }); });
          td.appendChild(img);
        } else td.innerHTML = '<span class="muted">—</span>';
      });
    });
  }
}
function updatePager(pages) {
  $('#dbPrev').disabled = S.db.page <= 1;
  $('#dbNext').disabled = pages ? S.db.page >= pages : true;
  const go = $('#dbPageGo'); if (go) go.max = pages; // 页码跳转输入框的范围提示
}
let _imgTok = 0; // 表格重渲染令牌：丢弃上一批未完成的图片 URL 填充

function mkBtn(label, fn, cls) {
  const b = document.createElement('button');
  b.className = 'btn sm' + (cls ? ' ' + cls : '');
  b.textContent = label;
  b.addEventListener('click', fn);
  return b;
}

// ---------- JSON 语法高亮 ----------
function highlightJson(text) {
  // 先转义 HTML，再用正则给 token 上色（字符串、键、数字、布尔、null）
  const s = esc(text);
  return s.replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false)\b|\bnull\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
    (match) => {
      let cls = 'jn';
      if (/^"/.test(match)) cls = /:\s*$/.test(match) ? 'jk' : 'js';
      else if (/true|false/.test(match)) cls = 'jb';
      else if (/null/.test(match)) cls = 'jnull';
      return '<span class="' + cls + '">' + match + '</span>';
    }
  );
}

// ---------- 文档查看 / 编辑 / 删除 ----------
let _editing = null; // { name, id }
let _editOrig = ''; // 打开（或进入编辑）时的原始文本，用于未保存检测
function setDocMode(edit) {
  const ta = $('#docText'), pre = $('#docPre');
  if (edit) {
    pre.style.display = 'none';
    ta.style.display = '';
    ta.readOnly = false;
  } else {
    pre.innerHTML = highlightJson(ta.value);
    pre.style.display = '';
    ta.style.display = 'none';
    ta.readOnly = true;
  }
  $('#docEdit').style.display = edit ? 'none' : '';
  $('#docSave').style.display = edit ? '' : 'none';
  // 进入编辑时记录基准文本
  if (edit) _editOrig = ta.value;
  updateDirty();
}
function updateDirty() {
  const d = !!_editing && $('#docMask').classList.contains('show') && $('#docText').value !== _editOrig;
  $('#docDirty').classList.toggle('show', d);
}
function docDirty() {
  return !!_editing && $('#docMask').classList.contains('show') && $('#docText').value !== _editOrig;
}
async function openDoc(id, edit) {
  const name = S.db.collection;
  let doc;
  try { doc = (await apiGet('/api/doc?' + new URLSearchParams({ name, id }))).doc; }
  catch (e) { return toast('读取文档失败：' + e.message, 'err'); }
  _editing = { name, id };
  const idShort = id.length > 16 ? id.slice(0, 16) + '…' : id;
  $('#docTitle').textContent = '文档 · ' + name;
  $('#docId').textContent = idShort;
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

function fmtDocBtn(kind) {
  const ta = $('#docText');
  const inEdit = !ta.readOnly;
  try {
    const obj = JSON.parse(ta.value);
    ta.value = JSON.stringify(obj, null, kind === 'fmt' ? 2 : 0);
    if (!inEdit) {
      // 查看态：重新生成高亮 pre
      $('#docPre').innerHTML = highlightJson(ta.value);
    }
    updateDirty();
  } catch (e) { toast('JSON 非法：' + e.message, 'err'); }
}

async function saveDoc() {
  if (!_editing) return;
  let doc;
  try { doc = JSON.parse($('#docText').value); }
  catch (e) { return toast('JSON 非法：' + e.message, 'err'); }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return toast('须为 JSON 对象', 'err');
  const btn = $('#docSave'); btn.disabled = true; btn.textContent = '保存中…';
  try {
    await apiPut('/api/doc?name=' + _editing.name + '&id=' + encodeURIComponent(_editing.id), doc);
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
  apiDelete('/api/doc?name=' + S.db.collection + '&id=' + encodeURIComponent(id))
    .then(() => { toast('已删除', 'ok'); loadDb(); })
    .catch(e => toast('删除失败：' + e.message, 'err'))
    .finally(() => { _delBusy = false; });
}
