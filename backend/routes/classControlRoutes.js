const express = require('express');
const { buildCompleteTaskCatalog, taskSelectionFingerprint } = require('../lib/taskCatalog');
const {
  buildClassControlCyclePlan,
  buildHistoricalCyclePlan,
  buildPreparedCycleSelection,
  getCombinedCheckinWindow,
  normalizeClassCode,
  selectCoreActivityTasks,
  summarizeAttendanceRows,
  summarizeSpeakingRows,
  summarizeTaskTableRows,
} = require('../lib/classControl');
const {
  normalizeTeacherScheduleEvents,
  summarizeTeacherSchedule,
} = require('../lib/teacherSchedule');
const { buildDailyReportViewModel } = require('../lib/dailyReportViewModel');

function addDays(dateText, days) {
  const date = new Date(`${dateText}T12:00:00+08:00`);
  if (Number.isNaN(date.getTime())) return '';
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function classControlCycleKey(cycle = {}) {
  return `${String(cycle.rangeStart || '')}|${String(cycle.rangeEnd || '')}|${(cycle.weekIds || []).map(String).join(',')}`;
}

function normalizeKnownCycleKeys(value) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map((item) => String(item || '').trim())
    .filter((item) => item && item.length <= 512))]
    .slice(0, 8);
}

function normalizeSelectedWeekIds(value) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map((item) => String(item || '').trim())
    .filter((item) => item && item.length <= 160))]
    .slice(0, 12);
}

function normalizeReportOptions(value = {}, fallbackRange = {}) {
  const minSpeakingDays = Number(value?.minSpeakingDays);
  return {
    mode: ['standard', 'detail', 'senior'].includes(value?.mode) ? value.mode : 'standard',
    includeSpeaking: value?.includeSpeaking !== false,
    minSpeakingDays: Number.isFinite(minSpeakingDays) ? Math.max(0, Math.min(7, minSpeakingDays)) : 2,
    testPassScore: value?.testPassScore === '' || value?.testPassScore == null
      ? null
      : Math.max(0, Math.min(100, Number(value.testPassScore) || 0)),
    aiVoicePassRate: Number.isFinite(Number(value?.aiVoicePassRate))
      ? Math.max(0, Math.min(100, Number(value.aiVoicePassRate)))
      : 75,
    speakingRangeStart: String(value?.speakingRangeStart || fallbackRange?.start || '').trim(),
    speakingRangeEnd: String(value?.speakingRangeEnd || fallbackRange?.end || '').trim(),
  };
}

function historicalTaskSnapshot(classId, preferredSemester, tasks = []) {
  const preferredYear = String(preferredSemester || '').match(/(20\d{2})学年/)?.[1] || '';
  return {
    classId: normalizeClassCode(classId),
    preferredYear,
    preferredSemester,
    weekTasks: tasks,
    weekMap: Object.fromEntries(tasks.map((task) => [String(task.id), task.tasks || []])),
    weekSourceLabels: Object.fromEntries(tasks.map((task) => [String(task.id), task.sourceLabels || []])),
    weekSelectionMap: Object.fromEntries(tasks.map((task) => [String(task.id), task.taskSelection || {}])),
  };
}

function checkinRowsForCycle(rows = [], cycle = {}) {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const dates = Object.entries(row?.date_values || {}).filter(([date]) => (
      date >= String(cycle.rangeStart || '') && date <= String(cycle.rangeEnd || '')
    ));
    return {
      ...row,
      all_check_days: dates.filter(([, value]) => String(value || '').trim()).length,
      supplement_times: dates.filter(([, value]) => String(value || '').includes('补')).length,
      date_values: Object.fromEntries(dates),
    };
  });
}

function createConcurrencyLimiter(limit = 8) {
  const concurrency = Math.max(1, Math.min(20, Number(limit) || 8));
  let active = 0;
  const waiters = [];

  async function acquire() {
    if (active < concurrency) {
      active += 1;
      return;
    }
    await new Promise((resolve) => waiters.push(resolve));
  }

  function release() {
    active = Math.max(0, active - 1);
    const next = waiters.shift();
    if (!next) return;
    active += 1;
    next();
  }

  return {
    async run(task) {
      await acquire();
      try {
        return await task();
      } finally {
        release();
      }
    },
    stats() {
      return { concurrency, active, queued: waiters.length };
    },
  };
}

