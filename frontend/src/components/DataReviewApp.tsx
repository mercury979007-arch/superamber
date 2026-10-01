import { useEffect, useMemo, useState } from 'react';
import type { ClassInfo, StudentInfo } from '../types';
import { getClassProfile, getStudentsFromSeatingData, savePreciseStudentList } from '../utils/classProfiles';
import { getBundledScheduleMetaMap, getClassScheduleMeta, inferThisWeekDate, type ClassScheduleMeta, type ScheduleMetaSlot } from '../utils/classScheduleMeta';
import { loadOverviewRoster, saveOverviewRoster } from '../utils/overviewData';
import { loadMergedSeatingClassData, saveSeatingClassData } from '../services/seatingStorage';
import { getCurrentWeek, getWeekNumberForDate } from '../utils/weekNumber';
import type { ClassData, LocationInfo } from '../seating/types';
import { makeClassShell } from '../seating/state';
import './DataReviewApp.css';

const REVIEW_DRAFT_STORAGE_KEY = 'amber_data_review_field_drafts_v1';
const REVIEW_ROSTER_DRAFT_STORAGE_KEY = 'amber_data_review_roster_drafts_v1';
const REVIEW_MODULE_DRAFT_STORAGE_KEY = 'amber_data_review_module_drafts_v1';
const SCHEDULE_META_STORAGE_KEY = 'amber_class_schedule_meta_v1';

interface Props {
  classes: ClassInfo[];
  teacherName: string;
  onBack: () => void;
  onSessionExpired?: () => void;
}

interface StandardStudent {
  studentId: string;
  chineseName: string;
  englishName: string;
}

interface StandardRosterClass {
  classId: string;
  students: Array<{
    no?: string;
    chName?: string;
    enName?: string;
    studentId?: string;
    chineseName?: string;
    englishName?: string;
  }>;
}

interface ReviewClass {
  classCode: string;
  currentProfile: ReturnType<typeof getClassProfile>;
  currentSchedule: ClassScheduleMeta | null;
  standardSchedule: ClassScheduleMeta | null;
  currentStudents: StudentInfo[];
  standardStudents: StandardStudent[];
  overviewRoster: StudentInfo[];
  seatingRoster: StudentInfo[];
  seatingLocation: LocationInfo | null;
  scheduleRows: ReviewFieldRow[];
  roster: ReviewRosterSummary;
  dateReview: DateReview;
  moduleImpact: ModuleImpact;
  classInfoIssueCount: number;
  rosterIssueCount: number;
  rosterMissingCount: number;
  rosterErrorCount: number;
  moduleIssueCount: number;
  safeCount: number;
  riskCount: number;
}

interface ReviewFieldRow {
  key: string;
  label: string;
  currentValue: string;
  standardValue: string;
  risk: 'safe' | 'warning' | 'risk';
}

interface ReviewRosterSummary {
  rows: ReviewRosterRow[];
  summary: {
    matched: number;
    fillable: number;
    mismatched: number;
    standardMissing: number;
    currentMissingId: number;
    conflicts: number;
  };
}

interface ReviewRosterRow {
  key: string;
  studentId: string;
  currentChinese: string;
  currentEnglish: string;
  standardChinese: string;
  standardEnglish: string;
  status: 'matched' | 'fillable' | 'mismatch' | 'standard-missing' | 'current-missing-id' | 'conflict';
  note: string;
}

interface DateReview {
  baselineWeek: number;
  currentDate: string;
  currentWeek: number | null;
  inferredDate: string;
  inferredWeek: number | null;
  exportWeek: number | null;
  status: 'ok' | 'missing' | 'warning' | 'risk';
  issues: string[];
}

interface ModuleImpact {
  overviewOnly: string[];
  seatingOnly: string[];
  overviewMissingCore: string[];
  seatingMissingCore: string[];
}

type ModuleTarget = 'overview' | 'seating';
type ModuleState = 'ok' | 'missing' | 'error';

type DraftChoice = 'current' | 'standard' | 'manual' | 'skip';
type DraftRecord = Record<string, { choice: DraftChoice; value: string }>;
type RosterDraftRecord = Record<string, { choice: Exclude<DraftChoice, 'skip'>; chineseName: string; englishName: string }>;
type ModuleDraftRecord = Record<string, { choice: 'keep' | 'sync' }>;

function loadStoredJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function saveStoredJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage quota errors in review prototype mode.
  }
}

function normalizeText(value: unknown): string {
  return String(value || '').trim();
}

function normalizeName(value: unknown): string {
  return normalizeText(value).replace(/\s+/g, ' ');
}

