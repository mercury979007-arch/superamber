const crypto = require('node:crypto');

const SOURCE_MODES = new Set(['off', 'shadow', 'canary', 'primary']);
const POLICY_FALLBACK_CODES = new Set([
  'DB_SOURCE_UNMAPPED_TASK',
  'DB_SOURCE_UNSUPPORTED_SCOPE',
]);

function isPolicyFallback(error) {
  return POLICY_FALLBACK_CODES.has(String(error?.code || ''));
}

function normalizePositiveIds(values = []) {
  return [...new Set((Array.isArray(values) ? values : [values])
    .map(Number)
    .filter((value) => Number.isInteger(value) && value > 0))]
    .sort((left, right) => left - right);
}

function loadSourceSwitchConfig(env = process.env) {
  const mode = String(env.SUPERAMBER_DB_SOURCE_MODE || 'off').trim().toLowerCase();
  if (!SOURCE_MODES.has(mode)) {
    throw new Error(`SUPERAMBER_DB_SOURCE_MODE 不支持 ${mode}`);
  }
  const canaryPercent = Math.max(0, Math.min(100,
    Number(env.SUPERAMBER_DB_CANARY_PERCENT) || 0));
  return {
    mode,
    canaryPercent,
    canarySalt: String(env.SUPERAMBER_DB_CANARY_SALT || 'superamber-db-v1'),
    failureThreshold: Math.max(1, Number(env.SUPERAMBER_DB_FAILURE_THRESHOLD) || 3),
    resetAfterMs: Math.max(1_000, Number(env.SUPERAMBER_DB_RESET_AFTER_MS) || 60_000),
  };
}

function assertAuthorizedSquads(requestedSquadIds, authorizedSquadIds) {
  const requested = normalizePositiveIds(requestedSquadIds);
  const authorized = new Set(normalizePositiveIds(authorizedSquadIds));
  if (requested.length === 0) {
    const error = new Error('数据库读取至少需要一个已授权班级');
    error.code = 'DB_SOURCE_EMPTY_SCOPE';
    throw error;
  }
  const denied = requested.filter((squadId) => !authorized.has(squadId));
  if (denied.length > 0) {
    const error = new Error('请求包含当前登录老师未获授权的班级');
    error.code = 'DB_SOURCE_SCOPE_DENIED';
    error.deniedSquadIds = denied;
    throw error;
  }
  return requested;
}

function canaryBucket(identity, salt = 'superamber-db-v1') {
  const normalized = String(identity || '').trim().toLowerCase();
  if (!normalized) return 100;
  const digest = crypto.createHash('sha256').update(`${salt}:${normalized}`).digest();
  return digest.readUInt32BE(0) % 100;
}

function selectSource(config, teacherIdentity) {
  if (config.mode === 'primary') return 'database';
  if (config.mode !== 'canary') return 'legacy';
  return canaryBucket(teacherIdentity, config.canarySalt) < config.canaryPercent
    ? 'database'
    : 'legacy';
}

function percentile(values, percentage) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * percentage) - 1)];
}

function createSourceMetrics({ sampleLimit = 512 } = {}) {
  const counters = {
    requests: 0,
    legacyServed: 0,
    databaseServed: 0,
    fallbacks: 0,
    shadowRuns: 0,
    shadowFailures: 0,
    comparisons: 0,
    comparisonFailures: 0,
    scopeDenied: 0,
    policyFallbacks: 0,
  };
  const latency = { legacy: [], database: [] };

  function recordLatency(source, durationMs) {
    const bucket = latency[source];
    if (!bucket || !Number.isFinite(durationMs)) return;
    bucket.push(Math.max(0, Math.round(durationMs * 10) / 10));
    if (bucket.length > sampleLimit) bucket.splice(0, bucket.length - sampleLimit);
  }

  return {
    increment(name, count = 1) {
      if (Object.prototype.hasOwnProperty.call(counters, name)) counters[name] += count;
    },
    recordLatency,
    snapshot(extra = {}) {
      const summarize = (values) => ({
        samples: values.length,
        p50Ms: percentile(values, 0.5),
        p90Ms: percentile(values, 0.9),
        p99Ms: percentile(values, 0.99),
      });
      return {
        ...counters,
        latency: {
          legacy: summarize(latency.legacy),
          database: summarize(latency.database),
        },
        ...extra,
      };
    },
  };
}

