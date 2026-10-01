const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createClassroomAgentApiRouter } = require('../routes/classroomAgentRoutes');

test('revoke during an in-flight fresh permission check wins over its successful response',async()=>{
 const {issueReadGrant,revokeReadGrant}=require('../routes/classroomAgentRoutes');let release,started;
 const entered=new Promise(r=>started=r);const session={username:'fixture',scraper:{getClassMap:async()=>{started();await new Promise(r=>release=r);return [{classCode:'K218',squadId:'1'}];}}};
 const sessions=new Map([['a',session]]),grant=issueReadGrant(session);
 const app=express();app.use(express.json());app.use('/api',createClassroomAgentApiRouter({sessions,ensureSession:()=>({session})}));
 const server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));});
 try{const request=fetch(`http://127.0.0.1:${server.address().port}/api/classroom-agent/read-grant/exchange`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:grant.token})});
 await entered;revokeReadGrant(sessions,grant.token);release();assert.equal((await request).status,401);
 }finally{await new Promise(r=>server.close(r));}
});

test('grant HTTP lifecycle: authorization, persistence/reload, isolation, transient errors and revocation', async () => {
  const sessions = new Map();
  let snapshot, failPersist = false, failRead = false;
  const scraper = code => ({ getClassMap: async () => {
    if (failRead) throw new Error('temporary upstream failure');
    return [{ classCode: code, squadId: `squad-${code}` }];
  } });
  sessions.set('teacher-a', { username: 'fixture-a', scraper: scraper('K218') });
  sessions.set('teacher-b', { username: 'fixture-b', scraper: scraper('K339') });
  const app = express();
  app.use(express.json());
  app.use('/api', createClassroomAgentApiRouter({ sessions,
    ensureSession: req => ({ session: sessions.get(req.headers['x-test-session']) || {} }),
    persistSessions: async () => {
      if (failPersist) throw new Error('disk failure');
      snapshot = JSON.parse(JSON.stringify([...sessions].map(([sid,s]) => ({ sid, username:s.username, grants:[...(s.agentReadGrants || new Map())] }))));
    },
  }));
  const server = await new Promise(resolve => { const s=app.listen(0,'127.0.0.1',()=>resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api/classroom-agent/`;
  async function post(path, body = {}, sid = '') {
    const r=await fetch(base+path,{method:'POST',headers:{'content-type':'application/json','x-test-session':sid},body:JSON.stringify(body)});
    return {status:r.status, body:await r.json()};
  }
  try {
    assert.equal((await post('read-grant')).status,401);
    assert.equal((await post('read-grant/exchange',{token:'unknown'})).status,401);
    failPersist=true;
    assert.equal((await post('read-grant',{},'teacher-a')).status,502);
    failPersist=false;
    const a=await post('read-grant',{},'teacher-a'), b=await post('read-grant',{},'teacher-b');
    assert.equal(a.status,200); assert.equal(b.status,200);
    assert.notEqual(a.body.token,b.body.token);
    assert.ok(!JSON.stringify(snapshot).includes(a.body.token));
    // Simulate server restart from serialized grant hashes, not plaintext tokens.
    sessions.clear();
    for(const s of snapshot) sessions.set(s.sid,{username:s.username,scraper:scraper(s.sid==='teacher-a'?'K218':'K339'),agentReadGrants:new Map(s.grants)});
    const ar=await post('read-grant/exchange',{token:a.body.token});
    const br=await post('read-grant/exchange',{token:b.body.token});
    assert.equal(ar.body.classes[0].id,'K218');
    assert.equal(br.body.classes[0].id,'K339');
    failRead=true;
    assert.equal((await post('read-grant/exchange',{token:a.body.token})).status,502);
    failRead=false;
    assert.equal((await post('read-grant/exchange',{token:a.body.token})).status,200);
    await post('read-grant/revoke',{token:a.body.token});
    assert.equal((await post('read-grant/exchange',{token:a.body.token})).status,401);
    assert.equal((await post('read-grant/exchange',{token:b.body.token})).status,200);
  } finally { await new Promise(resolve=>server.close(resolve)); }
});
