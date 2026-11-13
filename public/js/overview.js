/* 云端数据管理台 —— 概览 Tab
   顶部 KPI 卡（集合/文档/目录/扫描体积）+ 集合文档数卡片（占比条）+ 云存储采样概览。
   集合卡片点击跳转数据库 Tab（见 db.js#openCollection）。 */
'use strict';

// 可选：集合中文标签（key = 集合名，value = 显示名）；未配置的集合直接显示原始集合名
const COL_LABEL = {};

// KPI 卡数据：[图标, 色块类, 数值, 标题, 副标题]
function buildKpis(items) {
  const box = $('#ovKpis');
  box.innerHTML = items.map(it =>
    '<div class="kpi"><div class="ic ' + it[1] + '">' + ic(it[0]) + '</div>' +
    '<div><div class="v">' + esc(it[2]) + '</div><div class="k">' + esc(it[3]) + (it[4] ? ' <span class="muted">· ' + esc(it[4]) + '</span>' : '') + '</div></div></div>'
  ).join('');
}

async function loadOverview() {
  const banner = $('#ovBanner');
  const prev = S.overview;
  if (!prev) {
    buildKpis([
      ['grid', 'b1', '—', '数据库集合'],
      ['db', 'b2', '—', '文档总数'],
      ['folder', 'b3', '—', '顶层目录'],
      ['chart', 'b6', '—', '扫描体积']
    ]);
  }
  try {
    const o = await apiGet('/api/overview');
    S.overview = o;
    S.overview.at = Date.now();
    $('#ovLoading').style.display = 'none';
    $('#ovBody').style.display = 'block';
    $('#ovUpdatedAt').textContent = '统计于 ' + new Date().toLocaleTimeString('zh-CN', { hour12: false }) + ' · 进入本页自动统计';
    // DB 卡片（带占整体文档数比例条）
    const cards = $('#ovCards'); cards.innerHTML = '';
    let total = 0, err = 0;
    for (const name in o.counts) {
      const v = o.counts[name];
      if (v === 'ERR') err++; else total += Number(v) || 0;
    }
    for (const name in o.counts) {
      const v = o.counts[name];
      const c = document.createElement('div');
      c.className = 'card click';
      const share = (v === 'ERR' || !total) ? 0 : Math.max(1, Math.round((Number(v) / total) * 100));
      c.innerHTML = '<div class="k">' + esc(COL_LABEL[name] || name) + '<span class="arrow">' + ic('arrowR') + '</span></div>' +
        '<div class="v">' + (v === 'ERR' ? '—' : fmtNum(v)) + '</div>' +
        '<div class="bar"><i style="width:' + (v === 'ERR' ? 0 : share) + '%"></i></div>' +
        '<div class="m">' + esc(name) + '</div>';
      c.addEventListener('click', () => { openCollection(name); });
      cards.appendChild(c);
    }
    $('#ovDbTotal').textContent = '合计 ' + fmtNum(total) + (err ? '（' + err + ' 个集合读取失败）' : '');
    // KPI 汇总卡
    const st = o.storage || {};
    buildKpis([
      ['grid', 'b1', fmtNum(Object.keys(o.counts).length), '数据库集合', err ? err + ' 个读取失败' : ''],
      ['db', 'b2', fmtNum(total), '文档总数', '全集合合计'],
      ['folder', 'b3', (st.topDirs != null && st.topDirs >= 0) ? fmtNum(st.topDirs) : '—', '顶层目录', '根目录下一级'],
      ['chart', 'b6', st.totalSize != null ? fmtSize(st.totalSize) : '—', '扫描体积', st.truncated ? '已达采样上限' : '采样合计']
    ]);
    // 存储明细卡片（totalFiles 为 -1 表示采样未计全，展示为「—」而非负数）
    const sc = $('#ovStorageCards'); sc.innerHTML = '';
    const filesShown = (st.totalFiles != null && st.totalFiles >= 0) ? fmtNum(st.totalFiles) : '—';
    const stCards = [
      ['顶层目录数', (st.topDirs != null && st.topDirs >= 0) ? fmtNum(st.topDirs) : '—', '根目录下一级路径段'],
      ['扫描文件数', filesShown, st.truncated ? '已达采样上限 5000' : '根目录全量采样'],
      ['扫描字节合计', st.totalSize != null ? fmtSize(st.totalSize) : '—', '采样文件体积之和']
    ];
    stCards.forEach((it) => {
      const c = document.createElement('div');
      c.className = 'card';
      c.innerHTML = '<div class="k">' + it[0] + '</div><div class="v">' + esc(it[1]) + '</div><div class="m">' + esc(it[2]) + '</div>';
      sc.appendChild(c);
    });
    if (st.error) {
      banner.className = 'banner show';
      banner.innerHTML = ic('warning') + '<span>云存储概览失败：' + esc(st.error) + '</span>';
    } else banner.className = 'banner';
  } catch (e) {
    $('#ovLoading').style.display = 'none';
    banner.className = 'banner show';
    banner.innerHTML = ic('warning') + '<span>概览加载失败：' + esc(e.message) + '</span>';
  }
}
