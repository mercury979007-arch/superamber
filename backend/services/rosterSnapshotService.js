const { taskSelectionFingerprint } = require('../lib/taskCatalog');
const { filterVideoTaskSnapshot } = require('../lib/videoTaskPolicy');
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const STORE_VERSION = 1;
const SHANGHAI_UTC_OFFSET_MS = 8 * 60 * 60 * 1000;

function normalizeUsername(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return '';
  return `u_${crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 24)}`;
}

function normalizeStoredSnapshotKey(key, snapshot) {
  const currentKey = String(key || '').trim();
  if (/^u_[a-f0-9]{24}$/.test(currentKey)) return currentKey;
  return normalizeUsername(snapshot?.username || currentKey);
}

function normalizeClassCode(value) {
  return String(value || '').trim().toUpperCase();
}

function normalizeStudent(item) {
  return {
    no: String(item?.no || '').trim(),
    chName: String(item?.ch_name ?? item?.chName ?? '').trim(),
    enName: String(item?.en_name ?? item?.enName ?? '').trim(),
  };
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function normalizeSelectedWeekIds(value) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map((item) => String(item || '').trim())
    .filter(Boolean))].sort();
}

function publicitySelectionKey(selectedWeekIds) {
  return normalizeSelectedWeekIds(selectedWeekIds).join('|');
}


function buildPublicityCandidateSelections(taskSnapshot) {
  const weekTasks = Array.isArray(taskSnapshot?.weekTasks) ? taskSnapshot.weekTasks : [];
  const selectableIds = new Set(weekTasks
    .filter((task) => {
      const weekId = String(task?.id || '');
      return (
        Array.isArray(taskSnapshot?.weekSelectionMap?.[weekId]?.taskIds)
          && taskSnapshot.weekSelectionMap[weekId].taskIds.length > 0
      ) || (
        Array.isArray(taskSnapshot?.weekMap?.[weekId])
          && taskSnapshot.weekMap[weekId].length > 0
      );
    })
    .map((task) => String(task.id)));
  const hydratedIds = normalizeSelectedWeekIds(taskSnapshot?.hydratedWeekIds);
  const recentIds = [...weekTasks]
    .filter((task) => selectableIds.has(String(task?.id || '')))
    .sort((left, right) => String(right?.startAt || right?.addedAt || '')
      .localeCompare(String(left?.startAt || left?.addedAt || '')))
    .slice(0, 8)
    .map((task) => String(task.id));
  const candidateIds = [...new Set([...recentIds, ...hydratedIds])]
    .filter((weekId) => selectableIds.has(weekId));
  const candidates = [];
  const seen = new Set();
  const add = (weekIds) => {
    const normalized = normalizeSelectedWeekIds(weekIds).filter((weekId) => selectableIds.has(weekId));
    const key = publicitySelectionKey(normalized);
    if (!key || seen.has(key)) return;
    seen.add(key);
    candidates.push(normalized);
  };

  add(taskSnapshot?.defaultSelectedWeekIds);
  const tasksById = new Map(weekTasks.map((task) => [String(task?.id || ''), task]));
  const bySessionDate = new Map();
  for (const weekId of candidateIds) {
    const task = tasksById.get(weekId) || {};
    const sessionDate = String(task.startAt || task.addedAt || '').slice(0, 10) || `id:${weekId}`;
    if (!bySessionDate.has(sessionDate)) bySessionDate.set(sessionDate, []);
    bySessionDate.get(sessionDate).push(weekId);
  }
  for (const weekIds of bySessionDate.values()) add(weekIds);
  return candidates.slice(0, 4);
}

function getSnapshotStatus(snapshot, nowMs, staleAfterMs) {
  if (!snapshot) {
    return { state: 'empty', stale: true, ageMs: null };
  }
  const referenceTime = Date.parse(snapshot.lastCompleteAt || snapshot.updatedAt || '');
  const ageMs = Number.isFinite(referenceTime) ? Math.max(0, nowMs - referenceTime) : null;
  const stale = ageMs == null || ageMs > staleAfterMs;
  return {
    state: snapshot.failures?.length || snapshot.taskFailures?.length || snapshot.speakingFailures?.length
      || snapshot.dailyReportPublicityFailures?.length
      ? 'partial'
      : stale ? 'stale' : 'fresh',
    stale,
    ageMs,
  };
}

