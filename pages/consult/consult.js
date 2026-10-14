var appointments = require('../../utils/appointments')
var api = require('../../utils/api-request.js')
var unread = require('../../utils/chat-unread')
var USE_BACKEND = true

var EXCLUDED_STATUSES = ['completed', 'cancelled']

Page({
  data: {
    items: [],
    loading: false,
    loadError: false
  },

  onShow: function () {
    var self = this
    var app = getApp()
    var account = (app && app.globalData && app.globalData.openid) || ''
    if (self._account !== account) { self._account = account; self.setData({ items: [], loading: false, loadError: false }) }
    self._visible = true
    var epoch = self._epoch = (self._epoch || 0) + 1
    self.stopPolling()
    // 等登录完成再拉数据,避免 openid 还没拿到时显示本地旧数据
    if (app && app.globalData && app.globalData.loginReady) {
      app.globalData.loginReady
        .then(function () { if (self._visible && self._epoch === epoch) { self.loadItems(); self._timer = setInterval(function () { self.loadItems() }, 10000) } })
        .catch(function () { if (self._visible && self._epoch === epoch) { self.loadItems(); self._timer = setInterval(function () { self.loadItems() }, 10000) } })
    } else {
      if (self._visible && self._epoch === epoch) { self.loadItems(); self._timer = setInterval(function () { self.loadItems() }, 10000) }
    }
  },

  onPullDownRefresh: function () {
    this.loadItems()
    wx.stopPullDownRefresh()
  },

  onHide: function () { this._visible = false; this._epoch = (this._epoch || 0) + 1; this._request = (this._request || 0) + 1; this.stopPolling() },
  onUnload: function () { this.onHide() },
  stopPolling: function () { if (this._timer) clearInterval(this._timer); this._timer = null },
  loadItems: function () {
    var self = this, app = getApp(), openid = (app && app.globalData && app.globalData.openid) || ''
    if (!openid || self._busy) return Promise.resolve()
    var requestId = self._request = (self._request || 0) + 1
    var current = function () { var a = getApp(); return self._visible && self._request === requestId && a && a.globalData.openid === openid }
    if (self._account !== openid) { self._account = openid; self.setData({ items: [] }) }
    self._busy = true
    if (!self.data.items.length) self.setData({ loading: true })
    return unread.overview(openid, api).then(function (result) {
      if (!current()) return
      var list = result.items.filter(function (item) { return EXCLUDED_STATUSES.indexOf(item.status) === -1 || result.counts[item.id] > 0 }).map(function (item) {
        var decorated = appointments.decorate ? appointments.decorate(item) : Object.assign({}, item)
        decorated.unreadCount = result.counts[item.id] || 0
        decorated.unreadText = decorated.unreadCount > 99 ? '99+' : String(decorated.unreadCount)
        return decorated
      })
      self.setData({ items: list, loading: false, loadError: false })
    }).catch(function () { if (current()) self.setData({ loading: false, loadError: true }) }).then(function () { self._busy = false })
  },

  goChat: function (event) {
    var id = event.currentTarget.dataset.id
    if (!id) {
      return
    }
    wx.navigateTo({
      url: '/pages/chat/chat?id=' + id + '&role=user'
    })
  },

  goBooking: function () {
    wx.navigateTo({ url: '/pages/booking/booking' })
  }
})
