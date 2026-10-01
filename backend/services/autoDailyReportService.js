const {
  getAcademicWeekNumber,
  getPreviousAcademicWeekRange,
  getPreferredAcademicWindow,
  resolveAcademicTimezone,
  resolveWeek1Start,
} = require('../lib/academicCalendar');

function createAutoDailyReportService({
  defaultWeek1Start,
  formatDateOnly,
  academicTimezone,
}) {
  const week1Start = resolveWeek1Start(defaultWeek1Start);
  const timezone = resolveAcademicTimezone(academicTimezone);

  function getCurrentAcademicWeek(now = new Date()) {
    return getAcademicWeekNumber(now, { week1Start, timezone });
  }

  function getPreviousWeekDateRange(now = new Date()) {
    return getPreviousAcademicWeekRange(now, { week1Start, timezone });
  }

  function extractWeekKey(taskName = '') {
    const text = String(taskName || '').trim();
    const weekMatch = text.match(/Week\s*\d+/i);
    if (weekMatch?.[0]) return weekMatch[0].replace(/\s+/g, '');
    const chineseWeekMatch = text.match(/第\s*\d+\s*周/);
    if (chineseWeekMatch?.[0]) return chineseWeekMatch[0].replace(/\s+/g, '');
    return text;
  }

  function groupTasksByWeek(tasks = []) {
    const grouped = new Map();
    for (const task of tasks) {
      const name = String(task?.name || task || '').trim();
      const nestedTasks = Array.isArray(task?.tasks) ? task.tasks.map((item) => String(item || '').trim()).filter(Boolean) : [];
      if (!name && nestedTasks.length === 0) continue;
      const weekKey = extractWeekKey(name || nestedTasks[0] || '');
      const existing = grouped.get(weekKey) || { id: weekKey, name: weekKey, resourceCount: 0, tasks: [], sourceLabels: [] };
      const nextTasks = nestedTasks.length > 0 ? nestedTasks : [name];
      existing.tasks.push(...nextTasks);
      existing.tasks = [...new Set(existing.tasks.filter(Boolean))];
      existing.resourceCount = existing.tasks.length;
      const sourceLabel = String(task?.sourceLabel || name || '').trim();
      if (sourceLabel && !existing.sourceLabels.includes(sourceLabel)) {
        existing.sourceLabels.push(sourceLabel);
      }
      grouped.set(weekKey, existing);
    }
    return Array.from(grouped.values());
  }

  function extractWeekNumber(taskName = '') {
    const text = String(taskName || '').trim();
    const weekMatch = text.match(/Week\s*(\d+)/i);
    if (weekMatch?.[1]) return Number(weekMatch[1]);
    const chineseWeekMatch = text.match(/第\s*(\d+)\s*周/);
    if (chineseWeekMatch?.[1]) return Number(chineseWeekMatch[1]);
    return null;
  }

  function extractTaskAssignedAt(taskName = '') {
    const text = String(taskName || '').trim();
    const match = text.match(/任务时间[:：]\s*(20\d{2})[-./年](\d{1,2})[-./月](\d{1,2})(?:[日\sT]+(\d{1,2}):(\d{1,2}):(\d{1,2}))?/);
    if (!match) return null;

    const [, year, month, day, hour = '0', minute = '0', second = '0'] = match;
    const normalized = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`;
    const date = new Date(normalized);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function buildDefaultWeekSelection(groupedWeeks = [], now = new Date()) {
    const previousWeekRange = getPreviousWeekDateRange(now);
    const previousWeek = previousWeekRange.previousWeek;
    const previousStartMs = new Date(`${formatDateOnly(previousWeekRange.start)}T00:00:00`).getTime();
    const previousEndMs = new Date(`${formatDateOnly(previousWeekRange.end)}T23:59:59`).getTime();
    const withNumber = groupedWeeks.map((week) => {
      let assignedAt = extractTaskAssignedAt(week.name || week.id);
      if (!assignedAt && Array.isArray(week.sourceLabels)) {
        for (const label of week.sourceLabels) {
          assignedAt = extractTaskAssignedAt(label);
          if (assignedAt) break;
        }
      }
      return {
        ...week,
        weekNumber: extractWeekNumber(week.name || week.id),
        assignedAt,
      };
    });

    const withinPreviousWeek = withNumber
      .filter((week) => week.assignedAt && week.assignedAt.getTime() >= previousStartMs && week.assignedAt.getTime() <= previousEndMs)
      .sort((a, b) => a.assignedAt.getTime() - b.assignedAt.getTime());
    if (withinPreviousWeek.length > 0) {
      const targetTime = withinPreviousWeek[0].assignedAt.getTime();
      return withinPreviousWeek.filter((week) => week.assignedAt.getTime() === targetTime).map((week) => week.id);
    }

    const exact = withNumber.filter((week) => week.weekNumber === previousWeek);
    if (exact.length > 0) {
      return exact.map((week) => week.id);
    }

    const earlier = withNumber
      .filter((week) => Number.isFinite(week.weekNumber) && week.weekNumber < previousWeekRange.currentWeek)
      .sort((a, b) => Number(b.weekNumber) - Number(a.weekNumber));
    if (earlier.length > 0) {
      const topWeek = earlier[0].weekNumber;
      return earlier.filter((week) => week.weekNumber === topWeek).map((week) => week.id);
    }

    const historicalByDate = withNumber
      .filter((week) => week.assignedAt && week.assignedAt.getTime() <= previousEndMs)
      .sort((a, b) => b.assignedAt.getTime() - a.assignedAt.getTime());
    if (historicalByDate.length > 0) {
      return [historicalByDate[0].id];
    }

    return withNumber.slice(-1).map((week) => week.id);
  }

  function buildAutoDailyReportState({
    classId,
    taskInfo,
    preferredYear,
    preferredSemester,
  }) {
    const groupedWeeks = Array.isArray(taskInfo?.taskGroups) && taskInfo.taskGroups.length > 0
      ? groupTasksByWeek(taskInfo.taskGroups)
      : groupTasksByWeek(taskInfo?.tasks || []);

    return {
      classId: String(classId),
      preferredYear,
      preferredSemester: taskInfo?.preferredSemester || preferredSemester,
      weekGroups: groupedWeeks,
      weekMap: Object.fromEntries(groupedWeeks.map((week) => [week.id, week.tasks])),
    };
  }

  function buildWeekTasksPayload(state, now = new Date()) {
    const previousWeekRange = getPreviousWeekDateRange(now);
    return {
      status: 'success',
      termId: 0,
      defaultSelectedWeekIds: buildDefaultWeekSelection(state.weekGroups || [], now),
      defaultCheckinRange: {
        start: formatDateOnly(previousWeekRange.start),
        end: formatDateOnly(previousWeekRange.end),
      },
      weekTasks: (state.weekGroups || []).map((week) => ({
        id: week.id,
        name: week.name,
        resourceCount: week.resourceCount,
        addedAt: (() => {
          if (Array.isArray(week.sourceLabels)) {
            for (const label of week.sourceLabels) {
              const assignedAt = extractTaskAssignedAt(label);
              if (assignedAt) return formatDateOnly(assignedAt);
            }
          }
          return '';
        })(),
      })),
    };
  }

  function normalizeSelectedWeekIds(selectedWeekIds = []) {
    if (!Array.isArray(selectedWeekIds)) return [];
    return [...new Set(selectedWeekIds.map((item) => String(item || '')).filter(Boolean))];
  }

  function resolveEffectiveWeekIds(state, selectedWeekIds = [], now = new Date()) {
    const normalized = normalizeSelectedWeekIds(selectedWeekIds);
    if (normalized.length > 0) {
      return normalized;
    }
    return buildDefaultWeekSelection(state.weekGroups || [], now);
  }

  function buildPublicitySelection(state, selectedWeekIds = []) {
    const normalizedWeekIds = normalizeSelectedWeekIds(selectedWeekIds);
    return {
      selectedWeekIds: normalizedWeekIds,
      selectedTasks: [...new Set(
        normalizedWeekIds.flatMap((weekId) => state.weekMap[String(weekId)] || [])
      )],
      preferredYear: state.preferredYear,
      preferredSemester: state.preferredSemester,
    };
  }

  return {
    getPreferredAcademicWindow,
    getPreviousWeekDateRange,
    groupTasksByWeek,
    buildDefaultWeekSelection,
    buildAutoDailyReportState,
    buildWeekTasksPayload,
    resolveEffectiveWeekIds,
    buildPublicitySelection,
  };
}

module.exports = {
  createAutoDailyReportService,
  getPreferredAcademicWindow,
};
