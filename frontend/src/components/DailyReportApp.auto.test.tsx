import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMocks = vi.hoisted(() => ({
  ensureDailyReportSession: vi.fn(),
  fetchAutoWeekTasks: vi.fn(),
  requestAutoDailyReport: vi.fn(),
  requestUploadDailyReport: vi.fn(),
}));

vi.mock('../services/dailyReportApi', () => apiMocks);

import DailyReportApp from './DailyReportApp';

describe('DailyReportApp automatic task snapshots', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.ensureDailyReportSession.mockResolvedValue({ loggedIn: true, username: 'Amber' });
    apiMocks.fetchAutoWeekTasks.mockResolvedValue({
      weekTasks: [{ id: 'Week1', name: 'Week 1', resourceCount: 4, addedAt: '2026-08-31' }],
      preferredSemester: '2026学年秋季学期',
      defaultSelectedWeekIds: ['Week1'],
      defaultCheckinRange: { start: '2026-08-31', end: '2026-09-06' },
      source: 'snapshot',
      updatedAt: '2026-08-30T08:00:00.000Z',
    });
  });

  it('loads week tasks on entry and does not render a read-tasks button', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    flushSync(() => {
      root.render(
        <DailyReportApp
          classInfo={{ id: 'K339', name: 'K339' }}
          onBack={() => {}}
          onBackToHome={() => {}}
        />,
      );
    });
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(apiMocks.fetchAutoWeekTasks).toHaveBeenCalledWith('K339');
    expect(Array.from(container.querySelectorAll('button')).some((button) => button.textContent?.includes('读取周任务'))).toBe(false);
    expect(container.textContent).toContain('Week 1');
    expect(container.textContent).toContain('已自动载入主页预抓数据');
    root.unmount();
  });

  it('labels historical official data without mixing in the current term date', async () => {
    apiMocks.fetchAutoWeekTasks.mockResolvedValue({
      weekTasks: [
        { id: 'Week2', name: 'Week2', resourceCount: 5, addedAt: '2026-07-26' },
        { id: 'Week3', name: 'Week3', resourceCount: 5, addedAt: '2026-08-01' },
        { id: 'Week4', name: 'Week4', resourceCount: 5, addedAt: '2026-08-09' },
      ],
      preferredSemester: '2026学年春季学期',
      defaultSelectedWeekIds: ['Week4'],
      defaultCheckinRange: { start: '2026-08-31', end: '2026-09-06' },
      source: 'snapshot',
      updatedAt: '2026-08-30T08:00:00.000Z',
    });
    const container = document.createElement('div');
    const root = createRoot(container);
    flushSync(() => {
      root.render(
        <DailyReportApp
          classInfo={{ id: 'K339', name: 'K339' }}
          onBack={() => {}}
          onBackToHome={() => {}}
        />,
      );
    });
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(container.textContent).toContain('历史只读验证数据源：2026学年春季学期');
    expect(container.textContent).toContain('当前勾选：Week4（2026-08-09）');
    expect(container.textContent).not.toContain('默认勾选 Week 1');
    root.unmount();
  });
});
