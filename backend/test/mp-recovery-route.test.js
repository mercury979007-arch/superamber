const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

test('mounted recovery routes require login, expose context and deduplicate batch submissions', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mp-recovery-route-'));
  process.env.SESSION_STORE_DIR = directory;
  process.env.CLASSSITDOWN_USAGE_LOG_PATH = path.join(directory, 'usage.jsonl');
  const { app, sessions } = require('../server');
  let calls = 0;
  sessions.set('mock-recovery-teacher', { username: 'mock', lastSeenAt: Date.now(), scraper: {
    getMinipinRecoveryContext: async () => ({ defaultReason: '行为习惯', students: [{ no: '1001', availableMp: 2 }], tags: [{ name: '行为习惯' }] }),
    recoverMinipinDirect: async (classId, rows, reason) => {
      calls += 1;
      assert.equal(classId, 'K218'); assert.equal(reason, '行为习惯');
      assert.deepEqual(rows, [{ studentId: '1001', amount: 0.5 }]);
      return { success: 1, failed: 0, totalMP: 0.5 };
    },
  } });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { sessions.clear(); await new Promise((resolve) => server.close(resolve)); await fs.rm(directory, { recursive: true, force: true }); });
  const post = (route, payload, authenticated = true) => fetch(`http://127.0.0.1:${server.address().port}${route}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(authenticated ? { cookie: 'amber_sid=mock-recovery-teacher' } : {}) }, body: JSON.stringify(payload),
  });
  assert.equal((await post('/api/scraper/recover-minipin', {}, false)).status, 401);
  const context = await post('/api/mp/recovery-context', { classId: 'K218' });
  assert.equal((await context.json()).defaultReason, '行为习惯');
  const payload = { classId: 'K218', requestId: 'mock-request-00001', recoveries: [{ studentId: '1001', amount: 0.5 }] };
  assert.equal((await post('/api/scraper/recover-minipin', payload)).status, 200);
  const repeated = await post('/api/scraper/recover-minipin', payload);
  assert.equal((await repeated.json()).duplicate, true);
  assert.equal(calls, 1);
});
