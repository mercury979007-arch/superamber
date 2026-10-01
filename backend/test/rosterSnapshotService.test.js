const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const {
  createRosterSnapshotService,
  millisecondsUntilNextShanghaiRun,
  startDailyRosterPrefetch,
} = require('../services/rosterSnapshotService');

async function makeStore() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'superamber-roster-snapshot-'));
  return { dir, storePath: path.join(dir, 'snapshots.json') };
}

function makeScraper({ failClass = '', gate = null } = {}) {
  const counters = { classMap: 0, classMapForces: [], roster: 0 };
  return {
    counters,
    async getClassMap(forceRefresh = false) {
      counters.classMap += 1;
      counters.classMapForces.push(forceRefresh);
      if (gate) await gate;
      return [
        { classCode: 'J101', squadId: '101' },
        { classCode: 'K202', squadId: '202' },
      ];
    },
    async request(url) {
      counters.roster += 1;
      const squadId = new URL(url, 'https://example.test').searchParams.get('squad_id');
      if (failClass === squadId) {
        throw new Error('upstream unavailable');
      }
      return {
        status: 200,
        async json() {
          return {
            data: [{ no: `${squadId}-1`, ch_name: `学生${squadId}`, en_name: `Student ${squadId}` }],
          };
        },
      };
    },
  };
}

test('roster snapshot persists per teacher with private file permissions', async (t) => {
  const { dir, storePath } = await makeStore();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const service = createRosterSnapshotService({ storePath, now: () => Date.parse('2026-08-30T22:00:00Z') });

  const result = await service.refresh({ username: 'AmberZhang', scraper: makeScraper(), reason: 'homepage' });
  assert.equal(result.deduplicated, false);
  assert.equal(result.snapshot.rosters.length, 2);
  assert.equal(result.snapshot.totalStudents, 2);
  assert.equal(result.snapshot.lastCompleteAt, '2026-08-30T22:00:00.000Z');

  const saved = JSON.parse(await fs.readFile(storePath, 'utf8'));
  assert.equal(Object.values(saved.snapshots)[0].username, 'AmberZhang');
  assert.equal((await fs.stat(storePath)).mode & 0o777, 0o600);

  const restored = createRosterSnapshotService({ storePath, now: () => Date.parse('2026-08-30T22:01:00Z') });
  const snapshot = await restored.get('AMBERZHANG');
  assert.equal(snapshot.state, 'fresh');
  assert.equal(snapshot.snapshot.rosters[0].students[0].chName, '学生101');
});

test('server mode returns rosters to the browser without persisting student data', async (t) => {
  const { dir, storePath } = await makeStore();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const service = createRosterSnapshotService({
    storePath,
    persistRosters: false,
    now: () => Date.parse('2026-08-30T22:00:00Z'),
    async fetchDailyReportTasks({ classId }) {
      return {
        classId,
        preferredYear: '2026',
        preferredSemester: '2026学年春季学期',
        weekMap: { Week12: [`${classId}-task`] },
        weekSourceLabels: { Week12: ['Week12'] },
        weekTasks: [{ id: 'Week12', name: 'Week12', resourceCount: 1 }],
        defaultSelectedWeekIds: ['Week12'],
        defaultCheckinRange: {},
        updatedAt: '2026-08-30T22:00:00.000Z',
      };
    },
  });

  const result = await service.refresh({ username: 'AmberZhang', scraper: makeScraper(), reason: 'homepage' });
  assert.equal(result.snapshot.rosters.length, 2);
  assert.equal(result.snapshot.totalStudents, 2);

  const savedText = await fs.readFile(storePath, 'utf8');
  const saved = JSON.parse(savedText);
  assert.equal(savedText.includes('学生101'), false);
  const savedSnapshot = Object.values(saved.snapshots)[0];
  assert.match(Object.keys(saved.snapshots)[0], /^u_[a-f0-9]{24}$/);
  assert.equal(savedSnapshot.username, '');
  assert.deepEqual(savedSnapshot.rosters, []);
  assert.equal(savedSnapshot.totalStudents, 0);
  assert.equal(savedSnapshot.dailyReportTasks.J101.weekTasks[0].id, 'Week12');
});

