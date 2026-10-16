const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const swipe = require('../utils/swipe-navigation')
const root = path.resolve(__dirname, '..')
function touch(x, y, scope = 'page', stamp = 1, id = 7) {
  return { timeStamp: stamp, touches: [{ clientX: x, clientY: y, identifier: id }], changedTouches: [{ clientX: x, clientY: y, identifier: id }], currentTarget: { dataset: { swipeScope: scope } } }
}
function page(name, role = 'admin') {
  let definition
  const switches = []
  const navigation = Object.assign({}, swipe, { switchMainTab: (p, url) => switches.push(url) })
  const fakeModule = { withPage: p => p, data: {}, methods: {} }
  vm.runInNewContext(fs.readFileSync(path.join(root, 'pages', name, name + '.js'), 'utf8'), {
    Page: p => { definition = p }, console, Promise, setTimeout, clearTimeout, wx: { showToast() {} },
    require: n => n.includes('swipe-navigation') ? navigation : fakeModule
  })
  const p = Object.assign({}, definition, { data: JSON.parse(JSON.stringify(definition.data)), setData(values, callback) { Object.assign(this.data, values); if (callback) callback() } })
  p.data.role = role
  return { p, switches }
}
function gesture(p, direction, scope = 'page') {
  const x = direction === 'left' ? 200 : 50, end = direction === 'left' ? 50 : 200
  p.onNavigationTouchStart(touch(x, 100, scope))
  // Simulate bubbling to the page's handler with the same timestamp.
  p.onNavigationTouchStart(touch(x, 100))
  p.onNavigationTouchMove(touch(end, 102))
  p.onNavigationTouchEnd(touch(end, 102))
}
test('home left and records header right switch the native bottom tab; outer edges stay put', () => {
  const home = page('index'), records = page('records')
  gesture(home.p, 'right'); assert.equal(home.switches.length, 0)
  gesture(home.p, 'left'); assert.deepEqual(home.switches, ['/pages/records/records'])
  gesture(records.p, 'left'); assert.equal(records.switches.length, 0)
  gesture(records.p, 'right'); assert.deepEqual(records.switches, ['/pages/index/index'])
})
test('records list changes only its category, preserves source data and stops at both edges', () => {
  const { p, switches } = page('records')
  p.data.allItems = [{ id: 'a', status: 'pending' }, { id: 'b', status: 'completed' }]
  gesture(p, 'right', 'records'); assert.equal(p.data.currentFilter, 'all')
  gesture(p, 'left', 'records'); assert.equal(p.data.currentFilter, 'active'); assert.equal(p.data.items[0].id, 'a')
  gesture(p, 'left', 'records'); assert.equal(p.data.currentFilter, 'closed'); assert.equal(p.data.items[0].id, 'b')
  gesture(p, 'left', 'records'); assert.equal(p.data.currentFilter, 'closed')
  assert.equal(switches.length, 0); assert.equal(p.data.allItems.length, 2)
})
test('admin list swipes change statuses, omit hidden voided category and never change main section', () => {
  const { p } = page('admin')
  p.applyFilter = function () {}
  p.data.currentFilter = 'completed'
  gesture(p, 'left', 'statuses'); assert.equal(p.data.currentFilter, 'cancelled')
  assert.equal(p.data.activeTab, 'appointments')
  gesture(p, 'left', 'statuses'); assert.equal(p.data.currentFilter, 'cancelled')
  p.data.isRealAdmin = true; p.data.currentFilter = 'completed'
  gesture(p, 'left', 'statuses'); assert.equal(p.data.currentFilter, 'voided')
  gesture(p, 'left', 'statuses'); assert.equal(p.data.currentFilter, 'cancelled')
})
test('main sections follow current role and reuse normal data loading; denied sections stay denied', () => {
  for (const [role, expected] of [['admin', ['invite', 'apply', 'members']], ['leader', ['invite', 'members']], ['member', ['members']]]) {
    const { p } = page('admin', role), loaded = []
    p.stopChatPolling = () => {}; p.loadInviteCodes = () => loaded.push('invite'); p.loadApplications = () => loaded.push('apply'); p.loadMembers = () => loaded.push('members')
    for (const tab of expected) { gesture(p, 'left'); assert.equal(p.data.activeTab, tab) }
    gesture(p, 'left'); assert.equal(p.data.activeTab, 'members'); assert.deepEqual(loaded, expected)
    if (role !== 'admin') { p.switchTab({ currentTarget: { dataset: { tab: 'apply' } } }); assert.equal(p.data.activeTab, 'members') }
  }
})
test('dialogs and status submissions block navigation', () => {
  for (const key of ['assignDialogVisible', 'statusBusy', 'adminActionBusy']) {
    const { p } = page('admin'); p.data[key] = true
    gesture(p, 'left'); assert.equal(p.data.activeTab, 'appointments')
  }
})
test('controls and native scrolling retain their own gesture; child scope survives bubbling', () => {
  const { p, switches } = page('index')
  gesture(p, 'left', 'ignore'); assert.equal(switches.length, 0)
  assert.equal(p._navigationSwipe, null)
})
test('vertical scroll, diagonal movement, short movement, multitouch and cancellation do not navigate', () => {
  const { p, switches } = page('index')
  for (const [x, y] of [[150, 101], [110, 180]]) {
    p.onNavigationTouchStart(touch(200, 100)); p.onNavigationTouchEnd(touch(x, y))
  }
  p.onNavigationTouchStart(touch(200, 100)); p.onNavigationTouchMove(touch(198, 125)); p.onNavigationTouchEnd(touch(80, 130))
  p.onNavigationTouchStart(touch(200, 100)); p.onNavigationTouchMove({ touches: [touch(20, 100).touches[0], touch(30, 100).touches[0]] }); p.onNavigationTouchEnd(touch(80, 100))
  p.onNavigationTouchStart(touch(200, 100)); p.onNavigationTouchCancel(); p.onNavigationTouchEnd(touch(80, 100))
  p.onNavigationTouchStart(touch(200, 100)); p._navigationSwipe.began -= 1100; p.onNavigationTouchEnd(touch(80, 100))
  assert.equal(switches.length, 0)
})
test('page hide discards incomplete gesture', () => {
  const { p, switches } = page('records')
  p.onNavigationTouchStart(touch(50, 100)); p.onHide(); p.onNavigationTouchEnd(touch(200, 100))
  assert.equal(switches.length, 0)
})
test('repeated swipe while switching tabs issues only one native navigation request', () => {
  let options, calls = 0
  const context = { module: { exports: {} }, wx: { switchTab: o => { options = o; calls++ } } }
  vm.runInNewContext(fs.readFileSync(path.join(root, 'utils/swipe-navigation.js'), 'utf8'), context)
  const p = {}, module = context.module.exports
  module.switchMainTab(p, '/pages/records/records'); module.switchMainTab(p, '/pages/records/records'); assert.equal(calls, 1)
  options.complete(); module.switchMainTab(p, '/pages/records/records'); assert.equal(calls, 2)
})

