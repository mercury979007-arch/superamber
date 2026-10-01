const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateAcceptance } = require('../lib/dbShadow/acceptance');
const { buildPublicityPayload } = require('../lib/dbShadow/publicityAdapter');
const {
  createPublicitySourceService,
  resolveAuthorizedClass,
} = require('../lib/dbShadow/publicitySourceService');
const {
  assertAuthorizedSquads,
  createSourceSwitch,
  loadSourceSwitchConfig,
  selectSource,
} = require('../lib/dbShadow/sourceSwitch');

test('database source switch is off by default and validates configuration', () => {
  assert.deepEqual(loadSourceSwitchConfig({}), {
    mode: 'off',
    canaryPercent: 0,
    canarySalt: 'superamber-db-v1',
    failureThreshold: 3,
    resetAfterMs: 60_000,
  });
  assert.throws(
    () => loadSourceSwitchConfig({ SUPERAMBER_DB_SOURCE_MODE: 'surprise' }),
    /不支持/,
  );
  assert.equal(selectSource({ mode: 'canary', canaryPercent: 100, canarySalt: 'x' }, 'teacher'), 'database');
  assert.equal(selectSource({ mode: 'canary', canaryPercent: 0, canarySalt: 'x' }, 'teacher'), 'legacy');
});

test('database reads reject any squad outside the logged-in teacher grant', () => {
  assert.deepEqual(assertAuthorizedSquads([710, 710], [710, 947]), [710]);
  assert.throws(
    () => assertAuthorizedSquads([710, 999], [710, 947]),
    { code: 'DB_SOURCE_SCOPE_DENIED', deniedSquadIds: [999] },
  );
  assert.throws(() => assertAuthorizedSquads([], [710]), { code: 'DB_SOURCE_EMPTY_SCOPE' });
});

test('shadow mode always serves legacy and records the background comparison', async () => {
  const sourceSwitch = createSourceSwitch({
    config: {
      mode: 'shadow', canaryPercent: 0, canarySalt: 'x', failureThreshold: 3, resetAfterMs: 60_000,
    },
    logger: { warn() {} },
  });
  const response = await sourceSwitch.execute({
    teacherIdentity: 'teacher',
    requestedSquadIds: [710],
    authorizedSquadIds: [710],
    legacy: async () => ({ rows: ['legacy'] }),
    database: async () => ({ rows: ['database'] }),
    compare: async () => ({ passed: false, calculationsPassed: true, identityDrift: 2 }),
  });
  assert.deepEqual(response, { source: 'legacy', value: { rows: ['legacy'] }, fallback: false });
  await sourceSwitch.drain();
  const health = sourceSwitch.health();
  assert.equal(health.legacyServed, 1);
  assert.equal(health.databaseServed, 0);
  assert.equal(health.shadowRuns, 1);
  assert.equal(health.comparisons, 1);
  assert.equal(health.comparisonFailures, 0);
});

test('primary mode falls back and opens the breaker instead of repeating database failures', async () => {
  let databaseCalls = 0;
  let legacyCalls = 0;
  const sourceSwitch = createSourceSwitch({
    config: {
      mode: 'primary', canaryPercent: 100, canarySalt: 'x', failureThreshold: 2, resetAfterMs: 60_000,
    },
    logger: { warn() {} },
  });
  const input = {
    teacherIdentity: 'teacher',
    requestedSquadIds: [710],
    authorizedSquadIds: [710],
    legacy: async () => ({ sequence: ++legacyCalls }),
    database: async () => { databaseCalls += 1; throw new Error('offline'); },
  };
  const first = await sourceSwitch.execute(input);
  const second = await sourceSwitch.execute(input);
  const third = await sourceSwitch.execute(input);
  assert.equal(first.fallback, true);
  assert.equal(second.fallback, true);
  assert.equal(third.fallback, true);
  assert.equal(databaseCalls, 2);
  assert.equal(legacyCalls, 3);
  assert.equal(sourceSwitch.health().breaker.state, 'open');
});

