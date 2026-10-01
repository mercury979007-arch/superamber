import type { ClassProfile, StudentInfo } from '../types';
import { loadMergedSeatingClassData } from '../services/seatingStorage';

const STORAGE_KEY = 'amber_class_profiles';

const STUDENT_NOISE_PATTERNS: RegExp[] = [
  /^[:：\d\s.()（）\-_/\\]+$/,
  /^(?:rows?|row|circular|four|weekday|weekend|layout|theme|paper|table|column|columns|header|footer|page|sheet|student|students|class|classroom|teacher|campus)$/i,
  /(?:校区|座位|名单|班级|教室|课表|课堂|上课|下课|调课|排课)/,
  /(?:周[一二三四五六日天]|星期[一二三四五六日天]|上午|下午|晚上|早上|中午)/,
  /^\d{1,2}:\d{2}$/,
];

export function loadClassProfiles(): ClassProfile[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as ClassProfile[];
  } catch {
    return [];
  }
}

function saveAll(profiles: ClassProfile[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles));
}

function normalizeClassCode(classCode: string): string {
  return String(classCode || '').trim().toUpperCase();
}

function normalizeStudentName(raw: unknown): string {
  return String(raw ?? '')
    .replace(/\s+/g, ' ')
    .replace(/^[\d.、)\]-]+\s*/, '')
    .replace(/\s*[.。,，;；:：]+$/, '')
    .trim();
}

