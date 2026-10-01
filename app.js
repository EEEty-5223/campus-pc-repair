// app.js
const api = require('./utils/api-request.js')
const appointments = require('./utils/appointments')

App({
  onLaunch: function () {
    // 静默登录:wx.login() → 后端换 openid → 存到 globalData
    // 把登录过程暴露成 promise,方便各页面等待登录完成后再拉数据
    var self = this
    self.globalData.loginReady = api.silentLogin()
      .then(function (data) {
        self.globalData.openid = data.openid || ''
        self.globalData.isAdmin = data.isAdmin || false
        self.globalData.role = data.role || 'user'
        console.log('[登录成功]', data)
        // 真机登录成功后,清理本地旧的演示数据,避免不同微信账号间看到混乱数据
        if (self.globalData.openid && self.globalData.openid !== 'simulator_openid_dev') {
          appointments.clearDemoData && appointments.clearDemoData()
        }
        return data
      })
      .catch(function (err) {
        console.error('[登录失败]', err.message || err)
        throw err
      })
  },
  globalData: {
    appName: '校园电脑维修预约',
    version: '1.0.0',
    // 登录后填
    openid: '',
    isAdmin: false,
    role: 'user',
    loginReady: null
  }
})