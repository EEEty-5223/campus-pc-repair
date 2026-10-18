'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm')
const root=path.resolve(__dirname,'..'),clone=x=>JSON.parse(JSON.stringify(x)),flush=()=>new Promise(resolve=>setImmediate(resolve))
function fixture(file,options={}){
 let definition,viewer='first',challengeCalls=0
 const requests=[],native=[],media=[],uploads=[],discards=[],app={globalData:{loginReady:Promise.resolve(),openid:'fixture'}}
 const portal={identity:()=>viewer,absolute:x=>x,article:x=>x,call:(url,method,body)=>{requests.push({url,method,body});if(options.call)return options.call(url,method,body);return Promise.resolve({ok:true,available:true,remaining:0,templateId:'fixture-template',challengeId:'challenge'})}}
 portal.upload=file=>{uploads.push(file);return options.upload?options.upload(file):Promise.resolve('/uploads/fixture.png')}
 portal.avatar=value=>options.avatar?options.avatar(value):Promise.resolve(value)
 portal.forgetAvatar=()=>{}
 portal.image=value=>options.image?options.image(value):Promise.resolve(value)
 portal.articles=rows=>options.articles?options.articles(rows):Promise.resolve(rows.map(row=>({...row,coverUrl:row.cover||''})))
 portal.blocks=rows=>options.blocks?options.blocks(rows):Promise.resolve(rows.map(row=>row.type==='image'?{...row,url:row.src}:row))
 portal.discard=value=>{discards.push(value);return Promise.resolve()}
 portal.discardAll=values=>Promise.all((values||[]).map(portal.discard))
 let mixin;const module={exports:{}};vm.runInNewContext(fs.readFileSync(path.join(root,'utils/portal-page.js'),'utf8'),{module,require:()=>portal,getApp:()=>app,Promise,wx:{stopPullDownRefresh(){}}});mixin=module.exports
 const wx={showToast(){},chooseMedia:o=>media.push(o),requestSubscribeMessage:o=>native.push(o),navigateBack(){},setNavigationBarTitle(){},navigateTo(){},stopPullDownRefresh(){},enableAlertBeforeUnload(){},disableAlertBeforeUnload(){},showModal(){},previewImage(){}}
 vm.runInNewContext(fs.readFileSync(path.join(root,file),'utf8'),{Page:p=>definition=p,require:n=>n.includes('portal-page')?mixin:portal,getApp:()=>app,wx,Promise})
 const page={...definition,data:clone(definition.data),setData(patch){for(const [key,value] of Object.entries(clone(patch))){const parts=key.split('.');let target=this.data;for(const part of parts.slice(0,-1))target=target[part];target[parts.at(-1)]=value}}}
 return {page,app,portal,requests,native,media,uploads,discards,setViewer:value=>viewer=value,wx}
}
test('subscription authorization is prepared before click and native prompt starts synchronously on tap',async()=>{
 const f=fixture('pages/subscriptions/subscriptions.js');f.page.onLoad({id:'A1'});await f.page.onShow();assert.equal(f.native.length,0);assert(f.requests.some(x=>x.url.endsWith('/challenge')))
 const previous=f.requests.length;f.page.subscribe();assert.equal(f.native.length,1);assert.equal(f.requests.length,previous)
 f.native[0].success({'fixture-template':'accept'});await flush();assert(f.requests.some(x=>x.method==='POST'&&x.url==='/api/message-subscriptions'&&x.body.appointmentId==='A1'))
})
test('failed authorization registration keeps pending choice and retries without another native grant',async()=>{
 let attempts=0;const f=fixture('pages/subscriptions/subscriptions.js',{call:(url,method)=>{if(url.endsWith('/challenge'))return Promise.resolve({challengeId:'challenge'});if(method==='POST'){attempts++;return attempts===1?Promise.reject(Error('offline')):Promise.resolve({ok:true})}return Promise.resolve({available:true,remaining:0,templateId:'fixture-template'})}})
 f.page.onLoad({id:'A1'});await f.page.onShow();f.page.subscribe();f.native[0].success({'fixture-template':'accept'});await flush();assert(f.page._pending);assert.match(f.page.data.error,/不需要重复授权/)
 f.page.subscribe();await flush();assert.equal(f.native.length,1);assert.equal(attempts,2);assert.equal(f.page._pending,null)
})
test('expired prepared challenge cannot open a native prompt and consume a grant',async()=>{
 const f=fixture('pages/subscriptions/subscriptions.js');f.page.onLoad({id:'A1'});await f.page.onShow();f.page._challengeDeadline=Date.now()-1;f.page.subscribe();assert.equal(f.native.length,0);assert.match(f.page.data.error,/过期/)
})
test('expired registration clears stale choice instead of offering an endless retry',async()=>{
 const f=fixture('pages/subscriptions/subscriptions.js',{call:(url,method)=>{if(url.endsWith('/challenge'))return Promise.resolve({challengeId:'challenge',expiresInSeconds:290});if(method==='POST')return Promise.reject(Object.assign(Error('expired'),{statusCode:409}));return Promise.resolve({available:true,remaining:0,templateId:'fixture-template'})}})
 f.page.onLoad({id:'A1'});await f.page.onShow();f.page.subscribe();f.native[0].success({'fixture-template':'accept'});await flush();assert.equal(f.page._pending,null);assert.equal(f.page.data.pending,false);assert.match(f.page.data.error,/刷新后重新订阅/)
})
test('hidden profile response cannot update the page and account change clears private data',async()=>{
 let resolve;const f=fixture('pages/my/my.js',{call:()=>new Promise(r=>resolve=r)});const promise=f.page.onShow();await flush();f.page.onHide();resolve({profile:{nickname:'旧账号',avatar:'',role:'user'},stats:{total:9}});await promise;assert.equal(f.page.data.profile,null)
 f.page.setData({profile:{nickname:'旧账号'},stats:{total:9}});f.setViewer('second');f.page.onShow();assert.equal(f.page.data.profile,null)
})
test('personal center cleans old data when silent login changes identity during onShow',async()=>{
 const f=fixture('pages/my/my.js',{call:()=>Promise.reject(Error('offline'))});let complete;f.app.globalData.loginReady=new Promise(r=>complete=r);f.page._viewer='first';f.page.setData({profile:{nickname:'private old account'},stats:{total:99}})
 const pending=f.page.onShow();f.setViewer('second');complete();await pending;assert.equal(f.page.data.profile,null);assert.equal(f.page.data.stats,null)
})

