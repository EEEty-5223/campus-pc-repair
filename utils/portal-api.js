var api = require('./api-request')
function call(path, method, data) { return api.memberRequest(path, method || 'GET', data || {}) }
function identity() { var u = getApp().globalData || {}; return [u.openid, u.notificationSession, u.role].join(':') }
function absolute(path) { return path && path.charAt(0) === '/' ? api.getBackendBaseUrl() + path : path }
// Native image loading can reject HTTP development URLs even when API calls work.
// Use WeChat-managed temporary files for images served by the local backend.
var avatarDownloads = Object.create(null)
function image(path, options) {
  options = options || {}
  var url = absolute(path)
  if (!url || !/^http:\/\//i.test(url)) return Promise.resolve(url || '')
  if (options.cache !== false && avatarDownloads[url]) return avatarDownloads[url]
  var pending = new Promise(function (resolve, reject) {
    wx.downloadFile({ url: url, timeout: 15000,
      success: function (response) {
        if (response.statusCode === 200 && response.tempFilePath) resolve(response.tempFilePath)
        else reject(new Error(options.error || '图片加载失败，请点击重试'))
      },
      fail: function () { reject(new Error(options.error || '图片加载失败，请确认手机能连接本地后端后重试')) }
    })
  })
  if (options.cache === false) return pending
  avatarDownloads[url] = pending
  var keys = Object.keys(avatarDownloads)
  if (keys.length > 40) delete avatarDownloads[keys[0]]
  pending.catch(function () { if (avatarDownloads[url] === pending) delete avatarDownloads[url] })
  return pending
}
function avatar(path) { return image(path, { error: '头像加载失败，请重新加载资料' }) }
function forgetAvatar(path) { delete avatarDownloads[absolute(path)] }
function discard(path) {
  if (!/^\/uploads\/portal-[a-f0-9]{32}\.(jpg|png|webp|gif)$/.test(path || '')) return Promise.resolve()
  return call('/api/portal/images/' + encodeURIComponent(path.split('/').pop()), 'DELETE').catch(function () {})
}
function discardAll(paths) { return Promise.all((paths || []).map(discard)) }
function upload(filePath) {
  var viewer = identity(), user = getApp().globalData || {}
  return new Promise(function (resolve, reject) {
    wx.uploadFile({ url: api.getBackendBaseUrl() + '/api/portal/images', filePath: filePath, name: 'file', timeout: 30000, header: { Authorization: 'Bearer ' + user.notificationSession },
      success: function (response) {
        if (viewer !== identity()) return reject(new Error('账号已变化，请重新操作'))
        var data; try { data = JSON.parse(response.data) } catch (_) { return reject(new Error('图片上传失败')) }
        if (response.statusCode >= 200 && response.statusCode < 300 && data.ok && data.path) resolve(data.path)
        else reject(new Error(data.error || '图片上传失败'))
      }, fail: function () { reject(new Error('图片上传失败，请检查网络')) } })
  })
}
function date(value) { if (!value) return ''; var d = new Date(value); return isNaN(d.getTime()) ? '' : d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0') }
function article(row) { return Object.assign({}, row, { coverUrl: absolute(row.cover), categoryText: row.category === 'apps' ? '常用应用' : '电脑使用', dateText: date(row.publishedAt || row.updatedAt) }) }
function articles(rows) {
  return Promise.all(rows.map(function (row) {
    var value = article(row)
    return image(row.cover).then(function (url) { return Object.assign(value, { coverUrl: url, coverFailed: false }) }, function () { return Object.assign(value, { coverUrl: '', coverFailed: !!row.cover }) })
  }))
}
function blocks(rows) {
  return Promise.all(rows.map(function (row) {
    if (row.type !== 'image') return row
    return image(row.src).then(function (url) { return Object.assign({}, row, { url: url, failed: false }) }, function () { return Object.assign({}, row, { url: '', failed: true }) })
  }))
}
function coverError(page, event) {
  var id = event.currentTarget.dataset.id, items = page.data.items || [], index = items.findIndex(function (item) { return item.id === id })
  if (index < 0) return
  forgetAvatar(items[index].cover)
  var next = items.slice(); next[index] = Object.assign({}, items[index], { coverUrl: '', coverFailed: true }); page.setData({ items: next })
}
function retryCover(page, event) {
  var id = event.currentTarget.dataset.id, row = (page.data.items || []).find(function (item) { return item.id === id })
  if (!row) return Promise.resolve()
  var viewer = identity(), epoch = page._epoch
  forgetAvatar(row.cover)
  return articles([row]).then(function (values) {
    if (!page._visible || page._disposed || viewer !== identity() || epoch !== page._epoch) return
    var next = page.data.items.slice(), index = next.findIndex(function (item) { return item.id === id && item.cover === row.cover })
    if (index >= 0) { next[index] = values[0]; page.setData({ items: next }) }
  })
}
module.exports = { call: call, identity: identity, absolute: absolute, image: image, avatar: avatar, forgetAvatar: forgetAvatar, upload: upload, discard: discard, discardAll: discardAll, date: date, article: article, articles: articles, blocks: blocks, coverError: coverError, retryCover: retryCover }
