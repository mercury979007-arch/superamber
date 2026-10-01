const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const {createUserFeedbackStore}=require('../lib/userFeedbackStore');
const {createUserFeedbackRoutes}=require('../routes/userFeedbackRoutes');
const {digest}=require('../scripts/user-feedback.cjs');
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jK1sAAAAASUVORK5CYII=';
async function fixture(t) {const root=await fs.mkdtemp(path.join(os.tmpdir(),'amber-feedback-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return{root,store:createUserFeedbackStore(root)};}
const input=(id='request-123')=>({clientId:id,text:'选择三横排后布局不对',images:[{dataUrl:image}],context:{screen:'seating',cookie:'must-not-be-stored'}});
test('feedback text and image survive store reload; only approved context fields persist',async t=>{
 const {root,store}=await fixture(t); const item=await store.create('Teacher',input());const reloaded=await createUserFeedbackStore(root).get(item.id);
 assert.equal(reloaded.text,input().text);assert.equal(reloaded.images.length,1);assert.equal(reloaded.context.cookie,undefined);assert.equal((await fs.stat(store.imagePath(item.id,item.images[0].name))).mode&0o777,0o600);
});
test('concurrent retries are idempotent while different submissions cannot overwrite each other',async t=>{
 const {store}=await fixture(t);const repeated=await Promise.all(Array.from({length:5},()=>store.create('Teacher',input())));assert.equal(new Set(repeated.map(x=>x.id)).size,1);
 await Promise.all(Array.from({length:8},(_,i)=>store.create('Teacher',input(`request-other-${i}`))));assert.equal((await store.list()).length,9);
});
test('rejects forged, oversized and unsupported images, empty text and excess images without leaving records',async t=>{
 const {store}=await fixture(t);for(const patch of [{text:''},{images:Array(4).fill({dataUrl:image})},{images:[{dataUrl:'data:image/svg+xml;base64,PHN2Zz4='}]},{images:[{dataUrl:'data:image/png;base64,YWJjZA=='}]},{images:[{dataUrl:'data:image/png;base64,'+Buffer.alloc(2*1024*1024+1).toString('base64')}]}])await assert.rejects(()=>store.create('Teacher',{...input(),...patch}));assert.equal((await store.list()).length,0);
});
test('review updates retain original evidence and reject unknown statuses',async t=>{
 const {store}=await fixture(t);const item=await store.create('Teacher',input());await store.update(item.id,{status:'ready-for-review',validation:'9 项通过',candidateCommit:'abc123',text:'must-not-overwrite'});const next=await store.get(item.id);assert.equal(next.text,item.text);assert.equal(next.status,'ready-for-review');assert.deepEqual(next.images,item.images);await assert.rejects(()=>store.update(item.id,{status:'made-up'}));
});
test('routes enforce login, owner isolation, private image access, and same-origin submission',async t=>{
 const {root,store}=await fixture(t);const item=await store.create('Teacher',input());const app=express();app.use(express.json({limit:'10mb'}));app.use('/api',createUserFeedbackRoutes({storePath:root,requireLoggedInSession(req,res){if(!req.get('x-test-user')){res.status(401).end();return null;}return{username:req.get('x-test-user')};}}));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));const origin=`http://127.0.0.1:${server.address().port}`;
 assert.equal((await fetch(origin+'/api/user-feedback')).status,401);
 const own=await fetch(origin+'/api/user-feedback',{headers:{'x-test-user':'Teacher'}});assert.match(own.headers.get('cache-control'),/no-store/);const ownData=await own.json();assert.equal(ownData.items.length,1);assert.equal(ownData.items[0].owner,undefined);
 assert.equal((await (await fetch(origin+'/api/user-feedback',{headers:{'x-test-user':'Other'}})).json()).items.length,0);
 assert.equal((await fetch(origin+ownData.items[0].images[0].url,{headers:{'x-test-user':'Other'}})).status,404);
 assert.equal((await fetch(origin+ownData.items[0].images[0].url,{headers:{'x-test-user':'Teacher'}})).status,200);
 assert.equal((await fetch(origin+'/api/user-feedback',{method:'POST',headers:{'x-test-user':'Teacher','Content-Type':'application/json',Origin:'https://unrelated.test'},body:JSON.stringify(input('request-second'))})).status,403);
 const retry=await fetch(origin+'/api/user-feedback',{method:'POST',headers:{'x-test-user':'Teacher','Content-Type':'application/json'},body:JSON.stringify(input())});assert.equal(retry.status,201);assert.equal((await retry.json()).item.id,item.id);
});
test('daily digest uses Shanghai dates, includes old open work, and separates candidate from released',()=>{
 const items=[{id:'FB-a',text:'布局',status:'ready-for-review',createdAt:'2026-09-07T17:00:00Z',updatedAt:'2026-09-07T17:00:00Z',candidateCommit:'abc',validation:'已验证'}, {id:'FB-b',text:'旧反馈',status:'needs-info',createdAt:'2026-09-05T00:00:00Z',updatedAt:'2026-09-05T00:00:00Z'}];
 const report=digest(items,'2026-09-08');assert.match(report,/今日新增 1 条/);assert.match(report,/修复待验收 1 条/);assert.match(report,/旧反馈/);assert.match(report,/待验收版本：abc/);assert.match(digest([],'2026-09-08'),/暂无需要处理/);
});
test('daily sender records success once and preserves an uncertain send lock',async t=>{
 const {spawnSync}=require('node:child_process');const {root}=await fixture(t);const connector=path.join(root,'connector');await fs.mkdir(connector);const count=path.join(root,'send-count');
 await fs.writeFile(path.join(connector,'cli.js'),`const fs=require('node:fs');fs.appendFileSync(${JSON.stringify(count)},'sent\\n');console.log(JSON.stringify({ok:true,deliveryId:'qa-only'}));`);
 const cli=path.resolve(__dirname,'../scripts/user-feedback.cjs'),env={...process.env,REMOTELAB_PROJECT_ROOT:connector};
 const run=()=>spawnSync(process.execPath,[cli,'send','--root',root,'--date','2026-09-08'],{encoding:'utf8',env});
 assert.equal(run().status,0);assert.equal(run().status,0);assert.equal((await fs.readFile(count,'utf8')).trim(),'sent');
 await fs.writeFile(path.join(root,'.daily','2026-09-09.lock'),'pending');const uncertain=spawnSync(process.execPath,[cli,'send','--root',root,'--date','2026-09-09'],{encoding:'utf8',env});assert.equal(uncertain.status,1);assert.match(uncertain.stderr,/不自动重发/);assert.equal((await fs.readFile(count,'utf8')).trim(),'sent');
});