function isLikelyStudentName(raw: unknown): boolean {
  const normalized = normalizeStudentName(raw);
  if (!normalized) return false;
  if (normalized.length < 2 || normalized.length > 24) return false;
  if (STUDENT_NOISE_PATTERNS.some((pattern) => pattern.test(normalized))) return false;

  const hasChinese = /[\u4e00-\u9fff]/.test(normalized);
  const looksEnglishName = /^[A-Za-z][A-Za-z' -]*$/.test(normalized);
  if (!hasChinese && !looksEnglishName) return false;
  if (looksEnglishName && normalized.split(/\s+/).length > 3) return false;

  return true;
}

export function compareStudentNames(a: string, b: string): number {
  return a.localeCompare(b, 'zh-Hans-CN', { sensitivity: 'base', numeric: true });
}

export function sortStudentNames(names: string[]): string[] {
  return [...new Set(names.map((name) => normalizeStudentName(name)).filter((name) => name && isLikelyStudentName(name)))]
    .sort(compareStudentNames);
}

function sortStudents(students: StudentInfo[]): StudentInfo[] {
  return [...students].sort((a, b) => compareStudentNames(a.chineseName, b.chineseName));
}

function normalizeAliasKey(raw: unknown): string {
  return normalizeStudentName(raw).toLowerCase();
}

function buildCanonicalNameMap(students: StudentInfo[]): Map<string, string> {
  const aliases = new Map<string, string>();

  for (const student of students) {
    const canonical = normalizeStudentName(student.chineseName);
    if (!canonical) continue;

    aliases.set(normalizeAliasKey(canonical), canonical);

    const englishName = normalizeStudentName(student.englishName || '');
    if (englishName) {
      aliases.set(normalizeAliasKey(englishName), canonical);
    }

    for (const alias of student.aliases || []) {
      const normalized = normalizeStudentName(alias);
      if (normalized) {
        aliases.set(normalizeAliasKey(normalized), canonical);
      }
    }
  }

  return aliases;
}

function canonicalizeStudentName(name: string, aliases: Map<string, string>): string {
  const normalized = normalizeStudentName(name);
  if (!normalized) return '';
  return aliases.get(normalizeAliasKey(normalized)) || normalized;
}

export function getClassProfile(classCode: string): ClassProfile | null {
  const normalized = normalizeClassCode(classCode);
  return loadClassProfiles().find((p) => normalizeClassCode(p.classCode) === normalized) ?? null;
}

export function saveClassProfile(profile: ClassProfile): void {
  const all = loadClassProfiles();
  const idx = all.findIndex((p) => normalizeClassCode(p.classCode) === normalizeClassCode(profile.classCode));
  if (idx >= 0) all[idx] = profile;
  else all.push(profile);
  saveAll(all);
}

export function updateClassProfile(classCode: string, updates: Partial<Omit<ClassProfile, 'classCode'>>): ClassProfile {
  const existing = getClassProfile(classCode) ?? {
    classCode: normalizeClassCode(classCode),
    schedule: [],
    students: [],
    updatedAt: Date.now(),
  };
  const updated = { ...existing, ...updates, updatedAt: Date.now() };
  saveClassProfile(updated);
  return updated;
}

/**
 * Merge new students into existing list. Returns added students for notification.
 * Does NOT auto-remove — discrepancy alerts are UI-level, not data-level.
 */
export function mergeStudents(
  classCode: string,
  incoming: StudentInfo[],
): { profile: ClassProfile; added: StudentInfo[] } {
  const profile = getClassProfile(classCode) ?? {
    classCode: normalizeClassCode(classCode),
    schedule: [],
    students: [],
    updatedAt: Date.now(),
  };

  const existingNames = new Map(profile.students.map((s) => [normalizeStudentName(s.chineseName), s]));
  const added: StudentInfo[] = [];

  for (const s of incoming) {
    const cleanName = normalizeStudentName(s.chineseName);
    if (!isLikelyStudentName(cleanName)) continue;

    const existing = existingNames.get(cleanName);
    if (!existing) {
      const next = { ...s, chineseName: cleanName };
      profile.students.push(next);
      existingNames.set(cleanName, next);
      added.push(next);
    } else {
      existing.studentId = existing.studentId || s.studentId;
      existing.englishName = existing.englishName || s.englishName;
      existing.aliases = [...new Set([...(existing.aliases || []), ...(s.aliases || [])])];
    }
  }

  if (added.length > 0 || incoming.length > 0) {
    profile.updatedAt = Date.now();
    profile.students = sortStudents(profile.students);
    saveClassProfile(profile);
  }

  return { profile, added };
}

export function getStudentCount(classCode: string): number {
  return getClassProfile(classCode)?.students.length ?? 0;
}

function collectNamesFromGroups(groups: unknown): string[] {
  if (!Array.isArray(groups)) return [];
  return groups.flatMap((group) =>
    Array.isArray(group)
      ? group.map((name) => String(name ?? '').trim()).filter(Boolean)
      : [],
  );
}

function collectNamesFromRowGroups(rowGroups: unknown): string[] {
  if (!rowGroups || typeof rowGroups !== 'object') return [];
  const rows = (rowGroups as { rows?: Array<{ left?: unknown[]; right?: unknown[] }> }).rows;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => [
    ...((Array.isArray(row.left) ? row.left : []).map((name) => String(name ?? '').trim()).filter(Boolean)),
    ...((Array.isArray(row.right) ? row.right : []).map((name) => String(name ?? '').trim()).filter(Boolean)),
  ]);
}

function collectNamesFromArcGroups(arcGroups: unknown): string[] {
  if (!arcGroups || typeof arcGroups !== 'object') return [];
  const rows = (arcGroups as { rows?: unknown[] }).rows;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => collectNamesFromGroups(row));
}

type SeatingDataMap = Record<string, unknown>;

function loadMergedSeatingData(): SeatingDataMap {
  return loadMergedSeatingClassData() as SeatingDataMap;
}

