import type { DayOfWeek, StudentInfo } from '../types';
import type {
  ChallengeItem,
  CommunicationGroup,
  CommunicationPlan,
  CommunicationPlanEntry,
  CommunicationRecord,
  CommunicationSlotType,
  CommunicationSnapshot,
  CustomBlock,
  ListeningMaterialItem,
  MediaAnnotation,
  MediaItem,
  OverviewClassMemory,
  OverviewContent,
  OverviewDraft,
  PhaseChallengeKey,
  PhaseChallengeRow,
  SavedCommunicationPlan,
} from '../types/overview';
import { sortStudentNames } from './classProfiles';

const DRAFT_STORAGE_KEY = 'amber_overview_drafts_v2';
const MEMORY_STORAGE_KEY = 'amber_overview_memory_v2';
const ROSTER_STORAGE_KEY = 'amber_overview_rosters_v1';

const PHASE_KEYS: PhaseChallengeKey[] = ['夯实基础', '维稳达标', '突破拔高'];
const DEFAULT_COMMUNICATION_SLOTS: CommunicationSlotType[] = ['weekday_after', 'weekend_middle'];

function uid(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function createRosterStudent(classCode: string, chineseName: string, englishName = '', studentId = '', existingId = ''): StudentInfo {
  const cleanName = String(chineseName || '').trim();
  const cleanEnglishName = String(englishName || '').trim();
  const cleanStudentId = String(studentId || '').trim();

  return {
    id: existingId || cleanStudentId || `${classCode}_${cleanName}`.replace(/\s+/g, '_'),
    chineseName: cleanName,
    englishName: cleanEnglishName || undefined,
    studentId: cleanStudentId || undefined,
  };
}

function normalizeOverviewRoster(classCode: string, students: StudentInfo[]): StudentInfo[] {
  const englishByName = new Map<string, string>();
  const idByName = new Map<string, string>();
  const studentIdByName = new Map<string, string>();

  for (const student of students) {
    const chineseName = String(student.chineseName || '').trim();
    if (!chineseName) continue;

    const englishName = String(student.englishName || '').trim();
    const studentId = String(student.studentId || '').trim();
    if (englishName) englishByName.set(chineseName, englishName);
    if (studentId) studentIdByName.set(chineseName, studentId);
    if (student.id) idByName.set(chineseName, student.id);
  }

  return sortStudentNames(students.map((student) => student.chineseName)).map((name) =>
    createRosterStudent(
      classCode,
      name,
      englishByName.get(name) || '',
      studentIdByName.get(name) || '',
      idByName.get(name) || '',
    ),
  );
}

export function createMediaAnnotation(type: MediaAnnotation['type']): MediaAnnotation {
  return {
    id: uid(type),
    type,
    x: type === 'text' ? 8 : 18,
    y: type === 'text' ? 8 : 18,
    width: type === 'text' ? 28 : 34,
    height: type === 'text' ? 12 : 24,
    text: type === 'text' ? '标注文字' : '',
    color: type === 'text' ? '#7ba862' : '#e58a4b',
  };
}

export function createMediaItem(name = ''): MediaItem {
  return {
    id: uid('media'),
    src: '',
    name,
    caption: '',
    displayWidth: 160,
    annotations: [],
  };
}

export function createChallengeItem(): ChallengeItem {
  return {
    id: uid('challenge'),
    title: '',
    detail: '',
    media: [],
  };
}

export function createListeningItem(): ListeningMaterialItem {
  return {
    id: uid('listen'),
    english: '',
    chinese: '',
  };
}

function createCommunicationGroup(memory?: OverviewClassMemory): CommunicationGroup {
  return {
    id: uid('comm_group'),
    label: '第1组',
    selectedStudents: [],
    teacherName: memory?.preferredCommunicationTeacher ?? '',
    slotType: 'weekday_after',
    locationText: memory?.preferredCommunicationLocation ?? '教室',
    scheduleText: memory?.preferredCommunicationSchedule ?? '',
    note: '',
  };
}

function cloneCommunicationGroup(group: CommunicationGroup): CommunicationGroup {
  return {
    ...group,
    selectedStudents: sortStudentNames(group.selectedStudents),
    slotType: group.slotType || 'weekday_after',
    locationText: String(group.locationText || ''),
  };
}

function cloneCommunicationEntry(entry: CommunicationPlanEntry): CommunicationPlanEntry {
  return {
    ...entry,
    selectedStudents: sortStudentNames(entry.selectedStudents),
    slotType: entry.slotType || 'weekday_after',
    locationText: String(entry.locationText || ''),
  };
}

function normalizeCommunicationSlots(slots: CommunicationSlotType[]): CommunicationSlotType[] {
  const allowed = new Set<CommunicationSlotType>([
    'weekday_before',
    'weekday_after',
    'weekend_before',
    'weekend_middle',
    'weekend_after',
  ]);
  const clean = slots.filter((slot): slot is CommunicationSlotType => allowed.has(slot));
  return clean.length > 0 ? clean : [...DEFAULT_COMMUNICATION_SLOTS];
}

export function normalizeCommunicationPlan(plan: CommunicationPlan): CommunicationPlan {
  const groups = plan.groups.length > 0 ? plan.groups.map(cloneCommunicationGroup) : [createCommunicationGroup()];
  return {
    planName: String(plan.planName || '交流计划'),
    roundLabel: String(plan.roundLabel || '第1轮'),
    status: plan.status || 'draft',
    cycleWeeks: Math.max(1, Number(plan.cycleWeeks || 4)),
    deadlineDate: String(plan.deadlineDate || ''),
    mode: plan.mode || 'phase',
    suggestedGroupSize: Math.max(1, Number(plan.suggestedGroupSize || 2)),
    availableSlots: normalizeCommunicationSlots(Array.isArray(plan.availableSlots) ? plan.availableSlots : []),
    defaultTeacherName: String(plan.defaultTeacherName || plan.teacherName || ''),
    defaultLocationText: String(plan.defaultLocationText || groups[0]?.locationText || '教室'),
    entries: Array.isArray(plan.entries) ? plan.entries.map(cloneCommunicationEntry) : [],
    groups,
    selectedStudents: sortStudentNames(groups.flatMap((group) => group.selectedStudents)),
    teacherName: String(plan.teacherName || ''),
    scheduleText: String(plan.scheduleText || ''),
    note: String(plan.note || ''),
  };
}

function normalizeStoredCommunicationPlan(raw: unknown): CommunicationPlan {
  const plan = raw && typeof raw === 'object' ? (raw as Partial<CommunicationPlan>) : {};
  const groups = Array.isArray(plan.groups) && plan.groups.length > 0
    ? plan.groups
        .filter((group): group is CommunicationGroup => Boolean(group && typeof group === 'object'))
        .map((group, index) => cloneCommunicationGroup({
          id: String(group.id || uid('comm_group')),
          label: String(group.label || `第${index + 1}组`),
          selectedStudents: Array.isArray(group.selectedStudents) ? group.selectedStudents.map((name) => String(name || '').trim()).filter(Boolean) : [],
          teacherName: String(group.teacherName || ''),
          slotType: (group.slotType as CommunicationSlotType) || 'weekday_after',
          locationText: String(group.locationText || ''),
          scheduleText: String(group.scheduleText || ''),
          note: String(group.note || ''),
          sourceEntryId: String(group.sourceEntryId || '') || undefined,
          isManual: Boolean(group.isManual),
        }))
    : [{
        id: uid('comm_group'),
        label: '第1组',
        selectedStudents: sortStudentNames(Array.isArray(plan.selectedStudents) ? plan.selectedStudents.map((name) => String(name || '').trim()).filter(Boolean) : []),
        teacherName: String(plan.teacherName || ''),
        slotType: 'weekday_after' as CommunicationSlotType,
        locationText: '',
        scheduleText: String(plan.scheduleText || ''),
        note: String(plan.note || ''),
      }];

  return normalizeCommunicationPlan({
    planName: String(plan.planName || '交流计划'),
    roundLabel: String(plan.roundLabel || '第1轮'),
    status: (plan.status as CommunicationPlan['status']) || 'draft',
    cycleWeeks: Math.max(1, Number(plan.cycleWeeks || 4)),
    deadlineDate: String(plan.deadlineDate || ''),
    mode: (plan.mode as CommunicationPlan['mode']) || 'phase',
    suggestedGroupSize: Math.max(1, Number(plan.suggestedGroupSize || 2)),
    availableSlots: normalizeCommunicationSlots(Array.isArray(plan.availableSlots) ? plan.availableSlots as CommunicationSlotType[] : []),
    defaultTeacherName: String(plan.defaultTeacherName || plan.teacherName || ''),
    defaultLocationText: String(plan.defaultLocationText || groups[0]?.locationText || '教室'),
    entries: Array.isArray(plan.entries)
      ? plan.entries
          .filter((entry): entry is CommunicationPlanEntry => Boolean(entry && typeof entry === 'object'))
          .map((entry, index) => cloneCommunicationEntry({
            id: String(entry.id || uid('plan_entry')),
            label: String(entry.label || `第${index + 1}组`),
            weekIndex: Math.max(1, Number(entry.weekIndex || 1)),
            slotType: (entry.slotType as CommunicationSlotType) || 'weekday_after',
            selectedStudents: Array.isArray(entry.selectedStudents) ? entry.selectedStudents.map((name) => String(name || '').trim()).filter(Boolean) : [],
            teacherName: String(entry.teacherName || ''),
            locationText: String(entry.locationText || ''),
            scheduleText: String(entry.scheduleText || ''),
            note: String(entry.note || ''),
            isManual: Boolean(entry.isManual),
          }))
      : [],
    groups,
    selectedStudents: Array.isArray(plan.selectedStudents) ? plan.selectedStudents.map((name) => String(name || '').trim()).filter(Boolean) : [],
    teacherName: String(plan.teacherName || ''),
    scheduleText: String(plan.scheduleText || ''),
    note: String(plan.note || ''),
  });
}

export function createCustomBlock(): CustomBlock {
  return {
    id: uid('custom'),
    title: '补充内容',
    mode: 'text',
    text: '',
    table: {
      columns: ['项目', '内容'],
      rows: [['', '']],
    },
    media: [],
  };
}

function createCommunicationPlan(memory?: OverviewClassMemory): CommunicationPlan {
  const groups = memory?.communicationGroups?.length
    ? memory.communicationGroups.map(cloneCommunicationGroup)
    : [createCommunicationGroup(memory)];
  return normalizeCommunicationPlan({
    planName: '交流计划',
    roundLabel: '第1轮',
    status: 'draft',
    cycleWeeks: 4,
    deadlineDate: '',
    mode: 'phase',
    suggestedGroupSize: 2,
    availableSlots: DEFAULT_COMMUNICATION_SLOTS,
    defaultTeacherName: memory?.preferredCommunicationTeacher ?? '',
    defaultLocationText: memory?.preferredCommunicationLocation ?? '教室',
    entries: [],
    groups,
    selectedStudents: [],
    teacherName: memory?.preferredCommunicationTeacher ?? '',
    scheduleText: memory?.preferredCommunicationSchedule ?? '',
    note: '',
  });
}

function clonePhaseChallenge(row: PhaseChallengeRow): PhaseChallengeRow {
  return {
    ...row,
    selectedStudents: [...row.selectedStudents],
  };
}

function createDefaultPhaseChallenges(studentNames: string[], memory?: OverviewClassMemory): PhaseChallengeRow[] {
  const remembered = memory?.phaseChallenges?.length
    ? memory.phaseChallenges.map(clonePhaseChallenge)
    : PHASE_KEYS.map((key) => ({
        id: uid('phase'),
        key,
        label: key,
        selectedStudents: [],
        challengeContent: '',
        method: '',
      }));

  const validNames = new Set(studentNames);
  return remembered.map((row) => ({
    ...row,
    selectedStudents: sortStudentNames(row.selectedStudents.filter((name) => validNames.has(name))),
  }));
}

function cloneCustomBlock(block: CustomBlock): CustomBlock {
  return {
    ...block,
    table: {
      columns: [...block.table.columns],
      rows: block.table.rows.map((row) => [...row]),
    },
    media: block.media.map((item) => ({
      ...item,
      displayWidth: item.displayWidth ?? 160,
      annotations: item.annotations.map((annotation) => ({ ...annotation })),
    })),
  };
}

function createWeeklyChallenges(orderedDays: DayOfWeek[]): OverviewContent['weeklyChallenges'] {
  return orderedDays.map((day) => ({ day, task: '' }));
}

export function loadDraft(classCode: string, week: number): OverviewContent | null {
  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const drafts = JSON.parse(raw) as Record<string, OverviewDraft>;
    const content = drafts[`${classCode}_W${week}`]?.content ?? null;
    if (!content) return null;
    return {
      ...content,
      communicationPlan: normalizeStoredCommunicationPlan((content as OverviewContent).communicationPlan),
    };
  } catch {
    return null;
  }
}

