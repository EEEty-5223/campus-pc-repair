const assert = require('assert'), fs = require('fs'), vm = require('vm'), path = require('path')
const members = require('../utils/members')
const root = path.resolve(__dirname, '..')
const clone = value => JSON.parse(JSON.stringify(value))
const tick = async () => { for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve)) }
const evt = (field, value) => ({ currentTarget: { dataset: { field } }, detail: { value } })
const initialProfile = { openid: 'self', name: '自己', nickname: '测试昵称', contact: '示例联系资料', contactVisible: true, department: '技术部', displayTag: '硬件维修', role: 'member', tag: 'permanent', isSelf: true, canEdit: true, canReview: false, editMode: 'request' }
// Fixture represents backend's verified mixed pinyin/English ordering; client must preserve it.
const directory = [
  { openid: 'admin-a', name: 'Alice', role: 'admin', department: '运营部', status: 1 },
  { openid: 'admin-b', name: '白同学', role: 'admin', department: '宣传部', status: 1 },
  { openid: 'admin-z', name: 'Zoe', role: 'admin', department: '技术部', status: 1 },
  { openid: 'leader-a', name: '负责人甲', role: 'leader', department: '技术部', status: 1 },
  { openid: 'member-a', name: 'Amy', role: 'member', department: '宣传部', status: 1 },
  { openid: 'member-b', name: '白成员', role: 'member', department: '维修小组', status: 1 },
  { openid: 'unassigned', name: '未分配成员', role: 'member', department: '', status: 1 },
  { ...initialProfile, status: 1 }
]

function fixture(options = {}) {
  const user = { openid: 'self', role: options.userRole || 'member', notificationSession: 'test-session', department: '技术部' }
  let profile = Object.assign(clone(initialProfile), options.profileOverride), pending = null, definition
  const calls = { navigation: [], submissions: [], directSaves: [], reviews: [], modals: [], toasts: [], logins: 0, deferred: [] }
  const session = { key: () => user.openid + ':' + user.notificationSession, authError: e => ['REAL_LOGIN_REQUIRED', 'MEMBER_REQUIRED'].includes(e.code), renew: () => { calls.logins++; user.notificationSession = 'renewed'; return Promise.resolve(user) } }
  const api = {
    getMyAppointments: () => Promise.resolve({ list: [] }),
    getMemberDirectory: () => options.badList ? Promise.resolve({ list: {} }) : Promise.resolve({ list: clone(directory), selfOpenid: 'self' }),
    getMemberDetail: target => {
      const data = { profile: target === 'self' ? clone(profile) : { ...clone(initialProfile), openid: target, isSelf: false, canEdit: !!options.otherCanEdit, editMode: options.otherCanEdit ? 'direct' : null, canReview: !!options.canReview, contact: '其他成员联系资料', contactVisible: true, ...options.otherProfile }, pendingRequest: clone(pending), canReview: !!options.canReview }
      if (options.detailCanReview === false) data.canReview = false
      if (options.deferLoad) return new Promise(resolve => calls.deferred.push({ resolve: () => resolve(data) }))
      return Promise.resolve(data)
    },
    getMyProfileRequests: () => Promise.resolve({ currentProfile: clone(profile), pendingRequest: clone(pending), requests: pending ? [clone(pending)] : [] }),
    updateMemberProfile: (target, body) => {
      calls.directSaves.push({ target, body: clone(body) })
      if (options.directError) return Promise.reject(Object.assign(new Error('direct failed'), { code: options.directErrorCode || 'SAVE_FAILED' }))
      const patch = { ...body }; delete patch.requestKey
      if (target === 'self') { profile = Object.assign(profile, patch); return Promise.resolve({ profile: clone(profile) }) }
      options.otherProfile = Object.assign({ ...initialProfile, openid: target, isSelf: false, canEdit: true, editMode: 'direct', contact: '其他成员联系资料' }, options.otherProfile, patch)
      return Promise.resolve({ profile: clone(options.otherProfile) })
    },
    submitProfileRequest: body => {
      calls.submissions.push(clone(body))
      if (options.submitError) return Promise.reject(Object.assign(new Error('failed'), { code: options.authError ? 'REAL_LOGIN_REQUIRED' : 'SAVE_FAILED' }))
      const proposed = { ...body }; delete proposed.requestKey
      pending = { id: 1, proposed, base: members.draft(profile), status: 'pending', requesterOpenid: 'self', requesterName: profile.name, createdAt: '离线示例时间' }
      return Promise.resolve({ request: clone(pending) })
    },
    getProfileReviews: () => Promise.resolve({ canReview: !!options.canReview, list: options.reviewList || [] }),
    reviewProfileRequest: (id, decision, reason) => { calls.reviews.push({ id, decision, reason }); return options.reviewError ? Promise.reject(Object.assign(new Error('conflict'), { code: 'REQUEST_NOT_PENDING' })) : Promise.resolve({ request: { id, status: 'approved' } }) }
  }
  const wx = { navigateTo: opts => calls.navigation.push(opts.url), showToast: opts => calls.toasts.push(opts), showModal: opts => { calls.modals.push(opts); opts.success(options.modalResult || { confirm: true, content: '请完善部门信息' }) } }
  function page(relativePath) {
    vm.runInNewContext(fs.readFileSync(path.join(root, relativePath), 'utf8'), {
      Page: value => { definition = value }, getApp: () => ({ globalData: user }), wx, Promise, console,
      setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, clearTimeout() {},
      require: name => name.includes('portal-api') ? { identity: () => 'fixture', call: () => Promise.resolve({ list: [] }), article: x => x, articles: rows => Promise.resolve(rows) } : name.includes('assignment-ui') ? { withPage: page => page } : name.includes('chat-unread') ? { overview: () => Promise.resolve({ total: 0, counts: {}, items: [] }), markRead() {} } : name.includes('admin-notifications') ? { data: {}, methods: {} } : name.includes('member-removal-ui') ? { canRemove: () => false, methods: { loadRemovalRequests: () => Promise.resolve() } } : name.includes('member-session') ? session : name.includes('members') ? members : name.includes('api-request') ? api : {}
    })
    const instance = Object.assign({}, definition, { data: clone(definition.data) })
    instance.setData = patch => Object.assign(instance.data, clone(patch))
    return instance
  }
  return { page, user, calls, options, setProfile: next => { profile = next } }
}

