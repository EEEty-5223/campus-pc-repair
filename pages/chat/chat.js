var appointments = require('../../utils/appointments')
var api = require('../../utils/api-request.js')
var USE_BACKEND = true

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
    var self = this
    var app = getApp()
    // 等登录完成再拉数据,避免 openid 还没拿到时显示本地旧数据
    if (app && app.globalData && app.globalData.loginReady) {
      app.globalData.loginReady
        .then(function () { self.loadItem() })
        .catch(function () { self.loadItem() })
    } else {
      self.loadItem()
    }
  },

  loadItem: function () {
    var self = this
    var id = self.data.id
    if (!id) {
      return
    }
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
            return
          }
          var decorated = appointments.decorate ? appointments.decorate(item) : item
          self.setData({ item: decorated })
          if (decorated && decorated.messages && decorated.messages.length) {
            var last = decorated.messages[decorated.messages.length - 1]
            self.setData({ scrollIntoView: 'msg-' + last.id })
          }
        })
        .catch(function (err) {
          console.error('[chat] 加载失败:', err.message)
          var localItem = appointments.getById(id)
          self.setData({ item: localItem })
        })
      return
    }
    var item = appointments.getById(id)
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
