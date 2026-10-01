const { normalizeEnglishName, englishNameOrPlaceholder } = require('./studentNames');
const {
  formatDateKeyInTimezone,
  getAcademicWeekNumber,
  getAcademicWeekRange,
} = require('./academicCalendar');
const {
  getMondayDateKey,
  mergeTaskSelections,
  parseOfficialDateTime,
} = require('./taskCatalog');

const DAY_MS = 24 * 60 * 60 * 1000;
const ENGLISH_NAME_COLLATOR = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

function normalizeClassCode(value) {
  return String(value || '').trim().toUpperCase();
}

function sortEnglishNames(names = []) {
  return [...new Set((Array.isArray(names) ? names : []).map((name) => String(name || '').trim()).filter(Boolean))]
    .sort((left, right) => ENGLISH_NAME_COLLATOR.compare(left, right));
}

function formatRangeDate(date) {
  return new Date(date).toISOString().slice(0, 10);
}

function isCoreActivityTask(task = {}) {
  const skuId = String(task?.skuId || '').trim();
  const collectionName = String(task?.collectionName || '').trim();
  return skuId === '5' || collectionName.includes('活动计划');
}

function hasPreparedSelection(taskSnapshot = {}, taskId = '') {
  return Array.isArray(taskSnapshot?.weekSelectionMap?.[String(taskId)]?.taskIds)
    && taskSnapshot.weekSelectionMap[String(taskId)].taskIds.length > 0;
}

function selectCoreActivityTasks(taskSnapshot = {}) {
  const selectable = (Array.isArray(taskSnapshot?.weekTasks) ? taskSnapshot.weekTasks : [])
    .filter((task) => task?.id && task?.startAt && hasPreparedSelection(taskSnapshot, task.id));
  const classified = selectable.filter(isCoreActivityTask);
  if (classified.length > 0) return classified;

  // Browser fallback and old snapshots did not carry SKU metadata. Keep them
  // usable, but only when no positively identified activity-plan task exists.
  return selectable.filter((task) => !task?.skuId && !task?.collectionName);
}

function taskStartDateKey(task = {}, timezone = 'Asia/Shanghai') {
  const start = parseOfficialDateTime(task?.startAt);
  return start ? formatDateKeyInTimezone(start, timezone) : '';
}

function taskMondayKey(task = {}, timezone = 'Asia/Shanghai') {
  return getMondayDateKey(taskStartDateKey(task, timezone));
}

function cycleFromTasks({ role, weekNumber = null, tasks, rangeStart, rangeEnd, now, timezone, historical = false }) {
  if (!Array.isArray(tasks) || tasks.length === 0) return null;
  const starts = tasks.map((task) => parseOfficialDateTime(task.startAt)).filter(Boolean);
  const earliestStart = starts.length > 0 ? new Date(Math.min(...starts.map((date) => date.getTime()))) : null;
  const openedHours = earliestStart
    ? Math.max(0, Math.floor((new Date(now).getTime() - earliestStart.getTime()) / (60 * 60 * 1000)))
    : 0;
  const detectedWeeks = [...new Set(tasks.map((task) => Number(task?.weekNumber)).filter(Number.isFinite))];
  const labelNumber = Number.isFinite(weekNumber) ? weekNumber : detectedWeeks.length === 1 ? detectedWeeks[0] : null;
  const fallbackName = String(tasks[0]?.name || '').trim();

  return {
    role,
    weekNumber: labelNumber,
    weekLabel: labelNumber ? `W${labelNumber}` : fallbackName || (role === 'review' ? '上周' : '本周'),
    weekIds: tasks.map((task) => String(task.id)),
    rangeStart,
    rangeEnd,
    openedAt: earliestStart?.toISOString() || '',
    openedHours,
    historical,
  };
}

