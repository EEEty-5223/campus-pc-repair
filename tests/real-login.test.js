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
    }else o.success({statusCode:200,data:{ok:true,list:[]}});}
  };
  const module={exports:{}};
  const consoleStub={log(){},warn(){},error(){}};
  vm.runInNewContext(source('utils/api-request.js'),{module,wx,getApp:()=>app,Promise,console:consoleStub});
  const api=module.exports;
  vm.runInNewContext(source('app.js'),{App:value=>{app=value;},require:name=>name.includes('api-request')?api:{clearDemoData(){}},Promise,console:consoleStub});
  vm.runInNewContext(source('pages/index/index.js'),{Page:value=>{page=value;},require:name=>name.includes('chat-unread')?{overview:()=>Promise.resolve({total:0,counts:{},items:[]})}:name.includes('api-request')?api:{},getApp:()=>app,wx,Promise,setInterval:()=>1,clearInterval(){},console:consoleStub});
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
test('non-member retains join entry without receiving club permission',async()=>{const f=fixture({role:'user'});f.app.onLaunch();await f.app.globalData.loginReady;f.page.onShow();await new Promise(resolve=>setImmediate(resolve));assert.equal(f.page.data.isAdmin,false);});
for(const options of [{noCode:true},{loginFail:true},{networkFail:true},{statusCode:401},{response:{ok:false,error:'login failed'}},{response:{ok:true,openid:'simulator_openid_dev',isAdmin:true,role:'admin'}},{response:{ok:true,openid:'fake-user',_simulator:true}},{response:{ok:true}}])test('failed or fake login never falls back: '+JSON.stringify(options),async()=>{
  const f=fixture(options);await assert.rejects(f.api.silentLogin({requireReal:true}));assert.equal(f.calls.login,1);assert.equal(f.app.globalData.openid,'');assert.equal(f.app.globalData.isAdmin,false);if(options.noCode||options.loginFail)assert.equal(f.calls.requests.length,0);
});
