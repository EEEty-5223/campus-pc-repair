const fs=require('fs'),vm=require('vm'),path=require('path'),assert=require('node:assert/strict'),{test}=require('node:test');
const source=fs.readFileSync(path.join(__dirname,'../utils/member-removal-ui.js'),'utf8');
const tick=async()=>{for(let i=0;i<8;i++)await new Promise(r=>setImmediate(r));};
function fixture(role='admin'){
 const user={openid:'actor',role,department:'技术部'}, calls={modals:[],removes:[],reviews:[]};
 const api={getRemovalRequests:()=>Promise.resolve({list:[],canReview:role==='admin'}),removeMember:(id,b)=>{calls.removes.push({id,...b});return Promise.resolve({ok:true,mode:role==='admin'?'direct':'request'});},reviewRemovalRequest:(...args)=>{calls.reviews.push(args);return Promise.resolve({ok:true});}};
 const module={exports:{}};
 vm.runInNewContext(source,{module,require:n=>n.includes('api-request')?api:{key:()=>user.openid+':session',authError:e=>e.code==='MEMBER_REQUIRED'},getApp:()=>({globalData:user}),wx:{showModal:o=>calls.modals.push(o),showToast:()=>{}},Promise,console});
 const page={...module.exports.methods,_removalEpoch:1,_targetOpenid:'target',data:{profile:{openid:'target',status:1,role:'member',department:'技术部',name:'示例成员'},removalRequests:[]},setData(p){Object.assign(this.data,p);}};
 return{page,api,calls,user,allowed:module.exports.canRemove};
}
test('removal UI excludes self/admin/other department and leader targets; admin can remove leader',()=>{
 const f=fixture('leader'),p=f.page.data.profile;
 assert(f.allowed(f.user,p));
 for(const patch of [{openid:'actor'},{role:'admin'},{role:'leader'},{department:'运营部'},{status:0}])assert(!f.allowed(f.user,{...p,...patch}));
 f.user.role='admin';assert(f.allowed(f.user,{...p,role:'leader'}));assert(!f.allowed(f.user,{...p,role:'admin'}));
});
test('requires reason and second confirmation; admin success clears removed profile',async()=>{
 const f=fixture();f.page.beginRemove();f.calls.modals.shift().success({confirm:true,content:''});assert.equal(f.calls.removes.length,0);
 f.page.beginRemove();f.calls.modals.shift().success({confirm:true,content:'离开社团'});assert.equal(f.calls.removes.length,0);
 f.calls.modals.shift().success({confirm:true});await tick();assert.equal(f.calls.removes.length,1);assert.equal(f.page.data.profile,null);assert.equal(f.page.data.removalBusy,false);assert(f.page.data.removalSuccess);
});
test('leader submits request and keeps active member profile',async()=>{
 const f=fixture('leader');f.page.beginRemove();f.calls.modals.shift().success({confirm:true,content:'退出部门'});f.calls.modals.shift().success({confirm:true});await tick();assert.equal(f.calls.removes.length,1);assert.equal(f.page.data.profile.status,1);assert.equal(f.page.data.removalBusy,false);
});
test('failed removal retries same idempotency key and shows unfinished task error',async()=>{
 const f=fixture();f.api.removeMember=(id,b)=>{f.calls.removes.push({id,...b});return Promise.reject({code:'ASSIGNED_APPOINTMENTS_PENDING'});};
 for(let i=0;i<2;i++){f.page.beginRemove();f.calls.modals.shift().success({confirm:true,content:'退出'});f.calls.modals.shift().success({confirm:true});await tick();}
 assert.equal(f.calls.removes[0].requestKey,f.calls.removes[1].requestKey);assert.match(f.page.data.removalError,/转交/);
});
test('modal after account/role/visibility changes cannot submit',()=>{
 for(const change of [f=>f.user.openid='other',f=>f.user.role='member',f=>f.page._removalEpoch++]){const f=fixture();f.page.beginRemove();change(f);f.calls.modals.shift().success({confirm:true,content:'退出'});assert.equal(f.calls.modals.length,0);assert.equal(f.calls.removes.length,0);}
});
test('review requires admin capability and reject reason; hidden result cannot update page',async()=>{
 const f=fixture();f.page.data.removalCanReview=true;f.page.data.removalRequests=[{id:'2',status:'pending',targetName:'示例成员',reason:'申请退出'}];
 const event={currentTarget:{dataset:{id:'2',decision:'reject'}}};f.page.reviewRemoval(event);f.calls.modals.shift().success({confirm:true,content:''});assert.equal(f.calls.reviews.length,0);
 f.page.reviewRemoval(event);f.calls.modals.shift().success({confirm:true,content:'请先沟通'});await tick();assert.equal(f.calls.reviews.length,1);
 let finish;f.api.getRemovalRequests=()=>new Promise(r=>finish=r);const pending=f.page.loadRemovalRequests();f.page._removalEpoch++;finish({list:[{id:'old'}],canReview:true});await pending;assert(!f.page.data.removalRequests.some(r=>r.id==='old'));
});
test('approving removal in member detail removes stale editable profile and controls',async()=>{
 const f=fixture();f.page.data.removalCanReview=true;f.page.data.canRemoveMember=true;f.page.data.removalRequests=[{id:'3',status:'pending',targetOpenid:'target',targetName:'示例成员',reason:'退出'}];
 f.page.reviewRemoval({currentTarget:{dataset:{id:'3',decision:'approve'}}});f.calls.modals.shift().success({confirm:true});await tick();
 assert.equal(f.page.data.profile,null);assert.equal(f.page.data.canRemoveMember,false);assert.equal(f.page.data.removalBusy,false);
});
test('request pagination appends without duplicates and preserves records on a network failure',async()=>{
 const f=fixture();f.page._removalMode=true;
 f.api.getRemovalRequests=page=>Promise.resolve({list:page>1?[{id:'1',status:'pending'},{id:'2',status:'rejected'}]:[{id:'1',status:'pending'}],canReview:true,hasMore:page===1});
 await f.page.loadRemovalRequests();assert.equal(f.page.data.removalHasMore,true);await f.page.loadMoreRemovals();assert.deepEqual(Array.from(f.page.data.removalRequests,r=>r.id),['1','2']);
 f.api.getRemovalRequests=()=>Promise.reject({code:'NETWORK_ERROR'});await f.page.loadRemovalRequests();assert.equal(f.page.data.removalRequests.length,2);assert(f.page.data.removalError);
});