function buildClassControlCyclePlan(taskSnapshot = {}, {
  now = new Date(),
  currentTermName = '',
  week1Start,
  timezone = 'Asia/Shanghai',
} = {}) {
  const tasks = selectCoreActivityTasks(taskSnapshot);
  const historical = Boolean(
    taskSnapshot?.preferredSemester
    && currentTermName
    && String(taskSnapshot.preferredSemester) !== String(currentTermName)
  );

  if (tasks.length === 0) {
    return { review: null, current: null, trend: [], historical };
  }

  if (historical) {
    const nowMs = new Date(now).getTime();
    const groups = new Map();
    for (const task of tasks) {
      const monday = taskMondayKey(task, timezone);
      const start = parseOfficialDateTime(task.startAt);
      if (!monday || !start || start.getTime() > nowMs) continue;
      if (!groups.has(monday)) groups.set(monday, []);
      groups.get(monday).push(task);
    }
    const orderedMondays = [...groups.keys()].sort();
    const latestMonday = orderedMondays.at(-1) || '';
    const previousMonday = orderedMondays.at(-2) || '';
    if (!latestMonday) return { review: null, current: null, trend: [], historical };
    const buildHistoricalCycle = (role, monday) => {
      if (!monday) return null;
      return cycleFromTasks({
        role,
        tasks: groups.get(monday),
        rangeStart: monday,
        rangeEnd: formatRangeDate(new Date(`${monday}T12:00:00Z`).getTime() + 6 * DAY_MS),
        now,
        timezone,
        historical: true,
      });
    };
    return {
      review: buildHistoricalCycle('review', latestMonday),
      current: buildHistoricalCycle('current', previousMonday),
      trend: orderedMondays.slice(-4).map((monday) => buildHistoricalCycle('trend', monday)).filter(Boolean),
      historical,
    };
  }

  const currentWeek = getAcademicWeekNumber(now, { week1Start, timezone });
  const currentRange = getAcademicWeekRange(currentWeek, { week1Start, timezone });
  const currentStart = formatRangeDate(currentRange.start);
  const currentEnd = formatRangeDate(currentRange.end);
  const nowMs = new Date(now).getTime();
  const currentTasks = tasks.filter((task) => {
    const start = parseOfficialDateTime(task.startAt);
    const dateKey = taskStartDateKey(task, timezone);
    return start && start.getTime() <= nowMs && dateKey >= currentStart && dateKey <= currentEnd;
  });

  let review = null;
  if (currentWeek > 1) {
    const reviewRange = getAcademicWeekRange(currentWeek - 1, { week1Start, timezone });
    const reviewStart = formatRangeDate(reviewRange.start);
    const reviewEnd = formatRangeDate(reviewRange.end);
    const reviewTasks = tasks.filter((task) => {
      const dateKey = taskStartDateKey(task, timezone);
      return dateKey >= reviewStart && dateKey <= reviewEnd;
    });
    review = cycleFromTasks({
      role: 'review',
      weekNumber: currentWeek - 1,
      tasks: reviewTasks,
      rangeStart: reviewStart,
      rangeEnd: reviewEnd,
      now,
      timezone,
    });
  }

  const trend = [];
  for (let weekNumber = Math.max(1, currentWeek - 4); weekNumber < currentWeek; weekNumber += 1) {
    const range = getAcademicWeekRange(weekNumber, { week1Start, timezone });
    const rangeStart = formatRangeDate(range.start);
    const rangeEnd = formatRangeDate(range.end);
    const weekTasks = tasks.filter((task) => {
      const dateKey = taskStartDateKey(task, timezone);
      return dateKey >= rangeStart && dateKey <= rangeEnd;
    });
    const cycle = cycleFromTasks({
      role: 'trend',
      weekNumber,
      tasks: weekTasks,
      rangeStart,
      rangeEnd,
      now,
      timezone,
    });
    if (cycle) trend.push(cycle);
  }

  return {
    review,
    current: cycleFromTasks({
      role: 'current',
      weekNumber: currentWeek,
      tasks: currentTasks,
      rangeStart: currentStart,
      rangeEnd: formatDateKeyInTimezone(now, timezone),
      now,
      timezone,
    }),
    trend,
    historical,
  };
}

