const test = require('node:test');
const assert = require('node:assert/strict');
const { createAsyncTtlCache } = require('../lib/dbShadow/cache');
const { compactSnapshot, expandCompactSnapshot } = require('../lib/dbShadow/compact');
const { createAsyncLimiter } = require('../lib/dbShadow/limiter');
const { parseCnf } = require('../lib/dbShadow/config');
const { buildStudentAssignmentQuery, buildTaskResourceQuery } = require('../lib/dbShadow/query');
const { expandAssignments, mergeAssignments } = require('../lib/dbShadow/pipeline');
const { reconcileRows, valuesEqual } = require('../lib/dbShadow/reconcile');
const { normalizeTeacherFilterPayload } = require('../lib/dbShadow/teacherReference');
const {
  buildCheckinPayload,
  compareCheckinRows,
  compareRosters,
} = require('../lib/dbShadow/supplementalAdapter');
const { readCurrentRosters, readDailyAttendance } = require('../lib/dbShadow/supplementalReaders');

const assignment = {
  taskId: 18414,
  resourceId: 4865,
  studentId: 100,
  squadId: 710,
  resourceTable: 'online_word_pack',
};

test('private MySQL option files are parsed without copying credentials', () => {
  const profile = parseCnf('[client]\nhost="db.example"\nuser="reader"\npassword="a=b c"\nssl\n');
  assert.deepEqual(profile, {
    host: 'db.example',
    user: 'reader',
    password: 'a=b c',
    ssl: true,
  });
});

test('short cache reuses values, shares in-flight reads, and expires', async () => {
  let timestamp = 1_000;
  let loads = 0;
  const cache = createAsyncTtlCache({
    ttlMs: 30,
    staleTtlMs: 30,
    maxEntries: 2,
    now: () => timestamp,
  });
  const load = async () => ({ sequence: ++loads });
  const first = await cache.getOrLoad('a', load);
  const second = await cache.getOrLoad('a', load);
  assert.equal(first.cacheHit, false);
  assert.equal(second.cacheHit, true);
  assert.equal(second.value.sequence, 1);

  let resolvePending;
  const pendingLoad = () => new Promise((resolve) => { resolvePending = resolve; });
  const pendingA = cache.getOrLoad('b', pendingLoad);
  await Promise.resolve();
  const pendingB = cache.getOrLoad('b', pendingLoad);
  resolvePending({ sequence: 2 });
  const [, shared] = await Promise.all([pendingA, pendingB]);
  assert.equal(shared.sharedInFlight, true);

  timestamp += 31;
  const expired = await cache.getOrLoad('a', load);
  assert.equal(expired.cacheHit, false);
  assert.equal(expired.value.sequence, 2);
});

test('cache enforces a byte budget in addition to entry count', async () => {
  const cache = createAsyncTtlCache({
    ttlMs: 30_000,
    maxEntries: 10,
    maxWeightBytes: 10,
    weigh: (value) => value.weight,
  });
  await cache.getOrLoad('a', async () => ({ weight: 6 }));
  await cache.getOrLoad('b', async () => ({ weight: 6 }));
  assert.deepEqual(cache.stats(), {
    entries: 1,
    inFlight: 0,
    ttlMs: 30_000,
    staleTtlMs: 300_000,
    maxEntries: 10,
    totalWeightBytes: 6,
    maxWeightBytes: 10,
  });
  const reloaded = await cache.getOrLoad('a', async () => ({ weight: 4 }));
  assert.equal(reloaded.cacheHit, false);
});

test('stale cache serves the last success while one background refresh runs', async () => {
  let timestamp = 1_000;
  let loads = 0;
  let resolveRefresh;
  const cache = createAsyncTtlCache({
    ttlMs: 30,
    staleTtlMs: 300,
    now: () => timestamp,
    weigh: () => 1,
  });
  await cache.getOrLoad('a', async () => ({ sequence: ++loads }));
  timestamp += 31;
  const loader = () => new Promise((resolve) => {
    loads += 1;
    resolveRefresh = () => resolve({ sequence: loads });
  });
  const staleA = await cache.getOrLoad('a', loader);
  await Promise.resolve();
  const staleB = await cache.getOrLoad('a', loader);
  assert.equal(staleA.value.sequence, 1);
  assert.equal(staleA.stale, true);
  assert.equal(staleB.value.sequence, 1);
  assert.equal(loads, 2);
  resolveRefresh();
  await new Promise((resolve) => setImmediate(resolve));
  const fresh = await cache.getOrLoad('a', loader);
  assert.equal(fresh.value.sequence, 2);
  assert.equal(fresh.stale, false);
});

