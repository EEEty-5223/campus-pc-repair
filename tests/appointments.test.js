var assert = require('assert')
var path = require('path')

var cache = {}
global.wx = {
  getStorageSync: function (key) {
    return cache[key]
  },
  setStorageSync: function (key, value) {
    cache[key] = value
  }
}

var store = require(path.join(__dirname, '..', 'utils', 'appointments.js'))

function reset() {
  cache = {}
}

function samplePayload() {
  return {
    name: '测试同学',
    phone: '13800000000',
    location: '东区 3 号宿舍楼',
    deviceType: '笔记本电脑',
    faultType: '无法开机',
    description: '按下电源键后没有反应',
    appointmentDate: '2026-09-18',
    timeSlot: '14:00-16:00'
  }
}

function testCreateAndRead() {
  reset()
  var created = store.create(samplePayload())
  assert.strictEqual(created.status, 'pending')
  assert.strictEqual(created.statusText, '预约中')
  assert.strictEqual(created.canEdit, true)
  assert.strictEqual(created.history.length, 1)
  assert.strictEqual(store.list().length, 1)
}

function testPendingAppointmentCanBeEdited() {
  reset()
  var created = store.create(samplePayload())
  assert.strictEqual(store.update(created.id, {
    location: '西区活动中心',
    status: 'completed'
  }), true)
  var updated = store.getById(created.id)
  assert.strictEqual(updated.location, '西区活动中心')
  assert.strictEqual(updated.status, 'pending')
}

function testTransitionRulesAndHistory() {
  reset()
  var created = store.create(samplePayload())
  assert.strictEqual(store.updateStatus(created.id, 'repairing'), false)
  assert.strictEqual(store.updateStatus(created.id, 'accepted'), true)
  assert.strictEqual(store.update(created.id, { location: '不应生效' }), false)
  assert.strictEqual(store.updateStatus(created.id, 'repairing'), true)
  assert.strictEqual(store.updateStatus(created.id, 'completed'), true)
  assert.strictEqual(store.updateStatus(created.id, 'cancelled'), false)

  var completed = store.getById(created.id)
  assert.strictEqual(completed.status, 'completed')
  assert.strictEqual(completed.history.length, 4)
  assert.strictEqual(completed.history[0].status, 'completed')
}

function testLegacyRecordFallback() {
  reset()
  var key = 'campus_pc_repair_appointments_v1'
  cache[key] = [{
    id: 'WX-LEGACY',
    status: 'accepted',
    createdAt: 1000,
    updatedAt: 2000
  }]
  var legacy = store.getById('WX-LEGACY')
  assert.strictEqual(legacy.history.length, 1)
  assert.strictEqual(legacy.history[0].status, 'accepted')
}

function testDuplicateDetection() {
  reset()
  var payload = samplePayload()
  var created = store.create(payload)
  assert.strictEqual(store.hasActiveDuplicate(
    payload.phone,
    payload.appointmentDate,
    payload.timeSlot,
    ''
  ), true)
  assert.strictEqual(store.hasActiveDuplicate(
    payload.phone,
    payload.appointmentDate,
    payload.timeSlot,
    created.id
  ), false)
  store.updateStatus(created.id, 'accepted')
  store.updateStatus(created.id, 'repairing')
  store.updateStatus(created.id, 'completed')
  assert.strictEqual(store.hasActiveDuplicate(
    payload.phone,
    payload.appointmentDate,
    payload.timeSlot,
    ''
  ), false)
}

function testDemoDataOnlySeedsEmptyStore() {
  reset()
  assert.strictEqual(store.seedDemoData(), true)
  assert.strictEqual(store.list().length, 3)
  assert.strictEqual(store.seedDemoData(), false)
  assert.strictEqual(store.list().length, 3)
}

function testReplyToAppointment() {
  reset()
  var created = store.create(samplePayload())
  assert.strictEqual(created.hasReply, false)
  assert.strictEqual(store.replyTo(created.id, '  '), false)
  assert.strictEqual(store.replyTo(created.id, '已收到，请保持电话畅通。'), true)
  var replied = store.getById(created.id)
  assert.strictEqual(replied.hasReply, true)
  assert.strictEqual(replied.reply.content, '已收到，请保持电话畅通。')
  assert(replied.reply.atText, 'reply should carry a formatted time')
  assert.strictEqual(store.replyTo('NOT_EXIST', 'hi'), false)
}

function testTwoWayChat() {
  reset()
  var created = store.create(samplePayload())
  assert.strictEqual(created.hasMessages, false)
  assert.strictEqual(created.latestMessage, null)

  // 用户发一条
  assert.strictEqual(store.addMessage(created.id, 'user', '请问大概几点上门？'), true)
  var item = store.getById(created.id)
  assert.strictEqual(item.messages.length, 1)
  assert.strictEqual(item.messages[0].from, 'user')
  assert.strictEqual(item.messages[0].fromText, '我')
  assert.strictEqual(item.hasMessages, true)
  assert.strictEqual(item.latestMessage.content, '请问大概几点上门？')
  assert.strictEqual(item.hasReply, false)

  // 管理员回一条
  assert.strictEqual(store.addMessage(created.id, 'admin', '下午三点上门。'), true)
  item = store.getById(created.id)
  assert.strictEqual(item.messages.length, 2)
  assert.strictEqual(item.messages[1].from, 'admin')
  assert.strictEqual(item.messages[1].fromText, '社团')
  assert.strictEqual(item.latestMessage.content, '下午三点上门。')
  assert.strictEqual(item.hasReply, true)

  // 空白内容不发送
  assert.strictEqual(store.addMessage(created.id, 'admin', '  '), false)
  assert.strictEqual(store.getById(created.id).messages.length, 2)

  // 非法发送方回退为 user
  store.addMessage(created.id, 'hacker', 'x')
  assert.strictEqual(store.getById(created.id).messages[2].from, 'user')
}

function testLegacyReplyMigratesToMessages() {
  reset()
  var key = 'campus_pc_repair_appointments_v1'
  cache[key] = [{
    id: 'WX-LEGACY-REPLY',
    status: 'accepted',
    createdAt: 1000,
    updatedAt: 2000,
    reply: { content: '旧的社团回复', at: 1500, atText: '2026-09-18 10:00' }
  }]
  var item = store.getById('WX-LEGACY-REPLY')
  assert.strictEqual(item.messages.length, 1)
  assert.strictEqual(item.messages[0].from, 'admin')
  assert.strictEqual(item.messages[0].content, '旧的社团回复')
  assert.strictEqual(item.hasReply, true)
}

testCreateAndRead()
testPendingAppointmentCanBeEdited()
testTransitionRulesAndHistory()
testLegacyRecordFallback()
testDuplicateDetection()
testDemoDataOnlySeedsEmptyStore()
testReplyToAppointment()
testTwoWayChat()
testLegacyReplyMigratesToMessages()

console.log('appointments.test.js: all tests passed')
