const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDailyReportViewModel } = require('../lib/dailyReportViewModel');

const rows = [
  ['', '', '', '', '', '', '', '', '', '', ''],
  ['', '', '', '', 'Lesson 1 测试[测试]', '', 'Lesson 1 词王[主题表达积累]', '', '', '', ''],
  ['', '编号', '中文名', '英文名', '是否完成', '分数(15)', '是否完成', '是否达到词王', 'PK次数', '词王平均正确率', '【不是词王pk数据！！！重复环节平均正确率】'],
  ['', '1', '艾米', 'Amy', '已完成', '12.5', '已完成', '是', '6', '88%', '58%'],
  ['', '2', '本', 'Ben', '已完成', '8', '未完成', '否', '2', '40%', '35%'],
];

const leaderboard = {
  students: [
    { studentId: '1', chineseName: '艾米', englishName: 'Amy', daily: [{ date: '2026-08-25', status: 'normal' }, { date: '2026-08-26', status: 'supplement' }] },
    { studentId: '2', chineseName: '本', englishName: 'Ben', daily: [] },
  ],
};

test('daily report view model preserves each task column, detail values, speaking and diagnoses', () => {
  const report = buildDailyReportViewModel(rows, leaderboard, {
    mode: 'detail', includeSpeaking: true, minSpeakingDays: 2,
    speakingRangeStart: '2026-08-24', speakingRangeEnd: '2026-08-30',
  });
  assert.deepEqual(report.tasks.map((task) => task.label), ['Lesson 1 测试', 'Lesson 1 词王']);
  assert.equal(report.students[0].cells[0].display, '✅ 12.5/15');
  assert.equal(report.students[0].cells[1].display, '👑 88%');
  assert.equal(report.students[0].speaking.days, 2);
  assert.match(report.students[1].diagnosis, /Lesson 1 词王未完成/);
  assert.match(report.students[1].diagnosis, /本周零开口/);
  assert.equal(report.students[1].tier, 'D');
});

test('senior report switches word tasks to repeated-stage average accuracy', () => {
  const report = buildDailyReportViewModel(rows, leaderboard, { mode: 'senior', includeSpeaking: false });
  assert.equal(report.students[0].cells[1].display, '👑 58%');
  assert.equal(report.students[0].cells[1].level, 3);
});

test('AI voice pass rate controls coloring and diagnosis', () => {
  const audioRows = [
    ['', '', '', '', '', ''],
    ['', '', '', '', 'Lesson 1 AI语音[语音]', ''],
    ['', '编号', '中文名', '英文名', '是否完成', '平均分'],
    ['', '1', '艾米', 'Amy', '已完成', '82%'],
  ];
  const passing = buildDailyReportViewModel(audioRows, null, { mode: 'detail', includeSpeaking: false, aiVoicePassRate: 82 });
  const needsAttention = buildDailyReportViewModel(audioRows, null, { mode: 'detail', includeSpeaking: false, aiVoicePassRate: 85 });
  assert.equal(passing.options.aiVoicePassRate, 82);
  assert.equal(passing.students[0].cells[0].level, 0);
  assert.equal(passing.students[0].diagnosis, '');
  assert.equal(needsAttention.students[0].cells[0].level, 1);
  assert.match(needsAttention.students[0].diagnosis, /准确率82%/);
});

test('legacy real-world 词王 resource labels normalize to the reward rule resource type', () => {
  const legacyRows = [
    ['', '', '', '', '', ''],
    ['', '', '', '', 'Lesson 1 词王[词王]', ''],
    ['', '编号', '中文名', '英文名', '是否完成', '是否达到词王'],
    ['', '1', '艾米', 'Amy', '已完成', '是'],
  ];
  const report = buildDailyReportViewModel(legacyRows, null, { mode: 'standard', includeSpeaking: false });
  assert.equal(report.tasks[0].type, '主题表达积累');
  assert.equal(report.students[0].rewardResources[0].resourceType, '主题表达积累');
});

test('repeat-accuracy-only resources normalize to the theme reward type', () => {
  const repeatRows = [
    ['', '', '', '', '', ''],
    ['', '', '', '', 'Lesson 1 重复练习', ''],
    ['', '编号', '中文名', '英文名', '是否完成', '重复环节平均正确率'],
    ['', '1', '艾米', 'Amy', '已完成', '82%'],
  ];
  const report = buildDailyReportViewModel(repeatRows, null, { mode: 'senior', includeSpeaking: false });
  assert.equal(report.tasks[0].type, '主题表达积累');
  assert.equal(report.students[0].rewardResources[0].resourceType, '主题表达积累');
});