function millisecondsUntilNextShanghaiRun(nowMs, hour = 6, minute = 30) {
  const shifted = new Date(nowMs + SHANGHAI_UTC_OFFSET_MS);
  let targetMs = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate(),
    hour - 8,
    minute,
    0,
    0,
  );
  if (targetMs <= nowMs) {
    targetMs += 24 * 60 * 60 * 1000;
  }
  return targetMs - nowMs;
}

function createRosterSnapshotService({
  storePath,
  now = () => Date.now(),
  staleAfterMs = 6 * 60 * 60 * 1000,
  concurrency = 4,
  logger = console,
  fetchDailyReportTasks = null,
  fetchDailyReportPublicity = null,
  fetchSpeakingChallenge = null,
  speakingStaleAfterMs = 30 * 60 * 1000,
  persistRosters = true,
  fetchRosters = true,
}) {
  if (!storePath) {
    throw new Error('roster snapshot storePath is required');
  }

  let loaded = false;
  let loadPromise = null;
  let state = { version: STORE_VERSION, snapshots: {} };
  const refreshJobs = new Map();
  const taskRefreshJobs = new Map();
  const speakingSnapshots = new Map();
  const speakingRefreshJobs = new Map();
  // The academic-system speaking export is a two-step "generate file, then
  // download URL" flow. Concurrent exports in the same teacher session can
  // overwrite that shared generated file and return another class's rows.
  // Keep exports serialized per teacher while still allowing different
  // teachers to refresh independently.
  const speakingTeacherQueues = new Map();
  let writeChain = Promise.resolve();
  let writeSequence = 0;

  function stripRosterData(snapshot) {
    if (!snapshot || persistRosters) return snapshot;
    return {
      ...snapshot,
      username: '',
      rosters: [],
      failures: [],
      totalStudents: 0,
    };
  }

  async function ensureLoaded() {
    if (loaded) return;
    if (!loadPromise) {
      loadPromise = (async () => {
        try {
          const parsed = JSON.parse(await fs.readFile(storePath, 'utf8'));
          if (parsed?.version === STORE_VERSION && parsed.snapshots && typeof parsed.snapshots === 'object') {
            state = {
              ...parsed,
              snapshots: Object.fromEntries(
                Object.entries(parsed.snapshots).map(([key, snapshot]) => [
                  normalizeStoredSnapshotKey(key, snapshot),
                  stripRosterData(snapshot),
                ]),
              ),
            };
            if (!persistRosters) {
              await persist();
            }
          }
        } catch (error) {
          if (error?.code !== 'ENOENT') {
            logger.warn?.(`⚠️ 名单快照读取失败，将使用空快照: ${error.message}`);
          }
        } finally {
          loaded = true;
          loadPromise = null;
        }
      })();
    }
    await loadPromise;
  }

  async function persist() {
    writeChain = writeChain.catch(() => {}).then(async () => {
      const dir = path.dirname(storePath);
      const tempPath = `${storePath}.${process.pid}.${writeSequence += 1}.tmp`;
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(tempPath, JSON.stringify(state, null, 2), { mode: 0o600 });
      await fs.rename(tempPath, storePath);
      await fs.chmod(storePath, 0o600).catch(() => {});
    });
    return writeChain;
  }

  async function get(username) {
    await ensureLoaded();
    const snapshot = state.snapshots[normalizeUsername(username)] || null;
    return {
      snapshot: clone(snapshot),
      ...getSnapshotStatus(snapshot, now(), staleAfterMs),
    };
  }

  function speakingCacheKey(username, classId) {
    return `${normalizeUsername(username)}:${normalizeClassCode(classId)}`;
  }

  async function getSpeakingChallenge(username, classId, window = null) {
    const cached = speakingSnapshots.get(speakingCacheKey(username, classId));
    if (!cached) return null;
    const challenge = cached.leaderboard?.challenge || {};
    if (window?.id && challenge.id !== window.id) return null;
    if (window?.end && challenge.end !== window.end) return null;
    if (now() - cached.cachedAt > speakingStaleAfterMs) return null;
    return clone(cached.leaderboard);
  }

  async function refreshSpeakingChallenge({ username, scraper, classId, window = null }) {
    if (typeof fetchSpeakingChallenge !== 'function') {
      throw new Error('每日开口快照未配置');
    }
    const key = speakingCacheKey(username, classId);
    if (!normalizeUsername(username) || !scraper || !normalizeClassCode(classId)) {
      throw new Error('缺少老师、教务会话或班级');
    }
    const activeJob = speakingRefreshJobs.get(key);
    if (activeJob) {
      return { leaderboard: clone(await activeJob), deduplicated: true };
    }
    const teacherKey = normalizeUsername(username);
    const previousTeacherJob = speakingTeacherQueues.get(teacherKey) || Promise.resolve();
    const upstreamJob = previousTeacherJob.catch(() => {}).then(async () => {
      const leaderboard = await fetchSpeakingChallenge({ scraper, classId: normalizeClassCode(classId), window });
      const returnedClassCode = normalizeClassCode(leaderboard?.classCode);
      if (returnedClassCode !== normalizeClassCode(classId)) {
        throw new Error(`每日开口班级数据不一致：请求 ${normalizeClassCode(classId)}，返回 ${returnedClassCode || '未知班级'}`);
      }
      speakingSnapshots.set(key, { leaderboard: clone(leaderboard), cachedAt: now() });
      return leaderboard;
    });
    speakingTeacherQueues.set(teacherKey, upstreamJob);
    const job = upstreamJob.finally(() => {
      if (speakingTeacherQueues.get(teacherKey) === upstreamJob) {
        speakingTeacherQueues.delete(teacherKey);
      }
    });
    speakingRefreshJobs.set(key, job);
    try {
      return { leaderboard: clone(await job), deduplicated: false };
    } finally {
      speakingRefreshJobs.delete(key);
    }
  }

  async function fetchRoster(scraper, classInfo) {
    let squadId = String(classInfo.squadId || '').trim();
    if (!squadId) {
      const resolved = await scraper.resolveSquadId(classInfo.id);
      squadId = String(resolved?.squadId || '').trim();
    }
    if (!squadId) {
      throw new Error('缺少 squadId');
    }

    const response = await scraper.request(
      `/admin/squad/cop_mip/getStudentList?squad_id=${encodeURIComponent(squadId)}&squad_type=offline`,
      { headers: { accept: 'application/json' } },
    );
    const data = await response.json().catch(() => ({}));
    if (!Array.isArray(data?.data)) {
      throw new Error(String(data?.msg || `HTTP ${response.status}`));
    }
    return {
      classId: classInfo.id,
      squadId,
      students: data.data.map(normalizeStudent),
      updatedAt: new Date(now()).toISOString(),
    };
  }

  async function performRefresh({ username, scraper, reason = 'manual', context = {}, classMap: preparedClassMap = null }) {
    await ensureLoaded();
    const key = normalizeUsername(username);
    if (!key || !scraper) {
      throw new Error('缺少已登录老师或教务会话');
    }

    const previous = state.snapshots[key] || null;
    // A class-map cache is valid for only two minutes, so reusing it avoids
    // repeating the login/bootstrap request while keeping the snapshot current.
    const classMap = preparedClassMap || await scraper.getClassMap(false);
    const seen = new Set();
    const classes = (Array.isArray(classMap) ? classMap : []).map((item) => ({
      id: normalizeClassCode(item?.classCode || item?.name || item?.id),
      name: normalizeClassCode(item?.classCode || item?.name || item?.id),
      squadId: String(item?.squadId || '').trim(),
    })).filter((item) => item.id && !seen.has(item.id) && seen.add(item.id));

    // Start the speaking export immediately. If the homepage board asks for the
    // same class while this silent refresh is running, both consumers share the
    // per-class job instead of downloading the export twice.
    const speakingRefreshPromise = typeof fetchSpeakingChallenge === 'function'
      ? (async () => {
        const allResults = [];
        // Keep this explicitly single-file as well as using the per-teacher
        // queue above. The upstream export generator is not concurrency-safe.
        const challengeConcurrency = 1;
        for (let index = 0; index < classes.length; index += challengeConcurrency) {
          const chunk = classes.slice(index, index + challengeConcurrency);
          const results = await Promise.allSettled(chunk.map((classInfo) => (
            refreshSpeakingChallenge({
              username,
              scraper,
              classId: classInfo.id,
              window: context?.speakingWindow || null,
            })
          )));
          results.forEach((result, offset) => allResults.push({ classId: chunk[offset].id, result }));
        }
        return allResults;
      })()
      : Promise.resolve([]);

    const successes = [];
    const failures = [];
    if (fetchRosters) {
      for (let index = 0; index < classes.length; index += concurrency) {
        const chunk = classes.slice(index, index + concurrency);
        const results = await Promise.allSettled(chunk.map((classInfo) => fetchRoster(scraper, classInfo)));
        results.forEach((result, offset) => {
          if (result.status === 'fulfilled') {
            successes.push(result.value);
          } else {
            failures.push({
              classId: chunk[offset].id,
              error: String(result.reason?.message || result.reason || '名单抓取失败'),
            });
          }
        });
      }
    }

    const previousRosters = fetchRosters && persistRosters
      ? Object.fromEntries((previous?.rosters || []).map((roster) => [normalizeClassCode(roster.classId), roster]))
      : {};
    const successfulRosters = Object.fromEntries(successes.map((roster) => [roster.classId, roster]));
    const rosters = classes.map((classInfo) => successfulRosters[classInfo.id] || previousRosters[classInfo.id]).filter(Boolean);
    const previousDailyReportTasks = previous?.dailyReportTasks && typeof previous.dailyReportTasks === 'object'
      ? previous.dailyReportTasks
      : {};
    const dailyReportTasks = {};
    const taskFailures = [];
    if (typeof fetchDailyReportTasks === 'function') {
      const taskSuccesses = {};
      const taskConcurrency = Math.max(1, Math.min(2, concurrency));
      for (let index = 0; index < classes.length; index += taskConcurrency) {
        const chunk = classes.slice(index, index + taskConcurrency);
        const results = await Promise.allSettled(chunk.map((classInfo) => (
          fetchDailyReportTasks({ scraper, classId: classInfo.id })
        )));
        results.forEach((result, offset) => {
          const classId = chunk[offset].id;
          if (result.status === 'fulfilled') {
            taskSuccesses[classId] = result.value;
          } else {
            taskFailures.push({
              classId,
              error: String(result.reason?.message || result.reason || '周任务抓取失败'),
            });
          }
        });
      }
      for (const classInfo of classes) {
        const taskSnapshot = filterVideoTaskSnapshot(taskSuccesses[classInfo.id] || previousDailyReportTasks[classInfo.id]);
        if (taskSnapshot) dailyReportTasks[classInfo.id] = taskSnapshot;
      }
    }

    const previousSpeakingMeta = previous?.speakingChallengeMeta && typeof previous.speakingChallengeMeta === 'object'
      ? previous.speakingChallengeMeta
      : {};
    const speakingChallengeMeta = {};
    const speakingFailures = [];
    if (typeof fetchSpeakingChallenge === 'function') {
      const challengeSuccesses = {};
      const results = await speakingRefreshPromise;
      results.forEach(({ classId, result }) => {
        if (result.status === 'fulfilled') {
          const leaderboard = result.value.leaderboard;
          challengeSuccesses[classId] = {
            classId,
            challengeId: leaderboard?.challenge?.id || '',
            rangeStart: leaderboard?.challenge?.start || '',
            rangeEnd: leaderboard?.challenge?.end || '',
            studentCount: Number(leaderboard?.totalStudents) || 0,
            updatedAt: new Date(now()).toISOString(),
          };
        } else {
          speakingFailures.push({
            classId,
            error: String(result.reason?.message || result.reason || '每日开口抓取失败'),
          });
        }
      });
      for (const classInfo of classes) {
        const meta = challengeSuccesses[classInfo.id] || previousSpeakingMeta[classInfo.id];
        if (meta) speakingChallengeMeta[classInfo.id] = meta;
      }
    }

    const latestStoredSnapshot = state.snapshots[key] || previous || null;
    const previousPublicities = latestStoredSnapshot?.dailyReportPublicities
      && typeof latestStoredSnapshot.dailyReportPublicities === 'object'
      ? clone(latestStoredSnapshot.dailyReportPublicities)
      : {};
    const dailyReportPublicities = previousPublicities;
    const dailyReportPublicityFailures = [];
    if (typeof fetchDailyReportPublicity === 'function') {
      // The academic-system publicity fallback uses a browser page. Keep the
      // 06:30 preparation serialized so one slow class cannot make every
      // parallel report navigation time out.
      for (const classInfo of classes) {
        const taskSnapshot = dailyReportTasks[classInfo.id];
        if (!taskSnapshot) continue;
        const candidates = buildPublicityCandidateSelections(taskSnapshot);
        for (const selectedWeekIds of candidates) {
          try {
            const publicity = await fetchDailyReportPublicity({
              scraper,
              classId: classInfo.id,
              taskSnapshot,
              selectedWeekIds,
            });
            if (!Array.isArray(publicity?.tableRows) || publicity.tableRows.length === 0) {
              throw new Error('日报公示数据为空');
            }
            const selectionKey = publicitySelectionKey(selectedWeekIds);
            dailyReportPublicities[classInfo.id] = {
              ...(dailyReportPublicities[classInfo.id] || {}),
              [selectionKey]: {
                classId: classInfo.id,
                selectedWeekIds,
                selectionFingerprint: taskSelectionFingerprint(taskSnapshot, selectedWeekIds),
                tableRows: clone(publicity.tableRows),
                updatedAt: new Date(now()).toISOString(),
              },
            };
          } catch (error) {
            dailyReportPublicityFailures.push({
              classId: classInfo.id,
              selectedWeekIds,
              error: String(error?.message || error || '班级日报预抓取失败'),
            });
          }
        }
      }
    }
    const activeClassIds = new Set(classes.map((classInfo) => classInfo.id));
    for (const classId of Object.keys(dailyReportPublicities)) {
      if (!activeClassIds.has(classId)) {
        delete dailyReportPublicities[classId];
        continue;
      }
      dailyReportPublicities[classId] = Object.fromEntries(
        Object.entries(dailyReportPublicities[classId] || {})
          .sort(([, left], [, right]) => Date.parse(right?.updatedAt || '') - Date.parse(left?.updatedAt || ''))
          .slice(0, 12),
      );
    }

    const refreshedAt = new Date(now()).toISOString();
    const complete = failures.length === 0 && taskFailures.length === 0 && speakingFailures.length === 0
      && dailyReportPublicityFailures.length === 0;
    const snapshot = {
      version: STORE_VERSION,
      username: String(username || '').trim(),
      reason: String(reason || 'manual').trim().slice(0, 40),
      context: clone(context),
      classes,
      rosters,
      failures,
      dailyReportTasks,
      taskFailures,
      speakingChallengeMeta,
      speakingFailures,
      dailyReportPublicities,
      dailyReportPublicityFailures,
      updatedAt: refreshedAt,
      lastCompleteAt: complete ? refreshedAt : previous?.lastCompleteAt || null,
      totalStudents: rosters.reduce((sum, roster) => sum + roster.students.length, 0),
    };

    state.snapshots[key] = stripRosterData(snapshot);
    await persist();
    return clone(snapshot);
  }

  async function refresh(input) {
    const key = normalizeUsername(input?.username);
    const activeJob = refreshJobs.get(key);
    if (activeJob) {
      return { ...(await activeJob), deduplicated: true };
    }

    const job = (async () => {
      await ensureLoaded();
      const previous = state.snapshots[key] || null;
      const reason = String(input?.reason || 'manual').trim().toLowerCase();
      const requestedDataDate = String(input?.context?.dataDate || '').trim();
      const previousDataDate = String(previous?.context?.dataDate || '').trim();
      if (reason === 'homepage' && previous && requestedDataDate && previousDataDate === requestedDataDate
        && !previous.failures?.length && !previous.taskFailures?.length
        && !previous.speakingFailures?.length && !previous.dailyReportPublicityFailures?.length) {
        // A restored browser session may carry an older class map for the
        // entire session lifetime. The skip decision must compare against the
        // authoritative current list, otherwise a newly assigned class stays
        // invisible until another code path happens to refresh that cache.
        const classMap = await input.scraper.getClassMap(true);
        const currentClassIds = (Array.isArray(classMap) ? classMap : [])
          .map((item) => normalizeClassCode(item?.classCode || item?.name || item?.id))
          .filter(Boolean)
          .sort();
        const previousClassIds = (Array.isArray(previous.classes) ? previous.classes : [])
          .map((item) => normalizeClassCode(item?.id || item?.name || item?.classCode))
          .filter(Boolean)
          .sort();
        const classesMatch = currentClassIds.length === previousClassIds.length
          && currentClassIds.every((classId, index) => classId === previousClassIds[index]);
        if (classesMatch) {
          return { snapshot: clone(previous), skipped: true };
        }
        return { snapshot: await performRefresh({ ...input, classMap }) };
      }
      return { snapshot: await performRefresh(input) };
    })();
    refreshJobs.set(key, job);
    try {
      return { ...(await job), deduplicated: false };
    } finally {
      refreshJobs.delete(key);
    }
  }

  async function getDailyReportTask(username, classId) {
    await ensureLoaded();
    const key = normalizeUsername(username);
    const normalizedClassId = normalizeClassCode(classId);
    return filterVideoTaskSnapshot(clone(state.snapshots[key]?.dailyReportTasks?.[normalizedClassId] || null));
  }

  async function getDailyReportPublicity(username, classId, selectedWeekIds, selectionFingerprint = '') {
    await ensureLoaded();
    const key = normalizeUsername(username);
    const normalizedClassId = normalizeClassCode(classId);
    const selectionKey = publicitySelectionKey(selectedWeekIds);
    const cached = state.snapshots[key]?.dailyReportPublicities?.[normalizedClassId]?.[selectionKey] || null;
    if (!cached) return null;
    if (selectionFingerprint && String(cached.selectionFingerprint || '') !== String(selectionFingerprint)) return null;
    return clone(cached);
  }

  async function saveDailyReportPublicity({
    username,
    classId,
    selectedWeekIds,
    selectionFingerprint = '',
    tableRows,
  }) {
    await ensureLoaded();
    const key = normalizeUsername(username);
    const normalizedClassId = normalizeClassCode(classId);
    const normalizedWeekIds = normalizeSelectedWeekIds(selectedWeekIds);
    const selectionKey = publicitySelectionKey(normalizedWeekIds);
    if (!key || !normalizedClassId || !selectionKey || !Array.isArray(tableRows) || tableRows.length === 0) {
      throw new Error('日报快照保存参数无效');
    }
    const previous = state.snapshots[key] || {
      version: STORE_VERSION,
      username: String(username || '').trim(),
      classes: [],
      rosters: [],
      failures: [],
      dailyReportTasks: {},
      taskFailures: [],
      totalStudents: 0,
      updatedAt: new Date(now()).toISOString(),
      lastCompleteAt: null,
    };
    const record = {
      classId: normalizedClassId,
      selectedWeekIds: normalizedWeekIds,
      selectionFingerprint: String(selectionFingerprint || ''),
      tableRows: clone(tableRows),
      updatedAt: new Date(now()).toISOString(),
    };
    state.snapshots[key] = {
      ...previous,
      dailyReportPublicities: {
        ...(previous.dailyReportPublicities || {}),
        [normalizedClassId]: {
          ...(previous.dailyReportPublicities?.[normalizedClassId] || {}),
          [selectionKey]: record,
        },
      },
      dailyReportPublicityFailures: (previous.dailyReportPublicityFailures || []).filter((item) => (
        normalizeClassCode(item?.classId) !== normalizedClassId
        || publicitySelectionKey(item?.selectedWeekIds) !== selectionKey
      )),
    };
    await persist();
    return clone(record);
  }

  async function refreshDailyReportTask({ username, scraper, classId }) {
    await ensureLoaded();
    if (typeof fetchDailyReportTasks !== 'function') {
      throw new Error('日报周任务快照未配置');
    }
    const key = normalizeUsername(username);
    const normalizedClassId = normalizeClassCode(classId);
    if (!key || !scraper || !normalizedClassId) {
      throw new Error('缺少老师、教务会话或班级');
    }

    const fullRefresh = refreshJobs.get(key);
    if (fullRefresh) {
      await fullRefresh;
      const taskSnapshot = await getDailyReportTask(username, normalizedClassId);
      if (taskSnapshot) return { taskSnapshot, deduplicated: true };
    }

    const jobKey = `${key}:${normalizedClassId}`;
    const activeJob = taskRefreshJobs.get(jobKey);
    if (activeJob) {
      return { taskSnapshot: await activeJob, deduplicated: true };
    }

    const job = (async () => {
      const taskSnapshot = await fetchDailyReportTasks({ scraper, classId: normalizedClassId });
      const previous = state.snapshots[key] || {
        version: STORE_VERSION,
        username: String(username || '').trim(),
        classes: [],
        rosters: [],
        failures: [],
        dailyReportTasks: {},
        taskFailures: [],
        totalStudents: 0,
        updatedAt: new Date(now()).toISOString(),
        lastCompleteAt: null,
      };
      state.snapshots[key] = {
        ...previous,
        dailyReportTasks: {
          ...(previous.dailyReportTasks || {}),
          [normalizedClassId]: taskSnapshot,
        },
        taskFailures: (previous.taskFailures || []).filter((item) => normalizeClassCode(item.classId) !== normalizedClassId),
        updatedAt: new Date(now()).toISOString(),
      };
      await persist();
      return clone(taskSnapshot);
    })();
    taskRefreshJobs.set(jobKey, job);
    try {
      return { taskSnapshot: await job, deduplicated: false };
    } finally {
      taskRefreshJobs.delete(jobKey);
    }
  }

  return {
    get,
    refresh,
    getDailyReportTask,
    getDailyReportPublicity,
    saveDailyReportPublicity,
    refreshDailyReportTask,
    getSpeakingChallenge,
    refreshSpeakingChallenge,
  };
}

