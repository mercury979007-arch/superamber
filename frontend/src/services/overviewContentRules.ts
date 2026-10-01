import type { DayOfWeek, StudentInfo } from '../types';
import type {
  CommunicationGroup,
  CustomBlock,
  OverviewContent,
  PhaseChallengeKey,
  PhaseChallengeRow,
} from '../types/overview';
import { ALL_DAYS } from '../utils/classSchedule';
import { sortStudentNames } from '../utils/classProfiles';
import { normalizeCommunicationPlan, syncPhaseChallenges, syncWeeklyChallengeDays } from '../utils/overviewData';

export type StudentPickerTone = 'neutral' | 'foundation' | 'steady' | 'boost';

export const PHASE_TIER_ORDER: PhaseChallengeKey[] = ['突破拔高', '维稳达标', '夯实基础'];

export function parseStudentNames(raw: string): string[] {
  return sortStudentNames(
    raw
      .split(/[\n,，、;；]+/)
      .map((item) => item.replace(/^[\d.、)\]-]+\s*/, '').trim())
      .filter(Boolean),
  );
}

export function orderDaysFromStart(startDay: string): string[] {
  const startIndex = ALL_DAYS.indexOf(startDay as typeof ALL_DAYS[number]);
  if (startIndex === -1) return [...ALL_DAYS];
  return [...ALL_DAYS.slice(startIndex), ...ALL_DAYS.slice(0, startIndex)];
}

export function hasWeeklyChallenges(content: OverviewContent): boolean {
  return content.weeklyChallenges.some((item) => item.task.trim());
}

export function hasCommunicationPlan(content: OverviewContent): boolean {
  return content.communicationPlan.groups.some((group) =>
    group.selectedStudents.length > 0 ||
    group.teacherName.trim() ||
    group.scheduleText.trim() ||
    group.note.trim(),
  );
}

export function getPhaseTone(key: PhaseChallengeRow['key']): StudentPickerTone {
  if (key === '突破拔高') return 'boost';
  if (key === '维稳达标') return 'steady';
  return 'foundation';
}

export function createEnglishNameMap(resolvedStudents: StudentInfo[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const student of resolvedStudents) {
    if (student.englishName) {
      map.set(student.chineseName, student.englishName);
    }
  }
  return map;
}

export function formatDisplayName(chineseName: string, englishNameMap: Map<string, string>): string {
  return englishNameMap.get(chineseName) || chineseName;
}

export function formatDisplayNames(chineseNames: string[], englishNameMap: Map<string, string>): string {
  return [...chineseNames]
    .map((name) => ({ name, display: formatDisplayName(name, englishNameMap) }))
    .sort((a, b) => a.display.localeCompare(b.display, 'en', { sensitivity: 'base' }))
    .map((item) => item.display)
    .join('、');
}

