const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { submitRecoveryOnce } = require('../lib/minipinRecoverySubmission');

test('recovery protects concurrent requests and replays receipts after restart', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mp-recovery-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const options = { directory, username: 'teacher', requestId: 'test-recovery-00001',
    payload: { amount: 0.5 }, submit: async () => { calls += 1; await gate; return { success: 1, totalMP: 0.5 }; } };
  const first = submitRecoveryOnce(options);
  while (!calls) await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(submitRecoveryOnce(options), /禁止自动重试/);
  release();
  assert.equal((await first).totalMP, 0.5);
  assert.equal((await submitRecoveryOnce(options)).duplicate, true);
  assert.equal(calls, 1);
  await assert.rejects(submitRecoveryOnce({ ...options, payload: { amount: 1 } }), /已改变/);
});

test('recovery retains an uncertain claim across later requests', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mp-recovery-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  let calls = 0;
  const options = { directory, username: 'teacher', requestId: 'test-recovery-00002',
    payload: {}, submit: async () => { calls += 1; throw new Error('timeout'); } };
  await assert.rejects(submitRecoveryOnce(options), /timeout/);
  await assert.rejects(submitRecoveryOnce(options), /禁止自动重试/);
  assert.equal(calls, 1);
});
