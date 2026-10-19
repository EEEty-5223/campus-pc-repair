var api = require('./api-request')
function valid(doc) {
  return doc && typeof doc.version === 'string' && /^[a-f0-9]{64}$/.test(doc.hash || '') && typeof doc.title === 'string' && Array.isArray(doc.sections) && doc.sections.length > 0 && doc.sections.every(function (s) { return typeof s.title === 'string' && Array.isArray(s.paragraphs) && s.paragraphs.length && s.paragraphs.every(function (p) { return p && typeof p.text === 'string' }) })
}
function load() {
  return api.request('/api/service-documents', 'GET').then(function (r) {
    if (!r || !valid(r.service) || !valid(r.privacy)) throw new Error('说明内容暂时无法读取，请重试')
    return { service: r.service, privacy: r.privacy }
  })
}
function fingerprint(docs) { return docs ? [docs.service.version, docs.service.hash, docs.privacy.version, docs.privacy.hash].join(':') : '' }
function consent(docs) { return { accepted: true, serviceVersion: docs.service.version, privacyVersion: docs.privacy.version, serviceHash: docs.service.hash, privacyHash: docs.privacy.hash } }
function page(key) {
  return {
    data: { document: null, loading: true, error: '' },
    onShow: function () { this._documentVisible = true; this.loadDocument() },
    onHide: function () { this._documentVisible = false; this._documentRequest = (this._documentRequest || 0) + 1 },
    onUnload: function () { this.onHide() },
    loadDocument: function () {
      var self = this, request = this._documentRequest = (this._documentRequest || 0) + 1
      this.setData({ loading: true, error: '' })
      return load().then(function (docs) { if (self._documentVisible && self._documentRequest === request) self.setData({ document: docs[key], loading: false }) }).catch(function (e) { if (self._documentVisible && self._documentRequest === request) self.setData({ document: null, loading: false, error: e.message || '说明暂不可用，请检查网络后重试' }) })
    }
  }
}
module.exports = { load: load, fingerprint: fingerprint, consent: consent, page: page }