export function createCommunicationGroup(overrides: Partial<CommunicationGroup> = {}): CommunicationGroup {
  return {
    id: `comm_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    label: '第1组',
    selectedStudents: [],
    teacherName: '',
    scheduleText: '',
    note: '',
    ...overrides,
  };
}

export function normalizeCommunicationGroups(groups: CommunicationGroup[]): CommunicationGroup[] {
  return (groups.length > 0 ? groups : [createCommunicationGroup()]).map((group) => ({
    ...group,
    selectedStudents: sortStudentNames(group.selectedStudents),
  }));
}

export function syncCommunicationPlan(groups: CommunicationGroup[]): OverviewContent['communicationPlan'] {
  const normalizedGroups = normalizeCommunicationGroups(groups);
  return normalizeCommunicationPlan({
    groups: normalizedGroups,
    selectedStudents: normalizedGroups.flatMap((group) => group.selectedStudents),
    teacherName: normalizedGroups[0]?.teacherName ?? '',
    scheduleText: normalizedGroups[0]?.scheduleText ?? '',
    note: normalizedGroups[0]?.note ?? '',
  });
}

export function shouldShowCustomBlock(block: CustomBlock): boolean {
  if (block.mode === 'text') {
    return Boolean(block.text.trim() || (block.title.trim() && block.title.trim() !== '补充内容'));
  }

  if (block.mode === 'table') {
    return block.table.rows.some((row) => row.some((cell) => cell.trim()))
      || Boolean(block.title.trim() && block.title.trim() !== '补充内容');
  }

  return block.media.length > 0 || Boolean(block.title.trim() && block.title.trim() !== '补充内容');
}

export function getStudentPhase(phaseChallenges: PhaseChallengeRow[], name: string): PhaseChallengeRow['key'] | null {
  for (const row of phaseChallenges) {
    if (row.selectedStudents.includes(name)) {
      return row.key;
    }
  }
  return null;
}

export function moveStudentToTierRows(
  phaseChallenges: PhaseChallengeRow[],
  name: string,
  tier: PhaseChallengeRow['key'],
): PhaseChallengeRow[] {
  return phaseChallenges.map((row) => {
    const without = row.selectedStudents.filter((studentName) => studentName !== name);
    if (row.key === tier) {
      return { ...row, selectedStudents: sortStudentNames([...without, name]) };
    }
    return { ...row, selectedStudents: without };
  });
}

export function toggleStudentTierWithMemory(
  phaseChallenges: PhaseChallengeRow[],
  name: string,
  tier: PhaseChallengeRow['key'],
  previousTierMap: Record<string, PhaseChallengeRow['key'] | null>,
): {
  rows: PhaseChallengeRow[];
  previousTierMap: Record<string, PhaseChallengeRow['key'] | null>;
} {
  const currentTier = getStudentPhase(phaseChallenges, name) || '维稳达标';
  if (currentTier === tier) {
    const previousTier = previousTierMap[name];
    if (!previousTier || previousTier === tier) {
      return { rows: phaseChallenges, previousTierMap };
    }
    return {
      rows: moveStudentToTierRows(phaseChallenges, name, previousTier),
      previousTierMap: {
        ...previousTierMap,
        [name]: null,
      },
    };
  }

  return {
    rows: moveStudentToTierRows(phaseChallenges, name, tier),
    previousTierMap: {
      ...previousTierMap,
      [name]: currentTier,
    },
  };
}

export function toggleSortedName(list: string[], name: string): string[] {
  const next = list.includes(name)
    ? list.filter((item) => item !== name)
    : [...list, name];
  return sortStudentNames(next);
}

export function syncOverviewContent(
  current: OverviewContent,
  orderedDays: DayOfWeek[],
  studentNames: string[],
): OverviewContent {
  const nextChallenges = syncWeeklyChallengeDays(current.weeklyChallenges, orderedDays);
  let nextPhases = syncPhaseChallenges(current.phaseChallenges, studentNames);
  const assigned = new Set(nextPhases.flatMap((row) => row.selectedStudents));
  const unassigned = studentNames.filter((name) => !assigned.has(name));
  if (unassigned.length > 0) {
    nextPhases = nextPhases.map((row) =>
      row.key === '维稳达标'
        ? { ...row, selectedStudents: sortStudentNames([...row.selectedStudents, ...unassigned]) }
        : row,
    );
  }

  const nextGroups = normalizeCommunicationGroups(current.communicationPlan.groups).map((group) => ({
    ...group,
    selectedStudents: sortStudentNames(group.selectedStudents.filter((name) => studentNames.includes(name))),
  }));
  const nextCommunicationPlan = syncCommunicationPlan(nextGroups);

  const challengesChanged = nextChallenges.length !== current.weeklyChallenges.length ||
    nextChallenges.some((item, index) => item.day !== current.weeklyChallenges[index]?.day);
  const phasesChanged = nextPhases.some((row, index) =>
    row.selectedStudents.length !== current.phaseChallenges[index]?.selectedStudents.length ||
    row.selectedStudents.some((name, studentIndex) => name !== current.phaseChallenges[index]?.selectedStudents[studentIndex]),
  );
  const selectedChanged = JSON.stringify(nextCommunicationPlan.groups.map((group) => group.selectedStudents))
    !== JSON.stringify(current.communicationPlan.groups.map((group) => group.selectedStudents));

  if (!challengesChanged && !phasesChanged && !selectedChanged) {
    return current;
  }

  return {
    ...current,
    challengeStartDay: current.challengeStartDay || orderedDays[0] || '周一',
    weeklyChallenges: nextChallenges,
    phaseChallenges: nextPhases,
    communicationPlan: nextCommunicationPlan,
  };
}
