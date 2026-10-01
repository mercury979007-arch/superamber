import type { StudentData, StudentRecord } from '../types';
import { getClassProfile } from '../utils/classProfiles';

const QUICK_ROSTER_KEY = 'amber_mp_quick_rosters_v1';

export type QuickInputMode = 'chinese' | 'english' | 'picker';
export type StudentSortKey = 'en_asc' | 'en_desc' | 'zh_asc' | 'zh_desc';

export interface QuickDraftReward extends StudentRecord {
  amount: number;
}

export interface QuickResolveIssue {
  name: string;
  matches: StudentRecord[];
}

export const STUDENT_SORT_OPTIONS: Array<{ key: StudentSortKey; label: string }> = [
  { key: 'en_asc', label: '英文名 A→Z' },
  { key: 'en_desc', label: '英文名 Z→A' },
];

export function normalizeStudentName(raw: string): string {
  return String(raw || '').replace(/\s+/g, ' ').trim();
}

function normalizeStudentKey(raw: string): string {
  return normalizeStudentName(raw).toLowerCase();
}

function compareStudentListItem(
  a: Pick<StudentRecord, 'chineseName' | 'englishName'>,
  b: Pick<StudentRecord, 'chineseName' | 'englishName'>,
  sortKey: StudentSortKey,
): number {
  const englishA = normalizeStudentName(a.englishName || '');
  const englishB = normalizeStudentName(b.englishName || '');
  const chineseA = normalizeStudentName(a.chineseName || '');
  const chineseB = normalizeStudentName(b.chineseName || '');

  switch (sortKey) {
    case 'en_desc':
      return (englishB || chineseB).localeCompare(englishA || chineseA, 'en', { sensitivity: 'base' })
        || chineseA.localeCompare(chineseB, 'zh-Hans-CN');
    case 'zh_asc':
      return chineseA.localeCompare(chineseB, 'zh-Hans-CN')
        || (englishA || chineseA).localeCompare(englishB || chineseB, 'en', { sensitivity: 'base' });
    case 'zh_desc':
      return chineseB.localeCompare(chineseA, 'zh-Hans-CN')
        || (englishA || chineseA).localeCompare(englishB || chineseB, 'en', { sensitivity: 'base' });
    case 'en_asc':
    default:
      return (englishA || chineseA).localeCompare(englishB || chineseB, 'en', { sensitivity: 'base' })
        || chineseA.localeCompare(chineseB, 'zh-Hans-CN');
  }
}

export function sortStudentList<T extends Pick<StudentRecord, 'chineseName' | 'englishName'>>(
  items: T[],
  sortKey: StudentSortKey,
): T[] {
  return [...items].sort((a, b) => compareStudentListItem(a, b, sortKey));
}

export function saveQuickRoster(classCode: string, students: StudentData[]): void {
  try {
    const key = String(classCode || '').trim().toUpperCase();
    if (!key || students.length === 0) return;
    const raw = localStorage.getItem(QUICK_ROSTER_KEY);
    const all = raw ? JSON.parse(raw) as Record<string, StudentRecord[]> : {};
    all[key] = students.map((student) => ({
      studentId: student.studentId,
      chineseName: student.chineseName,
      englishName: student.englishName,
      classCode: key,
    }));
    localStorage.setItem(QUICK_ROSTER_KEY, JSON.stringify(all));
  } catch {
    // Ignore storage errors.
  }
}

export function loadQuickRoster(classCode: string): StudentRecord[] {
  try {
    const key = String(classCode || '').trim().toUpperCase();
    if (!key) return [];

    const profileRoster = (getClassProfile(key)?.students || [])
      .filter((student) => student.studentId)
      .map((student) => ({
        studentId: String(student.studentId || ''),
        chineseName: student.chineseName,
        englishName: student.englishName || '',
        classCode: key,
      }));
    if (profileRoster.length > 0) {
      return profileRoster;
    }

    const raw = localStorage.getItem(QUICK_ROSTER_KEY);
    const all = raw ? JSON.parse(raw) as Record<string, StudentRecord[]> : {};
    return Array.isArray(all[key]) ? all[key] : [];
  } catch {
    return [];
  }
}

