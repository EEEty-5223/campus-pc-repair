'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const root = path.resolve(__dirname, '..')
const clone = value => JSON.parse(JSON.stringify(value))
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }

function fixture(options = {}) {
  const calls = { routes: [], tabs: [], localReads: 0, submissions: 0 }
  const app = { globalData: { openid: 'real-student', isAdmin: false } }
  const api = {
    getMyAppointments: options.getMyAppointments || (() => Promise.resolve({ list: [] })),
    getAdminAppointments: () => Promise.resolve({ list: [] }),
    createAppointment: () => { calls.submissions++; return Promise.resolve({ ok: true }) },
    updateAppointment: () => { calls.submissions++; return Promise.resolve({ ok: true }) }
  }
  const wx = {
    navigateTo: value => calls.routes.push(value.url),
    switchTab: value => calls.tabs.push(value.url),
    getStorageSync: () => options.draft ? clone(options.draft) : undefined,
    setStorageSync: () => {}, removeStorageSync: () => {},
    showToast: () => {}, showModal: () => {}, setNavigationBarTitle: () => {},
    navigateBack: () => {}
  }
  function page(relativePath) {
    let definition
    vm.runInNewContext(fs.readFileSync(path.join(root, relativePath), 'utf8'), {
      Page: value => { definition = value }, wx, getApp: () => app, setInterval: () => 1, clearInterval() {},
      console: { error: () => {} },
      require: name => name.includes('portal-api') ? { identity: () => 'fixture', call: () => Promise.resolve({ list: [] }), article: x => x, articles: rows => Promise.resolve(rows) } : name.includes('chat-unread') ? { overview: () => Promise.resolve({ total: 0, counts: {}, items: [] }) } : name.includes('api-request') ? api : {
        list: () => { calls.localReads++; return [{ id: 'local-demo' }, { id: 'local-demo-2' }] },
        decorate: item => Object.assign({}, item, { canEdit: true })
      }
    }, { filename: relativePath })
    return Object.assign({}, definition, { data: clone(definition.data), setData(patch) { Object.assign(this.data, clone(patch)) } })
  }
  return { page, calls, app, api }
}

const services = { system: '系统与软件', maintenance: '清灰与保养', hardware: '硬件或外设', network: '网络问题' }

test('all four service cards lead to booking with matching fault category and no submission', () => {
  const f = fixture()
  const home = f.page('pages/index/index.js')
  assert.deepEqual(home.data.services.map(item => item.id), Object.keys(services))
  for (const [id, fault] of Object.entries(services)) {
    home.goServiceBooking({ currentTarget: { dataset: { service: id } } })
    assert.equal(f.calls.routes.at(-1), '/pages/booking/booking?service=' + id)
    const booking = f.page('pages/booking/booking.js')
    booking.onLoad({ service: id })
    assert.equal(booking.data.faultTypes[booking.data.faultIndex], fault)
    assert.equal(booking.data.servicePrefilled, true)
    assert.equal(booking.data.isEditing, false)
  }
  assert.equal(f.calls.submissions, 0)
})

test('explicit service overrides only draft fault category; generic booking preserves draft', () => {
  const draft = { formData: { name: '同学', phone: '13800001234', location: '校内地点', description: '保留已有故障描述' }, deviceIndex: 1, faultIndex: 2, timeIndex: 3, appointmentDate: '2030-10-13' }
  const f = fixture({ draft })
  const booking = f.page('pages/booking/booking.js')
  booking.onLoad({ service: 'maintenance' })
  assert.deepEqual(booking.data.formData, draft.formData)
  for (const key of ['deviceIndex', 'timeIndex', 'appointmentDate']) assert.equal(booking.data[key], draft[key])
  assert.equal(booking.data.faultTypes[booking.data.faultIndex], '清灰与保养')
  assert.equal(draft.faultIndex, 2)
  const generic = f.page('pages/booking/booking.js')
  generic.onLoad({})
  assert.equal(generic.data.faultIndex, 2)
  assert.equal(generic.data.servicePrefilled, false)
})

test('edit route ignores service prefill and draft, preserves appointment details', async () => {
  const appointment = { id: 'APPT-existing', deviceType: '其他设备', faultType: '其他问题', timeSlot: '14:00-16:00', appointmentDate: '2030-10-15', name: '原联系人', phone: '13900001234', location: '原地点', description: '原故障描述' }
  const f = fixture({ draft: { faultIndex: 0, formData: { name: '草稿联系人' } }, getMyAppointments: () => Promise.resolve({ list: [appointment] }) })
  const booking = f.page('pages/booking/booking.js')
  booking.onLoad({ id: appointment.id, service: 'maintenance' })
  await flush()
  assert.equal(booking.data.isEditing, true)
  assert.equal(booking.data.editId, appointment.id)
  assert.equal(booking.data.servicePrefilled, false)
  assert.equal(booking.data.faultTypes[booking.data.faultIndex], appointment.faultType)
  assert.equal(booking.data.deviceTypes[booking.data.deviceIndex], appointment.deviceType)
  assert.equal(booking.data.appointmentDate, appointment.appointmentDate)
  assert.deepEqual(booking.data.formData, { name: appointment.name, phone: appointment.phone, location: appointment.location, description: appointment.description })
  assert.equal(f.calls.submissions, 0)
})

