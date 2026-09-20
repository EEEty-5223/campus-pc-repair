var appointments = require('../../utils/appointments')

Page({
  data: {
    recordCount: 0,
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
    this.setData({
      recordCount: appointments.list().length
    })
  },

  goBooking: function () {
    wx.navigateTo({ url: '/pages/booking/booking' })
  },

  goRecords: function () {
    wx.switchTab({ url: '/pages/records/records' })
  },

  goAdmin: function () {
    wx.navigateTo({ url: '/pages/admin/admin' })
  }
})