test('homepage data refresh can skip roster requests entirely', async (t) => {
  const { dir, storePath } = await makeStore();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const scraper = makeScraper();
  const taskCalls = [];
  const service = createRosterSnapshotService({
    storePath,
    persistRosters: false,
    fetchRosters: false,
    async fetchDailyReportTasks({ classId }) {
      taskCalls.push(classId);
      return {
        classId,
        weekMap: {},
        weekSourceLabels: {},
        weekTasks: [],
        defaultSelectedWeekIds: [],
        defaultCheckinRange: {},
        updatedAt: '2026-09-02T02:00:00.000Z',
      };
    },
  });

  const result = await service.refresh({ username: 'teacher', scraper, reason: 'homepage' });
  assert.equal(scraper.counters.classMap, 1);
  assert.equal(scraper.counters.roster, 0);
  assert.deepEqual(result.snapshot.rosters, []);
  assert.equal(result.snapshot.totalStudents, 0);
  assert.deepEqual(taskCalls.sort(), ['J101', 'K202']);
});

test('same-day homepage entry reuses the prepared snapshot when the current classes still match', async (t) => {
  const { dir, storePath } = await makeStore();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const scraper = makeScraper();
  const service = createRosterSnapshotService({ storePath, fetchRosters: false });
  const context = { dataDate: '2026-09-02' };

  await service.refresh({ username: 'teacher', scraper, reason: 'daily', context });
  assert.equal(scraper.counters.classMap, 1);

  const homepage = await service.refresh({ username: 'teacher', scraper, reason: 'homepage', context });
  assert.equal(homepage.skipped, true);
  assert.equal(scraper.counters.classMap, 2);
  assert.deepEqual(scraper.counters.classMapForces, [false, true]);

  const manual = await service.refresh({ username: 'teacher', scraper, reason: 'manual', context });
  assert.equal(manual.skipped, undefined);
  assert.equal(scraper.counters.classMap, 3);
});

test('same-day homepage entry rebuilds the snapshot when the teacher class list changes', async (t) => {
  const { dir, storePath } = await makeStore();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const scraper = makeScraper();
  const originalGetClassMap = scraper.getClassMap.bind(scraper);
  let addedClass = false;
  scraper.getClassMap = async (forceRefresh = false) => {
    const classes = await originalGetClassMap(forceRefresh);
    return addedClass
      ? [...classes, { classCode: 'K303', squadId: '303' }]
      : classes;
  };
  const service = createRosterSnapshotService({ storePath, fetchRosters: false });
  const context = { dataDate: '2026-09-02' };

  await service.refresh({ username: 'teacher', scraper, reason: 'daily', context });
  addedClass = true;

  const homepage = await service.refresh({ username: 'teacher', scraper, reason: 'homepage', context });
  assert.equal(homepage.skipped, undefined);
  assert.deepEqual(homepage.snapshot.classes.map((item) => item.id), ['J101', 'K202', 'K303']);
  assert.equal(scraper.counters.classMap, 2);
  assert.deepEqual(scraper.counters.classMapForces, [false, true]);
});

test('server mode removes legacy roster rows when loading an older snapshot file', async (t) => {
  const { dir, storePath } = await makeStore();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.writeFile(storePath, JSON.stringify({
    version: 1,
    snapshots: {
      teacher: {
        version: 1,
        username: 'Teacher',
        classes: [{ id: 'J101', name: 'J101' }],
        rosters: [{ classId: 'J101', students: [{ no: '1', chName: '历史学生', enName: 'Old' }] }],
        failures: [],
        dailyReportTasks: {},
        taskFailures: [],
        totalStudents: 1,
        updatedAt: '2026-08-30T22:00:00.000Z',
        lastCompleteAt: '2026-08-30T22:00:00.000Z',
      },
    },
  }));

  const service = createRosterSnapshotService({ storePath, persistRosters: false });
  const result = await service.get('teacher');
  assert.deepEqual(result.snapshot.rosters, []);
  assert.equal(result.snapshot.username, '');
  const savedText = await fs.readFile(storePath, 'utf8');
  assert.equal(savedText.includes('历史学生'), false);
});

