/* 云端数据管理台 —— 环境配置 Tab（ES Module）
   云环境的增 / 删 / 改 / 默认切换 / 凭证连通性测试；全部走 /api/environments*。
   密钥只在浏览器 ↔ 本地服务之间传输，服务端只落盘 config/environments.json（不入 git）。 */

import { $, S, ENV_LS_KEY, apiGet, apiPost, apiPut, apiDelete, toast, esc, ic, showModal, hideModal } from './common.js';
import { checkStatus, switchEnv } from './main.js';
import { closeModals } from './db.js';

const SETTINGS_HINT_URL = 'https://console.cloud.tencent.com/api/v3/secret-key';

function cfgLoading(on, text) {
  const el = $('#cfgLoading');
  if (el) { el.style.display = on ? '' : 'none'; if (text) el.innerHTML = '<span class="spin"></span> ' + esc(text); }
}
function cfgBanner(msg, kind) {
  const b = $('#cfgBanner');
  if (!b) return;
  if (!msg) { b.className = 'banner'; b.innerHTML = ''; return; }
  b.className = 'banner show ' + (kind || 'warn');
  b.innerHTML = ic('warning') + '<span>' + esc(msg) + '</span>';
}

async function loadEnvironments() {
  cfgLoading(true, '正在读取环境列表…');
  try {
    const d = await apiGet('/api/environments');
    renderEnvList(d);
    $('#envRows').style.display = ''; // 成功加载后显示列表（初始为 display:none）
    cfgBanner('');
  } catch (e) {
    cfgBanner('环境列表加载失败：' + e.message, 'err');
  } finally {
    cfgLoading(false);
  }
}

function renderEnvList(d) {
  const box = $('#envRows');
  box.innerHTML = '';
  $('#cfgCount').textContent = '共 ' + d.envs.length + ' 个环境';
  if (!d.envs.length) {
    box.innerHTML = '<div class="empty" style="padding:34px 16px">'
      + ic('cloud') + '<div>尚未配置任何云环境</div><div class="hint">点右上角「新增环境」开始添加（环境 ID 与腾讯云凭证）</div></div>';
    return;
  }
  d.envs.forEach(e => {
    const row = document.createElement('div');
    row.className = 'envrow';
    row.innerHTML =
      '<div class="er-main">'
      + '<div class="er-id mono">' + esc(e.envId)
      + (e.isDefault ? ' <span class="tag">默认</span>' : '') + '</div>'
      + '<div class="er-meta">'
      + (e.hasSecrets
          ? '凭证 ' + esc(e.secretIdMasked || '已配置') + ' · 可用'
          : '<span class="pill del">未配置凭证</span>')
      + '</div></div>'
      + '<div class="er-ops">'
      + (e.isDefault
          ? '<button class="btn sm" data-op="default" disabled>默认环境</button>'
          : '<button class="btn sm" data-op="default" title="设为顶栏默认环境">设默认</button>')
      + '<button class="btn sm" data-op="test" title="用该凭证发起一次轻量调用验证">' + ic('search') + ' 测试</button>'
      + '<button class="btn sm" data-op="edit">' + ic('edit') + ' 编辑</button>'
      + '<button class="btn sm danger" data-op="del">' + ic('trash') + ' 删除</button>'
      + '</div>';
    row.querySelectorAll('button[data-op]').forEach(btn => btn.addEventListener('click', () => {
      const op = btn.dataset.op;
      if (op === 'edit') openEnvModal(e.envId);
      if (op === 'del') removeEnv(e.envId, e.isDefault);
      if (op === 'default') setDefaultEnv(e.envId);
      if (op === 'test') testEnvRow(btn, e.envId);
    }));
    box.appendChild(row);
  });
}

async function removeEnv(envId, isDefault) {
  if (!confirm('确定删除环境「' + envId + '」？\n删除后无法再通过本服务管理该环境（密钥一并移除）。')) return;
  const wasCurrent = S.env === envId;
  try {
    const d = await apiDelete('/api/environments?env=' + encodeURIComponent(envId));
    if (wasCurrent) {
      S.env = ''; // 强制下一轮按新默认环境重解析
      closeModals(true);
      try { localStorage.removeItem(ENV_LS_KEY); } catch (e) { /* ignore */ }
    }
    toast('已删除环境 ' + envId, 'ok');
    await loadEnvironments();
    await checkStatus();
    if (wasCurrent) switchEnv(d.defaultEnvId, true); // 清掉当前 Tab 的旧环境数据
  } catch (e) {
    toast('删除失败：' + e.message, 'err');
  }
}

async function setDefaultEnv(envId) {
  try {
    await apiPut('/api/environments/default', { envId });
    toast('已将 ' + envId + ' 设为默认环境', 'ok');
    await loadEnvironments();
    await checkStatus();
  } catch (e) { toast('设置失败：' + e.message, 'err'); }
}

async function testEnvRow(btn, envId) {
  btn.disabled = true;
  const prev = btn.innerHTML;
  btn.innerHTML = '<span class="spin"></span> 测试中';
  try {
    const d = await apiPost('/api/environments/test', { envId });
    toast(d.ok ? ('「' + envId + '」' + d.message) : ('「' + envId + '」' + d.message), d.ok ? 'ok' : 'err');
  } catch (e) {
    toast('测试失败：' + e.message, 'err');
  } finally {
    btn.disabled = false;
    btn.innerHTML = prev;
  }
}

