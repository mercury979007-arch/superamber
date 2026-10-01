const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const EducationSystemScraper = require('../scraper/scraper');

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

test('HTTP login and class-map fetch work without launching browser', async () => {
  const requests = [];
  const upstream = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    requests.push({
      method: req.method,
      path: url.pathname,
      cookie: req.headers.cookie || '',
      xsrf: req.headers['x-xsrf-token'] || '',
    });

    if (req.method === 'GET' && url.pathname === '/admin/auth/login') {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Set-Cookie': [
          'XSRF-TOKEN=test-xsrf%3Dvalue; Path=/',
          'laravel_session=guest-session; Path=/; HttpOnly',
        ],
      });
      res.end(`
        <html>
          <head><title>C&F School教务管理系统 | 登录</title></head>
          <body>
            <script>
              window.__STATE__ = { _token: "csrf-token-123" };
            </script>
          </body>
        </html>
      `);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/admin/auth/login') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        const form = new URLSearchParams(body);
        const cookies = parseCookies(req.headers.cookie || '');
        const isValid =
          form.get('username') === 'amber'
          && form.get('password') === 'secret'
          && form.get('_token') === 'csrf-token-123'
          && form.get('remember') === 'false'
          && cookies['XSRF-TOKEN'] === 'test-xsrf%3Dvalue'
          && cookies.laravel_session === 'guest-session'
          && req.headers['x-xsrf-token'] === 'test-xsrf=value';

        res.writeHead(isValid ? 200 : 400, {
          'Content-Type': 'application/json; charset=utf-8',
          'Set-Cookie': ['laravel_session=logged-in-session; Path=/; HttpOnly'],
        });
        res.end(JSON.stringify(
          isValid
            ? { code: '1', msg: '登陆成功', url: `http://${req.headers.host}/admin` }
            : { code: '0', msg: '登录参数不正确' }
        ));
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/admin/my_squad') {
      const cookies = parseCookies(req.headers.cookie || '');
      if (cookies.laravel_session !== 'logged-in-session') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<html><title>C&F School教务管理系统 | 登录</title></html>');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`
        <table>
          <tr data-id="101"><td class="column-name"><a href="/admin/squad_console?type=offline&id=101">K2 我的班级</a></td></tr>
          <tr data-id="202"><td class="column-name"><a href="/admin/squad_console?type=offline&id=202">GN67 晚辅班</a></td></tr>
        </table>
      `);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/admin') {
      const cookies = parseCookies(req.headers.cookie || '');
      if (cookies.laravel_session !== 'logged-in-session') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<html><title>C&F School教务管理系统 | 登录</title></html>');
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`
        <script>axios.get("/admin/dashboard/getSquadData?id=297")</script>
        <div class="small-box">
          <div>K2 我的班级列表</div>
          <a href="/admin/squad_console?id=101&type=offline">进入班级</a>
        </div>
        <div class="panel">
          <span>GN67 晚辅班</span>
          <a href="/admin/squad_console?id=202&type=offline">查看详情</a>
        </div>
      `);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/admin/dashboard/getSquadData') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ myClasses: [
        { name: 'K2', squad_id: 101, type: 'offline' },
        { name: 'J398', squad_id: 398, type: 'offline' },
        { name: 'FS1', squad_id: 501, type: 'offline' },
        { name: 'X1平方', squad_id: 502, type: 'offline' },
        { name: '繁星1班', squad_id: 601, type: 'online' },
      ] }));
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
    const firstFetch = await scraper.getClassMap();
    const secondFetch = await scraper.getClassMap();

    assert.deepEqual(firstFetch, [
      { classCode: 'K2', squadId: '101', relationship: 'current-head-teacher', sources: ['my_squad', 'dashboard'], type: 'offline' },
      { classCode: 'GN67', squadId: '202', relationship: 'current-head-teacher', sources: ['my_squad'], type: 'offline' },
      { classCode: 'J398', squadId: '398', relationship: 'manageable', sources: ['dashboard'], type: 'offline' },
      { classCode: 'FS1', squadId: '501', relationship: 'manageable', sources: ['dashboard'], type: 'offline' },
      { classCode: 'X1平方', squadId: '502', relationship: 'manageable', sources: ['dashboard'], type: 'offline' },
    ]);
    assert.deepEqual(secondFetch, firstFetch);
    assert.equal(scraper.browser, null);
    assert.equal(requests.filter((item) => item.path === '/admin').length, 1);
  } finally {
    await scraper.close();
    await close(upstream);
  }
});

test('MiniPin grant record reader maps class transactions back to student numbers and MP amounts', async () => {
  let recordQuery = null;
  const upstream = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === '/admin/squad_console') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<script>window.__STATE__ = { _token: "record-token" };</script>');
      return;
    }
    if (url.pathname === '/admin/squad/cop_mip/getStudentList') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ code: 1, data: [
        { id: 11, no: '001', en_name: 'Amy', ch_name: '张三' },
        { id: 12, no: '002', en_name: 'Ben', ch_name: '李四' },
      ] }));
      return;
    }
    if (url.pathname === '/admin/squad/cop_mip/getSquadStudent') {
      recordQuery = url.searchParams;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (recordQuery.get('start_at') || recordQuery.get('end_at')) {
        res.end(JSON.stringify({ code: 1, data: { total: 0, rows: [] } }));
        return;
      }
      res.end(JSON.stringify({ code: 1, data: { total: 3, rows: [
        { id: 91, student_id: 11, number: 3, add_at: '2026-09-03 17:29:35', type_name: '发放', grant_name: 'CP', tag_name: 'MP奖励', add_user_name: 'Teacher' },
        { id: 92, student_id: 12, number: 2, add_at: '2026-09-03 17:29:35', type_name: '发放', grant_name: 'CP', tag_name: 'MP奖励', add_user_name: 'Teacher' },
        { id: 90, student_id: 11, number: 9, add_at: '2026-09-02 17:29:35', type_name: '发放', grant_name: 'CP', tag_name: 'MP奖励', add_user_name: 'Teacher' },
      ] } }));
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });
  const address = await listen(upstream);
  const scraper = new EducationSystemScraper({ baseUrl: `http://${address.address}:${address.port}` });
  scraper.classMapCache = [{ classCode: 'J464', squadId: '1400' }];
  scraper.classMapCacheAt = Date.now();
  try {
    const records = await scraper.getMinipinGrantRecords('J464', {
      startedAt: '2026-09-03T09:29:27.000Z',
      endedAt: '2026-09-03T09:32:27.000Z',
    });
    assert.deepEqual(records.map((record) => ({
      id: record.id,
      studentNo: record.studentNo,
      amount: record.amount,
      occurredAt: record.occurredAt,
    })), [
      { id: '91', studentNo: '001', amount: 0.3, occurredAt: '2026-09-03T09:29:35.000Z' },
      { id: '92', studentNo: '002', amount: 0.2, occurredAt: '2026-09-03T09:29:35.000Z' },
    ]);
    assert.equal(recordQuery.get('start_at'), '');
    assert.equal(recordQuery.get('end_at'), '');
    assert.equal(recordQuery.get('_token'), 'record-token');
  } finally {
    await scraper.close();
    await close(upstream);
  }
});

