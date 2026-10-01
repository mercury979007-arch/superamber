const test = require('node:test');
const assert = require('node:assert/strict');

const {
  calendarConfig,
  getAcademicWeekNumber,
  getPreviousAcademicWeekRange,
  getPreferredAcademicWindow,
  resolveWeek1Start,
} = require('../lib/academicCalendar');

test('autumn 2026 term starts Week 1 on August 31', () => {
  assert.equal(calendarConfig.currentTerm.week1Start, '2026-08-31');
  assert.equal(resolveWeek1Start(), '2026-08-31');
  assert.equal(getAcademicWeekNumber(new Date('2026-08-31T00:00:00+08:00')), 1);
  assert.equal(getAcademicWeekNumber(new Date('2026-09-06T23:59:59+08:00')), 1);
  assert.equal(getAcademicWeekNumber(new Date('2026-09-07T00:00:00+08:00')), 2);
});

test('academic dates use Asia/Shanghai rather than the server UTC boundary', () => {
  assert.deepEqual(
    getPreferredAcademicWindow(new Date('2026-07-31T16:30:00Z')),
    { preferredYear: '2026', preferredSemester: '2026学年秋季学期' },
  );

  const range = getPreviousAcademicWeekRange(new Date('2026-09-07T00:00:00+08:00'));
  assert.equal(range.currentWeek, 2);
  assert.equal(range.previousWeek, 1);
  assert.equal(range.start.toISOString().slice(0, 10), '2026-08-31');
  assert.equal(range.end.toISOString().slice(0, 10), '2026-09-06');
});
