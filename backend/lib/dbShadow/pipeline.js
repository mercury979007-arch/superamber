const mysql = require('mysql2/promise');
const { performance } = require('node:perf_hooks');
const { createAsyncTtlCache } = require('./cache');
const { createAsyncLimiter } = require('./limiter');
const {
  buildStudentAssignmentQuery,
  buildTaskResourceQuery,
  SUPPORTED_RESOURCE_TABLES,
} = require('./query');
const {
  readAttendanceResults,
  readTestResults,
  readVoiceResults,
  readWordResults,
} = require('./resultReaders');
const { readCurrentRosters, readDailyAttendance } = require('./supplementalReaders');

function assignmentKey(row) {
  return `${row.resourceTable}_${row.taskId}_${row.resourceId}_${row.studentId}`;
}

function taskResourceStudentKey(row) {
  return `${row.taskId}_${row.resourceId}_${row.studentId}`;
}

function resourceStudentKey(row) {
  return `${row.resourceId}_${row.studentId}`;
}

function mapBy(rows, keyFn) {
  return new Map(rows.map((row) => [keyFn(row), row]));
}

function expandAssignments(studentAssignments, resources) {
  const resourcesByTask = new Map();
  for (const resource of resources) {
    const bucket = resourcesByTask.get(Number(resource.taskId)) || [];
    bucket.push(resource);
    resourcesByTask.set(Number(resource.taskId), bucket);
  }
  const rows = studentAssignments.flatMap((assignment) => (
    (resourcesByTask.get(Number(assignment.taskId)) || []).map((resource) => ({
      ...assignment,
      ...resource,
    }))
  ));
  rows.sort((left, right) => (
    String(left.taskStartAt || '').localeCompare(String(right.taskStartAt || ''))
    || Number(left.taskId) - Number(right.taskId)
    || Number(left.resourceId) - Number(right.resourceId)
    || Number(left.studentId) - Number(right.studentId)
  ));
  return rows;
}

function mergeAssignments(assignments, results) {
  const wordCompletion = mapBy(results.word.completion, taskResourceStudentKey);
  const wordRepetition = mapBy(results.word.repetition, taskResourceStudentKey);
  const wordPk = mapBy(results.word.pk, resourceStudentKey);
  const voiceBase = mapBy(results.voice.base, taskResourceStudentKey);
  const voiceHistory = mapBy(results.voice.history, taskResourceStudentKey);
  const voiceFirst = mapBy(results.voice.first, taskResourceStudentKey);
  const voiceDimensions = mapBy(results.voice.dimensions, taskResourceStudentKey);
  const test = mapBy(results.test, taskResourceStudentKey);

  return assignments.map((assignment) => {
    const stableKey = assignmentKey(assignment);
    const taskKey = taskResourceStudentKey(assignment);
    const resourceKey = resourceStudentKey(assignment);
    const common = {
      key: stableKey,
      ...assignment,
      supported: SUPPORTED_RESOURCE_TABLES.has(assignment.resourceTable),
      result: null,
    };

    if (assignment.resourceTable === 'online_word_pack') {
      const completion = wordCompletion.get(taskKey);
      const repetition = wordRepetition.get(taskKey);
      const pk = wordPk.get(resourceKey);
      common.result = {
        hasSourceRecord: Boolean(completion || repetition || pk),
        completed: Boolean(completion?.completed),
        challengeStatus: completion?.challengeStatus ?? null,
        wordKing: Boolean(pk?.wordKing),
        pkAttempts: Number(pk?.pkAttempts || 0),
        pkAccuracy: pk?.pkAccuracy ?? null,
        repetitionAttempts: Number(repetition?.repetitionAttempts || 0),
        repetitionItems: Number(repetition?.repetitionItems || 0),
        repetitionAccuracy: repetition?.repetitionAccuracy ?? null,
        repetitionFirstAccuracy: repetition?.repetitionFirstAccuracy ?? null,
        startedAt: completion?.startedAt ?? null,
        completedAt: completion?.completedAt ?? null,
      };
    } else if (assignment.resourceTable === 'online_voice') {
      const base = voiceBase.get(taskKey);
      const history = voiceHistory.get(taskKey);
      const first = voiceFirst.get(taskKey);
      const dimensions = voiceDimensions.get(taskKey);
      common.result = {
        hasSourceRecord: Boolean(base || history || first || dimensions),
        completed: Boolean(base?.completed),
        status: base?.status ?? null,
        doneCount: Number(base?.doneCount || 0),
        voiceCount: Number(history?.voiceCount || 0),
        historyRows: Number(history?.historyRows || 0),
        averageScore: history?.averageScore ?? null,
        firstScore: first?.firstScore ?? null,
        highestScore: history?.highestScore ?? null,
        dimensionSamples: Number(dimensions?.dimensionSamples || 0),
        averageAccuracy: dimensions?.averageAccuracy ?? null,
        averageFluency: dimensions?.averageFluency ?? null,
        averageStandard: dimensions?.averageStandard ?? null,
        averageIntegrity: dimensions?.averageIntegrity ?? null,
        averageDimensionTotal: dimensions?.averageDimensionTotal ?? null,
        startedAt: base?.startedAt ?? null,
        completedAt: base?.completedAt ?? null,
      };
    } else if (assignment.resourceTable === 'online_test') {
      const row = test.get(taskKey);
      common.result = {
        hasSourceRecord: Boolean(row),
        completed: Boolean(row?.completed),
        status: row?.status ?? null,
        realScore: row?.realScore ?? null,
        allScore: row?.allScore ?? null,
        rightQuestions: row?.rightQuestions ?? null,
        allQuestions: row?.allQuestions ?? null,
        afterTest: row?.afterTest ?? null,
        startedAt: row?.startedAt ?? null,
        completedAt: row?.completedAt ?? null,
      };
    }

    return common;
  });
}

