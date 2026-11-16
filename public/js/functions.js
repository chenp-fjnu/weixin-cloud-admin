/* 云端数据管理台 —— 云函数 Tab（ES Module）
   云函数列表、详情、运行时配置、调用（含日志/结果）、定时触发器增删、删除函数。
   触发器列举经服务端 scfService('scf') 的 ListTriggers 透传（SDK 无 getFunctionTriggers）。 */

import { $, $$, toast, apiGet, apiPost, apiDelete, S, esc, fmtDate } from './common.js';

let fnInited = false;
let fnSeq = 0; // 请求序号：切环境 / 快速刷新时丢弃过期响应
let _fnSelected = ''; // 当前展开详情的函数名
const _busy = new Set(); // 防重复提交的函数名

// 切环境时由 main.js 调用：复位状态并使在途请求过期
export function resetFunctions() {
  fnInited = false;
  fnSeq++;
  _fnSelected = '';
  const d = $('#fnDetail'); if (d) d.innerHTML = '';
  const body = $('#fnBody'); if (body) body.style.display = 'none';
}

export async function initFunctions() {
  if (!fnInited) { fnInited = true; }
  await loadFunctions();
}

export async function loadFunctions() {
  const loading = $('#fnLoading'), body = $('#fnBody');
  if (loading) { loading.style.display = ''; }
  if (body) body.style.display = 'none';
  const d = $('#fnDetail'); if (d) d.innerHTML = '';
  _fnSelected = '';
  const seq = ++fnSeq;
  try {
    const r = await apiGet('/api/functions');
    if (seq !== fnSeq) return;
    const list = (r.functions || []).map(f => f.name).filter(Boolean);
    if (body) body.style.display = '';
    if (loading) loading.style.display = 'none';
    const tb = $('#fnListBody');
    tb.innerHTML = '';
    if (!list.length) {
      tb.innerHTML = '<tr><td colspan="4" class="empty">（该环境暂无云函数）</td></tr>';
      return;
    }
    list.forEach(name => {
      const tr = document.createElement('tr');
      tr.addEventListener('click', () => openFnDetail(name));
      const nameTd = document.createElement('td');
      nameTd.className = 'val mono';
      nameTd.textContent = name;
      tr.appendChild(nameTd);
      const stTd = document.createElement('td');
      stTd.innerHTML = '<span class="pill inv">—</span>';
      tr.appendChild(stTd);
      const tmTd = document.createElement('td');
      tmTd.className = 'val';
      tmTd.innerHTML = '<span class="muted">—</span>';
      tr.appendChild(tmTd);
      const opTd = document.createElement('td');
      opTd.className = 'opcell';
      const bDetail = mkBtn('详情', (e) => { e.stopPropagation(); openFnDetail(name); }, 'ghost');
      const bInv = mkBtn('调用', (e) => { e.stopPropagation(); openFnDetail(name); }, 'ghost');
      const bDel = mkBtn('删除', (e) => { e.stopPropagation(); delFn(name); }, 'danger ghost');
      bDel.title = '删除该云函数';
      opTd.append(bDetail, bInv, bDel);
      tr.appendChild(opTd);
      tb.appendChild(tr);
    });
  } catch (e) {
    if (seq !== fnSeq) return;
    if (loading) loading.style.display = '';
    loading.innerHTML = '<span>加载失败：' + esc(e.message) + '</span>';
  }
}

// ---------- 函数详情 / 配置 / 调用 / 触发器 ----------
async function openFnDetail(name) {
  const seq = ++fnSeq;
  _fnSelected = name;
  const d = $('#fnDetail');
  if (d) d.innerHTML = '<div class="empty" style="padding:24px"><span class="spin"></span> 正在读取函数详情…</div>';
  let r;
  try { r = await apiGet('/api/function?name=' + encodeURIComponent(name)); }
  catch (e) {
    if (d) d.innerHTML = '<div class="empty" style="padding:24px">加载详情失败：' + esc(e.message) + '</div>';
    return;
  }
  if (seq !== fnSeq) return;
  renderFnDetail(r.info, r.triggers || []);
}

