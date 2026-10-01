const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const { createClassControlRoutes, createConcurrencyLimiter } = require('../routes/classControlRoutes');

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address())));
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

function taskSnapshot() {
  const taskId = 'task-w1';
  return {
    taskCatalogVersion: 3,
    preferredYear: '2026',
    preferredSemester: '2026学年秋季学期',
    weekTasks: [{
      id: taskId,
      name: 'Week1',
      weekNumber: 1,
      startAt: '2026-08-31 19:20:00',
      endAt: '2026-09-07 19:20:00',
      skuId: '5',
      collectionName: '活动计划',
    }],
    weekMap: { [taskId]: ['voice'] },
    weekSourceLabels: { [taskId]: ['Week1 任务时间:2026-08-31 19:20:00'] },
    weekSelectionMap: {
      [taskId]: {
        taskIds: ['101_voice'],
        idToName: { 101: '必做语音' },
        orderedTaskKeys: ['101'],
        taskMetaByKey: { 101: { title: '必做语音' } },
      },
    },
  };
}

test('class control limiter caps simultaneous upstream reads', async () => {
  const limiter = createConcurrencyLimiter(2);
  let active = 0;
  let peak = 0;
  const tasks = Array.from({ length: 6 }, (_, index) => limiter.run(async () => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 10));
    active -= 1;
    return index;
  }));
  assert.deepEqual(await Promise.all(tasks), [0, 1, 2, 3, 4, 5]);
  assert.equal(peak, 2);
  assert.deepEqual(limiter.stats(), { concurrency: 2, active: 0, queued: 0 });
});

test('production report routes require authentication before reading data', async () => {
  let sessionCalls = 0;
  const app = express();
  app.use(express.json());
  app.use('/api', createClassControlRoutes({
    requireLoggedInSession(req, res) {
      sessionCalls += 1;
      res.status(401).json({ error: '请先登录' });
      return null;
    },
    rosterSnapshotService: {},
    taskCatalogVersion: 3,
    currentTermName: '2026学年秋季学期',
    week1Start: '2026-08-31',
    timezone: 'Asia/Shanghai',
  }));
  const server = http.createServer(app);
  const address = await listen(server);
  try {
    const response = await new Promise((resolve, reject) => {
      const request = http.request({
        hostname: address.address,
        port: address.port,
        path: '/api/data/class-control/refresh',
        method: 'POST',
        headers: {
          host: 'superamber.example.invalid',
          origin: 'https://superamber.example.invalid',
          'content-type': 'application/json',
        },
      }, (incoming) => {
        let body = '';
        incoming.setEncoding('utf8');
        incoming.on('data', (chunk) => { body += chunk; });
        incoming.on('end', () => resolve({
          status: incoming.statusCode,
          payload: JSON.parse(body),
        }));
      });
      request.on('error', reject);
      request.end(JSON.stringify({ classId: 'J328' }));
    });
    assert.equal(response.status, 401);
    assert.deepEqual(response.payload, { error: '请先登录' });
    assert.equal(sessionCalls, 1);
  } finally {
    await close(server);
  }
});

