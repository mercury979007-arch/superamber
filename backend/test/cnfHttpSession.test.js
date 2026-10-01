const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { CnfHttpSession } = require('../lib/cnfHttpSession');

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

test('CNF session keeps cookies across requests and decodes xsrf token', async () => {
  const upstream = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === '/login') {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Set-Cookie': [
          'XSRF-TOKEN=session-xsrf%3Dvalue; Path=/',
          'laravel_session=prelogin; Path=/; HttpOnly',
        ],
      });
      res.end('<html>ok</html>');
      return;
    }

    if (url.pathname === '/echo-cookie') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ cookie: req.headers.cookie || '' }));
      return;
    }

    res.writeHead(404).end();
  });

  const address = await listen(upstream);
  const session = new CnfHttpSession(`http://${address.address}:${address.port}`);

  try {
    await session.requestText('/login');
    const echo = await session.request('/echo-cookie');
    const json = await echo.json();

    assert.match(json.cookie, /XSRF-TOKEN=session-xsrf%3Dvalue/);
    assert.match(json.cookie, /laravel_session=prelogin/);
    assert.equal(session.getDecodedCookieValue('XSRF-TOKEN'), 'session-xsrf=value');
  } finally {
    await close(upstream);
  }
});

test('CNF session can detect login pages from both url and html', () => {
  const session = new CnfHttpSession('https://school.example.invalid');

  assert.equal(session.isLoginPage('<html><title>C&F School教务管理系统 | 登录</title></html>', ''), true);
  assert.equal(session.isLoginPage('<html>ok</html>', 'https://school.example.invalid/admin/auth/login'), true);
  assert.equal(session.isLoginPage('<html>dashboard</html>', 'https://school.example.invalid/admin'), false);
});

for (const phase of ['headers', 'body']) {
  test(`CNF request deadline cancels stalled ${phase} and allows the next request`, async () => {
    const upstream = http.createServer((req, res) => {
      if (req.url === '/ok') return res.end('recovered');
      if (phase === 'body') { res.writeHead(200); res.write('incomplete'); }
    });
    const address = await listen(upstream);
    const session = new CnfHttpSession(`http://${address.address}:${address.port}`, { timeoutMs: 80 });
    try {
      await assert.rejects(session.requestText('/stalled'), error => ['TimeoutError', 'AbortError'].includes(error.name));
      session.timeoutMs = 2000;
      assert.equal((await session.requestText('/ok')).text, 'recovered');
      const controller = new AbortController();
      controller.abort();
      await assert.rejects(session.request('/ok', { signal: controller.signal }), { name: 'AbortError' });
    } finally {
      upstream.closeAllConnections();
      await close(upstream);
    }
  });
}
