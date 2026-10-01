import { describe, expect, it } from 'vitest';
import { getWeek1StartDate, getWeekNumberForDate, getWeekRange } from './weekNumber';

describe('academic week numbering', () => {
  it('starts the 2026 autumn term on August 31', () => {
    expect(getWeek1StartDate()).toEqual(new Date(2026, 7, 31));
    expect(getWeekNumberForDate(new Date(2026, 7, 31, 0, 0, 0))).toBe(1);
    expect(getWeekNumberForDate(new Date(2026, 8, 6, 23, 59, 59))).toBe(1);
    expect(getWeekNumberForDate(new Date(2026, 8, 7, 0, 0, 0))).toBe(2);
  });

  it('returns Monday-to-Sunday ranges for each academic week', () => {
    const range = getWeekRange(2);
    expect(range.start).toEqual(new Date(2026, 8, 7));
    expect(range.end).toEqual(new Date(2026, 8, 13));
  });
});
