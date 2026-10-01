import {
  addDays,
  dateKeyToMonthDay,
  formatTodayLabel,
  getChineseWeekday,
  getWeekNumber,
  monthDayToDateKey,
  parseDateFromClassTime
} from './calendar';
import { APP_NAME, APP_SLUG, BACKUP_FILE_PREFIX, readStorageValue, storageKeys, writeStorageValue } from './appMeta';
import {
  applyManualGrouping,
  collectStudentsFromCamp,
  collectStudentsFromCircular,
  collectStudentsFromFour,
  collectStudentsFromRows,
  convertStudentsToCamp,
  convertStudentsToCircular,
  convertStudentsToFour,
  convertStudentsToRows,
  getCircularGroupCount,
  getCampGroupCountFromGroups,
  getCircularGroupCountFromGroups,
  getCircularVisibleGroupCountFromGroups,
  defaultRotationConfig,
  getCircularSlotMap,
  getFourGroupCountFromGroups,
  getRowsGroupCountFromGroups,
  getRowGroupCount,
  getRowsOccupiedSlotsFromGroups,
  getRowsSlotMap,
  layoutMaxStudents,
  normalizeStudentList,
  normalizeGroupLabels,
} from './layouts';
import {
  buildCampImportState,
  buildCircularImportState,
  buildFourImportState,
  buildRowsImportState,
  rotateLocationInfoByWeek,
  rotateTimeModeData,
} from './layoutOperations';
import type { ImportedLayoutState } from './layoutOperations';
import {
  captureLayoutIdentity,
  getLayoutGroupCount,
  previewLayoutWithIdentity,
  sanitizeSeatingLayoutIdentity,
  updateIdentityAfterRegroup,
} from './layoutIdentity';
import { getDefaultOCREndpoint, loadOCRSettings, saveOCRSettings } from './ocrSettings';
import {
  normalizeSummerCampSeatSlots,
  resolveImportedSummerCampGroupCount,
  resolveSavedSummerCampGroupCount,
  sanitizeSummerCampSeatGroups,
} from './summerCampSeatSlots';
import { refreshSeating, renderModePreview, setRenderQueryRoot } from './render';
import {
  createInitialState,
  makeClassShell,
  makeDefaultReminderMeta,
  CAMP_GROUP_SIZE,
  MAX_STUDENT_LIMIT,
  getLayoutGroupSeatCapacity,
  makeEmptyCampGroups,
  makeEmptyCircularGroups,
  makeEmptyFourGroups,
  makeEmptyLocationInfo,
  makeEmptyRowGroups
} from './state';
import {
  buildTodayTodoSummary as buildReminderTodoSummary,
  createReminderNote,
  formatTodoHeadline,
  sanitizeReminderNotes,
} from './reminderRules';
import {
  clearBatchUndoData,
  loadBatchUndoData,
  loadClassData,
  loadReminderMeta,
  loadUserProfile,
  saveBatchUndoData,
  saveClassData,
  saveReminderMeta,
  saveUserProfile
} from './storage';
import { cnfFetchRoster, cnfLoginAndListSquads } from './cnfSync';
import {
  buildBackupPayload as createBackupPayload,
  type BackupPayload,
  sanitizeClassDataMap as sanitizePersistedClassDataMap,
  sanitizeClassSnapshot as sanitizePersistedClassSnapshot,
  sanitizeImportedTheme,
  snapshotFromConfig as createSnapshotFromConfig,
} from './backupData';
import {
  buildExportScript,
  buildExportSnapshot as createExportSnapshot,
  deliverExportImageBlob,
  downloadBackupPayload,
  requestExportImageBlob,
} from './exportHelpers';
import { applyFetchedCnfRoster, buildCnfSquadOptions, resolvePreferredCnfSquadId } from './cnfDialogState';
import {
  buildOcrReviewCardHtml,
  type OCRDraftView,
} from './ocrReviewState';
import {
  computeRosterDiff,
  extractRosterStudents,
  findMatchingCnfSquad,
  loadKnownRosterForClass,
  mergeStudentListsByMaxCount,
  saveKnownRosterForClass,
} from './rosterSync';
import {
  buildManualSeatSections,
  compareStudentMultisets,
  collectManualDraftStudents,
  findFirstEmptyManualSeat,
  findManualSeat,
  getManualSeatValue,
  manualSeatSummary,
  setManualSeatValue,
  shuffleManualSeatAssignments,
  validateBalancedManualGroups,
  type ManualSeatRef,
  type ManualTuneDraft,
} from './manualTuneState';
import { buildWeeklyRotatedClassData, restorePreviousWeekConfig } from './weeklySeatingState';
import { getClassScheduleMeta, inferThisWeekDate } from '../utils/classScheduleMeta';
import { fetchSeatingBackup, saveSeatingBackup } from '../services/seatingBackupApi';
import { loadAcademicTermLaunchInfo, saveAcademicTermLaunchInfo } from '../services/seatingStorage';
import { mergeMissingBackupClassData, selectBackupClasses } from './seatingBackupMerge';
import { buildAcademicWeekContext } from './academicWeekContext';
import { classConfigHasAnySeating, populateEmptyClassWithStudents } from './emptySeatingGeneration';
import { normalizeLocationDate } from './locationDateNormalization';
import {
  CAMP_MAJOR_OPTIONS,
  CAMP_MINOR_OPTIONS,
  getCampReportDateIndex,
  getCampReportDateOptions,
  getCampReportPhase,
  getCurrentCampReportDate,
  getDefaultCampReportDate,
  getNextCampReportDate,
  type CampMajorLevel,
} from '../data/campReportCatalog';
import {
  loadCampReportThemeConfigs,
  loadSummerCampLaunchPreference,
  saveSummerCampLaunchPreference,
} from '../utils/campReportStorage';
import { buildCampThemeVars, CAMP_THEME_UPDATED_EVENT, resolveCampReportTheme } from '../utils/campReportTheme';
import {
  buildBalancedCampPresetGroups,
  campPresetGenderStats,
  CAMP_PRESET_ROSTERS,
  findCampPresetRoster,
  formatCampPresetStudentName,
  getCampPresetRostersForMajorAndPhase,
  type CampPresetRoster,
} from './campPresetRosters';
import {
  shouldPreserveExistingCampPresetSeating,
} from './summerCampLaunchRules';
import type {
  ClassConfig,
  ClassData,
  ClassSnapshot,
  FourGroups,
  GroupRotation,
  LabelNameMode,
  LayoutType,
  LocationInfo,
  OCRSettings,
  ReminderMeta,
  ReminderNote,
  RotationConfig,
  ThemeName,
  TimeMode
} from './types';
export interface AppMountOptions {
  launchClassName?: string;
  availableClassNames?: string[];
  embedded?: boolean;
  queryRoot?: ParentNode;
  hostElement?: HTMLElement | null;
  siteMode?: 'standard' | 'summer-camp';
  defaultLayout?: LayoutType;
  onReady?: () => void;
  disableRemoteBackup?: boolean;
  rotationPreset?: 'standard' | 'camp-cross';
  preserveRotationConfigOnLayoutChange?: boolean;
  availableLayouts?: LayoutType[];
}

const state = createInitialState();
let reminderMeta: ReminderMeta = makeDefaultReminderMeta();
let ocrDrafts: OCRDraftView[] = [];
let ocrSettings: OCRSettings = loadOCRSettings();
let manualTuneDraft: ManualTuneDraft | null = null;
let isOcrRecognitionRunning = false;
let activeClassName = '';
let appMountOptions: AppMountOptions = {};
let appQueryRoot: ParentNode = document;
let updateTimeInterval: number | null = null;
let mountCleanupTasks: Array<() => void> = [];
const emptySeatingPromptedClasses = new Set<string>();
let emptySeatingGuideClassName = '';
let emptySeatingGenerationRunning = false;
let emptySeatingBatchAbortController: AbortController | null = null;

const DEFAULT_GROUP_ORDER = [1, 2, 3, 4, 5, 6];
const CAMP_GROUP_ORDER = [1, 2, 3, 4, 5, 6, 7, 8];
const ALL_LAYOUTS: LayoutType[] = ['circular', 'rows', 'four', 'camp'];

const normalizeRotationConfigsByLayout = (
  configs: Partial<Record<LayoutType, RotationConfig>> | null | undefined,
): Partial<Record<LayoutType, RotationConfig>> => {
  const normalized: Partial<Record<LayoutType, RotationConfig>> = {};
  ALL_LAYOUTS.forEach((layout) => {
    const config = configs?.[layout];
    if (config) {
      normalized[layout] = { ...defaultRotationConfig(layout), ...config };
    }
  });
  return normalized;
};

const rememberCurrentRotationConfig = (): void => {
  state.rotationConfigsByLayout[state.currentLayout] = { ...state.rotationConfig };
};
const DEFAULT_GROUP_LABELS = ['1', '2', '3', '4', '5', '6'];
const CAMP_GROUP_LABELS = ['Group 1', 'Group 2', 'Group 3', 'Group 4', 'Group 5', 'Group 6', 'Group 7', 'Group 8'];

const getDefaultGroupOrder = (layout: LayoutType = 'circular', groupCount = layout === 'camp' ? 8 : 6): number[] =>
  Array.from({ length: groupCount }, (_, index) => (layout === 'camp' ? CAMP_GROUP_ORDER[index] : DEFAULT_GROUP_ORDER[index]) || index + 1);

const getDefaultGroupLabels = (layout: LayoutType = 'circular', groupCount = layout === 'camp' ? 8 : 6): string[] =>
  Array.from({ length: groupCount }, (_, index) => (layout === 'camp' ? CAMP_GROUP_LABELS[index] : DEFAULT_GROUP_LABELS[index]) || `${index + 1}`);

const formatGroupTitle = (label: string, layout: LayoutType = 'circular'): string => {
  const clean = String(label || '').trim();
  if (!clean) {
    return '空组';
  }
  const chineseGroupMatch = clean.match(/^第\s*(\d+)\s*组$/);
  if (layout === 'camp' && chineseGroupMatch) {
    return `Group ${chineseGroupMatch[1]}`;
  }
  if (/^\d+$/.test(clean)) {
    return layout === 'camp' ? `Group ${clean}` : `第${clean}组`;
  }
  return clean;
};

const buildStandardGroupLabelsForOrder = (
  layout: LayoutType,
  groupCount: number,
  groupOrder: number[],
  followMembers: boolean
): string[] => {
  const defaults = getDefaultGroupLabels(layout, groupCount);
  if (!followMembers) {
    return defaults;
  }
  return Array.from({ length: groupCount }, (_, index) => {
    const logicalGroup = Number(groupOrder[index]) || index + 1;
    return defaults[logicalGroup - 1] || defaults[index] || `${logicalGroup}`;
  });
};

const isStandardGroupLabelSet = (labels: string[], expectedLabels: string[]): boolean => {
  const groupCount = expectedLabels.length;
  const normalized = normalizeGroupLabels(labels, groupCount);
  return normalized.every((label, index) => label === expectedLabels[index]);
};

const registerMountCleanup = (cleanup: () => void): void => {
  mountCleanupTasks.push(cleanup);
};

const cleanupMountSideEffects = (): void => {
  while (mountCleanupTasks.length > 0) {
    const cleanup = mountCleanupTasks.pop();
    try {
      cleanup?.();
    } catch {
      // Ignore teardown failures to keep unmount resilient.
    }
  }
};

export const setAppMountOptions = (options: AppMountOptions = {}): void => {
  appMountOptions = options;
  appQueryRoot = options.queryRoot || document;
  setRenderQueryRoot(appQueryRoot);
};

const getLaunchClassName = (): string => {
  try {
    const rawRestoreCamp = new URLSearchParams(window.location.search).get('restoreCamp')?.trim() || '';
    const restoreCampNo = rawRestoreCamp.match(/\d+/)?.[0] || '';
    if (restoreCampNo) {
      return `L2第一期-营${restoreCampNo}`;
    }
  } catch {
    // Fall back to the normal launch context below.
  }

  if (appMountOptions.launchClassName) {
    return appMountOptions.launchClassName.trim();
  }

  try {
    return new URLSearchParams(window.location.search).get('class')?.trim() || '';
  } catch {
    return '';
  }
};

const isSummerCampMode = (): boolean => appMountOptions.siteMode === 'summer-camp';

const syncHistoryCopy = (): void => {
  const previousWeekButton = queryOne<HTMLButtonElement>('#previousWeekBtn');
  if (previousWeekButton) {
    previousWeekButton.textContent = isSummerCampMode() ? '查看上一天座位' : '查看上一周座位表';
  }
  const historyGuide = queryOne<HTMLElement>('#previousHistoryGuide');
  if (historyGuide) {
    historyGuide.textContent = isSummerCampMode()
      ? '如需恢复旧排法，可先查看上一天座位，再决定是否覆盖当前草稿。'
      : '如需恢复旧排法，可先查看上一周座位表，再决定是否覆盖当前草稿。';
  }
};

const getDefaultLaunchLayout = (): LayoutType =>
  appMountOptions.defaultLayout || (isSummerCampMode() ? 'camp' : 'rows');

const campNumberFromText = (value: string): string => {
  const matched = value.match(/营\s*(\d+)/i) || value.match(/camp\s*(\d+)/i);
  return matched?.[1] || '';
};

const currentCampNumber = (): string =>
  campNumberFromText(activeClassName || classSelect()?.value || headerClassName()?.value || '') || '1';

const SUMMER_CAMP_DEFAULT_MAJOR = 'L2';
const SUMMER_CAMP_DEFAULT_DATE = '2026-07-20';

const queryOne = <T extends Element>(selector: string): T | null => appQueryRoot.querySelector(selector) as T | null;

const queryAll = <T extends Element>(selector: string): T[] =>
  Array.from(appQueryRoot.querySelectorAll(selector)) as T[];

const byId = <T extends HTMLElement>(id: string): T => {
  const element = queryOne<T>(`#${id}`);
  if (!element) {
    throw new Error(`Missing element: ${id}`);
  }
  return element as T;
};

const classSelect = (): HTMLSelectElement => byId<HTMLSelectElement>('classSelect');
const floatingClassSelect = (): HTMLSelectElement => byId<HTMLSelectElement>('floatingClassSelect');
const headerClassName = (): HTMLInputElement => byId<HTMLInputElement>('headerClassName');
const notes = (): HTMLDivElement => byId<HTMLDivElement>('notes');
const classroom = (): HTMLDivElement => byId<HTMLDivElement>('classroom');

const isCampMajorLevel = (value: string): value is CampMajorLevel =>
  CAMP_MAJOR_OPTIONS.some((item) => item.level === value);

const getPreferredSummerCampMajor = (): CampMajorLevel => {
  const preferred = loadSummerCampLaunchPreference()?.majorCamp || '';
  return isCampMajorLevel(preferred) ? preferred : SUMMER_CAMP_DEFAULT_MAJOR;
};

const resolveSummerCampThemeMajor = (preferredMajor?: string): CampMajorLevel => {
  if (preferredMajor && isCampMajorLevel(preferredMajor)) {
    return preferredMajor;
  }

  const className = activeClassName || classSelect()?.value || '';
  const roster = findCampPresetRosterByClassName(className);
  if (roster?.majorCamp && isCampMajorLevel(roster.majorCamp)) {
    return roster.majorCamp;
  }

  const classMajor = CAMP_MAJOR_OPTIONS.find((item) => className.startsWith(item.level))?.level;
  if (classMajor && isCampMajorLevel(classMajor)) {
    return classMajor;
  }

  const selectedMajor = summerCampMajorSelect()?.value || '';
  return isCampMajorLevel(selectedMajor) ? selectedMajor : getPreferredSummerCampMajor();
};

const applySummerCampTheme = (preferredMajor?: string): void => {
  if (!isSummerCampMode()) {
    return;
  }

  const major = resolveSummerCampThemeMajor(preferredMajor);
  const theme = resolveCampReportTheme(major, loadCampReportThemeConfigs());
  const vars = buildCampThemeVars(theme);
  const host = appMountOptions.hostElement || queryOne<HTMLElement>('#superamberShell');
  if (!host) {
    return;
  }

  Object.entries(vars).forEach(([key, value]) => {
    if (typeof value === 'string') {
      host.style.setProperty(key, value);
    }
  });
  host.dataset.campMajor = major;
  queryOne<HTMLElement>('#editorView')?.setAttribute('data-camp-major', major);
};

const deepCopy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const toLocalDateKey = (date = new Date()): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const saveReminderState = (): void => {
  saveReminderMeta(reminderMeta);
};

const formatDateLabel = (dateKey: string): string => {
  const converted = dateKeyToMonthDay(dateKey);
  return converted ? `${converted.month}/${converted.day} ${converted.weekday}` : dateKey;
};

const summerCampDateOptions = () =>
  getCampReportDateOptions().map((item) => ({
    ...item,
    monthDay: dateKeyToMonthDay(item.date),
  }));

const summerCampScheduleDates = (): string[] =>
  summerCampDateOptions().map((item) => item.date);

const defaultSummerCampDateKey = (): string =>
  getDefaultCampReportDate() || summerCampDateOptions()[0]?.date || SUMMER_CAMP_DEFAULT_DATE;

const summerCampDateLabel = (dateKey: string): string => {
  const option = summerCampDateOptions().find((item) => item.date === dateKey);
  const converted = option?.monthDay || dateKeyToMonthDay(dateKey);
  if (!converted) {
    return option?.dayLabel || dateKey;
  }
  return `${converted.month}/${converted.day} ${converted.weekday}${option ? ` · ${option.dayLabel}` : ''}`;
};

const summerCampCompactDateLabel = (dateKey: string): string => {
  const converted = dateKeyToMonthDay(dateKey);
  return converted ? `${converted.month}月${converted.day}日` : dateKey;
};

const summerCampDayLabel = (dateKey: string): string =>
  summerCampDateOptions().find((item) => item.date === dateKey)?.dayLabel || '';

const SUMMER_CAMP_SEAT_TITLE_MAX_SIZE = 52;
const SUMMER_CAMP_SEAT_TITLE_MIN_SIZE = 26;
let summerCampSeatTitleFitFrame = 0;

const setSummerCampSeatTitleSize = (title: HTMLElement, size: number): void => {
  title.style.setProperty('--camp-seat-title-size', `${size}px`);
};

const fitSummerCampSeatTitle = (): void => {
  if (!isSummerCampMode()) {
    return;
  }
  const title = queryOne<HTMLElement>('#summerCampSeatTitle');
  if (!title || !title.textContent?.trim()) {
    return;
  }
  const header = title.closest<HTMLElement>('.header') || title.parentElement;
  const availableWidth = Math.max(0, title.clientWidth || header?.clientWidth || 0);
  if (availableWidth <= 0) {
    return;
  }

  let fittedSize = SUMMER_CAMP_SEAT_TITLE_MIN_SIZE;
  for (let size = SUMMER_CAMP_SEAT_TITLE_MAX_SIZE; size >= SUMMER_CAMP_SEAT_TITLE_MIN_SIZE; size -= 1) {
    setSummerCampSeatTitleSize(title, size);
    if (title.scrollWidth <= availableWidth) {
      fittedSize = size;
      break;
    }
  }
  setSummerCampSeatTitleSize(title, fittedSize);
};

const queueSummerCampSeatTitleFit = (): void => {
  if (summerCampSeatTitleFitFrame) {
    window.cancelAnimationFrame(summerCampSeatTitleFitFrame);
  }
  summerCampSeatTitleFitFrame = window.requestAnimationFrame(() => {
    summerCampSeatTitleFitFrame = 0;
    fitSummerCampSeatTitle();
  });
};

const getSummerCampDateKeyFromInfo = (info: Partial<LocationInfo> | undefined): string =>
  sanitizeLocationInfo(info).fullDate || defaultSummerCampDateKey();

const nextSummerCampClassDate = (dateKey: string): string => {
  const scheduledNextDate = getNextCampReportDate(dateKey);
  if (scheduledNextDate) {
    return scheduledNextDate;
  }

  if (getCampReportDateIndex(dateKey) >= 0) {
    return dateKey;
  }

  let nextDate = dateKey;
  for (let attempts = 0; attempts < 8; attempts += 1) {
    const candidate = addDays(nextDate, 1);
    if (!candidate) {
      return defaultSummerCampDateKey();
    }
    const converted = dateKeyToMonthDay(candidate);
    if (converted?.weekday !== '星期日') {
      return candidate;
    }
    nextDate = candidate;
  }
  return dateKey;
};

const getModeDateKey = (mode: ClassConfig[TimeMode]): string => {
  const info = sanitizeLocationInfo(mode.locationInfo || {});
  return info.fullDate || monthDayToDateKey(info.date, info.day) || parseDateFromClassTime(info.time) || '';
};

const showDialog = (id: string): void => {
  byId<HTMLDivElement>(id).style.display = 'block';
  byId<HTMLDivElement>('overlay').style.display = 'block';
};

const hideDialog = (id: string): void => {
  byId<HTMLDivElement>(id).style.display = 'none';
  byId<HTMLDivElement>('overlay').style.display = 'none';
};

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const shuffleStudents = (students: string[]): string[] => {
  const next = [...students];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
};

let pendingCnfClassName = '';

const createClassFromKnownRoster = (className: string): void => {
  const students = loadKnownRosterForClass(className);
  if (students.length === 0) {
    alert('这班还没有可用名单。可以先用“核心名单随机排座”生成，或手动导入学生名单。');
    return;
  }

  ensureClassShell(className);
  syncClassPickerValues(className);
  activeClassName = className;
  headerClassName().value = className;
  state.currentTimeMode = 'weekday';
  setCurrentView('editor');
  importDefaultLayout(shuffleStudents(students));
  seedOtherModeForNewClass(className);
  hydrateClassScheduleFromMeta(className, { force: true });
  saveKnownRosterForClass(className, students);
  renderClassOverview();
};

const openCnfDialogForClass = (className: string, message = '请先连接主站教务系统，然后在这里直接抓取。'): void => {
  pendingCnfClassName = className.trim();
  showCnfSyncDialog(message, 'cnf-busy');
};

type SessionRosterStatus = 'ok' | 'unauthorized' | 'error' | 'timeout' | 'cancelled';

const fetchRosterViaSession = async (
  className: string,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<{ status: SessionRosterStatus; students: string[] }> => {
  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs ?? 15000);
  const abortFromParent = (): void => controller.abort();
  options.signal?.addEventListener('abort', abortFromParent, { once: true });
  try {
    const resp = await fetch('/api/scraper/get-student-list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ classId: className }),
      signal: controller.signal,
    });

    if (resp.status === 401) {
      return { status: 'unauthorized', students: [] };
    }
    if (!resp.ok) {
      return { status: 'error', students: [] };
    }

    const data = await resp.json().catch(() => ({}));
    return { status: 'ok', students: extractRosterStudents((data as { data?: unknown }).data) };
  } catch {
    if (options.signal?.aborted) {
      return { status: 'cancelled', students: [] };
    }
    if (timedOut) {
      return { status: 'timeout', students: [] };
    }
    return { status: 'error', students: [] };
  } finally {
    window.clearTimeout(timeoutId);
    options.signal?.removeEventListener('abort', abortFromParent);
  }
};

const fetchRosterViaSharedCnf = async (
  className: string
): Promise<{ status: 'ok' | 'missing-session' | 'no-match' | 'error'; students: string[] }> => {
  try {
    const squads = await cnfLoginAndListSquads();
    const matched = findMatchingCnfSquad(squads, className);
    if (!matched) {
      return { status: 'no-match', students: [] };
    }

    const result = await cnfFetchRoster(undefined, String(matched.id), matched.type || 'offline');
    return { status: 'ok', students: extractRosterStudents(result.students) };
  } catch (error) {
    if (error instanceof Error && /未登录|重新登录/.test(error.message)) {
      return { status: 'missing-session', students: [] };
    }
    return { status: 'error', students: [] };
  }
};

const fetchRosterForClass = async (className: string): Promise<string[] | null> => {
  const sessionResult = await fetchRosterViaSession(className);
  if (sessionResult.status === 'ok' && sessionResult.students.length > 0) {
    saveKnownRosterForClass(className, sessionResult.students);
    return sessionResult.students;
  }

  if (sessionResult.status !== 'unauthorized') {
    return null;
  }

  const cnfResult = await fetchRosterViaSharedCnf(className);
  if (cnfResult.status === 'ok' && cnfResult.students.length > 0) {
    saveKnownRosterForClass(className, cnfResult.students);
    return cnfResult.students;
  }

  openCnfDialogForClass(className);
  return null;
};

const syncFromCoreRoster = (): void => {
  const className = activeClassName.trim();
  if (!className) {
    alert('请先选择一个班级。');
    return;
  }
  const rosterNames = loadKnownRosterForClass(className);
  if (rosterNames.length === 0) {
    void (async () => {
      const students = await fetchRosterForClass(className);
      if (!students) {
        return;
      }
      if (students.length === 0) {
          alert(`${className} 在教务系统中暂无学生数据。`);
          return;
      }
      const currentStudentCount = countCurrentEditorStudents();
      if (currentStudentCount > 0) {
        const ok = window.confirm(
          `当前座位表有 ${currentStudentCount} 人。\n\n这次抓到 ${students.length} 人学生名单。是否用新名单重新随机生成座位表？（当前座位会被覆盖）`
        );
        if (!ok) {
          saveKnownRosterForClass(className, students);
          alert(`已抓取 ${className} 的 ${students.length} 人学生名单，并保留当前座位表不变。`);
          return;
        }
      }
      importDefaultLayout(shuffleStudents(students));
      refresh();
      saveCurrentClassMode();
      alert(`已为 ${className} 现抓现导 ${students.length} 人，并随机生成座位表。`);
    })();
    return;
  }

  const currentStudents = collectStudentsFromCurrentLayout();

  if (currentStudents.length > 0) {
    const ok = window.confirm(
      `当前座位表有 ${currentStudents.length} 人，核心名单有 ${rosterNames.length} 人。\n\n是否用核心名单重新随机生成座位表？（当前座位会被覆盖）`
    );
    if (!ok) return;
  }

  importDefaultLayout(shuffleStudents(rosterNames));
  refresh();
  saveCurrentClassMode();
  alert(`已用 ${rosterNames.length} 人核心名单随机生成座位表。`);
};

const rosterSourceLabel = (): string => isSummerCampMode() ? '当前保存名单' : '核心名单';

const savedRosterMirrorNamesForClass = (className: string): string[] => {
  const mirror = state.classData[className]?.rosterMirror;
  if (!Array.isArray(mirror) || mirror.length === 0) {
    return [];
  }
  return normalizeStudentList(
    mirror.map((student) => student.englishName || student.chineseName).filter(Boolean),
  );
};

const buildSummerCampRosterMirror = (students: string[]): ClassConfig['rosterMirror'] =>
  normalizeStudentList(students).map((name, index) => ({
    id: `manual-${index + 1}`,
    studentId: `manual-${index + 1}`,
    chineseName: '',
    englishName: name,
  }));

const rosterNamesForClass = (className: string): string[] => {
  if (isSummerCampMode()) {
    const savedNames = savedRosterMirrorNamesForClass(className);
    if (savedNames.length > 0) {
      return savedNames;
    }

    const knownRoster = loadKnownRosterForClass(className);
    if (knownRoster.length > 0) {
      return knownRoster;
    }

    const presetRoster = findCampPresetRosterByClassName(className);
    return presetRoster ? presetRoster.students.map(formatCampPresetStudentName) : [];
  }

  const mirrorNames = savedRosterMirrorNamesForClass(className);
  if (mirrorNames.length > 0) {
    return mirrorNames;
  }

  return loadKnownRosterForClass(className);
};

const updateRosterDiffBanner = (): void => {
  const banner = queryOne<HTMLDivElement>('#rosterDiffBanner');
  if (!banner) {
    return;
  }
  const className = activeClassName.trim();
  if (!className) {
    banner.style.display = 'none';
    return;
  }

  const rosterNames = rosterNamesForClass(className);
  if (rosterNames.length === 0) {
    banner.style.display = 'none';
    return;
  }

  const currentStudents = collectStudentsFromCurrentLayout();

  if (currentStudents.length === 0) {
    banner.style.display = 'none';
    return;
  }

  const { extra, missing } = computeRosterDiff(rosterNames, currentStudents);

  if (extra.length === 0 && missing.length === 0) {
    banner.style.display = '';
    banner.className = 'roster-diff-banner roster-diff-ok';
    banner.textContent = `✓ 座位表与${rosterSourceLabel()}一致（${rosterNames.length} 人）`;
    return;
  }

  const parts: string[] = [];
  if (missing.length > 0) {
    parts.push(`<span class="diff-missing">${rosterSourceLabel()}有但座位表没有（${missing.length}人）：${missing.join('、')}</span>`);
  }
  if (extra.length > 0) {
    parts.push(`<span class="diff-extra">座位表有但${rosterSourceLabel()}没有（${extra.length}人）：${extra.join('、')}</span>`);
  }
  banner.style.display = '';
  banner.className = 'roster-diff-banner roster-diff-warn';
  banner.innerHTML = parts.join('<br>');
};

const toggleImportMenu = (): void => {
  const menu = byId<HTMLDivElement>('importMenu');
  menu.style.display = menu.style.display === 'none' ? '' : 'none';
};

const hideImportMenu = (): void => {
  byId<HTMLDivElement>('importMenu').style.display = 'none';
};

const fillFirstEmptySeatInCurrentLayout = (studentName: string): boolean => {
  const cleanName = studentName.trim();
  if (!cleanName) {
    return false;
  }

  if (state.currentLayout === 'circular' || state.currentLayout === 'camp') {
    for (const group of state.groups) {
      const emptyIndex = group.findIndex((seat) => !String(seat || '').trim());
      if (emptyIndex >= 0) {
        group[emptyIndex] = cleanName;
        return true;
      }
    }
    return false;
  }

  if (state.currentLayout === 'rows') {
    for (const row of state.rowGroups.rows) {
      for (const side of ['left', 'right'] as const) {
        const emptyIndex = row[side].findIndex((seat) => !String(seat || '').trim());
        if (emptyIndex >= 0) {
          row[side][emptyIndex] = cleanName;
          return true;
        }
      }
    }
    return false;
  }

  for (const group of state.fourGroups.groups) {
    const emptyIndex = group.findIndex((seat) => !String(seat || '').trim());
    if (emptyIndex >= 0) {
      group[emptyIndex] = cleanName;
      return true;
    }
  }
  return false;
};

const restoreMissingRosterStudents = (students: string[]): { restored: string[]; skipped: string[] } => {
  const restored: string[] = [];
  const skipped: string[] = [];

  normalizeStudentList(students).forEach((studentName) => {
    if (fillFirstEmptySeatInCurrentLayout(studentName)) {
      restored.push(studentName);
    } else {
      skipped.push(studentName);
    }
  });

  if (restored.length > 0) {
    state.currentArrangement = 0;
    refresh();
    saveCurrentClassMode();
    renderClassOverview();
    updateRosterDiffBanner();
  }

  return { restored, skipped };
};

