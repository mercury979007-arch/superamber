import { describe, expect, it, vi } from 'vitest';

vi.mock('../utils/classProfiles', () => ({
  getStudentCount: (classCode: string) => (classCode === 'J101' ? 12 : 8),
}));

vi.mock('../utils/classSchedule', () => ({
  ALL_DAYS: ['周一', '周二', '周三', '周四', '周五', '周六', '周日'],
  sortClassesBySchedule: (classes: Array<{ id: string; name: string }>) => [...classes].reverse(),
  getClassDays: (classCode: string) => (classCode === 'J101' ? ['周三'] : ['周五']),
  getClassTimeOnDay: (classCode: string, day: string) => `${classCode}-${day}-18:20`,
  getResolvedSchedule: () => ({
    周一: [],
    周二: [],
    周三: ['J101'],
    周四: [],
    周五: ['K202'],
    周六: [],
    周日: [],
  }),
}));

import { buildWelcomeClassCards, buildWelcomeDayGroups } from './welcomeViewModels';

describe('welcomeViewModels', () => {
  it('builds class cards outside the Welcome component', () => {
    const cards = buildWelcomeClassCards([
      { id: '1', name: 'J101' },
      { id: '2', name: 'K202' },
    ]);

    expect(cards.map((item) => item.classInfo.name)).toEqual(['K202', 'J101']);
    expect(cards[1]?.days).toEqual(['周三']);
    expect(cards[1]?.studentCount).toBe(12);
  });

  it('builds date groups from resolved schedule matches', () => {
    const groups = buildWelcomeDayGroups([
      { id: '1', name: 'J101' },
      { id: '2', name: 'K202' },
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0]?.day).toBe('周三');
    expect(groups[0]?.classes[0]?.time).toBe('J101-周三-18:20');
    expect(groups[1]?.classes[0]?.studentCount).toBe(8);
  });
});
