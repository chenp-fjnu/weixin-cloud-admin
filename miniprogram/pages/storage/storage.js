var api = require('../../utils/api.js');
var envUtil = require('../../utils/env.js');
var util = require('../../utils/util.js');
var fs = wx.getFileSystemManager();

var UPLOAD_LIMIT = 20 * 1024 * 1024; // 与云函数 ADMIN_UPLOAD_LIMIT 默认值一致

Page({
    data: {
        envId: '',
        loading: true,
        error: '',
        path: '',            // 当前前缀，根目录为 ''
        crumbs: [],         // [{label, path}] 面包屑
        dirs: [],
        files: [],
        deleting: [],
        previewing: '',
        uploading: false
    },

    onShow: function () {
        var envId = envUtil.getCurrentEnv();
        this.setData({ envId: envId });
        if (!envId) {
            this.setData({ loading: false, error: '未找到当前云环境，请先在总览页确认环境。' });
            return;
        }
        // 每次进入都回到根目录，保证状态简单可预期
        this.setData({ path: '' });
        this.load();
    },

    goEnvConfig: function () {
        wx.navigateTo({ url: '/pages/env-config/env-config' });
    },

    load: function () {
        var that = this;
        var path = this.data.path;
        this.setData({ loading: true, error: '' });
        api.callAdmin('storage', { env: this.data.envId, prefix: path })
            .then(function (r) {
                var prefix = (r && r.prefix) || '';
                var files = (r && r.files) || [];
                var entries = files.map(function (f) {
                    var full = f.name.indexOf(prefix) === 0 ? f.name : prefix + f.name;
                    return {
                        name: f.name.replace(prefix, ''),
                        full: full,
                        sizeText: util.formatBytes(f.size),
                        isImg: util.isImage(f.name),
                        mtime: f.lastModified || ''
                    };
                });
                that.setData({
                    loading: false,
                    path: prefix,
                    dirs: (r && r.prefixes) || [],
                    files: entries,
                    crumbs: that.buildCrumbs(prefix)
                });
            })
            .catch(function (e) {
                that.setData({ loading: false, error: e.message || '加载失败' });
            });
    },

    buildCrumbs: function (prefix) {
        var out = [{ label: '根目录', path: '' }];
        if (!prefix) return out;
        var parts = prefix.split('/').filter(Boolean);
        var acc = '';
        parts.forEach(function (p, i) {
            acc += p + '/';
            out.push({ label: p, path: acc });
        });
        return out;
    },

    // 进入子目录
    enterDir: function (e) {
        var p = e.currentTarget.dataset.path;
        this.setData({ path: p, dirs: [], files: [], crumbs: this.buildCrumbs(p) });
        this.load();
    },

    // 点击面包屑回跳
    crumbTap: function (e) {
        var p = e.currentTarget.dataset.path;
        if (p === this.data.path) return;
        this.setData({ path: p, dirs: [], files: [], crumbs: this.buildCrumbs(p) });
        this.load();
    },

    // 预览（图片：取临时链接后预览）
    previewFile: function (e) {
        var that = this;
        var full = e.currentTarget.dataset.full;
        if (!util.isImage(full)) {
            wx.showToast({ title: '仅支持图片预览', icon: 'none' });
            return;
        }
        this.setData({ previewing: full });
        api.callAdmin('storageUrls', { env: this.data.envId, fileIDs: [full] })
            .then(function (r) {
                var url = (r && r.urls) && (r.urls[full] || '');
                that.setData({ previewing: '' });
                if (!url) { wx.showToast({ title: '获取预览链接失败', icon: 'none' }); return; }
                wx.previewImage({ urls: [url] });
            })
            .catch(function (err) {
                that.setData({ previewing: '' });
                wx.showToast({ title: err.message || '预览失败', icon: 'none' });
            });
    },

    // 删除文件
    deleteFile: function (e) {
        var that = this;
        var full = e.currentTarget.dataset.full;
        var name = e.currentTarget.dataset.name;
        wx.showModal({
            title: '删除文件',
            content: '确认删除 ' + name + ' ？删除后不可恢复。',
            confirmColor: '#d4380d',
            success: function (res) {
                if (!res.confirm) return;
                that.setData({
                    deleting: that.data.deleting.concat([full])
                });
                api.callAdmin('storageDelete', { env: that.data.envId, fileIDs: [full] })
                    .then(function () {
                        that.setData({ deleting: that.data.deleting.filter(function (x) { return x !== full; }) });
                        wx.showToast({ title: '已删除', icon: 'success' });
                        that.load();
                    })
                    .catch(function (err) {
                        that.setData({ deleting: that.data.deleting.filter(function (x) { return x !== full; }) });
                        wx.showToast({ title: err.message || '删除失败', icon: 'none' });
                    });
            }
        });
    },

    // 上传（从聊天记录选文件 → base64 → 云函数上传到当前目录）
    uploadFile: function () {
        var that = this;
        if (this.data.uploading) return;
        wx.chooseMessageFile({
            count: 1,
            type: 'file',
            success: function (res) {
                var file = res.tempFiles && res.tempFiles[0];
                if (!file) return;
                var size = file.size || 0;
                if (size > UPLOAD_LIMIT) {
                    wx.showToast({ title: '超过 20MB，大文件请走本地 server.js', icon: 'none' });
                    return;
                }
                that.setData({ uploading: true });
                fs.readFile({
                    filePath: file.path,
                    encoding: 'base64',
                    success: function (r) {
                        var cloudPath = (that.data.path || '') + (file.name || 'file_' + Date.now());
                        api.callAdmin('storageUpload', {
                            env: that.data.envId,
                            cloudPath: cloudPath,
                            content: r.data
                        }).then(function () {
                            that.setData({ uploading: false });
                            wx.showToast({ title: '上传成功', icon: 'success' });
                            that.load();
                        }).catch(function (err) {
                            that.setData({ uploading: false });
                            wx.showToast({ title: err.message || '上传失败', icon: 'none' });
                        });
                    },
                    fail: function () {
                        that.setData({ uploading: false });
                        wx.showToast({ title: '读取本地文件失败', icon: 'none' });
                    }
                });
            }
        });
    }
});
