const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildClassControlCyclePlan,
  buildHistoricalCyclePlan,
  buildPreparedCycleSelection,
  summarizeAttendanceRows,
  summarizeSpeakingRows,
  summarizeTaskTableRows,
} = require('../lib/classControl');

function makeTask(id, weekNumber, startAt, options = {}) {
  return {
    id,
    name: `Week${weekNumber}`,
    weekNumber,
    startAt,
    endAt: options.endAt || startAt,
    skuId: options.skuId ?? '5',
    collectionName: options.collectionName ?? '活动计划',
    studentVisible: true,
  };
}

test('class task, speaking and attendance summaries preserve bilingual English name qualifiers', () => {
  const roster = [
    { no: '01', chName: '学生甲', enName: 'Test A甲' },
    { no: '02', chName: '学生乙', enName: 'Test B乙' },
  ];
  const task = summarizeTaskTableRows([
    [], ['序号', '学号', '中文名', '英文名', '必做语音'],
    ['序号', '学号', '中文名', '英文名', '是否完成'],
    ['1', '01', '学生甲', '学生甲', '未完成'],
    ['2', '02', '学生乙', 'Test B乙', '未完成'],
  ], roster);
  assert.deepEqual(new Set(task.incompleteStudents), new Set(['Test A甲', 'Test B乙']));
  const speaking = summarizeSpeakingRows([
    { no: '01', ch_name: '学生甲', en_name: 'Test A甲', all_check_days: 0 },
    { no: '02', ch_name: '学生乙', en_name: 'Test B乙', all_check_days: 0 },
  ], roster);
  assert.deepEqual(new Set(speaking.zeroStudents), new Set(['Test A甲', 'Test B乙']));
  const attendance = summarizeAttendanceRows([{ name: '学生甲', absenceCount: 1, lateCount: 0, attendanceRate: 90 }], roster);
  assert.equal(attendance.studentProfiles[0].name, 'Test A甲');
});

function makeSnapshot(tasks, preferredSemester = '2026学年秋季学期') {
  return {
    preferredYear: '2026',
    preferredSemester,
    weekTasks: tasks,
    weekMap: Object.fromEntries(tasks.map((task) => [task.id, [`${task.id}-resource`]])),
    weekSourceLabels: Object.fromEntries(tasks.map((task) => [task.id, [`${task.name} 任务时间:${task.startAt}`]])),
    weekSelectionMap: Object.fromEntries(tasks.map((task) => [task.id, {
      taskIds: [`node_${task.id}_1_voice`],
      idToName: { [`${task.id}_1`]: `${task.id} 必做 类型:语音` },
      orderedTaskKeys: [`${task.id}_1`],
      taskMetaByKey: { [`${task.id}_1`]: { title: `${task.id} 必做` } },
    }])),
  };
}

test('class control keeps last week as review and only exposes a started current task', () => {
  const snapshot = makeSnapshot([
    makeTask('w1', 1, '2026-08-31 19:20:00', { endAt: '2026-09-07 19:20:00' }),
    makeTask('w2', 2, '2026-09-07 19:20:00', { endAt: '2026-09-14 19:20:00' }),
  ]);

  const beforeOpening = buildClassControlCyclePlan(snapshot, {
    now: new Date('2026-09-07T10:00:00Z'),
    currentTermName: '2026学年秋季学期',
    week1Start: '2026-08-31',
    timezone: 'Asia/Shanghai',
  });
  assert.equal(beforeOpening.review.weekLabel, 'W1');
  assert.equal(beforeOpening.current, null);

  const afterOpening = buildClassControlCyclePlan(snapshot, {
    now: new Date('2026-09-08T02:00:00Z'),
    currentTermName: '2026学年秋季学期',
    week1Start: '2026-08-31',
    timezone: 'Asia/Shanghai',
  });
  assert.deepEqual(afterOpening.review.weekIds, ['w1']);
  assert.deepEqual(afterOpening.current.weekIds, ['w2']);
  assert.equal(afterOpening.current.weekLabel, 'W2');
  assert.deepEqual(afterOpening.trend.map((cycle) => cycle.weekIds), [['w1']]);
});

