var appointments = require('../../utils/appointments')
var api = require('../../utils/api-request.js')
var USE_BACKEND = true

var EXCLUDED_STATUSES = ['completed', 'cancelled']

Page({
  data: {
    items: [],
    loading: false
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
    self.setData({ loading: true })

    var finish = function (list) {
      var active = list.filter(function (item) {
        return EXCLUDED_STATUSES.indexOf(item.status) === -1
      })
      self.setData({ items: active, loading: false })
    }

    if (USE_BACKEND) {
      var app = getApp()
      var openid = (app && app.globalData && app.globalData.openid) || ''
      if (!openid) {
        finish(appointments.list())
        return
      }
      api.getMyAppointments(openid)
        .then(function (resp) {
          var list = (resp && resp.list) || []
          var decorated = list.map(function (item) {
            return appointments.decorate ? appointments.decorate(item) : item
          })
          finish(decorated)
        })
        .catch(function (err) {
          console.error('[consult] 拉取后端预约失败:', err.message)
          finish(appointments.list())
        })
      return
    }

    finish(appointments.list())
  },

  goChat: function (event) {
    var id = event.currentTarget.dataset.id
    if (!id) {
      return
    }
    wx.navigateTo({
      url: '/pages/chat/chat?id=' + id + '&role=user'
    })
  },

  goBooking: function () {
    wx.navigateTo({ url: '/pages/booking/booking' })
  }
})
