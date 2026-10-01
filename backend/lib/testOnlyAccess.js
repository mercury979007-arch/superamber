const TEST_ONLY_ALLOWED_HOST_PATTERNS = [
  'staging.example.invalid',
  'localhost',
  '127.0.0.1',
];

function normalizeHost(value) {
  const raw = String(value || '').trim().toLowerCase().split(',')[0].trim();
  if (!raw) return '';
  try {
    return new URL(raw.includes('://') ? raw : `http://${raw}`).hostname.toLowerCase();
  } catch {
    return raw.split(':')[0];
  }
}

function isTestOnlyRequestAllowed(req) {
  const forwardedHost = normalizeHost(req?.headers?.['x-forwarded-host']);
  const directHost = normalizeHost(req?.headers?.host);
  const effectiveHost = forwardedHost || directHost;
  if (effectiveHost) {
    return TEST_ONLY_ALLOWED_HOST_PATTERNS.includes(effectiveHost);
  }

  const originHost = normalizeHost(req?.headers?.origin);
  const refererHost = normalizeHost(req?.headers?.referer);
  return [originHost, refererHost].some((host) => TEST_ONLY_ALLOWED_HOST_PATTERNS.includes(host));
}

function rejectIfTestOnlyRouteBlocked(req, res, message = '该功能仅在测试站开放') {
  if (isTestOnlyRequestAllowed(req)) {
    return false;
  }
  res.status(403).json({ error: message });
  return true;
}

// Shared by the main server and HTTP acceptance tests. Environment gating
// also rejects forged staging/local host headers sent to a production process.
const TEST_ONLY_ROUTES = [
  '/api/classroom-agent', '/classroom-agent', '/api/camp-report',
  '/api/score-book', '/api/scraper/batch-student-list',
  '/api/admin/usage-summary', '/api/debug',
];

function createTestOnlyMiddleware(environment, { allowProductionClassroomAgentApi = false } = {}) {
  const isTest = ['test', 'staging', 'development'].includes(environment);
  return (req, res, next) => {
    const pathname = req.originalUrl || req.url || '';
    const message = pathname.startsWith('/api/debug') ? '该调试接口仅在测试站开放'
      : pathname.startsWith('/api/admin/usage-summary') ? '该页面仅在测试站开放'
        : '该功能仅在测试站开放';
    if (!isTest) {
      // This opt-in exposes only the existing agent API. The embedded test UI
      // and every other private route remain blocked in production, while the
      // API itself still requires a site session or a high-entropy grant token.
      if (allowProductionClassroomAgentApi && pathname.startsWith('/api/classroom-agent')) return next();
      return res.status(403).json({ error: message });
    }
    if (!rejectIfTestOnlyRouteBlocked(req, res, message)) next();
  };
}

module.exports = {
  TEST_ONLY_ROUTES,
  createTestOnlyMiddleware,
  TEST_ONLY_ALLOWED_HOST_PATTERNS,
  isTestOnlyRequestAllowed,
  normalizeHost,
  rejectIfTestOnlyRouteBlocked,
};
