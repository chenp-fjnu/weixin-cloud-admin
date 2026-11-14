// 统一云函数调用封装：wx.cloud.callFunction({ name: 'admin', data })
// 云函数返回 { ok, data, error, code }，这里做解包：
//   ok   -> resolve(data !== undefined ? data : result)
//   !ok  -> reject(new Error(error))
function callAdmin(action, payload) {
    return new Promise(function (resolve, reject) {
        wx.cloud.callFunction({
            name: 'admin',
            data: Object.assign({ action: action }, payload || {}),
            success: function (res) {
                var r = (res && res.result) || {};
                if (r.ok) {
                    resolve(r.data !== undefined ? r.data : r);
                } else {
                    reject(new Error(r.error || '云函数执行失败'));
                }
            },
            fail: function (err) {
                var msg = (err && (err.errMsg || err.message)) || '';
                reject(new Error(msg || '云函数调用失败：请确认已部署 admin 云函数并绑定正确的 AppID / 云环境'));
            }
        });
    });
}

module.exports = {
    callAdmin: callAdmin
};
