var appointments = require('../../utils/appointments')

Page({
  data: {
    allItems: [],
    items: [],
    currentFilter: 'all',
    filters: [
      { value: 'all', label: '全部' },
      { value: 'active', label: '处理中' },
      { value: 'closed', label: '已结束' }
    ]
  },

  onShow: function () {
    this.loadItems()
  },

  onPullDownRefresh: function () {
    this.loadItems()
    wx.stopPullDownRefresh()
  },

  loadItems: function () {
    this.setData({ allItems: appointments.list() })
    this.applyFilter()
  },

  selectFilter: function (event) {
    this.setData({ currentFilter: event.currentTarget.dataset.filter })
    this.applyFilter()
  },

  applyFilter: function () {
    var filter = this.data.currentFilter
    var items = this.data.allItems.filter(function (item) {
      if (filter === 'all') {
        return true
      }
      if (filter === 'active') {
        return ['pending', 'accepted', 'repairing'].indexOf(item.status) !== -1
      }
      return ['completed', 'cancelled'].indexOf(item.status) !== -1
    })
    this.setData({ items: items })
  },

  goBooking: function () {
    wx.navigateTo({ url: '/pages/booking/booking' })
  },

  goDetail: function (event) {
    wx.navigateTo({
      url: '/pages/detail/detail?id=' + event.currentTarget.dataset.id
    })
  }
})
