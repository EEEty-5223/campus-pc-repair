// app.js
const api = require('./utils/api-request.js')
const appointments = require('./utils/appointments')
const memberPhone = require('./utils/member-phone-prompt')

App({
  onShow: function () { this._phoneVisible = true; this.checkMemberPhone() },
  onHide: function () { this._phoneVisible = false; memberPhone.cancel() },
  checkMemberPhone: function () {
    var self = this
    if (this._phoneVisible !== true) return Promise.resolve()
    return Promise.resolve(this.globalData.loginReady).then(function () { if (self._phoneVisible) return memberPhone.ensure(self) }).catch(function () {})
  },
  onLaunch: function () {
    // 静默登录:wx.login() → 后端换 openid → 存到 globalData
    // 把登录过程暴露成 promise,方便各页面等待登录完成后再拉数据
    var self = this
    self.globalData.loginReady = api.silentLogin()
      .then(function (data) {
        self.globalData.openid = data.openid || ''
        self.globalData.isAdmin = data.isAdmin || false
        self.globalData.role = data.role || 'user'
        self.globalData.department = data.department || ''
        self.globalData.phone = data.phone || ''
        self.globalData.needsPhone = !!data.needsPhone
        self.globalData.notificationSession = data._simulator ? '' : (data.notificationSession || '')
        self.globalData.notificationSessionExpiresAt = data.notificationSessionExpiresAt || ''
        self.globalData.isSimulator = !!data._simulator
        self.globalData.isLocalDevelopment = !!data._localDevelopment
        console.log('[登录成功]', { role: self.globalData.role, isAdmin: self.globalData.isAdmin })
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
    version: '1.2.3',
    // 登录后填
    openid: '',
    isAdmin: false,
    role: 'user',
    notificationSession: '',
    notificationSessionExpiresAt: '',
    isSimulator: false,
    isLocalDevelopment: false,
    loginReady: null
  }
})
