var api = require('./api-request')
var session = require('./member-session')
var LABELS = { pending: '待管理员审核', approved: '已通过', rejected: '已拒绝', invalidated: '已失效' }
function viewerKey() { var user = (getApp() && getApp().globalData) || {}; return session.key() + ':' + user.role + ':' + user.department }
function key() { var s = Date.now().toString(16); while (s.length < 64) s += Math.floor(Math.random() * 0x100000000).toString(16).padStart(8, '0'); return s.slice(0, 64) }
function allowed(user, target) {
  return !!(user && target && target.status === 1 && ['member', 'leader'].indexOf(target.role) !== -1 && user.openid !== target.openid &&
    (user.role === 'admin' || (user.role === 'leader' && target.role === 'member' && user.department && user.department === target.department)))
}
function message(error) {
  var codes = { ASSIGNED_APPOINTMENTS_PENDING: '该成员还有未完成的维修任务，请先转交任务再移出。', REMOVAL_REQUEST_PENDING: '已有待审核的移出申请，请等待管理员处理。', REMOVAL_REQUEST_INVALIDATED: '人员身份或部门已变化，申请已失效，请刷新。', REMOVAL_REQUEST_NOT_PENDING: '申请已处理，请刷新查看结果。', REQUEST_KEY_CONFLICT: '提交标识已变化，请刷新后重试。' }
  return codes[error && error.code] || '操作未完成，权限或网络可能已变化，请刷新后重试。'
}
module.exports = {
  canRemove: allowed,
  methods: {
    loadMoreRemovals: function () { if (this.data.removalHasMore && !this.data.removalLoading && !this.data.removalBusy) return this.loadRemovalRequests((this.data.removalPage || 1) + 1) },
    loadRemovalRequests: function (page) {
      page = typeof page === 'number' ? page : 1
      var self = this, viewer = viewerKey(), epoch = this._removalEpoch, version = this._removalLoad = (this._removalLoad || 0) + 1
      var user = (getApp() && getApp().globalData) || {}
      if (['admin', 'leader'].indexOf(user.role) === -1) { this.setData({ removalRequests: [], removalCanReview: false }); return Promise.resolve() }
      var current = function () { return viewer === viewerKey() && epoch === self._removalEpoch && version === self._removalLoad }
      this.setData({ removalLoading: true, removalError: '' })
      return api.getRemovalRequests(page).then(function (result) {
        if (!current()) return
        if (!result || !Array.isArray(result.list)) throw new Error('invalid removal list')
        var list = result.list.filter(function (r) { return self._removalMode || r.targetOpenid === self._targetOpenid }).map(function (r) { return Object.assign({}, r, { statusText: LABELS[r.status] || r.status }) })
        if (page > 1) { var ids = {}; (self.data.removalRequests || []).forEach(function (r) { ids[r.id] = true }); list = (self.data.removalRequests || []).concat(list.filter(function (r) { return !ids[r.id] })) }
        self.setData({ removalRequests: list, removalCanReview: !!result.canReview, removalPage: page, removalHasMore: !!result.hasMore })
      }).catch(function (error) { if (current()) { var auth = session.authError(error); self.setData({ removalError: auth ? '登录身份已失效，请重新登录后重试。' : '移出申请加载失败，请刷新重试。', needsLogin: auth }); if (self._removalMode && auth) self.setData({ error: '请重新微信登录后查看移出申请。' }) } }).then(function () { if (current()) self.setData({ removalLoading: false }) })
    },
    beginRemove: function () {
      var self = this, profile = this.data.profile, user = (getApp() && getApp().globalData) || {}
      if (!allowed(user, profile) || this.data.removalBusy || this.data.saving || this.data.editing) return
      var viewer = viewerKey(), epoch = this._removalEpoch, direct = user.role === 'admin'
      var current = function () { return viewer === viewerKey() && epoch === self._removalEpoch && self.data.profile && self.data.profile.openid === profile.openid }
      wx.showModal({ title: direct ? '移出社团' : '申请移出社团', content: '对象：' + (profile.name || profile.nickname || '该成员') + '。请填写移出原因。' + (direct ? '确认后成员权限立即停用，历史记录保留。' : '提交后等待管理员审核，审核前成员资格不变。'), editable: true, placeholderText: '请填写原因（最多256字）', success: function (r) {
        if (!r.confirm || !current()) return
        var reason = String(r.content || '').trim()
        if (!reason || Array.from(reason).length > 256 || /[\u0000-\u001f\u007f]/.test(reason)) { wx.showToast({ title: '请填写有效原因，最多256字', icon: 'none' }); return }
        wx.showModal({ title: direct ? '确认移出该成员？' : '确认提交移出申请？', content: reason, confirmText: direct ? '确认移出' : '提交申请', confirmColor: '#b42318', success: function (confirmation) {
          if (!confirmation.confirm || !current() || self.data.removalBusy) return
          if (!self._removalSubmission || self._removalSubmission.target !== profile.openid || self._removalSubmission.reason !== reason) self._removalSubmission = { target: profile.openid, reason: reason, requestKey: key() }
          var submission = self._removalSubmission
          self.setData({ removalBusy: true, removalError: '' })
          api.removeMember(profile.openid, { reason: reason, requestKey: submission.requestKey }).then(function (result) {
            if (!current()) return
            if (!result || !result.ok || ['direct', 'request'].indexOf(result.mode) === -1) throw new Error('invalid removal result')
            self._removalSubmission = null
            if (result.mode === 'direct') self.setData({ profile: null, canRemoveMember: false, removalSuccess: '成员已移出社团，历史记录保留。返回成员表可查看最新名单。' })
            else { wx.showToast({ title: '已提交，等待管理员审核', icon: 'none' }); return self.loadRemovalRequests() }
          }).catch(function (error) { if (current()) self.setData({ removalError: message(error) }) }).then(function () { if (viewer === viewerKey() && epoch === self._removalEpoch) self.setData({ removalBusy: false }) })
        } })
      } })
    },
    reviewRemoval: function (event) {
      var self = this, id = String(event.currentTarget.dataset.id), decision = event.currentTarget.dataset.decision
      var request = (this.data.removalRequests || []).find(function (r) { return String(r.id) === id })
      if (!this.data.removalCanReview || this.data.removalBusy || !request || request.status !== 'pending' || ['approve', 'reject'].indexOf(decision) === -1) return
      var viewer = viewerKey(), epoch = this._removalEpoch
      wx.showModal({ title: decision === 'approve' ? '同意移出成员？' : '拒绝移出申请', content: decision === 'approve' ? '成员：' + (request.targetName || '社团成员') + '。原因：' + request.reason + '。通过后立即停用社团权限，历史记录保留。' : '请填写拒绝原因，申请人可查看。', editable: decision === 'reject', success: function (r) {
        if (!r.confirm || viewer !== viewerKey() || epoch !== self._removalEpoch || self.data.removalBusy) return
        var reason = decision === 'reject' ? String(r.content || '').trim() : ''
        if ((decision === 'reject' && !reason) || Array.from(reason).length > 256) { wx.showToast({ title: '请填写有效拒绝原因', icon: 'none' }); return }
        self.setData({ removalBusy: true, removalError: '' })
        api.reviewRemovalRequest(id, decision, reason).then(function () {
          if (viewer !== viewerKey() || epoch !== self._removalEpoch) return
          if (decision === 'approve' && request.targetOpenid === self._targetOpenid && !self._removalMode) self.setData({ profile: null, canRemoveMember: false, canReview: false, reviews: [], removalSuccess: '成员已移出社团，历史记录保留。返回成员表可查看最新名单。' })
          wx.showToast({ title: '审核结果已保存', icon: 'none' })
          return self.loadRemovalRequests()
        }).catch(function (error) { if (viewer === viewerKey() && epoch === self._removalEpoch) self.setData({ removalError: message(error) }) }).then(function () { if (viewer === viewerKey() && epoch === self._removalEpoch) self.setData({ removalBusy: false }) })
      } })
    }
  }
}
