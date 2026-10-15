var appointments = require('../../utils/appointments')
var api = require('../../utils/api-request.js')
var USE_BACKEND = true

Page({
  data: {
    id: '',
    item: null,
    role: 'user',
    chatText: '',
    sending: false,
    completionCode: '',
    codeLoading: false,
    codeError: '',
    loading: false,
    loadError: '',
    scrollIntoView: ''
  },

  onLoad: function (options) {
    this.setData({
      id: options.id || '',
      role: options.role === 'admin' ? 'admin' : 'user'
    })
  },

  onShow: function () {
    var self = this
    var app = getApp()
    this._detailVisible = true
    this._detailDisposed = false
    var version = this._detailVersion = (this._detailVersion || 0) + 1
    this.setData({ completionCode: '', codeError: '' })
    function load() { if (self._detailVisible && version === self._detailVersion) return self.loadItem() }
    // 等登录完成再拉数据,避免 openid 还没拿到时显示本地旧数据
    if (app && app.globalData && app.globalData.loginReady) {
      app.globalData.loginReady
        .then(load)
        .catch(load)
    } else {
      load()
    }
  },
  onHide: function () { this._detailVisible = false; this._detailVersion = (this._detailVersion || 0) + 1; this._itemLoad = (this._itemLoad || 0) + 1; this._codeLoad = (this._codeLoad || 0) + 1; if (!this._detailDisposed) this.setData({ completionCode: '' }) },
  onUnload: function () { this._detailDisposed = true; this.onHide() },
  detailIdentity: function () { var u = (getApp() && getApp().globalData) || {}; return [u.openid, u.notificationSession, this.data.id, this.data.role].join(':') },
  loadCompletionCode: function () {
    var self = this, item = this.data.item
    if (this.data.role !== 'user' || !item || ['pending', 'accepted', 'repairing'].indexOf(item.status) === -1 || this._detailVisible === false) { this.setData({ completionCode: '', codeError: '', codeLoading: false }); return Promise.resolve() }
    var who = this.detailIdentity(), version = this._codeLoad = (this._codeLoad || 0) + 1
    function current() { return self._detailVisible !== false && who === self.detailIdentity() && version === self._codeLoad && self.data.item && ['pending', 'accepted', 'repairing'].indexOf(self.data.item.status) !== -1 }
    this.setData({ completionCode: '', codeError: '', codeLoading: true })
    return api.getCompletionCode(item.id).then(function (r) {
      if (!current()) return
      if (r && r.ended && ['completed', 'cancelled'].indexOf(r.status) !== -1) { var ended = Object.assign({}, self.data.item, { status: r.status }); self.setData({ item: appointments.decorate ? appointments.decorate(ended) : ended, completionCode: '', codeLoading: false }); return }
      if (!r || !/^\d{4}$/.test(r.completionCode || '')) throw new Error('invalid completion code')
      self.setData({ completionCode: r.completionCode })
    }).catch(function () { if (current()) self.setData({ completionCode: '', codeError: '确认码暂时无法加载，请刷新重试。' }) }).then(function () { if (current()) self.setData({ codeLoading: false }) })
  },

  loadItem: function () {
    var self = this, id = this.data.id, who = this.detailIdentity(), version = this._itemLoad = (this._itemLoad || 0) + 1
    var app = getApp(), openid = (app && app.globalData && app.globalData.openid) || ''
    function current() { return self._detailVisible !== false && who === self.detailIdentity() && version === self._itemLoad }
    this._codeLoad = (this._codeLoad || 0) + 1
    this.setData({ item: null, completionCode: '', codeError: '', codeLoading: false, loading: true, loadError: '' })
    var fetch = this.data.role === 'admin' ? api.getAdminAppointments() : (openid ? api.getMyAppointments(openid) : Promise.reject(new Error('login required')))
    return fetch.then(function (r) {
      if (!current()) return
      if (!r || !Array.isArray(r.list)) throw new Error('invalid appointments')
      var item = r.list.find(function (x) { return x.id === id })
      if (!item) throw new Error('appointment missing')
      self.setData({ item: appointments.decorate ? appointments.decorate(item) : item, loading: false })
      return self.loadCompletionCode()
    }).catch(function () { if (current()) self.setData({ item: null, completionCode: '', loading: false, loadError: '预约暂时无法加载，请刷新重试。' }) })
  },
  editBooking: function () {
    wx.navigateTo({
      url: '/pages/booking/booking?id=' + this.data.id
    })
  },

  cancelBooking: function () {
    var that = this
    wx.showModal({
      title: '取消预约',
      content: '确定取消这次预约吗？取消后状态无法自行恢复。',
      confirmText: '确认取消',
      confirmColor: '#DC2626',
      success: function (result) {
        if (!result.confirm) {
          return
        }
        if (USE_BACKEND) {
          (that.data.role === 'admin' ? api.updateStatus(that.data.id, 'cancelled') : api.cancelOwnAppointment(that.data.id))
            .then(function () {
              that.loadItem()
              wx.showToast({ title: '已取消', icon: 'success' })
            })
            .catch(function (err) {
              wx.showToast({ title: '取消失败:' + (err.message || err), icon: 'none' })
              that.loadItem()
            })
          return
        }
        var changed = appointments.updateStatus(that.data.id, 'cancelled')
        if (!changed) {
          wx.showToast({ title: '状态已变化，无法取消', icon: 'none' })
          that.loadItem()
          return
        }
        that.loadItem()
        wx.showToast({ title: '已取消', icon: 'success' })
      }
    })
  },

  goChat: function () {
    wx.navigateTo({
      url: '/pages/chat/chat?id=' + this.data.id + '&role=' + this.data.role
    })
  },

  onChatInput: function (event) {
    this.setData({ chatText: event.detail.value })
  },

  sendMessage: function () {
    var self = this
    var text = String(this.data.chatText || '').trim()
    if (!text) {
      wx.showToast({ title: '请输入内容', icon: 'none' })
      return
    }
    if (this.data.sending) {
      return
    }

    this.setData({ sending: true })
    var app = getApp()
    var openid = (app && app.globalData && app.globalData.openid) || ''

    if (USE_BACKEND) {
      api.sendMessage(self.data.id, self.data.role, text)
        .then(function () {
          self.setData({ sending: false, chatText: '' })
          self.loadItem()
        })
        .catch(function (err) {
          self.setData({ sending: false })
          wx.showToast({ title: '发送失败:' + (err.message || err), icon: 'none' })
        })
      return
    }

    var changed = appointments.addMessage(self.data.id, self.data.role, text)
    self.setData({ sending: false })

    if (!changed) {
      wx.showToast({ title: '发送失败，请重试', icon: 'none' })
      return
    }

    self.setData({ chatText: '' })
    self.loadItem()
  }
})