test('170 simultaneous identical misses share one loader', async () => {
  let loads = 0;
  let resolveLoad;
  const cache = createAsyncTtlCache();
  const loader = () => new Promise((resolve) => {
    loads += 1;
    resolveLoad = resolve;
  });
  const requests = Array.from({ length: 170 }, () => cache.getOrLoad('same-scope', loader));
  await Promise.resolve();
  assert.equal(loads, 1);
  resolveLoad({ ok: true });
  const results = await Promise.all(requests);
  assert.equal(results.filter((result) => result.sharedInFlight).length, 169);
});

test('refresh limiter caps database work and rejects excess cold-load pressure', async () => {
  const limiter = createAsyncLimiter({ concurrency: 2, maxQueue: 3 });
  let active = 0;
  let peak = 0;
  const releases = [];
  const task = () => new Promise((resolve) => {
    active += 1;
    peak = Math.max(peak, active);
    releases.push(() => {
      active -= 1;
      resolve();
    });
  });
  const jobs = Array.from({ length: 6 }, () => limiter.run(task));
  await Promise.resolve();
  assert.equal(limiter.stats().active, 2);
  assert.equal(limiter.stats().queued, 3);
  await assert.rejects(jobs[5], { code: 'DB_SHADOW_QUEUE_FULL' });
  while (releases.length > 0 || limiter.stats().queued > 0 || limiter.stats().active > 0) {
    releases.shift()?.();
    await new Promise((resolve) => setImmediate(resolve));
  }
  await Promise.all(jobs.slice(0, 5));
  assert.equal(peak, 2);
  await limiter.close();
});

test('assignment query uses online_task_student and rejects unbounded scans', () => {
  const query = buildStudentAssignmentQuery({ taskIds: [18414], squadIds: [710] });
  assert.match(query.sql, /online_task_student/);
  assert.match(query.sql, /student_task\.task_id/);
  assert.doesNotMatch(query.sql, /JSON_TABLE/);
  assert.deepEqual(query.params, [18414, 710]);
  const resources = buildTaskResourceQuery({ taskIds: [18414], squadIds: [710] });
  assert.match(resources.sql, /JSON_TABLE/);
  assert.doesNotMatch(resources.sql, /online_task_student/);
  assert.deepEqual(resources.params, [18414, 710]);
  assert.throws(() => buildStudentAssignmentQuery({ squadIds: [710] }), /禁止无边界扫描/);
});

test('current roster query uses the literal active ENUM value and stays squad-scoped', async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      return [[{ studentId: 1, squadId: 710, studentNo: 'S1' }]];
    },
  };
  const rows = await readCurrentRosters(pool, [710, 710]);
  assert.equal(rows.length, 1);
  assert.match(calls[0].sql, /status = '1'/);
  assert.match(calls[0].sql, /squad_id IN \(\?\)/);
  assert.deepEqual(calls[0].params, [710]);
});

test('daily attendance query is bounded by authorized roster students and an exclusive end date', async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      return [[]];
    },
  };
  await readDailyAttendance(pool, {
    studentIds: [101, 102], from: '2026-08-31', toExclusive: '2026-09-07',
  });
  assert.match(calls[0].sql, /WHERE st_id IN \(\?,\?\)/);
  assert.match(calls[0].sql, /GROUP BY st_id, date/);
  assert.deepEqual(calls[0].params, [101, 102, '2026-08-31', '2026-09-07']);
  await assert.rejects(
    readDailyAttendance(pool, { studentIds: [101], from: '', toExclusive: '' }),
    /明确的日期范围/,
  );
});

