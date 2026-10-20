var api = require('./api-request'), portal = require('./portal-api')
function call(path, method, data) { return (path.indexOf('/api/admin/') === 0 ? api.memberRequest : api.request)(path, method || 'GET', data || {}) }
function photo(row, administrative) {
  if (!row || !/^\/api\/(?:case-images\/[a-f0-9]{32}|admin\/cases\/[a-f0-9]{32}\/(?:images|source-photos)\/[a-f0-9]{32})$/.test(row.url || '')) return Promise.resolve(Object.assign({}, row, { displayUrl: '', failed: true }))
  var viewer = portal.identity(), header = {}, user = getApp().globalData || {}
  if (administrative) header.Authorization = 'Bearer ' + user.notificationSession
  return new Promise(function (resolve) {
    wx.downloadFile({ url: portal.absolute(row.url), header: header, timeout: 15000, success: function (r) {
      resolve(Object.assign({}, row, { displayUrl: viewer === portal.identity() && r.statusCode === 200 ? r.tempFilePath || '' : '', failed: viewer !== portal.identity() || r.statusCode !== 200 || !r.tempFilePath }))
    }, fail: function () { resolve(Object.assign({}, row, { displayUrl: '', failed: true })) } })
  })
}
function photos(rows, administrative) { return Promise.all((rows || []).map(function (r) { return photo(r, administrative) })) }
function dateTime(value) { if (!value) return '历史未记录'; var date = portal.date(value), time = new Date(value); return date && !isNaN(time.getTime()) ? date + ' ' + String(time.getHours()).padStart(2,'0') + ':' + String(time.getMinutes()).padStart(2,'0') : '历史未记录' }
function card(row) { return Object.assign({}, row, { appointmentDateText: (row.appointmentTime || '').slice(0,10), completedDateText: portal.date(row.completedAt) || '历史未记录', completedText: dateTime(row.completedAt) }) }
function cards(rows) { return Promise.all((rows || []).map(function (r) { var value = card(r); return r.cover ? photo({ url: r.cover }, false).then(function (p) { return Object.assign(value, { coverUrl: p.displayUrl, coverFailed: p.failed }) }) : Promise.resolve(value) })) }
function upload(id, filePath, version) {
  var viewer = portal.identity(), user = getApp().globalData || {}
  return new Promise(function (resolve, reject) {
    wx.uploadFile({ url: api.getBackendBaseUrl() + '/api/admin/cases/' + encodeURIComponent(id) + '/images', filePath: filePath, name: 'file', timeout: 30000,
      header: { Authorization: 'Bearer ' + user.notificationSession }, formData: { version: String(version) }, success: function (r) {
        if (viewer !== portal.identity()) return reject(new Error('账号已变化，请重新打开案例'))
        var data; try { data = JSON.parse(r.data) } catch (_) { return reject(new Error('图片上传未成功，请重试')) }
        if (r.statusCode >= 200 && r.statusCode < 300 && data.ok) resolve(data)
        else reject(Object.assign(new Error(data.error || '上传失败'), { statusCode: r.statusCode }))
      }, fail: function () { reject(new Error('图片上传失败，请检查网络')) } })
  })
}
module.exports = { call: call, photos: photos, cards: cards, card: card, upload: upload, identity: portal.identity }