export function getStudentsFromSeating(classCode: string): StudentInfo[] {
  try {
    const data = loadMergedSeatingData() as Record<string, {
      weekday?: { groups?: unknown; rowGroups?: unknown; arcGroups?: unknown };
      weekend?: { groups?: unknown; rowGroups?: unknown; arcGroups?: unknown };
    }>;
    if (Object.keys(data).length === 0) return [];
    const matchedKey = resolveSeatingKey(classCode);
    if (!matchedKey) return [];

    const config = data[matchedKey];
    const names = [
      ...collectNamesFromGroups(config?.weekday?.groups),
      ...collectNamesFromGroups(config?.weekend?.groups),
      ...collectNamesFromRowGroups(config?.weekday?.rowGroups),
      ...collectNamesFromRowGroups(config?.weekend?.rowGroups),
      ...collectNamesFromArcGroups(config?.weekday?.arcGroups),
      ...collectNamesFromArcGroups(config?.weekend?.arcGroups),
    ];

    const uniqueNames = sortStudentNames(names);
    return uniqueNames
      .filter(isLikelyStudentName)
      .map((name, index) => ({
        id: `seat_${matchedKey}_${index}_${name}`,
        chineseName: name,
      }));
  } catch {
    return [];
  }
}

export function getResolvedStudents(classCode: string): StudentInfo[] {
  const profileStudents = sortStudents((getClassProfile(classCode)?.students ?? []).filter((student) =>
    isLikelyStudentName(student.chineseName),
  ));
  const canonicalNames = buildCanonicalNameMap(profileStudents);
  const mergedNames = new Map<string, StudentInfo>();

  for (const student of [...profileStudents, ...getStudentsFromSeating(classCode), ...getStudentsFromSeatingData(classCode)]) {
    const cleanName = canonicalizeStudentName(student.chineseName, canonicalNames);
    if (!isLikelyStudentName(cleanName)) continue;

    const existing = mergedNames.get(cleanName);
    if (!existing) {
      mergedNames.set(cleanName, { ...student, chineseName: cleanName });
      continue;
    }

    mergedNames.set(cleanName, {
      ...existing,
      studentId: existing.studentId || student.studentId,
      englishName: existing.englishName || student.englishName,
      aliases: [...new Set([...(existing.aliases || []), ...(student.aliases || [])])],
    });
  }

  return sortStudents([...mergedNames.values()]);
}

export function importStudentNames(classCode: string, names: string[]): StudentInfo[] {
  const cleaned = sortStudentNames(names);
  if (cleaned.length === 0) return getResolvedStudents(classCode);

  const incoming: StudentInfo[] = cleaned.map((name, index) => ({
    id: `manual_${classCode}_${Date.now()}_${index}`,
    chineseName: name,
  }));

  mergeStudents(classCode, incoming);
  return getResolvedStudents(classCode);
}

function createStudentRecord(classCode: string, chineseName: string): StudentInfo {
  return {
    id: `${normalizeClassCode(classCode)}_${chineseName}`.replace(/\s+/g, '_'),
    chineseName,
  };
}

function createPreciseStudentRecord(
  classCode: string,
  studentId: string,
  chineseName: string,
  englishName = '',
): StudentInfo {
  const normalizedCode = normalizeClassCode(classCode);
  const cleanId = studentId.trim();
  return {
    id: cleanId ? `${normalizedCode}_${cleanId}` : `${normalizedCode}_${chineseName}`.replace(/\s+/g, '_'),
    studentId: cleanId || undefined,
    chineseName: chineseName.trim(),
    englishName: englishName.trim() || undefined,
    aliases: [],
  };
}

function collectNamesFromValue(value: unknown, names: Set<string>): void {
  if (typeof value === 'string') {
    const normalized = normalizeStudentName(value);
    if (isLikelyStudentName(normalized)) names.add(normalized);
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) collectNamesFromValue(item, names);
    return;
  }

  if (value && typeof value === 'object') {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      collectNamesFromValue(nested, names);
    }
  }
}

export function getStudentsFromSeatingData(classCode: string): StudentInfo[] {
  try {
    const all = loadMergedSeatingData();
    if (Object.keys(all).length === 0) return [];
    const resolvedKey = Object.keys(all).find((key) => key.toUpperCase() === classCode.toUpperCase());
    if (!resolvedKey) return [];

    const names = new Set<string>();
    const payload = all[resolvedKey] as { rosterMirror?: Array<{ chineseName?: string }> } | undefined;
    const explicitRoster = Array.isArray(payload?.rosterMirror) ? payload.rosterMirror : [];

    for (const student of explicitRoster) {
      const chineseName = normalizeStudentName(student?.chineseName);
      if (isLikelyStudentName(chineseName)) {
        names.add(chineseName);
      }
    }

    collectNamesFromValue(payload, names);

    return sortStudentNames([...names])
      .filter(isLikelyStudentName)
      .map((name) => createStudentRecord(classCode, name));
  } catch {
    return [];
  }
}

