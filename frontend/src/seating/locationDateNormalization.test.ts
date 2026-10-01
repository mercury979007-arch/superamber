import { describe, expect, it } from 'vitest';
import { normalizeLocationDate } from './locationDateNormalization';

describe('normalizeLocationDate', () => {
  it.each([
    ['2026-08-31', '8', '31', '星期一'],
    ['2026-09-01', '9', '1', '星期二'],
    ['2026-09-02', '9', '2', '星期三'],
    ['2026-09-03', '9', '3', '星期四'],
    ['2026-09-04', '9', '4', '星期五'],
    ['2026-09-05', '9', '5', '星期六'],
    ['2026-09-06', '9', '6', '星期日'],
  ])('normalizes every Week 1 day: %s', (fullDate, date, day, weekday) => {
    expect(normalizeLocationDate({ fullDate, date: '1', day: '1', weekday: '错误星期' })).toEqual({
      fullDate,
      date,
      day,
      weekday,
    });
  });

  it('repairs a valid full date whose saved weekday is inconsistent', () => {
    expect(normalizeLocationDate({
      fullDate: '2027-06-27',
      date: '6',
      day: '27',
      weekday: '星期六',
    })).toEqual({
      fullDate: '2027-06-27',
      date: '6',
      day: '27',
      weekday: '星期日',
    });
  });

  it('keeps an undated draft undated', () => {
    expect(normalizeLocationDate({})).toEqual({ fullDate: '', date: '', day: '', weekday: '' });
  });
});
