const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { createClassroomObservationAsrRouter } = require('../routes/classroomObservationAsrRoutes');

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address())));
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

test('classroom observation ASR accepts raw audio and returns transcript', async () => {
  let receivedMime = '';
  const app = express();
  app.use('/classroom-observation-api', createClassroomObservationAsrRouter({
    normalize: async (audio, mime) => {
      assert.equal(audio.length, 1024);
      receivedMime = mime;
      return Buffer.from('normalized');
    },
    transcribe: async (audio) => {
      assert.equal(audio.toString(), 'normalized');
      return { text: 'Amber，cook 这个词不熟。', durationMs: 2300 };
    },
  }));
  const server = http.createServer(app);
  const address = await listen(server);
  try {
    const response = await fetch(`http://${address.address}:${address.port}/classroom-observation-api/transcribe`, {
      method: 'POST',
      headers: {
        origin: 'https://superamber.example.invalid',
        'content-type': 'audio/mp4',
      },
      body: Buffer.alloc(1024, 1),
    });
    assert.equal(response.status, 200);
    assert.equal(receivedMime, 'audio/mp4');
    assert.equal((await response.json()).text, 'Amber，cook 这个词不熟。');
  } finally {
    await close(server);
  }
});

test('classroom observation ASR rejects unexpected origins and empty clips', async () => {
  const app = express();
  app.use('/classroom-observation-api', createClassroomObservationAsrRouter());
  const server = http.createServer(app);
  const address = await listen(server);
  const url = `http://${address.address}:${address.port}/classroom-observation-api/transcribe`;
  try {
    const rejectedOrigin = await fetch(url, {
      method: 'POST',
      headers: { origin: 'https://example.com', 'content-type': 'audio/webm' },
      body: Buffer.alloc(1024, 1),
    });
    assert.equal(rejectedOrigin.status, 403);

    const empty = await fetch(url, {
      method: 'POST',
      headers: { origin: 'https://superamber.example.invalid', 'content-type': 'audio/webm' },
      body: Buffer.alloc(20, 1),
    });
    assert.equal(empty.status, 400);
  } finally {
    await close(server);
  }
});
