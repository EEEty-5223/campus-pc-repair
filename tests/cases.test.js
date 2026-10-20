const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),clone=x=>JSON.parse(JSON.stringify(x)),flush=()=>new Promise(r=>setImmediate(r));
function fixture(file,options={}){
  let definition,viewer='first';const requests=[],pickers=[],uploads=[],routes=[],app={globalData:{loginReady:Promise.resolve()}};
  const row={id:'a'.repeat(32),version:1,status:'draft',technicianNames:'维修员',department:'技术部',title:'蓝屏排查',publicLocation:'图书馆',symptoms:'启动蓝屏',solution:'修复驱动',result:'恢复使用',photos:[]};
  const reply=()=>({ok:true,item:clone(row),canEdit:true,canPublish:true,sourceAvailable:true,sourcePhotos:[]});
  const cases={identity:()=>viewer,card:r=>r,cards:rows=>Promise.resolve(rows),photos:rows=>Promise.resolve((rows||[]).map(p=>({...p,displayUrl:p.displayUrl||'wxfile://'+p.id}))),call:(url,method='GET',body)=>{requests.push({url,method,body});return options.call?options.call(url,method,body):Promise.resolve(reply())},upload:(id,file,version)=>{uploads.push({id,file,version});return options.upload?options.upload(id,file,version):Promise.resolve({ok:true,version:version+1,photos:[{id:'photo'}]})}};
  const wx={chooseMedia:r=>pickers.push(r),showToast(){},showModal:r=>r.success({confirm:true}),navigateTo:r=>routes.push(r.url),navigateBack(){},previewImage(){},stopPullDownRefresh(){},disableAlertBeforeUnload(){},enableAlertBeforeUnload(){}};
  const module={exports:{}};vm.runInNewContext(fs.readFileSync(path.join(root,'utils/portal-page.js'),'utf8'),{module,require:()=>({identity:()=>viewer}),getApp:()=>app,wx,Promise});
  vm.runInNewContext(fs.readFileSync(path.join(root,file),'utf8'),{Page:p=>definition=p,require:n=>n.includes('portal-page')?module.exports:cases,getApp:()=>app,wx,Promise});
  const page={...definition,data:clone(definition.data),setData(patch){for(const [key,value] of Object.entries(clone(patch))){const parts=key.split('.');let target=this.data;for(const p of parts.slice(0,-1))target=target[p];target[parts.at(-1)]=value}}};
  if(page.onLoad)page.onLoad({id:row.id});return {page,row,reply,cases,requests,uploads,pickers,routes,viewer:v=>{viewer=v}};
}
test('case detail clears previously displayed content when the case is withdrawn',async()=>{
  let visible=true;const f=fixture('pages/case-detail/case-detail.js',{call:()=>visible?Promise.resolve({item:{title:'案例',photos:[],faultType:'系统与软件'}}):Promise.reject(Error('案例已撤下'))});
  await f.page.onShow();assert(f.page.data.item);visible=false;await f.page.load();assert.equal(f.page.data.item,null);assert.match(f.page.data.error,/撤下/);f.page.booking();assert.equal(f.routes.length,0);
});
test('late list response cannot overwrite a hidden page',async()=>{
  let resolve;const f=fixture('pages/cases/cases.js',{call:()=>new Promise(r=>{resolve=r})});const pending=f.page.onShow();await flush();f.page.onHide();resolve({list:[{id:'old'}],hasMore:false,departments:[],faultTypes:[]});await pending;assert.equal(f.page.data.items.length,0);
});
test('case picker returning after hide preserves unsaved text and uploads once on return',async()=>{
  const f=fixture('pages/case-edit/case-edit.js');await f.page.onShow();f.page.input({currentTarget:{dataset:{field:'solution'}},detail:{value:'尚未保存的处理过程'}});f.page.choosePhoto();f.page.choosePhoto();assert.equal(f.pickers.length,1);
  f.page.onHide();f.pickers[0].success({tempFiles:[{tempFilePath:'wxfile://chosen',size:100}]});f.pickers[0].complete();assert.equal(f.uploads.length,0);await f.page.onShow();assert.equal(f.uploads.length,1);assert.equal(f.page.data.form.solution,'尚未保存的处理过程');assert.equal(f.page.data.item.version,2);assert.equal(f.page.data.busy,false);
});
test('account change clears the form and ignores a previous account media selection',async()=>{
  const f=fixture('pages/case-edit/case-edit.js');await f.page.onShow();f.page.choosePhoto();f.page.onHide();f.viewer('second');await f.page.onShow();f.pickers[0].success({tempFiles:[{tempFilePath:'wxfile://old',size:100}]});f.pickers[0].complete();assert.equal(f.uploads.length,0);assert.equal(f.page.data.confirmed,false);
});
test('a version conflict preserves typed content and blocks saving instead of overwriting another editor',async()=>{
  const f=fixture('pages/case-edit/case-edit.js');await f.page.onShow();f.page.input({currentTarget:{dataset:{field:'symptoms'}},detail:{value:'未保存描述'}});f.row.version=2;await f.page.load(true);assert(f.page.data.stale);assert.equal(f.page.data.form.symptoms,'未保存描述');await f.page.saveDraft();assert.equal(f.requests.filter(r=>r.method==='PUT').length,0);
});
test('preview, explicit confirmation, source eligibility and usable case images gate publication',async()=>{
  const f=fixture('pages/case-edit/case-edit.js',{call:(url,method,body)=>method==='PUT'?Promise.resolve({ok:true,version:2,status:body.status}):Promise.resolve({item:{id:'a'.repeat(32),version:1,status:'draft',title:'案例',publicLocation:'图书馆',symptoms:'故障',solution:'处理',result:'修复',photos:[]},canPublish:true,canEdit:true,sourceAvailable:true,sourcePhotos:[]})});await f.page.onShow();await f.page.publish();assert.equal(f.requests.filter(r=>r.method==='PUT').length,0);f.page.preview();f.page.confirm({detail:{value:['confirmed']}});f.page.data.caseImagesReady=false;await f.page.publish();assert.equal(f.requests.filter(r=>r.method==='PUT').length,0);f.page.data.caseImagesReady=true;await f.page.publish();assert.equal(f.requests.filter(r=>r.method==='PUT').length,1);assert.equal(f.requests.find(r=>r.method==='PUT').body.privacyConfirmed,true);
});
test('a media write that finishes while hidden preserves its new server version and typed copy on return',async()=>{
  let finish;const f=fixture('pages/case-edit/case-edit.js',{upload:()=>new Promise(r=>{finish=r})});await f.page.onShow();f.page.input({currentTarget:{dataset:{field:'solution'}},detail:{value:'继续保留的文字'}});
  const pending=f.page.mutateMedia(f.cases.upload(f.row.id,'file',1));f.page.onHide();f.row.version=2;finish({ok:true,version:2,photos:[]});await pending;await f.page.onShow();assert.equal(f.page.data.stale,false);assert.equal(f.page.data.item.version,2);assert.equal(f.page.data.form.solution,'继续保留的文字');
});
test('revoked access clears old private form and photo previews',async()=>{
  let allowed=true;const f=fixture('pages/case-edit/case-edit.js',{call:()=>allowed?Promise.resolve({item:{id:'x',version:1,title:'私有草稿',photos:[{id:'private'}]},canEdit:true,canPublish:true,sourceAvailable:true,sourcePhotos:[]}):Promise.reject(Object.assign(Error('权限已变化'),{statusCode:403}))});await f.page.onShow();assert.equal(f.page.data.photos.length,1);allowed=false;await f.page.load(true);assert.equal(f.page.data.item,null);assert.equal(f.page.data.photos.length,0);assert.equal(f.page.data.canPublish,false);
});
test('case images send a session only to validated same-backend administrative media routes',async()=>{
  let exported;const downloads=[],module={exports:{}};const app={globalData:{notificationSession:'fixture-session'}};
  const portal={identity:()=> 'viewer',absolute:p=>'http://local'+p,date:()=> '2026-10-19'};
  vm.runInNewContext(fs.readFileSync(path.join(root,'utils/cases-api.js'),'utf8'),{module,getApp:()=>app,Promise,require:n=>n.includes('portal-api')?portal:{},wx:{downloadFile:o=>{downloads.push(o);o.success({statusCode:200,tempFilePath:'wxfile://image'})}}});exported=module.exports;
  const valid='/api/admin/cases/'+'a'.repeat(32)+'/images/'+'b'.repeat(32);await exported.photos([{id:'a',url:valid}],true);assert.equal(downloads[0].header.Authorization,'Bearer fixture-session');await exported.photos([{url:'https://external.example/steal'}],true);assert.equal(downloads.length,1);await exported.photos([{url:'/api/case-images/'+'c'.repeat(32)}],false);assert.equal(downloads[1].header.Authorization,undefined);
});
