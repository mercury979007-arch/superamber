import { describe, expect, it } from 'vitest';
import type { OverviewContent, PhaseChallengeRow } from '../types/overview';
import {
  formatDisplayNames,
  moveStudentToTierRows,
  parseStudentNames,
  syncOverviewContent,
} from './overviewContentRules';

function makePhaseRow(
  key: PhaseChallengeRow['key'],
  selectedStudents: string[] = [],
): PhaseChallengeRow {
  return {
    id: key,
    key,
    label: key,
    selectedStudents,
    challengeContent: '',
    method: '',
  };
}

function makeContent(): OverviewContent {
  return {
    classCode: 'TEST',
    week: 1,
    theme: 'green',
    challengeStartDay: '周一',
    weeklyChallenges: [
      { day: '周一', task: 'A' },
      { day: '周二', task: '' },
    ],
    phaseChallenges: [
      makePhaseRow('夯实基础', ['Amy']),
      makePhaseRow('维稳达标', []),
      makePhaseRow('突破拔高', []),
    ],
    challengeItems: [],
    listeningMaterials: [],
    listeningFont: 'guide',
    communicationPlan: {
      groups: [
        {
          id: 'g1',
          label: '第1组',
          selectedStudents: ['Amy', 'Ghost'],
          teacherName: '',
          scheduleText: '',
          note: '',
        },
      ],
      selectedStudents: ['Amy', 'Ghost'],
      teacherName: '',
      scheduleText: '',
      note: '',
    },
    customBlocks: [],
  };
}

describe('overviewContentRules', () => {
  it('parses pasted student names and strips numbering noise', () => {
    expect(parseStudentNames('1. Amy\n2、 Bob；3) Cindy')).toEqual(['Amy', 'Bob', 'Cindy']);
  });

  it('syncs overview content by assigning unassigned students and pruning stale communication selections', () => {
    const synced = syncOverviewContent(makeContent(), ['周二', '周三'], ['Amy', 'Bob']);
    expect(synced.weeklyChallenges.map((item) => item.day)).toEqual(['周二', '周三']);
    expect(synced.phaseChallenges.find((row) => row.key === '维稳达标')?.selectedStudents).toEqual(['Bob']);
    expect(synced.communicationPlan.groups[0]?.selectedStudents).toEqual(['Amy']);
  });

  it('moves students between tiers and formats preview names by english display order', () => {
    const rows = moveStudentToTierRows([
      makePhaseRow('夯实基础', ['Amy']),
      makePhaseRow('维稳达标', ['Bob']),
      makePhaseRow('突破拔高', []),
    ], 'Amy', '突破拔高');

    expect(rows.find((row) => row.key === '夯实基础')?.selectedStudents).toEqual([]);
    expect(rows.find((row) => row.key === '突破拔高')?.selectedStudents).toEqual(['Amy']);

    const englishNameMap = new Map([
      ['Amy', 'Zoey'],
      ['Bob', 'Alice'],
    ]);
    expect(formatDisplayNames(['Amy', 'Bob'], englishNameMap)).toBe('Alice、Zoey');
  });
});
