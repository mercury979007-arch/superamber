import { describe, expect, it } from 'vitest';
import { getWeekNumber, monthDayToDateKey } from './calendar';

describe('seating academic calendar', () => {
  it('uses the shared autumn term week numbering', () => {
    expect(getWeekNumber(new Date(2026, 7, 31))).toBe(1);
    expect(getWeekNumber(new Date(2026, 8, 7))).toBe(2);
  });

  it('maps month/day values across the school-year boundary', () => {
    expect(monthDayToDateKey('8', '31')).toBe('2026-08-31');
    expect(monthDayToDateKey('1', '5')).toBe('2027-01-05');
  });
});