export function getAvailableStudents(classCode: string): StudentInfo[] {
  const profileStudents = sortStudents((getClassProfile(classCode)?.students ?? []).filter((student) =>
    isLikelyStudentName(student.chineseName),
  ));
  if (profileStudents.length > 0) return profileStudents;
  return sortStudents(getStudentsFromSeatingData(classCode));
}

export function saveStudentList(classCode: string, studentNames: string[]): ClassProfile {
  const uniqueNames = sortStudentNames(studentNames);
  return updateClassProfile(classCode, {
    students: uniqueNames.map((name) => createStudentRecord(classCode, name)),
  });
}

export function savePreciseStudentList(
  classCode: string,
  students: Array<{ studentId?: string; chineseName: string; englishName?: string }>,
): ClassProfile {
  const normalizedCode = normalizeClassCode(classCode);
  const cleaned = students
    .map((student) => ({
      studentId: String(student.studentId || '').trim(),
      chineseName: normalizeStudentName(student.chineseName),
      englishName: String(student.englishName || '').trim(),
    }))
    .filter((student) => student.chineseName && isLikelyStudentName(student.chineseName));

  const deduped = new Map<string, StudentInfo>();
  for (const student of cleaned) {
    deduped.set(
      student.chineseName,
      createPreciseStudentRecord(normalizedCode, student.studentId, student.chineseName, student.englishName),
    );
  }

  return updateClassProfile(normalizedCode, {
    students: sortStudents([...deduped.values()]),
  });
}

export function upsertPreciseStudents(
  classCode: string,
  students: Array<{ studentId?: string; chineseName: string; englishName?: string }>,
): ClassProfile {
  const incoming = students
    .map((student) => createPreciseStudentRecord(classCode, String(student.studentId || ''), student.chineseName, student.englishName))
    .filter((student) => isLikelyStudentName(student.chineseName));
  mergeStudents(classCode, incoming);
  return getClassProfile(classCode) ?? updateClassProfile(classCode, {});
}

export function removeStudentFromClass(classCode: string, studentKey: string): ClassProfile | null {
  const profile = getClassProfile(classCode);
  if (!profile) return null;
  profile.students = profile.students.filter(
    (student) => student.id !== studentKey && student.studentId !== studentKey && student.chineseName !== studentKey,
  );
  profile.updatedAt = Date.now();
  saveClassProfile(profile);
  return profile;
}

export function listKnownClassCodes(classCodes: string[] = []): string[] {
  const known = new Set(classCodes.map((item) => normalizeClassCode(item)).filter(Boolean));
  for (const profile of loadClassProfiles()) {
    known.add(normalizeClassCode(profile.classCode));
  }
  for (const classCode of Object.keys(loadMergedSeatingData())) {
    known.add(normalizeClassCode(classCode));
  }
  return [...known].filter(Boolean).sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
}

export function hasSeatingData(classCode: string): boolean {
  try {
    const data = loadMergedSeatingData();
    if (Object.keys(data).length === 0) return false;
    // Case-insensitive match: scraper uppercases class codes, but seating app
    // may store them in original case from user input
    const upper = classCode.toUpperCase();
    return Object.keys(data).some((key) => key.toUpperCase() === upper);
  } catch {
    return false;
  }
}

/** Find the actual key used in classSeatingData for a given class code (case-insensitive) */
export function resolveSeatingKey(classCode: string): string | null {
  try {
    const data = loadMergedSeatingData();
    if (Object.keys(data).length === 0) return null;
    const upper = classCode.toUpperCase();
    return Object.keys(data).find((key) => key.toUpperCase() === upper) ?? null;
  } catch {
    return null;
  }
}
