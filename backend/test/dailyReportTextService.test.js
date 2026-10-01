const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildDailyReportPrompt,
  buildFastDailyReport,
  parseCompletedValue,
  parseScoreValue,
  summarizeTablesForReport,
} = require('../services/dailyReportTextService');

const sampleTables = [
  {
    name: 'J328 Week 12',
    text: [
      '| row | row | row | row | row | row | row | row |',
      '|  | 学号 | 中文名 | 英文名 | Lesson 1 测试[测试] |  | Lesson 1 AI语音[AI语音] |  |',
      '|  | 学号 | 中文名 | 英文名 | 是否完成 | 分数(15) | 是否完成 | 平均分 |',
      '|  | 20240001 | 张三 | Amy | 已完成 | 13 | 已完成 | 82% |',
      '|  | 20240002 | 李四 | Ben | 未完成 | 10 | 已完成 | 71% |',
    ].join('\n'),
  },
];

test('buildDailyReportPrompt includes custom requirement when mode is custom', () => {
  const prompt = buildDailyReportPrompt('custom', '重点强调课堂配合');
  assert.match(prompt, /重点强调课堂配合/);
  assert.match(prompt, /自定义要求/);
});

test('parseCompletedValue and parseScoreValue normalize common workbook values', () => {
  assert.equal(parseCompletedValue('已完成'), true);
  assert.equal(parseCompletedValue('未完成'), false);
  assert.equal(parseCompletedValue(''), null);
  assert.equal(parseScoreValue('82%'), 82);
  assert.equal(parseScoreValue('13'), 13);
  assert.equal(parseScoreValue('abc'), null);
});

test('summarizeTablesForReport aggregates completion and score fields', () => {
  const summary = summarizeTablesForReport(sampleTables, '');
  assert.equal(summary.classCode, 'J328');
  assert.equal(summary.students.length, 2);
  assert.deepEqual(summary.students[0], {
    name: 'Amy',
    completedTasks: 2,
    totalTrackedTasks: 2,
    scoreSum: 95,
    scoreCount: 2,
  });
  assert.deepEqual(summary.students[1], {
    name: 'Ben',
    completedTasks: 1,
    totalTrackedTasks: 2,
    scoreSum: 81,
    scoreCount: 2,
  });
});

test('buildFastDailyReport returns detailed markdown when detailed mode is requested', () => {
  const report = buildFastDailyReport({
    classCode: 'J328',
    tables: sampleTables,
    note: '老师反馈整体配合不错。',
    mode: 'detailed',
    customPrompt: '',
  });

  assert.match(report, /班级日报详细版/);
  assert.match(report, /Amy/);
  assert.match(report, /Ben/);
  assert.match(report, /老师反馈整体配合不错/);
});

test('buildFastDailyReport carries custom focus line into standard report', () => {
  const report = buildFastDailyReport({
    classCode: 'J328',
    tables: sampleTables,
    note: '',
    mode: 'custom',
    customPrompt: '重点关注课堂状态',
  });

  assert.match(report, /本次重点：重点关注课堂状态/);
  assert.match(report, /表现亮点/);
});