function historicalTaskLabel(task = {}) {
  return [
    task?.name,
    ...(Array.isArray(task?.sourceLabels) ? task.sourceLabels : []),
    task?.collectionName,
    ...(Array.isArray(task?.tasks) ? task.tasks : []),
  ].map((value) => String(value || '').trim()).filter(Boolean).join(' ');
}

function matchesHistoricalPhase(task = {}, phase = 'regular') {
  const label = historicalTaskLabel(task);
  const special = /(寒假|寒训|暑假|暑期|春季[^ ]*(?:集训|训练营|集训课)|秋季[^ ]*(?:集训|训练营|集训课)|winter|summer|intensive)/i;
  if (phase === 'all') return true;
  if (phase === 'regular') return !special.test(label);
  if (phase === 'winter_camp') return /(寒假|寒训|winter)/i.test(label);
  if (phase === 'summer_camp') return /(暑假|暑期|summer)/i.test(label);
  if (phase === 'spring_intensive') {
    return /(春季|春训|spring)/i.test(label) && /(集训|训练营|集训课|intensive)/i.test(label);
  }
  if (phase === 'autumn_intensive') {
    return /(秋季|秋训|autumn|fall)/i.test(label) && /(集训|训练营|集训课|intensive)/i.test(label);
  }
  return false;
}

function buildHistoricalCyclePlan(tasks = [], {
  phase = 'regular',
  monthKind = 'whole_term',
  month = null,
  maxCycles = 8,
  now = new Date(),
} = {}) {
  const supportedPhases = new Set(['all', 'regular', 'winter_camp', 'summer_camp', 'spring_intensive', 'autumn_intensive']);
  if (!supportedPhases.has(String(phase))) {
    return { status: 'invalid', cycles: [], message: '历史阶段参数无效。' };
  }
  const supportedMonthKinds = new Set(['whole_term', 'calendar_month', 'last_active_month']);
  if (!supportedMonthKinds.has(String(monthKind))) {
    return { status: 'invalid', cycles: [], message: '历史月份参数无效。' };
  }

  const candidates = (Array.isArray(tasks) ? tasks : []).map((task) => {
    const start = parseOfficialDateTime(task?.startAt);
    const dateKey = start ? taskStartDateKey(task) : '';
    const taskMonth = dateKey ? Number(dateKey.slice(5, 7)) : null;
    return { task, start, dateKey, taskMonth };
  }).filter((entry) => entry.start && entry.dateKey && matchesHistoricalPhase(entry.task, phase));

  if (phase !== 'regular' && candidates.length === 0) {
    return { status: 'not_found', cycles: [], message: '真实任务标签中没有找到对应特殊阶段，不能按日期猜测。' };
  }

  let resolvedMonth = monthKind === 'calendar_month' ? Number(month) : null;
  if (monthKind === 'calendar_month' && (!Number.isInteger(resolvedMonth) || resolvedMonth < 1 || resolvedMonth > 12)) {
    return { status: 'invalid', cycles: [], message: '历史月份必须是 1 到 12。' };
  }
  if (monthKind === 'last_active_month') {
    resolvedMonth = candidates.map((entry) => entry.taskMonth).filter(Number.isInteger).sort((a, b) => a - b).at(-1) || null;
  }
  const selected = resolvedMonth
    ? candidates.filter((entry) => entry.taskMonth === resolvedMonth)
    : candidates;
  if (selected.length === 0) {
    return { status: 'not_found', cycles: [], resolvedMonth, message: '指定范围内没有真实 startAt 任务。' };
  }

  const groups = new Map();
  for (const entry of selected) {
    const monday = taskMondayKey(entry.task);
    if (!monday) continue;
    if (!groups.has(monday)) groups.set(monday, []);
    groups.get(monday).push(entry.task);
  }
  const cycles = [...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([monday, groupedTasks]) => (
    cycleFromTasks({
      role: 'history',
      tasks: groupedTasks,
      rangeStart: monday,
      rangeEnd: formatRangeDate(new Date(`${monday}T12:00:00Z`).getTime() + 6 * DAY_MS),
      now,
      timezone: 'Asia/Shanghai',
      historical: true,
    })
  )).filter(Boolean);

  if (cycles.length > Math.max(1, Number(maxCycles) || 8)) {
    return {
      status: 'too_broad', cycles: [], resolvedMonth,
      message: `这个范围包含 ${cycles.length} 个真实任务周期。请缩小到一个月份后再查询。`,
    };
  }
  return { status: 'ready', cycles, resolvedMonth, taskCount: selected.length };
}

