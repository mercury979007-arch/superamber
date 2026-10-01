const test=require('node:test');
const assert=require('node:assert/strict');
const {freshAgentPermissions,readAgentPermissionMap}=require('../lib/agentPermissionRead');
test('overlapping authorization reads share work, not completed permissions or another account',async()=>{
 let reads=0,resolve;const scraper={getClassMap:async(force,options)=>{assert.equal(force,true);assert.equal(options.authorization,true);reads++;return new Promise(r=>resolve=r);}};
 const a=freshAgentPermissions(scraper),b=freshAgentPermissions(scraper);await new Promise(r=>setImmediate(r));assert.equal(reads,1);resolve(['fresh']);assert.deepEqual(await a,await b);
 const c=freshAgentPermissions(scraper);await new Promise(r=>setImmediate(r));assert.equal(reads,2);resolve(['changed']);assert.deepEqual(await c,['changed']);
 const other={getClassMap:async()=>['other']};assert.deepEqual(await freshAgentPermissions(other),['other']);
});
test('permission deadline aborts upstream and a later request can recover without stale data',async()=>{
 let signal;const scraper={getClassMap:async(_,o)=>{signal=o.signal;return new Promise(()=>{});}};
 await assert.rejects(freshAgentPermissions(scraper,{timeoutMs:15}),e=>e.code==='SOURCE_PERMISSION_TIMEOUT');assert.equal(signal.aborted,true);
 scraper.getClassMap=async()=>['recovered'];assert.deepEqual(await freshAgentPermissions(scraper),['recovered']);
});
test('both permission branches start concurrently, merge real classes, no browser fallback or stale subset',async()=>{
 const paths=[];let release;const hold=new Promise(r=>release=r);
 const scraper={username:'fixture',classMapCache:[{classCode:'OLD'}],requestText:async(url,options)=>{assert.ok(options.signal);paths.push(url);if(paths.length===2)release();await hold;return {response:{ok:true,status:200,url},text:url==='/admin/my_squad'?'<a href="/admin/squad_console?id=1">K218</a>':'/admin/dashboard/getSquadData?id=3'};},requestJson:async()=>({response:{ok:true},data:{myClasses:[{id:2,name:'C²-2',type:'offline'}]}}),isLoginPage:()=>false,extractClassMapFromHtml:()=>{throw Error('must not fallback');}};
 const rows=await readAgentPermissionMap(scraper,new AbortController().signal);assert.deepEqual(rows.map(r=>r.classCode).sort(),['C²-2','K218']);assert.equal(scraper.lastClassMapTiming.authorization,true);
 scraper.requestJson=async()=>({response:{ok:true},data:{}});await assert.rejects(readAgentPermissionMap(scraper,new AbortController().signal),e=>e.code==='SOURCE_PERMISSION_UNAVAILABLE');
});
test('authoritative login expiry differs from a temporary dependency failure',async()=>{
 const scraper={requestText:async()=>({response:{ok:false,status:401,url:'/auth/login'},text:''}),isLoginPage:()=>true};
 await assert.rejects(readAgentPermissionMap(scraper,new AbortController().signal),e=>e.code==='SOURCE_LOGIN_EXPIRED');
});
