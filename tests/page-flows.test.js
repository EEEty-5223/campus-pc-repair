const assert = require('assert')
const path = require('path')

const projectRoot = path.resolve(__dirname, '..')
const storage = Object.create(null)
const calls = {
  modals: [],
  toasts: [],
  navigateTo: [],
  navigateBack: 0,
  switchTab: [],
  titles: [],
  pullDownStops: 0
}
const modalResponses = []

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

global.wx = {
  getStorageSync(key) {
    return clone(storage[key])
  },
  setStorageSync(key, value) {
    storage[key] = clone(value)
  },
  showModal(options) {
    calls.modals.push(clone({
      title: options.title,
      content: options.content,
      confirmText: options.confirmText
    }))
    const result = modalResponses.length
      ? modalResponses.shift()
      : { confirm: true, cancel: false }
    if (options.success) options.success(result)
    if (options.complete) options.complete(result)
  },
  showToast(options) {
    calls.toasts.push(clone(options))
  },
  navigateTo(options) {
    calls.navigateTo.push(options.url)
  },
  navigateBack() {
    calls.navigateBack += 1
  },
  switchTab(options) {
    calls.switchTab.push(options.url)
  },
  setNavigationBarTitle(options) {
    calls.titles.push(options.title)
  },
  stopPullDownRefresh() {
    calls.pullDownStops += 1
  }
}

function loadPage(relativePath) {
  let definition
  global.Page = function (config) {
    definition = config
  }

  const absolutePath = path.join(projectRoot, relativePath)
  delete require.cache[require.resolve(absolutePath)]
  require(absolutePath)
  assert(definition, relativePath + ' should register a Page')

  const instance = {}
  Object.keys(definition).forEach((key) => {
    instance[key] = key === 'data' ? clone(definition[key]) : definition[key]
  })
  instance.setData = function (patch) {
    Object.assign(this.data, clone(patch))
  }
  return instance
}

function submit(page, values) {
  page.submitBooking({ detail: { value: values } })
}

function validValues(overrides) {
  return Object.assign({
    name: '测试同学',
    phone: '13800001234',
    location: '东区 2 号宿舍楼',
    description: '电脑开机后经常出现蓝屏',
    agreement: ['agreed']
  }, overrides || {})
}

function last(array) {
  return array[array.length - 1]
}

// 1. 预约页校验、提交以及成功跳转。
const booking = loadPage('pages/booking/booking.js')
booking.onLoad({})
assert(booking.data.appointmentDate, 'booking page should initialize a date')
submit(booking, validValues({ name: '' }))
assert.strictEqual(last(calls.toasts).title, '请填写联系人姓名')

submit(booking, validValues())
assert.strictEqual(last(calls.modals).title, '预约已提交')
assert.strictEqual(last(calls.switchTab), '/pages/records/records')
assert.strictEqual(booking.data.submitting, false)

// 2. “我的预约”能够读到新记录，并正确筛选处理中记录。
const records = loadPage('pages/records/records.js')
records.onShow()
assert.strictEqual(records.data.items.length, 1)
const firstId = records.data.items[0].id
records.selectFilter({ currentTarget: { dataset: { filter: 'active' } } })
assert.strictEqual(records.data.items.length, 1)
records.onPullDownRefresh()
assert.strictEqual(calls.pullDownStops, 1)

// 3. 详情页能打开修改入口。
const detail = loadPage('pages/detail/detail.js')
detail.onLoad({ id: firstId })
detail.onShow()
assert.strictEqual(detail.data.item.status, 'pending')
detail.editBooking()
assert.strictEqual(last(calls.navigateTo), '/pages/booking/booking?id=' + firstId)

// 4. 修改待确认预约并保留原 ID。
const editing = loadPage('pages/booking/booking.js')
editing.onLoad({ id: firstId })
assert.strictEqual(editing.data.isEditing, true)
assert.strictEqual(last(calls.titles), '修改预约')
submit(editing, validValues({
  location: '图书馆一楼服务台',
  description: '修改后的故障说明不少于五个字'
}))
assert.strictEqual(last(calls.modals).title, '修改已保存')
assert.strictEqual(calls.navigateBack, 1)

