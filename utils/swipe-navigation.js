// 只识别明确的单指横滑，不拦截原生纵向滚动和控件触摸。
function start(page, event) {
  var touches = event.touches || []
  if (touches.length !== 1) { page._navigationSwipe = { cancelled: true }; return }
  var previous = page._navigationSwipe
  // 子区域先收到冒泡事件，父区域不得覆盖它的手势归属。
  if (previous && previous.stamp === event.timeStamp) return
  var point = touches[0]
  page._navigationSwipe = {
    stamp: event.timeStamp, began: Date.now(), id: point.identifier,
    x: point.clientX, y: point.clientY, axis: '',
    scope: (event.currentTarget.dataset || {}).swipeScope || 'page'
  }
}
function move(page, event) {
  var state = page._navigationSwipe, points = event.touches || []
  if (!state || state.cancelled) return
  if (points.length !== 1 || points[0].identifier !== state.id) { state.cancelled = true; return }
  var dx = Math.abs(points[0].clientX - state.x), dy = Math.abs(points[0].clientY - state.y)
  if (!state.axis) {
    if (dy >= 12 && dy >= dx) state.axis = 'vertical'
    else if (dx >= 16 && dx >= dy * 1.6) state.axis = 'horizontal'
  }
}
function cancel(page) { page._navigationSwipe = null }
function end(page, event) {
  var state = page._navigationSwipe
  cancel(page)
  var points = event.changedTouches || []
  if (!state || state.cancelled || state.scope === 'ignore' || state.axis === 'vertical' || points.length !== 1 || Date.now() - state.began > 1000) return null
  var point = points[0], dx = point.clientX - state.x, dy = Math.abs(point.clientY - state.y)
  if (point.identifier !== state.id || Math.abs(dx) < 60 || Math.abs(dx) < dy * 1.6) return null
  return { scope: state.scope, direction: dx < 0 ? 'left' : 'right' }
}
function adjacent(values, current, direction) {
  var index = values.indexOf(current)
  if (index < 0 || ['left', 'right'].indexOf(direction) < 0) return null
  return values[index + (direction === 'left' ? 1 : -1)] || null
}
function adminTabs(role) {
  if (role === 'admin') return ['appointments', 'invite', 'apply', 'members']
  if (role === 'leader') return ['appointments', 'invite', 'members']
  if (role === 'member') return ['appointments', 'members']
  return []
}
function switchMainTab(page, url) {
  if (page._navigationTabBusy) return
  page._navigationTabBusy = true
  wx.switchTab({ url: url, complete: function () { page._navigationTabBusy = false } })
}
module.exports = { start: start, move: move, end: end, cancel: cancel, adjacent: adjacent, adminTabs: adminTabs, switchMainTab: switchMainTab }