test('same-teacher concurrent refreshes share one upstream job', async (t) => {
  const { dir, storePath } = await makeStore();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const scraper = makeScraper({ gate });
  const service = createRosterSnapshotService({ storePath });

  const first = service.refresh({ username: 'teacher', scraper, reason: 'homepage' });
  const second = service.refresh({ username: 'teacher', scraper, reason: 'manual' });
  release();
  const [firstResult, secondResult] = await Promise.all([first, second]);

  assert.equal(firstResult.deduplicated, false);
  assert.equal(secondResult.deduplicated, true);
  assert.equal(scraper.counters.classMap, 1);
  assert.equal(scraper.counters.roster, 2);
});

test('partial refresh retains the last usable roster for failed classes', async (t) => {
  const { dir, storePath } = await makeStore();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  let nowMs = Date.parse('2026-08-30T22:00:00Z');
  const service = createRosterSnapshotService({ storePath, now: () => nowMs });
  await service.refresh({ username: 'teacher', scraper: makeScraper() });

  nowMs += 60_000;
  const partial = await service.refresh({ username: 'teacher', scraper: makeScraper({ failClass: '202' }) });
  assert.equal(partial.snapshot.failures.length, 1);
  assert.equal(partial.snapshot.rosters.length, 2);
  assert.equal(partial.snapshot.rosters.find((item) => item.classId === 'K202').students[0].no, '202-1');
  assert.equal(partial.snapshot.lastCompleteAt, '2026-08-30T22:00:00.000Z');
});

test('homepage refresh snapshots daily-report week tasks for every class', async (t) => {
  const { dir, storePath } = await makeStore();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const taskCalls = [];
  const service = createRosterSnapshotService({
    storePath,
    now: () => Date.parse('2026-08-30T22:00:00Z'),
    async fetchDailyReportTasks({ classId }) {
      taskCalls.push(classId);
      return {
        classId,
        preferredYear: '2026',
        preferredSemester: '2026学年秋季学期',
        weekMap: { 'Week 1': [`${classId}-task`] },
        weekSourceLabels: { 'Week 1': ['Week 1'] },
        weekTasks: [{ id: 'Week 1', name: 'Week 1', resourceCount: 1 }],
        defaultSelectedWeekIds: ['Week 1'],
        defaultCheckinRange: { start: '2026-08-31', end: '2026-09-06' },
        updatedAt: '2026-08-30T22:00:00.000Z',
      };
    },
  });

  const refreshed = await service.refresh({ username: 'teacher', scraper: makeScraper(), reason: 'homepage' });
  assert.deepEqual(taskCalls.sort(), ['J101', 'K202']);
  assert.equal(Object.keys(refreshed.snapshot.dailyReportTasks).length, 2);
  assert.equal(refreshed.snapshot.taskFailures.length, 0);

  const taskSnapshot = await service.getDailyReportTask('teacher', 'j101');
  assert.deepEqual(taskSnapshot.defaultSelectedWeekIds, ['Week 1']);
  assert.deepEqual(taskSnapshot.weekMap['Week 1'], ['J101-task']);
});

