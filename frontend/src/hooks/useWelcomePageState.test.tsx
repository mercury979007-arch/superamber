import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let mockSeatingDateKeys = ['2026-04-14'];

vi.mock('../utils/weekNumber', () => ({
  getCurrentWeek: () => 6,
  getWeek1StartDate: () => new Date('2026-03-09T00:00:00'),
  getWeekRange: (week: number) => {
    const start = new Date(`2026-04-${String(week === 6 ? 13 : 20).padStart(2, '0')}T00:00:00`);
    const end = new Date(`2026-04-${String(week === 6 ? 19 : 26).padStart(2, '0')}T23:59:59`);
    return { start, end };
  },
}));

vi.mock('../utils/classProfiles', () => ({
  listKnownClassCodes: () => [],
  savePreciseStudentList: vi.fn(),
}));

vi.mock('../utils/classScheduleMeta', () => ({
  getBundledScheduleMetaMap: () => ({}),
  saveScheduleMetaForClasses: () => ({ matchedClassCount: 0, keptClassCount: 0 }),
}));

vi.mock('../services/weeklyRotationService', () => ({
  hasRotatedThisWeek: () => false,
  performWeeklyRotation: () => ({ classCount: 1, undoAvailable: true }),
  getLastRotationInfo: () => null,
  getSeatingClassCount: () => 2,
  getSeatingDateKeys: () => mockSeatingDateKeys,
  getWeeklyRotationPlan: () => mockSeatingDateKeys.length ? ({ sourceWeek: 6, targetWeek: 7, classCount: 1 }) : null,
  undoWeeklyRotation: () => true,
}));

vi.mock('../services/academicTermLaunchService', () => ({
  runAcademicTermLaunch: () => Promise.resolve({
    shouldCelebrate: false,
    performed: false,
    classCount: 0,
    week1Start: '2026-08-31',
    alreadyReady: true,
    cloudSynced: true,
  }),
}));

vi.mock('../services/welcomeViewModels', () => ({
  buildWelcomeClassCards: (classes: Array<{ id: string; name: string }>) => classes.map((classInfo) => ({
    classInfo,
    days: ['周三'],
    studentCount: 10,
  })),
  buildWelcomeDayGroups: () => [{
    day: '周三',
    classes: [{
      classInfo: { id: '1', name: 'J101' },
      time: '18:20',
      studentCount: 10,
    }],
  }],
}));

vi.mock('./useVersionStatus', () => ({
  useVersionStatus: () => ({
    versionInfo: {
      environment: 'test',
      version: 'build-123',
      commit: 'abc1234',
      deployedAt: '2026-04-14T09:30:00.000Z',
      fingerprint: 'test:build-123:abc1234:2026-04-14T09:30:00.000Z',
    },
    currentFingerprint: 'build-123',
    latestFingerprint: 'build-123',
    hasUpdate: false,
    shouldShow: true,
    refreshing: false,
    autoReloadBlocked: false,
    reloadToLatestVersion: vi.fn(),
  }),
}));

import { useWelcomePageState } from './useWelcomePageState';

const flushEffects = async () => {
  await vi.advanceTimersByTimeAsync(20);
};
type WelcomePageStateSnapshot = Pick<
  ReturnType<typeof useWelcomePageState>,
  'versionInfo' | 'classCards' | 'setView' | 'daySchedule' | 'rotationPanelState' | 'batchFetchStatus' | 'batchFetchDone' | 'batchFetchBusy' | 'batchFetchStartedAt' | 'batchFetchDurationSeconds' | 'batchFetchRevision' | 'handleReLoginSuccess'
>;

