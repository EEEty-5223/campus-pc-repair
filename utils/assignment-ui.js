var api = require('./api-request')
function actor() { return (getApp() && getApp().globalData) || {} }
function identity() { var u = actor(); return [u.openid || '', u.notificationSession || '', u.role || '', u.department || '', !!u.isSimulator].join(':') }
function allowed(user, member) {
  if (!member || typeof member.openid !== 'string' || !member.openid || !(member.isActive === true || Number(member.status) === 1) || (member.status !== undefined && Number(member.status) !== 1) || ['leader', 'member'].indexOf(member.role) === -1) return false
  return user.role === 'admin' || (user.role === 'leader' && member.role === 'member' && !!user.department && member.department === user.department)
}
function unique(ids) { return ids.filter(function (id, index) { return typeof id === 'string' && id && ids.indexOf(id) === index }) }
function active(page, epoch, who) { return page._assignmentPageVisible && !page._assignmentDisposed && page.data.assignDialogVisible && page._assignmentEpoch === epoch && who === identity() }
function invalidate(page, render) {
  page._assignmentEpoch = (page._assignmentEpoch || 0) + 1
  page._assignmentLoad = (page._assignmentLoad || 0) + 1
  page._assignmentConfirming = false
  if (render) page.setData({ assignDialogVisible: false, assignLoading: false, assignSaving: false, assignConfirming: false })
}
function tables(list) {
  var departments = ['技术部', '运营部', '宣传部']
  list.forEach(function (m) { var dept = m.department || ''; if (departments.indexOf(dept) === -1) departments.push(dept) })
  return [{ value: 'all', label: '全部人员', count: list.length }].concat(departments.map(function (dept) {
    return { value: 'department:' + dept, label: dept || '未分配', count: list.filter(function (m) { return (m.department || '') === dept }).length }
  }))
}
var data = {
  assignDialogVisible: false, assignAppointmentId: '', assignAllMembers: [], assignVisibleMembers: [], assignDepartmentTabs: [], assignDepartmentFilter: 'all',
  assignPrimaryOpenid: '', assignAssistantOpenids: [], assignPrimaryPreview: null, assignAssistantPreviews: [], assignLoading: false, assignLoaded: false,
  assignSaving: false, assignConfirming: false, assignError: ''
}
var methods = {
  showAssign: function (event) {
    var user = actor(), id = String(event.currentTarget.dataset.id || '')
    if (!this._assignmentPageVisible || this._assignmentDisposed) return
    if (this._assignmentSaveLock) { wx.showToast({ title: '上一项分配仍在处理中', icon: 'none' }); return }
    if (['admin', 'leader'].indexOf(user.role) === -1 || !user.openid || !user.notificationSession || user.isSimulator) return
    var item = (this.data.allItems || []).concat(this.data.items || []).find(function (record) { return String(record.id) === id })
    if (!item || ['completed', 'cancelled'].indexOf(item.status) !== -1) return
    invalidate(this, false)
    this._assignmentIdentity = identity()
    var primary = item.assignedOpenid || '', assistants = unique(Array.isArray(item.assistantOpenids) ? item.assistantOpenids : []).filter(function (person) { return person !== primary })
    this._assignmentOriginalNames = {}
    var self = this, ids = (primary ? [primary] : []).concat(assistants), names = item.assignedNames || item.assigneeNames || []
    ids.forEach(function (person, index) { if (typeof names[index] === 'string') self._assignmentOriginalNames[person] = names[index] })
    ;(Array.isArray(item.assignees) ? item.assignees : []).forEach(function (person) { if (person.openid && person.name) self._assignmentOriginalNames[person.openid] = person.name })
    this.setData({ assignDialogVisible: true, assignAppointmentId: id, assignPrimaryOpenid: primary, assignAssistantOpenids: assistants,
      assignAllMembers: [], assignVisibleMembers: [], assignDepartmentTabs: tables([]), assignDepartmentFilter: 'all', assignLoaded: false,
      assignLoading: false, assignSaving: false, assignConfirming: false, assignError: '' })
    this.refreshAssignmentView()
    return this.loadAssignableMembers()
  },
  loadAssignableMembers: function () {
    var self = this, epoch = this._assignmentEpoch, who = identity(), version = (this._assignmentLoad || 0) + 1
    if (!active(this, epoch, who) || this._assignmentIdentity !== who || this.data.assignSaving || this._assignmentConfirming) return Promise.resolve()
    this._assignmentLoad = version
    this.setData({ assignLoading: true, assignError: '' })
    return Promise.resolve().then(function () { return api.getMemberDirectory() }).then(function (response) {
      if (!active(self, epoch, who) || version !== self._assignmentLoad) return
      if (!response || !Array.isArray(response.list)) throw new Error('invalid member list')
      var seen = {}, user = actor()
      var list = response.list.filter(function (person) { if (!allowed(user, person) || seen[person.openid]) return false; seen[person.openid] = true; return true }).map(function (person) {
        return Object.assign({}, person, { displayName: person.name || person.nickname || '未填写姓名', roleText: person.role === 'leader' ? '负责人 leader' : '成员 member' })
      })
      self.setData({ assignAllMembers: list, assignDepartmentTabs: tables(list), assignLoading: false, assignLoaded: true })
      self.refreshAssignmentView()
    }).catch(function () {
      if (active(self, epoch, who) && version === self._assignmentLoad) {
        self.setData({ assignLoading: false, assignLoaded: false, assignError: '人员加载失败，当前选择已保留，请重试。' })
        self.refreshAssignmentView()
      }
    })
  },
  refreshAssignmentView: function () {
    var self = this, selected = this.data.assignAssistantOpenids || [], primary = this.data.assignPrimaryOpenid
    var list = (this.data.assignAllMembers || []).map(function (person) { return Object.assign({}, person, { isPrimary: person.openid === primary, isAssistant: selected.indexOf(person.openid) !== -1,
      primaryDisabled: !person.department, assistantDisabled: person.openid === primary || (selected.indexOf(person.openid) === -1 && selected.length >= 2) }) })
    function preview(id, role) {
      var person = list.find(function (member) { return member.openid === id })
      return person ? { openid: id, name: person.displayName, department: person.department || '未分配', roleText: person.roleText, unavailable: false } :
        { openid: id, name: (self._assignmentOriginalNames || {})[id] || role, department: '', roleText: self.data.assignLoaded ? '已不可选，请替换或移除' : '待核验', unavailable: true }
    }
    var filter = this.data.assignDepartmentFilter
    if (!(this.data.assignDepartmentTabs || []).some(function (tab) { return tab.value === filter })) filter = 'all'
    this.setData({ assignDepartmentFilter: filter, assignVisibleMembers: filter === 'all' ? list : list.filter(function (person) { return 'department:' + (person.department || '') === filter }),
      assignPrimaryPreview: primary ? preview(primary, '原主负责人') : null, assignAssistantPreviews: selected.map(function (id) { return preview(id, '原随行人员') }) })
  },
  selectAssignmentDepartment: function (event) {
    var who = identity()
    if (!active(this, this._assignmentEpoch, who) || this._assignmentIdentity !== who || this.data.assignSaving || this._assignmentConfirming) return
    this.setData({ assignDepartmentFilter: event.currentTarget.dataset.department }); this.refreshAssignmentView()
  },
  selectAssignmentPrimary: function (event) {
    var id = event.currentTarget.dataset.openid, who = identity()
    if (!active(this, this._assignmentEpoch, who) || this._assignmentIdentity !== who || this.data.assignLoading || this.data.assignSaving || this._assignmentConfirming) return
    var member = this.data.assignAllMembers.find(function (person) { return person.openid === id })
    if (!allowed(actor(), member) || !member.department) { wx.showToast({ title: '主负责人须已设置部门', icon: 'none' }); return }
    this.setData({ assignPrimaryOpenid: id, assignAssistantOpenids: this.data.assignAssistantOpenids.filter(function (person) { return person !== id }), assignError: '' }); this.refreshAssignmentView()
  },
  toggleAssignmentAssistant: function (event) {
    var id = event.currentTarget.dataset.openid, who = identity()
    if (!active(this, this._assignmentEpoch, who) || this._assignmentIdentity !== who || this.data.assignLoading || this.data.assignSaving || this._assignmentConfirming) return
    var selected = this.data.assignAssistantOpenids.slice(), index = selected.indexOf(id)
    if (index !== -1) selected.splice(index, 1)
    else {
      var member = this.data.assignAllMembers.find(function (person) { return person.openid === id })
      if (!allowed(actor(), member)) return
      if (this.data.assignPrimaryOpenid === id) { wx.showToast({ title: '主负责人无需重复选择随行', icon: 'none' }); return }
      if (selected.length >= 2) { wx.showToast({ title: '最多选择2名随行人员', icon: 'none' }); return }
      selected.push(id)
    }
    this.setData({ assignAssistantOpenids: selected, assignError: '' }); this.refreshAssignmentView()
  },
  hideAssignDialog: function () { if (!this.data.assignSaving) invalidate(this, true) },
  stopPropagation: function () {},
  confirmAssign: function () {
    var self = this, epoch = this._assignmentEpoch, who = identity()
    if (!active(this, epoch, who) || this._assignmentIdentity !== who || this.data.assignLoading || !this.data.assignLoaded || this.data.assignSaving || this._assignmentConfirming || this._assignmentSaveLock) return
    var primary = this.data.assignAllMembers.find(function (person) { return person.openid === self.data.assignPrimaryOpenid })
    var assistants = this.data.assignAssistantOpenids.slice()
    if (!allowed(actor(), primary) || !primary.department) { this.setData({ assignError: '请选择一名可用且已设置部门的主负责人。' }); return }
    if (assistants.length > 2 || unique(assistants).length !== assistants.length || assistants.indexOf(primary.openid) !== -1 || assistants.some(function (id) { return !self.data.assignAllMembers.some(function (person) { return person.openid === id && allowed(actor(), person) }) })) {
      this.setData({ assignError: '随行人员已不可选或重复，请检查后重新选择。' }); return
    }
    var names = assistants.map(function (id) { return self.data.assignAllMembers.find(function (person) { return person.openid === id }).displayName })
    var appointmentId = this.data.assignAppointmentId
    this._assignmentConfirming = true; this.setData({ assignConfirming: true, assignError: '' })
    wx.showModal({ title: '确认分配', content: '主负责人：' + primary.displayName + '（' + primary.department + '）\n随行人员：' + (names.join('、') || '无'),
      success: function (result) {
        if (!active(self, epoch, who)) return
        self._assignmentConfirming = false; self.setData({ assignConfirming: false })
        if (!result.confirm || self._assignmentSaveLock) return
        self._assignmentSaveLock = true; self.setData({ assignSaving: true })
        Promise.resolve().then(function () {
          if (!active(self, epoch, who)) return null
          return api.assignAppointment(appointmentId, primary.department, primary.openid, assistants)
        }).then(function (response) {
          self._assignmentSaveLock = false
          if (!active(self, epoch, who)) return
          if (!response || response.ok !== true) throw new Error('invalid assignment response')
          invalidate(self, true); wx.showToast({ title: '分配已保存', icon: 'success' })
          return Promise.resolve(self.loadItems()).catch(function () {})
        }).catch(function () {
          self._assignmentSaveLock = false
          if (active(self, epoch, who)) self.setData({ assignSaving: false, assignError: '分配未保存，请重试；所选人员已保留。' })
        })
      }, fail: function () { if (active(self, epoch, who)) { self._assignmentConfirming = false; self.setData({ assignConfirming: false, assignError: '未能打开确认框，请重试。' }) } }
    })
  }
}
function withPage(page) {
  var show = page.onShow, hide = page.onHide, unload = page.onUnload
  page.data = Object.assign({}, data, page.data)
  Object.assign(page, methods)
  page.onShow = function () { this._assignmentPageVisible = true; this._assignmentDisposed = false; return show && show.apply(this, arguments) }
  page.onHide = function () { this._assignmentPageVisible = false; invalidate(this, !this._assignmentDisposed && this.data.assignDialogVisible); return hide && hide.apply(this, arguments) }
  page.onUnload = function () { this._assignmentDisposed = true; this._assignmentPageVisible = false; invalidate(this, false); return unload && unload.apply(this, arguments) }
  return page
}
module.exports = { withPage: withPage, methods: methods, data: data, canAssign: allowed }