test('acceptance keeps advisory transport checks non-blocking but still requires user confirmation', () => {
  const evidence = {
    data: {
      comparedFields: 2_690,
      valueDifferenceCount: 0,
      completionDifferenceCount: 0,
      identityDriftClassified: true,
    },
    coverage: {
      sampledClasses: 5,
      resourceTypes: ['word', 'voice', 'test', 'attendance'],
      emptyResult: true,
      partialCompletion: true,
      rosterChange: true,
    },
    performance: {
      hotP90Ms: 4,
      hotP99Ms: 8,
      coldP90Ms: 5_260,
      steadyRssMb: 165,
      peakRssMb: 240,
      maxConnectionsPerHost: 2,
    },
    reliability: {
      peakAccountsTested: 170,
      refreshConcurrencyPeak: 2,
      prefetchConcurrencyPeak: 1,
      fallbackVerified: true,
      shadowRuns: 1_000,
      shadowFailures: 2,
      soakHours: 72,
    },
    security: {
      authorizationBoundaryVerified: true,
      readOnlyAccount: true,
      noWriteSql: true,
      tlsEnabled: false,
    },
    operations: { rollbackDrillPassed: true, observabilityVerified: true },
    userApproval: false,
  };
  const blocked = evaluateAcceptance(evidence);
  assert.equal(blocked.technicalReady, true);
  assert.equal(blocked.promotionAllowed, false);
  assert.equal(blocked.gates.find((gate) => gate.id === 'tls').status, 'fail');
  assert.equal(blocked.gates.find((gate) => gate.id === 'tls').critical, false);

  evidence.userApproval = true;
  const ready = evaluateAcceptance(evidence);
  assert.equal(ready.technicalReady, true);
  assert.equal(ready.promotionAllowed, true);
  assert.equal(ready.counts.fail, 1);
  assert.equal(ready.counts.pending, 0);
});

test('database results adapt to the existing teacher payload without changing the report UI contract', () => {
  const common = {
    supported: true,
    taskId: 18414,
    studentId: 100,
    studentNo: 'S100',
    studentChName: '安柏',
    studentEnName: 'Amber',
    squadId: 710,
    taskName: 'Week 1',
    taskShowName: 'Week 1',
  };
  const payload = buildPublicityPayload([
    {
      ...common,
      resourceTable: 'online_word_pack', resourceId: 4865, resourceName: 'Words',
      result: {
        completed: true, wordKing: true, pkAttempts: 3, pkAccuracy: 88.5,
        repetitionFirstAccuracy: 75, repetitionAccuracy: 80,
      },
    },
    {
      ...common,
      resourceTable: 'online_voice', resourceId: 4073, resourceName: 'Voice',
      result: { completed: true, averageScore: 90, voiceCount: 2, firstScore: 80, highestScore: 100 },
    },
    {
      ...common,
      resourceTable: 'online_test', resourceId: 2516, resourceName: 'Test',
      result: { completed: true, realScore: 12, allScore: 15 },
    },
  ], {
    legacyPayload: { data: [{ id: 100, no: 'S100', keep_unsupported: 'legacy-value' }] },
  });
  assert.equal(payload.data.length, 1);
  assert.deepEqual(payload.data[0], {
    id: 100,
    no: 'S100',
    keep_unsupported: 'legacy-value',
    ch_name: '安柏',
    en_name: 'Amber',
    '18414_4865_packAttr': '已完成',
    '18414_4865_packAttr_rank': '是',
    '18414_4865_packAttr_pk_count': '3',
    '18414_4865_packAttr_pk_ratio': '88.5%',
    '18414_4865_packAttr_first_ratio': '75%',
    '18414_4865_packAttr_ratio': '80%',
    '18414_4073_voice': '已完成',
    '18414_4073_voicescore': '90',
    '18414_4073_voicecount': '2',
    '18414_4073_voicefirst': '80',
    '18414_4073_voiceheighest': '100',
    '18414_2516_test': '已完成',
    '18414_2516_testscore': '12',
    '18414_2516_testscoretotal': '15',
  });
  assert.deepEqual(payload.orderedTaskKeys, ['18414_4865', '18414_4073', '18414_2516']);
  assert.equal(payload.taskMetaByKey['18414_2516'].scoreTotal, 15);
});

test('assignment-only students retain the complete legacy column shape with blank fallback values', () => {
  const rows = [100, 200].map((studentId) => ({
    supported: true,
    taskId: 18414,
    studentId,
    studentNo: `S${studentId}`,
    studentChName: '',
    studentEnName: `Student ${studentId}`,
    squadId: 710,
    resourceTable: 'online_test',
    resourceId: 2516,
    resourceName: 'Test',
    result: { completed: false, realScore: null, allScore: 15 },
  }));
  const payload = buildPublicityPayload(rows, {
    legacyPayload: { data: [{ id: 100, no: 'S100', '18414_9000_studyMark': '已完成' }] },
  });
  assert.equal(payload.data.find((row) => row.id === 200)['18414_9000_studyMark'], '');
});

test('database adapter preserves the teacher-confirmed task order and labels', () => {
  const base = {
    supported: true, taskId: 18414, studentId: 100, studentNo: 'S100', squadId: 710,
    result: { completed: true },
  };
  const payload = buildPublicityPayload([
    { ...base, resourceTable: 'online_test', resourceId: 1, resourceName: 'Database one' },
    { ...base, resourceTable: 'online_test', resourceId: 2, resourceName: 'Database two' },
  ], {
    preferredTaskKeys: ['18414_2', '18414_1'],
    preferredIdToName: { '18414_2': 'Teacher label 类型:测试' },
    preferredTaskMeta: { '18414_2': { title: 'Teacher title', groupOrder: 7, sourceOrder: 8 } },
  });
  assert.deepEqual(payload.orderedTaskKeys, ['18414_2', '18414_1']);
  assert.equal(payload.idToName['18414_2'], 'Teacher label 类型:测试');
  assert.equal(payload.taskMetaByKey['18414_2'].groupOrder, 7);
});