function parseQuickLineItems(raw: string, splitter: RegExp): Array<{ name: string; amount: number }> {
  return raw
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const match = line.match(/^(.+?)[\s,，:：\-]+(-?\d+(?:\.\d+)?)$/);
      if (!match) return [];

      const amount = Number(match[2]);
      return match[1]
        .split(splitter)
        .map((item) => normalizeStudentName(item))
        .filter(Boolean)
        .map((name) => ({ name, amount }));
    })
    .filter((item) => Boolean(item.name));
}

export function parseQuickChineseRewardText(raw: string): Array<{ name: string; amount: number }> {
  return parseQuickLineItems(raw, /[、,，/／]+|\s+/);
}

export function parseQuickEnglishRewardText(raw: string): Array<{ name: string; amount: number }> {
  return raw
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const match = line.match(/^(.+?)(?:[\s,，:：\-]+)?(-?\d+(?:\.\d+)?)$/);
      if (!match) return [];

      const amount = Number(match[2]);
      return match[1]
        .split(/[、,，;；/／]+/)
        .map((item) => normalizeStudentName(item))
        .filter(Boolean)
        .map((name) => ({ name, amount }));
    })
    .filter((item) => Boolean(item.name));
}

export function mergeQuickDraftRewards(existing: QuickDraftReward[], incoming: QuickDraftReward[]): QuickDraftReward[] {
  const merged = new Map<string, QuickDraftReward>();

  for (const reward of [...existing, ...incoming]) {
    const current = merged.get(reward.studentId);
    if (!current) {
      merged.set(reward.studentId, { ...reward });
      continue;
    }
    merged.set(reward.studentId, {
      ...current,
      amount: Number((current.amount + reward.amount).toFixed(2)),
    });
  }

  return [...merged.values()].sort((a, b) => a.chineseName.localeCompare(b.chineseName, 'zh-Hans-CN'));
}

export function resolveQuickRewards(
  roster: StudentRecord[],
  rewards: Array<{ name: string; amount: number }>,
  mode: Exclude<QuickInputMode, 'picker'>,
): {
  resolved: QuickDraftReward[];
  missingNames: string[];
  ambiguousNames: QuickResolveIssue[];
} {
  const byChinese = new Map<string, StudentRecord[]>();
  const byEnglish = new Map<string, StudentRecord[]>();

  for (const student of roster) {
    const chineseKey = normalizeStudentKey(student.chineseName);
    if (chineseKey) {
      if (!byChinese.has(chineseKey)) byChinese.set(chineseKey, []);
      byChinese.get(chineseKey)?.push(student);
    }

    const englishKey = normalizeStudentKey(student.englishName);
    if (englishKey) {
      if (!byEnglish.has(englishKey)) byEnglish.set(englishKey, []);
      byEnglish.get(englishKey)?.push(student);
    }
  }

  const resolved: QuickDraftReward[] = [];
  const missingNames: string[] = [];
  const ambiguousNames: QuickResolveIssue[] = [];

  for (const reward of rewards) {
    const key = normalizeStudentKey(reward.name);
    const preferredMatches = (mode === 'english' ? byEnglish : byChinese).get(key) || [];
    const fallbackMatches = (mode === 'english' ? byChinese : byEnglish).get(key) || [];
    const matches = preferredMatches.length > 0 ? preferredMatches : fallbackMatches;

    if (matches.length === 0) {
      missingNames.push(reward.name);
      continue;
    }

    if (matches.length > 1) {
      ambiguousNames.push({ name: reward.name, matches });
      continue;
    }

    const hit = matches[0];
    resolved.push({
      studentId: hit.studentId,
      chineseName: hit.chineseName,
      englishName: hit.englishName,
      classCode: hit.classCode,
      amount: reward.amount,
    });
  }

  return { resolved, missingNames, ambiguousNames };
}

export function buildQuickTemplateRows(rewards: QuickDraftReward[]): {
  students: StudentData[];
  mpMap: Map<string, number>;
} {
  const students: StudentData[] = rewards.map((reward) => ({
    studentId: reward.studentId,
    chineseName: reward.chineseName,
    englishName: reward.englishName || '',
    classCode: reward.classCode,
    resources: [],
    dailyCheckIns: 0,
    classParticipation: 0,
    bonusItems: [],
  }));

  const mpMap = new Map(rewards.map((reward) => [reward.studentId, reward.amount]));
  return { students, mpMap };
}
