// 云开发环境：admin 云函数部署所在的「绑定环境」。
// 通常就是你要管理的那批环境中的「默认环境」。留空则使用 AppID 的默认云开发环境。
// 如果 admin 云函数部署在某个非默认环境，把它的环境 ID 填到这里。
const CLOUD_ENV = '';

App({
    globalData: {
        appName: '云环境管理',
        // 当前被管理 / 浏览的云环境 ID（由「环境」页切换，持久化到本地）
        currentEnv: '',
        cloudEnv: CLOUD_ENV
    },

    onLaunch() {
        try {
            wx.cloud.init({
                env: this.globalData.cloudEnv || undefined,
                traceUser: true
            });
        } catch (e) {
            // 未绑定云开发环境（touristappid / 未开通）时这里会失败，属预期。
            console.error('wx.cloud.init 失败：', e);
        }
        this.globalData.currentEnv = wx.getStorageSync('weixin_cloud_admin_current_env') || '';
    }
});