const profileReply={profile:{nickname:'原昵称',avatar:'/uploads/original.png'}}
test('avatar label and picture use one media picker and returning from the picker preserves unsaved nickname',async()=>{
 const f=fixture('pages/profile/profile.js',{call:()=>Promise.resolve(profileReply)});await f.page.onShow()
 f.page.input({detail:{value:'未保存昵称'}});f.page.chooseImage();f.page.chooseImage();assert.equal(f.media.length,1)
 f.page.onHide();f.media[0].success({tempFiles:[{tempFilePath:'wxfile://avatar.jpg',size:1024}]});f.media[0].complete()
 assert.equal(f.uploads.length,0);await f.page.onShow();await flush()
 assert.deepEqual(f.uploads,['wxfile://avatar.jpg']);assert.equal(f.page.data.nickname,'未保存昵称');assert.equal(f.page.data.avatar,'/uploads/fixture.png');assert.equal(f.page.data.avatarUrl,'wxfile://avatar.jpg');assert.equal(f.page.data.uploading,false)
})
test('cancel, oversize and picker errors leave the existing avatar intact and release the picker',async()=>{
 const f=fixture('pages/profile/profile.js',{call:()=>Promise.resolve(profileReply)});await f.page.onShow();f.page.chooseImage()
 f.media[0].fail({errMsg:'chooseMedia:fail cancel'});f.media[0].complete();assert.equal(f.page.data.error,'');assert.equal(f.page.data.choosing,false)
 f.page.chooseImage();f.media[1].success({tempFiles:[{tempFilePath:'wxfile://large.jpg',size:6*1024*1024}]});f.media[1].complete();assert.match(f.page.data.error,/5MB/);assert.equal(f.uploads.length,0)
 f.page.chooseImage();f.media[2].fail({errMsg:'chooseMedia:fail api scope is not declared in the privacy agreement'});f.media[2].complete();assert.match(f.page.data.error,/隐私保护指引/);assert.equal(f.page.data.avatar,profileReply.profile.avatar)
})
test('avatar upload failure retains the saved image and a later retry can succeed',async()=>{
 let attempt=0;const f=fixture('pages/profile/profile.js',{call:()=>Promise.resolve(profileReply),upload:()=>++attempt===1?Promise.reject(Error('上传失败')):Promise.resolve('/uploads/retry.png')});await f.page.onShow()
 await f.page.uploadAvatar('wxfile://avatar.jpg','first');assert.equal(f.page.data.avatar,profileReply.profile.avatar);assert.equal(f.page.data.uploading,false);assert.match(f.page.data.error,/上传失败/)
 await f.page.uploadAvatar('wxfile://avatar.jpg','first');assert.equal(f.page.data.avatar,'/uploads/retry.png');assert.equal(f.page.data.error,'')
})
test('account change and page disposal prevent a selected file or late upload from updating another profile',async()=>{
 let finish;const f=fixture('pages/profile/profile.js',{call:()=>Promise.resolve(profileReply),upload:()=>new Promise(r=>finish=r)});await f.page.onShow();f.page.chooseImage();f.setViewer('second')
 f.media[0].success({tempFiles:[{tempFilePath:'wxfile://private.jpg'}]});assert.equal(f.uploads.length,0);await f.page.onShow()
 const pending=f.page.uploadAvatar('wxfile://new.jpg','second');f.page.onUnload();finish('/uploads/late.png');await pending;assert.notEqual(f.page.data.avatar,'/uploads/late.png')
})
test('failed initial profile load cannot overwrite nickname or avatar with empty values',async()=>{
 const f=fixture('pages/profile/profile.js',{call:()=>Promise.reject(Error('离线'))});await f.page.onShow();assert.equal(f.page.data.loadFailed,true)
 f.page.input({detail:{value:'草稿'}});await f.page.save();assert.equal(f.requests.filter(x=>x.method==='PUT').length,0)
 f.portal.call=()=>Promise.resolve(profileReply);await f.page.load();assert.equal(f.page.data.loadFailed,false);assert.equal(f.page.data.nickname,'原昵称')
})
test('both profile pages show downloaded local avatars and ignore downloads that finish after hide',async()=>{
 for(const file of ['pages/my/my.js','pages/profile/profile.js']){
  const f=fixture(file,{call:()=>Promise.resolve({...profileReply,stats:{total:1}}),avatar:()=>Promise.resolve('wxfile://downloaded.jpg')});await f.page.onShow()
  assert.equal(file.includes('/my/')?f.page.data.profile.avatarUrl:f.page.data.avatarUrl,'wxfile://downloaded.jpg')
  let finish;f.portal.avatar=()=>new Promise(r=>finish=r);const pending=f.page.load();await flush();f.page.onHide();finish('wxfile://stale.jpg');await pending
  assert.notEqual(file.includes('/my/')?f.page.data.profile.avatarUrl:f.page.data.avatarUrl,'wxfile://stale.jpg')
 }
})
test('a failed avatar download preserves the saved path and exposes retry without blocking nickname saving',async()=>{
 const f=fixture('pages/profile/profile.js',{call:()=>Promise.resolve(profileReply),avatar:()=>Promise.reject(Error('头像加载失败'))});await f.page.onShow()
 assert.equal(f.page.data.avatar,profileReply.profile.avatar);assert.equal(f.page.data.avatarUrl,'');assert.equal(f.page.data.loadFailed,false);assert.equal(f.page.data.avatarFailed,true)
 f.portal.avatar=()=>Promise.resolve('wxfile://retry.jpg');await f.page.load();assert.equal(f.page.data.avatarFailed,false);assert.equal(f.page.data.avatarUrl,'wxfile://retry.jpg')
 f.page.avatarError();assert.equal(f.page.data.avatarUrl,'');assert.equal(f.page.data.avatar,profileReply.profile.avatar);assert.equal(f.page.data.avatarFailed,true)
})
function avatarApi(base='http://10.222.65.216:3000'){
 const downloads=[],module={exports:{}}
 vm.runInNewContext(fs.readFileSync(path.join(root,'utils/portal-api.js'),'utf8'),{module,require:()=>({getBackendBaseUrl:()=>base}),Promise,wx:{downloadFile:o=>downloads.push(o)}})
 return {api:module.exports,downloads}
}
test('HTTP avatars are downloaded once to a local file, while HTTPS and empty avatars need no download',async()=>{
 const f=avatarApi(),path='/uploads/portal-'+ 'a'.repeat(32)+'.jpg';const one=f.api.avatar(path),two=f.api.avatar(path)
 assert.equal(f.downloads.length,1);assert.equal(f.downloads[0].url,'http://10.222.65.216:3000'+path)
 f.downloads[0].success({statusCode:200,tempFilePath:'wxfile://downloaded.jpg'});assert.equal(await one,'wxfile://downloaded.jpg');assert.equal(await two,'wxfile://downloaded.jpg')
 assert.equal(await f.api.avatar(path),'wxfile://downloaded.jpg');assert.equal(f.downloads.length,1)
 const online=avatarApi('https://campusapi.keon5223.xyz');assert.equal(await online.api.avatar(path),'https://campusapi.keon5223.xyz'+path);assert.equal(await online.api.avatar(''),'');assert.equal(online.downloads.length,0)
})
test('failed or missing avatar downloads are not cached as success and an expired temporary file can be retried',async()=>{
 const f=avatarApi();let pending=f.api.avatar('/uploads/test.jpg');const failed=assert.rejects(pending,/头像加载失败/);f.downloads[0].success({statusCode:404,tempFilePath:'wxfile://error.html'});await failed
 pending=f.api.avatar('/uploads/test.jpg');const network=assert.rejects(pending,/头像加载失败/);f.downloads[1].fail({errMsg:'offline'});await network
 pending=f.api.avatar('/uploads/test.jpg');f.downloads[2].success({statusCode:200,tempFilePath:'wxfile://ok.jpg'});await pending
 f.api.forgetAvatar('/uploads/test.jpg');pending=f.api.avatar('/uploads/test.jpg');assert.equal(f.downloads.length,4);f.downloads[3].success({statusCode:200,tempFilePath:'wxfile://new.jpg'});assert.equal(await pending,'wxfile://new.jpg')
})

