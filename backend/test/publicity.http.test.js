const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const EducationSystemScraper = require('../scraper/scraper');

test('multi-group export combines both semesters and refuses missing groups', async () => {
  const scraper = new EducationSystemScraper({ baseUrl: 'http://example.com' });
  scraper.resolveSquadId = async () => ({ classCode: 'K218', squadId: '1465' });
  scraper.fetchSemesterData = async () => [{ id: 17, name: '2026学年秋季学期' }, { id: 16, name: '2026学年春季学期' }];
  const labels = ['NBC 任务时间:2026-08-31 15:37:15', 'BC 任务时间:2026-08-30 14:07:24'];
  scraper.fetchFilterData = async (_, id) => ({ data: { task: [{ label: labels[id === 17 ? 0 : 1], children: [{ id: `node_${id}_1`, label: `${id === 17 ? 'NBC' : 'BC'} 阅读 类型:复合资源` }] }] } });
  let requested;
  scraper.fetchStudentPersonFilter = async (_, ids) => {
    requested = ids;
    return [{ no: '1', ch_name: '张三', en_name: 'Amy', '17_1_composite': '已完成', '16_1_composite': '未完成' }];
  };
  scraper.scrapePublicityExportDataViaBrowser = async () => { throw new Error('must not hide incomplete selection via fallback'); };
  const options = { preferredYear: '2026', preferredSemester: '2026学年秋季学期', selectedWeekLabels: labels };
  const result = await scraper.scrapePublicityExportData('K218', options);
  assert.deepEqual(requested, ['node_17_1', 'node_16_1']);
  assert.deepEqual(result.tableRows[1].slice(4), ['NBC 阅读[复合资源]', 'BC 阅读[复合资源]']);
  await assert.rejects(scraper.scrapePublicityExportData('K218', { ...options, selectedWeekLabels: [...labels, '失踪挑战 任务时间:2026-08-29'] }), /尚未完整读取/);
});

test('semester selection can target the immediately previous semester', () => {
  const scraper = new EducationSystemScraper({ baseUrl: 'http://example.com' });
  const selected = scraper.selectSemester([
    { id: 30, name: '2026学年秋季学期' },
    { id: 29, name: '2026学年春季学期' },
    { id: 28, name: '2025学年秋季学期' },
  ], {
    preferredYear: '2026',
    preferredSemester: '2026学年秋季学期',
    semesterMode: 'previous',
  });
  assert.equal(selected.id, 29);
});

test('browser fallback can hydrate cookies without visiting the heavy admin dashboard first', async () => {
  const scraper = Object.create(EducationSystemScraper.prototype);
  let cookieCalls = 0;
  let navigationCalls = 0;
  scraper.browser = {};
  scraper.browserSessionReady = false;
  scraper.page = {
    isClosed: () => false,
    evaluate: async () => 1,
    setCookie: async () => { cookieCalls += 1; },
    goto: async () => { navigationCalls += 1; },
  };
  scraper.getPuppeteerCookies = () => [{ name: 'session', value: 'ready', domain: 'example.test' }];

  await scraper.ensurePageReady({ skipHydrationNavigation: true });
  assert.equal(cookieCalls, 1);
  assert.equal(navigationCalls, 0);
  assert.equal(scraper.browserSessionReady, true);
});

test('browser fallback selects a prepared parent task before trying resource labels', async () => {
  const scraper = Object.create(EducationSystemScraper.prototype);
  const attempts = [];
  scraper.applySelectedTasksFromDialog = async (targets) => {
    attempts.push(targets);
    if (targets[0]?.includes('任务时间:')) {
      return { matched: [targets[0]], missing: [] };
    }
    return { matched: [], missing: targets };
  };

  const result = await scraper.applyPreparedTaskSelectionFromDialog(
    ['开学第一课（BC版） 任务时间:2026-08-30 14:07:24'],
    ['L2 BC 开学第一课 Lesson 1', 'L2 BC 开学第一课 Lesson 2'],
  );

  assert.equal(result.strategy, 'parent-task');
  assert.equal(result.matched.length, 1);
  assert.equal(attempts.length, 1);
});