const showRosterCheckDialog = (): void => {
  const className = activeClassName.trim();
  if (!className) {
    alert('请先选择一个班级。');
    return;
  }

  const rosterNames = rosterNamesForClass(className);
  const currentStudents = collectStudentsFromCurrentLayout();

  let bodyHtml = '';
  let missingStudents: string[] = [];
  const sourceLabel = rosterSourceLabel();
  if (rosterNames.length === 0) {
    bodyHtml = isSummerCampMode()
      ? '<p>未找到该营的名单。内置预设营请先选择营号，其他营请先上传学生名单。</p>'
      : '<p>未找到该班级名单。可以先用“核心名单随机排座”生成，或手动导入学生名单。</p>';
  } else if (currentStudents.length === 0) {
    bodyHtml = '<p>座位表还没有学生数据。</p>';
  } else {
    const { missing, extra } = computeRosterDiff(rosterNames, currentStudents);
    missingStudents = missing;

    if (missing.length === 0 && extra.length === 0) {
      bodyHtml = `<div class="roster-check-ok">✓ 座位表与${sourceLabel}完全一致（${rosterNames.length} 人）</div>`;
    } else {
      const parts: string[] = [];
      if (missing.length > 0) {
        parts.push(`<div class="diff-missing">${sourceLabel}有但座位表没有（${missing.length}人）：<br><strong>${missing.join('、')}</strong></div>`);
      }
      if (extra.length > 0) {
        parts.push(`<div class="diff-extra">座位表有但${sourceLabel}没有（${extra.length}人）：<br><strong>${extra.join('、')}</strong></div>`);
      }
      bodyHtml = `<div class="roster-check-warn">${parts.join('<br>')}</div>`;
    }
  }

  const overlay = document.createElement('div');
  overlay.className = 'roster-check-overlay';
  const restoreButtonHtml = missingStudents.length > 0
    ? '<button type="button" class="restore-missing-roster">确认加回缺失学生</button>'
    : '';
  overlay.innerHTML = `
    <div class="roster-check-panel">
      <h3>名单核对 · ${className}</h3>
      ${bodyHtml}
      <div class="btn-row">
        ${restoreButtonHtml}
        <button class="close-roster-check">关闭</button>
      </div>
    </div>
  `;
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || (e.target as HTMLElement).classList.contains('close-roster-check')) {
      overlay.remove();
    }
  });
  overlay.querySelector<HTMLButtonElement>('.restore-missing-roster')?.addEventListener('click', () => {
    const latestRosterNames = rosterNamesForClass(className);
    const latestDiff = computeRosterDiff(latestRosterNames, collectStudentsFromCurrentLayout());
    if (latestDiff.missing.length === 0) {
      alert('当前座位表已经和名单一致，不需要加回学生。');
      overlay.remove();
      return;
    }

    const ok = window.confirm(`确认把这些学生加回当前座位表吗？\n\n${latestDiff.missing.join('、')}`);
    if (!ok) {
      return;
    }

    const { restored, skipped } = restoreMissingRosterStudents(latestDiff.missing);
    const messageParts: string[] = [];
    if (restored.length > 0) {
      messageParts.push(`已加回：${restored.join('、')}`);
    }
    if (skipped.length > 0) {
      messageParts.push(`没有空位，未加回：${skipped.join('、')}`);
    }
    alert(messageParts.join('\n') || '没有需要加回的学生。');
    overlay.remove();
  });
  (appQueryRoot as Element).appendChild(overlay);
};

const saveProfile = (): void => {
  saveUserProfile(state.userProfile);
};

let seatingRemoteBackupTimer = 0;
let suppressRemoteBackup = false;

const classDataHasEntries = (classData: ClassData): boolean => Object.keys(classData).length > 0;
const serverLockedRestoreClasses = new Set(['L2第一期-营9']);

const getForcedSummerCampBackupRestore = (): { campNo: string; className: string } | null => {
  if (typeof window === 'undefined') {
    return null;
  }
  const url = new URL(window.location.href);
  const raw = String(url.searchParams.get('restoreCamp') || '').trim();
  const campNo = raw.match(/\d+/)?.[0] || '';
  if (!campNo) {
    return null;
  }
  return {
    campNo,
    className: `L2第一期-营${campNo}`,
  };
};

const notifyLocalSaveFailure = (): void => {
  setSummerCampSaveStatus('本地保存失败，请先导出备份后再继续操作', 'dirty');
  const banner = queryOne<HTMLElement>('#localSaveWarning');
  if (banner) banner.hidden = false;
};

const scheduleSeatingRemoteBackup = (): void => {
  if (suppressRemoteBackup || appMountOptions.disableRemoteBackup) {
    return;
  }
  if (!classDataHasEntries(state.classData)) {
    return;
  }
  if (seatingRemoteBackupTimer) {
    window.clearTimeout(seatingRemoteBackupTimer);
  }
  seatingRemoteBackupTimer = window.setTimeout(() => {
    seatingRemoteBackupTimer = 0;
    const payload = buildBackupPayload();
    if (!classDataHasEntries(payload.classData)) {
      return;
    }
    void saveSeatingBackup(payload).catch((error) => {
      console.warn('座位表后台备份失败:', error);
    });
  }, 900);
};

const persist = (): boolean => {
  const ok = saveClassData(state.classData);
  if (ok) {
    const banner = queryOne<HTMLElement>('#localSaveWarning');
    if (banner) banner.hidden = true;
    scheduleSeatingRemoteBackup();
  }
  return ok;
};

const runWithoutRemoteBackup = (task: () => void): void => {
  const previous = suppressRemoteBackup;
  suppressRemoteBackup = true;
  try {
    task();
  } finally {
    suppressRemoteBackup = previous;
  }
};

const applyTheme = (theme: ThemeName): void => {
  const host = appMountOptions.hostElement;
  if (!host) {
    return;
  }

  host.classList.remove(
    'theme-paper',
    'theme-classic',
    'theme-mint',
    'theme-rose',
    'theme-apricot',
    'theme-golden',
    'theme-plum'
  );
  host.classList.add(`theme-${theme}`);
  byId<HTMLSelectElement>('themeSelect').value = theme;
};

const getClassTheme = (className: string): ThemeName => state.classData[className]?.theme || state.userProfile.theme || 'paper';

const syncEditorThemeSelect = (theme: ThemeName): void => {
  byId<HTMLSelectElement>('editorThemeSelect').value = theme;
};

const ensureUsername = (): void => {
  const currentName = state.userProfile.username.trim();
  if (currentName) {
    return;
  }

  if (appMountOptions.embedded) {
    const inheritedName = localStorage.getItem('amber_username')?.trim() || 'Teacher';
    state.userProfile.username = inheritedName;
    saveProfile();
    return;
  }

  const input = window.prompt('请输入用户名', 'Teacher');
  const username = input?.trim() || 'Teacher';
  state.userProfile.username = username;
  saveProfile();
};

const normalizeMetaWeekday = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const first = trimmed.split('/')[0]?.trim() || trimmed;
  const map: Record<string, string> = {
    周一: '星期一',
    周二: '星期二',
    周三: '星期三',
    周四: '星期四',
    周五: '星期五',
    周六: '星期六',
    周日: '星期日',
    星期一: '星期一',
    星期二: '星期二',
    星期三: '星期三',
    星期四: '星期四',
    星期五: '星期五',
    星期六: '星期六',
    星期日: '星期日',
    星期天: '星期日',
  };
  return map[first] || first;
};

const normalizeMetaCampus = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const first = trimmed.split('/')[0]?.trim() || trimmed;
  if (first === 'C86') return 'C86校区';
  if (first === '七彩') return '七彩校区';
  if (first === '十中') return '十中校区';
  return first;
};

const normalizeMetaFloor = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const first = trimmed.split('/')[0]?.trim() || trimmed;
  const matched = first.match(/(\d+)/);
  return matched?.[1] ? matched[1] : '';
};

const normalizeMetaRoom = (value: string, campusValue = ''): string => {
  let room = value.trim();
  if (!room) return '';
  const campus = normalizeMetaCampus(campusValue);
  const aliases = [campus, campus.replace(/校区/g, ''), 'C86校区', 'C86', '七彩校区', '七彩', '十中校区', '十中']
    .filter(Boolean);
  room = room.replace(/[（(][^）)]*[）)]/g, '').trim();
  aliases.forEach((alias) => {
    room = room.replace(new RegExp(alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '').trim();
  });
  room = room.replace(/^[-—\s]+/, '').trim();
  if (/^\d+楼[-—]?\d+$/.test(room)) {
    const matched = room.match(/^(\d+楼)[-—]?(\d+)$/);
    if (matched) return `${matched[1]}${matched[2]}教室`;
  }
  if (/^\d+[-—]\d+$/.test(room)) {
    const matched = room.match(/^(\d+)[-—](\d+)$/);
    if (matched) return `${matched[1]}楼${matched[2]}教室`;
  }
  if (/^\d{3,4}$/.test(room)) return `${room}教室`;
  if (/^[A-Za-z]\d+$/.test(room)) return `${room}教室`;
  return room;
};

const updateWelcome = (): void => {
  const week = getWeekNumber();
  const weekLabel = queryOne<HTMLSpanElement>('#homeWeekNum');
  if (weekLabel) {
    weekLabel.textContent = String(week);
  }
  byId<HTMLHeadingElement>('welcomeText').textContent = `${APP_NAME} · ${state.userProfile.username}`;
  byId<HTMLParagraphElement>('todayText').textContent = `今天是 ${formatTodayLabel()}，第${week}周，${getChineseWeekday()}`;
  byId<HTMLInputElement>('usernameInput').value = state.userProfile.username;
  applySiteModeUi();
};

const applySiteModeUi = (): void => {
  const summerMode = isSummerCampMode();
  byId<HTMLDivElement>('superamberShell').classList.toggle('is-summer-camp-site', summerMode);
  if (!summerMode) {
    return;
  }

  byId<HTMLHeadingElement>('welcomeText').textContent = '夏令营座位表';
  byId<HTMLParagraphElement>('todayText').textContent = '按大营、营号和上课日生成座位表';
  byId<HTMLButtonElement>('newClassBtn').textContent = '选择/新建营座位表';
  byId<HTMLButtonElement>('generateWeekBtn').textContent = '生成下一上课日座位表';
  byId<HTMLButtonElement>('undoWeekBtn').textContent = '撤回上次日轮转';
  populateSummerCampPicker();
  const createTitle = queryOne<HTMLHeadingElement>('#createClassDialog h2');
  if (createTitle) {
    createTitle.textContent = '选择/新建夏令营座位表';
  }
  const importTitle = queryOne<HTMLHeadingElement>('#importDialog h2');
  if (importTitle) {
    importTitle.textContent = '上传夏令营学生名单';
  }
};

const setUsageGuideVisible = (visible: boolean): void => {
  byId<HTMLDivElement>('homeView')
    .querySelector<HTMLElement>('.usage-guide')
    ?.classList.toggle('hidden', !visible);
  byId<HTMLButtonElement>('usageGuideToggleBtn').textContent = visible ? '隐藏使用说明' : '查看使用说明';
  writeStorageValue(storageKeys.usageGuideDismissed, visible ? '0' : '1');
};

const initializeUsageGuide = (): void => {
  setUsageGuideVisible(readStorageValue(storageKeys.usageGuideDismissed) === '0');
};

const toggleUsageGuide = (): void => {
  const guide = byId<HTMLDivElement>('homeView').querySelector<HTMLElement>('.usage-guide');
  setUsageGuideVisible(guide?.classList.contains('hidden') ?? false);
};

const collectStudentsFromModeData = (mode: ClassConfig[TimeMode]): string[] => {
  if (mode.layout === 'circular') {
    return collectStudentsFromCircular(mode.groups || []);
  }
  if (mode.layout === 'camp') {
    return collectStudentsFromCamp(mode.groups || makeEmptyCampGroups());
  }
  if (mode.layout === 'rows') {
    return collectStudentsFromRows(mode.rowGroups || makeEmptyRowGroups());
  }
  return collectStudentsFromFour(mode.fourGroups || makeEmptyFourGroups());
};

const countStudentsInMode = (mode: ClassConfig[TimeMode]): number => {
  return collectStudentsFromModeData(mode).length;
};

const hasRosterDifference = (rosterNames: string[], seatingNames: string[]): boolean => {
  if (rosterNames.length === 0 || seatingNames.length === 0) {
    return false;
  }
  const { missing, extra } = computeRosterDiff(rosterNames, seatingNames);
  return missing.length > 0 || extra.length > 0;
};

const primarySavedModeForSummerCampClass = (
  className: string,
  presetRosterNames: string[] = [],
): ClassConfig[TimeMode] | null => {
  const config = state.classData[className];
  if (!config) {
    return null;
  }

  const weekdayStudents = collectStudentsFromModeData(config.weekday);
  const weekendStudents = collectStudentsFromModeData(config.weekend);
  if (hasRosterDifference(presetRosterNames, weekdayStudents)) {
    return config.weekday;
  }
  if (hasRosterDifference(presetRosterNames, weekendStudents)) {
    return config.weekend;
  }
  if (weekdayStudents.length > 0) {
    return config.weekday;
  }

  return weekendStudents.length > 0 ? config.weekend : null;
};

const collectStudentsFromCurrentLayout = (): string[] => {
  if (state.currentLayout === 'circular') {
    return collectStudentsFromCircular(state.groups);
  }
  if (state.currentLayout === 'camp') {
    return collectStudentsFromCamp(state.groups);
  }
  if (state.currentLayout === 'rows') {
    return collectStudentsFromRows(state.rowGroups);
  }
  return collectStudentsFromFour(state.fourGroups);
};

const countCurrentEditorStudents = (): number => {
  return collectStudentsFromCurrentLayout().length;
};

const classHasAnySavedSeating = (config: ClassConfig | null | undefined): boolean => {
  if (!config) return false;
  return countStudentsInMode(config.weekday) > 0 || countStudentsInMode(config.weekend) > 0;
};

const setEmptySeatingGuideBusy = (busy: boolean): void => {
  emptySeatingGenerationRunning = busy;
  queryAll<HTMLButtonElement>('#emptySeatingDialog button').forEach((button) => {
    button.disabled = busy && !button.hasAttribute('data-allow-while-busy');
  });
  const stopButton = queryOne<HTMLButtonElement>('#emptySeatingStopBtn');
  if (stopButton) {
    stopButton.hidden = !(busy && emptySeatingBatchAbortController);
    stopButton.disabled = false;
  }
};

const cancelEmptySeatingGeneration = (): void => {
  if (!emptySeatingGenerationRunning || !emptySeatingBatchAbortController) return;
  byId<HTMLDivElement>('emptySeatingStatus').textContent = '正在停止，已生成的班级会保留…';
  const stopButton = queryOne<HTMLButtonElement>('#emptySeatingStopBtn');
  if (stopButton) stopButton.disabled = true;
  emptySeatingBatchAbortController.abort();
};

const showEmptySeatingMethodStep = (): void => {
  if (emptySeatingGenerationRunning) return;
  byId<HTMLDivElement>('emptySeatingMethodStep').hidden = false;
  byId<HTMLDivElement>('emptySeatingScopeStep').hidden = true;
  byId<HTMLDivElement>('emptySeatingStatus').textContent = '';
};

const showEmptySeatingScopeStep = (): void => {
  if (emptySeatingGenerationRunning) return;
  byId<HTMLDivElement>('emptySeatingMethodStep').hidden = true;
  byId<HTMLDivElement>('emptySeatingScopeStep').hidden = false;
  byId<HTMLDivElement>('emptySeatingStatus').textContent = '';
};

const hideEmptySeatingDialog = (): void => {
  if (emptySeatingGenerationRunning) return;
  hideDialog('emptySeatingDialog');
};

const showEmptySeatingDialog = (className: string): void => {
  emptySeatingGuideClassName = className;
  byId<HTMLElement>('emptySeatingClassName').textContent = className;
  setEmptySeatingGuideBusy(false);
  showEmptySeatingMethodStep();
  showDialog('emptySeatingDialog');
};

const maybeShowEmptySeatingDialog = (className: string): void => {
  const normalized = className.trim();
  if (
    !normalized
    || isSummerCampMode()
    || emptySeatingPromptedClasses.has(normalized)
    || classConfigHasAnySeating(state.classData[normalized])
  ) {
    return;
  }

  window.requestAnimationFrame(() => {
    if (
      state.currentView !== 'editor'
      || activeClassName !== normalized
      || emptySeatingPromptedClasses.has(normalized)
      || classConfigHasAnySeating(state.classData[normalized])
      || hasOpenEditorDialog()
    ) {
      return;
    }
    emptySeatingPromptedClasses.add(normalized);
    showEmptySeatingDialog(normalized);
  });
};

const startEmptySeatingManualImport = (): void => {
  if (emptySeatingGenerationRunning) return;
  hideEmptySeatingDialog();
  showImportDialog();
};

const allKnownClassNames = (): string[] => {
  const byNormalizedName = new Map<string, string>();
  [...Object.keys(state.classData), ...(appMountOptions.availableClassNames || [])]
    .map((className) => className.trim())
    .filter(Boolean)
    .forEach((className) => {
      const key = className.toUpperCase();
      if (!byNormalizedName.has(key)) {
        byNormalizedName.set(key, className);
      }
    });
  return [...byNormalizedName.values()].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
};

type AutoRosterResult = {
  status: 'ok' | 'missing' | 'unauthorized' | 'error' | 'timeout' | 'cancelled';
  students: string[];
};

const loadRosterForAutomaticSeating = async (className: string, signal?: AbortSignal): Promise<AutoRosterResult> => {
  const cached = rosterNamesForClass(className);
  if (cached.length > 0) {
    return { status: 'ok', students: cached };
  }

  const fetched = await fetchRosterViaSession(className, { signal });
  if (fetched.status === 'unauthorized') {
    return { status: 'unauthorized', students: [] };
  }
  if (fetched.status === 'error') {
    return { status: 'error', students: [] };
  }
  if (fetched.status === 'timeout' || fetched.status === 'cancelled') {
    return { status: fetched.status, students: [] };
  }
  if (fetched.students.length === 0) {
    return { status: 'missing', students: [] };
  }
  saveKnownRosterForClass(className, fetched.students);
  return { status: 'ok', students: fetched.students };
};

const populateEmptyClassAutomatically = (className: string, students: string[]): boolean => {
  ensureClassShell(className);
  const config = state.classData[className];
  const generated = populateEmptyClassWithStudents(config, shuffleStudents(students), getDefaultLaunchLayout());
  if (!generated) {
    return false;
  }
  saveKnownRosterForClass(className, students);
  hydrateClassScheduleFromMeta(className);
  return true;
};

const finalizeAutomaticSeating = (generatedClasses: string[]): void => {
  if (generatedClasses.length > 0) {
    if (!persist()) {
      notifyLocalSaveFailure();
    }
    updateClassSelect();
    renderClassOverview();
    if (generatedClasses.includes(activeClassName)) {
      syncClassPickerValues(activeClassName);
      loadClass();
    }
  }
};

const generateEmptySeatingForCurrentClass = async (): Promise<void> => {
  if (emptySeatingGenerationRunning) return;
  const className = emptySeatingGuideClassName || activeClassName.trim();
  if (!className) return;

  setEmptySeatingGuideBusy(true);
  try {
    byId<HTMLDivElement>('emptySeatingStatus').textContent = `正在读取 ${className} 的学生名单…`;
    const roster = await loadRosterForAutomaticSeating(className);
    if (roster.status !== 'ok') {
      byId<HTMLDivElement>('emptySeatingStatus').textContent = roster.status === 'unauthorized'
        ? '教务登录已失效，请重新登录后再试。'
        : roster.status === 'missing'
          ? '这个班级暂时没有可用学生名单，可返回选择手动导入。'
          : roster.status === 'timeout'
            ? '学生名单读取超时，请点击“仅当前班级”重试或改用手动导入。'
            : '学生名单读取失败，请稍后重试或改用手动导入。';
      return;
    }

    const generated = populateEmptyClassAutomatically(className, roster.students);
    finalizeAutomaticSeating(generated ? [className] : []);
    hideDialog('emptySeatingDialog');
    window.alert(generated
      ? `已为 ${className} 随机生成座位表，共 ${roster.students.length} 人。`
      : `${className} 已有座位安排，没有覆盖。`);
  } catch (error) {
    console.error('当前班级自动生成失败:', error);
    byId<HTMLDivElement>('emptySeatingStatus').textContent = '生成失败，请重试或返回选择手动导入。';
  } finally {
    setEmptySeatingGuideBusy(false);
  }
};

const generateEmptySeatingForAllClasses = async (): Promise<void> => {
  if (emptySeatingGenerationRunning) return;
  const classNames = allKnownClassNames();
  const targets = classNames.filter((className) => !classConfigHasAnySeating(state.classData[className]));
  if (targets.length === 0) {
    byId<HTMLDivElement>('emptySeatingStatus').textContent = '所有班级都已经有座位安排。';
    return;
  }

  const controller = new AbortController();
  emptySeatingBatchAbortController = controller;
  setEmptySeatingGuideBusy(true);
  const generated: string[] = [];
  const missing: string[] = [];
  const failed: string[] = [];
  const timedOut: string[] = [];
  let unauthorized = false;
  let cancelled = false;

  try {
    for (let index = 0; index < targets.length; index += 1) {
      const className = targets[index];
      byId<HTMLDivElement>('emptySeatingStatus').textContent = `正在生成 ${index + 1}/${targets.length}：${className}`;
      const roster = await loadRosterForAutomaticSeating(className, controller.signal);
      if (roster.status === 'cancelled') {
        cancelled = true;
        break;
      }
      if (roster.status === 'unauthorized') {
        unauthorized = true;
        break;
      }
      if (roster.status === 'missing') {
        missing.push(className);
        continue;
      }
      if (roster.status === 'timeout') {
        timedOut.push(className);
        continue;
      }
      if (roster.status === 'error') {
        failed.push(className);
        continue;
      }
      try {
        if (populateEmptyClassAutomatically(className, roster.students)) {
          generated.push(className);
        }
      } catch (error) {
        console.error(`自动生成 ${className} 失败:`, error);
        failed.push(className);
      }
    }
  } catch (error) {
    console.error('批量自动生成座位表失败:', error);
    failed.push('未完成班级');
  } finally {
    finalizeAutomaticSeating(generated);
    emptySeatingBatchAbortController = null;
    setEmptySeatingGuideBusy(false);
  }

  const parts = [`已生成 ${generated.length} 个空班级`];
  if (missing.length > 0) parts.push(`${missing.length} 个暂无名单`);
  if (timedOut.length > 0) parts.push(`${timedOut.length} 个读取超时，可再次点击重试`);
  if (failed.length > 0) parts.push(`${failed.length} 个读取失败`);
  if (unauthorized) parts.push('教务登录已失效，批量生成已停止');
  if (cancelled) parts.push('已按你的操作停止');
  parts.push('可重试未生成班级，或点击“暂不生成”退出');
  byId<HTMLDivElement>('emptySeatingStatus').textContent = `${parts.join('；')}。`;
  window.alert(`${parts.join('；')}。\n已有座位安排的班级均未覆盖。`);
};

const makeEmptyModeDataForLayout = (layout: LayoutType, locationInfo: LocationInfo = makeEmptyLocationInfo()): ClassConfig[TimeMode] => {
  const groupCount = layout === 'camp' ? 8 : 6;
  return {
    layout,
    groups: (layout === 'circular' || layout === 'camp')
      ? (layout === 'camp' ? makeEmptyCampGroups(groupCount) : makeEmptyCircularGroups())
      : null,
    groupOrder: (layout === 'circular' || layout === 'rows' || layout === 'four' || layout === 'camp')
      ? getDefaultGroupOrder(layout, groupCount)
      : null,
    groupLabels: (layout === 'circular' || layout === 'rows' || layout === 'four' || layout === 'camp')
      ? getDefaultGroupLabels(layout, groupCount)
      : null,
    rowGroups: layout === 'rows' ? makeEmptyRowGroups() : null,
    fourGroups: layout === 'four' ? makeEmptyFourGroups() : null,
    currentArrangement: 0,
    locationInfo,
    rotationConfig: defaultRotationConfig(layout),
    rotationConfigsByLayout: { [layout]: defaultRotationConfig(layout) },
    layoutIdentity: null,
  };
};

const ensureSummerCampShellDefaults = (className: string): void => {
  if (!isSummerCampMode()) {
    return;
  }

  const config = state.classData[className];
  if (!config || classHasAnySavedSeating(config)) {
    return;
  }

  const weekdayLocation = sanitizeLocationInfo(config.weekday?.locationInfo);
  const weekendLocation = sanitizeLocationInfo(config.weekend?.locationInfo);
  config.weekday = makeEmptyModeDataForLayout('camp', weekdayLocation);
  config.weekend = makeEmptyModeDataForLayout('camp', weekendLocation);
};

const syncModeDataSilently = (className: string, sourceMode: TimeMode, targetMode: TimeMode): boolean => {
  const config = state.classData[className];
  if (!config) {
    return false;
  }

  const source = config[sourceMode];
  const target = config[targetMode];
  if (countStudentsInMode(source) === 0 || countStudentsInMode(target) > 0) {
    return false;
  }
  const groupCount = source.layout === 'camp' ? getCampGroupCountFromGroups(source.groups || makeEmptyCampGroups()) : 6;

  config[targetMode] = {
    layout: source.layout,
    groups: (source.layout === 'circular' || source.layout === 'camp') ? deepCopy(source.groups) : null,
    groupOrder: (source.layout === 'circular' || source.layout === 'rows' || source.layout === 'four' || source.layout === 'camp')
      ? [...(source.groupOrder || getDefaultGroupOrder(source.layout, groupCount))]
      : null,
    groupLabels: (source.layout === 'circular' || source.layout === 'rows' || source.layout === 'four' || source.layout === 'camp')
      ? normalizeGroupLabels(source.groupLabels || getDefaultGroupLabels(source.layout, groupCount), groupCount)
      : null,
    rowGroups: source.layout === 'rows' ? deepCopy(source.rowGroups) : null,
    fourGroups: source.layout === 'four' ? deepCopy(source.fourGroups) : null,
    currentArrangement: source.currentArrangement,
    locationInfo: deepCopy(target.locationInfo || makeEmptyLocationInfo()),
    rotationConfig: source.rotationConfig ? { ...source.rotationConfig } : defaultRotationConfig(source.layout),
    rotationConfigsByLayout: {
      ...normalizeRotationConfigsByLayout(source.rotationConfigsByLayout),
      [source.layout]: source.rotationConfig ? { ...source.rotationConfig } : defaultRotationConfig(source.layout),
    },
    layoutIdentity: source.layoutIdentity ? deepCopy(source.layoutIdentity) : null,
  };

  return true;
};

const seedOtherModeForNewClass = (className: string): void => {
  const synced = syncModeDataSilently(className, 'weekday', 'weekend')
    || syncModeDataSilently(className, 'weekend', 'weekday');
  if (synced) {
    persist();
    updateSyncModeButton();
  }
};

const getUpcomingClassDateForClass = (className: string, now = new Date()): string => {
  const config = state.classData[className];
  if (!config) {
    return '';
  }

  const todayKey = toLocalDateKey(now);
  const candidates = [config.weekday, config.weekend]
    .map((mode) => getModeDateKey(mode))
    .filter(Boolean)
    .filter((dateKey) => dateKey >= todayKey)
    .sort();

  return candidates[0] || getModeDateKey(config[state.currentTimeMode]) || getModeDateKey(config.weekday) || getModeDateKey(config.weekend);
};

const addReminderNoteToClass = (className: string, text: string, dueDate: string, source: ReminderNote['source'] = 'manual'): boolean => {
  const normalizedClass = className.trim();
  const normalizedText = text.trim();
  if (!normalizedClass || !normalizedText || !dueDate) {
    return false;
  }

  ensureClassShell(normalizedClass);
  state.classData[normalizedClass].todoNotes.push(createReminderNote(normalizedText, dueDate, source));
  state.classData[normalizedClass].todoNotes = sanitizeReminderNotes(state.classData[normalizedClass].todoNotes);
  persist();
  return true;
};

const updateReminderNoteStatus = (className: string, noteId: string, completed: boolean): void => {
  const note = state.classData[className]?.todoNotes.find((item) => item.id === noteId);
  if (!note) {
    return;
  }

  note.completed = completed;
  note.completedAt = completed ? new Date().toISOString() : null;
  persist();
};

const removeReminderNote = (className: string, noteId: string): void => {
  const config = state.classData[className];
  if (!config) {
    return;
  }

  config.todoNotes = config.todoNotes.filter((note) => note.id !== noteId);
  persist();
};

const buildTodayTodoSummary = (now = new Date()) =>
  buildReminderTodoSummary({
    classData: state.classData,
    currentTimeMode: state.currentTimeMode,
    todayKey: toLocalDateKey(now),
    countStudentsInMode,
    getModeDateKey,
  });

const updateSyncModeButton = (): void => {
  const button = byId<HTMLButtonElement>('syncOtherModeBtn');
  const className = classSelect().value.trim();
  const targetMode: TimeMode = state.currentTimeMode === 'weekday' ? 'weekend' : 'weekday';
  const targetLabel = targetMode === 'weekday' ? '周中' : '周末';

  if (!className || !state.classData[className]) {
    button.textContent = `一键同名单到${targetLabel}`;
    button.disabled = true;
    return;
  }

  const currentMode = state.classData[className][state.currentTimeMode];
  const currentCount = countStudentsInMode(currentMode);

  button.textContent = `一键同名单到${targetLabel}`;
  button.disabled = currentCount === 0;
  button.title = currentCount === 0 ? '当前时段还没有可同步的名单。' : `一键把当前学生名单和座位顺序同步到${targetLabel}。`;
};

const layoutLabel = (layout: LayoutType): string => {
  if (layout === 'rows') return '三横排';
  if (layout === 'four') return '四大组';
  if (layout === 'camp') return '夏令营';
  return '六张圆桌';
};

const availableLayoutOrder = (): LayoutType[] => {
  const requested = appMountOptions.availableLayouts?.filter((layout, index, layouts) =>
    layouts.indexOf(layout) === index,
  );
  if (requested?.length) return requested;
  return isSummerCampMode() ? ['camp'] : ['rows', 'four', 'circular'];
};

const updateLayoutSwitchButton = (): void => {
  const button = byId<HTMLButtonElement>('toggleLayoutBtn');
  const layoutOrder = availableLayoutOrder();
  const nextLayout = layoutOrder[(layoutOrder.indexOf(state.currentLayout) + 1) % layoutOrder.length];
  button.textContent = `切换布局 → ${layoutLabel(nextLayout)}`;
  button.title = layoutOrder.length > 1
    ? `当前为${layoutLabel(state.currentLayout)}，点击直接切换并保存为${layoutLabel(nextLayout)}`
    : `当前为${layoutLabel(state.currentLayout)}`;
  button.disabled = layoutOrder.length <= 1;
};

const modeLabel = (mode: TimeMode): string =>
  isSummerCampMode() ? '今日座位' : (mode === 'weekday' ? '周中' : '周末');

const syncClassPickerValues = (className: string): void => {
  classSelect().value = className;
  floatingClassSelect().value = className;
};

const updateEditorFloatingContext = (): void => {
  const floating = byId<HTMLDivElement>('editorFloatingContext');
  const meta = byId<HTMLSpanElement>('floatingClassMeta');
  const className = activeClassName.trim();

  floating.classList.toggle('hidden', state.currentView !== 'editor');
  if (state.currentView !== 'editor') {
    return;
  }

  syncClassPickerValues(className);
  meta.textContent = className
    ? `${modeLabel(state.currentTimeMode)} · ${layoutLabel(state.currentLayout)}`
    : '未选择班级';
};

