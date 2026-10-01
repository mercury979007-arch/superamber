const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const { createScraperRoutes } = require('../routes/scraperRoutes');

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

function requestJson({ port, host, origin, body }) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: '/api/scraper/batch-student-list',
      method: 'POST',
      headers: {
        Host: host,
        Origin: origin,
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
    req.write(JSON.stringify(body));
    req.end();
  });
}

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', createScraperRoutes({
    ensureSession() {
      return { session: {} };
    },
    requireLoggedInSession(_req, res) {
      res.status(401).json({ error: '未登录，请先登录' });
      return null;
    },
    buildUsageEvent() {
      return {};
    },
    async appendUsageEvent() {},
    USAGE_LOG_PATH: '/tmp/scraper-routes-test.log',
    CNF_BASE_URL: 'https://example.invalid',
    async loginCNF() {
      throw new Error('not implemented');
    },
    async fetchWithJar() {
      throw new Error('not implemented');
    },
    parseMySquadHtml() {
      return [];
    },
    getTraceId() {
      return 'trace-id';
    },
    logTrace() {},
    async saveSessionStore() {},
    EducationSystemScraper: class {},
  }));
  return http.createServer(app);
}

test('batch student list remains available on staging host and blocks production host', async () => {
  const server = createTestApp();
  const address = await listen(server);

  try {
    const allowed = await requestJson({
      port: address.port,
      host: 'staging.example.invalid',
      origin: 'https://staging.example.invalid',
      body: { classIds: ['J101'] },
    });
    assert.equal(allowed.status, 401);

    const blocked = await requestJson({
      port: address.port,
      host: 'superamber.example.invalid',
      origin: 'https://superamber.example.invalid',
      body: { classIds: ['J101'] },
    });
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.error, '该功能仅在测试站开放');
  } finally {
    await close(server);
  }
});