test('browser fallback still uses resource labels when no prepared parent matches', async () => {
  const scraper = Object.create(EducationSystemScraper.prototype);
  const attempts = [];
  scraper.applySelectedTasksFromDialog = async (targets) => {
    attempts.push(targets);
    return attempts.length === 1
      ? { matched: [], missing: targets }
      : { matched: [targets[0]], missing: targets.slice(1) };
  };

  const result = await scraper.applyPreparedTaskSelectionFromDialog(
    ['旧父任务'],
    ['当前资源一', '当前资源二'],
  );

  assert.equal(result.strategy, 'resource-task');
  assert.deepEqual(result.matched, ['当前资源一']);
  assert.deepEqual(attempts, [['旧父任务'], ['当前资源一', '当前资源二']]);
});

test('browser fallback keeps a squad page whose controls rendered before navigation timeout', async () => {
  const scraper = Object.create(EducationSystemScraper.prototype);
  scraper.sleep = async () => {};
  scraper.page = {
    goto: async () => { throw new Error('Navigation timeout of 30000 ms exceeded'); },
    evaluate: async () => ({
      href: 'http://example.test/admin/squad_console?id=1465&type=offline',
      ready: true,
      login: false,
    }),
  };

  const result = await scraper.navigateToSquadConsole(
    'http://example.test/admin/squad_console?id=1465&type=offline',
  );
  assert.equal(result.recoveredFromTimeout, true);
});

test('browser fallback still rejects a navigation timeout before squad controls render', async () => {
  const scraper = Object.create(EducationSystemScraper.prototype);
  scraper.sleep = async () => {};
  scraper.page = {
    goto: async () => { throw new Error('Navigation timeout of 30000 ms exceeded'); },
    evaluate: async () => ({ href: 'http://example.test/admin/squad_console?id=1465', ready: false, login: false }),
  };

  await assert.rejects(
    scraper.navigateToSquadConsole('http://example.test/admin/squad_console?id=1465'),
    /Navigation timeout/,
  );
});

test('student-person dialog accepts an already active panel without its menu entry', async () => {
  const scraper = Object.create(EducationSystemScraper.prototype);
  const evaluateResults = [
    'already-active',
    true,
    undefined,
    '',
    undefined,
    0,
  ];
  scraper.page = {
    evaluate: async () => evaluateResults.shift(),
  };
  scraper.sleep = async () => {};

  const semester = await scraper.openStudentPersonDialog('2026', '2026学年秋季学期');
  assert.equal(semester, '2026学年秋季学期');
  assert.equal(evaluateResults.length, 0);
});

function parseCookies(header = '') {
  return Object.fromEntries(
    String(header)
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf('=');
        return index === -1 ? [part, ''] : [part.slice(0, index), part.slice(index + 1)];
      })
  );
}

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

const squadConsoleHtml = `
  <html>
    <head><title>J328 第 6 周</title></head>
    <body>
      <div class="el-dialog">
        <div class="el-tree">
          <div class="el-tree-node">
            <div class="el-tree-node__content"><span class="el-tree-node__label">Week 6</span></div>
            <div class="el-tree-node__children">
              <div class="el-tree-node">
                <div class="el-tree-node__content"><span class="el-tree-node__label">Week 6 My Week 词王</span></div>
              </div>
              <div class="el-tree-node">
                <div class="el-tree-node__content"><span class="el-tree-node__label">Week 6 小挑战</span></div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <table>
        <tr>
          <th>序号</th>
          <th>学号</th>
          <th>中文名</th>
          <th>英文名</th>
          <th>Week 6 My Week 词王[词王]</th>
          <th>Week 6 小挑战[小挑战]</th>
        </tr>
        <tr>
          <th>序号</th>
          <th>学号</th>
          <th>中文名</th>
          <th>英文名</th>
          <th>是否完成</th>
          <th>是否完成</th>
        </tr>
        <tr>
          <td>1</td>
          <td>20240001</td>
          <td>张三</td>
          <td>Amy</td>
          <td>已完成</td>
          <td>已完成</td>
        </tr>
        <tr>
          <td>2</td>
          <td>20240002</td>
          <td>李四</td>
          <td>Ben</td>
          <td>未完成</td>
          <td>已完成</td>
        </tr>
      </table>
    </body>
  </html>
`;

