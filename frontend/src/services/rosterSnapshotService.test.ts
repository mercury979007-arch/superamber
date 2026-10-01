import { beforeEach, describe, expect, it, vi } from 'vitest';

const { savePreciseStudentListMock } = vi.hoisted(() => ({
  savePreciseStudentListMock: vi.fn(),
}));

vi.mock('../utils/classProfiles', () => ({
  savePreciseStudentList: savePreciseStudentListMock,
}));

import {
  applyRosterSnapshot,
  formatRosterSnapshotGeneratedTime,
  formatRosterSnapshotTime,
  getPreparedDailyReportStates,
  getRosterSnapshot,
  refreshRosterSnapshot,
  RosterSnapshotApiError,
  summarizeRosterSnapshot,
  type RosterSnapshot,
} from './rosterSnapshotService';

const snapshot: RosterSnapshot = {
  classes: [{ id: 'J101', name: 'J101', squadId: '101' }],
  rosters: [{
    classId: 'J101',
    squadId: '101',
    updatedAt: '2026-08-30T22:00:00.000Z',
    students: [{ no: '001', chName: '张三', enName: 'Sam' }],
  }],
  failures: [],
  updatedAt: '2026-08-30T22:00:00.000Z',
  lastCompleteAt: '2026-08-30T22:00:00.000Z',
  totalStudents: 1,
};

describe('rosterSnapshotService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    savePreciseStudentListMock.mockReset();
  });

  it('reads the saved snapshot before requesting a homepage refresh', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'success', snapshot }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'success', snapshot, deduplicated: false }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    expect((await getRosterSnapshot()).snapshot?.totalStudents).toBe(1);
    expect((await refreshRosterSnapshot('homepage')).snapshot?.rosters).toHaveLength(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/data/roster-snapshot');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/data/roster-snapshot/refresh');
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({ reason: 'homepage' });
  });

  it('writes snapshot rosters into the existing precise-list cache', () => {
    expect(applyRosterSnapshot(snapshot)).toEqual({ classCount: 1, studentCount: 1 });
    expect(savePreciseStudentListMock).toHaveBeenCalledWith('J101', [{
      studentId: '001',
      chineseName: '张三',
      englishName: 'Sam',
    }]);
  });

  it('shows the generated snapshot time separately from the last complete refresh', () => {
    const partialSnapshot = { ...snapshot, updatedAt: '2026-08-31T00:30:00.000Z' };
    expect(formatRosterSnapshotGeneratedTime(partialSnapshot)).not.toBe(formatRosterSnapshotTime(partialSnapshot));
    expect(formatRosterSnapshotGeneratedTime(null)).toBe('');
  });

  it('keeps the fallback snapshot on refresh errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: 'upstream failed',
      snapshot,
    }), { status: 502 })));

    await expect(refreshRosterSnapshot('manual')).rejects.toMatchObject({
      status: 502,
      snapshot,
    } satisfies Partial<RosterSnapshotApiError>);
  });

  it('separates classes with tasks from resolved empty classes', () => {
    const preparedSnapshot: RosterSnapshot = {
      ...snapshot,
      classes: [
        { id: 'J101', name: 'J101' },
        { id: 'J102', name: 'J102' },
        { id: 'J103', name: 'J103' },
      ],
      dailyReportTasks: [
        { classId: 'J101', weekTasks: [{ id: 'w1', name: 'Week 1', resourceCount: 2 }], updatedAt: snapshot.updatedAt },
        { classId: 'J102', weekTasks: [], updatedAt: snapshot.updatedAt },
      ],
      taskFailures: [{ classId: 'J103', error: 'upstream failed' }],
      speakingChallenges: [
        { classId: 'J101', challengeId: 'opening', rangeStart: '2026-08-31', rangeEnd: '2026-09-02', studentCount: 1, updatedAt: snapshot.updatedAt },
      ],
    };

    expect(summarizeRosterSnapshot(preparedSnapshot)).toEqual({
      checkedTaskClassCount: 2,
      taskDataClassCount: 1,
      taskEmptyClassCount: 1,
      taskFailureClassCount: 1,
      speakingClassCount: 1,
      speakingFailureClassCount: 0,
    });
    expect(getPreparedDailyReportStates(preparedSnapshot, preparedSnapshot.classes)).toMatchObject({
      J101: { state: 'ready-data', taskCount: 1 },
      J102: { state: 'ready-empty', taskCount: 0 },
      J103: { state: 'failed', error: 'upstream failed' },
    });
  });
});