function saveDraftMap(drafts: Record<string, OverviewDraft>): void {
  localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(drafts));
}

export function saveDraft(content: OverviewContent): void {
  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
    const drafts = raw ? (JSON.parse(raw) as Record<string, OverviewDraft>) : {};
    drafts[`${content.classCode}_W${content.week}`] = {
      content: {
        ...content,
        communicationPlan: normalizeCommunicationPlan(content.communicationPlan),
      },
      updatedAt: Date.now(),
    };
    saveDraftMap(drafts);
  } catch {
    // ignore localStorage failures
  }
}

export function loadClassMemory(classCode: string): OverviewClassMemory | null {
  try {
    const raw = localStorage.getItem(MEMORY_STORAGE_KEY);
    if (!raw) return null;
    const all = JSON.parse(raw) as Record<string, OverviewClassMemory>;
    const memory = all[classCode] ?? null;
    if (!memory) return null;
    return {
      ...memory,
      preferredCommunicationLocation: String(memory.preferredCommunicationLocation || '教室'),
      communicationGroups: Array.isArray(memory.communicationGroups) ? memory.communicationGroups.map(cloneCommunicationGroup) : [],
      communicationHistory: Array.isArray(memory.communicationHistory) ? memory.communicationHistory : [],
      savedCommunicationPlans: Array.isArray(memory.savedCommunicationPlans)
        ? memory.savedCommunicationPlans.map((plan) => ({
            ...plan,
            availableSlots: normalizeCommunicationSlots(Array.isArray(plan.availableSlots) ? plan.availableSlots : []),
            entries: Array.isArray(plan.entries) ? plan.entries.map(cloneCommunicationEntry) : [],
          }))
        : [],
      communicationSnapshots: Array.isArray(memory.communicationSnapshots)
        ? memory.communicationSnapshots.map((snapshot) => ({
            ...snapshot,
            groups: Array.isArray(snapshot.groups) ? snapshot.groups.map(cloneCommunicationGroup) : [],
          }))
        : [],
    };
  } catch {
    return null;
  }
}

