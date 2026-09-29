var appointments = require('../../utils/appointments')
var api = require('../../utils/api-request.js')
var USE_BACKEND = true   // 切换:走后端 API / 本地存储
var DRAFT_KEY = 'campus…t_v1'

function formatDate(date) {
  var month = String(date.getMonth() + 1).padStart(2, '0')
  var day = String(date.getDate()).padStart(2, '0')
  return date.getFullYear() + '-' + month + '-' + day
}

function saveDraftToStorage(draft) {
  try { wx.setStorageSync(DRAFT_KEY, draft) } catch (e) {}
}
function readDraftFromStorage() {
  try {
    var v = wx.getStorageSync(DRAFT_KEY)
    return v ? v : null
  } catch (e) { return null }
}
function clearDraftFromStorage() {
  try { wx.removeStorageSync(DRAFT_KEY) } catch (e) {}
}
function pickDefaultDateTime(slots) {
  var now = new Date()
  var hour = now.getHours()
  var lastEnd = parseInt(slots[slots.length - 1].split('-')[1].split(':')[0]) // 21
  // 今天太晚：超过最后时段结束时间 → 跳明天最早时段
  if (hour >= lastEnd) {
    var tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
    return { date: formatDate(tomorrow), timeIndex: 0 }
  }

  // 今天接下来的第一个可用时段（过早时自然落到第 0 个）
  for (var i = 0; i < slots.length; i++) {
    var endHour = parseInt(slots[i].split('-')[1].split(':')[0])
    if (endHour > hour) {
      return { date: formatDate(now), timeIndex: i }
    }
  }

  return { date: formatDate(now), timeIndex: 0 }
}