const renderReminderSummary = (): void => {
  const board = byId<HTMLDivElement>('todoBoard');
  if (appMountOptions.embedded) {
    board.style.display = 'none';
    return;
  }
  const body = byId<HTMLDivElement>('todoBoardBody');
  const summaryMeta = byId<HTMLSpanElement>('todoSummaryMeta');
  const summaryList = byId<HTMLDivElement>('todoSummaryList');
  const classMeta = byId<HTMLSpanElement>('todoClassMeta');
  const classList = byId<HTMLDivElement>('todoClassList');
  const enabledToggle = byId<HTMLInputElement>('todoEnabledToggle');
  const collapseBtn = byId<HTMLButtonElement>('todoBoardCollapseBtn');
  const weeklyCard = byId<HTMLDivElement>('todoWeeklyCard');
  const addBtn = byId<HTMLButtonElement>('todoAddBtn');
  const dueDateInput = byId<HTMLInputElement>('todoDueDate');
  const todayItems = buildTodayTodoSummary();
  const currentWeek = getWeekNumber();

  enabledToggle.checked = reminderMeta.enabled;
  board.classList.toggle('is-disabled', !reminderMeta.enabled);
  board.classList.toggle('is-collapsed', reminderMeta.panelCollapsed);
  body.hidden = !reminderMeta.enabled || reminderMeta.panelCollapsed;
  collapseBtn.textContent = reminderMeta.panelCollapsed ? '展开' : '收起';

  if (!reminderMeta.enabled) {
    weeklyCard.innerHTML = '<div class="todo-empty">提醒功能已关闭，打开后才会自动生成每日待办。</div>';
    summaryMeta.textContent = '未开启';
    summaryList.innerHTML = '<div class="todo-empty">开启后会按班级日期自动生成今天的提醒。</div>';
    classMeta.textContent = activeClassName ? `${activeClassName} · 功能未开启` : '请选择班级';
    classList.innerHTML = '<div class="todo-empty">开启后可以给当前班级手动加备忘和 DDL。</div>';
    addBtn.disabled = true;
    return;
  }

  addBtn.disabled = !activeClassName;
  dueDateInput.value = getUpcomingClassDateForClass(activeClassName || classSelect().value.trim()) || dueDateInput.value || toLocalDateKey();

  const weeklyDone = reminderMeta.weeklyConfirmedWeek === currentWeek;
  const weeklyDoneLabel = weeklyDone && reminderMeta.weeklyConfirmedAt
    ? `本周已确认，时间：${reminderMeta.weeklyConfirmedAt.slice(5, 16).replace('T', ' ')}`
    : '本周首次登录提醒：学段资料包都查看了吗？';
  const classOptions = Object.keys(state.classData).sort().map((className) =>
    `<option value="${escapeHtml(className)}"${className === activeClassName ? ' selected' : ''}>${escapeHtml(className)}</option>`
  ).join('');
  weeklyCard.innerHTML = `
    <div class="todo-section-title">
      <strong>本周额外提醒</strong>
      <span>${escapeHtml(weeklyDoneLabel)}</span>
    </div>
    <div class="todo-weekly-form">
      <div class="todo-weekly-row">
        <select id="weeklyTodoClassSelect">
          <option value="">选择班级（可不选）</option>
          ${classOptions}
        </select>
        <textarea id="weeklyTodoNote" placeholder="例如：J413 要发书、K218 要发资料要领讲义"></textarea>
      </div>
      <button type="button" id="weeklyTodoConfirmBtn">${weeklyDone ? '更新本周提醒' : '确认已查看并记录'}</button>
    </div>
  `;

  summaryMeta.textContent = todayItems.length > 0 ? `今天共 ${todayItems.length} 条` : '今天暂无提醒';
  summaryList.innerHTML = todayItems.length > 0
    ? todayItems.map((item) => `
      <article class="todo-item${item.alert ? ' is-alert' : ''}">
        <div class="todo-item-head">
          <div class="todo-item-title">${escapeHtml(formatTodoHeadline(item))}</div>
        </div>
        <div class="todo-item-classes">${escapeHtml(item.kind === 'auto' ? `涉及班级：${item.classes.join(' & ')}` : item.classes.join(' & '))}</div>
        ${item.detail ? `<div class="todo-item-date">${escapeHtml(item.detail)}</div>` : ''}
        <div class="todo-item-tag">${item.kind === 'auto' ? '自动提醒' : '手动提醒'}</div>
      </article>
    `).join('')
    : '<div class="todo-empty">今天没有待办，右侧仍可继续手动记备忘。</div>';

  const currentClass = activeClassName || classSelect().value.trim();
  if (!currentClass || !state.classData[currentClass]) {
    classMeta.textContent = '请选择班级';
    classList.innerHTML = '<div class="todo-empty">选中班级后，这里会显示该班的自动提醒和手动便签。</div>';
    return;
  }

  const classConfig = state.classData[currentClass];
  const todayKey = toLocalDateKey();
  const classNotes = sanitizeReminderNotes(classConfig.todoNotes);
  const currentClassToday = buildTodayTodoSummary().filter((item) => item.classes.includes(currentClass));
  classMeta.textContent = `${currentClass} · ${currentClassToday.length} 条今日提醒，${classNotes.filter((note) => !note.completed).length} 条备忘`;
  classList.innerHTML = `
    ${currentClassToday.length > 0 ? currentClassToday.map((item) => `
      <article class="todo-item is-alert">
        <div class="todo-item-title">${escapeHtml(formatTodoHeadline(item))}</div>
        ${item.detail ? `<div class="todo-item-date">${escapeHtml(item.detail)}</div>` : ''}
        <div class="todo-item-tag">今天自动提醒</div>
      </article>
    `).join('') : ''}
    ${classNotes.length > 0 ? classNotes.map((note) => `
      <article class="todo-item${note.completed ? ' is-done' : ''}${!note.completed && note.dueDate <= todayKey ? ' is-alert' : ''}">
        <div class="todo-item-title">${escapeHtml(note.text)}</div>
        <div class="todo-item-date">DDL：${escapeHtml(formatDateLabel(note.dueDate))}</div>
        <div class="todo-item-actions">
          <span class="todo-item-tag">${note.source === 'weekly' ? '资料包提醒' : '手动备忘'}</span>
          <button type="button" data-note-toggle="${escapeHtml(note.id)}">${note.completed ? '恢复' : '完成'}</button>
          <button type="button" data-note-delete="${escapeHtml(note.id)}">删除</button>
        </div>
      </article>
    `).join('') : '<div class="todo-empty">这个班还没有手动提醒，可以直接在上面录入。</div>'}
  `;
};

const maybeShowTodayReminderAlert = (): void => {
  if (appMountOptions.embedded) {
    return;
  }

  if (!reminderMeta.enabled) {
    return;
  }

  const todayKey = toLocalDateKey();
  if (reminderMeta.lastAlertDate === todayKey) {
    return;
  }

  const items = buildTodayTodoSummary();
  if (items.length === 0) {
    return;
  }

  const preview = items.slice(0, 4).map((item) => formatTodoHeadline(item)).join('\n');
  reminderMeta.lastAlertDate = todayKey;
  saveReminderState();
  window.alert(`今天有 ${items.length} 条提醒：\n${preview}${items.length > 4 ? '\n…' : ''}`);
};


const formatModeMeta = (mode: ClassConfig[TimeMode]): string => {
  const info = sanitizeLocationInfo(mode.locationInfo);
  if (isSummerCampMode() && info.arrivalMessage) {
    return info.arrivalMessage;
  }
  const parts = [info.weekday, info.time, info.campus, info.room].filter(Boolean);
  return parts.join(' · ') || '未设置';
};

const renderClassOverview = (): void => {
  const container = byId<HTMLDivElement>('homeClassList');
  const classNames = Object.keys(state.classData).sort();

  if (classNames.length === 0) {
    container.innerHTML = '<div class="class-card empty">暂无班级，请点击“新建班级座位表”</div>';
    updateBatchUndoButton();
    updateSyncModeButton();
    return;
  }

  const cards = classNames
    .map((className) => {
      const config = state.classData[className];
      const weekdayCount = countStudentsInMode(config.weekday);
      const weekendCount = countStudentsInMode(config.weekend);
      const isCampOverview = isSummerCampMode() && config.weekday.layout === 'camp';

      // Compare seating students against core roster
      const rosterNames = rosterNamesForClass(className);
      let rosterDiffHtml = '';
      if (rosterNames.length > 0) {
        const allSeatingStudents = mergeStudentListsByMaxCount(
          collectStudentsFromModeData(config.weekday),
          collectStudentsFromModeData(config.weekend),
        );
        const { extra, missing } = computeRosterDiff(rosterNames, allSeatingStudents);
        if (extra.length > 0 || missing.length > 0) {
          const parts: string[] = [];
          if (missing.length > 0) parts.push(`<span style="color:#c45">缺 ${missing.length} 人</span>`);
          if (extra.length > 0) parts.push(`<span style="color:#e89020">多 ${extra.length} 人</span>`);
          rosterDiffHtml = `<div class="class-card-meta" style="font-size:11px;margin-top:2px">${rosterSourceLabel()}对比：${parts.join('，')}</div>`;
        } else {
          rosterDiffHtml = `<div class="class-card-meta" style="font-size:11px;margin-top:2px;color:#7ba862">✓ 与${rosterSourceLabel()}一致</div>`;
        }
      }

      return `
        <article class="class-card" data-open-class="${escapeHtml(className)}">
          <div class="class-card-header">
            <strong>${escapeHtml(className)}</strong>
            <span>${isCampOverview ? `${weekdayCount} 人` : `${weekdayCount + weekendCount} 人次`}</span>
          </div>
          ${isCampOverview ? `
            <div class="class-card-meta">
              <span class="mode-chip">今日座位</span>
              <span>${escapeHtml(layoutLabel(config.weekday.layout))}</span>
              <span>${weekdayCount} 人</span>
            </div>
            <div class="class-card-detail">${escapeHtml(`${summerCampDateLabel(getSummerCampDateKeyFromInfo(config.weekday.locationInfo))} · ${formatModeMeta(config.weekday)}`)}</div>
          ` : `
            <div class="class-card-meta">
              <span class="mode-chip">周中</span>
              <span>${escapeHtml(layoutLabel(config.weekday.layout))}</span>
              <span>${weekdayCount} 人</span>
            </div>
            <div class="class-card-detail">${escapeHtml(formatModeMeta(config.weekday))}</div>
            <div class="class-card-meta">
              <span class="mode-chip weekend">周末</span>
              <span>${escapeHtml(layoutLabel(config.weekend.layout))}</span>
              <span>${weekendCount} 人</span>
            </div>
            <div class="class-card-detail">${escapeHtml(formatModeMeta(config.weekend))}</div>
          `}
          ${rosterDiffHtml}
          <button>进入编辑</button>
        </article>
      `;
    })
    .join('');

  container.innerHTML = cards;
  updateBatchUndoButton();
  updateSyncModeButton();
};

const applyLaunchClass = (): void => {
  const launchClass = getLaunchClassName();
  if (!launchClass) {
    return;
  }

  if (isSummerCampMode()) {
    const forcedRestore = getForcedSummerCampBackupRestore();
    const launchCampNo = campNumberFromText(launchClass);
    const directLaunchClass = state.classData[launchClass]
      ? launchClass
      : launchCampNo
        ? `L2第一期-营${launchCampNo}`
        : '';
    const launchTarget = forcedRestore?.className || directLaunchClass;
    const launchCamp = forcedRestore?.campNo || launchCampNo;
    if (launchTarget && launchCamp && state.classData[launchTarget]) {
      const config = state.classData[launchTarget];
      const restoredDate = getModeDateKey(config.weekday)
        || getModeDateKey(config.weekend)
        || getCurrentCampReportDate(new Date());
      saveSummerCampLaunchPreference({
        majorCamp: 'L2',
        minorCamp: `Camp ${launchCamp}`,
        reportDate: restoredDate,
        lastTool: 'seating',
      });
      populateSummerCampPicker();
      const majorSelect = summerCampMajorSelect();
      const dateSelect = summerCampDateSelect();
      if (majorSelect) {
        majorSelect.value = 'L2';
      }
      if (dateSelect && summerCampDateOptions().some((item) => item.date === restoredDate)) {
        dateSelect.value = restoredDate;
      }
      updateSummerCampMinorOptions(`Camp ${launchCamp}`, restoredDate);
      openClassInEditor(launchTarget);
      syncSummerCampPickerFromActiveClass();
      return;
    }
    ensurePreferredSummerCampSeating();
    return;
  }

  if (state.classData[launchClass]) {
    ensureSummerCampShellDefaults(launchClass);
    openClassInEditor(launchClass);
    return;
  }

  // Class has no seating data — create shell, populate dropdown, open editor
  ensureClassShell(launchClass);
  updateClassSelect();
  syncClassPickerValues(launchClass);
  activeClassName = launchClass;
  headerClassName().value = launchClass;
  state.currentTimeMode = 'weekday';
  setCurrentView('editor');
  loadClass();

  // Show tools by default for new classes so user can import
  const editorView = queryOne<HTMLDivElement>('.editor-view');
  const toggle = queryOne<HTMLButtonElement>('#editorToolsToggle');
  if (editorView && toggle) {
    editorView.classList.remove('editor-tools-collapsed');
    toggle.textContent = '隐藏工具';
  }
};

const updateBatchUndoButton = (): void => {
  const button = byId<HTMLButtonElement>('undoWeekBtn');
  button.disabled = !loadBatchUndoData();
};

const setCurrentView = (view: 'home' | 'editor'): void => {
  state.currentView = view;
  const home = byId<HTMLDivElement>('homeView');
  const editor = byId<HTMLDivElement>('editorView');

  if (view === 'home') {
    home.classList.remove('hidden');
    editor.classList.add('hidden');
    updateWelcome();
    renderClassOverview();
    updateEditorFloatingContext();
    updateCampPresetSwitchUi();
    syncSummerCampPickerFromActiveClass();
    return;
  }

  home.classList.add('hidden');
  editor.classList.remove('hidden');
  updateEditorFloatingContext();
  updateCampPresetSwitchUi();
  syncSummerCampPickerFromActiveClass();
  renderReminderSummary();
};

const updateClassSelect = (): void => {
  const classNames = Object.keys(state.classData).sort();
  const populate = (select: HTMLSelectElement): void => {
    select.innerHTML = '<option value="">选择班级...</option>';
    classNames.forEach((className) => {
      const option = document.createElement('option');
      option.value = className;
      option.textContent = className;
      select.appendChild(option);
    });
  };

  populate(classSelect());
  populate(floatingClassSelect());
  updateEditorFloatingContext();
  syncSummerCampPickerFromActiveClass();
  if (queryOne('#todoBoard')) {
    renderReminderSummary();
  }
};

const sanitizeLocationInfo = (location: Partial<LocationInfo> | undefined): LocationInfo => {
  const merged: LocationInfo = {
    ...makeEmptyLocationInfo(),
    ...location
  };
  const normalizedDate = normalizeLocationDate(merged);
  merged.fullDate = normalizedDate.fullDate;
  merged.date = normalizedDate.date;
  merged.day = normalizedDate.day;
  merged.weekday = normalizedDate.weekday;

  merged.arrivalMessage = String(merged.arrivalMessage || '').trim();
  merged.seatTitle = String(merged.seatTitle || '').trim();
  merged.campus = normalizeMetaCampus(merged.campus || '');
  merged.room = normalizeMetaRoom(merged.room || '', merged.campus || '');
  if (!merged.floor) {
    merged.floor = normalizeMetaFloor(merged.room || '');
  } else {
    merged.floor = normalizeMetaFloor(merged.floor);
  }

  return merged;
};

const makeSummerCampLocationInfo = (
  dateKey: string,
  campNo: string,
  existing?: Partial<LocationInfo>,
): LocationInfo => {
  const base = sanitizeLocationInfo(existing);
  const resolvedDateKey = dateKeyToMonthDay(dateKey) ? dateKey : defaultSummerCampDateKey();
  const converted = dateKeyToMonthDay(resolvedDateKey);
  const time = base.time || '8:00';
  const resolvedCampNo = campNo || campNumberFromText(base.room || base.arrivalMessage || '') || '1';
  const baseCampNo = campNumberFromText(base.room || base.arrivalMessage || '');
  const shouldRefreshCampPlace = !baseCampNo || baseCampNo !== resolvedCampNo;
  return sanitizeLocationInfo({
    ...base,
    date: converted?.month || base.date,
    day: converted?.day || base.day,
    weekday: converted?.weekday || base.weekday,
    time,
    room: shouldRefreshCampPlace ? `营${resolvedCampNo}教室` : base.room,
    arrivalMessage: shouldRefreshCampPlace ? `${time}准时抵达营${resolvedCampNo}教室哦~` : base.arrivalMessage,
    fullDate: resolvedDateKey,
  });
};

const rotateSummerCampLocationInfoByDay = (location: Partial<LocationInfo> | undefined): LocationInfo => {
  const base = sanitizeLocationInfo(location);
  const campNo = campNumberFromText(base.room || base.arrivalMessage || activeClassName || '') || currentCampNumber();
  return makeSummerCampLocationInfo(nextSummerCampClassDate(getSummerCampDateKeyFromInfo(base)), campNo, base);
};

const shouldResetSummerCampSeatTitleForDateChange = (
  seatTitle: string,
  previousInfo: LocationInfo,
  className: string,
): boolean => {
  const cleanTitle = normalizeSummerCampSeatTitle(seatTitle);
  if (!cleanTitle) {
    return true;
  }

  const previousDefaultTitle = buildSummerCampSeatTitle(
    sanitizeLocationInfo({ ...previousInfo, seatTitle: '' }),
    className,
  );
  return cleanTitle === previousDefaultTitle
    || (cleanTitle.includes('座位表') && /\d{1,2}月\d{1,2}日/.test(cleanTitle) && /Day\s*\d+/.test(cleanTitle));
};

const applySummerCampDateToClass = (className: string, dateKey: string, campNo?: string): void => {
  const config = state.classData[className];
  if (!config) {
    return;
  }

  const resolvedCampNo = campNo || campNumberFromText(className) || currentCampNumber();
  (['weekday', 'weekend'] as const).forEach((mode) => {
    const previousInfo = sanitizeLocationInfo(config[mode].locationInfo);
    const nextInfo = makeSummerCampLocationInfo(dateKey, resolvedCampNo, previousInfo);
    config[mode].locationInfo = shouldResetSummerCampSeatTitleForDateChange(previousInfo.seatTitle || '', previousInfo, className)
      ? { ...nextInfo, seatTitle: '' }
      : nextInfo;
  });
  persist();

  if (classSelect().value === className || activeClassName === className) {
    setLocationInfo(config[state.currentTimeMode].locationInfo);
  }
};

const hydrateClassScheduleFromMeta = (className: string, options?: { force?: boolean }): void => {
  const config = state.classData[className];
  const meta = getClassScheduleMeta(className);
  if (!config || !meta) {
    return;
  }

  let changed = false;
  ([
    ['weekday', meta.weekday],
    ['weekend', meta.weekend]
  ] as const).forEach(([mode, slot]) => {
    const current = sanitizeLocationInfo(config[mode].locationInfo);
    if (!slot) {
      if (options?.force && (current.date || current.day || current.weekday || current.time || current.campus || current.room || current.fullDate)) {
        config[mode].locationInfo = makeEmptyLocationInfo();
        changed = true;
      }
      return;
    }
    const inferredDate = inferThisWeekDate(slot.day);
    const next = {
      ...current,
      date: options?.force ? (inferredDate?.month || current.date) : (current.date || inferredDate?.month || ''),
      day: options?.force ? (inferredDate?.day || current.day) : (current.day || inferredDate?.day || ''),
      weekday: options?.force ? (normalizeMetaWeekday(slot.day) || current.weekday) : (current.weekday || normalizeMetaWeekday(slot.day)),
      time: options?.force ? (slot.time || current.time) : (current.time || slot.time),
      campus: options?.force ? (normalizeMetaCampus(slot.campus) || current.campus) : (current.campus || normalizeMetaCampus(slot.campus)),
      floor: options?.force ? (normalizeMetaFloor(slot.floor || slot.room || '') || current.floor) : (current.floor || normalizeMetaFloor(slot.floor || slot.room || '')),
      room: options?.force ? (normalizeMetaRoom(slot.room || '', slot.campus || '') || current.room) : (current.room || normalizeMetaRoom(slot.room || '', slot.campus || '')),
      fullDate: options?.force ? (inferredDate?.fullDate || current.fullDate) : (current.fullDate || inferredDate?.fullDate || ''),
    };
    if (
      next.date !== current.date
      || next.day !== current.day
      || next.weekday !== current.weekday
      || next.time !== current.time
      || next.campus !== current.campus
      || next.floor !== current.floor
      || next.room !== current.room
      || next.fullDate !== current.fullDate
    ) {
      config[mode].locationInfo = sanitizeLocationInfo(next);
      changed = true;
    }
  });

  if (changed) {
    persist();
  }
};

export const sanitizeModeData = (mode: ClassConfig[TimeMode]): ClassConfig[TimeMode] => {
  const locationInfo = sanitizeLocationInfo(mode.locationInfo || {});
  const layoutIdentity = sanitizeSeatingLayoutIdentity(mode.layoutIdentity);
  const rotationConfigsByLayout = normalizeRotationConfigsByLayout(mode.rotationConfigsByLayout);
  rotationConfigsByLayout[mode.layout] = mode.rotationConfig
    ? { ...defaultRotationConfig(mode.layout), ...mode.rotationConfig }
    : rotationConfigsByLayout[mode.layout] || defaultRotationConfig(mode.layout);

  if (mode.layout === 'circular') {
    const rawGroups = (mode.groups || []).slice(0, 6);
    const studentCount = Math.min(MAX_STUDENT_LIMIT, normalizeStudentList(rawGroups.flat()).length);
    const seatCapacity = getLayoutGroupSeatCapacity('circular', studentCount, 6);
    const base = makeEmptyCircularGroups(seatCapacity);
    rawGroups.forEach((group, idx) => {
      base[idx] = normalizeStudentList(group)
        .slice(0, seatCapacity)
        .concat(Array(seatCapacity).fill(''))
        .slice(0, seatCapacity);
    });
    const groupOrder = (mode.groupOrder || DEFAULT_GROUP_ORDER).slice(0, 6).concat(DEFAULT_GROUP_ORDER).slice(0, 6);
    const groupLabels = normalizeGroupLabels(mode.groupLabels || getDefaultGroupLabels());

    return {
      layout: 'circular',
      groups: base,
      groupOrder,
      groupLabels,
      rowGroups: null,
      fourGroups: null,
      currentArrangement: mode.currentArrangement || 0,
      locationInfo,
      rotationConfig: mode.rotationConfig ? { ...defaultRotationConfig('circular'), ...mode.rotationConfig } : defaultRotationConfig('circular'),
      rotationConfigsByLayout,
      layoutIdentity,
    };
  }

  if (mode.layout === 'rows') {
    const rows = mode.rowGroups?.rows || [];
    const studentCount = Math.min(MAX_STUDENT_LIMIT, normalizeStudentList(rows.flatMap((row) => [
      ...(row?.left || []),
      ...(row?.right || []),
    ])).length);
    const seatCapacity = getLayoutGroupSeatCapacity('rows', studentCount, 6);
    const base = makeEmptyRowGroups(seatCapacity);
    for (let index = 0; index < 3; index += 1) {
      base.rows[index].left = normalizeStudentList(rows[index]?.left || []).slice(0, seatCapacity).concat(Array(seatCapacity).fill('')).slice(0, seatCapacity);
      base.rows[index].right = normalizeStudentList(rows[index]?.right || []).slice(0, seatCapacity).concat(Array(seatCapacity).fill('')).slice(0, seatCapacity);
    }

    const groupOrder = (mode.groupOrder || DEFAULT_GROUP_ORDER).slice(0, 6).concat(DEFAULT_GROUP_ORDER).slice(0, 6);
    const groupLabels = normalizeGroupLabels(mode.groupLabels || getDefaultGroupLabels());

    return {
      layout: 'rows',
      groups: null,
      groupOrder,
      groupLabels,
      rowGroups: base,
      fourGroups: null,
      currentArrangement: mode.currentArrangement || 0,
      locationInfo,
      rotationConfig: mode.rotationConfig ? { ...defaultRotationConfig('rows'), ...mode.rotationConfig } : defaultRotationConfig('rows'),
      rotationConfigsByLayout,
      layoutIdentity,
    };
  }

  if (mode.layout === 'camp') {
    const rawGroups = (mode.groups || []).slice(0, 8);
    const groupCount = resolveSavedSummerCampGroupCount(rawGroups);
    const base = sanitizeSummerCampSeatGroups(rawGroups, groupCount);
    const groupOrder = (mode.groupOrder || getDefaultGroupOrder('camp', groupCount)).slice(0, groupCount).concat(getDefaultGroupOrder('camp', groupCount)).slice(0, groupCount);
    const groupLabels = normalizeGroupLabels(mode.groupLabels || getDefaultGroupLabels('camp', groupCount), groupCount);

    return {
      layout: 'camp',
      groups: base,
      groupOrder,
      groupLabels,
      rowGroups: null,
      fourGroups: null,
      currentArrangement: mode.currentArrangement || 0,
      locationInfo,
      rotationConfig: mode.rotationConfig ? { ...defaultRotationConfig('camp'), ...mode.rotationConfig } : defaultRotationConfig('camp'),
      rotationConfigsByLayout,
      layoutIdentity,
    };
  }

  if (mode.layout === 'four') {
    const legacyArcRows = (
      mode as ClassConfig[TimeMode] & { arcGroups?: { rows?: string[][] } | null }
    ).arcGroups?.rows;
    const rawFourGroups = (mode.fourGroups?.groups || []).slice(0, 4);
    const hasExplicitFourGroups = rawFourGroups.some((group) => normalizeStudentList(group).length > 0);
    const legacyStudents = hasExplicitFourGroups
      ? []
      : normalizeStudentList([
        ...(Array.isArray(mode.groups) ? mode.groups.flat() : []),
        ...(Array.isArray(legacyArcRows) ? legacyArcRows.flat() : []),
      ]);

    const sourceStudents = hasExplicitFourGroups
      ? normalizeStudentList(rawFourGroups.flat())
      : legacyStudents;
    const limitedStudents = sourceStudents.slice(0, MAX_STUDENT_LIMIT);
    const base = convertStudentsToFour(limitedStudents, Math.max(3, Math.min(4, Number(mode.fourGroups?.groupCount) || 4)));

    base.groupCount = Math.max(3, Math.min(4, Number(mode.fourGroups?.groupCount) || 4));
    if (hasExplicitFourGroups) {
      const seatCapacity = getLayoutGroupSeatCapacity('four', limitedStudents.length, base.groupCount);
      rawFourGroups.forEach((group, idx) => {
        base.groups[idx] = normalizeStudentList(group).slice(0, seatCapacity).concat(Array(seatCapacity).fill('')).slice(0, seatCapacity);
      });
    }
    const groupOrder = (mode.groupOrder || DEFAULT_GROUP_ORDER).slice(0, 6).concat(DEFAULT_GROUP_ORDER).slice(0, 6);
    const groupLabels = normalizeGroupLabels(mode.groupLabels || getDefaultGroupLabels());

    return {
      layout: 'four',
      groups: null,
      groupOrder,
      groupLabels,
      rowGroups: null,
      fourGroups: base,
      currentArrangement: mode.currentArrangement || 0,
      locationInfo,
      rotationConfig: mode.rotationConfig ? { ...defaultRotationConfig('four'), ...mode.rotationConfig } : defaultRotationConfig('four'),
      rotationConfigsByLayout,
      layoutIdentity,
    };
  }
  const legacyArcRows = (
    mode as ClassConfig[TimeMode] & { arcGroups?: { rows?: string[][] } | null }
  ).arcGroups?.rows;
  const legacyGroups = Array.isArray(mode.groups) && mode.groups.length > 0
    ? mode.groups
    : Array.isArray(legacyArcRows)
      ? legacyArcRows
      : [];
  const legacyStudents = normalizeStudentList(legacyGroups.flat());
  const base = convertStudentsToFour(legacyStudents.slice(0, MAX_STUDENT_LIMIT), 4);

  return {
    layout: 'four',
    groups: null,
    groupOrder: [...DEFAULT_GROUP_ORDER],
    groupLabels: getDefaultGroupLabels(),
    rowGroups: null,
    fourGroups: base,
    currentArrangement: mode.currentArrangement || 0,
    locationInfo,
    rotationConfig: defaultRotationConfig('four'),
    rotationConfigsByLayout,
    layoutIdentity,
  };
};

const normalizeSummerCampRotationDefaults = (config: ClassConfig): ClassConfig => {
  if (!isSummerCampMode()) {
    return config;
  }
  const campCoreRotations = new Set(['front-back-swap', 'row-left', 'clockwise', 'counterclockwise']);
  (['weekday', 'weekend'] as const).forEach((mode) => {
    const modeData = config[mode];
    const rc = modeData.rotationConfig;
    if (modeData.layout === 'camp' && rc && !campCoreRotations.has(rc.groupRotation)) {
      modeData.rotationConfig = { ...defaultRotationConfig('camp'), ...rc, groupRotation: 'front-back-swap' };
    }
  });
  return config;
};

const sanitizeClassSnapshot = (snapshot: Partial<ClassSnapshot> | undefined): ClassSnapshot =>
  sanitizePersistedClassSnapshot(snapshot, {
    defaultTheme: state.userProfile.theme,
    makeClassShell: () => makeClassShell(getDefaultLaunchLayout(), state.userProfile.theme),
    sanitizeModeData,
  });

const snapshotFromConfig = (config: ClassConfig): ClassSnapshot =>
  createSnapshotFromConfig(config, deepCopy);

const sanitizeClassDataMap = (loaded: ClassData): ClassData => {
  const sanitized = sanitizePersistedClassDataMap(loaded, {
    defaultTheme: state.userProfile.theme,
    makeClassShell: () => makeClassShell(getDefaultLaunchLayout(), state.userProfile.theme),
    sanitizeModeData,
    sanitizeReminderNotes,
  });

  // Reading saved seats must not infer and replay a rotation from their
  // similarity to last week. A teacher may deliberately keep that arrangement.
  return Object.fromEntries(
    Object.entries(sanitized).map(([className, config]) => [className, normalizeSummerCampRotationDefaults(config)])
  ) as ClassData;
};

const buildBackupPayload = (classData: ClassData = state.classData): BackupPayload =>
  createBackupPayload({
    appName: APP_NAME,
    appSlug: APP_SLUG,
    sourceOrigin: window.location.origin,
    classData,
    userProfile: state.userProfile,
    reminderMeta,
    batchUndo: loadBatchUndoData(),
    academicTermLaunch: loadAcademicTermLaunchInfo(),
    deepCopy,
  });

const exportDataBackup = (): void => {
  const payload = buildBackupPayload();
  downloadBackupPayload(payload, BACKUP_FILE_PREFIX, JSON.stringify(payload, null, 2));
};

const showExportDialog = (statusText: string): void => {
  byId<HTMLParagraphElement>('exportStatus').textContent = statusText;
  showDialog('exportDialog');
};

const hideExportDialog = (): void => {
  hideDialog('exportDialog');
};

const startExportDialog = (): void => {
  byId<HTMLParagraphElement>('exportStatus').textContent = '正在生成图片，请稍候…';
  showDialog('exportDialog');
};

let seatingExportBusy = false;
const exportSeatingImage = async (): Promise<void> => {
  if (seatingExportBusy) return;
  seatingExportBusy = true;
  const button = byId<HTMLButtonElement>('exportSeatingBtn');
  button.disabled = true;
  button.textContent = '正在生成图片…';
  button.setAttribute('aria-busy', 'true');
  startExportDialog();
  const status = byId<HTMLParagraphElement>('exportStatus');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.classList.add('is-exporting');
  let exportTarget: HTMLElement | null = null;
  try {
    // Paint feedback before the synchronous DOM snapshot work begins.
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    let className = activeClassName.trim() || headerClassName().value.trim() || '座位表';
    if (isSummerCampMode()) className = `${className}_${getSummerCampDateKeyFromInfo(getLocationInfo())}`;
    exportTarget = createExportSnapshot({ editorView: byId<HTMLDivElement>('editorView'), notesRoot: notes() });
    if (!exportTarget) throw new Error('未找到可导出的座位表区域。');
    const blob = await requestExportImageBlob(exportTarget);
    status.textContent = '图片已生成，正在准备保存…';
    const statusText = await deliverExportImageBlob(blob, className);
    showExportDialog(statusText);
  } catch (error) {
    showExportDialog(`导出失败：${error instanceof Error ? error.message : '请稍后重试'}`);
  } finally {
    exportTarget?.remove();
    seatingExportBusy = false;
    button.disabled = false;
    button.textContent = '导出座位表';
    button.removeAttribute('aria-busy');
    status.classList.remove('is-exporting');
  }
};

const applyImportedBackup = (payload: Partial<BackupPayload>): void => {
  state.userProfile = {
    username: typeof payload.userProfile?.username === 'string' ? payload.userProfile.username.trim() : '',
    theme: sanitizeImportedTheme(payload.userProfile?.theme)
  };
  saveProfile();
  applyTheme(state.userProfile.theme);
  updateWelcome();

  state.classData = sanitizeClassDataMap(
    payload.classData && typeof payload.classData === 'object'
      ? payload.classData as ClassData
      : {}
  );
  if (!persist()) {
    notifyLocalSaveFailure();
  }

  reminderMeta = payload.reminderMeta ? {
    ...makeDefaultReminderMeta(),
    ...payload.reminderMeta
  } : makeDefaultReminderMeta();
  saveReminderState();

  if (payload.batchUndo && typeof payload.batchUndo === 'object') {
    saveBatchUndoData(sanitizeClassDataMap(payload.batchUndo as ClassData));
  } else {
    clearBatchUndoData();
  }
  if (payload.academicTermLaunch) {
    saveAcademicTermLaunchInfo(payload.academicTermLaunch);
  }

  activeClassName = '';
  syncClassPickerValues('');
  updateClassSelect();
  renderClassOverview();
  setCurrentView('home');
};

