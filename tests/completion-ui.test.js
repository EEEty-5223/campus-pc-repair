const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('node:assert/strict'),{test}=require('node:test');
const root=path.resolve(__dirname,'..'),tick=async()=>{for(let i=0;i<6;i++)await new Promise(r=>setImmediate(r));};
function fixture(){
 const user={openid:'owner',notificationSession:'session',role:'admin',department:'技术部'},calls={modals:[],updates:[],codeReads:0,myReads:0,adminReads:0,refresh:0,toasts:[]};
 const item={id:'appt',status:'repairing',assignedOpenid:'member',assignedActiveCount:1};
 const api={getCompletionCode:()=>{calls.codeReads++;return Promise.resolve({completionCode:'0037'});},getMyAppointments:()=>{calls.myReads++;return Promise.resolve({list:[{...item}]});},getAdminAppointments:()=>{calls.adminReads++;return Promise.resolve({list:[{...item}]});},updateStatus:(...args)=>{calls.updates.push(args);return Promise.resolve({ok:true});}};
 const wx={showModal:o=>calls.modals.push(o),showToast:o=>calls.toasts.push(o)};
 function load(file){const module={exports:{}};let page;vm.runInNewContext(fs.readFileSync(path.join(root,file),'utf8'),{module,Page:p=>page=p,require:n=>n.includes('api-request')?api:n.includes('assignment-ui')?{withPage:p=>p}:n.includes('admin-notifications')?{data:{},methods:{}}:{decorate:x=>({...x})},getApp:()=>({globalData:user}),wx,Promise,console});return page||module.exports;}
 const status=load('utils/appointment-status-ui.js'),page={data:{allItems:[item]},_chatVisible:true,_chatVisibilityVersion:1,setData(p){Object.assign(this.data,p)},loadItems(){calls.refresh++;return Promise.resolve();}};
 function detail(role='user'){const definition=load('pages/detail/detail.js');const d={...definition,data:{...definition.data,id:'appt',role},setData(p){Object.assign(this.data,p)}};return d;}
 return{user,calls,api,item,status,page,detail,load};
}
test('unassigned confirmation is blocked before a modal or network mutation',()=>{
 const f=fixture();f.item.status='pending';f.item.assignedActiveCount=0;f.status.changeStatus.call(f.page,{currentTarget:{dataset:{id:'appt',status:'accepted'}}});assert.equal(f.calls.modals.length,0);assert.equal(f.calls.updates.length,0);assert.match(f.calls.toasts[0].title,/分配/);
});
test('complete requires exactly four digits and keeps leading zeros unchanged',async()=>{
 const f=fixture(),event={currentTarget:{dataset:{id:'appt',status:'completed'}}};f.status.changeStatus.call(f.page,event);f.calls.modals.shift().success({confirm:true,content:'37'});assert.equal(f.calls.updates.length,0);
 f.status.changeStatus.call(f.page,event);f.calls.modals.shift().success({confirm:true,content:'0037'});await tick();assert.deepEqual(f.calls.updates[0],['appt','completed','0037']);assert.equal(f.calls.codeReads,0);
});
test('wrong or locked code never updates local status; repeated in-flight submit is suppressed',async()=>{
 const f=fixture();let finish;f.api.updateStatus=(...args)=>{f.calls.updates.push(args);return new Promise((_,reject)=>finish=reject);};const event={currentTarget:{dataset:{id:'appt',status:'completed'}}};
 f.status.changeStatus.call(f.page,event);f.calls.modals.shift().success({confirm:true,content:'0000'});f.status.changeStatus.call(f.page,event);assert.equal(f.calls.updates.length,1);finish({code:'COMPLETION_CODE_LOCKED'});await tick();assert.equal(f.item.status,'repairing');assert.match(f.calls.modals[0].content,/锁定/);assert.equal(f.page.data.statusBusy,false);
});
test('stale confirmation after hide, account switch or status update cannot submit',()=>{
 for(const change of [f=>f.page._chatVisibilityVersion++,f=>f.user.openid='other',f=>f.item.status='completed']){const f=fixture();f.status.changeStatus.call(f.page,{currentTarget:{dataset:{id:'appt',status:'completed'}}});change(f);f.calls.modals.shift().success({confirm:true,content:'0037'});assert.equal(f.calls.updates.length,0);}
});
test('customer detail shows fixed owner-only code; staff detail never requests it',async()=>{
 const f=fixture(),d=f.detail();await d.loadItem();assert.equal(d.data.completionCode,'0037');assert.equal(f.calls.myReads,1);assert.equal(f.calls.adminReads,0);
 const a=f.detail('admin');await a.loadItem();assert.equal(a.data.completionCode,'');assert.equal(f.calls.codeReads,1);assert.equal(f.calls.adminReads,1);
});
test('owner code error has no fallback and completed/cancelled details never fetch code',async()=>{
 const f=fixture();f.api.getCompletionCode=()=>Promise.reject({code:'APPOINTMENT_FORBIDDEN'});const d=f.detail();await d.loadItem();assert.equal(d.data.completionCode,'');assert(d.data.codeError);assert.equal(f.calls.adminReads,0);
 for(const status of ['completed','cancelled']){f.item.status=status;await d.loadItem();assert.equal(d.data.completionCode,'');assert.equal(d.data.codeLoading,false);}
});
test('late owner-code response after hide/account switch never renders code',async()=>{
 for(const invalidate of [(f,d)=>d.onHide(),f=>f.user.openid='other']){const f=fixture();let finish;f.api.getCompletionCode=()=>new Promise(r=>finish=r);const d=f.detail(),load=d.loadItem();await tick();invalidate(f,d);finish({completionCode:'0037'});await load;assert.equal(d.data.completionCode,'');}
});
test('appointment completed during code fetch clears code and updates displayed state',async()=>{
 const f=fixture();f.api.getCompletionCode=()=>Promise.resolve({completionCode:null,ended:true,used:true,status:'completed'});const d=f.detail();await d.loadItem();assert.equal(d.data.item.status,'completed');assert.equal(d.data.completionCode,'');assert.equal(d.data.codeLoading,false);
});
test('appointment voided during code fetch hides code and synchronizes reason without a spurious error',async()=>{
 const f=fixture();f.api.getCompletionCode=()=>Promise.resolve({completionCode:null,ended:true,isVoided:true,status:'repairing',voidReason:'重复预约',voidedAt:'2026-10-15'});
 const d=f.detail();await d.loadItem();assert.equal(d.data.item.isVoided,true);assert.equal(d.data.item.voidReason,'重复预约');assert.equal(d.data.item.canReply,false);assert.equal(d.data.completionCode,'');assert.equal(d.data.codeLoading,false);assert.equal(d.data.codeError,'');
});
test('returning to admin after hidden request finishes re-enables state buttons',async()=>{
 const f=fixture();let finish;f.api.updateStatus=()=>new Promise(r=>finish=r);
 f.status.changeStatus.call(f.page,{currentTarget:{dataset:{id:'appt',status:'completed'}}});f.calls.modals.shift().success({confirm:true,content:'0037'});f.page._chatVisible=false;f.page._chatVisibilityVersion++;finish({ok:true});await tick();assert.equal(f.page._statusBusy,false);
 const definition=f.load('pages/admin/admin.js'),p={...definition,data:{...definition.data,statusBusy:true},_statusBusy:false,setData(x){Object.assign(this.data,x)},loadItems:()=>Promise.resolve(),scheduleChatPolling(){},loadNotificationStatus(){}};
 p.onShow();await tick();assert.equal(p.data.statusBusy,false);
});
