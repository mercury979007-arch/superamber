const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { summarizeUsageEvents } = require('../lib/usageAnalytics');

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address()));
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function requestSummaryWithHost(port, host) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: '/api/admin/usage-summary?days=30',
      method: 'GET',
      headers: {
        Host: host,
        Origin: `https://${host}`,
      },
    }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          body: raw ? JSON.parse(raw) : {},
        });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

test('unauthenticated usage events are recorded but kept out of verified account metrics', async () => {
  const usageLogPath = path.join(os.tmpdir(), `classsitdown-usage-${Date.now()}.jsonl`);
  process.env.CLASSSITDOWN_USAGE_LOG_PATH = usageLogPath;

  delete require.cache[require.resolve('../server')];
  const { app } = require('../server');
  const backend = http.createServer(app);
  const backendAddress = await listen(backend);
  const baseUrl = `http://${backendAddress.address}:${backendAddress.port}`;

  try {
    const firstResponse = await fetch(`${baseUrl}/api/usage-events`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'Mozilla/5.0 Test Browser',
        'x-forwarded-for': '1.2.3.4',
      },
      body: JSON.stringify({
        event: 'screen_view',
        module: 'daily-report',
        teacherName: 'Amber',
        className: 'K123',
        screen: 'daily-report',
      }),
    });
    assert.equal(firstResponse.status, 200);

    const secondResponse = await fetch(`${baseUrl}/api/usage-events`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'Mozilla/5.0 Test Browser',
        'x-forwarded-for': '1.2.3.4',
      },
      body: JSON.stringify({
        event: 'screen_view',
        module: 'overview',
        teacherName: 'Amber',
        className: 'K123',
        screen: 'overview',
      }),
    });
    assert.equal(secondResponse.status, 200);

    const thirdResponse = await fetch(`${baseUrl}/api/usage-events`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'Mozilla/5.0 Test Browser',
        'x-forwarded-for': '1.2.3.4',
      },
      body: JSON.stringify({
        event: 'minipin_issued',
        module: 'mp-distribution',
        teacherName: 'Amber',
        className: 'K123',
        mpTotal: 12,
        studentCount: 6,
        successCount: 6,
      }),
    });
    assert.equal(thirdResponse.status, 200);

    const summaryResponse = await fetch(`${baseUrl}/api/admin/usage-summary?days=30`);
    assert.equal(summaryResponse.status, 200);
    const summaryJson = await summaryResponse.json();

    assert.equal(summaryJson.status, 'success');
    assert.equal(summaryJson.summary.totalEvents, 0);
    assert.equal(summaryJson.summary.uniqueUsers, 0);
    assert.deepEqual(summaryJson.summary.byUser, []);
    assert.deepEqual(summaryJson.summary.byTool, []);
    assert.equal(summaryJson.summary.dataQuality.unverifiedEventCount, 3);
    assert.equal(summaryJson.summary.dataQuality.unverifiedUserCount, 1);
    assert.deepEqual(summaryJson.summary.identity, {
      verifiedUsers: 0,
      observedUsers: 1,
      unverifiedUsers: 1,
      mergedCaseVariants: 0,
    });
  } finally {
    await close(backend);
    await fs.rm(usageLogPath, { force: true }).catch(() => {});
    delete process.env.CLASSSITDOWN_USAGE_LOG_PATH;
  }
});

