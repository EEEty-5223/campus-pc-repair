// utils/api-request.js
// 后端 API 封装:wx.login() → 发 /api/login → 拿到真实 openid

const BASE_URL = 'https://campusapi.keon5223.xyz'
// 模拟器 fallback 开关:true 时模拟器直接返回假 openid
const SIMULATOR_FALLBACK = true

// 时间戳转显示文本(和 utils/appointments.js 保持一致)
function formatDateTime(timestamp) {
  var date = new Date(timestamp)
  var month = String(date.getMonth() + 1).padStart(2, '0')
  var day = String(date.getDate()).padStart(2, '0')
  var hour = String(date.getHours()).padStart(2, '0')
  var minute = String(date.getMinutes()).padStart(2, '0')
  return date.getFullYear() + '-' + month + '-' + day + ' ' + hour + ':' + minute
}

// 后端蛇形字段 → 前端驼峰字段(预约)
function normalizeAppointment(row) {
  if (!row) return null
  var createdAt = row.created_at ? Date.parse(row.created_at) : Date.now()
  var updatedAt = row.updated_at ? Date.parse(row.updated_at) : createdAt
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    location: row.location,
    deviceType: row.device_type,
    faultType: row.fault_type,
    description: row.description,
    appointmentDate: row.appointment_date,
    timeSlot: row.time_slot,
    status: row.status,
    createdAt: createdAt,
    createdAtText: formatDateTime(createdAt),
    updatedAt: updatedAt
  }
}

// 后端蛇形字段 → 前端驼峰字段(消息)
function normalizeMessage(row) {
  if (!row) return null
  var at = row.created_at ? Date.parse(row.created_at) : Date.now()
  return {
    id: String(row.id),
    from: row.from_role,
    content: row.content,
    at: at,
    atText: formatDateTime(at)
  }
}

// 静默登录
function silentLogin() {
  // 开发者工具(模拟器)环境检测
  var isDevtools = false
  try {
    var sysInfo = wx.getSystemInfoSync()
    isDevtools = sysInfo && sysInfo.platform === 'devtools'
  } catch (e) { isDevtools = false }

  // 模拟器:用固定占位 openid,避免每次重编译 openid 变化导致查不到数据
  if (isDevtools && SIMULATOR_FALLBACK) {
    console.warn('[silentLogin] 开发者工具模式,使用固定占位 openid')
    return Promise.resolve({
      ok: true,
      openid: 'simulator_openid_dev',
      isAdmin: false,
      role: 'user',
      _simulator: true
    })
  }

  return new Promise(function (resolve, reject) {
    wx.login({
      success: function (res) {
        if (!res.code) {
          if (SIMULATOR_FALLBACK) {
            console.warn('[silentLogin] 未拿到 code,使用占位 openid')
            return resolve({
              ok: true,
              openid: 'simulator_openid_dev',
              isAdmin: false,
              role: 'user',
              _simulator: true
            })
          }
          return reject(new Error('wx.login 没拿到 code'))
        }
        wx.request({
          url: BASE_URL + '/api/login',
          method: 'POST',
          data: { code: res.code },
          success: function (r) {
            if (r.data && r.data.ok) {
              resolve(r.data)
            } else {
              reject(new Error((r.data && r.data.error) || '登录失败'))
            }
          },
          fail: function (e) { reject(e) }
        })
      },
      fail: function (e) { reject(e) }
    })
  })
}

// 通用请求
function request(path, method, data) {
  var app = getApp()
  return new Promise(function (resolve, reject) {
    wx.request({
      url: BASE_URL + path,
      method: method || 'GET',
      data: data || {},
      header: {
        'Content-Type': 'application/json',
        'openid': (app && app.globalData && app.globalData.openid) || ''
      },
      success: function (r) {
        if (r.data && r.data.ok !== undefined) {
          if (r.data.ok) {
            resolve(r.data)
          } else {
            reject(new Error(r.data.error || '请求失败'))
          }
        } else {
          resolve(r.data)
        }
      },
      fail: function (e) { reject(e) }
    })
  })
}

module.exports = {
  silentLogin: silentLogin,
  request: request,
  normalizeAppointment: normalizeAppointment,
  normalizeMessage: normalizeMessage,
  createAppointment: function (data) {
    return request('/api/appointments', 'POST', data)
  },
  // 返回的 list 已经是驼峰字段
  getMyAppointments: function (openid) {
    return request('/api/appointments?openid=' + openid, 'GET').then(function (resp) {
      var list = (resp && resp.list) || []
      resp.list = list.map(normalizeAppointment)
      return resp
    })
  },
  // 返回的 list 已经是驼峰字段
  getAdminAppointments: function () {
    return request('/api/admin/appointments', 'GET').then(function (resp) {
      var list = (resp && resp.list) || []
      resp.list = list.map(normalizeAppointment)
      return resp
    })
  },
  updateStatus: function (id, status) {
    return request('/api/appointments/status', 'POST', { id: id, status: status })
  },
  // 修改预约内容(仅待确认可改)
  updateAppointment: function (id, data) {
    return request('/api/appointments/update', 'POST', Object.assign({ id: id }, data))
  },
  // 返回的 list 已经是驼峰字段
  getMessages: function (id) {
    return request('/api/messages?appointmentId=' + id, 'GET').then(function (resp) {
      var list = (resp && resp.list) || []
      resp.list = list.map(normalizeMessage)
      return resp
    })
  },
  sendMessage: function (id, role, content) {
    var app = getApp()
    return request('/api/messages', 'POST', {
      appointmentId: id,
      role: role,
      openid: (app && app.globalData && app.globalData.openid) || '',
      content: content
    })
  }
}