async function fetchClassRoster(scraper, classId) {
  const resolved = await scraper.resolveSquadId(classId);
  const squadId = String(resolved?.squadId || '').trim();
  if (!squadId) throw new Error('缺少班级 squadId');
  return {
    classCode: normalizeClassCode(resolved?.classCode || classId),
    squadId,
    // Task rows and speaking exports are each authoritative for their own
    // student lists. Do not cross-check against a second roster source here.
    students: [],
  };
}

function summarizeSpeakingLeaderboardForRange(leaderboard, rangeStart, rangeEnd) {
  if (!leaderboard || !Array.isArray(leaderboard.students)) return null;
  const rows = leaderboard.students.map((student) => {
    const days = (Array.isArray(student?.daily) ? student.daily : [])
      .filter((entry) => entry?.date >= rangeStart && entry?.date <= rangeEnd);
    return {
      no: String(student?.studentId || '').trim(),
      ch_name: String(student?.chineseName || '').trim(),
      en_name: String(student?.englishName || '').trim(),
      all_check_days: days.filter((entry) => entry?.status === 'normal' || entry?.status === 'supplement').length,
      supplement_times: days.filter((entry) => entry?.status === 'supplement').length,
    };
  });
  return summarizeSpeakingRows(rows, []);
}

function speakingLeaderboardFromRows(rows = [], rangeStart = '', rangeEnd = '') {
  const dates = [];
  const cursor = new Date(`${rangeStart}T12:00:00Z`);
  const last = new Date(`${rangeEnd}T12:00:00Z`);
  while (!Number.isNaN(cursor.getTime()) && cursor <= last && dates.length < 31) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return {
    challenge: { start: rangeStart, end: rangeEnd },
    students: (Array.isArray(rows) ? rows : []).map((row) => ({
      studentId: String(row?.no || row?.student_no || '').trim(),
      chineseName: String(row?.ch_name || row?.中文名 || '').trim(),
      englishName: String(row?.en_name || row?.英文名 || '').trim(),
      daily: dates.map((date) => {
        const value = row?.date_values?.[date];
        return {
        date,
        status: String(value || '').includes('补') ? 'supplement' : String(value || '').trim() ? 'normal' : 'missed',
        };
      }),
    })),
  };
}

