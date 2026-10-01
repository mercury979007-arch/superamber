const crypto = require('node:crypto');

function taskSelectionFingerprint(taskSnapshot, selectedWeekIds) {
  const normalizedWeekIds = [...new Set((selectedWeekIds || []).map(String))].sort();
  const isComplete = normalizedWeekIds.every((weekId) => (
    Array.isArray(taskSnapshot?.weekSelectionMap?.[weekId]?.taskIds)
    && taskSnapshot.weekSelectionMap[weekId].taskIds.length > 0
  ));
  const taskIds = normalizedWeekIds.flatMap((weekId) => (
    Array.isArray(taskSnapshot?.weekSelectionMap?.[weekId]?.taskIds)
      ? taskSnapshot.weekSelectionMap[weekId].taskIds.map(String)
      : []
  ));
  // Version the conversion as well as the selection: old partial tables must refresh.
  const ids = isComplete ? [...new Set(taskIds)].sort().join(',') : normalizedWeekIds.join(',');
  return `resource-columns-v2:${isComplete ? 'resources' : 'groups'}:${ids}`;
}

function buildCompleteTaskCatalog(taskInfo = {}, groupTasksByWeek) {
  if (typeof groupTasksByWeek !== 'function') {
    throw new TypeError('groupTasksByWeek is required');
  }
  const taskGroups = Array.isArray(taskInfo.taskGroups) ? taskInfo.taskGroups : [];
  if (taskGroups.length === 0) {
    return groupTasksByWeek(taskInfo.tasks || []);
  }
  // Preserve the legacy grouping callback contract for callers/tests that use
  // it for lightweight catalog observation. The richer catalog below remains
  // authoritative and intentionally keeps same-label official tasks separate.
  groupTasksByWeek(taskGroups);

  const groupedBySource = new Map();
  for (const group of taskGroups) {
    const name = String(group?.name || group?.id || '未命名任务').trim();
    const sourceLabel = String(group?.sourceLabel || group?.name || group?.id || '').trim();
    const officialTaskId = String(group?.officialTaskId || '').trim();
    const identity = officialTaskId ? `official:${officialTaskId}` : `${name}\u0000${sourceLabel}`;
    if (!groupedBySource.has(identity)) {
      const dateKey = extractAssignedDateKey(sourceLabel);
      const suffix = crypto.createHash('sha1').update(identity).digest('hex').slice(0, 10);
      groupedBySource.set(identity, {
        id: officialTaskId ? `task-${officialTaskId}` : `${name}@${dateKey || 'undated'}-${suffix}`,
        name,
        officialTaskId,
        addAt: String(group?.addAt || '').trim(),
        startAt: String(group?.startAt || '').trim(),
        endAt: String(group?.endAt || '').trim(),
        skuId: String(group?.skuId || '').trim(),
        collectionName: String(group?.collectionName || '').trim(),
        declaredTerm: String(group?.declaredTerm || '').trim(),
        status: group?.status ?? null,
        statusText: String(group?.statusText || '').trim(),
        weekNumber: group?.weekNumber !== null
          && group?.weekNumber !== undefined
          && group?.weekNumber !== ''
          && Number.isFinite(Number(group.weekNumber))
          ? Number(group.weekNumber)
          : null,
        studentVisible: Boolean(group?.studentVisible),
        declaredResourceCount: Number(group?.resourceCount) || 0,
        tasks: [],
        sourceLabels: sourceLabel ? [sourceLabel] : [],
        taskSelection: normalizeTaskSelection(group?.taskSelection),
      });
    }
    const entry = groupedBySource.get(identity);
    for (const task of Array.isArray(group?.tasks) ? group.tasks : []) {
      const normalized = String(task || '').trim();
      if (normalized && !entry.tasks.includes(normalized)) entry.tasks.push(normalized);
    }
    entry.taskSelection = mergeTaskSelections([entry.taskSelection, group?.taskSelection]);
    if (!entry.addAt && group?.addAt) entry.addAt = String(group.addAt).trim();
    if (!entry.startAt && group?.startAt) entry.startAt = String(group.startAt).trim();
    if (!entry.endAt && group?.endAt) entry.endAt = String(group.endAt).trim();
    if (!entry.skuId && group?.skuId) entry.skuId = String(group.skuId).trim();
    if (!entry.collectionName && group?.collectionName) entry.collectionName = String(group.collectionName).trim();
    if (!entry.declaredTerm && group?.declaredTerm) entry.declaredTerm = String(group.declaredTerm).trim();
    if (!entry.statusText && group?.statusText) entry.statusText = String(group.statusText).trim();
    if (entry.status == null && group?.status != null) entry.status = group.status;
    entry.studentVisible = entry.studentVisible || Boolean(group?.studentVisible);
    entry.declaredResourceCount = Math.max(entry.declaredResourceCount, Number(group?.resourceCount) || 0);
  }

  return [...groupedBySource.values()].map((entry) => ({
    ...entry,
    resourceCount: Math.max(entry.taskSelection.taskIds.length, entry.tasks.length, entry.declaredResourceCount),
  }));
}