test('publicity task list and export prefer direct HTTP/HTML parsing without launching browser', async () => {
  const upstream = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === 'GET' && url.pathname === '/admin/auth/login') {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Set-Cookie': [
          'XSRF-TOKEN=publicity-xsrf%3Dvalue; Path=/',
          'laravel_session=publicity-prelogin; Path=/; HttpOnly',
        ],
      });
      res.end('<script>window.__STATE__ = { _token: "publicity-csrf-001" };</script>');
      return;
    }

    if (req.method === 'POST' && url.pathname === '/admin/auth/login') {
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Set-Cookie': ['laravel_session=publicity-logged-in; Path=/; HttpOnly'],
      });
      res.end(JSON.stringify({ code: '1', msg: '登陆成功', url: `http://${req.headers.host}/admin` }));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/admin/my_squad') {
      const cookies = parseCookies(req.headers.cookie || '');
      if (cookies.laravel_session !== 'publicity-logged-in') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<html><title>C&F School教务管理系统 | 登录</title></html>');
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`
        <table>
          <tr data-id="101"><td class="column-name"><a href="/admin/squad_console?type=offline&id=101">J328 班级</a></td></tr>
        </table>
      `);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/admin/squad_console') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(squadConsoleHtml);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('not found');
  });

  const address = await listen(upstream);
  const scraper = new EducationSystemScraper({
    baseUrl: `http://${address.address}:${address.port}`,
    username: 'amber',
    password: 'secret',
  });

  try {
    await scraper.login();
    scraper.resolveSquadId = async () => ({ classCode: 'J328', squadId: '101' });

    const taskInfo = await scraper.scrapePublicityTaskList('J328', {
      preferredYear: '2025',
      preferredSemester: '2025学年秋季学期',
    });
    const publicity = await scraper.scrapePublicityExportData('J328', {
      selectedTasks: ['Week 6 My Week 词王', 'Week 6 小挑战'],
    });

    assert.equal(taskInfo.transport, 'http-html');
    assert.equal(taskInfo.taskGroups.length, 1);
    assert.deepEqual(taskInfo.taskGroups[0].tasks, ['Week 6 My Week 词王', 'Week 6 小挑战']);

    assert.equal(publicity.meta.transport, 'http-html');
    assert.equal(publicity.tableRows.length, 4);
    assert.equal(publicity.week, 6);
    assert.equal(scraper.browser, null);
  } finally {
    await scraper.close();
    await close(upstream);
  }
});

test('publicity task list falls back to browser handler when HTTP/HTML parsing misses data', async () => {
  const scraper = new EducationSystemScraper({ baseUrl: 'http://example.com', username: 'amber', password: 'secret' });
  scraper.resolveSquadId = async () => ({ classCode: 'J328', squadId: '101' });
  scraper.fetchSquadConsoleHtml = async () => '<html><body>empty</body></html>';
  scraper.scrapePublicityTaskListViaBrowser = async () => ({
    classId: 'J328',
    squadId: '101',
    preferredYear: '2025',
    preferredSemester: '2025学年秋季学期',
    currentTask: '',
    taskGroups: [{ id: 'Week 6', name: 'Week 6', resourceCount: 1, tasks: ['Fallback Task'] }],
    tasks: ['Fallback Task'],
    transport: 'browser-fallback',
  });

  const result = await scraper.scrapePublicityTaskList('J328', { preferredYear: '2025' });
  assert.equal(result.transport, 'browser-fallback');
  assert.deepEqual(result.tasks, ['Fallback Task']);
});

