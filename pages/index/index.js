var appointments = require('../../utils/appointments')
var api = require('../../utils/api-request.js')
var USE_BACKEND = true

Page({
  data: {
    recordCount: 0,
    isAdmin: false,
    services: [
      { icon: '💻', name: '系统问题', desc: '蓝屏、卡顿、系统安装' },
      { icon: '🧹', name: '清灰维护', desc: '除尘、硅脂与基础保养' },
      { icon: '🔧', name: '硬件排查', desc: '无法开机、异响、外设故障' },
      { icon: '🌐', name: '网络软件', desc: '网络、驱动与常用软件' }
    ],
    steps: [
      { number: '1', title: '填写预约', desc: '描述设备和故障' },
      { number: '2', title: '社团确认', desc: '确认后回复并预约成功' },
      { number: '3', title: '到场处理', desc: '检测后再确认维修' }
    ]
  },

  onShow: function () {
    var self = this
    var app = getApp()
    // 等登录完成再拉数据,避免 openid 还没拿到时显示本地旧数据
    var doLoad = function () {
      // 登录完成后同步管理员状态
      var isAdmin = !!(app && app.globalData && app.globalData.isAdmin)
      self.setData({ isAdmin: isAdmin })
      self.loadRecordCount()
    }
    if (app && app.globalData && app.globalData.loginReady) {
      app.globalData.loginReady
        .then(doLoad)
        .catch(doLoad)
    } else {
      doLoad()
    }
  },

  loadRecordCount: function () {
    var self = this
    var app = getApp()
    // 同步管理员状态(防止从后台批准后回首页时没刷新)
    var isA = !!(app && app.globalData && app.globalData.isAdmin)
    self.setData({ isAdmin: isA })

    if (USE_BACKEND) {
      var app = getApp()
      var openid = (app && app.globalData && app.globalData.openid) || ''
      if (!openid) {
        self.setData({ recordCount: appointments.list().length })
        return
      }
      api.getMyAppointments(openid)
        .then(function (resp) {
          var list = (resp && resp.list) || []
          self.setData({ recordCount: list.length })
        })
        .catch(function (err) {
          console.error('[index] 拉取预约计数失败:', err.message)
          self.setData({ recordCount: appointments.list().length })
        })
      return
    }
    self.setData({ recordCount: appointments.list().length })
  },

  goBooking: function () {
    wx.navigateTo({ url: '/pages/booking/booking' })
  },

  goRecords: function () {
    wx.switchTab({ url: '/pages/records/records' })
  },

  goConsult: function () {
    wx.navigateTo({ url: '/pages/consult/consult' })
  },

  goAdmin: function () {
    wx.navigateTo({ url: '/pages/admin/admin' })
  },

  goApply: function () {
    wx.navigateTo({ url: '/pages/apply/apply' })
  }
})