const appointments = require(path.join(projectRoot, 'utils/appointments.js'))
assert.strictEqual(appointments.getById(firstId).location, '图书馆一楼服务台')

// 5. 重复预约先取消确认，再确认后才能新增。
const duplicate = loadPage('pages/booking/booking.js')
duplicate.onLoad({})
duplicate.setData({
  appointmentDate: appointments.getById(firstId).appointmentDate,
  timeIndex: duplicate.data.timeSlots.indexOf(appointments.getById(firstId).timeSlot)
})
modalResponses.push({ confirm: false, cancel: true })
submit(duplicate, validValues())
assert.strictEqual(last(calls.modals).title, '发现相同时段预约')
assert.strictEqual(appointments.list().length, 1)

modalResponses.push({ confirm: true, cancel: false })
modalResponses.push({ confirm: true, cancel: false })
submit(duplicate, validValues())
assert.strictEqual(appointments.list().length, 2)

// 6. 社团后台按合法顺序完成第一条预约，并拒绝结束后的再次变更。
const admin = loadPage('pages/admin/admin.js')
admin.onShow()
assert.strictEqual(admin.data.stats.total, 2)

function adminChange(status) {
  admin.changeStatus({ currentTarget: { dataset: { id: firstId, status } } })
}

adminChange('accepted')
assert.strictEqual(appointments.getById(firstId).status, 'accepted')
adminChange('repairing')
assert.strictEqual(appointments.getById(firstId).status, 'repairing')
adminChange('completed')
assert.strictEqual(appointments.getById(firstId).status, 'completed')
adminChange('accepted')
assert.strictEqual(last(calls.toasts).title, '不允许这样变更状态')
assert.strictEqual(appointments.getById(firstId).history.length, 4)

// 7. 另一条待确认预约可从详情页取消，取消后不能再取消。
const secondId = appointments.list().find((item) => item.id !== firstId).id
const cancelDetail = loadPage('pages/detail/detail.js')
cancelDetail.onLoad({ id: secondId })
cancelDetail.onShow()
cancelDetail.cancelBooking()
assert.strictEqual(cancelDetail.data.item.status, 'cancelled')
cancelDetail.cancelBooking()
assert.strictEqual(last(calls.toasts).title, '状态已变化，无法取消')

// 8. 列表筛选能区分已结束记录。
records.onShow()
records.selectFilter({ currentTarget: { dataset: { filter: 'closed' } } })
assert.strictEqual(records.data.items.length, 2)
assert(records.data.items.every((item) => ['completed', 'cancelled'].includes(item.status)))

// 9. 社团后台回复预约内容，用户详情页与“我的预约”可见。
admin.onShow()
admin.onReplyInput({ currentTarget: { dataset: { id: firstId } }, detail: { value: '  ' } })
admin.submitReply({ currentTarget: { dataset: { id: firstId } } })
assert.strictEqual(last(calls.toasts).title, '请先输入回复内容')

admin.onReplyInput({
  currentTarget: { dataset: { id: firstId } },
  detail: { value: '已确认预约，请保持电话畅通。' }
})
admin.submitReply({ currentTarget: { dataset: { id: firstId } } })
assert.strictEqual(last(calls.toasts).title, '回复已发送')
assert.strictEqual(admin.data.draftReplies[firstId], '')

const repliedItem = appointments.getById(firstId)
assert.strictEqual(repliedItem.hasReply, true)
assert.strictEqual(repliedItem.reply.content, '已确认预约，请保持电话畅通。')

const replyDetail = loadPage('pages/detail/detail.js')
replyDetail.onLoad({ id: firstId })
replyDetail.onShow()
assert.strictEqual(replyDetail.data.item.hasReply, true)

console.log('page-flows.test.js: all tests passed')
