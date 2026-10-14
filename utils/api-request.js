// utils/api-request.js
// 后端 API 封装:wx.login() → 发 /api/login → 拿到真实 openid

// 开发版连接本机局域网；体验版、正式版保持线上服务。
const PRODUCTION_BASE_URL = 'https://campusapi.keon5223.xyz'
const LOCAL_BASE_URL = 'http://10.222.65.216:3000'
// 仅本机开发工具启用独立普通成员，真机和发布版本使用微信登录。
const LOCAL_DEV_MEMBER = true
function useLocalMember() {
  try { return LOCAL_DEV_MEMBER && wx.getAccountInfoSync().miniProgram.envVersion === 'develop' && wx.getSystemInfoSync().platform === 'devtools' } catch (_) { return false }
}
function resolveBaseUrl() {
  try {
    const info = wx.getAccountInfoSync()
    return info && info.miniProgram && info.miniProgram.envVersion === 'develop'
      ? (useLocalMember() ? 'http://127.0.0.1:3000' : LOCAL_BASE_URL) : PRODUCTION_BASE_URL
  } catch (_) { return PRODUCTION_BASE_URL }
}
const BASE_URL = resolveBaseUrl()
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
    assignedDepartment: row.assigned_department,
    assignedOpenid: row.assigned_openid,
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
    type: row.type || 'text',
    content: row.content || '',
    imageUrl: row.image_url || '',
    at: at,
    atText: formatDateTime(at)
  }
}

// 模拟器和手机均通过微信凭证登录；身份与权限由后端返回。
function silentLogin(options) {
  if (useLocalMember()) {
    return new Promise(function (resolve, reject) {
      wx.request({ url: BASE_URL + '/api/local-dev/login', method: 'POST', data: {}, timeout: 10000,
        success: function (r) {
          var d = r && r.data
          if (r.statusCode === 200 && d && d.ok && d._localDevelopment && d.role === 'member' && d.openid === 'local_test_member_xiaotangzhu' && /^localdev_[a-f0-9]{64}$/.test(d.notificationSession || '')) resolve(d)
          else reject(new Error((d && d.error) || '独立测试成员登录失败'))
        }, fail: function () { reject(new Error('无法连接本机测试成员，请启动本地后端')) } })
    })
  }
  return new Promise(function (resolve, reject) {
    wx.login({
      timeout: 10000,
      success: function (res) {
        if (!res || !res.code) {
          return reject(new Error('微信登录未返回凭证，请确认开发者工具已扫码登录后重新编译'))
        }
        wx.request({
          url: BASE_URL + '/api/login',
          method: 'POST',
          timeout: 15000,
          data: { code: res.code },
          success: function (r) {
            var data = r && r.data
            if (r && r.statusCode >= 200 && r.statusCode < 300 && data && data.ok &&
                typeof data.openid === 'string' && data.openid && data.openid !== 'simulator_openid_dev' && !data._simulator) {
              resolve(data)
            } else {
              reject(new Error((data && data.error) || '微信登录失败，请重新登录后重试'))
            }
          },
          fail: function () { reject(new Error('无法连接登录服务，请确认本地后端已启动')) }
        })
      },
      fail: function () { reject(new Error('微信登录失败，请确认开发者工具已扫码登录后重新编译')) }
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
        'Authorization': (app && app.globalData && app.globalData.notificationSession) ? ('Bearer ' + app.globalData.notificationSession) : '',
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
      fail: function (e) {
        reject(e)
      }
    })
  })
}

// 提醒接口单独使用真实微信登录取得的会话；不沿用可由客户端填写的 openid 鉴权。
function notificationRequest(path, method, data, publicConfig, ownProfile, routeOverride) {
  var app = getApp()
  var globalData = (app && app.globalData) || {}
  var session = globalData.notificationSession || ''
  if (!publicConfig && (!session || !globalData.openid || globalData.isSimulator || globalData.openid === 'simulator_openid_dev')) {
    return Promise.reject(Object.assign(new Error('请在微信真机登录后设置提醒'), { code: 'REAL_LOGIN_REQUIRED' }))
  }
  return new Promise(function (resolve, reject) {
    var header = { 'Content-Type': 'application/json' }
    if (!publicConfig) header.Authorization = 'Bearer ' + session
    wx.request({
      url: BASE_URL + (routeOverride || (ownProfile ? '/api/admin/profile/me' : '/api/admin/notifications/' + path)),
      method: method || 'GET',
      data: data || {},
      header: header,
      success: function (response) {
        if (response.statusCode >= 200 && response.statusCode < 300 && response.data && response.data.ok) {
          resolve(response.data)
        } else {
          var error = new Error((response.data && response.data.error) || '提醒服务暂时无法连接')
          error.code = response.data && response.data.code
          error.statusCode = response.statusCode
          reject(error)
        }
      },
      fail: function () { reject(new Error('网络连接失败，请稍后重试')) }
    })
  })
}

