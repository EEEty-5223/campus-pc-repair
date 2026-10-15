var appointments = require('../../utils/appointments')
var api = require('../../utils/api-request.js')
var chatUnread = require('../../utils/chat-unread')
var notifications = require('../../utils/admin-notifications')
var memberDirectory = require('../../utils/members')
var memberSession = require('../../utils/member-session')
var statusUI = require('../../utils/appointment-status-ui')
var assignmentUI = require('../../utils/assignment-ui')
var USE_BACKEND = true

function copyMember(member) { return JSON.parse(JSON.stringify(member)) }
function memberViewer(page) {
  var user = (getApp() && getApp().globalData) || {}
  return (user.openid || '') + ':' + page.data.role + ':' + (page.data.role === 'leader' ? page.data.myDepartment : '')
}
function canEditMember(page, member) {
  if (!member || member.isSelf || ['member', 'leader'].indexOf(member._originalRole) === -1 || Number(member.status) !== 1) return false
  return page.data.role === 'admin' || (page.data.role === 'leader' && member._originalRole === 'member' && member._originalDepartment === page.data.myDepartment)
}
function memberIndex(page, event) {
  var openid = event && event.currentTarget && event.currentTarget.dataset.openid
  if (!openid) return -1
  return page.data.members.findIndex(function (member) { return member.openid === openid })
}
function profileViewer() {
  var user = (getApp() && getApp().globalData) || {}
  return (user.openid || '') + ':' + (user.notificationSession || '')
}
function validOwnProfile(profile) {
  return !!profile && !Array.isArray(profile) && profile.role === 'admin' && ['name', 'nickname', 'contact', 'department', 'displayTag'].every(function (field) { return typeof profile[field] === 'string' })
}

