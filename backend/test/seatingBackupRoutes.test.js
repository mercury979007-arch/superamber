const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { createSeatingBackupRoutes } = require('../routes/seatingBackupRoutes');

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

test('seating backup stores non-empty latest backup and rejects empty overwrites', async () => {
  const backupStorePath = path.join(os.tmpdir(), `seating-backup-${Date.now()}-${Math.random()}.json`);
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/api', createSeatingBackupRoutes({ backupStorePath }));

  const server = http.createServer(app);
  const address = await listen(server);
  const baseUrl = `http://${address.address}:${address.port}`;

  try {
    const emptyResponse = await fetch(`${baseUrl}/api/seating/backup`);
    assert.equal(emptyResponse.status, 200);
    assert.equal((await emptyResponse.json()).backup, null);

    const rejectedResponse = await fetch(`${baseUrl}/api/seating/backup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ backup: { classData: {} } }),
    });
    assert.equal(rejectedResponse.status, 400);

    const backup = {
      app: { name: 'Super Amber', slug: 'superamber' },
      exportedAt: '2026-07-21T00:00:00.000Z',
      sourceOrigin: 'https://superamber.example.invalid',
      classData: {
        'L2 Camp 1': {
          theme: 'paper',
          weekday: { layout: 'camp', groups: [['A']] },
          weekend: { layout: 'camp', groups: [['B']] },
        },
      },
      userProfile: { username: 'Amber', theme: 'paper' },
      reminderMeta: { enabled: false },
      batchUndo: null,
      academicTermLaunch: {
        termId: '2026-autumn',
        week1Start: '2026-08-31',
        completedAt: '2026-08-30T02:00:00.000Z',
        rotatedClassCodes: ['l2 camp 1'],
      },
    };

    const savedResponse = await fetch(`${baseUrl}/api/seating/backup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ backup }),
    });
    assert.equal(savedResponse.status, 200);
    assert.equal((await savedResponse.json()).classCount, 1);

    const sharedResponse = await fetch(`${baseUrl}/api/seating/backup`);
    assert.equal(sharedResponse.status, 200);
    const sharedJson = await sharedResponse.json();
    assert.equal(sharedJson.classCount, 1);
    assert.equal(sharedJson.backup.classData['L2 Camp 1'].theme, 'paper');
    assert.deepEqual(sharedJson.backup.academicTermLaunch.rotatedClassCodes, ['L2 CAMP 1']);

    const unchangedResponse = await fetch(`${baseUrl}/api/seating/backup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ backup }),
    });
    assert.equal(unchangedResponse.status, 200);
    assert.equal((await unchangedResponse.json()).unchanged, true);

    const concurrentResponses = await Promise.all(Array.from({ length: 6 }, (_, index) => fetch(`${baseUrl}/api/seating/backup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        backup: {
          ...backup,
          exportedAt: `2026-07-21T00:00:0${index}.000Z`,
          classData: {
            ...backup.classData,
            [`Concurrent ${index}`]: {
              theme: 'paper',
              weekday: { layout: 'circular', groups: [[`Student ${index}`]] },
              weekend: { layout: 'circular', groups: [[`Student ${index}`]] },
            },
          },
        },
      }),
    })));
    assert.equal(concurrentResponses.every((response) => response.status === 200), true);
    assert.doesNotThrow(() => JSON.parse(require('fs').readFileSync(backupStorePath, 'utf8')));

    await fs.appendFile(backupStorePath, ' damaged trailing bytes');
    const recoveredResponse = await fetch(`${baseUrl}/api/seating/backup`);
    assert.equal(recoveredResponse.status, 200);
    assert.equal((await recoveredResponse.json()).classCount, 2);
    assert.doesNotThrow(() => JSON.parse(require('fs').readFileSync(backupStorePath, 'utf8')));
    const files = await fs.readdir(path.dirname(backupStorePath));
    assert.equal(files.some((name) => name.startsWith(`${path.basename(backupStorePath)}.corrupt-`)), true);
  } finally {
    await close(server);
  }
});

test('seating backup prevents stale tabs from reverting a weekly rotation unless undo is explicit', async () => {
  const backupStorePath = path.join(os.tmpdir(), `seating-rotation-${Date.now()}-${Math.random()}.json`);
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/api', createSeatingBackupRoutes({ backupStorePath }));
  const server = http.createServer(app);
  const address = await listen(server);
  const baseUrl = `http://${address.address}:${address.port}`;

  const makeBackup = (date, arrangement, student, note = '') => ({
    app: { name: 'Super Amber', slug: 'superamber' },
    exportedAt: '2026-09-06T00:00:00.000Z',
    sourceOrigin: 'https://superamber.example.invalid',
    classData: {
      J101: {
        theme: 'paper',
        weekday: {
          layout: 'circular',
          currentArrangement: arrangement,
          locationInfo: { fullDate: date },
          groups: [[student]],
        },
        weekend: {
          layout: 'circular',
          currentArrangement: arrangement,
          locationInfo: { fullDate: date },
          groups: [[student]],
        },
        todoNotes: note ? [{ text: note }] : [],
      },
    },
    userProfile: { username: 'Amber', theme: 'paper' },
    batchUndo: null,
  });

  try {
    const rotated = makeBackup('2026-09-07', 2, 'Week 2');
    assert.equal((await fetch(`${baseUrl}/api/seating/backup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ backup: rotated }),
    })).status, 200);

    const stale = makeBackup('2026-08-31', 1, 'Week 1', 'new local note');
    const staleResponse = await fetch(`${baseUrl}/api/seating/backup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ backup: stale }),
    });
    const staleResult = await staleResponse.json();
    assert.equal(staleResult.preservedClassCount, 1);

    const protectedBackup = await (await fetch(`${baseUrl}/api/seating/backup`)).json();
    assert.equal(protectedBackup.backup.classData.J101.weekday.locationInfo.fullDate, '2026-09-07');
    assert.equal(protectedBackup.backup.classData.J101.weekday.groups[0][0], 'Week 2');
    assert.equal(protectedBackup.backup.classData.J101.todoNotes[0].text, 'new local note');

    const undoResponse = await fetch(`${baseUrl}/api/seating/backup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ backup: stale, allowDateRegression: true }),
    });
    assert.equal(undoResponse.status, 200);
    const undoneBackup = await (await fetch(`${baseUrl}/api/seating/backup`)).json();
    assert.equal(undoneBackup.backup.classData.J101.weekday.locationInfo.fullDate, '2026-08-31');
    assert.equal(undoneBackup.backup.classData.J101.weekday.groups[0][0], 'Week 1');
  } finally {
    await close(server);
  }
});
