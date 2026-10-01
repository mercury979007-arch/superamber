import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/classProfiles', () => ({
  getClassProfile: vi.fn(),
}));

import { getClassProfile } from '../utils/classProfiles';
import {
  buildQuickTemplateRows,
  loadQuickRoster,
  mergeQuickDraftRewards,
  parseQuickChineseRewardText,
  parseQuickEnglishRewardText,
  resolveQuickRewards,
  saveQuickRoster,
  sortStudentList,
} from './distributionQuickFlow';

const mockedGetClassProfile = vi.mocked(getClassProfile);

describe('distributionQuickFlow', () => {
  beforeEach(() => {
    localStorage.clear();
    mockedGetClassProfile.mockReset();
  });

  it('parses chinese and english quick reward text', () => {
    expect(parseQuickChineseRewardText('Alice、Bob 2')).toEqual([
      { name: 'Alice', amount: 2 },
      { name: 'Bob', amount: 2 },
    ]);

    expect(parseQuickEnglishRewardText('Alice, Bob, Charlie 1.5')).toEqual([
      { name: 'Alice', amount: 1.5 },
      { name: 'Bob', amount: 1.5 },
      { name: 'Charlie', amount: 1.5 },
    ]);
  });

  it('merges repeated rewards and resolves names against the remembered roster', () => {
    const roster = [
      { studentId: '1', chineseName: '艾丽丝', englishName: 'Alice', classCode: 'J101' },
      { studentId: '2', chineseName: '鲍勃', englishName: 'Bob', classCode: 'J101' },
    ];

    const { resolved, missingNames, ambiguousNames } = resolveQuickRewards(
      roster,
      [
        { name: 'Alice', amount: 1 },
        { name: 'Bob', amount: 2 },
        { name: 'Carol', amount: 3 },
      ],
      'english',
    );

    const merged = mergeQuickDraftRewards(resolved, [
      { ...resolved[0], amount: 0.5 },
    ]);

    expect(missingNames).toEqual(['Carol']);
    expect(ambiguousNames).toEqual([]);
    expect(merged[0]?.amount).toBe(1.5);
    expect(merged[1]?.amount).toBe(2);
  });

  it('prefers class profile roster over cached quick roster and can build template rows', () => {
    mockedGetClassProfile.mockReturnValue({
      classCode: 'J101',
      schedule: [],
      students: [
        { id: '1', studentId: '1', chineseName: '艾丽丝', englishName: 'Alice' },
      ],
      updatedAt: Date.now(),
    });

    saveQuickRoster('J101', [{
      studentId: '9',
      chineseName: '缓存学生',
      englishName: 'Cache',
      classCode: 'J101',
      resources: [],
      dailyCheckIns: 0,
      classParticipation: 0,
      bonusItems: [],
    }]);

    const roster = loadQuickRoster('J101');
    const { students, mpMap } = buildQuickTemplateRows([
      { studentId: '1', chineseName: '艾丽丝', englishName: 'Alice', classCode: 'J101', amount: 2 },
    ]);

    expect(roster).toHaveLength(1);
    expect(roster[0]?.englishName).toBe('Alice');
    expect(students[0]?.studentId).toBe('1');
    expect(mpMap.get('1')).toBe(2);
  });

  it('sorts remembered students by english name for quick picker mode', () => {
    const sorted = sortStudentList([
      { studentId: '2', chineseName: '鲍勃', englishName: 'Bob', classCode: 'J101' },
      { studentId: '1', chineseName: '艾丽丝', englishName: 'Alice', classCode: 'J101' },
    ], 'en_asc');

    expect(sorted.map((item) => item.englishName)).toEqual(['Alice', 'Bob']);
  });
});
