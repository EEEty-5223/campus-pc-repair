var completion = require('./completion-api')
function viewer(page) { return typeof page.chatViewerIdentity === 'function' ? page.chatViewerIdentity() : '' }
module.exports = {
  data: { specialPendingCount: null, specialSummaryError: false, specialSummaryLoading: false, notificationExpanded: false },
  methods: {
    toggleNotificationPanel: function () { this.setData({ notificationExpanded: !this.data.notificationExpanded }) },
    openSpecialOrders: function () {
      if (['admin', 'leader'].indexOf(this.data.role) !== -1) wx.navigateTo({ url: '/pages/special-orders/special-orders' })
    },
    loadSpecialSummary: function () {
      if (['admin', 'leader'].indexOf(this.data.role) === -1) { this.setData({ specialPendingCount: null, specialSummaryError: false, specialSummaryLoading: false }); return Promise.resolve() }
      var self = this, who = viewer(this), version = this._chatVisibilityVersion, load = this._specialLoad = (this._specialLoad || 0) + 1
      function current() { return self._chatVisible && who === viewer(self) && version === self._chatVisibilityVersion && load === self._specialLoad }
      this.setData({ specialPendingCount: null, specialSummaryLoading: true, specialSummaryError: false })
      return completion.summary().then(function (response) {
        if (!current()) return
        if (!Number.isInteger(response.pendingCount) || response.pendingCount < 0) throw new Error('invalid review count')
        self.setData({ specialPendingCount: response.pendingCount })
      }).catch(function () { if (current()) self.setData({ specialPendingCount: null, specialSummaryError: true }) })
        .then(function () { if (current()) self.setData({ specialSummaryLoading: false }) })
    }
  }
}
