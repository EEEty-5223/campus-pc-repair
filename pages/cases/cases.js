var cases = require('../../utils/cases-api'), page = require('../../utils/portal-page')
Page(page({
  data: { items: [], loading: true, error: '', hasMore: false, query: '', departments: ['全部部门'], faults: ['全部故障'], departmentIndex: 0, faultIndex: 0 },
  clearPrivate: function () { this.setData({ items: [], hasMore: false }) },
  load: function () { return this.loadPage(false) },
  loadPage: function (append) {
    var self = this, current = this.guard(), next = append ? (this._page || 1) + 1 : 1
    this.setData({ loading: true, error: '' })
    return cases.call('/api/cases?page=' + next + '&q=' + encodeURIComponent(this.data.query.trim()) + '&department=' + encodeURIComponent(this.data.departmentIndex ? this.data.departments[this.data.departmentIndex] : '') + '&faultType=' + encodeURIComponent(this.data.faultIndex ? this.data.faults[this.data.faultIndex] : '')).then(function (r) {
      if (!current()) return
      return cases.cards(r.list).then(function (rows) {
        if (!current()) return
        self._page = next
        var departments = ['全部部门'].concat(r.departments), faults = ['全部故障'].concat(r.faultTypes)
        self.setData({ items: (append ? self.data.items : []).concat(rows), hasMore: r.hasMore, departments: departments, faults: faults,
          departmentIndex: Math.max(0, departments.indexOf(self.data.departments[self.data.departmentIndex])), faultIndex: Math.max(0, faults.indexOf(self.data.faults[self.data.faultIndex])) })
      })
    }).catch(function (e) { if (current()) self.setData({ items: append ? self.data.items : [], error: e.message || '案例暂未加载' }) }).then(function () { if (current()) self.setData({ loading: false }) })
  },
  input: function (e) { this.setData({ query: e.detail.value }) },
  search: function () { return this.load() },
  department: function (e) { this.setData({ departmentIndex: Number(e.detail.value), items: [] }); return this.load() },
  fault: function (e) { this.setData({ faultIndex: Number(e.detail.value), items: [] }); return this.load() },
  more: function () { if (this.data.hasMore && !this.data.loading) return this.loadPage(true) },
  onReachBottom: function () { return this.more() },
  open: function (e) { wx.navigateTo({ url: '/pages/case-detail/case-detail?id=' + encodeURIComponent(e.currentTarget.dataset.id) }) },
  guides: function () { wx.switchTab({ url: '/pages/guides/guides' }) },
  imageError: function (e) { var id = e.currentTarget.dataset.id; this.setData({ items: this.data.items.map(function (r) { return r.id === id ? Object.assign({}, r, { coverUrl: '', coverFailed: true }) : r }) }) },
  retryImage: function (e) { if (this.data.loading) return; var id = e.currentTarget.dataset.id, self = this, current = this.guard(), item = this.data.items.find(function (r) { return r.id === id }); if (!item) return; return cases.cards([item]).then(function (rows) { if (current()) self.setData({ items: self.data.items.map(function (r) { return r.id === id ? rows[0] : r }) }) }) },
  onShareAppMessage: function () { return { title: '维修案例 · 电脑e家', path: '/pages/cases/cases' } }
}))