test('class control excludes resource-only SKU and merges same-week activity packages', () => {
  const snapshot = makeSnapshot([
    makeTask('activity-a', 1, '2026-08-31 19:20:00'),
    makeTask('activity-b', 1, '2026-09-01 08:00:00'),
    makeTask('audio', 1, '2026-09-01 09:00:00', { skuId: '20', collectionName: '拓展学习资源' }),
  ]);
  const plan = buildClassControlCyclePlan(snapshot, {
    now: new Date('2026-09-08T02:00:00Z'),
    currentTermName: '2026学年秋季学期',
    week1Start: '2026-08-31',
    timezone: 'Asia/Shanghai',
  });
  assert.deepEqual(plan.review.weekIds, ['activity-a', 'activity-b']);
  const selection = buildPreparedCycleSelection(snapshot, plan.review);
  assert.equal(selection.preparedSelection.taskIds.includes('node_audio_1_voice'), false);
  assert.equal(selection.preparedSelection.taskIds.length, 2);
});

test('historical cycle plan uses the last real startAt month and excludes special phases', () => {
  const tasks = [
    { ...makeTask('march', 1, '2026-03-02 19:20:00'), sourceLabels: ['Week1'], taskSelection: { taskIds: ['march-node'] } },
    { ...makeTask('june-a', 15, '2026-06-08 19:20:00'), sourceLabels: ['Week15'], taskSelection: { taskIds: ['june-a-node'] } },
    { ...makeTask('june-b', 16, '2026-06-15 19:20:00'), sourceLabels: ['Week16'], taskSelection: { taskIds: ['june-b-node'] } },
    { ...makeTask('summer', 17, '2026-07-20 09:00:00'), name: '暑期集训', sourceLabels: ['暑期集训'], taskSelection: { taskIds: ['summer-node'] } },
  ];
  const plan = buildHistoricalCyclePlan(tasks, {
    phase: 'regular',
    monthKind: 'last_active_month',
    now: new Date('2026-09-04T00:00:00Z'),
  });
  assert.equal(plan.status, 'ready');
  assert.equal(plan.resolvedMonth, 6);
  assert.deepEqual(plan.cycles.map((cycle) => cycle.weekIds), [['june-a'], ['june-b']]);
});

test('unspecified historical phase includes every real task in the official term', () => {
  const tasks = [
    { ...makeTask('regular', 16, '2026-06-15 19:20:00'), sourceLabels: ['Week16'] },
    { ...makeTask('summer', 17, '2026-07-20 09:00:00'), name: '暑期集训', sourceLabels: ['暑期集训'] },
  ];
  const plan = buildHistoricalCyclePlan(tasks, {
    phase: 'all', monthKind: 'last_active_month', now: new Date('2026-09-04T00:00:00Z'),
  });
  assert.equal(plan.status, 'ready');
  assert.equal(plan.resolvedMonth, 7);
  assert.deepEqual(plan.cycles.map((cycle) => cycle.weekIds), [['summer']]);
});

test('historical intensive phase requires real task label evidence', () => {
  const plan = buildHistoricalCyclePlan([
    { ...makeTask('regular', 12, '2026-05-18 19:20:00'), sourceLabels: ['Week12'] },
  ], {
    phase: 'spring_intensive',
    monthKind: 'whole_term',
  });
  assert.equal(plan.status, 'not_found');
  assert.match(plan.message, /不能按日期猜测/);
});

test('historical source keeps its latest four real activity weeks without changing the live term', () => {
  const snapshot = makeSnapshot([
    makeTask('w1', 1, '2026-07-06 19:20:00'),
    makeTask('w2', 2, '2026-07-13 19:20:00'),
    makeTask('w3', 3, '2026-07-20 19:20:00'),
    makeTask('w4', 4, '2026-07-27 19:20:00'),
    makeTask('w5', 5, '2026-08-03 19:20:00'),
  ], '2026学年春季学期');
  const plan = buildClassControlCyclePlan(snapshot, {
    now: new Date('2026-08-31T04:00:00Z'),
    currentTermName: '2026学年秋季学期',
    week1Start: '2026-08-31',
    timezone: 'Asia/Shanghai',
  });
  assert.equal(plan.historical, true);
  assert.deepEqual(plan.review.weekIds, ['w5']);
  assert.deepEqual(plan.current.weekIds, ['w4']);
  assert.equal(plan.review.weekLabel, 'W5');
  assert.equal(plan.current.weekLabel, 'W4');
  assert.deepEqual(plan.trend.map((cycle) => cycle.weekIds), [['w2'], ['w3'], ['w4'], ['w5']]);
});

