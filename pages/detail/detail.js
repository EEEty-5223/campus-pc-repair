var appointments = require('../../utils/appointments')
var api = require('../../utils/api-request.js')
var adminActions = require('../../utils/appointment-admin-actions')
var USE_BACKEND = true

Page({
  data: {
    evidence: null,
    evidenceError: '',
    id: '',
    isRealAdmin: false,
    adminActionBusy: false,
    item: null,
    role: 'user',
    chatText: '',
    sending: false,
    startCode: '',
    startCodeLoading: false,
    startCodeError: '',
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
    this._subscriptionDisposed = false
    var self = this
    var app = getApp()
    this._detailVisible = true
    this._detailDisposed = false
    if (this.data.role === 'admin') {
      var direct = require('../../utils/direct-staff-subscription'), ready = app.globalData.loginReady
      Promise.resolve(ready).then(function () { if (self._detailVisible) direct.prepare(self) }, function () {})
    }
    var version = this._detailVersion = (this._detailVersion || 0) + 1
    this.setData({ completionCode: '', startCode: '', codeError: '', startCodeError: '', startCodeLoading: false })
    function load() { if (self._detailVisible && version === self._detailVersion) { var u = app.globalData || {}; self.setData({ isRealAdmin: u.role === 'admin' && !!u.notificationSession && !u.isSimulator, adminActionBusy: !!self._adminActionBusy }); return self.loadItem().then(function () { if (self._detailVisible && version === self._detailVersion) self.schedulePhasePolling() }) } }
    // 等登录完成再拉数据,避免 openid 还没拿到时显示本地旧数据
    if (app && app.globalData && app.globalData.loginReady) {
      app.globalData.loginReady
        .then(load)
        .catch(load)
    } else {
      load()
    }
  },
  onHide: function () { require('../../utils/direct-staff-subscription').hide(this); this.stopPhasePolling(); this._phaseCodeLoad = (this._phaseCodeLoad || 0) + 1; this._detailVisible = false; this._detailVersion = (this._detailVersion || 0) + 1; this._itemLoad = (this._itemLoad || 0) + 1; this._codeLoad = (this._codeLoad || 0) + 1; this._startCodeLoad = (this._startCodeLoad || 0) + 1; if (!this._detailDisposed) this.setData({ completionCode: '', startCode: '', startCodeLoading: false }) },
  onUnload: function () { require('../../utils/direct-staff-subscription').dispose(this); this._detailDisposed = true; this.onHide() },
  detailIdentity: function () { var u = (getApp() && getApp().globalData) || {}; return [u.openid, u.notificationSession, this.data.id, this.data.role].join(':') },
  loadCompletionCode: function () { return this.loadPhaseCode() },
  loadStartCode: function () { return this.loadPhaseCode() },
  loadPhaseCode: function (retried) {
    var self = this, item = this.data.item, status = item && item.status
    var beforeStart = ['pending', 'accepted'].indexOf(status) !== -1
    var allowed = this.data.role === 'user' && item && !item.isVoided && (beforeStart || status === 'repairing') && this._detailVisible !== false
    var version = this._phaseCodeLoad = (this._phaseCodeLoad || 0) + 1, who = this.detailIdentity()
    this.setData({ startCode: '', completionCode: '', startCodeError: '', codeError: '', startCodeLoading: !!allowed && beforeStart, codeLoading: !!allowed && !beforeStart })
    if (!allowed) return Promise.resolve()
    function current() { return self._detailVisible !== false && version === self._phaseCodeLoad && who === self.detailIdentity() && self.data.item && !self.data.item.isVoided && self.data.item.status === status }
    return Promise.resolve().then(function () { return beforeStart ? api.getStartCode(item.id) : api.getCompletionCode(item.id) }).then(function (result) {
      if (!current()) return
      if (!result) throw new Error('code unavailable')
      if (result.isVoided || result.status && result.status !== status) {
        var next = Object.assign({}, self.data.item, { status: result.status || status, isVoided: !!result.isVoided, voidReason: result.voidReason || '', voidedAt: result.voidedAt || '' })
        if (next.isVoided || ['completed', 'cancelled'].indexOf(next.status) !== -1) next.canReply = false
        self.setData({ item: appointments.decorate ? appointments.decorate(next) : next, startCode: '', completionCode: '', startCodeLoading: false, codeLoading: false })
        if (!retried && !next.isVoided && ['pending', 'accepted', 'repairing'].indexOf(next.status) !== -1) return self.loadPhaseCode(true)
        return
      }
      var code = beforeStart ? result.startCode : result.completionCode
      if (!/^\d{4}$/.test(code || '')) throw new Error('code unavailable')
      self.setData(beforeStart ? { startCode: code } : { completionCode: code })
    }).catch(function () {
      if (current()) self.setData(beforeStart ? { startCodeError: '开工码暂时无法加载，请刷新重试。' } : { codeError: '完成码暂时无法加载，请刷新重试。' })
    }).then(function () { if (version === self._phaseCodeLoad && who === self.detailIdentity() && self._detailVisible !== false) self.setData({ startCodeLoading: false, codeLoading: false }) })
  },
  stopPhasePolling: function () { if (this._phaseTimer) clearTimeout(this._phaseTimer); this._phaseTimer = null },
  schedulePhasePolling: function () {
    var self = this
    this.stopPhasePolling()
    if (typeof setTimeout === 'undefined' || typeof api.getAppointment !== 'function' || this._detailVisible !== true || this.data.role !== 'user' || !this.data.item || this.data.item.isVoided || ['pending', 'accepted', 'repairing'].indexOf(this.data.item.status) === -1) return
    var who = this.detailIdentity(), version = this._detailVersion
    function current() { return self._detailVisible === true && version === self._detailVersion && who === self.detailIdentity() }
    this._phaseTimer = setTimeout(function () {
      if (!current()) return
      api.getAppointment(self.data.id).then(function (response) {
        if (!current()) return
        var next = response && response.item, old = self.data.item
        if (next && old && (next.status !== old.status || !!next.isVoided !== !!old.isVoided)) return self.loadItem()
      }).catch(function () {}).then(function () { if (current()) self.schedulePhasePolling() })
    }, 5000)
  },
  loadItem: function () {
    var self = this, id = this.data.id, who = this.detailIdentity(), version = this._itemLoad = (this._itemLoad || 0) + 1
    var app = getApp(), openid = (app && app.globalData && app.globalData.openid) || ''
    function current() { return self._detailVisible !== false && who === self.detailIdentity() && version === self._itemLoad }
    this._phaseCodeLoad = (this._phaseCodeLoad || 0) + 1
    this._codeLoad = (this._codeLoad || 0) + 1
    this._startCodeLoad = (this._startCodeLoad || 0) + 1
    this.setData({ item: null, evidence: null, evidenceError: '', completionCode: '', startCode: '', codeError: '', codeLoading: false, startCodeError: '', startCodeLoading: false, loading: true, loadError: '' })
    var fetch = typeof api.getAppointment === 'function' ? api.getAppointment(id) : (this.data.role === 'admin' ? api.getAdminAppointments() : (openid ? api.getMyAppointments(openid) : Promise.reject(new Error('login required'))))
    return fetch.then(function (r) {
      if (!current()) return
      if (!r || (!r.item && !Array.isArray(r.list))) throw new Error('invalid appointments')
      var item = r.item || r.list.find(function (x) { return x.id === id })
      if (!item) throw new Error('appointment missing')
      self.setData({ item: appointments.decorate ? appointments.decorate(item) : item, loading: false })
      self.loadEvidence()
      return self.loadPhaseCode()
    }).catch(function () { if (current()) self.setData({ item: null, completionCode: '', startCode: '', loading: false, loadError: '预约暂时无法加载，请刷新重试。' }) })
  },
  subscribeMessages: function () { if (this.data.role === 'admin') return require('../../utils/direct-staff-subscription').tap(this); wx.navigateTo({ url: '/pages/subscriptions/subscriptions?id=' + encodeURIComponent(this.data.id) }) },
  loadEvidence: function () {
    var self = this, who = this.detailIdentity(), version = this._itemLoad, evidenceLoad = this._evidenceLoad = (this._evidenceLoad || 0) + 1
    function current() { return self._detailVisible && who === self.detailIdentity() && version === self._itemLoad && evidenceLoad === self._evidenceLoad }
    this.setData({ evidence: null, evidenceError: '' })
    if (!this.data.item || this.data.item.status !== 'completed') return Promise.resolve()
    var completion = require('../../utils/completion-api')
    return completion.context(this.data.id).then(function (result) {
      if (!current()) return
      return completion.evidenceImages(result.completion).then(function (evidence) {
        if (current()) self.setData({ evidence: evidence, evidenceError: evidence && evidence.photos.some(function (photo) { return photo.failed }) ? '部分完工照片加载失败' : '' })
      })
    }).catch(function (error) { if (current()) self.setData({ evidenceError: error.statusCode === 403 ? '' : '完工记录暂时无法加载' }) })
  },
  evidenceImageFailed: function () { this.setData({ evidenceError: '完工照片加载失败' }) },
  previewEvidence: function (event) { var photos = this.data.evidence && this.data.evidence.photos || [], urls = photos.filter(function (p) { return p.url && !p.failed }).map(function (p) { return p.url }); if (urls.length) wx.previewImage({ current: event.currentTarget.dataset.url || urls[0], urls: urls }) },
  resubmitEvidence: function () {
    if (!this.data.evidence || !this.data.evidence.canResubmit || this._resubmitting) return
    var self = this, who = this.detailIdentity()
    wx.showModal({ title: '补充说明并重新审核', editable: true, placeholderText: '说明不方便拍照的原因与核实情况', confirmText: '重新提交', success: function (r) {
      if (!r.confirm || !self._detailVisible || who !== self.detailIdentity() || self._resubmitting) return
      var note = String(r.content || '').trim()
      if (!note || note.length > 1000) { wx.showToast({ title: '请填写1至1000字说明', icon: 'none' }); return }
      self._resubmitting = true
      api.memberRequest('/api/appointments/' + encodeURIComponent(self.data.id) + '/completion/resubmit', 'POST', { note: note }).then(function () { if (who === self.detailIdentity() && self._detailVisible) return self.loadItem() }).catch(function (e) { if (self._detailVisible && who === self.detailIdentity()) wx.showToast({ title: e.message || '提交失败', icon: 'none' }) }).then(function () { self._resubmitting = false })
    } })
  },
  forceStatus: adminActions.forceStatus,
  forceComplete: adminActions.forceComplete,
  voidAppointment: adminActions.voidAppointment,
  restoreAppointment: adminActions.restoreAppointment,
  copyPhone: function (event) { var phone = String(event.currentTarget.dataset.phone || '').replace(/[^0-9+]/g, ''); if (phone) wx.setClipboardData({ data: phone, success: function () { wx.showToast({ title: '手机号已复制', icon: 'success' }) } }) },
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
    if (!this.data.item || this.data.item.canChat === false) return
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
