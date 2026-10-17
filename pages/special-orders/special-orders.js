var completion = require('../../utils/completion-api')
var session = { key: completion.viewerKey }
var labels = { pending: '待审核', approved: '审核通过', rejected: '审核未通过' }

function decorate(row) {
  return Object.assign({}, row, { id: String(row.id), statusText: labels[row.status] || '状态待确认', photos: Array.isArray(row.photos) ? row.photos : [] })
}
Page({
  data: { loading: true, error: '', forbidden: false, status: 'pending', items: [], pendingCount: null, hasMore: false, busyId: '', filters: [{ value: 'pending', label: '待审核' }, { value: 'approved', label: '已通过' }, { value: 'rejected', label: '未通过' }] },
  onLoad: function () { this._disposed = false },
  onShow: function () {
    var self = this
    this._visible = true
    this.setData({ busyId: this._reviewFlight && this._reviewFlight.viewer === session.key() ? this._reviewFlight.id : '' })
    Promise.resolve(getApp().globalData.loginReady).then(function () { if (self._visible && !self._disposed) return self.refresh() }).catch(function () {
      if (self._visible && !self._disposed) self.setData({ loading: false, error: '请登录负责人或管理员账号后重试。' })
    })
  },
  onHide: function () { this._visible = false; this._load = (this._load || 0) + 1 },
  onUnload: function () { this._disposed = true; this.onHide() },
  current: function (viewer) { return this._visible && !this._disposed && session.key() === viewer && this._viewer === viewer },
  onPullDownRefresh: function () { return this.refresh().then(function () { wx.stopPullDownRefresh() }) },
  refresh: function () { return this.loadList(false) },
  loadMore: function () { if (this.data.hasMore && !this.data.loading) return this.loadList(true) },
  loadList: function (append) {
    var self = this, user = getApp().globalData || {}, viewer = session.key()
    if (!this._visible || this._disposed) return Promise.resolve()
    if (this._viewer !== viewer) { this._viewer = viewer; this._reviewKeys = {}; this._page = 0; this.setData({ items: [], pendingCount: null, busyId: '' }) }
    var permitted = ['leader', 'admin'].indexOf(user.role) !== -1 && !!user.notificationSession && !user.isSimulator
    if (!permitted) { this.setData({ forbidden: true, loading: false, items: [], pendingCount: null, error: '' }); return Promise.resolve() }
    var load = this._load = (this._load || 0) + 1, filter = this.data.status, page = append ? (this._page || 1) + 1 : 1
    this.setData({ forbidden: false, loading: true, error: '' })
    return completion.list(filter, page).then(function (result) {
      if (!self.current(viewer) || load !== self._load) return
      if (!Array.isArray(result.list) || !Number.isInteger(result.pendingCount) || result.pendingCount < 0 || result.list.some(function (row) { return !row.id || !row.appointmentId || !labels[row.status] })) throw new Error('invalid review list')
      var list = result.list.map(decorate)
      if (append) list = self.data.items.concat(list.filter(function (row) { return !self.data.items.some(function (old) { return String(old.id) === String(row.id) }) }))
      self._page = page
      self.setData({ items: list, pendingCount: result.pendingCount, hasMore: result.hasMore === true })
    }).catch(function (error) {
      if (self.current(viewer) && load === self._load) self.setData({ error: error.code === 'COMPLETION_UNAVAILABLE' ? '特殊单审核暂未开放，请稍后重试。' : completion.errorText(error), pendingCount: null, hasMore: false })
    }).then(function () { if (self.current(viewer) && load === self._load) self.setData({ loading: false }) })
  },
  selectFilter: function (event) {
    var status = event.currentTarget.dataset.status
    if (!labels[status] || status === this.data.status || this.data.busyId) return
    this.setData({ status: status, items: [], hasMore: false }); this.refresh()
  },
  openAppointment: function (event) { wx.navigateTo({ url: '/pages/detail/detail?id=' + encodeURIComponent(event.currentTarget.dataset.id) + '&role=admin' }) },
  previewPhotos: function (event) {
    if (!this.current(session.key())) return
    var row = this.data.items.find(function (item) { return String(item.id) === String(event.currentTarget.dataset.id) })
    if (!row) return
    var urls = row.photos.map(function (p) { return typeof p === 'string' ? p : p.url }).filter(Boolean)
    if (urls.length) wx.previewImage({ current: urls[0], urls: urls })
  },
  review: function (event) {
    if (this.data.busyId || this.data.loading || this.data.error || !this.current(session.key())) return
    var id = String(event.currentTarget.dataset.id), decision = event.currentTarget.dataset.decision
    if (['approve', 'reject'].indexOf(decision) === -1) return
    var row = this.data.items.find(function (item) { return String(item.id) === id })
    if (!row || row.status !== 'pending' || row.canReview !== true) return
    var self = this, viewer = session.key(), load = this._load, reject = decision === 'reject'
    wx.showModal({ title: reject ? '审核不通过' : '通过特殊单审核', editable: reject, placeholderText: '请填写不通过的原因（最多200字）', content: reject ? '' : '确认已核实本单不方便拍照的情况？', confirmText: reject ? '提交审核' : '确认通过',
      success: function (result) {
        if (!result.confirm || !self.current(viewer) || load !== self._load || self.data.busyId) return
        var reason = String(result.content || '').trim()
        if (reject && (!reason || reason.length > 200)) { wx.showToast({ title: '请填写1至200字原因', icon: 'none' }); return }
        var key = JSON.stringify([id, decision, reject ? reason : ''])
        self._reviewKeys = self._reviewKeys || {}; self._reviewKeys[key] = self._reviewKeys[key] || completion.requestKey()
        self.setData({ busyId: id })
        var flight = self._reviewFlight = { id: id, viewer: viewer }
        completion.review(id, { decision: decision, reason: reject ? reason : '', requestKey: self._reviewKeys[key] }).then(function (response) {
          if (!self.current(viewer)) return
          if (response.reviewStatus !== (reject ? 'rejected' : 'approved')) throw new Error('invalid review response')
          wx.showToast({ title: '审核已提交', icon: 'success' }); return self.refresh()
        }).catch(function (error) {
          if (self.current(viewer)) { wx.showModal({ title: '审核未完成', content: completion.errorText(error), showCancel: false }); self.refresh() }
        }).then(function () {
          if (self._reviewFlight === flight) {
            self._reviewFlight = null
            if (!self._disposed && session.key() === viewer) self.setData({ busyId: '' })
          }
        })
      }
    })
  }
})
