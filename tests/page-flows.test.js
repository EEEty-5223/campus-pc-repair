'use strict'
// The former synchronous demo-storage flow no longer described the signed backend app.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path')
const root=path.resolve(__dirname,'..'),config=JSON.parse(fs.readFileSync(path.join(root,'app.json'),'utf8'))
test('all declared native pages have all four source files',()=>{
  for(const page of config.pages)for(const ext of ['js','json','wxml','wxss'])assert(fs.existsSync(path.join(root,page+'.'+ext)),page+'.'+ext)
})
test('three tabs are home guide and personal center, with distinct valid PNG icons',()=>{
  assert.deepEqual(config.tabBar.list.map(x=>x.text),['首页','指南','我的'])
  for(const tab of config.tabBar.list)for(const icon of [tab.iconPath,tab.selectedIconPath])assert.equal(fs.readFileSync(path.join(root,icon)).subarray(1,4).toString(),'PNG')
  assert.notEqual(config.tabBar.list[2].iconPath,'./images/book.png')
})
test('booking and home open records as a regular page and personal center has no logout',()=>{
  for(const file of ['pages/booking/booking.js','pages/index/index.js']){
    const source=fs.readFileSync(path.join(root,file),'utf8')
    assert(!/wx\.switchTab\(\{\s*url:\s*['"]\/pages\/records/.test(source))
  }
  assert(!/退出登录/.test(fs.readFileSync(path.join(root,'pages/my/my.wxml'),'utf8')))
})
