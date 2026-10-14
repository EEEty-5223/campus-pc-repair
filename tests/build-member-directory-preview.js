const fs = require('fs'), path = require('path')
const root = path.resolve(__dirname, '..')
function css(file, scope) {
  const source = fs.readFileSync(path.join(root, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(-?[\d.]+)rpx/g, (_, n) => `calc(var(--rpx) * ${n})`)
  return source.replace(/([^{}]+)\{([^{}]*)\}/g, (_, selector, body) => selector.split(',').map(s => s.trim() === 'page' ? scope : scope + ' ' + s.trim()).join(',') + '{' + body + '}')
}
const common = css('app.wxss', '.frame'), directoryCss = css('pages/admin/admin.wxss', '.directory-preview'), detailCss = css('pages/member-detail/member-detail.wxss', '.detail-preview')
const rows = [
  ['管理员', 'admin', '胡桃', '技术部', '主板维修', true],
  ['管理员', 'admin', 'Alice', '运营部'], ['管理员', 'admin', '白同学', '宣传部'], ['管理员', 'admin', 'Zoe', '技术部'],
  ['负责人', 'leader', '陈负责人', '技术部'], ['成员', 'member', 'Amy', '宣传部'],
  ['成员', 'member', '白成员', '维修小组'], ['成员', 'member', '李成员', '技术部'],
  ['成员', 'member', '王成员', '运营部'], ['成员', 'member', '未分配成员', '']
]
const row = r => `<div class="directory-row"><div class="directory-name-row"><span class="member-role-pill role-${r[1]}">${r[0]}</span><span class="directory-name">${r[2]}</span>${r[5] ? '<span class="directory-self">我</span>' : ''}<span class="directory-arrow">›</span></div><div class="directory-meta">${r[3] || '未分配'}${r[4] ? ' · ' + r[4] : ''}</div></div>`
function directory(technical) {
  const departments = ['技术部', '运营部', '宣传部', '维修小组', '']
  const tabs = [{ label:'总成员表', count:rows.length }].concat(departments.map(d => ({label:d || '未分配',count:rows.filter(r=>r[3]===d).length})))
  return `<div class="admin-head"><div class="admin-title">社团后台</div><div class="admin-count">成员资料</div></div><div class="card member-summary-card"><div class="member-summary-top"><div class="notification-title">社团成员表</div><button class="member-refresh">刷新</button></div><div class="member-meta">可见成员共 ${rows.length} 人。自己的资料排在所在表的首位。</div><div class="member-meta">点姓名查看详情。成员本人修改需审核，负责人和管理员按权限维护资料。</div><div class="member-meta">管理员 admin · 负责人 leader · 成员 member</div><button class="mini-button detail-button">资料修改审核</button></div><div class="filter-scroll"><div class="filter-row">${tabs.map((t,i)=>`<div class="filter-chip ${i===(technical?1:0)?'filter-chip-active':''}">${t.label} ${t.count}</div>`).join('')}</div></div><div class="card directory-list">${(technical?rows.filter(r=>r[3]==='技术部'):rows).map(row).join('')}</div>`
}
function profile(name, role, self=false) {
  const label = {admin:'管理员',leader:'负责人',member:'成员'}[role]
  return `<div class="card"><div class="detail-title"><span class="role-badge role-${role}">${label}</span><span>${name}</span>${self?'<span class="self-tag">我</span>':''}</div>${[['姓名',name],['昵称','维修同学'],['联系方式','示例联系方式'],['部门','技术部'],['展示标签','主板维修']].map(([k,v])=>`<div class="info-row"><span class="field-label">${k}</span><span class="field-value">${v}</span></div>`).join('')}<div class="readonly-note">角色：${label}（只读）</div><div class="readonly-note">入社标记：永久邀请码（只读）</div></div>`
}
function form(name, role, direct, self, error=false) {
  return `${error?`<div class="card error-note">${direct?'保存':'提交'}未完成，草稿已保留，请重试。</div>`:''}${profile(name,role,self)}<div class="card"><div class="section-heading">${direct?'修改成员资料':'申请修改资料'}</div><div class="readonly-note">${direct?'保存后资料生效，修改记录保存在后台。':'提交后资料保持原样，审核通过后才会更新。'}</div>${[['姓名',name],['昵称','维修同学'],['联系方式','示例联系方式'],['部门','技术部'],['展示标签','主板维修 / 焊接专长']].map(([k,v])=>`<div class="edit-row"><span class="field-label">${k}</span><input class="edit-input" readonly value="${v}"></div>`).join('')}<div class="readonly-note">角色、启用状态及入社标记不能在此修改。</div><div class="action-row"><button class="action-button">${direct?'保存修改':'提交修改申请'}</button><button class="action-button secondary">取消</button></div></div>`
}
const change = '<div class="change-row"><div class="field-label">展示标签</div><div class="before-value">原：主板维修</div><div class="after-value">申请：主板维修 / 焊接专长</div></div>'
const pending = `${profile('李成员','member',true)}<div class="card pending-card"><div class="section-heading">我的修改申请 · 待审核</div><div class="readonly-note">下列内容尚未生效，成员表仍显示原资料。</div>${change}</div><div class="card"><div class="section-heading">我的申请记录</div><div class="history-row">待审核 · 离线示例时间</div></div>`
const review = `${profile('李成员','member')}<div class="card"><div class="review-heading"><div class="section-heading">待审资料申请</div><button class="small-button">刷新</button></div><div class="review-request"><div class="review-name">李成员 · 待审核</div>${change}<div class="action-row"><button class="action-button">通过申请</button><button class="action-button secondary">拒绝</button></div></div></div>`
const panes = [
  ['320 px · 总成员表（胡桃首位）',320,'directory-preview',directory(false)],
  ['375 px · 技术部（胡桃首位）',375,'directory-preview',directory(true)],
  ['375 px · 管理员本人详情与直接保存',375,'detail-preview',form('胡桃','admin',true,true)],
  ['320 px · 管理员修改普通成员详情',320,'detail-preview',form('李成员','member',true,false)],
  ['320 px · 普通成员本人申请修改',320,'detail-preview',form('李成员','member',false,true)],
  ['375 px · 待审期间仍显示原资料',375,'detail-preview',pending],
  ['320 px · 保存失败保留草稿',320,'detail-preview',form('胡桃','admin',true,true,true)],
  ['375 px · 单个成员的资料审核',375,'detail-preview',review]
]
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>成员列表、个人详情与审核 · 离线预览</title><style>${common}${directoryCss}${detailCss}body{font-family:system-ui,'Microsoft YaHei',sans-serif;background:#e2e8f0;margin:0;padding:24px}h1{font-size:20px;margin:0}h2{font-size:14px;color:#475569;font-weight:500}.panes{display:flex;gap:24px;width:max-content}.frame{border-radius:20px;overflow:hidden;box-shadow:0 12px 30px #0f172322;--rpx:.5px}.navbar{height:44px;display:flex;align-items:center;justify-content:center;background:white;font-size:16px;font-weight:600}.frame .page{min-height:1100px}.frame button,.frame input{font-family:inherit;box-sizing:border-box}.frame button{border:none;pointer-events:none;cursor:default}.frame input{outline:0}.frame .filter-scroll{overflow:auto}</style><h1>第三阶段 · 成员分表、个人详情、保存与审核</h1><p>全部为离线示例资料，按钮与输入框无功能；不登录、不联网、不申请权限。每列使用工作版实际 CSS，并按手机宽度换算 rpx。</p><main class="panes">${panes.map(([title,width,type,content])=>`<article style="width:${width}px"><h2>${title}</h2><div class="frame ${type}" style="--rpx:${width/750}px"><div class="navbar">校园电脑维修预约</div><div class="page">${content}</div></div></article>`).join('')}</main></html>`
const output = path.resolve(root, '../../member-directory-preview.html')
fs.writeFileSync(output,html,'utf8')
console.log(output)