test('runtime class authorization never accepts an arbitrary numeric squad id', async () => {
  const scraper = {
    async getClassMap() { return [{ classCode: 'J100', squadId: '710' }]; },
  };
  assert.deepEqual(await resolveAuthorizedClass(scraper, 'J100'), { classCode: 'J100', squadId: 710 });
  await assert.rejects(resolveAuthorizedClass(scraper, '999'), { code: 'DB_SOURCE_SCOPE_DENIED' });
});

test('off mode stays byte-shape compatible and never creates a database runtime', async () => {
  let runtimeCreated = 0;
  const sourceSwitch = createSourceSwitch({
    config: { mode: 'off', canaryPercent: 0, canarySalt: 'x', failureThreshold: 3, resetAfterMs: 60_000 },
  });
  const service = createPublicitySourceService({
    sourceSwitch,
    runtimeFactory: async () => { runtimeCreated += 1; return {}; },
  });
  const scraper = {
    async getClassMap() { return [{ classCode: 'J100', squadId: '710' }]; },
    async scrapePublicityExportData() {
      return { classId: 'J100', squadId: 710, tableRows: [['legacy']], meta: { transport: 'http' } };
    },
  };
  const result = await service.fetch({ teacherIdentity: 'teacher', scraper, classId: 'J100' });
  assert.deepEqual(result.tableRows, [['legacy']]);
  assert.equal(result.meta.dataSource, 'legacy');
  assert.equal(result.meta.databaseFallback, false);
  assert.equal(runtimeCreated, 0);
});

test('primary mode serves supported database rows and falls back for unsupported scopes', async () => {
  let unsupported = false;
  const sourceSwitch = createSourceSwitch({
    config: { mode: 'primary', canaryPercent: 100, canarySalt: 'x', failureThreshold: 3, resetAfterMs: 60_000 },
    logger: { warn() {} },
  });
  const service = createPublicitySourceService({
    sourceSwitch,
    runtimeFactory: async () => ({
      async run() {
        return {
          summary: { unsupportedAssignmentRows: unsupported ? 1 : 0 },
          rows: [{
            supported: true,
            taskId: 18414,
            resourceId: 2516,
            resourceTable: 'online_test',
            resourceName: 'Test',
            studentId: 100,
            studentNo: 'S100',
            studentEnName: 'Amber',
            studentChName: '安柏',
            squadId: 710,
            result: { completed: true, realScore: 12, allScore: 15 },
          }],
        };
      },
      async close() {},
    }),
  });
  const scraper = {
    async getClassMap() { return [{ classCode: 'J100', squadId: '710' }]; },
    async scrapePublicityExportData() { return { classId: 'J100', tableRows: [['legacy']] }; },
    convertStudentFilterToTableRows() { return [[], [], [], ['database']]; },
  };
  const input = {
    teacherIdentity: 'teacher', scraper, classId: 'J100',
    selection: { preparedSelection: { taskIds: [18414] } },
  };
  const database = await service.fetch(input);
  assert.equal(database.meta.dataSource, 'database');
  assert.deepEqual(database.tableRows.at(-1), ['database']);

  unsupported = true;
  const fallback = await service.fetch(input);
  assert.equal(fallback.meta.dataSource, 'legacy');
  assert.equal(fallback.meta.databaseFallback, true);
  assert.deepEqual(fallback.tableRows, [['legacy']]);
  assert.equal(service.health().policyFallbacks, 1);
  assert.equal(service.health().breaker.state, 'closed');
  await service.close();
});