test('task summary separates required work and exposes completion, quality, distribution and task detail', () => {
  const rows = [
    ['', '', '', '', '', '', '', '', '', ''],
    ['序号', '学号', '中文名', '英文名', '【必做】语音', '【必做】语音', '【选做】歌曲', '必做测试', '必做测试'],
    ['序号', '学号', '中文名', '英文名', '是否完成', '平均分', '是否完成', '是否完成', '分数(15)'],
    ['1', '001', '张三', 'Amy', '已完成', '90', '未完成', '已完成', '12'],
    ['2', '002', '李四', 'Ben', '已完成', '80', '已完成', '未完成', '8'],
  ];
  const summary = summarizeTaskTableRows(rows, [
    { no: '001', chName: '张三', enName: 'Amy' },
    { no: '002', chName: '李四', enName: 'Ben' },
  ]);
  assert.equal(summary.completionRate, 75);
  assert.equal(summary.fullyCompletedCount, 1);
  assert.equal(summary.requiredTaskCount, 2);
  assert.equal(summary.optionalTaskCount, 1);
  assert.deepEqual(summary.incompleteStudents, ['Ben']);
  assert.equal(summary.averageAccuracy, 75.8);
  assert.deepEqual(summary.completionDistribution, {
    excellent: 1, good: 0, watch: 0, critical: 1, noData: 0, total: 2,
  });
  assert.deepEqual(summary.accuracyDistribution, {
    excellent: 0, good: 1, watch: 1, critical: 0, noData: 0, total: 2,
  });
  assert.equal(summary.taskBreakdown[0].title, '【必做】语音');
  assert.equal(summary.taskBreakdown[0].completionRate, 100);
  assert.equal(summary.taskBreakdown[0].averageAccuracy, 85);
  assert.deepEqual(summary.taskBreakdown[1].incompleteStudents, ['Ben']);
  assert.equal(summary.taskBreakdown[1].averageAccuracy, 66.7);
  assert.deepEqual(summary.studentProfiles, [
    {
      name: 'Amy',
      completionRate: 100,
      completedTaskCount: 2,
      requiredTaskCount: 2,
      incompleteTaskCount: 0,
      incompleteTasks: [],
      averageAccuracy: 85,
      accuracyTaskCount: 2,
    },
    {
      name: 'Ben',
      completionRate: 50,
      completedTaskCount: 1,
      requiredTaskCount: 2,
      incompleteTaskCount: 1,
      incompleteTasks: ['必做测试'],
      averageAccuracy: 66.7,
      accuracyTaskCount: 2,
    },
  ]);
  assert.equal(summary.incompleteStudents.some((name) => /[\u4e00-\u9fff]/.test(name)), false);
});

test('all student exception lists are sorted by English name', () => {
  const rows = [
    ['', '', '', '', ''],
    ['序号', '学号', '中文名', '英文名', '必做语音'],
    ['序号', '学号', '中文名', '英文名', '是否完成'],
    ['1', '003', '王五', 'zoe', '未完成'],
    ['2', '001', '张三', 'Amy', '未完成'],
    ['3', '002', '李四', 'ben', '未完成'],
  ];
  const summary = summarizeTaskTableRows(rows);
  assert.deepEqual(summary.incompleteStudents, ['Amy', 'ben', 'zoe']);
  assert.deepEqual(summary.taskBreakdown[0].incompleteStudents, ['Amy', 'ben', 'zoe']);
});

test('speaking summary uses the complete roster and English names for zero-day students', () => {
  const summary = summarizeSpeakingRows([
    { no: '001', ch_name: '张三', all_check_days: 4, supplement_times: 1 },
  ], [
    { no: '001', chName: '张三', enName: 'Amy' },
    { no: '002', chName: '李四', enName: 'Ben' },
  ]);
  assert.equal(summary.averageDays, 2);
  assert.equal(summary.supplementCount, 1);
  assert.deepEqual(summary.zeroStudents, ['Ben']);
  assert.deepEqual(summary.studentProfiles, [
    { name: 'Amy', days: 4, supplementCount: 1 },
    { name: 'Ben', days: 0, supplementCount: 0 },
  ]);
});

test('attendance summary maps source names to English names and normalizes rates', () => {
  const summary = summarizeAttendanceRows([
    { name: '张三', absenceCount: 1, lateCount: 0, attendanceRate: 0.92 },
    { name: 'Ben', absenceCount: 0, lateCount: 2, attendanceRate: 88 },
  ], [
    { no: '001', chName: '张三', enName: 'Amy' },
    { no: '002', chName: '李四', enName: 'Ben' },
  ]);
  assert.equal(summary.available, true);
  assert.deepEqual(summary.studentProfiles, [
    { name: 'Amy', absenceCount: 1, lateCount: 0, attendanceRate: 92 },
    { name: 'Ben', absenceCount: 0, lateCount: 2, attendanceRate: 88 },
  ]);
  assert.equal(/[\u4e00-\u9fff]/.test(JSON.stringify(summary)), false);
});