test('publicity task list treats a valid empty current-term API response as an empty result', async () => {
  const scraper = new EducationSystemScraper({ baseUrl: 'http://example.com', username: 'amber', password: 'secret' });
  scraper.resolveSquadId = async () => ({ classCode: 'J328', squadId: '101' });
  scraper.fetchSemesterData = async () => ([{ id: 26, name: '2026学年秋季学期' }]);
  scraper.fetchFilterData = async () => ({
    code: 200,
    msg: 'success',
    data: {
      task: [{ id: 'all', name: '学生中心', children: [] }],
      week: { week1: [] },
      plan: [],
    },
  });
  scraper.fetchSquadConsoleHtml = async () => {
    throw new Error('valid empty API response should not fall back to HTML');
  };
  scraper.scrapePublicityTaskListViaBrowser = async () => {
    throw new Error('valid empty API response should not launch a browser');
  };

  const result = await scraper.scrapePublicityTaskList('J328', {
    preferredYear: '2026',
    preferredSemester: '2026学年秋季学期',
  });

  assert.equal(result.transport, 'http-api-empty');
  assert.equal(result.preferredSemester, '2026学年秋季学期');
  assert.deepEqual(result.taskGroups, []);
  assert.deepEqual(result.tasks, []);
});

test('semester data is fetched once per authenticated scraper session', async () => {
  const scraper = new EducationSystemScraper({ baseUrl: 'http://example.com', username: 'amber' });
  let calls = 0;
  scraper.requestJson = async () => {
    calls += 1;
    return { data: [{ id: 26, name: '2026学年秋季学期' }] };
  };

  const [first, second] = await Promise.all([
    scraper.fetchSemesterData(),
    scraper.fetchSemesterData(),
  ]);
  const third = await scraper.fetchSemesterData();
  assert.equal(calls, 1);
  assert.equal(first[0].id, 26);
  assert.deepEqual(second, first);
  assert.deepEqual(third, first);
});

test('publicity export falls back to browser handler when selected tasks do not match HTTP table', async () => {
  const scraper = new EducationSystemScraper({ baseUrl: 'http://example.com', username: 'amber', password: 'secret' });
  scraper.resolveSquadId = async () => ({ classCode: 'J328', squadId: '101' });
  scraper.fetchSquadConsoleHtml = async () => squadConsoleHtml;
  scraper.scrapePublicityExportDataViaBrowser = async () => ({
    classId: 'J328',
    squadId: '101',
    week: 6,
    tableRows: [['fallback']],
    selectedTaskResult: { matched: ['Browser Task'], missing: [] },
    meta: { transport: 'browser-fallback' },
  });

  const result = await scraper.scrapePublicityExportData('J328', {
    selectedTasks: ['Week 7 不在表里的任务'],
  });
  assert.equal(result.meta.transport, 'browser-fallback');
  assert.deepEqual(result.tableRows, [['fallback']]);
});

test('publicity export follows a term-boundary task into the previous semester directory', async () => {
  const scraper = new EducationSystemScraper({ baseUrl: 'http://example.com', username: 'amber' });
  scraper.resolveSquadId = async () => ({ classCode: 'K218', squadId: '1465' });
  scraper.fetchSemesterData = async () => ([
    { id: 17, name: '2026学年秋季学期' },
    { id: 16, name: '2026学年春季学期' },
  ]);
  const termCalls = [];
  scraper.fetchFilterData = async (_squadId, termId) => {
    termCalls.push(termId);
    return termId === 17
      ? { data: { task: [{ label: '秋季任务', children: [] }] } }
      : {
        data: {
          task: [{
            label: '开学第一课（BC版） 任务时间:2026-08-30 14:07:24',
            children: [{ id: 'node_100_1', label: '开学第一课 Lesson 1 类型:复合资源' }],
          }],
        },
      };
  };
  scraper.fetchStudentPersonFilter = async () => ([{
    no: '20240001',
    ch_name: '张三',
    en_name: 'Amy',
    '100_1_composite': '已完成',
  }]);
  scraper.fetchSquadConsoleHtml = async () => { throw new Error('HTTP API should satisfy this report'); };
  scraper.scrapePublicityExportDataViaBrowser = async () => { throw new Error('browser should not launch'); };

  const result = await scraper.scrapePublicityExportData('K218', {
    preferredYear: '2026',
    preferredSemester: '2026学年秋季学期',
    selectedTasks: ['开学第一课 Lesson 1'],
    selectedWeekLabels: ['开学第一课（BC版） 任务时间:2026-08-30 14:07:24'],
  });

  assert.equal(result.meta.transport, 'http-api-adjacent');
  assert.equal(result.tableRows.length, 4);
  assert.deepEqual(termCalls, [17, 16]);
});

