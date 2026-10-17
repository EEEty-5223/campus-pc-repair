var api = require('./api-request')
function key() {
  var app = getApp(), user = (app && app.globalData) || {}
  return (user.openid || '') + ':' + (user.notificationSession || '')
}
function authError(error) { return !!error && ['REAL_LOGIN_REQUIRED', 'MEMBER_REQUIRED', 'ADMIN_REQUIRED', 'SESSION_EXPIRED'].indexOf(error.code) !== -1 }
function renew() {
  var app = getApp()
  if (!app || !app.globalData) return Promise.reject(new Error('请在手机微信中重新登录'))
  var original = key()
  return api.silentLogin({ requireReal: true }).then(function (user) {
    if (original !== key()) throw new Error('登录账号已改变，请重新打开页面')
    if (!user || user._simulator || !user.openid || user.openid === 'simulator_openid_dev') throw new Error('请使用手机微信完成真实登录')
    Object.assign(app.globalData, { openid: user.openid, role: user.role || 'user', isAdmin: !!user.isAdmin, department: user.department || '', notificationSession: user.notificationSession || '', notificationSessionExpiresAt: user.notificationSessionExpiresAt || '', isSimulator: false, isLocalDevelopment: !!user._localDevelopment, loginReady: Promise.resolve(user) })
    if (['admin', 'leader', 'member'].indexOf(user.role) === -1 || !user.notificationSession) throw new Error('当前微信没有社团成员权限')
    return user
  })
}
module.exports = { key: key, authError: authError, renew: renew }
