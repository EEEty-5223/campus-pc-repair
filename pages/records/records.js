var appointments = require('../../utils/appointments')
var api = require('../../utils/api-request.js')
var USE_BACKEND = true   // 切换:走后端 API / 本地存储

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
    var self = this
    var app = getApp()
    // 等登录完成再拉数据,避免 openid 还没拿到时显示本地旧数据
    if (app && app.globalData && app.globalData.loginReady) {
      app.globalData.loginReady
        .then(function () { self.loadItems() })
        .catch(function () { self.loadItems() })
    } else {
      self.loadItems()
    }
  },

  onPullDownRefresh: function () {
    this.loadItems()
    wx.stopPullDownRefresh()
  },

  loadItems: function () {
    var self = this
    if (USE_BACKEND) {
      // === 走后端 API ===
      var app = getApp()
      var openid = (app && app.globalData && app.globalData.openid) || ''
      if (!openid) {
        // openid 还没拿到（silentLogin 异步），先用本地占位
        self.setData({ allItems: appointments.list() })
        self.applyFilter()
        return
      }
      api.getMyAppointments(openid)
        .then(function (resp) {
          var list = (resp && resp.list) || []
          // 统一加前端需要的状态文本/类名（appointments.decorate 提供）
          var decorated = list.map(function (item) {
            return appointments.decorate ? appointments.decorate(item) : item
          })
          self.setData({ allItems: decorated })
          self.applyFilter()
        })
        .catch(function (err) {
          // 后端拉取失败回退本地
          console.error('[records] 拉取后端预约失败:', err.message)
          self.setData({ allItems: appointments.list() })
          self.applyFilter()
        })
      return
    }
    // === 走本地 ===
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
