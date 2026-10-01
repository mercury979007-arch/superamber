const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { createCampReportTemplateRoutes } = require('../routes/campReportTemplateRoutes');

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

test('camp report templates are shared through backend storage and protected by admin password', async () => {
  const templateStorePath = path.join(os.tmpdir(), `camp-report-templates-${Date.now()}.json`);
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/api', createCampReportTemplateRoutes({
    templateStorePath,
    adminPassword: 'secret',
  }));

  const server = http.createServer(app);
  const address = await listen(server);
  const baseUrl = `http://${address.address}:${address.port}`;

  try {
    const emptyResponse = await fetch(`${baseUrl}/api/camp-report/templates`);
    assert.equal(emptyResponse.status, 200);
    assert.deepEqual((await emptyResponse.json()).templates, {});

    const rejectedResponse = await fetch(`${baseUrl}/api/camp-report/templates`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        password: 'wrong',
        template: {
          majorCamp: 'L2',
          minorCamp: 'Camp 2',
          dayIndex: 1,
          defaultDisplayCampName: 'L2 Camp 2',
          goalText: '冲刺目标：测试',
          prepText: '明日准备：测试',
        },
      }),
    });
    assert.equal(rejectedResponse.status, 401);

    const savedResponse = await fetch(`${baseUrl}/api/camp-report/templates`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        password: 'secret',
        template: {
          majorCamp: 'L2',
          minorCamp: 'Camp 2',
          dayIndex: 1,
          defaultDisplayCampName: 'L2 Camp 2',
          goalText: '冲刺目标：测试',
          prepText: '明日准备：测试',
        },
      }),
    });
    assert.equal(savedResponse.status, 200);
    const savedJson = await savedResponse.json();
    assert.equal(savedJson.templates['L2__Camp 2__1'].goalText, '冲刺目标：测试');

    const bulkResponse = await fetch(`${baseUrl}/api/camp-report/templates/bulk`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        password: 'secret',
        templates: [
          {
            majorCamp: 'L2',
            minorCamp: 'Camp 2',
            dayIndex: 2,
            defaultDisplayCampName: 'L2 Camp 2',
            goalText: '冲刺目标：批量',
            prepText: '明日准备：批量',
          },
        ],
      }),
    });
    assert.equal(bulkResponse.status, 200);
    assert.equal((await bulkResponse.json()).savedCount, 1);

    const sharedResponse = await fetch(`${baseUrl}/api/camp-report/templates`);
    assert.equal(sharedResponse.status, 200);
    const sharedJson = await sharedResponse.json();
    assert.equal(sharedJson.templates['L2__Camp 2__1'].goalText, '冲刺目标：测试');
    assert.equal(sharedJson.templates['L2__Camp 2__2'].goalText, '冲刺目标：批量');
  } finally {
    await close(server);
  }
});
