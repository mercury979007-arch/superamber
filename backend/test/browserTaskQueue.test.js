const test = require('node:test');
const assert = require('node:assert/strict');

const { createBrowserTaskQueue } = require('../lib/browserTaskQueue');

test('browser task queue serializes work when concurrency is 1', async () => {
  const queue = createBrowserTaskQueue(1);
  const timeline = [];

  const taskA = queue.withTask(async () => {
    timeline.push('a:start');
    await new Promise((resolve) => setTimeout(resolve, 40));
    timeline.push('a:end');
  }, { label: 'a' });

  const taskB = queue.withTask(async () => {
    timeline.push('b:start');
    timeline.push(`stats:${JSON.stringify(queue.getStats())}`);
    timeline.push('b:end');
  }, { label: 'b' });

  await Promise.all([taskA, taskB]);

  assert.deepEqual(timeline.slice(0, 3), ['a:start', 'a:end', 'b:start']);
  assert.match(timeline[3], /"activeCount":1/);
  assert.equal(timeline.at(-1), 'b:end');
});

test('full queue rejects additional work without running it', async () => {
  const queue = createBrowserTaskQueue(1, { maxQueued: 1 });
  let release;
  const a = queue.withTask(() => new Promise(resolve => { release = resolve; }));
  const b = queue.withTask(() => 'queued');
  await assert.rejects(queue.withTask(() => assert.fail('must not execute')), { code: 'BROWSER_QUEUE_FULL' });
  release();
  assert.deepEqual(await Promise.all([a, b]), [undefined, 'queued']);
  assert.deepEqual(queue.getStats(), { concurrency: 1, activeCount: 0, queuedCount: 0 });
});

test('expired waiters never run later and do not consume permits', async () => {
  const queue = createBrowserTaskQueue(1, { waitTimeoutMs: 10 });
  let release;
  const a = queue.withTask(() => new Promise(resolve => { release = resolve; }));
  await assert.rejects(queue.withTask(() => assert.fail('expired task ran')), { code: 'BROWSER_QUEUE_TIMEOUT' });
  assert.equal(queue.getStats().queuedCount, 0);
  release(); await a;
  assert.equal(await queue.withTask(() => 42), 42);
  assert.equal(queue.getStats().activeCount, 0);
});

test('a rejected active task releases capacity for the next waiter', async () => {
  const queue = createBrowserTaskQueue(1);
  const a = queue.withTask(async () => { throw new Error('upstream failure'); });
  const b = queue.withTask(() => 42);
  await assert.rejects(a, /upstream failure/);
  assert.equal(await b, 42);
  assert.equal(queue.getStats().activeCount, 0);
});
