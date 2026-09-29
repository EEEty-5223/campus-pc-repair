var appointments = require('../../utils/appointments')
var api = require('../../utils/api-request.js')
var USE_BACKEND = true

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
    var self = this
    var id = self.data.id
    if (USE_BACKEND) {
      var app = getApp()
      var openid = (app && app.globalData && app.globalData.openid) || ''
      var fetchItem = function () {
        return openid
          ? api.getMyAppointments(openid).then(function (resp) {
              var list = (resp && resp.list) || []
              return list.find(function (x) { return x.id === id }) || null
            })
          : Promise.resolve(null)
      }
      fetchItem()
        .then(function (item) {
          if (!item) {
            return api.getAdminAppointments().then(function (resp) {
              var all = (resp && resp.list) || []
              return all.find(function (x) { return x.id === id }) || null
            })
          }
          return item
        })
        .then(function (item) {
          if (!item) return null
          return api.getMessages(id).then(function (mr) {
            item.messages = (mr && mr.list) || []
            return item
          })
        })
        .then(function (item) {
          if (!item) {
            var localItem = appointments.getById(id)
            self.setData({ item: localItem })
            if (!localItem) {
              wx.showToast({ title: '预约记录不存在', icon: 'none' })
            }
            return
          }
          var decorated = appointments.decorate ? appointments.decorate(item) : item
          self.setData({ item: decorated })
        })
        .catch(function (err) {
          console.error('[detail] 加载失败:', err.message)
          var localItem = appointments.getById(id)
          self.setData({ item: localItem })
        })
      return
    }
    var item = appointments.getById(id)
    self.setData({ item: item })
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
        if (USE_BACKEND) {
          api.updateStatus(that.data.id, 'cancelled')
            .then(function () {
              that.loadItem()
              wx.showToast({ title: '已取消', icon: 'success' })
            })
            .catch(function (err) {
              wx.showToast({ title: '取消失败:' + (err.message || err), icon: 'none' })
              that.loadItem()
            })
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
      url: '/pages/chat/chat?id=' + this.data.id + '&role=' + this.data.role
    })
  },

  onChatInput: function (event) {
    this.setData({ chatText: event.detail.value })
  },

  sendMessage: function () {
    var self = this
    var text = String(this.data.chatText || '').trim()
    if (!text) {
      wx.showToast({ title: '请输入内容', icon: 'none' })
      return
    }
    if (this.data.sending) {
      return
    }

    this.setData({ sending: true })
    var app = getApp()
    var openid = (app && app.globalData && app.globalData.openid) || ''

    if (USE_BACKEND) {
      api.sendMessage(self.data.id, self.data.role, text)
        .then(function () {
          self.setData({ sending: false, chatText: '' })
          self.loadItem()
        })
        .catch(function (err) {
          self.setData({ sending: false })
          wx.showToast({ title: '发送失败:' + (err.message || err), icon: 'none' })
        })
      return
    }

    var changed = appointments.addMessage(self.data.id, self.data.role, text)
    self.setData({ sending: false })

    if (!changed) {
      wx.showToast({ title: '发送失败，请重试', icon: 'none' })
      return
    }

    self.setData({ chatText: '' })
    self.loadItem()
  }
})