const importBackupFile = async (event: Event): Promise<void> => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) {
    return;
  }

  try {
    const payload = JSON.parse(await file.text()) as Partial<BackupPayload>;
    applyImportedBackup(payload);
    window.alert('备份导入成功，当前页面已切回主页。');
  } catch {
    window.alert('备份文件读取失败，请确认选择的是导出的 JSON 备份。');
  } finally {
    input.value = '';
  }
};

const triggerImportBackup = (): void => {
  byId<HTMLInputElement>('backupImportInput').click();
};

const loadSavedData = (): void => {
  const loaded = loadClassData();

  state.classData = sanitizeClassDataMap(loaded);
  if (!saveClassData(state.classData)) {
    notifyLocalSaveFailure();
  }
  reminderMeta = loadReminderMeta();
  activeClassName = '';
  updateClassSelect();
};

const mergeSeatingBackupFromServer = async (): Promise<void> => {
  if (appMountOptions.disableRemoteBackup) {
    return;
  }
  try {
    const payload = await fetchSeatingBackup();
    if (!payload || !classDataHasEntries(payload.classData)) {
      return;
    }
    const localHadEntries = classDataHasEntries(state.classData);
    const restoreScope = appMountOptions.embedded && !isSummerCampMode()
      ? [...(appMountOptions.availableClassNames || []), appMountOptions.launchClassName || ''].filter(Boolean)
      : undefined;
    const backupClassData = sanitizeClassDataMap(selectBackupClasses(payload.classData, restoreScope));

    const { classData, changed } = mergeMissingBackupClassData(
      state.classData,
      backupClassData,
      classHasAnySavedSeating,
    );
    if (!changed) {
      return;
    }

    if (!localHadEntries) {
      state.userProfile = {
        username: typeof payload.userProfile?.username === 'string' ? payload.userProfile.username.trim() : '',
        theme: sanitizeImportedTheme(payload.userProfile?.theme),
      };
      saveProfile();
      applyTheme(state.userProfile.theme);
      updateWelcome();

      reminderMeta = payload.reminderMeta ? {
        ...makeDefaultReminderMeta(),
        ...payload.reminderMeta,
      } : makeDefaultReminderMeta();
      saveReminderState();

      if (payload.batchUndo && typeof payload.batchUndo === 'object') {
        saveBatchUndoData(sanitizeClassDataMap(selectBackupClasses(payload.batchUndo as ClassData, restoreScope)));
      }
    }

    state.classData = classData;
    if (!saveClassData(state.classData)) {
      notifyLocalSaveFailure();
    }

    activeClassName = '';
    syncClassPickerValues('');
    updateClassSelect();
    renderClassOverview();
  } catch (error) {
    console.warn('座位表后台备份合并失败:', error);
  }
};

const getLocationInfo = (): LocationInfo => {
  const date = byId<HTMLInputElement>('date').value.trim();
  const day = byId<HTMLInputElement>('day').value.trim();
  const cachedFullDate = byId<HTMLInputElement>('date').dataset.fullDate || '';
  const fullDate = monthDayToDateKey(date, day) || cachedFullDate;

  return {
    date,
    day,
    weekday: byId<HTMLSelectElement>('weekday').value,
    time: byId<HTMLInputElement>('time').value,
    campus: byId<HTMLSelectElement>('campus').value,
    floor: byId<HTMLInputElement>('floor').value,
    room: byId<HTMLInputElement>('room').value,
    arrivalMessage: byId<HTMLInputElement>('campArrivalMessage').value,
    notes: notes().innerHTML,
    notesHidden: byId<HTMLDivElement>('editorView').classList.contains('seating-notes-hidden'),
    seatTitle: activeClassName ? state.classData[activeClassName]?.[state.currentTimeMode]?.locationInfo.seatTitle || '' : '',
    fullDate
  };
};

const setNotesVisibility = (hidden: boolean): void => {
  byId<HTMLDivElement>('editorView').classList.toggle('seating-notes-hidden', hidden);
  const button = byId<HTMLButtonElement>('notesVisibilityToggle');
  button.textContent = hidden ? '显示备注' : '隐藏备注';
  button.setAttribute('aria-pressed', String(!hidden));
};

const hasNotesContent = (): boolean => {
  const root = notes();
  return (root.textContent || '').trim().length > 0 || root.querySelector('img') !== null;
};

const syncSummerCampToolsToggleLabel = (): void => {
  if (!isSummerCampMode()) {
    return;
  }

  const editorView = queryOne<HTMLDivElement>('#editorView');
  const toggle = queryOne<HTMLButtonElement>('#summerCampToolsToggleBtn');
  if (!editorView || !toggle) {
    return;
  }

  const collapsed = editorView.classList.contains('editor-tools-collapsed');
  const notesHasContent = hasNotesContent();
  toggle.textContent = notesHasContent
    ? collapsed ? '显示设置' : '隐藏设置'
    : collapsed ? '显示提示' : '隐藏提示';
};

const syncSummerCampNotesState = (): void => {
  if (!isSummerCampMode()) {
    return;
  }
  byId<HTMLDivElement>('editorView').classList.toggle('summer-camp-notes-has-content', hasNotesContent());
  syncSummerCampToolsToggleLabel();
};

type SummerCampSaveStatus = 'saved' | 'saving' | 'dirty';

let summerCampSaveStatusTimer = 0;
let summerCampNotesSaveTimer = 0;

const setSummerCampSaveStatus = (
  message = '已自动保存',
  status: SummerCampSaveStatus = 'saved',
): void => {
  if (!isSummerCampMode()) {
    return;
  }

  const root = queryOne<HTMLElement>('#summerCampSaveStatus');
  const text = queryOne<HTMLElement>('#summerCampSaveStatusText');
  if (!root || !text) {
    return;
  }

  root.dataset.status = status;
  text.textContent = message;

  if (summerCampSaveStatusTimer) {
    window.clearTimeout(summerCampSaveStatusTimer);
    summerCampSaveStatusTimer = 0;
  }

  if (status === 'saved' && message !== '已自动保存') {
    summerCampSaveStatusTimer = window.setTimeout(() => {
      root.dataset.status = 'saved';
      text.textContent = '已自动保存';
      summerCampSaveStatusTimer = 0;
    }, 2400);
  }
};

const scheduleSummerCampNotesAutosave = (): void => {
  if (!isSummerCampMode()) {
    return;
  }

  if (summerCampNotesSaveTimer) {
    window.clearTimeout(summerCampNotesSaveTimer);
  }

  setSummerCampSaveStatus('正在保存备注...', 'saving');
  summerCampNotesSaveTimer = window.setTimeout(() => {
    summerCampNotesSaveTimer = 0;
    saveCurrentClassMode('备注已自动保存');
  }, 520);
};

const updateSummerCampSeatTitle = (): void => {
  const title = byId<HTMLSpanElement>('summerCampSeatTitle');
  if (!isSummerCampMode()) {
    title.textContent = '';
    return;
  }

  const info = getLocationInfo();
  const className = activeClassName || classSelect().value || '';
  title.textContent = info.seatTitle || buildSummerCampSeatTitle(info, className);
  queueSummerCampSeatTitleFit();
};

const buildSummerCampSeatTitle = (info: LocationInfo, className: string): string => {
  const roster = findCampPresetRosterByClassName(className);
  const majorLevel = roster?.majorCamp
    || CAMP_MAJOR_OPTIONS.find((item) => className.startsWith(item.level))?.level
    || summerCampMajorSelect()?.value
    || SUMMER_CAMP_DEFAULT_MAJOR;
  const majorName = CAMP_MAJOR_OPTIONS.find((item) => item.level === majorLevel)?.campName || majorLevel;
  const majorLabel = majorLevel === 'L2' && majorName === 'Sparkchat' ? `🎙${majorName}` : majorName;
  const campNo = campNumberFromText(roster?.camp || className || summerCampMinorSelect()?.value || '') || currentCampNumber();
  const campLabel = `Camp ${campNo}`;
  const dateKey = info.fullDate || summerCampDateSelect()?.value || defaultSummerCampDateKey();
  const dateText = summerCampCompactDateLabel(dateKey);
  const dayText = summerCampDayLabel(dateKey);
  return `${majorLabel}✨${campLabel}🗓${dateText}${dayText ? `💺${dayText}` : ''}座位表`;
};

const normalizeSummerCampSeatTitle = (value: string): string => value.replace(/\s+/g, ' ').trim();

const saveSummerCampSeatTitle = (value: string): void => {
  if (!isSummerCampMode()) {
    return;
  }

  const className = activeClassName.trim();
  const config = className ? state.classData[className] : null;
  if (!className || !config) {
    updateSummerCampSeatTitle();
    return;
  }

  if (!saveCurrentClassMode()) {
    return;
  }
  const modeData = state.classData[className][state.currentTimeMode];
  const cleanTitle = normalizeSummerCampSeatTitle(value);
  const defaultTitle = buildSummerCampSeatTitle(
    sanitizeLocationInfo({ ...modeData.locationInfo, seatTitle: '' }),
    className,
  );
  modeData.locationInfo = sanitizeLocationInfo({
    ...modeData.locationInfo,
    seatTitle: cleanTitle && cleanTitle !== defaultTitle ? cleanTitle : '',
  });
  if (!persist()) {
    notifyLocalSaveFailure();
    return;
  }
  setLocationInfo(modeData.locationInfo);
  updateSummerCampSeatTitle();
  setSummerCampSaveStatus('标题已保存', 'saved');
};

const setLocationInfo = (info: Partial<LocationInfo> | undefined): void => {
  const merged = sanitizeLocationInfo(info);
  byId<HTMLInputElement>('date').value = merged.date;
  byId<HTMLInputElement>('date').dataset.fullDate = merged.fullDate;
  byId<HTMLInputElement>('day').value = merged.day;
  byId<HTMLSelectElement>('weekday').value = merged.weekday;
  byId<HTMLInputElement>('time').value = merged.time;
  byId<HTMLSelectElement>('campus').value = merged.campus;
  byId<HTMLInputElement>('floor').value = merged.floor;
  byId<HTMLInputElement>('room').value = merged.room;
  byId<HTMLInputElement>('campArrivalMessage').value = merged.arrivalMessage;
  byId<HTMLDivElement>('academicWeekContext').textContent = buildAcademicWeekContext(merged.fullDate);
  notes().innerHTML = merged.notes;
  setNotesVisibility(merged.notesHidden === true);
  syncSummerCampNotesState();
  updateSummerCampSeatTitle();
};

const captureCurrentModeData = (): ClassConfig[TimeMode] => {
  rememberCurrentRotationConfig();
  return {
    layout: state.currentLayout,
    groups: (state.currentLayout === 'circular' || state.currentLayout === 'camp') ? JSON.parse(JSON.stringify(state.groups)) : null,
    groupOrder: (state.currentLayout === 'circular' || state.currentLayout === 'rows' || state.currentLayout === 'four' || state.currentLayout === 'camp') ? [...state.currentGroupOrder] : null,
    groupLabels: (state.currentLayout === 'circular' || state.currentLayout === 'rows' || state.currentLayout === 'four' || state.currentLayout === 'camp') ? [...state.currentGroupLabels] : null,
    rowGroups: state.currentLayout === 'rows' ? JSON.parse(JSON.stringify(state.rowGroups)) : null,
    fourGroups: state.currentLayout === 'four' ? JSON.parse(JSON.stringify(state.fourGroups)) : null,
    currentArrangement: state.currentArrangement,
    locationInfo: getLocationInfo(),
    rotationConfig: { ...state.rotationConfig },
    rotationConfigsByLayout: normalizeRotationConfigsByLayout(state.rotationConfigsByLayout),
    layoutIdentity: activeClassName.trim()
      ? deepCopy(state.classData[activeClassName.trim()]?.[state.currentTimeMode]?.layoutIdentity || null)
      : null,
  };
};

const saveSummerCampRosterSnapshot = (className: string, modeData: ClassConfig[TimeMode]): void => {
  if (!isSummerCampMode()) {
    return;
  }

  const config = state.classData[className];
  if (!config) {
    return;
  }

  const students = collectStudentsFromModeData(modeData);
  if (students.length === 0) {
    return;
  }

  config.rosterMirror = buildSummerCampRosterMirror(students);
  saveKnownRosterForClass(className, students, { preserveDuplicates: true });
};

const syncSummerCampHiddenMode = (className: string, modeData: ClassConfig[TimeMode]): void => {
  if (!isSummerCampMode()) {
    return;
  }

  const config = state.classData[className];
  if (!config) {
    return;
  }

  const otherMode: TimeMode = state.currentTimeMode === 'weekday' ? 'weekend' : 'weekday';
  config[otherMode] = deepCopy(modeData);
};

const ensureClassShell = (className: string, layout: LayoutType = getDefaultLaunchLayout()): void => {
  if (!state.classData[className]) {
    state.classData[className] = makeClassShell(layout, state.userProfile.theme);
    ensureSummerCampShellDefaults(className);
  }
};

const saveCurrentClassMode = (
  successMessage = '已自动保存',
  options: { regroupIdentity?: boolean; identityOverride?: ClassConfig[TimeMode]['layoutIdentity'] } = {},
): boolean => {
  const className = activeClassName.trim();
  if (!className) {
    return true;
  }

  ensureClassShell(className);
  const capturedMode = captureCurrentModeData();
  if (options.identityOverride) {
    capturedMode.layoutIdentity = deepCopy(options.identityOverride);
  }
  if (options.regroupIdentity) {
    capturedMode.layoutIdentity = updateIdentityAfterRegroup(capturedMode);
  } else if (capturedMode.layoutIdentity) {
    capturedMode.layoutIdentity = captureLayoutIdentity(capturedMode, capturedMode.layoutIdentity);
  }
  state.classData[className][state.currentTimeMode] = capturedMode;
  syncSummerCampHiddenMode(className, capturedMode);
  saveSummerCampRosterSnapshot(className, capturedMode);
  state.classData[className].theme = getClassTheme(className);
  if (!persist()) {
    notifyLocalSaveFailure();
    return false;
  }
  setSummerCampSaveStatus(successMessage, 'saved');
  return true;
};

const resetLayoutData = (layout: LayoutType = 'circular'): void => {
  if (layout === 'camp') {
    state.groups = makeEmptyCampGroups();
    state.currentGroupOrder = getDefaultGroupOrder('camp');
    state.currentGroupLabels = getDefaultGroupLabels('camp');
    state.rowGroups = makeEmptyRowGroups();
    state.fourGroups = makeEmptyFourGroups();
    return;
  }

  state.groups = makeEmptyCircularGroups();
  state.currentGroupOrder = [...DEFAULT_GROUP_ORDER];
  state.currentGroupLabels = getDefaultGroupLabels();
  state.rowGroups = makeEmptyRowGroups();
  state.fourGroups = makeEmptyFourGroups();
};

const setLayoutClass = (layout: LayoutType): void => {
  const target = classroom();
  target.className = 'classroom';
  if (layout === 'rows') {
    target.classList.add('three-rows-layout');
  } else if (layout === 'four') {
    target.classList.add('four-layout');
  } else if (layout === 'camp') {
    target.classList.add('camp-layout');
  }
};

const refresh = (): void => {
  refreshSeating(state, {
    handleSeatChange: (groupIndex, seatIndex, value) => {
      if (state.isEditMode) {
        state.groups[groupIndex][seatIndex] = value;
      }
    },
    handleRowSeatChange: (rowIndex, side, seatIndex, value) => {
      if (state.isEditMode) {
        state.rowGroups.rows[rowIndex][side][seatIndex] = value;
      }
    },
    handleFourSeatChange: (groupIndex, seatIndex, value) => {
      if (state.isEditMode) {
        state.fourGroups.groups[groupIndex][seatIndex] = value;
      }
    }
  });
  updateLayoutSwitchButton();
};

const focusEditableLabel = (target: HTMLElement): void => {
  const range = document.createRange();
  range.selectNodeContents(target);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
};

const commitGroupLabelEdit = (target: HTMLElement): void => {
  const index = Number(target.dataset.groupLabelIndex || '');
  if (!Number.isInteger(index) || index < 0) {
    return;
  }
  const nextLabel = target.textContent?.trim() || `${index + 1}`;
  state.currentGroupLabels[index] = nextLabel;
  state.rotationConfig.labelNameMode = 'custom';
  if (state.rotationConfig.labelRotation === 'custom') {
    state.rotationConfig.labelRotation = 'fixed';
  }
  syncRotationSelectors();
  target.removeAttribute('contenteditable');
  delete target.dataset.editing;
  refresh();
  saveCurrentClassMode();
};

const loadClass = (): void => {
  const className = classSelect().value;
  if (className) {
    hydrateClassScheduleFromMeta(className);
  }
  const data = state.classData[className]?.[state.currentTimeMode];

  if (!className || !data) {
    activeClassName = className || '';
    state.currentLayout = getDefaultLaunchLayout();
    resetLayoutData(state.currentLayout);
    state.currentArrangement = 0;
    state.rotationConfig = defaultRotationConfig(state.currentLayout);
    state.rotationConfigsByLayout = { [state.currentLayout]: { ...state.rotationConfig } };
    state.currentGroupLabels = getDefaultGroupLabels(state.currentLayout);
    syncRotationSelectors();
    setLocationInfo(makeEmptyLocationInfo());
    headerClassName().value = className || '';
    syncEditorThemeSelect(state.userProfile.theme);
    applyTheme(state.userProfile.theme);
    setLayoutClass(state.currentLayout);
    refresh();
    updateSyncModeButton();
    updateEditorFloatingContext();
    updateCampPresetSwitchUi();
    syncSummerCampPickerFromActiveClass();
    renderReminderSummary();
    window.requestAnimationFrame(() => {
      const panel = byId<HTMLDivElement>('editorView').querySelector<HTMLElement>('.right-section');
      if (panel) panel.dataset.heightMode = 'auto';
      window.dispatchEvent(new Event('superamber:notes-sync'));
    });
    maybeShowEmptySeatingDialog(className);
    return;
  }

  activeClassName = className;
  state.currentLayout = data.layout || 'circular';
  state.currentArrangement = data.currentArrangement || 0;
  state.rotationConfigsByLayout = normalizeRotationConfigsByLayout(data.rotationConfigsByLayout);

  if (state.currentLayout === 'circular') {
    state.groups = JSON.parse(JSON.stringify(data.groups || makeEmptyCircularGroups()));
    state.currentGroupOrder = [...(data.groupOrder || getDefaultGroupOrder())];
    state.currentGroupLabels = normalizeGroupLabels(data.groupLabels || getDefaultGroupLabels());
    state.rowGroups = makeEmptyRowGroups();
    state.fourGroups = makeEmptyFourGroups();
  } else if (state.currentLayout === 'camp') {
    const groupCount = getCampGroupCountFromGroups(data.groups || makeEmptyCampGroups());
    state.groups = JSON.parse(JSON.stringify(data.groups || makeEmptyCampGroups(groupCount)));
    state.currentGroupOrder = [...(data.groupOrder || getDefaultGroupOrder('camp', groupCount))];
    state.currentGroupLabels = normalizeGroupLabels(data.groupLabels || getDefaultGroupLabels('camp', groupCount), groupCount);
    state.rowGroups = makeEmptyRowGroups();
    state.fourGroups = makeEmptyFourGroups();
  } else if (state.currentLayout === 'rows') {
    state.rowGroups = JSON.parse(JSON.stringify(data.rowGroups || makeEmptyRowGroups()));
    state.groups = makeEmptyCircularGroups();
    state.currentGroupOrder = [...(data.groupOrder || getDefaultGroupOrder())];
    state.currentGroupLabels = normalizeGroupLabels(data.groupLabels || getDefaultGroupLabels());
    state.fourGroups = makeEmptyFourGroups();
  } else {
    state.fourGroups = JSON.parse(JSON.stringify(data.fourGroups || makeEmptyFourGroups()));
    state.groups = makeEmptyCircularGroups();
    state.currentGroupOrder = [...(data.groupOrder || getDefaultGroupOrder())];
    state.currentGroupLabels = normalizeGroupLabels(data.groupLabels || getDefaultGroupLabels());
    state.rowGroups = makeEmptyRowGroups();
  }

  state.rotationConfig = state.rotationConfigsByLayout[state.currentLayout]
    ? { ...state.rotationConfigsByLayout[state.currentLayout] as RotationConfig }
    : data.rotationConfig
      ? { ...data.rotationConfig }
      : defaultRotationConfig(state.currentLayout);
  rememberCurrentRotationConfig();
  syncRotationSelectors();

  setLocationInfo(data.locationInfo);
  headerClassName().value = className;
  const classTheme = getClassTheme(className);
  syncEditorThemeSelect(classTheme);
  applyTheme(classTheme);
  setLayoutClass(state.currentLayout);
  refresh();
  updateSyncModeButton();
  updateEditorFloatingContext();
  updateCampPresetSwitchUi();
  syncSummerCampPickerFromActiveClass();
  renderReminderSummary();
  window.requestAnimationFrame(() => {
    const panel = byId<HTMLDivElement>('editorView').querySelector<HTMLElement>('.right-section');
    if (panel) panel.dataset.heightMode = 'auto';
    window.dispatchEvent(new Event('superamber:notes-sync'));
  });
  maybeShowEmptySeatingDialog(className);
};

const applyTimeModeUi = (mode: TimeMode): void => {
  state.currentTimeMode = mode;
  byId<HTMLButtonElement>('weekdayBtn').className = 'active';
  byId<HTMLButtonElement>('weekendBtn').className = '';
  if (mode === 'weekend') {
    byId<HTMLButtonElement>('weekdayBtn').className = '';
    byId<HTMLButtonElement>('weekendBtn').className = 'active';
  }
  updateCampPresetSwitchUi();
  updateEditorFloatingContext();
};

const hasOpenEditorDialog = (): boolean =>
  queryAll<HTMLElement>('.dialog').some((dialog) => dialog.style.display === 'block');

const closeEditorTransientUi = (): void => {
  queryAll<HTMLElement>('.dialog').forEach((dialog) => {
    dialog.style.display = 'none';
  });
  byId<HTMLDivElement>('overlay').style.display = 'none';
  manualTuneDraft = null;
};

const switchEditorClass = (nextClassName: string, options?: { resetMode?: boolean; preserveDialogs?: boolean }): void => {
  const targetClassName = nextClassName.trim();
  const currentClassName = activeClassName.trim();

  if (!targetClassName) {
    syncClassPickerValues(currentClassName);
    return;
  }

  if (targetClassName === currentClassName && state.currentView === 'editor') {
    syncClassPickerValues(targetClassName);
    updateEditorFloatingContext();
    return;
  }

  if (isOcrRecognitionRunning) {
    window.alert('图片识别进行中，请等待当前识别完成后再切换班级。');
    syncClassPickerValues(currentClassName);
    return;
  }

  if (!options?.preserveDialogs && hasOpenEditorDialog()) {
    const shouldContinue = window.confirm('当前有功能弹窗处于打开状态。切换班级会先关闭弹窗，并放弃这些弹窗里未确认的临时修改，是否继续？');
    if (!shouldContinue) {
      syncClassPickerValues(currentClassName);
      return;
    }
    closeEditorTransientUi();
  }

  if (state.currentView === 'editor' && currentClassName) {
    saveCurrentClassMode();
  }

  if (options?.resetMode) {
    applyTimeModeUi('weekday');
  }

  syncClassPickerValues(targetClassName);
  loadClass();
  setCurrentView('editor');
};

const openClassInEditor = (className: string): void => {
  switchEditorClass(className, { resetMode: true, preserveDialogs: true });
};

const goHome = (): void => {
  saveCurrentClassMode();
  applyTheme(state.userProfile.theme);
  setCurrentView('home');
};

const toggleTime = (mode: TimeMode): void => {
  saveCurrentClassMode();
  applyTimeModeUi(mode);
  loadClass();
};

const copyCurrentToOtherMode = (): void => {
  const className = classSelect().value.trim();
  if (!className) {
    alert('请先选择班级。');
    return;
  }

  ensureClassShell(className);
  saveCurrentClassMode();

  const targetMode: TimeMode = state.currentTimeMode === 'weekday' ? 'weekend' : 'weekday';
  const targetLabel = targetMode === 'weekday' ? '周中' : '周末';
  const currentModeData = state.classData[className][state.currentTimeMode];
  const targetModeData = state.classData[className][targetMode];

  if (countStudentsInMode(currentModeData) === 0) {
    alert('当前时段还没有可复制的名单。');
    return;
  }

  const shouldSync = window.confirm(`是否同步所有学生及座位顺序到${targetLabel}？\n\n这会覆盖${targetLabel}当前的座位布局与学生顺序，但保留${targetLabel}原本的日期、时间、校区和备注信息。`);
  if (!shouldSync) {
    return;
  }
  const groupCount = currentModeData.layout === 'camp' ? getCampGroupCountFromGroups(currentModeData.groups || makeEmptyCampGroups()) : 6;

  state.classData[className][targetMode] = {
    layout: currentModeData.layout,
    groups: (currentModeData.layout === 'circular' || currentModeData.layout === 'camp') ? deepCopy(currentModeData.groups) : null,
    groupOrder: (currentModeData.layout === 'circular' || currentModeData.layout === 'rows' || currentModeData.layout === 'four' || currentModeData.layout === 'camp')
      ? [...(currentModeData.groupOrder || getDefaultGroupOrder(currentModeData.layout, groupCount))]
      : null,
    groupLabels: (currentModeData.layout === 'circular' || currentModeData.layout === 'rows' || currentModeData.layout === 'four' || currentModeData.layout === 'camp')
      ? normalizeGroupLabels(currentModeData.groupLabels || getDefaultGroupLabels(currentModeData.layout, groupCount), groupCount)
      : null,
    rowGroups: currentModeData.layout === 'rows' ? deepCopy(currentModeData.rowGroups) : null,
    fourGroups: currentModeData.layout === 'four' ? deepCopy(currentModeData.fourGroups) : null,
    currentArrangement: currentModeData.currentArrangement,
    locationInfo: deepCopy(targetModeData.locationInfo || makeEmptyLocationInfo()),
    rotationConfig: currentModeData.rotationConfig
      ? { ...defaultRotationConfig(currentModeData.layout), ...currentModeData.rotationConfig }
      : defaultRotationConfig(currentModeData.layout),
    rotationConfigsByLayout: {
      ...normalizeRotationConfigsByLayout(currentModeData.rotationConfigsByLayout),
      [currentModeData.layout]: currentModeData.rotationConfig
        ? { ...currentModeData.rotationConfig }
        : defaultRotationConfig(currentModeData.layout),
    },
    layoutIdentity: currentModeData.layoutIdentity ? deepCopy(currentModeData.layoutIdentity) : null,
  };

  persist();
  updateSyncModeButton();
  alert(`已把当前学生名单和座位顺序同步到${targetLabel}。`);
};

const showSaveDialog = (): void => {
  byId<HTMLInputElement>('saveClassName').value = headerClassName().value;
  showDialog('saveDialog');
};

const hideSaveDialog = (): void => {
  hideDialog('saveDialog');
};

const saveClass = (): void => {
  const className = byId<HTMLInputElement>('saveClassName').value.trim();
  if (!className) {
    alert('请输入班级名称');
    return;
  }

  ensureClassShell(className);
  state.classData[className][state.currentTimeMode] = captureCurrentModeData();

  persist();
  updateClassSelect();
  syncClassPickerValues(className);
  activeClassName = className;
  headerClassName().value = className;
  hideSaveDialog();
  renderClassOverview();
  updateEditorFloatingContext();
};

const deleteCurrentClass = (): void => {
  const className = classSelect().value;
  if (!className) {
    return;
  }

  if (!confirm(`确定要删除 ${className} 的所有配置吗？`)) {
    return;
  }

  delete state.classData[className];
  persist();
  updateClassSelect();
  renderClassOverview();

  headerClassName().value = '';
  activeClassName = '';
  syncClassPickerValues('');
  state.currentLayout = 'circular';
  resetLayoutData();
  state.currentArrangement = 0;
  syncEditorThemeSelect(state.userProfile.theme);
  applyTheme(state.userProfile.theme);
  setLocationInfo(makeEmptyLocationInfo());
  refresh();
  updateEditorFloatingContext();
};

const renameCurrentClass = (): void => {
  const oldName = classSelect().value.trim();
  if (!oldName) {
    alert('请先选择班级。');
    return;
  }

  saveCurrentClassMode();
  const input = window.prompt('输入新的班号', oldName);
  const newName = input?.trim();
  if (!newName || newName === oldName) {
    return;
  }

  if (state.classData[newName]) {
    alert('这个班号已经存在了，请换一个名称。');
    return;
  }

  state.classData[newName] = state.classData[oldName];
  delete state.classData[oldName];
  persist();
  updateClassSelect();
  renderClassOverview();
  syncClassPickerValues(newName);
  activeClassName = newName;
  headerClassName().value = newName;
  loadClass();
};

const syncDateField = (): void => {
  const info = getLocationInfo();
  byId<HTMLInputElement>('date').dataset.fullDate = info.fullDate;
  byId<HTMLDivElement>('academicWeekContext').textContent = buildAcademicWeekContext(info.fullDate);
  updateSummerCampSeatTitle();
  if (isSummerCampMode()) {
    saveCurrentClassMode();
    syncSummerCampPickerFromActiveClass();
    setSummerCampSaveStatus('日期已同步保存', 'saved');
  }
};

const showImportDialog = (): void => {
  byId<HTMLTextAreaElement>('studentNames').value = '';
  byId<HTMLDivElement>('errorMsg').textContent = '';
  byId<HTMLDivElement>('errorMsg').className = '';
  if (isSummerCampMode()) {
    byId<HTMLInputElement>('campLayout').checked = true;
  } else if (!queryOne<HTMLInputElement>('input[name="layout"]:checked')) {
    byId<HTMLInputElement>('circularLayout').checked = true;
  }
  updateLayoutDescription();
  showDialog('importDialog');
};

const hideImportDialog = (): void => {
  hideDialog('importDialog');
};

const showError = (message: string): void => {
  const errorMsg = byId<HTMLDivElement>('errorMsg');
  errorMsg.textContent = message;
  errorMsg.className = 'error';
};

const showSuccess = (message: string): void => {
  const errorMsg = byId<HTMLDivElement>('errorMsg');
  errorMsg.textContent = message;
  errorMsg.className = 'success';
  setTimeout(() => {
    errorMsg.textContent = '';
    errorMsg.className = '';
  }, 2500);
};

const ensureClassForImportSave = (): string | null => {
  const selected = classSelect().value.trim();
  if (selected) {
    activeClassName = selected;
    return selected;
  }

  const proposed = headerClassName().value.trim() || `Class${Object.keys(state.classData).length + 1}`;
  const input = window.prompt('请输入班级名称以保存导入结果', proposed);
  const className = input?.trim();
  if (!className) {
    return null;
  }

  ensureClassShell(className);
  updateClassSelect();
  syncClassPickerValues(className);
  activeClassName = className;
  headerClassName().value = className;
  return className;
};

const saveAndRefresh = (message: string): void => {
  if (state.currentView === 'home') {
    setCurrentView('editor');
  }

  refresh();
  hideImportDialog();

  const className = ensureClassForImportSave();
  if (!className) {
    alert('已导入到当前画布，但你取消了保存，数据不会持久化。');
    return;
  }

  saveCurrentClassMode(message, { regroupIdentity: true });
  showSuccess(message);
};

const applyImportedLayout = (imported: ImportedLayoutState): void => {
  state.currentLayout = imported.currentLayout;
  state.groups = imported.groups;
  state.currentGroupOrder = imported.currentGroupOrder;
  state.currentGroupLabels = imported.currentGroupLabels;
  state.rowGroups = imported.rowGroups;
  state.fourGroups = imported.fourGroups;
  state.currentArrangement = imported.currentArrangement;
  setLayoutClass(imported.currentLayout);
};