test('usage summary can read from a separate summary log path', async () => {
  const usageLogPath = path.join(os.tmpdir(), `classsitdown-usage-local-${Date.now()}.jsonl`);
  const summaryLogPath = path.join(os.tmpdir(), `classsitdown-usage-summary-${Date.now()}.jsonl`);
  process.env.CLASSSITDOWN_USAGE_LOG_PATH = usageLogPath;
  process.env.CLASSSITDOWN_USAGE_SUMMARY_LOG_PATH = summaryLogPath;

  const summaryEvent = {
    ts: new Date().toISOString(),
    event: 'screen_view',
    module: 'makeup',
    teacherName: 'ProdAmber',
    className: 'K888',
    screen: 'makeup',
    ip: '8.8.8.8',
    userAgent: 'Mozilla/5.0 Production Browser',
    authenticated: true,
    env: 'production',
    mpTotal: 0,
    studentCount: 0,
    successCount: 0,
    failedCount: 0,
  };
  await fs.writeFile(summaryLogPath, `${JSON.stringify(summaryEvent)}\n`, 'utf8');

  delete require.cache[require.resolve('../server')];
  const { app } = require('../server');
  const backend = http.createServer(app);
  const backendAddress = await listen(backend);
  const baseUrl = `http://${backendAddress.address}:${backendAddress.port}`;

  try {
    const writeResponse = await fetch(`${baseUrl}/api/usage-events`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'Mozilla/5.0 Test Browser',
        'x-forwarded-for': '1.2.3.4',
      },
      body: JSON.stringify({
        event: 'screen_view',
        module: 'daily-report',
        teacherName: 'StagingAmber',
        className: 'J328',
        screen: 'daily-report',
      }),
    });
    assert.equal(writeResponse.status, 200);

    const summaryResponse = await fetch(`${baseUrl}/api/admin/usage-summary?days=30`);
    assert.equal(summaryResponse.status, 200);
    const summaryJson = await summaryResponse.json();

    assert.equal(summaryJson.sourceEnvironment, 'external');
    assert.equal(summaryJson.summary.totalEvents, 1);
    assert.deepEqual(summaryJson.summary.byUser, [
      { teacherName: 'ProdAmber', count: 1 },
    ]);
    assert.deepEqual(summaryJson.summary.byTool, [
      { tool: '补课助手', count: 1 },
    ]);
  } finally {
    await close(backend);
    await fs.rm(usageLogPath, { force: true }).catch(() => {});
    await fs.rm(summaryLogPath, { force: true }).catch(() => {});
    delete process.env.CLASSSITDOWN_USAGE_LOG_PATH;
    delete process.env.CLASSSITDOWN_USAGE_SUMMARY_LOG_PATH;
  }
});

test('usage summary blocks production-like hosts', async () => {
  const usageLogPath = path.join(os.tmpdir(), `classsitdown-usage-guard-${Date.now()}.jsonl`);
  process.env.CLASSSITDOWN_USAGE_LOG_PATH = usageLogPath;

  delete require.cache[require.resolve('../server')];
  const { app } = require('../server');
  const backend = http.createServer(app);
  const backendAddress = await listen(backend);

  try {
    const response = await requestSummaryWithHost(backendAddress.port, 'superamber.example.invalid');
    assert.equal(response.status, 403);
    assert.equal(response.body.error, '该页面仅在测试站开放');
  } finally {
    await close(backend);
    await fs.rm(usageLogPath, { force: true }).catch(() => {});
    delete process.env.CLASSSITDOWN_USAGE_LOG_PATH;
  }
});

test('usage summary requires a logged-in teacher on the public staging host', async () => {
  const usageLogPath = path.join(os.tmpdir(), `classsitdown-usage-auth-${Date.now()}.jsonl`);
  process.env.CLASSSITDOWN_USAGE_LOG_PATH = usageLogPath;

  delete require.cache[require.resolve('../server')];
  const { app } = require('../server');
  const backend = http.createServer(app);
  const backendAddress = await listen(backend);

  try {
    const response = await requestSummaryWithHost(backendAddress.port, 'staging.example.invalid');
    assert.equal(response.status, 401);
    assert.equal(response.body.error, '请先登录后查看使用统计');
  } finally {
    await close(backend);
    await fs.rm(usageLogPath, { force: true }).catch(() => {});
    delete process.env.CLASSSITDOWN_USAGE_LOG_PATH;
  }
});

test('usage summary rounds minipin totals to single-decimal precision', () => {
  const now = new Date().toISOString();
  const summary = summarizeUsageEvents([
    {
      ts: now,
      event: 'minipin_issued',
      module: 'mp-distribution',
      teacherName: 'Lenny',
      mpTotal: 364.70000000000005,
      studentCount: 6,
      ip: '8.8.8.8',
      userAgent: 'Mozilla/5.0 Production Browser',
      authenticated: true,
    },
    {
      ts: now,
      event: 'minipin_issued',
      module: 'mp-distribution',
      teacherName: 'Joyce',
      mpTotal: 346.70000000000005,
      studentCount: 10,
      ip: '8.8.4.4',
      userAgent: 'Mozilla/5.0 Production Browser',
      authenticated: true,
    },
    {
      ts: now,
      event: 'minipin_issued',
      module: 'mp-distribution',
      teacherName: 'Halsey',
      mpTotal: 188.29999999999998,
      studentCount: 6,
      ip: '1.1.1.1',
      userAgent: 'Mozilla/5.0 Production Browser',
      authenticated: true,
    },
  ]);

  assert.equal(summary.minipin.totalMP, 899.7);
  assert.deepEqual(summary.minipin.byTeacher, [
    { teacherName: 'Lenny', totalMP: 364.7, actions: 1, students: 6 },
    { teacherName: 'Joyce', totalMP: 346.7, actions: 1, students: 10 },
    { teacherName: 'Halsey', totalMP: 188.3, actions: 1, students: 6 },
  ]);
});

