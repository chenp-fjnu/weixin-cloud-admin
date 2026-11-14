// 当前被管理 / 浏览的云环境 ID（本地持久化）
var KEY = 'weixin_cloud_admin_current_env';

function getCurrentEnv() {
    return wx.getStorageSync(KEY) || '';
}

function setCurrentEnv(id) {
    wx.setStorageSync(KEY, id || '');
    var app = getApp();
    if (app && app.globalData) app.globalData.currentEnv = id || '';
}

// 总览页点击集合后跳转到云数据库 tab 时的一次性焦点
var FOCUS_KEY = 'weixin_cloud_admin_focus_collection';
function setFocusCollection(name) {
    wx.setStorageSync(FOCUS_KEY, name || '');
}
function getFocusCollection() {
    return wx.getStorageSync(FOCUS_KEY) || '';
}
function clearFocusCollection() {
    wx.removeStorageSync(FOCUS_KEY);
}

// 上次浏览的集合（跨 tab 切换保留）
var LAST_COL_KEY = 'weixin_cloud_admin_last_collection';
function getLastCollection() {
    return wx.getStorageSync(LAST_COL_KEY) || '';
}
function setLastCollection(name) {
    wx.setStorageSync(LAST_COL_KEY, name || '');
}

module.exports = {
    getCurrentEnv: getCurrentEnv,
    setCurrentEnv: setCurrentEnv,
    setFocusCollection: setFocusCollection,
    getFocusCollection: getFocusCollection,
    clearFocusCollection: clearFocusCollection,
    getLastCollection: getLastCollection,
    setLastCollection: setLastCollection
};
