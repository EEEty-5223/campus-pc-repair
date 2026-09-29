// app.js
const api = require('./utils/api-request.js')

App({
  onLaunch: function () {
    // 静默登录:wx.login() → 后端换 openid → 存到 globalData
    api.silentLogin()
      .then(function (data) {
        this.globalData.openid = data.openid
        this.globalData.isAdmin = data.isAdmin
        this.globalData.role = data.role
        console.log('[登录成功]', data)
      }.bind(this))
      .catch(function (err) {
        console.error('[登录失败]', err.message || err)
      })
  },
  globalData: {
    appName: '校园电脑维修预约',
    version: '1.0.0',
    // 登录后填
    openid: '',
    isAdmin: false,
    role: 'user'
  }
})