function normalizeTaskSelection(selection = {}) {
  const value = selection && typeof selection === 'object' ? selection : {};
  return {
    taskIds: [...new Set((Array.isArray(value.taskIds) ? value.taskIds : []).map((item) => String(item || '')).filter(Boolean))],
    idToName: Object.fromEntries(Object.entries(value.idToName || {}).map(([key, name]) => [String(key), String(name || '')])),
    orderedTaskKeys: [...new Set((Array.isArray(value.orderedTaskKeys) ? value.orderedTaskKeys : []).map((item) => String(item || '')).filter(Boolean))],
    taskMetaByKey: JSON.parse(JSON.stringify(value.taskMetaByKey || {})),
  };
}

function mergeTaskSelections(selections = []) {
  const merged = normalizeTaskSelection();
  let nextGroupOrder = 0;
  for (const raw of Array.isArray(selections) ? selections : []) {
    const selection = normalizeTaskSelection(raw);
    for (const taskId of selection.taskIds) {
      if (!merged.taskIds.includes(taskId)) merged.taskIds.push(taskId);
    }
    Object.assign(merged.idToName, selection.idToName);
    for (const taskKey of selection.orderedTaskKeys) {
      if (!merged.orderedTaskKeys.includes(taskKey)) merged.orderedTaskKeys.push(taskKey);
    }
    const groupOrders = new Map();
    for (const key of selection.orderedTaskKeys) {
      const meta = selection.taskMetaByKey[key];
      if (!meta || merged.taskMetaByKey[key]) continue;
      const group = meta.groupOrder ?? 0;
      if (!groupOrders.has(group)) groupOrders.set(group, nextGroupOrder++);
      merged.taskMetaByKey[key] = { ...meta, groupOrder: groupOrders.get(group), sourceOrder: merged.orderedTaskKeys.indexOf(key) };
    }
  }
  return merged;
}

const DATE_PATTERN = /任务时间[:：]\s*(20\d{2})[-./年](\d{1,2})[-./月](\d{1,2})/;

function extractAssignedDateKey(value = '') {
  const match = String(value || '').match(DATE_PATTERN);
  if (!match) return '';
  return `${match[1]}-${String(match[2]).padStart(2, '0')}-${String(match[3]).padStart(2, '0')}`;
}

function getMondayDateKey(dateKey = '') {
  const match = String(dateKey || '').match(/^(20\d{2})-(\d{2})-(\d{2})$/);
  if (!match) return '';
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (Number.isNaN(date.getTime())) return '';
  const offset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - offset);
  return date.toISOString().slice(0, 10);
}

function extractWeekNumber(value = '') {
  const text = String(value || '');
  const week = text.match(/Week\s*(\d+)/i) || text.match(/第\s*(\d+)\s*周/);
  return week?.[1] ? Number(week[1]) : null;
}

