var api = require('../../utils/api.js');
var envUtil = require('../../utils/env.js');
var util = require('../../utils/util.js');

Page({
    data: {
        envId: '',
        mode: 'collections',           // collections | docs
        loading: true,
        error: '',
        // 集合列表
        collections: [],
        // 文档分页
        collection: '',
        total: 0,
        page: 1,
        size: 20,
        hasMore: false,
        docs: [],
        loadingMore: false,
        // 检索 / 排序
        q: '',
        field: '',
        sort: '',
        sortDir: 'asc'
    },

    onShow: function () {
        var that = this;
        this.setData({ envId: envUtil.getCurrentEnv() });
        if (!this.envId()) {
            this.setData({ loading: false, error: '请先在总览页确认云环境，或联系管理员为 admin 云函数配置环境变量。' });
            return;
        }
        // 总览页带焦点集合跳来：直接进文档模式
        var focus = envUtil.getFocusCollection();
        if (focus) {
            envUtil.clearFocusCollection();
            this.setData({ loading: true, error: '', mode: 'docs', collection: focus, total: 0, page: 1, docs: [] });
            this.loadCollections(focus);
            return;
        }
        // 无焦点：有上次记忆集合则恢复，否则回集合列表
        var last = envUtil.getLastCollection();
        if (last) {
            this.setData({ loading: true, error: '', mode: 'docs', collection: last, total: 0, page: 1, docs: [] });
            this.loadCollections(last);
        } else {
            this.setData({ loading: true, error: '' });
            api.callAdmin('collections', { env: this.envId() })
                .then(function (r) {
                    that.setData({ loading: false, mode: 'collections', collections: (r && r.collections) || [] });
                })
                .catch(function (e) {
                    that.setData({ loading: false, error: e.message || '加载失败' });
                });
        }
    },

    envId: function () {
        return envUtil.getCurrentEnv();
    },

    goEnvConfig: function () {
        wx.navigateTo({ url: '/pages/env-config/env-config' });
    },

    // 进入集合（集合列表项点击）
    openCollection: function (e) {
        var that = this;
        var name = e.currentTarget.dataset.name;
        envUtil.setLastCollection(name);
        this.setData({ loading: true, error: '', mode: 'docs', collection: name, total: 0, page: 1, docs: [], hasMore: false });
        this.loadCollections(name);
    },

    // 加载集合列表（用于校验焦点集合是否真实存在）
    loadCollections: function (focusName) {
        var that = this;
        api.callAdmin('collections', { env: this.envId() })
            .then(function (r) {
                var names = (r && r.collections) || [];
                that.setData({ collections: names });
                if (focusName && names.indexOf(focusName) < 0) {
                    that.setData({ mode: 'collections', collection: '', docs: [], total: 0 });
                    that.setData({ error: '集合 ' + focusName + ' 不存在或无权限，已回退到集合列表。' });
                    that.setData({ loading: false });
                    return;
                }
                that.setData({ loading: false });
                that.loadPage(1, true);
            })
            .catch(function (e) {
                that.setData({ loading: false, error: e.message || '加载失败' });
            });
    },

    backCollections: function () {
        this.setData({ mode: 'collections', collection: '', docs: [], total: 0, page: 1 });
        var that = this;
        api.callAdmin('collections', { env: this.envId() })
            .then(function (r) { that.setData({ collections: (r && r.collections) || [] }); })
            .catch(function () { /* 列表加载失败不阻塞 */ });
    },

    // 加载某页文档（reset=true 从头来）
    loadPage: function (page, reset) {
        var that = this;
        if (reset) this.setData({ page: 1, docs: [], total: 0, hasMore: false, loadingMore: false });
        else this.setData({ loadingMore: true });
        var payload = {
            env: this.envId(),
            name: this.data.collection,
            page: page,
            size: this.data.size
        };
        if (this.data.q) { payload.field = this.data.field; payload.q = this.data.q; }
        if (this.data.sort) { payload.sort = this.data.sort; payload.sortDir = this.data.sortDir; }
        api.callAdmin('collection', payload)
            .then(function (r) {
                var docs = (r && r.docs) || [];
                docs = docs.map(function (d) {
                    var copy = {};
                    for (var k in d) copy[k] = d[k];
                    copy._idText = String(d._id || '');
                    copy._timeText = util.pickTime(d);
                    copy._preview = util.docPreview(d);
                    return copy;
                });
                that.setData({
                    docs: reset ? docs : that.data.docs.concat(docs),
                    total: (r && r.total) || 0,
                    page: page,
                    hasMore: !!(r && r.hasMore),
                    loadingMore: false
                });
            })
            .catch(function (e) {
                that.setData({ loadingMore: false, error: e.message || '查询失败' });
            });
    },

    // 检索（q 为空则查全量；field 为正则匹配的字段，两者需同时填写）
    onSearch: function () {
        if (this.data.q && !this.data.field) {
            wx.showToast({ title: '请填写要匹配的字段名', icon: 'none' });
            return;
        }
        this.loadPage(1, true);
    },

    onFieldInput: function (e) { this.setData({ field: (e.detail.value || '').trim() }); },
    onQInput: function (e) { this.setData({ q: (e.detail.value || '').trim() }); },
    onSortInput: function (e) {
        this.setData({ sort: (e.detail.value || '').trim(), sortDir: 'asc' });
    },
    onSortDirInput: function (e) { this.setData({ sortDir: (e.detail.value || 'asc').trim() }); },
    onResetFilter: function () {
        this.setData({ q: '', field: '', sort: '', sortDir: 'asc' });
        this.loadPage(1, true);
    },

    onReachBottom: function () {
        if (this.data.mode !== 'docs' || !this.data.hasMore || this.data.loadingMore) return;
        this.loadPage(this.data.page + 1, false);
    },

    // 打开文档编辑
    openDoc: function (e) {
        var id = e.currentTarget.dataset.id;
        if (!id) return;
        wx.navigateTo({
            url: '/pages/doc-edit/doc-edit?collection=' + encodeURIComponent(this.data.collection) +
                '&id=' + encodeURIComponent(id)
        });
    },

    addDoc: function () {
        wx.navigateTo({
            url: '/pages/doc-edit/doc-edit?collection=' + encodeURIComponent(this.data.collection)
        });
    }
});
