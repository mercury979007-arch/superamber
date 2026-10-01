import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getNextClassSession,
  getClassDisplaySession,
  getOfficialClassControlSessions,
  getSuggestedClassControlSessions,
  isClassControlScheduleConfirmed,
  saveConfirmedClassControlSchedule,
  type OfficialTeacherScheduleSlot,
} from './classControlSchedule';

const officialSlot: OfficialTeacherScheduleSlot = {
  id: '90210',
  classCode: 'ZZ999',
  date: '2026-08-31',
  day: '周一',
  time: '19:20',
  endTime: '20:20',
  campus: 'C86',
  room: '2楼-17',
  classroomName: 'C86-2楼-17',
  courseName: '主题口语课',
  teacherName: 'Sam',
  tutorName: 'Amber',
  source: 'official_schedule',
  sampleCount: 1,
  latestDate: '2026-08-31',
};

describe('classControlSchedule', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useRealTimers();
  });

  it('orders a synthetic confirmed class by its next scheduled session', () => {
    saveConfirmedClassControlSchedule('ZZ999', [
      { day: '周一', time: '18:30', campus: 'Demo', room: '101', source: 'manual' },
    ], 'Amber');
    const session = getClassDisplaySession('ZZ999', [], new Date('2026-09-07T02:00:00Z'), 'Amber');
    expect(session).toMatchObject({ day: '周一', time: '18:30' });
  });

  it('keeps the official timetable adapter ready while the active source remains the system schedule', () => {
    expect(getOfficialClassControlSessions([officialSlot])[0]).toMatchObject({
      day: '周一', time: '19:20', campus: 'C86', room: '2楼-17', source: 'official_schedule',
    });
    const sessions = getSuggestedClassControlSessions('ZZ999', [officialSlot], 'Amber');
    expect(sessions).toEqual([]);
    expect(isClassControlScheduleConfirmed('ZZ999', 'Amber')).toBe(false);
  });

  it('keeps a teacher-confirmed two-session schedule per account in the current browser', () => {
    saveConfirmedClassControlSchedule('ZZ999', [
      { day: '周一', time: '18:30', campus: 'C86', room: '301', source: 'manual' },
      { day: '周日', time: '09:00', campus: 'C86', room: '302', source: 'manual' },
    ], 'Amber');
    expect(isClassControlScheduleConfirmed('ZZ999', 'Amber')).toBe(true);
    expect(isClassControlScheduleConfirmed('ZZ999', 'Another')).toBe(false);
    expect(getSuggestedClassControlSessions('ZZ999', [officialSlot], 'Amber')).toHaveLength(2);

    const next = getNextClassSession('ZZ999', [officialSlot], new Date('2026-09-01T02:00:00Z'), 'Amber');
    expect(next).toMatchObject({ day: '周日', dayOffset: 5, time: '09:00' });
  });

  it('records a one-time confirmation even when a class has no system schedule', () => {
    saveConfirmedClassControlSchedule('MISSING1', [], 'Amber');
    expect(isClassControlScheduleConfirmed('MISSING1', 'Amber')).toBe(true);
    expect(getSuggestedClassControlSessions('MISSING1', [], 'Amber')).toEqual([]);
  });

  it('moves a same-day class to next week after its start time has passed', () => {
    saveConfirmedClassControlSchedule('ZZ999', [
      { day: '周一', time: '18:30', campus: 'C86', room: '301', source: 'manual' },
      { day: '周日', time: '09:00', campus: 'C86', room: '302', source: 'manual' },
    ], 'Amber');

    const next = getNextClassSession('ZZ999', [], new Date('2026-09-07T11:00:00Z'), 'Amber');
    expect(next).toMatchObject({ day: '周日', dayOffset: 6, time: '09:00', minutesUntil: 8040 });
  });
});
