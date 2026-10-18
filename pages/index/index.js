var appointments = require('../../utils/appointments')
var api = require('../../utils/api-request.js')
var unread = require('../../utils/chat-unread')
var swipe = require('../../utils/swipe-navigation')
var USE_BACKEND = true

Page({
  data: {
    recordCount: null,
    recordCountLoading: true,
    recordCountError: false,
    isAdmin: false,
    unreadCount: 0,
    unreadText: '',
    unreadError: false,
    services: [
      { id: 'system', icon: '💻', name: '系统问题', desc: '蓝屏、卡顿、系统安装' },
      { id: 'maintenance', icon: '🧹', name: '清灰维护', desc: '除尘、硅脂与基础保养' },
      { id: 'hardware', icon: '🔧', name: '硬件排查', desc: '无法开机、异响、外设故障' },
      { id: 'network', icon: '🌐', name: '网络软件', desc: '网络连接与上网故障' }
    ],
    steps: [
      { number: '1', title: '填写预约', desc: '描述设备和故障' },
      { number: '2', title: '社团确认', desc: '确认后回复并预约成功' },
      { number: '3', title: '到场处理', desc: '检测后再确认维修' }
    ]
  },

  onNavigationTouchStart: function (event) { swipe.start(this, event) },
  onNavigationTouchMove: function (event) { swipe.move(this, event) },
  onNavigationTouchCancel: function () { swipe.cancel(this) },
  onNavigationTouchEnd: function (event) {
    var gesture = swipe.end(this, event)
    if (gesture && gesture.direction === 'left') swipe.switchMainTab(this, '/pages/guides/guides')
  },

  onShow: function () {
    var self = this
    var app = getApp()
    var account = (app && app.globalData && app.globalData.openid) || ''
    if (self._unreadAccount !== account) { self._unreadAccount = account; self.setData({ unreadCount: 0, unreadText: '', unreadError: false }) }
    self._homeVisible = true
    var epoch = self._homeEpoch = (self._homeEpoch || 0) + 1
    self.stopUnreadPolling()
    self.setData({ recordCount: null, recordCountLoading: true, recordCountError: false })
    // 等登录完成再拉数据,避免 openid 还没拿到时显示本地旧数据
    var doLoad = function () {
      if (!self._homeVisible || self._homeEpoch !== epoch) return
      // 登录完成后同步管理员状态
      var isAdmin = !!(app && app.globalData && app.globalData.isAdmin)
      self.setData({ isAdmin: isAdmin })
      if (typeof app.checkMemberPhone === 'function') app.checkMemberPhone()
      self.loadRecordCount()
      self.refreshUnread()
      self._unreadTimer = setInterval(function () { self.refreshUnread() }, 10000)
    }
    if (app && app.globalData && app.globalData.loginReady) {
      app.globalData.loginReady
        .then(doLoad)
        .catch(doLoad)
    } else {
      doLoad()
    }
  },

  onHide: function () { swipe.cancel(this); this._homeVisible = false; this._homeEpoch = (this._homeEpoch || 0) + 1; this._unreadRequest = (this._unreadRequest || 0) + 1; this.stopUnreadPolling() },
  onUnload: function () { this.onHide() },
  stopUnreadPolling: function () { if (this._unreadTimer) clearInterval(this._unreadTimer); this._unreadTimer = null },
  refreshUnread: function () {
    var self = this, app = getApp(), openid = (app && app.globalData && app.globalData.openid) || ''
    if (!self._homeVisible || !openid || self._unreadBusy) return Promise.resolve()
    if (self._unreadAccount !== openid) { self._unreadAccount = openid; self.setData({ unreadCount: 0, unreadText: '', unreadError: false }) }
    var requestId = self._unreadRequest = (self._unreadRequest || 0) + 1
    var current = function () { var a = getApp(); return self._homeVisible && self._unreadRequest === requestId && a && a.globalData.openid === openid }
    self._unreadBusy = true
    return unread.overview(openid, api).then(function (result) {
      if (current()) self.setData({ unreadCount: result.total, unreadText: result.total > 99 ? '99+' : String(result.total), unreadError: false })
    }).catch(function () { if (current()) self.setData({ unreadError: true }) }).then(function () { self._unreadBusy = false })
  },

  loadRecordCount: function () {
    var self = this
    var app = getApp()
    // 同步管理员状态(防止从后台批准后回首页时没刷新)
    var isA = !!(app && app.globalData && app.globalData.isAdmin)
    self.setData({ isAdmin: isA })

    var requestId = (this._recordCountRequestId || 0) + 1
    this._recordCountRequestId = requestId
    if (USE_BACKEND) {
      var openid = (app && app.globalData && app.globalData.openid) || ''
      self.setData({ recordCount: null, recordCountLoading: true, recordCountError: false })
      if (!openid) {
        self.setData({ recordCountLoading: false, recordCountError: true })
        return Promise.resolve()
      }
      var isCurrent = function () {
        var currentApp = getApp()
        return self._recordCountRequestId === requestId && currentApp && currentApp.globalData && currentApp.globalData.openid === openid
      }
      return api.getMyAppointments(openid)
        .then(function (resp) {
          if (!isCurrent()) return
          if (!resp || !Array.isArray(resp.list)) throw new Error('预约列表格式错误')
          self.setData({ recordCount: resp.list.length, recordCountLoading: false, recordCountError: false })
        })
        .catch(function (err) {
          if (!isCurrent()) return
          console.error('[index] 拉取预约计数失败:', err.message)
          self.setData({ recordCount: null, recordCountLoading: false, recordCountError: true })
        })
    }
    self.setData({ recordCount: appointments.list().length, recordCountLoading: false, recordCountError: false })
    return Promise.resolve()
  },

  goBooking: function () {
    wx.navigateTo({ url: '/pages/booking/booking' })
  },

  goServiceBooking: function (event) {
    var service = event && event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.service
    if (['system', 'maintenance', 'hardware', 'network'].indexOf(service) === -1) return
    wx.navigateTo({ url: '/pages/booking/booking?service=' + service })
  },

  goRecords: function () {
    wx.navigateTo({ url: '/pages/records/records' })
  },

  goConsult: function () {
    wx.navigateTo({ url: '/pages/consult/consult' })
  }
})