describe('useWelcomePageState', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-13T09:00:00'));
    vi.stubGlobal('fetch', vi.fn());
    mockSeatingDateKeys = ['2026-04-14'];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('loads visible version info and keeps day view data in the hook layer', async () => {
    let snapshot: WelcomePageStateSnapshot | null = null;

    function Harness() {
      snapshot = useWelcomePageState([{ id: '1', name: 'J101' }]);
      return null;
    }

    const container = document.createElement('div');
    const root = createRoot(container);

    flushSync(() => {
      root.render(<Harness />);
    });
    await flushEffects();
    await flushEffects();

    expect(snapshot).not.toBeNull();
    const current = snapshot!;

    expect(current.versionInfo?.environment).toBe('test');
    expect(current.classCards).toHaveLength(1);

    flushSync(() => {
      current.setView('byDate');
    });
    await flushEffects();
    const updated = snapshot!;

    expect(updated.daySchedule[0]?.day).toBe('周三');
    expect(updated.rotationPanelState).toBe('rotation-current');

    root.unmount();
  });

  it('does not claim generated seating when no local plan exists', async () => {
    mockSeatingDateKeys = [];
    let snapshot: WelcomePageStateSnapshot | null = null;

    function Harness() {
      snapshot = useWelcomePageState([{ id: '1', name: 'J101' }]);
      return null;
    }

    const container = document.createElement('div');
    const root = createRoot(container);

    flushSync(() => {
      root.render(<Harness />);
    });
    await flushEffects();

    expect(snapshot).not.toBeNull();
    expect(snapshot!.rotationPanelState).toBe('rotation-current');

    root.unmount();
  });

  it('opens weekly rotation on Sunday when next-week seating is not ready yet', async () => {
    vi.setSystemTime(new Date('2026-04-19T09:00:00'));
    mockSeatingDateKeys = ['2026-04-14'];
    let snapshot: WelcomePageStateSnapshot | null = null;

    function Harness() {
      snapshot = useWelcomePageState([{ id: '1', name: 'J101' }]);
      return null;
    }

    const container = document.createElement('div');
    const root = createRoot(container);

    flushSync(() => {
      root.render(<Harness />);
    });
    await flushEffects();

    expect(snapshot).not.toBeNull();
    expect(snapshot!.rotationPanelState).toBe('rotation-ready');

    root.unmount();
  });

  it('allows manual completion when current-week and next-week dates coexist', async () => {
    vi.setSystemTime(new Date('2026-04-19T09:00:00'));
    mockSeatingDateKeys = ['2026-04-14', '2026-04-21'];
    let snapshot: WelcomePageStateSnapshot | null = null;

    function Harness() {
      snapshot = useWelcomePageState([{ id: '1', name: 'J101' }]);
      return null;
    }

    const container = document.createElement('div');
    const root = createRoot(container);
    flushSync(() => root.render(<Harness />));
    await flushEffects();

    expect(snapshot).not.toBeNull();
    expect(snapshot!.rotationPanelState).toBe('rotation-ready');
    root.unmount();
  });

  it('blocks a plan more than one week ahead even on Sunday', async () => {
    vi.setSystemTime(new Date('2026-04-12T09:00:00'));
    mockSeatingDateKeys = ['2026-04-14'];
    let snapshot: WelcomePageStateSnapshot | null = null;

    function Harness() {
      snapshot = useWelcomePageState([{ id: '1', name: 'J101' }]);
      return null;
    }

    const container = document.createElement('div');
    const root = createRoot(container);

    flushSync(() => {
      root.render(<Harness />);
    });
    await flushEffects();

    expect(snapshot).not.toBeNull();
    expect(snapshot!.rotationPanelState).toBe('rotation-current');

    root.unmount();
  });

  it('loads same-day prepared homepage data without starting another refresh', async () => {
    const cachedSnapshot = {
      context: { dataDate: '2026-04-13' },
      classes: [{ id: 'J101', name: 'J101', squadId: '101' }],
      rosters: [{
        classId: 'J101',
        squadId: '101',
        students: [{ no: '001', chName: '张三', enName: 'Sam' }],
        updatedAt: '2026-04-13T08:00:00.000Z',
      }],
      failures: [],
      dailyReportTasks: [{
        classId: 'J101',
        weekTasks: [{ id: 'Week 1', name: 'Week 1', resourceCount: 2 }],
        updatedAt: '2026-04-13T08:00:00.000Z',
      }],
      speakingChallenges: [{
        classId: 'J101', challengeId: 'opening', rangeStart: '2026-08-31', rangeEnd: '2026-09-02', studentCount: 1, updatedAt: '2026-04-13T08:00:00.000Z',
      }],
      updatedAt: '2026-04-13T08:00:00.000Z',
      lastCompleteAt: '2026-04-13T08:00:00.000Z',
      totalStudents: 1,
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'success', snapshot: cachedSnapshot }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    let snapshot: WelcomePageStateSnapshot | null = null;

    function Harness() {
      snapshot = useWelcomePageState([{ id: '1', name: 'J101' }]);
      return null;
    }

    const container = document.createElement('div');
    const root = createRoot(container);
    flushSync(() => {
      root.render(<Harness />);
    });
    await flushEffects();
    await flushEffects();

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual(['/api/data/roster-snapshot']);
    expect(snapshot!.batchFetchDone).toBe(true);
    expect(snapshot!.batchFetchStatus).toContain('今日数据已准备：作业 1 个班有数据、0 个班暂无挑战；每日开口 1 个班已更新');
    root.unmount();
  });

  it('retries same-day partial data instead of announcing that all data is ready', async () => {
    const cachedSnapshot = {
      context: { dataDate: '2026-04-13' },
      classes: [{ id: 'J101', name: 'J101', squadId: '101' }],
      rosters: [], failures: [], dailyReportTasks: [], speakingChallenges: [],
      updatedAt: '2026-04-13T08:00:00.000Z', totalStudents: 0,
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'success', state: 'partial', snapshot: cachedSnapshot })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'partial', snapshot: cachedSnapshot })));
    vi.stubGlobal('fetch', fetchMock);
    let snapshot: WelcomePageStateSnapshot | null = null;
    function Harness() {
      snapshot = useWelcomePageState([{ id: '1', name: 'J101' }]);
      return null;
    }
    const root = createRoot(document.createElement('div'));
    flushSync(() => root.render(<Harness />));
    await flushEffects();
    await flushEffects();
    expect(fetchMock.mock.calls.map(call => call[0])).toEqual(['/api/data/roster-snapshot', '/api/data/roster-snapshot/refresh']);
    expect(snapshot!.batchFetchStatus).toContain('今日数据已部分更新');
    expect(snapshot!.batchFetchStatus).not.toContain('今日数据已准备');
    root.unmount();
  });

  it('automatically refreshes after re-login and ignores an older failed refresh', async () => {
    const cachedSnapshot = {
      classes: [{ id: 'J101', name: 'J101', squadId: '101' }],
      rosters: [],
      failures: [],
      dailyReportTasks: [],
      speakingChallenges: [],
      updatedAt: '2026-04-13T08:00:00.000Z',
      lastCompleteAt: null,
      totalStudents: 0,
    };
    const refreshedSnapshot = {
      ...cachedSnapshot,
      dailyReportTasks: [{
        classId: 'J101',
        weekTasks: [{ id: 'Week 1', name: 'Week 1', resourceCount: 2 }],
        updatedAt: '2026-04-13T09:00:00.000Z',
      }],
      speakingChallenges: [{
        classId: 'J101', challengeId: 'opening', rangeStart: '2026-08-31', rangeEnd: '2026-09-02', studentCount: 1, updatedAt: '2026-04-13T09:00:00.000Z',
      }],
      updatedAt: '2026-04-13T09:00:00.000Z',
      lastCompleteAt: '2026-04-13T09:00:00.000Z',
      totalStudents: 0,
    };
    let resolveOldRefresh!: (response: Response) => void;
    const oldRefresh = new Promise<Response>((resolve) => { resolveOldRefresh = resolve; });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'success', snapshot: cachedSnapshot }), { status: 200 }))
      .mockImplementationOnce(() => oldRefresh)
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'success', snapshot: refreshedSnapshot }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    let snapshot: WelcomePageStateSnapshot | null = null;

    function Harness() {
      snapshot = useWelcomePageState([{ id: '1', name: 'J101' }]);
      return null;
    }

    const container = document.createElement('div');
    const root = createRoot(container);
    flushSync(() => {
      root.render(<Harness />);
    });
    await flushEffects();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    flushSync(() => {
      snapshot!.handleReLoginSuccess([{ id: '1', name: 'J101' }]);
    });
    await flushEffects();
    await flushEffects();

    expect(fetchMock.mock.calls[2]?.[0]).toBe('/api/data/roster-snapshot/refresh');
    expect(snapshot!.batchFetchStatus).toContain('刷新完成：作业 1 个班有数据、0 个班暂无挑战；每日开口 1 个班已更新');
    expect(snapshot!.batchFetchDone).toBe(true);
    expect(snapshot!.batchFetchBusy).toBe(false);
    expect(snapshot!.batchFetchStartedAt).toBeGreaterThanOrEqual(new Date('2026-04-13T09:00:00').getTime());
    expect(snapshot!.batchFetchDurationSeconds).toBe(1);
    expect(snapshot!.batchFetchRevision).toBe(1);

    resolveOldRefresh(new Response(JSON.stringify({ error: '未登录，请先登录' }), { status: 401 }));
    await flushEffects();

    expect(snapshot!.batchFetchStatus).toContain('刷新完成：作业 1 个班有数据、0 个班暂无挑战；每日开口 1 个班已更新');
    expect(snapshot!.batchFetchStatus).not.toContain('登录已过期');
    root.unmount();
  });
});
