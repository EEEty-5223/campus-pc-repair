const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
const root = path.resolve(__dirname, '..'), clone = value => JSON.parse(JSON.stringify(value))
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)) }
const messages = [{ id: '1', from: 'user', content: '预约用户提问', type: 'text' }, { id: '2', from: 'admin', content: '社团成员回复', type: 'text' }]
function fixture(options = {}) {
  const user = Object.assign({ openid: 'test-user', role: 'user', notificationSession: '' }, options.user), app = { globalData: user }
  const timers = new Map(), storage = {}, calls = { marks: [], renders: [], patches: [], prompts: [], disables: 0, modals: [], switches: [], ownFetches: 0, adminFetches: 0, messageFetches: 0, sends: 0, imageSends: 0, uploads: 0, pendingMessages: [], pendingSends: [] }
  let nextTimer = 1, page, media, sendResolver
  const wx = { getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop' } }), getStorageSync: key => storage[key], setStorageSync: (key, value) => { storage[key] = clone(value) },
    showToast() {}, showModal: args => { calls.modals.push(args); args.success({ confirm: !options.cancelLeave, cancel: !!options.cancelLeave }) },
    navigateTo: args => { calls.switches.push(args.url) }, switchTab: args => { calls.switches.push(args.url) }, chooseMedia: args => { media = args }, previewImage() {}
  }
  if (!options.noNativePrompt) { wx.enableAlertBeforeUnload = args => { calls.prompts.push(args); if (options.nativeFail) args.fail({}); else args.success({}) }; wx.disableAlertBeforeUnload = () => { calls.disables++ } }
  const helper = { exports: {} }
  vm.runInNewContext(fs.readFileSync(path.join(root, 'utils/chat-unread.js'), 'utf8'), { module: helper, wx, Promise })
  const unread = { ...helper.exports, markRead: (...args) => { calls.marks.push(clone(args)); helper.exports.markRead(...args) } }
  const api = {
    getMyAppointments: async () => { calls.ownFetches++; return { list: [{ id: 'p', status: 'pending' }] } },
    getAdminAppointments: async () => { calls.adminFetches++; return { list: [{ id: 'p', status: 'pending' }] } },
    getMessages: () => { calls.messageFetches++; if (options.fetchError) return Promise.reject(Error('network'));
      if (options.deferMessages) return new Promise(resolve => calls.pendingMessages.push(resolve)); return Promise.resolve({ list: clone(messages) }) },
    sendMessage: () => { calls.sends++; if (options.deferSend) return new Promise(resolve => { sendResolver = resolve }); return Promise.resolve({ ok: true }) },
    uploadImage: async () => { calls.uploads++; return 'https://example.invalid/test-image.png' },
    sendImageMessage: () => { calls.imageSends++; if (options.deferSend) return new Promise(resolve => { sendResolver = resolve }); return Promise.resolve({ ok: true }) }
  }
  const appointments = { decorate: item => Object.assign({}, item, { canReply: true, hasMessages: !!item.messages.length }) }
  vm.runInNewContext(fs.readFileSync(path.join(root, 'pages/chat/chat.js'), 'utf8'), {
    Page: definition => { page = definition }, getApp: () => app, require: name => name.includes('direct-staff-subscription') ? ({prepare:()=>Promise.resolve(),hide(){},dispose(){},tap(){}}) : name.includes('api-request') ? api : name.includes('chat-unread') ? unread : appointments,
    wx, Promise, console, setTimeout: callback => { const id = nextTimer++; timers.set(id, callback); return id }, clearTimeout: id => { timers.delete(id) }
  })
  page.data = clone(page.data)
  page.setData = (patch, callback) => { calls.patches.push(clone(patch)); Object.assign(page.data, clone(patch)); if (callback) { if (options.holdRender) calls.renders.push(callback); else callback() } }
  page.onLoad({ id: 'p', role: options.routeRole || 'user' })
  return { page, user, calls, timers, options, unread, resolveSend: () => sendResolver({ ok: true }), media: () => media }
}

