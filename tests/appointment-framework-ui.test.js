const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm'), fs = require('node:fs'), path = require('node:path')
const root = path.resolve(__dirname, '..'), flush = async () => { for (let n = 0; n < 5; n++) await new Promise(r => setImmediate(r)) }
function run(file, extras = {}) { const module = { exports: {} }; let page; vm.runInNewContext(fs.readFileSync(path.join(root, file), 'utf8'), { module, Page: p => { page = p }, console, Promise, setTimeout, clearTimeout, ...extras }); return page || module.exports }
test('admin override requires reason and two explicit confirmations, sends no completion code', async () => {
 const user = { openid: 'a', role: 'admin', notificationSession: 'signed' }, modals = [], calls = []
 const api = { forceAppointmentStatus: (...x) => { calls.push(x); return Promise.resolve() } }
 const actions = run('utils/appointment-admin-actions.js', { getApp: () => ({ globalData: user }), require: () => api, wx: { showModal: x => modals.push(x), showToast() {} } })
 const page = { data: { id: 'p', item: { id: 'p', status: 'repairing' } }, setData(p) { Object.assign(this.data, p) }, loadItem: async () => {} }, event = { currentTarget: { dataset: {} } }
 actions.forceComplete.call(page, event); modals.shift().success({ confirm: true, content: '  ' }); assert.equal(calls.length, 0); assert.equal(modals.length, 0)
 actions.forceComplete.call(page, event); modals.shift().success({ confirm: true, content: '用户完成码无法获取，现场确认' }); assert.equal(calls.length, 0)
 const confirmation = modals.shift(); assert.match(confirmation.content, /跳过用户完成码/); confirmation.success({ confirm: true }); await flush()
 assert.deepEqual(calls[0], ['p', 'completed', '用户完成码无法获取，现场确认']); assert.equal(page.data.adminActionBusy, false)
})
test('non-admin, voided record and identity change never submit special operation', () => {
 const user = { openid: 'a', role: 'member', notificationSession: 'signed' }, modals = [], calls = []
 const actions = run('utils/appointment-admin-actions.js', { getApp: () => ({ globalData: user }), require: () => ({ voidAppointment: (...x) => { calls.push(x); return Promise.resolve() } }), wx: { showModal: x => modals.push(x), showToast() {} } })
 const page = { data: { id: 'p', item: { id: 'p', isVoided: false } }, setData() {} }, event = { currentTarget: { dataset: {} } }
 actions.voidAppointment.call(page, event); assert.equal(modals.length, 0)
 user.role = 'admin'; page.data.item.isVoided = true; actions.voidAppointment.call(page, event); assert.equal(modals.length, 0)
 page.data.item.isVoided = false; actions.voidAppointment.call(page, event); modals.shift().success({ confirm: true, content: '重复预约' }); user.openid = 'other'; modals.shift().success({ confirm: true }); assert.equal(calls.length, 0)
})
test('chat uses authenticated sender identity, named teammates and structured assignment notice', async () => {
 const user = { openid: 'staff-a', role: 'member', notificationSession: 'signed' }, copied = [], messages = [
  { id: '1', from: 'admin', senderOpenid: 'staff-a', senderName: '小堂主', kind: 'normal', content: '我的消息' },
  { id: '2', from: 'admin', senderOpenid: 'staff-b', senderName: '随行同学', kind: 'normal', content: '同事消息' },
  { id: '3', from: 'admin', senderOpenid: 'admin', senderName: '胡桃', kind: 'admin_notice', content: '协调安排' },
  { id: '4', from: 'admin', kind: 'assignment_notice', content: '服务人员已调整', assignmentPeople: [{ openid: 'staff-b', phone: '13800000000' }] },
  { id: '5', from: 'user', senderOpenid: 'owner', kind: 'normal', content: '人员分配通知' }
 ]
 const api = { getAppointment: async () => ({ item: { id: 'p', status: 'repairing' } }), getMessages: async () => ({ list: messages, canReply: false }) }
 const definition = run('pages/chat/chat.js', { getApp: () => ({ globalData: user }), require: n => n.includes('api-request') ? api : n.includes('chat-unread') ? { markRead() {} } : require(path.join(root, 'utils/appointments')), wx: { setClipboardData: x => { copied.push(x.data); x.success() }, showToast() {} } })
 const page = { ...definition, data: { ...definition.data, id: 'p', role: 'admin' }, _requestedAdmin: true, _visible: true, setData(p, cb) { Object.assign(this.data, p); if (cb) cb() } }
 await page.loadItem(); const result = page.data.item.messages
 assert.equal(result[0].viewerClass, 'msg-own'); assert.equal(result[1].viewerClass, 'msg-other'); assert.equal(result[1].fromText, '随行同学')
 assert.equal(result[2].viewerClass, 'msg-admin-notice'); assert.equal(result[3].isAssignmentNotice, true); assert.equal(result[4].isAssignmentNotice, false); assert.equal(page.data.item.canReply, false)
 page.copyPhone({ currentTarget: { dataset: { phone: '138 0000 0000' } } }); assert.deepEqual(copied, ['13800000000'])
})