// ---------- 新增 / 编辑模态框 ----------
let _envModalMode = 'add';
let _envModalCur = ''; // 编辑时的原环境 ID

function openEnvModal(envId) {
  _envModalMode = envId ? 'edit' : 'add';
  _envModalCur = envId || '';
  const m = $('#envModal');
  $('#envModalTitle').textContent = envId ? '编辑环境' : '新增环境';
  $('#envModalId').value = envId || '';
  $('#envModalId').disabled = !!envId;
  $('#envModalId').placeholder = envId ? '' : '如 cloud1-xxxxxxxxxxxx';
  $('#envModalIdHint').style.display = envId ? 'none' : '';
  $('#envModalSid').value = '';
  $('#envModalSid').placeholder = envId ? '留空 = 保持不变（当前已配置）' : 'AKID 开头，如 AKIDxxxxxxxxxxxx';
  $('#envModalSkey').value = '';
  $('#envModalSkey').placeholder = envId ? '留空 = 保持不变' : '与 SecretId 配套的 SecretKey';
  // 「设为默认」勾选框仅在新增时展示（编辑时用行内「设默认」按钮，避免误改）
  $('#envMakeDefaultWrap').style.display = envId ? 'none' : '';
  const md = $('#envMakeDefault');
  md.checked = false;
  md.disabled = false;
  $('#envModalTest').disabled = false;
  $('#envModalMsg').innerHTML = '';
  showModal('envModal');
  if (!envId) $('#envModalId').focus();
}

async function saveEnvModal() {
  const envId = $('#envModalId').value.trim();
  const sid = $('#envModalSid').value.trim();
  const skey = $('#envModalSkey').value.trim();
  const btn = $('#envModalSave');
  const msgEl = $('#envModalMsg');
  msgEl.innerHTML = '';
  if (_envModalMode === 'add') {
    if (!envId) return showEnvMsg('请填入云环境 ID', 'err');
    if (!/^[a-zA-Z0-9_-]{2,64}$/.test(envId)) return showEnvMsg('环境 ID 仅支持字母 / 数字 / _ / -（2-64 位）', 'err');
    if (!sid || !skey) return showEnvMsg('新增环境须同时填入 SecretId 与 SecretKey', 'err');
  } else {
    if (!_envModalCur) return showEnvMsg('内部错误：缺少待编辑环境', 'err');
    if (!sid && !skey) return showEnvMsg('环境 ID 与密钥均未修改，无需保存', 'err');
  }
  btn.disabled = true;
  btn.innerHTML = '<span class="spin"></span> 保存中';
  try {
    const payload = { envId, secretId: sid, secretKey: skey };
    if (_envModalMode === 'add') {
      if ($('#envMakeDefault').checked) payload.makeDefault = true;
      await apiPost('/api/environments', payload);
      toast('已添加环境 ' + envId, 'ok');
    } else {
      payload.curEnvId = _envModalCur;
      if ($('#envMakeDefault').checked) payload.makeDefault = true;
      const d = await apiPut('/api/environments', payload);
      // 环境 ID 变更：刷新顶栏下拉与当前环境
      if (d.envId && d.envId !== _envModalCur) S.env = '';
      toast('已保存环境 ' + d.envId, 'ok');
    }
    hideModal('envModal');
    await loadEnvironments();
    await checkStatus(); // 重建顶栏环境下拉与连接状态
  } catch (e) {
    showEnvMsg('保存失败：' + e.message, 'err');
    btn.disabled = false;
    btn.innerHTML = ic('check') + ' 保存';
    return;
  }
  btn.disabled = false;
  btn.innerHTML = ic('check') + ' 保存';
}

function showEnvMsg(text, kind) {
  const el = $('#envModalMsg');
  el.className = 'envmsg ' + (kind || 'warn');
  el.innerHTML = text;
}

async function testEnvModal() {
  const envId = $('#envModalId').value.trim();
  const sid = $('#envModalSid').value.trim();
  const skey = $('#envModalSkey').value.trim();
  const msgEl = $('#envModalMsg');
  const btn = $('#envModalTest');
  if (_envModalMode === 'add') {
    if (!envId || !sid || !skey) return showEnvMsg('请先填齐环境 ID / SecretId / SecretKey', 'err');
  } else {
    if (!sid && !skey) showEnvMsg('表单未填密钥：将使用已保存的凭证测试', 'warn');
  }
  btn.disabled = true;
  msgEl.className = 'envmsg';
  msgEl.innerHTML = '<span class="spin"></span> 正在验证凭证…';
  try {
    const d = await apiPost('/api/environments/test', { envId, secretId: sid, secretKey: skey });
    msgEl.className = 'envmsg ' + (d.ok ? 'ok' : 'err');
    msgEl.innerHTML = esc(d.message || (d.ok ? '凭证有效' : '凭证无效'));
  } catch (e) {
    msgEl.className = 'envmsg err';
    msgEl.innerHTML = '测试失败：' + esc(e.message);
  } finally {
    btn.disabled = false;
  }
}

// ---------- 模块导出 ----------
export { loadEnvironments, openEnvModal, saveEnvModal, testEnvModal };
