const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const { createMpRoutes } = require('../routes/mpRoutes');

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

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', createMpRoutes({
    requireLoggedInSession(req, res) {
      res.status(401).json({ error: '未登录，请先登录' });
      return null;
    },
    buildUsageEvent() {
      return {};
    },
    async appendUsageEvent() {},
    USAGE_LOG_PATH: '/tmp/mp-routes-test.log',
    sanitizeText(value) {
      return String(value || '');
    },
    collectFailedRewardIds() {
      return [];
    },
  }));
  return http.createServer(app);
}

async function postProbeWithHost(port, host) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: '/api/debug/probe-copmip',
      method: 'POST',
      headers: {
        Host: host,
        Origin: `https://${host}`,
        'Content-Type': 'application/json',
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
    req.end(JSON.stringify({ classId: 'J342' }));
  });
}

test('debug cop-mip probe stays available on staging hosts and blocks production hosts', async () => {
  const server = createTestApp();
  const address = await listen(server);

  try {
    const stagingResponse = await postProbeWithHost(address.port, 'staging.example.invalid');
    assert.equal(stagingResponse.status, 401);
    assert.equal(stagingResponse.body.error, '未登录，请先登录');

    const productionResponse = await postProbeWithHost(address.port, 'superamber.example.invalid');
    assert.equal(productionResponse.status, 403);
    assert.equal(productionResponse.body.error, '该调试接口仅在测试站开放');
  } finally {
    await close(server);
  }
});
