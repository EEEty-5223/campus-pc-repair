var appointments = require('../../utils/appointments')

Page({
  data: {
    id: '',
    item: null,
    role: 'user',
    chatText: '',
    sending: false,
    scrollIntoView: ''
  },

  onLoad: function (options) {
    this.setData({
      id: options.id || '',
      role: options.role === 'admin' ? 'admin' : 'user'
    })
  },

  onShow: function () {
    this.loadItem()
  },

  loadItem: function () {
    var item = appointments.getById(this.data.id)
    this.setData({ item: item })
    if (!item) {
      wx.showToast({ title: '预约记录不存在', icon: 'none' })
    }
  },

  editBooking: function () {
    wx.navigateTo({
      url: '/pages/booking/booking?id=' + this.data.id
    })
  },

  cancelBooking: function () {
    var that = this
    wx.showModal({
      title: '取消预约',
      content: '确定取消这次预约吗？取消后状态无法自行恢复。',
      confirmText: '确认取消',
      confirmColor: '#DC2626',
      success: function (result) {
        if (!result.confirm) {
          return
        }
        var changed = appointments.updateStatus(that.data.id, 'cancelled')
        if (!changed) {
          wx.showToast({ title: '状态已变化，无法取消', icon: 'none' })
          that.loadItem()
          return
        }
        that.loadItem()
        wx.showToast({ title: '已取消', icon: 'success' })
      }
    })
  },

  goChat: function () {
    wx.navigateTo({
      url: '/pages/chat/chat?id=' + this.data.id + '&role=user'
    })
  },

  onChatInput: function (event) {
    this.setData({ chatText: event.detail.value })
  },

  sendMessage: function () {
    var text = String(this.data.chatText || '').trim()
    if (!text) {
      wx.showToast({ title: '请输入内容', icon: 'none' })
      return
    }
    if (this.data.sending) {
      return
    }

    this.setData({ sending: true })
    var changed = appointments.addMessage(this.data.id, this.data.role, text)
    this.setData({ sending: false })

    if (!changed) {
      wx.showToast({ title: '发送失败，请重试', icon: 'none' })
      return
    }

    this.setData({ chatText: '' })
    this.loadItem()
  }
})
