var appointments = require('../../utils/appointments')
var api = require('../../utils/api-request.js')
var unread = require('../../utils/chat-unread')
var LEAVE_MESSAGE = '离开聊天后收不到新消息推送，请回首页“快速沟通”查看未读消息。'
Page({
  data: { id: '', role: 'user', item: null, chatText: '', sending: false, scrollIntoView: '', loading: false, loadError: '', nativeLeavePrompt: false },
  onLoad: function (options) { this._requestedAdmin = !!(options && options.role === 'admin'); this.setData({ id: (options && options.id) || '' }) },
  resolveViewerRole: function () {
    var user = (getApp() && getApp().globalData) || {}
    return this._requestedAdmin && user.notificationSession && !user.isSimulator && user.openid !== 'simulator_openid_dev' && ['admin', 'leader', 'member'].indexOf(user.role) !== -1 ? 'admin' : 'user'
  },
  chatIdentity: function () {
    var user = (getApp() && getApp().globalData) || {}
    return (user.openid || '') + ':' + (user.notificationSession || '') + ':' + (user.role || '') + ':' + this.data.id + ':' + this.resolveViewerRole()
  },
  onShow: function () {
    var self = this, app = getApp(), version = (this._visibilityVersion || 0) + 1
    this._disposed = false; this._visible = true; this._visibilityVersion = version; this.stopPolling(); this.setData({ sending: false })
    if (typeof wx.enableAlertBeforeUnload === 'function') {
      try { wx.enableAlertBeforeUnload({ message: LEAVE_MESSAGE,
        success: function () { if (self._visible && version === self._visibilityVersion) self.setData({ nativeLeavePrompt: true }) },
        fail: function () { if (self._visible && version === self._visibilityVersion) self.setData({ nativeLeavePrompt: false }) }
      }) } catch (_) { this.setData({ nativeLeavePrompt: false }) }
    }
    var begin = function () {
      if (!self._visible || version !== self._visibilityVersion) return
      var identity = self.chatIdentity()
      if (self._viewerIdentity !== identity) self.setData({ item: null, chatText: '', sending: false })
      self._viewerIdentity = identity; self.setData({ role: self.resolveViewerRole() })
      return self.loadItem().then(function () {
        var selected = self._selectedImage
        if (self._visible && selected && selected.identity === self.chatIdentity()) { self._selectedImage = null; return self.sendImage(selected.file) }
      }).then(function () { self.schedulePolling() })
    }
    var ready = app && app.globalData && app.globalData.loginReady
    return ready ? Promise.resolve(ready).then(begin, begin) : begin()
  },
  stopPolling: function () { if (this._pollTimer) { clearTimeout(this._pollTimer); this._pollTimer = null } },
  schedulePolling: function () {
    var self = this; this.stopPolling()
    if (this._visible) this._pollTimer = setTimeout(function () { self._pollTimer = null; if (self._visible) self.loadItem().then(function () { self.schedulePolling() }) }, 5000)
  },
  onHide: function () { this._visible = false; this._visibilityVersion = (this._visibilityVersion || 0) + 1; this._loadId = (this._loadId || 0) + 1; this._sendNonce = (this._sendNonce || 0) + 1; this.stopPolling(); if (!this._disposed) this.setData({ sending: false }); this.disableLeavePrompt() },
  onUnload: function () { this._disposed = true; this._selectedImage = null; this.onHide() },
  disableLeavePrompt: function () { if (typeof wx.disableAlertBeforeUnload === 'function') { try { wx.disableAlertBeforeUnload({}) } catch (_) {} } },
  leaveChat: function () {
    var self = this, identity = this.chatIdentity()
    wx.showModal({ title: '离开聊天', content: LEAVE_MESSAGE, confirmText: '回首页', cancelText: '继续聊天', success: function (result) {
      if (!result.confirm || !self._visible || identity !== self.chatIdentity()) return
      self.disableLeavePrompt(); wx.switchTab({ url: '/pages/index/index', fail: function () { if (self._visible) self.onShow() } })
    } })
  },
  loadItem: function () {
    var self = this, id = this.data.id
    if (!this._visible || !id) return Promise.resolve()
    var user = (getApp() && getApp().globalData) || {}, openid = user.openid || ''
    var identity = this.chatIdentity(), version = this._visibilityVersion, loadId = (this._loadId || 0) + 1
    if (this._viewerIdentity && this._viewerIdentity !== identity) this.setData({ item: null, chatText: '' })
    this._viewerIdentity = identity
    this._loadId = loadId
    var current = function () { return self._visible && version === self._visibilityVersion && loadId === self._loadId && identity === self.chatIdentity() }
    this.setData({ role: this.resolveViewerRole(), loading: !this.data.item, loadError: '' })
    var fetch = typeof api.getAppointment === 'function' ? api.getAppointment(id) : (this.data.role === 'admin' ? api.getAdminAppointments() : (openid ? api.getMyAppointments(openid) : Promise.reject(new Error('请先登录'))))
    return fetch.then(function (response) {
      if (!current()) return null
      if (!response || (!response.item && !Array.isArray(response.list))) throw new Error('预约资料无法读取')
      var item = response.item || response.list.find(function (record) { return String(record.id) === String(id) })
      if (!item) throw new Error('未找到可查看的预约')
      if (item.canChat === false) throw Object.assign(new Error('你当前无权查看该预约聊天'), { code: 'APPOINTMENT_FORBIDDEN' })
      return api.getMessages(id).then(function (response) {
        if (!response || !Array.isArray(response.list)) throw new Error('沟通记录无法读取')
        return Object.assign({}, item, { messages: response.list, isVoided: response.isVoided === undefined ? item.isVoided : response.isVoided, canReply: response.canReply === undefined ? item.canReply : response.canReply })
      })
    }).then(function (item) {
      if (!current() || !item) return
      var decorated = appointments.decorate ? appointments.decorate(item) : item
      decorated.messages = (decorated.messages || []).map(function (message) {
        var notice = message.kind === 'assignment_notice', adminNotice = message.kind === 'admin_notice' || message.kind === 'admin_intervention'
        var own = message.senderOpenid ? message.senderOpenid === openid : message.from === self.data.role
        var label = message.senderName || (message.from === 'admin' ? '社团成员' : (self.data.role === 'admin' ? '预约用户' : '我'))
        return Object.assign({}, message, { viewerClass: notice ? 'msg-assignment' : (adminNotice ? 'msg-admin-notice' : (own ? 'msg-own' : 'msg-other')), fromText: notice ? '人员分配通知' : label, isAssignmentNotice: notice, isAdminNotice: adminNotice })
      })
      decorated.canReply = !decorated.isVoided && decorated.canReply
      var last = decorated.messages[decorated.messages.length - 1]
      self.setData({ item: decorated, loading: false, loadError: '', scrollIntoView: last ? 'msg-' + last.id : '' }, function () {
        if (current()) unread.markRead(openid, id, self.data.role, decorated.messages)
      })
    }).catch(function (error) { if (current()) { var patch = { loading: false, loadError: error.message || '聊天加载失败，请重试。' }; if (['APPOINTMENT_FORBIDDEN', 'APPOINTMENT_NOT_FOUND', 'MEMBER_REQUIRED', 'SESSION_EXPIRED', 'REAL_LOGIN_REQUIRED'].indexOf(error.code) !== -1) patch.item = null; else if (self.data.item) patch.item = Object.assign({}, self.data.item, { canReply: false }); self.setData(patch) } })
  },
  onChatInput: function (event) { this.setData({ chatText: event.detail.value }) },
  sendMessage: function () {
    var self = this, text = String(this.data.chatText || '').trim(), identity = this.chatIdentity()
    if (!text) { wx.showToast({ title: '请输入内容', icon: 'none' }); return Promise.resolve() }
    if (this._sendInFlight || this.data.sending || !this._visible || this._disposed || !this.data.item || !this.data.item.canReply) return Promise.resolve()
    var version = this._visibilityVersion, nonce = (this._sendNonce || 0) + 1
    this._sendNonce = nonce; this._sendInFlight = true
    var current = function () { return self._visible && !self._disposed && self._visibilityVersion === version && self._sendNonce === nonce && identity === self.chatIdentity() }
    this.setData({ sending: true })
    return api.sendMessage(this.data.id, this.data.role, text).then(function () {
      self._sendInFlight = false
      if (!current()) return
      self.setData({ sending: false, chatText: '' }); if (self._visible) return self.loadItem()
    }).catch(function (error) { self._sendInFlight = false; if (current()) { self.setData({ sending: false, item: Object.assign({}, self.data.item, { canReply: false }) }); wx.showToast({ title: error.message || '发送失败，请重试', icon: 'none' }); return self.loadItem() } })
  },
  chooseImage: function () {
    var self = this, identity = this.chatIdentity()
    if (this._sendInFlight || this.data.sending || this._disposed || !this.data.item || !this.data.item.canReply) return
    wx.chooseMedia({ count: 1, mediaType: ['image'], sourceType: ['album', 'camera'], success: function (result) {
      if (self._disposed || identity !== self.chatIdentity()) return
      var file = result.tempFiles && result.tempFiles[0] && result.tempFiles[0].tempFilePath
      if (file) { if (self._visible) self.sendImage(file); else self._selectedImage = { file: file, identity: identity } }
    }, fail: function () { if (self._visible) wx.showToast({ title: '未选择图片', icon: 'none' }) } })
  },
  sendImage: function (filePath) {
    var self = this, identity = this.chatIdentity()
    if (this._sendInFlight || this.data.sending || !this._visible || this._disposed || !this.data.item || !this.data.item.canReply) return Promise.resolve()
    var version = this._visibilityVersion, nonce = (this._sendNonce || 0) + 1
    this._sendNonce = nonce; this._sendInFlight = true
    var current = function () { return self._visible && !self._disposed && self._visibilityVersion === version && self._sendNonce === nonce && identity === self.chatIdentity() }
    this.setData({ sending: true })
    return api.uploadImage(filePath).then(function (imageUrl) {
      if (!current()) throw new Error('页面或登录状态已改变')
      return api.sendImageMessage(self.data.id, self.data.role, imageUrl)
    }).then(function () { self._sendInFlight = false; if (current()) { self.setData({ sending: false }); return self.loadItem() } })
      .catch(function (error) { self._sendInFlight = false; if (current()) { self.setData({ sending: false, item: Object.assign({}, self.data.item, { canReply: false }) }); wx.showToast({ title: error.message || '图片发送失败，请重试', icon: 'none' }); return self.loadItem() } })
  },
  copyPhone: function (event) { var phone = String(event.currentTarget.dataset.phone || '').replace(/[^0-9+]/g, ''); if (phone) wx.setClipboardData({ data: phone, success: function () { wx.showToast({ title: '手机号已复制', icon: 'success' }) } }) },
  previewImage: function (event) { var url = event.currentTarget.dataset.url; if (url) wx.previewImage({ urls: [url], current: url }) }
})
