var api = require('./api-request')
var active = null, epoch = 0, loadingOwner = null
function hideLoading(owner) { if (loadingOwner === owner) { loadingOwner = null; wx.hideLoading && wx.hideLoading() } }
function identity(app) { var u = app.globalData || {}; return [u.openid, u.notificationSession, u.role].join(':') }
function member(app) { var u = app.globalData || {}; return u.openid && u.notificationSession && !u.isSimulator && ['admin', 'leader', 'member'].indexOf(u.role) !== -1 }
function modal(options) { return new Promise(function (resolve) { wx.showModal(Object.assign({}, options, { success: resolve, fail: function () { resolve({ confirm: false }) } })) }) }
function requestKey() { var s = Date.now().toString(16); while (s.length < 64) s += Math.floor(Math.random() * 0x100000000).toString(16).padStart(8, '0'); return s.slice(0, 64) }
function ensure(app) {
  if (!member(app)) return Promise.resolve()
  var who = identity(app), version = epoch
  if (active && active.identity === who && active.epoch === version) return active.promise
  var owner = { identity: who, epoch: version }
  var current = function () { return version === epoch && who === identity(app) && member(app) }
  function update(phone) { app.globalData.phone = phone; app.globalData.needsPhone = !phone }
  function input(draft) {
    if (!current()) return Promise.resolve()
    return modal({ title: '补充社团联系手机号', content: draft || '', editable: true, placeholderText: '请输入本人11位手机号', confirmText: '下一步', cancelText: '稍后填写' }).then(function (r) {
      if (!current() || !r.confirm) return
      var phone = String(r.content || '').trim()
      if (!/^1[3-9]\d{9}$/.test(phone)) return modal({ title: '手机号格式不正确', content: '请填写11位大陆手机号。', showCancel: false, confirmText: '重新填写' }).then(function () { return input(phone) })
      return confirm(phone)
    })
  }
  function confirm(phone) {
    if (!current()) return Promise.resolve()
    return modal({ title: '请再次核对手机号', content: '你填写的手机号是：\n' + phone + '\n\n用于社团联系。请确认号码属于本人且没有输错。', confirmText: '确认保存', cancelText: '返回修改' }).then(function (r) {
      if (!current()) return
      if (!r.confirm) return input(phone)
      return save(phone, requestKey())
    })
  }
  function save(phone, key) {
    if (!current()) return Promise.resolve()
    loadingOwner = owner
    wx.showLoading && wx.showLoading({ title: '正在保存', mask: true })
    return api.saveMyMemberPhone(phone, key).then(function (r) {
      if (!current()) return
      if (!r || r.phone !== phone || r.needsPhone !== false) throw new Error('invalid saved phone')
      update(phone)
      wx.showToast({ title: '手机号已保存', icon: 'success' })
    }).catch(function (error) {
      if (!current()) return
      hideLoading(owner)
      if (error.code === 'PHONE_ALREADY_SET') return syncExisting()
      return modal({ title: '手机号尚未保存', content: '请检查网络后重试。未保存成功前，下次进入仍会提醒补填。', confirmText: '重试保存', cancelText: '稍后填写' }).then(function (r) { if (current() && r.confirm) return save(phone, key) })
    }).then(function () { hideLoading(owner) })
  }
  function syncExisting() {
    if (!current()) return Promise.resolve()
    return api.getMyMemberPhone().then(function (r) {
      if (!current()) return
      if (!r || !/^1[3-9]\d{9}$/.test(r.phone || '') || r.needsPhone !== false) throw new Error('invalid saved phone status')
      update(r.phone)
      wx.showToast({ title: '已同步保存的手机号', icon: 'none' })
    }).catch(function () {
      if (!current()) return
      return modal({ title: '手机号状态尚未同步', content: '后端提示已有手机号，但暂时无法读取保存结果。可重试同步，不会覆盖原号码。', confirmText: '重试同步', cancelText: '稍后同步' }).then(function (r) { if (current() && r.confirm) return syncExisting() })
    })
  }
  owner.promise = api.getMyMemberPhone().then(function (r) {
    if (!current()) return
    if (!r || typeof r.phone !== 'string' || typeof r.needsPhone !== 'boolean') throw new Error('invalid phone status')
    if (!r.needsPhone && /^1[3-9]\d{9}$/.test(r.phone)) { update(r.phone); return }
    if (!r.needsPhone || r.phone) throw new Error('inconsistent phone status')
    update('')
    return input('')
  }).catch(function () { /* Do not block normal use on auth/schema/network failure; check again on the next entry. */ }).then(function () { if (active === owner) active = null })
  active = owner
  return owner.promise
}
module.exports = { ensure: ensure, cancel: function () { epoch++; if (loadingOwner) hideLoading(loadingOwner) } }