test('a failed JSON body read is not returned as an empty successful catalog', async () => {
  const scraper = new EducationSystemScraper();
  const error = new DOMException('upstream body deadline', 'AbortError');
  scraper.session.request = async () => ({ json: async () => { throw error; } });
  await assert.rejects(scraper.fetchSemesterData(true), error);
  assert.deepEqual(scraper.semesterDataCache, []);
  scraper.session.request = async () => ({ json: async () => [{ id: 'term-1' }] });
  assert.deepEqual(await scraper.fetchSemesterData(), [{ id: 'term-1' }]);
});

for (const [label, response, pattern] of [
  ['upstream failure', () => new Response('{"data":[]}', { status: 503 }), /HTTP 503/],
  ['expired authentication', () => new Response('expired', { status: 401 }), /登录状态已失效/],
  ['unexpected HTML', () => new Response('<html>login</html>'), /返回格式异常/],
]) {
  test(`${label} cannot replace a usable semester cache with an empty list`, async () => {
    const scraper = new EducationSystemScraper();
    scraper.semesterDataCache = [{ id: 'previous-term' }];
    scraper.session.request = async () => response();
    await assert.rejects(scraper.fetchSemesterData(true), pattern);
    assert.deepEqual(scraper.semesterDataCache, [{ id: 'previous-term' }]);
    scraper.session.request = async () => new Response('[]');
    assert.deepEqual(await scraper.fetchSemesterData(true), []);
  });
}
