const DEFAULT_BROWSER_TASK_LIMIT = Math.max(
  1,
  Math.min(4, Number(process.env.CLASSSITDOWN_BROWSER_TASK_LIMIT) || 2)
);

function createBrowserTaskQueue(limit = DEFAULT_BROWSER_TASK_LIMIT, { maxQueued = 8, waitTimeoutMs = 30_000 } = {}) {
  const concurrency = Math.max(1, Number(limit) || 1);
  let activeCount = 0;
  const waiters = [];

  const releaseNext = () => {
    activeCount = Math.max(0, activeCount - 1);
    const next = waiters.shift();
    if (!next) return;
    activeCount += 1;
    clearTimeout(next.timer);
    next.resolve();
  };

  const acquire = async (label = 'browser-task') => {
    if (activeCount < concurrency) {
      activeCount += 1;
      return;
    }

    if (waiters.length >= maxQueued) {
      throw Object.assign(new Error('数据读取繁忙，请稍后重试'), { code: 'BROWSER_QUEUE_FULL' });
    }
    await new Promise((resolve, reject) => {
      const waiter = { resolve, timer: null };
      waiter.timer = setTimeout(() => {
        const index = waiters.indexOf(waiter);
        if (index >= 0) waiters.splice(index, 1);
        reject(Object.assign(new Error('数据读取排队超时，请稍后重试'), { code: 'BROWSER_QUEUE_TIMEOUT' }));
      }, waitTimeoutMs);
      waiters.push(waiter);
    });
  };

  return {
    async withTask(fn, options = {}) {
      const label = String(options.label || 'browser-task').trim() || 'browser-task';
      const startedAt = Date.now();
      await acquire(label);
      const waitMs = Date.now() - startedAt;
      // Progress logs are operational diagnostics; Node's isolated test runner
      // can corrupt its IPC framing when these async-context writes interleave.
      if (waitMs > 0 && process.env.NODE_ENV !== 'test') {
        console.log(`ℹ️ 浏览器任务开始: ${label}; waited=${waitMs}ms; active=${activeCount}/${concurrency}`);
      }

      try {
        return await fn();
      } finally {
        releaseNext();
      }
    },
    getStats() {
      return {
        concurrency,
        activeCount,
        queuedCount: waiters.length,
      };
    },
  };
}

const sharedQueue = createBrowserTaskQueue();

async function withBrowserTask(fn, options = {}) {
  return sharedQueue.withTask(fn, options);
}

function getBrowserTaskQueueStats() {
  return sharedQueue.getStats();
}

module.exports = {
  createBrowserTaskQueue,
  withBrowserTask,
  getBrowserTaskQueueStats,
};
