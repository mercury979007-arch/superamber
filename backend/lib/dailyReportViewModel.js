function text(value) {
  return String(value ?? '').trim();
}

function number(value) {
  const parsed = Number.parseFloat(text(value).replace(/%/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function percent(value) {
  const parsed = number(value);
  if (parsed == null) return null;
  return parsed > 0 && parsed <= 1 ? parsed * 100 : parsed;
}

function completed(value) {
  return ['已完成', '完成', '是', '1', '√'].includes(text(value));
}

function optional(title) {
  return /(?:【|\[|\()\s*选做\s*(?:】|\]|\))|\boptional\b/i.test(text(title));
}

function resourceType(title, metrics = []) {
  const explicit = text(title).match(/\[([^\]]+)\]\s*$/)?.[1];
  if (explicit) {
    if (explicit === '语音') return 'AI语音';
    if (explicit === '词王' || explicit === '主题表达') return '主题表达积累';
    return explicit;
  }
  const labels = new Set(metrics.map((metric) => metric.label));
  if ([...labels].some((label) => /^分数[（(]/.test(label)) || text(title).includes('测试')) return '测试';
  if (labels.has('是否达到词王')
    || labels.has('词王平均正确率')
    || [...labels].some((label) => label.includes('重复环节') && label.includes('正确率'))) return '主题表达积累';
  if (labels.has('平均分') || text(title).includes('AI语音')) return 'AI语音';
  if (text(title).includes('小挑战')) return '小挑战';
  return '复合资源';
}

function displayTitle(title) {
  return text(title).replace(/\[[^\]]+\]\s*$/, '').trim();
}

function issueLevel(incomplete, total) {
  if (incomplete <= 0) return 0;
  if (total > 0 && incomplete >= total) return 3;
  if (incomplete >= Math.max(2, total - 1)) return 2;
  return 1;
}

function metricMap(row, task) {
  return Object.fromEntries(task.metrics.map((metric) => [metric.label, row[metric.column] ?? '']));
}

function testValue(metrics) {
  for (const [label, raw] of Object.entries(metrics)) {
    const match = label.match(/^分数[（(]\s*([\d.]+)\s*[）)]$/);
    if (!match) continue;
    return { value: number(raw), total: Number(match[1]) };
  }
  return { value: null, total: null };
}

function speakingByStudent(leaderboard, rangeStart, rangeEnd) {
  const result = new Map();
  for (const student of Array.isArray(leaderboard?.students) ? leaderboard.students : []) {
    const entries = (Array.isArray(student?.daily) ? student.daily : []).filter((entry) => (
      (!rangeStart || text(entry?.date) >= rangeStart) && (!rangeEnd || text(entry?.date) <= rangeEnd)
    ));
    const profile = {
      days: entries.filter((entry) => entry?.status === 'normal' || entry?.status === 'supplement').length,
      supplementCount: entries.filter((entry) => entry?.status === 'supplement').length,
      daily: entries.map((entry) => ({ date: text(entry?.date), status: text(entry?.status) || 'missed' })),
    };
    const keys = [student?.studentId, student?.chineseName, student?.englishName]
      .map((value) => text(value).toLowerCase()).filter(Boolean);
    for (const key of keys) result.set(key, profile);
  }
  return result;
}

function buildTasks(tableRows) {
  const titleRow = tableRows[1] || [];
  const subHeaderRow = tableRows[2] || [];
  const tasks = [];
  let activeTitle = '';
  for (let column = 4; column < Math.max(titleRow.length, subHeaderRow.length); column += 1) {
    if (text(titleRow[column])) activeTitle = text(titleRow[column]);
    if (text(subHeaderRow[column]) !== '是否完成') continue;
    const title = activeTitle || `任务 ${tasks.length + 1}`;
    const metrics = [];
    for (let metricColumn = column + 1; metricColumn < Math.max(titleRow.length, subHeaderRow.length); metricColumn += 1) {
      const nextTitle = text(titleRow[metricColumn]) || activeTitle;
      const label = text(subHeaderRow[metricColumn]);
      if (nextTitle !== title || label === '是否完成') break;
      if (label) metrics.push({ label, column: metricColumn });
    }
    tasks.push({
      id: `${column}:${title}`,
      title,
      label: displayTitle(title),
      type: resourceType(title, metrics),
      optional: optional(title),
      completionColumn: column,
      metrics,
    });
  }

  const labelCounts = new Map();
  tasks.forEach((task) => labelCounts.set(task.label, (labelCounts.get(task.label) || 0) + 1));
  tasks.forEach((task) => {
    if ((labelCounts.get(task.label) || 0) > 1) task.label = `${task.label}（${task.type}）`;
  });
  return tasks;
}

function qualityForTask(type, metrics, wordAccuracyMode) {
  if (type === '测试') {
    const score = testValue(metrics);
    return { kind: 'test', value: score.value, total: score.total };
  }
  if (type === 'AI语音') return { kind: 'audio', value: percent(metrics['平均分']), total: 100 };
  if (type === '主题表达积累') {
    const aliases = wordAccuracyMode === 'repeated'
      ? ['重复环节平均正确率', '【不是词王pk数据！！！重复环节平均正确率】']
      : ['词王平均正确率'];
    const raw = aliases.map((label) => metrics[label]).find((value) => text(value));
    return { kind: 'word', value: percent(raw), total: 100 };
  }
  return { kind: 'none', value: null, total: null };
}

function qualityLevel(quality, testPassScore, aiVoicePassRate) {
  if (quality.value == null) return 0;
  const pass = quality.kind === 'test'
    ? (Number.isFinite(Number(testPassScore)) ? Number(testPassScore) : Number(quality.total || 15) * 0.8)
    : quality.kind === 'audio'
      ? (Number.isFinite(Number(aiVoicePassRate)) ? Number(aiVoicePassRate) : 75)
      : 75;
  const gap = pass - quality.value;
  if (gap <= 0) return 0;
  if (gap <= (quality.kind === 'test' ? 1 : 7)) return 1;
  if (gap <= (quality.kind === 'test' ? 3 : 15)) return 2;
  return 3;
}

function formatNumber(value) {
  if (!Number.isFinite(value)) return '';
  return Number.isInteger(value) ? String(value) : Number(value).toFixed(1);
}

function cellDisplay({ complete, king, quality }, mode) {
  if (!complete) return '⭕';
  const symbol = king ? '👑' : '✅';
  if (mode === 'standard' || quality.value == null || quality.kind === 'none') return symbol;
  if (quality.kind === 'test') return `${symbol} ${formatNumber(quality.value)}/${formatNumber(quality.total)}`;
  return `${symbol} ${formatNumber(quality.value)}%`;
}

function diagnosis(student, { includeSpeaking, minSpeakingDays, testPassScore, aiVoicePassRate }) {
  const notes = [];
  for (const cell of student.cells) {
    if (!cell.complete) {
      notes.push(`${cell.label}未完成`);
      continue;
    }
    if (cell.quality.value == null) continue;
    const level = qualityLevel(cell.quality, testPassScore, aiVoicePassRate);
    if (level === 0) continue;
    if (cell.quality.kind === 'test') notes.push(`${cell.label}得分${formatNumber(cell.quality.value)}/${formatNumber(cell.quality.total)}，未达最低要求`);
    if (cell.quality.kind === 'audio') notes.push(`${cell.label}准确率${formatNumber(cell.quality.value)}%，质量偏低`);
    if (cell.quality.kind === 'word') notes.push(`${cell.label}正确率${formatNumber(cell.quality.value)}%，掌握不稳`);
  }
  if (includeSpeaking) {
    if (student.speaking.days === 0) notes.push('本周零开口');
    else if (student.speaking.days < minSpeakingDays) notes.push(`每日开口仅${student.speaking.days}天，未达${minSpeakingDays}天`);
  }
  return notes.join('；');
}

function qualityTier(student, options) {
  if (student.incompleteCount > 0) return 'D';
  const qualityFlags = student.cells.filter((cell) => cell.complete && qualityLevel(cell.quality, options.testPassScore, options.aiVoicePassRate) > 0).length;
  if (options.includeSpeaking && student.speaking.days < options.minSpeakingDays) return 'C';
  const wordCells = student.cells.filter((cell) => cell.quality.kind === 'word');
  const kingCount = wordCells.filter((cell) => cell.king).length;
  if (wordCells.length > 0 && kingCount === wordCells.length && qualityFlags === 0 && (!options.includeSpeaking || student.speaking.days >= 6)) return 'A';
  if (qualityFlags <= 1) return 'B';
  return 'C';
}

function buildDailyReportViewModel(tableRows = [], leaderboard = null, options = {}) {
  const requestedMinSpeakingDays = Number(options.minSpeakingDays);
  const normalizedOptions = {
    mode: ['standard', 'detail', 'senior'].includes(options.mode) ? options.mode : 'standard',
    includeSpeaking: options.includeSpeaking !== false,
    minSpeakingDays: Number.isFinite(requestedMinSpeakingDays)
      ? Math.max(0, Math.min(7, requestedMinSpeakingDays))
      : 2,
    testPassScore: options.testPassScore === '' || options.testPassScore == null ? null : Number(options.testPassScore),
    aiVoicePassRate: Number.isFinite(Number(options.aiVoicePassRate))
      ? Math.max(0, Math.min(100, Number(options.aiVoicePassRate)))
      : 75,
    speakingRangeStart: text(options.speakingRangeStart),
    speakingRangeEnd: text(options.speakingRangeEnd),
  };
  if (!Array.isArray(tableRows) || tableRows.length < 4) {
    return { options: normalizedOptions, tasks: [], students: [], qualityTiers: { A: [], B: [], C: [], D: [] }, problemStudents: [] };
  }
  const tasks = buildTasks(tableRows);
  const speaking = speakingByStudent(leaderboard, normalizedOptions.speakingRangeStart, normalizedOptions.speakingRangeEnd);
  const students = [];
  for (let rowIndex = 3; rowIndex < tableRows.length; rowIndex += 1) {
    const row = tableRows[rowIndex] || [];
    const studentId = text(row[1]);
    const chineseName = text(row[2]);
    const englishName = text(row[3]) || chineseName || `学生 ${rowIndex - 2}`;
    if (!studentId && !chineseName && !englishName) continue;
    const speakingProfile = speaking.get(studentId.toLowerCase())
      || speaking.get(chineseName.toLowerCase())
      || speaking.get(englishName.toLowerCase())
      || { days: 0, supplementCount: 0, daily: [] };
    const cells = tasks.map((task) => {
      const metrics = metricMap(row, task);
      const isComplete = completed(row[task.completionColumn]);
      const king = text(metrics['是否达到词王']) === '是';
      const quality = qualityForTask(task.type, metrics, normalizedOptions.mode === 'senior' ? 'repeated' : 'word');
      const level = isComplete ? qualityLevel(quality, normalizedOptions.testPassScore, normalizedOptions.aiVoicePassRate) : 3;
      return {
        taskId: task.id,
        label: task.label,
        type: task.type,
        optional: task.optional,
        complete: isComplete,
        king,
        metrics,
        quality,
        level,
        display: cellDisplay({ complete: isComplete, king, quality }, normalizedOptions.mode),
      };
    });
    const incompleteCount = cells.filter((cell) => !cell.complete).length;
    const student = {
      studentId,
      chineseName,
      englishName,
      speaking: speakingProfile,
      incompleteCount,
      issueLevel: issueLevel(incompleteCount, cells.length),
      cells,
      diagnosis: '',
      tier: 'C',
      rewardResources: cells.map((cell) => ({
        resourceName: cell.label + (cell.optional ? '【选做】' : ''),
        resourceType: cell.type,
        columns: { '是否完成': cell.complete ? '已完成' : '未完成', ...cell.metrics },
      })),
    };
    student.diagnosis = diagnosis(student, normalizedOptions);
    student.tier = qualityTier(student, normalizedOptions);
    students.push(student);
  }
  students.sort((left, right) => left.englishName.localeCompare(right.englishName, 'en', { sensitivity: 'base', numeric: true }));
  const qualityTiers = { A: [], B: [], C: [], D: [] };
  students.forEach((student) => qualityTiers[student.tier].push(student.englishName));
  const problemStudents = students.filter((student) => student.diagnosis).sort((left, right) => (
    (right.incompleteCount * 3 + (right.speaking.days < normalizedOptions.minSpeakingDays ? 2 : 0))
    - (left.incompleteCount * 3 + (left.speaking.days < normalizedOptions.minSpeakingDays ? 2 : 0))
  )).map((student) => ({
    studentId: student.studentId,
    chineseName: student.chineseName,
    englishName: student.englishName,
    diagnosis: student.diagnosis,
  }));
  return { options: normalizedOptions, tasks, students, qualityTiers, problemStudents };
}

module.exports = { buildDailyReportViewModel };