test('class control returns a resolved empty state without fetching student details', async () => {
  let rosterCalls = 0;
  const app = express();
  app.use(express.json());
  app.use('/api', createClassControlRoutes({
    requireLoggedInSession() {
      return {
        username: 'AmberZhang',
        scraper: {
          async resolveSquadId() {
            rosterCalls += 1;
            return { classCode: 'J328', squadId: '1001' };
          },
        },
      };
    },
    rosterSnapshotService: {
      async getDailyReportTask() {
        return {
          taskCatalogVersion: 3,
          preferredSemester: '2026学年秋季学期',
          weekTasks: [],
        };
      },
    },
    taskCatalogVersion: 3,
    currentTermName: '2026学年秋季学期',
    week1Start: '2026-08-31',
    timezone: 'Asia/Shanghai',
    now: () => new Date('2026-09-02T06:00:00Z'),
  }));
  const server = http.createServer(app);
  const address = await listen(server);
  try {
    const response = await fetch(`http://${address.address}:${address.port}/api/data/class-control/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ classId: 'J328' }),
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.summary.taskState, 'empty');
    assert.equal(payload.summary.review, null);
    assert.equal(payload.summary.current, null);
    assert.equal(rosterCalls, 0);
  } finally {
    await close(server);
  }
});

test('selected task report merges the teacher-confirmed task lists into one summary', async () => {
  const snapshot = taskSnapshot();
  snapshot.updatedAt = '2026-09-08T02:00:00.000Z';
  snapshot.defaultSelectedWeekIds = ['task-w1'];
  snapshot.weekTasks.push({
    id: 'task-w1-extra',
    name: 'Week1 第二轮',
    startAt: '2026-08-31 19:20:00',
    endAt: '2026-09-07 19:20:00',
    skuId: '5',
    collectionName: '活动计划',
  });
  snapshot.weekMap['task-w1-extra'] = ['video'];
  snapshot.weekSourceLabels['task-w1-extra'] = ['Week1 第二轮 任务时间:2026-08-31 19:20:00'];
  snapshot.weekSelectionMap['task-w1-extra'] = {
    taskIds: ['102_video'],
    idToName: { 102: '必做视频' },
    orderedTaskKeys: ['102'],
    taskMetaByKey: { 102: { title: '必做视频' } },
  };
  let receivedSelection = null;
  const app = express();
  app.use(express.json());
  app.use('/api', createClassControlRoutes({
    requireLoggedInSession() {
      return {
        username: 'Teacher',
        scraper: {
          async scrapePublicityExportData(_classId, selection) {
            receivedSelection = selection;
            return {
              classId: 'J328',
              tableRows: [
                ['', '', '', '', '', ''],
                ['序号', '学号', '中文名', '英文名', '【音频】A', '【视频】B'],
                ['序号', '学号', '中文名', '英文名', '是否完成', '是否完成'],
                ['1', '001', '张三', 'Amy', '已完成', '未完成'],
              ],
            };
          },
        },
      };
    },
    rosterSnapshotService: {
      async getDailyReportTask() { return snapshot; },
    },
    taskCatalogVersion: 3,
    currentTermName: '2026学年秋季学期',
    week1Start: '2026-08-31',
    timezone: 'Asia/Shanghai',
    now: () => new Date('2026-09-08T02:00:00Z'),
  }));
  const server = http.createServer(app);
  const address = await listen(server);
  try {
    const catalogResponse = await fetch(`http://${address.address}:${address.port}/api/data/class-control/task-catalog`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ classId: 'J328' }),
    });
    const catalogPayload = await catalogResponse.json();
    assert.equal(catalogResponse.status, 200);
    assert.equal(catalogPayload.catalog.weekTasks.length, 2);
    assert.deepEqual(catalogPayload.catalog.defaultSelectedWeekIds, ['task-w1']);
    assert.equal(catalogPayload.catalog.weekTasks[0].name, 'Week1');
    assert.equal(Object.hasOwn(catalogPayload.catalog.weekTasks[0], 'tasks'), false);

    const response = await fetch(`http://${address.address}:${address.port}/api/data/class-control/task-report`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ classId: 'J328', selectedWeekIds: ['task-w1', 'task-w1-extra'] }),
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(payload.report.selectedWeekIds, ['task-w1', 'task-w1-extra']);
    assert.deepEqual(receivedSelection.preparedSelection.taskIds, ['101_voice', '102_video']);
    assert.equal(payload.report.task.requiredTaskCount, 2);
    assert.equal(payload.report.task.completionRate, 50);
    assert.deepEqual(payload.report.detail.tasks.map((task) => task.label), ['【音频】A', '【视频】B']);
    assert.deepEqual(payload.report.detail.students[0].cells.map((cell) => cell.display), ['✅', '⭕']);
    assert.equal(payload.report.snapshotUpdatedAt, snapshot.updatedAt);

    snapshot.weekTasks.push({
      id: 'task-w1-unhydrated',
      name: 'Week1 第三轮',
      startAt: '2026-08-31 19:20:00',
      endAt: '2026-09-07 19:20:00',
      skuId: '5',
      collectionName: '活动计划',
    });
    snapshot.weekMap['task-w1-unhydrated'] = ['reading'];
    snapshot.weekSourceLabels['task-w1-unhydrated'] = ['Week1 第三轮 任务时间:2026-08-31 19:20:00'];
    snapshot.weekSelectionMap['task-w1-unhydrated'] = {};
    const partialPreparedResponse = await fetch(`http://${address.address}:${address.port}/api/data/class-control/task-report`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ classId: 'J328', selectedWeekIds: ['task-w1', 'task-w1-extra', 'task-w1-unhydrated'], refresh: true }),
    });
    assert.equal(partialPreparedResponse.status, 200);
    assert.equal(receivedSelection.preparedSelection, null);
    assert.deepEqual(receivedSelection.selectedTasks, ['voice', 'video', 'reading']);
  } finally {
    await close(server);
  }
});

