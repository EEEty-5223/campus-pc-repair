var api = require('./api-request')

function unavailable(error) {
  if (error && (error.statusCode === 404 || error.statusCode === 501)) {
    return Object.assign(new Error('完工审核服务暂未开放，请稍后重试。'), { code: 'COMPLETION_UNAVAILABLE' })
  }
  return error
}
function call(path, method, body) {
  return api.memberRequest(path, method || 'GET', body || {}).catch(function (error) { throw unavailable(error) })
}
function path(id) { return '/api/appointments/' + encodeURIComponent(id) + '/completion' }
function upload(id, filePath) {
  var user = (getApp() && getApp().globalData) || {}
  if (!user.notificationSession || user.isSimulator) return Promise.reject(new Error('请先登录社团成员账号。'))
  return new Promise(function (resolve, reject) {
    wx.uploadFile({
      url: api.getBackendBaseUrl() + path(id) + '/photos', filePath: filePath, name: 'file',
      header: { Authorization: 'Bearer ' + user.notificationSession },
      success: function (response) {
        if (response.statusCode === 404 || response.statusCode === 501) return reject(unavailable({ statusCode: response.statusCode }))
        var data
        try { data = JSON.parse(response.data) } catch (_) { return reject(new Error('照片上传未成功，请重试。')) }
        if (response.statusCode < 200 || response.statusCode >= 300 || !data.ok || !data.photo || !data.photo.id || !data.photo.url) {
          return reject(new Error('照片上传未成功，请重试。'))
        }
        resolve({ id: String(data.photo.id), url: data.photo.url })
      }, fail: function () { reject(new Error('照片上传失败，请检查网络后重试。')) }
    })
  })
}
function errorText(error) {
  var messages = {
    COMPLETION_UNAVAILABLE: '完工审核服务暂未开放，请稍后重试。',
    COMPLETION_CODE_INVALID: '完成码不正确，请向用户重新核对。',
    COMPLETION_CODE_LOCKED: '完成码尝试次数过多，请稍后重试。',
    COMPLETION_PHOTO_REQUIRED: '请至少上传一张完工照片。',
    COMPLETION_PHOTO_LIMIT: '照片超过允许数量，请移除多余照片后重试。',
    APPOINTMENT_FORBIDDEN: '当前账号没有操作这条预约的权限。',
    INVALID_STATUS_TRANSITION: '预约状态已经变化，请返回刷新。',
    REVIEW_ALREADY_PROCESSED: '这条特殊单已被处理，请刷新列表。',
    REAL_LOGIN_REQUIRED: '请重新登录社团成员账号。', SESSION_EXPIRED: '登录已过期，请重新登录。'
  }
  return messages[error && error.code] || (error && error.statusCode === 403 ? '当前账号没有操作权限。' : '操作未完成，请检查网络后重试。')
}
module.exports = {
  viewerKey: function () { var user = (getApp() && getApp().globalData) || {}; return [user.openid || '', user.notificationSession || '', user.role || '', user.department || ''].join(':') },
  context: function (id) { return call(path(id)) },
  upload: upload,
  submit: function (id, body) { return call(path(id), 'POST', body) },
  summary: function () { return call('/api/appointments/special-orders/summary') },
  list: function (status, page) { return call('/api/appointments/special-orders?status=' + encodeURIComponent(status) + '&page=' + (page || 1)) },
  review: function (id, body) { return call('/api/appointments/special-orders/' + encodeURIComponent(id) + '/review', 'POST', body) },
  errorText: errorText,
  requestKey: function () { return 'completion_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 14) }
}
