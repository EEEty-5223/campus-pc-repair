var STORAGE_KEY = 'campus_pc_repair_appointments_v1'

var STATUS_LABELS = {
  pending: '预约中',
  accepted: '预约成功',
  repairing: '维修中',
  completed: '已完成',
  cancelled: '已取消'
}

var ALLOWED_TRANSITIONS = {
  pending: ['accepted', 'cancelled'],
  accepted: ['repairing', 'cancelled'],
  repairing: ['completed', 'cancelled'],
  completed: [],
  cancelled: []
}

var EDITABLE_FIELDS = [
  'name',
  'phone',
  'location',
  'deviceType',
  'faultType',
  'description',
  'appointmentDate',
  'timeSlot'
]

function readAll() {
  try {
    var value = wx.getStorageSync(STORAGE_KEY)
    return Array.isArray(value) ? value : []
  } catch (error) {
    return []
  }
}

function writeAll(items) {
  wx.setStorageSync(STORAGE_KEY, items)
}

function decorate(item) {
  var copy = Object.assign({}, item)
  copy.statusText = STATUS_LABELS[copy.status] || '未知状态'
  copy.statusClass = 'status-' + copy.status
  copy.canEdit = copy.status === 'pending'
  copy.canCancel = copy.status === 'pending'
  copy.messages = normalizeMessages(copy).map(function (msg) {
    var isAdmin = msg.from === 'admin'
    return Object.assign({}, msg, {
      isAdmin: isAdmin,
      fromText: isAdmin ? '社团' : '我',
      fromClass: isAdmin ? 'msg-from-admin' : 'msg-from-user'
    })
  })
  copy.hasReply = copy.messages.some(function (msg) { return msg.isAdmin })
  copy.hasMessages = copy.messages.length > 0
  copy.latestMessage = copy.messages.length
    ? copy.messages[copy.messages.length - 1]
    : null
  copy.canReply = copy.status !== 'cancelled' && copy.status !== 'completed'
  copy.history = getHistory(copy).map(function (entry) {
    return Object.assign({}, entry, {
      statusText: STATUS_LABELS[entry.status] || '未知状态',
      statusClass: 'status-' + entry.status
    })
  }).reverse()
  return copy
}

function normalizeMessages(item) {
  if (Array.isArray(item.messages) && item.messages.length) {
    return item.messages.slice()
  }

  // 兼容旧数据：单条 reply 转成一条社团消息
  if (item.reply && item.reply.content) {
    var at = item.reply.at || item.updatedAt || item.createdAt
    return [{
      id: 'MSGLEGACY',
      from: 'admin',
      content: item.reply.content,
      at: at,
      atText: item.reply.atText || formatDateTime(at)
    }]
  }

  return []
}

function getHistory(item) {
  if (Array.isArray(item.history) && item.history.length) {
    return item.history.slice()
  }

  return [{
    status: item.status || 'pending',
    at: item.updatedAt || item.createdAt,
    atText: formatDateTime(item.updatedAt || item.createdAt),
    note: item.status === 'pending' ? '用户提交预约' : '历史记录'
  }]
}

function list() {
  return readAll()
    .slice()
    .sort(function (a, b) {
      return b.createdAt - a.createdAt
    })
    .map(decorate)
}

function getById(id) {
  var item = readAll().find(function (current) {
    return current.id === id
  })
  return item ? decorate(item) : null
}

function create(payload) {
  var now = Date.now()
  var item = Object.assign({}, payload, {
    id: createId(now),
    status: 'pending',
    createdAt: now,
    createdAtText: formatDateTime(now),
    updatedAt: now,
    history: [{
      status: 'pending',
      at: now,
      atText: formatDateTime(now),
      note: '用户提交预约'
    }]
  })
  var items = readAll()
  items.unshift(item)
  writeAll(items)
  return decorate(item)
}

function createId(timestamp) {
  var random = String(Math.floor(Math.random() * 1000)).padStart(3, '0')
  return 'WX' + timestamp.toString().slice(-9) + random
}