test('selected task report serves the prepared snapshot first and retains it when live refresh fails', async () => {
  const snapshot = taskSnapshot();
  snapshot.updatedAt = '2026-09-06T22:30:00.000Z';
  let publicityCalls = 0;
  const cached = {
    classId: 'J328',
    selectedWeekIds: ['task-w1'],
    selectionFingerprint: '101_voice',
    updatedAt: '2026-09-05T22:30:00.000Z',
    tableRows: [
      ['', '', '', '', ''],
      ['序号', '学号', '中文名', '英文名', '【音频】A'],
      ['序号', '学号', '中文名', '英文名', '是否完成'],
      ['1', '001', '张三', 'Amy', '已完成'],
    ],
  };
  const app = express();
  app.use(express.json());
  app.use('/api', createClassControlRoutes({
    requireLoggedInSession() {
      return {
        username: 'Teacher',
        scraper: {
          async scrapePublicityExportData() {
            publicityCalls += 1;
            throw new Error('upstream navigation timeout');
          },
        },
      };
    },
    rosterSnapshotService: {
      async getDailyReportTask() { return snapshot; },
      async getDailyReportPublicity() { return cached; },
    },
    taskCatalogVersion: 3,
    currentTermName: '2026学年秋季学期',
    week1Start: '2026-08-31',
    timezone: 'Asia/Shanghai',
    now: () => new Date('2026-09-06T23:00:00Z'),
  }));
  const server = http.createServer(app);
  const address = await listen(server);
  const url = `http://${address.address}:${address.port}/api/data/class-control/task-report`;
  try {
    const preparedResponse = await fetch(url, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ classId: 'J328', selectedWeekIds: ['task-w1'] }),
    });
    const prepared = await preparedResponse.json();
    assert.equal(preparedResponse.status, 200);
    assert.equal(prepared.report.source, 'snapshot');
    assert.equal(prepared.report.dataUpdatedAt, cached.updatedAt);
    assert.equal(prepared.report.detail.students[0].englishName, 'Amy');
    assert.equal(publicityCalls, 0);

    const refreshResponse = await fetch(url, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ classId: 'J328', selectedWeekIds: ['task-w1'], refresh: true }),
    });
    const refreshed = await refreshResponse.json();
    assert.equal(refreshResponse.status, 200);
    assert.equal(refreshed.report.source, 'snapshot-fallback');
    assert.match(refreshed.report.refreshError, /navigation timeout/);
    assert.equal(refreshed.report.detail.students[0].cells[0].display, '✅');
    assert.equal(publicityCalls, 1);
  } finally {
    await close(server);
  }
});