test('participating admin uses ordinary own/other text and image bubbles while outside admin notices stay grey', async () => {
 for (const openid of ['admin', 'owner']) {
  const user = { openid, role: openid === 'admin' ? 'admin' : 'user', notificationSession: 'signed' }
  const messages = [{ id: '1', from: 'admin', senderOpenid: 'admin', senderName: '胡桃', kind: 'normal', content: '参与维修', type: 'text' }, { id: '2', from: 'admin', senderOpenid: 'admin', senderName: '胡桃', kind: 'normal', type: 'image', imageUrl: 'https://example.invalid/a.png' }, { id: '3', from: 'admin', senderOpenid: 'other-admin', kind: 'admin_notice', content: '协调' }]
  const api = { getAppointment: async () => ({ item: { id: 'p', status: 'repairing' } }), getMessages: async () => ({ list: messages, canReply: true }) }
  const definition = run('pages/chat/chat.js', { getApp: () => ({ globalData: user }), require: n => n.includes('api-request') ? api : n.includes('chat-unread') ? { markRead() {} } : require(path.join(root, 'utils/appointments')), wx: {} })
  const page = { ...definition, data: { ...definition.data, id: 'p' }, _requestedAdmin: openid === 'admin', _visible: true, setData(p, cb) { Object.assign(this.data, p); if (cb) cb() } }
  await page.loadItem(); const rows = page.data.item.messages
  for (const message of rows.slice(0, 2)) { assert.equal(message.viewerClass, openid === 'admin' ? 'msg-own' : 'msg-other'); assert.equal(message.isAdminNotice, false); assert.equal(message.fromText, '胡桃') }
  assert.equal(rows[2].viewerClass, 'msg-admin-notice'); assert.equal(rows[2].isAdminNotice, true)
 }
})
test('voided appointments always decorate as hidden-state read-only, even if backend canReply is true', () => {
 const appointments = require(path.join(root, 'utils/appointments'))
 const item = appointments.decorate({ status: 'pending', isVoided: true, canReply: true })
 assert.equal(item.canReply, false); assert.equal(item.canEdit, false); assert.equal(item.canCancel, false); assert.equal(item.statusText, '已作废')
})
test('unread staff messages are isolated by real sender, notices are read per viewer', () => {
 const helper = run('utils/chat-unread.js', { wx: { getStorageSync() {}, setStorageSync() {}, getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop' } }) } })
 const messages = [{ id: '1', from: 'admin', senderOpenid: 'a' }, { id: '2', from: 'admin', senderOpenid: 'b' }, { id: '3', kind: 'assignment_notice' }]
 assert.equal(helper.countUnread('a', 'p', 'admin', messages), 2)
 helper.markRead('a', 'p', 'admin', messages); assert.equal(helper.countUnread('a', 'p', 'admin', messages), 0); assert.equal(helper.countUnread('b', 'p', 'admin', messages), 2)
})

test('restore prompts explain retained status/new code and require reason, confirmation and unchanged context', async () => {
 const user = { openid: 'a', role: 'admin', notificationSession: 'signed' }, modals = [], calls = []
 const actions = run('utils/appointment-admin-actions.js', { getApp: () => ({ globalData: user }), require: () => ({ restoreAppointment: (...args) => { calls.push(args); return Promise.resolve() } }), wx: { showModal: x => modals.push(x), showToast() {} } })
 const page = { data: { id: 'p', item: { id: 'p', isVoided: true, status: 'repairing' } }, setData(p) { Object.assign(this.data, p) }, loadItem: async () => {} }, event = { currentTarget: { dataset: {} } }
 actions.restoreAppointment.call(page, event); modals.shift().success({ confirm: true, content: '核实后恢复' }); const confirm = modals.shift(); assert.match(confirm.content, /保留原状态/); assert.match(confirm.content, /新完成码/); assert.equal(calls.length, 0); confirm.success({ confirm: true }); await flush()
 assert.deepEqual(calls[0], ['p', '核实后恢复']); assert.equal(page.data.adminActionBusy, false)
 actions.restoreAppointment.call(page, event); modals.shift().success({ confirm: true, content: '再次恢复' }); page._detailVersion = 1; modals.shift().success({ confirm: true }); assert.equal(calls.length, 1)
 page.data.item.isVoided = false; actions.restoreAppointment.call(page, event); assert.equal(modals.length, 0)
})

test('API preserves detail chat capabilities and restore sends only signed session, reason and confirmation', async () => {
 const requests = [], user = { openid: 'leader', role: 'leader', notificationSession: 'signed' }
 const api = run('utils/api-request.js', { getApp: () => ({ globalData: user }), wx: { getAccountInfoSync: () => ({ miniProgram: { envVersion: 'release' } }), request: r => { requests.push(r); r.success({ statusCode: 200, data: { ok: true, item: { id: 'p', status: 'repairing' }, canChat: false, canReply: false } }) } } })
 const response = await api.getAppointment('p'); assert.equal(response.item.canChat, false); assert.equal(response.item.canReply, false)
 await api.restoreAppointment('p', '恢复原因'); const req = requests[1]; assert.match(req.url, /\/p\/restore$/); assert.equal(req.header.Authorization, 'Bearer signed'); assert.deepEqual(JSON.parse(JSON.stringify(req.data)), { reason: '恢复原因', confirmed: true })
})

test('chat stops showing cached messages when current team permission is revoked', async () => {
 const user = { openid: 'staff', role: 'member', notificationSession: 'signed' }; let revoked = false
 const api = { getAppointment: async () => { if (revoked) throw Object.assign(new Error('无权查看'), { code: 'APPOINTMENT_FORBIDDEN' }); return { item: { id: 'p', status: 'repairing', canChat: true } } }, getMessages: async () => ({ list: [{ id: '1', from: 'user', content: '历史' }], canReply: true }) }
 const definition = run('pages/chat/chat.js', { getApp: () => ({ globalData: user }), require: n => n.includes('api-request') ? api : n.includes('chat-unread') ? { markRead() {} } : require(path.join(root, 'utils/appointments')), wx: {} })
 const page = { ...definition, data: { ...definition.data, id: 'p' }, _visible: true, setData(p, cb) { Object.assign(this.data, p); if (cb) cb() } }
 await page.loadItem(); assert(page.data.item.canReply); revoked = true; await page.loadItem(); assert.equal(page.data.item, null); assert.match(page.data.loadError, /无权/)
})