test('06:30 refresh persists usable report rows for each recent session date', async (t) => {
  const { dir, storePath } = await makeStore();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const publicityCalls = [];
  const service = createRosterSnapshotService({
    storePath,
    persistRosters: false,
    fetchRosters: false,
    now: () => Date.parse('2026-09-05T22:30:00Z'),
    async fetchDailyReportTasks({ classId }) {
      return {
        classId,
        weekTasks: [
          { id: 'tue-a', startAt: '2026-09-01 18:00:00' },
          { id: 'tue-b', startAt: '2026-09-01 18:00:00' },
          { id: 'sat', startAt: '2026-09-05 10:00:00' },
          { id: 'sun-browser-fallback', startAt: '2026-08-30 18:00:00' },
        ],
        weekMap: { 'sun-browser-fallback': ['开学第一课'] },
        weekSelectionMap: {
          'tue-a': { taskIds: ['101'] },
          'tue-b': { taskIds: ['102'] },
          sat: { taskIds: ['103'] },
        },
        hydratedWeekIds: ['tue-a', 'tue-b', 'sat'],
        defaultSelectedWeekIds: ['sat'],
        updatedAt: '2026-09-05T22:30:00.000Z',
      };
    },
    async fetchDailyReportPublicity({ classId, selectedWeekIds }) {
      publicityCalls.push([classId, [...selectedWeekIds]]);
      return { tableRows: [['英文名', '任务'], [`${classId}-Student`, '已完成']] };
    },
  });

  await service.refresh({ username: 'teacher', scraper: makeScraper(), reason: 'daily' });
  assert.deepEqual(publicityCalls, [
    ['J101', ['sat']],
    ['J101', ['tue-a', 'tue-b']],
    ['J101', ['sun-browser-fallback']],
    ['K202', ['sat']],
    ['K202', ['tue-a', 'tue-b']],
    ['K202', ['sun-browser-fallback']],
  ]);
  assert.equal(await service.getDailyReportPublicity('teacher', 'J101', ['tue-b', 'tue-a'], '101,102'), null);
  const cached = await service.getDailyReportPublicity('teacher', 'J101', ['tue-b', 'tue-a'], 'resource-columns-v2:resources:101,102');
  assert.equal(cached.tableRows[1][0], 'J101-Student');
  assert.equal(cached.updatedAt, '2026-09-05T22:30:00.000Z');

  const restored = createRosterSnapshotService({ storePath, persistRosters: false, fetchRosters: false });
  const restoredCache = await restored.getDailyReportPublicity('teacher', 'J101', ['tue-a', 'tue-b'], 'resource-columns-v2:resources:101,102');
  assert.equal(restoredCache.tableRows[1][1], '已完成');
});

test('homepage refresh preloads weekly speaking exports and shares active class work', async (t) => {
  const { dir, storePath } = await makeStore();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const challengeCalls = [];
  let releaseFirst;
  let markFirstStarted;
  const firstStarted = new Promise((resolve) => { markFirstStarted = resolve; });
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const service = createRosterSnapshotService({
    storePath,
    now: () => Date.parse('2026-09-02T02:00:00Z'),
    async fetchSpeakingChallenge({ classId, window }) {
      challengeCalls.push(classId);
      if (classId === 'J101') {
        markFirstStarted();
        await firstGate;
      }
      return {
        classCode: classId,
        totalStudents: 1,
        challenge: {
          id: window.id,
          start: window.start,
          end: window.end,
        },
        students: [{ studentId: `${classId}-1`, englishName: 'Sam', chineseName: '张三' }],
      };
    },
  });
  const window = { id: 'opening', start: '2026-08-31', end: '2026-09-02' };
  const fullRefresh = service.refresh({
    username: 'teacher',
    scraper: makeScraper(),
    reason: 'homepage',
    context: { speakingWindow: window },
  });
  await firstStarted;
  const sameClass = service.refreshSpeakingChallenge({
    username: 'teacher',
    scraper: makeScraper(),
    classId: 'J101',
    window,
  });
  releaseFirst();
  const [refreshed, shared] = await Promise.all([fullRefresh, sameClass]);

  assert.equal(shared.deduplicated, true);
  assert.deepEqual(challengeCalls.sort(), ['J101', 'K202']);
  assert.equal(Object.keys(refreshed.snapshot.speakingChallengeMeta).length, 2);
  assert.equal(refreshed.snapshot.speakingFailures.length, 0);
  assert.equal((await service.getSpeakingChallenge('teacher', 'J101', window)).classCode, 'J101');

  const persisted = await fs.readFile(storePath, 'utf8');
  assert.equal(persisted.includes('张三'), false);
  assert.equal(persisted.includes('Sam'), false);
});

