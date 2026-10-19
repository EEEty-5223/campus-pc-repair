const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const source = file => fs.readFileSync(path.join(root,file),'utf8');
function fixture(options={}) {
  const calls={login:0,requests:[]};
  let app, page;
  const user={ok:true,openid:'verified-test-user',role:options.role||'member',isAdmin:options.role!=='user',department:'技术部',notificationSession:'signed-test-session'};
  if(options.role==='user')user.notificationSession='';
  const wx={getAccountInfoSync:()=>({miniProgram:{envVersion:options.envVersion||'develop'}}),getSystemInfoSync:()=>({platform:options.platform||'ios'}),
    login:o=>{calls.login++;if(options.loginFail)o.fail({errMsg:'native failed'});else o.success({code:options.noCode?'':'temporary-wechat-code'});},
    request:o=>{calls.requests.push(o);if(o.url.endsWith('/api/login')){
      if(options.networkFail)return o.fail({errMsg:'timeout'});
      o.success({statusCode:options.statusCode||200,data:options.response||user});
    }else o.success({statusCode:200,data:options.apiResponse||{ok:true,list:[]}});}
  };
  const module={exports:{}};
  const consoleStub={log(){},warn(){},error(){}};
  vm.runInNewContext(source('utils/api-request.js'),{module,wx,getApp:()=>app,Promise,console:consoleStub,require:n=>{if(n==='./chat-media')return {hydrate:rows=>Promise.resolve(rows)};throw Error('Unexpected dependency '+n)}});
  const api=module.exports;
  vm.runInNewContext(source('app.js'),{App:value=>{app=value;},require:name=>name.includes('portal-api') ? { identity: () => 'fixture', call: () => Promise.resolve({ list: [] }), article: x => x, articles: rows => Promise.resolve(rows) } : name.includes('api-request')?api:{clearDemoData(){}},Promise,console:consoleStub});
  vm.runInNewContext(source('pages/index/index.js'),{Page:value=>{page=value;},require:name=>name.includes('portal-api') ? { identity: () => 'fixture', call: () => Promise.resolve({ list: [] }), article: x => x, articles: rows => Promise.resolve(rows) } : name.includes('chat-unread')?{overview:()=>Promise.resolve({total:0,counts:{},items:[]})}:name.includes('api-request')?api:{},getApp:()=>app,wx,Promise,setInterval:()=>1,clearInterval(){},console:consoleStub});
  page.setData=patch=>Object.assign(page.data,patch);
  return {api,calls,app,page,user};
}
for(const role of ['admin','leader','member'])test('devtools authenticates '+role+' and preserves club entry after restart',async()=>{
  const f=fixture({role,envVersion:'release',platform:'devtools'});
  for(let n=0;n<2;n++){
    f.app.onLaunch();await f.app.globalData.loginReady;
    f.page.onShow();await new Promise(resolve=>setImmediate(resolve));
    assert.equal(f.app.globalData.role,role);
    assert.equal(f.app.globalData.openid,f.user.openid);
    assert.equal(f.app.globalData.notificationSession,f.user.notificationSession);
    assert.equal(f.app.globalData.isSimulator,false);
    assert.equal(f.page.data.isAdmin,true);
    assert.equal(f.page.data.recordCount,0);
  }
  assert.equal(f.calls.login,2);
  const loginRequests=f.calls.requests.filter(o=>o.url.endsWith('/api/login'));
  assert.equal(loginRequests.length,2);
  assert.equal(loginRequests[0].url,'https://campusapi.keon5223.xyz/api/login');
  assert.deepEqual(JSON.parse(JSON.stringify(loginRequests[0].data)),{code:'temporary-wechat-code'});
  await f.api.silentLogin({requireReal:true});assert.equal(f.calls.login,3);
});
test('actual phone still authenticates through same backend',async()=>{const f=fixture({platform:'ios',role:'admin'});assert.equal((await f.api.silentLogin()).role,'admin');assert.equal(f.calls.login,1);});
test('editing a booking uses signed identity and HTTP or non-JSON API failures never report success',async()=>{
 const f=fixture();f.app.onLaunch();await f.app.globalData.loginReady
 await f.api.updateAppointment('A1',{name:'新名字'});const edit=f.calls.requests.at(-1)
 assert.match(edit.url,/\/api\/appointments\/update$/);assert.equal(edit.header.Authorization,'Bearer signed-test-session');assert.equal(edit.header.openid,undefined)
 for(const data of ['<html>Not Found</html>',{list:[]}]) {
  const broken=fixture({apiResponse:data});broken.app.onLaunch();await broken.app.globalData.loginReady
  await assert.rejects(broken.api.request('/missing','POST',{}),/服务响应异常/)
 }
})
for (const scenario of [
  { active:true, expected:true },
  { active:false, expected:false },
  { active:true, flag:false, expected:false }
]) test('detail derives assignment only when server omits flag '+JSON.stringify(scenario),async()=>{
  const item={id:'a',status:'repairing',canProcess:true,assignees:[{openid:'verified-test-user',isActive:scenario.active}]};
  if ('flag' in scenario) item.isAssignedToMe=scenario.flag;
  const f=fixture({apiResponse:{ok:true,item}});f.app.onLaunch();await f.app.globalData.loginReady;
  const result=await f.api.getAppointment('a');assert.equal(result.item.isAssignedToMe,scenario.expected);assert.equal(result.item.canProcess,true);
});

