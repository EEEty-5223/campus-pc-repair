// Both the conversation and workstation previews use WeChat-managed local HTTP images.
function hydrate(rows) {
  var portal = require('./portal-api'), viewer = portal.identity()
  return Promise.all(rows.map(function (message) {
    var value = Object.assign({}, message, { senderAvatarUrl: '/images/my_avatar.png', imageDisplayUrl: '', imageFailed: false })
    var avatar = message.kind === 'assignment_notice' || !message.senderAvatar ? Promise.resolve() : portal.image(message.senderAvatar).then(function (url) { value.senderAvatarUrl = url }, function () {})
    var picture = message.type !== 'image' ? Promise.resolve() : portal.image(message.imageUrl).then(function (url) {
      value.imageDisplayUrl = url; value.imageFailed = !url
    }, function () { value.imageFailed = true })
    return Promise.all([avatar, picture]).then(function () { return value })
  })).then(function (values) { if (viewer !== portal.identity()) throw new Error('账号已变化，请重新打开聊天'); return values })
}
function forget(url) { require('./portal-api').forgetAvatar(url) }
module.exports = { hydrate: hydrate, forget: forget }
