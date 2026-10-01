const test = require('node:test');
const assert = require('node:assert/strict');
const { createSeatingImageRenderer } = require('../services/seatingImageRenderer');
const { createBrowserTaskQueue } = require('../lib/browserTaskQueue');

const input = { html: '<div data-export-root="1">Class</div>', cssText: '', width: 1600, height: 900 };

function fixture(failure = '') {
  const calls = { launched: 0, closed: 0, viewport: null };
  const page = {
    setJavaScriptEnabled: async value => { calls.javascriptEnabled = value; },
    setViewport: async value => { calls.viewport = value; },
    setContent: async () => { if (failure === 'content') throw new Error('network timeout'); },
    $: async () => failure === 'missing' ? null : { screenshot: async () => {
      if (failure === 'screenshot') throw new Error('target closed');
      return Buffer.from('png-fixture');
    } },
  };
  const launch = async () => {
    calls.launched++;
    if (failure === 'launch') throw new Error('launch failed');
    return {
      newPage: async () => { if (failure === 'page') throw new Error('page failed'); return page; },
      close: async () => { calls.closed++; },
    };
  };
  return { calls, launch };
}

test('exports retain canvas scale but release the browser after each image', async () => {
  const f = fixture();
  const render = createSeatingImageRenderer({ launch: f.launch });
  assert.equal((await render(input)).toString(), 'png-fixture');
  assert.deepEqual(f.calls.viewport, { width: 1600, height: 900, deviceScaleFactor: 2 });
  assert.equal(f.calls.closed, 1);
  assert.equal(f.calls.javascriptEnabled, false);
  await render(input);
  assert.equal(f.calls.launched, 2);
  assert.equal(f.calls.closed, 2);
});

test('page creation, content, missing root and screenshot failures all release the browser', async () => {
  for (const failure of ['page', 'content', 'missing', 'screenshot']) {
    const f = fixture(failure);
    await assert.rejects(createSeatingImageRenderer({ launch: f.launch })(input));
    assert.equal(f.calls.closed, 1, failure);
  }
});

test('a failed launch releases its queue slot so the next export can succeed', async () => {
  const queue = createBrowserTaskQueue(1);
  let launch = fixture('launch').launch;
  const render = createSeatingImageRenderer({ launch: () => launch(), runShared: queue.withTask });
  await assert.rejects(render(input), /launch failed/);
  assert.equal(queue.getStats().activeCount, 0);
  const f = fixture();
  launch = f.launch;
  await render(input);
  assert.equal(f.calls.closed, 1);
  assert.equal(queue.getStats().activeCount, 0);
});

test('parallel exports share the bounded browser queue', async () => {
  const queue = createBrowserTaskQueue(1);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const f = fixture();
  const render = createSeatingImageRenderer({ launch: async () => {
    const browser = await f.launch();
    if (f.calls.launched === 1) await gate;
    return browser;
  }, runShared: queue.withTask });
  const jobs = [render(input), render(input), render(input)];
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.calls.launched, 1);
  assert.equal(queue.getStats().queuedCount, 2);
  release();
  await Promise.all(jobs);
  assert.equal(f.calls.closed, 3);
  assert.deepEqual(queue.getStats(), { concurrency: 1, activeCount: 0, queuedCount: 0 });
});