test('start and completion actions send separate signed code fields and owner route',async()=>{
 const f=fixture();f.app.onLaunch();await f.app.globalData.loginReady;
 await f.api.updateStatus('a','repairing','0017');let request=f.calls.requests.at(-1);assert.equal(request.data.startCode,'0017');assert.equal(request.data.completionCode,undefined);assert.equal(request.header.Authorization,'Bearer signed-test-session');
 await f.api.updateStatus('a','completed','0037');request=f.calls.requests.at(-1);assert.equal(request.data.completionCode,'0037');assert.equal(request.data.startCode,undefined);
 await f.api.getStartCode('a');assert.match(f.calls.requests.at(-1).url,/appointments\/a\/start-code$/);
});

test('API preserves task permissions, repair logs and intervention notice without exposing normal actions',async()=>{
 const f=fixture({apiResponse:{ok:true,item:{id:'a',status:'repairing',canProcess:false,canAssign:true,adminIntervened:true,repairHistory:[{id:'1',title:'管理员介入',at:'2026-10-16T01:00:00Z',isIntervention:true}]},list:[{id:1,kind:'admin_intervention',from_role:'admin',content:'管理员介入'}]}});
 f.app.onLaunch();await f.app.globalData.loginReady;
 const detail=await f.api.getAppointment('a');assert.equal(detail.item.canProcess,false);assert.equal(detail.item.canAssign,true);assert.equal(detail.item.repairHistory[0].isIntervention,true);assert.equal(detail.item.adminIntervened,true);
 const messages=await f.api.getMessages('a');assert.equal(messages.list[0].kind,'admin_intervention');
});

for(const platform of ['ios','android'])for(const envVersion of ['develop','trial','release'])test('phone '+platform+' '+envVersion+' uses configured development or production backend',async()=>{
  const f=fixture({platform,envVersion,role:'admin'});
  const base=envVersion==='develop'?'http://10.222.65.216:3000':'https://campusapi.keon5223.xyz';
  f.app.onLaunch();await f.app.globalData.loginReady;
  await f.api.createAppointment({name:'测试',phone:'13800000000',description:'仅请求桩验证'});
  assert.equal(f.calls.requests.find(o=>o.url.endsWith('/api/login')).url,base+'/api/login');
  const booking=f.calls.requests.find(o=>o.url.endsWith('/api/appointments'));
  assert.equal(booking.url,base+'/api/appointments');
  assert.equal(booking.header.Authorization,'Bearer '+f.user.notificationSession);
});

test('develop simulator keeps independent local member endpoint',async()=>{
  const f=fixture({platform:'devtools',envVersion:'develop'});
  await assert.rejects(f.api.silentLogin());
  assert.equal(f.calls.requests[0].url,'http://127.0.0.1:3000/api/local-dev/login');
  assert.equal(f.calls.login,0);
});
for (const role of ['member','leader','admin']) test('develop simulator accepts fixed local account role '+role,async()=>{
  const local={ok:true,_localDevelopment:true,openid:'local_test_member_xiaotangzhu',role,isAdmin:true,notificationSession:'localdev_'+'a'.repeat(64)};
  const f=fixture({platform:'devtools',envVersion:'develop',apiResponse:local});
  f.app.onLaunch();await f.app.globalData.loginReady;assert.equal(f.app.globalData.role,role);assert.equal(f.app.globalData.openid,local.openid);assert.equal(f.calls.login,0);
});
test('non-member retains join entry without receiving club permission',async()=>{const f=fixture({role:'user'});f.app.onLaunch();await f.app.globalData.loginReady;f.page.onShow();await new Promise(resolve=>setImmediate(resolve));assert.equal(f.page.data.isAdmin,false);});
for(const options of [{noCode:true},{loginFail:true},{networkFail:true},{statusCode:401},{response:{ok:false,error:'login failed'}},{response:{ok:true,openid:'simulator_openid_dev',isAdmin:true,role:'admin'}},{response:{ok:true,openid:'fake-user',_simulator:true}},{response:{ok:true}}])test('failed or fake login never falls back: '+JSON.stringify(options),async()=>{
  const f=fixture(options);await assert.rejects(f.api.silentLogin({requireReal:true}));assert.equal(f.calls.login,1);assert.equal(f.app.globalData.openid,'');assert.equal(f.app.globalData.isAdmin,false);if(options.noCode||options.loginFail)assert.equal(f.calls.requests.length,0);
});
