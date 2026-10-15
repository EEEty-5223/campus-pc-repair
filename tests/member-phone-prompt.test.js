const fs=require('fs'),vm=require('vm'),path=require('path'),assert=require('node:assert/strict'),{test}=require('node:test');
const source=fs.readFileSync(path.join(__dirname,'../utils/member-phone-prompt.js'),'utf8');
const tick=async()=>{for(let i=0;i<6;i++)await new Promise(r=>setImmediate(r));};
function fixture(role='member',stored=''){
 const app={globalData:{openid:'self',notificationSession:'session',role}},calls={gets:0,saves:[],modals:[],toasts:[],loading:[]};
 const api={getMyMemberPhone:()=>{calls.gets++;return Promise.resolve({phone:stored,needsPhone:!stored});},saveMyMemberPhone:(phone,key)=>{calls.saves.push({phone,key});stored=phone;return Promise.resolve({ok:true,phone,needsPhone:false});}};
 const module={exports:{}};
 vm.runInNewContext(source,{module,require:()=>api,Promise,console,wx:{showModal:o=>calls.modals.push(o),showToast:o=>calls.toasts.push(o),showLoading(){calls.loading.push('show')},hideLoading(){calls.loading.push('hide')}}});
 return{app,calls,api,prompt:module.exports};
}
test('only signed active club roles prompt; existing server phone does not prompt',async()=>{
 for(const role of ['admin','leader','member']){const f=fixture(role,'13800000000');await f.prompt.ensure(f.app);assert.equal(f.calls.modals.length,0);assert.equal(f.app.globalData.phone,'13800000000');}
 for(const field of [{role:'user'},{notificationSession:''},{isSimulator:true}]){const f=fixture();Object.assign(f.app.globalData,field);await f.prompt.ensure(f.app);assert.equal(f.calls.gets,0);}
});
test('two confirmations show full number; saving succeeds before repeat entry stops prompting',async()=>{
 const f=fixture(),pending=f.prompt.ensure(f.app);await tick();f.calls.modals.shift().success({confirm:true,content:'13800000000'});await tick();
 assert.equal(f.calls.saves.length,0);assert.match(f.calls.modals[0].content,/13800000000/);f.calls.modals.shift().success({confirm:true});await pending;
 assert.equal(f.calls.saves.length,1);assert.match(f.calls.saves[0].key,/^[a-f0-9]{64}$/);assert.equal(f.app.globalData.needsPhone,false);
 await f.prompt.ensure(f.app);assert.equal(f.calls.modals.length,0);
});
test('invalid phone is not submitted; back from confirmation preserves input and cancel keeps phone missing',async()=>{
 const f=fixture(),pending=f.prompt.ensure(f.app);await tick();f.calls.modals.shift().success({confirm:true,content:'123'});await tick();assert.equal(f.calls.saves.length,0);f.calls.modals.shift().success({confirm:true});await tick();assert.equal(f.calls.modals[0].content,'123');
 f.calls.modals.shift().success({confirm:true,content:'13800000000'});await tick();f.calls.modals.shift().success({confirm:false});await tick();assert.equal(f.calls.modals[0].content,'13800000000');f.calls.modals.shift().success({confirm:false});await pending;assert.equal(f.app.globalData.needsPhone,true);
});
test('failed save retries same request key and cannot mark complete until saved',async()=>{
 const f=fixture();let fail=true;f.api.saveMyMemberPhone=(phone,key)=>{f.calls.saves.push({phone,key});return fail?Promise.reject({code:'NETWORK_ERROR'}):Promise.resolve({phone,needsPhone:false});};
 const pending=f.prompt.ensure(f.app);await tick();f.calls.modals.shift().success({confirm:true,content:'13800000000'});await tick();f.calls.modals.shift().success({confirm:true});await tick();assert.equal(f.app.globalData.needsPhone,true);fail=false;f.calls.modals.shift().success({confirm:true});await pending;assert.equal(f.calls.saves[0].key,f.calls.saves[1].key);assert.equal(f.app.globalData.needsPhone,false);
});
test('concurrent checks do not duplicate popup; account switch and hide cancel stale modal submission',async()=>{
 for(const cancel of [f=>f.app.globalData.openid='other',f=>f.prompt.cancel()]){const f=fixture(),one=f.prompt.ensure(f.app),two=f.prompt.ensure(f.app);await tick();assert.equal(f.calls.gets,1);assert.equal(f.calls.modals.length,1);cancel(f);f.calls.modals.shift().success({confirm:true,content:'13800000000'});await Promise.all([one,two]);assert.equal(f.calls.saves.length,0);}
});
test('lost response or other-device save resolves conflict using server state',async()=>{
 const f=fixture();f.api.saveMyMemberPhone=()=>Promise.reject({code:'PHONE_ALREADY_SET'});
 const pending=f.prompt.ensure(f.app);await tick();f.calls.modals.shift().success({confirm:true,content:'13800000000'});await tick();f.api.getMyMemberPhone=()=>Promise.resolve({phone:'13900000000',needsPhone:false});f.calls.modals.shift().success({confirm:true});await pending;assert.equal(f.app.globalData.phone,'13900000000');
});
test('network or schema failure does not mark phone complete or prevent later check',async()=>{
 const f=fixture();f.api.getMyMemberPhone=()=>Promise.reject({code:'PHONE_UNAVAILABLE'});await f.prompt.ensure(f.app);assert.equal(f.calls.modals.length,0);assert.notEqual(f.app.globalData.needsPhone,false);
 f.api.getMyMemberPhone=()=>Promise.resolve({phone:'',needsPhone:true});const pending=f.prompt.ensure(f.app);await tick();assert.equal(f.calls.modals.length,1);f.calls.modals.shift().success({confirm:false});await pending;
});
test('old save cannot dismiss loading indicator owned by a new account flow',async()=>{
 const f=fixture(),pending=[];f.api.saveMyMemberPhone=()=>new Promise(r=>pending.push(r));
 const a=f.prompt.ensure(f.app);await tick();f.calls.modals.shift().success({confirm:true,content:'13800000000'});await tick();f.calls.modals.shift().success({confirm:true});await tick();
 f.prompt.cancel();f.app.globalData.openid='other';const b=f.prompt.ensure(f.app);await tick();f.calls.modals.shift().success({confirm:true,content:'13900000000'});await tick();f.calls.modals.shift().success({confirm:true});await tick();
 const before=f.calls.loading.length;pending[0]({phone:'13800000000',needsPhone:false});await a;assert.equal(f.calls.loading.length,before);assert.notEqual(f.app.globalData.phone,'13800000000');pending[1]({phone:'13900000000',needsPhone:false});await b;assert.equal(f.calls.loading.at(-1),'hide');
});
test('conflict sync failure offers read-only retry and never saves a replacement number',async()=>{
 const f=fixture();let saves=0;f.api.saveMyMemberPhone=()=>{saves++;return Promise.reject({code:'PHONE_ALREADY_SET'});};
 const pending=f.prompt.ensure(f.app);await tick();f.calls.modals.shift().success({confirm:true,content:'13800000000'});await tick();f.api.getMyMemberPhone=()=>Promise.reject({code:'NETWORK_ERROR'});f.calls.modals.shift().success({confirm:true});await tick();assert.equal(f.calls.modals[0].confirmText,'重试同步');
 f.api.getMyMemberPhone=()=>Promise.resolve({phone:'13900000000',needsPhone:false});f.calls.modals.shift().success({confirm:true});await pending;assert.equal(saves,1);assert.equal(f.app.globalData.phone,'13900000000');
});