test('primary mode serves current roster, daily check-in, and speaking leaderboard from one shared runtime', async () => {
  let runtimeCreated = 0;
  const sourceSwitch = createSourceSwitch({
    config: { mode: 'primary', canaryPercent: 100, canarySalt: 'x', failureThreshold: 3, resetAfterMs: 60_000 },
  });
  const service = createPublicitySourceService({
    sourceSwitch,
    enabledDomains: ['publicity', 'roster', 'checkin', 'speaking'],
    runtimeFactory: async () => {
      runtimeCreated += 1;
      return {
        async readRoster() {
          return { rows: [
            { studentId: 1, squadId: 710, studentNo: 'S1', studentChName: '一', studentEnName: 'Test A甲' },
            { studentId: 2, squadId: 710, studentNo: 'S2', studentChName: '二', studentEnName: 'Test B乙' },
          ] };
        },
        async readAttendance() {
          return { rows: [{ studentId: 1, squadId: 710, date: '2026-09-01', completed: 1, hasSupplement: 0 }] };
        },
        async close() {},
      };
    },
  });
  const scraper = { async getClassMap() { return [{ classCode: 'J100', squadId: '710' }]; } };
  const common = {
    teacherIdentity: 'teacher', scraper, classId: 'J100',
    legacy: async () => { throw new Error('legacy must not run'); },
  };
  const roster = await service.fetchRoster(common);
  assert.equal(roster.students.length, 2);
  const checkin = await service.fetchCheckinRows({
    ...common, rangeStart: '2026-09-01', rangeEnd: '2026-09-02',
  });
  assert.equal(checkin.rows.length, 2);
  assert.equal(checkin.rows[1].all_check_days, 0);
  const speaking = await service.fetchSpeakingChallenge({
    ...common,
    window: {
      id: 'x', start: '2026-09-01', end: '2026-09-02', fullEnd: '2026-09-02',
      dates: ['2026-09-01', '2026-09-02'], complete: false,
    },
  });
  assert.equal(speaking.totalStudents, 2);
  assert.equal(speaking.activeStudents, 1);
  assert.deepEqual(speaking.students.map(student => student.englishName), ['Test A甲', 'Test B乙']);
  assert.deepEqual(roster.students.map(student => student.enName), ['Test A甲', 'Test B乙']);
  assert.deepEqual(checkin.rows.map(student => student.en_name), ['Test A甲', 'Test B乙']);
  assert.equal(runtimeCreated, 1);
  await service.close();
});

test('supplemental database domains remain opt-in even when publicity primary mode is enabled', async () => {
  let runtimeCreated = 0;
  let legacyCalls = 0;
  const sourceSwitch = createSourceSwitch({
    config: { mode: 'primary', canaryPercent: 100, canarySalt: 'x', failureThreshold: 3, resetAfterMs: 60_000 },
  });
  const service = createPublicitySourceService({
    sourceSwitch,
    runtimeFactory: async () => {
      runtimeCreated += 1;
      throw new Error('supplemental runtime must stay disabled');
    },
  });
  const value = await service.fetchRoster({
    teacherIdentity: 'teacher',
    scraper: { async getClassMap() { return [{ classCode: 'J100', squadId: '710' }]; } },
    classId: 'J100',
    legacy: async () => {
      legacyCalls += 1;
      return { students: [{ no: 'S1' }] };
    },
  });
  assert.equal(value.students.length, 1);
  assert.equal(legacyCalls, 1);
  assert.equal(runtimeCreated, 0);
  assert.deepEqual(service.health().enabledDomains, ['publicity']);
  await service.close();
});

test('current encoded task selections preserve resource scope and fall back atomically for unknown resources', async () => {
  let runs = 0;
  const row = { supported: true, taskId: 21441, resourceId: 2706, resourceTable: 'online_voice', studentId: 1, studentNo: 'S1', squadId: 710, result: { completed: true } };
  const service = createPublicitySourceService({
    sourceSwitch: createSourceSwitch({ config: { mode: 'primary', failureThreshold: 3, resetAfterMs: 60000 }, logger: { warn() {} } }),
    runtimeFactory: async () => ({ run: async ({ taskIds }) => {
      runs++; assert.deepEqual(taskIds, [21441]);
      return { summary: { unsupportedAssignmentRows: 1 }, rows: [row, { ...row, resourceId: 9999 }, { ...row, supported: false, resourceId: 8888, resourceTable: 'unsupported' }] };
    } }),
  });
  const scraper = {
    getClassMap: async () => [{ classCode: 'J100', squadId: 710 }],
    scrapePublicityExportData: async () => ({ tableRows: [['legacy']] }),
    convertStudentFilterToTableRows: payload => {
      assert.ok(Object.hasOwn(payload.data[0], '21441_2706_voice'));
      assert.equal(Object.hasOwn(payload.data[0], '21441_9999_voice'), false);
      return [[], [], [], ['database']];
    },
  };
  const fetchIds = taskIds => service.fetch({ teacherIdentity: 'teacher', scraper, classId: 'J100', selection: { preparedSelection: { taskIds } } });
  assert.equal((await fetchIds(['16313_21441_2706_voice'])).meta.dataSource, 'database');
  assert.equal((await fetchIds(['16313_21441_2706_voice', '17250_21441_2649_studyMark'])).meta.dataSource, 'legacy');
  assert.equal(runs, 1);
  assert.equal((await fetchIds(['16313_21441_1234_voice'])).meta.dataSource, 'legacy');
  assert.equal((await fetchIds(['16313_21441_2706_voice', 1234])).meta.dataSource, 'legacy');
  assert.equal(service.health().breaker.state, 'closed');
  await service.close();
});