module.exports = {
  silentLogin: silentLogin,
  request: request,
  normalizeAppointment: normalizeAppointment,
  normalizeMessage: normalizeMessage,
  getNotificationConfig: function () { return notificationRequest('config', 'GET', {}, true) },
  getNotificationStatus: function () { return notificationRequest('status', 'GET') },
  createNotificationChallenge: function () { return notificationRequest('challenge', 'POST') },
  saveNotificationSubscription: function (data) { return notificationRequest('subscription', 'POST', data) },
  stopNotificationSubscription: function () { return notificationRequest('subscription', 'DELETE') },
  getMemberDirectory: function () { return notificationRequest('', 'GET', {}, false, false, '/api/members') },
  getMemberDetail: function (openid) { return notificationRequest('', 'GET', {}, false, false, '/api/members/' + encodeURIComponent(openid)) },
  updateMemberProfile: function (openid, profile) {
    var patch = {}
    ;['name', 'nickname', 'contact', 'department', 'displayTag', 'requestKey'].forEach(function (field) { if (Object.prototype.hasOwnProperty.call(profile, field)) patch[field] = profile[field] })
    return notificationRequest('', 'PATCH', patch, false, false, '/api/members/' + encodeURIComponent(openid))
  },
  getMyProfileRequests: function () { return notificationRequest('', 'GET', {}, false, false, '/api/member/profile-requests/me') },
  submitProfileRequest: function (data) { return notificationRequest('', 'POST', data, false, false, '/api/member/profile-requests/me') },
  getProfileReviews: function () { return notificationRequest('', 'GET', {}, false, false, '/api/member/profile-requests/review') },
  reviewProfileRequest: function (id, decision, reason) { return notificationRequest('', 'POST', { decision: decision, reason: reason || '' }, false, false, '/api/member/profile-requests/' + encodeURIComponent(id) + '/review') },
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
    return request('/api/appointments/status', 'POST', {
      id: id,
      status: status
    })
  },
  // 修改预约内容(仅待确认可改)
  updateAppointment: function (id, data) {
    return request('/api/appointments/update', 'POST', Object.assign({
      id: id
    }, data))
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
      content: content,
      type: 'text'
    })
  },
  sendImageMessage: function (id, role, imageUrl) {
    var app = getApp()
    return request('/api/messages', 'POST', {
      appointmentId: id,
      role: role,
      openid: (app && app.globalData && app.globalData.openid) || '',
      content: '',
      type: 'image',
      imageUrl: imageUrl
    })
  },
  uploadImage: function (filePath) {
    var app = getApp()
    return new Promise(function (resolve, reject) {
      wx.uploadFile({
        url: BASE_URL + '/api/upload',
        filePath: filePath,
        name: 'file',
        header: {
          'openid': (app && app.globalData && app.globalData.openid) || ''
        },
        success: function (res) {
          var data = {}
          try {
            data = JSON.parse(res.data)
          } catch (e) {
            return reject(new Error('上传返回格式错误'))
          }
          if (data && data.ok) {
            resolve(data.url)
          } else {
            reject(new Error((data && data.error) || '上传失败'))
          }
        },
        fail: function (err) {
          reject(err || new Error('上传失败'))
        }
      })
    })
  },
  // 提交管理员申请
  submitApply: function (inviteCode, name, department, studentId) {
    return request('/api/admin/apply', 'POST', {
      inviteCode: inviteCode,
      name: name,
      department: department,
      studentId: studentId
    })
  },
  // 查看自己的申请状态
  getMyApplyStatus: function () {
    return request('/api/admin/my-application', 'GET')
  },
  // 生成邀请码(super)
  createInviteCode: function () {
    return request('/api/admin/invite-code', 'POST', {})
  },
  // 查看已生成的邀请码列表(super)
  getInviteCodes: function () {
    return request('/api/admin/invite-code', 'GET')
  },
  // 查看所有申请(super)
  getApplications: function () {
    return request('/api/admin/applications', 'GET')
  },
  // 审核:同意或拒绝(super)  action='approve'|'reject'
  reviewApplication: function (id, action, reason) {
    return request('/api/admin/applications/review', 'POST', {
      id: id,
      action: action,
      reason: reason || ''
    })
  },
  // 成员管理
  getMembers: function () {
    return request('/api/admin/whitelist', 'GET')
  },
  // 分配预约
  assignAppointment: function (id, assignedDepartment, assignedOpenid) {
    return request('/api/appointments/assign', 'POST', {
      id: id,
      assignedDepartment: assignedDepartment,
      assignedOpenid: assignedOpenid
    })
  }

}
