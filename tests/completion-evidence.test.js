const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const assert = require('node:assert/strict'), { test } = require('node:test');
const root = path.resolve(__dirname, '..');
const tick = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r)); };
function fixture(file = 'pages/completion/completion.js') {
  const user = { openid: 'staff', notificationSession: 'session', role: 'member', department: '技术部' };
  const calls = { uploads: [], submits: [], modals: [], review: [] };
  const item = { id: 'appt', name: '用户', status: 'repairing', canProcess: true, isAssignedToMe: true };
  const key = () => [user.openid, user.notificationSession, user.role, user.department].join(':');
  const completion = {
    viewerKey: key, requestKey: () => 'unique-request', errorText: e => e.code || 'failed',
    context: async () => ({ available: true, canSubmit: true }),
    upload: async (id, p) => { calls.uploads.push([id,p]); return { id: 'photo-' + p, url: 'https://photo/' + p }; },
    submit: async (id, body) => { calls.submits.push([id,body]); return { status: 'completed', reviewStatus: body.evidenceType === 'no_photo' ? 'pending' : 'not_required' }; },
    list: async () => ({ pendingCount: 1, hasMore: false, list: [{ id: 'review1', appointmentId: 'appt', status: 'pending', canReview: true }] }),
    review: async (...args) => { calls.review.push(args); return { reviewStatus: 'approved' }; }
  };
  const wx = { showModal: o => { assert(Array.from(o.confirmText || '确定').length <= 4, 'native modal confirmText supports at most 4 characters'); calls.modals.push(o); }, showToast() {}, navigateBack() {} };
  let definition;
  vm.runInNewContext(fs.readFileSync(path.join(root, file), 'utf8'), { Page: p => definition = p, require: n => n.includes('completion-api') ? completion : { getAppointment: async () => ({ item }) }, getApp: () => ({globalData:user}), wx, Promise, console });
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(p) { Object.assign(this.data,p); } };
  page.onLoad({ id: 'appt' }); page._viewer = key(); page._visible = true; page.data.item = {...item}; page.data.loading = false; page.data.canSkipPhoto = true;
  return { user, page, completion, calls, wx, key };
}
test('photos are mandatory, upload completes before code step, leading zeros reach submit unchanged', async () => {
  const f=fixture(); await f.page.nextStep(); assert.equal(f.page.data.step,'evidence'); assert.equal(f.calls.uploads.length,0);
  f.page.data.photos=[{path:'one',id:''}]; let finish;
  f.completion.upload=()=>new Promise(resolve=>finish=resolve);
  const next=f.page.nextStep(); await tick(); assert.equal(f.page.data.step,'evidence'); assert.equal(f.page.data.busy,true);
  finish({id:'photo1',url:'https://photo/1'}); await next; assert.equal(f.page.data.step,'code');
  f.page.inputCode({detail:{value:'0037'}}); await f.page.submit(); assert.equal(f.calls.submits[0][1].completionCode,'0037'); assert.deepEqual(Array.from(f.calls.submits[0][1].photoIds),['photo1']); assert.equal(f.page.data.success,true);
});
test('missing backend leaves photo step unchanged and never uploads or falls back to old completion API', async () => {
  const f=fixture(); f.page.data.photos=[{path:'one',id:''}]; f.completion.context=async()=>{throw {code:'COMPLETION_UNAVAILABLE'};};
  await f.page.nextStep(); assert.equal(f.page.data.step,'evidence'); assert.equal(f.calls.uploads.length,0); assert.equal(f.calls.submits.length,0); assert.equal(f.page.data.error,'COMPLETION_UNAVAILABLE');
});
test('photo exemption requires confirmation and four digits; server success creates pending review UI', async () => {
  const f=fixture(); f.page.skipPhoto(); assert.equal(f.page.data.step,'evidence'); f.calls.modals.shift().success({confirm:true}); assert.equal(f.page.data.step,'code');
  f.page.data.code='37'; await f.page.submit(); assert.equal(f.calls.submits.length,0);
  f.page.data.code='0037'; await f.page.submit(); const body=f.calls.submits[0][1]; assert.equal(body.evidenceType,'no_photo'); assert.equal(body.noPhotoReason,'用户不方便拍照'); assert.equal(body.photoIds.length,0); assert.equal(f.page.data.reviewPending,true);
});
test('photo exemption modal failure is visible and cancellation never advances the workflow', () => {
  const f=fixture();f.page.skipPhoto();f.calls.modals.shift().fail({errMsg:'showModal:fail'});assert.equal(f.page.data.step,'evidence');assert.match(f.page.data.error,/确认窗口/);
  f.page.skipPhoto();f.calls.modals.shift().success({confirm:false,cancel:true});assert.equal(f.page.data.step,'evidence');assert.equal(f.calls.submits.length,0);
});
test('wrong completion code retains evidence, suppresses duplicate in-flight submit, never marks success', async () => {
  const f=fixture(); f.page.data.mode='no_photo'; f.page.data.code='0037'; let reject;
  f.completion.submit=()=>{f.calls.submits.push(1);return new Promise((_,r)=>reject=r);};
  const p=f.page.submit(); f.page.submit(); assert.equal(f.calls.submits.length,1); reject({code:'COMPLETION_CODE_INVALID'}); await p;
  assert.equal(f.page.data.success,false); assert.equal(f.page.data.busy,false); assert.equal(f.page.data.error,'COMPLETION_CODE_INVALID');
});
test('account or department changes during upload cannot advance old order or submit its payload', async () => {
  for (const change of [f=>f.user.openid='other',f=>f.user.department='运营部']) {
    const f=fixture(); f.page.data.photos=[{path:'one',id:''}];let finish;f.completion.upload=()=>new Promise(r=>finish=r);
    const p=f.page.nextStep();await tick();change(f);finish({id:'photo1',url:'https://photo/1'});await p;
    assert.equal(f.page.data.step,'evidence');f.page.data.code='0037';await f.page.submit();assert.equal(f.calls.submits.length,0);
  }
});
test('special-order query failure is not shown as an empty queue; review has no optimistic approval', async () => {
  const f=fixture('pages/special-orders/special-orders.js'); f.user.role='leader'; f.page._viewer=f.key();
  f.completion.list=async()=>{throw {code:'COMPLETION_UNAVAILABLE'};};await f.page.refresh();assert.equal(f.page.data.pendingCount,null);assert(f.page.data.error);
  f.completion.list=async()=>({pendingCount:1,hasMore:false,list:[{id:'review1',appointmentId:'appt',status:'pending',canReview:true}]});await f.page.refresh();
  let finish;f.completion.review=()=>new Promise(r=>finish=r);f.page.review({currentTarget:{dataset:{id:'review1',decision:'approve'}}});f.calls.modals.shift().success({confirm:true});assert.equal(f.page.data.items[0].status,'pending');
  f.page.onHide();finish({reviewStatus:'approved'});await tick();assert.equal(f.page.data.busyId,'');assert.equal(f.page.data.items[0].status,'pending');
});
test('non-reviewer cannot send review even if an action is manually invoked', async () => {
  const f=fixture('pages/special-orders/special-orders.js');f.user.role='leader';f.page._viewer=f.key();f.page.data.items=[{id:'x',status:'pending',canReview:false}];
  f.page.review({currentTarget:{dataset:{id:'x',decision:'approve'}}});assert.equal(f.calls.modals.length,0);assert.equal(f.calls.review.length,0);
});