export function loadOverviewRoster(classCode: string): StudentInfo[] | null {
  try {
    const raw = localStorage.getItem(ROSTER_STORAGE_KEY);
    if (!raw) return null;
    const all = JSON.parse(raw) as Record<string, StudentInfo[]>;
    const roster = Array.isArray(all[classCode]) ? all[classCode] : null;
    return roster ? normalizeOverviewRoster(classCode, roster) : null;
  } catch {
    return null;
  }
}

export function saveOverviewRoster(classCode: string, students: StudentInfo[]): StudentInfo[] {
  const normalized = normalizeOverviewRoster(classCode, students);
  try {
    const raw = localStorage.getItem(ROSTER_STORAGE_KEY);
    const all = raw ? (JSON.parse(raw) as Record<string, StudentInfo[]>) : {};
    all[classCode] = normalized;
    localStorage.setItem(ROSTER_STORAGE_KEY, JSON.stringify(all));
  } catch {
    // ignore localStorage failures
  }
  return normalized;
}

function saveClassMemory(memory: OverviewClassMemory): void {
  try {
    const raw = localStorage.getItem(MEMORY_STORAGE_KEY);
    const all = raw ? (JSON.parse(raw) as Record<string, OverviewClassMemory>) : {};
    all[memory.classCode] = memory;
    localStorage.setItem(MEMORY_STORAGE_KEY, JSON.stringify(all));
  } catch {
    // ignore localStorage failures
  }
}

