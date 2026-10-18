var portal = require('../../utils/portal-api')
var page = require('../../utils/portal-page')
Page(page({
  data: { loading: true, error: '', profile: null, stats: null, isMember: false, canManage: false },
  clearPrivate: function () { this.setData({ profile: null, stats: null, isMember: false, canManage: false }) },
  load: function () {
    var self = this, current = this.guard(); this.setData({ loading: true, error: '' })
    return portal.call('/api/portal/me').then(function (result) {
      if (!current()) return
      var p = result.profile
      self.setData({ profile: Object.assign({}, p, { avatarUrl: '', roleText: { admin:'管理员',leader:'部门负责人',member:'社团成员',user:'校园服务' }[p.role] || '校园服务' }), stats: result.stats,
        isMember: ['admin','leader','member'].indexOf(p.role) !== -1, canManage: ['admin','leader'].indexOf(p.role) !== -1 })
      return portal.avatar(p.avatar).then(function (url) { if (current()) self.setData({ 'profile.avatarUrl': url }) })
    }).catch(function (error) { if (current()) self.setData({ error: error.message || '个人中心暂时无法加载' }) }).then(function () { if (current()) self.setData({ loading: false }) })
  },
  avatarError: function () {
    if (!this.data.profile || !this.data.profile.avatarUrl) return
    portal.forgetAvatar(this.data.profile.avatar)
    this.setData({ 'profile.avatarUrl': '', error: '头像加载失败，请点击重新加载' })
  },
  open: function (event) {
    var destinations = { records:'/pages/records/records',messages:'/pages/messages/messages',profile:'/pages/profile/profile',favorites:'/pages/favorites/favorites',subscriptions:'/pages/records/records?subscribe=1',admin:'/pages/admin/admin',articles:'/pages/guide-manage/guide-manage',privacy:'/pages/privacy/privacy',help:'/pages/help/help',apply:'/pages/apply/apply' }
    var key = event.currentTarget.dataset.key
    if (key === 'guides') { wx.switchTab({url:'/pages/guides/guides'}); return }
    if (destinations[key]) wx.navigateTo({url:destinations[key]})
  },
  onShareAppMessage: function () { return {title:'电脑出问题？来校园电脑维修预约',path:'/pages/index/index'} }
}))