test('publicity export keeps selected parent-task blocks separated and ordered', () => {
  const scraper = new EducationSystemScraper({ baseUrl: 'http://example.com', username: 'amber', password: 'secret' });
  const filterData = {
    data: {
      task: [
        {
          label: '大任务1 任务时间:2026-05-01 10:00:00',
          children: [
            { id: 'node_100_1', label: '任务1-A 类型:复合资源' },
            { id: 'node_100_2', label: '任务1-B 类型:复合资源' },
          ],
        },
        {
          label: '大任务2 任务时间:2026-05-02 10:00:00',
          children: [
            { id: 'node_200_1', label: '任务2-A 类型:复合资源' },
            { id: 'node_200_2', label: '任务2-B 类型:复合资源' },
          ],
        },
      ],
    },
  };

  const { idToName, orderedTaskKeys, taskMetaByKey } = scraper.collectTaskIdsFromFilterData(
    filterData,
    [],
    ['大任务1 任务时间:2026-05-01 10:00:00', '大任务2 任务时间:2026-05-02 10:00:00'],
  );

  const tableRows = scraper.convertStudentFilterToTableRows([
    {
      no: '20240001',
      ch_name: '张三',
      en_name: 'Amy',
      '200_1_composite': '已完成',
      '100_1_composite': '已完成',
      '200_2_composite': '未完成',
      '100_2_composite': '未完成',
    },
  ], idToName, orderedTaskKeys, taskMetaByKey);

  assert.deepEqual(orderedTaskKeys, ['100_1', '100_2', '200_1', '200_2']);
  assert.deepEqual(tableRows[1].slice(4), [
    '任务1-A[复合资源]',
    '任务1-B[复合资源]',
    '任务2-A[复合资源]',
    '任务2-B[复合资源]',
  ]);
  assert.deepEqual(taskMetaByKey['100_1'], {
    title: '任务1-A',
    groupTitle: '大任务1 任务时间:2026-05-01 10:00:00',
    groupOrder: 0,
    sourceOrder: 0,
    weekLabel: '大任务1 任务时间:2026-05-01 10:00:00',
  });
});

test('publicity export applies report sequence sorting within each selected parent-task block', () => {
  const scraper = new EducationSystemScraper({ baseUrl: 'http://example.com', username: 'amber', password: 'secret' });
  const filterData = {
    data: {
      task: [
        {
          label: 'Week6 任务时间:2026-05-01 10:00:00',
          children: [
            {
              label: '周末任务块',
              children: [
                { id: 'node_100_1', label: '步骤2:周末内容AI语音陪练 类型:语音' },
                { id: 'node_100_2', label: '步骤1:周末磨耳朵&跟读 类型:音频' },
              ],
            },
            {
              label: '周内任务块',
              children: [
                { id: 'node_200_1', label: '步骤2:周内内容AI语音陪练 类型:语音' },
                { id: 'node_200_2', label: '步骤1:周内磨耳朵&跟读 类型:音频' },
              ],
            },
          ],
        },
      ],
    },
  };

  const { idToName, orderedTaskKeys, taskMetaByKey } = scraper.collectTaskIdsFromFilterData(
    filterData,
    [],
    ['Week6 任务时间:2026-05-01 10:00:00'],
  );

  const tableRows = scraper.convertStudentFilterToTableRows([
    {
      no: '20240001',
      ch_name: '张三',
      en_name: 'Amy',
      '100_1_voice': '已完成',
      '100_1_voicescore': '88',
      '100_2_audio': '已完成',
      '100_2_audioscore': '92',
      '200_1_voice': '已完成',
      '200_1_voicescore': '80',
      '200_2_audio': '已完成',
      '200_2_audioscore': '81',
    },
  ], idToName, orderedTaskKeys, taskMetaByKey);

  assert.deepEqual(orderedTaskKeys, ['100_1', '100_2', '200_1', '200_2']);
  assert.deepEqual(tableRows[1].slice(4, 8), [
    '步骤1:周末磨耳朵&跟读[AI语音]',
    '步骤1:周末磨耳朵&跟读[AI语音]',
    '步骤2:周末内容AI语音陪练[AI语音]',
    '步骤2:周末内容AI语音陪练[AI语音]',
  ]);
  assert.deepEqual(tableRows[1].slice(8, 12), [
    '步骤1:周内磨耳朵&跟读[AI语音]',
    '步骤1:周内磨耳朵&跟读[AI语音]',
    '步骤2:周内内容AI语音陪练[AI语音]',
    '步骤2:周内内容AI语音陪练[AI语音]',
  ]);
});

