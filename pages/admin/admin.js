var appointments = require('../../utils/appointments')
var api = require('../../utils/api-request.js')
var USE_BACKEND = true

Page({
  data: {
    activeTab: 'appointments',
    allItems: [],
    items: [],
    currentFilter: 'all',
    draftReplies: {},
    filters: [
      { value: 'all', label: '全部', count: 0 },
      { value: 'pending', label: '预约中', count: 0 },
      { value: 'accepted', label: '预约成功', count: 0 },
      { value: 'repairing', label: '维修中', count: 0 },
      { value: 'completed', label: '已完成', count: 0 },
      { value: 'cancelled', label: '已取消', count: 0 }
    ],
    stats: {
      total: 0,
      active: 0,
      completed: 0
    },
    inviteCodes: [],
    applications: [],
    pendingApplications: 0
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

  loadItems: function () {
    var self = this
    var render = function (list) {
      var allItems = list.map(function (item) {
        return appointments.decorate ? appointments.decorate(item) : item
      })
      var filters = self.data.filters.map(function (filter) {
        var count = filter.value === 'all'
          ? allItems.length
          : allItems.filter(function (item) { return item.status === filter.value }).length
        return Object.assign({}, filter, { count: count })
      })
      self.setData({
        allItems: allItems,
        filters: filters,
        stats: {
          total: allItems.length,
          active: allItems.filter(function (item) {
            return item.status === 'accepted' || item.status === 'repairing'
          }).length,
          completed: allItems.filter(function (item) {
            return item.status === 'completed'
          }).length
        }
      })
      self.applyFilter()
    }
    if (USE_BACKEND) {
      api.getAdminAppointments()
        .then(function (resp) {
          var list = (resp && resp.list) || []
          // 补每条预约的消息
          var msgPromises = list.map(function (item) {
            return api.getMessages(item.id).then(function (mr) {
              item.messages = (mr && mr.list) || []
              return item
            }).catch(function () { item.messages = []; return item })
          })
          return Promise.all(msgPromises)
        })
        .then(function (list) { render(list) })
        .catch(function (err) {
          console.error('[admin] 拉取失败:', err.message)
          render(appointments.list())
        })
      return
    }
    render(appointments.list())
  },

  selectFilter: function (event) {
    this.setData({ currentFilter: event.currentTarget.dataset.status })
    this.applyFilter()
  },

  applyFilter: function () {
    var status = this.data.currentFilter
    var items = status === 'all'
      ? this.data.allItems
      : this.data.allItems.filter(function (item) { return item.status === status })
    this.setData({ items: items })
  },

  switchTab: function (event) {
    var tab = event.currentTarget.dataset.tab
    this.setData({ activeTab: tab })
    if (tab === 'invite') {
      this.loadInviteCodes()
    } else if (tab === 'apply') {
      this.loadApplications()
    }
  },

  loadInviteCodes: function () {
    var self = this
    api.getInviteCodes()
      .then(function (resp) {
        var list = (resp && resp.list) || []
        list.forEach(function (c) {
          c.expired = c.used_at ? false : (c.expires_at && Date.parse(c.expires_at) < Date.now())
          c.statusText = c.used_at ? '已使用' : (c.expired ? '已过期' : '有效')
        })
        self.setData({ inviteCodes: list })
      })
      .catch(function (err) {
        wx.showToast({ title: '加载失败:' + (err.message || err), icon: 'none' })
      })
  },

  createInviteCode: function () {
    var self = this
    api.createInviteCode()
      .then(function (resp) {
        var code = (resp && resp.code) || ''
        wx.showModal({
          title: '邀请码已生成',
          content: '把下面这串码发给要加入的人:\n\n' + code,
          showCancel: false,
          confirmText: '复制并关闭',
          success: function (r) {
            wx.setClipboardData({ data: code })
          }
        })
        self.loadInviteCodes()
      })
      .catch(function (err) {
        wx.showToast({ title: '生成失败:' + (err.message || err), icon: 'none' })
      })
  },

  copyCode: function (event) {
    var code = event.currentTarget.dataset.code
    wx.setClipboardData({ data: code })
  },

  loadApplications: function () {
    var self = this
    api.getApplications()
      .then(function (resp) {
        var list = (resp && resp.list) || []
        var statusMap = { pending: '待审核', approved: '已通过', rejected: '已拒绝' }
        list.forEach(function (a) {
          a.statusText = statusMap[a.status] || a.status
        })
        self.setData({
          applications: list,
          pendingApplications: list.filter(function (a) { return a.status === 'pending' }).length
        })
      })
      .catch(function (err) {
        wx.showToast({ title: '加载失败:' + (err.message || err), icon: 'none' })
      })
  },

  reviewApplication: function (event) {
    var id = event.currentTarget.dataset.id
    var action = event.currentTarget.dataset.action
    var name = event.currentTarget.dataset.name
    var that = this

    var label = action === 'approve' ? '同意' : '拒绝'
    wx.showModal({
      title: '确认' + label + '申请',
      content: '确定' + label + ' "' + name + '" 的申请吗?',
      success: function (result) {
        if (!result.confirm) return
        api.reviewApplication(id, action)
          .then(function () {
            wx.showToast({ title: label + '成功', icon: 'success' })
            that.loadApplications()
          })
          .catch(function (err) {
            wx.showToast({ title: '操作失败:' + (err.message || err), icon: 'none' })
          })
      }
    })
  },

  changeStatus: function (event) {
    var id = event.currentTarget.dataset.id
    var status = event.currentTarget.dataset.status
    var label = appointments.STATUS_LABELS[status]
    var that = this

    wx.showModal({
      title: '更新处理状态',
      content: '确定将预约状态改为“' + label + '”吗？',
      success: function (result) {
        if (!result.confirm) {
          return
        }
        if (USE_BACKEND) {
          api.updateStatus(id, status)
            .then(function () {
              that.loadItems()
              wx.showToast({ title: '状态已更新', icon: 'success' })
            })
            .catch(function (err) {
              wx.showToast({ title: '更新失败:' + (err.message || err), icon: 'none' })
              that.loadItems()
            })
          return
        }
        var changed = appointments.updateStatus(id, status)
        if (!changed) {
          wx.showToast({ title: '不允许这样变更状态', icon: 'none' })
          that.loadItems()
          return
        }
        that.loadItems()
        wx.showToast({ title: '状态已更新', icon: 'success' })
      }
    })
  },

  goDetail: function (event) {
    wx.navigateTo({
      url: '/pages/detail/detail?id=' + event.currentTarget.dataset.id + '&role=admin'
    })
  },

  goChat: function (event) {
    wx.navigateTo({
      url: '/pages/chat/chat?id=' + event.currentTarget.dataset.id + '&role=admin'
    })
  },

  onReplyInput: function (event) {
    var id = event.currentTarget.dataset.id
    var drafts = Object.assign({}, this.data.draftReplies)
    drafts[id] = event.detail.value
    this.setData({ draftReplies: drafts })
  },

  submitReply: function (event) {
    var id = event.currentTarget.dataset.id
    var text = String(this.data.draftReplies[id] || '').trim()
    if (!text) {
      wx.showToast({ title: '请先输入回复内容', icon: 'none' })
      return
    }
    var that = this

    if (USE_BACKEND) {
      api.sendMessage(id, 'admin', text)
        .then(function () {
          var drafts = Object.assign({}, that.data.draftReplies)
          drafts[id] = ''
          that.setData({ draftReplies: drafts })
          that.loadItems()
          wx.showToast({ title: '回复已发送', icon: 'success' })
        })
        .catch(function (err) {
          wx.showToast({ title: '回复失败:' + (err.message || err), icon: 'none' })
        })
      return
    }

    var changed = appointments.replyTo(id, text)
    if (!changed) {
      wx.showToast({ title: '回复失败，请重试', icon: 'none' })
      return
    }

    var drafts = Object.assign({}, that.data.draftReplies)
    drafts[id] = ''
    that.setData({ draftReplies: drafts })
    that.loadItems()
    wx.showToast({ title: '回复已发送', icon: 'success' })
  }
})
