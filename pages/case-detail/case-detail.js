var cases = require('../../utils/cases-api'), page = require('../../utils/portal-page')
Page(page({
  data: { item: null, loading: true, error: '', imageError: false },
  onLoad: function (options) { this._id = options.id || '' },
  clearPrivate: function () { this.setData({ item: null, imageError: false }) },
  load: function () {
    var self = this, current = this.guard(); this.setData({ loading: true, error: '', item: null, imageError: false })
    return cases.call('/api/cases/' + encodeURIComponent(this._id)).then(function (r) { return cases.photos(r.item.photos).then(function (photos) {
      if (current()) self.setData({ item: Object.assign(cases.card(r.item), { photos: photos }), imageError: photos.some(function (p) { return p.failed }) })
    }) }).catch(function (e) { if (current()) self.setData({ item: null, error: e.message || '案例暂不可查看' }) }).then(function () { if (current()) self.setData({ loading: false }) })
  },
  imageFailed: function () { this.setData({ imageError: true }) },
  preview: function (e) { var urls = this.data.item.photos.filter(function (p) { return p.displayUrl }).map(function (p) { return p.displayUrl }); if (urls.length) wx.previewImage({ current: e.currentTarget.dataset.url || urls[0], urls: urls }) },
  booking: function () { if (this.data.item) wx.navigateTo({ url: '/pages/booking/booking?faultType=' + encodeURIComponent(this.data.item.faultType) }) },
  onShareAppMessage: function () { return { title: this.data.item ? this.data.item.title + ' · 电脑e家' : '维修案例 · 电脑e家', path: '/pages/case-detail/case-detail?id=' + encodeURIComponent(this._id) } }
}))
