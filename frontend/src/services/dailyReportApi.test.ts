import { describe, expect, it, vi } from 'vitest';
import { ensureDailyReportSession, fetchAutoWeekTasks } from './dailyReportApi';

describe('dailyReportApi', () => {
  it('normalizes auto week task payloads', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        weekTasks: [
          { id: 'week-1', name: 'Week 1', resourceCount: 3, addedAt: '2026-06-01' },
          { id: '', name: 'ignore-me', resourceCount: 0 },
        ],
        preferredSemester: '2026学年春季学期',
        defaultSelectedWeekIds: ['week-1', null],
        defaultCheckinRange: { start: '2026-05-26', end: '2026-06-01' },
        source: 'snapshot',
        updatedAt: '2026-08-30T08:00:00.000Z',
      }),
    });

    await expect(fetchAutoWeekTasks('J101', fetchMock as never)).resolves.toEqual({
      weekTasks: [
        { id: 'week-1', name: 'Week 1', resourceCount: 3, addedAt: '2026-06-01' },
      ],
      preferredSemester: '2026学年春季学期',
      defaultSelectedWeekIds: ['week-1'],
      defaultCheckinRange: { start: '2026-05-26', end: '2026-06-01' },
      source: 'snapshot',
      updatedAt: '2026-08-30T08:00:00.000Z',
    });
  });

  it('returns login status and username from health payload', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        loggedIn: true,
        username: 'Amber',
      }),
    });

    await expect(ensureDailyReportSession(fetchMock as never)).resolves.toEqual({
      loggedIn: true,
      username: 'Amber',
    });
  });
});
