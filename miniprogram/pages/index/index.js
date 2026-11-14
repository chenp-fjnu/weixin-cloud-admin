var api = require('../../utils/api.js');
var envUtil = require('../../utils/env.js');
var util = require('../../utils/util.js');

// 确保证件当前环境有效：本地未记录 / 已不在环境列表中时回落默认环境
function ensureEnv(that) {
    return api.callAdmin('environments').then(function (r) {
        var envs = (r && r.envs) || [];
        var cur = envUtil.getCurrentEnv();
        var valid = false;
        envs.forEach(function (e) { if (e.envId === cur) valid = true; });
        var id = valid ? cur : ((r && r.defaultEnvId) || (envs.length ? envs[0].envId : ''));
        envUtil.setCurrentEnv(id);
        that.setData({ envId: id });
        return id;
    });
}

Page({
    data: {
        envId: '',
        loading: true,
        error: '',
        statItems: [],
        collectionsArr: [],
        storageError: '',
        storageTruncated: false,
        statusList: []
    },

    onShow: function () {
        var that = this;
        this.setData({ loading: true, error: '' });
        ensureEnv(that).then(function (envId) {
            if (!envId) {
                that.setData({
                    loading: false,
                    error: '云函数尚未配置任何云环境。请在微信开发者工具中为 admin 云函数设置环境变量 TCB_ENV_ID、TCB_SECRET_ID / TCB_SECRET_KEY 后重新部署。'
                });
                return;
            }
            return Promise.all([
                api.callAdmin('overview', { env: envId }),
                api.callAdmin('status', { env: envId })
            ]).then(function (res) {
                that.applyOverview(res[0]);
                that.applyStatus(res[1]);
                that.setData({ loading: false });
            });
        }).catch(function (e) {
            that.setData({ loading: false, error: e.message || '加载失败' });
        });
    },

    applyOverview: function (ov) {
        var counts = (ov && ov.counts) || {};
        var names = Object.keys(counts);
        var totalDocs = 0;
        var collectionsArr = names.map(function (name) {
            var c = counts[name];
            if (c === 'ERR') return { name: name, countText: '错误' };
            totalDocs += Number(c) || 0;
            return { name: name, countText: String(c) };
        });
        var s = (ov && ov.storage) || {};
        var statItems = [
            { num: String(names.length), label: '集合数' },
            { num: String(totalDocs), label: '文档总数' },
            { num: s.topDirs != null ? String(s.topDirs) : '—', label: '顶层目录' },
            { num: (s.totalFiles != null && s.totalFiles >= 0) ? String(s.totalFiles) : '—', label: '文件数' },
            { num: s.totalSize ? util.formatBytes(s.totalSize) : '0 B', label: '存储大小' }
        ];
        this.setData({
            statItems: statItems,
            collectionsArr: collectionsArr,
            storageError: s.error || '',
            storageTruncated: !!s.truncated
        });
    },

    applyStatus: function (st) {
        var list = ((st && st.envs) || []).map(function (e) {
            return {
                envId: e.envId,
                tagClass: e.ok ? 'tag-ok' : (e.hasSecrets ? 'tag-warn' : 'tag-err'),
                tagText: e.ok ? '就绪' : (e.hasSecrets ? '异常' : '缺凭证'),
                message: e.message || ''
            };
        });
        this.setData({ statusList: list });
    },

    goEnvConfig: function () {
        wx.navigateTo({ url: '/pages/env-config/env-config' });
    },

    openCollection: function (e) {
        envUtil.setFocusCollection(e.currentTarget.dataset.name);
        wx.switchTab({ url: '/pages/data/data' });
    }
});
