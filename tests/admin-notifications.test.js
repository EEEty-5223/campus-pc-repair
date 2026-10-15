// Offline tests: real network, WeChat dialogs and production data are never used.
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')
const root = path.resolve(__dirname, '..')
const source = fs.readFileSync(path.join(root, 'utils/admin-notifications.js'), 'utf8')
const pageSource = fs.readFileSync(path.join(root, 'pages/admin/admin.js'), 'utf8')
const config = { ok: true, enabled: true, available: true, platformVerified: true, templateId: 'verified-template', subscriptionType: 'once' }
const copy = value => JSON.parse(JSON.stringify(value))
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)) }

function fixture(options = {}) {
  const calls = { prompts: [], posts: [], challenges: 0, statuses: 0, settings: 0, stops: 0, logins: 0, modals: [], toasts: [] }
  const user = Object.assign({ role: 'admin', openid: 'real-user', notificationSession: 'opaque-test-session' }, options.user)
  const app = { globalData: user }
  let accepted = false
  let definition
  const api = {
    silentLogin: request => {
      calls.logins++
      assert.strictEqual(request.requireReal, true)
      return options.loginError ? Promise.reject(new Error('login')) : Promise.resolve(Object.assign({ openid: 'real-user', role: 'admin', isAdmin: true, notificationSession: 'new-test-session', notificationSessionExpiresAt: new Date(Date.now() + 604800000).toISOString() }, options.loginData))
    },
    getNotificationConfig: () => options.configError ? Promise.reject(new Error('network')) : Promise.resolve(Object.assign({}, config, options.config)),
    getNotificationStatus: () => {
      calls.statuses++
      if (options.statusError) return Promise.reject(Object.assign(new Error('status'), { code: options.statusErrorCode }))
      return Promise.resolve(Object.assign({}, config, {
        eligible: true, enrollment: { active: accepted }, oneTimeClaimsRemaining: accepted ? 1 : 0, claimsVerified: false
      }, options.status))
    },
    createNotificationChallenge: () => {
      calls.challenges++
      if (options.challengeError) return Promise.reject(Object.assign(new Error('challenge'), { code: options.challengeErrorCode }))
      return Promise.resolve({ challengeId: 'opaque-challenge', expiresAt: new Date(Date.now() + 300000).toISOString() })
    },
    saveNotificationSubscription: data => {
      calls.posts.push(copy(data))
      if (options.saveError) return Promise.reject(Object.assign(new Error('save'), { code: options.saveErrorCode }))
      accepted = data.result === 'accept'
      return Promise.resolve({ ok: true })
    },
    stopNotificationSubscription: () => {
      calls.stops++
      if (options.stopError) return Promise.reject(new Error('stop'))
      accepted = false
      return Promise.resolve({ ok: true })
    },
    getAdminAppointments: () => options.itemsError ? Promise.reject(new Error('load')) : Promise.resolve({ list: [] })
  }
  const wx = {
    showToast: data => calls.toasts.push(data),
    requestSubscribeMessage: data => {
      calls.prompts.push(data)
      if (options.nativeThrow) throw new Error('native exception')
      if (options.nativeFail) return data.fail({ errMsg: 'requestSubscribeMessage:fail' })
      if (!options.deferNative) data.success({ [config.templateId]: options.choice || 'accept' })
    },
    openSetting: data => { calls.settings++; assert.strictEqual(data.withSubscriptions, true); data.success({}) },
    showModal: data => { calls.modals.push(data); data.success({ confirm: !options.cancelStop }) }
  }
  const module = { exports: {} }
  vm.runInNewContext(source, { module, require: () => api, wx, getApp: () => app, Promise, Date })
  vm.runInNewContext(pageSource, {
    Page: value => { definition = value },
    require: name => name.includes('assignment-ui') ? { withPage: page => page } : name.includes('chat-unread') ? { markRead() {} } : name.includes('admin-notifications') ? module.exports : name.includes('api-request') ? api : {
      decorate: x => x, list: () => { throw new Error('Must not show stale demo data after API error') }
    },
    getApp: () => app, wx, console: { error() {} }, Promise, setTimeout: () => 1, clearTimeout() {}
  })
  const page = Object.assign({}, definition, { data: copy(definition.data), setData: data => Object.assign(page.data, copy(data)) })
  return { page, calls, options, user }
}

