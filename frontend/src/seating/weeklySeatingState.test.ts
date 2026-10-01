import { describe, expect, it } from 'vitest';
import { makeClassShell, makeModeData } from './state';
import type { ClassConfig, ClassSnapshot } from './types';
import { buildWeeklyRotatedClassData, restorePreviousWeekConfig } from './weeklySeatingState';

describe('weeklySeatingState', () => {
  it('builds a rotated class map while storing previous-week snapshots', () => {
    const classConfig = makeClassShell('circular', 'mint') as ClassConfig;
    classConfig.weekday.currentArrangement = 2;
    classConfig.weekday.locationInfo.fullDate = '2026-04-14';
    classConfig.weekend.currentArrangement = 4;
    classConfig.weekend.locationInfo.fullDate = '2026-04-19';
    classConfig.cnf = {
      squadId: '12',
      squadType: 'offline',
      sessionToken: 'token',
      loginUsername: 'amber',
      lastSyncedAt: '2026-04-14T00:00:00.000Z',
    };
    classConfig.todoNotes = [
      {
        id: 'todo-1',
        text: '发资料',
        dueDate: '2026-04-14',
        source: 'weekly',
        completed: false,
        createdAt: '2026-04-14T00:00:00.000Z',
        completedAt: null,
      },
    ];

    const rotated = buildWeeklyRotatedClassData(
      { J101: classConfig },
      {
        snapshotFromConfig: (config) => ({
          theme: config.theme,
          weekday: structuredClone(config.weekday),
          weekend: structuredClone(config.weekend),
        }),
        rotateSingleClassMode: (mode) => ({
          ...structuredClone(mode),
          currentArrangement: mode.currentArrangement + 1,
          locationInfo: {
            ...mode.locationInfo,
            fullDate: `${mode.locationInfo.fullDate}-next`,
          },
        }),
      },
    );

    expect(rotated.J101.previousWeek?.weekday.currentArrangement).toBe(2);
    expect(rotated.J101.previousWeek?.weekend.currentArrangement).toBe(4);
    expect(rotated.J101.weekday.currentArrangement).toBe(3);
    expect(rotated.J101.weekday.locationInfo.fullDate).toBe('2026-04-14-next');
    expect(rotated.J101.cnf?.squadId).toBe('12');
    expect(rotated.J101.todoNotes).toHaveLength(1);
  });

  it('restores previous-week seating while swapping the current snapshot into history', () => {
    const current = makeClassShell('circular', 'paper') as ClassConfig;
    current.weekday.currentArrangement = 1;
    current.weekday.locationInfo.fullDate = '2026-04-21';
    current.previousWeek = {
      theme: 'classic',
      weekday: {
        ...makeModeData('rows'),
        currentArrangement: 7,
        locationInfo: {
          ...makeModeData('rows').locationInfo,
          fullDate: '2026-04-14',
        },
      },
      weekend: makeModeData('four'),
    } as ClassSnapshot;

    const restored = restorePreviousWeekConfig(current, {
      snapshotFromConfig: (config) => ({
        theme: config.theme,
        weekday: structuredClone(config.weekday),
        weekend: structuredClone(config.weekend),
      }),
      sanitizeClassSnapshot: (snapshot) => snapshot as ClassSnapshot,
    });

    expect(restored?.theme).toBe('classic');
    expect(restored?.weekday.layout).toBe('rows');
    expect(restored?.weekday.currentArrangement).toBe(7);
    expect(restored?.previousWeek?.theme).toBe('paper');
    expect(restored?.previousWeek?.weekday.currentArrangement).toBe(1);
  });
});
