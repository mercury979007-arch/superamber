const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const { createRosterSnapshotRoutes, toPublicSnapshot } = require('../routes/rosterSnapshotRoutes');

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address())));
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

test('public task catalog retains its official semester label', () => {
  const snapshot = toPublicSnapshot({
    dailyReportTasks: {
      J101: {
        classId: 'J101',
        preferredSemester: '2026学年春季学期',
        weekTasks: [{ id: 'Week2', name: 'Week2', resourceCount: 5 }],
      },
    },
    speakingChallengeMeta: {
      J101: { classId: 'J101', rangeStart: '2026-08-31', rangeEnd: '2026-09-02', studentCount: 12 },
    },
    dailyReportPublicities: {
      J101: { Week2: { tableRows: [['中文名'], ['张三']] } },
    },
    dailyReportPublicityFailures: [{ classId: 'J101', error: 'private upstream detail' }],
  });
  assert.equal(snapshot.dailyReportTasks[0].preferredSemester, '2026学年春季学期');
  assert.equal(snapshot.speakingChallenges[0].classId, 'J101');
  assert.equal(snapshot.speakingChallengeMeta, undefined);
  assert.equal(snapshot.dailyReportPublicities, undefined);
  assert.equal(snapshot.dailyReportPublicityFailures, undefined);
});

test('roster snapshot routes require login and use the authenticated teacher identity', async () => {
  const calls = [];
  const app = express();
  app.use(express.json());
  app.use('/api', createRosterSnapshotRoutes({
    requireLoggedInSession(req, res) {
      if (req.headers.authorization !== 'ready') {
        res.status(401).json({ error: '未登录，请先登录' });
        return null;
      }
      return { username: 'AmberZhang', scraper: { id: 'scraper' } };
    },
    service: {
      async get(username) {
        calls.push(['get', username]);
        return { snapshot: null, state: 'empty', stale: true, ageMs: null };
      },
      async refresh(input) {
        calls.push(['refresh', input.username, input.reason, input.context.academicWeek]);
        return {
          deduplicated: false,
          snapshot: { failures: [], classes: [], rosters: [], totalStudents: 0 },
        };
      },
    },
    buildContext: () => ({ academicWeek: 1 }),
  }));
  const server = http.createServer(app);
  const address = await listen(server);
  const baseUrl = `http://${address.address}:${address.port}`;

  try {
    const blocked = await fetch(`${baseUrl}/api/data/roster-snapshot`);
    assert.equal(blocked.status, 401);
    assert.deepEqual(calls, []);

    const read = await fetch(`${baseUrl}/api/data/roster-snapshot`, {
      headers: { authorization: 'ready' },
    });
    assert.equal(read.status, 200);

    const refreshed = await fetch(`${baseUrl}/api/data/roster-snapshot/refresh`, {
      method: 'POST',
      headers: { authorization: 'ready', 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'homepage', username: 'somebody-else' }),
    });
    assert.equal(refreshed.status, 200);
    assert.deepEqual(calls, [
      ['get', 'AmberZhang'],
      ['refresh', 'AmberZhang', 'homepage', 1],
    ]);
  } finally {
    await close(server);
  }
});

test('failed report prefetch is partial even when catalog and speaking reads succeeded', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', createRosterSnapshotRoutes({
    requireLoggedInSession: () => ({ username: 'teacher', scraper: {} }),
    service: { async refresh() { return { snapshot: {
      failures: [], taskFailures: [], speakingFailures: [],
      dailyReportPublicityFailures: [{ classId: 'J101', error: 'private upstream details' }],
      classes: [], rosters: [], totalStudents: 0,
    } }; } },
  }));
  const server = http.createServer(app);
  const address = await listen(server);
  try {
    const response = await fetch(`http://${address.address}:${address.port}/api/data/roster-snapshot/refresh`, { method: 'POST' });
    const result = await response.json();
    assert.equal(result.status, 'partial');
    assert.equal(result.snapshot.dailyReportPublicityFailures, undefined);
    assert.equal(JSON.stringify(result).includes('private upstream'), false);
  } finally { await close(server); }
});
