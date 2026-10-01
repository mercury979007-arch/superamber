const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const { createScoreBookRoutes, isTestOnlyRequestAllowed } = require('../routes/scoreBookRoutes');

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

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function createTestApp(scraper) {
  const app = express();
  app.use(express.json());
  app.use('/api', createScoreBookRoutes({
    requireLoggedInSession() {
      return { scraper, username: 'Amber', scoreBookCache: {} };
    },
    buildUsageEvent() {
      return {};
    },
    async appendUsageEvent() {},
    USAGE_LOG_PATH: '/tmp/score-book-test.log',
    sanitizeText(value) {
      return String(value || '');
    },
  }));
  return http.createServer(app);
}

test('score-book routes stay available on localhost/test-like hosts', async () => {
  const scraper = {
    async requestText(path) {
      if (path.startsWith('/admin/my_todo_notices?')) {
        return {
          text: `
            <html>
              <body>
                <table><tbody>
                  <tr>
                    <td></td><td>474063</td><td></td><td>测试</td><td>L0 寒假课营后测 5/9/10月班级录入-K339/2026-02-01</td>
                    <td>2026-02-01 00:00:00</td><td>2026-02-12 00:00:00</td><td></td><td>已完成</td>
                  </tr>
                </tbody></table>
              </body>
            </html>
          `,
        };
      }
      throw new Error(`unexpected requestText path: ${path}`);
    },
    async request() {
      throw new Error('unexpected request path');
    },
  };

  const server = createTestApp(scraper);
  const address = await listen(server);

  try {
    const response = await fetch(`http://${address.address}:${address.port}/api/score-book/tasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ classId: 'K339' }),
    });
    const data = await response.json();

    assert.equal(response.status, 200);
    assert.equal(data.count, 1);
    assert.equal(data.data[0].noticeId, '474063');
  } finally {
    await close(server);
  }
});

test('score-book routes reject production-domain requests', () => {
  assert.equal(isTestOnlyRequestAllowed({
    headers: {
      host: 'superamber.example.invalid',
      origin: 'https://superamber.example.invalid',
      referer: 'https://superamber.example.invalid/welcome',
    },
  }), false);

  assert.equal(isTestOnlyRequestAllowed({
    headers: {
      host: 'staging.example.invalid',
      origin: '',
      referer: '',
    },
  }), true);
});