async function main() {
  const f = fixture()
  f.user.role = 'user'
  f.user.loginReady = Promise.resolve().then(() => { f.user.role = 'admin' })
  f.page.onShow()
  await flush()
  assert.strictEqual(f.page.data.role, 'admin', 'role must refresh after login completes')
  assert.strictEqual(f.calls.prompts.length, 0, 'show/load must never request subscription')
  assert.strictEqual(f.calls.challenges, 1)
  assert.strictEqual(f.page.data.notificationCanSubscribe, true)
  f.page.subscribeNotifications()
  assert.strictEqual(f.calls.prompts.length, 1, 'native API must run synchronously within tap')
  assert.deepStrictEqual(Array.from(f.calls.prompts[0].tmplIds), ['verified-template'])
  await flush()
  assert.strictEqual(f.calls.posts[0].result, 'accept')
  assert.strictEqual(f.page.data.notificationStatus, '授权已登记')
  assert.strictEqual(f.page.data.notificationClaims, 1)

  for (const role of ['user', 'member', 'leader']) {
    const f = fixture({ user: { role } })
    f.page.onShow(); await flush(); f.page.subscribeNotifications()
    assert.strictEqual(f.calls.prompts.length, 0, role + ' must not subscribe as admin')
    assert.strictEqual(f.calls.statuses, 0)
  }
  for (const user of [{ notificationSession: '' }, { openid: '' }, { isSimulator: true }, { openid: 'simulator_openid_dev' }]) {
    const f = fixture({ user })
    f.page.onShow(); await flush(); f.page.subscribeNotifications()
    assert.strictEqual(f.calls.prompts.length, 0)
    assert.strictEqual(f.calls.statuses, 0)
    assert.strictEqual(f.page.data.notificationStatus, '请重新登录')
  }
  for (const configPatch of [{ available: false }, { enabled: false }, { platformVerified: false }, { templateId: '' }, { subscriptionType: null }]) {
    const f = fixture({ config: configPatch })
    f.page.onShow(); await flush(); f.page.subscribeNotifications()
    assert.strictEqual(f.calls.prompts.length, 0)
    assert.strictEqual(f.calls.challenges, 0)
    assert.strictEqual(f.page.data.notificationStatus, '提醒暂未开放')
  }
  for (const choice of ['reject', 'ban']) {
    const f = fixture({ choice })
    f.page.onShow(); await flush(); f.page.subscribeNotifications(); await flush()
    assert.strictEqual(f.calls.posts[0].result, choice)
    assert.strictEqual(f.page.data.notificationActive, false, 'native success must not equal consent')
    assert.strictEqual(f.page.data.notificationNeedsSettings, choice === 'ban')
    assert.strictEqual(f.calls.settings, 0, 'settings cannot open automatically')
    if (choice === 'ban') { f.page.openNotificationSettings(); await flush(); assert.strictEqual(f.calls.settings, 1) }
  }
  const notOwner = fixture({ status: { eligible: false } })
  notOwner.page.onShow(); await flush(); notOwner.page.subscribeNotifications()
  assert.strictEqual(notOwner.calls.challenges, 0)
  assert.strictEqual(notOwner.calls.prompts.length, 0)
  assert.strictEqual(notOwner.page.data.notificationReady, false)

  const longterm = fixture({ config: { subscriptionType: 'longterm' }, status: { subscriptionType: 'longterm' } })
  longterm.page.onShow(); await flush(); longterm.page.subscribeNotifications(); await flush()
  assert.strictEqual(longterm.page.data.notificationType, 'longterm')
  assert.strictEqual(longterm.calls.prompts.length, 1)

  const exhausted = fixture({ status: { enrollment: { active: true }, oneTimeClaimsRemaining: 0, lastDelivery: { status: 'uncertain' } } })
  exhausted.page.onShow(); await flush()
  assert.strictEqual(exhausted.page.data.notificationStatus, '需要再次授权')
  assert.strictEqual(exhausted.page.data.notificationLastDelivery, '最近一条：发送结果待确认')
  for (const options of [{ nativeFail: true }, { nativeThrow: true }, { choice: 'filter' }]) {
    const f = fixture(options)
    f.page.onShow(); await flush(); f.page.subscribeNotifications(); await flush()
    assert.strictEqual(f.calls.posts.length, 0)
    assert.strictEqual(f.page.data.notificationBusy, false)
    assert.strictEqual(f.page.data.notificationActive, false)
  }
  for (const options of [{ configError: true }, { statusError: true }, { challengeError: true }]) {
    const f = fixture(options)
    f.page.onShow(); await flush()
    assert.strictEqual(f.page.data.notificationCanSubscribe, false)
    assert.strictEqual(f.page.data.notificationLoading, false)
    assert.strictEqual(f.calls.prompts.length, 0)
  }
  const retry = fixture({ saveError: true })
  retry.page.onShow(); await flush(); retry.page.subscribeNotifications(); await flush()
  assert.strictEqual(retry.page.data.notificationCanRetry, true)
  assert.strictEqual(retry.page.data.notificationStatus, '授权待登记')
  retry.page.subscribeNotifications(); assert.strictEqual(retry.calls.prompts.length, 1)
  retry.options.saveError = false
  await retry.page.savePendingNotificationSubscription(); await flush()
  assert.deepStrictEqual(retry.calls.posts[0], retry.calls.posts[1], 'retry must reuse challenge id, not grant twice')
  assert.strictEqual(retry.calls.prompts.length, 1)
  assert.strictEqual(retry.page.data.notificationActive, true)
  retry.options.challengeError = true
  retry.page._notificationChallenge = null
  await retry.page.loadNotificationStatus(); await flush()
  assert.strictEqual(retry.page.data.notificationStatus, '授权已登记', 'prefetch failure must not erase already saved consent')

  const retryExpired = fixture({ saveError: true, saveErrorCode: 'INVALID_CHALLENGE' })
  retryExpired.page.onShow(); await flush(); retryExpired.page.subscribeNotifications(); await flush()
  assert.strictEqual(retryExpired.page.data.notificationCanRetry, false)
  assert.strictEqual(retryExpired.calls.prompts.length, 1, 'expired save never automatically prompts again')

  const expired = fixture()
  expired.page.onShow(); await flush()
  expired.page._notificationChallenge.expiresAt = new Date(Date.now() - 1).toISOString()
  expired.page.subscribeNotifications(); await flush()
  assert.strictEqual(expired.calls.prompts.length, 0, 'expired challenge requires new deliberate tap after preparation')
  assert.strictEqual(expired.calls.challenges, 2)

  const changed = fixture({ deferNative: true })
  changed.page.onShow(); await flush(); changed.page.subscribeNotifications()
  changed.user.openid = 'another-user'
  changed.calls.prompts[0].success({ [config.templateId]: 'accept' }); await flush()
  assert.strictEqual(changed.calls.posts.length, 0, 'cannot register for a different login identity')

  const paused = fixture()
  paused.page.onShow(); await flush(); paused.page.subscribeNotifications(); await flush()
  paused.page.stopNotifications(); await flush()
  assert.strictEqual(paused.calls.stops, 1)
  assert.strictEqual(paused.page.data.notificationActive, false)
  const cancelled = fixture({ cancelStop: true })
  cancelled.page.onShow(); await flush(); cancelled.page.stopNotifications(); await flush()
  assert.strictEqual(cancelled.calls.stops, 0)

  const loadFailure = fixture({ itemsError: true })
  loadFailure.page.onShow(); await flush()
  assert.strictEqual(loadFailure.page.data.itemsError, true)
  assert.strictEqual(loadFailure.page.data.itemsLoading, false)

  // Expiry must offer a real re-login, not an endless refresh with the old session.
  for (const code of ['REAL_LOGIN_REQUIRED', 'ADMIN_REQUIRED', 'SESSION_EXPIRED']) {
    const f = fixture({ statusError: true, statusErrorCode: code })
    f.page.onShow(); await flush()
    assert.strictEqual(f.user.notificationSession, '')
    assert.strictEqual(f.page.data.notificationNeedsLogin, true)
    assert.strictEqual(f.page.data.notificationStatus, '请重新登录')
    assert.strictEqual(f.page.data.notificationLoading, false)
    assert.strictEqual(f.calls.prompts.length, 0)
    f.options.statusError = false
    await f.page.reloginNotifications(); await flush()
    assert.strictEqual(f.calls.logins, 1)
    assert.strictEqual(f.user.notificationSession, 'new-test-session')
    assert.strictEqual(f.page.data.notificationNeedsLogin, false)
    assert.strictEqual(f.page.data.notificationCanSubscribe, true)
    assert.strictEqual(f.calls.prompts.length, 0, 'login cannot also prompt for subscription')
    f.page.subscribeNotifications(); await flush()
    assert.strictEqual(f.calls.prompts.length, 1, 'subscription needs a separate user tap after login')
  }
  const oldSession = fixture({ user: { notificationSessionExpiresAt: new Date(Date.now() - 1000).toISOString() } })
  oldSession.page.onShow(); await flush()
  assert.strictEqual(oldSession.calls.statuses, 0)
  assert.strictEqual(oldSession.page.data.notificationNeedsLogin, true)
  assert.strictEqual(oldSession.user.notificationSession, '')

  const laterExpiry = fixture()
  laterExpiry.page.onShow(); await flush()
  laterExpiry.user.notificationSessionExpiresAt = new Date(Date.now() - 1000).toISOString()
  laterExpiry.page.subscribeNotifications(); await flush()
  assert.strictEqual(laterExpiry.calls.prompts.length, 0)
  assert.strictEqual(laterExpiry.page.data.notificationNeedsLogin, true)

  for (const options of [{ loginError: true }, { loginData: { _simulator: true } }]) {
    const f = fixture(options)
    await f.page.reloginNotifications(); await flush()
    assert.strictEqual(f.page.data.notificationNeedsLogin, true)
    assert.strictEqual(f.calls.prompts.length, 0)
    assert.strictEqual(f.user.notificationSession, 'opaque-test-session')
  }
  const missingLoginSession = fixture({ loginData: { notificationSession: '' } })
  await missingLoginSession.page.reloginNotifications(); await flush()
  assert.strictEqual(missingLoginSession.user.notificationSession, '')
  assert.strictEqual(missingLoginSession.page.data.notificationNeedsLogin, true)
  assert.strictEqual(missingLoginSession.calls.prompts.length, 0)

  const revoked = fixture({ loginData: { role: 'member', isAdmin: false, notificationSession: undefined, notificationSessionExpiresAt: undefined } })
  revoked.page.data.allItems = [{ id: 'old-admin-record' }]
  revoked.page.data.items = [{ id: 'old-admin-record' }]
  revoked.page.data.members = [{ openid: 'old-member' }]
  revoked.page.data.inviteCodes = [{ code: 'old-code' }]
  revoked.page.data.assignDialogVisible = true
  await revoked.page.reloginNotifications(); await flush()
  assert.strictEqual(revoked.user.role, 'member')
  assert.strictEqual(revoked.page.data.role, 'member')
  assert.strictEqual(revoked.page.data.items.length, 0)
  assert.strictEqual(revoked.page.data.members.length, 0)
  assert.strictEqual(revoked.page.data.inviteCodes.length, 0)
  assert.strictEqual(revoked.page.data.assignDialogVisible, false)
  assert.strictEqual(revoked.user.notificationSession, '')
  assert.strictEqual(revoked.page.data.notificationNeedsLogin, false, 'permission downgrade is a valid login, not a missing-token login failure')
  assert.strictEqual(revoked.calls.statuses, 0)
  assert.strictEqual(revoked.calls.prompts.length, 0)

  const challengeSession = fixture({ challengeError: true, challengeErrorCode: 'REAL_LOGIN_REQUIRED' })
  challengeSession.page.onShow(); await flush()
  assert.strictEqual(challengeSession.page.data.notificationNeedsLogin, true)
  assert.strictEqual(challengeSession.user.notificationSession, '')
  const saveSession = fixture({ saveError: true, saveErrorCode: 'REAL_LOGIN_REQUIRED' })
  saveSession.page.onShow(); await flush(); saveSession.page.subscribeNotifications(); await flush()
  assert.strictEqual(saveSession.page.data.notificationNeedsLogin, true)
  assert.strictEqual(saveSession.page._notificationPending, null)

  // Transport: notification routes cannot fall back to the legacy openid header.
  let requests = []
  let response = { statusCode: 200, data: { ok: true } }
  const transportModule = { exports: {} }
  const transportUser = { openid: 'real-user', notificationSession: 'session-for-tests' }
  vm.runInNewContext(fs.readFileSync(path.join(root, 'utils/api-request.js'), 'utf8'), {
    module: transportModule, getApp: () => ({ globalData: transportUser }),
    wx: { request: opts => { requests.push(opts); opts.success(response) } }, Promise, console
  })
  const transport = transportModule.exports
  await transport.getNotificationConfig()
  assert.strictEqual(requests[0].header.Authorization, undefined)
  await transport.getNotificationStatus()
  assert.strictEqual(requests[1].header.Authorization, 'Bearer session-for-tests')
  assert.strictEqual(requests[1].header.openid, undefined)
  response = { statusCode: 401, data: { ok: false, error: 'session expired', code: 'SESSION_EXPIRED' } }
  await assert.rejects(transport.getNotificationStatus(), error => error.code === 'SESSION_EXPIRED')
  transportUser.openid = 'simulator_openid_dev'
  const count = requests.length
  await assert.rejects(transport.createNotificationChallenge(), /真机/)
  assert.strictEqual(requests.length, count)

  let nativeLogins = 0
  const realLoginModule = { exports: {} }
  vm.runInNewContext(fs.readFileSync(path.join(root, 'utils/api-request.js'), 'utf8'), {
    module: realLoginModule, getApp: () => ({ globalData: {} }),
    wx: { getSystemInfoSync: () => ({ platform: 'devtools' }), login: opts => { nativeLogins++; opts.success({ code: '' }) } }, Promise, console
  })
  await assert.rejects(realLoginModule.exports.silentLogin({ requireReal: true }), /微信登录未返回凭证/)
  assert.strictEqual(nativeLogins, 1, 'devtools real re-login invokes wx.login and never uses a fake identity')

  // App keeps opaque session in memory and never logs login payload.
  let appDefinition, loginLog
  vm.runInNewContext(fs.readFileSync(path.join(root, 'app.js'), 'utf8'), {
    App: data => { appDefinition = data },
    require: name => name.includes('api-request') ? { silentLogin: () => Promise.resolve({ openid: 'real-user', role: 'admin', notificationSession: 'private-test-session' }) } : {},
    console: { log: (...args) => { loginLog = args }, error() {} }, Promise
  })
  appDefinition.onLaunch(); await appDefinition.globalData.loginReady
  assert.strictEqual(appDefinition.globalData.notificationSession, 'private-test-session')
  assert(!JSON.stringify(loginLog).includes('private-test-session'))
  assert(!JSON.stringify(loginLog).includes('real-user'))
  console.log('admin-notifications.test.js: all offline tests passed')
}

main().catch(error => { console.error(error); process.exitCode = 1 })