test('publicity export keeps repeated-stage accuracy columns for theme-expression tasks', () => {
  const scraper = new EducationSystemScraper({ baseUrl: 'http://example.com', username: 'amber', password: 'secret' });

  const tableRows = scraper.convertStudentFilterToTableRows([
    {
      no: '20240001',
      ch_name: '张三',
      en_name: 'Amy',
      '100_1_packAttr': '已完成',
      '100_1_packAttr_rank': '是',
      '100_1_packAttr_pk_count': '6',
      '100_1_packAttr_pk_ratio': '88%',
      '100_1_packAttr_first_ratio': '61%',
      '100_1_packAttr_repeat_ratio': '58%',
    },
  ], {
    '100_1': 'Lesson 1 词王 类型:主题表达积累',
  }, ['100_1'], {
    '100_1': {
      title: 'Lesson 1 词王',
      groupTitle: 'Week1',
      groupOrder: 0,
      sourceOrder: 0,
    },
  });

  assert.deepEqual(tableRows[2].slice(4), [
    '是否完成',
    '是否达到词王',
    'PK次数',
    '词王平均正确率',
    '【不是词王pk数据！！！重复环节首次完成正确率】',
    '【不是词王pk数据！！！重复环节平均正确率】',
  ]);
  assert.deepEqual(tableRows[3].slice(4), [
    '已完成',
    '是',
    '6',
    '88%',
    '61%',
    '58%',
  ]);
});

test('publicity export keeps test total score from task metadata', () => {
  const scraper = new EducationSystemScraper({ baseUrl: 'http://example.com', username: 'amber', password: 'secret' });
  const filterData = {
    data: {
      task: [
        {
          label: 'Week14 任务时间:2026-06-06 00:00:00',
          children: [
            { id: 'node_100_1', label: 'L4·Reading·U4L2温故 类型:测试', limit: '11' },
          ],
        },
      ],
    },
  };

  const { idToName, orderedTaskKeys, taskMetaByKey } = scraper.collectTaskIdsFromFilterData(
    filterData,
    [],
    ['Week14 任务时间:2026-06-06 00:00:00'],
  );
  const tableRows = scraper.convertStudentFilterToTableRows([
    {
      no: '22300474',
      ch_name: '周颢凌',
      en_name: 'Andy',
      '100_1_test': '已完成',
      '100_1_testscore': '10',
    },
  ], idToName, orderedTaskKeys, taskMetaByKey);

  assert.equal(taskMetaByKey['100_1'].scoreTotal, 11);
  assert.deepEqual(tableRows[2].slice(4, 6), ['是否完成', '分数(11)']);
  assert.deepEqual(tableRows[3].slice(4, 6), ['已完成', '10']);
});

test('publicity export keeps test total score from explicit student fields', () => {
  const scraper = new EducationSystemScraper({ baseUrl: 'http://example.com', username: 'amber', password: 'secret' });

  const tableRows = scraper.convertStudentFilterToTableRows([
    {
      no: '22300474',
      ch_name: '周颢凌',
      en_name: 'Andy',
      '100_1_test': '已完成',
      '100_1_testscore': '10',
      '100_1_test_all_score': '11',
    },
  ], {
    '100_1': 'L4·Reading·U4L2温故 类型:测试',
  }, ['100_1'], {});

  assert.deepEqual(tableRows[2].slice(4, 6), ['是否完成', '分数(11)']);
  assert.deepEqual(tableRows[3].slice(4, 6), ['已完成', '10']);
});

