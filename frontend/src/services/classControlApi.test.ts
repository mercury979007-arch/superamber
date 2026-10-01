import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  classControlCycleKey,
  fetchClassControlAttendance,
  fetchClassControlTrendBatch,
  loadClassControlCache,
  mergeClassControlSummary,
  refreshClassControlSummary,
  saveClassControlCache,
  type ClassControlSummary,
} from './classControlApi';

const summary: ClassControlSummary = {
  classId: 'K339',
  preferredSemester: '2026学年秋季学期',
  historical: false,
  review: null,
  current: null,
  updatedAt: '2026-08-31T02:24:00.000Z',
};

describe('classControlApi browser cache', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  it('isolates cached transient summaries by teacher and normalizes class codes', () => {
    saveClassControlCache('Amber Zhang', { k339: summary });
    expect(loadClassControlCache('Amber Zhang')).toEqual({ K339: summary });
    expect(loadClassControlCache('Another Teacher')).toEqual({});
  });

  it('rejects a browser cache created for another academic term', () => {
    localStorage.setItem('superamber_class_control_v6:amber_zhang', JSON.stringify({
      version: 6,
      termId: '2026-spring',
      teacherKey: 'amber_zhang',
      summaries: { K339: { ...summary, preferredSemester: '2026学年春季学期', historical: true } },
    }));

    expect(loadClassControlCache('Amber Zhang')).toEqual({});
  });

  it('keeps the latest usable browser result when the same cycle partially fails', () => {
    const usable = {
      ...summary,
      review: {
        role: 'review' as const,
        weekNumber: 1,
        weekLabel: 'W1',
        weekIds: ['w1'],
        rangeStart: '2026-08-31',
        rangeEnd: '2026-09-06',
        openedAt: '2026-08-31T11:20:00.000Z',
        openedHours: 100,
        historical: false,
        task: {
          available: true,
          completionRate: 80,
          fullyCompletedCount: 8,
          totalStudents: 10,
          requiredTaskCount: 3,
          optionalTaskCount: 1,
          incompleteStudents: ['Ben'],
          averageAccuracy: 86,
          accuracyStudentCount: 9,
          completionDistribution: {
            excellent: 8, good: 0, watch: 1, critical: 1, noData: 0, total: 10,
          },
          accuracyDistribution: {
            excellent: 4, good: 3, watch: 2, critical: 0, noData: 1, total: 10,
          },
          taskBreakdown: [],
          studentProfiles: [],
        },
        speaking: null,
      },
    };
    const failed = {
      ...usable,
      review: { ...usable.review, task: null, taskError: 'upstream failed' },
    };
    const merged = mergeClassControlSummary(usable, failed);
    expect(merged.review?.task?.completionRate).toBe(80);
    expect(merged.review?.taskRetained).toBe(true);
  });

  it('keeps an on-demand four-week trend when a lightweight refresh omits it', () => {
    const trendCycle = {
      role: 'trend' as const,
      weekNumber: 1,
      weekLabel: 'W1',
      weekIds: ['w1'],
      rangeStart: '2026-08-31',
      rangeEnd: '2026-09-06',
      openedAt: '2026-08-31T11:20:00.000Z',
      openedHours: 100,
      historical: false,
      task: null,
      speaking: null,
    };
    const attendance = {
      available: true,
      studentProfiles: [{ name: 'Amy', absenceCount: 1, lateCount: 0, attendanceRate: 90 }],
    };
    const previous = { ...summary, trend: [trendCycle], attendance };
    const merged = mergeClassControlSummary(previous, { ...summary, updatedAt: '2026-09-01T02:24:00.000Z' });
    expect(merged.trend).toEqual([trendCycle]);
    expect(merged.attendance).toEqual(attendance);
  });

  it('preserves the 401 status so the page can open the login window', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: 'not logged in' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    )));

    await expect(refreshClassControlSummary('K339')).rejects.toMatchObject({
      name: 'ClassControlApiError',
      message: '未登录，请先登录',
      status: 401,
    });
  });

  it('loads trend batches and attendance through their lightweight endpoints', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: 'success',
        batch: {
          classId: 'K339',
          preferredSemester: '2026学年秋季学期',
          historical: false,
          trend: [],
          trendPlanKeys: ['2026-08-31|2026-09-06|w1'],
          trendExpectedCount: 1,
          trendRemainingCount: 0,
          trendComplete: true,
          updatedAt: '2026-09-01T02:24:00.000Z',
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: 'success',
        result: {
          classId: 'K339',
          attendance: { available: true, studentProfiles: [] },
          attendanceError: '',
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const knownKey = classControlCycleKey({
      rangeStart: '2026-08-31',
      rangeEnd: '2026-09-06',
      weekIds: ['w1'],
    });
    const batch = await fetchClassControlTrendBatch('K339', [knownKey]);
    const attendance = await fetchClassControlAttendance('K339');

    expect(batch.trendComplete).toBe(true);
    expect(attendance.attendance?.available).toBe(true);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      classId: 'K339',
      knownCycleKeys: [knownKey],
    });
    expect(fetchMock.mock.calls[1][0]).toBe('/api/data/class-control/attendance');
  });
});