const importCircularLayout = (students: string[]): void => {
  const imported = buildCircularImportState(students);
  applyImportedLayout(imported);
  saveAndRefresh(imported.successMessage);
};

const importDefaultLayout = (students: string[]): void => {
  const imported = getDefaultLaunchLayout() === 'camp'
    ? buildCampImportState(students)
    : buildCircularImportState(students);
  applyImportedLayout(imported);
  saveAndRefresh(imported.successMessage);
};

const importStudents = (): void => {
  const input = byId<HTMLTextAreaElement>('studentNames').value;
  const students = input
    .split('\n')
    .map((name) => name.trim())
    .filter(Boolean);

  try {
    const imported = isSummerCampMode()
      ? buildCampImportState(students)
      : byId<HTMLInputElement>('circularLayout').checked
      ? buildCircularImportState(students)
      : byId<HTMLInputElement>('rowsLayout').checked
        ? buildRowsImportState(students)
        : byId<HTMLInputElement>('fourLayout').checked
          ? buildFourImportState(students)
          : buildCampImportState(students);

    applyImportedLayout(imported);
    saveAndRefresh(imported.successMessage);
    if (isSummerCampMode() && activeClassName && students.length > 0) {
      saveKnownRosterForClass(activeClassName, students, { preserveDuplicates: true });
      updateRosterDiffBanner();
    }
  } catch (error) {
    showError(error instanceof Error ? error.message : '导入失败');
  }
};

const campPresetPhaseLabel = (roster: CampPresetRoster): string =>
  roster.period.match(/（(.+)）/)?.[1] || roster.period.replace(roster.majorCamp, '').replace(/[（）]/g, '');

const campPhaseIndexFromDate = (dateKey: string): number =>
  getCampReportPhase(dateKey) || getCampReportPhase(defaultSummerCampDateKey()) || 1;

const campPhaseLabelFromDate = (dateKey: string): string =>
  campPhaseIndexFromDate(dateKey) === 2 ? '第二期' : '第一期';

const campPresetClassName = (roster: CampPresetRoster): string =>
  `${roster.majorCamp}${campPresetPhaseLabel(roster)}-${roster.camp}`;

const summerCampMajorSelect = (): HTMLSelectElement | null => queryOne<HTMLSelectElement>('#summerCampMajorSelect');
const summerCampMinorSelect = (): HTMLSelectElement | null => queryOne<HTMLSelectElement>('#summerCampMinorSelect');
const summerCampDateSelect = (): HTMLSelectElement | null => queryOne<HTMLSelectElement>('#summerCampDateSelect');

const findCampPresetRosterByClassName = (className: string): CampPresetRoster | null =>
  CAMP_PRESET_ROSTERS.find((roster) => campPresetClassName(roster) === className) || null;

const campPresetRostersForMajor = (major: string, dateKey: string): CampPresetRoster[] =>
  getCampPresetRostersForMajorAndPhase(major, campPhaseIndexFromDate(dateKey));

const summerCampClassName = (majorCamp: string, minorCamp: string, dateKey: string): string => {
  const campNo = campNumberFromText(minorCamp);
  const campLabel = campNo ? `营${campNo}` : minorCamp;
  return `${majorCamp}${campPhaseLabelFromDate(dateKey)}-${campLabel}`;
};

const setSelectOptions = (
  select: HTMLSelectElement,
  options: Array<{ value: string; label: string }>,
): void => {
  select.innerHTML = '';
  options.forEach((item) => {
    const option = document.createElement('option');
    option.value = item.value;
    option.textContent = item.label;
    select.appendChild(option);
  });
};

const existingSummerCampMinorOptions = (
  major: string,
  dateKey: string,
): Array<{ value: string; label: string }> => {
  const phaseLabel = campPhaseLabelFromDate(dateKey);
  return Object.entries(state.classData)
    .map(([className, config]) => ({
      className,
      config,
      campNo: campNumberFromText(className),
    }))
    .filter(({ className, config, campNo }) =>
      Boolean(campNo)
      && className.startsWith(`${major}${phaseLabel}-营`)
      && classHasAnySavedSeating(config)
    )
    .sort((a, b) => Number(a.campNo) - Number(b.campNo))
    .map(({ campNo }) => ({
      value: `Camp ${campNo}`,
      label: `Camp ${campNo}`,
    }));
};

const updateSummerCampPickerButtons = (): void => {
  const uploadBtn = queryOne<HTMLButtonElement>('#summerCampUploadBtn');
  const applyBtn = queryOne<HTMLButtonElement>('#summerCampApplyBtn');
  if (uploadBtn) {
    uploadBtn.style.display = 'none';
  }
  if (applyBtn) {
    applyBtn.style.display = 'none';
  }
};

const updateSummerCampMinorOptions = (preferredValue?: string, dateKey?: string): void => {
  const majorSelect = summerCampMajorSelect();
  const minorSelect = summerCampMinorSelect();
  if (!majorSelect || !minorSelect) {
    return;
  }

  const major = majorSelect.value || SUMMER_CAMP_DEFAULT_MAJOR;
  const currentValue = preferredValue || minorSelect.value;
  const effectiveDateKey = dateKey || summerCampDateSelect()?.value || defaultSummerCampDateKey();
  const presetRosters = campPresetRostersForMajor(major, effectiveDateKey);
  const existingOptions = existingSummerCampMinorOptions(major, effectiveDateKey);
  const options = presetRosters.length > 0
    ? presetRosters.map((roster) => ({
        value: roster.key,
        label: `${roster.label} · ${roster.students.length}人`,
      }))
    : (existingOptions.length > 0 ? existingOptions : CAMP_MINOR_OPTIONS.map((minor) => ({
        value: minor,
        label: minor,
      })));
  const resolvedPresetValue = presetRosters.find((roster) =>
    roster.key === currentValue || roster.camp === currentValue || `Camp ${campNumberFromText(roster.camp)}` === currentValue
  )?.key;

  setSelectOptions(minorSelect, options);
  if (resolvedPresetValue) {
    minorSelect.value = resolvedPresetValue;
  } else if (options.some((item) => item.value === currentValue)) {
    minorSelect.value = currentValue;
  }
  updateSummerCampPickerButtons();
};

const populateSummerCampPicker = (): void => {
  if (!isSummerCampMode()) {
    return;
  }

  const majorSelect = summerCampMajorSelect();
  const dateSelect = summerCampDateSelect();
  if (!majorSelect || !dateSelect) {
    return;
  }

  const currentMajor = majorSelect.value;
  const launchPreference = loadSummerCampLaunchPreference();
  setSelectOptions(majorSelect, CAMP_MAJOR_OPTIONS.map((item) => ({
    value: item.level,
    label: item.label,
  })));
  majorSelect.value = CAMP_MAJOR_OPTIONS.some((item) => item.level === currentMajor)
    ? currentMajor
    : getPreferredSummerCampMajor();

  const currentDate = dateSelect.value;
  setSelectOptions(dateSelect, summerCampDateOptions().map((item) => ({
    value: item.date,
    label: summerCampDateLabel(item.date),
  })));
  dateSelect.value = summerCampDateOptions().some((item) => item.date === currentDate)
    ? currentDate
    : typeof launchPreference?.reportDate === 'string' && summerCampDateOptions().some((item) => item.date === launchPreference.reportDate)
      ? launchPreference.reportDate
      : defaultSummerCampDateKey();

  updateSummerCampMinorOptions(
    launchPreference?.majorCamp === majorSelect.value
      ? launchPreference.minorCamp
      : undefined,
    dateSelect.value,
  );
};

const syncSummerCampPickerFromActiveClass = (): void => {
  if (!isSummerCampMode()) {
    return;
  }

  populateSummerCampPicker();
  const majorSelect = summerCampMajorSelect();
  const minorSelect = summerCampMinorSelect();
  const dateSelect = summerCampDateSelect();
  if (!majorSelect || !minorSelect || !dateSelect) {
    return;
  }

  const className = activeClassName || classSelect().value || '';
  const selectedClass = state.classData[className];
  const selectedDate = selectedClass
    ? getSummerCampDateKeyFromInfo(selectedClass[state.currentTimeMode].locationInfo)
    : defaultSummerCampDateKey();
  dateSelect.value = summerCampDateOptions().some((item) => item.date === selectedDate)
    ? selectedDate
    : defaultSummerCampDateKey();
  const roster = findCampPresetRosterByClassName(className);
  if (roster) {
    majorSelect.value = roster.majorCamp;
    updateSummerCampMinorOptions(roster.key, dateSelect.value);
  } else {
    const major = CAMP_MAJOR_OPTIONS.find((item) => className.startsWith(item.level))?.level || SUMMER_CAMP_DEFAULT_MAJOR;
    const campNo = campNumberFromText(className);
    majorSelect.value = major;
    updateSummerCampMinorOptions(campNo ? `Camp ${campNo}` : undefined, dateSelect.value);
  }
  updateSummerCampPickerButtons();
  applySummerCampTheme(majorSelect.value);
};

const applySummerCampSelection = (options: { showSuccess?: boolean } = {}): void => {
  if (!isSummerCampMode()) {
    return;
  }

  const major = summerCampMajorSelect()?.value || SUMMER_CAMP_DEFAULT_MAJOR;
  const minorValue = summerCampMinorSelect()?.value || '';
  const dateKey = summerCampDateSelect()?.value || defaultSummerCampDateKey();
  applySummerCampTheme(major);

  const presetRosters = campPresetRostersForMajor(major, dateKey);
  if (presetRosters.length > 0) {
    const roster = findCampPresetRoster(minorValue) || presetRosters[0];
    if (!roster) {
      alert(`还没有可用的 ${major} 预设名单。`);
      return;
    }
    const ok = applyCampPresetRoster(roster, 6, {
      confirmOverwrite: false,
      showAlert: false,
      openEditor: true,
    });
    if (!ok) {
      return;
    }
    saveSummerCampLaunchPreference({
      majorCamp: major,
      minorCamp: normalizeSummerCampMinor(roster.camp),
      reportDate: dateKey,
      lastTool: 'seating',
    });
    window.dispatchEvent(new CustomEvent('superamber:summer-camp-selection-change', {
      detail: {
        majorCamp: major,
        minorCamp: normalizeSummerCampMinor(roster.camp),
        reportDate: dateKey,
      },
    }));
    const className = campPresetClassName(roster);
    applySummerCampDateToClass(className, dateKey, campNumberFromText(roster.camp));
    loadClass();
    renderClassOverview();
    syncSummerCampPickerFromActiveClass();
    setSummerCampSaveStatus(`${summerCampDateLabel(dateKey)} 已同步保存`, 'saved');
    return;
  }

  if (state.currentView === 'editor' && activeClassName) {
    saveCurrentClassMode();
  }

  const minorCamp = minorValue || CAMP_MINOR_OPTIONS[0] || 'Camp 1';
  saveSummerCampLaunchPreference({
    majorCamp: major,
    minorCamp,
    reportDate: dateKey,
    lastTool: 'seating',
  });
  window.dispatchEvent(new CustomEvent('superamber:summer-camp-selection-change', {
    detail: {
      majorCamp: major,
      minorCamp,
      reportDate: dateKey,
    },
  }));
  const className = summerCampClassName(major, minorCamp, dateKey);
  ensureClassShell(className, 'camp');
  applySummerCampDateToClass(className, dateKey, campNumberFromText(minorCamp));
  updateClassSelect();
  openClassInEditor(className);
  renderClassOverview();
  syncSummerCampPickerFromActiveClass();
  setSummerCampSaveStatus(`${summerCampDateLabel(dateKey)} 已同步保存`, 'saved');
  if (options.showSuccess) {
    showSuccess(`${className} 已切换。非预设营请点击“导入名单”导入学生。`);
  }
};

const campPresetDefaultLocationInfo = (
  roster: CampPresetRoster,
  existing?: Partial<LocationInfo>,
): LocationInfo => {
  const campNo = campNumberFromText(roster.camp) || '1';
  const base = sanitizeLocationInfo(existing);
  const dateKey = base.fullDate || defaultSummerCampDateKey();
  const time = base.time || '8:00';
  const room = base.room || `营${campNo}教室`;
  return makeSummerCampLocationInfo(dateKey, campNo, {
    ...base,
    time,
    room,
    arrivalMessage: base.arrivalMessage || `${time}准时抵达营${campNo}教室哦~`,
  });
};

const updateCampPresetSwitchUi = (): void => {
  const status = queryOne<HTMLButtonElement>('#campRosterStatusBtn');
  const switchBtn = queryOne<HTMLButtonElement>('#campRosterSwitchBtn');
  if (!status || !switchBtn) {
    return;
  }
  if (!isSummerCampMode()) {
    status.style.display = 'none';
    switchBtn.style.display = 'none';
    return;
  }

  const className = activeClassName || classSelect().value;
  const campNo = currentCampNumber();
  const count = className && state.classData[className]
    ? countStudentsInMode(state.classData[className][state.currentTimeMode])
    : 0;
  const dateLabel = className && state.classData[className]
    ? summerCampDateLabel(getSummerCampDateKeyFromInfo(state.classData[className][state.currentTimeMode].locationInfo))
    : '';
  status.style.display = '';
  switchBtn.style.display = '';
  switchBtn.textContent = '切换营号';
  status.textContent = className && state.classData[className]
    ? `${className || `营${campNo}`} · ${dateLabel}${count > 0 ? ` · ${count}人` : ' · 待上传'}`
    : '未选择营号';
};

const campPresetKnownScoreCount = (roster: CampPresetRoster): number =>
  roster.students.filter((student) =>
    typeof student.wordScore === 'number'
    || typeof student.dialogueScore === 'number'
    || Boolean(student.analysis.trim())
  ).length;

const currentCampPresetPhaseDate = (): string =>
  summerCampDateSelect()?.value
  || getStoredSummerCampDateForClass(activeClassName || classSelect().value || '')
  || defaultSummerCampDateKey();

const populateCampPresetOptions = (): void => {
  const select = byId<HTMLSelectElement>('campPresetSelect');
  const phaseRosters = campPresetRostersForMajor(
    summerCampMajorSelect()?.value || SUMMER_CAMP_DEFAULT_MAJOR,
    currentCampPresetPhaseDate(),
  );
  const activeRoster = phaseRosters.find((roster) => campPresetClassName(roster) === activeClassName);
  select.innerHTML = phaseRosters.map((roster) =>
    `<option value="${escapeHtml(roster.key)}">${escapeHtml(roster.label)} · ${roster.students.length}人</option>`
  ).join('');
  if (activeRoster) {
    select.value = activeRoster.key;
  } else if (phaseRosters[0]) {
    select.value = phaseRosters[0].key;
  }
};

const selectedCampPresetRoster = (): CampPresetRoster | null => {
  const key = byId<HTMLSelectElement>('campPresetSelect').value;
  const phaseRosters = campPresetRostersForMajor(
    summerCampMajorSelect()?.value || SUMMER_CAMP_DEFAULT_MAJOR,
    currentCampPresetPhaseDate(),
  );
  return phaseRosters.find((roster) => roster.key === key) || phaseRosters[0] || null;
};

const updateCampPresetSummary = (): void => {
  const roster = selectedCampPresetRoster();
  const summary = byId<HTMLDivElement>('campPresetSummary');
  const groupSelect = byId<HTMLSelectElement>('campPresetGroupCount');
  if (!roster) {
    summary.innerHTML = '<div class="camp-preset-empty">还没有可用的预设营名单。</div>';
    return;
  }

  const studentCount = roster.students.length;
  const knownScoreCount = campPresetKnownScoreCount(roster);
  const genderStats = campPresetGenderStats(roster.students);
  groupSelect.value = '6';

  const firstStudents = roster.students.slice(0, 8).map(formatCampPresetStudentName).join('、');
  summary.innerHTML = `
    <div class="camp-preset-card">
      <strong>${escapeHtml(roster.label)}</strong>
      <span>班主任：${escapeHtml([roster.teacher, roster.teacher2].filter(Boolean).join(' / ') || '未填写')}</span>
      <span>名单人数：${studentCount} 人</span>
      <span>已有能力数据：${knownScoreCount} 人</span>
      <span>姓名性别倾向：男 ${genderStats.male} / 女 ${genderStats.female} / 未知 ${genderStats.unknown}</span>
      <span>默认6组，标准36人，所有布局最高45人</span>
    </div>
    <div class="camp-preset-preview">名单预览：${escapeHtml(firstStudents)}${roster.students.length > 8 ? '…' : ''}</div>
    <div class="camp-preset-rule">预排规则：优先用词句/对话分数和数据分析做能力均衡，再用常见英文名和中文名特征做性别倾向均衡；无法判断的学生按未知处理。</div>
  `;
};

const showCampPresetDialog = (): void => {
  if (!isSummerCampMode()) {
    alert('预设营号只能在夏令营页面使用。');
    return;
  }
  populateCampPresetOptions();
  const activeMode = activeClassName ? state.classData[activeClassName]?.[state.currentTimeMode] : null;
  if (activeMode?.layout === 'camp') {
    byId<HTMLSelectElement>('campPresetGroupCount').value = String(getCampGroupCountFromGroups(activeMode.groups || makeEmptyCampGroups()));
  }
  updateCampPresetSummary();
  showDialog('campPresetDialog');
};

const hideCampPresetDialog = (): void => {
  hideDialog('campPresetDialog');
};

const makeCampPresetModeData = (groups: string[][], groupCount: 6 | 8, locationInfo: LocationInfo): ClassConfig[TimeMode] => ({
  ...makeEmptyModeDataForLayout('camp'),
  groups: deepCopy(groups),
  groupOrder: getDefaultGroupOrder('camp', groupCount),
  groupLabels: getDefaultGroupLabels('camp', groupCount),
  locationInfo,
});

const hasChineseCharacters = (value: string): boolean => /[\u3400-\u9fff]/.test(value);

const campPresetModeNeedsRefresh = (mode: ClassConfig[TimeMode] | null | undefined, groupCount: 6 | 8): boolean => {
  if (!mode || mode.layout !== 'camp') {
    return true;
  }
  const groups = mode.groups || [];
  if (getCampGroupCountFromGroups(groups) !== groupCount || groups.length !== groupCount) {
    return true;
  }
  if (groups.some((group) => group.length !== CAMP_GROUP_SIZE)) {
    return true;
  }
  return groups.flat().some((name) => hasChineseCharacters(name));
};

const campPresetStudentNames = (roster: CampPresetRoster): string[] => {
  return roster.students.map(formatCampPresetStudentName);
};

const campPresetModeRosterMismatch = (
  mode: ClassConfig[TimeMode] | null | undefined,
  rosterNames: string[],
): boolean => {
  if (!mode) {
    return true;
  }
  const currentStudents = collectStudentsFromModeData(mode);
  if (currentStudents.length === 0) {
    return true;
  }
  const { missing, extra } = computeRosterDiff(rosterNames, currentStudents);
  return missing.length > 0 || extra.length > 0;
};

const applyCampPresetRoster = (
  roster: CampPresetRoster,
  groupCount: 6 | 8,
  options: { confirmOverwrite?: boolean; showAlert?: boolean; openEditor?: boolean } = {},
): boolean => {
  try {
    const groups = buildBalancedCampPresetGroups(roster.students, groupCount);
    const className = campPresetClassName(roster);
    const previousConfig = state.classData[className];
    const rosterNames = campPresetStudentNames(roster);
    const currentCount = state.classData[className]
      ? countStudentsInMode(state.classData[className].weekday) + countStudentsInMode(state.classData[className].weekend)
      : 0;

    const needsShapeRefresh = campPresetModeNeedsRefresh(previousConfig?.weekday, groupCount)
      || campPresetModeNeedsRefresh(previousConfig?.weekend, groupCount);
    const needsRosterRefresh = previousConfig
      ? campPresetModeRosterMismatch(previousConfig.weekday, rosterNames)
        || campPresetModeRosterMismatch(previousConfig.weekend, rosterNames)
      : true;

    if (shouldPreserveExistingCampPresetSeating(currentCount, options.confirmOverwrite, needsShapeRefresh)) {
      if (state.classData[className]) {
        const preservedMode = needsRosterRefresh
          ? primarySavedModeForSummerCampClass(className, rosterNames)
          : null;
        const preservedNames = preservedMode
          ? collectStudentsFromModeData(preservedMode)
          : rosterNames;
        if (preservedNames.length > 0) {
          if (preservedMode) {
            state.classData[className].weekday = deepCopy(preservedMode);
            state.classData[className].weekend = deepCopy(preservedMode);
          }
          state.classData[className].rosterMirror = needsRosterRefresh
            ? buildSummerCampRosterMirror(preservedNames)
            : roster.students.map((student) => ({
                id: student.id,
                studentId: student.id,
                chineseName: student.chineseName,
                englishName: student.englishName,
              }));
          saveKnownRosterForClass(className, preservedNames, {
            preserveDuplicates: true,
          });
          persist();
        }
      }
      updateClassSelect();
      syncClassPickerValues(className);
      if (options.openEditor !== false) {
        openClassInEditor(className);
      }
      updateCampPresetSwitchUi();
      return true;
    }

    if (currentCount > 0 && options.confirmOverwrite !== false) {
      const ok = window.confirm(`${className} 已经有座位数据。是否用这份飞书名单重新生成预排座位表？`);
      if (!ok) {
        return false;
      }
    }

    ensureClassShell(className, 'camp');
    const weekdayLocation = campPresetDefaultLocationInfo(roster, previousConfig?.weekday.locationInfo);
    const weekendLocation = campPresetDefaultLocationInfo(roster, previousConfig?.weekend.locationInfo);
    state.classData[className].weekday = makeCampPresetModeData(groups, groupCount, weekdayLocation);
    state.classData[className].weekend = makeCampPresetModeData(groups, groupCount, weekendLocation);
    state.classData[className].cnf = null;
    state.classData[className].rosterMirror = roster.students.map((student) => ({
      id: student.id,
      studentId: student.id,
      chineseName: student.chineseName,
      englishName: student.englishName,
    }));
    saveKnownRosterForClass(className, rosterNames, {
      preserveDuplicates: true,
    });
    persist();
    updateClassSelect();
    hideCampPresetDialog();
    if (options.openEditor !== false) {
      openClassInEditor(className);
    }
    updateCampPresetSwitchUi();
    if (options.showAlert !== false) {
      alert(`已生成 ${className} 预排座位表：${roster.students.length} 人，${groupCount} 组。`);
    }
    return true;
  } catch (error) {
    byId<HTMLDivElement>('campPresetSummary').innerHTML += `<div class="camp-preset-error">${escapeHtml(error instanceof Error ? error.message : '预排失败')}</div>`;
    return false;
  }
};

const applyCampPresetSeating = (): void => {
  const roster = selectedCampPresetRoster();
  if (!roster) {
    alert('还没有可用的预设营名单。');
    return;
  }

  const groupCount = Number.parseInt(byId<HTMLSelectElement>('campPresetGroupCount').value, 10) as 6 | 8;
  const ok = applyCampPresetRoster(roster, groupCount);
  if (ok && isSummerCampMode()) {
    applySummerCampDateToClass(
      campPresetClassName(roster),
      summerCampDateSelect()?.value || defaultSummerCampDateKey(),
      campNumberFromText(roster.camp),
    );
    loadClass();
    syncSummerCampPickerFromActiveClass();
  }
};

const ensureDefaultCampPresetSeating = (): void => {
  const firstRoster = CAMP_PRESET_ROSTERS[0];
  if (!firstRoster) {
    return;
  }
  applyCampPresetRoster(firstRoster, 6, {
    confirmOverwrite: false,
    showAlert: false,
    openEditor: true,
  });
};

const normalizeSummerCampMinor = (value?: string): string => {
  if (value && CAMP_MINOR_OPTIONS.includes(value)) {
    return value;
  }
  const campNo = value ? campNumberFromText(value) : '';
  return campNo ? `Camp ${campNo}` : CAMP_MINOR_OPTIONS[0] || 'Camp 1';
};

const SUMMER_CAMP_PHASE2_AUTO_LAUNCH_KEY = 'superamberSummerCampPhase2AutoLaunch202608';
const SUMMER_CAMP_PHASE2_DEFAULT_CLASS = 'L2第二期-营1';

const hasAppliedSummerCampPhase2AutoLaunch = (): boolean => {
  try {
    return window.localStorage.getItem(SUMMER_CAMP_PHASE2_AUTO_LAUNCH_KEY) === 'done';
  } catch {
    return false;
  }
};

const markSummerCampPhase2AutoLaunchApplied = (): void => {
  try {
    window.localStorage.setItem(SUMMER_CAMP_PHASE2_AUTO_LAUNCH_KEY, 'done');
  } catch {
    // Ignore storage failures; the launch itself should still work.
  }
};

const resolveSummerCampLaunchClass = (
  major: CampMajorLevel,
  minorValue: string,
  dateKey: string,
): { className: string; minorForPreference: string } => {
  const presetRosters = campPresetRostersForMajor(major, dateKey);
  if (presetRosters.length > 0) {
    const roster = findCampPresetRoster(minorValue) || presetRosters[0];
    if (roster) {
      return {
        className: campPresetClassName(roster),
        minorForPreference: normalizeSummerCampMinor(roster.camp),
      };
    }
  }

  const minorForPreference = normalizeSummerCampMinor(minorValue);
  return {
    className: summerCampClassName(major, minorForPreference, dateKey),
    minorForPreference,
  };
};

const getStoredSummerCampDateForClass = (className: string): string => {
  const config = state.classData[className];
  if (!config) {
    return '';
  }
  return getModeDateKey(config.weekday) || getModeDateKey(config.weekend) || '';
};

const ensurePreferredSummerCampSeating = (): void => {
  if (!isSummerCampMode()) {
    return;
  }

  const now = new Date();
  const preference = loadSummerCampLaunchPreference();
  const shouldAutoLaunchPhase2 = Boolean(
    state.classData[SUMMER_CAMP_PHASE2_DEFAULT_CLASS]
    && !hasAppliedSummerCampPhase2AutoLaunch()
    && (!preference?.reportDate || campPhaseIndexFromDate(preference.reportDate) !== 2),
  );
  const major = isCampMajorLevel(preference?.majorCamp || '')
    ? preference!.majorCamp as CampMajorLevel
    : SUMMER_CAMP_DEFAULT_MAJOR;
  const minor = normalizeSummerCampMinor(preference?.minorCamp);
  const operationalDate = getCurrentCampReportDate(now);

  populateSummerCampPicker();
  const majorSelect = summerCampMajorSelect();
  const minorSelect = summerCampMinorSelect();
  const dateSelect = summerCampDateSelect();
  if (majorSelect) {
    majorSelect.value = major;
  }
  if (dateSelect) {
    dateSelect.value = summerCampDateOptions().some((item) => item.date === operationalDate)
      ? operationalDate
      : defaultSummerCampDateKey();
  }
  if (shouldAutoLaunchPhase2) {
    const config = state.classData[SUMMER_CAMP_PHASE2_DEFAULT_CLASS];
    const restoredDate = getModeDateKey(config.weekday)
      || getModeDateKey(config.weekend)
      || defaultSummerCampDateKey();
    saveSummerCampLaunchPreference({
      majorCamp: 'L2',
      minorCamp: 'Camp 1',
      reportDate: restoredDate,
      lastTool: 'seating',
    });
    markSummerCampPhase2AutoLaunchApplied();
    if (majorSelect) {
      majorSelect.value = 'L2';
    }
    if (dateSelect && summerCampDateOptions().some((item) => item.date === restoredDate)) {
      dateSelect.value = restoredDate;
    }
    updateSummerCampMinorOptions('Camp 1', restoredDate);
    openClassInEditor(SUMMER_CAMP_PHASE2_DEFAULT_CLASS);
    syncSummerCampPickerFromActiveClass();
    return;
  }
  updateSummerCampMinorOptions(minor, dateSelect?.value || operationalDate);
  const lockedPreferenceClass = Array.from(serverLockedRestoreClasses)
    .find((className) => campNumberFromText(className) === campNumberFromText(minor) && state.classData[className]);
  if (lockedPreferenceClass) {
    const lockedCampNo = campNumberFromText(lockedPreferenceClass);
    const config = state.classData[lockedPreferenceClass];
    const restoredDate = getModeDateKey(config.weekday)
      || getModeDateKey(config.weekend)
      || preference?.reportDate
      || defaultSummerCampDateKey();
    saveSummerCampLaunchPreference({
      majorCamp: 'L2',
      minorCamp: `Camp ${lockedCampNo}`,
      reportDate: restoredDate,
      lastTool: 'seating',
    });
    if (majorSelect) {
      majorSelect.value = 'L2';
    }
    if (dateSelect && summerCampDateOptions().some((item) => item.date === restoredDate)) {
      dateSelect.value = restoredDate;
    }
    updateSummerCampMinorOptions(`Camp ${lockedCampNo}`, restoredDate);
    openClassInEditor(lockedPreferenceClass);
    syncSummerCampPickerFromActiveClass();
    return;
  }
  const currentMinorValue = minorSelect?.value || minor;
  const { className, minorForPreference } = resolveSummerCampLaunchClass(
    major,
    currentMinorValue,
    dateSelect?.value || operationalDate,
  );
  const resolvedStoredDate = getStoredSummerCampDateForClass(className);
  const preferredDate = preference?.reportDate && summerCampDateOptions().some((item) => item.date === preference.reportDate)
    ? preference.reportDate
    : '';
  // Entry restores the locally selected date; time passing never moves seats.
  const dateKey = resolvedStoredDate || preferredDate || defaultSummerCampDateKey();

  if (dateSelect) {
    dateSelect.value = summerCampDateOptions().some((item) => item.date === dateKey)
      ? dateKey
      : defaultSummerCampDateKey();
  }
  updateSummerCampMinorOptions(minorForPreference, dateSelect?.value || dateKey);

  runWithoutRemoteBackup(() => {
    applySummerCampSelection();
  });


};

const rotateSingleClassMode = (mode: ClassConfig[TimeMode], rotateDate: boolean): ClassConfig[TimeMode] => {
  const nextLocationInfo = rotateDate
    ? isSummerCampMode()
      ? rotateSummerCampLocationInfoByDay(mode.locationInfo)
      : rotateLocationInfoByWeek(sanitizeLocationInfo(mode.locationInfo))
    : sanitizeLocationInfo(mode.locationInfo);
  return rotateTimeModeData(mode, nextLocationInfo);
};


const generateSeating = (): void => {
  if (state.isEditMode) {
    refresh();
    return;
  }

  if (isSummerCampMode() && activeClassName.trim()) {
    saveCurrentClassMode();
    const currentConfig = state.classData[activeClassName.trim()];
    if (currentConfig) {
      currentConfig.previousWeek = snapshotFromConfig(currentConfig);
    }
  }

  const currentMode = captureCurrentModeData();
  const nextLocationInfo = isSummerCampMode()
    ? rotateSummerCampLocationInfoByDay(currentMode.locationInfo)
    : currentMode.locationInfo;
  const rotated = rotateTimeModeData(currentMode, nextLocationInfo);

  state.currentLayout = rotated.layout;
  state.groups = deepCopy(rotated.groups || makeEmptyCircularGroups());
  state.rowGroups = deepCopy(rotated.rowGroups || makeEmptyRowGroups());
  state.fourGroups = deepCopy(rotated.fourGroups || makeEmptyFourGroups());
  state.currentGroupOrder = [...(rotated.groupOrder || getDefaultGroupOrder(rotated.layout))];
  state.currentGroupLabels = [...(rotated.groupLabels || getDefaultGroupLabels(rotated.layout))];
  state.rotationConfig = rotated.rotationConfig
    ? { ...rotated.rotationConfig }
    : defaultRotationConfig(rotated.layout);
  state.currentArrangement = rotated.currentArrangement;
  setLocationInfo(rotated.locationInfo);
  refresh();
  saveCurrentClassMode('已自动保存', { identityOverride: rotated.layoutIdentity });
  syncSummerCampPickerFromActiveClass();
};