function startDailyRosterPrefetch({
  sessions,
  service,
  hour = 6,
  minute = 30,
  now = () => Date.now(),
  logger = console,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  buildContext = () => ({}),
}) {
  let timer = null;
  let stopped = false;

  async function run() {
    const activeByUsername = new Map();
    for (const session of sessions.values()) {
      const key = normalizeUsername(session?.username);
      if (key && session?.scraper && !activeByUsername.has(key)) {
        activeByUsername.set(key, session);
      }
    }
    const results = await Promise.allSettled(Array.from(activeByUsername.values()).map((session) => (
      service.refresh({
        username: session.username,
        scraper: session.scraper,
        reason: 'daily',
        context: buildContext(),
      })
    )));
    const completed = results.filter((result) => result.status === 'fulfilled').length;
    if (activeByUsername.size > 0) {
      logger.log?.(`✅ 每日首页数据预抓取完成: ${completed}/${activeByUsername.size} 位老师`);
    }
  }

  function schedule() {
    if (stopped) return;
    const delay = millisecondsUntilNextShanghaiRun(now(), hour, minute);
    timer = setTimer(async () => {
      try {
        await run();
      } catch (error) {
        logger.error?.(`❌ 每日首页数据预抓取失败: ${error.message}`);
      } finally {
        schedule();
      }
    }, delay);
    timer?.unref?.();
  }

  schedule();
  return () => {
    stopped = true;
    if (timer) clearTimer(timer);
  };
}

module.exports = {
  buildPublicityCandidateSelections,
  createRosterSnapshotService,
  getSnapshotStatus,
  millisecondsUntilNextShanghaiRun,
  publicitySelectionKey,
  startDailyRosterPrefetch,
};
