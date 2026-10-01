import { describe, expect, it } from 'vitest';
import { speakingVisibleDates } from './speakingVisibleDates';
describe('speaking date display', () => {
  const dates = ['2026-08-31', '2026-09-06', '2026-09-07', '2026-09-08'];
  it('starts at Shanghai Monday and hides last week without changing source dates', () => {
    const result = speakingVisibleDates(dates, false, new Date('2026-09-06T16:01:00Z'));
    expect(result.dates).toEqual(['2026-09-07', '2026-09-08']);
    expect(result.history).toEqual(['2026-08-31', '2026-09-06']);
    expect(dates).toHaveLength(4);
  });
  it('keeps current dates first when expanding history', () => {
    expect(speakingVisibleDates(dates, true, new Date('2026-09-07T04:00:00Z')).dates)
      .toEqual(['2026-09-07', '2026-09-08', '2026-08-31', '2026-09-06']);
  });
  it('does not present old data as current when a new week is empty', () => {
    expect(speakingVisibleDates(dates.slice(0, 2), false, new Date('2026-09-07T04:00:00Z')).dates).toEqual([]);
  });
});

import { settlementDatesInRange, speakingWeekMetrics, speakingStudentInRange, sortSpeakingStudents } from './speakingVisibleDates';
import type { SpeakingChallengeStudent } from '../services/speakingChallengeApi';
const student = (name: string, words: number | null): SpeakingChallengeStudent => ({
  rank: 1, englishName: name, chineseName: '', normalDays: 2, supplementDays: 1, totalDays: 3, streakDays: 2,
  daily: [
    { date: '2026-09-06', status: 'normal', words: 9000 },
    { date: '2026-09-07', status: 'normal', words },
    { date: '2026-09-08', status: 'supplement', words: 20 },
    { date: '2026-09-14', status: 'normal', words: 5000 },
  ],
});

describe('selected report range', () => {
  it('clips completed days, supplements and words without changing settlement source data', () => {
    const original = student('Amy', 100);
    const before = structuredClone(original);
    const scoped = speakingStudentInRange(original, '2026-09-07', '2026-09-08');
    expect(scoped).toMatchObject({ normalDays: 1, supplementDays: 1, totalDays: 2, streakDays: 1 });
    expect(speakingWeekMetrics(scoped, '2026-09-07', '2026-09-08')).toEqual({ days: 2, words: 120 });
    expect(original).toEqual(before);
  });

  it('restarts continuous days at range boundaries, missing dates and supplements', () => {
    const original = { ...student('Amy', 100), daily: [
      { date: '2026-09-01', status: 'normal' as const },
      { date: '2026-09-02', status: 'normal' as const },
      { date: '2026-09-03', status: 'normal' as const },
      { date: '2026-09-05', status: 'normal' as const },
      { date: '2026-09-06', status: 'supplement' as const },
      { date: '2026-09-07', status: 'normal' as const },
    ] };
    expect(speakingStudentInRange(original, '2026-09-03', '2026-09-07').streakDays).toBe(1);
    expect(speakingStudentInRange(original, '2026-09-02', '2026-09-07').streakDays).toBe(2);
    expect(speakingStudentInRange(original, '2026-09-06', '2026-09-06')).toMatchObject({ totalDays: 1, streakDays: 0 });
    expect(speakingStudentInRange(original, '2026-09-08', '2026-09-09')).toMatchObject({ totalDays: 0, streakDays: 0 });
  });
});
describe('weekly calendar, word totals and sorting', () => {
  it('pads every week Monday to Sunday and excludes next week', () => {
    const view = speakingVisibleDates(['2026-09-06', '2026-09-07', '2026-09-14'], true, new Date('2026-09-07T04:00:00Z'));
    expect(view.weeks.map(week => [week[0], week[6], week.length])).toEqual([
      ['2026-09-07', '2026-09-13', 7], ['2026-08-31', '2026-09-06', 7],
    ]);
    expect(view.dates).not.toContain('2026-09-14');
  });
  it('counts this week only, counts supplements once and preserves lifetime totals', () => {
    const row = student('Amy', 100);
    expect(speakingWeekMetrics(row, '2026-09-07', '2026-09-13')).toEqual({ days: 2, words: 120 });
    expect(row.totalDays).toBe(3);
    expect(speakingWeekMetrics(student('Ben', null), '2026-09-07', '2026-09-13').words).toBeNull();
  });
  it('sorts both directions, uses names for ties and keeps missing totals last', () => {
    const rows = [student('zoe', 100), student('Ben', 20), student('amy', 100), student('Missing', null)];
    const order = (sort: Parameters<typeof sortSpeakingStudents>[1]) => sortSpeakingStudents(rows, sort, '2026-09-07', '2026-09-13').map(row => row.englishName);
    expect(order('words-desc')).toEqual(['amy', 'zoe', 'Ben', 'Missing']);
    expect(order('words-asc')).toEqual(['Ben', 'amy', 'zoe', 'Missing']);
    expect(order('name-asc')).toEqual(['amy', 'Ben', 'Missing', 'zoe']);
    expect(order('name-desc')).toEqual(['zoe', 'Missing', 'Ben', 'amy']);
    expect(rows[0].englishName).toBe('zoe');
  });
  it('selects available dates inclusively across a week boundary and rejects reversed ranges', () => {
    const dates = ['2026-09-05', '2026-09-06', '2026-09-07'];
    expect(settlementDatesInRange(dates, '2026-09-06', '2026-09-09')).toEqual(['2026-09-06', '2026-09-07']);
    expect(settlementDatesInRange(dates, '2026-09-07', '2026-09-06')).toEqual([]);
  });
});