function buildPreparedCycleSelection(taskSnapshot = {}, cycle = null) {
  if (!cycle?.weekIds?.length) return null;
  const weekIds = cycle.weekIds.map(String);
  const selectedTasks = [...new Set(weekIds.flatMap((weekId) => taskSnapshot?.weekMap?.[weekId] || []))];
  const selectedWeekLabels = [...new Set(weekIds.flatMap((weekId) => taskSnapshot?.weekSourceLabels?.[weekId] || []))];
  return {
    selectedTasks,
    selectedWeekIds: weekIds,
    selectedWeekLabels,
    preparedSelection: mergeTaskSelections(weekIds.map((weekId) => taskSnapshot?.weekSelectionMap?.[weekId] || {})),
    preferredYear: taskSnapshot?.preferredYear || '',
    preferredSemester: taskSnapshot?.preferredSemester || '',
  };
}

function parseCompletedValue(value) {
  const text = String(value || '').trim();
  if (['已完成', '完成', '是', '1', '√'].includes(text)) return true;
  if (['进行中', '未完成', '否', '0', '×'].includes(text)) return false;
  return null;
}

function normalizeRoster(roster = []) {
  return (Array.isArray(roster) ? roster : []).map((student, index) => ({
    no: String(student?.no || student?.student_no || '').trim(),
    chName: String(student?.chName || student?.ch_name || '').trim(),
    enName: englishNameOrPlaceholder(
      student?.enName || student?.en_name,
      student?.no || student?.student_no,
      index,
      student?.chName || student?.ch_name,
    ),
  }));
}

function isOptionalTaskTitle(value) {
  return /(?:【|\[|\()\s*选做\s*(?:】|\]|\))|\boptional\b/i.test(String(value || ''));
}

function parseQualityValue(value, subHeader = '') {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const numeric = Number.parseFloat(text.replace(/%/g, ''));
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  const totalMatch = String(subHeader || '').match(/分数\s*[（(]\s*(\d+(?:\.\d+)?)\s*[）)]/);
  const total = totalMatch ? Number.parseFloat(totalMatch[1]) : null;
  let percentage = total && total > 0 ? (numeric / total) * 100 : numeric;
  if (!total && /正确率|平均分/.test(String(subHeader || '')) && percentage > 0 && percentage <= 1) {
    percentage *= 100;
  }
  if (!Number.isFinite(percentage)) return null;
  return Math.max(0, Math.min(100, percentage));
}

function roundOne(value) {
  return Math.round(Number(value || 0) * 10) / 10;
}

function buildDistribution(values = [], noData = 0) {
  const normalized = (Array.isArray(values) ? values : []).filter(Number.isFinite);
  return {
    excellent: normalized.filter((value) => value >= 90).length,
    good: normalized.filter((value) => value >= 80 && value < 90).length,
    watch: normalized.filter((value) => value >= 60 && value < 80).length,
    critical: normalized.filter((value) => value < 60).length,
    noData: Math.max(0, Number(noData) || 0),
    total: normalized.length + Math.max(0, Number(noData) || 0),
  };
}

