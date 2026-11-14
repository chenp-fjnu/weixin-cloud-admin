var api = require('../../utils/api.js');
var envUtil = require('../../utils/env.js');

Page({
    data: {
        collection: '',
        id: '',
        mode: 'new',          // new | edit
        loading: true,
        error: '',
        text: '',
        saving: false,
        removing: false
    },

    onLoad: function (query) {
        var collection = decodeURIComponent(query.collection || '');
        var id = decodeURIComponent(query.id || '');
        if (!collection) {
            this.setData({ loading: false, error: '缺少集合参数，请从云数据库页进入。' });
            return;
        }
        this.setData({ collection: collection, id: id, mode: id ? 'edit' : 'new' });
        if (!envUtil.getCurrentEnv()) {
            this.setData({ loading: false, error: '未找到当前云环境，请先在总览页确认环境。' });
            return;
        }
        if (id) {
            this.loadDoc();
        } else {
            this.setData({ text: '{}', loading: false });
        }
    },

    loadDoc: function () {
        var that = this;
        api.callAdmin('docGet', {
            env: envUtil.getCurrentEnv(),
            name: this.data.collection,
            id: this.data.id
        }).then(function (r) {
            var doc = (r && r.doc) || {};
            // 去掉 _id 后展示，保存时云函数也会忽略 _id
            that.setData({ text: JSON.stringify(doc, null, 2), loading: false });
        }).catch(function (e) {
            that.setData({ loading: false, error: e.message || '读取文档失败' });
        });
    },

    onTextInput: function (e) {
        this.setData({ text: e.detail.value, error: '' });
    },

    // 校验 + 保存
    parseDoc: function () {
        var raw = this.data.text;
        if (!raw || !raw.trim()) throw new Error('内容不能为空');
        var obj;
        try { obj = JSON.parse(raw); }
        catch (e) { throw new Error('JSON 格式不正确：' + e.message); }
        if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
            throw new Error('内容必须是 JSON 对象（{}），不能是数组或基本类型');
        }
        return obj;
    },

    onSave: function () {
        var that = this;
        var doc;
        try { doc = this.parseDoc(); }
        catch (e) { wx.showToast({ title: e.message, icon: 'none' }); return; }

        var isEdit = this.data.mode === 'edit';
        var action = isEdit ? 'docSet' : 'docAdd';
        this.setData({ saving: true });
        api.callAdmin(action, {
            env: envUtil.getCurrentEnv(),
            name: this.data.collection,
            id: this.data.id,
            doc: doc
        }).then(function () {
            wx.showToast({ title: isEdit ? '已保存' : '已新增', icon: 'success' });
            setTimeout(function () { wx.navigateBack(); }, 600);
        }).catch(function (e) {
            that.setData({ saving: false });
            wx.showToast({ title: e.message || '保存失败', icon: 'none' });
        });
    },

    onDelete: function () {
        var that = this;
        if (this.data.mode !== 'edit') return;
        wx.showModal({
            title: '删除文档',
            content: '确认删除该文档（' + this.data.id + '）？删除后不可恢复。',
            confirmColor: '#d4380d',
            success: function (res) {
                if (!res.confirm) return;
                that.setData({ removing: true });
                api.callAdmin('docRemove', {
                    env: envUtil.getCurrentEnv(),
                    name: that.data.collection,
                    id: that.data.id
                }).then(function () {
                    wx.showToast({ title: '已删除', icon: 'success' });
                    setTimeout(function () { wx.navigateBack(); }, 600);
                }).catch(function (e) {
                    that.setData({ removing: false });
                    wx.showToast({ title: e.message || '删除失败', icon: 'none' });
                });
            }
        });
    },

    goBack: function () {
        wx.navigateBack({ fail: function () { wx.switchTab({ url: '/pages/data/data' }); } });
    }
});