function renderFnDetail(info, triggers) {
  const d = $('#fnDetail');
  const trig = (triggers || []).map(t =>
    '<tr><td class="val mono">' + esc(t.name) + '</td><td class="val">' + esc(t.type || '') + '</td><td class="val mono">' + esc(t.config || '') + '</td>' +
    '<td class="opcell"><button class="btn sm danger ghost" data-del-trig="' + esc(t.name) + '" title="删除触发器">删除</button></td></tr>'
  ).join('');
  const trigRow = triggers && triggers.length
    ? trig
    : '<tr><td colspan="4" class="empty">（无触发器）</td></tr>';
  const envRows = (info.envVariables || []).map(v =>
    '<tr><td class="val mono">' + esc(v.key) + '</td><td class="val mono">' + esc(v.value) + '</td></tr>'
  ).join('') || '<tr><td colspan="2" class="empty">（无环境变量）</td></tr>';

  d.innerHTML =
    '<div class="panel" style="margin-top:0">' +
      '<div class="pagehead" style="margin:0 0 14px">' +
        '<div><h2 style="margin:0">' + esc(info.name) + '</h2>' +
        '<div class="sub mono">' + esc(info.runtime) + ' · handler ' + esc(info.handler) + '</div></div>' +
        '<div class="acts"><span class="pill ' + (info.status === 'Active' ? 'pub' : 'inv') + '">' + esc(info.status || '—') + '</span></div>' +
      '</div>' +

      '<h2 class="sect">基础信息<span class="ln"></span></h2>' +
      '<div class="grid cards">' +
        card('超时', info.timeout + ' s') +
        card('内存', (info.memory || 0) + ' MB') +
        card('角色', info.role || '—', true) +
        card('创建', fmtDate(info.addTime) || '—') +
      '</div>' +
      (info.description ? '<p class="hint" style="margin-top:10px">描述：' + esc(info.description) + '</p>' : '') +

      '<h2 class="sect" style="margin-top:18px">配置调整<span class="ln"></span></h2>' +
      '<div style="display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap">' +
        '<label class="fld" style="margin:0;width:140px"><span>超时（秒）</span><input type="number" id="fnCfgTimeout" min="1" max="86400" value="' + (info.timeout || 3) + '" /></label>' +
        '<label class="fld" style="margin:0;width:140px"><span>内存（MB）</span><input type="number" id="fnCfgMem" min="128" step="64" value="' + (info.memory || 256) + '" /></label>' +
        '<button class="btn sm" id="fnCfgSave">保存配置</button>' +
      '</div>' +

      '<h2 class="sect" style="margin-top:18px">环境变量<span class="ln"></span></h2>' +
      '<div class="tblwrap" style="max-height:220px"><table><thead><tr><th>KEY</th><th>VALUE</th></tr></thead><tbody>' + envRows + '</tbody></table></div>' +

      '<h2 class="sect" style="margin-top:18px">触发器<span class="ln"></span></h2>' +
      '<div class="tblwrap" style="max-height:200px"><table><thead><tr><th style="width:24%">名称</th><th style="width:12%">类型</th><th>配置（cron）</th><th class="opcell">操作</th></tr></thead><tbody>' + trigRow + '</tbody></table></div>' +
      '<div style="display:flex;gap:10px;align-items:flex-end;margin-top:10px;flex-wrap:wrap">' +
        '<label class="fld" style="margin:0;width:150px"><span>触发器名</span><input type="text" id="fnTrigName" class="mono" placeholder="如 timer-x" /></label>' +
        '<label class="fld" style="margin:0;width:180px"><span>cron 表达式</span><input type="text" id="fnTrigCfg" class="mono" placeholder="0 0 * * * *" /></label>' +
        '<button class="btn sm" id="fnTrigAdd">添加定时触发器</button>' +
      '</div>' +

      '<h2 class="sect" style="margin-top:18px">调用<span class="ln"></span></h2>' +
      '<textarea class="code" id="fnInvokeBody" style="width:100%;min-height:88px;font-size:12.5px" spellcheck="false">{}</textarea>' +
      '<div style="display:flex;gap:10px;align-items:center;margin-top:10px;flex-wrap:wrap">' +
        '<button class="btn pri sm" id="fnInvokeBtn">调用函数</button>' +
        '<span class="hint">传入 JSON 作为调用参数；结果 / 日志 / 耗时显示在下方。此操作会真实执行函数代码。</span>' +
      '</div>' +
      '<div id="fnInvokeOut" style="margin-top:10px"></div>' +
    '</div>';

  $('#fnCfgSave').addEventListener('click', saveFnConfig);
  $('#fnTrigAdd').addEventListener('click', addFnTrigger);
  $$('#fnDetail [data-del-trig]').forEach(b => b.addEventListener('click', () => delFnTrigger(info.name, b.getAttribute('data-del-trig'))));
  $('#fnInvokeBtn').addEventListener('click', invokeFn);
}

function card(k, v, mono) {
  return '<div class="card"><div class="k">' + esc(k) + '</div><div class="v" style="font-size:' + (mono ? '14px' : '24px') + ';font-family:' + (mono ? 'var(--mono)' : '') + ';word-break:break-all">' + esc(v) + '</div></div>';
}