const generateWeeklySeating = (): void => {
  const undoAvailable = saveBatchUndoData(deepCopy(state.classData));
  state.classData = buildWeeklyRotatedClassData(state.classData, {
    snapshotFromConfig,
    rotateSingleClassMode,
  });

  persist();
  updateWelcome();
  renderClassOverview();

  if (state.currentView === 'editor' && classSelect().value) {
    loadClass();
  }

  const successMessage = isSummerCampMode()
    ? '已生成下一上课日座位表，所有营已完成轮转并保存。'
    : '已生成新一周座位表，所有班级已完成轮转并保存。';
  const noUndoMessage = isSummerCampMode()
    ? '已生成下一上课日座位表，所有营已完成轮转并保存，但没有保留撤回记录。'
    : '已生成新一周座位表，所有班级已完成轮转并保存，但没有保留撤回记录。';
  alert(undoAvailable ? successMessage : noUndoMessage);
};

const undoWeeklySeating = (): void => {
  const snapshot = loadBatchUndoData();
  if (!snapshot) {
    alert(isSummerCampMode() ? '当前没有可撤回的日轮转记录。' : '当前没有可撤回的周轮转记录。');
    return;
  }

  state.classData = sanitizeClassDataMap(snapshot);
  clearBatchUndoData();
  persist();
  updateClassSelect();
  renderClassOverview();

  if (state.currentView === 'editor' && classSelect().value) {
    loadClass();
  }

  alert(isSummerCampMode() ? '已撤回上次主页日轮转。' : '已撤回上次主页周轮转。');
};

const currentStudentList = (): string[] => {
  return collectStudentsFromCurrentLayout();
};

const sortStudentNames = (students: string[]): string[] =>
  [...normalizeStudentList(students)].sort((left, right) =>
    left.localeCompare(right, 'en', { sensitivity: 'base', numeric: true })
  );

const showPreviousWeekDialog = (): void => {
  const className = classSelect().value.trim();
  if (!className) {
    alert('请先选择班级。');
    return;
  }

  const previousWeek = state.classData[className]?.previousWeek;
  if (!previousWeek) {
    alert(isSummerCampMode() ? '这个营还没有上一天记录。' : '这个班级还没有上一周记录。');
    return;
  }

  const previousLabel = isSummerCampMode() ? '上一天' : '上一周';
  const currentModeLabel = modeLabel(state.currentTimeMode);
  const previewContainer = byId<HTMLDivElement>('previousWeekPreview');
  const summary = byId<HTMLParagraphElement>('previousWeekSummary');
  const title = queryOne<HTMLHeadingElement>('#previousWeekDialog h2');
  const confirm = queryOne<HTMLButtonElement>('#previousWeekDialog .confirm');
  if (title) {
    title.textContent = `查看${previousLabel}座位`;
  }
  if (confirm) {
    confirm.textContent = `恢复为${previousLabel}版本`;
  }
  previewContainer.className = `previous-week-preview ${previousWeek[state.currentTimeMode].layout === 'rows' ? 'three-rows-layout' : previousWeek[state.currentTimeMode].layout === 'four' ? 'four-layout' : previousWeek[state.currentTimeMode].layout === 'camp' ? 'camp-layout' : 'classroom'}`;
  summary.textContent = `${className} · ${currentModeLabel} · 预览${previousLabel}座位。恢复后会把当前版本保留为新的“${previousLabel}”记录。`;
  renderModePreview(previewContainer, previousWeek[state.currentTimeMode]);
  showDialog('previousWeekDialog');
};

const hidePreviousWeekDialog = (): void => {
  hideDialog('previousWeekDialog');
};

const restorePreviousWeek = (): void => {
  const className = classSelect().value.trim();
  if (!className) {
    return;
  }

  const restoredConfig = restorePreviousWeekConfig(state.classData[className], {
    snapshotFromConfig,
    sanitizeClassSnapshot,
  });
  if (!restoredConfig) {
    alert(isSummerCampMode() ? '没有可恢复的上一天记录。' : '没有可恢复的上一周记录。');
    return;
  }

  state.classData[className] = restoredConfig;
  persist();
  loadClass();
  renderClassOverview();
  hidePreviousWeekDialog();
  alert(isSummerCampMode() ? '已恢复为上一天版本。' : '已恢复为上周版本。');
};

const showRosterDialog = (): void => {
  const className = classSelect().value.trim();
  if (!className) {
    alert('请先选择班级。');
    return;
  }

  const students = sortStudentNames(currentStudentList());
  const summary = byId<HTMLParagraphElement>('rosterSummary');
  const rosterList = byId<HTMLDivElement>('rosterList');
  const currentModeLabel = modeLabel(state.currentTimeMode);

  summary.textContent = `${className} · ${currentModeLabel} · 当前总人数 ${students.length} 人`;
  rosterList.innerHTML = students.length
    ? students.map((student, index) => `<div class="roster-item"><span>${index + 1}.</span><strong>${escapeHtml(student)}</strong><button type="button" class="roster-delete-btn" data-delete-student="${escapeHtml(student)}" title="删除该学生">&times;</button></div>`).join('')
    : '<div class="muted">当前没有学生名单。</div>';
  showDialog('rosterDialog');
};

const removeStudentFromSeats = (name: string): void => {
  const className = classSelect().value.trim();
  if (!className || !state.classData[className]) {
    return;
  }
  const mode = state.classData[className][state.currentTimeMode];
  if (!mode) {
    return;
  }

  if (mode.groups) {
    for (const group of mode.groups) {
      for (let i = 0; i < group.length; i++) {
        if (group[i] === name) {
          group[i] = '';
        }
      }
    }
    state.groups = deepCopy(mode.groups);
  }
  if (mode.rowGroups) {
    for (const row of mode.rowGroups.rows) {
      for (let i = 0; i < row.left.length; i++) {
        if (row.left[i] === name) {
          row.left[i] = '';
        }
      }
      for (let i = 0; i < row.right.length; i++) {
        if (row.right[i] === name) {
          row.right[i] = '';
        }
      }
    }
    state.rowGroups = deepCopy(mode.rowGroups);
  }
  if (mode.fourGroups) {
    for (const group of mode.fourGroups.groups) {
      for (let i = 0; i < group.length; i++) {
        if (group[i] === name) {
          group[i] = '';
        }
      }
    }
    state.fourGroups = deepCopy(mode.fourGroups);
  }
  persist();
  renderClassOverview();
  showRosterDialog();
};

const hideRosterDialog = (): void => {
  hideDialog('rosterDialog');
};

const toggleEditMode = (): void => {
  state.isEditMode = !state.isEditMode;
  const button = queryOne<HTMLButtonElement>('.edit-mode button');
  if (button) {
    button.textContent = state.isEditMode ? '退出编辑' : '编辑模式';
    button.style.background = state.isEditMode ? '#f44336' : '#2196F3';
  }
  refresh();
};

const modeFromManualTuneDraft = (draft: ManualTuneDraft): ClassConfig[TimeMode] => ({
  layout: draft.layout,
  groups: draft.layout === 'circular' || draft.layout === 'camp' ? deepCopy(draft.groups) : null,
  groupOrder: draft.groupOrder ? [...draft.groupOrder] : getDefaultGroupOrder(draft.layout, draft.layout === 'camp' ? draft.groupCount : 6),
  groupLabels: draft.groupLabels ? [...draft.groupLabels] : getDefaultGroupLabels(draft.layout, draft.layout === 'camp' ? draft.groupCount : 6),
  rowGroups: draft.layout === 'rows' ? deepCopy(draft.rowGroups) : null,
  fourGroups: draft.layout === 'four' ? deepCopy(draft.fourGroups) : null,
  currentArrangement: draft.currentArrangement || 0,
  locationInfo: getLocationInfo(),
  rotationConfig: draft.rotationConfig ? { ...draft.rotationConfig } : defaultRotationConfig(draft.layout),
  layoutIdentity: draft.layoutIdentity ? deepCopy(draft.layoutIdentity) : null,
});

const defaultPreviewGroupCount = (layout: LayoutType, studentCount: number, currentDraft?: ManualTuneDraft): number => {
  const savedCount = currentDraft?.layoutIdentity?.snapshots?.[layout]?.groupCount;
  if (savedCount) return savedCount;
  if ((layout === 'circular' || layout === 'rows')
    && currentDraft
    && (currentDraft.layout === 'circular' || currentDraft.layout === 'rows')
    && currentDraft.groupCount >= 1
    && currentDraft.groupCount <= 6) {
    return currentDraft.groupCount;
  }
  if (layout === 'circular') return Math.max(1, getCircularGroupCount(studentCount));
  if (layout === 'rows') return Math.max(1, getRowGroupCount(studentCount));
  if (layout === 'four') return 4;
  return 6;
};

const toggleLayout = (): void => {
  const currentStudents = collectStudentsFromCurrentLayout();
  const currentMode = captureCurrentModeData();
  const identity = captureLayoutIdentity(currentMode, currentMode.layoutIdentity);
  currentMode.layoutIdentity = identity;
  const groupCount = getLayoutGroupCount(currentMode);
  const draft: ManualTuneDraft = {
    layout: state.currentLayout,
    groups: deepCopy(state.groups),
    rowGroups: deepCopy(state.rowGroups),
    fourGroups: deepCopy(state.fourGroups),
    groupCount,
    selectedSeatKey: null,
    editingSeatKey: null,
    isDirty: false,
    sourceLayout: state.currentLayout,
    baselineStudents: [...currentStudents],
    requiresBalancedGroups: false,
    resetGroupMeta: false,
    studentSetEdited: false,
    layoutIdentity: identity,
    restoredLayoutSnapshot: true,
    groupOrder: [...state.currentGroupOrder],
    groupLabels: [...state.currentGroupLabels],
    rotationConfig: { ...state.rotationConfig },
    currentArrangement: state.currentArrangement,
  };
  const order = availableLayoutOrder();
  if (order.length <= 1) return;
  manualTuneDraft = draft;
  previewManualLayout(order[(order.indexOf(state.currentLayout) + 1) % order.length]);
  if (!byId<HTMLDivElement>('manualTuneError').textContent) applyManualTune();
  if (manualTuneDraft) showDialog('manualTuneDialog');
};

const previewManualLayout = (layout: LayoutType): void => {
  if (!manualTuneDraft) return;
  const students = collectManualDraftStudents(manualTuneDraft);
  if (students.length > layoutMaxStudents(layout)) {
    byId<HTMLDivElement>('manualTuneError').textContent = `当前人数超出${layoutLabel(layout)}上限`;
    return;
  }

  try {
    const groupCount = defaultPreviewGroupCount(layout, students.length, manualTuneDraft);
    const result = previewLayoutWithIdentity(modeFromManualTuneDraft(manualTuneDraft), layout, groupCount);
    manualTuneDraft.layout = layout;
    manualTuneDraft.groups = deepCopy(result.mode.groups || makeEmptyCircularGroups());
    manualTuneDraft.rowGroups = deepCopy(result.mode.rowGroups || makeEmptyRowGroups());
    manualTuneDraft.fourGroups = deepCopy(result.mode.fourGroups || makeEmptyFourGroups());
    manualTuneDraft.groupCount = getLayoutGroupCount(result.mode);
    manualTuneDraft.layoutIdentity = result.identity;
    manualTuneDraft.restoredLayoutSnapshot = result.restoredSnapshot;
    manualTuneDraft.groupOrder = result.mode.groupOrder ? [...result.mode.groupOrder] : null;
    manualTuneDraft.groupLabels = result.mode.groupLabels ? [...result.mode.groupLabels] : null;
    manualTuneDraft.rotationConfig = result.mode.rotationConfig ? { ...result.mode.rotationConfig } : null;
    manualTuneDraft.currentArrangement = result.mode.currentArrangement;
    manualTuneDraft.requiresBalancedGroups = !result.restoredSnapshot;
    manualTuneDraft.resetGroupMeta = false;
    manualTuneDraft.selectedSeatKey = null;
    manualTuneDraft.editingSeatKey = null;
    manualTuneDraft.isDirty = layout !== manualTuneDraft.sourceLayout;
    byId<HTMLDivElement>('manualTuneError').textContent = '';
    renderManualTuneEditor();
  } catch (error) {
    byId<HTMLDivElement>('manualTuneError').textContent = error instanceof Error ? error.message : '布局预览失败';
  }
};

const updateLayoutDescription = (): void => {
  const layoutDesc = byId<HTMLDivElement>('layoutDescription');
  if (byId<HTMLInputElement>('circularLayout').checked) {
    layoutDesc.innerHTML = `
      <ul style="font-size: 14px; color: #666; margin: 10px 0;">
        <li>圆桌：默认36人以内保持标准密度；37-45人自动扩为6组、每组最多8人</li>
        <li>展示时隐藏空座，编辑时保留座位槽；轮转自动跳过空组</li>
      </ul>
    `;
    return;
  }

  if (byId<HTMLInputElement>('rowsLayout').checked) {
    layoutDesc.innerHTML = `
      <ul style="font-size: 14px; color: #666; margin: 10px 0;">
        <li>三横排：默认36人以内保持标准密度；37-45人自动扩为6组、每组最多8人</li>
        <li>展示时隐藏空座，轮转按组号+2并跳过空组</li>
      </ul>
    `;
    return;
  }

  if (byId<HTMLInputElement>('fourLayout').checked) {
    layoutDesc.innerHTML = `
      <ul style="font-size: 14px; color: #666; margin: 10px 0;">
        <li>四大组：默认4组；36人以内每组9人，37-45人每组最多12人</li>
        <li>手动微调可切成3组，仍受所有布局总上限45人约束</li>
      </ul>
    `;
    return;
  }

  if (byId<HTMLInputElement>('campLayout').checked) {
    layoutDesc.innerHTML = `
      <ul style="font-size: 14px; color: #666; margin: 10px 0;">
        <li>夏令营：可选6组或8组，所有布局统一总上限45人</li>
        <li>轮转按下一上课日推进，周日不上课；组内和组间规则仍可调整</li>
      </ul>
    `;
  }
};

const showCreateClassDialog = (): void => {
  if (isSummerCampMode()) {
    ensureDefaultCampPresetSeating();
    syncSummerCampPickerFromActiveClass();
    return;
  }
  showDialog('createClassDialog');
};

const hideCreateClassDialog = (): void => {
  hideDialog('createClassDialog');
};

const parseGroupsText = (layout: LayoutType, text: string): string[][] => {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const groups = Array.from({ length: layout === 'camp' ? 8 : 6 }, () => [] as string[]);
  const maxGroups = layout === 'four' ? 4 : layout === 'camp' ? 8 : 6;
  const maxSeats = layout === 'four' ? 12 : layout === 'camp' ? CAMP_GROUP_SIZE : 8;
  lines.forEach((line, lineIndex) => {
    const match = line.match(/Group\s*(\d+)\s*:/i);
    if (match) {
      const groupIndex = Math.max(0, Math.min(maxGroups - 1, Number.parseInt(match[1], 10) - 1));
      const body = line.substring(line.indexOf(':') + 1).trim();
      if (body.includes('|')) {
        const seats = body
          .split('|')
          .flatMap((row) =>
            row
              .split(/[,，]/)
              .map((name) => name.trim())
              .map((name) => (name === '_' ? '' : name))
          )
          .slice(0, maxSeats);
        groups[groupIndex] = [...seats, ...Array(Math.max(0, maxSeats - seats.length)).fill('')].slice(0, maxSeats);
        return;
      }

      groups[groupIndex] = line
        .substring(line.indexOf(':') + 1)
        .split(/[,，]/)
        .map((name) => name.trim())
        .filter(Boolean)
        .slice(0, maxSeats);
      return;
    }

    if (lineIndex < maxGroups) {
      groups[lineIndex] = line
        .split(/[,，]/)
        .map((name) => name.trim())
        .filter(Boolean)
        .slice(0, maxSeats);
    }
  });

  return groups.slice(0, maxGroups);
};

const renderOcrReview = (): void => {
  const container = byId<HTMLDivElement>('ocrReviewList');
  if (ocrDrafts.length === 0) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = ocrDrafts
    .map((draft) => buildOcrReviewCardHtml(draft, escapeHtml))
    .join('');
};

const updateOcrProviderFields = (): void => {
  const engine = byId<HTMLSelectElement>('ocrEngine').value;
  const config = byId<HTMLDivElement>('ocrCloudConfig');
  config.classList.toggle('hidden', engine === 'local');
};

const setOcrEngineStatus = (message: string, type: 'error' | 'success' | 'muted' = 'muted'): void => {
  const status = byId<HTMLDivElement>('ocrEngineStatus');
  status.classList.remove('error', 'success', 'muted');
  status.classList.add(type);
  status.textContent = message;
};

const syncOcrSettingsToForm = (): void => {
  byId<HTMLSelectElement>('ocrEngine').value = ocrSettings.engine;
  byId<HTMLInputElement>('allowLocalFallback').checked = ocrSettings.allowLocalFallback;
  byId<HTMLInputElement>('tencentEndpoint').value = ocrSettings.tencentEndpoint;
  byId<HTMLInputElement>('tencentRegion').value = ocrSettings.tencentRegion;
  byId<HTMLSelectElement>('tencentAction').value = ocrSettings.tencentAction;
  updateOcrProviderFields();
};

const readOcrSettingsFromForm = (): OCRSettings => {
  const engine = byId<HTMLSelectElement>('ocrEngine').value as OCRSettings['engine'];
  const settings: OCRSettings = {
    engine: engine === 'local' || engine === 'tencent' || engine === 'hybrid' ? engine : 'hybrid',
    allowLocalFallback: byId<HTMLInputElement>('allowLocalFallback').checked,
    tencentEndpoint: byId<HTMLInputElement>('tencentEndpoint').value.trim().replace(/\/$/, '') || getDefaultOCREndpoint(),
    tencentRegion: byId<HTMLInputElement>('tencentRegion').value.trim() || 'ap-guangzhou',
    tencentAction: byId<HTMLSelectElement>('tencentAction').value as OCRSettings['tencentAction']
  };

  if (
    settings.tencentAction !== 'Auto' &&
    settings.tencentAction !== 'ExtractDocMulti' &&
    settings.tencentAction !== 'GeneralAccurateOCR' &&
    settings.tencentAction !== 'GeneralBasicOCR'
  ) {
    settings.tencentAction = 'Auto';
  }

  ocrSettings = settings;
  saveOCRSettings(settings);
  return settings;
};

const checkOCRChannel = async (): Promise<void> => {
  readOcrSettingsFromForm();
  setOcrEngineStatus('图片导入暂不开放。请改用文字导入、预设营号或手动微调。', 'error');
};

const showImageImportDialog = (): void => {
  hideCreateClassDialog();
  syncOcrSettingsToForm();
  setOcrEngineStatus('图片导入暂不开放。请改用文字导入、预设营号或手动微调。', 'error');
  byId<HTMLDivElement>('ocrProgress').textContent = '';
  byId<HTMLInputElement>('imageFiles').value = '';
  ocrDrafts = [];
  renderOcrReview();
  showDialog('imageImportDialog');
};

const hideImageImportDialog = (): void => {
  hideDialog('imageImportDialog');
};

const startImageRecognition = async (): Promise<void> => {
  const progress = byId<HTMLDivElement>('ocrProgress');
  readOcrSettingsFromForm();
  ocrDrafts = [];
  renderOcrReview();
  isOcrRecognitionRunning = false;
  progress.textContent = '图片导入暂不开放。请改用文字导入、预设营号或手动微调。';
};

const confirmImageImport = (): void => {
  alert('图片导入暂不开放。请改用文字导入、预设营号或手动微调。');
};

const currentGroupCountForLayout = (): number =>
  state.currentLayout === 'circular'
    ? Math.max(1, getCircularGroupCountFromGroups(state.groups))
    : state.currentLayout === 'rows'
      ? Math.max(1, getRowsGroupCountFromGroups(state.rowGroups))
      : state.currentLayout === 'four'
        ? Math.max(3, getFourGroupCountFromGroups(state.fourGroups) || 4)
        : state.currentLayout === 'camp'
          ? getCampGroupCountFromGroups(state.groups)
          : 4;

const updateManualTuneStatus = (): void => {
  const status = byId<HTMLDivElement>('manualTuneStatus');
  if (!manualTuneDraft) {
    status.textContent = '当前修改仅在预览中，记得保存后才会正式生效。';
    status.classList.remove('is-selected', 'is-dirty', 'is-saved');
    return;
  }

  const draft = manualTuneDraft;
  const memoryHint = draft.restoredLayoutSnapshot && draft.sourceLayout !== draft.layout
    ? '已恢复这个布局上次保存的座位编号。'
    : draft.sourceLayout !== draft.layout
      ? '首次进入这个布局，已按稳定组编号生成座位。'
      : '';
  const saveHint = draft.isDirty
    ? '未保存：当前修改仅在预览中，点“保存微调”后才会正式生效。'
    : '已保存状态：现在看到的是当前草稿，继续改动后记得点“保存微调”。';

  if (!draft.selectedSeatKey) {
    status.textContent = `${saveHint}${memoryHint ? ` ${memoryHint}` : ''} 单击两个座位可交换，双击座位可直接编辑名字。`;
    status.classList.remove('is-selected');
    status.classList.toggle('is-dirty', draft.isDirty);
    status.classList.toggle('is-saved', !draft.isDirty);
    return;
  }

  const seat = findManualSeat(draft, draft.selectedSeatKey);
  status.textContent = seat
    ? `${saveHint}${memoryHint ? ` ${memoryHint}` : ''} 已选中 ${manualSeatSummary(seat)}，现在再点一个目标座位完成互换。`
    : `${saveHint}${memoryHint ? ` ${memoryHint}` : ''} 单击两个座位可交换，双击座位可直接编辑名字。`;
  status.classList.toggle('is-selected', Boolean(seat));
  status.classList.toggle('is-dirty', draft.isDirty);
  status.classList.toggle('is-saved', !draft.isDirty);
};

const markManualTuneDirty = (): void => {
  if (!manualTuneDraft) {
    return;
  }

  manualTuneDraft.isDirty = true;
  updateManualTuneStatus();
};

const renderManualTuneEditor = (): void => {
  const container = byId<HTMLDivElement>('manualSeatEditor');
  if (!manualTuneDraft) {
    container.innerHTML = '';
    return;
  }
  const draft = manualTuneDraft;
  byId<HTMLDivElement>('manualLayoutPicker').querySelectorAll<HTMLButtonElement>('[data-layout-preview]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.layoutPreview === draft.layout);
  });
  const groupCountInput = byId<HTMLInputElement>('manualGroupCount');
  groupCountInput.value = String(draft.groupCount);
  groupCountInput.min = draft.layout === 'four' ? '3' : draft.layout === 'camp' ? '6' : '1';
  groupCountInput.max = draft.layout === 'four' ? '4' : draft.layout === 'camp' ? '8' : '6';
  groupCountInput.step = draft.layout === 'camp' ? '2' : '1';
  const heading = byId<HTMLDivElement>('manualTuneDialog').querySelector<HTMLHeadingElement>('h2');
  if (heading) heading.textContent = `手动微调 · ${layoutLabel(draft.layout)}`;
  const focusEditingSeat = (): void => {
    if (!draft.editingSeatKey) {
      return;
    }

    window.requestAnimationFrame(() => {
      const input = container.querySelector<HTMLInputElement>(`input[data-seat-input="${draft.editingSeatKey}"]`);
      input?.focus();
      input?.select();
    });
  };

  const renderSeat = (seat: ManualSeatRef, label: string): string => `
    <div class="seat manual-seat${draft.selectedSeatKey === seat.key ? ' selected' : ''}${draft.editingSeatKey === seat.key ? ' editing' : ''}" data-seat-key="${seat.key}">
      <span class="manual-seat-label">${escapeHtml(label)}</span>
      <button type="button" class="manual-seat-clear" data-clear-key="${seat.key}" title="清空此座位">&times;</button>
      <input data-seat-input="${seat.key}" value="${escapeHtml(getManualSeatValue(draft, seat))}" />
    </div>
  `;

  if (draft.layout === 'circular') {
    const activeGroupCount = getCircularVisibleGroupCountFromGroups(draft.groups);
    const slotMap = getCircularSlotMap(activeGroupCount);
    container.innerHTML = `
      <div class="manual-layout classroom">
        ${Array.from({ length: 6 }, (_, slotIndex) => {
          const logicalGroupIndex = slotMap[slotIndex];
          if (logicalGroupIndex === null) {
            return `
              <div class="table table-empty manual-table-empty">
                <h3>空组</h3>
                <div class="seats seats-empty"></div>
              </div>
            `;
          }
          return `
            <div class="table group-${(logicalGroupIndex % 6) + 1}">
              <h3>${escapeHtml(formatGroupTitle(draft.groupLabels?.[logicalGroupIndex] || `${logicalGroupIndex + 1}`))}</h3>
              <div class="seats">
                ${draft.groups[logicalGroupIndex].map((_, seatIndex) => renderSeat({
                  key: `c-${logicalGroupIndex}-${seatIndex}`,
                  label: `位置 ${seatIndex + 1}`,
                  kind: 'circular',
                  groupIndex: logicalGroupIndex,
                  seatIndex
                }, `${seatIndex + 1}`)).join('')}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
    updateManualTuneStatus();
    focusEditingSeat();
    return;
  }

  if (draft.layout === 'rows') {
    const rows = [
      { leftSlot: 0, rightSlot: 1 },
      { leftSlot: 2, rightSlot: 3 },
      { leftSlot: 4, rightSlot: 5 }
    ];

    container.innerHTML = `
      <div class="manual-layout classroom three-rows-layout">
        ${rows.map((rowMeta, rowIndex) => {
          const renderGroup = (side: 'left' | 'right', title: string, groupIndex: number) => {
            const seats = draft.rowGroups.rows[rowIndex][side];
            const isEmptyGroup = !seats.some((name) => name.trim());
            return `
              <div class="${side === 'left' ? 'group-left' : 'group-right'}${isEmptyGroup ? ' manual-group-empty' : ''}">
                <h3>${escapeHtml(title)}</h3>
                <div class="seats-row">
                  ${seats.map((_, seatIndex) => renderSeat({
                    key: `r-${rowIndex}-${side}-${seatIndex}`,
                    label: `位置 ${seatIndex + 1}`,
                    kind: 'rows',
                    rowIndex,
                    side,
                    seatIndex
                  }, `${seatIndex + 1}`)).join('')}
                </div>
              </div>
            `;
          };
          return `
            <div class="row${rowIndex === 2 && !draft.rowGroups.rows[rowIndex].right.some(name => name.trim()) ? ' single-center' : ''}">
              ${renderGroup('left', formatGroupTitle(draft.groupLabels?.[rowMeta.leftSlot] || `${rowMeta.leftSlot + 1}`), rowMeta.leftSlot)}
              ${renderGroup('right', formatGroupTitle(draft.groupLabels?.[rowMeta.rightSlot] || `${rowMeta.rightSlot + 1}`), rowMeta.rightSlot)}
            </div>
          `;
        }).join('')}
      </div>
    `;
    updateManualTuneStatus();
    focusEditingSeat();
    return;
  }

  if (draft.layout === 'camp') {
    const activeGroupCount = getCampGroupCountFromGroups(draft.groups);
    container.innerHTML = `
      <div class="manual-layout classroom camp-layout" style="--camp-group-count:${activeGroupCount};--camp-grid-columns:${activeGroupCount === 8 ? 4 : 3};">
        ${draft.groups.slice(0, activeGroupCount).map((group, groupIndex) => `
          <div class="camp-group-card group-${(groupIndex % 6) + 1}">
            <h3>${escapeHtml(formatGroupTitle(draft.groupLabels?.[groupIndex] || `${groupIndex + 1}`, 'camp'))}</h3>
            <div class="camp-seats">
              ${group.map((_, seatIndex) => renderSeat({
                key: `camp-${groupIndex}-${seatIndex}`,
                label: `位置 ${seatIndex + 1}`,
                kind: 'camp',
                groupIndex,
                seatIndex
              }, `${seatIndex + 1}`)).join('')}
            </div>
          </div>
        `).join('')}
      </div>
    `;
    updateManualTuneStatus();
    focusEditingSeat();
    return;
  }

  if (draft.layout === 'four') {
    const activeGroupCount = getFourGroupCountFromGroups(draft.fourGroups);
    container.innerHTML = `
      <div class="manual-layout classroom four-layout" style="--four-group-count:${activeGroupCount};">
        ${draft.fourGroups.groups.slice(0, activeGroupCount).map((group, groupIndex) => `
          <div class="four-group-card group-${(groupIndex % 6) + 1}">
            <h3>${escapeHtml(formatGroupTitle(draft.groupLabels?.[groupIndex] || `${groupIndex + 1}`))}</h3>
            <div class="four-seats">
              ${group.map((_, seatIndex) => renderSeat({
                key: `f-${groupIndex}-${seatIndex}`,
                label: `位置 ${seatIndex + 1}`,
                kind: 'four',
                groupIndex,
                seatIndex
              }, `${seatIndex + 1}`)).join('')}
            </div>
          </div>
        `).join('')}
      </div>
    `;
    updateManualTuneStatus();
    focusEditingSeat();
    return;
  }

  updateManualTuneStatus();
  focusEditingSeat();
};

const openManualTuneDialog = (draft: ManualTuneDraft): void => {
  manualTuneDraft = draft;

  const heading = byId<HTMLDivElement>('manualTuneDialog').querySelector<HTMLHeadingElement>('h2');
  if (heading) {
    heading.textContent = draft.sourceLayout && draft.sourceLayout !== draft.layout
      ? `切换布局预览 · ${layoutLabel(draft.layout)}`
      : '手动微调';
  }
  const groupCountInput = byId<HTMLInputElement>('manualGroupCount');
  groupCountInput.value = String(draft.groupCount);
  groupCountInput.min = draft.layout === 'four' ? '3' : draft.layout === 'camp' ? '6' : '1';
  groupCountInput.max = draft.layout === 'four' ? '4' : draft.layout === 'camp' ? '8' : '6';
  groupCountInput.step = draft.layout === 'camp' ? '2' : '1';
  byId<HTMLInputElement>('manualNewStudent').value = '';
  byId<HTMLDivElement>('manualTuneError').textContent = '';
  renderManualTuneEditor();
  showDialog('manualTuneDialog');
};

const showManualTuneDialog = (): void => {
  const currentMode = captureCurrentModeData();
  const identity = captureLayoutIdentity(currentMode, currentMode.layoutIdentity);
  openManualTuneDialog({
    layout: state.currentLayout,
    groups: deepCopy(state.groups),
    rowGroups: deepCopy(state.rowGroups),
    fourGroups: deepCopy(state.fourGroups),
    groupCount: currentGroupCountForLayout(),
    selectedSeatKey: null,
    editingSeatKey: null,
    isDirty: false,
    sourceLayout: state.currentLayout,
    baselineStudents: collectStudentsFromCurrentLayout(),
    requiresBalancedGroups: false,
    resetGroupMeta: false,
    studentSetEdited: false,
    layoutIdentity: identity,
    restoredLayoutSnapshot: true,
    groupOrder: [...state.currentGroupOrder],
    groupLabels: [...state.currentGroupLabels],
    rotationConfig: { ...state.rotationConfig },
    currentArrangement: state.currentArrangement,
  });
};

const hideManualTuneDialog = (): void => {
  manualTuneDraft = null;
  hideDialog('manualTuneDialog');
};

