const test = require('node:test');
const assert = require('node:assert/strict');
const { ScraperBrowserRuntime } = require('../lib/scraperBrowserRuntime');
const { createBrowserTaskQueue } = require('../lib/browserTaskQueue');
const Scraper = require('../scraper/scraper');

function fixture(options = {}) {
  const state = { browser: null, page: null, browserSessionReady: false };
  const events = [];
  let live = 0;
  const runtime = new ScraperBrowserRuntime(state, async () => {
    events.push('launch'); live++;
    return {
      isConnected: () => true,
      newPage: async () => {
        events.push('page');
        let closed = false;
        return { isClosed: () => closed, close: async () => { closed = true; events.push('page:close'); } };
      },
      close: async () => { live--; events.push('close'); },
    };
  }, options);
  return { state, runtime, events, get live() { return live; } };
}

test('success and failure both close the browser before releasing its task lease', async () => {
  const f = fixture();
  assert.equal(await f.runtime.run('success', async () => {
    await f.runtime.replacePage(); return 42;
  }), 42);
  assert.equal(f.live, 0);
  assert.equal(f.state.page, null);
  await assert.rejects(f.runtime.run('failure', async () => {
    await f.runtime.ensureBrowser(); throw new Error('upstream timeout');
  }), /upstream timeout/);
  assert.equal(f.live, 0);
  assert.deepEqual(f.events, ['launch', 'page', 'close', 'launch', 'close']);
});

test('concurrent work on one scraper cannot navigate the same page', async () => {
  const f = fixture();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const order = [];
  const a = f.runtime.run('first', async () => {
    await f.runtime.ensureBrowser(); order.push('a:start'); await gate; order.push('a:end');
  });
  const b = f.runtime.run('second', async () => {
    assert.equal(f.live, 0); await f.runtime.ensureBrowser(); order.push('b');
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(order, ['a:start']); release();
  await Promise.all([a, b]);
  assert.deepEqual(order, ['a:start', 'a:end', 'b']);
  assert.equal(f.live, 0);
});

test('nested class-list/class-map fallback reuses its lease and stays open until the outer task ends', async () => {
  const global = createBrowserTaskQueue(1);
  const f = fixture({ runShared: (...args) => global.withTask(...args) });
  await f.runtime.run('outer', async () => {
    const browser = await f.runtime.ensureBrowser();
    await f.runtime.run('inner', async () => assert.equal(await f.runtime.ensureBrowser(), browser));
    assert.equal(f.live, 1);
  });
  assert.equal(f.live, 0);
  assert.equal(global.getStats().activeCount, 0);
});

test('many teacher sessions do not retain browsers after their tasks finish', async () => {
  const global = createBrowserTaskQueue(2);
  const fs = Array.from({ length: 8 }, () => fixture({ runShared: (...args) => global.withTask(...args) }));
  let peak = 0;
  await Promise.all(fs.map(f => f.runtime.run('teacher', async () => {
    await f.runtime.ensureBrowser();
    peak = Math.max(peak, fs.reduce((n, item) => n + item.live, 0));
    await new Promise(resolve => setImmediate(resolve));
  })));
  assert.equal(peak, 2);
  assert.equal(fs.reduce((n, f) => n + f.live, 0), 0);
});

test('parallel initialization launches once and can retry a failed launch', async () => {
  const f = fixture();
  const [a, b] = await Promise.all([f.runtime.ensureBrowser(), f.runtime.ensureBrowser()]);
  assert.equal(a, b); assert.deepEqual(f.events, ['launch']);
  await f.runtime.close();
  const launch = f.runtime.launch;
  f.runtime.launch = () => { throw new Error('failed launch'); };
  await assert.rejects(f.runtime.ensureBrowser(), /failed launch/);
  f.runtime.launch = launch;
  await f.runtime.ensureBrowser();
  assert.equal(f.live, 1); await f.runtime.close();
});

test('recovery closes the old page before allocating its replacement', async () => {
  const f = fixture();
  const first = await f.runtime.replacePage();
  const second = await f.runtime.replacePage();
  assert.notEqual(first, second);
  assert.equal(first.isClosed(), true);
  assert.deepEqual(f.events, ['launch', 'page', 'page:close', 'page']);
  await f.runtime.close();
});

test('logout during launch waits for that browser and closes it exactly once', async () => {
  const f = fixture();
  let release;
  const launch = f.runtime.launch;
  f.runtime.launch = async () => { await new Promise(resolve => { release = resolve; }); return launch(); };
  const starting = f.runtime.ensureBrowser();
  await new Promise(resolve => setImmediate(resolve));
  const a = f.runtime.close();
  const b = f.runtime.close();
  release(); await Promise.all([starting, a, b]);
  assert.equal(f.live, 0);
  assert.deepEqual(f.events, ['launch', 'close']);
});

test('failed or hung browser close clears state and terminates only its own child', async () => {
  for (const close of [async () => { throw new Error('disconnected'); }, () => new Promise(() => {})]) {
    const f = fixture({ closeTimeoutMs: 10 });
    const signals = [];
    f.state.browser = { close, process: () => ({ kill: signal => signals.push(signal) }) };
    f.state.page = {}; f.state.browserSessionReady = true;
    await f.runtime.close();
    assert.deepEqual(signals, ['SIGKILL']);
    assert.deepEqual(f.state, { browser: null, page: null, browserSessionReady: false });
  }
});

test('disconnected browser is replaced and cleanup preserves login cookies', async () => {
  const scraper = new Scraper();
  const f = fixture();
  scraper.browserRuntime = new ScraperBrowserRuntime(scraper, f.runtime.launch);
  scraper.session.cookieJar.set('session', { name: 'session', value: 'synthetic-cookie' });
  let closed = 0;
  scraper.browser = { isConnected: () => false, close: async () => { closed++; } };
  await scraper.runBrowserTask('reconnect', async () => { await scraper.initBrowser(); });
  assert.equal(closed, 1);
  assert.equal(scraper.browser, null);
  assert.equal(scraper.session.cookieJar.get('session').value, 'synthetic-cookie');
});