function emptyTaskSummary(roster = []) {
  return {
    available: false,
    completionRate: null,
    fullyCompletedCount: 0,
    totalStudents: normalizeRoster(roster).length,
    requiredTaskCount: 0,
    optionalTaskCount: 0,
    incompleteStudents: [],
    averageAccuracy: null,
    accuracyStudentCount: 0,
    completionDistribution: buildDistribution([]),
    accuracyDistribution: buildDistribution([]),
    taskBreakdown: [],
    studentProfiles: [],
  };
}

function summarizeTaskTableRows(tableRows = [], roster = []) {
  if (!Array.isArray(tableRows) || tableRows.length < 4) {
    return emptyTaskSummary(roster);
  }
  const titleRow = tableRows[1] || [];
  const subHeaderRow = tableRows[2] || [];
  const taskGroups = [];
  let activeTitle = '';
  let activeGroup = null;
  for (let index = 4; index < Math.max(titleRow.length, subHeaderRow.length); index += 1) {
    const explicitTitle = String(titleRow[index] || '').trim();
    if (explicitTitle) activeTitle = explicitTitle;
    const title = activeTitle || `任务 ${taskGroups.length + 1}`;
    if (!activeGroup || activeGroup.title !== title) {
      activeGroup = {
        id: `${index}:${title}`,
        title,
        optional: isOptionalTaskTitle(title),
        completionColumn: null,
        qualityColumns: [],
      };
      taskGroups.push(activeGroup);
    }
    const subHeader = String(subHeaderRow[index] || '').trim();
    if (subHeader.includes('是否完成')) activeGroup.completionColumn = index;
    if (/正确率|平均分|分数\s*[（(]/.test(subHeader)) {
      activeGroup.qualityColumns.push({ index, subHeader });
    }
  }
  const requiredGroups = taskGroups.filter((group) => !group.optional && Number.isInteger(group.completionColumn));
  const optionalTaskCount = taskGroups.filter((group) => group.optional && Number.isInteger(group.completionColumn)).length;

  const normalizedRoster = normalizeRoster(roster);
  const rosterByNo = new Map(normalizedRoster.map((student) => [student.no, student]));
  const rosterByChinese = new Map(normalizedRoster.map((student) => [student.chName, student]));
  const students = [];
  const seen = new Set();
  for (let index = 3; index < tableRows.length; index += 1) {
    const row = tableRows[index] || [];
    const no = String(row[1] || '').trim();
    const chinese = String(row[2] || '').trim();
    if (!no && !chinese && !row[3]) continue;
    const rosterStudent = rosterByNo.get(no) || rosterByChinese.get(chinese);
    const name = englishNameOrPlaceholder(normalizeEnglishName(row[3]) || rosterStudent?.enName, no, students.length, chinese);
    const taskStates = requiredGroups.map((group) => ({
      group,
      completed: parseCompletedValue(row[group.completionColumn]),
      qualities: group.qualityColumns
        .map(({ index: column, subHeader }) => parseQualityValue(row[column], subHeader))
        .filter(Number.isFinite),
    }));
    const values = taskStates.map((state) => state.completed);
    const tracked = values.filter((value) => value !== null).length;
    const completed = values.filter((value) => value === true).length;
    const qualityValues = taskStates
      .filter((state) => state.qualities.length > 0)
      .map((state) => state.qualities.reduce((sum, value) => sum + value, 0) / state.qualities.length);
    students.push({ no, chinese, name, tracked, completed, taskStates, qualityValues });
    seen.add(no || chinese);
  }

  for (const student of normalizedRoster) {
    if (seen.has(student.no || student.chName)) continue;
    students.push({
      no: student.no,
      chinese: student.chName,
      name: student.enName,
      tracked: requiredGroups.length,
      completed: 0,
      taskStates: requiredGroups.map((group) => ({ group, completed: false, qualities: [] })),
      qualityValues: [],
    });
  }

  const totalTracked = students.reduce((sum, student) => sum + student.tracked, 0);
  const totalCompleted = students.reduce((sum, student) => sum + student.completed, 0);
  const fullyCompleted = students.filter((student) => student.tracked > 0 && student.completed === student.tracked);
  const incomplete = students.filter((student) => student.tracked === 0 || student.completed < student.tracked);
  const completionPercentages = students.map((student) => (
    student.tracked > 0 ? (student.completed / student.tracked) * 100 : 0
  ));
  const studentAccuracyValues = students
    .filter((student) => student.qualityValues.length > 0)
    .map((student) => student.qualityValues.reduce((sum, value) => sum + value, 0) / student.qualityValues.length);
  const taskBreakdown = requiredGroups.map((group) => {
    const states = students.map((student) => (
      student.taskStates.find((state) => state.group.id === group.id)
      || { completed: false, qualities: [] }
    ));
    const completedCount = states.filter((state) => state.completed === true).length;
    const accuracyValues = states
      .filter((state) => state.qualities.length > 0)
      .map((state) => state.qualities.reduce((sum, value) => sum + value, 0) / state.qualities.length);
    return {
      id: group.id,
      title: group.title,
      completionRate: students.length > 0 ? Math.round((completedCount / students.length) * 100) : null,
      completedCount,
      totalStudents: students.length,
      incompleteStudents: sortEnglishNames(students
        .filter((student, index) => states[index].completed !== true)
        .map((student) => student.name)),
      averageAccuracy: accuracyValues.length > 0
        ? roundOne(accuracyValues.reduce((sum, value) => sum + value, 0) / accuracyValues.length)
        : null,
      accuracyStudentCount: accuracyValues.length,
    };
  });
  const studentProfiles = students.map((student) => {
    const incompleteTasks = student.taskStates
      .filter((state) => state.completed !== true)
      .map((state) => state.group.title);
    return {
      name: student.name,
      completionRate: student.tracked > 0 ? roundOne((student.completed / student.tracked) * 100) : null,
      completedTaskCount: student.completed,
      requiredTaskCount: student.tracked,
      incompleteTaskCount: incompleteTasks.length,
      incompleteTasks,
      averageAccuracy: student.qualityValues.length > 0
        ? roundOne(student.qualityValues.reduce((sum, value) => sum + value, 0) / student.qualityValues.length)
        : null,
      accuracyTaskCount: student.qualityValues.length,
    };
  }).sort((left, right) => ENGLISH_NAME_COLLATOR.compare(left.name, right.name));

  return {
    available: requiredGroups.length > 0 && students.length > 0,
    completionRate: totalTracked > 0 ? Math.round((totalCompleted / totalTracked) * 100) : null,
    fullyCompletedCount: fullyCompleted.length,
    totalStudents: students.length,
    requiredTaskCount: requiredGroups.length,
    optionalTaskCount,
    incompleteStudents: sortEnglishNames(incomplete.map((student) => student.name)),
    averageAccuracy: studentAccuracyValues.length > 0
      ? roundOne(studentAccuracyValues.reduce((sum, value) => sum + value, 0) / studentAccuracyValues.length)
      : null,
    accuracyStudentCount: studentAccuracyValues.length,
    completionDistribution: buildDistribution(completionPercentages),
    accuracyDistribution: buildDistribution(studentAccuracyValues, students.length - studentAccuracyValues.length),
    taskBreakdown,
    studentProfiles,
  };
}

function summarizeSpeakingRows(rows = [], roster = []) {
  const normalizedRoster = normalizeRoster(roster);
  const dataRows = Array.isArray(rows) ? rows : [];
  const byNo = new Map(dataRows.map((row) => [String(row?.no || row?.student_no || '').trim(), row]));
  const byChinese = new Map(dataRows.map((row) => [String(row?.ch_name || row?.中文名 || '').trim(), row]));
  const sourceStudents = normalizedRoster.length > 0
    ? normalizedRoster
    : dataRows.map((row, index) => ({
      no: String(row?.no || row?.student_no || '').trim(),
      chName: String(row?.ch_name || row?.中文名 || '').trim(),
      enName: englishNameOrPlaceholder(row?.en_name, row?.no || row?.student_no, index, row?.ch_name || row?.中文名),
    }));
  const students = sourceStudents.map((student, index) => {
    const row = byNo.get(student.no) || byChinese.get(student.chName) || {};
    return {
      name: normalizeEnglishName(student.enName)
        || englishNameOrPlaceholder(row?.en_name || row?.enName, student.no, index, student.chName),
      days: Math.max(0, Number.parseInt(row?.all_check_days, 10) || 0),
      supplement: Math.max(0, Number.parseInt(row?.supplement_times, 10) || 0),
    };
  });
  const totalDays = students.reduce((sum, student) => sum + student.days, 0);
  return {
    available: students.length > 0 && dataRows.length > 0,
    averageDays: students.length > 0 ? Math.round((totalDays / students.length) * 10) / 10 : null,
    zeroStudents: sortEnglishNames(students.filter((student) => student.days === 0).map((student) => student.name)),
    supplementCount: students.reduce((sum, student) => sum + student.supplement, 0),
    totalStudents: students.length,
    studentProfiles: students
      .map((student) => ({ name: student.name, days: student.days, supplementCount: student.supplement }))
      .sort((left, right) => ENGLISH_NAME_COLLATOR.compare(left.name, right.name)),
  };
}

function summarizeAttendanceRows(rows = [], roster = []) {
  const normalizedRoster = normalizeRoster(roster);
  const rosterByChinese = new Map(normalizedRoster.map((student) => [student.chName, student]));
  const rosterByEnglish = new Map(normalizedRoster.map((student) => [student.enName.toLowerCase(), student]));
  const profiles = (Array.isArray(rows) ? rows : []).map((row, index) => {
    const sourceName = String(row?.name || row?.studentName || '').trim();
    const rosterStudent = rosterByChinese.get(sourceName) || rosterByEnglish.get(sourceName.toLowerCase());
    const rateValue = Number(row?.attendanceRate);
    const normalizedRate = Number.isFinite(rateValue)
      ? roundOne(Math.max(0, Math.min(100, rateValue <= 1 ? rateValue * 100 : rateValue)))
      : null;
    return {
      name: rosterStudent?.enName || englishNameOrPlaceholder(sourceName, row?.no || row?.student_no, index, sourceName),
      absenceCount: Math.max(0, Number.parseInt(row?.absenceCount, 10) || 0),
      lateCount: Math.max(0, Number.parseInt(row?.lateCount, 10) || 0),
      attendanceRate: normalizedRate,
    };
  }).sort((left, right) => ENGLISH_NAME_COLLATOR.compare(left.name, right.name));
  return {
    available: profiles.length > 0,
    studentProfiles: profiles,
  };
}

function getCombinedCheckinWindow(cycles = []) {
  const valid = (Array.isArray(cycles) ? cycles : []).filter((cycle) => cycle?.rangeStart && cycle?.rangeEnd);
  if (valid.length === 0) return null;
  return {
    start: valid.map((cycle) => cycle.rangeStart).sort()[0],
    end: valid.map((cycle) => cycle.rangeEnd).sort().at(-1),
  };
}

module.exports = {
  buildClassControlCyclePlan,
  buildHistoricalCyclePlan,
  buildPreparedCycleSelection,
  englishNameOrPlaceholder,
  getCombinedCheckinWindow,
  isCoreActivityTask,
  isOptionalTaskTitle,
  normalizeClassCode,
  selectCoreActivityTasks,
  sortEnglishNames,
  summarizeAttendanceRows,
  summarizeSpeakingRows,
  summarizeTaskTableRows,
};
