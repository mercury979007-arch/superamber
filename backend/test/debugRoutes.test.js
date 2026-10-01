const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

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

function postDebugRoute(port, path, host) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      path,
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

test('debug probe routes are test-only on the actual server app', async () => {
  delete require.cache[require.resolve('../server')];
  const { app } = require('../server');
  const backend = http.createServer(app);
  const address = await listen(backend);

  try {
    for (const path of ['/api/debug/probe-copmip', '/api/debug/probe-cnf-apis']) {
      const stagingResponse = await postDebugRoute(address.port, path, 'staging.example.invalid');
      assert.equal(stagingResponse.status, 401);
      assert.equal(stagingResponse.body.error, '未登录，请先登录');

      const productionResponse = await postDebugRoute(address.port, path, 'superamber.example.invalid');
      assert.equal(productionResponse.status, 403);
      assert.equal(productionResponse.body.error, '该调试接口仅在测试站开放');
    }
  } finally {
    await close(backend);
  }
});