test('cached report bypasses a blocked live read and disabled speaking ignores saved reward template', async () => {
  let release, markStarted, speakingCalls = 0;
  const held = new Promise((resolve) => { release = resolve; });
  const started = new Promise((resolve) => { markStarted = resolve; });
  const cached = {
    classId: 'J328', updatedAt: '2026-09-07T06:30:00+08:00',
    tableRows: [['', '', '', '', ''], ['序号', '学号', '中文名', '英文名', '【音频】A'],
      ['序号', '学号', '中文名', '英文名', '是否完成'], ['1', '001', '张三', 'Amy', '已完成']],
  };
  const app = express();
  app.use(express.json());
  app.use('/api', createClassControlRoutes({
    requireLoggedInSession: () => ({username: 'Teacher', scraper: {
      async scrapePublicityExportData() { markStarted(); await held; return cached; },
    }}),
    rosterSnapshotService: {
      async getDailyReportTask() { return taskSnapshot(); },
      async getDailyReportPublicity() { return cached; },
    },
    rewardPolicyStore: { async get() { return {policy: {sources: {speaking: true}}}; } },
    async fetchCheckinRowsForRange() { speakingCalls += 1; return {rows: []}; },
    taskCatalogVersion: 3, readConcurrency: 1,
  }));
  const server = http.createServer(app);
  const address = await listen(server);
  const url = `http://${address.address}:${address.port}/api/data/class-control/task-report`;
  const body = {classId: 'J328', selectedWeekIds: ['task-w1'], options: {
    includeSpeaking: false, speakingRangeStart: '2026-08-31', speakingRangeEnd: '2026-09-06',
  }};
  let live;
  try {
    live = fetch(url, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({...body, refresh: true})});
    await started;
    const response = await fetch(url, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body), signal: AbortSignal.timeout(1000)});
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.report.source, 'snapshot');
    assert.equal(payload.report.detail.students.length, 1);
    assert.equal(speakingCalls, 0);
  } finally {
    release();
    if (live) await live;
    await close(server);
  }
});

