const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

test('production host exposes authenticated reports and recovery but blocks private tools', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'report-release-access-'));
  process.env.SESSION_STORE_DIR = directory;
  process.env.CLASSSITDOWN_USAGE_LOG_PATH = path.join(directory, 'usage.jsonl');
  const { app } = require('../server');
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await fs.rm(directory, { recursive: true, force: true }); });
  const request = (route, method = 'POST') => fetch('http://127.0.0.1:' + server.address().port + route, {
    method, headers: { 'x-forwarded-host': 'superamber.example.invalid', 'content-type': 'application/json' },
    ...(method === 'POST' ? { body: '{}' } : {}),
  });
  for (const route of ['/api/data/class-control/task-report', '/api/mp/recovery-context', '/api/scraper/recover-minipin']) {
    assert.equal((await request(route)).status, 401, route + ' requires login, not test environment');
  }
  for (const route of ['/api/score-book/tasks', '/api/score-book/roster', '/api/score-book/submit', '/api/scraper/batch-student-list', '/api/classroom-agent/delegation']) {
    assert.equal((await request(route)).status, 403, route + ' remains private');
  }
  assert.equal((await request('/classroom-agent/', 'GET')).status, 403);
});