test('usage summary groups daily activity by Shanghai calendar day', () => {
  const summary = summarizeUsageEvents([
    {
      ts: '2026-09-01T16:30:00.000Z',
      event: 'screen_view',
      module: 'daily-report',
      teacherName: 'Amber',
      ip: '8.8.8.8',
      userAgent: 'Mozilla/5.0 Production Browser',
      authenticated: true,
    },
  ]);

  assert.deepEqual(summary.daily, [
    { day: '2026-09-02', events: 1, activeUsers: 1 },
  ]);
});

test('usage summary merges username case variants and separates unverified identities', () => {
  const summary = summarizeUsageEvents([
    {
      ts: '2026-09-03T01:00:00.000Z',
      event: 'login_success',
      module: 'auth',
      teacherName: 'AmberZhang',
      ip: '8.8.8.8',
      userAgent: 'Mozilla/5.0 Production Browser',
    },
    {
      ts: '2026-09-03T01:01:00.000Z',
      event: 'screen_view',
      module: 'seating',
      teacherName: 'amberzhang',
      ip: '8.8.8.8',
      userAgent: 'Mozilla/5.0 Production Browser',
    },
    {
      ts: '2026-09-03T01:02:00.000Z',
      event: 'screen_view',
      module: 'seating',
      teacherName: 'QA',
      ip: '8.8.4.4',
      userAgent: 'Mozilla/5.0 Production Browser',
    },
  ]);

  assert.equal(summary.uniqueUsers, 1);
  assert.equal(summary.totalEvents, 2);
  assert.deepEqual(summary.byUser, [
    { teacherName: 'AmberZhang', count: 2 },
  ]);
  assert.deepEqual(summary.daily, [
    { day: '2026-09-03', events: 2, activeUsers: 1 },
  ]);
  assert.deepEqual(summary.identity, {
    verifiedUsers: 1,
    observedUsers: 2,
    unverifiedUsers: 1,
    mergedCaseVariants: 1,
  });
  assert.deepEqual(summary.dataQuality.unverifiedUsers, [
    { teacherName: 'QA', count: 1 },
  ]);
  assert.equal(summary.recentActivity[0].teacherName, 'AmberZhang');
});

test('usage summary exposes identified teacher activity and speaking MiniPin issues without raw session data', () => {
  const summary = summarizeUsageEvents([
    {
      ts: '2026-09-02T01:49:26.346Z',
      event: 'minipin_issued',
      module: 'speaking-challenge',
      teacherName: 'Amberzhang',
      className: 'J413',
      mpTotal: 1.2,
      studentCount: 4,
      successCount: 4,
      failedCount: 0,
      sessionId: 'must-not-leak',
      ip: '8.8.8.8',
      userAgent: 'Mozilla/5.0 Production Browser',
      authenticated: true,
    },
    {
      ts: '2026-09-02T02:00:00.000Z',
      event: 'screen_view',
      module: 'seating',
      teacherName: '匿名老师',
      ip: '8.8.4.4',
      userAgent: 'Mozilla/5.0 Production Browser',
      authenticated: true,
    },
  ]);

  assert.equal(summary.totalEvents, 1);
  assert.equal(summary.dataQuality.unidentifiedEventCount, 1);
  assert.deepEqual(summary.byTeacherTool, [
    { teacherName: 'Amberzhang', tool: '每日开口挑战', count: 1 },
  ]);
  assert.deepEqual(summary.speakingMinipin, {
    totalMP: 1.2,
    totalActions: 1,
    totalStudents: 4,
    recent: [{
      ts: '2026-09-02T01:49:26.346Z',
      teacherName: 'Amberzhang',
      className: 'J413',
      totalMP: 1.2,
      studentCount: 4,
      successCount: 4,
      failedCount: 0,
    }],
  });
  assert.equal(summary.recentActivity[0].tool, '每日开口挑战');
  assert.equal(summary.recentActivity[0].action, '发放 MiniPin');
  assert.equal('sessionId' in summary.recentActivity[0], false);
  assert.equal('ip' in summary.recentActivity[0], false);
});