Page(assignmentUI.withPage(Object.assign({
  data: Object.assign({}, notifications.data, {
    activeTab: 'appointments',
    role: '',
    allItems: [],
    items: [],
    currentFilter: 'all',
    draftReplies: {},
    filters: [{
        value: 'all',
        label: '全部',
        count: 0
      },
      {
        value: 'pending',
        label: '预约中',
        count: 0
      },
      {
        value: 'accepted',
        label: '预约成功',
        count: 0
      },
      {
        value: 'repairing',
        label: '维修中',
        count: 0
      },
      {
        value: 'completed',
        label: '已完成',
        count: 0
      },
      {
        value: 'cancelled',
        label: '已取消',
        count: 0
      }
    ],
    stats: {
      total: 0,
      active: 0,
      completed: 0
    },
    inviteCodes: [],
    applications: [],
    pendingApplications: 0,
    members: [],
    directoryMembers: [],
    memberSortMode: 'server',
    membersNeedLogin: false,
    membersErrorText: '',
    memberRoles: ['leader', 'member'],
    memberRoleOptions: ['负责人', '成员'],
    memberRoleLabels: {
      admin: '管理员',
      leader: '负责人',
      member: '成员'
    },
    memberDepartments: ['技术部', '运营部', '宣传部'],
    memberDepartmentLabels: ['技术部', '运营部', '宣传部'],
    memberDepartmentFilter: 'all',
    memberDepartmentFilters: [],
    memberGroups: [],
    memberStats: { total: 0, active: 0, departments: 0 },
    membersLoading: false,
    membersError: false,
    ownProfile: null,
    ownProfileDraft: {},
    ownProfileEditing: false,
    ownProfileLoading: false,
    ownProfileSaving: false,
    ownProfileNeedsLogin: false,
    ownProfileError: '',
    editingMember: null,
    assignDialogVisible: false,
    assignAppointmentId: '',
    assignDepartmentIndex: 0,
    assignMemberIndex: 0,
    assignableMembers: [],
    myDepartment: '',
    itemsLoading: false,
    itemsError: false

  }),

  onLoad: function (options) {
    if (options && options.tab === 'members') this.setData({ activeTab: 'members' })
  },

  onShow: function () {
    var self = this
    var app = getApp()
    this._chatVisible = true
    this.setData({ statusBusy: !!this._statusBusy })
    var version = (this._chatVisibilityVersion || 0) + 1
    this._chatVisibilityVersion = version
    var refresh = function () {
      if (!self._chatVisible || version !== self._chatVisibilityVersion) return
      // 登录完成后再同步角色，首次进入也能显示正确的操作入口。
      self.setData({
        role: (app && app.globalData && app.globalData.role) || '',
        myDepartment: (app && app.globalData && app.globalData.department) || ''
      })
      self.loadItems().then(function () { self.scheduleChatPolling() })
      self.loadNotificationStatus()
      if (self.data.activeTab === 'members') {
        self.loadMembers()
      }
    }
    // 等登录完成再拉数据,避免 openid 还没拿到时显示本地旧数据
    if (app && app.globalData && app.globalData.loginReady) {
      app.globalData.loginReady
        .then(function () {
          refresh()
        })
        .catch(function () {
          refresh()
        })
    } else {
      refresh()
    }
  },

  chatViewerIdentity: function () {
    var user = (getApp() && getApp().globalData) || {}
    return (user.openid || '') + ':' + (user.notificationSession || '') + ':' + (user.role || '') + ':' + (user.department || '')
  },
  stopChatPolling: function () { if (this._chatTimer) { clearTimeout(this._chatTimer); this._chatTimer = null } },
  scheduleChatPolling: function () {
    var self = this; this.stopChatPolling()
    if (this._chatVisible && this.data.activeTab === 'appointments') this._chatTimer = setTimeout(function () {
      self._chatTimer = null
      if (self._chatVisible && self.data.activeTab === 'appointments') self.loadItems().then(function () { self.scheduleChatPolling() })
    }, 10000)
  },
  onHide: function () { this._chatVisible = false; this._chatVisibilityVersion = (this._chatVisibilityVersion || 0) + 1; this._itemsLoadId = (this._itemsLoadId || 0) + 1; this.stopChatPolling() },
  onUnload: function () { this.onHide() },

  loadItems: function () {
    var self = this
    if (!this._chatVisible) return Promise.resolve()
    var identity = this.chatViewerIdentity(), version = this._chatVisibilityVersion, loadId = (this._itemsLoadId || 0) + 1
    this._itemsLoadId = loadId
    var current = function () { return self._chatVisible && identity === self.chatViewerIdentity() && version === self._chatVisibilityVersion && loadId === self._itemsLoadId }
    self.setData({ itemsLoading: !self.data.allItems.length, itemsError: false })
    var render = function (list) {
      if (!current()) return
      var allItems = list.map(function (item) {
        var decorated = appointments.decorate ? appointments.decorate(item) : item
        if (decorated.latestMessage) decorated.latestMessage = Object.assign({}, decorated.latestMessage, { viewerClass: decorated.latestMessage.from === 'admin' ? 'reply-own' : 'reply-other', fromText: decorated.latestMessage.from === 'admin' ? '社团成员' : '预约用户' })
        return decorated
      })
      var filters = self.data.filters.map(function (filter) {
        var count = filter.value === 'all' ?
          allItems.length :
          allItems.filter(function (item) {
            return item.status === filter.value
          }).length
        return Object.assign({}, filter, {
          count: count
        })
      })
      self.setData({
        itemsLoading: false,
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
      return api.getAdminAppointments()
        .then(function (resp) {
          var list = (resp && resp.list) || []
          // 补每条预约的消息
          var msgPromises = list.map(function (item) {
            return api.getMessages(item.id).then(function (mr) {
              if (!mr || !Array.isArray(mr.list)) throw new Error('消息无法读取')
              item.messages = mr.list
              item._messagesFailed = false
              return item
            }).catch(function () {
              var previous = self.data.allItems.find(function (old) { return old.id === item.id })
              item.messages = previous ? (previous.messages || []) : []
              item._messagesFailed = true
              return item
            })
          })
          return Promise.all(msgPromises)
        })
        .then(function (list) {
          render(list)
        })
        .catch(function (err) {
          if (!current()) return
          console.error('[admin] 拉取失败:', err.message)
          self.setData({ itemsLoading: false, itemsError: true })
        })
    }
    render(appointments.list())
    return Promise.resolve()
  },

  selectFilter: function (event) {
    this.setData({
      currentFilter: event.currentTarget.dataset.status
    })
    this.applyFilter()
  },

  applyFilter: function () {
    var self = this, identity = this.chatViewerIdentity(), renderId = (this._previewRenderId || 0) + 1
    this._previewRenderId = renderId
    var status = this.data.currentFilter
    var items = status === 'all' ?
      this.data.allItems :
      this.data.allItems.filter(function (item) {
        return item.status === status
      })
    this.setData({ items: items }, function () {
      if (!self._chatVisible || self.data.itemsLoading || self.data.activeTab !== 'appointments' || self.data.currentFilter !== status || renderId !== self._previewRenderId || identity !== self.chatViewerIdentity()) return
      var user = (getApp() && getApp().globalData) || {}
      items.forEach(function (item) { if (item.canReply && item.latestMessage && !item._messagesFailed) chatUnread.markRead(user.openid, item.id, 'admin', [item.latestMessage]) })
    })
  },

  switchTab: function (event) {
    var tab = event.currentTarget.dataset.tab
    this.setData({
      activeTab: tab
    })
    this._previewRenderId = (this._previewRenderId || 0) + 1
    this.stopChatPolling()
    if (tab === 'appointments') { this.applyFilter(); this.scheduleChatPolling() }
    if (tab === 'invite') {
      this.loadInviteCodes()
    } else if (tab === 'apply') {
      this.loadApplications()
    } else if (tab === 'members') {
      this.loadMembers()
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
        self.setData({
          inviteCodes: list
        })
      })
      .catch(function (err) {
        wx.showToast({
          title: '加载失败:' + (err.message || err),
          icon: 'none'
        })
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
            wx.setClipboardData({
              data: code
            })
          }
        })
        self.loadInviteCodes()
      })
      .catch(function (err) {
        wx.showToast({
          title: '生成失败:' + (err.message || err),
          icon: 'none'
        })
      })
  },

  copyCode: function (event) {
    var code = event.currentTarget.dataset.code
    wx.setClipboardData({
      data: code
    })
  },

  loadApplications: function () {
    var self = this
    api.getApplications()
      .then(function (resp) {
        var list = (resp && resp.list) || []
        var statusMap = {
          pending: '待审核',
          approved: '已通过',
          rejected: '已拒绝'
        }
        list.forEach(function (a) {
          a.statusText = statusMap[a.status] || a.status
        })
        self.setData({
          applications: list,
          pendingApplications: list.filter(function (a) {
            return a.status === 'pending'
          }).length
        })
      })
      .catch(function (err) {
        wx.showToast({
          title: '加载失败:' + (err.message || err),
          icon: 'none'
        })
      })
  },

  loadMembers: function () {
    var self = this
    var user = (getApp() && getApp().globalData) || {}
    if (['admin', 'leader', 'member'].indexOf(this.data.role) === -1) return Promise.resolve()
    var viewer = memberSession.key()
    if (this._membersViewer !== viewer) {
      this.setData({ members: [], memberGroups: [], directoryMembers: [], memberStats: { total: 0, active: 0, departments: 0 } })
    }
    this._membersViewer = viewer
    var loadId = (this._memberLoadId || 0) + 1
    this._memberLoadId = loadId
    var isCurrent = function () { return loadId === self._memberLoadId && viewer === memberSession.key() }
    this.setData({ membersLoading: true, membersError: false, membersNeedLogin: false, membersErrorText: '' })
    return api.getMemberDirectory().then(function (resp) {
      if (!isCurrent()) return
      if (!resp || !Array.isArray(resp.list)) throw new Error('名单格式错误')
      var sorted = memberDirectory.sortMembers(resp.list, resp.selfOpenid || user.openid, self.data.memberSortMode)
      sorted = sorted.map(function (m) { return Object.assign({}, m, { roleText: memberDirectory.ROLE_LABELS[m.role] || m.role, isSelf: m.openid === (resp.selfOpenid || user.openid) }) })
      self.setData({ members: sorted, memberDepartmentFilters: memberDirectory.tables(sorted), memberStats: { total: sorted.length, active: sorted.filter(function (m) { return m.isActive || Number(m.status) === 1 }).length } })
      self.applyMemberView()
    }).catch(function (error) {
      if (!isCurrent()) return
      self.setData({ membersError: true, membersNeedLogin: memberSession.authError(error), membersErrorText: memberSession.authError(error) ? '请在手机微信中重新登录后查看社团资料。' : '成员表加载失败，请重试。' })
    }).then(function () { if (isCurrent()) self.setData({ membersLoading: false }) })
  },

  applyMemberView: function () {
    var table = this.data.memberDepartmentFilter
    if (!this.data.memberDepartmentFilters.some(function (tab) { return tab.value === table })) table = 'all'
    var list = table === 'all' ? this.data.members : this.data.members.filter(function (m) { return 'department:' + (m.department || '') === table })
    this.setData({ memberDepartmentFilter: table, directoryMembers: list })
  },

  selectMemberDepartment: function (event) {
    this.setData({ memberDepartmentFilter: event.currentTarget.dataset.department })
    this.applyMemberView()
  },

  goMemberDetail: function (event) {
    var openid = event.currentTarget.dataset.openid
    if (!this.data.members.some(function (m) { return m.openid === openid && m.canView !== false })) return
    wx.navigateTo({ url: '/pages/member-detail/member-detail?openid=' + encodeURIComponent(openid) })
  },

  goProfileReviews: function () {
    if (this.data.role !== 'admin' && this.data.role !== 'leader') return
    wx.navigateTo({ url: '/pages/member-detail/member-detail?review=1' })
  },
  goRemovalRequests: function () {
    if (['admin', 'leader'].indexOf(this.data.role) !== -1) wx.navigateTo({ url: '/pages/member-detail/member-detail?removals=1' })
  },

  reloginMembers: function () {
    var self = this
    if (this.data.membersLoading) return Promise.resolve()
    this.setData({ membersLoading: true })
    return memberSession.renew().then(function (user) {
      self.setData({ role: user.role, myDepartment: user.department || '' })
      return self.loadMembers()
    }).catch(function () { self.setData({ membersLoading: false, membersNeedLogin: true, membersErrorText: '登录未完成，请在手机微信中重新登录。' }) })
  },

  showAssign: function (event) {
    var id = event.currentTarget.dataset.id
    var self = this
    this.setData({
      assignDialogVisible: true,
      assignAppointmentId: id,
      assignMemberIndex: 0,
      assignableMembers: []
    })
    this.loadAssignableMembers()
  },

  loadAssignableMembers: function () {
    var self = this
    var role = self.data.role
    var myDepartment = self.data.myDepartment
    var roleLabels = self.data.memberRoleLabels
    api.getMembers()
      .then(function (resp) {
        var list = (resp && resp.list) || []
        // leader 只能选本部门 member；admin 可以选所有人（admin/leader/member）
        if (role === 'leader') {
          list = list.filter(function (m) {
            return m.role === 'member' && m.department === myDepartment
          })
        }
        list.forEach(function (m) {
          var label = roleLabels[m.role] || m.role
          var dept = m.department ? ' · ' + m.department : ''
          m.displayName = (m.name || m.nickname || '未命名') + ' (' + label + dept + ')'
        })
        self.setData({ assignableMembers: list })
      })
      .catch(function () {
        self.setData({ assignableMembers: [] })
      })
  },

  onAssignMemberChange: function (event) {
    this.setData({ assignMemberIndex: event.detail.value })
  },

  hideAssignDialog: function () {
    this.setData({ assignDialogVisible: false })
  },

  stopPropagation: function () {},

  confirmAssign: function () {
    var self = this
    var members = this.data.assignableMembers
    var member = members[this.data.assignMemberIndex]
    if (!member) {
      wx.showToast({ title: '请选择成员', icon: 'none' })
      return
    }
    if (!member.department) {
      wx.showToast({ title: '该成员未设置部门，无法分配', icon: 'none' })
      return
    }
    wx.showModal({
      title: '确认分配',
      content: '把这条预约分配给 ' + (member.name || member.nickname || '该成员') + ' 吗？',
      success: function (r) {
        if (!r.confirm) return
        api.assignAppointment(self.data.assignAppointmentId, member.department, member.openid)
          .then(function () {
            wx.showToast({ title: '分配成功', icon: 'success' })
            self.setData({ assignDialogVisible: false })
            self.loadItems()
          })
          .catch(function (err) {
            wx.showToast({ title: '分配失败:' + (err.message || err), icon: 'none' })
          })
      }
    })
  },

  reviewApplication: function (event) {
    var id = event.currentTarget.dataset.id
    var action = event.currentTarget.dataset.action
    var name = event.currentTarget.dataset.name
    var that = this

    var label = action === 'approve' ? '同意' : '拒绝'
    if (action === 'reject') {
      wx.showModal({
        title: '驳回申请',
        content: '请填写驳回原因，申请人将看到此原因',
        editable: true,
        placeholderText: '例如：邀请码无效、信息填写不完整',
        success: function (result) {
          if (!result.confirm) return
          var reason = String(result.content || '').trim()
          if (!reason) {
            wx.showToast({
              title: '驳回原因不能为空',
              icon: 'none'
            })
            return
          }
          that.doReviewApplication(id, action, name, reason)
        }
      })
    } else {
      wx.showModal({
        title: '确认' + label + '申请',
        content: '确定' + label + ' "' + name + '" 的申请吗?',
        success: function (result) {
          if (!result.confirm) return
          that.doReviewApplication(id, action, name, '')
        }
      })
    }
  },

  doReviewApplication: function (id, action, name, reason) {
    var that = this
    var label = action === 'approve' ? '同意' : '拒绝'
    api.reviewApplication(id, action, reason)
      .then(function () {
        wx.showToast({
          title: label + '成功',
          icon: 'success'
        })
        that.loadApplications()
      })
      .catch(function (err) {
        wx.showToast({
          title: '操作失败:' + (err.message || err),
          icon: 'none'
        })
      })
  },

  changeStatus: function (event) { return statusUI.changeStatus.call(this, event) },

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
  previewReplyImage: function (event) { var url = event.currentTarget.dataset.url; if (url) wx.previewImage({ urls: [url], current: url }) },

  onReplyInput: function (event) {
    var id = event.currentTarget.dataset.id
    var drafts = Object.assign({}, this.data.draftReplies)
    drafts[id] = event.detail.value
    this.setData({
      draftReplies: drafts
    })
  },

  submitReply: function (event) {
    var id = event.currentTarget.dataset.id
    var text = String(this.data.draftReplies[id] || '').trim()
    if (!text) {
      wx.showToast({
        title: '请先输入回复内容',
        icon: 'none'
      })
      return
    }
    var that = this

    if (USE_BACKEND) {
      api.sendMessage(id, 'admin', text)
        .then(function () {
          var drafts = Object.assign({}, that.data.draftReplies)
          drafts[id] = ''
          that.setData({
            draftReplies: drafts
          })
          that.loadItems()
          wx.showToast({
            title: '回复已发送',
            icon: 'success'
          })
        })
        .catch(function (err) {
          wx.showToast({
            title: '回复失败:' + (err.message || err),
            icon: 'none'
          })
        })
      return
    }

    var changed = appointments.replyTo(id, text)
    if (!changed) {
      wx.showToast({
        title: '回复失败，请重试',
        icon: 'none'
      })
      return
    }

    var drafts = Object.assign({}, that.data.draftReplies)
    drafts[id] = ''
    that.setData({
      draftReplies: drafts
    })
    that.loadItems()
    wx.showToast({
      title: '回复已发送',
      icon: 'success'
    })
  }
}, notifications.methods)))