test('student and club viewer bubbles align their own side right, and labels describe the actual side', async () => {
  const student = fixture(); await student.page.onShow()
  assert.equal(student.page.data.item.messages[0].viewerClass, 'msg-own'); assert.equal(student.page.data.item.messages[1].viewerClass, 'msg-other')
  assert.equal(student.page.data.item.messages[0].fromText, '我'); assert.equal(student.page.data.item.messages[1].fromText, '社团成员')
  for (const role of ['admin', 'leader', 'member']) {
    const f = fixture({ user: { role, notificationSession: 'signed-test-session' }, routeRole: 'admin' }); await f.page.onShow()
    assert.equal(f.page.data.role, 'admin'); assert.equal(f.calls.adminFetches, 1)
    assert.equal(f.page.data.item.messages[0].viewerClass, 'msg-other'); assert.equal(f.page.data.item.messages[1].viewerClass, 'msg-own')
    assert.equal(f.page.data.item.messages[0].fromText, '预约用户'); assert.equal(f.page.data.item.messages[1].fromText, '社团成员')
    assert.equal(f.calls.marks[0][2], 'admin')
  }
  const unauthorized = fixture({ routeRole: 'admin' }); await unauthorized.page.onShow()
  assert.equal(unauthorized.page.data.role, 'user'); assert.equal(unauthorized.calls.adminFetches, 0)
})
test('markRead happens after successful render, only for the open account/side', async () => {
  const f = fixture({ holdRender: true }); await f.page.onShow()
  assert.equal(f.calls.marks.length, 0)
  assert.equal(f.unread.countUnread('test-user', 'p', 'user', messages), 1)
  f.calls.renders.shift()()
  assert.equal(f.calls.marks.length, 1)
  assert.equal(f.unread.countUnread('test-user', 'p', 'user', messages), 0)
  assert.equal(f.unread.countUnread('different-user', 'p', 'user', messages), 1)
})
test('render callback after hide or account change never marks unread as read', async () => {
  for (const change of ['hide', 'account']) {
    const f = fixture({ holdRender: true }); await f.page.onShow()
    if (change === 'hide') f.page.onHide(); else f.user.openid = 'different-user'
    f.calls.renders.shift()(); assert.equal(f.calls.marks.length, 0)
  }
})
test('polling runs only when visible and hide/unload cancels timers', async () => {
  const f = fixture(); await f.page.onShow(); assert.equal(f.timers.size, 1)
  const callback = [...f.timers.values()][0]; f.timers.clear(); callback(); await flush()
  assert.equal(f.calls.messageFetches, 2); assert.equal(f.timers.size, 1)
  f.page.onHide(); assert.equal(f.timers.size, 0)
  await f.page.loadItem(); assert.equal(f.calls.messageFetches, 2)
  await f.page.onShow(); assert.equal(f.timers.size, 1)
  f.page.onUnload(); assert.equal(f.timers.size, 0)
})
test('in-flight load after hide does not render or mark; latest concurrent load wins', async () => {
  const hidden = fixture({ deferMessages: true }), hiddenLoad = hidden.page.onShow(); await flush()
  hidden.page.onHide(); const patchesAfterHide = hidden.calls.patches.length
  hidden.calls.pendingMessages[0]({ list: messages }); await hiddenLoad
  assert.equal(hidden.calls.patches.length, patchesAfterHide); assert.equal(hidden.calls.marks.length, 0)
  const concurrent = fixture({ deferMessages: true }), first = concurrent.page.onShow(); await flush()
  const second = concurrent.page.loadItem(); await flush()
  concurrent.calls.pendingMessages[1]({ list: [{ id: '7', from: 'admin', content: 'new' }] }); await second
  concurrent.calls.pendingMessages[0]({ list: messages }); await first
  assert.equal(concurrent.page.data.item.messages[0].id, '7'); assert.equal(concurrent.calls.marks.length, 1)
})
test('fetch failure neither fabricates local conversation nor clears unread', async () => {
  const f = fixture({ fetchError: true }); await f.page.onShow()
  assert.equal(f.page.data.item, null); assert.equal(f.calls.marks.length, 0); assert(f.page.data.loadError)
})
test('native leave alert uses honest reminder and visible fallback works if API absent or fails', async () => {
  for (const options of [{}, { noNativePrompt: true }, { nativeFail: true }]) {
    const f = fixture(options); await f.page.onShow(); f.page.leaveChat()
    assert.equal(f.calls.modals[0].title, '离开聊天'); assert.match(f.calls.modals[0].content, /订阅一次消息/)
    assert.deepEqual(f.calls.switches, ['/pages/subscriptions/subscriptions?id=p'])
    if (!options.noNativePrompt) assert.match(f.calls.prompts[0].message, /用完需再次订阅/)
  }
  const cancelled = fixture({ cancelLeave: true }); await cancelled.page.onShow(); cancelled.page.leaveChat(); assert.deepEqual(cancelled.calls.switches, ['/pages/index/index'])
})
test('text send completing after hide/unload cannot update data; in-flight duplicate is blocked', async () => {
  for (const action of ['onHide', 'onUnload']) {
    const f = fixture({ deferSend: true }); await f.page.onShow(); f.page.onChatInput({ detail: { value: '保留的草稿' } })
    const operation = f.page.sendMessage(); assert.equal(f.calls.sends, 1)
    f.page[action](); const count = f.calls.patches.length
    f.resolveSend(); await operation; assert.equal(f.calls.patches.length, count); assert.equal(f.page.data.chatText, '保留的草稿')
  }
  const returning = fixture({ deferSend: true }); await returning.page.onShow(); returning.page.onChatInput({ detail: { value: '旧发送草稿' } })
  const operation = returning.page.sendMessage(); returning.page.onHide(); await returning.page.onShow()
  returning.page.onChatInput({ detail: { value: '回来后新草稿' } }); await returning.page.sendMessage(); assert.equal(returning.calls.sends, 1)
  returning.resolveSend(); await operation; assert.equal(returning.page.data.chatText, '回来后新草稿')
})
test('image send completing after unload cannot mutate page; native picker hide/show still sends selected image', async () => {
  const f = fixture({ deferSend: true }); await f.page.onShow()
  const sending = f.page.sendImage('/offline-test.png'); await flush(); f.page.onUnload()
  const count = f.calls.patches.length; f.resolveSend(); await sending; assert.equal(f.calls.patches.length, count)
  const picker = fixture(); await picker.page.onShow(); picker.page.chooseImage(); picker.page.onHide()
  picker.media().success({ tempFiles: [{ tempFilePath: '/selected-offline-image.png' }] }); assert.equal(picker.calls.uploads, 0)
  await picker.page.onShow(); assert.equal(picker.calls.uploads, 1); assert.equal(picker.calls.imageSends, 1)
})