function createClassControlRoutes({
  requireLoggedInSession,
  rosterSnapshotService,
  taskCatalogVersion,
  currentTermName,
  week1Start,
  timezone,
  now = () => new Date(),
  readConcurrency = 8,
  fetchCheckinRowsForRange = null,
  fetchPublicity = null,
  rewardPolicyStore = null,
}) {
  const router = express.Router();
  const jobs = new Map();
  const readLimiter = createConcurrencyLimiter(readConcurrency);

  // Approved report/overview endpoints remain available with authenticated teacher sessions.
  function readPublicity(session, classId, selection) {
    if (typeof fetchPublicity === 'function') return fetchPublicity({ session, classId, selection });
    return session.scraper.scrapePublicityExportData(classId, selection);
  }


  async function loadTaskSnapshot(session, classId) {
    let taskSnapshot = await rosterSnapshotService.getDailyReportTask(session.username, classId);
    if (!taskSnapshot || Number(taskSnapshot.taskCatalogVersion) !== Number(taskCatalogVersion)) {
      taskSnapshot = (await rosterSnapshotService.refreshDailyReportTask({
        username: session.username,
        scraper: session.scraper,
        classId,
      })).taskSnapshot;
    }
    return taskSnapshot;
  }

  async function hydrateTaskCycle(session, classId, taskSnapshot, cycle, roster) {
    if (!cycle) return null;
    const selection = buildPreparedCycleSelection(taskSnapshot, cycle);
    if (!selection?.preparedSelection?.taskIds?.length) {
      return { ...cycle, task: null, taskError: '任务目录尚未提供可读取节点', speaking: null };
    }
    try {
      const publicity = await readPublicity(session, classId, selection);
      return {
        ...cycle,
        task: summarizeTaskTableRows(publicity.tableRows, roster),
        taskError: '',
        speaking: null,
      };
    } catch (error) {
      return {
        ...cycle,
        task: null,
        taskError: String(error?.message || error || '作业完成数据读取失败'),
        speaking: null,
      };
    }
  }

  async function buildSelectedTaskReport(
    session,
    classId,
    requestedWeekIds,
    requestedOptions = {},
    { forceRefresh = false } = {},
  ) {
    const taskSnapshot = await loadTaskSnapshot(session, classId);
    const availableTasks = Array.isArray(taskSnapshot?.weekTasks) ? taskSnapshot.weekTasks : [];
    const availableIds = new Set(availableTasks.map((task) => String(task?.id || '')).filter(Boolean));
    const selectedWeekIds = normalizeSelectedWeekIds(requestedWeekIds)
      .filter((weekId) => availableIds.has(weekId));
    if (selectedWeekIds.length === 0) {
      const error = new Error('请至少选择一个当前任务列表');
      error.statusCode = 400;
      throw error;
    }

    const selection = buildPreparedCycleSelection(taskSnapshot, { weekIds: selectedWeekIds });
    if (!selection || (!selection.selectedTasks?.length && !selection.preparedSelection?.taskIds?.length)) {
      const error = new Error('所选任务列表还没有可读取的任务节点');
      error.statusCode = 400;
      throw error;
    }

    const hasCompletePreparedSelection = selectedWeekIds.every((weekId) => (
      Array.isArray(taskSnapshot?.weekSelectionMap?.[weekId]?.taskIds)
      && taskSnapshot.weekSelectionMap[weekId].taskIds.length > 0
    ));
    const effectiveSelection = hasCompletePreparedSelection
      ? selection
      : { ...selection, preparedSelection: null };
    const selectionFingerprint = taskSelectionFingerprint(taskSnapshot, selectedWeekIds);
    const cachedPublicity = typeof rosterSnapshotService.getDailyReportPublicity === 'function'
      ? await rosterSnapshotService.getDailyReportPublicity(
        session.username,
        classId,
        selectedWeekIds,
        selectionFingerprint,
      )
      : null;
    let publicity = null;
    let source = '';
    let dataUpdatedAt = '';
    let refreshError = '';
    if (cachedPublicity && !forceRefresh) {
      publicity = {
        classId: cachedPublicity.classId || classId,
        tableRows: cachedPublicity.tableRows,
      };
      source = 'snapshot';
      dataUpdatedAt = cachedPublicity.updatedAt || '';
    } else {
      try {
        publicity = await readLimiter.run(() => readPublicity(session, classId, effectiveSelection));
        source = 'live';
        dataUpdatedAt = new Date(now()).toISOString();
        if (typeof rosterSnapshotService.saveDailyReportPublicity === 'function') {
          try {
            const saved = await rosterSnapshotService.saveDailyReportPublicity({
              username: session.username,
              classId,
              selectedWeekIds,
              selectionFingerprint,
              tableRows: publicity.tableRows,
            });
            dataUpdatedAt = saved?.updatedAt || dataUpdatedAt;
          } catch (cacheError) {
            console.warn(`⚠️ 班级日报快照保存失败 ${classId}: ${String(cacheError?.message || cacheError)}`);
          }
        }
      } catch (error) {
        if (!cachedPublicity) throw error;
        publicity = {
          classId: cachedPublicity.classId || classId,
          tableRows: cachedPublicity.tableRows,
        };
        source = 'snapshot-fallback';
        dataUpdatedAt = cachedPublicity.updatedAt || '';
        refreshError = String(error?.message || error || '实时刷新失败');
      }
    }
    const reportOptions = normalizeReportOptions(requestedOptions, taskSnapshot?.defaultCheckinRange || {});
    // The applied report options are authoritative. A saved template must not
    // re-enable speaking for a report/overview that explicitly switched it off.
    const needsSpeaking = reportOptions.includeSpeaking;
    let speakingLeaderboard = null;
    let speakingError = '';
    if (needsSpeaking && typeof rosterSnapshotService.getSpeakingChallenge === 'function') {
      const cached = await rosterSnapshotService.getSpeakingChallenge(session.username, classId);
      const cachedStart = String(cached?.challenge?.start || '');
      const cachedEnd = String(cached?.challenge?.end || '');
      if (cached && (!reportOptions.speakingRangeStart || cachedStart <= reportOptions.speakingRangeStart)
        && (!reportOptions.speakingRangeEnd || cachedEnd >= reportOptions.speakingRangeEnd)) {
        speakingLeaderboard = cached;
      }
    }
    if (needsSpeaking && !speakingLeaderboard && typeof fetchCheckinRowsForRange === 'function'
      && reportOptions.speakingRangeStart && reportOptions.speakingRangeEnd) {
      try {
        const checkin = await fetchCheckinRowsForRange(session.scraper, {
          classId,
          rangeStart: reportOptions.speakingRangeStart,
          rangeEnd: reportOptions.speakingRangeEnd,
          preferredYear: taskSnapshot?.preferredYear || '',
          preferredSemester: taskSnapshot?.preferredSemester || '',
        });
        speakingLeaderboard = speakingLeaderboardFromRows(
          checkin?.rows,
          reportOptions.speakingRangeStart,
          reportOptions.speakingRangeEnd,
        );
      } catch (nextError) {
        speakingError = String(nextError?.message || nextError || '每日开口数据读取失败');
      }
    }
    return {
      classId: normalizeClassCode(publicity?.classId || classId),
      preferredSemester: taskSnapshot?.preferredSemester || '',
      selectedWeekIds,
      selectedTasks: availableTasks.filter((task) => selectedWeekIds.includes(String(task?.id || ''))),
      selectionFingerprint,
      task: summarizeTaskTableRows(publicity.tableRows, []),
      detail: buildDailyReportViewModel(publicity.tableRows, speakingLeaderboard, reportOptions),
      speakingAvailable: Boolean(speakingLeaderboard),
      speakingError,
      source,
      dataUpdatedAt,
      refreshError,
      snapshotUpdatedAt: taskSnapshot?.updatedAt || '',
      updatedAt: new Date(now()).toISOString(),
    };
  }

  async function buildClassControlSummary(session, classId) {
    const currentTime = now();
    const taskSnapshot = await loadTaskSnapshot(session, classId);
    const cyclePlan = buildClassControlCyclePlan(taskSnapshot, {
      now: currentTime,
      currentTermName,
      week1Start,
      timezone,
    });
    const taskCount = Array.isArray(taskSnapshot?.weekTasks) ? taskSnapshot.weekTasks.length : 0;
    if (!cyclePlan.review && !cyclePlan.current) {
      return {
        classId: normalizeClassCode(classId),
        preferredSemester: taskSnapshot?.preferredSemester || '',
        historical: cyclePlan.historical,
        taskState: 'empty',
        taskCount,
        review: null,
        current: null,
        speakingError: '',
        updatedAt: new Date(currentTime).toISOString(),
      };
    }
    const rosterResult = await fetchClassRoster(session.scraper, classId);
    const cycles = [];
    if (cyclePlan.review) cycles.push(cyclePlan.review);
    if (cyclePlan.current) cycles.push(cyclePlan.current);
    const seenCycleKeys = new Set();
    const uniqueCycles = cycles.filter((cycle) => {
      const key = classControlCycleKey(cycle);
      if (seenCycleKeys.has(key)) return false;
      seenCycleKeys.add(key);
      return true;
    });

    const hydrated = [];
    for (const cycle of uniqueCycles) {
      hydrated.push(await hydrateTaskCycle(
        session,
        classId,
        taskSnapshot,
        cycle,
        rosterResult.students,
      ));
    }

    let speakingError = '';
    const speakingLeaderboard = typeof rosterSnapshotService.getSpeakingChallenge === 'function'
      ? await rosterSnapshotService.getSpeakingChallenge(session.username, classId)
      : null;
    if (speakingLeaderboard) {
      for (const cycle of hydrated) {
        cycle.speaking = summarizeSpeakingLeaderboardForRange(
          speakingLeaderboard,
          cycle.rangeStart,
          cycle.rangeEnd,
        );
      }
    } else {
      speakingError = '每日开口正在后台更新，完成后会自动进入班级分析';
    }

    const hydratedByKey = new Map(hydrated.map((cycle) => [classControlCycleKey(cycle), cycle]));

    const summary = {
      classId: rosterResult.classCode,
      preferredSemester: taskSnapshot?.preferredSemester || '',
      historical: cyclePlan.historical,
      taskState: 'ready',
      taskCount,
      review: cyclePlan.review ? hydratedByKey.get(classControlCycleKey(cyclePlan.review)) || null : null,
      current: cyclePlan.current ? hydratedByKey.get(classControlCycleKey(cyclePlan.current)) || null : null,
      speakingError,
      updatedAt: new Date(currentTime).toISOString(),
    };
    return summary;
  }

  async function buildClassControlTrendBatch(session, classId, knownCycleKeys = []) {
    const currentTime = now();
    const taskSnapshot = await loadTaskSnapshot(session, classId);
    const cyclePlan = buildClassControlCyclePlan(taskSnapshot, {
      now: currentTime,
      currentTermName,
      week1Start,
      timezone,
    });
    const plan = cyclePlan.trend || [];
    const planKeys = plan.map(classControlCycleKey);
    const known = new Set(normalizeKnownCycleKeys(knownCycleKeys));
    const missing = [...plan]
      .reverse()
      .filter((cycle) => !known.has(classControlCycleKey(cycle)));
    const batch = missing.slice(0, 2);
    if (batch.length === 0) {
      return {
        classId: normalizeClassCode(classId),
        preferredSemester: taskSnapshot?.preferredSemester || '',
        historical: cyclePlan.historical,
        trend: [],
        trendPlanKeys: planKeys,
        trendExpectedCount: plan.length,
        trendRemainingCount: 0,
        trendComplete: true,
        updatedAt: new Date(currentTime).toISOString(),
      };
    }
    const rosterResult = await fetchClassRoster(session.scraper, classId);
    const hydrated = await Promise.all(batch.map((cycle) => readLimiter.run(() => (
      hydrateTaskCycle(session, classId, taskSnapshot, cycle, rosterResult.students)
    ))));
    return {
      classId: rosterResult.classCode,
      preferredSemester: taskSnapshot?.preferredSemester || '',
      historical: cyclePlan.historical,
      trend: hydrated.filter(Boolean).map((cycle) => ({ ...cycle, role: 'trend' })),
      trendPlanKeys: planKeys,
      trendExpectedCount: plan.length,
      trendRemainingCount: Math.max(0, missing.length - hydrated.length),
      trendComplete: missing.length <= hydrated.length,
      updatedAt: new Date(currentTime).toISOString(),
    };
  }

  async function buildClassControlAttendance(session, classId) {
    const rosterResult = await fetchClassRoster(session.scraper, classId);
    if (typeof session.scraper.scrapeAttendanceData !== 'function') {
      return { classId: rosterResult.classCode, attendance: null, attendanceError: '考勤接口暂不可用' };
    }
    try {
      const rows = await session.scraper.scrapeAttendanceData(classId);
      return {
        classId: rosterResult.classCode,
        attendance: summarizeAttendanceRows(rows, rosterResult.students),
        attendanceError: '',
      };
    } catch (error) {
      return {
        classId: rosterResult.classCode,
        attendance: null,
        attendanceError: String(error?.message || error || '考勤数据读取失败'),
      };
    }
  }

  async function buildHistoricalClassControl(session, classId, request = {}) {
    const preferredSemester = String(request.preferredSemester || '').trim();
    if (!/^20\d{2}学年(?:春季|秋季)学期$/.test(preferredSemester)) {
      throw new Error('必须提供官网格式的明确历史学期。');
    }
    const semesters = await session.scraper.fetchSemesterData();
    const officialTerm = (Array.isArray(semesters) ? semesters : []).find((term) => (
      String(term?.name || '').trim() === preferredSemester
    ));
    if (!officialTerm) throw new Error(`网站真实学期目录中没有 ${preferredSemester}。`);

    // Resolve the class through the logged-in scraper before reading any term
    // data. A class outside the current teacher's class map fails here.
    const rosterResult = await fetchClassRoster(session.scraper, classId);
    const preferredYear = preferredSemester.match(/(20\d{2})学年/)?.[1] || '';
    const taskInfo = await session.scraper.scrapePublicityTaskList(classId, {
      preferredYear,
      preferredSemester,
      includeAdjacentActive: false,
    });
    if (String(taskInfo?.preferredSemester || '').trim() !== preferredSemester) {
      throw new Error(`网站没有精确返回 ${preferredSemester}，已停止，未使用相近学期替代。`);
    }
    const taskCatalog = buildCompleteTaskCatalog(taskInfo, (items) => items);
    const completeSnapshot = historicalTaskSnapshot(classId, preferredSemester, taskCatalog);
    const coreTasks = selectCoreActivityTasks(completeSnapshot);
    const cyclePlan = buildHistoricalCyclePlan(coreTasks, {
      phase: request.phase,
      monthKind: request.monthKind,
      month: request.month,
      maxCycles: 8,
      now: now(),
    });
    if (cyclePlan.status !== 'ready') {
      return {
        classId: rosterResult.classCode,
        preferredSemester,
        phase: String(request.phase || 'all'),
        monthKind: String(request.monthKind || 'whole_term'),
        resolvedMonth: cyclePlan.resolvedMonth || null,
        status: cyclePlan.status,
        message: cyclePlan.message,
        cycles: [],
        speakingError: '',
        attendanceError: '历史考勤尚无可按日期核验的读取入口。',
        updatedAt: new Date(now()).toISOString(),
      };
    }

    const snapshot = historicalTaskSnapshot(classId, preferredSemester, coreTasks);
    const hydrated = [];
    for (const cycle of cyclePlan.cycles) {
      hydrated.push(await readLimiter.run(() => hydrateTaskCycle(
        session,
        classId,
        snapshot,
        cycle,
        rosterResult.students,
      )));
    }

    let speakingError = '';
    if (typeof fetchCheckinRowsForRange === 'function') {
      const window = getCombinedCheckinWindow(hydrated);
      if (window) {
        try {
          const checkin = await fetchCheckinRowsForRange(session.scraper, {
            classId,
            rangeStart: window.start,
            rangeEnd: window.end,
            preferredYear,
            preferredSemester,
          });
          if (checkin?.summaryOnly) {
            speakingError = '每日开口只返回学期累计值，不能拆成所选历史周期。';
          } else {
            for (const cycle of hydrated) {
              cycle.speaking = summarizeSpeakingRows(checkinRowsForCycle(checkin?.rows, cycle), rosterResult.students);
            }
          }
        } catch (error) {
          speakingError = String(error?.message || error || '历史每日开口读取失败');
        }
      }
    } else {
      speakingError = '历史每日开口读取适配器尚未配置。';
    }

    return {
      classId: rosterResult.classCode,
      preferredSemester,
      officialTermId: String(officialTerm.id || officialTerm.term_id || ''),
      phase: String(request.phase || 'all'),
      monthKind: String(request.monthKind || 'whole_term'),
      resolvedMonth: cyclePlan.resolvedMonth || null,
      status: 'ready',
      taskCount: cyclePlan.taskCount,
      cycles: hydrated,
      speakingError,
      attendanceError: '历史考勤尚无可按日期核验的读取入口。',
      updatedAt: new Date(now()).toISOString(),
    };
  }

  router.get('/data/class-control/schedule', async (req, res) => {
    const session = requireLoggedInSession(req, res);
    if (!session) return;
    try {
      const classMap = await session.scraper.getClassMap(false);
      const allowedClassCodes = classMap.map((item) => normalizeClassCode(item?.classCode)).filter(Boolean);
      const startDate = week1Start;
      const endDate = addDays(week1Start, 210);
      const rows = await session.scraper.fetchTeacherScheduleEvents({ startDate, endDate });
      const events = normalizeTeacherScheduleEvents(rows, allowedClassCodes);
      res.setHeader('Cache-Control', 'no-store');
      res.json({
        status: 'success',
        source: 'official_schedule',
        range: { startDate, endDate },
        classes: summarizeTeacherSchedule(events),
        updatedAt: new Date(now()).toISOString(),
      });
    } catch (error) {
      res.status(502).json({ error: String(error?.message || error || '老师课表读取失败') });
    }
  });

  router.post('/data/class-control/refresh', async (req, res) => {
    const session = requireLoggedInSession(req, res);
    if (!session) return;
    const classId = normalizeClassCode(req.body?.classId);
    if (!classId || !/^[A-Z][A-Z0-9-]{1,31}$/.test(classId)) {
      return res.status(400).json({ error: 'classId 必须是当前老师的班级代码' });
    }
    const jobKey = `${String(session.username || '').trim().toLowerCase()}:${classId}:base`;
    let job = jobs.get(jobKey);
    const deduplicated = Boolean(job);
    if (!job) {
      job = readLimiter.run(() => buildClassControlSummary(session, classId));
      jobs.set(jobKey, job);
    }

    try {
      const summary = await job;
      res.setHeader('Cache-Control', 'no-store');
      res.json({ status: 'success', deduplicated, summary });
    } catch (error) {
      res.status(502).json({ error: String(error?.message || error || '班级监控数据读取失败') });
    } finally {
      if (!deduplicated) jobs.delete(jobKey);
    }
  });

  router.post('/data/class-control/task-catalog', async (req, res) => {
    const session = requireLoggedInSession(req, res);
    if (!session) return;
    const classId = normalizeClassCode(req.body?.classId);
    if (!classId || !/^[A-Z][A-Z0-9-]{1,31}$/.test(classId)) {
      return res.status(400).json({ error: 'classId 必须是当前老师的班级代码' });
    }
    const jobKey = `${String(session.username || '').trim().toLowerCase()}:${classId}:task-catalog`;
    let job = jobs.get(jobKey);
    const deduplicated = Boolean(job);
    if (!job) {
      job = readLimiter.run(() => loadTaskSnapshot(session, classId));
      jobs.set(jobKey, job);
    }
    try {
      const taskSnapshot = await job;
      const weekTasks = Array.isArray(taskSnapshot?.weekTasks)
        ? taskSnapshot.weekTasks.map((task) => ({
          id: String(task?.id || ''),
          name: String(task?.name || ''),
          resourceCount: Number(task?.resourceCount) || 0,
          addedAt: task?.addedAt || '',
          startAt: task?.startAt || '',
          endAt: task?.endAt || '',
          status: task?.status ?? null,
          statusText: task?.statusText || '',
          lifecycle: task?.lifecycle || 'unknown',
          studentVisible: task?.studentVisible !== false,
          skuId: task?.skuId || '',
          collectionName: task?.collectionName || '',
          declaredTerm: task?.declaredTerm || '',
          weekNumber: Number.isFinite(Number(task?.weekNumber)) ? Number(task.weekNumber) : null,
        })).filter((task) => task.id)
        : [];
      res.setHeader('Cache-Control', 'no-store');
      res.json({
        status: 'success',
        deduplicated,
        catalog: {
          classId,
          preferredSemester: taskSnapshot?.preferredSemester || '',
          weekTasks,
          defaultSelectedWeekIds: Array.isArray(taskSnapshot?.defaultSelectedWeekIds) ? taskSnapshot.defaultSelectedWeekIds : [],
          defaultCheckinRange: taskSnapshot?.defaultCheckinRange || {},
          updatedAt: taskSnapshot?.updatedAt || '',
        },
      });
    } catch (error) {
      res.status(502).json({ error: String(error?.message || error || '任务目录读取失败') });
    } finally {
      if (!deduplicated) jobs.delete(jobKey);
    }
  });

  router.post('/data/class-control/task-report', async (req, res) => {
    const session = requireLoggedInSession(req, res);
    if (!session) return;
    const classId = normalizeClassCode(req.body?.classId);
    if (!classId || !/^[A-Z][A-Z0-9-]{1,31}$/.test(classId)) {
      return res.status(400).json({ error: 'classId 必须是当前老师的班级代码' });
    }
    const selectedWeekIds = normalizeSelectedWeekIds(req.body?.selectedWeekIds);
    const reportOptions = normalizeReportOptions(req.body?.options || {});
    const forceRefresh = req.body?.refresh === true;
    const optionKey = JSON.stringify(reportOptions);
    const jobKey = `${String(session.username || '').trim().toLowerCase()}:${classId}:task-report:${selectedWeekIds.slice().sort().join(',')}:${optionKey}:${forceRefresh ? 'refresh' : 'snapshot'}`;
    let job = jobs.get(jobKey);
    const deduplicated = Boolean(job);
    if (!job) {
      // Cached reports must not queue behind slow live class analysis. Only
      // the upstream scrape inside this builder consumes a read slot.
      job = buildSelectedTaskReport(
        session,
        classId,
        selectedWeekIds,
        reportOptions,
        { forceRefresh },
      );
      jobs.set(jobKey, job);
    }
    try {
      const report = await job;
      res.setHeader('Cache-Control', 'no-store');
      res.json({ status: 'success', deduplicated, report });
    } catch (error) {
      res.status(Number(error?.statusCode) || 502).json({
        error: String(error?.message || error || '班级日报数据读取失败'),
      });
    } finally {
      if (!deduplicated) jobs.delete(jobKey);
    }
  });

  router.get('/data/class-control/reward-policy', async (req, res) => {
    const session = requireLoggedInSession(req, res);
    if (!session) return;
    const classId = normalizeClassCode(req.query?.classId);
    if (!rewardPolicyStore || !classId || !/^[A-Z][A-Z0-9-]{1,31}$/.test(classId)) {
      return res.status(400).json({ error: '奖励规则读取参数无效' });
    }
    try {
      const result = await rewardPolicyStore.get(session.username, classId);
      res.setHeader('Cache-Control', 'no-store');
      res.json({ status: 'success', ...result });
    } catch (error) {
      res.status(500).json({ error: String(error?.message || error || '奖励规则读取失败') });
    }
  });

  router.put('/data/class-control/reward-policy', async (req, res) => {
    const session = requireLoggedInSession(req, res);
    if (!session) return;
    const classId = normalizeClassCode(req.body?.classId);
    const scope = String(req.body?.scope || 'teacher');
    if (!rewardPolicyStore || !classId || !/^[A-Z][A-Z0-9-]{1,31}$/.test(classId) || !['teacher', 'class'].includes(scope)) {
      return res.status(400).json({ error: '奖励规则保存参数无效' });
    }
    try {
      const result = await rewardPolicyStore.save(session.username, classId, scope, req.body?.policy || {});
      res.setHeader('Cache-Control', 'no-store');
      res.json({ status: 'success', ...result });
    } catch (error) {
      res.status(500).json({ error: String(error?.message || error || '奖励规则保存失败') });
    }
  });

  router.delete('/data/class-control/reward-policy', async (req, res) => {
    const session = requireLoggedInSession(req, res);
    if (!session) return;
    const classId = normalizeClassCode(req.query?.classId);
    if (!rewardPolicyStore || !classId || !/^[A-Z][A-Z0-9-]{1,31}$/.test(classId)) {
      return res.status(400).json({ error: '班级奖励规则参数无效' });
    }
    try {
      const result = await rewardPolicyStore.clearClass(session.username, classId);
      res.setHeader('Cache-Control', 'no-store');
      res.json({ status: 'success', ...result });
    } catch (error) {
      res.status(500).json({ error: String(error?.message || error || '恢复默认规则失败') });
    }
  });

  router.post('/data/class-control/trend', async (req, res) => {
    const session = requireLoggedInSession(req, res);
    if (!session) return;
    const classId = normalizeClassCode(req.body?.classId);
    if (!classId || !/^[A-Z][A-Z0-9-]{1,31}$/.test(classId)) {
      return res.status(400).json({ error: 'classId 必须是当前老师的班级代码' });
    }
    const knownCycleKeys = normalizeKnownCycleKeys(req.body?.knownCycleKeys);
    const jobKey = `${String(session.username || '').trim().toLowerCase()}:${classId}:trend:${knownCycleKeys.sort().join(';')}`;
    let job = jobs.get(jobKey);
    const deduplicated = Boolean(job);
    if (!job) {
      job = buildClassControlTrendBatch(session, classId, knownCycleKeys);
      jobs.set(jobKey, job);
    }
    try {
      const batch = await job;
      res.setHeader('Cache-Control', 'no-store');
      res.json({ status: 'success', deduplicated, batch });
    } catch (error) {
      res.status(502).json({ error: String(error?.message || error || '四周趋势读取失败') });
    } finally {
      if (!deduplicated) jobs.delete(jobKey);
    }
  });

  router.post('/data/class-control/attendance', async (req, res) => {
    const session = requireLoggedInSession(req, res);
    if (!session) return;
    const classId = normalizeClassCode(req.body?.classId);
    if (!classId || !/^[A-Z][A-Z0-9-]{1,31}$/.test(classId)) {
      return res.status(400).json({ error: 'classId 必须是当前老师的班级代码' });
    }
    const jobKey = `${String(session.username || '').trim().toLowerCase()}:${classId}:attendance`;
    let job = jobs.get(jobKey);
    const deduplicated = Boolean(job);
    if (!job) {
      job = readLimiter.run(() => buildClassControlAttendance(session, classId));
      jobs.set(jobKey, job);
    }
    try {
      const result = await job;
      res.setHeader('Cache-Control', 'no-store');
      res.json({ status: 'success', deduplicated, result });
    } catch (error) {
      res.status(502).json({ error: String(error?.message || error || '考勤数据读取失败') });
    } finally {
      if (!deduplicated) jobs.delete(jobKey);
    }
  });

  router.post('/data/class-control/history', async (req, res) => {
    const session = requireLoggedInSession(req, res);
    if (!session) return;
    const classId = normalizeClassCode(req.body?.classId);
    if (!classId || !/^[A-Z][A-Z0-9-]{1,31}$/.test(classId)) {
      return res.status(400).json({ error: 'classId 必须是当前老师的班级代码' });
    }
    const request = {
      preferredSemester: String(req.body?.preferredSemester || '').trim(),
      phase: String(req.body?.phase || 'all').trim(),
      monthKind: String(req.body?.monthKind || 'whole_term').trim(),
      month: req.body?.month == null ? null : Number(req.body.month),
    };
    const jobKey = `${String(session.username || '').trim().toLowerCase()}:${classId}:history:${JSON.stringify(request)}`;
    let job = jobs.get(jobKey);
    const deduplicated = Boolean(job);
    if (!job) {
      job = readLimiter.run(() => buildHistoricalClassControl(session, classId, request));
      jobs.set(jobKey, job);
    }
    try {
      const result = await job;
      res.setHeader('Cache-Control', 'no-store');
      res.json({ status: 'success', deduplicated, result });
    } catch (error) {
      res.status(502).json({ error: String(error?.message || error || '历史班级表现读取失败') });
    } finally {
      if (!deduplicated) jobs.delete(jobKey);
    }
  });

  return router;
}

module.exports = {
  classControlCycleKey,
  createConcurrencyLimiter,
  createClassControlRoutes,
  fetchClassRoster,
};
