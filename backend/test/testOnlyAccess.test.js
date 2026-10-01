const test = require('node:test');
const assert = require('node:assert/strict');

const { isTestOnlyRequestAllowed } = require('../lib/testOnlyAccess');
const { TEST_ONLY_ROUTES, createTestOnlyMiddleware } = require('../lib/testOnlyAccess');
const express = require('express');

test('production rejects every private API even with staging or local headers; staging preserves access', async () => {
  for (const environment of ['production', 'unknown', 'staging']) {
    let reached = 0;
    const app = express();
    app.use(TEST_ONLY_ROUTES, createTestOnlyMiddleware(environment));
    app.use((_req, res) => { reached++; res.json({ ok: true }); });
    const server = await new Promise(resolve => { const value = app.listen(0, '127.0.0.1', () => resolve(value)); });
    try {
      for (const route of TEST_ONLY_ROUTES) {
        const response = await fetch(`http://127.0.0.1:${server.address().port}${route}`, { headers: { 'x-forwarded-host': 'staging.example.invalid' } });
        assert.equal(response.status, environment === 'staging' ? 200 : 403, route);
      }
      assert.equal(reached, environment === 'staging' ? TEST_ONLY_ROUTES.length : 0);
      assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/api/seating/export-image`)).status, 200);
    } finally { await new Promise(resolve => server.close(resolve)); }
  }
});

test('production opt-in exposes only the classroom-agent API', async () => {
  const app = express();
  app.use(TEST_ONLY_ROUTES, createTestOnlyMiddleware('production', {
    allowProductionClassroomAgentApi: true,
  }));
  app.use((_req, res) => res.json({ ok: true }));
  const server = await new Promise(resolve => { const value = app.listen(0, '127.0.0.1', () => resolve(value)); });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const request = route => fetch(`${base}${route}`, { headers: { 'x-forwarded-host': 'superamber.example.invalid' } });
    assert.equal((await request('/api/classroom-agent/read-grant/exchange')).status, 200);
    assert.equal((await request('/classroom-agent/')).status, 403);
    assert.equal((await request('/api/admin/usage-summary')).status, 403);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('test-only access allows staging and local hosts', () => {
  assert.equal(isTestOnlyRequestAllowed({
    headers: {
      host: 'staging.example.invalid',
      origin: '',
      referer: '',
    },
  }), true);

  assert.equal(isTestOnlyRequestAllowed({
    headers: {
      host: '127.0.0.1:7781',
      origin: 'http://localhost:5173',
      referer: '',
    },
  }), true);
});

test('test-only access blocks production-like hosts', () => {
  assert.equal(isTestOnlyRequestAllowed({
    headers: {
      host: 'superamber.example.invalid',
      origin: 'https://superamber.example.invalid',
      referer: 'https://superamber.example.invalid/welcome',
    },
  }), false);

  assert.equal(isTestOnlyRequestAllowed({
    headers: {
      host: 'superamber.example.invalid',
      origin: 'https://staging.example.invalid',
      referer: '',
    },
  }), false);

  assert.equal(isTestOnlyRequestAllowed({
    headers: {
      host: '127.0.0.1:7781',
      'x-forwarded-host': 'superamber.example.invalid',
      origin: '',
      referer: '',
    },
  }), false);
});
