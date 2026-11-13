/* 云端数据管理台 —— 概览 Tab
   集合文档数卡片 + 云存储采样概览。卡片点击跳转数据库 Tab（见 db.js#openCollection）。 */
'use strict';

// 可选：集合中文标签（key = 集合名，value = 显示名）；未配置的集合直接显示原始集合名
const COL_LABEL = {};

async function loadOverview() {
  const banner = $('#ovBanner');
  try {
    const o = await apiGet('/api/overview');
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
