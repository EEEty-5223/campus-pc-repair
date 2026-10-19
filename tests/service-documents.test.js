'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm')
const root=path.resolve(__dirname,'..'),clone=x=>JSON.parse(JSON.stringify(x)),flush=async()=>{for(let i=0;i<5;i++)await new Promise(r=>setImmediate(r))}
function fixture(options={}) {
  let page
  const document=key=>({key,title:key,version:'first',hash:(key==='service'?'a':'b').repeat(64),sections:[{title:'注意事项',paragraphs:[{text:'提前备份',important:true}]}]})
  const calls={saved:[],toasts:[],modals:[],navigated:[],drafts:[]}, user={openid:'owner',notificationSession:'signed'}
  const docs={service:document('service'),privacy:document('privacy')}
  const api={request:()=>options.load?options.load():Promise.resolve(clone(docs)),createAppointment:async body=>{calls.saved.push(clone(body));if(options.saveError)throw options.saveError;return {ok:true,consentRecorded:options.recorded!==false}},updateAppointment:async(id,body)=>{calls.saved.push({id,...clone(body)});return {ok:true,consentRecorded:true}}}
  const wx={showToast:o=>calls.toasts.push(o.title),showModal:o=>calls.modals.push(o),navigateTo:o=>calls.navigated.push(o.url),enableAlertBeforeUnload(){},disableAlertBeforeUnload(){},getStorageSync(){return null},setStorageSync:(key,value)=>calls.drafts.push(clone(value))}
  const mod={exports:{}};vm.runInNewContext(fs.readFileSync(path.join(root,'utils/service-documents.js'),'utf8'),{module:mod,require:()=>api,Promise})
  vm.runInNewContext(fs.readFileSync(path.join(root,'pages/booking/booking.js'),'utf8'),{Page:p=>page=p,require:n=>n.includes('service-documents')?mod.exports:n.includes('api-request')?api:{hasActiveDuplicate:()=>false},getApp:()=>({globalData:user}),wx,Date,Promise,console})
  page.data=clone(page.data);page.setData=p=>Object.assign(page.data,p);page.onLoad({})
  const submit=()=>page.submitBooking({detail:{value:{name:'预约用户',phone:'13800000000',location:'校园',description:'电脑无法正常启动',agreement:['agreed']}}})
  return {page,docs,calls,user,api,options,submit,agree:()=>page.onAgreementChange({detail:{value:['agreed']}})}
}
test('new and edited bookings require an explicit current checkbox and never restore it from a draft',async()=>{
 const f=fixture();f.page.onShow();await flush();assert.equal(f.page.data.consentAgreed,false);f.submit();assert.equal(f.calls.saved.length,0)
 f.page.setData({isEditing:true});f.submit();assert.equal(f.calls.saved.length,0)
 f.agree();f.page.saveDraft();assert(!Object.hasOwn(f.calls.drafts[0],'consentAgreed'));assert(!Object.hasOwn(f.calls.drafts[0],'consent'))
 f.page.setData({editId:'A1'});f.submit();await flush();assert.equal(f.calls.saved[0].id,'A1');assert.equal(f.calls.saved[0].consent.accepted,true)
})
test('submission carries both displayed document versions and hashes, without a client acceptance time',async()=>{
 const f=fixture();f.page.onShow();await flush();f.agree();f.submit();await flush()
 assert.equal(f.calls.saved.length,1);assert.deepEqual(f.calls.saved[0].consent,{accepted:true,serviceVersion:'first',privacyVersion:'first',serviceHash:'a'.repeat(64),privacyHash:'b'.repeat(64)});assert.equal(f.calls.modals.length,1)
})
test('reading either document preserves form fields and unchanged acceptance; changed documents or account reset it',async()=>{
 const f=fixture();f.page.onShow();await flush();f.agree();f.page.setData({dirty:true,formData:{name:'未保存内容'}})
 f.page.goServiceTerms();f.page.onHide();f.page.onShow();await flush();assert.equal(f.page.data.formData.name,'未保存内容');assert.equal(f.page.data.consentAgreed,true);assert.match(f.calls.navigated[0],/service-terms/)
 f.docs.service.version='second';f.page.onShow();await flush();assert.equal(f.page.data.consentAgreed,false)
 f.agree();f.user.openid='other';f.page.onShow();await flush();assert.equal(f.page.data.consentAgreed,false)
})
test('unavailable documents block submitting and retry does not silently agree',async()=>{
 const f=fixture({load:()=>Promise.reject(Error('离线'))});f.page.onShow();await flush();f.agree();f.submit();assert.equal(f.calls.saved.length,0);assert.equal(f.page.data.documentsReady,false)
 f.options.load=null;await f.page.loadServiceDocuments();assert.equal(f.page.data.documentsReady,true);assert.equal(f.page.data.consentAgreed,false)
})
test('a late response cannot fill a hidden page, and malformed document content is rejected',async()=>{
 let finish;const f=fixture({load:()=>new Promise(r=>finish=r)});f.page.onShow();f.page.onHide();finish(clone(f.docs));await flush();assert.equal(f.page.data.documentsReady,false)
 f.options.load=()=>Promise.resolve({service:{version:'x'},privacy:{}});f.page.onShow();await flush();assert.equal(f.page.data.documentsReady,false);assert.match(f.page.data.documentsError,/说明/)
})
test('a server version conflict reloads documents without resubmitting; missing receipt never reports success',async()=>{
 const f=fixture({saveError:Object.assign(Error('说明已更新'),{code:'SERVICE_DOCUMENTS_CHANGED'})});f.page.onShow();await flush();f.agree();f.submit();await flush();assert.equal(f.calls.saved.length,1);assert.equal(f.calls.modals.length,0);assert.equal(f.page.data.consentAgreed,false)
 const g=fixture({recorded:false});g.page.onShow();await flush();g.agree();g.submit();await flush();assert.equal(g.calls.modals.length,0);assert(g.calls.toasts.some(t=>t.includes('未能登记')))
})
