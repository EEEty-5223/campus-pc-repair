const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

function fixture() {
  let page
  const viewport = { height: 720, width: 375 }
  const pending = [], patches = []
  const state = { defer: false }
  const wx = {
    createSelectorQuery() {
      let callback
      return {
        in() { return this },
        select() { return this },
        boundingClientRect(fn) { callback = fn; return this },
        exec() {
          const rect = { ...viewport }
          if (state.defer) pending.push(() => callback(rect))
          else callback(rect)
        }
      }
    }
  }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../pages/chat/chat.js'), 'utf8'), {
    Page: definition => { page = definition },
    require: name => name.includes('direct-staff-subscription') ? ({prepare:()=>Promise.resolve(),hide(){},dispose(){},tap(){}}) : ({}), wx, clearTimeout, setTimeout
  })
  page.data = JSON.parse(JSON.stringify(page.data))
  page.setData = patch => { patches.push(patch); Object.assign(page.data, patch) }
  page.onLoad({ id: 'test-appointment' })
  page._visible = true
  page.onReady()
  const keyboard = height => page.onChatKeyboardHeightChange({ detail: { height } })
  return { page, viewport, pending, patches, state, keyboard }
}

test('overlay keyboard lifts the page, and closing restores the full viewport', () => {
  const f = fixture()
  assert.equal(f.page.data.keyboardInset, 0)
  f.keyboard(310)
  assert.equal(f.page.data.keyboardHeight, 310)
  assert.equal(f.page.data.keyboardInset, 310)
  f.keyboard(0)
  assert.equal(f.page.data.keyboardHeight, 0)
  assert.equal(f.page.data.keyboardInset, 0)
})

test('a client that already resizes the viewport is not lifted a second time', () => {
  const f = fixture()
  f.viewport.height = 410
  f.keyboard(310)
  assert.equal(f.page.data.keyboardHeight, 310)
  assert.equal(f.page.data.keyboardInset, 0)
  // Closing can be reported before the client expands its viewport.
  f.keyboard(0)
  f.viewport.height = 720
  f.page.onResize()
  f.keyboard(280)
  assert.equal(f.page.data.keyboardInset, 280)
})

test('partial and delayed client resizing uses only the remaining keyboard overlap', () => {
  const f = fixture()
  f.viewport.height = 620
  f.keyboard(310)
  assert.equal(f.page.data.keyboardInset, 210)
  f.viewport.height = 410
  f.page.onResize()
  assert.equal(f.page.data.keyboardInset, 0)
})

test('out-of-order viewport measurements cannot reopen a closed keyboard layout', () => {
  const f = fixture()
  f.state.defer = true
  f.keyboard(310)
  f.keyboard(0)
  f.pending[1]()
  f.pending[0]()
  assert.equal(f.page.data.keyboardHeight, 0)
  assert.equal(f.page.data.keyboardInset, 0)
})

test('hiding restores the layout and invalidates pending keyboard measurements', () => {
  const f = fixture()
  f.keyboard(310)
  f.state.defer = true
  f.keyboard(340)
  f.page.onHide()
  const count = f.patches.length
  f.pending[0]()
  f.keyboard(340)
  assert.equal(f.patches.length, count)
  assert.equal(f.page.data.keyboardHeight, 0)
  assert.equal(f.page.data.keyboardInset, 0)
})

test('input grows for multiple lines, remains capped, and resets when cleared', () => {
  const f = fixture()
  f.page.onChatInputLineChange({ detail: { height: 40 } })
  assert.equal(f.page.data.chatInputHeight, 110)
  f.page.onChatInputLineChange({ detail: { height: 300 } })
  assert.equal(f.page.data.chatInputHeight, 150)
  f.page.onChatInput({ detail: { value: '' } })
  assert.equal(f.page.data.chatInputHeight, 72)
  f.page.onChatInputLineChange({ detail: { height: -1 } })
  assert.equal(f.page.data.chatInputHeight, 72)
})
