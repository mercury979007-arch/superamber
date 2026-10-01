import { describe, expect, it } from 'vitest';
import { buildAcademicWeekContext } from './academicWeekContext';

describe('academicWeekContext', () => {
  it.each([
    ['2026-08-31', '8月31日 星期一'],
    ['2026-09-01', '9月1日 星期二'],
    ['2026-09-02', '9月2日 星期三'],
    ['2026-09-03', '9月3日 星期四'],
    ['2026-09-04', '9月4日 星期五'],
    ['2026-09-05', '9月5日 星期六'],
    ['2026-09-06', '9月6日 星期日'],
  ])('uses the shared Week 1 range for %s', (dateKey, classDateLabel) => {
    expect(buildAcademicWeekContext(dateKey)).toBe(
      `Week 1｜周区间 8月31日—9月6日｜本班上课 ${classDateLabel}`,
    );
  });

  it('keeps a Saturday class inside the Monday-starting Week 1 range', () => {
    expect(buildAcademicWeekContext('2026-09-05')).toBe(
      'Week 1｜周区间 8月31日—9月6日｜本班上课 9月5日 星期六',
    );
  });

  it('shows August 31 as the first day of Week 1', () => {
    expect(buildAcademicWeekContext('2026-08-31')).toBe(
      'Week 1｜周区间 8月31日—9月6日｜本班上课 8月31日 星期一',
    );
  });
});
