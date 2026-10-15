const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('node:assert/strict'), { test } = require('node:test');
const source = fs.readFileSync(path.join(__dirname, '../utils/assignment-ui.js'), 'utf8');
const tick = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); };
const event = (key, value) => ({ currentTarget: { dataset: { [key]: value } } });
const member = (openid, department = '技术部', role = 'member', status = 1) => ({ openid, name: openid, department, role, status });
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function fixture(role = 'admin', list) {
  const app = { globalData: { openid: 'viewer', notificationSession: 'real-session', role, department: '技术部' } };
  const calls = { modals: [], toasts: [], saves: [], refresh: 0, lifecycle: [] };
  const api = { getMemberDirectory: () => Promise.resolve({ list: list || [member('a'), member('b', '运营部', 'leader'), member('c', '宣传部'), member('d', '其他部'), member('none', ''), member('admin', '技术部', 'admin'), member('disabled', '技术部', 'member', 0)] }), assignAppointment: (...args) => { calls.saves.push(args); return Promise.resolve({ ok: true }); } };
  const module = { exports: {} };
  vm.runInNewContext(source, { module, require: () => api, getApp: () => app, Promise, console, wx: { showModal: modal => calls.modals.push(modal), showToast: toast => calls.toasts.push(toast) } });
  const definition = module.exports.withPage({ data: { allItems: [{ id: 12, status: 'pending' }], items: [] }, onShow() { calls.lifecycle.push('show'); }, onHide() { calls.lifecycle.push('hide'); }, onUnload() { calls.lifecycle.push('unload'); }, loadItems() { calls.refresh++; return Promise.resolve(); } });
  const page = Object.assign({}, definition, { data: JSON.parse(JSON.stringify(definition.data)), setData(patch) { Object.assign(this.data, patch); } });
  page.onShow();
  return { app, api, calls, page, helper: module.exports, open: () => page.showAssign(event('id', 12)) };
}
test('department tabs count eligible personnel and preserve custom / unassigned departments; no implicit primary', async () => {
  const f = fixture(); await f.open();
  assert.deepEqual(Array.from(f.page.data.assignDepartmentTabs, t => [t.label, t.count]), [['全部人员', 6], ['技术部', 2], ['运营部', 1], ['宣传部', 1], ['其他部', 1], ['未分配', 1]]);
  assert.equal(f.page.data.assignPrimaryOpenid, '');
  f.page.confirmAssign(); assert.equal(f.calls.modals.length, 0); assert.match(f.page.data.assignError, /主负责人/);
  f.page.selectAssignmentDepartment(event('department', 'department:运营部'));
  assert.deepEqual(Array.from(f.page.data.assignVisibleMembers, m => m.openid), ['b']);
  assert.match(f.page.data.assignVisibleMembers[0].roleText, /leader/);
});
test('admin chooses cross-department team; primary and two assistants stay distinct and are sent explicitly', async () => {
  const f = fixture(); await f.open();
  f.page.selectAssignmentPrimary(event('openid', 'a'));
  f.page.toggleAssignmentAssistant(event('openid', 'b')); f.page.toggleAssignmentAssistant(event('openid', 'c')); f.page.toggleAssignmentAssistant(event('openid', 'd'));
  assert.deepEqual(Array.from(f.page.data.assignAssistantOpenids), ['b', 'c']);
  f.page.selectAssignmentPrimary(event('openid', 'b'));
  assert.deepEqual(Array.from(f.page.data.assignAssistantOpenids), ['c']);
  f.page.toggleAssignmentAssistant(event('openid', 'b')); assert.equal(f.page.data.assignAssistantOpenids.length, 1);
  f.page.toggleAssignmentAssistant(event('openid', 'a'));
  f.page.confirmAssign(); f.page.confirmAssign(); assert.equal(f.calls.modals.length, 1);
  assert.match(f.calls.modals[0].content, /主负责人：b（运营部）/); assert.match(f.calls.modals[0].content, /随行人员：c、a/);
  f.calls.modals[0].success({ confirm: true }); await tick();
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls.saves)), [['12', '运营部', 'b', ['c', 'a']]]);
  assert.equal(f.calls.refresh, 1); assert.equal(f.page.data.assignDialogVisible, false);
});
test('leader only sees own department ordinary members; inactive / admin / other leader are rejected', async () => {
  const list = [member('a'), member('b'), member('leader', '技术部', 'leader'), member('other', '运营部'), member('admin', '技术部', 'admin'), Object.assign(member('inactive', '技术部', 'member', 0), { isActive: true })];
  const f = fixture('leader', list); await f.open();
  assert.deepEqual(Array.from(f.page.data.assignAllMembers, m => m.openid), ['a', 'b']);
  f.page.selectAssignmentPrimary(event('openid', 'leader')); assert.equal(f.page.data.assignPrimaryOpenid, '');
  f.page.toggleAssignmentAssistant(event('openid', 'other')); assert.equal(f.page.data.assignAssistantOpenids.length, 0);
});
test('existing assignment prefills; unavailable original assignee is shown and cannot silently disappear on save', async () => {
  const f = fixture(); Object.assign(f.page.data.allItems[0], { assignedOpenid: 'a', assistantOpenids: ['b', 'gone'], assignedNames: ['甲', '乙', '离队成员'] });
  await f.open(); assert.equal(f.page.data.assignPrimaryPreview.openid, 'a'); assert.equal(f.page.data.assignAssistantPreviews[1].name, '离队成员'); assert.equal(f.page.data.assignAssistantPreviews[1].unavailable, true);
  f.page.confirmAssign(); assert.equal(f.calls.modals.length, 0); assert.match(f.page.data.assignError, /不可选/);
  f.page.toggleAssignmentAssistant(event('openid', 'gone')); f.page.confirmAssign(); assert.equal(f.calls.modals.length, 1);
});
test('cancel closes without save and modal cancel retains choices; department filters retain team', async () => {
  const f = fixture(); await f.open(); f.page.selectAssignmentPrimary(event('openid', 'a')); f.page.toggleAssignmentAssistant(event('openid', 'b'));
  f.page.selectAssignmentDepartment(event('department', 'department:宣传部')); assert.equal(f.page.data.assignPrimaryOpenid, 'a'); assert.deepEqual(Array.from(f.page.data.assignAssistantOpenids), ['b']);
  f.page.confirmAssign(); f.calls.modals[0].success({ confirm: false }); assert.equal(f.page.data.assignDialogVisible, true);
  f.page.hideAssignDialog(); assert.equal(f.page.data.assignDialogVisible, false); assert.equal(f.calls.saves.length, 0);
});
test('network save failure retains team and allows retry; malformed list is failure rather than empty success', async () => {
  const f = fixture(); await f.open(); f.page.selectAssignmentPrimary(event('openid', 'a')); f.page.toggleAssignmentAssistant(event('openid', 'b'));
  f.api.assignAppointment = (...args) => { f.calls.saves.push(args); return Promise.reject(new Error('offline')); };
  f.page.confirmAssign(); f.calls.modals[0].success({ confirm: true }); await tick();
  assert.equal(f.page.data.assignSaving, false); assert.equal(f.page.data.assignPrimaryOpenid, 'a'); assert.deepEqual(Array.from(f.page.data.assignAssistantOpenids), ['b']); assert.match(f.page.data.assignError, /未保存/);
  f.page.confirmAssign(); assert.equal(f.calls.modals.length, 2);
  f.calls.modals[1].success({ confirm: false }); f.api.getMemberDirectory = () => Promise.resolve({ list: {} }); await f.page.loadAssignableMembers();
  assert.match(f.page.data.assignError, /加载失败/); assert.equal(f.page.data.assignAllMembers.length, 6);
});