test('class control route reuses cached sources, deduplicates work, and does not fetch a second roster', async () => {
  let publicityCalls = 0;
  let rosterCalls = 0;
  const scraper = {
    async getClassMap() {
      return [{ classCode: 'K339', squadId: '1874' }];
    },
    async fetchTeacherScheduleEvents() {
      return [{
        id: 90210,
        title: 'K339',
        start: '2026-08-31T18:20',
        end: '2026-08-31T19:20',
        classroom_name: 'C86-2楼-17',
        crouse_name: '主题口语课',
      }];
    },
    async resolveSquadId() {
      return { classCode: 'K339', squadId: '1874' };
    },
    async request() {
      rosterCalls += 1;
      return {
        status: 200,
        async json() {
          return { data: [
            { no: '001', ch_name: '张三', en_name: 'Amy' },
            { no: '002', ch_name: '李四', en_name: 'Ben' },
          ] };
        },
      };
    },
    async scrapePublicityExportData() {
      publicityCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 30));
      return {
        tableRows: [
          ['', '', '', '', ''],
          ['序号', '学号', '中文名', '英文名', '【必做】语音'],
          ['序号', '学号', '中文名', '英文名', '是否完成'],
          ['1', '001', '张三', 'Amy', '已完成'],
          ['2', '002', '李四', 'Ben', '未完成'],
        ],
      };
    },
    async fetchCheckinExport() {
      throw new Error('test checkin unavailable');
    },
    async scrapeAttendanceData() {
      return [
        { name: '张三', absenceCount: 1, lateCount: 0, attendanceRate: 0.9 },
        { name: '李四', absenceCount: 0, lateCount: 1, attendanceRate: 95 },
      ];
    },
  };
  const app = express();
  app.use(express.json());
  app.use('/api', createClassControlRoutes({
    requireLoggedInSession(req, res) {
      if (req.headers.authorization !== 'ready') {
        res.status(401).json({ error: '未登录' });
        return null;
      }
      return { username: 'AmberZhang', scraper };
    },
    rosterSnapshotService: {
      async getDailyReportTask() { return taskSnapshot(); },
      async refreshDailyReportTask() { return { taskSnapshot: taskSnapshot() }; },
    },
    taskCatalogVersion: 3,
    currentTermName: '2026学年秋季学期',
    week1Start: '2026-08-31',
    timezone: 'Asia/Shanghai',
    now: () => new Date('2026-09-08T02:00:00Z'),
  }));
  const server = http.createServer(app);
  const address = await listen(server);
  const url = `http://${address.address}:${address.port}/api/data/class-control/refresh`;
  const trendUrl = `http://${address.address}:${address.port}/api/data/class-control/trend`;
  const attendanceUrl = `http://${address.address}:${address.port}/api/data/class-control/attendance`;
  const scheduleUrl = `http://${address.address}:${address.port}/api/data/class-control/schedule`;

  try {
    const blocked = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ classId: 'K339' }),
    });
    assert.equal(blocked.status, 401);

    const options = {
      method: 'POST',
      headers: { authorization: 'ready', 'content-type': 'application/json' },
      body: JSON.stringify({ classId: 'K339' }),
    };
    const [first, second] = await Promise.all([fetch(url, options), fetch(url, options)]);
    const responses = await Promise.all([first.json(), second.json()]);
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(publicityCalls, 1);
    assert.equal(rosterCalls, 0);
    assert.equal(responses.some((item) => item.deduplicated === true), true);
    const summary = responses[0].summary;
    assert.equal(summary.review.task.completionRate, 50);
    assert.deepEqual(summary.review.task.incompleteStudents, ['Ben']);
    assert.equal(/[张李][三四]/.test(JSON.stringify(summary)), false);

    const trendResponse = await fetch(trendUrl, {
      method: 'POST',
      headers: { authorization: 'ready', 'content-type': 'application/json' },
      body: JSON.stringify({ classId: 'K339', knownCycleKeys: [] }),
    });
    const trendPayload = await trendResponse.json();
    assert.equal(trendResponse.status, 200);
    assert.equal(publicityCalls, 2);
    assert.equal(trendPayload.batch.trend.length, 1);
    assert.deepEqual(trendPayload.batch.trend[0].weekIds, ['task-w1']);
    assert.equal(trendPayload.batch.trend[0].speaking, null);
    assert.equal(trendPayload.batch.trendExpectedCount, 1);
    assert.equal(trendPayload.batch.trendComplete, true);

    const cachedTrendResponse = await fetch(trendUrl, {
      method: 'POST',
      headers: { authorization: 'ready', 'content-type': 'application/json' },
      body: JSON.stringify({
        classId: 'K339',
        knownCycleKeys: ['2026-08-31|2026-09-06|task-w1'],
      }),
    });
    const cachedTrendPayload = await cachedTrendResponse.json();
    assert.equal(cachedTrendResponse.status, 200);
    assert.equal(publicityCalls, 2);
    assert.deepEqual(cachedTrendPayload.batch.trend, []);
    assert.equal(cachedTrendPayload.batch.trendComplete, true);

    const attendanceResponse = await fetch(attendanceUrl, {
      method: 'POST',
      headers: { authorization: 'ready', 'content-type': 'application/json' },
      body: JSON.stringify({ classId: 'K339' }),
    });
    const attendancePayload = await attendanceResponse.json();
    assert.equal(attendanceResponse.status, 200);
    assert.deepEqual(attendancePayload.result.attendance.studentProfiles, [
      { name: '张三', absenceCount: 1, lateCount: 0, attendanceRate: 90 },
      { name: '李四', absenceCount: 0, lateCount: 1, attendanceRate: 95 },
    ]);

    const scheduleResponse = await fetch(scheduleUrl, { headers: { authorization: 'ready' } });
    const schedulePayload = await scheduleResponse.json();
    assert.equal(scheduleResponse.status, 200);
    assert.equal(schedulePayload.source, 'official_schedule');
    assert.equal(schedulePayload.classes.K339[0].day, '周一');
    assert.equal(schedulePayload.classes.K339[0].time, '18:20');
    assert.equal(schedulePayload.classes.K339[0].campus, 'C86');
    assert.equal(schedulePayload.classes.K339[0].room, '2楼-17');
  } finally {
    await close(server);
  }
});

