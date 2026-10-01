function defaultWeigh(value) {
  return Buffer.byteLength(JSON.stringify(value));
}

function createAsyncTtlCache({
  ttlMs = 30_000,
  staleTtlMs = 5 * 60_000,
  maxEntries = 32,
  maxWeightBytes = 32 * 1024 * 1024,
  now = Date.now,
  weigh = defaultWeigh,
} = {}) {
  const entries = new Map();
  const inFlight = new Map();
  let totalWeightBytes = 0;

  if (staleTtlMs < ttlMs) {
    throw new Error('staleTtlMs 不能小于 ttlMs');
  }

  function remove(key) {
    const entry = entries.get(key);
    if (!entry) return;
    totalWeightBytes -= entry.weightBytes;
    entries.delete(key);
  }

  function prune(timestamp) {
    for (const [key, entry] of entries) {
      if (timestamp - entry.createdAt >= staleTtlMs) remove(key);
    }
    while (entries.size > maxEntries || totalWeightBytes > maxWeightBytes) {
      remove(entries.keys().next().value);
    }
  }

  function store(key, value) {
    const weightBytes = Math.max(0, Number(weigh(value)) || 0);
    remove(key);
    entries.set(key, { value, createdAt: now(), weightBytes });
    totalWeightBytes += weightBytes;
    prune(now());
  }

  function startBackgroundRefresh(key, loader) {
    const promise = Promise.resolve().then(loader);
    inFlight.set(key, promise);
    promise
      .then((value) => store(key, value))
      .catch(() => {})
      .finally(() => {
        if (inFlight.get(key) === promise) inFlight.delete(key);
      });
    return promise;
  }

  return {
    async getOrLoad(key, loader, { bypass = false } = {}) {
      const startedAt = now();
      prune(startedAt);
      if (!bypass) {
        const cached = entries.get(key);
        if (cached) {
          entries.delete(key);
          entries.set(key, cached);
          const ageMs = startedAt - cached.createdAt;
          if (ageMs >= ttlMs && !inFlight.has(key)) {
            startBackgroundRefresh(key, loader);
          }
          return {
            value: cached.value,
            cacheHit: true,
            stale: ageMs >= ttlMs,
            refreshing: ageMs >= ttlMs,
            sharedInFlight: false,
            ageMs,
          };
        }
        const pending = inFlight.get(key);
        if (pending) {
          return {
            value: await pending,
            cacheHit: false,
            stale: false,
            refreshing: false,
            sharedInFlight: true,
            ageMs: 0,
          };
        }
      }

      const promise = Promise.resolve().then(loader);
      if (!bypass) inFlight.set(key, promise);
      try {
        const value = await promise;
        if (!bypass) {
          store(key, value);
        }
        return {
          value,
          cacheHit: false,
          stale: false,
          refreshing: false,
          sharedInFlight: false,
          ageMs: 0,
        };
      } finally {
        if (!bypass && inFlight.get(key) === promise) inFlight.delete(key);
      }
    },
    clear() {
      entries.clear();
      totalWeightBytes = 0;
    },
    stats() {
      prune(now());
      return {
        entries: entries.size,
        inFlight: inFlight.size,
        ttlMs,
        staleTtlMs,
        maxEntries,
        totalWeightBytes,
        maxWeightBytes,
      };
    },
  };
}

module.exports = { createAsyncTtlCache };