test('database check-in adapter keeps the full active roster and marks zero-day students', () => {
  const roster = [
    { studentId: 1, studentNo: 'S1', studentChName: '一', studentEnName: 'One' },
    { studentId: 2, studentNo: 'S2', studentChName: '二', studentEnName: 'Two' },
  ];
  const payload = buildCheckinPayload(roster, [
    { studentId: 1, date: '2026-09-01', completed: 1, hasSupplement: 0 },
    { studentId: 1, date: '2026-09-02', completed: 1, hasSupplement: 1 },
  ], {
    classCode: 'J100', squadId: 710, rangeStart: '2026-09-01', rangeEnd: '2026-09-03',
  });
  assert.equal(payload.rows.length, 2);
  assert.deepEqual(payload.rows[0].date_values, {
    '2026-09-01': '√', '2026-09-02': '补', '2026-09-03': '',
  });
  assert.equal(payload.rows[0].all_check_days, 2);
  assert.equal(payload.rows[0].supplement_times, 1);
  assert.equal(payload.rows[1].all_check_days, 0);

  const compatible = buildCheckinPayload(roster, [
    { studentId: 1, date: '2026-09-02', completed: 1, hasSupplement: 1 },
  ], {
    classCode: 'J100', squadId: 710, rangeStart: '2026-09-02', rangeEnd: '2026-09-02',
    supplementMode: 'legacy-compatible',
  });
  assert.equal(compatible.rows[0].date_values['2026-09-02'], '√');
  assert.equal(compatible.rows[0].supplement_times, 0);
});

test('roster and check-in comparison separate identity drift from value differences', () => {
  const roster = { students: [{ id: 1, no: 'S1', chName: '一', enName: 'One' }] };
  assert.equal(compareRosters(roster, roster).calculationsPassed, true);
  const checkin = {
    rows: [{ no: 'S1', all_check_days: 1, normal_record_total: 1, supplement_times: 0, date_values: { '2026-09-01': '√' } }],
  };
  assert.equal(compareCheckinRows(checkin, checkin).passed, true);
  const drift = compareCheckinRows(checkin, { rows: [] });
  assert.equal(drift.calculationsPassed, true);
  assert.equal(drift.identity.databaseOnlyStudentCount, 1);
});

test('student assignments and task resources expand locally without changing the stable key', () => {
  const rows = expandAssignments([
    { taskId: 18414, studentId: 100, squadId: 710 },
    { taskId: 18414, studentId: 200, squadId: 710 },
  ], [
    { taskId: 18414, resourceId: 4865, resourceTable: 'online_word_pack' },
    { taskId: 18414, resourceId: 2516, resourceTable: 'online_test' },
  ]);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map((row) => `${row.studentId}:${row.resourceId}`), [
    '100:2516', '200:2516', '100:4865', '200:4865',
  ]);
});

test('normalized snapshot removes repeated metadata and expands without result changes', () => {
  const rows = mergeAssignments([
    {
      ...assignment,
      assignedAt: '2026-09-01 10:00:00',
      taskStartAt: '2026-09-01 00:00:00',
      taskName: 'Task',
      taskShowName: 'Visible',
      lessonName: 'Lesson',
      term: '2026秋',
      week: 1,
      studentNo: 'S100',
      studentEnName: 'Amber',
      studentChName: '安柏',
      squadName: 'J100',
      sectionGroupName: 'J',
      resourceName: 'Words',
      resourceType: 'word',
      mustDo: 1,
    },
  ], {
    word: {
      completion: [{ taskId: 18414, resourceId: 4865, studentId: 100, completed: 1 }],
      repetition: [],
      pk: [],
    },
    voice: { base: [], history: [], first: [], dimensions: [] },
    test: [],
  });
  const original = { schemaVersion: 1, rows, attendance: [] };
  const compact = compactSnapshot(original);
  assert.equal(compact.catalog.tasks.length, 1);
  assert.equal(compact.catalog.resources.length, 1);
  assert.equal(compact.catalog.students.length, 1);
  assert.equal(compact.assignments.length, 1);
  assert.deepEqual(expandCompactSnapshot(compact).rows, rows);
});

