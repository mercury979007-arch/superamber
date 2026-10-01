import type { CnfSquadSummary } from './cnfSync';
import { normalizeStudentList } from './layouts';

interface AmberClassProfileStudent {
  chineseName?: string;
  englishName?: string;
}

interface AmberClassProfile {
  classCode?: string;
  students?: AmberClassProfileStudent[];
}

export interface RosterDiff {
  missing: string[];
  extra: string[];
}

const STORAGE_KEY = 'amber_class_profiles';

function normalizeClassLookup(value: string): string {
  return String(value || '').trim().replace(/\s+/g, '').toUpperCase();
}

export function extractRosterStudents(raw: unknown): string[] {
  return normalizeStudentList(
    Array.isArray(raw)
      ? raw.map((student) => {
          const record = student as { enName?: unknown; chName?: unknown; displayName?: unknown };
          const en = String(record?.enName || '').trim();
          const ch = String(record?.chName || '').trim();
          const display = String(record?.displayName || '').trim();
          return en || ch || display;
        }).filter(Boolean)
      : [],
  );
}

export function saveKnownRosterForClass(
  className: string,
  students: string[],
  options: { preserveDuplicates?: boolean } = {},
): void {
  const normalizedClassName = className.trim().toUpperCase();
  if (!normalizedClassName || students.length === 0) return;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const profiles = raw ? JSON.parse(raw) as AmberClassProfile[] : [];
    const normalizedStudents = normalizeStudentList(students);
    const savedStudents = options.preserveDuplicates
      ? normalizedStudents
      : [...new Set(normalizedStudents)];
    const nextStudents = savedStudents.map((name) => {
      const isEnglish = /^[A-Za-z][A-Za-z' -]*$/.test(name);
      return isEnglish
        ? { englishName: name, chineseName: '' }
        : { englishName: '', chineseName: name };
    });

    const existingIndex = profiles.findIndex((profile) =>
      String(profile?.classCode || '').trim().toUpperCase() === normalizedClassName,
    );

    if (existingIndex >= 0) {
      profiles[existingIndex] = {
        ...profiles[existingIndex],
        classCode: normalizedClassName,
        students: nextStudents,
      };
    } else {
      profiles.push({
        classCode: normalizedClassName,
        students: nextStudents,
      });
    }

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles));
  } catch {
    // Ignore storage write errors; importing into seating still works.
  }
}

export function loadKnownRosterForClass(className: string): string[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const profiles = JSON.parse(raw) as AmberClassProfile[];
    const matched = profiles.find((profile) =>
      String(profile?.classCode || '').trim().toUpperCase() === className.trim().toUpperCase(),
    );

    return normalizeStudentList(
      Array.isArray(matched?.students)
        ? matched.students.map((student) => {
            const en = String(student?.englishName || '').trim();
            const ch = String(student?.chineseName || '').trim();
            return en || ch;
          }).filter(Boolean)
        : [],
    );
  } catch {
    return [];
  }
}

export function mergeStudentListsByMaxCount(...lists: string[][]): string[] {
  const order: string[] = [];
  const maxCounts = new Map<string, number>();

  lists.forEach((list) => {
    const counts = new Map<string, number>();
    normalizeStudentList(list).forEach((name) => {
      if (!maxCounts.has(name) && !counts.has(name)) {
        order.push(name);
      }
      counts.set(name, (counts.get(name) || 0) + 1);
    });

    counts.forEach((count, name) => {
      maxCounts.set(name, Math.max(maxCounts.get(name) || 0, count));
    });
  });

  return order.flatMap((name) => Array(maxCounts.get(name) || 0).fill(name));
}

export function findMatchingCnfSquad(
  squads: CnfSquadSummary[],
  className: string,
): CnfSquadSummary | null {
  const target = normalizeClassLookup(className);
  if (!target) return null;

  const exact = squads.find((squad) =>
    [squad.name, squad.section, squad.group].some((part) => normalizeClassLookup(String(part || '')) === target),
  );
  if (exact) return exact;

  return squads.find((squad) =>
    [squad.name, squad.section, squad.group].some((part) => normalizeClassLookup(String(part || '')).includes(target)),
  ) || null;
}

export function computeRosterDiff(rosterNames: string[], currentStudents: string[]): RosterDiff {
  const countByName = (names: string[]): Map<string, number> => {
    const counts = new Map<string, number>();
    normalizeStudentList(names).forEach((name) => {
      counts.set(name, (counts.get(name) || 0) + 1);
    });
    return counts;
  };
  const consume = (counts: Map<string, number>, name: string): boolean => {
    const count = counts.get(name) || 0;
    if (count <= 0) {
      return false;
    }
    counts.set(name, count - 1);
    return true;
  };

  const roster = normalizeStudentList(rosterNames);
  const seating = normalizeStudentList(currentStudents);
  const seatingCounts = countByName(seating);
  const rosterCounts = countByName(roster);

  return {
    missing: roster.filter((name) => !consume(seatingCounts, name)),
    extra: seating.filter((name) => !consume(rosterCounts, name)),
  };
}