test('abandoned avatar uploads are discarded when replaced or when the page is closed',async()=>{
 const f=fixture('pages/profile/profile.js',{call:()=>Promise.resolve(profileReply)});await f.page.onShow()
 await f.page.uploadAvatar('wxfile://first.jpg','first');await f.page.uploadAvatar('wxfile://second.jpg','first')
 assert.deepEqual(f.discards,['/uploads/fixture.png']);f.page.onUnload();assert.equal(f.discards.length,2)
})

test('closing profile during save defers cleanup until the save request has finished',async()=>{
 let finish;const f=fixture('pages/profile/profile.js',{call:(url,method)=>method==='PUT'?new Promise(resolve=>finish=resolve):Promise.resolve(profileReply)})
 await f.page.onShow();await f.page.uploadAvatar('wxfile://new.jpg','first')
 const saving=f.page.save();f.page.onUnload();assert.equal(f.discards.length,0);finish({ok:true});await saving;assert(f.discards.includes('/uploads/fixture.png'))
})

test('article editor cannot overwrite a document after its initial load failed',async()=>{
 const f=fixture('pages/guide-edit/guide-edit.js',{call:()=>Promise.reject(Error('offline'))});f.page.onLoad({id:'original'});await f.page.onShow()
 assert.equal(f.page.data.loadFailed,true);f.page.data.title='unsafe';f.page.data.body='unsafe';await f.page.saveDraft()
 assert.equal(f.requests.filter(r=>r.method==='PUT'||r.method==='POST').length,0)
 f.setViewer('second');await f.page.onShow();assert.equal(f.page._id,'original');assert.equal(f.page.data.title,'')
})

