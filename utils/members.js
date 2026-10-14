var ROLE_LABELS = { admin: '管理员', leader: '负责人', member: '成员' }
var FIELDS = [{ key: 'name', label: '姓名', max: 32 }, { key: 'nickname', label: '昵称', max: 32 }, { key: 'contact', label: '联系方式', max: 64 }, { key: 'department', label: '部门', max: 32 }, { key: 'displayTag', label: '展示标签', max: 50 }]
function sortMembers(list, selfOpenid) {
  // 角色和拼音/英文排序统一由服务器执行，客户端保持其顺序。
  return list.filter(function (m) { return m.openid === selfOpenid }).concat(list.filter(function (m) { return m.openid !== selfOpenid }))
}
function tables(list) {
  var departments = ['技术部', '运营部', '宣传部']
  list.forEach(function (m) { if (m.department && departments.indexOf(m.department) === -1) departments.push(m.department) })
  return [{ value: 'all', label: '总成员表', count: list.length }].concat(departments.concat(['']).map(function (department) {
    return { value: 'department:' + department, label: department || '未分配', count: list.filter(function (m) { return (m.department || '') === department }).length }
  }))
}
function draft(profile) {
  var value = {}
  FIELDS.forEach(function (field) { value[field.key] = profile[field.key] || '' })
  return value
}
function changes(request) {
  return Object.keys(request.proposed || {}).filter(function (key) { return FIELDS.some(function (field) { return field.key === key }) }).map(function (key) {
    var field = FIELDS.find(function (item) { return item.key === key })
    return { key: key, label: field.label, before: (request.base || {})[key] || '未填写', after: request.proposed[key] || '清空' }
  })
}
module.exports = { ROLE_LABELS: ROLE_LABELS, FIELDS: FIELDS, sortMembers: sortMembers, tables: tables, draft: draft, changes: changes }
