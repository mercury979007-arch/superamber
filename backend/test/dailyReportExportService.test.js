const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildDailyReportExportPlan,
  decodeBase64File,
  inferClassNameFromFilename,
  normalizeReportMode,
} = require('../services/dailyReportExportService');

test('inferClassNameFromFilename extracts normalized class code', () => {
  assert.equal(inferClassNameFromFilename('J328 学生个人数据.xlsx'), 'J328班');
  assert.equal(inferClassNameFromFilename('k218-detail.xlsx'), 'K218班');
  assert.equal(inferClassNameFromFilename('students.xlsx'), '');
});

test('decodeBase64File validates payload and returns buffer', () => {
  const decoded = decodeBase64File({
    name: 'student.xlsx',
    content: Buffer.from('hello').toString('base64'),
  }, '学生个人数据');

  assert.equal(decoded.name, 'student.xlsx');
  assert.equal(decoded.buffer.toString(), 'hello');
  assert.throws(() => decodeBase64File({}, '学生个人数据'), /学生个人数据文件缺失/);
});

test('normalizeReportMode keeps detail and senior as alternate modes', () => {
  assert.equal(normalizeReportMode('detail'), 'detail');
  assert.equal(normalizeReportMode('senior'), 'senior');
  assert.equal(normalizeReportMode('standard'), 'standard');
  assert.equal(normalizeReportMode('unexpected'), 'standard');
});

test('buildDailyReportExportPlan uses detail script and no-checkin fallback when no source exists', () => {
  const plan = buildDailyReportExportPlan({
    reportMode: 'detail',
    className: 'J328班',
    minCheckinDays: '4',
    detailTestPassScore: '12.5',
    checkinFile: null,
    checkinWorkbookBuilder: null,
    reportScriptDir: '/srv/scripts',
    tempDir: '/tmp/daily-report-demo',
  });

  assert.equal(plan.normalizedMode, 'detail');
  assert.equal(plan.studentPath, '/tmp/daily-report-demo/student-publicity.xlsx');
  assert.equal(plan.checkinPath, '/tmp/daily-report-demo/optional-checkin.xlsx');
  assert.equal(plan.scriptPath, '/srv/scripts/class_daily_report_detail.py');
  assert.deepEqual(plan.args, [
    '/tmp/daily-report-demo/optional-checkin.xlsx',
    '/tmp/daily-report-demo/student-publicity.xlsx',
    'J328班',
    '--no-checkin',
    '--min-checkin',
    '4',
    '--test-pass',
    '12.5',
  ]);
  assert.equal(plan.hasCheckinFile, false);
  assert.equal(plan.hasCheckinBuilder, false);
});

test('buildDailyReportExportPlan skips no-checkin when builder is available', () => {
  const plan = buildDailyReportExportPlan({
    reportMode: 'standard',
    className: 'J328班',
    minCheckinDays: '',
    detailTestPassScore: '',
    checkinFile: null,
    checkinWorkbookBuilder: async () => {},
    reportScriptDir: '/srv/scripts',
    tempDir: '/tmp/daily-report-demo',
  });

  assert.equal(plan.normalizedMode, 'standard');
  assert.equal(plan.scriptPath, '/srv/scripts/class_daily_report.py');
  assert.deepEqual(plan.args, [
    '/tmp/daily-report-demo/optional-checkin.xlsx',
    '/tmp/daily-report-demo/student-publicity.xlsx',
    'J328班',
  ]);
  assert.equal(plan.hasCheckinFile, false);
  assert.equal(plan.hasCheckinBuilder, true);
});

test('buildDailyReportExportPlan uses detail script with repeated accuracy for senior mode', () => {
  const plan = buildDailyReportExportPlan({
    reportMode: 'senior',
    className: 'J342班',
    minCheckinDays: '2',
    detailTestPassScore: '',
    checkinFile: null,
    checkinWorkbookBuilder: null,
    reportScriptDir: '/srv/scripts',
    tempDir: '/tmp/daily-report-demo',
  });

  assert.equal(plan.normalizedMode, 'senior');
  assert.equal(plan.scriptPath, '/srv/scripts/class_daily_report_detail.py');
  assert.deepEqual(plan.args, [
    '/tmp/daily-report-demo/optional-checkin.xlsx',
    '/tmp/daily-report-demo/student-publicity.xlsx',
    'J342班',
    '--no-checkin',
    '--min-checkin',
    '2',
    '--word-acc',
    'repeated',
  ]);
});