function hasActiveDuplicate(phone, appointmentDate, timeSlot, excludeId) {
  var activeStatuses = ['pending', 'accepted', 'repairing']
  return readAll().some(function (item) {
    return item.id !== excludeId &&
      item.phone === phone &&
      item.appointmentDate === appointmentDate &&
      item.timeSlot === timeSlot &&
      activeStatuses.indexOf(item.status) !== -1
  })
}

function seedDemoData() {
  if (readAll().length) {
    return false
  }

  var now = Date.now()
  var tomorrow = new Date(now + 24 * 60 * 60 * 1000)
  var dateText = tomorrow.getFullYear() + '-' +
    String(tomorrow.getMonth() + 1).padStart(2, '0') + '-' +
    String(tomorrow.getDate()).padStart(2, '0')
  var samples = [
    {
      name: '张三',
      phone: '13888888881',
      location: '15教666',
      deviceType: '笔记本电脑',
      faultType: '卡顿或蓝屏',
      description: '开机后使用一段时间出现蓝屏，已备份重要文件。',
      appointmentDate: dateText,
      timeSlot: '14:00-16:00',
      status: 'pending',
      age: 20 * 60 * 1000,
      statuses: ['pending']
    },
    {
      name: '演示同学 B',
      phone: '13800000002',
      location: '图书馆服务台',
      deviceType: '台式电脑',
      faultType: '无法开机',
      description: '按下电源键后风扇转一下就停止。',
      appointmentDate: dateText,
      timeSlot: '16:00-18:00',
      status: 'repairing',
      age: 3 * 60 * 60 * 1000,
      statuses: ['pending', 'accepted', 'repairing'],
      messages: [
        { from: 'user', content: '请问大概几点上门？我下午都有课。', after: 2 * 60 * 60 * 1000 },
        { from: 'admin', content: '已确认你的预约，预计明天下午上门。请提前备份重要文件。', after: 2 * 60 * 60 * 1000 + 15 * 60 * 1000 }
      ]
    },
    {
      name: '演示同学 C',
      phone: '13800000003',
      location: '社团活动室',
      deviceType: '笔记本电脑',
      faultType: '清灰与保养',
      description: '风扇噪声较大，希望进行除尘和基础检查。',
      appointmentDate: dateText,
      timeSlot: '09:00-11:00',
      status: 'completed',
      age: 24 * 60 * 60 * 1000,
      statuses: ['pending', 'accepted', 'repairing', 'completed'],
      messages: [
        { from: 'user', content: '电脑风扇声很大，能帮忙清灰吗？', after: 23 * 60 * 60 * 1000 },
        { from: 'admin', content: '可以，明天上午帮你处理。', after: 22 * 60 * 60 * 1000 },
        { from: 'admin', content: '电脑已清理风扇并更换硅脂，运行温度恢复正常，可随时取回。', after: 20 * 60 * 60 * 1000 }
      ]
    }
  ]

  var items = samples.map(function (sample, sampleIndex) {
    var createdAt = now - sample.age
    var history = sample.statuses.map(function (status, statusIndex) {
      var at = createdAt + statusIndex * 30 * 60 * 1000
      return {
        status: status,
        at: at,
        atText: formatDateTime(at),
        note: statusIndex === 0
          ? '用户提交预约'
          : '状态更新为「' + (STATUS_LABELS[status] || status) + '」'
      }
    })
    var lastAt = history[history.length - 1].at
    var messages = (sample.messages || []).map(function (msg, msgIndex) {
      var at = now - msg.after
      return {
        id: 'MSGDEMO' + sampleIndex + '_' + msgIndex,
        from: msg.from,
        content: msg.content,
        at: at,
        atText: formatDateTime(at)
      }
    })
    return {
      id: 'WXDEMO' + String(sampleIndex + 1).padStart(2, '0'),
      name: sample.name,
      phone: sample.phone,
      location: sample.location,
      deviceType: sample.deviceType,
      faultType: sample.faultType,
      description: sample.description,
      appointmentDate: sample.appointmentDate,
      timeSlot: sample.timeSlot,
      status: sample.status,
      createdAt: createdAt,
      createdAtText: formatDateTime(createdAt),
      updatedAt: lastAt,
      history: history,
      messages: messages,
      isDemo: true
    }
  })
  writeAll(items)
  return true
}

