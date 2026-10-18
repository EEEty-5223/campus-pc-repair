var portal = require('../../utils/portal-api'), page = require('../../utils/portal-page')
Page(page({
  data: { article: null, loading: true, error: '', imageError: '', busy: false },
  onLoad: function (options) { this._id = options.id || '' },
  clearPrivate: function () { this.setData({ article: null, imageError: '', busy: false }) },
  load: function () {
    var self = this, current = this.guard()
    this.setData({ loading: true, error: '', imageError: '' })
    return portal.call('/api/guides/' + encodeURIComponent(this._id)).then(function (result) {
      if (!current()) return
      return Promise.all([portal.articles([result.article]), portal.blocks(result.article.blocks)]).then(function (values) {
        if (!current()) return
        var article = values[0][0]; article.blocks = values[1]
        self.setData({ article: article, imageError: article.coverFailed || article.blocks.some(function (block) { return block.failed }) ? '部分图片加载失败，点击重试' : '' })
        wx.setNavigationBarTitle({ title: article.title })
      })
    }).catch(function (error) { if (current()) self.setData({ article: null, error: error.message }) })
      .then(function () { if (current()) self.setData({ loading: false }) })
  },
  imageFailed: function (event) {
    var article = this.data.article
    if (!article) return
    var index = event.currentTarget.dataset.index
    if (index === undefined) { portal.forgetAvatar(article.cover); article = Object.assign({}, article, { coverUrl: '', coverFailed: true }) }
    else {
      var blocks = article.blocks.slice(), block = blocks[Number(index)]
      if (!block) return
      portal.forgetAvatar(block.src); blocks[Number(index)] = Object.assign({}, block, { url: '', failed: true }); article = Object.assign({}, article, { blocks: blocks })
    }
    this.setData({ article: article, imageError: '部分图片加载失败，点击重试' })
  },
  retryImages: function () {
    if (this.data.loading || !this.data.article) return
    portal.forgetAvatar(this.data.article.cover)
    this.data.article.blocks.forEach(function (block) { if (block.type === 'image') portal.forgetAvatar(block.src) })
    return this.load()
  },
  favorite: function () {
    if (!this.data.article || this.data.busy || this.data.loading) return
    var self = this, current = this.guard(), favorite = !this.data.article.favorite
    this.setData({ busy: true })
    return portal.call('/api/guides/' + encodeURIComponent(this._id) + '/favorite', 'PUT', { favorite: favorite }).then(function (result) {
      if (current()) self.setData({ 'article.favorite': result.favorite })
    }).catch(function (error) { if (current()) wx.showToast({ title: error.message, icon: 'none' }) }).then(function () { if (!self._disposed) self.setData({ busy: false }) })
  },
  preview: function (event) {
    if (!this.data.article) return
    var urls = this.data.article.blocks.filter(function (block) { return block.type === 'image' && block.url }).map(function (block) { return block.url })
    if (urls.length) wx.previewImage({ current: event.currentTarget.dataset.url || urls[0], urls: urls })
  },
  onShareAppMessage: function () { return { title: this.data.article ? this.data.article.title : '电脑使用指南', path: '/pages/guide-detail/guide-detail?id=' + encodeURIComponent(this._id) } }
}))