test('same-teacher speaking exports are serialized across different classes', async (t) => {
  const { dir, storePath } = await makeStore();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  let active = 0;
  let maxActive = 0;
  const calls = [];
  const service = createRosterSnapshotService({
    storePath,
    async fetchSpeakingChallenge({ classId }) {
      calls.push(classId);
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 15));
      active -= 1;
      return { classCode: classId, challenge: {}, students: [] };
    },
  });
  const scraper = makeScraper();
  await Promise.all([
    service.refreshSpeakingChallenge({ username: 'teacher', scraper, classId: 'J101' }),
    service.refreshSpeakingChallenge({ username: 'teacher', scraper, classId: 'K202' }),
  ]);
  assert.deepEqual(calls, ['J101', 'K202']);
  assert.equal(maxActive, 1);
});

test('speaking refresh rejects a response labeled as another class', async (t) => {
  const { dir, storePath } = await makeStore();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const service = createRosterSnapshotService({
    storePath,
    async fetchSpeakingChallenge() {
      return { classCode: 'J413', challenge: {}, students: [] };
    },
  });
  await assert.rejects(
    service.refreshSpeakingChallenge({ username: 'teacher', scraper: makeScraper(), classId: 'J328' }),
    /请求 J328，返回 J413/,
  );
  assert.equal(await service.getSpeakingChallenge('teacher', 'J328'), null);
});

test('single-class task refresh is shared and becomes available without a full roster refresh', async (t) => {
  const { dir, storePath } = await makeStore();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  let taskCalls = 0;
  const service = createRosterSnapshotService({
    storePath,
    async fetchDailyReportTasks({ classId }) {
      taskCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return {
        classId,
        weekMap: {},
        weekSourceLabels: {},
        weekTasks: [],
        defaultSelectedWeekIds: [],
        defaultCheckinRange: {},
        updatedAt: '2026-08-30T22:00:00.000Z',
      };
    },
  });
  const scraper = makeScraper();
  const [first, second] = await Promise.all([
    service.refreshDailyReportTask({ username: 'teacher', scraper, classId: 'J101' }),
    service.refreshDailyReportTask({ username: 'teacher', scraper, classId: 'J101' }),
  ]);
  assert.equal(first.deduplicated, false);
  assert.equal(second.deduplicated, true);
  assert.equal(taskCalls, 1);
  assert.equal((await service.getDailyReportTask('teacher', 'J101')).classId, 'J101');
});

test('daily prefetch targets 06:30 Shanghai and deduplicates sessions by username', async () => {
  const nowMs = Date.parse('2026-08-30T20:00:00Z'); // 04:00 in Shanghai
  assert.equal(millisecondsUntilNextShanghaiRun(nowMs), 150 * 60 * 1000);

  let scheduledDelay = 0;
  let scheduledCallback = null;
  const calls = [];
  const stop = startDailyRosterPrefetch({
    sessions: new Map([
      ['a', { username: 'Teacher', scraper: {} }],
      ['b', { username: 'teacher', scraper: {} }],
      ['c', { username: 'Other', scraper: {} }],
    ]),
    service: {
      async refresh(input) { calls.push(input.username); },
    },
    now: () => nowMs,
    setTimer(callback, delay) {
      scheduledCallback = callback;
      scheduledDelay = delay;
      return { unref() {} };
    },
    clearTimer() {},
    logger: { log() {}, error() {} },
  });
  assert.equal(scheduledDelay, 150 * 60 * 1000);
  await scheduledCallback();
  assert.deepEqual(calls.sort(), ['Other', 'Teacher']);
  stop();
});

test('same-day homepage entry retries a partial snapshot and preserves usable data until recovery', async (t) => {
  const { dir, storePath } = await makeStore();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const service = createRosterSnapshotService({ storePath });
  const context = { dataDate: '2026-09-08' };
  await service.refresh({ username: 'teacher', scraper: makeScraper(), context });
  const failed = await service.refresh({ username: 'teacher', scraper: makeScraper({ failClass: '202' }), context });
  assert.equal(failed.snapshot.failures.length, 1);
  assert.equal(failed.snapshot.rosters.length, 2);
  const retry = makeScraper();
  const recovered = await service.refresh({ username: 'teacher', scraper: retry, reason: 'homepage', context });
  assert.equal(recovered.skipped, undefined);
  assert.equal(retry.counters.classMap, 1);
  assert.equal(recovered.snapshot.failures.length, 0);
  assert.equal((await service.get('teacher')).state, 'fresh');
});