function update(id, payload) {
  var items = readAll()
  var changed = false
  items = items.map(function (item) {
    if (item.id !== id || item.status !== 'pending') {
      return item
    }

    var next = Object.assign({}, item)
    EDITABLE_FIELDS.forEach(function (field) {
      if (Object.prototype.hasOwnProperty.call(payload, field)) {
        next[field] = payload[field]
      }
    })
    next.updatedAt = Date.now()
    changed = true
    return next
  })

  if (changed) {
    writeAll(items)
  }
  return changed
}

function canTransition(fromStatus, toStatus) {
  var allowed = ALLOWED_TRANSITIONS[fromStatus] || []
  return allowed.indexOf(toStatus) !== -1
}

function updateStatus(id, status) {
  if (!STATUS_LABELS[status]) {
    return false
  }

  var items = readAll()
  var changed = false
  items = items.map(function (item) {
    if (item.id !== id) {
      return item
    }
    if (!canTransition(item.status, status)) {
      return item
    }

    var now = Date.now()
    var history = getHistory(item)
    history.push({
      status: status,
      at: now,
      atText: formatDateTime(now),
      note: status === 'cancelled'
        ? '预约已取消'
        : '状态更新为「' + (STATUS_LABELS[status] || status) + '」'
    })
    changed = true
    return Object.assign({}, item, {
      status: status,
      updatedAt: now,
      history: history
    })
  })

  if (changed) {
    writeAll(items)
  }
  return changed
}

function addMessage(id, from, content) {
  var text = String(content || '').trim()
  if (!text) {
    return false
  }
  var sender = from === 'admin' ? 'admin' : 'user'

  var items = readAll()
  var changed = false
  items = items.map(function (item) {
    if (item.id !== id) {
      return item
    }
    var now = Date.now()
    var messages = normalizeMessages(item)
    var msg = {
      id: createMessageId(now),
      from: sender,
      content: text,
      at: now,
      atText: formatDateTime(now)
    }
    messages.push(msg)

    var next = Object.assign({}, item, {
      messages: messages,
      updatedAt: now
    })
    // 兼容旧 reply 字段：社团消息同步到 reply，供旧逻辑读取
    if (sender === 'admin') {
      next.reply = { content: text, at: now, atText: formatDateTime(now) }
    }
    changed = true
    return next
  })

  if (changed) {
    writeAll(items)
  }
  return changed
}

function createMessageId(timestamp) {
  var random = String(Math.floor(Math.random() * 1000)).padStart(3, '0')
  return 'MSG' + timestamp.toString().slice(-9) + random
}

function replyTo(id, content) {
  return addMessage(id, 'admin', content)
}

function formatDateTime(timestamp) {
  var date = new Date(timestamp)
  var month = String(date.getMonth() + 1).padStart(2, '0')
  var day = String(date.getDate()).padStart(2, '0')
  var hour = String(date.getHours()).padStart(2, '0')
  var minute = String(date.getMinutes()).padStart(2, '0')
  return date.getFullYear() + '-' + month + '-' + day + ' ' + hour + ':' + minute
}

module.exports = {
  STATUS_LABELS: STATUS_LABELS,
  ALLOWED_TRANSITIONS: ALLOWED_TRANSITIONS,
  list: list,
  getById: getById,
  create: create,
  hasActiveDuplicate: hasActiveDuplicate,
  seedDemoData: seedDemoData,
  update: update,
  canTransition: canTransition,
  updateStatus: updateStatus,
  replyTo: replyTo,
  addMessage: addMessage
}