test('publicity export keeps test total score from nested task question count metadata', () => {
  const scraper = new EducationSystemScraper({ baseUrl: 'http://example.com', username: 'amber', password: 'secret' });
  const filterData = {
    data: {
      task: [
        {
          label: 'Week14 任务时间:2026-06-01 17:19:55',
          children: [
            {
              id: 'node_100_1',
              label: 'L4·Reading·U4L2温故 类型:测试',
              config: { question_count: 11 },
            },
          ],
        },
      ],
    },
  };

  const { idToName, orderedTaskKeys, taskMetaByKey } = scraper.collectTaskIdsFromFilterData(
    filterData,
    [],
    ['Week14 任务时间:2026-06-01 17:19:55'],
  );
  const tableRows = scraper.convertStudentFilterToTableRows([
    {
      no: '22300474',
      ch_name: '周颢凌',
      en_name: 'Andy',
      '100_1_test': '已完成',
      '100_1_testscore': '10',
    },
  ], idToName, orderedTaskKeys, taskMetaByKey);

  assert.equal(taskMetaByKey['100_1'].scoreTotal, 11);
  assert.deepEqual(tableRows[2].slice(4, 6), ['是否完成', '分数(11)']);
  assert.deepEqual(tableRows[3].slice(4, 6), ['已完成', '10']);
});

test('publicity export keeps test total score from test total field variants', () => {
  const scraper = new EducationSystemScraper({ baseUrl: 'http://example.com', username: 'amber', password: 'secret' });

  const tableRows = scraper.convertStudentFilterToTableRows([
    {
      no: '22300474',
      ch_name: '周颢凌',
      en_name: 'Andy',
      '100_1_test': '已完成',
      '100_1_testscore': '10',
      '100_1_test_total': '11',
    },
  ], {
    '100_1': 'L4·Reading·U4L2温故 类型:测试',
  }, ['100_1'], {});

  assert.deepEqual(tableRows[2].slice(4, 6), ['是否完成', '分数(11)']);
  assert.deepEqual(tableRows[3].slice(4, 6), ['已完成', '10']);
});

test('publicity export uses known total for L4 Reading U4L2 review test when upstream omits metadata', () => {
  const scraper = new EducationSystemScraper({ baseUrl: 'http://example.com', username: 'amber', password: 'secret' });

  const tableRows = scraper.convertStudentFilterToTableRows([
    {
      no: '22300474',
      ch_name: '周颢凌',
      en_name: 'Andy',
      '19887_2246_test': '已完成',
      '19887_2246_testscore': '10',
    },
  ], {
    '19887_2246': 'L4·Reading·U4L2温故 类型:测试',
  }, ['19887_2246'], {});

  assert.deepEqual(tableRows[2].slice(4, 6), ['是否完成', '分数(11)']);
  assert.deepEqual(tableRows[3].slice(4, 6), ['已完成', '10']);
});

test('a resource absent from the first student still reaches the daily report', () => {
  const scraper = new EducationSystemScraper({ baseUrl: 'https://example.test' });
  const rows = scraper.convertStudentFilterToTableRows([
    { no: '1', en_name: 'Amy', '10_1_composite': '未完成' },
    { no: '2', en_name: 'Ben', '10_1_composite': '已完成', '10_2_composite': '已完成' },
  ], { '10_1': '阅读 类型:复合资源', '10_2': '阅读 类型:复合资源' }, ['10_1', '10_2']);
  const report = require('../lib/dailyReportViewModel').buildDailyReportViewModel(rows);
  assert.equal(report.tasks.length, 2);
  assert.equal(report.students[0].cells.length, 2);
  assert.equal(report.students[0].cells[1].complete, false);
  assert.equal(report.students[1].cells[1].complete, true);
});

test('failed task catalogs never become a successful empty catalog', async () => {
  const scraper = new EducationSystemScraper({ baseUrl: 'https://example.test' });
  for (const data of [{ code: 0, data: [] }, { code: 1, data: null }]) {
    scraper.requestJson = async () => ({ data });
    await assert.rejects(scraper.fetchSquadTaskCatalog('1', '17'), /任务目录读取失败/);
  }
  scraper.requestJson = async () => ({ data: { code: 1, data: [] } });
  assert.deepEqual(await scraper.fetchSquadTaskCatalog('1', '17'), []);
});
