var portal = require('../../utils/portal-api'), page = require('../../utils/portal-page')
function parseBlocks(body) {
  return body.replace(/\r\n/g, '\n').split(/\n\s*\n/).map(function (text) {
    var image = /^!\[[^\]]*\]\((\/uploads\/portal-[a-f0-9]{32}\.(?:jpg|png|webp|gif))\)$/.exec(text.trim())
    return image ? { type: 'image', src: image[1] } : { type: /^#{1,3} /.test(text) ? 'heading' : 'paragraph', text: text.replace(/^#{1,3} /, '') }
  })
}
Page(page({
  data: { loading: true, loadFailed: false, error: '', imageError: '', busy: false, uploading: false, choosing: false, previewLoading: false, title: '', summary: '', body: '', cover: '', coverUrl: '', category: 'computer', categoryIndex: 0, categories: ['电脑使用', '常用应用'], canPublish: false, status: 'draft', preview: false, blocks: [] },
  onLoad: function (options) { this._id = options.id || ''; this._version = 0; this._dirty = false; this._uploads = []; this._localImages = {} },
  clearPrivate: function () {
    this._loaded = false; this._dirty = false; this._version = 0; this._uploads = []; this._localImages = {}
    this.setData({ title: '', summary: '', body: '', cover: '', coverUrl: '', canPublish: false, status: 'draft', category: 'computer', categoryIndex: 0, preview: false, blocks: [], busy: false, uploading: false, choosing: false })
  },
  onShow: function () {
    if (this._committed && this._committed.viewer === portal.identity()) {
      this.setData({ status: this._committed.status }); this._committed = null
      if (typeof wx.disableAlertBeforeUnload === 'function') wx.disableAlertBeforeUnload({})
    }
    if (!this._loaded) return this.load()
    if (this.data.loading) { this.setData({ loading: false }); return this.retryCover() }
    if (this.data.previewLoading) { this.setData({ preview: false }); return this.preview() }
  },
  onUnload: function () { if (!this.data.busy) this.releaseUploads() },
  releaseUploads: function () { var uploads = this._uploads || []; this._uploads = []; return portal.discardAll(uploads) },
  load: function () {
    var self = this, current = this.guard()
    this.setData({ loading: true, loadFailed: false, error: '', imageError: '' })
    return portal.call('/api/admin/guides' + (this._id ? '/' + encodeURIComponent(this._id) : '?page=1')).then(function (result) {
      if (!current()) return
      self._loaded = true; self.setData({ canPublish: result.canPublish })
      if (!result.article) return
      var article = result.article; self._version = article.version
      self.setData({ title: article.title, summary: article.summary, body: article.body, cover: article.cover, coverUrl: '', category: article.category, categoryIndex: article.category === 'apps' ? 1 : 0, status: article.status })
      return portal.image(article.cover).then(function (url) { if (current()) self.setData({ coverUrl: url }) }, function () { if (current()) self.setData({ imageError: '封面加载失败，点击重试' }) })
    }).catch(function (error) { if (current()) self.setData({ loadFailed: true, error: error.message }) })
      .then(function () { if (current()) self.setData({ loading: false }) })
  },
  input: function (event) {
    var field = event.currentTarget.dataset.field
    if (this.data.loading || this.data.loadFailed || this.data.busy || ['title', 'summary', 'body'].indexOf(field) < 0) return
    var patch = {}; patch[field] = event.detail.value; this._dirty = true; this.setData(patch); this.leaveGuard()
  },
  categoryChange: function (event) { if (this.data.busy || this.data.loadFailed || this.data.loading) return; var index = Number(event.detail.value); this._dirty = true; this.setData({ category: index === 1 ? 'apps' : 'computer', categoryIndex: index }); this.leaveGuard() },
  leaveGuard: function () { if (typeof wx.enableAlertBeforeUnload === 'function') wx.enableAlertBeforeUnload({ message: '文章尚未保存，离开会丢失本次修改。' }) },
  chooseImage: function (event) {
    if (this.data.loading || this.data.loadFailed || this.data.busy || this.data.uploading || this.data.choosing) return
    var self = this, viewer = portal.identity(), target = event.currentTarget.dataset.target
    if (target !== 'cover' && target !== 'body') return
    this.setData({ choosing: true, error: '' })
    wx.chooseMedia({ count: 1, mediaType: ['image'], sourceType: ['album', 'camera'], sizeType: ['compressed'],
      success: function (result) {
        if (self._disposed || viewer !== portal.identity()) return
        var file = result.tempFiles && result.tempFiles[0]
        if (!file || !file.tempFilePath) { self.setData({ error: '没有取得图片，请重新选择' }); return }
        if (file.size > 5 * 1024 * 1024) { self.setData({ error: '请选择5MB以内的图片' }); return }
        self.uploadImage(file.tempFilePath, target, viewer)
      },
      fail: function (error) { if (!self._disposed && viewer === portal.identity() && !/cancel/i.test(error.errMsg || '')) self.setData({ error: '无法打开图片选择，请检查微信相册或相机权限' }) },
      complete: function () { if (!self._disposed && viewer === portal.identity()) self.setData({ choosing: false }) }
    })
  },
  uploadImage: function (file, target, viewer) {
    var self = this; this.setData({ uploading: true, error: '' })
    return portal.upload(file).then(function (path) {
      if (viewer !== portal.identity()) return
      if (self._disposed) { portal.discard(path); return }
      self._uploads = (self._uploads || []).concat(path); self._localImages = self._localImages || {}; self._localImages[path] = file; self._dirty = true
      if (target === 'cover') self.setData({ cover: path, coverUrl: file, imageError: '' })
      else self.setData({ body: self.data.body + '\n\n![图片](' + path + ')\n\n' })
      self.leaveGuard()
    }).catch(function (error) { if (!self._disposed && viewer === portal.identity()) self.setData({ error: error.message }) }).then(function () { if (!self._disposed && viewer === portal.identity()) self.setData({ uploading: false }) })
  },
  coverFailed: function () { portal.forgetAvatar(this.data.cover); this.setData({ coverUrl: '', imageError: '封面加载失败，点击重试' }) },
  retryCover: function () {
    if (this.data.busy || this.data.loading || !this.data.cover) return
    var self = this, viewer = portal.identity(), cover = this.data.cover
    portal.forgetAvatar(cover)
    return portal.image(cover).then(function (url) { if (!self._disposed && viewer === portal.identity() && self.data.cover === cover) self.setData({ coverUrl: url, imageError: '' }) }, function () { if (!self._disposed && viewer === portal.identity()) self.setData({ imageError: '封面加载失败，点击重试' }) })
  },
  removeCover: function () { if (!this.data.busy && !this.data.uploading) { this._dirty = true; this.setData({ cover: '', coverUrl: '', imageError: '' }); this.leaveGuard() } },
  preview: function () {
    if (this.data.loading || this.data.busy || this.data.uploading || this.data.choosing) return
    var self = this, viewer = portal.identity(), version = this._previewVersion = (this._previewVersion || 0) + 1
    if (this.data.preview) { this.setData({ preview: false, previewLoading: false }); return }
    this.setData({ preview: true, previewLoading: true, blocks: [] })
    return Promise.all(parseBlocks(this.data.body).map(function (block) {
      var local = self._localImages && self._localImages[block.src]
      return local ? Object.assign({}, block, { url: local }) : portal.blocks([block]).then(function (blocks) { return blocks[0] })
    })).then(function (blocks) { if (!self._disposed && viewer === portal.identity() && version === self._previewVersion) self.setData({ blocks: blocks, previewLoading: false }) })
  },
  previewImageFailed: function (event) {
    var index = Number(event.currentTarget.dataset.index), blocks = this.data.blocks.slice(), block = blocks[index]
    if (!block) return
    if (this._localImages) delete this._localImages[block.src]
    portal.forgetAvatar(block.src); blocks[index] = Object.assign({}, block, { url: '', failed: true }); this.setData({ blocks: blocks })
  },
  retryPreviewImages: function () { this.data.blocks.forEach(function (block) { if (block.src) portal.forgetAvatar(block.src) }); this.setData({ preview: false }); return this.preview() },
  saveDraft: function () { return this.save('draft') },
  publish: function () {
    if (!this.data.canPublish || this.data.busy || this.data.loadFailed) return
    var self = this, viewer = portal.identity()
    wx.showModal({ title: '发布文章', content: '发布后所有用户都能在指南中看到，请确认内容与图片可以公开。', confirmText: '确认发布', success: function (result) { if (result.confirm && self._visible && viewer === portal.identity()) self.save('published') } })
  },
  save: function (status) {
    if (this.data.busy || this.data.uploading || this.data.choosing || this.data.loading || this.data.loadFailed || this.data.previewLoading) return
    if (!this.data.title.trim() || !this.data.body.trim()) { this.setData({ error: '请填写文章标题和正文' }); return }
    var self = this, current = this.guard(), uploads = this._uploads || [], viewer = portal.identity()
    this.setData({ busy: true, error: '' })
    var body = { title: this.data.title, summary: this.data.summary, category: this.data.category, cover: this.data.cover, body: this.data.body, status: status }; if (this._id) body.version = this._version
    return portal.call('/api/admin/guides' + (this._id ? '/' + encodeURIComponent(this._id) : ''), this._id ? 'PUT' : 'POST', body).then(function (result) {
      portal.discardAll(uploads)
      if (self._uploads === uploads) self._uploads = []
      if (!self._disposed && viewer === portal.identity()) {
        self._id = result.id; self._version = result.version; self._dirty = false; self._committed = { status: status, viewer: viewer }
      }
      if (!current()) return
      self._committed = null; self.setData({ status: status })
      if (typeof wx.disableAlertBeforeUnload === 'function') wx.disableAlertBeforeUnload({})
      wx.showToast({ title: status === 'published' ? '文章已发布' : '草稿已保存' })
    }).catch(function (error) { if (current()) self.setData({ error: error.message }) }).then(function () {
      if (self._disposed) portal.discardAll(uploads)
      else self.setData({ busy: false })
    })
  }
}))