export function createEmptyContent(
  classCode: string,
  week: number,
  options?: { orderedDays?: DayOfWeek[]; studentNames?: string[] },
): OverviewContent {
  const orderedDays = options?.orderedDays?.length
    ? options.orderedDays
    : (['周一', '周二', '周三', '周四', '周五', '周六', '周日'] as DayOfWeek[]);
  const studentNames = options?.studentNames ?? [];
  const memory = loadClassMemory(classCode);

  return {
    classCode,
    week,
    theme: 'green',
    challengeStartDay: orderedDays[0] ?? '周一',
    weeklyChallenges: createWeeklyChallenges(orderedDays),
    phaseChallenges: createDefaultPhaseChallenges(studentNames, memory ?? undefined),
    challengeItems: [],
    listeningMaterials: [],
    listeningFont: 'guide',
    communicationPlan: createCommunicationPlan(memory ?? undefined),
    customBlocks: memory?.customBlocks?.length
      ? memory.customBlocks.map(cloneCustomBlock)
      : [createCustomBlock()],
  };
}

export function syncWeeklyChallengeDays(
  current: OverviewContent['weeklyChallenges'],
  orderedDays: DayOfWeek[],
): OverviewContent['weeklyChallenges'] {
  return orderedDays.map((day) => ({
    day,
    task: current.find((item) => item.day === day)?.task ?? '',
  }));
}

