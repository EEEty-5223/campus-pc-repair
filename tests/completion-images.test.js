'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),vm=require('vm');
const root=path.resolve(__dirname,'..');
function fixture(){
 const app={globalData:{openid:'owner',notificationSession:'session',role:'user'}},downloads=[];
 const imageApi={image:(url,options)=>{downloads.push({url,options});return url.includes('bad')?Promise.reject(Error('offline')):Promise.resolve('wxfile://private.png');}};
 const module={exports:{}};
 vm.runInNewContext(fs.readFileSync(path.join(root,'utils/completion-api.js'),'utf8'),{module,require:name=>name.includes('portal-api')?imageApi:{memberRequest:()=>Promise.resolve({})},getApp:()=>app,Promise});
 return {api:module.exports,downloads,app};
}
test('private evidence images use uncached downloads and preserve metadata and source URLs',async()=>{
 const f=fixture(),evidence={note:'证据说明',photos:[{id:'a',url:'http://local/signed-photo'}]};
 const result=await f.api.evidenceImages(evidence);assert.equal(result.note,'证据说明');assert.equal(result.photos[0].url,'wxfile://private.png');assert.equal(result.photos[0].sourceUrl,evidence.photos[0].url);assert.equal(f.downloads[0].options.cache,false);assert.equal(evidence.photos[0].url,'http://local/signed-photo');
});
test('one failed evidence image does not hide the completion record or remaining photos',async()=>{
 const f=fixture(),result=await f.api.evidenceImages({note:'保留记录',photos:[{id:'a',url:'http://local/good'},{id:'b',url:'http://local/bad'}]});
 assert.equal(result.note,'保留记录');assert.equal(result.photos[0].url,'wxfile://private.png');assert.equal(result.photos[1].failed,true);assert.equal(result.photos[1].url,'');assert.equal(await f.api.evidenceImages(null),null);
});
