var api = require('./api-request')
var labels = { accepted: '预约成功', repairing: '维修中', completed: '已完成', cancelled: '已取消' }
var allowed = { pending: ['accepted', 'cancelled'], accepted: ['repairing', 'cancelled'], repairing: ['completed', 'cancelled'] }
function identity() { var u = (getApp() && getApp().globalData) || {}; return [u.openid, u.notificationSession, u.role, u.department].join(':') }
function failure(error) {
  var messages = { ASSIGNEE_REQUIRED: '请先分配至少一名有效服务人员，再确认预约。', COMPLETION_CODE_INVALID: '完成码不正确，请向用户重新核对。', COMPLETION_CODE_LOCKED: '完成码连续输入错误，已暂时锁定，请稍后再试。', INVALID_STATUS_TRANSITION: '预约状态已经变化，请刷新后操作。', APPOINTMENT_FORBIDDEN: '当前账号没有处理该预约的权限。' }
  return messages[error && error.code] || '操作未完成，请刷新后重试。'
}
module.exports = {
  changeStatus: function (event) {
    var self = this, id = event.currentTarget.dataset.id, status = event.currentTarget.dataset.status
    var item = (this.data.allItems || []).find(function (r) { return r.id === id })
    if (!item || item.isVoided || this._statusBusy || !(allowed[item.status] || []).includes(status)) return
    if (status === 'accepted' && !(Number(item.assignedActiveCount) > 0 || (item.assignedActiveCount === undefined && item.assignedOpenid))) { wx.showToast({ title: '请先分配服务人员，再确认预约', icon: 'none' }); return }
    var who = identity(), version = this._chatVisibilityVersion, original = item.status
    function current() { return who === identity() && version === self._chatVisibilityVersion && self._chatVisible !== false }
    wx.showModal({ title: status === 'completed' ? '输入用户的4位完成码' : '更新处理状态', content: status === 'completed' ? '' : '确定将预约状态改为“' + labels[status] + '”吗？', editable: status === 'completed', placeholderText: '向用户核对4位数字，保留前导零', confirmText: status === 'completed' ? '确认完成' : '确认', success: function (r) {
      if (!r.confirm || !current() || self._statusBusy) return
      var latest = (self.data.allItems || []).find(function (x) { return x.id === id })
      if (!latest || latest.status !== original) { wx.showToast({ title: '预约状态已变化，请刷新', icon: 'none' }); return }
      var code = status === 'completed' ? String(r.content || '').trim() : undefined
      if (status === 'completed' && !/^\d{4}$/.test(code)) { wx.showToast({ title: '请输入4位数字完成码', icon: 'none' }); return }
      self._statusBusy = true; self.setData({ statusBusy: true })
      api.updateStatus(id, status, code).then(function () {
        if (!current()) return
        wx.showToast({ title: '状态已更新', icon: 'success' }); return self.loadItems()
      }).catch(function (error) {
        if (!current()) return
        wx.showModal({ title: status === 'completed' ? '预约尚未完成' : '状态更新未完成', content: failure(error), showCancel: false })
        return self.loadItems()
      }).then(function () { self._statusBusy = false; if (who === identity() && self._chatVisible !== false) self.setData({ statusBusy: false }) })
    } })
  }
}
