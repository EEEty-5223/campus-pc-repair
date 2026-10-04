var api = require('../../utils/api-request.js')

var DEPARTMENTS = ['技术部', '运营部', '宣传部']

Page({
  data: {
    // 表单
    inviteCode: '',
    name: '',
    departmentIndex: 0,
    departments: DEPARTMENTS,
    studentId: '',
    submitting: false,
    // 已有申请状态
    application: null,
    statusText: '',
    loadingStatus: true,
    // 是否已管理员
    isAdmin: false
  },

  onLoad: function () {
    this.loadStatus()
  },

  onShow: function () {
    this.loadStatus()
  },

  loadStatus: function () {
    var self = this
    var app = getApp()
    var doLoad = function () {
      var isAdmin = !!(app && app.globalData && app.globalData.isAdmin)
      self.setData({ isAdmin: isAdmin })
      if (isAdmin) {
        self.setData({ loadingStatus: false })
        return
      }
      api.getMyApplyStatus()
        .then(function (resp) {
          var app0 = (resp && resp.application) || null
          var statusMap = { pending: '待审核', approved: '已通过', rejected: '已拒绝' }
          self.setData({
            application: app0,
            statusText: app0 ? (statusMap[app0.status] || app0.status) : '',
            loadingStatus: false
          })
        })
        .catch(function (err) {
          console.error('[apply] 查状态失败:', err.message)
          self.setData({ loadingStatus: false })
        })
    }
    if (app && app.globalData && app.globalData.loginReady) {
      app.globalData.loginReady.then(doLoad).catch(doLoad)
    } else {
      doLoad()
    }
  },

  onInput: function (e) {
    var field = e.currentTarget.dataset.field
    var patch = {}
    patch[field] = e.detail.value
    this.setData(patch)
  },

  onDeptChange: function (e) {
    this.setData({ departmentIndex: parseInt(e.detail.value) })
  },

  submit: function () {
    var self = this
    var d = this.data
    if (d.submitting) return

    var code = String(d.inviteCode || '').trim()
    var name = String(d.name || '').trim()
    var studentId = String(d.studentId || '').trim()
    var department = DEPARTMENTS[d.departmentIndex]

    if (!code) {
      wx.showToast({ title: '请输入邀请码', icon: 'none' })
      return
    }
    if (!name) {
      wx.showToast({ title: '请输入姓名', icon: 'none' })
      return
    }

    self.setData({ submitting: true })
    api.submitApply(code, name, department, studentId)
      .then(function () {
        wx.showToast({ title: '申请已提交', icon: 'success' })
        self.setData({ submitting: false })
        self.loadStatus()
      })
      .catch(function (err) {
        self.setData({ submitting: false })
        wx.showToast({ title: '提交失败:' + (err.message || err), icon: 'none', duration: 3000 })
      })
  },

  refresh: function () {
    this.setData({ loadingStatus: true })
    this.loadStatus()
  }
})