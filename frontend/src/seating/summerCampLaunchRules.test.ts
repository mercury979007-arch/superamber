import { describe, expect, it } from 'vitest';
import {
  getSummerCampAutoAdvanceTarget,
  resolveSummerCampLaunchDate,
  shouldPreserveExistingCampPresetSeating,
} from './summerCampLaunchRules';

const SCHEDULE = [
  '2026-07-20',
  '2026-07-21',
  '2026-07-22',
  '2026-07-23',
];

describe('summerCampLaunchRules', () => {
  it('auto-advances stale seating to the current camp day', () => {
    expect(getSummerCampAutoAdvanceTarget(SCHEDULE, '2026-07-21', '2026-07-20')).toBe('2026-07-21');
    expect(getSummerCampAutoAdvanceTarget(SCHEDULE, '2026-07-21', '2026-07-21')).toBeNull();
    expect(getSummerCampAutoAdvanceTarget(SCHEDULE, '2026-07-21', '')).toBeNull();
  });

  it('prefers stored seating date when it is already current or ahead', () => {
    expect(resolveSummerCampLaunchDate(SCHEDULE, '2026-07-21', '2026-07-22', '2026-07-21')).toBe('2026-07-22');
    expect(resolveSummerCampLaunchDate(SCHEDULE, '2026-07-21', '2026-07-21', '2026-07-22')).toBe('2026-07-21');
  });

  it('falls back to operational date for stale classes and to preferred date for fresh classes', () => {
    expect(resolveSummerCampLaunchDate(SCHEDULE, '2026-07-21', '2026-07-20', '2026-07-23')).toBe('2026-07-21');
    expect(resolveSummerCampLaunchDate(SCHEDULE, '2026-07-21', '', '2026-07-23')).toBe('2026-07-23');
    expect(resolveSummerCampLaunchDate(SCHEDULE, '2026-07-21', '', '')).toBe('2026-07-21');
  });

  it('preserves existing preset seating during implicit summer-camp entry unless the shape is outdated', () => {
    expect(shouldPreserveExistingCampPresetSeating(32, false, false)).toBe(true);
    expect(shouldPreserveExistingCampPresetSeating(32, false, true)).toBe(false);
    expect(shouldPreserveExistingCampPresetSeating(32, undefined, false)).toBe(false);
    expect(shouldPreserveExistingCampPresetSeating(0, false, false)).toBe(false);
  });
});