test('compact card primary action follows assignment and lifecycle', () => {
  const { p } = page('admin'), calls=[];p._chatVisible=true;
  p.showAssign=e=>calls.push(['assign',e.currentTarget.dataset.id]);p.changeStatus=e=>calls.push(['status',e.currentTarget.dataset.status]);
  p.data.allItems=[{id:'p',status:'pending',assignedActiveCount:0}];const event={currentTarget:{dataset:{id:'p'}}};
  p.runCardPrimary(event);assert.deepEqual(calls.pop(),['assign','p']);
  p.data.allItems[0].assignedActiveCount=1;p.runCardPrimary(event);assert.deepEqual(calls.pop(),['status','accepted']);
  p.data.allItems[0].status='accepted';p.runCardPrimary(event);assert.deepEqual(calls.pop(),['status','repairing']);
  p.data.allItems[0].status='repairing';p.runCardPrimary(event);assert.deepEqual(calls.pop(),['status','completed']);
  p.data.allItems[0].status='completed';p.runCardPrimary(event);assert.equal(calls.length,0);
  p.data.allItems[0].status='accepted';p.data.allItems[0].canProcess=false;p.runCardPrimary(event);assert.equal(calls.length,0);
})
test('more menu is role-aware and rejects stale selection; quick reply opens only on request', () => {
  const { p }=page('admin','member'),calls=[];p._chatVisible=true;p._chatVisibilityVersion=1;p.chatViewerIdentity=()=>p.data.role;
  p.data.allItems=[{id:'p',status:'accepted',assignedActiveCount:1,canChat:true,canReply:true}];const event={currentTarget:{dataset:{id:'p'}}};
  p.openCardMenu(event);assert(!p.data.cardMenuActions.some(a=>a.handler==='forceStatus'||a.handler==='showAssign'));
  p.data.role='admin';p.data.isRealAdmin=true;p.openCardMenu(event);assert(p.data.cardMenuActions.some(a=>a.handler==='forceStatus'));
  const index=p.data.cardMenuActions.findIndex(a=>a.handler==='changeStatus');p.changeStatus=()=>calls.push(1);p.data.allItems[0].status='repairing';
  p.selectCardAction({currentTarget:{dataset:{index}}});assert.equal(calls.length,0);assert.equal(p.data.cardMenuVisible,false);
  assert.equal(p.data.expandedReplies.p,undefined);p.toggleQuickReply(event);assert.equal(p.data.expandedReplies.p,true);p.toggleQuickReply(event);assert.equal(p.data.expandedReplies.p,false);
})

test('member list swipes move between department tables in both directions, stop at edges and never switch main section', () => {
  for (const role of ['admin','leader','member']) {
    const {p}=page('admin',role);p.data.activeTab='members';p.data.memberDepartmentFilter='all';
    p.data.memberDepartmentFilters=['all','department:技术部','department:运营部','department:宣传部'].map(value=>({value}));
    p.data.members=[{openid:'a',department:'技术部'},{openid:'b',department:'运营部'}];
    p.switchTab=()=>assert.fail('department gesture must not reach main navigation');
    gesture(p,'right','members');assert.equal(p.data.memberDepartmentFilter,'all');
    gesture(p,'left','members');assert.equal(p.data.memberDepartmentFilter,'department:技术部');assert.equal(p.data.directoryMembers[0].openid,'a');assert.equal(p.data.memberDepartmentAnchor,'member-filter-1');
    gesture(p,'left','members');assert.equal(p.data.memberDepartmentFilter,'department:运营部');
    gesture(p,'right','members');assert.equal(p.data.memberDepartmentFilter,'department:技术部');
    gesture(p,'left','members');gesture(p,'left','members');gesture(p,'left','members');assert.equal(p.data.memberDepartmentFilter,'department:宣传部');assert.equal(p.data.activeTab,'members');
    gesture(p,'left','ignore');assert.equal(p.data.memberDepartmentFilter,'department:宣传部');
  }
})
test('gesture from a panel that is no longer active does not fall through to main navigation', () => {
  const {p}=page('admin');p.data.activeTab='appointments';p.switchTab=()=>assert.fail('stale inner gesture must be ignored');
  gesture(p,'left','members');assert.equal(p.data.activeTab,'appointments');
  p.data.activeTab='members';gesture(p,'right','statuses');assert.equal(p.data.activeTab,'members');
})
