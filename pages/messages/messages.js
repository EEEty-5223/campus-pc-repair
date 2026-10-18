var portal = require('../../utils/portal-api')
var page = require('../../utils/portal-page')
Page(page({
  data: { loading: true, error: '', items: [], hasMore: false },
  clearPrivate: function () { this.setData({ items: [], hasMore: false }) },
  load: function () { return this.loadPage(false) },
  loadPage: function (append) {
    var self = this, current = this.guard(), next = append ? (this._page || 1) + 1 : 1
    this.setData({ loading: true, error: '' })
    return portal.call('/api/portal/messages?page=' + next).then(function (result) {
      if (!current()) return
      self._page = next
      var list = result.list.map(function (item) { return Object.assign({}, item, { dateText: portal.date(item.at) }) })
      if (append) list = self.data.items.concat(list.filter(function (item) { return !self.data.items.some(function (old) { return old.appointmentId === item.appointmentId }) }))
      self.setData({ items: list, hasMore: result.hasMore })
    }).catch(function (error) { if (current()) self.setData({ error: error.message, hasMore: false }) })
      .then(function () { if (current()) self.setData({ loading: false }) })
  },
  more: function () { if (!this.data.loading && this.data.hasMore) return this.loadPage(true) },
  onReachBottom: function () { return this.more() },
  open: function (event) { wx.navigateTo({ url: '/pages/chat/chat?id=' + encodeURIComponent(event.currentTarget.dataset.id) }) },
  records: function () { wx.navigateTo({ url: '/pages/records/records' }) }
}))
