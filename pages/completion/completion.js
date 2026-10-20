var api = require('../../utils/api-request')
var completion = require('../../utils/completion-api')
var session = { key: completion.viewerKey }

Page({
  data: { item: null, loading: true, loadError: '', step: 'evidence', photos: [], mode: 'photos', codeOnly: false, note: '', code: '', error: '', busy: false, success: false, reviewPending: false, canSkipPhoto: false, maxPhotos: 9 },
  onLoad: function (options) { this._id = options && options.id || ''; this._disposed = false },
  onShow: function () {
    var self = this
    this._visible = true
    var app = getApp()
    Promise.resolve(app && app.globalData.loginReady).then(function () {
      if (self._disposed || !self._visible) return
      if (self._viewer && self._viewer !== session.key()) {
        self._context = null; self._submitKey = ''; self.setData({ item: null, photos: [], mode: 'photos', codeOnly: false, step: 'evidence', code: '', note: '', busy: false, success: false, canSkipPhoto: false })
      }
      self._viewer = session.key()
      if (!self.data.item) return self.loadItem()
    }).catch(function () { if (!self._disposed && self._visible) self.setData({ loading: false, loadError: '请登录社团成员账号后重试。' }) })
  },
  onHide: function () { this._visible = false; if (!this._choosing) this.setData({ code: '' }) },
  onUnload: function () { this._disposed = true; this._visible = false },
  current: function (viewer) { return !this._disposed && viewer === session.key() && viewer === this._viewer },
  loadItem: function () {
    var self = this, viewer = session.key(), load = this._load = (this._load || 0) + 1
    this._viewer = viewer
    this.setData({ loading: true, loadError: '' })
    return api.getAppointment(this._id).then(function (result) {
      if (!self.current(viewer) || self._load !== load) return
      var item = result && result.item
      if (!item || item.isVoided || item.status !== 'repairing' || item.canProcess !== true) {
        self.setData({ item: null, loadError: '这条预约当前不能提交完工，请返回检查状态与人员分配。' }); return
      }
      return completion.context(self._id).then(function (context) {
        if (!self.current(viewer) || self._load !== load) return
        if (!context.available || context.canSubmit !== true) throw { code: 'COMPLETION_UNAVAILABLE' }
        var codeOnly = context.codeOnly === true && context.photoUploadEnabled === false
        self._context = context
        self.setData({ item: item, codeOnly: codeOnly, mode: codeOnly ? 'code_only' : 'photos', step: codeOnly ? 'code' : 'evidence', canSkipPhoto: !codeOnly && !!item.isAssignedToMe, code: '', error: '' })
      })
    }).catch(function () { if (self.current(viewer) && self._load === load) self.setData({ loadError: '预约暂时无法加载，请返回刷新或重试。' }) })
      .then(function () { if (self.current(viewer) && self._load === load) self.setData({ loading: false }) })
  },
  choosePhotos: function () {
    if (!this.current(session.key()) || this.data.codeOnly || this.data.busy || this._choosing || this.data.photos.length >= this.data.maxPhotos) return
    var self = this, viewer = session.key()
    this._choosing = true
    wx.chooseMedia({ count: this.data.maxPhotos - this.data.photos.length, mediaType: ['image'], sourceType: ['camera', 'album'],
      success: function (result) {
        if (!self.current(viewer)) return
        var files = (result.tempFiles || []).filter(function (file) { return file.tempFilePath && file.size <= 10 * 1024 * 1024 && !self.data.photos.some(function (photo) { return photo.path === file.tempFilePath }) })
        self.setData({ photos: self.data.photos.concat(files.map(function (file) { return { path: file.tempFilePath, id: '', url: '' } })).slice(0, self.data.maxPhotos), error: files.length !== (result.tempFiles || []).length ? '部分照片超过10MB，请压缩后重新选择。' : '' })
      }, fail: function (error) { if (self.current(viewer) && !/cancel/.test(error.errMsg || '')) self.setData({ error: '未能选择照片，请重试。' }) },
      complete: function () { self._choosing = false }
    })
  },
  removePhoto: function (event) {
    if (this.data.busy) return
    var index = Number(event.currentTarget.dataset.index)
    this.setData({ photos: this.data.photos.filter(function (_, i) { return i !== index }), error: '' }); this._submitKey = ''
  },
  previewPhoto: function (event) { if (!this.current(session.key())) return; var urls = this.data.photos.map(function (p) { return p.path }); wx.previewImage({ current: event.currentTarget.dataset.url, urls: urls }) },
  inputNote: function (event) { if (!this.data.busy) { this.setData({ note: event.detail.value }); this._submitKey = '' } },
  inputCode: function (event) { if (!this.data.busy) { this.setData({ code: String(event.detail.value || '').replace(/\D/g, '').slice(0, 4), error: '' }); this._submitKey = '' } },
  skipPhoto: function () {
    if (!this.current(session.key()) || this.data.codeOnly || !this.data.canSkipPhoto || this.data.busy) return
    var self = this, viewer = session.key()
    function failed() { if (self.current(viewer)) self.setData({ error: '确认窗口未能打开，请重新点击“用户不方便拍照”。' }) }
    try {
      wx.showModal({ title: '用户不方便拍照', content: '请先征得用户同意。输入完成码并提交成功后，预约完成，同时交由所属部门负责人或管理员审核。', confirmText: '下一步',
        success: function (result) { if (result.confirm && self.current(viewer) && self._visible && !self.data.busy) { self._submitKey = ''; self.setData({ mode: 'no_photo', step: 'code', code: '', error: '' }) } },
        fail: failed
      })
    } catch (_) { failed() }
  },
  nextStep: function () {
    if (!this.current(session.key()) || this.data.codeOnly || this.data.busy) return
    if (!this.data.photos.length) { this.setData({ error: '请至少选择一张完工照片，或选择“用户不方便拍照”。' }); return }
    var self = this, viewer = session.key()
    this.setData({ busy: true, error: '' })
    return completion.context(this._id).then(function (context) {
      if (!self.current(viewer)) return
      if (!context.available || context.canSubmit !== true) throw { code: 'COMPLETION_UNAVAILABLE' }
      var limit = Math.max(1, Math.min(9, Number(context.maxPhotos) || 9))
      self.setData({ maxPhotos: limit })
      if (self.data.photos.length > limit) throw { code: 'COMPLETION_PHOTO_LIMIT' }
      self._context = context
      var chain = Promise.resolve()
      self.data.photos.forEach(function (_, index) {
        chain = chain.then(function () {
          if (!self.current(viewer)) throw new Error('account changed')
          var photo = self.data.photos[index]
          if (photo.id) return
          return completion.upload(self._id, photo.path).then(function (uploaded) {
            if (!self.current(viewer)) return
            var photos = self.data.photos.slice(); photos[index] = Object.assign({}, photo, uploaded); self.setData({ photos: photos })
          })
        })
      })
      return chain.then(function () {
        if (self.current(viewer)) { self._submitKey = ''; self.setData({ mode: 'photos', step: 'code', code: '', error: '' }) }
      })
    }).catch(function (error) { if (self.current(viewer)) self.setData({ error: completion.errorText(error) }) })
      .then(function () { if (self.current(viewer)) self.setData({ busy: false }) })
  },
  backToPhotos: function () { if (!this.data.codeOnly && !this.data.busy) { this._submitKey = ''; this.setData({ step: 'evidence', mode: 'photos', code: '', error: '' }) } },
  submit: function () {
    if (!this.current(session.key()) || this.data.busy || this.data.success) return
    if (!/^\d{4}$/.test(this.data.code)) { this.setData({ error: '请输入用户提供的4位完成码。' }); return }
    if (this.data.mode === 'photos' && (!this.data.photos.length || this.data.photos.some(function (p) { return !p.id }))) { this.setData({ error: '请返回上一步，完成照片上传。' }); return }
    if (this.data.mode === 'no_photo' && !this.data.canSkipPhoto) return
    if (this.data.mode === 'code_only' && !this.data.codeOnly) return
    var self = this, viewer = session.key()
    this._submitKey = this._submitKey || completion.requestKey()
    var body = { completionCode: this.data.code, evidenceType: this.data.mode, photoIds: this.data.mode === 'photos' ? this.data.photos.map(function (p) { return p.id }) : [], noPhotoReason: this.data.mode === 'no_photo' ? '用户不方便拍照' : '', note: this.data.note.trim(), requestKey: this._submitKey }
    this.setData({ busy: true, error: '' })
    var request = this.data.codeOnly ? api.updateStatus(this._id, 'completed', this.data.code) : completion.submit(this._id, body)
    return request.then(function (result) {
      if (!self.current(viewer)) return
      if (result.status !== 'completed' || (body.evidenceType === 'no_photo' && ['pending', 'approved', 'rejected'].indexOf(result.reviewStatus) === -1)) throw new Error('invalid completion response')
      self.setData({ success: true, code: '', reviewPending: result.reviewStatus === 'pending' })
    }).catch(function (error) { if (self.current(viewer)) self.setData({ error: completion.errorText(error) }) })
      .then(function () { if (self.current(viewer)) self.setData({ busy: false }) })
  },
  goBack: function () { wx.navigateBack() }
})