test('historical class control reads an exact official term and remains zero-write', async () => {
  let taskListCalls = 0;
  let publicityCalls = 0;
  let checkinCalls = 0;
  const scraper = {
    async fetchSemesterData() {
      return [{ id: 16, name: '2026学年春季学期' }, { id: 17, name: '2026学年秋季学期' }];
    },
    async resolveSquadId(classId) {
      assert.equal(classId, 'K339');
      return { classCode: 'K339', squadId: '1874' };
    },
    async scrapePublicityTaskList(_classId, options) {
      taskListCalls += 1;
      assert.equal(options.preferredSemester, '2026学年春季学期');
      assert.equal(options.includeAdjacentActive, false);
      return {
        preferredSemester: '2026学年春季学期',
        taskGroups: [
          {
            id: 'Week15', name: 'Week15', officialTaskId: '6015',
            sourceLabel: 'Week15 任务时间:2026-06-08 19:20:00',
            startAt: '2026-06-08 19:20:00', endAt: '2026-06-15 19:20:00',
            skuId: '5', collectionName: '活动计划', studentVisible: true,
            tasks: ['必做语音'],
            taskSelection: {
              taskIds: ['6015_voice'], idToName: { 6015: '必做语音' },
              orderedTaskKeys: ['6015'], taskMetaByKey: { 6015: { title: '必做语音' } },
            },
          },
          {
            id: 'Week16', name: 'Week16', officialTaskId: '6016',
            sourceLabel: 'Week16 任务时间:2026-06-15 19:20:00',
            startAt: '2026-06-15 19:20:00', endAt: '2026-06-22 19:20:00',
            skuId: '5', collectionName: '活动计划', studentVisible: true,
            tasks: ['必做阅读'],
            taskSelection: {
              taskIds: ['6016_reading'], idToName: { 6016: '必做阅读' },
              orderedTaskKeys: ['6016'], taskMetaByKey: { 6016: { title: '必做阅读' } },
            },
          },
        ],
      };
    },
    async scrapePublicityExportData(_classId, selection) {
      publicityCalls += 1;
      assert.equal(selection.preferredSemester, '2026学年春季学期');
      assert.equal(selection.preparedSelection.taskIds.length, 1);
      return {
        tableRows: [
          ['', '', '', '', ''],
          ['序号', '学号', '中文名', '英文名', '必做任务'],
          ['序号', '学号', '中文名', '英文名', '是否完成'],
          ['1', '001', '张三', 'Amy', '已完成'],
          ['2', '002', '李四', 'Ben', '未完成'],
        ],
      };
    },
  };
  const app = express();
  app.use(express.json());
  app.use('/api', createClassControlRoutes({
    requireLoggedInSession() { return { username: 'AmberZhang', scraper }; },
    rosterSnapshotService: {},
    taskCatalogVersion: 4,
    currentTermName: '2026学年秋季学期',
    week1Start: '2026-08-31',
    timezone: 'Asia/Shanghai',
    now: () => new Date('2026-09-04T00:00:00Z'),
    async fetchCheckinRowsForRange(_scraper, options) {
      checkinCalls += 1;
      assert.deepEqual(options, {
        classId: 'K339', rangeStart: '2026-06-08', rangeEnd: '2026-06-21',
        preferredYear: '2026', preferredSemester: '2026学年春季学期',
      });
      return {
        rows: [
          { no: '001', ch_name: '张三', en_name: 'Amy', date_values: { '2026-06-09': '√', '2026-06-16': '补' } },
          { no: '002', ch_name: '李四', en_name: 'Ben', date_values: { '2026-06-09': '', '2026-06-16': '√' } },
        ],
      };
    },
  }));
  const server = http.createServer(app);
  const address = await listen(server);
  try {
    const response = await fetch(`http://${address.address}:${address.port}/api/data/class-control/history`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        classId: 'K339', preferredSemester: '2026学年春季学期',
        phase: 'regular', monthKind: 'last_active_month',
      }),
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.result.status, 'ready');
    assert.equal(payload.result.resolvedMonth, 6);
    assert.equal(payload.result.cycles.length, 2);
    assert.equal(payload.result.cycles[0].task.completionRate, 50);
    assert.equal(payload.result.cycles[0].speaking.averageDays, 0.5);
    assert.equal(taskListCalls, 1);
    assert.equal(publicityCalls, 2);
    assert.equal(checkinCalls, 1);
    assert.match(payload.result.attendanceError, /尚无/);
  } finally {
    await close(server);
  }
});
