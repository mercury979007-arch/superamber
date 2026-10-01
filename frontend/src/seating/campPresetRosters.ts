export interface CampPresetStudent {
  id: string;
  chineseName: string;
  englishName: string;
  period: string;
  camp: string;
  teacher: string;
  teacher2: string;
  wordScore: number | null;
  dialogueScore: number | null;
  observationNote: string;
  analysis: string;
  genderHint?: CampPresetGenderHint;
}

export interface CampPresetRoster {
  key: string;
  majorCamp: 'L2' | 'L3';
  period: string;
  camp: string;
  label: string;
  teacher: string;
  teacher2: string;
  students: CampPresetStudent[];
}

// Real camp rosters are private runtime data and are never committed.
export const CAMP_PRESET_ROSTERS: CampPresetRoster[] = [];

const ANALYSIS_SCORE: Record<string, number> = {
  '惊艳瞬间': 3,
  '稳定加速': 2,
  '弯道超车': 1,
};

export type CampPresetGenderHint = 'male' | 'female' | 'unknown';

export const inferCampPresetGenderHint = (
  student: Pick<CampPresetStudent, 'genderHint'>,
): CampPresetGenderHint => student.genderHint || 'unknown';

export const campPresetGenderStats = (
  students: CampPresetStudent[],
): Record<CampPresetGenderHint, number> =>
  students.reduce<Record<CampPresetGenderHint, number>>((stats, student) => {
    stats[inferCampPresetGenderHint(student)] += 1;
    return stats;
  }, { male: 0, female: 0, unknown: 0 });

export const formatCampPresetStudentName = (student: CampPresetStudent): string =>
  student.englishName.trim() || student.chineseName.trim();

const abilityScore = (student: CampPresetStudent): number => {
  const scores = [student.wordScore, student.dialogueScore]
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const average = scores.length > 0
    ? scores.reduce((sum, value) => sum + value, 0) / scores.length
    : 0;
  return average * 10 + (ANALYSIS_SCORE[student.analysis] || 0);
};

const targetGroupSizes = (studentCount: number, groupCount: number): number[] => {
  const base = Math.floor(studentCount / groupCount);
  const extra = studentCount % groupCount;
  return Array.from({ length: groupCount }, (_, index) => base + (index < extra ? 1 : 0));
};

export const buildBalancedCampPresetGroups = (
  students: CampPresetStudent[],
  groupCount: 6 | 8,
  groupSize = 8,
): string[][] => {
  if (students.length > groupCount * groupSize) {
    throw new Error(`当前名单 ${students.length} 人，${groupCount}组最多只能容纳 ${groupCount * groupSize} 人`);
  }

  const sorted = [...students].sort((a, b) => {
    const scoreDiff = abilityScore(b) - abilityScore(a);
    if (scoreDiff !== 0) return scoreDiff;
    return formatCampPresetStudentName(a).localeCompare(formatCampPresetStudentName(b), 'zh-Hans-CN');
  });
  const targets = targetGroupSizes(students.length, groupCount);
  const groups = Array.from({ length: groupCount }, () => [] as string[]);
  const abilityTotals = Array.from({ length: groupCount }, () => 0);
  const genderCounts = Array.from({ length: groupCount }, () => ({ male: 0, female: 0 }));

  sorted.forEach((student) => {
    const gender = inferCampPresetGenderHint(student);
    let bestIndex = -1;
    let bestScore = Number.POSITIVE_INFINITY;

    groups.forEach((group, groupIndex) => {
      if (group.length >= targets[groupIndex]) return;
      const sizePressure = (group.length / Math.max(targets[groupIndex], 1)) * 100;
      const abilityPressure = abilityTotals[groupIndex] * 0.85;
      const genderPressure = gender === 'unknown' ? 0 : genderCounts[groupIndex][gender] * 12;
      const candidateScore = sizePressure + abilityPressure + genderPressure + groupIndex * 0.01;
      if (candidateScore < bestScore) {
        bestScore = candidateScore;
        bestIndex = groupIndex;
      }
    });

    if (bestIndex >= 0) {
      groups[bestIndex].push(formatCampPresetStudentName(student));
      abilityTotals[bestIndex] += abilityScore(student);
      if (gender !== 'unknown') genderCounts[bestIndex][gender] += 1;
    }
  });

  return groups.map(group =>
    [...group, ...Array(Math.max(0, groupSize - group.length)).fill('')].slice(0, groupSize),
  );
};

export const findCampPresetRoster = (key: string): CampPresetRoster | undefined =>
  CAMP_PRESET_ROSTERS.find(roster => roster.key === key);

export const getCampPresetRosterPhase = (rosterOrPeriod: CampPresetRoster | string): number | null => {
  const period = typeof rosterOrPeriod === 'string' ? rosterOrPeriod : rosterOrPeriod.period;
  if (period.includes('第二期')) return 2;
  if (period.includes('第一期')) return 1;
  return null;
};

export const getCampPresetRostersForMajorAndPhase = (
  majorCamp: string,
  phaseIndex: number,
): CampPresetRoster[] =>
  CAMP_PRESET_ROSTERS.filter(roster =>
    roster.majorCamp === majorCamp && getCampPresetRosterPhase(roster) === phaseIndex,
  );