async function main() {
  const f = fixture(), admin = f.page('pages/admin/admin.js')
  admin.setData({ role: 'member' })
  await admin.loadMembers()
  assert.strictEqual(admin.data.members[0].openid, 'self')
  assert.deepStrictEqual(Array.from(admin.data.members.slice(1), m => m.openid), directory.slice(0, -1).map(m => m.openid), 'client must retain authoritative mixed pinyin/English and role order')
  assert.deepStrictEqual(Array.from(admin.data.memberDepartmentFilters.slice(0, 4), t => t.label), ['总成员表', '技术部', '运营部', '宣传部'])
  assert(admin.data.memberDepartmentFilters.some(t => t.label === '维修小组'))
  assert(admin.data.memberDepartmentFilters.some(t => t.label === '未分配'))
  admin.selectMemberDepartment({ currentTarget: { dataset: { department: 'department:技术部' } } })
  assert.strictEqual(admin.data.directoryMembers[0].openid, 'self')
  assert.strictEqual(admin.data.memberStats.total, 8)
  admin.goMemberDetail({ currentTarget: { dataset: { openid: 'self' } } })
  assert.strictEqual(f.calls.navigation[0], '/pages/member-detail/member-detail?openid=self')
  admin.goMemberDetail({ currentTarget: { dataset: { openid: 'not-visible' } } })
  assert.strictEqual(f.calls.navigation.length, 1)
  assert.strictEqual(admin.saveMember, undefined, 'inline direct editing must be removed')
  assert.strictEqual(admin.saveOwnProfile, undefined)
  f.options.badList = true; await admin.loadMembers()
  assert.strictEqual(admin.data.membersError, true)
  assert.strictEqual(admin.data.memberStats.total, 8)

  const detail = f.page('pages/member-detail/member-detail.js')
  detail.onLoad({ openid: 'self' }); await detail.loadDetail()
  detail.beginEdit(); detail.onDraftInput(evt('department', '专项维修组'))
  detail.onDraftInput(evt('role', 'admin')); detail.data.draft.status = 0
  await detail.submitChanges()
  assert.strictEqual(detail.data.profile.department, '技术部', 'submitted proposal cannot change effective profile')
  assert.strictEqual(f.user.department, '技术部')
  assert.strictEqual(detail.data.pendingRequest.proposed.department, '专项维修组')
  assert.strictEqual(detail.data.profile.role, 'member')
  assert.deepStrictEqual(Object.keys(f.calls.submissions[0]).sort(), ['department', 'requestKey'])
  assert(/^[a-f0-9]{64}$/.test(f.calls.submissions[0].requestKey))
  detail.beginEdit(); assert.strictEqual(detail.data.editing, false, 'one pending request blocks new changes')

  const other = f.page('pages/member-detail/member-detail.js')
  other.onLoad({ openid: 'admin-a' }); await other.loadDetail()
  other.beginEdit(); assert.strictEqual(other.data.editing, false)
  assert.strictEqual(other.data.profileFields.find(x => x.key === 'contact').value, '其他成员联系资料')

  const failure = fixture({ submitError: true }), failing = failure.page('pages/member-detail/member-detail.js')
  failing.onLoad({ openid: 'self' }); await failing.loadDetail(); failing.beginEdit(); failing.onDraftInput(evt('nickname', '失败后保留草稿'))
  await failing.submitChanges(); assert.strictEqual(failing.data.editing, true); assert.strictEqual(failing.data.draft.nickname, '失败后保留草稿')
  await failing.submitChanges()
  assert.deepStrictEqual(failure.calls.submissions[0], failure.calls.submissions[1], 'failed submit must retry with same key and proposal')
  failure.options.authError = true
  await failing.submitChanges(); assert.strictEqual(failing.data.needsLogin, true)
  failure.options.submitError = false
  await failing.relogin(); assert.strictEqual(failing.data.draft.nickname, '失败后保留草稿'); assert.strictEqual(failing.data.editing, true)
  await failing.submitChanges(); assert.strictEqual(failing.data.pendingRequest.status, 'pending')

  const delayed = fixture(), delayedPage = delayed.page('pages/member-detail/member-detail.js')
  delayedPage.onLoad({ openid: 'self' }); await delayedPage.loadDetail()
  delayedPage.beginEdit(); delayedPage.onDraftInput(evt('displayTag', '待审展示标签'))
  delayed.options.deferLoad = true
  const oldGet = delayedPage.loadDetail()
  delayed.options.deferLoad = false
  await delayedPage.submitChanges()
  delayed.calls.deferred[0].resolve(); await oldGet
  assert.strictEqual(delayedPage.data.pendingRequest.proposed.displayTag, '待审展示标签', 'old GET cannot erase newer pending result')

  const race = fixture({ deferLoad: true }), racePage = race.page('pages/member-detail/member-detail.js')
  racePage.onLoad({ openid: 'self' })
  const first = racePage.loadDetail(), second = racePage.loadDetail()
  race.calls.deferred[0].resolve(); await first
  assert.strictEqual(racePage.data.loading, true)
  race.calls.deferred[1].resolve(); await second
  assert.strictEqual(racePage.data.loading, false)
  const hidden = fixture({ deferLoad: true }), hiddenPage = hidden.page('pages/member-detail/member-detail.js')
  hiddenPage.onLoad({ openid: 'self' })
  const hiddenLoad = hiddenPage.loadDetail()
  hiddenPage.onUnload()
  hidden.calls.deferred[0].resolve(); await hiddenLoad
  assert.strictEqual(hiddenPage.data.profile, null, 'unloaded detail response must not render a profile or start related requests')
  racePage.beginEdit(); racePage.onDraftInput(evt('nickname', '旧账号草稿'))
  race.user.openid = 'new-member'; race.user.notificationSession = 'new-session'; race.options.deferLoad = false
  await racePage.loadDetail()
  assert.notStrictEqual(racePage.data.draft.nickname, '旧账号草稿')

  const request = { id: 8, status: 'pending', requesterOpenid: 'other-member', requesterName: '申请成员', base: { department: '技术部' }, proposed: { department: '运营部' } }
  const reviewer = fixture({ canReview: true, reviewList: [request] }), reviewPage = reviewer.page('pages/member-detail/member-detail.js')
  reviewPage.onLoad({ review: '1' }); reviewPage.onShow(); await tick()
  reviewPage.reviewRequest({ currentTarget: { dataset: { id: 8, decision: 'reject' } } }); await tick()
  assert.deepStrictEqual(reviewer.calls.reviews[0], { id: 8, decision: 'reject', reason: '请完善部门信息' })
  reviewer.options.modalResult = { confirm: true, content: '' }
  reviewPage.reviewRequest({ currentTarget: { dataset: { id: 8, decision: 'reject' } } }); await tick()
  assert.strictEqual(reviewer.calls.reviews.length, 1)
  reviewer.options.reviewList = [{ ...request, requesterOpenid: 'self' }]; await reviewPage.loadReviews()
  reviewPage.reviewRequest({ currentTarget: { dataset: { id: 8, decision: 'approve' } } }); await tick()
  assert.strictEqual(reviewer.calls.reviews.length, 1, 'self-review must never be submitted')
  reviewer.options.canReview = false; await reviewPage.loadReviews()
  assert.strictEqual(reviewPage.data.canReview, false)

  const scoped = fixture({ canReview: true, reviewList: [request, { ...request, id: 9, requesterOpenid: 'different-member' }] })
  const scopedPage = scoped.page('pages/member-detail/member-detail.js')
  scopedPage.onLoad({ openid: 'other-member' }); await scopedPage.loadDetail()
  assert.strictEqual(scopedPage.data.reviews.length, 1)
  assert.strictEqual(scopedPage.data.reviews[0].requesterOpenid, 'other-member', 'personal detail must show only the selected person\'s requests')
  scoped.options.detailCanReview = false
  await scopedPage.loadDetail()
  assert.strictEqual(scopedPage.data.canReview, false, 'explicit backend false cannot fall back to broader profile capability')
  scopedPage.reviewRequest({ currentTarget: { dataset: { id: 8, decision: 'approve' } } })
  assert.strictEqual(scoped.calls.reviews.length, 0)

  const ownerDirect = fixture({ userRole: 'admin', profileOverride: { role: 'admin', editMode: 'direct' } })
  const ownerPage = ownerDirect.page('pages/member-detail/member-detail.js')
  ownerPage.onLoad({ openid: 'self' }); await ownerPage.loadDetail(); ownerPage.beginEdit(); ownerPage.onDraftInput(evt('nickname', '管理员自己直接保存'))
  await ownerPage.submitChanges()
  assert.strictEqual(ownerDirect.calls.submissions.length, 0)
  assert.strictEqual(ownerDirect.calls.directSaves[0].target, 'self')
  assert.strictEqual(ownerPage.data.profile.nickname, '管理员自己直接保存')
  assert.strictEqual(ownerPage.data.profile.role, 'admin')

  const actingAdmin = fixture({ userRole: 'admin', otherCanEdit: true, otherProfile: { role: 'leader' } })
  const actingPage = actingAdmin.page('pages/member-detail/member-detail.js')
  actingPage.onLoad({ openid: 'target-leader' }); await actingPage.loadDetail(); actingPage.beginEdit(); actingPage.onDraftInput(evt('department', '运营部'))
  await actingPage.submitChanges()
  assert.strictEqual(actingAdmin.calls.directSaves[0].target, 'target-leader')
  assert.strictEqual(actingAdmin.calls.directSaves[0].body.department, '运营部')
  assert.strictEqual(actingAdmin.calls.submissions.length, 0)
  assert.strictEqual(actingPage.data.departmentReadonly, false)
  actingAdmin.options.otherCanEdit = false; actingAdmin.options.otherProfile = { role: 'admin', canEdit: false, editMode: null }
  await actingPage.loadDetail(); actingPage.beginEdit()
  assert.strictEqual(actingPage.data.editing, false, 'another admin stays protected by server capability')

  const leaderOwn = fixture({ userRole: 'leader', profileOverride: { role: 'leader', editMode: 'direct' } })
  const leaderPage = leaderOwn.page('pages/member-detail/member-detail.js')
  leaderPage.onLoad({ openid: 'self' }); await leaderPage.loadDetail(); leaderPage.beginEdit(); leaderPage.onDraftInput(evt('nickname', '负责人自己的昵称'))
  await leaderPage.submitChanges()
  assert.strictEqual(leaderOwn.calls.directSaves.length, 1)
  leaderPage.beginEdit(); leaderPage.onDraftInput(evt('department', '运营部'))
  assert.strictEqual(leaderPage.data.saveMode, 'request')
  await leaderPage.submitChanges()
  assert.strictEqual(leaderOwn.calls.submissions.length, 1)
  assert.strictEqual(leaderPage.data.profile.department, '技术部', 'leader own department change stays pending')
  const leaderOther = fixture({ userRole: 'leader', otherCanEdit: true, otherProfile: { role: 'leader' } })
  const peerPage = leaderOther.page('pages/member-detail/member-detail.js')
  peerPage.onLoad({ openid: 'peer-leader' }); await peerPage.loadDetail(); peerPage.beginEdit(); peerPage.onDraftInput(evt('department', '运营部')); peerPage.onDraftInput(evt('name', '本部门负责人新姓名'))
  assert.strictEqual(peerPage.data.draft.department, '技术部')
  await peerPage.submitChanges()
  assert.strictEqual(leaderOther.calls.directSaves[0].body.name, '本部门负责人新姓名')
  assert.strictEqual(leaderOther.calls.directSaves[0].body.department, undefined)

  const directRetry = fixture({ userRole: 'admin', profileOverride: { role: 'admin', editMode: 'direct' }, directError: true })
  const directRetryPage = directRetry.page('pages/member-detail/member-detail.js')
  directRetryPage.onLoad({ openid: 'self' }); await directRetryPage.loadDetail(); directRetryPage.beginEdit(); directRetryPage.onDraftInput(evt('displayTag', '直接保存失败仍保留'))
  await directRetryPage.submitChanges(); await directRetryPage.submitChanges()
  assert.deepStrictEqual(directRetry.calls.directSaves[0], directRetry.calls.directSaves[1], 'direct retry must preserve signed target, proposal and requestKey')
  assert.strictEqual(directRetryPage.data.editing, true)
  directRetry.options.directError = false; await directRetryPage.submitChanges()
  assert.strictEqual(directRetryPage.data.profile.displayTag, '直接保存失败仍保留')

  // The legacy home membership flag includes every active club role. A detail
  // refresh must not turn leaders/members into applicants on the next home visit.
  for (const role of ['member', 'leader', 'admin']) {
    const returning = fixture({ userRole: role, profileOverride: { role, editMode: role === 'member' ? 'request' : 'direct' } })
    const personal = returning.page('pages/member-detail/member-detail.js')
    personal.onLoad({ openid: 'self' }); await personal.loadDetail()
    const home = returning.page('pages/index/index.js')
    home.onShow(); await tick()
    assert.strictEqual(home.data.isAdmin, true, role + ' retains the club-backend entry after personal detail')
    home.goAdmin()
    assert.strictEqual(returning.calls.navigation[0], '/pages/admin/admin')
  }

  const apiModule = { exports: {} }, requests = [], user = { openid: 'self', notificationSession: 'signed-test-session' }
  vm.runInNewContext(fs.readFileSync(path.join(root, 'utils/api-request.js'), 'utf8'), { module: apiModule, getApp: () => ({ globalData: user }), Promise, console, wx: { request: opts => { requests.push(opts); opts.success({ statusCode: 200, data: { ok: true } }) } } })
  await apiModule.exports.getMemberDirectory()
  assert.strictEqual(requests[0].header.Authorization, 'Bearer signed-test-session')
  await apiModule.exports.updateMemberProfile('target', { name: '新姓名', requestKey: 'a'.repeat(64), role: 'admin', status: 0, tag: 'wrong' })
  assert.deepStrictEqual(clone(requests[1].data), { name: '新姓名', requestKey: 'a'.repeat(64) })
  assert.strictEqual(requests[1].method, 'PATCH')
  await apiModule.exports.request('/api/admin/appointments', 'GET')
  assert.strictEqual(requests[2].header.Authorization, 'Bearer signed-test-session')
  user.notificationSession = ''; user.role = 'user'
  await apiModule.exports.createAppointment({ name: '学生预约示例' })
  assert(!requests[3].header.Authorization)
  await assert.rejects(apiModule.exports.submitProfileRequest({ nickname: 'x' }), e => e.code === 'REAL_LOGIN_REQUIRED')
  assert.strictEqual(apiModule.exports.updateMember, undefined)
  assert.strictEqual(apiModule.exports.updateOwnAdminProfile, undefined)
  console.log('member-directory.test.js: all offline tests passed')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