const applyManualGroupCount = (): void => {
  if (!manualTuneDraft) {
    return;
  }

  const rawGroupCount = byId<HTMLInputElement>('manualGroupCount').value.trim();
  const groupCount = Number(rawGroupCount);
  const students = collectManualDraftStudents(manualTuneDraft);

  try {
    if (!rawGroupCount || !Number.isInteger(groupCount)) {
      throw new Error('请输入有效的整数组数');
    }
    const result = applyManualGrouping(manualTuneDraft.layout, groupCount, students);
    const nextDraft: ManualTuneDraft = {
      ...manualTuneDraft,
      groups: result.groups,
      rowGroups: result.rowGroups,
      fourGroups: result.fourGroups,
      groupCount,
    };
    const integrity = compareStudentMultisets(students, collectManualDraftStudents(nextDraft));
    if (!integrity.ok) {
      throw new Error('重排前后名单不一致，已停止操作，原座位没有改变');
    }
    const balance = validateBalancedManualGroups(nextDraft);
    if (!balance.ok) {
      throw new Error(`重排后人数不均衡（${balance.counts.join('/') || '无有效分组'}），已停止操作`);
    }
    const regroupedMode = modeFromManualTuneDraft(nextDraft);
    regroupedMode.layoutIdentity = updateIdentityAfterRegroup(regroupedMode);
    manualTuneDraft.groups = nextDraft.groups;
    manualTuneDraft.rowGroups = nextDraft.rowGroups;
    manualTuneDraft.fourGroups = nextDraft.fourGroups;
    manualTuneDraft.groupCount = groupCount;
    manualTuneDraft.layoutIdentity = regroupedMode.layoutIdentity;
    manualTuneDraft.restoredLayoutSnapshot = false;
    manualTuneDraft.groupOrder = regroupedMode.groupOrder;
    manualTuneDraft.groupLabels = regroupedMode.groupLabels;
    manualTuneDraft.rotationConfig = regroupedMode.rotationConfig;
    manualTuneDraft.currentArrangement = 0;
    manualTuneDraft.requiresBalancedGroups = true;
    manualTuneDraft.resetGroupMeta = true;
    manualTuneDraft.selectedSeatKey = null;
    manualTuneDraft.editingSeatKey = null;
    markManualTuneDirty();
    byId<HTMLDivElement>('manualTuneError').textContent = '';
    renderManualTuneEditor();
  } catch (error) {
    byId<HTMLDivElement>('manualTuneError').textContent = error instanceof Error ? error.message : '重排失败';
  }
};

const addManualTuneStudent = (): void => {
  if (!manualTuneDraft) {
    return;
  }

  const input = byId<HTMLInputElement>('manualNewStudent');
  const name = input.value.trim();
  if (!name) {
    byId<HTMLDivElement>('manualTuneError').textContent = '请先输入新学生名字。';
    return;
  }

  const target = findFirstEmptyManualSeat(manualTuneDraft);

  if (!target) {
    const students = collectManualDraftStudents(manualTuneDraft);
    try {
      const result = applyManualGrouping(manualTuneDraft.layout, manualTuneDraft.groupCount, [...students, name]);
      manualTuneDraft.groups = result.groups;
      manualTuneDraft.rowGroups = result.rowGroups;
      manualTuneDraft.fourGroups = result.fourGroups;
      input.value = '';
      markManualTuneDirty();
      byId<HTMLDivElement>('manualTuneError').textContent = '';
      renderManualTuneEditor();
    } catch (error) {
      byId<HTMLDivElement>('manualTuneError').textContent = error instanceof Error ? error.message : '当前没有可用座位。';
    }
    return;
  }

  setManualSeatValue(manualTuneDraft, target, name);
  manualTuneDraft.studentSetEdited = true;
  manualTuneDraft.editingSeatKey = null;
  input.value = '';
  markManualTuneDirty();
  byId<HTMLDivElement>('manualTuneError').textContent = '';
  renderManualTuneEditor();
};

const shuffleManualTuneSeats = (): void => {
  if (!manualTuneDraft) {
    return;
  }

  if (!shuffleManualSeatAssignments(manualTuneDraft)) {
    return;
  }
  markManualTuneDirty();
  renderManualTuneEditor();
};

const applyManualTune = (): void => {
  if (!manualTuneDraft) {
    return;
  }

  const errorNode = byId<HTMLDivElement>('manualTuneError');
  const draftStudents = collectManualDraftStudents(manualTuneDraft);
  if (!manualTuneDraft.studentSetEdited && manualTuneDraft.baselineStudents) {
    const integrity = compareStudentMultisets(manualTuneDraft.baselineStudents, draftStudents);
    if (!integrity.ok) {
      errorNode.textContent = '预览前后名单不一致，已禁止保存；当前本地座位没有改变。';
      return;
    }
  }
  if (manualTuneDraft.requiresBalancedGroups) {
    const balance = validateBalancedManualGroups(manualTuneDraft);
    if (!balance.ok) {
      errorNode.textContent = `各组人数不均衡（${balance.counts.join('/') || '无有效分组'}），已禁止保存。`;
      return;
    }
  }

  const previousLayout = state.currentLayout;
  const previousGroups = deepCopy(state.groups);
  const previousRowGroups = deepCopy(state.rowGroups);
  const previousFourGroups = deepCopy(state.fourGroups);
  const previousGroupOrder = [...state.currentGroupOrder];
  const previousGroupLabels = [...state.currentGroupLabels];
  const previousRotationConfig = { ...state.rotationConfig };
  const previousArrangement = state.currentArrangement;
  const className = activeClassName.trim();
  const previousClassConfig = className && state.classData[className]
    ? deepCopy(state.classData[className])
    : null;

  state.currentLayout = manualTuneDraft.layout;
  state.groups = deepCopy(manualTuneDraft.groups);
  state.rowGroups = deepCopy(manualTuneDraft.rowGroups);
  state.fourGroups = deepCopy(manualTuneDraft.fourGroups);
  if (manualTuneDraft.groupOrder && manualTuneDraft.groupLabels) {
    state.currentGroupOrder = [...manualTuneDraft.groupOrder];
    state.currentGroupLabels = [...manualTuneDraft.groupLabels];
  } else if (manualTuneDraft.resetGroupMeta || previousLayout !== manualTuneDraft.layout) {
    const metadataGroupCount = manualTuneDraft.layout === 'camp' ? manualTuneDraft.groupCount : 6;
    state.currentGroupOrder = getDefaultGroupOrder(manualTuneDraft.layout, metadataGroupCount);
    state.currentGroupLabels = getDefaultGroupLabels(manualTuneDraft.layout, metadataGroupCount);
  }
  if (manualTuneDraft.rotationConfig) {
    state.rotationConfig = { ...manualTuneDraft.rotationConfig };
  } else if (previousLayout !== manualTuneDraft.layout) {
    state.rotationConfig = defaultRotationConfig(manualTuneDraft.layout);
  }
  state.currentArrangement = manualTuneDraft.currentArrangement || 0;
  syncRotationSelectors();
  setLayoutClass(state.currentLayout);
  refresh();
  if (!saveCurrentClassMode('布局与分组已保存', {
    identityOverride: manualTuneDraft.layoutIdentity,
  })) {
    state.currentLayout = previousLayout;
    state.groups = previousGroups;
    state.rowGroups = previousRowGroups;
    state.fourGroups = previousFourGroups;
    state.currentGroupOrder = previousGroupOrder;
    state.currentGroupLabels = previousGroupLabels;
    state.rotationConfig = previousRotationConfig;
    state.currentArrangement = previousArrangement;
    if (className) {
      if (previousClassConfig) state.classData[className] = previousClassConfig;
      else delete state.classData[className];
    }
    syncRotationSelectors();
    setLayoutClass(state.currentLayout);
    refresh();
    errorNode.textContent = '本地保存失败，界面已恢复到修改前状态；原座位数据未被覆盖。';
    return;
  }
  updateEditorFloatingContext();
  hideManualTuneDialog();
};

// ── CNF Sync (教务导入) ──────────────────────────────────

let cnfSyncBusy = false;

const setCnfStatus = (text: string, cls: 'cnf-ok' | 'cnf-err' | 'cnf-busy' | '' = ''): void => {
  const el = byId<HTMLDivElement>('cnfSyncStatus');
  el.textContent = text;
  el.className = `cnf-sync-status ${cls}`.trim();
};

const showCnfSyncDialog = (message = '', statusClass: 'cnf-ok' | 'cnf-err' | 'cnf-busy' | '' = ''): void => {
  if (!pendingCnfClassName && activeClassName.trim()) {
    pendingCnfClassName = activeClassName.trim();
  }
  byId<HTMLDivElement>('cnfSquadPickerWrap').style.display = 'none';
  byId<HTMLButtonElement>('cnfFetchBtn').disabled = true;
  setCnfStatus(message, statusClass);
  showDialog('cnfSyncDialog');
};

const hideCnfSyncDialog = (): void => {
  pendingCnfClassName = '';
  hideDialog('cnfSyncDialog');
};

const cnfLoginAction = async (): Promise<void> => {
  if (cnfSyncBusy) return;
  cnfSyncBusy = true;
  setCnfStatus('正在读取当前登录班级列表...', 'cnf-busy');
  try {
    const squads = await cnfLoginAndListSquads();

    const select = byId<HTMLSelectElement>('cnfSquadSelect');
    select.innerHTML = '';
    const optionModels = buildCnfSquadOptions(squads);
    if (optionModels.length === 0) {
      select.innerHTML = '<option value="">暂无班级</option>';
    } else {
      select.innerHTML = '<option value="">-- 选择班级 --</option>';
      for (const optionModel of optionModels) {
        const opt = document.createElement('option');
        opt.value = optionModel.value;
        opt.dataset.type = optionModel.type;
        opt.textContent = optionModel.label;
        select.appendChild(opt);
      }
    }

    const currentCnf = activeClassName ? state.classData[activeClassName]?.cnf : null;
    select.value = resolvePreferredCnfSquadId({
      squads,
      currentCnfSquadId: currentCnf?.squadId,
      preferredClass: pendingCnfClassName || activeClassName,
    });

    byId<HTMLDivElement>('cnfSquadPickerWrap').style.display = '';
    byId<HTMLButtonElement>('cnfFetchBtn').disabled = false;
    if (select.value) {
      const selectedLabel = select.options[select.selectedIndex]?.textContent || pendingCnfClassName || activeClassName;
      setCnfStatus(`已自动匹配 ${selectedLabel}，直接点"抓取名单"即可。`, 'cnf-ok');
    } else {
      setCnfStatus(`已加载 ${squads.length} 个班级，选一个然后点"抓取名单"`, 'cnf-ok');
    }
  } catch (err) {
    setCnfStatus(err instanceof Error ? err.message : '读取班级失败', 'cnf-err');
  } finally {
    cnfSyncBusy = false;
  }
};

const cnfFetchAction = async (): Promise<void> => {
  if (cnfSyncBusy) return;
  const select = byId<HTMLSelectElement>('cnfSquadSelect');
  const squadId = select.value;
  if (!squadId) {
    setCnfStatus('请先选择一个班级', 'cnf-err');
    return;
  }
  const selectedOption = select.options[select.selectedIndex];
  const squadType = selectedOption?.dataset.type || 'offline';
  const preferredClassName = pendingCnfClassName || activeClassName.trim();

  cnfSyncBusy = true;
  setCnfStatus('正在抓取学生名单...', 'cnf-busy');
  hideCnfSyncDialog();

  try {
    const result = await cnfFetchRoster(undefined, squadId, squadType);

    const names = extractRosterStudents(result.students);
    if (names.length === 0) {
      pendingCnfClassName = preferredClassName;
      setCnfStatus('该班级暂无学生', 'cnf-err');
      showCnfSyncDialog('该班级暂无学生，请换一个班级后再抓取。', 'cnf-err');
      return;
    }

    const squadName = result.squad.name || result.squad.fullName || `班级${squadId}`;
    const targetClassName = preferredClassName || squadName;

    if (!state.classData[targetClassName]) {
      const shell = makeClassShell(getDefaultLaunchLayout(), state.userProfile.theme);
      state.classData[targetClassName] = shell;
      ensureSummerCampShellDefaults(targetClassName);
    }

    const config = state.classData[targetClassName];
    if (config) {
      saveKnownRosterForClass(targetClassName, names);
      config.cnf = {
        squadId,
        squadType: squadType as 'offline' | 'online',
        sessionToken: '',
        loginUsername: result.loginUsername || '',
        lastSyncedAt: new Date().toISOString(),
      };

      const hadExistingSeating = classHasAnySavedSeating(config);
      if (!hadExistingSeating) {
        applyFetchedCnfRoster(config, names, {
          squadId,
          squadType: squadType as 'offline' | 'online',
          loginUsername: result.loginUsername || '',
        });
      }

      if (!persist()) {
        notifyLocalSaveFailure();
        return;
      }

      classSelect().value = targetClassName;
      loadClass();
      renderClassOverview();
      refresh();

      const errorMsg = byId<HTMLDivElement>('errorMsg');
      errorMsg.textContent = hadExistingSeating
        ? `已抓取 ${targetClassName} 的 ${names.length} 名学生，当前座位表已保留不变`
        : `已从教务系统导入 ${names.length} 名学生（${squadName}）`;
      errorMsg.className = 'success';
      setTimeout(() => { errorMsg.textContent = ''; errorMsg.className = ''; }, 3000);
    }
    pendingCnfClassName = '';
  } catch (err) {
    pendingCnfClassName = preferredClassName;
    showCnfSyncDialog(err instanceof Error ? err.message : '抓取失败', 'cnf-err');
  } finally {
    cnfSyncBusy = false;
  }
};

// ── Batch Import ──────────────────────────────────────────

const showBatchImportDialog = (): void => {
  byId<HTMLTextAreaElement>('batchImportData').value = '';
  byId<HTMLDivElement>('batchImportError').textContent = '';
  showDialog('batchImportDialog');
};

const hideBatchImportDialog = (): void => {
  hideDialog('batchImportDialog');
};

const parseBatchLayout = (text: string): LayoutType => {
  if (text.includes('camp') || text.includes('苦令营') || text.includes('8组') || text.includes('八组')) return 'camp';
  if (text.includes('four') || text.includes('四组') || text.includes('4组')) return 'four';
  if (text.includes('三排') || text.includes('横排')) return 'rows';
  return 'circular';
};

const processBatchImport = (): void => {
  const input = byId<HTMLTextAreaElement>('batchImportData').value;
  const chunks = input.split('!').map((item) => item.trim()).filter(Boolean);
  let successCount = 0;
  const errors: string[] = [];

  chunks.forEach((chunk) => {
    try {
      const lines = chunk.split('\n').map((line) => line.trim()).filter(Boolean);
      const nameLine = lines.find((line) => line.startsWith('班级名称:'));
      const className = nameLine?.split(':')[1]?.trim();
      if (!className) {
        throw new Error('缺少班级名称');
      }

      ensureClassShell(className);

      let activeMode: TimeMode = 'weekday';
      let activeLayout: LayoutType = 'circular';
      let groupText: string[] = [];

      const flush = (): void => {
        if (groupText.length === 0) {
          return;
        }

        const modeData = state.classData[className][activeMode];
        const text = groupText.join('\n');

        if (activeLayout === 'circular') {
          const groups = parseGroupsText('circular', text);
          const studentCount = normalizeStudentList(groups.flat()).length;
          if (studentCount > MAX_STUDENT_LIMIT) throw new Error(`圆桌布局最多${MAX_STUDENT_LIMIT}人，当前${studentCount}人`);
          const seatCapacity = getLayoutGroupSeatCapacity('circular', studentCount, 6);
          modeData.layout = 'circular';
          modeData.groups = makeEmptyCircularGroups(seatCapacity);
          groups.forEach((group, idx) => {
            if (idx < 6) {
              modeData.groups![idx] = normalizeStudentList(group).slice(0, seatCapacity).concat(Array(seatCapacity).fill('')).slice(0, seatCapacity);
            }
          });
          modeData.rowGroups = null;
          modeData.fourGroups = null;
        } else if (activeLayout === 'rows') {
          const groups = parseGroupsText('rows', text);
          const studentCount = normalizeStudentList(groups.flat()).length;
          if (studentCount > MAX_STUDENT_LIMIT) throw new Error(`三横排布局最多${MAX_STUDENT_LIMIT}人，当前${studentCount}人`);
          const rowGroupCount = groups.filter((group) => group.some((name) => name.trim())).length || 4;
          const seatCapacity = getLayoutGroupSeatCapacity('rows', studentCount, rowGroupCount);
          const slotMap = getRowsSlotMap(rowGroupCount);
          const slotGroups = Array.from({ length: 6 }, () => Array(seatCapacity).fill(''));
          slotMap.forEach((logicalIndex, slotIndex) => {
            if (logicalIndex === null) {
              return;
            }
            slotGroups[slotIndex] = normalizeStudentList(groups[logicalIndex] || []).slice(0, seatCapacity).concat(Array(seatCapacity).fill('')).slice(0, seatCapacity);
          });
          modeData.layout = 'rows';
          modeData.groups = null;
          modeData.rowGroups = {
            rows: [
              { left: slotGroups[0], right: slotGroups[1] },
              { left: slotGroups[2], right: slotGroups[3] },
              { left: slotGroups[4], right: slotGroups[5] },
            ],
          };
          modeData.fourGroups = null;
        } else if (activeLayout === 'four') {
          const groups = parseGroupsText('four', text);
          const studentCount = normalizeStudentList(groups.flat()).length;
          if (studentCount > MAX_STUDENT_LIMIT) throw new Error(`四大组布局最多${MAX_STUDENT_LIMIT}人，当前${studentCount}人`);
          const seatCapacity = getLayoutGroupSeatCapacity('four', studentCount, 4);
          const fourGroups = makeEmptyFourGroups(seatCapacity);
          groups.forEach((group, idx) => {
            if (idx < 4) {
              fourGroups.groups[idx] = normalizeStudentList(group).slice(0, seatCapacity).concat(Array(seatCapacity).fill('')).slice(0, seatCapacity);
            }
          });
          modeData.layout = 'four';
          modeData.groups = null;
          modeData.rowGroups = null;
          modeData.fourGroups = fourGroups;
        } else if (activeLayout === 'camp') {
          const groups = parseGroupsText('camp', text);
          const studentCount = normalizeStudentList(groups.flat()).length;
          if (studentCount > MAX_STUDENT_LIMIT) throw new Error(`夏令营布局最多${MAX_STUDENT_LIMIT}人，当前${studentCount}人`);
          const groupCount = resolveImportedSummerCampGroupCount(groups);
          const campGroups = makeEmptyCampGroups(groupCount);
          groups.forEach((group, idx) => {
            if (idx < groupCount) {
              campGroups[idx] = normalizeSummerCampSeatSlots(group);
            }
          });
          modeData.layout = 'camp';
          modeData.groups = campGroups;
          modeData.groupOrder = getDefaultGroupOrder('camp', groupCount);
          modeData.groupLabels = getDefaultGroupLabels('camp', groupCount);
          modeData.rowGroups = null;
          modeData.fourGroups = null;
        }

        groupText = [];
      };

      lines.forEach((line) => {
        if (line.startsWith('周中布局:')) {
          flush();
          activeMode = 'weekday';
          activeLayout = parseBatchLayout(line);
          return;
        }

        if (line.startsWith('周末布局:')) {
          flush();
          activeMode = 'weekend';
          activeLayout = parseBatchLayout(line);
          return;
        }

        if (line.startsWith('月:')) {
          state.classData[className][activeMode].locationInfo.date = line.split(':')[1]?.trim() || '';
          return;
        }

        if (line.startsWith('日:')) {
          state.classData[className][activeMode].locationInfo.day = line.split(':')[1]?.trim() || '';
          return;
        }

        if (line.startsWith('星期:')) {
          state.classData[className][activeMode].locationInfo.weekday = line.split(':')[1]?.trim() || '';
          return;
        }

        if (line.startsWith('时间:')) {
          state.classData[className][activeMode].locationInfo.time = line.slice(line.indexOf(':') + 1).trim();
          return;
        }

        if (line.startsWith('校区:')) {
          state.classData[className][activeMode].locationInfo.campus = line.split(':')[1]?.trim() || '';
          return;
        }

        if (line.startsWith('楼层:')) {
          state.classData[className][activeMode].locationInfo.floor = line.split(':')[1]?.trim() || '';
          return;
        }

        if (line.startsWith('教室:')) {
          state.classData[className][activeMode].locationInfo.room = line.split(':')[1]?.trim() || '';
          return;
        }

        if (line.startsWith('Group') || line.startsWith('第一排') || line.startsWith('第二排')) {
          groupText.push(line);
        }
      });

      flush();

      (['weekday', 'weekend'] as TimeMode[]).forEach((mode) => {
        const info = state.classData[className][mode].locationInfo;
        info.fullDate = monthDayToDateKey(info.date, info.day) || '';
      });

      successCount += 1;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : '解析失败');
    }
  });

  persist();
  updateClassSelect();
  renderClassOverview();

  const errorBox = byId<HTMLDivElement>('batchImportError');
  if (errors.length > 0) {
    errorBox.className = 'error';
    errorBox.innerHTML = `成功 ${successCount} 个，失败 ${errors.length} 个：<br>${errors.map((msg) => `• ${escapeHtml(msg)}`).join('<br>')}`;
  } else {
    errorBox.className = 'success';
    errorBox.textContent = `成功导入 ${successCount} 个班级。`;
    setTimeout(hideBatchImportDialog, 1300);
  }
};

const setTextAlign = (align: 'left' | 'center' | 'right'): void => {
  document.execCommand(`justify${align.charAt(0).toUpperCase()}${align.slice(1)}`, false);
  updateAlignButtons();
  syncSummerCampNotesState();
  scheduleSummerCampNotesAutosave();
};

const setVerticalAlign = (align: 'top' | 'middle' | 'bottom'): void => {
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount) {
    return;
  }

  const range = selection.getRangeAt(0);
  const selected = range.commonAncestorContainer;

  if (selected.nodeType === 3) {
    const span = document.createElement('span');
    span.style.verticalAlign = align;
    range.surroundContents(span);
  } else if (selected.nodeType === 1) {
    (selected as HTMLElement).style.verticalAlign = align;
  }

  updateAlignButtons();
  syncSummerCampNotesState();
  scheduleSummerCampNotesAutosave();
};

const updateAlignButtons = (): void => {
  const buttons = queryAll<HTMLButtonElement>('.text-align-group button');
  buttons.forEach((button) => button.classList.remove('active'));

  const alignment = document.queryCommandState('justifyLeft')
    ? 'left'
    : document.queryCommandState('justifyCenter')
      ? 'center'
      : document.queryCommandState('justifyRight')
        ? 'right'
        : '';

  if (!alignment) {
    return;
  }

  const activeButton = queryOne<HTMLButtonElement>(`[onclick*=\"setTextAlign('${alignment}')\"]`);
  if (activeButton) {
    activeButton.classList.add('active');
  }
};

const updateTime = (): void => {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const input = byId<HTMLInputElement>('time');
  if (!input.value) {
    input.value = isSummerCampMode() ? '8:00' : `${hours}:${minutes}`;
  }
};

const bindNotes = (): void => {
  const leftSection = byId<HTMLDivElement>('editorView').querySelector<HTMLElement>('.left-section');
  const infoSection = byId<HTMLDivElement>('editorView').querySelector<HTMLElement>('.info-section');
  const panel = byId<HTMLDivElement>('editorView').querySelector<HTMLElement>('.right-section');
  const notesSection = byId<HTMLDivElement>('editorView').querySelector<HTMLElement>('.notes-section');
  const widthHandle = byId<HTMLDivElement>('notesWidthHandle');
  const heightHandle = byId<HTMLDivElement>('notesHeightHandle');
  const todoEnabledToggle = byId<HTMLInputElement>('todoEnabledToggle');
  const todoCollapseBtn = byId<HTMLButtonElement>('todoBoardCollapseBtn');
  const todoAddBtn = byId<HTMLButtonElement>('todoAddBtn');
  const todoInput = byId<HTMLInputElement>('todoInput');
  const todoDueDate = byId<HTMLInputElement>('todoDueDate');
  const todoClassList = byId<HTMLDivElement>('todoClassList');
  const todoWeeklyCard = byId<HTMLDivElement>('todoWeeklyCard');

  if (panel && notesSection) {
    let syncQueued = false;
    const getAlignedNotesHeight = (): number => {
      const leftRect = leftSection?.getBoundingClientRect();
      const infoRect = infoSection?.getBoundingClientRect();
      if (leftRect && infoRect) {
        return Math.max(300, Math.round(leftRect.bottom - infoRect.top));
      }
      return Math.max(320, window.innerHeight - 220);
    };

    const applyPanelHeight = (height: number): void => {
      const nextHeight = Math.max(300, Math.min(getAlignedNotesHeight(), height));
      notesSection.style.height = `${nextHeight}px`;
    };

    const syncPanelAlignment = (): void => {
      const nextHeight = panel.dataset.heightMode === 'manual'
        ? Number.parseFloat(notesSection.style.height) || getAlignedNotesHeight()
        : getAlignedNotesHeight();
      if (!infoSection || window.innerWidth <= 1024) {
        panel.style.marginTop = '0px';
        notesSection.style.marginTop = '0px';
        notesSection.style.height = `${window.innerWidth <= 720 ? 320 : 380}px`;
        return;
      }
      const editorRect = panel.parentElement?.getBoundingClientRect();
      const infoRect = infoSection.getBoundingClientRect();
      const offset = editorRect ? Math.max(0, Math.round(infoRect.top - editorRect.top)) : 0;
      panel.style.marginTop = `${offset}px`;
      notesSection.style.marginTop = '0px';
      applyPanelHeight(nextHeight);
    };

    const queuePanelAlignment = (): void => {
      if (syncQueued) {
        return;
      }
      syncQueued = true;
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          syncQueued = false;
          syncPanelAlignment();
        });
      });
    };

    const applyPanelWidth = (width: number): void => {
      const nextWidth = Math.max(280, Math.min(560, width));
      panel.style.width = `${nextWidth}px`;
      panel.style.flex = `0 0 ${nextWidth}px`;
    };

    const savedWidth = readStorageValue(storageKeys.notesPanelWidth);
    if (savedWidth) {
      applyPanelWidth(Number(savedWidth) || 360);
    }
    const savedHeight = readStorageValue(storageKeys.notesSectionHeight);
    if (savedHeight) {
      panel.dataset.heightMode = 'auto';
      applyPanelHeight(getAlignedNotesHeight());
    } else {
      panel.dataset.heightMode = 'auto';
      applyPanelHeight(getAlignedNotesHeight());
    }

    const persistWidth = (): void => {
      writeStorageValue(storageKeys.notesPanelWidth, String(panel.getBoundingClientRect().width));
    };
    const persistHeight = (): void => {
      writeStorageValue(storageKeys.notesSectionHeight, String(notesSection.getBoundingClientRect().height));
    };

    panel.addEventListener('mouseup', persistWidth);
    panel.addEventListener('touchend', persistWidth);
    notesSection.addEventListener('mouseup', persistHeight);
    notesSection.addEventListener('touchend', persistHeight);
    queuePanelAlignment();
    syncSummerCampNotesState();
    const handleNotesSync = (): void => {
      syncSummerCampNotesState();
      queuePanelAlignment();
    };
    window.addEventListener('resize', queuePanelAlignment);
    window.addEventListener('load', queuePanelAlignment);
    window.addEventListener('superamber:notes-sync', handleNotesSync as EventListener);
    registerMountCleanup(() => {
      window.removeEventListener('resize', queuePanelAlignment);
      window.removeEventListener('load', queuePanelAlignment);
      window.removeEventListener('superamber:notes-sync', handleNotesSync as EventListener);
    });

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => queuePanelAlignment());
      if (leftSection) observer.observe(leftSection);
      if (infoSection) observer.observe(infoSection);
      const parent = panel.parentElement;
      if (parent) observer.observe(parent);
      registerMountCleanup(() => observer.disconnect());
    }

    widthHandle.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = panel.getBoundingClientRect().width;

      const onMove = (moveEvent: PointerEvent): void => {
        const nextWidth = startWidth + (moveEvent.clientX - startX);
        applyPanelWidth(nextWidth);
        persistWidth();
      };

      const onUp = (): void => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        persistWidth();
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp, { once: true });
    });

    heightHandle.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      const startY = event.clientY;
      const startHeight = notesSection.getBoundingClientRect().height;

      const onMove = (moveEvent: PointerEvent): void => {
        panel.dataset.heightMode = 'manual';
        const nextHeight = startHeight + (moveEvent.clientY - startY);
        applyPanelHeight(nextHeight);
        persistHeight();
      };

      const onUp = (): void => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        persistHeight();
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp, { once: true });
    });

    if ('ResizeObserver' in window) {
      const observer = new ResizeObserver(() => {
        persistWidth();
        persistHeight();
      });
      observer.observe(panel);
      observer.observe(notesSection);
      registerMountCleanup(() => observer.disconnect());
    }
  }

  todoEnabledToggle.addEventListener('change', () => {
    reminderMeta.enabled = todoEnabledToggle.checked;
    if (!reminderMeta.enabled) {
      reminderMeta.panelCollapsed = false;
      reminderMeta.lastAlertDate = '';
    }
    saveReminderState();
    renderReminderSummary();
    maybeShowTodayReminderAlert();
  });

  todoCollapseBtn.addEventListener('click', () => {
    reminderMeta.panelCollapsed = !reminderMeta.panelCollapsed;
    saveReminderState();
    renderReminderSummary();
  });

  todoAddBtn.addEventListener('click', () => {
    const className = activeClassName || classSelect().value.trim();
    const text = todoInput.value.trim();
    const dueDate = todoDueDate.value || getUpcomingClassDateForClass(className) || toLocalDateKey();
    if (!className) {
      alert('请先选中班级，再添加提醒。');
      return;
    }
    if (!text) {
      alert('请先输入提醒内容。');
      return;
    }

    addReminderNoteToClass(className, text, dueDate, 'manual');
    todoInput.value = '';
    todoDueDate.value = dueDate;
    renderReminderSummary();
  });

  todoInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      todoAddBtn.click();
    }
  });

  todoClassList.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const toggleBtn = target.closest<HTMLElement>('[data-note-toggle]');
    const deleteBtn = target.closest<HTMLElement>('[data-note-delete]');
    const className = activeClassName || classSelect().value.trim();
    if (!className) {
      return;
    }

    if (toggleBtn?.dataset.noteToggle) {
      const noteId = toggleBtn.dataset.noteToggle;
      const note = state.classData[className]?.todoNotes.find((item) => item.id === noteId);
      if (!note) {
        return;
      }
      updateReminderNoteStatus(className, noteId, !note.completed);
      renderReminderSummary();
      return;
    }

    if (deleteBtn?.dataset.noteDelete) {
      removeReminderNote(className, deleteBtn.dataset.noteDelete);
      renderReminderSummary();
    }
  });

  todoWeeklyCard.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    if (target.id !== 'weeklyTodoConfirmBtn') {
      return;
    }

    const className = queryOne<HTMLSelectElement>('#weeklyTodoClassSelect')?.value.trim() || '';
    const noteText = queryOne<HTMLTextAreaElement>('#weeklyTodoNote')?.value.trim() || '';
    if (className && noteText) {
      addReminderNoteToClass(className, noteText, getUpcomingClassDateForClass(className) || toLocalDateKey(), 'weekly');
    }

    reminderMeta.weeklyConfirmedWeek = getWeekNumber();
    reminderMeta.weeklyConfirmedAt = new Date().toISOString();
    saveReminderState();
    renderReminderSummary();
  });

  byId<HTMLSelectElement>('noteFontSize').addEventListener('change', (event) => {
    document.execCommand('fontSize', false, '7');
    const fonts = queryAll<HTMLFontElement>('font');
    const target = event.target as HTMLSelectElement;

    for (let idx = 0; idx < fonts.length; idx += 1) {
      if (fonts[idx].size === '7') {
        fonts[idx].removeAttribute('size');
        fonts[idx].style.fontSize = `${target.value}px`;
      }
    }
    syncSummerCampNotesState();
    scheduleSummerCampNotesAutosave();
  });

  byId<HTMLInputElement>('noteColor').addEventListener('change', (event) => {
    const target = event.target as HTMLInputElement;
    document.execCommand('foreColor', false, target.value);
    syncSummerCampNotesState();
    scheduleSummerCampNotesAutosave();
  });

  notes().addEventListener('input', () => {
    syncSummerCampNotesState();
    scheduleSummerCampNotesAutosave();
  });

  notes().addEventListener('paste', (event) => {
    event.preventDefault();
    const clipboard = (event as ClipboardEvent).clipboardData;
    if (!clipboard) {
      return;
    }

    for (const item of clipboard.items) {
      if (item.type.startsWith('image')) {
        const file = item.getAsFile();
        if (!file) {
          continue;
        }

        const reader = new FileReader();
        reader.onload = (loadEvent) => {
          const img = document.createElement('img');
          img.src = String(loadEvent.target?.result || '');
          img.style.maxWidth = '100%';
          img.style.height = 'auto';
          img.style.border = '1px solid #ddd';
          img.style.margin = '10px auto';
          img.style.display = 'block';
          notes().appendChild(img);
          syncSummerCampNotesState();
          scheduleSummerCampNotesAutosave();
        };
        reader.readAsDataURL(file);
        continue;
      }

      if (item.type === 'text/plain') {
        item.getAsString((text) => {
          document.execCommand('insertText', false, text);
          syncSummerCampNotesState();
          scheduleSummerCampNotesAutosave();
        });
      }
    }
  });
};

