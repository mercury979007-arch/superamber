function createAsyncLimiter({ concurrency = 2, maxQueue = 32 } = {}) {
  const limit = Math.max(1, Number(concurrency) || 1);
  const queueLimit = Math.max(0, Number(maxQueue) || 0);
  const queue = [];
  const idleWaiters = [];
  let active = 0;
  let closing = false;

  function notifyIdle() {
    if (active !== 0 || queue.length !== 0) return;
    for (const resolve of idleWaiters.splice(0)) resolve();
  }

  function pump() {
    while (!closing && active < limit && queue.length > 0) {
      const item = queue.shift();
      active += 1;
      Promise.resolve()
        .then(item.task)
        .then(item.resolve, item.reject)
        .finally(() => {
          active -= 1;
          pump();
          notifyIdle();
        });
    }
    notifyIdle();
  }

  function rejectQueued(message) {
    for (const item of queue.splice(0)) {
      const error = new Error(message);
      error.code = 'DB_SHADOW_QUEUE_CLOSED';
      item.reject(error);
    }
  }

  return {
    run(task) {
      if (closing) {
        const error = new Error('数据库影子刷新队列已经关闭');
        error.code = 'DB_SHADOW_QUEUE_CLOSED';
        return Promise.reject(error);
      }
      if (active >= limit && queue.length >= queueLimit) {
        const error = new Error('数据库影子刷新队列已满，应返回旧快照或回退现有链路');
        error.code = 'DB_SHADOW_QUEUE_FULL';
        return Promise.reject(error);
      }
      return new Promise((resolve, reject) => {
        queue.push({ task, resolve, reject });
        pump();
      });
    },
    stats() {
      return { active, queued: queue.length, concurrency: limit, maxQueue: queueLimit };
    },
    async close() {
      closing = true;
      rejectQueued('数据库影子刷新队列关闭，未开始的读取已取消');
      if (active === 0) return;
      await new Promise((resolve) => idleWaiters.push(resolve));
    },
  };
}

module.exports = { createAsyncLimiter };