test('invalid service parameters cannot create routes or change draft fault', () => {
  const f = fixture({ draft: { faultIndex: 2 } })
  const home = f.page('pages/index/index.js')
  for (const service of ['__proto__', 'constructor', 'toString', 'system&submit=true', '', null, ['system']]) {
    home.goServiceBooking({ currentTarget: { dataset: { service } } })
    const booking = f.page('pages/booking/booking.js')
    booking.onLoad({ service })
    assert.equal(booking.data.faultIndex, 2)
    assert.equal(booking.data.servicePrefilled, false)
  }
  home.goServiceBooking()
  assert.equal(f.calls.routes.length, 0)
})

test('home count failure clears previous count and never presents local demo records', async () => {
  const f = fixture({ getMyAppointments: () => Promise.reject(new Error('offline')) })
  const home = f.page('pages/index/index.js')
  home.setData({ recordCount: 9 })
  const request = home.loadRecordCount()
  assert.equal(home.data.recordCount, null)
  assert.equal(home.data.recordCountLoading, true)
  await request
  assert.equal(home.data.recordCount, null)
  assert.equal(home.data.recordCountLoading, false)
  assert.equal(home.data.recordCountError, true)
  assert.equal(f.calls.localReads, 0)
  home.goRecords()
  assert.equal(f.calls.routes.at(-1), '/pages/records/records')
})

test('home count retry uses backend data and clears error', async () => {
  const f = fixture({ getMyAppointments: () => Promise.reject(new Error('offline')) })
  const home = f.page('pages/index/index.js')
  await home.loadRecordCount()
  f.api.getMyAppointments = () => Promise.resolve({ list: [{ id: 'one' }, { id: 'two' }] })
  await home.loadRecordCount()
  assert.equal(home.data.recordCount, 2)
  assert.equal(home.data.recordCountError, false)
  assert.equal(home.data.recordCountLoading, false)
})

test('missing identity and malformed backend response show unavailable count', async () => {
  const f = fixture({ getMyAppointments: () => Promise.resolve({ ok: true }) })
  const home = f.page('pages/index/index.js')
  await home.loadRecordCount()
  assert.equal(home.data.recordCountError, true)
  f.app.globalData.openid = ''
  await home.loadRecordCount()
  assert.equal(home.data.recordCount, null)
  assert.equal(home.data.recordCountLoading, false)
  assert.equal(f.calls.localReads, 0)
})

test('older request cannot overwrite latest backend count or switched account', async () => {
  let finishFirst
  const f = fixture({ getMyAppointments: () => new Promise(resolve => { finishFirst = resolve }) })
  const home = f.page('pages/index/index.js')
  const first = home.loadRecordCount()
  f.api.getMyAppointments = () => Promise.resolve({ list: [{ id: 'new' }] })
  await home.loadRecordCount()
  finishFirst({ list: [] })
  await first
  assert.equal(home.data.recordCount, 1)
  let finishPreviousAccount
  f.api.getMyAppointments = () => new Promise(resolve => { finishPreviousAccount = resolve })
  const previousAccount = home.loadRecordCount()
  f.app.globalData.openid = 'different-student'
  finishPreviousAccount({ list: [{ id: 'private-old' }] })
  await previousAccount
  assert.equal(home.data.recordCount, null)
})

test('home keeps booking, consultation and records while club entry belongs to personal center', () => {
  const f = fixture()
  const home = f.page('pages/index/index.js')
  home.goBooking(); home.goConsult(); home.goRecords()
  assert.deepEqual(f.calls.routes, ['/pages/booking/booking', '/pages/consult/consult', '/pages/records/records'])
  assert.deepEqual(f.calls.tabs, [])
})

test('service cards are native accessible buttons with bound action and press feedback', () => {
  const markup = fs.readFileSync(path.join(root, 'pages/index/index.wxml'), 'utf8')
  assert.match(markup, /<button\b[^>]*class="service-card"[^>]*data-service="\{\{item.id\}\}"[^>]*bindtap="goServiceBooking"[^>]*hover-class="service-card-pressed"[^>]*aria-label=/)
  assert.match(markup, /预约此服务/)
  assert.match(markup, /bindtap="loadRecordCount"/)
  assert.doesNotMatch(markup, /本机预约|演示后台/)
})