test('returning from article media picker retains typed content and previews the local selected cover',async()=>{
 const f=fixture('pages/guide-edit/guide-edit.js',{call:()=>Promise.resolve({canPublish:true})});f.page.onLoad({});await f.page.onShow()
 f.page.input({currentTarget:{dataset:{field:'title'}},detail:{value:'未保存文章'}})
 const event={currentTarget:{dataset:{target:'cover'}}};f.page.chooseImage(event);f.page.chooseImage(event);assert.equal(f.media.length,1)
 f.page.onHide();f.media[0].success({tempFiles:[{tempFilePath:'wxfile://cover.png',size:1024}]});f.media[0].complete();await f.page.onShow();await flush()
 assert.equal(f.page.data.title,'未保存文章');assert.equal(f.page.data.coverUrl,'wxfile://cover.png');assert.equal(f.page.data.uploading,false)
 f.page.onUnload();assert(f.discards.includes('/uploads/fixture.png'))
})

test('article save keeps uploads until the database save succeeds even if the editor closes',async()=>{
 let finish;const f=fixture('pages/guide-edit/guide-edit.js',{call:(url,method)=>method==='POST'?new Promise(resolve=>finish=resolve):Promise.resolve({canPublish:true})})
 f.page.onLoad({});await f.page.onShow();await f.page.uploadImage('wxfile://body.png','body','first');f.page.data.title='文章'
 const saving=f.page.saveDraft();f.page.onUnload();assert.equal(f.discards.length,0);finish({ok:true,id:'saved',version:1});await saving;assert(f.discards.includes('/uploads/fixture.png'))
})

