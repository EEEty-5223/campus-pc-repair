var appointments = require('../../utils/appointments')

Page({
  data: {
    id: '',
    role: 'user',
    item: null,
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
    if (!this.data.id) {
      return
    }
    var item = appointments.getById(this.data.id)
    this.setData({ item: item })
    if (item && item.messages && item.messages.length) {
      var last = item.messages[item.messages.length - 1]
      this.setData({ scrollIntoView: 'msg-' + last.id })
    }
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