var api = require('../../utils/api.js');
var envUtil = require('../../utils/env.js');

Page({
    data: {
        loading: true,
        error: '',
        envs: [],
        defaultEnvId: '',
        currentEnv: ''
    },

    onShow: function () {
        var that = this;
        this.setData({ loading: true, error: '', currentEnv: envUtil.getCurrentEnv() });
        api.callAdmin('environments')
            .then(function (r) {
                var list = ((r && r.envs) || []).map(function (e) {
                    var tagClass = 'tag-err';
                    var tagText = '未配置凭证';
                    if (e.hasSecrets) { tagClass = 'tag-ok'; tagText = '已配置凭证'; }
                    return {
                        envId: e.envId,
                        isDefault: e.isDefault,
                        hasSecrets: e.hasSecrets,
                        tagClass: tagClass,
                        tagText: tagText,
                        masked: e.secretIdMasked || ''
                    };
                });
                that.setData({
                    loading: false,
                    envs: list,
                    defaultEnvId: (r && r.defaultEnvId) || '',
                    currentEnv: envUtil.getCurrentEnv()
                });
            })
            .catch(function (e) {
                that.setData({ loading: false, error: e.message || '加载失败' });
            });
    },

    // 设为当前浏览环境（本地持久化）
    useEnv: function (e) {
        var id = e.currentTarget.dataset.id;
        envUtil.setCurrentEnv(id);
        this.setData({ currentEnv: id });
        wx.showToast({ title: '已切换：' + id, icon: 'success' });
    },

    goOverview: function () {
        wx.switchTab({ url: '/pages/index/index' });
    },

    goBack: function () {
        wx.navigateBack({ fail: function () { wx.switchTab({ url: '/pages/index/index' }); } });
    }
});
