var portal = require('./portal-api')
// Shared lifetime guard: stale responses cannot overwrite another account or a hidden page.
module.exports = function (definition) {
  var show = definition.onShow, hide = definition.onHide, unload = definition.onUnload
  definition.onShow = function () {
    var self = this, stamp = this._epoch = (this._epoch || 0) + 1
    this._visible = true
    var viewer = portal.identity()
    if (this._viewer && this._viewer !== viewer && this.clearPrivate) this.clearPrivate()
    this._viewer = viewer
    return Promise.resolve(getApp().globalData.loginReady).then(function () {
      if (!self._visible || stamp !== self._epoch) return
      var currentViewer = portal.identity()
      if (self._viewer && self._viewer !== currentViewer && self.clearPrivate) self.clearPrivate()
      self._viewer = currentViewer
      return show ? show.call(self) : self.load()
    }).catch(function (error) { if (self._visible && stamp === self._epoch) self.setData({ loading: false, error: error.message || '加载失败，请重试' }) })
  }
  definition.onHide = function () { this._visible = false; this._epoch = (this._epoch || 0) + 1; if (hide) hide.call(this) }
  definition.onUnload = function () { this._disposed = true; this.onHide(); if (unload) unload.call(this) }
  definition.guard = function () {
    var self = this, viewer = portal.identity(), epoch = this._epoch, load = this._request = (this._request || 0) + 1
    return function () { return self._visible && !self._disposed && epoch === self._epoch && viewer === portal.identity() && load === self._request }
  }
  definition.onPullDownRefresh = function () { return Promise.resolve(this.load()).then(function () { wx.stopPullDownRefresh() }, function () { wx.stopPullDownRefresh() }) }
  return definition
}
