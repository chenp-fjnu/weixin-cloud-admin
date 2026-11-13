/* 云端数据管理台 —— 启动与跨 Tab 逻辑
   Tab 切换、连接状态徽章、环境下拉/切换、全部事件绑定、DOMContentLoaded 启动。
   引入顺序须为最后一个：依赖 common/overview/db/storage 已定义的全部全局函数与状态。 */
'use strict';

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

// ---------- 连接状态 & 环境切换 ----------
let _statusTimer = null; // 离线时每 10s 自动重试一次
async function checkStatus() {
  try {
    const s = await apiGet('/api/status');
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
  S.db.sort = ''; S.db.sortDir = 'desc'; S.db.q = ''; S.db.field = ''; S.db.fieldsSet = null;
  const qEl = $('#dbQuery'), sortEl = $('#dbSort'), fieldEl = $('#dbField'), sortDirEl = $('#dbSortDir');
  if (qEl) qEl.value = '';
  if (sortEl) sortEl.value = '';
  if (fieldEl) fieldEl.value = '';
  if (sortDirEl) sortDirEl.value = 'desc';
  S.st.prefix = ''; S.st.loadedAt = 0; stSel = new Set();
  loadOverview();
  const tab = S.activeTab || 'overview';
  if (tab === 'db') initDb();
  if (tab === 'storage') loadStorage();
  toast('已切换到环境 ' + envId, 'ok');
}

// ---------- 事件绑定 ----------
function bindEvents() {
  // Tab 切换
  $$('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));

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
    S.db.fieldsSet = null; S.db.q = ''; S.db.field = ''; S.db.sort = ''; S.db.sortDir = 'desc';
    $('#dbQuery').value = ''; $('#dbSort').value = ''; $('#dbSortDir').value = 'desc';
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
      const res = await apiPost('/api/collection?name=' + encodeURIComponent(S.db.collection), {});
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
    // prefix 形如 'a/b/'（结尾必有 /）。先去掉结尾 /，再截掉最后一段，保留的段补回 /
    const p = S.st.prefix.replace(/\/+$/, '');
    const i = p.lastIndexOf('/');
    S.st.prefix = i < 0 ? '' : p.slice(0, i + 1);
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

// ---------- 启动 ----------
document.addEventListener('DOMContentLoaded', function () {
  bindEvents();
  checkStatus();
  loadOverview();
});