function summarize(rows, attendance) {
  const supported = rows.filter((row) => row.supported);
  const byResourceTable = {};
  for (const row of rows) {
    const bucket = byResourceTable[row.resourceTable] || {
      assignments: 0,
      supported: row.supported,
      completed: 0,
      withResult: 0,
    };
    bucket.assignments += 1;
    if (row.result?.hasSourceRecord) bucket.withResult += 1;
    if (row.result?.completed) bucket.completed += 1;
    byResourceTable[row.resourceTable] = bucket;
  }
  return {
    assignmentRows: rows.length,
    supportedAssignmentRows: supported.length,
    unsupportedAssignmentRows: rows.length - supported.length,
    attendanceRows: attendance.length,
    byResourceTable,
  };
}

function createShadowRuntime(config, options = {}) {
  const taskPool = mysql.createPool(config.task);
  const resultPool = mysql.createPool(config.result);
  const snapshotCache = createAsyncTtlCache({
    ttlMs: Number(options.cacheTtlMs) || 30_000,
    staleTtlMs: Number(options.cacheStaleTtlMs) || 5 * 60_000,
    maxEntries: Number(options.cacheMaxEntries) || 32,
    maxWeightBytes: Number(options.cacheMaxBytes) || 32 * 1024 * 1024,
  });
  const refreshLimiter = createAsyncLimiter({
    concurrency: Number(options.maxConcurrentLoads) || 2,
    maxQueue: Number(options.maxQueuedLoads) || 32,
  });
  let closed = false;

  async function deliver(key, loader, { bypassCache = false } = {}) {
    if (closed) throw new Error('影子数据库运行时已经关闭');
    const deliveryStartedAt = performance.now();
    const loaded = await snapshotCache.getOrLoad(
      key,
      () => refreshLimiter.run(loader),
      { bypass: bypassCache },
    );
    return {
      ...loaded.value,
      delivery: {
        cacheHit: loaded.cacheHit,
        stale: loaded.stale,
        refreshing: loaded.refreshing,
        sharedInFlight: loaded.sharedInFlight,
        cacheAgeMs: loaded.ageMs,
        deliveryMs: Math.round((performance.now() - deliveryStartedAt) * 10) / 10,
      },
    };
  }

  async function runUncached(filters) {
    if (closed) throw new Error('影子数据库运行时已经关闭');
    const timings = {};
    const start = performance.now();
    const studentQuery = buildStudentAssignmentQuery(filters);
    const resourceQuery = buildTaskResourceQuery(filters);
    const [[studentAssignments], [resources]] = await Promise.all([
      taskPool.query(studentQuery.sql, studentQuery.params),
      taskPool.query(resourceQuery.sql, resourceQuery.params),
    ]);
    const assignments = expandAssignments(studentAssignments, resources);
    timings.assignmentsMs = Math.round((performance.now() - start) * 10) / 10;

    const resultStart = performance.now();
    const [word, voice, test, attendance] = await Promise.all([
      readWordResults(resultPool, assignments),
      readVoiceResults(resultPool, assignments),
      readTestResults(resultPool, assignments),
      readAttendanceResults(resultPool, assignments, filters),
    ]);
    timings.resultsMs = Math.round((performance.now() - resultStart) * 10) / 10;

    const mergeStart = performance.now();
    const rows = mergeAssignments(assignments, { word, voice, test });
    timings.mergeMs = Math.round((performance.now() - mergeStart) * 10) / 10;
    timings.totalMs = Math.round((performance.now() - start) * 10) / 10;

    return {
      schemaVersion: 1,
      mode: 'shadow-read-only',
      generatedAt: new Date().toISOString(),
      filters,
      timings,
      summary: summarize(rows, attendance),
      sourceCounts: {
        studentAssignments: studentAssignments.length,
        resources: resources.length,
      },
      rows,
      attendance,
      calculationContract: {
        wordCompletion: 'challenge_status = 3',
        wordKing: 'MAX(current_rank) = 3 per student + pack',
        pkAttempts: 'COUNT(pk rows) per student + pack',
        pkAccuracy: 'AVG(score_rate) where complete_status = 1',
        repetitionAccuracy: 'AVG(is_right = 1) * 100',
        repetitionFirstAccuracy: 'earliest add_at,id per attr_id; AVG(is_right = 1) * 100',
        voiceAverageScore: 'AVG(COALESCE(history.total_score, 0)) * 100 across existing history rows',
        voiceFirstScore: 'earliest non-null history.total_score * 100',
        voiceHighestScore: 'MAX(history.total_score) * 100',
        voiceDimensions: 'AVG(record dimension) excluding is_exercise = 1',
        testCompletion: 'status = 3',
        testScore: 'online_test_result.real_score/all_score',
        attendance: 'current authorized roster, then one normalized row per student + date; status = 1 means submitted',
      },
    };
  }

  return {
    async run(filters, { bypassCache = false } = {}) {
      if (closed) throw new Error('影子数据库运行时已经关闭');
      const normalizedFilters = {
        taskIds: [...(filters.taskIds || [])].map(Number).sort((a, b) => a - b),
        squadIds: [...(filters.squadIds || [])].map(Number).sort((a, b) => a - b),
        ...(filters.from ? { from: String(filters.from) } : {}),
        ...(filters.toExclusive ? { toExclusive: String(filters.toExclusive) } : {}),
      };
      return deliver(`task:${JSON.stringify(normalizedFilters)}`, () => runUncached(normalizedFilters), {
        bypassCache,
      });
    },
    async readRoster({ squadIds = [] } = {}, { bypassCache = false } = {}) {
      const normalized = [...new Set(squadIds.map(Number).filter((value) => Number.isInteger(value) && value > 0))]
        .sort((left, right) => left - right);
      if (normalized.length === 0) throw new Error('学生名单读取至少需要一个班级');
      return deliver(`roster:${normalized.join(',')}`, async () => ({
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        squadIds: normalized,
        rows: await readCurrentRosters(taskPool, normalized),
      }), { bypassCache });
    },
    async readAttendance({ studentIds = [], from = '', toExclusive = '' } = {}, { bypassCache = false } = {}) {
      const normalized = [...new Set(studentIds.map(Number).filter((value) => Number.isInteger(value) && value > 0))]
        .sort((left, right) => left - right);
      if (normalized.length === 0) throw new Error('每日打卡读取至少需要一个已授权学生');
      const filters = { studentIds: normalized, from: String(from), toExclusive: String(toExclusive) };
      return deliver(`attendance:${JSON.stringify(filters)}`, async () => ({
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        ...filters,
        rows: await readDailyAttendance(resultPool, filters),
      }), { bypassCache });
    },
    async close() {
      if (closed) return;
      closed = true;
      await refreshLimiter.close();
      snapshotCache.clear();
      await Promise.allSettled([taskPool.end(), resultPool.end()]);
    },
    getPools() { return { task: taskPool, result: resultPool }; },
    cacheStats() {
      return snapshotCache.stats();
    },
    loadStats() {
      return refreshLimiter.stats();
    },
  };
}

async function runShadowPipeline({ config, filters }) {
  const runtime = createShadowRuntime(config);
  try {
    return await runtime.run(filters);
  } finally {
    await runtime.close();
  }
}

module.exports = {
  assignmentKey,
  createShadowRuntime,
  expandAssignments,
  mergeAssignments,
  runShadowPipeline,
  summarize,
  taskResourceStudentKey,
};
