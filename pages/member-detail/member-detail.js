var api = require('../../utils/api-request')
var members = require('../../utils/members')
var session = require('../../utils/member-session')
var STATUS = { pending: '待审核', approved: '已通过', rejected: '已拒绝', invalidated: '已失效' }
function decorateRequest(request) {
  return request ? Object.assign({}, request, { statusText: STATUS[request.status] || request.status, changes: members.changes(request) }) : null
}
function requestKey() {
  var key = Date.now().toString(16)
  while (key.length < 64) key += Math.floor(Math.random() * 0x100000000).toString(16).padStart(8, '0')
  return key.slice(0, 64)
}
Page({
  data: { profile: null, profileFields: [], roleText: '', loading: false, saving: false, editing: false, draft: {}, saveMode: 'request', departmentReadonly: false, pendingRequest: null, history: [], canReview: false, reviews: [], reviewsLoading: false, reviewBusy: false, error: '', reviewError: '', needsLogin: false },
  onLoad: function (options) { this._targetOpenid = String((options && options.openid) || ''); this._reviewMode = !!(options && options.review === '1') },
  onShow: function () { if (this._reviewMode) { this.resetForAccount(); this.setData({ canReview: true }); this.loadReviews() } else this.loadDetail() },

  resetForAccount: function () {
    var user = (getApp() && getApp().globalData) || {}
    if (this._accountOpenid !== user.openid) {
      this._accountOpenid = user.openid
      this._submission = null
      this._reviewLoadId = (this._reviewLoadId || 0) + 1
      this._saveId = (this._saveId || 0) + 1
      this.setData({ profile: null, profileFields: [], draft: {}, editing: false, pendingRequest: null, history: [], reviews: [], canReview: false, saving: false, reviewBusy: false, reviewsLoading: false })
    }
    if (this._viewer !== session.key()) { this._viewer = session.key(); this._saveId = (this._saveId || 0) + 1; this._reviewLoadId = (this._reviewLoadId || 0) + 1; this.setData({ saving: false, reviews: [], canReview: false, reviewBusy: false, reviewsLoading: false }) }
  },

  refreshDetail: function () { if (this._reviewMode) { this.setData({ canReview: true }); return this.loadReviews() } return this.loadDetail() },

  loadDetail: function () {
    var self = this
    this.resetForAccount()
    if (!this._targetOpenid) { this.setData({ error: '未找到成员，请返回成员表重新选择。', loading: false }); return Promise.resolve() }
    var viewer = session.key(), loadId = (this._loadId || 0) + 1
    this._loadId = loadId
    var current = function () { return loadId === self._loadId && viewer === session.key() }
    this.setData({ loading: true, error: '', needsLogin: false })
    return api.getMemberDetail(this._targetOpenid).then(function (response) {
      if (!current()) return
      if (!response || !response.profile || typeof response.profile.openid !== 'string') throw new Error('invalid profile')
      self.applyProfile(response.profile)
      self.setData({ pendingRequest: decorateRequest(response.pendingRequest), canReview: Object.prototype.hasOwnProperty.call(response, 'canReview') ? !!response.canReview : !!response.profile.canReview })
      if (!self.data.editing) self.setData({ draft: members.draft(response.profile) })
      if (response.profile.isSelf && response.profile.canEdit) {
        return api.getMyProfileRequests().then(function (result) {
          if (!current()) return
          if (!result || !Array.isArray(result.requests)) throw new Error('invalid history')
          if (result.currentProfile) self.applyProfile(Object.assign({}, response.profile, result.currentProfile))
          self.setData({ history: result.requests.map(decorateRequest), pendingRequest: decorateRequest(result.pendingRequest) })
          if (!self.data.editing) self.setData({ draft: members.draft(self.data.profile) })
        })
      }
    }).catch(function (error) {
      if (current()) self.setData({ needsLogin: session.authError(error), error: session.authError(error) ? '请在手机微信中重新登录后查看社团资料。' : '成员资料暂时无法加载，请重试。' })
    }).then(function () {
      if (current()) { self.setData({ loading: false }); if (self.data.canReview) return self.loadReviews() }
    })
  },

  applyProfile: function (profile) {
    this.setData({ profile: profile, roleText: members.ROLE_LABELS[profile.role] || profile.role, profileFields: members.FIELDS.map(function (field) {
      return { key: field.key, label: field.label, value: profile[field.key] || '未填写' }
    }) })
    if (profile.isSelf) {
      var app = getApp()
      if (app && app.globalData) { app.globalData.department = profile.department || ''; app.globalData.role = profile.role; app.globalData.isAdmin = ['admin', 'leader', 'member'].indexOf(profile.role) !== -1; app.globalData.adminProfile = Object.assign({}, profile) }
    }
    var user = (getApp() && getApp().globalData) || {}
    this.setData({ departmentReadonly: !!(profile.canEdit && !profile.isSelf && user.role === 'leader') })
    this.updateSaveMode()
  },

  updateSaveMode: function () {
    var profile = this.data.profile || {}
    var changingOwnLeaderDepartment = profile.isSelf && profile.role === 'leader' && this.data.editing && String(this.data.draft.department || '').trim() !== (profile.department || '')
    this.setData({ saveMode: changingOwnLeaderDepartment ? 'request' : (profile.editMode || 'request') })
  },

  beginEdit: function () {
    var profile = this.data.profile
    if (!profile || !profile.canEdit || (profile.editMode === 'request' && this.data.pendingRequest) || this.data.needsLogin || this.data.saving) return
    this.setData({ editing: true, draft: members.draft(profile), error: '' })
    this.updateSaveMode()
  },
  cancelEdit: function () { if (!this.data.saving) { this._submission = null; this.setData({ editing: false, draft: members.draft(this.data.profile || {}), error: '' }) } },
  onDraftInput: function (event) {
    var field = event.currentTarget.dataset.field
    if (!this.data.editing || this.data.saving || (field === 'department' && this.data.departmentReadonly) || !members.FIELDS.some(function (item) { return item.key === field })) return
    var draft = Object.assign({}, this.data.draft); draft[field] = event.detail.value
    this.setData({ draft: draft })
    this.updateSaveMode()
  },

  submitChanges: function () {
    var self = this, profile = this.data.profile
    if (!profile || !profile.canEdit || !this.data.editing || this.data.saving || this.data.needsLogin) return Promise.resolve()
    this.updateSaveMode()
    var isDirect = this.data.saveMode === 'direct'
    if (!isDirect && (!profile.isSelf || this.data.pendingRequest)) return Promise.resolve()
    var proposed = {}, draft = members.draft(this.data.draft)
    var valid = members.FIELDS.every(function (field) {
      var value = String(draft[field.key]).trim()
      if (Array.from(value).length > field.max || /[\u0000-\u001f\u007f]/.test(value) || (field.key === 'name' && !value)) return false
      if (value !== (profile[field.key] || '')) proposed[field.key] = value
      return true
    })
    if (!valid) { this.setData({ error: '请填写姓名，并检查资料长度和格式。' }); return Promise.resolve() }
    if (!Object.keys(proposed).length) { this.setData({ error: '资料没有变化，无需提交申请。' }); return Promise.resolve() }
    var bodyText = JSON.stringify(proposed)
    if (!this._submission || this._submission.bodyText !== bodyText) this._submission = { bodyText: bodyText, body: Object.assign({ requestKey: requestKey() }, proposed) }
    var submission = this._submission, viewer = session.key(), saveId = (this._saveId || 0) + 1
    this._saveId = saveId; this._loadId = (this._loadId || 0) + 1
    var current = function () { return self._saveId === saveId && viewer === session.key() }
    this.setData({ saving: true, loading: false, error: '' })
    var operation = isDirect ? api.updateMemberProfile(profile.openid, submission.body) : api.submitProfileRequest(submission.body)
    return operation.then(function (response) {
      if (!current()) return
      if (isDirect) {
        if (!response || !response.profile) throw new Error('invalid profile')
        self._submission = null
        self.applyProfile(response.profile)
        self.setData({ saving: false, editing: false, draft: members.draft(response.profile) })
        wx.showToast({ title: '资料修改已保存', icon: 'success' })
        return self.loadDetail()
      }
      if (!response || !response.request) throw new Error('invalid request')
      self._submission = null
      self.setData({ saving: false, editing: false, pendingRequest: response.request.status === 'pending' ? decorateRequest(response.request) : null })
      wx.showToast({ title: '申请已提交，等待审核', icon: 'none' })
      // 当前资料保持后端已生效版本，申请提案只显示在待审核区域。
      return self.loadDetail()
    }).catch(function (error) {
      if (!current()) return
      if (error.code === 'NO_PROFILE_CHANGES') { self._submission = null; self.setData({ saving: false, editing: false }); return self.loadDetail() }
      if (error.code === 'REQUEST_KEY_CONFLICT') { self._submission = null; self.setData({ saving: false, error: '保存记录已改变，请刷新确认后再提交。' }); return }
      if (error.code === 'DEPARTMENT_APPROVAL_REQUIRED' && profile.isSelf) self.setData({ saveMode: 'request' })
      self.setData({ saving: false, needsLogin: session.authError(error), error: session.authError(error) ? '请重新微信登录后重试，未提交内容仍保留。' : (error.code === 'DEPARTMENT_APPROVAL_REQUIRED' ? (profile.isSelf ? '部门变更需要审核，请提交修改申请。' : '跨部门修改需由本人提交申请或管理员处理。') : (error.code === 'PROFILE_REQUEST_PENDING' ? '已有待审申请，请刷新查看；当前草稿仍保留。' : (isDirect ? '保存未完成，草稿已保留，请重试。' : '提交未完成，草稿已保留，请重试。'))) })
    }).then(function () { if (current()) self.setData({ saving: false }) })
  },

  relogin: function () {
    var self = this
    if (this.data.saving || this.data.loading) return Promise.resolve()
    this.setData({ loading: true })
    return session.renew().then(function () { if (self._reviewMode) { self.resetForAccount(); self.setData({ loading: false, canReview: true }); return self.loadReviews() } return self.loadDetail() }).catch(function () { self.resetForAccount(); self.setData({ loading: false, needsLogin: true, error: '登录未完成，请在手机微信中重新登录。' }) })
  },

  loadReviews: function () {
    var self = this
    if (!this.data.canReview) return Promise.resolve()
    var viewer = session.key(), loadId = (this._reviewLoadId || 0) + 1
    this._reviewLoadId = loadId
    var current = function () { return loadId === self._reviewLoadId && viewer === session.key() }
    this.setData({ reviewsLoading: true, reviewError: '' })
    if (this._reviewMode) this.setData({ error: '', needsLogin: false })
    return api.getProfileReviews().then(function (response) {
      if (!current()) return
      if (!response || !Array.isArray(response.list)) throw new Error('invalid reviews')
      var user = (getApp() && getApp().globalData) || {}
      self.setData({ canReview: !!response.canReview, reviews: response.list.filter(function (r) { return r.status === 'pending' && (self._reviewMode || r.requesterOpenid === self._targetOpenid) }).map(function (r) { return Object.assign(decorateRequest(r), { canAct: response.canReview && r.canReview !== false && r.requesterOpenid !== user.openid }) }) })
    }).catch(function (error) { if (current()) self.setData({ reviewError: '待审申请加载失败，请刷新重试。', error: self._reviewMode ? (session.authError(error) ? '请重新微信登录后查看待审资料。' : '当前暂不能查看待审资料，请返回成员表或稍后重试。') : self.data.error, needsLogin: session.authError(error), canReview: error.code === 'REVIEW_FORBIDDEN' ? false : self.data.canReview }) })
      .then(function () { if (current()) self.setData({ reviewsLoading: false }) })
  },

  reviewRequest: function (event) {
    var self = this, id = event.currentTarget.dataset.id, decision = event.currentTarget.dataset.decision
    var request = this.data.reviews.find(function (r) { return String(r.id) === String(id) })
    if (!this.data.canReview || this.data.reviewBusy || !request || !request.canAct || ['approve', 'reject'].indexOf(decision) === -1) return
    var viewer = session.key()
    wx.showModal({ title: decision === 'approve' ? '通过资料修改申请' : '拒绝资料修改申请', content: decision === 'approve' ? '请确认已查看修改前后的内容。通过后，新资料立即生效。' : '请填写拒绝原因，申请人可在记录中查看。', editable: decision === 'reject', placeholderText: '请说明需要调整的内容',
      success: function (result) {
        if (!result.confirm || viewer !== session.key()) return
        var reason = decision === 'reject' ? String(result.content || '').trim() : ''
        if (decision === 'reject' && !reason) { wx.showToast({ title: '请填写拒绝原因', icon: 'none' }); return }
        self.setData({ reviewBusy: true, reviewError: '' })
        api.reviewProfileRequest(id, decision, reason).then(function () {
          if (viewer !== session.key()) return
          self.setData({ reviewBusy: false }); wx.showToast({ title: '审核结果已保存', icon: 'none' }); return self._reviewMode ? self.loadReviews() : self.loadDetail()
        }).catch(function (error) {
          if (viewer !== session.key()) return
          self.setData({ reviewBusy: false, reviewError: ['REQUEST_NOT_PENDING', 'PROFILE_CONFLICT', 'REQUEST_INVALIDATED'].indexOf(error.code) !== -1 ? '申请状态已改变，请刷新后查看。' : '审核未完成，请刷新后重试。' })
          self.loadReviews()
        })
      }
    })
  }
})
