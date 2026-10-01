import { describe, expect, it } from 'vitest';
import { currentShanghaiWeekToDateRange, previousShanghaiWeekRange, shanghaiExportTimestamp } from './classDailyReportDates';

describe('class daily report dates', () => {
  it('returns the current Shanghai week through today', () => {
    expect(currentShanghaiWeekToDateRange(new Date('2026-09-17T02:00:00Z'))).toEqual({
      start: '2026-09-14', end: '2026-09-17',
    });
  });
  it('uses the previous Shanghai Monday through Sunday as the default speaking range', () => {
    expect(previousShanghaiWeekRange(new Date('2026-09-06T07:00:00Z'))).toEqual({
      start: '2026-08-24',
      end: '2026-08-30',
    });
    expect(previousShanghaiWeekRange(new Date('2026-09-07T00:30:00Z'))).toEqual({
      start: '2026-08-31',
      end: '2026-09-06',
    });
  });

  it('formats a filesystem-safe Shanghai export timestamp', () => {
    expect(shanghaiExportTimestamp(new Date('2026-09-06T15:23:45Z'))).toBe('2026-09-06_23-23-45');
  });
});
