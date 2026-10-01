const { AsyncLocalStorage } = require('node:async_hooks');
const { createBrowserTaskQueue, withBrowserTask } = require('./browserTaskQueue');

// Cookies belong to the HTTP session; browser processes belong to one task.
// A long-lived login must never keep an idle Chromium alive for months.
class ScraperBrowserRuntime {
  constructor(scraper, launch, { runShared = withBrowserTask, closeTimeoutMs = 5000 } = {}) {
    this.scraper = scraper;
    this.launch = launch;
    this.runShared = runShared;
    this.closeTimeoutMs = closeTimeoutMs;
    this.queue = createBrowserTaskQueue(1);
    this.context = new AsyncLocalStorage();
    this.launchPromise = null;
    this.closePromise = null;
  }

  run(label, task) {
    // Class-list fallback can call class-map fallback inside the same task.
    // Reuse its lease rather than deadlocking or closing its page early.
    const current = this.context.getStore();
    if (current?.active) return task();
    return this.queue.withTask(() => this.runShared(async () => {
      const lease = { active: true };
      return this.context.run(lease, async () => {
        try {
          return await task();
        } finally {
          lease.active = false;
          await this.close();
        }
      });
    }, { label }), { label });
  }

  async ensureBrowser() {
    if (this.closePromise) await this.closePromise;
    if (this.scraper.browser?.isConnected?.() === false) await this.close();
    if (this.scraper.browser) return this.scraper.browser;
    if (!this.launchPromise) {
      this.launchPromise = Promise.resolve().then(this.launch).then(browser => {
        this.scraper.browser = browser;
        this.scraper.browserSessionReady = false;
        return browser;
      }).finally(() => { this.launchPromise = null; });
    }
    return this.launchPromise;
  }

  async replacePage() {
    const browser = await this.ensureBrowser();
    const previous = this.scraper.page;
    this.scraper.page = null;
    this.scraper.browserSessionReady = false;
    if (previous && !previous.isClosed()) await previous.close().catch(() => {});
    this.scraper.page = await browser.newPage();
    return this.scraper.page;
  }

  close() {
    if (this.closePromise) return this.closePromise;
    this.closePromise = this.dispose().finally(() => { this.closePromise = null; });
    return this.closePromise;
  }

  async dispose() {
    // Logout/shutdown can arrive while Chromium is still launching.
    const launching = this.launchPromise;
    if (launching) await launching.catch(() => {});
    const browser = this.scraper.browser;
    this.scraper.browser = null;
    this.scraper.page = null;
    this.scraper.browserSessionReady = false;
    if (!browser) return;
    let timer;
    try {
      await Promise.race([
        Promise.resolve().then(() => browser.close()),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('Browser close timed out')), this.closeTimeoutMs);
        }),
      ]);
    } catch {
      // Only terminate the child we launched, never scan/kill other browsers.
      try { browser.process()?.kill('SIGKILL'); } catch {}
    } finally {
      clearTimeout(timer);
    }
  }
}

module.exports = { ScraperBrowserRuntime };