export function syncPhaseChallenges(
  phaseChallenges: PhaseChallengeRow[],
  studentNames: string[],
): PhaseChallengeRow[] {
  const valid = new Set(studentNames);
  return phaseChallenges.map((row) => ({
    ...row,
    selectedStudents: sortStudentNames(row.selectedStudents.filter((name) => valid.has(name))),
  }));
}

export function rememberReusableContent(content: OverviewContent, studentNames: string[]): void {
  const memory = loadClassMemory(content.classCode) ?? {
    classCode: content.classCode,
    preferredCommunicationTeacher: '',
    preferredCommunicationSchedule: '',
    preferredCommunicationLocation: '教室',
    communicationGroups: [],
    phaseChallenges: [],
    customBlocks: [],
    communicationHistory: [],
    savedCommunicationPlans: [],
    communicationSnapshots: [],
    updatedAt: 0,
  };

  const validNames = new Set(studentNames);
  const communicationPlan = normalizeCommunicationPlan(content.communicationPlan);
  const nextMemory: OverviewClassMemory = {
    ...memory,
    preferredCommunicationTeacher: communicationPlan.teacherName.trim(),
    preferredCommunicationSchedule: communicationPlan.groups[0]?.scheduleText.trim() ?? '',
    preferredCommunicationLocation: String(communicationPlan.groups[0]?.locationText || '').trim() || String(communicationPlan.defaultLocationText || '').trim() || '教室',
    communicationGroups: communicationPlan.groups.map((group) => ({
      ...cloneCommunicationGroup(group),
      selectedStudents: sortStudentNames(group.selectedStudents.filter((name) => validNames.has(name))),
    })),
    phaseChallenges: content.phaseChallenges.map((row) => ({
      ...row,
      selectedStudents: sortStudentNames(row.selectedStudents.filter((name) => validNames.has(name))),
    })),
    customBlocks: content.customBlocks.map(cloneCustomBlock),
    updatedAt: Date.now(),
  };

  saveClassMemory(nextMemory);
}

export function addCommunicationRecord(
  classCode: string,
  record: Omit<CommunicationRecord, 'id' | 'createdAt'>,
): CommunicationRecord {
  const memory = loadClassMemory(classCode) ?? {
    classCode,
    preferredCommunicationTeacher: '',
    preferredCommunicationSchedule: '',
    preferredCommunicationLocation: '教室',
    communicationGroups: [],
    phaseChallenges: [],
    customBlocks: [],
    communicationHistory: [],
    savedCommunicationPlans: [],
    communicationSnapshots: [],
    updatedAt: 0,
  };

  const nextRecord: CommunicationRecord = {
    ...record,
    id: uid('comm'),
    createdAt: Date.now(),
  };

  memory.communicationHistory = [nextRecord, ...memory.communicationHistory].slice(0, 80);
  memory.preferredCommunicationTeacher = record.teacherName.trim();
  memory.preferredCommunicationSchedule = record.scheduleText.trim();
  memory.updatedAt = Date.now();
  saveClassMemory(memory);
  return nextRecord;
}

