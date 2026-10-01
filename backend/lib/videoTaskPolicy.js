// Temporary, reversible staging policy authorized by the teacher.
const videoTasksIgnored = () => process.env.SUPERAMBER_IGNORE_VIDEO_TASKS === '1';
const videoLabel = value => /类型\s*[:：]\s*视频(?:\s|$)/.test(String(value || ''));

function filterVideoSelection(selection, enabled = videoTasksIgnored()) {
  if (!enabled || !selection) return selection;
  const removedKeys = new Set(Object.entries(selection.idToName || {}).filter(([, name]) => videoLabel(name)).map(([key]) => key));
  for (const id of selection.taskIds || []) {
    const match = String(id).match(/^\d+_(\d+)_(\d+)_video$/);
    if (match) removedKeys.add(`${match[1]}_${match[2]}`);
  }
  if (!removedKeys.size) return selection;
  const keepId = id => {
    const match = String(id).match(/^\d+_(\d+)_(\d+)_\w+$/);
    return !match || !removedKeys.has(`${match[1]}_${match[2]}`);
  };
  const keepEntries = obj => Object.fromEntries(Object.entries(obj || {}).filter(([key]) => !removedKeys.has(key)));
  return { ...selection,
    taskIds: (selection.taskIds || []).filter(keepId),
    orderedTaskKeys: (selection.orderedTaskKeys || []).filter(key => !removedKeys.has(key)),
    idToName: keepEntries(selection.idToName), taskMetaByKey: keepEntries(selection.taskMetaByKey),
  };
}

function filterVideoTaskSnapshot(snapshot, enabled = videoTasksIgnored()) {
  if (!enabled || !snapshot) return snapshot;
  const weekMap = { ...snapshot.weekMap };
  const weekSelectionMap = { ...snapshot.weekSelectionMap };
  const removedWeeks = new Set();
  const weekTasks = (snapshot.weekTasks || []).flatMap(week => {
    const original = weekSelectionMap[week.id];
    const filtered = filterVideoSelection(original, true);
    const tasks = weekMap[week.id] || [];
    const keptTasks = tasks.filter(task => !videoLabel(task));
    const removedCount = Math.max(tasks.length - keptTasks.length, (original?.taskIds?.length || 0) - (filtered?.taskIds?.length || 0));
    if (!removedCount) return [week];
    if (!filtered?.taskIds?.length && !keptTasks.length) {
      removedWeeks.add(week.id); delete weekMap[week.id]; delete weekSelectionMap[week.id]; return [];
    }
    weekMap[week.id] = keptTasks; weekSelectionMap[week.id] = filtered;
    return [{ ...week, resourceCount: Math.max(keptTasks.length, (Number(week.resourceCount) || 0) - removedCount) }];
  });
  const keepWeeks = ids => (ids || []).filter(id => !removedWeeks.has(id));
  return { ...snapshot, weekMap, weekSelectionMap, weekTasks,
    defaultSelectedWeekIds: keepWeeks(snapshot.defaultSelectedWeekIds),
    hydratedWeekIds: keepWeeks(snapshot.hydratedWeekIds),
    ignoredVideoTasks: true,
  };
}

function filterVideoPublicitySelection(selection = {}, enabled = videoTasksIgnored()) {
  if (!enabled) return selection;
  const preparedSelection = filterVideoSelection(selection.preparedSelection, true);
  const selectedTasks = (selection.selectedTasks || []).filter(task => !videoLabel(task));
  if ((selection.preparedSelection?.taskIds?.length && !preparedSelection?.taskIds?.length)
    || (!selection.preparedSelection && selection.selectedTasks?.length && !selectedTasks.length)) {
    const error = new Error('视频任务暂不参与本轮统计，请选择其他任务');
    error.code = 'VIDEO_TASKS_IGNORED'; error.statusCode = 400; throw error;
  }
  return { ...selection, preparedSelection, selectedTasks };
}

module.exports = { videoTasksIgnored, filterVideoSelection, filterVideoTaskSnapshot, filterVideoPublicitySelection };