test('word metrics keep no-result defaults separate from calculated nulls', () => {
  const rows = mergeAssignments([assignment], {
    word: {
      completion: [{ taskId: 18414, resourceId: 4865, studentId: 100, completed: 1, challengeStatus: 3 }],
      repetition: [{
        taskId: 18414,
        resourceId: 4865,
        studentId: 100,
        repetitionAttempts: 8,
        repetitionItems: 4,
        repetitionAccuracy: 75,
        repetitionFirstAccuracy: 50,
      }],
      pk: [{ resourceId: 4865, studentId: 100, pkAttempts: 3, wordKing: 1, pkAccuracy: 88.5 }],
    },
    voice: { base: [], history: [], first: [], dimensions: [] },
    test: [],
  });
  assert.equal(rows[0].key, 'online_word_pack_18414_4865_100');
  assert.deepEqual(rows[0].result, {
    hasSourceRecord: true,
    completed: true,
    challengeStatus: 3,
    wordKing: true,
    pkAttempts: 3,
    pkAccuracy: 88.5,
    repetitionAttempts: 8,
    repetitionItems: 4,
    repetitionAccuracy: 75,
    repetitionFirstAccuracy: 50,
    startedAt: null,
    completedAt: null,
  });
});

test('unsupported resources stay visible without invented result values', () => {
  const rows = mergeAssignments([{ ...assignment, resourceTable: 'online_composite' }], {
    word: { completion: [], repetition: [], pk: [] },
    voice: { base: [], history: [], first: [], dimensions: [] },
    test: [],
  });
  assert.equal(rows[0].supported, false);
  assert.equal(rows[0].result, null);
});

test('supported assignments distinguish missing source rows from incomplete rows', () => {
  const rows = mergeAssignments([{ ...assignment, resourceTable: 'online_test' }], {
    word: { completion: [], repetition: [], pk: [] },
    voice: { base: [], history: [], first: [], dimensions: [] },
    test: [],
  });
  assert.equal(rows[0].result.hasSourceRecord, false);
  assert.equal(rows[0].result.completed, false);
});

test('reconciliation uses numeric tolerance and reports missing rows', () => {
  assert.equal(valuesEqual(88.501, 88.5), true);
  const actual = [{ key: 'a', result: { score: 88.5, completed: true } }];
  const passed = reconcileRows(actual, [{ key: 'a', result: { score: 88.501, completed: true } }]);
  assert.equal(passed.passed, true);
  assert.equal(passed.calculationsPassed, true);
  const failed = reconcileRows(actual, [{ key: 'b', result: { score: 88.5 } }]);
  assert.equal(failed.passed, false);
  assert.equal(failed.calculationsPassed, true);
  assert.equal(failed.missingReferenceCount, 1);
  assert.equal(failed.missingDatabaseCount, 1);
  assert.equal(failed.differenceCount, 2);
});

test('teacher filter payload maps known fields and reports roster drift', () => {
  const databaseRows = mergeAssignments([
    assignment,
    { ...assignment, studentId: 200, studentNo: 'S200' },
  ], {
    word: {
      completion: [
        { taskId: 18414, resourceId: 4865, studentId: 100, completed: 1 },
        { taskId: 18414, resourceId: 4865, studentId: 200, completed: 1 },
      ],
      repetition: [],
      pk: [],
    },
    voice: { base: [], history: [], first: [], dimensions: [] },
    test: [],
  });
  const normalized = normalizeTeacherFilterPayload({ data: [{
    id: 100,
    no: 'S100',
    '18414_4865_packAttr': '已完成',
    '18414_4865_packAttr_rank': '是',
    '18414_4865_packAttr_pk_count': '3',
    '18414_4865_packAttr_pk_ratio': '88.5%',
    '18414_4865_packAttr_first_ratio': '75%',
    '18414_4865_packAttr_ratio': '80%',
  }, { id: 300, no: 'S300' }] }, databaseRows);
  assert.deepEqual(normalized.identity, {
    databaseStudentCount: 2,
    teacherStudentCount: 2,
    matchedStudentCount: 1,
    assignmentOnlyStudentCount: 1,
    teacherOnlyStudentCount: 1,
  });
  assert.deepEqual(normalized.rows[0].result, {
    completed: true,
    wordKing: true,
    pkAttempts: 3,
    pkAccuracy: 88.5,
    repetitionFirstAccuracy: 75,
    repetitionAccuracy: 80,
  });
});
test('explicit DB profiles work without a RemoteLab instance-root environment', () => {
  const { resolveProfilePaths } = require('../lib/dbShadow/config');
  assert.deepEqual(resolveProfilePaths({ SUPERAMBER_TASK_DB_PROFILE: '/private/task.cnf', SUPERAMBER_RESULT_DB_PROFILE: '/private/result.cnf' }), { task: '/private/task.cnf', result: '/private/result.cnf' });
});
