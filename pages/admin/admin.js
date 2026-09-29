var appointments = require('../../utils/appointments')
var api = require('../../utils/api-request.js')
var USE_BACKEND = true

Page({
  data: {
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
    }
  },

  onShow: function () {
    this.loadItems()
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

  addDemoData: function () {
    var created = appointments.seedDemoData()
    if (!created) {
      wx.showToast({ title: '已有预约，未添加演示数据', icon: 'none' })
      return
    }
    this.setData({ currentFilter: 'all' })
    this.loadItems()
    wx.showToast({ title: '演示数据已生成', icon: 'success' })
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