export function saveCommunicationPlanPreset(classCode: string, plan: CommunicationPlan): SavedCommunicationPlan {
  const normalizedPlan = normalizeCommunicationPlan(plan);
  const memory = loadClassMemory(classCode) ?? {
    classCode,
    preferredCommunicationTeacher: '',
    preferredCommunicationSchedule: '',
    preferredCommunicationLocation: '教室',
    communicationGroups: [],
    phaseChallenges: [],
    customBlocks: [],
    communicationHistory: [],
    savedCommunicationPlans: [],
    communicationSnapshots: [],
    updatedAt: 0,
  };

  const savedPlan: SavedCommunicationPlan = {
    id: uid('comm_plan'),
    classCode,
    planName: normalizedPlan.planName || '交流计划',
    roundLabel: normalizedPlan.roundLabel || '第1轮',
    status: normalizedPlan.status || 'draft',
    cycleWeeks: normalizedPlan.cycleWeeks || 4,
    deadlineDate: normalizedPlan.deadlineDate || '',
    mode: normalizedPlan.mode || 'phase',
    suggestedGroupSize: normalizedPlan.suggestedGroupSize || 2,
    availableSlots: [...(normalizedPlan.availableSlots || DEFAULT_COMMUNICATION_SLOTS)],
    defaultTeacherName: normalizedPlan.defaultTeacherName || '',
    defaultLocationText: normalizedPlan.defaultLocationText || '教室',
    entries: (normalizedPlan.entries || []).map(cloneCommunicationEntry),
    savedAt: Date.now(),
  };

  memory.savedCommunicationPlans = [savedPlan, ...(memory.savedCommunicationPlans || [])].slice(0, 20);
  memory.updatedAt = Date.now();
  saveClassMemory(memory);
  return savedPlan;
}

export function listSavedCommunicationPlans(classCode: string): SavedCommunicationPlan[] {
  return loadClassMemory(classCode)?.savedCommunicationPlans ?? [];
}

export function saveCommunicationSnapshot(classCode: string, week: number, plan: CommunicationPlan): CommunicationSnapshot {
  const normalizedPlan = normalizeCommunicationPlan(plan);
  const memory = loadClassMemory(classCode) ?? {
    classCode,
    preferredCommunicationTeacher: '',
    preferredCommunicationSchedule: '',
    preferredCommunicationLocation: '教室',
    communicationGroups: [],
    phaseChallenges: [],
    customBlocks: [],
    communicationHistory: [],
    savedCommunicationPlans: [],
    communicationSnapshots: [],
    updatedAt: 0,
  };

  const snapshot: CommunicationSnapshot = {
    id: uid('comm_snapshot'),
    classCode,
    week,
    roundLabel: normalizedPlan.roundLabel || '第1轮',
    planName: normalizedPlan.planName || '交流计划',
    groups: normalizedPlan.groups.map(cloneCommunicationGroup),
    createdAt: Date.now(),
  };

  memory.communicationSnapshots = [snapshot, ...(memory.communicationSnapshots || [])].slice(0, 30);
  memory.updatedAt = Date.now();
  saveClassMemory(memory);
  return snapshot;
}

export function listCommunicationSnapshots(classCode: string): CommunicationSnapshot[] {
  return loadClassMemory(classCode)?.communicationSnapshots ?? [];
}

export function getCommunicationStats(classCode: string, studentNames: string[]): {
  contacted: string[];
  pending: string[];
  latestByStudent: Record<string, CommunicationRecord>;
} {
  const memory = loadClassMemory(classCode);
  const latestByStudent: Record<string, CommunicationRecord> = {};

  for (const record of memory?.communicationHistory ?? []) {
    for (const name of record.studentNames) {
      if (!latestByStudent[name]) {
        latestByStudent[name] = record;
      }
    }
  }

  const contacted = studentNames.filter((name) => Boolean(latestByStudent[name]));
  const pending = studentNames.filter((name) => !latestByStudent[name]);

  return {
    contacted: sortStudentNames(contacted),
    pending: sortStudentNames(pending),
    latestByStudent,
  };
}