function saveFnConfig() {
  const name = _fnSelected;
  if (!name) return;
  if (_busy.has('cfg:' + name)) return;
  const timeout = parseInt($('#fnCfgTimeout').value, 10);
  const mem = parseInt($('#fnCfgMem').value, 10);
  const body = {};
  if (Number.isFinite(timeout)) body.timeout = timeout;
  if (Number.isFinite(mem)) body.memorySize = mem;
  if (!Object.keys(body).length) return toast('请修改超时或内存', 'err');
  _busy.add('cfg:' + name);
  const btn = $('#fnCfgSave'); btn.disabled = true; btn.textContent = '保存中…';
  apiPost('/api/function/config?name=' + encodeURIComponent(name), body)
    .then(() => { toast('配置已保存', 'ok'); openFnDetail(name); })
    .catch(e => toast('保存配置失败：' + e.message, 'err'))
    .finally(() => { _busy.delete('cfg:' + name); btn.disabled = false; btn.textContent = '保存配置'; });
}

function addFnTrigger() {
  const name = _fnSelected;
  if (!name) return;
  const tname = $('#fnTrigName').value.trim();
  const cfg = $('#fnTrigCfg').value.trim();
  if (!tname) return toast('请填写触发器名称', 'err');
  if (!cfg) return toast('请填写 cron 表达式', 'err');
  apiPost('/api/function/trigger?name=' + encodeURIComponent(name), { name: tname, type: 'timer', config: cfg })
    .then(() => { toast('触发器已创建', 'ok'); openFnDetail(name); })
    .catch(e => toast('创建触发器失败：' + e.message, 'err'));
}

function delFnTrigger(name, tname) {
  if (!confirm('确认删除触发器 ' + tname + ' ？')) return;
  apiDelete('/api/function/trigger?name=' + encodeURIComponent(name) + '&trigger=' + encodeURIComponent(tname))
    .then(() => { toast('已删除触发器', 'ok'); openFnDetail(name); })
    .catch(e => toast('删除触发器失败：' + e.message, 'err'));
}

function invokeFn() {
  const name = _fnSelected;
  if (!name) return;
  if (_busy.has('inv:' + name)) return;
  let payload;
  try { payload = JSON.parse($('#fnInvokeBody').value || '{}'); }
  catch (e) { return toast('参数须为合法 JSON：' + e.message, 'err'); }
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return toast('参数须为 JSON 对象', 'err');
  _busy.add('inv:' + name);
  const out = $('#fnInvokeOut');
  out.innerHTML = '<div class="empty" style="padding:18px"><span class="spin"></span> 正在调用（真实执行）…</div>';
  apiPost('/api/function/invoke?name=' + encodeURIComponent(name), payload)
    .then(r => {
      const okCls = r.ok ? 'pub' : 'del';
      const okTxt = r.ok ? '成功' : '失败';
      out.innerHTML =
        '<div class="panel" style="margin-top:0;padding:14px 16px">' +
          '<div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap;margin-bottom:8px">' +
            '<span class="pill ' + okCls + '">' + okTxt + '</span>' +
            '<span class="hint">耗时 ' + (r.duration || 0) + ' ms</span>' +
          '</div>' +
          (r.err ? '<div class="hint" style="color:var(--danger);margin-bottom:8px">' + esc(r.err) + '</div>' : '') +
          (r.log ? '<div class="sect" style="margin:10px 0 4px">日志</div><pre class="code" style="white-space:pre-wrap;max-height:200px;overflow:auto;font-size:12px">' + esc(r.log) + '</pre>' : '') +
          '<div class="sect" style="margin:12px 0 4px">结果</div><pre class="code hl" style="white-space:pre-wrap;max-height:260px;overflow:auto;font-size:12px">' + esc(JSON.stringify(r.result, null, 2)) + '</pre>' +
        '</div>';
    })
    .catch(e => { out.innerHTML = '<div class="hint" style="color:var(--danger)">调用失败：' + esc(e.message) + '</div>'; })
    .finally(() => _busy.delete('inv:' + name));
}

function delFn(name) {
  if (!confirm('确认删除云函数 ' + name + ' ？此操作不可撤销。')) return;
  apiDelete('/api/function?name=' + encodeURIComponent(name))
    .then(() => { toast('已删除函数', 'ok'); loadFunctions(); })
    .catch(e => toast('删除失败：' + e.message, 'err'));
}

function mkBtn(label, fn, cls) {
  const b = document.createElement('button');
  b.className = 'btn sm' + (cls ? ' ' + cls : '');
  b.textContent = label;
  b.addEventListener('click', fn);
  return b;
}
