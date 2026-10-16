var api = require('./api-request')
var statuses = ['pending', 'accepted', 'repairing', 'completed', 'cancelled']
var labels = ['预约中', '预约成功', '维修中', '已完成', '已取消']
function identity() { var u = (getApp() && getApp().globalData) || {}; return [u.openid, u.notificationSession, u.role].join(':') }
function permitted() { var u = (getApp() && getApp().globalData) || {}; return u.role === 'admin' && !!u.notificationSession && !u.isSimulator }
function operate(page, id, status) {
  if (!permitted() || page._adminActionBusy || page._detailVisible === false || page._chatVisible === false) return
  var who = identity(), item = page.data.item || (page.data.allItems || []).find(function (x) { return x.id === id })
  var restoring = status === 'restore'
  if (!item || (!!item.isVoided !== restoring)) return
  var originalStatus = item.status, detailVersion = page._detailVersion, chatVersion = page._chatVisibilityVersion
  var title = restoring ? '恢复已作废预约' : (status === null ? '作废并隐藏预约' : (status === 'completed' ? '强制完成预约' : '强制修改状态'))
  function current() { return who === identity() && permitted() && page._detailVisible !== false && page._chatVisible !== false && detailVersion === page._detailVersion && chatVersion === page._chatVisibilityVersion }
  function unchanged() { var latest = page.data.item || (page.data.allItems || []).find(function (x) { return x.id === id }); return latest && latest.status === originalStatus && !!latest.isVoided === restoring }
  wx.showModal({ title: title, editable: true, placeholderText: '填写操作原因（必填，最多256字）', content: '', confirmText: '下一步', success: function (r) {
    if (!r.confirm || !current() || !unchanged() || page._adminActionBusy) return
    var reason = String(r.content || '').trim()
    if (!reason || reason.length > 256) { wx.showToast({ title: '请填写1至256字的原因', icon: 'none' }); return }
    var target = restoring ? '恢复后保留原状态“' + labels[statuses.indexOf(item.status)] + '”。进行中的预约将生成新完成码；已完成或已取消的预约仍只读。' : (status === null ? '作废后从正常列表隐藏，聊天仅可查看历史。' : '将状态强制改为“' + labels[statuses.indexOf(status)] + '”。' + (status === 'completed' ? '此次操作将跳过用户完成码。' : (status === 'repairing' ? '此次操作将跳过用户开工码。' : '')))
    wx.showModal({ title: '再次确认操作', content: target + '\n原因：' + reason + '\n此操作将记录管理员身份和时间，并向用户和分配人员展示管理员介入及原因。', confirmText: '确认操作', confirmColor: '#dc2626', success: function (confirm) {
      if (!confirm.confirm || !current() || !unchanged() || page._adminActionBusy) return
      page._adminActionBusy = true; page.setData({ adminActionBusy: true })
      var action = restoring ? api.restoreAppointment(id, reason) : (status === null ? api.voidAppointment(id, reason) : api.forceAppointmentStatus(id, status, reason))
      action.then(function () { if (current()) { wx.showToast({ title: '操作已完成', icon: 'success' }); return page.loadItem ? page.loadItem() : page.loadItems() } })
        .catch(function (e) { if (current()) wx.showModal({ title: '操作未完成', content: e.message || '请刷新后重试', showCancel: false }) })
        .then(function () { page._adminActionBusy = false; if (current()) page.setData({ adminActionBusy: false }) })
    } })
  } })
}
module.exports = {
  forceStatus: function (event) {
    if (!permitted() || this._adminActionBusy) return
    var page = this, who = identity(), id = event.currentTarget.dataset.id || this.data.id, detailVersion = this._detailVersion, chatVersion = this._chatVisibilityVersion
    wx.showActionSheet({ itemList: labels.map(function (x) { return '强制改为' + x }), success: function (r) { if (who === identity() && detailVersion === page._detailVersion && chatVersion === page._chatVisibilityVersion && statuses[r.tapIndex]) operate(page, id, statuses[r.tapIndex]) } })
  },
  forceComplete: function (event) { operate(this, event.currentTarget.dataset.id || this.data.id, 'completed') },
  voidAppointment: function (event) { operate(this, event.currentTarget.dataset.id || this.data.id, null) },
  restoreAppointment: function (event) { operate(this, event.currentTarget.dataset.id || this.data.id, 'restore') }
}