test('admin can assign an active admin as primary or assistant with the correct role label', async () => {
  for (const primary of [true, false]) {
    const f = fixture(); await f.open();
    assert.match(f.page.data.assignAllMembers.find(person => person.openid === 'admin').roleText, /管理员 admin/);
    f.page.selectAssignmentPrimary(event('openid', primary ? 'admin' : 'a'));
    if (!primary) f.page.toggleAssignmentAssistant(event('openid', 'admin'));
    f.page.confirmAssign(); f.calls.modals[0].success({ confirm: true }); await tick();
    assert.deepEqual(JSON.parse(JSON.stringify(f.calls.saves[0])), ['12', '技术部', primary ? 'admin' : 'a', primary ? [] : ['admin']]);
  }
});
test('overlapping loads ignore earlier response; hide / unload / account switch ignore late responses', async () => {
  const f = fixture(), older = deferred(), newer = deferred(); f.api.getMemberDirectory = () => older.promise;
  const one = f.open(); await tick(); f.api.getMemberDirectory = () => newer.promise; const two = f.page.loadAssignableMembers(); await tick();
  newer.resolve({ list: [member('new')] }); await two; older.resolve({ list: [member('old')] }); await one;
  assert.equal(f.page.data.assignAllMembers[0].openid, 'new');
  for (const transition of [p => p.onHide(), p => p.onUnload(), () => { f.app.globalData.openid = 'other'; }]) {
    f.app.globalData.openid = 'viewer'; f.page.onShow(); const pending = deferred(); f.api.getMemberDirectory = () => pending.promise;
    const loading = f.open(); await tick(); transition(f.page); const before = JSON.stringify(f.page.data);
    pending.resolve({ list: [member('stale')] }); await loading; assert.equal(JSON.stringify(f.page.data), before);
  }
});
test('late confirm or save cannot mutate hidden / destroyed / different account page; in-flight save is not submitted twice', async () => {
  for (const transition of [f => f.page.onHide(), f => f.page.onUnload(), f => { f.app.globalData.openid = 'other'; }]) {
    const f = fixture(); await f.open(); f.page.selectAssignmentPrimary(event('openid', 'a')); f.page.confirmAssign(); transition(f); f.calls.modals[0].success({ confirm: true }); await tick(); assert.equal(f.calls.saves.length, 0);
    const g = fixture(); await g.open(); g.page.selectAssignmentPrimary(event('openid', 'a')); const pending = deferred(); g.api.assignAppointment = (...args) => { g.calls.saves.push(args); return pending.promise; };
    g.page.confirmAssign(); g.calls.modals[0].success({ confirm: true }); g.calls.modals[0].success({ confirm: true }); await tick(); assert.equal(g.calls.saves.length, 1);
    transition(g); const before = JSON.stringify(g.page.data); pending.resolve({ ok: true }); await tick(); assert.equal(JSON.stringify(g.page.data), before); assert.equal(g.calls.refresh, 0);
  }
});
test('unsigned / simulator / member cannot open modal; primary requires department; lifecycle hooks preserved', async () => {
  for (const patch of [{ notificationSession: '' }, { isSimulator: true }, { role: 'member' }]) { const f = fixture(); Object.assign(f.app.globalData, patch); await f.open(); assert.equal(f.page.data.assignDialogVisible, false); }
  const f = fixture(); await f.open(); f.page.selectAssignmentPrimary(event('openid', 'none')); assert.equal(f.page.data.assignPrimaryOpenid, '');
  f.page.toggleAssignmentAssistant(event('openid', 'none')); assert.equal(f.page.data.assignAssistantOpenids[0], 'none');
  f.page.onHide(); f.page.onUnload(); assert.deepEqual(f.calls.lifecycle, ['show', 'hide', 'unload']);
});
