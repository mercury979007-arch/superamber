import { describe, expect, it } from 'vitest';
import {
  buildGoalTextFromPlan,
  buildPrepTextFromPlan,
  findCampDayPlan,
  getCampReportPhase,
  getCampReportDateIndex,
  getCurrentCampReportDate,
  getDefaultCampReportDate,
  getNextCampReportDate,
  getCampReportDateOptions,
  resolveCampReportLaunchDate,
  shouldPromptForNextCampReportDate,
} from './campReportCatalog';

function getReminderText(date: string, majorLevel: string, minorCamp: string) {
  const plan = findCampDayPlan(date, majorLevel, minorCamp);
  return buildPrepTextFromPlan(plan).split('明日提醒')[1]?.trim() || '';
}

describe('campReportCatalog summer camp schedule', () => {
  it('starts Day 1 on July 20, 2026', () => {
    const options = getCampReportDateOptions();
    expect(options[0]).toMatchObject({
      date: '2026-07-20',
      dayIndex: 1,
      dayLabel: 'Day 1',
    });
  });

  it('uses the next available camp day before camp starts', () => {
    expect(getCurrentCampReportDate(new Date('2026-07-19T20:00:00'))).toBe('2026-07-20');
    expect(getDefaultCampReportDate('L2', 'Camp 1', new Date('2026-07-19T20:00:00'))).toBe('2026-07-20');
  });

  it('keeps the same day on camp morning and skips Sunday when finding next day', () => {
    expect(getCurrentCampReportDate(new Date('2026-07-20T08:00:00'))).toBe('2026-07-20');
    expect(getNextCampReportDate('2026-07-25')).toBe('2026-07-27');
  });

  it('switches to phase 2 on August 3 and already points there on August 2', () => {
    expect(getCurrentCampReportDate(new Date('2026-08-02T08:00:00'))).toBe('2026-08-03');
    expect(resolveCampReportLaunchDate('2026-07-31', new Date('2026-08-02T08:00:00'))).toBe('2026-08-03');
    expect(resolveCampReportLaunchDate('2026-08-04', new Date('2026-08-02T08:00:00'))).toBe('2026-08-04');
    expect(getCampReportPhase('2026-07-31')).toBe(1);
    expect(getCampReportPhase('2026-08-03')).toBe(2);
    expect(getCampReportDateOptions().find((item) => item.date === '2026-08-03')).toMatchObject({
      date: '2026-08-03',
      dayIndex: 1,
      phaseIndex: 2,
      dayLabel: 'Day 1',
    });
  });

  it('only prompts for next-day generation after 11:30 on the current camp day', () => {
    expect(shouldPromptForNextCampReportDate('2026-07-20', new Date('2026-07-20T11:29:00'))).toBe(false);
    expect(shouldPromptForNextCampReportDate('2026-07-20', new Date('2026-07-20T11:30:00'))).toBe(true);
    expect(shouldPromptForNextCampReportDate('2026-07-21', new Date('2026-07-20T12:00:00'))).toBe(false);
  });

  it('does not wrap after the final camp day', () => {
    expect(getCampReportDateIndex('2026-08-14')).toBeGreaterThan(-1);
    expect(getNextCampReportDate('2026-08-14')).toBeNull();
  });
});

describe('camp report content without private organization data', () => {
  it('keeps the public report structure available with generic goal text', () => {
    const plan = findCampDayPlan('2026-07-20', 'L2', 'Camp 1');
    expect(buildGoalTextFromPlan(plan, 'Demo Camp')).toContain('冲刺目标');
  });

  it('uses a neutral fallback when no private activity schedule is supplied', () => {
    const reminder = getReminderText('2026-07-20', 'L0', 'Camp 1');
    expect(reminder).toBe('明日暂未匹配到额外活动提醒，按常规准备营服、水杯与学习物资。');
  });
});