function parseOfficialDateTime(value = '') {
  const text = String(value || '').trim();
  if (!text) return null;
  const normalized = text.includes('T') ? text : text.replace(' ', 'T');
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized);
  const parsed = new Date(hasZone ? normalized : `${normalized}+08:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function taskLifecycle(task = {}, now = new Date()) {
  const nowMs = new Date(now).getTime();
  const start = parseOfficialDateTime(task?.startAt);
  const end = parseOfficialDateTime(task?.endAt);
  if (!Number.isFinite(nowMs) || !start || !end) return 'unknown';
  if (nowMs < start.getTime()) return 'upcoming';
  if (nowMs < end.getTime()) return 'active';
  return 'ended';
}

function selectCurrentTaskCycle(groupedWeeks = [], now = new Date(), { historical = false } = {}) {
  const entries = (Array.isArray(groupedWeeks) ? groupedWeeks : [])
    .map((week) => ({
      week,
      start: parseOfficialDateTime(week?.startAt),
      end: parseOfficialDateTime(week?.endAt),
    }))
    .filter((entry) => entry.week?.id && entry.start && entry.end);
  if (entries.length === 0) {
    return { ids: [], reason: 'missing-cycle-metadata' };
  }

  if (historical) {
    const nowMs = new Date(now).getTime();
    const completed = entries.filter((entry) => entry.end.getTime() <= nowMs);
    const candidates = completed.length > 0 ? completed : entries;
    const latestStart = Math.max(...candidates.map((entry) => entry.start.getTime()));
    return {
      ids: candidates.filter((entry) => entry.start.getTime() === latestStart).map((entry) => String(entry.week.id)),
      reason: completed.length > 0 ? 'historical-latest-completed-cycle' : 'historical-latest-cycle',
    };
  }

  const nowMs = new Date(now).getTime();
  const active = entries.filter((entry) => entry.start.getTime() <= nowMs && nowMs < entry.end.getTime());
  if (active.length > 0) {
    const latestActiveStart = Math.max(...active.map((entry) => entry.start.getTime()));
    return {
      ids: active.filter((entry) => entry.start.getTime() === latestActiveStart).map((entry) => String(entry.week.id)),
      reason: 'active-cycle',
    };
  }

  const future = entries.filter((entry) => entry.start.getTime() > nowMs);
  if (future.length > 0 && entries.every((entry) => entry.start.getTime() > nowMs)) {
    return { ids: [], reason: 'not-open-yet' };
  }

  // Keep the just-finished package available briefly when the next package is
  // late. This covers teachers exporting immediately after class without
  // allowing an old package to remain selected for days.
  const ended = entries.filter((entry) => entry.end.getTime() <= nowMs);
  if (ended.length > 0) {
    const latestEnd = Math.max(...ended.map((entry) => entry.end.getTime()));
    if (nowMs - latestEnd <= 24 * 60 * 60 * 1000) {
      return {
        ids: ended.filter((entry) => entry.end.getTime() === latestEnd).map((entry) => String(entry.week.id)),
        reason: 'just-ended-cycle',
      };
    }
  }

  return { ids: [], reason: 'no-current-cycle' };
}

function selectRecentTaskDetails(taskInfo = {}, maxWeeks = 3) {
  const taskGroups = Array.isArray(taskInfo.taskGroups) ? taskInfo.taskGroups.filter(Boolean) : [];
  const limit = Math.max(1, Number(maxWeeks) || 3);
  const dated = taskGroups.map((group) => {
    const label = String(group?.sourceLabel || group?.name || group?.id || '');
    const cycleDate = String(group?.startAt || '').slice(0, 10) || extractAssignedDateKey(label);
    return { group, weekStart: getMondayDateKey(cycleDate) };
  });
  const recentWeekStarts = [...new Set(dated.map((item) => item.weekStart).filter(Boolean))]
    .sort()
    .slice(-limit);
  if (recentWeekStarts.length > 0) {
    const selected = new Set(recentWeekStarts);
    return dated.filter((item) => selected.has(item.weekStart)).map((item) => item.group);
  }

  const numbered = taskGroups.map((group) => ({
    group,
    weekNumber: extractWeekNumber(group?.sourceLabel || group?.name || group?.id || ''),
  }));
  const recentWeekNumbers = [...new Set(numbered.map((item) => item.weekNumber).filter(Number.isFinite))]
    .sort((left, right) => left - right)
    .slice(-limit);
  if (recentWeekNumbers.length > 0) {
    const selected = new Set(recentWeekNumbers);
    return numbered.filter((item) => selected.has(item.weekNumber)).map((item) => item.group);
  }

  // If the source has no trustworthy date/week metadata, do not preload
  // details. The complete catalog remains available and can be read on demand.
  return [];
}

function selectLatestCatalogWeekIds(groupedWeeks = []) {
  const dated = (Array.isArray(groupedWeeks) ? groupedWeeks : []).map((week) => {
    const labels = Array.isArray(week?.sourceLabels) ? week.sourceLabels : [];
    const dateKey = String(week?.startAt || '').slice(0, 10)
      || labels.map(extractAssignedDateKey).filter(Boolean).sort().at(-1)
      || '';
    return { id: String(week?.id || ''), dateKey };
  }).filter((item) => item.id);
  const latestDate = dated.map((item) => item.dateKey).filter(Boolean).sort().at(-1) || '';
  if (latestDate) {
    return dated.filter((item) => item.dateKey === latestDate).map((item) => item.id);
  }
  return dated.slice(-1).map((item) => item.id);
}

module.exports = {
  taskSelectionFingerprint,
  buildCompleteTaskCatalog,
  extractAssignedDateKey,
  getMondayDateKey,
  mergeTaskSelections,
  normalizeTaskSelection,
  parseOfficialDateTime,
  selectCurrentTaskCycle,
  selectLatestCatalogWeekIds,
  selectRecentTaskDetails,
  taskLifecycle,
};