function toDateString(date: Date | null): string {
  if (!date || Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function parseDateString(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function buildStudentKey(student: { studentId?: string; chineseName?: string; englishName?: string }): string {
  const studentId = normalizeText(student.studentId);
  if (studentId) return `id:${studentId}`;
  const chineseName = normalizeName(student.chineseName);
  const englishName = normalizeName(student.englishName);
  if (chineseName || englishName) return `name:${chineseName}__${englishName}`;
  return '';
}

function formatStudentLabel(student: { studentId?: string; chineseName?: string; englishName?: string }): string {
  const parts = [normalizeText(student.studentId), normalizeName(student.chineseName), normalizeName(student.englishName)].filter(Boolean);
  return parts.join(' / ') || '未识别身份';
}

function buildStudentKeyMap(students: Array<{ studentId?: string; chineseName?: string; englishName?: string }>): Map<string, string> {
  const map = new Map<string, string>();
  for (const student of students) {
    const key = buildStudentKey(student);
    if (!key) continue;
    map.set(key, formatStudentLabel(student));
  }
  return map;
}

function namesFromStudents(students: Array<{ studentId?: string; chineseName?: string; englishName?: string }>): string[] {
  return students
    .map((student) => buildStudentKey(student))
    .filter(Boolean);
}

function pickPreferredSlot(meta: ClassScheduleMeta | null): ScheduleMetaSlot | null {
  return meta?.weekday || meta?.weekend || null;
}

function buildScheduleRows(currentSchedule: ClassScheduleMeta | null, standardSchedule: ClassScheduleMeta | null): ReviewFieldRow[] {
  const currentSlot = pickPreferredSlot(currentSchedule);
  const standardSlot = pickPreferredSlot(standardSchedule);
  const fields: Array<{ key: keyof ScheduleMetaSlot; label: string }> = [
    { key: 'day', label: '上课日' },
    { key: 'time', label: '上课时间' },
    { key: 'campus', label: '校区' },
    { key: 'floor', label: '楼层' },
    { key: 'room', label: '教室' },
  ];

  return fields.map(({ key, label }) => {
    const currentValue = normalizeText(currentSlot?.[key]);
    const standardValue = normalizeText(standardSlot?.[key]);
    let risk: ReviewFieldRow['risk'] = 'safe';
    if (!currentValue && standardValue) risk = 'safe';
    else if (currentValue && standardValue && currentValue !== standardValue) risk = 'warning';
    else if (!currentValue && !standardValue) risk = 'warning';
    return { key: String(key), label, currentValue, standardValue, risk };
  });
}

function buildRosterSummary(currentStudents: StudentInfo[], standardStudents: StandardStudent[]): ReviewRosterSummary {
  const rows: ReviewRosterRow[] = [];
  const currentGroups = new Map<string, StudentInfo[]>();
  const standardGroups = new Map<string, StandardStudent[]>();
  const currentMissingId = currentStudents.filter((student) => !normalizeText(student.studentId));
  const standardMissingId = standardStudents.filter((student) => !normalizeText(student.studentId));

  for (const student of currentStudents) {
    const studentId = normalizeText(student.studentId);
    if (!studentId) continue;
    const list = currentGroups.get(studentId) || [];
    list.push(student);
    currentGroups.set(studentId, list);
  }

  for (const student of standardStudents) {
    const studentId = normalizeText(student.studentId);
    if (!studentId) continue;
    const list = standardGroups.get(studentId) || [];
    list.push(student);
    standardGroups.set(studentId, list);
  }

  const studentIds = [...new Set([...currentGroups.keys(), ...standardGroups.keys()])].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));

  for (const studentId of studentIds) {
    const currentList = currentGroups.get(studentId) || [];
    const standardList = standardGroups.get(studentId) || [];

    if (currentList.length > 1 || standardList.length > 1) {
      rows.push({
        key: `conflict:${studentId}`,
        studentId,
        currentChinese: currentList.map((item) => normalizeName(item.chineseName)).filter(Boolean).join(' / '),
        currentEnglish: currentList.map((item) => normalizeName(item.englishName)).filter(Boolean).join(' / '),
        standardChinese: standardList.map((item) => normalizeName(item.chineseName)).filter(Boolean).join(' / '),
        standardEnglish: standardList.map((item) => normalizeName(item.englishName)).filter(Boolean).join(' / '),
        status: 'conflict',
        note: '同一个学号在当前或标准数据里出现了重复记录，需要人工处理。',
      });
      continue;
    }

    const current = currentList[0] || null;
    const standard = standardList[0] || null;
    const currentChinese = normalizeName(current?.chineseName);
    const currentEnglish = normalizeName(current?.englishName);
    const standardChinese = normalizeName(standard?.chineseName);
    const standardEnglish = normalizeName(standard?.englishName);

    if (current && standard) {
      const chineseSame = currentChinese === standardChinese;
      const englishSame = currentEnglish === standardEnglish;
      const chineseFill = chineseSame || !currentChinese || !standardChinese;
      const englishFill = englishSame || !currentEnglish || !standardEnglish;

      if (chineseSame && englishSame) {
        rows.push({
          key: `match:${studentId}`,
          studentId,
          currentChinese,
          currentEnglish,
          standardChinese,
          standardEnglish,
          status: 'matched',
          note: '学号、中文名、英文名一致。',
        });
      } else if (chineseFill && englishFill) {
        rows.push({
          key: `fill:${studentId}`,
          studentId,
          currentChinese,
          currentEnglish,
          standardChinese,
          standardEnglish,
          status: 'fillable',
          note: '同一学生身份已对上，只是中文名或英文名缺一边，可直接补全。',
        });
      } else {
        rows.push({
          key: `mismatch:${studentId}`,
          studentId,
          currentChinese,
          currentEnglish,
          standardChinese,
          standardEnglish,
          status: 'mismatch',
          note: '学号一致，但中文名或英文名不一致，需要人工确认哪边是对的。',
        });
      }
      continue;
    }

    if (standard) {
      rows.push({
        key: `std-only:${studentId}`,
        studentId,
        currentChinese: '',
        currentEnglish: '',
        standardChinese,
        standardEnglish,
        status: 'fillable',
        note: '标准名单里有这位学生，但当前核心名单还没收进来，可直接补入。',
      });
      continue;
    }

    rows.push({
      key: `current-only:${studentId}`,
      studentId,
      currentChinese,
      currentEnglish,
      standardChinese: '',
      standardEnglish: '',
      status: 'standard-missing',
      note: '当前核心名单有这位学生，但标准名单里没找到对应标准记录，先不要自动删除。',
    });
  }

  for (const student of currentMissingId) {
    rows.push({
      key: `missing-id-current:${formatStudentLabel(student)}`,
      studentId: '缺学号',
      currentChinese: normalizeName(student.chineseName),
      currentEnglish: normalizeName(student.englishName),
      standardChinese: '',
      standardEnglish: '',
      status: 'current-missing-id',
      note: '当前核心记录缺学号，系统没法把它和标准名单里的身份一一锁定。',
    });
  }

  for (const student of standardMissingId) {
    rows.push({
      key: `missing-id-standard:${formatStudentLabel(student)}`,
      studentId: '缺学号',
      currentChinese: '',
      currentEnglish: '',
      standardChinese: normalizeName(student.chineseName),
      standardEnglish: normalizeName(student.englishName),
      status: 'conflict',
      note: '标准名单这条记录本身没带学号，不能自动做身份校验，只能人工确认。',
    });
  }

  return {
    rows,
    summary: {
      matched: rows.filter((row) => row.status === 'matched').length,
      fillable: rows.filter((row) => row.status === 'fillable').length,
      mismatched: rows.filter((row) => row.status === 'mismatch').length,
      standardMissing: rows.filter((row) => row.status === 'standard-missing').length,
      currentMissingId: rows.filter((row) => row.status === 'current-missing-id').length,
      conflicts: rows.filter((row) => row.status === 'conflict').length,
    },
  };
}

function resolveLocation(classData: ClassData, classCode: string): LocationInfo | null {
  const exactKey = Object.keys(classData).find((key) => key.toUpperCase() === classCode.toUpperCase());
  if (!exactKey) return null;
  const config = classData[exactKey];
  const weekday = config?.weekday?.locationInfo || null;
  const weekend = config?.weekend?.locationInfo || null;
  return weekday?.fullDate ? weekday : weekend?.fullDate ? weekend : weekday || weekend;
}

function deriveDateReview(location: LocationInfo | null, standardSchedule: ClassScheduleMeta | null): DateReview {
  const baselineWeek = getCurrentWeek();
  const currentDate = normalizeText(location?.fullDate);
  const currentParsed = parseDateString(currentDate);
  const currentWeek = currentParsed ? getWeekNumberForDate(currentParsed) : null;

  const slot = pickPreferredSlot(standardSchedule);
  const inferred = slot?.day ? inferThisWeekDate(slot.day) : null;
  const inferredDate = inferred?.fullDate || '';
  const inferredParsed = parseDateString(inferredDate);
  const inferredWeek = inferredParsed ? getWeekNumberForDate(inferredParsed) : null;
  const exportWeek = currentWeek;
  const issues: string[] = [];
  let status: DateReview['status'] = 'ok';

  if (!currentDate) {
    status = 'missing';
    issues.push('座位表缺少 fullDate，轮转和导出周数都可能失真');
  }
  if (currentWeek && currentWeek < baselineWeek - 1) {
    status = 'risk';
    issues.push(`当前座位表日期偏旧，推导周数 W${currentWeek} 落后于主站当前周 W${baselineWeek}`);
  }
  if (currentWeek && inferredWeek && currentWeek !== inferredWeek) {
    status = status === 'risk' ? 'risk' : 'warning';
    issues.push(`当前座位表日期推导为 W${currentWeek}，按课表本周日期推导为 W${inferredWeek}`);
  }
  if (!issues.length) {
    issues.push('当前日期与主站周数基线一致');
  }

  return {
    baselineWeek,
    currentDate,
    currentWeek,
    inferredDate,
    inferredWeek,
    exportWeek,
    status,
    issues,
  };
}

function resolveDiffLabels(sourceKeys: string[], targetKeys: string[], labels: Map<string, string>): string[] {
  const targetSet = new Set(targetKeys);
  return sourceKeys.filter((key) => !targetSet.has(key)).map((key) => labels.get(key) || key);
}

function buildCoreIdentityResolver(coreStudents: StudentInfo[]) {
  const byChinese = new Map<string, string>();
  const byEnglish = new Map<string, string>();
  const ambiguousChinese = new Set<string>();
  const ambiguousEnglish = new Set<string>();

  for (const student of coreStudents) {
    const comparableKey = buildStudentKey(student);
    if (!comparableKey) continue;

    const chineseName = normalizeName(student.chineseName);
    if (chineseName) {
      if (byChinese.has(chineseName) && byChinese.get(chineseName) !== comparableKey) {
        ambiguousChinese.add(chineseName);
      } else {
        byChinese.set(chineseName, comparableKey);
      }
    }

    const englishName = normalizeName(student.englishName);
    if (englishName) {
      if (byEnglish.has(englishName) && byEnglish.get(englishName) !== comparableKey) {
        ambiguousEnglish.add(englishName);
      } else {
        byEnglish.set(englishName, comparableKey);
      }
    }
  }

  return (student: { studentId?: string; chineseName?: string; englishName?: string }): string => {
    const directKey = buildStudentKey(student);
    if (directKey.startsWith('id:')) return directKey;

    const tokens = [
      normalizeName(student.chineseName),
      normalizeName(student.englishName),
    ].filter(Boolean);

    for (const token of tokens) {
      if (!ambiguousChinese.has(token) && byChinese.has(token)) {
        return byChinese.get(token) || directKey;
      }
      if (!ambiguousEnglish.has(token) && byEnglish.has(token)) {
        return byEnglish.get(token) || directKey;
      }
    }

    return directKey;
  };
}

function namesFromStudentsWithResolver(
  students: Array<{ studentId?: string; chineseName?: string; englishName?: string }>,
  resolveKey: (student: { studentId?: string; chineseName?: string; englishName?: string }) => string,
): string[] {
  return students
    .map((student) => resolveKey(student))
    .filter(Boolean);
}

function buildModuleImpact(coreStudents: StudentInfo[], overviewRoster: StudentInfo[], seatingRoster: StudentInfo[]): ModuleImpact {
  const coreNames = namesFromStudents(coreStudents);
  const resolveModuleKey = buildCoreIdentityResolver(coreStudents);
  const overviewNames = namesFromStudentsWithResolver(overviewRoster, resolveModuleKey);
  const seatingNames = namesFromStudentsWithResolver(seatingRoster, resolveModuleKey);
  const coreLabels = buildStudentKeyMap(coreStudents);
  const overviewLabels = buildStudentKeyMap(overviewRoster);
  const seatingLabels = buildStudentKeyMap(seatingRoster);
  return {
    overviewOnly: resolveDiffLabels(overviewNames, coreNames, overviewLabels),
    seatingOnly: resolveDiffLabels(seatingNames, coreNames, seatingLabels),
    overviewMissingCore: resolveDiffLabels(coreNames, overviewNames, coreLabels),
    seatingMissingCore: resolveDiffLabels(coreNames, seatingNames, coreLabels),
  };
}

function buildDraftSeed(classes: ReviewClass[]): DraftRecord {
  const next: DraftRecord = {};
  for (const item of classes) {
    for (const row of item.scheduleRows) {
      const baseValue = row.standardValue || row.currentValue;
      next[`${item.classCode}:field:${row.key}`] = {
        choice: row.currentValue !== row.standardValue && row.standardValue ? 'standard' : 'current',
        value: baseValue,
      };
    }
    next[`${item.classCode}:date`] = {
      choice: item.dateReview.status === 'ok' ? 'current' : item.dateReview.inferredDate ? 'standard' : 'skip',
      value: item.dateReview.inferredDate || item.dateReview.currentDate,
    };
  }
  return next;
}

function buildRosterDraftSeed(classes: ReviewClass[]): RosterDraftRecord {
  const next: RosterDraftRecord = {};
  for (const item of classes) {
    for (const row of item.roster.rows) {
      const shouldUseStandard = row.status === 'fillable'
        && (!row.currentChinese || !row.currentEnglish)
        && (Boolean(row.standardChinese) || Boolean(row.standardEnglish));
      next[`${item.classCode}:roster:${row.key}`] = {
        choice: shouldUseStandard ? 'standard' : 'current',
        chineseName: shouldUseStandard ? row.standardChinese : row.currentChinese,
        englishName: shouldUseStandard ? row.standardEnglish : row.currentEnglish,
      };
    }
  }
  return next;
}

function getRosterDiffCount(roster: ReviewRosterSummary): number {
  const { matched, ...rest } = roster.summary;
  return Object.values(rest).reduce((sum, value) => sum + value, 0);
}

function getRosterStatusLabel(status: ReviewRosterRow['status']): string {
  switch (status) {
    case 'matched':
      return '完全匹配';
    case 'fillable':
      return '可直接补全';
    case 'mismatch':
      return '姓名不一致';
    case 'standard-missing':
      return '标准侧未找到';
    case 'current-missing-id':
      return '当前记录缺学号';
    case 'conflict':
      return '数据冲突';
    default:
      return '待确认';
  }
}

function hasModuleImpact(moduleImpact: ModuleImpact): boolean {
  return moduleImpact.overviewOnly.length > 0
    || moduleImpact.seatingOnly.length > 0
    || moduleImpact.overviewMissingCore.length > 0
    || moduleImpact.seatingMissingCore.length > 0;
}

function getModuleImpactStatus(moduleImpact: ModuleImpact): 'ok' | 'missing' | 'error' {
  const hasExtra = moduleImpact.overviewOnly.length > 0 || moduleImpact.seatingOnly.length > 0;
  const hasMissing = moduleImpact.overviewMissingCore.length > 0 || moduleImpact.seatingMissingCore.length > 0;
  if (hasExtra) return 'error';
  if (hasMissing) return 'missing';
  return 'ok';
}

function getModuleStateForTarget(moduleImpact: ModuleImpact, target: ModuleTarget): ModuleState {
  const only = target === 'overview' ? moduleImpact.overviewOnly : moduleImpact.seatingOnly;
  const missing = target === 'overview' ? moduleImpact.overviewMissingCore : moduleImpact.seatingMissingCore;
  if (only.length > 0) return 'error';
  if (missing.length > 0) return 'missing';
  return 'ok';
}

export default function DataReviewApp({ classes, teacherName, onBack, onSessionExpired }: Props) {
  const [loading, setLoading] = useState(false);
  const [standardReady, setStandardReady] = useState(false);
  const [error, setError] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [standardRosterMap, setStandardRosterMap] = useState<Record<string, StandardStudent[]>>({});
  const [draft, setDraft] = useState<DraftRecord>(() => loadStoredJson<DraftRecord>(REVIEW_DRAFT_STORAGE_KEY, {}));
  const [rosterDraft, setRosterDraft] = useState<RosterDraftRecord>(() => loadStoredJson<RosterDraftRecord>(REVIEW_ROSTER_DRAFT_STORAGE_KEY, {}));
  const [moduleDraft, setModuleDraft] = useState<ModuleDraftRecord>(() => loadStoredJson<ModuleDraftRecord>(REVIEW_MODULE_DRAFT_STORAGE_KEY, {}));
  const [storageVersion, setStorageVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function fetchStandardData() {
      if (classes.length === 0) return;
      setLoading(true);
      setStandardReady(false);
      setError('');
      try {
        const resp = await fetch('/api/scraper/batch-student-list', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ classIds: classes.map((item) => item.name) }),
        });
        const data = await resp.json().catch(() => ({} as Record<string, unknown>));
        if (resp.status === 401) {
          onSessionExpired?.();
          throw new Error('登录已失效，请重新登录后再核对。');
        }
        if (!resp.ok) {
          throw new Error(String((data as { error?: string }).error || '标准数据抓取失败'));
        }
        const mapped = ((data as { classes?: StandardRosterClass[] }).classes || []).reduce<Record<string, StandardStudent[]>>((acc, item) => {
          acc[item.classId.toUpperCase()] = (item.students || []).map((student) => ({
            studentId: normalizeText(student.studentId || student.no),
            chineseName: normalizeName(student.chineseName || student.chName),
            englishName: normalizeName(student.englishName || student.enName),
          }));
          return acc;
        }, {});
        if (!cancelled) {
          setStandardRosterMap(mapped);
          setStandardReady(true);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '标准数据抓取失败');
          setStandardReady(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void fetchStandardData();
    return () => {
      cancelled = true;
    };
  }, [classes, onSessionExpired]);

  const reviewClasses = useMemo(() => {
    const bundledScheduleMap = getBundledScheduleMetaMap();
    const seatingClassData = loadMergedSeatingClassData();

    return classes.map<ReviewClass>((classInfo) => {
      const classCode = classInfo.name.toUpperCase();
      const currentProfile = getClassProfile(classCode);
      const currentSchedule = getClassScheduleMeta(classCode);
      const standardSchedule = bundledScheduleMap[classCode] ?? null;
      const currentStudents = currentProfile?.students || [];
      const standardStudents = standardRosterMap[classCode] || [];
      const overviewRoster = loadOverviewRoster(classCode) || [];
      const seatingRoster = getStudentsFromSeatingData(classCode);
      const seatingLocation = resolveLocation(seatingClassData, classCode);
      const scheduleRows = buildScheduleRows(currentSchedule, standardSchedule);
      const roster = buildRosterSummary(currentStudents, standardStudents);
      const dateReview = deriveDateReview(seatingLocation, standardSchedule);
      const moduleImpact = buildModuleImpact(currentStudents, overviewRoster, seatingRoster);
      const classInfoIssueCount = scheduleRows.filter((row) => row.currentValue !== row.standardValue).length;
      const rosterIssueCount = getRosterDiffCount(roster);
      const rosterMissingCount = roster.summary.fillable;
      const rosterErrorCount = roster.summary.mismatched + roster.summary.standardMissing + roster.summary.currentMissingId + roster.summary.conflicts;
      const moduleIssueCount = hasModuleImpact(moduleImpact) ? 1 : 0;
      const safeCount = scheduleRows.filter((row) => !row.currentValue && row.standardValue).length + roster.summary.fillable;
      const riskCount = rosterErrorCount + (dateReview.status === 'risk' ? 1 : 0);

      return {
        classCode,
        currentProfile,
        currentSchedule,
        standardSchedule,
        currentStudents,
        standardStudents,
        overviewRoster,
        seatingRoster,
        seatingLocation,
        scheduleRows,
        roster,
        dateReview,
        moduleImpact,
        classInfoIssueCount,
        rosterIssueCount,
        rosterMissingCount,
        rosterErrorCount,
        moduleIssueCount,
        safeCount,
        riskCount,
      };
    });
  }, [classes, standardRosterMap, storageVersion]);

  useEffect(() => {
    setDraft((current) => ({
      ...buildDraftSeed(reviewClasses),
      ...loadStoredJson<DraftRecord>(REVIEW_DRAFT_STORAGE_KEY, {}),
      ...current,
    }));
    setRosterDraft((current) => ({
      ...buildRosterDraftSeed(reviewClasses),
      ...loadStoredJson<RosterDraftRecord>(REVIEW_ROSTER_DRAFT_STORAGE_KEY, {}),
      ...current,
    }));
  }, [reviewClasses]);

  useEffect(() => {
    saveStoredJson(REVIEW_DRAFT_STORAGE_KEY, draft);
  }, [draft]);

  useEffect(() => {
    saveStoredJson(REVIEW_ROSTER_DRAFT_STORAGE_KEY, rosterDraft);
  }, [rosterDraft]);

  useEffect(() => {
    saveStoredJson(REVIEW_MODULE_DRAFT_STORAGE_KEY, moduleDraft);
  }, [moduleDraft]);

  const summary = useMemo(() => {
    const classCount = reviewClasses.length;
    const diffCount = reviewClasses.reduce((sum, item) => (
      sum
      + item.scheduleRows.filter((row) => row.currentValue !== row.standardValue).length
      + getRosterDiffCount(item.roster)
      + (item.dateReview.status === 'ok' ? 0 : 1)
    ), 0);
    const safeCount = reviewClasses.reduce((sum, item) => sum + item.safeCount, 0);
    const riskCount = reviewClasses.reduce((sum, item) => sum + item.riskCount, 0);
    const missingDateClasses = reviewClasses.filter((item) => !item.dateReview.currentDate).length;
    const weekIssueClasses = reviewClasses.filter((item) => item.dateReview.status !== 'ok').length;
    return { classCount, diffCount, safeCount, riskCount, missingDateClasses, weekIssueClasses };
  }, [reviewClasses]);

  function updateDraft(key: string, patch: Partial<{ choice: DraftChoice; value: string }>) {
    setDraft((current) => ({
      ...current,
      [key]: {
        choice: current[key]?.choice || 'current',
        value: current[key]?.value || '',
        ...patch,
      },
    }));
  }

  function updateRosterDraft(
    key: string,
    patch: Partial<{ choice: Exclude<DraftChoice, 'skip'>; chineseName: string; englishName: string }>,
    fallback?: { chineseName: string; englishName: string },
  ) {
    setRosterDraft((current) => ({
      ...current,
      [key]: {
        choice: current[key]?.choice || 'current',
        chineseName: current[key]?.chineseName ?? fallback?.chineseName ?? '',
        englishName: current[key]?.englishName ?? fallback?.englishName ?? '',
        ...patch,
      },
    }));
  }

  function updateModuleDraft(key: string, choice: 'keep' | 'sync') {
    setModuleDraft((current) => ({
      ...current,
      [key]: { choice },
    }));
  }

  function bumpStorage(message: string) {
    setActionMessage(message);
    setStorageVersion((current) => current + 1);
  }

  function saveScheduleMetaPatch(classCode: string, patch: Partial<ScheduleMetaSlot>) {
    const normalizedClassCode = classCode.trim().toUpperCase();
    const raw = localStorage.getItem(SCHEDULE_META_STORAGE_KEY);
    const all = raw ? (JSON.parse(raw) as Record<string, ClassScheduleMeta>) : {};
    const current = all[normalizedClassCode] || getClassScheduleMeta(normalizedClassCode) || {
      classCode: normalizedClassCode,
      updatedAt: Date.now(),
    };
    const targetKey = current.weekday ? 'weekday' : current.weekend ? 'weekend' : 'weekday';
    const baseSlot = current[targetKey] || {
      day: '',
      time: '',
      campus: '',
      floor: '',
      room: '',
      rawCount: 0,
    };
    all[normalizedClassCode] = {
      ...current,
      updatedAt: Date.now(),
      [targetKey]: {
        ...baseSlot,
        ...patch,
      },
    };
    localStorage.setItem(SCHEDULE_META_STORAGE_KEY, JSON.stringify(all));
  }

  function saveDateToSeating(classCode: string, fullDate: string) {
    const trimmed = normalizeText(fullDate);
    if (!trimmed) return;
    const all = loadMergedSeatingClassData();
    const exactKey = Object.keys(all).find((key) => key.toUpperCase() === classCode.toUpperCase()) || classCode.toUpperCase();
    const current = all[exactKey] || makeClassShell();
    const targetMode = current.weekday?.locationInfo?.fullDate ? 'weekday' : current.weekend?.locationInfo?.fullDate ? 'weekend' : 'weekday';
    const currentMode = current[targetMode];
    all[exactKey] = {
      ...current,
      [targetMode]: {
        ...currentMode,
        locationInfo: {
          ...currentMode.locationInfo,
          fullDate: trimmed,
        },
      },
    };
    saveSeatingClassData(all);
  }

  function buildCoreRosterAfterSafeApply(item: ReviewClass): Array<{ studentId?: string; chineseName: string; englishName?: string }> {
    return item.roster.rows.reduce<Array<{ studentId?: string; chineseName: string; englishName?: string }>>((list, row) => {
      if (row.status === 'conflict') return list;
      const studentId = row.studentId === '缺学号' ? '' : row.studentId;
      const chineseName = row.status === 'fillable' ? (row.standardChinese || row.currentChinese) : row.currentChinese;
      const englishName = row.status === 'fillable' ? (row.standardEnglish || row.currentEnglish) : row.currentEnglish;
      if (!normalizeName(chineseName)) return list;
      list.push({
        studentId: studentId || undefined,
        chineseName,
        englishName: englishName || undefined,
      });
      return list;
    }, []);
  }

  function syncModuleFromCore(item: ReviewClass, target: ModuleTarget) {
    const coreStudents = item.currentStudents.map((student) => ({
      id: student.id,
      studentId: normalizeText(student.studentId) || undefined,
      chineseName: normalizeName(student.chineseName),
      englishName: normalizeName(student.englishName) || undefined,
    })).filter((student) => student.chineseName);

    if (target === 'overview') {
      saveOverviewRoster(item.classCode, coreStudents);
      updateModuleDraft(`${item.classCode}:module:overview`, 'sync');
      bumpStorage(`${item.classCode} 的概览内部名单已同步为核心名单。`);
      return;
    }

    const all = loadMergedSeatingClassData();
    const exactKey = Object.keys(all).find((key) => key.toUpperCase() === item.classCode.toUpperCase()) || item.classCode;
    const current = all[exactKey] || makeClassShell();
    all[exactKey] = {
      ...current,
      rosterMirror: coreStudents,
    };
    saveSeatingClassData(all);
    updateModuleDraft(`${item.classCode}:module:seating`, 'sync');
    bumpStorage(`${item.classCode} 的座位表内部名单已同步为核心名单。`);
  }

  function applyDateReference(item: ReviewClass) {
    if (!item.dateReview.inferredDate) return;
    saveDateToSeating(item.classCode, item.dateReview.inferredDate);
    updateDraft(`${item.classCode}:date`, {
      choice: 'standard',
      value: item.dateReview.inferredDate,
    });
    bumpStorage(`${item.classCode} 的座位表日期已补为 ${item.dateReview.inferredDate}。`);
  }

  function applyScheduleFieldStandard(item: ReviewClass, row: ReviewFieldRow) {
    if (!row.standardValue) return;
    saveScheduleMetaPatch(item.classCode, {
      [row.key]: row.standardValue,
    } as Partial<ScheduleMetaSlot>);
    updateDraft(`${item.classCode}:field:${row.key}`, {
      choice: 'standard',
      value: row.standardValue,
    });
    bumpStorage(`${item.classCode} 的${row.label}已采用标准值。`);
  }

  function applyRosterRowStandard(item: ReviewClass, row: ReviewRosterRow) {
    const studentId = row.studentId === '缺学号' ? '' : normalizeText(row.studentId);
    const standardChinese = normalizeName(row.standardChinese);
    const standardEnglish = normalizeName(row.standardEnglish);
    if (!studentId || (!standardChinese && !standardEnglish)) return;

    let replaced = false;
    const nextStudents = item.currentStudents.map((student) => {
      if (normalizeText(student.studentId) !== studentId) {
        return {
          studentId: normalizeText(student.studentId) || undefined,
          chineseName: normalizeName(student.chineseName),
          englishName: normalizeName(student.englishName) || undefined,
        };
      }

      replaced = true;
      return {
        studentId,
        chineseName: standardChinese || normalizeName(student.chineseName),
        englishName: standardEnglish || normalizeName(student.englishName) || undefined,
      };
    });

    if (!replaced) {
      nextStudents.push({
        studentId,
        chineseName: standardChinese,
        englishName: standardEnglish || undefined,
      });
    }

    savePreciseStudentList(item.classCode, nextStudents);
    updateRosterDraft(`${item.classCode}:roster:${row.key}`, {
      choice: 'standard',
      chineseName: standardChinese,
      englishName: standardEnglish,
    }, { chineseName: standardChinese, englishName: standardEnglish });
    bumpStorage(`${item.classCode} 的 ${studentId} 已采用标准名单。`);
  }

  function applyAllSafeItems() {
    let appliedClassCount = 0;

    for (const item of reviewClasses) {
      let touched = false;
      const safeRows = item.scheduleRows.filter((row) => !row.currentValue && row.standardValue);
      if (safeRows.length > 0) {
        const patch = safeRows.reduce<Partial<ScheduleMetaSlot>>((acc, row) => ({
          ...acc,
          [row.key]: row.standardValue,
        }), {});
        saveScheduleMetaPatch(item.classCode, patch);
        touched = true;
      }

      if (item.roster.summary.fillable > 0) {
        savePreciseStudentList(item.classCode, buildCoreRosterAfterSafeApply(item));
        touched = true;
      }

      if (item.dateReview.status === 'missing' && item.dateReview.inferredDate) {
        saveDateToSeating(item.classCode, item.dateReview.inferredDate);
        touched = true;
      }

      if (getModuleStateForTarget(item.moduleImpact, 'overview') === 'missing') {
        saveOverviewRoster(item.classCode, item.currentStudents);
        touched = true;
      }

      if (getModuleStateForTarget(item.moduleImpact, 'seating') === 'missing') {
        const all = loadMergedSeatingClassData();
        const exactKey = Object.keys(all).find((key) => key.toUpperCase() === item.classCode.toUpperCase()) || item.classCode;
        const current = all[exactKey] || makeClassShell();
        all[exactKey] = {
          ...current,
          rosterMirror: item.currentStudents,
        };
        saveSeatingClassData(all);
        touched = true;
      }

      if (touched) appliedClassCount += 1;
    }

    bumpStorage(appliedClassCount > 0 ? `已应用 ${appliedClassCount} 个班级的可直接处理项。` : '当前没有可直接自动处理的安全项。');
  }

  return (
    <div className="review-shell fade-in">
      <div className="review-topbar">
        <button className="tool-back-btn" onClick={onBack}>← 返回主页</button>
        <div className="review-title">
          <strong>一键核对数据</strong>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => window.location.reload()}>重新抓取标准数据</button>
      </div>

      <section className="review-summary card">
        <div className="review-summary-head">
          <div>
            <div className="review-kicker">核心数据核对</div>
            <h2>先看班级状态，再决定要不要展开</h2>
          </div>
          <div className="review-summary-actions">
            <button className="btn btn-primary btn-sm" type="button" onClick={applyAllSafeItems}>应用全部可直接处理项</button>
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => setActionMessage('先处理本页缺失项和有误项，再进入最终确认。')}>进入最终确认</button>
          </div>
        </div>
        <div className="review-summary-pills">
          <span className="review-summary-pill">{summary.classCount} 个班</span>
          <span className="review-summary-pill">{summary.diffCount} 个差异</span>
          <span className="review-summary-pill">{summary.safeCount} 个可安全处理</span>
          <span className="review-summary-pill is-risk">{summary.riskCount} 个高风险</span>
          <span className="review-summary-pill">{summary.missingDateClasses} 个缺日期</span>
          <span className="review-summary-pill">{summary.weekIssueClasses} 个周数异常</span>
        </div>
        {loading && <div className="review-banner">正在抓取标准数据...</div>}
        {error && <div className="review-banner is-error">{error}</div>}
        {actionMessage && !error && <div className="review-banner">{actionMessage}</div>}
      </section>

      <div className="review-class-list">
        {reviewClasses.map((item) => {
          const moduleStatus = getModuleImpactStatus(item.moduleImpact);
          const hasAnyIssue = standardReady && item.classInfoIssueCount + item.rosterIssueCount + item.moduleIssueCount + (item.dateReview.status === 'ok' ? 0 : 1) > 0;
          const statusClass = item.riskCount > 0 ? 'is-risk' : hasAnyIssue ? 'is-warning' : 'is-ok';
          return (
            <details key={item.classCode} className={`review-class-card card ${statusClass}`}>
              <summary className="review-class-summary">
                <div>
                  <div className="review-class-code">{item.classCode}</div>
                  <div className="review-class-status-row">
                    <span className={`review-status-chip${!standardReady ? ' is-pending' : item.classInfoIssueCount > 0 ? ' is-error' : ' is-ok'}`}>班级信息核对 {!standardReady ? '待抓取' : item.classInfoIssueCount > 0 ? '有误' : '无误'}</span>
                    <span className={`review-status-chip${!standardReady ? ' is-pending' : item.rosterErrorCount > 0 ? ' is-error' : item.rosterMissingCount > 0 ? ' is-missing' : ' is-ok'}`}>学生名单核对 {!standardReady ? '待抓取' : item.rosterErrorCount > 0 ? '有误' : item.rosterMissingCount > 0 ? '缺失' : '无误'}</span>
                    <span className={`review-status-chip${!standardReady ? ' is-pending' : item.dateReview.status === 'missing' ? ' is-missing' : item.dateReview.status !== 'ok' ? ' is-error' : ' is-ok'}`}>日期周数 {!standardReady ? '待抓取' : item.dateReview.status === 'missing' ? '缺失' : item.dateReview.status !== 'ok' ? '有误' : '无误'}</span>
                    <span className={`review-status-chip${moduleStatus === 'missing' ? ' is-missing' : moduleStatus === 'error' ? ' is-error' : ' is-ok'}`}>模块影响 {moduleStatus === 'missing' ? '缺失' : moduleStatus === 'error' ? '有误' : '无误'}</span>
                  </div>
                </div>
                <div className="review-class-actions">
                  <span className={`review-pill ${!standardReady ? 'is-pending' : statusClass}`}>{!standardReady ? '正在抓标准数据' : item.riskCount > 0 ? '有重点问题' : hasAnyIssue ? '有待核对项' : '已基本一致'}</span>
                  <span className="review-expand-hint">点击展开详情</span>
                </div>
              </summary>

              <div className="review-section-grid">
                <details className="review-section" open={item.classInfoIssueCount > 0}>
                  <summary className="review-section-head">
                    <h3>班级信息</h3>
                    <span>{item.classInfoIssueCount > 0 ? `有误 ${item.classInfoIssueCount} 项` : '无误'}</span>
                  </summary>
                  <div className="review-field-table">
                    <div className="review-field-head">字段</div>
                    <div className="review-field-head">当前</div>
                    <div className="review-field-head">标准</div>
                    <div className="review-field-head">最终</div>
                    {item.scheduleRows.map((row) => {
                      const draftKey = `${item.classCode}:field:${row.key}`;
                      const state = draft[draftKey];
                      return (
                        <div key={draftKey} className={`review-field-row is-${row.risk}`}>
                          <div className="review-field-label">{row.label}</div>
                          <div>{row.currentValue || '—'}</div>
                          <div>{row.standardValue || '—'}</div>
                          <div className="review-final-cell">
                            <div className="review-choice-row">
                              <button type="button" className={`review-choice${state?.choice === 'current' ? ' active' : ''}`} onClick={() => updateDraft(draftKey, { choice: 'current', value: row.currentValue })}>保留</button>
                              <button
                                type="button"
                                className={`review-choice${state?.choice === 'standard' ? ' active' : ''}`}
                                onClick={() => applyScheduleFieldStandard(item, row)}
                                disabled={!row.standardValue}
                              >
                                采用标准
                              </button>
                              <button type="button" className={`review-choice${state?.choice === 'manual' ? ' active' : ''}`} onClick={() => updateDraft(draftKey, { choice: 'manual' })}>手改</button>
                            </div>
                            <input
                              value={state?.value || ''}
                              onChange={(event) => updateDraft(draftKey, { value: event.target.value, choice: 'manual' })}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </details>

                <details className="review-section" open={item.dateReview.status !== 'ok'}>
                  <summary className="review-section-head">
                    <h3>日期与周数</h3>
                    <span>{item.dateReview.status === 'missing' ? '缺失' : item.dateReview.status !== 'ok' ? '有误' : `无误 · 主站周基线 W${item.dateReview.baselineWeek}`}</span>
                  </summary>
                  <div className={`review-date-card is-${item.dateReview.status}`}>
                    <div className="review-date-grid">
                      <div><strong>当前座位表日期</strong><span>{item.dateReview.currentDate || '缺失'}</span></div>
                      <div><strong>当前推导周数</strong><span>{item.dateReview.currentWeek ? `W${item.dateReview.currentWeek}` : '—'}</span></div>
                      <div><strong>标准参考日期</strong><span>{item.dateReview.inferredDate || '—'}</span></div>
                      <div><strong>参考周数</strong><span>{item.dateReview.inferredWeek ? `W${item.dateReview.inferredWeek}` : '—'}</span></div>
                      <div><strong>导出话术周数</strong><span>{item.dateReview.exportWeek ? `W${item.dateReview.exportWeek}` : '—'}</span></div>
                    </div>
                    <ul className="review-issue-list">
                      {item.dateReview.issues.map((issue) => <li key={issue}>{issue}</li>)}
                    </ul>
                    <div className="review-date-actions">
                      {(() => {
                        const draftKey = `${item.classCode}:date`;
                        const state = draft[draftKey];
                        return (
                          <>
                            <button type="button" className={`review-choice${state?.choice === 'current' ? ' active' : ''}`} onClick={() => updateDraft(draftKey, { choice: 'current', value: item.dateReview.currentDate })}>保留现状</button>
                            <button
                              type="button"
                              className={`review-choice${state?.choice === 'standard' ? ' active' : ''}`}
                              onClick={() => applyDateReference(item)}
                              disabled={!item.dateReview.inferredDate}
                            >
                              {item.dateReview.status === 'missing' ? '直接补上参考日期' : '采用参考日期'}
                            </button>
                            <input
                              value={state?.value || ''}
                              onChange={(event) => updateDraft(draftKey, { choice: 'manual', value: event.target.value })}
                              placeholder="手动修正 YYYY-MM-DD"
                            />
                          </>
                        );
                      })()}
                    </div>
                  </div>
                </details>

                <details className="review-section review-section-wide" open={standardReady && item.rosterIssueCount > 0}>
                  <summary className="review-section-head">
                    <h3>学生名单</h3>
                    <span>
                      {!standardReady
                        ? '待抓取'
                        : item.rosterErrorCount > 0
                          ? `有误 ${item.rosterErrorCount} 项`
                          : item.rosterMissingCount > 0
                            ? `缺失 ${item.rosterMissingCount} 项`
                            : '无误'}
                    </span>
                  </summary>
                  <div className="review-roster-summary">
                    {item.roster.summary.fillable > 0 && <span>可直接补入/补全 {item.roster.summary.fillable}</span>}
                    {item.roster.summary.mismatched > 0 && <span>姓名不一致 {item.roster.summary.mismatched}</span>}
                    {item.roster.summary.standardMissing > 0 && <span>标准侧未找到 {item.roster.summary.standardMissing}</span>}
                    {item.roster.summary.currentMissingId > 0 && <span>当前记录缺学号 {item.roster.summary.currentMissingId}</span>}
                    {item.roster.summary.conflicts > 0 && <span>数据冲突 {item.roster.summary.conflicts}</span>}
                    {item.rosterIssueCount === 0 && <span>当前这一班学生名单核对无误</span>}
                  </div>
                  <div className="review-roster-explain">
                    缺失和有误分开处理：缺失项直接补入/补全；有误项才需要人工核对。
                  </div>
                  <div className="review-roster-table">
                    <div className="review-roster-head">学号</div>
                    <div className="review-roster-head">当前中文名</div>
                    <div className="review-roster-head">当前英文名</div>
                    <div className="review-roster-head">标准中文名</div>
                    <div className="review-roster-head">标准英文名</div>
                    <div className="review-roster-head">判定结果</div>
                    <div className="review-roster-head">动作</div>
                    {item.roster.rows.map((row) => {
                      const draftKey = `${item.classCode}:roster:${row.key}`;
                      const state = rosterDraft[draftKey];
                      return (
                        <div key={row.key} className={`review-roster-row is-${row.status}`}>
                          <div className="review-roster-cell review-roster-id">{row.studentId || '—'}</div>
                          <div className="review-roster-cell">{row.currentChinese || '—'}</div>
                          <div className="review-roster-cell">{row.currentEnglish || '—'}</div>
                          <div className="review-roster-cell">{row.standardChinese || '—'}</div>
                          <div className="review-roster-cell">{row.standardEnglish || '—'}</div>
                          <div className="review-roster-cell">
                            <span className={`review-pill is-${row.status === 'matched' ? 'ok' : row.status === 'fillable' ? 'warning' : 'risk'}`}>{getRosterStatusLabel(row.status)}</span>
                            <div className="review-roster-note">{row.note}</div>
                          </div>
                          <div className="review-roster-cell">
                            <div className="review-choice-row">
                              <button
                                type="button"
                                className={`review-choice${state?.choice === 'current' ? ' active' : ''}`}
                                onClick={() => updateRosterDraft(draftKey, {
                                  choice: 'current',
                                  chineseName: row.currentChinese,
                                  englishName: row.currentEnglish,
                                }, { chineseName: row.currentChinese, englishName: row.currentEnglish })}
                              >
                                保留当前
                              </button>
                              <button
                                type="button"
                                className={`review-choice${state?.choice === 'standard' ? ' active' : ''}`}
                                onClick={() => applyRosterRowStandard(item, row)}
                                disabled={!row.studentId || row.studentId === '缺学号' || (!row.standardChinese && !row.standardEnglish)}
                              >
                                采用标准
                              </button>
                              <button
                                type="button"
                                className={`review-choice${state?.choice === 'manual' ? ' active' : ''}`}
                                onClick={() => updateRosterDraft(draftKey, { choice: 'manual' }, {
                                  chineseName: state?.chineseName || row.currentChinese || row.standardChinese,
                                  englishName: state?.englishName || row.currentEnglish || row.standardEnglish,
                                })}
                              >
                                手动修正
                              </button>
                            </div>
                            <div className="review-roster-draft">
                              <strong>本次采用</strong>
                              <span>{state?.chineseName || '—'} / {state?.englishName || '—'}</span>
                            </div>
                            {state?.choice === 'manual' && (
                              <div className="review-roster-manual">
                                <input
                                  value={state.chineseName}
                                  onChange={(event) => updateRosterDraft(draftKey, {
                                    choice: 'manual',
                                    chineseName: event.target.value,
                                  }, { chineseName: row.currentChinese, englishName: row.currentEnglish })}
                                  placeholder="手改中文名"
                                />
                                <input
                                  value={state.englishName}
                                  onChange={(event) => updateRosterDraft(draftKey, {
                                    choice: 'manual',
                                    englishName: event.target.value,
                                  }, { chineseName: row.currentChinese, englishName: row.currentEnglish })}
                                  placeholder="手改英文名"
                                />
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </details>

                <details className="review-section" open={item.moduleIssueCount > 0}>
                  <summary className="review-section-head">
                    <h3>座位表 / 概览内部名单</h3>
                    <span>{moduleStatus === 'missing' ? '缺失' : moduleStatus === 'error' ? '有误' : '无误'}</span>
                  </summary>
                  <div className="review-module-grid">
                    <div className="review-module-card">
                      <strong>概览内部名单</strong>
                      {(() => {
                        const cardStatus = getModuleStateForTarget(item.moduleImpact, 'overview');
                        return (
                          <span className={`review-pill is-${cardStatus === 'ok' ? 'ok' : cardStatus === 'missing' ? 'warning' : 'risk'}`}>
                            {cardStatus === 'missing' ? '当前无数据' : cardStatus === 'error' ? '已有数据，需要人工判断' : '无误'}
                          </span>
                        );
                      })()}
                      <span>仅存在于概览：{item.moduleImpact.overviewOnly.length ? item.moduleImpact.overviewOnly.join('、') : '无'}</span>
                      <span>核心里有但概览缺：{item.moduleImpact.overviewMissingCore.length ? item.moduleImpact.overviewMissingCore.join('、') : '无'}</span>
                      <div className="review-module-actions">
                        {(() => {
                          const cardStatus = getModuleStateForTarget(item.moduleImpact, 'overview');
                          const synced = moduleDraft[`${item.classCode}:module:overview`]?.choice === 'sync';
                          if (cardStatus === 'missing') {
                            return (
                              <div className="review-module-empty-action">
                                <span>当前无数据，是否采用核心名单数据生成？</span>
                                <button
                                  type="button"
                                  className={`review-choice${synced ? ' active' : ''}`}
                                  onClick={() => syncModuleFromCore(item, 'overview')}
                                >
                                  采用核心名单生成
                                </button>
                              </div>
                            );
                          }

                          if (cardStatus === 'error') {
                            return <span className="review-module-note">已有内部名单与核心名单不一致，先人工核对，不在这里直接覆盖。</span>;
                          }

                          return (
                            <span className="review-module-note">当前概览内部名单已和核心名单一致。</span>
                          );
                        })()}
                      </div>
                    </div>
                    <div className="review-module-card">
                      <strong>座位表内部名单</strong>
                      {(() => {
                        const cardStatus = getModuleStateForTarget(item.moduleImpact, 'seating');
                        return (
                          <span className={`review-pill is-${cardStatus === 'ok' ? 'ok' : cardStatus === 'missing' ? 'warning' : 'risk'}`}>
                            {cardStatus === 'missing' ? '当前无数据' : cardStatus === 'error' ? '已有数据，需要人工判断' : '无误'}
                          </span>
                        );
                      })()}
                      <span>仅存在于座位表：{item.moduleImpact.seatingOnly.length ? item.moduleImpact.seatingOnly.join('、') : '无'}</span>
                      <span>核心里有但座位表缺：{item.moduleImpact.seatingMissingCore.length ? item.moduleImpact.seatingMissingCore.join('、') : '无'}</span>
                      <div className="review-module-actions">
                        {(() => {
                          const cardStatus = getModuleStateForTarget(item.moduleImpact, 'seating');
                          const synced = moduleDraft[`${item.classCode}:module:seating`]?.choice === 'sync';
                          if (cardStatus === 'missing') {
                            return (
                              <div className="review-module-empty-action">
                                <span>当前无数据，是否采用核心名单数据生成？</span>
                                <button
                                  type="button"
                                  className={`review-choice${synced ? ' active' : ''}`}
                                  onClick={() => syncModuleFromCore(item, 'seating')}
                                >
                                  采用核心名单生成
                                </button>
                              </div>
                            );
                          }

                          if (cardStatus === 'error') {
                            return <span className="review-module-note">已有内部名单与核心名单不一致，先人工核对，不在这里直接覆盖。</span>;
                          }

                          return (
                            <span className="review-module-note">当前座位表内部名单已和核心名单一致。</span>
                          );
                        })()}
                      </div>
                    </div>
                  </div>
                </details>
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
}