test('article preview uses local uploaded images and can reload a failed remote image',async()=>{
 const src='/uploads/portal-'+ 'a'.repeat(32)+'.png';const f=fixture('pages/guide-edit/guide-edit.js',{call:()=>Promise.resolve({canPublish:true}),upload:()=>Promise.resolve(src)})
 f.page.onLoad({});await f.page.onShow();await f.page.uploadImage('wxfile://body.png','body','first');await f.page.preview()
 const index=f.page.data.blocks.findIndex(b=>b.type==='image');assert.equal(f.page.data.blocks[index].url,'wxfile://body.png')
 f.page.previewImageFailed({currentTarget:{dataset:{index}}});assert.equal(f.page.data.blocks[index].failed,true);await f.page.retryPreviewImages();assert.equal(f.page.data.blocks[index].url,src)
})

test('article text and favorite remain usable when a cover or content image cannot load',async()=>{
 const f=fixture('pages/guide-detail/guide-detail.js',{call:(url,method)=>Promise.resolve(method==='PUT'?{favorite:true}:{article:{id:'a',title:'文章',cover:'/cover.png',blocks:[{type:'paragraph',text:'正文'},{type:'image',src:'/body.png'}]}}),articles:rows=>Promise.resolve(rows.map(a=>({...a,coverUrl:'',coverFailed:true}))),blocks:rows=>Promise.resolve(rows.map(b=>b.type==='image'?{...b,failed:true,url:''}:b))})
 f.page.onLoad({id:'a'});await f.page.onShow();assert.equal(f.page.data.article.title,'文章');assert.equal(f.page.data.error,'');assert.match(f.page.data.imageError,/部分图片/)
 await f.page.favorite();assert.equal(f.page.data.article.favorite,true)
})

test('article image hydration cannot expose a previous account after switching or hiding',async()=>{
 let finish;const f=fixture('pages/guide-detail/guide-detail.js',{call:()=>Promise.resolve({article:{title:'旧账号草稿',blocks:[]}}),articles:()=>new Promise(resolve=>finish=resolve)})
 f.page.onLoad({id:'a'});const loading=f.page.onShow();await flush();f.page.onHide();finish([{title:'旧账号草稿'}]);await loading;assert.equal(f.page.data.article,null)
})

test('guide cover and body images resolve to local HTTP downloads while preserving original paths',async()=>{
 const f=avatarApi(),src='/uploads/portal-'+ 'b'.repeat(32)+'.png';const cover=f.api.articles([{id:'a',title:'文章',cover:src}]),body=f.api.blocks([{type:'paragraph',text:'正文'},{type:'image',src}])
 assert.equal(f.downloads.length,1);f.downloads[0].success({statusCode:200,tempFilePath:'wxfile://guide.png'})
 assert.equal((await cover)[0].coverUrl,'wxfile://guide.png');assert.equal((await body)[1].url,'wxfile://guide.png');assert.equal((await body)[1].src,src)
})

test('private signed images never reuse a public cached local download',async()=>{
 const f=avatarApi(),src='/api/completion-photos/p?expires=1&signature=private';const one=f.api.image(src,{cache:false}),two=f.api.image(src,{cache:false})
 assert.equal(f.downloads.length,2);f.downloads[0].success({statusCode:200,tempFilePath:'wxfile://private1.png'});f.downloads[1].success({statusCode:200,tempFilePath:'wxfile://private2.png'});assert.notEqual(await one,await two)
})

test('profile can return during an avatar download without remaining stuck in loading',async()=>{
 const resolvers=[];const f=fixture('pages/profile/profile.js',{call:()=>Promise.resolve(profileReply),avatar:()=>new Promise(resolve=>resolvers.push(resolve))})
 const initial=f.page.onShow();await flush();f.page.onHide();const returning=f.page.onShow();await flush()
 assert.equal(f.page.data.loading,false);resolvers.forEach(resolve=>resolve('wxfile://avatar.png'));await Promise.all([initial,returning]);assert.equal(f.page.data.avatarUrl,'wxfile://avatar.png')
})

test('a guide saved while hidden retains its server identifier and the next save updates instead of duplicating',async()=>{
 let finish;const f=fixture('pages/guide-edit/guide-edit.js',{call:(url,method)=>method==='POST'?new Promise(resolve=>finish=resolve):Promise.resolve({canPublish:true,id:'persisted',version:2})})
 f.page.onLoad({});await f.page.onShow();f.page.data.title='文章';f.page.data.body='正文'
 const saving=f.page.saveDraft();f.page.onHide();finish({id:'persisted',version:1});await saving;await f.page.onShow()
 assert.equal(f.page._id,'persisted');assert.equal(f.page._version,1);await f.page.saveDraft();assert.equal(f.requests.at(-1).method,'PUT');assert.match(f.requests.at(-1).url,/persisted$/)
})
