// Read positions stay on this device and are isolated by account/conversation side.
var memory = Object.create(null)
var environment = 'unknown'
try { environment = wx.getAccountInfoSync().miniProgram.envVersion || environment } catch (_) {}
function key(openid, id, role) { return 'campus_chat_read_v1:' + environment + ':' + encodeURIComponent(openid || '') + ':' + (role === 'admin' ? 'admin' : 'user') + ':' + encodeURIComponent(id || '') }
function decimal(value) { var s = String(value || ''); return /^\d+$/.test(s) ? s.replace(/^0+(?=\d)/, '') : null }
function later(a, b) { return a.length > b.length || (a.length === b.length && a > b) }
function state(k) {
  if (memory[k]) return memory[k]
  var saved
  try { saved = wx.getStorageSync(k) } catch (_) {}
  return memory[k] = saved && typeof saved === 'object' ? { last: decimal(saved.last) || '0', seen: Array.isArray(saved.seen) ? saved.seen : [] } : { last: '0', seen: [] }
}
function incoming(role, message, openid) {
  if (!message) return false
  if (message.kind === 'assignment_notice') return true
  if (message.senderOpenid) return message.senderOpenid !== openid
  return (message.from || message.from_role) === (role === 'admin' ? 'user' : 'admin')
}
function markRead(openid, appointmentId, viewerRole, messages) {
  if (!openid || !appointmentId) return
  var k = key(openid, appointmentId, viewerRole), value = state(k)
  ;(messages || []).forEach(function (m) {
    if (!incoming(viewerRole, m, openid) || !m.id) return
    var id = String(m.id), number = decimal(id)
    if (number) { if (later(number, value.last)) value.last = number }
    else if (value.seen.indexOf(id) === -1) value.seen.push(id)
  })
  try { wx.setStorageSync(k, { last: value.last, seen: value.seen.slice() }) } catch (_) {}
}
function countUnread(openid, appointmentId, viewerRole, messages) {
  if (!openid || !appointmentId) return 0
  var value = state(key(openid, appointmentId, viewerRole)), ids = Object.create(null), count = 0
  ;(messages || []).forEach(function (m) {
    if (!incoming(viewerRole, m, openid) || !m.id) return
    var id = String(m.id), number = decimal(id)
    if (ids[id]) return
    ids[id] = true
    if (number ? later(number, value.last) : value.seen.indexOf(id) === -1) count++
  })
  return count
}
function overview(openid, api) {
  return api.getMyAppointments(openid).then(function (response) {
    if (!response || !Array.isArray(response.list)) throw new Error('预约列表无法读取')
    var items = response.list, counts = {}, next = 0
    function worker() {
      if (next >= items.length) return Promise.resolve()
      var item = items[next++]
      return api.getMessages(item.id).then(function (r) {
        if (!r || !Array.isArray(r.list)) throw new Error('消息无法读取')
        counts[item.id] = countUnread(openid, item.id, 'user', r.list)
        return worker()
      })
    }
    return Promise.all([worker(), worker(), worker()]).then(function () {
      return { items: items, counts: counts, total: Object.keys(counts).reduce(function (sum, id) { return sum + counts[id] }, 0) }
    })
  })
}
module.exports = { markRead: markRead, countUnread: countUnread, overview: overview }