function createCircuitBreaker({ failureThreshold = 3, resetAfterMs = 60_000, now = Date.now } = {}) {
  let consecutiveFailures = 0;
  let openedAt = null;

  return {
    canAttempt() {
      if (openedAt == null) return true;
      if (now() - openedAt < resetAfterMs) return false;
      return true;
    },
    success() {
      consecutiveFailures = 0;
      openedAt = null;
    },
    failure() {
      consecutiveFailures += 1;
      if (consecutiveFailures >= failureThreshold) openedAt = now();
    },
    snapshot() {
      return {
        state: openedAt == null ? 'closed' : (now() - openedAt >= resetAfterMs ? 'half-open' : 'open'),
        consecutiveFailures,
        openedAt,
        resetAfterMs,
      };
    },
  };
}

function createSourceSwitch({
  config = loadSourceSwitchConfig(),
  metrics = createSourceMetrics(),
  logger = console,
  now = Date.now,
} = {}) {
  const breaker = createCircuitBreaker({
    failureThreshold: config.failureThreshold,
    resetAfterMs: config.resetAfterMs,
    now,
  });
  const background = new Set();

  async function timed(source, loader) {
    const startedAt = now();
    try {
      return await loader();
    } finally {
      metrics.recordLatency(source, now() - startedAt);
    }
  }

  function track(promise) {
    background.add(promise);
    promise.finally(() => background.delete(promise));
  }

  async function runDatabase(database) {
    const value = await timed('database', database);
    breaker.success();
    return value;
  }

  async function runShadow({ legacyValue, database, compare }) {
    metrics.increment('shadowRuns');
    try {
      const databaseValue = await runDatabase(database);
      if (typeof compare === 'function') {
        metrics.increment('comparisons');
        const result = await compare(databaseValue, legacyValue);
        const comparisonFailed = result?.calculationsPassed === false
          || (result?.calculationsPassed == null && result?.passed === false);
        if (comparisonFailed) {
          metrics.increment('comparisonFailures');
        }
      }
    } catch (error) {
      if (isPolicyFallback(error)) {
        metrics.increment('policyFallbacks');
      } else {
        breaker.failure();
        metrics.increment('shadowFailures');
        logger.warn?.(`数据库影子读取失败，用户仍使用原链路: ${error.message}`);
      }
    }
  }

  return {
    async execute({
      teacherIdentity,
      requestedSquadIds,
      authorizedSquadIds,
      legacy,
      database,
      compare,
      awaitShadow = false,
    }) {
      if (!String(teacherIdentity || '').trim()) {
        const error = new Error('必须先完成教师登录授权');
        error.code = 'DB_SOURCE_LOGIN_REQUIRED';
        throw error;
      }
      try {
        assertAuthorizedSquads(requestedSquadIds, authorizedSquadIds);
      } catch (error) {
        metrics.increment('scopeDenied');
        throw error;
      }
      if (typeof legacy !== 'function') throw new Error('缺少原链路读取函数');
      if (typeof database !== 'function' && config.mode !== 'off') throw new Error('缺少数据库读取函数');

      metrics.increment('requests');
      const desiredSource = selectSource(config, teacherIdentity);
      if (config.mode === 'off' || desiredSource === 'legacy') {
        const legacyValue = await timed('legacy', legacy);
        metrics.increment('legacyServed');
        if (config.mode === 'shadow' && breaker.canAttempt()) {
          const shadow = runShadow({ legacyValue, database, compare });
          if (awaitShadow) await shadow;
          else track(shadow);
        }
        return { source: 'legacy', value: legacyValue, fallback: false };
      }

      if (!breaker.canAttempt()) {
        metrics.increment('fallbacks');
        metrics.increment('legacyServed');
        return { source: 'legacy', value: await timed('legacy', legacy), fallback: true };
      }

      try {
        const value = await runDatabase(database);
        metrics.increment('databaseServed');
        return { source: 'database', value, fallback: false };
      } catch (error) {
        if (isPolicyFallback(error)) metrics.increment('policyFallbacks');
        else breaker.failure();
        metrics.increment('fallbacks');
        metrics.increment('legacyServed');
        if (!isPolicyFallback(error)) {
          logger.warn?.(`数据库主读取失败，已回退原链路: ${error.message}`);
        }
        return { source: 'legacy', value: await timed('legacy', legacy), fallback: true };
      }
    },
    health() {
      return metrics.snapshot({ mode: config.mode, canaryPercent: config.canaryPercent, breaker: breaker.snapshot() });
    },
    async drain() {
      await Promise.allSettled([...background]);
    },
  };
}

module.exports = {
  SOURCE_MODES,
  POLICY_FALLBACK_CODES,
  assertAuthorizedSquads,
  canaryBucket,
  createCircuitBreaker,
  createSourceMetrics,
  createSourceSwitch,
  isPolicyFallback,
  loadSourceSwitchConfig,
  normalizePositiveIds,
  percentile,
  selectSource,
};