const bindOcrReviewEvents = (): void => {
  byId<HTMLDivElement>('ocrReviewList').addEventListener('input', (event) => {
    const target = event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    const field = target.dataset.field;
    const card = target.closest<HTMLElement>('.ocr-card');
    const id = card?.dataset.id;

    if (!field || !id) {
      return;
    }

    const draft = ocrDrafts.find((item) => item.id === id);
    if (!draft) {
      return;
    }

    if (field === 'overwrite') {
      draft.overwrite = target.value === 'true';
      return;
    }

    if (field === 'layout') {
      draft.layout = target.value as LayoutType;
      return;
    }

    if (field === 'mode') {
      draft.mode = target.value as TimeMode;
      return;
    }

    switch (field) {
      case 'className':
        draft.className = target.value;
        break;
      case 'groupsText':
        draft.groupsText = target.value;
        break;
      case 'date':
        draft.date = target.value;
        break;
      case 'day':
        draft.day = target.value;
        break;
      case 'weekday':
        draft.weekday = target.value;
        break;
      case 'time':
        draft.time = target.value;
        break;
      case 'campus':
        draft.campus = target.value;
        break;
      case 'floor':
        draft.floor = target.value;
        break;
      case 'room':
        draft.room = target.value;
        break;
      default:
        break;
    }
  });
};

const bindHomeEvents = (): void => {
  const saveUsername = (): void => {
    const username = byId<HTMLInputElement>('usernameInput').value.trim();
    if (!username) {
      return;
    }
    state.userProfile.username = username;
    saveProfile();
    updateWelcome();
  };

  byId<HTMLButtonElement>('saveUsernameBtn').addEventListener('click', saveUsername);
  byId<HTMLInputElement>('usernameInput').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      saveUsername();
    }
  });

  byId<HTMLSelectElement>('themeSelect').addEventListener('change', (event) => {
    const value = (event.target as HTMLSelectElement).value as ThemeName;
    state.userProfile.theme = value;
    saveProfile();
    if (state.currentView === 'home') {
      applyTheme(value);
    }
  });

  byId<HTMLDivElement>('homeClassList').addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const useRosterBtn = target.closest<HTMLElement>('[data-use-roster-class]');
    if (useRosterBtn?.dataset.useRosterClass) {
      createClassFromKnownRoster(useRosterBtn.dataset.useRosterClass);
      return;
    }

    const card = target.closest<HTMLElement>('[data-open-class]');
    if (!card) {
      return;
    }

    const className = card.dataset.openClass;
    if (!className) {
      return;
    }

    openClassInEditor(className);
  });
};

const supportedGroupRotationsForCurrentLayout = (): Set<GroupRotation> => {
  if (state.currentLayout === 'rows') {
    return new Set(['snake', 'front-back-swap', 'clockwise', 'counterclockwise']);
  }
  if (state.currentLayout === 'camp') {
    return appMountOptions.rotationPreset === 'camp-cross'
      ? new Set(['front-back-swap', 'clockwise', 'counterclockwise'])
      : new Set(['front-back-swap', 'row-left', 'clockwise', 'counterclockwise']);
  }
  return new Set(state.currentLayout === 'circular' ? ['front-back-swap', 'clockwise', 'counterclockwise'] : ['clockwise', 'counterclockwise']);
};

const syncRotationSelectors = (): void => {
  normalizeRotationConfigForUi();
  const groupSel = byId<HTMLSelectElement>('groupRotationSelect');
  const internalSel = byId<HTMLSelectElement>('internalRotationSelect');
  const nameSel = byId<HTMLSelectElement>('groupNameModeSelect');
  const labelSel = byId<HTMLSelectElement>('labelRotationSelect');
  groupSel.value = state.rotationConfig.groupRotation;
  internalSel.value = state.rotationConfig.internalRotation;
  nameSel.value = state.rotationConfig.labelNameMode || inferLabelNameMode();
  labelSel.value = state.rotationConfig.labelRotation;

  const supportedRotations = supportedGroupRotationsForCurrentLayout();
  groupSel.querySelectorAll<HTMLOptionElement>('option').forEach((option) => {
    option.style.display = supportedRotations.has(option.value as GroupRotation) ? '' : 'none';
  });
  const frontBackOpt = groupSel.querySelector<HTMLOptionElement>('option[value="front-back-swap"]');
  const snakeOpt = groupSel.querySelector<HTMLOptionElement>('option[value="snake"]');
  if (frontBackOpt) {
    frontBackOpt.textContent = state.currentLayout === 'rows'
      ? '交叉 1→4→5→2→3→6'
      : '交叉 1→5→3→4→2→6';
  }
  if (snakeOpt) {
    snakeOpt.textContent = state.currentLayout === 'rows'
      ? '蛇形 1→2→4→3→5→6'
      : '蛇形';
  }

  const configPanel = byId<HTMLDivElement>('rotationConfig');
  const groupRow = configPanel.querySelector('.rotation-config-row') as HTMLElement | null;
  if (groupRow) {
    groupRow.style.display = '';
  }
  rememberCurrentRotationConfig();
};

const bindSummerCampSeatTitleFit = (): void => {
  if (!isSummerCampMode()) {
    return;
  }

  const title = queryOne<HTMLElement>('#summerCampSeatTitle');
  const header = title?.closest<HTMLElement>('.header') || title?.parentElement;
  const onResize = (): void => queueSummerCampSeatTitleFit();
  const finishEdit = (save: boolean): void => {
    if (!title || title.dataset.editing !== 'true') {
      return;
    }
    const previous = title.dataset.beforeEdit || '';
    const next = title.textContent || '';
    title.contentEditable = 'false';
    title.classList.remove('is-editing');
    delete title.dataset.editing;
    delete title.dataset.beforeEdit;

    if (save) {
      saveSummerCampSeatTitle(next);
    } else {
      title.textContent = previous;
      queueSummerCampSeatTitleFit();
    }
  };
  const beginEdit = (): void => {
    if (!title || !isSummerCampMode() || title.dataset.editing === 'true') {
      return;
    }
    title.dataset.editing = 'true';
    title.dataset.beforeEdit = title.textContent || '';
    title.contentEditable = 'true';
    title.classList.add('is-editing');
    title.focus();
    const selection = window.getSelection();
    if (selection) {
      const range = document.createRange();
      range.selectNodeContents(title);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  };
  const onTitleKeyDown = (event: KeyboardEvent): void => {
    if (title?.dataset.editing !== 'true') {
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      finishEdit(true);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      finishEdit(false);
    }
  };
  const onTitleBlur = (): void => finishEdit(true);
  const onTitleInput = (): void => queueSummerCampSeatTitleFit();
  window.addEventListener('resize', onResize);
  title?.addEventListener('dblclick', beginEdit);
  title?.addEventListener('keydown', onTitleKeyDown);
  title?.addEventListener('blur', onTitleBlur);
  title?.addEventListener('input', onTitleInput);
  registerMountCleanup(() => {
    window.removeEventListener('resize', onResize);
    title?.removeEventListener('dblclick', beginEdit);
    title?.removeEventListener('keydown', onTitleKeyDown);
    title?.removeEventListener('blur', onTitleBlur);
    title?.removeEventListener('input', onTitleInput);
    if (summerCampSeatTitleFitFrame) {
      window.cancelAnimationFrame(summerCampSeatTitleFitFrame);
      summerCampSeatTitleFitFrame = 0;
    }
  });

  if (typeof ResizeObserver !== 'undefined' && header) {
    const observer = new ResizeObserver(onResize);
    observer.observe(header);
    registerMountCleanup(() => observer.disconnect());
  }

  queueSummerCampSeatTitleFit();
};

const getStandardGroupLabelsForCurrentRules = (): string[] => {
  const groupCount = currentGroupCountForLayout();
  return buildStandardGroupLabelsForOrder(
    state.currentLayout,
    groupCount,
    state.currentGroupOrder,
    state.rotationConfig.labelRotation === 'rotate'
  );
};

const inferLabelNameMode = (): LabelNameMode => {
  const groupCount = currentGroupCountForLayout();
  const physicalLabels = buildStandardGroupLabelsForOrder(
    state.currentLayout,
    groupCount,
    state.currentGroupOrder,
    false
  );
  const memberLabels = buildStandardGroupLabelsForOrder(
    state.currentLayout,
    groupCount,
    state.currentGroupOrder,
    true
  );
  return isStandardGroupLabelSet(state.currentGroupLabels, physicalLabels)
    || isStandardGroupLabelSet(state.currentGroupLabels, memberLabels)
    ? 'standard'
    : 'custom';
};

const normalizeRotationConfigForUi = (): void => {
  const supportedRotations = supportedGroupRotationsForCurrentLayout();
  if (!supportedRotations.has(state.rotationConfig.groupRotation)) {
    state.rotationConfig.groupRotation = defaultRotationConfig(state.currentLayout).groupRotation;
  }
  if (state.rotationConfig.labelRotation === 'custom') {
    state.rotationConfig.labelRotation = 'fixed';
    state.rotationConfig.labelNameMode = 'custom';
    return;
  }
  if (!state.rotationConfig.labelNameMode) {
    state.rotationConfig.labelNameMode = inferLabelNameMode();
  }
};

const bindCoreEvents = (): void => {
  const editorView = byId<HTMLDivElement>('editorView');
  byId<HTMLButtonElement>('notesVisibilityToggle').addEventListener('click', () => {
    const hidden = byId<HTMLDivElement>('editorView').classList.contains('seating-notes-hidden');
    setNotesVisibility(!hidden);
    refresh();
    if (!saveCurrentClassMode('备注显示设置已保存')) {
      setNotesVisibility(hidden);
      refresh();
    }
  });
  const editorToolsToggle = byId<HTMLButtonElement>('editorToolsToggle');
  const summerCampToolsToggle = queryOne<HTMLButtonElement>('#summerCampToolsToggleBtn');
  const toolsCollapsedStorage = isSummerCampMode()
    ? storageKeys.summerCampToolsCollapsed
    : storageKeys.editorToolsCollapsed;
  const applyEditorToolsState = (collapsed: boolean): void => {
    editorView.classList.toggle('editor-tools-collapsed', collapsed);
    editorToolsToggle.textContent = collapsed ? '显示工具' : '隐藏工具';
    syncSummerCampToolsToggleLabel();
    writeStorageValue(toolsCollapsedStorage, collapsed ? '1' : '0');
  };

  const savedToolsCollapsed = readStorageValue(toolsCollapsedStorage);
  const defaultToolsCollapsed = isSummerCampMode()
    ? savedToolsCollapsed === '1'
    : false;
  applyEditorToolsState(defaultToolsCollapsed);
  const handleCampThemeUpdate = () => applySummerCampTheme();
  window.addEventListener(CAMP_THEME_UPDATED_EVENT, handleCampThemeUpdate);
  window.addEventListener('storage', handleCampThemeUpdate);
  registerMountCleanup(() => {
    window.removeEventListener(CAMP_THEME_UPDATED_EVENT, handleCampThemeUpdate);
    window.removeEventListener('storage', handleCampThemeUpdate);
    if (summerCampSaveStatusTimer) {
      window.clearTimeout(summerCampSaveStatusTimer);
      summerCampSaveStatusTimer = 0;
    }
    if (summerCampNotesSaveTimer) {
      window.clearTimeout(summerCampNotesSaveTimer);
      summerCampNotesSaveTimer = 0;
    }
  });
  editorToolsToggle.addEventListener('click', () => {
    applyEditorToolsState(!editorView.classList.contains('editor-tools-collapsed'));
  });
  summerCampToolsToggle?.addEventListener('click', () => {
    applyEditorToolsState(!editorView.classList.contains('editor-tools-collapsed'));
  });
  queryOne<HTMLButtonElement>('#summerCampSaveNowBtn')?.addEventListener('click', () => {
    setSummerCampSaveStatus('正在保存当前日报...', 'saving');
    if (saveCurrentClassMode('当前日报已保存')) {
      renderClassOverview();
    }
  });

  byId<HTMLSelectElement>('groupRotationSelect').addEventListener('change', (e) => {
    state.rotationConfig.groupRotation = (e.target as HTMLSelectElement).value as any;
    saveCurrentClassMode('轮转设置已保存');
  });
  byId<HTMLSelectElement>('internalRotationSelect').addEventListener('change', (e) => {
    state.rotationConfig.internalRotation = (e.target as HTMLSelectElement).value as any;
    saveCurrentClassMode('组内轮转已保存');
  });
  byId<HTMLSelectElement>('groupNameModeSelect').addEventListener('change', (e) => {
    const nextMode = (e.target as HTMLSelectElement).value as LabelNameMode;
    state.rotationConfig.labelNameMode = nextMode;
    if (nextMode === 'standard') {
      state.currentGroupLabels = getStandardGroupLabelsForCurrentRules();
      refresh();
    }
    saveCurrentClassMode('组名设置已保存');
  });
  byId<HTMLSelectElement>('labelRotationSelect').addEventListener('change', (e) => {
    const nextMode = (e.target as HTMLSelectElement).value as any;
    state.rotationConfig.labelRotation = nextMode;
    if (state.rotationConfig.labelNameMode !== 'custom') {
      state.currentGroupLabels = getStandardGroupLabelsForCurrentRules();
      refresh();
    }
    saveCurrentClassMode('组名位置已保存');
  });
  classroom().addEventListener('dblclick', (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('h3[data-group-label-index]');
    const index = Number(target?.dataset.groupLabelIndex || '');
    if (!target || !Number.isInteger(index) || index < 0) {
      return;
    }
    event.preventDefault();
    target.setAttribute('contenteditable', 'true');
    target.dataset.editing = '1';
    target.focus();
    focusEditableLabel(target);
  });
  classroom().addEventListener('keydown', (event) => {
    const target = event.target as HTMLElement;
    if (target?.dataset.editing !== '1') {
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      target.blur();
    }
  });
  classroom().addEventListener('focusout', (event) => {
    const target = event.target as HTMLElement;
    if (target?.dataset.editing !== '1') {
      return;
    }
    commitGroupLabelEdit(target);
  });

  byId<HTMLInputElement>('date').addEventListener('change', syncDateField);
  byId<HTMLInputElement>('day').addEventListener('change', syncDateField);
  byId<HTMLInputElement>('campArrivalMessage').addEventListener('change', () => {
    saveCurrentClassMode('到达提醒已保存');
  });
  byId<HTMLDivElement>('manualSeatEditor').addEventListener('click', (event) => {
    if (!manualTuneDraft) {
      return;
    }

    const target = event.target as HTMLElement;

    const clearBtn = target.closest<HTMLElement>('[data-clear-key]');
    if (clearBtn) {
      event.preventDefault();
      event.stopPropagation();
      const clearKey = clearBtn.dataset.clearKey;
      if (clearKey) {
        const seat = findManualSeat(manualTuneDraft, clearKey);
        if (seat) {
          setManualSeatValue(manualTuneDraft, seat, '');
          manualTuneDraft.studentSetEdited = true;
          manualTuneDraft.selectedSeatKey = null;
          manualTuneDraft.editingSeatKey = null;
          markManualTuneDirty();
          renderManualTuneEditor();
        }
      }
      return;
    }

    const row = target.closest<HTMLElement>('[data-seat-key]');
    const key = row?.dataset.seatKey;
    if (!key) {
      return;
    }

    if (!manualTuneDraft.selectedSeatKey && target.closest('input')) {
      event.preventDefault();
      manualTuneDraft.editingSeatKey = null;
      manualTuneDraft.selectedSeatKey = key;
      renderManualTuneEditor();
      return;
    }

    if (!manualTuneDraft.selectedSeatKey || manualTuneDraft.selectedSeatKey === key) {
      manualTuneDraft.editingSeatKey = null;
      manualTuneDraft.selectedSeatKey = manualTuneDraft.selectedSeatKey === key ? null : key;
      renderManualTuneEditor();
      return;
    }

    // Prevent the click from also focusing the input after swap
    event.preventDefault();

    const firstSeat = findManualSeat(manualTuneDraft, manualTuneDraft.selectedSeatKey);
    const secondSeat = findManualSeat(manualTuneDraft, key);
    if (!firstSeat || !secondSeat) {
      manualTuneDraft.selectedSeatKey = null;
      renderManualTuneEditor();
      return;
    }

    const firstValue = getManualSeatValue(manualTuneDraft, firstSeat);
    const secondValue = getManualSeatValue(manualTuneDraft, secondSeat);
    setManualSeatValue(manualTuneDraft, firstSeat, secondValue);
    setManualSeatValue(manualTuneDraft, secondSeat, firstValue);
    manualTuneDraft.selectedSeatKey = null;
    manualTuneDraft.editingSeatKey = null;
    markManualTuneDirty();
    byId<HTMLDivElement>('manualTuneError').textContent = '';
    renderManualTuneEditor();
  });
  byId<HTMLDivElement>('manualSeatEditor').addEventListener('dblclick', (event) => {
    if (!manualTuneDraft) {
      return;
    }

    const target = event.target as HTMLElement;
    const row = target.closest<HTMLElement>('[data-seat-key]');
    const key = row?.dataset.seatKey;
    if (!key) {
      return;
    }

    event.preventDefault();
    manualTuneDraft.selectedSeatKey = null;
    manualTuneDraft.editingSeatKey = key;
    renderManualTuneEditor();
  });
  byId<HTMLDivElement>('manualSeatEditor').addEventListener('input', (event) => {
    if (!manualTuneDraft) {
      return;
    }

    const target = event.target as HTMLInputElement;
    const key = target.dataset.seatInput;
    if (!key) {
      return;
    }

    const seat = findManualSeat(manualTuneDraft, key);
    if (!seat) {
      return;
    }

    setManualSeatValue(manualTuneDraft, seat, target.value);
    manualTuneDraft.studentSetEdited = true;
    manualTuneDraft.editingSeatKey = key;
    markManualTuneDirty();
  });
  byId<HTMLDivElement>('manualSeatEditor').addEventListener('focusout', (event) => {
    if (!manualTuneDraft) {
      return;
    }

    const nextTarget = event.relatedTarget;
    const container = byId<HTMLDivElement>('manualSeatEditor');
    if (nextTarget instanceof Node && container.contains(nextTarget)) {
      return;
    }

    manualTuneDraft.editingSeatKey = null;
    updateManualTuneStatus();
  });
  byId<HTMLDivElement>('rosterList').addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const btn = target.closest<HTMLElement>('[data-delete-student]');
    if (!btn) {
      return;
    }
    const studentName = btn.dataset.deleteStudent;
    if (studentName && confirm(`确定要删除「${studentName}」吗？`)) {
      removeStudentFromSeats(studentName);
    }
  });
  byId<HTMLSelectElement>('editorThemeSelect').addEventListener('change', (event) => {
    const className = classSelect().value.trim();
    if (!className) {
      return;
    }

    ensureClassShell(className);
    const value = (event.target as HTMLSelectElement).value as ThemeName;
    state.classData[className].theme = value;
    applyTheme(value);
    persist();
    renderClassOverview();
  });
  classSelect().addEventListener('change', (event) => {
    const target = event.target as HTMLSelectElement;
    switchEditorClass(target.value);
  });
  floatingClassSelect().addEventListener('change', (event) => {
    const target = event.target as HTMLSelectElement;
    switchEditorClass(target.value);
  });

  byId<HTMLInputElement>('circularLayout').addEventListener('change', updateLayoutDescription);
  byId<HTMLInputElement>('rowsLayout').addEventListener('change', updateLayoutDescription);
  byId<HTMLInputElement>('fourLayout').addEventListener('change', updateLayoutDescription);
  byId<HTMLInputElement>('campLayout').addEventListener('change', updateLayoutDescription);
  byId<HTMLSelectElement>('campPresetSelect').addEventListener('change', updateCampPresetSummary);
  byId<HTMLSelectElement>('campPresetGroupCount').addEventListener('change', updateCampPresetSummary);
  byId<HTMLSelectElement>('summerCampMajorSelect').addEventListener('change', () => {
    setSummerCampSaveStatus('正在同步营号...', 'saving');
    updateSummerCampMinorOptions(undefined, summerCampDateSelect()?.value || defaultSummerCampDateKey());
    applySummerCampSelection();
  });
  byId<HTMLSelectElement>('summerCampMinorSelect').addEventListener('change', () => {
    setSummerCampSaveStatus('正在同步营号...', 'saving');
    updateSummerCampPickerButtons();
    applySummerCampSelection();
  });
  byId<HTMLSelectElement>('summerCampDateSelect').addEventListener('change', () => {
    setSummerCampSaveStatus('正在同步日期...', 'saving');
    updateSummerCampMinorOptions(undefined, summerCampDateSelect()?.value || defaultSummerCampDateKey());
    applySummerCampSelection();
  });
  byId<HTMLInputElement>('backupImportInput').addEventListener('change', (event) => {
    void importBackupFile(event);
  });
  byId<HTMLSelectElement>('ocrEngine').addEventListener('change', () => {
    updateOcrProviderFields();
    readOcrSettingsFromForm();
  });
  byId<HTMLInputElement>('allowLocalFallback').addEventListener('change', () => {
    readOcrSettingsFromForm();
  });
  byId<HTMLInputElement>('tencentEndpoint').addEventListener('change', () => {
    readOcrSettingsFromForm();
  });
  byId<HTMLInputElement>('tencentRegion').addEventListener('change', () => {
    readOcrSettingsFromForm();
  });
  byId<HTMLSelectElement>('tencentAction').addEventListener('change', () => {
    readOcrSettingsFromForm();
  });
};

interface AppWindow extends Window {
  loadClass: () => void;
  toggleTime: (mode: TimeMode) => void;
  showSaveDialog: () => void;
  hideSaveDialog: () => void;
  saveClass: () => void;
  renameCurrentClass: () => void;
  deleteCurrentClass: () => void;
  showImportDialog: () => void;
  hideImportDialog: () => void;
  importStudents: () => void;
  showCampPresetDialog: () => void;
  hideCampPresetDialog: () => void;
  applyCampPresetSeating: () => void;
  applySummerCampSelection: () => void;
  generateSeating: () => void;
  toggleEditMode: () => void;
  setTextAlign: (align: 'left' | 'center' | 'right') => void;
  setVerticalAlign: (align: 'top' | 'middle' | 'bottom') => void;
  showBatchImportDialog: () => void;
  hideBatchImportDialog: () => void;
  processBatchImport: () => void;
  toggleLayout: () => void;
  previewManualLayout: (layout: LayoutType) => void;
  goHome: () => void;
  generateWeeklySeating: () => void;
  undoWeeklySeating: () => void;
  showCreateClassDialog: () => void;
  hideCreateClassDialog: () => void;
  showImageImportDialog: () => void;
  hideImageImportDialog: () => void;
  startImageRecognition: () => Promise<void>;
  checkOCRChannel: () => Promise<void>;
  confirmImageImport: () => void;
  showManualTuneDialog: () => void;
  hideManualTuneDialog: () => void;
  applyManualGroupCount: () => void;
  addManualTuneStudent: () => void;
  shuffleManualTuneSeats: () => void;
  applyManualTune: () => void;
  copyCurrentToOtherMode: () => void;
  showPreviousWeekDialog: () => void;
  hidePreviousWeekDialog: () => void;
  restorePreviousWeek: () => void;
  showRosterDialog: () => void;
  hideRosterDialog: () => void;
  exportSeatingImage: () => Promise<void>;
  getSeatingExportScript: () => string;
  hideExportDialog: () => void;
  exportDataBackup: () => void;
  triggerImportBackup: () => void;
  toggleUsageGuide: () => void;
  showCnfSyncDialog: () => void;
  hideCnfSyncDialog: () => void;
  cnfLoginAction: () => Promise<void>;
  cnfFetchAction: () => Promise<void>;
  toggleImportMenu: () => void;
  hideImportMenu: () => void;
  showRosterCheckDialog: () => void;
  syncFromCoreRoster: () => void;
  startEmptySeatingManualImport: () => void;
  showEmptySeatingMethodStep: () => void;
  showEmptySeatingScopeStep: () => void;
  hideEmptySeatingDialog: () => void;
  cancelEmptySeatingGeneration: () => void;
  generateEmptySeatingForCurrentClass: () => Promise<void>;
  generateEmptySeatingForAllClasses: () => Promise<void>;
}

const exposeToWindow = (): void => {
  const w = window as unknown as AppWindow;
  w.loadClass = loadClass;
  w.toggleTime = toggleTime;
  w.showSaveDialog = showSaveDialog;
  w.hideSaveDialog = hideSaveDialog;
  w.saveClass = saveClass;
  w.renameCurrentClass = renameCurrentClass;
  w.deleteCurrentClass = deleteCurrentClass;
  w.showImportDialog = showImportDialog;
  w.hideImportDialog = hideImportDialog;
  w.importStudents = importStudents;
  w.showCampPresetDialog = showCampPresetDialog;
  w.hideCampPresetDialog = hideCampPresetDialog;
  w.applyCampPresetSeating = applyCampPresetSeating;
  w.applySummerCampSelection = applySummerCampSelection;
  w.generateSeating = generateSeating;
  w.toggleEditMode = toggleEditMode;
  w.setTextAlign = setTextAlign;
  w.setVerticalAlign = setVerticalAlign;
  w.showBatchImportDialog = showBatchImportDialog;
  w.hideBatchImportDialog = hideBatchImportDialog;
  w.processBatchImport = processBatchImport;
  w.toggleLayout = toggleLayout;
  w.previewManualLayout = previewManualLayout;
  w.goHome = goHome;
  w.generateWeeklySeating = generateWeeklySeating;
  w.undoWeeklySeating = undoWeeklySeating;
  w.showCreateClassDialog = showCreateClassDialog;
  w.hideCreateClassDialog = hideCreateClassDialog;
  w.showImageImportDialog = showImageImportDialog;
  w.hideImageImportDialog = hideImageImportDialog;
  w.startImageRecognition = startImageRecognition;
  w.checkOCRChannel = checkOCRChannel;
  w.confirmImageImport = confirmImageImport;
  w.showManualTuneDialog = showManualTuneDialog;
  w.hideManualTuneDialog = hideManualTuneDialog;
  w.applyManualGroupCount = applyManualGroupCount;
  w.addManualTuneStudent = addManualTuneStudent;
  w.shuffleManualTuneSeats = shuffleManualTuneSeats;
  w.applyManualTune = applyManualTune;
  w.copyCurrentToOtherMode = copyCurrentToOtherMode;
  w.showPreviousWeekDialog = showPreviousWeekDialog;
  w.hidePreviousWeekDialog = hidePreviousWeekDialog;
  w.restorePreviousWeek = restorePreviousWeek;
  w.showRosterDialog = showRosterDialog;
  w.hideRosterDialog = hideRosterDialog;
  w.exportSeatingImage = exportSeatingImage;
  w.getSeatingExportScript = () => buildExportScript(getLocationInfo());
  w.hideExportDialog = hideExportDialog;
  w.exportDataBackup = exportDataBackup;
  w.triggerImportBackup = triggerImportBackup;
  w.toggleUsageGuide = toggleUsageGuide;
  w.showCnfSyncDialog = showCnfSyncDialog;
  w.hideCnfSyncDialog = hideCnfSyncDialog;
  w.cnfLoginAction = cnfLoginAction;
  w.cnfFetchAction = cnfFetchAction;
  w.toggleImportMenu = toggleImportMenu;
  w.hideImportMenu = hideImportMenu;
  w.showRosterCheckDialog = showRosterCheckDialog;
  w.syncFromCoreRoster = syncFromCoreRoster;
  w.startEmptySeatingManualImport = startEmptySeatingManualImport;
  w.showEmptySeatingMethodStep = showEmptySeatingMethodStep;
  w.showEmptySeatingScopeStep = showEmptySeatingScopeStep;
  w.hideEmptySeatingDialog = hideEmptySeatingDialog;
  w.cancelEmptySeatingGeneration = cancelEmptySeatingGeneration;
  w.generateEmptySeatingForCurrentClass = generateEmptySeatingForCurrentClass;
  w.generateEmptySeatingForAllClasses = generateEmptySeatingForAllClasses;
};

const loadProfile = (): void => {
  state.userProfile = loadUserProfile();
  ensureUsername();
  applyTheme(state.userProfile.theme);
  updateWelcome();
};

const finishInitialSeatingRender = (): void => {
  refresh();
  const launchClass = getLaunchClassName();

  if (launchClass) {
    // applyLaunchClass handles both existing and new classes
    applyLaunchClass();
  } else {
    renderClassOverview();
    setCurrentView('home');
  }

  renderReminderSummary();
  maybeShowTodayReminderAlert();
  appMountOptions.onReady?.();
};

const applyEmbeddedNavigationChrome = (): void => {
  // When embedded, the outer container already provides back, home, and class
  // switching. Hide duplicate navigation but keep theme/time-toggle/rotation config.
  if (appMountOptions.embedded || window.self !== window.top) {
    const backHomeBtn = queryOne<HTMLElement>('.back-home');
    if (backHomeBtn) {
      backHomeBtn.style.display = 'none';
    }
    const editorTopbar = queryOne<HTMLElement>('.editor-topbar');
    if (editorTopbar) {
      editorTopbar.style.display = 'none';
    }
    const floatingContext = byId<HTMLElement>('editorFloatingContext');
    if (floatingContext) {
      floatingContext.style.display = 'none';
    }
    // Hide only the class-select and its label (duplicate of outer frame), keep theme/time/rename/delete.
    const classMain = queryOne<HTMLElement>('.class-selector-main');
    if (classMain) {
      classMain.style.display = 'none';
    }
  }
};

export const initApp = (): void => {
  cleanupMountSideEffects();
  setRenderQueryRoot(appQueryRoot);
  exposeToWindow();
  loadProfile();
  loadSavedData();
  applySummerCampTheme();
  syncHistoryCopy();
  bindCoreEvents();
  bindSummerCampSeatTitleFit();
  bindNotes();
  const frame = queryOne<HTMLElement>('.main-content');
  if (frame && !frame.closest('.is-summer-camp-site')) {
    const viewport = document.createElement('div');
    viewport.className = 'seating-fixed-viewport';
    frame.before(viewport); viewport.appendChild(frame);
    const fit = () => { frame.style.zoom = String((viewport.clientWidth || 1600) / 1600); };
    const observer = new ResizeObserver(fit); observer.observe(viewport); fit();
    registerMountCleanup(() => { observer.disconnect(); viewport.replaceWith(frame); frame.style.zoom = ''; });
  }
  bindOcrReviewEvents();
  bindHomeEvents();
  initializeUsageGuide();
  updateLayoutDescription();
  updateTime();
  if (updateTimeInterval) {
    window.clearInterval(updateTimeInterval);
  }
  updateTimeInterval = window.setInterval(updateTime, 60000);
  void mergeSeatingBackupFromServer().finally(() => {
    finishInitialSeatingRender();
    applyEmbeddedNavigationChrome();
  });
};

export const disposeApp = (): void => {
  cleanupMountSideEffects();
  if (updateTimeInterval) {
    window.clearInterval(updateTimeInterval);
    updateTimeInterval = null;
  }
  if (seatingRemoteBackupTimer) {
    window.clearTimeout(seatingRemoteBackupTimer);
    seatingRemoteBackupTimer = 0;
  }
  manualTuneDraft = null;
  activeClassName = '';
  emptySeatingBatchAbortController?.abort();
  emptySeatingBatchAbortController = null;
  emptySeatingGuideClassName = '';
  emptySeatingGenerationRunning = false;
  state.currentView = 'home';
  appMountOptions = {};
  appQueryRoot = document;
  setRenderQueryRoot(document);
};
// Build: 1775967076
