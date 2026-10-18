var portal = require('./portal-api'), base = '/api/admin/message-subscriptions'
function state(page) {
  var viewer = portal.identity()
  if (!page._directSubscription || page._directSubscription.viewer !== viewer) {
    hide(page); page._directSubscription = { viewer: viewer, busy: false, pending: null }
    page.setData({ totalSubscriptionBusy: false, totalSubscriptionLabel: '准备中' })
  }
  return page._directSubscription
}
function current(page, s) { return !page._subscriptionDisposed && page._directSubscription === s && s.viewer === portal.identity() }
function visible(page) { return page._chatVisible || page._visible || page._detailVisible }
function label(page, s, text) { if (current(page, s)) page.setData({ totalSubscriptionBusy: s.busy, totalSubscriptionLabel: text }) }
function prepare(page) {
  var s = state(page)
  if (s.busy || s.loading || !visible(page)) return Promise.resolve()
  if (s.pending) { label(page, s, '登记未完成，点此重试'); return Promise.resolve() }
  if (s.challenge && s.deadline > Date.now() + 30000) { label(page, s, '点击订阅一次'); schedule(page, s); return Promise.resolve() }
  s.loading = true; s.challenge = null; hide(page); label(page, s, '准备中')
  return portal.call(base).then(function (r) {
    if (!current(page, s)) return
    s.status = r
    if (!r.available) { label(page, s, r.reason || '暂不可订阅'); return }
    return portal.call(base + '/challenge', 'POST', {}).then(function (c) {
      if (!current(page, s)) return
      s.challenge = c.challengeId
      s.deadline = Date.now() + Math.max(0, Math.min(270, Number(c.expiresInSeconds) || 240) - 10) * 1000
      label(page, s, '点击订阅一次'); schedule(page, s)
    })
  }).catch(function (e) { label(page, s, e.message || '准备失败，点击重试') }).then(function () { s.loading = false })
}
function schedule(page, s) {
  clearTimeout(s.timer)
  if (visible(page) && current(page, s)) s.timer = setTimeout(function () { s.challenge = null; prepare(page) }, Math.max(1000, s.deadline - Date.now() - 15000))
}
function save(page, s) {
  if (!current(page, s) || !s.pending || s.busy) return Promise.resolve()
  var pending = s.pending; s.busy = true; label(page, s, '正在登记')
  return portal.call(base, 'POST', pending).then(function () {
    if (!current(page, s)) return
    s.pending = null; s.challenge = null
    wx.showToast({ title: pending.result === 'accept' ? '已订阅一次总消息' : '本次未订阅', icon: 'none' })
  }).catch(function (e) {
    if (!current(page, s)) return
    if (e.statusCode === 409) { s.pending = null; s.challenge = null }
    label(page, s, s.pending ? '登记未完成，点此重试' : '登记已过期，请重新订阅')
    wx.showToast({ title: e.message || '登记失败，请点击重试', icon: 'none' })
  }).then(function () { s.busy = false; if (current(page, s)) page.setData({ totalSubscriptionBusy: false }); if (current(page, s) && !s.pending) return prepare(page) })
}
function tap(page) {
  var s = state(page)
  if (s.busy || s.loading) { wx.showToast({ title: '正在准备，请稍候', icon: 'none' }); return }
  if (s.pending) return save(page, s)
  if (!s.challenge || s.deadline <= Date.now() || !s.status || !s.status.available) {
    wx.showToast({ title: s.status && !s.status.available ? s.status.reason || '暂不可订阅' : '订阅准备中，请稍后点击', icon: 'none' }); return prepare(page)
  }
  if (typeof wx.requestSubscribeMessage !== 'function') { wx.showToast({ title: '请更新微信后重试', icon: 'none' }); return }
  var challenge = s.challenge, templateId = s.status.templateId
  s.busy = true; hide(page); label(page, s, '等待微信授权')
  // Preload first; authorization must run synchronously in the user's tap handler.
  wx.requestSubscribeMessage({ tmplIds: [templateId], success: function (r) {
    if (!current(page, s)) return
    s.busy = false; s.challenge = null
    var result = r[templateId]
    if (['accept', 'reject', 'ban'].indexOf(result) === -1) { label(page, s, '微信未返回授权，请重试'); prepare(page); return }
    s.pending = { challengeId: challenge, templateId: templateId, result: result }; save(page, s)
  }, fail: function () {
    s.busy = false; s.challenge = null
    if (current(page, s)) { label(page, s, '未完成授权，点击重试'); wx.showToast({ title: '未完成授权，请在手机微信中重试', icon: 'none' }); prepare(page) }
  } })
}
function hide(page) { if (page._directSubscription) clearTimeout(page._directSubscription.timer) }
function dispose(page) { page._subscriptionDisposed = true; hide(page) }
module.exports = { prepare: prepare, tap: tap, hide: hide, dispose: dispose }
