var cases = require('../../utils/cases-api'), page = require('../../utils/portal-page')
Page(page({
  data: { items: [], loading: true, error: '', sources: false, hasMore: false, busy: false, query: '' },
  clearPrivate: function () { this.setData({ items: [], busy: false, hasMore: false }) },
  load: function () { return this.loadPage(false) },
  loadPage: function (append) {
    var self = this, current = this.guard(), next = append ? (this._page || 1) + 1 : 1; this.setData({ loading: true, error: '' })
    return cases.call('/api/admin/cases' + (this.data.sources ? '/sources' : '') + '?page=' + next + '&q=' + encodeURIComponent(this.data.query)).then(function (r) { if (current()) { self._page = next; self.setData({ items: (append ? self.data.items : []).concat(r.list.map(cases.card)), hasMore: r.hasMore }) } }).catch(function (e) { if (current()) self.setData({ error: e.message, items: append ? self.data.items : [] }) }).then(function () { if (current()) self.setData({ loading: false }) })
  },
  toggle: function (e) { if (this.data.busy) return; this.setData({ sources: e.currentTarget.dataset.type === 'sources', items: [], query: '' }); return this.load() },
  input: function (e) { this.setData({ query: e.detail.value }) },
  more: function () { if (!this.data.loading && this.data.hasMore) return this.loadPage(true) },
  onReachBottom: function () { return this.more() },
  open: function (e) {
    if (this.data.busy) return
    var id = e.currentTarget.dataset.id, self = this
    if (!this.data.sources) return wx.navigateTo({ url: '/pages/case-edit/case-edit?id=' + encodeURIComponent(id) })
    var current = this.guard(); this.setData({ busy: true })
    return cases.call('/api/admin/cases', 'POST', { appointmentId: id }).then(function (r) { if (current()) wx.navigateTo({ url: '/pages/case-edit/case-edit?id=' + encodeURIComponent(r.id) }) }).catch(function (e) { if (current()) self.setData({ error: e.message }) }).then(function () { if (!self._disposed) self.setData({ busy: false }) })
  }
}))
