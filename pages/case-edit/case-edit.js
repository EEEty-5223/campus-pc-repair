var cases = require('../../utils/cases-api'), page = require('../../utils/portal-page')
function form(item) { return { title: item.title || '', publicLocation: item.publicLocation || '', symptoms: item.symptoms || '', solution: item.solution || '', result: item.result || '' } }
Page(page({
  data: { item: null, form: {}, photos: [], sourcePhotos: [], loading: true, error: '', busy: false, canPublish: false, canEdit: false, sourceAvailable: false, previewing: false, confirmed: false, stale: false, imageError: false, caseImagesReady: true },
  onLoad: function (options) { this._id = options.id || ''; this._loaded = false },
  onShow: function () { if (this._pendingPhoto) return this.applySelectedPhoto(); if (this._choosing || this.data.busy) { this._reloadWhenIdle = true; return } return this.load(!!this._loaded) },
  clearPrivate: function () { this._loaded = false; this._dirty = false; this._pendingVersion = null; this._pendingPhoto = null; this._choosing = false; this._reloadWhenIdle = false; if (wx.disableAlertBeforeUnload) wx.disableAlertBeforeUnload(); this.setData({ item: null, form: {}, photos: [], sourcePhotos: [], confirmed: false, previewing: false, busy: false, stale: false, canEdit: false, canPublish: false }) },
  load: function (preserve) {
    var self = this, current = this.guard(); this.setData({ loading: true, error: '' })
    return cases.call('/api/admin/cases/' + encodeURIComponent(this._id)).then(function (r) {
      if (!current()) return
      if (preserve && self._dirty && self.data.item && r.item.version !== (self._pendingVersion || self.data.item.version)) { self.setData({ stale: true, error: '案例已被其他操作更新，当前填写内容仍保留。请重新加载后再编辑。', canEdit: false }); return }
      return Promise.all([cases.photos(r.item.photos, true), cases.photos(r.sourcePhotos, true)]).then(function (values) {
        if (!current()) return
        var state = { item: cases.card(r.item), photos: values[0], sourcePhotos: values[1], canPublish: r.canPublish, canEdit: r.canEdit, sourceAvailable: r.sourceAvailable, stale: false, imageError: values[0].concat(values[1]).some(function (p) { return p.failed }), caseImagesReady: values[0].every(function (p) { return !!p.displayUrl && !p.failed }) }
        if (!preserve || !self._dirty) { state.form = form(r.item); state.confirmed = false; self._dirty = false }
        self._pendingVersion = null; self._loaded = true; self.setData(state)
      })
    }).catch(function (e) { if (current()) { if (e.statusCode === 403 || e.statusCode === 404) self.clearPrivate(); self.setData({ error: e.message || '案例暂时无法加载', canEdit: false, sourcePhotos: [] }) } }).then(function () { if (current()) self.setData({ loading: false }) })
  },
  dirty: function () { this._dirty = true; this.setData({ confirmed: false }); if (wx.enableAlertBeforeUnload) wx.enableAlertBeforeUnload({ message: '案例内容尚未保存，确定离开吗？' }) },
  input: function (e) { if (!this.data.canEdit || this.data.busy) return; var key = e.currentTarget.dataset.field; if (!Object.prototype.hasOwnProperty.call(this.data.form, key)) return; var update = {}; update['form.' + key] = e.detail.value; this.setData(update); this.dirty() },
  confirm: function (e) { this.setData({ confirmed: (e.detail.value || []).indexOf('confirmed') !== -1 }) },
  preview: function () { this.setData({ previewing: true, confirmed: false }) },
  edit: function () { this.setData({ previewing: false, confirmed: false }) },
  reload: function () {
    var self = this
    function run() { self._dirty = false; self._loaded = false; if (wx.disableAlertBeforeUnload) wx.disableAlertBeforeUnload(); return self.load(false) }
    if (!this._dirty) return run()
    wx.showModal({ title: '重新加载案例', content: '这会放弃尚未保存的文字，已上传图片会保留在草稿中。', success: function (r) { if (r.confirm) run() } })
  },
  finishBusy: function () { if (this._disposed) return; this.setData({ busy: false }); if (this._reloadWhenIdle && this._visible) { this._reloadWhenIdle = false; return this.load(true) } },
  mutateMedia: function (operation) {
    var self = this, current = this.guard(), viewer = cases.identity(); this.setData({ busy: true, error: '', confirmed: false })
    return operation.then(function (r) { if (viewer !== cases.identity() || self._disposed) return; self._pendingVersion = r.version; if (!current()) return; return cases.photos(r.photos, true).then(function (photos) { if (current()) { self._pendingVersion = null; self.setData({ 'item.version': r.version, photos: photos, imageError: photos.some(function (p) { return p.failed }), caseImagesReady: photos.every(function (p) { return !!p.displayUrl && !p.failed }) }); self.dirty() } }) }).catch(function (e) { if (current()) self.setData({ error: e.message, stale: e.statusCode === 409, canEdit: e.statusCode === 409 ? false : self.data.canEdit }) }).then(function () { return self.finishBusy() })
  },
  choosePhoto: function () {
    if (!this.data.canEdit || this.data.busy || this.data.loading || this._choosing || this.data.photos.length >= 9) return
    var self = this, viewer = cases.identity(); this._choosing = true
    wx.chooseMedia({ count: 1, mediaType: ['image'], sizeType: ['compressed'], sourceType: ['album','camera'], success: function (r) {
      self._choosing = false
      if (viewer !== cases.identity() || self._disposed || !r.tempFiles || !r.tempFiles.length) return
      if (r.tempFiles[0].size > 5 * 1024 * 1024) return wx.showToast({ title: '请选择不超过5MB的图片', icon: 'none' })
      self._pendingPhoto = { path: r.tempFiles[0].tempFilePath, viewer: viewer }
      if (self._visible) return self.applySelectedPhoto()
    }, fail: function (e) { if (viewer === cases.identity() && !/cancel/i.test(e.errMsg || '')) self.setData({ error: '无法选择图片，请检查微信隐私授权或重试。' }) }, complete: function () { self._choosing = false } })
  },
  applySelectedPhoto: function () { var selected = this._pendingPhoto; this._pendingPhoto = null; if (!selected || selected.viewer !== cases.identity() || !this._visible || !this.data.canEdit) return; this._reloadWhenIdle = false; return this.mutateMedia(cases.upload(this._id, selected.path, this.data.item.version)) },
  importPhoto: function (e) { if (!this.data.canEdit || this.data.busy || this.data.loading || this.data.photos.length >= 9) return; return this.mutateMedia(cases.call('/api/admin/cases/' + this._id + '/import-photo', 'POST', { photoId: e.currentTarget.dataset.id, version: this.data.item.version })) },
  removePhoto: function (e) {
    if (!this.data.canEdit || this.data.busy || this.data.loading) return
    var self = this, imageId = e.currentTarget.dataset.id, current = this.guard()
    wx.showModal({ title: '移除案例图片', content: '只移除这份案例图片，原预约的完工照片会保留。', success: function (r) { if (r.confirm && current()) self.mutateMedia(cases.call('/api/admin/cases/' + self._id + '/images/' + imageId, 'DELETE', { version: self.data.item.version })) } })
  },
  previewPhoto: function (e) { var urls = this.data.photos.concat(this.data.previewing ? [] : this.data.sourcePhotos).filter(function (p) { return p.displayUrl }).map(function (p) { return p.displayUrl }); if (urls.length) wx.previewImage({ current: e.currentTarget.dataset.url || urls[0], urls: urls }) },
  imageFailed: function (e) { var id = e.currentTarget.dataset.id; this.setData({ imageError: true, caseImagesReady: !this.data.photos.some(function (p) { return p.id === id }) && this.data.caseImagesReady }) },
  saveDraft: function () { return this.save('draft') },
  publish: function () { if (this.data.canPublish && this.data.previewing && this.data.confirmed && this.data.caseImagesReady && this.data.sourceAvailable) return this.save('published') },
  save: function (status) {
    if (!this.data.item || this.data.busy || this.data.loading || this.data.stale || !this.data.canEdit) return
    if (!this.data.form.title.trim()) return wx.showToast({ title: '请填写案例标题', icon: 'none' })
    if (status === 'published' && ['publicLocation','symptoms','solution','result'].some(function (k) { return !this.data.form[k].trim() }, this)) return wx.showToast({ title: '请完善地点、故障、处理和结果', icon: 'none' })
    var self = this, current = this.guard(), viewer = cases.identity(), body = Object.assign({}, this.data.form, { version: this.data.item.version, status: status, privacyConfirmed: status === 'published' && this.data.confirmed })
    this.setData({ busy: true, error: '' })
    return cases.call('/api/admin/cases/' + this._id, 'PUT', body).then(function (r) {
      if (viewer !== cases.identity() || self._disposed) return
      self._dirty = false; self._loaded = false; self._pendingVersion = r.version; if (wx.disableAlertBeforeUnload) wx.disableAlertBeforeUnload()
      if (!current()) return
      self.setData({ 'item.version': r.version, confirmed: false }); self._pendingVersion = null
      wx.showToast({ title: status === 'published' ? '案例已发布' : '草稿已保存', icon: 'success' })
      if (status === 'published') { self._loaded = false; return self.load(false) }
    }).catch(function (e) { if (current()) self.setData({ error: e.message, stale: e.statusCode === 409 }) }).then(function () { return self.finishBusy() })
  },
  withdraw: function () {
    if (!this.data.canPublish || this.data.busy || !this.data.item || this.data.item.status !== 'published') return
    var self = this, current = this.guard()
    wx.showModal({ title: '撤下维修案例', content: '撤下后，用户将无法查看案例及其公开图片。草稿会保留。', success: function (r) {
      if (!r.confirm || !current()) return
      self.setData({ busy: true, error: '' })
      return cases.call('/api/admin/cases/' + self._id, 'PUT', Object.assign({}, self.data.form, { version: self.data.item.version, status: 'draft', privacyConfirmed: false })).then(function () { if (current()) { self._dirty = false; self._loaded = false; return self.load(false) } }).catch(function (e) { if (current()) self.setData({ error: e.message }) }).then(function () { return self.finishBusy() })
    } })
  },
  removeDraft: function () {
    if (!this.data.canEdit || this.data.busy || !this.data.item || this.data.item.status !== 'draft') return
    var self = this, current = this.guard()
    wx.showModal({ title: '删除案例草稿', content: '删除案例及其图片副本，原预约、聊天和完工资料会保留。', confirmColor: '#b94e49', success: function (r) {
      if (!r.confirm || !current()) return
      self.setData({ busy: true, error: '' })
      return cases.call('/api/admin/cases/' + self._id, 'DELETE', { version: self.data.item.version }).then(function () { if (current()) { self._dirty = false; if (wx.disableAlertBeforeUnload) wx.disableAlertBeforeUnload(); wx.navigateBack() } }).catch(function (e) { if (current()) self.setData({ error: e.message }) }).then(function () { return self.finishBusy() })
    } })
  }
}))
