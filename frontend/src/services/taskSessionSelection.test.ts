import { describe, expect, it } from 'vitest';
import { recommendTasksForMatchingSession } from './taskSessionSelection';

const sessions = [
  { day: '周二', time: '18:00', campus: '', room: '', source: 'schedule' },
  { day: '周六', time: '09:00', campus: '', room: '', source: 'schedule' },
] as const;

describe('recommendTasksForMatchingSession', () => {
  it('previews J328 latest real activity when a new class has no preceding session', () => {
    const result = recommendTasksForMatchingSession({
      sessions: [{...sessions[0], day: '周一'}, {...sessions[1], day: '周日'}],
      now: new Date('2026-09-07T02:00:00Z'), defaultSelectedWeekIds: ['safety'],
      tasks: [
        {id: 'week1', name: 'Week1', skuId: '5', resourceCount: 2, startAt: '2026-09-06 12:00:00'},
        {id: 'safety', name: '安全第一课', skuId: '38', resourceCount: 1, startAt: '2026-09-07 00:00:00'},
      ],
    });
    expect(result.selectedWeekIds).toEqual(['week1']);
    expect(result.confidence).toBe('fallback');
    expect(result.reason).toContain('最近可用的落实挑战');
  });
  it('uses K218 real catalog dates without falling forward to this week safety lesson', () => {
    const result = recommendTasksForMatchingSession({
      sessions: [...sessions], now: new Date('2026-09-07T02:00:00Z'),
      defaultSelectedWeekIds: ['task-21484'],
      tasks: [
        { id: 'task-21433', name: '开学第一课NBC', resourceCount: 1, startAt: '2026-08-31 15:37:00' },
        { id: 'task-21459', name: 'Weather1引入', resourceCount: 1, startAt: '2026-09-05 08:30:00' },
        { id: 'task-21484', name: '安全第一课', resourceCount: 1, startAt: '2026-09-07 00:00:00' },
        { id: 'task-21420', name: '开学第一课（BC版）', resourceCount: 5, startAt: '2026-08-30 18:00:00', studentVisible: false },
      ],
    });
    expect(result.selectedWeekIds).toEqual(['task-21433']);
    expect(result.previousMatchingSessionDate).toBe('2026-09-01');
    expect(result.confidence).toBe('fallback');
    expect(result.reason).toContain('2026-08-31');
  });

  it('does not use a later Saturday or current Monday when previous Tuesday is absent', () => {
    const result = recommendTasksForMatchingSession({
      sessions: [...sessions], now: new Date('2026-09-07T02:00:00Z'),
      defaultSelectedWeekIds: ['new'],
      tasks: [
        { id: 'sat', name: '周六挑战', resourceCount: 2, startAt: '2026-09-05 08:30:00' },
        { id: 'new', name: '本周新挑战', resourceCount: 1, startAt: '2026-09-07 00:00:00' },
      ],
    });
    expect(result.selectedWeekIds).toEqual([]);
  });
  it('matches Tuesday only for a Tuesday and does not include Saturday', () => {
    const result = recommendTasksForMatchingSession({
      sessions: [...sessions],
      now: new Date('2026-09-08T02:00:00Z'),
      tasks: [
        { id: 'tue', name: '周二任务', resourceCount: 2, startAt: '2026-09-01 18:00:00' },
        { id: 'sat', name: '周六任务', resourceCount: 2, startAt: '2026-09-05 09:00:00' },
      ],
    });
    expect(result.selectedWeekIds).toEqual(['tue']);
    expect(result.previousMatchingSessionDate).toBe('2026-09-01');
    expect(result.needsConfirmation).toBe(false);
  });

  it('keeps same-session duplicate rounds available and requires confirmation', () => {
    const result = recommendTasksForMatchingSession({
      sessions: [...sessions],
      now: new Date('2026-09-08T02:00:00Z'),
      tasks: [
        { id: 'round-a', name: '第一轮', resourceCount: 2, startAt: '2026-09-01 18:00:00' },
        { id: 'round-b', name: '第二轮', resourceCount: 3, startAt: '2026-09-01 18:00:00' },
      ],
    });
    expect(result.selectedWeekIds).toEqual(['round-a', 'round-b']);
    expect(result.needsConfirmation).toBe(true);
  });

  it('uses the existing recommendation only as an explicit fallback', () => {
    const result = recommendTasksForMatchingSession({
      sessions: [...sessions],
      now: new Date('2026-09-08T02:00:00Z'),
      defaultSelectedWeekIds: ['legacy'],
      tasks: [{ id: 'legacy', name: '系统推荐', resourceCount: 1, startAt: '2026-08-20 10:00:00' }],
    });
    expect(result.selectedWeekIds).toEqual(['legacy']);
    expect(result.confidence).toBe('fallback');
    expect(result.needsConfirmation).toBe(true);
  });
});