Page({
  data: {
    deviceTypes: ['笔记本电脑', '台式电脑', '其他设备'],
    deviceIndex: 0,
    faultTypes: ['系统与软件', '无法开机', '卡顿或蓝屏', '清灰与保养', '网络问题', '硬件或外设', '其他问题'],
    faultIndex: 0,
    timeSlots: ['09:00-11:00','11:00-13:00', '14:00-16:00', '16:00-18:00', '18:00-20:00'],
    timeIndex: 1,
    minDate: '',
    appointmentDate: '',
    editId: '',
    isEditing: false,
    formData: {
      name: '',
      phone: '',
      location: '',
      description: ''
    },
    submitting: false,
    dirty: false//查询是否保存过

  },
  onFormInput: function (event) {
    var field = event.currentTarget.dataset.field
    var formData = Object.assign({}, this.data.formData)
    formData[field] = event.detail.value
    this.setData({ formData: formData })
    this.markDirty()
  },
  
  saveDraft: function () {
    var draft = {
      formData: this.data.formData,
      deviceIndex: this.data.deviceIndex,
      faultIndex: this.data.faultIndex,
      timeIndex: this.data.timeIndex,
      appointmentDate: this.data.appointmentDate
    }
    saveDraftToStorage(draft)//弹保存草稿
    this.setData({ dirty: false })                       
    if (wx.disableAlertBeforeUnload) {
      wx.disableAlertBeforeUnload()                      
    }
    wx.showToast({ title: '草稿已保存', icon: 'success' })
  },
  
  loadDraft: function () {
    var draft = readDraftFromStorage()
    if (!draft) { return }
    this.setData({
      formData: draft.formData || this.data.formData,
      deviceIndex: typeof draft.deviceIndex === 'number' ? draft.deviceIndex : this.data.deviceIndex,
      faultIndex: typeof draft.faultIndex === 'number' ? draft.faultIndex : this.data.faultIndex,
      timeIndex: typeof draft.timeIndex === 'number' ? draft.timeIndex : this.data.timeIndex,
      appointmentDate: draft.appointmentDate || this.data.appointmentDate
    })
    wx.showToast({ title: '已载入草稿', icon: 'none' })
  },
  
  onLoad: function (options) {
    var today = new Date()
    var defaultDT = pickDefaultDateTime(this.data.timeSlots)
    this.setData({
      minDate: formatDate(today),
      appointmentDate: defaultDT.date,
      timeIndex: defaultDT.timeIndex
    })
    if (options && options.id) {
      this.loadForEdit(options.id)
    } else {
      this.loadDraft()      // ← 新增:打开就尝试载入草稿
    }
  },  

  loadForEdit: function (id) {
    var self = this
    var applyEdit = function (item) {
      if (!item || !item.canEdit) {
        wx.showModal({
          title: '无法修改',
          content: '只有待确认的预约可以修改。',
          showCancel: false,
          success: function () {
            wx.navigateBack()
          }
        })
        return
      }

      var deviceIndex = self.data.deviceTypes.indexOf(item.deviceType)
      var faultIndex = self.data.faultTypes.indexOf(item.faultType)
      var timeIndex = self.data.timeSlots.indexOf(item.timeSlot)
      wx.setNavigationBarTitle({ title: '修改预约' })
      self.setData({
        editId: id,
        isEditing: true,
        deviceIndex: deviceIndex >= 0 ? deviceIndex : 0,
        faultIndex: faultIndex >= 0 ? faultIndex : 0,
        timeIndex: timeIndex >= 0 ? timeIndex : 0,
        appointmentDate: item.appointmentDate,
        formData: {
          name: item.name,
          phone: item.phone,
          location: item.location,
          description: item.description
        }
      })
    }

    if (USE_BACKEND) {
      var app = getApp()
      var openid = (app && app.globalData && app.globalData.openid) || ''
      api.getMyAppointments(openid)
        .then(function (resp) {
          var list = (resp && resp.list) || []
          var found = list.find(function (x) { return x.id === id }) || null
          if (!found) {
            // 可能是管理员视角
            return api.getAdminAppointments().then(function (resp2) {
              var all = (resp2 && resp2.list) || []
              return all.find(function (x) { return x.id === id }) || null
            })
          }
          return found
        })
        .then(function (item) {
          applyEdit(item ? appointments.decorate(item) : null)
        })
        .catch(function (err) {
          console.error('[booking] 载入修改失败:', err.message)
          applyEdit(appointments.getById(id))
        })
      return
    }
    applyEdit(appointments.getById(id))
  },

  onDeviceChange: function (event) {
    this.setData({ deviceIndex: Number(event.detail.value) })
    this.markDirty()
  },

  onFaultChange: function (event) {
    this.setData({ faultIndex: Number(event.detail.value) })
    this.markDirty()
  },

  onDateChange: function (event) {
    var picked = event.detail.value
    if (picked < this.data.minDate) {
      wx.showToast({ title: '请选择今天及之后的日期', icon: 'none' })
      return
    }
    this.setData({ appointmentDate: picked })
    this.markDirty()
  },

  markDirty: function () {
    if (this.data.dirty) {
      return
    }
    this.setData({ dirty: true })
    if (wx.enableAlertBeforeUnload) {
      wx.enableAlertBeforeUnload({
        message: '您填写的内容尚未保存，确定要离开吗？'
      })
    }
  },
  
  onTimeChange: function (event) {
    this.setData({ timeIndex: Number(event.detail.value) })
    this.markDirty()
  },

  goPrivacy: function () {
    if (!this.data.dirty) {
      wx.navigateTo({ url: '/pages/privacy/privacy' })
      return
    }
    var that = this
    wx.showModal({
      title: '内容未保存',
      content: '是否保存当前填写的内容？',
      cancelText: '不保存',
      confirmText: '保存草稿',
      success: function (res) {
        if (res.confirm) {
          that.saveDraft()
        }
        that.setData({ dirty: false })
        if (wx.disableAlertBeforeUnload) {
          wx.disableAlertBeforeUnload()
        }
        wx.navigateTo({ url: '/pages/privacy/privacy' })
      }
    })
  },

  submitBooking: function (event) {
    if (this.data.submitting) {
      return
    }

    var values = event.detail.value
    var name = String(values.name || '').trim()
    var phone = String(values.phone || '').trim()
    var location = String(values.location || '').trim()
    var description = String(values.description || '').trim()
    var agreed = Array.isArray(values.agreement) && values.agreement.indexOf('agreed') !== -1

    if (!name) {
      return this.showError('请填写联系人姓名')
    }
    if (!/^1\d{10}$/.test(phone)) {
      return this.showError('请填写正确的 11 位手机号')
    }
    if (!location) {
      return this.showError('请填写校内联系地点')
    }
    if (description.length < 5) {
      return this.showError('请至少用 5 个字描述故障现象')
    }
    if (!agreed) {
      return this.showError('请先阅读并同意信息使用说明')
    }
    if (this.data.appointmentDate < this.data.minDate) {
      return this.showError('请选择今天或之后的日期')
    }    
    var payload = {
      name: name,
      phone: phone,
      location: location,
      deviceType: this.data.deviceTypes[this.data.deviceIndex],
      faultType: this.data.faultTypes[this.data.faultIndex],
      description: description,
      appointmentDate: this.data.appointmentDate,
      timeSlot: this.data.timeSlots[this.data.timeIndex]
    }

    if (appointments.hasActiveDuplicate(
      phone,
      this.data.appointmentDate,
      this.data.timeSlots[this.data.timeIndex],
      this.data.editId
    )) {
      wx.showModal({
        title: '发现相同时段预约',
        content: '这个手机号在所选时段已有一条处理中预约。请确认是否仍要继续提交。（建议询问社团人员再进行提交）',
        confirmText: '仍要提交',
        success: function (result) {
          if (result.confirm) {
            this.saveBooking(payload)
          }
        }.bind(this)
      })
      return
    }

    this.saveBooking(payload)
  },

  saveBooking: function (payload) {
    var self = this
    self.setData({ submitting: true })

    if (USE_BACKEND) {
      // === 走后端 API ===
      var app = getApp()
      var openid = (app && app.globalData && app.globalData.openid) || ''

      // 把 payload + openid 一起发给后端
      var remotePayload = {
        userOpenid: openid,
        name: payload.name,
        phone: payload.phone,
        location: payload.location,
        deviceType: payload.deviceType,
        faultType: payload.faultType,
        description: payload.description,
        date: payload.appointmentDate,
        timeSlot: payload.timeSlot
      }

      var doPromise = self.data.isEditing
        ? api.updateAppointment(self.data.editId, {
            name: payload.name,
            phone: payload.phone,
            location: payload.location,
            deviceType: payload.deviceType,
            faultType: payload.faultType,
            description: payload.description,
            date: payload.appointmentDate,
            timeSlot: payload.timeSlot
          })
        : api.createAppointment(remotePayload)

      doPromise
        .then(function (resp) {
          self.setData({ submitting: false })
          wx.showModal({
            title: self.data.isEditing ? '修改已保存' : '预约已提交',
            content: self.data.isEditing
              ? '预约信息已经更新。'
              : '您的预约已提交,可在"我的预约"中查看进度。社团成员确认后会通过本小程序与您沟通。',
            showCancel: true,
            confirmText: '查看预约',
            cancelText: '留在首页',
            confirmColor: '#2563EB',
            success: function (res) {
              if (!self.data.isEditing) {
                clearDraftFromStorage()
                self.setData({ dirty: false })
                if (wx.disableAlertBeforeUnload) {
                  wx.disableAlertBeforeUnload()
                }
              }
              if (res.confirm) {
                wx.switchTab({ url: '/pages/records/records' })
              } else {
                wx.switchTab({ url: '/pages/index/index' })
              }
            }
          })
        })
        .catch(function (err) {
          self.setData({ submitting: false })
          self.showError('后端保存失败:' + (err.message || err))
        })
      return
    }

    // === 走本地存储(回退路径) ===
    var saved = self.data.isEditing
      ? appointments.update(self.data.editId, payload)
      : appointments.create(payload)

    if (!saved) {
      self.setData({ submitting: false })
      return self.showError('保存失败，预约状态可能已经变化')
    }

    wx.showModal({
      title: self.data.isEditing ? '修改已保存' : '预约已提交',
      content: self.data.isEditing
        ? '预约信息已经更新。'
        : '您的预约已提交,可在"我的预约"中查看进度。社团成员确认后会通过本小程序与您沟通。',
      showCancel: true,
      confirmText: '查看预约',
      cancelText: '留在首页',
      confirmColor: '#2563EB',
      success: function (res) {
        if (!self.data.isEditing) {
          clearDraftFromStorage()
          self.setData({ dirty: false })
          if (wx.disableAlertBeforeUnload) {
            wx.disableAlertBeforeUnload()
          }
        }
        if (res.confirm) {
          wx.switchTab({ url: '/pages/records/records' })
        } else {
          wx.switchTab({ url: '/pages/index/index' })
        }
      },
      complete: function () {
        self.setData({ submitting: false })
      }
    })
  },

  showError: function (message) {
    wx.showToast({
      title: message,
      icon: 'none'
    })
  }
})
