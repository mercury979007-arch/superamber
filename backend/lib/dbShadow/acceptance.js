const DEFAULT_THRESHOLDS = Object.freeze({
  minimumComparedFields: 2_000,
  minimumSampledClasses: 5,
  requiredResourceTypes: ['word', 'voice', 'test', 'attendance'],
  hotP90Ms: 300,
  hotP99Ms: 800,
  coldP90Ms: 6_000,
  steadyRssMb: 256,
  peakRssMb: 512,
  maxConnectionsPerHost: 2,
  maximumErrorRate: 0.005,
  minimumSoakHours: 72,
  peakAccounts: 170,
  maximumRefreshConcurrency: 2,
  maximumPrefetchConcurrency: 1,
});

function present(value) {
  return value !== null && value !== undefined;
}

function makeGate({ id, group, label, observed, target, passed, critical = true }) {
  return {
    id,
    group,
    label,
    status: present(observed) ? (passed ? 'pass' : 'fail') : 'pending',
    observed: present(observed) ? observed : null,
    target,
    critical,
  };
}

function evaluateAcceptance(evidence = {}, thresholds = {}) {
  const limits = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const data = evidence.data || {};
  const coverage = evidence.coverage || {};
  const performance = evidence.performance || {};
  const reliability = evidence.reliability || {};
  const security = evidence.security || {};
  const operations = evidence.operations || {};
  const resourceTypes = Array.isArray(coverage.resourceTypes) ? coverage.resourceTypes : [];
  const errorRate = present(reliability.shadowRuns) && Number(reliability.shadowRuns) > 0
    ? Number(reliability.shadowFailures || 0) / Number(reliability.shadowRuns)
    : null;

  const gates = [
    makeGate({
      id: 'calculation-fields', group: 'data', label: '计算字段一致',
      observed: present(data.comparedFields) ? `${data.comparedFields} fields / ${data.valueDifferenceCount ?? '?'} diff` : null,
      target: `>= ${limits.minimumComparedFields} fields and 0 value differences`,
      passed: Number(data.comparedFields) >= limits.minimumComparedFields && Number(data.valueDifferenceCount) === 0,
    }),
    makeGate({
      id: 'completion-status', group: 'data', label: '完成状态完全一致',
      observed: data.completionDifferenceCount,
      target: '0 differences', passed: Number(data.completionDifferenceCount) === 0,
    }),
    makeGate({
      id: 'identity-drift', group: 'data', label: '名单变化独立归类',
      observed: data.identityDriftClassified,
      target: true, passed: data.identityDriftClassified === true,
    }),
    makeGate({
      id: 'sample-classes', group: 'coverage', label: '跨班级样本量',
      observed: coverage.sampledClasses,
      target: `>= ${limits.minimumSampledClasses}`, passed: Number(coverage.sampledClasses) >= limits.minimumSampledClasses,
    }),
    makeGate({
      id: 'resource-coverage', group: 'coverage', label: '本轮资源类型覆盖',
      observed: resourceTypes.length ? resourceTypes.join(', ') : null,
      target: limits.requiredResourceTypes.join(', '),
      passed: limits.requiredResourceTypes.every((item) => resourceTypes.includes(item)),
    }),
    makeGate({
      id: 'edge-cases', group: 'coverage', label: '空结果、部分完成、名单变化',
      observed: present(coverage.emptyResult) && present(coverage.partialCompletion) && present(coverage.rosterChange)
        ? `${coverage.emptyResult}/${coverage.partialCompletion}/${coverage.rosterChange}` : null,
      target: 'true/true/true',
      passed: coverage.emptyResult === true && coverage.partialCompletion === true && coverage.rosterChange === true,
    }),
    makeGate({
      id: 'hot-latency', group: 'performance', label: '热读尾延迟',
      observed: present(performance.hotP90Ms) && present(performance.hotP99Ms)
        ? `P90 ${performance.hotP90Ms}ms / P99 ${performance.hotP99Ms}ms` : null,
      target: `P90 <= ${limits.hotP90Ms}ms / P99 <= ${limits.hotP99Ms}ms`,
      passed: Number(performance.hotP90Ms) <= limits.hotP90Ms && Number(performance.hotP99Ms) <= limits.hotP99Ms,
    }),
    makeGate({
      id: 'cold-latency', group: 'performance', label: '后台冷刷新延迟',
      observed: performance.coldP90Ms,
      target: `P90 <= ${limits.coldP90Ms}ms`, passed: Number(performance.coldP90Ms) <= limits.coldP90Ms,
    }),
    makeGate({
      id: 'memory', group: 'performance', label: 'Node 内存边界',
      observed: present(performance.steadyRssMb) && present(performance.peakRssMb)
        ? `steady ${performance.steadyRssMb}MB / peak ${performance.peakRssMb}MB` : null,
      target: `steady < ${limits.steadyRssMb}MB / peak < ${limits.peakRssMb}MB`,
      passed: Number(performance.steadyRssMb) < limits.steadyRssMb && Number(performance.peakRssMb) < limits.peakRssMb,
    }),
    makeGate({
      id: 'connections', group: 'performance', label: '每台数据库连接上限',
      observed: performance.maxConnectionsPerHost,
      target: `<= ${limits.maxConnectionsPerHost}`, passed: Number(performance.maxConnectionsPerHost) <= limits.maxConnectionsPerHost,
    }),
    makeGate({
      id: 'peak-model', group: 'reliability', label: '峰值账号模型',
      observed: reliability.peakAccountsTested,
      target: `>= ${limits.peakAccounts}`, passed: Number(reliability.peakAccountsTested) >= limits.peakAccounts,
    }),
    makeGate({
      id: 'refresh-concurrency', group: 'reliability', label: '刷新并发硬上限',
      observed: reliability.refreshConcurrencyPeak,
      target: `<= ${limits.maximumRefreshConcurrency}`,
      passed: Number(reliability.refreshConcurrencyPeak) <= limits.maximumRefreshConcurrency,
    }),
    makeGate({
      id: 'prefetch-concurrency', group: 'reliability', label: '旧抓取过渡队列并发',
      observed: reliability.prefetchConcurrencyPeak,
      target: `<= ${limits.maximumPrefetchConcurrency}`,
      passed: Number(reliability.prefetchConcurrencyPeak) <= limits.maximumPrefetchConcurrency,
    }),
    makeGate({
      id: 'fallback', group: 'reliability', label: '数据库故障自动回退',
      observed: reliability.fallbackVerified,
      target: true, passed: reliability.fallbackVerified === true,
    }),
    makeGate({
      id: 'error-rate', group: 'reliability', label: '影子运行错误率',
      observed: errorRate,
      target: `<= ${limits.maximumErrorRate}`,
      passed: present(errorRate) && errorRate <= limits.maximumErrorRate,
    }),
    makeGate({
      id: 'soak', group: 'reliability', label: '测试站连续观察',
      observed: reliability.soakHours,
      target: `>= ${limits.minimumSoakHours} hours`, passed: Number(reliability.soakHours) >= limits.minimumSoakHours,
    }),
    makeGate({
      id: 'authorization', group: 'security', label: '登录授权班级边界',
      observed: security.authorizationBoundaryVerified,
      target: true, passed: security.authorizationBoundaryVerified === true,
    }),
    makeGate({
      id: 'read-only', group: 'security', label: '数据库只读与无写 SQL',
      observed: present(security.readOnlyAccount) && present(security.noWriteSql)
        ? `${security.readOnlyAccount}/${security.noWriteSql}` : null,
      target: 'true/true', passed: security.readOnlyAccount === true && security.noWriteSql === true,
    }),
    makeGate({
      id: 'tls', group: 'security', label: '数据库传输加密',
      observed: security.tlsEnabled,
      target: true, passed: security.tlsEnabled === true, critical: false,
    }),
    makeGate({
      id: 'rollback', group: 'operations', label: '一键回退演练',
      observed: operations.rollbackDrillPassed,
      target: true, passed: operations.rollbackDrillPassed === true,
    }),
    makeGate({
      id: 'observability', group: 'operations', label: '来源、延迟、差异与回退可观察',
      observed: operations.observabilityVerified,
      target: true, passed: operations.observabilityVerified === true,
    }),
  ];

  const critical = gates.filter((gate) => gate.critical);
  const counts = {
    pass: gates.filter((gate) => gate.status === 'pass').length,
    fail: gates.filter((gate) => gate.status === 'fail').length,
    pending: gates.filter((gate) => gate.status === 'pending').length,
  };
  const technicalReady = critical.every((gate) => gate.status === 'pass');
  const userApproved = evidence.userApproval === true;
  return {
    schemaVersion: 1,
    evaluatedAt: new Date().toISOString(),
    technicalReady,
    userApproved,
    promotionAllowed: technicalReady && userApproved,
    counts,
    gates,
  };
}

module.exports = { DEFAULT_THRESHOLDS, evaluateAcceptance, makeGate };
