var api = require('./api-request')

function identity(ignoreExpiry) {
  var app = getApp()
  var user = (app && app.globalData) || {}
  if (user.role !== 'admin' || user.isSimulator || !user.openid || user.openid === 'simulator_openid_dev' || !user.notificationSession || (!ignoreExpiry && sessionExpired(user))) return ''
  return user.openid + ':' + user.notificationSession
}

function sessionExpired(user) {
  var expiry = timestamp(user.notificationSessionExpiresAt)
  return !!user.notificationSessionExpiresAt && isFinite(expiry) && expiry <= Date.now()
}

function timestamp(value) {
  return typeof value === 'number' ? value : Date.parse(value || '')
}

function ready(config) {
  return !!(config && config.enabled && config.available && config.platformVerified && config.templateId &&
    (config.subscriptionType === 'once' || config.subscriptionType === 'longterm'))
}

module.exports = {
  data: {
    notificationLoading: false,
    notificationBusy: false,
    notificationReady: false,
    notificationActive: false,
    notificationCanSubscribe: false,
    notificationCanRetry: false,
    notificationNeedsSettings: false,
    notificationNeedsLogin: false,
    notificationStatus: '等待检查',
    notificationDescription: '有人预约后，可在微信服务通知中查看提醒。',
    notificationType: '',
    notificationClaims: 0,
    notificationLastDelivery: ''
  },
  methods: {
    requireNotificationLogin: function (error) {
      if (!error || ['REAL_LOGIN_REQUIRED', 'ADMIN_REQUIRED', 'SESSION_EXPIRED'].indexOf(error.code) === -1) return false
      var app = getApp()
      if (app && app.globalData) {
        // 只清除提醒会话；既有预约等业务登录不在这里擅自变更。
        app.globalData.notificationSession = ''
        app.globalData.notificationSessionExpiresAt = ''
      }
      this._notificationIdentity = ''
      this._notificationChallenge = null
      this._notificationPending = null
      this._notificationChoice = ''
      this.setData({
        notificationNeedsLogin: true, notificationReady: false, notificationLoading: false,
        notificationBusy: false, notificationCanSubscribe: false, notificationCanRetry: false,
        notificationActive: false, notificationNeedsSettings: false, notificationClaims: 0, notificationLastDelivery: '',
        notificationStatus: '请重新登录', notificationDescription: '请使用手机微信重新登录，以继续设置预约提醒。'
      })
      return true
    },

    reloginNotifications: function () {
      var self = this
      if (this.data.notificationBusy) return Promise.resolve()
      var app = getApp()
      if (!app || !app.globalData) return Promise.resolve()
      var originalOpenid = app.globalData.openid
      var originalSession = app.globalData.notificationSession
      this.setData({ notificationBusy: true })
      // 单独的登录按钮准备后续订阅；这里绝不调用原生订阅弹窗。
      return api.silentLogin({ requireReal: true }).then(function (user) {
        if (app.globalData.openid !== originalOpenid || app.globalData.notificationSession !== originalSession) return
        if (!user || user._simulator || !user.openid || user.openid === 'simulator_openid_dev') {
          throw new Error('请使用手机微信重新登录；提醒服务准备完成后再试。')
        }
        app.globalData.openid = user.openid
        app.globalData.isAdmin = !!user.isAdmin
        app.globalData.role = user.role || 'user'
        app.globalData.department = user.department || ''
        app.globalData.notificationSession = app.globalData.role === 'admin' ? (user.notificationSession || '') : ''
        app.globalData.notificationSessionExpiresAt = app.globalData.notificationSession ? (user.notificationSessionExpiresAt || '') : ''
        app.globalData.isSimulator = false
        app.globalData.loginReady = Promise.resolve(user)
        self._notificationPending = null
        self._notificationChallenge = null
        self._notificationChoice = ''
        self.setData({ role: app.globalData.role, myDepartment: app.globalData.department, notificationNeedsLogin: false, notificationBusy: false, notificationReady: false, notificationActive: false, notificationCanSubscribe: false, notificationCanRetry: false, notificationNeedsSettings: false, notificationClaims: 0, notificationLastDelivery: '' })
        if (app.globalData.role !== 'admin') {
          // 重新登录后权限可能改变，先清除旧管理员页面的数据。
          self.setData({ allItems: [], items: [], members: [], inviteCodes: [], applications: [], draftReplies: {}, stats: { total: 0, active: 0, completed: 0 }, pendingApplications: 0, activeTab: 'appointments', assignDialogVisible: false, assignAppointmentId: '', assignableMembers: [], editingMember: null })
          wx.showToast({ title: '当前微信没有管理员权限', icon: 'none' })
          return
        }
        // 真实登录可能返回权限降级结果而不发放提醒会话，先更新权限再检查会话。
        if (!app.globalData.notificationSession) {
          self.requireNotificationLogin({ code: 'REAL_LOGIN_REQUIRED' })
          return
        }
        self.loadItems()
        return self.loadNotificationStatus()
      }).catch(function () {
        if (app.globalData.openid !== originalOpenid || app.globalData.notificationSession !== originalSession) return
        self.setData({ notificationNeedsLogin: true, notificationStatus: '登录未完成', notificationDescription: '请在手机微信中重新登录；若暂时失败，可稍后再试。' })
      }).then(function () { self.setData({ notificationBusy: false }) })
    },

    loadNotificationStatus: function () {
      var self = this
      if (this.data.role !== 'admin') return Promise.resolve()
      var currentIdentity = identity()
      var loginSnapshot = identity(true)
      var loadId = (this._notificationLoadId || 0) + 1
      this._notificationLoadId = loadId
      var isCurrent = function () { return self._notificationLoadId === loadId && loginSnapshot === identity(true) }
      if (this._notificationIdentity !== currentIdentity) {
        this._notificationPending = null
        this._notificationChallenge = null
        this._notificationChoice = ''
        this.setData({ notificationBusy: false, notificationActive: false, notificationNeedsSettings: false, notificationLastDelivery: '', notificationClaims: 0 })
      }
      this._notificationIdentity = currentIdentity
      this.setData({ notificationLoading: true, notificationCanSubscribe: false, notificationCanRetry: !!this._notificationPending, notificationNeedsLogin: false })
      return api.getNotificationConfig().then(function (config) {
        if (!isCurrent()) return
        self._notificationConfig = config
        self.setData({ notificationReady: ready(config), notificationType: config.subscriptionType || '' })
        if (!ready(config)) {
          self.setData({ notificationStatus: '提醒暂未开放', notificationDescription: '配置完成后，可在这里开启微信预约提醒。', notificationActive: false, notificationNeedsSettings: false, notificationLastDelivery: '', notificationClaims: 0 })
          return
        }
        if (!currentIdentity) {
          self.requireNotificationLogin({ code: 'REAL_LOGIN_REQUIRED' })
          return
        }
        return api.getNotificationStatus().then(function (status) {
          if (!isCurrent()) return
          // 后台重新配置或停用后，不使用之前缓存的模板继续授权。
          self._notificationConfig = status
          if (!ready(status) || !status.eligible) {
            self.setData({ notificationReady: false, notificationActive: false, notificationStatus: '暂不能订阅', notificationDescription: status.eligible ? '请稍后重试，或联系管理员确认提醒配置。' : '当前账号尚未开通此提醒，请使用指定的管理员微信登录。', notificationLastDelivery: '', notificationClaims: 0 })
            return
          }
          var active = !!(status.enrollment && status.enrollment.active)
          var remaining = Number(status.oneTimeClaimsRemaining) || 0
          var choice = self._notificationChoice
          var description = active ? '授权已登记。有新预约时由服务器发送微信服务通知。' : '点击下方按钮，在微信弹窗中选择允许。'
          if (status.subscriptionType === 'once' && active && remaining === 0) description = '已登记的提醒次数已用完，请再次授权以接收下一条提醒。'
          if (choice === 'reject') description = '本次未允许提醒。如需接收，可主动再次点击授权。'
          if (choice === 'ban') description = '你已关闭此类提醒。如需恢复，请打开订阅设置。'
          var lastDelivery = status.lastDelivery || {}
          var deliveryText = { sent: '最近一条：微信接口已接受发送', failed: '最近一条：发送失败，请检查提醒配置', uncertain: '最近一条：发送结果待确认', sending: '最近一条：正在发送', pending: '最近一条：等待发送', retry: '最近一条：等待重试', cancelled: '最近一条：已取消发送' }[lastDelivery.status] || ''
          self.setData({
            notificationReady: true, notificationActive: active, notificationClaims: remaining,
            notificationType: status.subscriptionType,
            notificationNeedsSettings: choice === 'ban',
            notificationStatus: self._notificationPending ? '授权待登记' : (choice === 'ban' ? '已关闭' : (choice === 'reject' ? '本次未允许' : (active ? (status.subscriptionType === 'once' && remaining === 0 ? '需要再次授权' : '授权已登记') : '尚未授权'))),
            notificationDescription: self._notificationPending ? '微信授权结果尚未保存，请重试登记；暂不能保证收到提醒。' : description,
            notificationLastDelivery: deliveryText
          })
          if (!self._notificationPending) return self.prepareNotificationChallenge(loadId)
        })
      }).catch(function (error) {
        if (isCurrent() && !self.requireNotificationLogin(error)) self.setData({ notificationStatus: '检查失败', notificationDescription: '暂时无法检查提醒状态，请点击刷新重试。', notificationCanSubscribe: false })
      }).then(function () { if (isCurrent()) self.setData({ notificationLoading: false }) })
    },

    prepareNotificationChallenge: function (loadId) {
      var self = this
      if (!ready(this._notificationConfig) || this._notificationConfig.eligible !== true || !identity()) return Promise.resolve()
      if (this._notificationChallenge && timestamp(this._notificationChallenge.expiresAt) > Date.now() + 5000) {
        this.setData({ notificationCanSubscribe: true })
        return Promise.resolve()
      }
      var userIdentity = identity()
      return api.createNotificationChallenge().then(function (challenge) {
        if (userIdentity !== identity(true) || (loadId && self._notificationLoadId !== loadId) || self._notificationPending) return
        if (!identity()) { self.requireNotificationLogin({ code: 'SESSION_EXPIRED' }); return }
        self._notificationChallenge = challenge
        self.setData({ notificationCanSubscribe: !!(challenge.challengeId && timestamp(challenge.expiresAt) > Date.now()) })
      }).catch(function (error) {
        if (userIdentity !== identity(true) || (loadId && self._notificationLoadId !== loadId)) return
        if (self.requireNotificationLogin(error)) return
        self.setData({ notificationCanSubscribe: false })
        if (!self.data.notificationActive) self.setData({ notificationStatus: '请稍后刷新', notificationDescription: '暂时无法准备授权，请稍后点击刷新状态。' })
      })
    },

    subscribeNotifications: function () {
      var self = this
      if (this.data.notificationBusy || this._notificationPending) return
      if (!identity() || this._notificationIdentity !== identity() || !ready(this._notificationConfig) || this._notificationConfig.eligible !== true) {
        var app = getApp()
        if (app && app.globalData && (sessionExpired(app.globalData) || this.data.notificationNeedsLogin)) {
          this.requireNotificationLogin({ code: 'REAL_LOGIN_REQUIRED' })
          return
        }
        wx.showToast({ title: '请先刷新提醒状态', icon: 'none' })
        return
      }
      var challenge = this._notificationChallenge
      if (!challenge || timestamp(challenge.expiresAt) <= Date.now() + 5000) {
        this.setData({ notificationCanSubscribe: false })
        wx.showToast({ title: '授权准备已过期，请刷新', icon: 'none' })
        this.prepareNotificationChallenge()
        return
      }
      if (typeof wx.requestSubscribeMessage !== 'function') {
        wx.showToast({ title: '请更新微信后重试', icon: 'none' })
        return
      }
      var templateId = this._notificationConfig.templateId
      var userIdentity = identity()
      this.setData({ notificationBusy: true })
      // 必须直接在用户点击回调中调用，前面不能等待网络请求。
      try {
        wx.requestSubscribeMessage({
          tmplIds: [templateId],
          success: function (result) {
            if (userIdentity !== identity()) {
              self.setData({ notificationBusy: false })
              if (userIdentity === identity(true)) self.requireNotificationLogin({ code: 'SESSION_EXPIRED' })
              return
            }
            var choice = result[templateId]
            if (['accept', 'reject', 'ban'].indexOf(choice) === -1) {
              self.setData({ notificationBusy: false, notificationStatus: '未取得授权结果', notificationDescription: '微信未返回有效授权结果，请刷新后重试。' })
              return
            }
            self._notificationChoice = choice
            self._notificationPending = { challengeId: challenge.challengeId, templateId: templateId, result: choice }
            self._notificationChallenge = null
            self.savePendingNotificationSubscription()
          },
          fail: function () {
            self.setData({ notificationBusy: false, notificationStatus: '授权未完成', notificationDescription: '微信授权未完成。如已关闭提醒，可在订阅设置中检查。', notificationNeedsSettings: true })
          }
        })
      } catch (e) {
        this.setData({ notificationBusy: false, notificationStatus: '授权未完成', notificationDescription: '暂时无法打开微信授权，请稍后重试。' })
      }
    },

    savePendingNotificationSubscription: function () {
      var self = this
      var app = getApp()
      if (app && app.globalData && sessionExpired(app.globalData)) {
        this.requireNotificationLogin({ code: 'SESSION_EXPIRED' })
        return Promise.resolve()
      }
      if (!this._notificationPending || !identity() || this._notificationIdentity !== identity()) return Promise.resolve()
      var pending = this._notificationPending
      var userIdentity = identity()
      this.setData({ notificationBusy: true, notificationCanSubscribe: false })
      return api.saveNotificationSubscription(pending).then(function () {
        if (userIdentity !== identity(true) || self._notificationPending !== pending) return
        self._notificationPending = null
        self.setData({ notificationBusy: false, notificationCanRetry: false })
        return self.loadNotificationStatus()
      }).catch(function (error) {
        if (userIdentity !== identity(true) || self._notificationPending !== pending) return
        if (self.requireNotificationLogin(error)) return
        self.setData({ notificationBusy: false, notificationCanRetry: true, notificationStatus: '授权待登记', notificationDescription: '授权结果未能保存，请重试登记；暂不能保证收到提醒。' })
        // 过期的挑战无法补登记，必须明确让用户重新点击，不能自动再次弹窗。
        if (error.code === 'CHALLENGE_EXPIRED' || error.code === 'INVALID_CHALLENGE') {
          self._notificationPending = null
          self.setData({ notificationCanRetry: false, notificationDescription: '登记已过期，请刷新后主动重新授权。' })
        }
      })
    },

    openNotificationSettings: function () {
      var self = this
      if (!identity() || typeof wx.openSetting !== 'function') return
      wx.openSetting({
        withSubscriptions: true,
        success: function () { self._notificationChoice = ''; self.loadNotificationStatus() },
        fail: function () { wx.showToast({ title: '未能打开设置，请重试', icon: 'none' }) }
      })
    },

    stopNotifications: function () {
      var self = this
      var app = getApp()
      if (app && app.globalData && sessionExpired(app.globalData)) { this.requireNotificationLogin({ code: 'SESSION_EXPIRED' }); return }
      if (!identity() || this.data.notificationBusy) return
      var userIdentity = identity()
      wx.showModal({
        title: '暂停预约提醒', content: '暂停后，服务器将不再向你的微信发送新预约提醒。', confirmText: '暂停提醒',
        success: function (result) {
          if (!result.confirm || userIdentity !== identity()) return
          self.setData({ notificationBusy: true })
          api.stopNotificationSubscription().then(function () {
            if (userIdentity !== identity(true)) return
            self._notificationChoice = ''
            self._notificationPending = null
            self.setData({ notificationBusy: false, notificationCanRetry: false })
            return self.loadNotificationStatus()
          }).catch(function (error) {
            if (userIdentity !== identity(true)) return
            if (self.requireNotificationLogin(error)) return
            self.setData({ notificationBusy: false })
            wx.showToast({ title: '暂停失败，请重试', icon: 'none' })
          })
        }
      })
    }
  }
}
