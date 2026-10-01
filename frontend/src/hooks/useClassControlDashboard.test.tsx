import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useClassControlDashboard } from './useClassControlDashboard';
import type { RosterSnapshot } from '../services/rosterSnapshotService';

const classes = [
  { id: 'J101', name: 'J101' },
  { id: 'J102', name: 'J102' },
];

const preparedSnapshot: RosterSnapshot = {
  context: { dataDate: '2026-09-02' },
  classes,
  rosters: [],
  failures: [],
  dailyReportTasks: [
    {
      classId: 'J101',
      preferredSemester: '2026学年秋季学期',
      weekTasks: [{ id: 'w1', name: 'Week 1', resourceCount: 2 }],
      updatedAt: '2026-09-02T06:51:00.000Z',
    },
    {
      classId: 'J102',
      preferredSemester: '2026学年秋季学期',
      weekTasks: [],
      updatedAt: '2026-09-02T06:51:00.000Z',
    },
  ],
  speakingChallenges: [],
  updatedAt: '2026-09-02T06:51:00.000Z',
  lastCompleteAt: '2026-09-02T06:51:00.000Z',
  totalStudents: 0,
};

describe('useClassControlDashboard prepared snapshot integration', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('analyzes only classes with prepared tasks and resolves empty classes without a request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: 'success',
      summary: {
        classId: 'J101',
        preferredSemester: '2026学年秋季学期',
        historical: false,
        taskState: 'ready',
        taskCount: 1,
        review: null,
        current: null,
        updatedAt: '2026-09-02T06:52:00.000Z',
      },
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    let dashboard!: ReturnType<typeof useClassControlDashboard>;
    function Harness() {
      dashboard = useClassControlDashboard(classes, 'Amber', undefined, preparedSnapshot);
      return null;
    }

    const root = createRoot(document.createElement('div'));
    flushSync(() => root.render(<Harness />));
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(dashboard.preparedTaskStates).toMatchObject({
      J101: { state: 'ready-data' },
      J102: { state: 'ready-empty' },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ classId: 'J101', includeTrend: false });
    root.unmount();
  });

  it('pauses prepared multi-class reads while the class report tab has priority', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    function Harness() {
      useClassControlDashboard(classes, 'Amber', undefined, preparedSnapshot, false);
      return null;
    }

    const root = createRoot(document.createElement('div'));
    flushSync(() => root.render(<Harness />));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(fetchMock).not.toHaveBeenCalled();
    root.unmount();
  });

  it('loads missing overview summaries when the overview tab becomes active even without a prepared snapshot', async () => {
    const fetchMock = vi.fn().mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const classId = JSON.parse(String(init?.body || '{}')).classId;
      return new Response(JSON.stringify({
        status: 'success',
        summary: {
          classId,
          preferredSemester: '2026学年秋季学期',
          historical: false,
          taskState: 'ready',
          taskCount: 1,
          review: null,
          current: null,
          updatedAt: '2026-09-02T07:00:00.000Z',
        },
      }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    function Harness({ active }: { active: boolean }) {
      useClassControlDashboard(classes, 'Amber', undefined, null, active);
      return null;
    }

    const root = createRoot(document.createElement('div'));
    flushSync(() => root.render(<Harness active={false}/>));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchMock).not.toHaveBeenCalled();
    flushSync(() => root.render(<Harness active/>));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls.map((call) => JSON.parse(String(call[1]?.body)).classId).sort()).toEqual(['J101', 'J102']);
    root.unmount();
  });
});
