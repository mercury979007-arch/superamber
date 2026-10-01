import type * as XLSX from 'xlsx';
import type { MakeupDataset, MakeupClassMeta, MakeupOccurrence, MakeupSlot, StageKey, MultiStageStore } from '../types/makeup';
import { ALL_STAGES } from '../types/makeup';
import { getBundledScheduleMetaMap } from './classScheduleMeta';
import { getXlsx } from './xlsxFile';
import { getWeekNumber as getSchoolWeekNumber } from '../seating/calendar';
import { getWeek1StartDate } from './weekNumber';
import { extractScheduleWorkbook } from './scheduleExtraction.mjs';
import amberManifest from '../../public/amber/4.13/manifest.json';
import academicCalendar from '../../../config/academic-calendar.json';

const STORAGE_KEY = 'amber_makeup_data'; // legacy single-stage key
const MULTI_STAGE_KEY = 'amber_makeup_stages';
const bundledScheduleMetaMap = getBundledScheduleMetaMap();
const AMBER_DATA_FORMAT_VERSION = 8;
export const AMBER_BUNDLE_REVISION = amberManifest.version;
export const AMBER_BUNDLED_STAGES = Object.keys(amberManifest.stages) as StageKey[];
const loadXlsx = (): Promise<typeof XLSX> => getXlsx();

function isAmberManagedDataset(data: MakeupDataset | null | undefined): boolean {
  if (!data) return false;
  const meta = data.meta || {};
  if (meta.source_kind === 'amber_bundle') return true;
  const sourceName = String(meta.source_name || '');
  return sourceName.includes('Amber课表') || sourceName.includes('Amber 4.13');
}

export function isAmberDatasetStale(data: MakeupDataset | null | undefined): boolean {
  if (!isAmberManagedDataset(data)) return false;
  return Number(data?.meta?.data_format_version || 0) < AMBER_DATA_FORMAT_VERSION || data?.meta?.bundle_revision !== AMBER_BUNDLE_REVISION;
}

export function shouldSyncAmberBundle(): boolean {
  const stages = loadMultiStageStore().stages;
  return AMBER_BUNDLED_STAGES.some(stage => !stages[stage] || isAmberDatasetStale(stages[stage]));
}

// ── Multi-stage localStorage persistence ──

export function loadMultiStageStore(): MultiStageStore {
  try {
    const raw = localStorage.getItem(MULTI_STAGE_KEY);
    if (raw) return JSON.parse(raw) as MultiStageStore;
  } catch { /* fall through */ }

  // Migrate legacy single-stage data
  try {
    const legacy = localStorage.getItem(STORAGE_KEY);
    if (legacy) {
      const data = JSON.parse(legacy) as MakeupDataset;
      const stage = (data.meta?.active_stage || 'L2') as StageKey;
      const store: MultiStageStore = { stages: { [stage]: data }, activeStage: stage };
      try {
        localStorage.setItem(MULTI_STAGE_KEY, JSON.stringify(store));
        localStorage.removeItem(STORAGE_KEY);
      } catch { /* Keep the legacy data usable when storage is full. */ }
      return store;
    }
  } catch { /* fall through */ }

  return { stages: {}, activeStage: 'L2' };
}

export function saveMultiStageStore(store: MultiStageStore): void {
  localStorage.setItem(MULTI_STAGE_KEY, JSON.stringify(store));
}

export function isStorageQuotaExceeded(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const name = String((error as { name?: unknown }).name || '');
  const message = String((error as { message?: unknown }).message || '');
  return name === 'QuotaExceededError'
    || name === 'NS_ERROR_DOM_QUOTA_REACHED'
    || /quota/i.test(message)
    || /storage/i.test(message) && /exceed/i.test(message);
}

export function loadStageData(stage: StageKey): MakeupDataset | null {
  const store = loadMultiStageStore();
  return store.stages[stage] ?? null;
}

export function saveStageData(stage: StageKey, data: MakeupDataset): void {
  const store = loadMultiStageStore();
  store.stages[stage] = data;
  store.activeStage = stage;
  saveMultiStageStore(store);
}

export function replaceStoreWithSingleStage(stage: StageKey, data: MakeupDataset): void {
  saveMultiStageStore({
    stages: { [stage]: data },
    activeStage: stage,
  });
}

export function replaceStoreWithBundle(
  bundle: Partial<Record<StageKey, MakeupDataset>>,
  preferredStage: StageKey,
  preserveUploads = false,
): StageKey {
  // A new bundled L1/L2 schedule must not delete a teacher's other stages.
  const stages: Partial<Record<StageKey, MakeupDataset>> = { ...loadMultiStageStore().stages };
  for (const stage of ALL_STAGES) {
    const data = bundle[stage];
    if (data && !(preserveUploads && stages[stage] && !isAmberManagedDataset(stages[stage]))) stages[stage] = data;
  }
  const activeStage = stages[preferredStage]
    ? preferredStage
    : (ALL_STAGES.find((stage) => !!stages[stage]) || preferredStage);
  saveMultiStageStore({ stages, activeStage });
  localStorage.removeItem(STORAGE_KEY);
  return activeStage;
}

export function clearStageData(stage: StageKey): void {
  const store = loadMultiStageStore();
  delete store.stages[stage];
  saveMultiStageStore(store);
}

export function getLoadedStages(): { stage: StageKey; classCount: number; occCount: number }[] {
  const store = loadMultiStageStore();
  const result: { stage: StageKey; classCount: number; occCount: number }[] = [];
  for (const s of ALL_STAGES) {
    const d = store.stages[s];
    if (d && d.classes.length > 0 && d.occurrences.length > 0) {
      result.push({ stage: s, classCount: d.classes.length, occCount: d.occurrences.length });
    }
  }
  return result;
}

// Legacy compat — returns any loaded data (first available stage)
export function loadMakeupData(): MakeupDataset | null {
  const store = loadMultiStageStore();
  return store.stages[store.activeStage] ?? Object.values(store.stages)[0] ?? null;
}

export function saveMakeupData(data: MakeupDataset): void {
  const stage = (data.meta?.active_stage || 'L2') as StageKey;
  saveStageData(stage, data);
}

export function clearMakeupData(): void {
  const store = loadMultiStageStore();
  delete store.stages[store.activeStage];
  saveMultiStageStore(store);
}

interface AmberManifestEntry {
  name: string;
  url: string;
}

interface AmberManifest {
  version: string;
  label: string;
  updatedAt: string;
  stages: Partial<Record<StageKey, AmberManifestEntry[]>>;
}

async function loadAmberManifest(version: string): Promise<AmberManifest> {
  const manifestRes = await fetch(`/amber/${version}/manifest.json`, { cache: 'no-store' });
  if (!manifestRes.ok) {
    throw new Error(`无法读取 Amber ${version} 清单`);
  }
  return manifestRes.json() as Promise<AmberManifest>;
}

// ── JSON import ──

export async function parseJsonImport(file: File): Promise<MakeupDataset> {
  const text = await file.text();
  const data = JSON.parse(text) as MakeupDataset;
  if (!Array.isArray(data.classes) || !Array.isArray(data.occurrences)) {
    throw new Error('JSON 格式不正确：缺少 classes 或 occurrences');
  }
  return data;
}

function mergeMakeupDatasets(stage: StageKey, datasets: MakeupDataset[], sourceLabel: string): MakeupDataset {
  if (datasets.length === 0) {
    throw new Error('没有可合并的课表数据');
  }
  if (datasets.length === 1) {
    return {
      ...datasets[0],
      meta: {
        ...datasets[0].meta,
        active_stage: stage,
        source_name: sourceLabel,
        source_kind: 'amber_bundle',
        has_grade: datasets[0].meta.has_grade ?? detectDatasetHasGrade(datasets[0].classes),
        data_format_version: AMBER_DATA_FORMAT_VERSION,
      },
    };
  }

  const classMap = new Map<string, MakeupClassMeta>();
  const occurrenceMap = new Map<string, MakeupOccurrence>();
  const slotMap = new Map<string, MakeupSlot>();
  const invalidWeekLabels = new Set<string>();
  const supportedStages = new Map<string, MakeupDataset['meta']['supported_stages'][number]>();

  for (const dataset of datasets) {
    for (const meta of dataset.classes) {
      classMap.set(meta.class_code, meta);
    }
    for (const occ of dataset.occurrences) {
      occurrenceMap.set(occ.id, occ);
    }
    for (const slot of dataset.slots) {
      slotMap.set(`${slot.day}|${slot.time}`, slot);
    }
    for (const label of dataset.meta.invalid_week_labels || []) {
      invalidWeekLabels.add(label);
    }
    for (const item of dataset.meta.supported_stages || []) {
      supportedStages.set(item.key, item);
    }
  }

  const classes = [...classMap.values()].sort((a, b) => a.class_code.localeCompare(b.class_code));
  const occurrences = [...occurrenceMap.values()].sort((a, b) => {
    if (a.class_code !== b.class_code) return a.class_code.localeCompare(b.class_code);
    if (a.week_col !== b.week_col) return a.week_col - b.week_col;
    return a.id.localeCompare(b.id);
  });
  const slots = [...slotMap.values()].sort((a, b) => (DAY_SORT[a.day] ?? 9) - (DAY_SORT[b.day] ?? 9) || a.time.localeCompare(b.time));

  return {
    classes,
    occurrences,
    slots,
    meta: {
      active_stage: stage,
      supported_stages: [...supportedStages.values()],
      source_name: sourceLabel,
      source_kind: 'amber_bundle',
      imported_at: new Date().toISOString().replace(/\.\d+Z$/, ''),
      invalid_week_labels: [...invalidWeekLabels],
      has_grade: detectDatasetHasGrade(classes),
      data_format_version: AMBER_DATA_FORMAT_VERSION,
    },
  };
}

export async function importAmberScheduleVersion(version: string, stage: StageKey): Promise<MakeupDataset> {
  const manifest = await loadAmberManifest(version);
  const entries = manifest.stages?.[stage] || [];
  if (!entries.length) {
    throw new Error(`Amber ${version} 暂未提供 ${stage} 学段课表`);
  }

  const datasets: MakeupDataset[] = [];
  for (const entry of entries) {
    const fileRes = await fetch(entry.url, { cache: 'no-store' });
    if (!fileRes.ok) {
      throw new Error(`无法下载 ${entry.name}`);
    }
    const blob = await fileRes.blob();
    const filename = entry.url.split('/').pop() || `${stage}.xlsx`;
    const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
    datasets.push(await parseXlsxImport(file, stage));
  }

  const label = `${manifest.label} · ${stage}`;
  const merged = mergeMakeupDatasets(stage, datasets, label);
  merged.meta.bundle_revision = manifest.version;
  return merged;
}

export async function importAmberScheduleBundle(
  version: string,
  onProgress?: (msg: string) => void,
): Promise<Partial<Record<StageKey, MakeupDataset>>> {
  const manifest = await loadAmberManifest(version);
  const result: Partial<Record<StageKey, MakeupDataset>> = {};
  const stagesWithEntries = ALL_STAGES.filter((s) => (manifest.stages?.[s] || []).length > 0);
  const errors: string[] = [];
  for (let si = 0; si < stagesWithEntries.length; si++) {
    const stage = stagesWithEntries[si];
    const entries = manifest.stages?.[stage] || [];
    onProgress?.(`正在同步 ${stage}（${si + 1}/${stagesWithEntries.length}）...`);
    try {
      const datasets: MakeupDataset[] = [];
      for (const entry of entries) {
        const fileRes = await fetch(entry.url, { cache: 'no-store' });
        if (!fileRes.ok) {
          throw new Error(`无法下载 ${entry.name}`);
        }
        const blob = await fileRes.blob();
        const filename = entry.url.split('/').pop() || `${stage}.xlsx`;
        const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
        datasets.push(await parseXlsxImport(file, stage));
      }
      result[stage] = mergeMakeupDatasets(stage, datasets, `${manifest.label} · ${stage}`);
      result[stage]!.meta.bundle_revision = manifest.version;
    } catch (err) {
      errors.push(`${stage}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (errors.length > 0) {
    throw new Error('课表同步不完整，未替换现有数据：' + errors.join('；'));
  }
  return result;
}

// ── XLSX import ──

const DAY_MAP: Record<string, string> = {
  '星期一': '周一', '星期二': '周二', '星期三': '周三', '星期四': '周四',
  '星期五': '周五', '星期六': '周六', '星期日': '周日',
  '周一': '周一', '周二': '周二', '周三': '周三', '周四': '周四',
  '周五': '周五', '周六': '周六', '周日': '周日', '周天': '周日',
};

const DAY_SORT: Record<string, number> = {
  '周一': 1,
  '周二': 2,
  '周三': 3,
  '周四': 4,
  '周五': 5,
  '周六': 6,
  '周日': 7,
};

function normalizeSpace(val: unknown): string {
  if (val === null || val === undefined) return '';
  let s = String(val);
  if (typeof val === 'number' && Number.isInteger(val)) s = String(val);
  return s.replace(/\r/g, '').replace(/\s+/g, ' ').trim();
}

function normalizeDay(val: unknown): string {
  const s = normalizeSpace(val);
  return DAY_MAP[s] || s;
}

function normalizeTime(val: unknown): string {
  const s = normalizeSpace(val);
  if (!s) return '';
  const m = s.match(/^(\d{1,2}):(\d{2})/);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : s;
}

function normalizeLesson(val: unknown): string {
  return normalizeSpace(String(val ?? '').replace(/\n/g, ' '));
}

function normalizeGrade(val: unknown): string {
  const s = normalizeSpace(val);
  if (!s) return '';
  if (/^[一二三四五六七八九十]年级$/.test(s)) return s;
  if (/^\d{1,2}年级$/.test(s)) return s;
  const digitMatch = s.match(/(\d{1,2})\s*年级/);
  if (digitMatch) return `${digitMatch[1]}年级`;
  const chineseMatch = s.match(/([一二三四五六七八九十])\s*年级/);
  if (chineseMatch) return `${chineseMatch[1]}年级`;
  return s;
}

function inferGrade(rawGrade: unknown, batch: string): string {
  const normalized = normalizeGrade(rawGrade);
  if (normalized) return normalized;
  const fromBatch = normalizeGrade(batch);
  return fromBatch;
}

function inferCampus(room: string): string {
  room = normalizeSpace(room);
  if (!room) return '';
  if (room.startsWith('七彩')) return '七彩';
  if (room.startsWith('C86')) return 'C86';
  const m = room.match(/^([A-Za-z0-9+]+校区|[A-Za-z0-9+]+)/);
  return m ? m[1] : room;
}

function timeToMin(t: string): number | null {
  const m = t.match(/^(\d{1,2}):(\d{2})/);
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
}

function minToTime(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

const DEFAULT_LESSON_DURATION = 60; // minutes
const CONSECUTIVE_GAP_TOLERANCE = 15; // minutes between consecutive lessons

/**
 * Merge consecutive occurrences for the same class on the same day/week.
 * e.g., J293 周六 14:55-15:55 + 16:00-17:00 → single occurrence 14:55-17:00
 */
function mergeConsecutiveOccurrences(occurrences: MakeupOccurrence[]): MakeupOccurrence[] {
  // Group by class_code + week_label + day
  const groups = new Map<string, MakeupOccurrence[]>();
  for (const occ of occurrences) {
    const key = `${occ.class_code}|${occ.week_label}|${occ.day}`;
    const arr = groups.get(key) || [];
    arr.push(occ);
    groups.set(key, arr);
  }

  const result: MakeupOccurrence[] = [];
  for (const [, group] of groups) {
    if (group.length <= 1) {
      result.push(...group);
      continue;
    }

    // Parse start times and sort
    const withTimes = group.map((occ) => {
      const startMin = timeToMin(occ.time);
      return { occ, startMin };
    }).sort((a, b) => (a.startMin ?? 0) - (b.startMin ?? 0));

    // Try to merge consecutive entries
    let i = 0;
    while (i < withTimes.length) {
      const base = withTimes[i];
      if (base.startMin == null) {
        result.push(base.occ);
        i++;
        continue;
      }

      let mergedStart = base.startMin;
      let mergedEnd = base.startMin + DEFAULT_LESSON_DURATION;
      const lessons: string[] = [base.occ.lesson];
      let j = i + 1;

      while (j < withTimes.length) {
        const next = withTimes[j];
        if (next.startMin == null) break;
        const nextStart = next.startMin;
        if (nextStart <= mergedEnd + CONSECUTIVE_GAP_TOLERANCE) {
          mergedEnd = Math.max(mergedEnd, nextStart + DEFAULT_LESSON_DURATION);
          if (!lessons.includes(next.occ.lesson)) lessons.push(next.occ.lesson);
          j++;
        } else {
          break;
        }
      }

      if (j > i + 1) {
        // Merged — create a combined occurrence
        const merged: MakeupOccurrence = {
          ...base.occ,
          time: `${minToTime(mergedStart)}-${minToTime(mergedEnd)}`,
          lesson: lessons.join(' + '),
          id: `${base.occ.class_code}__${base.occ.week_label}__${base.occ.mode}__merged`,
        };
        result.push(merged);
      } else {
        result.push(base.occ);
      }
      i = j;
    }
  }

  return result;
}

function parseRangeStart(range: string): string {
  const match = normalizeSpace(range).match(/(\d{1,2}:\d{2})\s*[-—~～]\s*(\d{1,2}:\d{2})/);
  return match ? normalizeTime(match[1]) : '';
}

function parseCourseInfoDetail(raw: unknown): {
  day: string;
  room: string;
  time: string;
  classCode: string;
  stage: string;
  course: string;
  teacher: string;
  headTeacher: string;
  note: string;
  studentCount: string;
  grade: string;
} {
  const parts = normalizeSpace(raw).split('|').map((item) => normalizeSpace(item));
  return {
    day: normalizeDay(parts[0] || ''),
    room: parts[1] || '',
    time: parseRangeStart(parts[2] || ''),
    classCode: (parts[3] || '').toUpperCase(),
    stage: parts[4] || '',
    course: parts[5] || '',
    teacher: parts[6] || '',
    headTeacher: parts[7] || '',
    note: parts[8] || '',
    studentCount: parts[9] || '',
    grade: normalizeGrade(parts[10] || ''),
  };
}

function modeFromWeekLabel(label: string): '周中' | '周末' | '' {
  const s = normalizeSpace(label);
  if (s.includes('周中')) return '周中';
  if (s.includes('周末')) return '周末';
  return '';
}

function detectStageFromName(name: string): StageKey {
  const m = name.match(/L(\d)/i);
  if (m) {
    const key = `L${m[1]}` as StageKey;
    if (ALL_STAGES.includes(key)) return key;
  }
  return 'L2'; // default
}

function indexOfNth(headers: string[], label: string, nth = 1): number {
  let count = 0;
  for (let i = 0; i < headers.length; i++) {
    if (headers[i] !== label) continue;
    count += 1;
    if (count === nth) return i;
  }
  return -1;
}

function indexOfAnyNth(headers: string[], labels: string[], nth = 1): number {
  let count = 0;
  const normalized = new Set(labels.map((label) => normalizeSpace(label)));
  for (let i = 0; i < headers.length; i++) {
    if (!normalized.has(headers[i])) continue;
    count += 1;
    if (count === nth) return i;
  }
  return -1;
}

function resolveScheduleColumnPair(
  headers: string[],
  explicitDayLabels: string[],
  genericLabels: string[],
  explicitTimeLabels: string[],
): { dayIdx: number; timeIdx: number } {
  const explicitDayIdx = indexOfAnyNth(headers, explicitDayLabels, 1);
  const explicitTimeIdx = indexOfAnyNth(headers, explicitTimeLabels, 1);
  const genericFirstIdx = indexOfAnyNth(headers, genericLabels, 1);
  const genericSecondIdx = indexOfAnyNth(headers, genericLabels, 2);

  const dayIdx = explicitDayIdx >= 0 ? explicitDayIdx : genericFirstIdx;
  let timeIdx = explicitTimeIdx;
  if (timeIdx < 0) {
    timeIdx = genericSecondIdx >= 0 ? genericSecondIdx : genericFirstIdx;
  }

  return { dayIdx, timeIdx };
}

function findHeaderRow(rows: unknown[][]): number {
  for (let i = 0; i < rows.length; i++) {
    const cells = (rows[i] as unknown[]).map((v) => normalizeSpace(v).replace(/\n/g, ' '));
    if (!cells.includes('班级')) continue;
    const weekdayHits = cells.filter((v) => v === '周内时间' || v === '周中时间').length;
    const weekendHits = cells.filter((v) => v === '周末时间').length;
    if (weekdayHits >= 1 && weekendHits >= 1) return i;
  }
  return 0;
}

function isRecognizedProgressSheet(rows: unknown[][]): boolean {
  if (rows.length < 2) return false;
  const headerRowIndex = findHeaderRow(rows);
  const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const headerRow = rows[headerRowIndex] as unknown[] | undefined;
  if (!headerRow) return false;
  const headers = Array.from({ length: columnCount }, (_, idx) => normalizeSpace(headerRow[idx]).replace(/\n/g, ' '));
  const classIdx = indexOfNth(headers, '班级', 1);
  const lessonStartIdx = Math.max(
    headers.findIndex((h) => isDateLikeHeader(h)),
    headers.findIndex((h) => h.includes('开学第一节')),
    headers.findIndex((h) => h.includes('上学期常规课')),
  );
  return classIdx >= 0 && lessonStartIdx >= 0;
}

function isRowBasedProgressSheet(rows: unknown[][]): boolean {
  if (rows.length < 2) return false;
  const firstRow = rows[0] as unknown[];
  const header = Array.from({ length: firstRow.length }, (_, idx) => normalizeSpace(firstRow[idx]).replace(/\n/g, ' '));
  const classIdx = indexOfNth(header, '班级', 1);
  const courseInfoIdx = indexOfNth(header, '课程信息', 1);
  const dayIdx = indexOfAnyNth(header, ['星期', '上课星期', '周几'], 1);
  const lessonStartIdx = Math.max(
    header.findIndex((h) => isDateLikeHeader(h)),
    header.findIndex((h) => h.includes('进度')),
  );
  // Accept sheets with 课程信息, or those with 班级 + day column + date columns (e.g., L5)
  if (classIdx >= 0 && courseInfoIdx >= 0 && dayIdx >= 0 && lessonStartIdx >= 0) return true;
  if (classIdx >= 0 && dayIdx >= 0 && lessonStartIdx >= 0 && courseInfoIdx < 0) return true;
  return false;
}

function isOccurrenceScheduleSheet(rows: unknown[][]): boolean {
  if (rows.length < 2) return false;
  const firstRow = rows[0] as unknown[];
  const header = Array.from({ length: firstRow.length }, (_, idx) => normalizeSpace(firstRow[idx]).replace(/\n/g, ' '));
  const classIdx = indexOfNth(header, '班级', 1);
  const courseInfoIdx = indexOfNth(header, '课程信息', 1);
  const dayIdx = indexOfAnyNth(header, ['星期', '上课星期', '周几'], 1);
  const startTimeIdx = indexOfAnyNth(header, ['上课时间'], 1);
  return classIdx >= 0 && courseInfoIdx >= 0 && dayIdx >= 0 && startTimeIdx >= 0;
}

function isBatchProgressSheet(rows: unknown[][]): boolean {
  if (rows.length < 2) return false;
  const firstRow = rows[0] as unknown[];
  const header = Array.from({ length: firstRow.length }, (_, idx) => normalizeSpace(firstRow[idx]).replace(/\n/g, ' '));
  const classIdx = indexOfNth(header, '班级', 1);
  const batchIdx = indexOfAnyNth(header, ['批次', '班级', '班级号'], 1);
  const weekdayDayIdx = indexOfAnyNth(header, ['周中时间', '周内时间', '周中星期', '周内星期'], 1);
  const weekendDayIdx = indexOfAnyNth(header, ['周末时间', '周末星期'], 1);
  const weekdayCampusIdx = indexOfAnyNth(header, ['周中校区', '周内校区'], 1);
  const weekendCampusIdx = indexOfAnyNth(header, ['周末校区'], 1);
  const lessonStartIdx = Math.max(
    header.findIndex((h) => isDateLikeHeader(h)),
    header.findIndex((h) => h.includes('进度')),
    header.findIndex((h) => /^Week\s*\d+/i.test(h)),
  );
  return classIdx < 0 && batchIdx >= 0 && weekdayDayIdx >= 0 && weekendDayIdx >= 0 && weekdayCampusIdx >= 0 && weekendCampusIdx >= 0 && lessonStartIdx >= 0;
}

function isDateLikeHeader(label: string): boolean {
  const s = normalizeSpace(label);
  return /^W\d+/i.test(s) || /(?:\d{1,2}\.\d{1,2})(?:\s*[-—]\s*\d{1,2}\.\d{1,2})?/.test(s);
}

function parseDateParts(label: string): { sm: number; sd: number; em: number; ed: number } | null {
  const s = normalizeSpace(label).replace(/\s+/g, '');
  const range = s.match(/(\d{1,2})\.(\d{1,2})(?:[-—](\d{1,2})\.(\d{1,2}))?/);
  if (!range) return null;
  const sm = parseInt(range[1], 10);
  const sd = parseInt(range[2], 10);
  const em = range[3] ? parseInt(range[3], 10) : sm;
  const ed = range[4] ? parseInt(range[4], 10) : sd;
  return { sm, sd, em, ed };
}

function parseExplicitWeekNumber(label: string): number | null {
  const match = normalizeSpace(label).match(/^W\s*(\d+)/i);
  return match ? parseInt(match[1], 10) : null;
}

function getSchoolYears(sourceName: string): { startYear: number; endYear: number } {
  const explicit = sourceName.match(/20\d{2}/);
  if (explicit) {
    const endYear = parseInt(explicit[0], 10);
    return { startYear: endYear - 1, endYear };
  }
  const now = new Date();
  const endYear = now.getMonth() + 1 >= 7 ? now.getFullYear() + 1 : now.getFullYear();
  return { startYear: endYear - 1, endYear };
}

function toSchoolDate(month: number, day: number, years: { startYear: number; endYear: number }): Date {
  const year = month >= 7 ? years.startYear : years.endYear;
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

function formatRange(parts: { sm: number; sd: number; em: number; ed: number }): string {
  return `${parts.sm}.${parts.sd}-${parts.em}.${parts.ed}`;
}

function mondayKey(date: Date): string {
  const monday = new Date(date);
  const weekday = (monday.getDay() + 6) % 7;
  monday.setDate(monday.getDate() - weekday);
  return monday.toISOString().slice(0, 10);
}

function getCurrentTermWeekOneStart(endYear: number): Date {
  const configured = getWeek1StartDate();
  const startYear = configured.getMonth() >= 6 ? endYear - 1 : endYear;
  return new Date(startYear, configured.getMonth(), configured.getDate(), 12, 0, 0, 0);
}

function buildWeekBaseLabel(
  parts: { sm: number; sd: number; em: number; ed: number },
  years: { startYear: number; endYear: number },
  explicitWeekNum: number | null,
): string {
  const rangeText = formatRange(parts);
  if (explicitWeekNum != null) {
    return `W${explicitWeekNum} [${rangeText}]`;
  }

  const startDate = toSchoolDate(parts.sm, parts.sd, years);
  const currentTermWeekOneStart = getCurrentTermWeekOneStart(years.endYear);
  if (startDate >= currentTermWeekOneStart) {
    const weekNum = getSchoolWeekNumber(startDate);
    return `W${weekNum} [${rangeText}]`;
  }

  return `上学期 [${rangeText}]`;
}

function inferModes(rawLabel: string, helperText: string, parts: { sm: number; sd: number; em: number; ed: number } | null): Array<'周中' | '周末'> {
  const combined = `${helperText} ${rawLabel}`.replace(/\s+/g, '');
  const hasWeekday = /周内|周中|补周[一二三四五]/.test(combined);
  const hasWeekend = /周末|周六|周天|周日/.test(combined);
  if (hasWeekday && !hasWeekend) return ['周中'];
  if (hasWeekend && !hasWeekday) return ['周末'];
  if (hasWeekday && hasWeekend) return ['周中', '周末'];
  if (!parts) return [];
  const start = new Date(2024, parts.sm - 1, parts.sd);
  const end = new Date(2024, parts.em - 1, parts.ed);
  const spanDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
  return spanDays <= 2 ? ['周末'] : ['周中'];
}

function shouldSkipLesson(lesson: string): boolean {
  const normalized = normalizeLesson(lesson).replace(/[／]/g, '/');
  if (!normalized) return true;
  if (['/', '\\', '放假', '假期', '不上课'].includes(normalized)) return true;
  return false;
}

function parseDateCellParts(raw: unknown): { date: Date | null; day: string } {
  const normalized = normalizeSpace(raw);
  const dayMatch = normalized.match(/(星期[一二三四五六日天]|周[一二三四五六日天])/);
  const dateMatch = normalized.match(/(20\d{2})[\/.-](\d{1,2})[\/.-](\d{1,2})/);
  const day = normalizeDay(dayMatch?.[1] || '');
  if (!dateMatch) return { date: null, day };
  const year = parseInt(dateMatch[1], 10);
  const month = parseInt(dateMatch[2], 10);
  const dayNum = parseInt(dateMatch[3], 10);
  return { date: new Date(year, month - 1, dayNum, 12, 0, 0, 0), day };
}

function formatMonthDay(date: Date): string {
  return `${date.getMonth() + 1}.${date.getDate()}`;
}

function buildWeekLabelLookup(
  occurrences: MakeupOccurrence[],
  years: { startYear: number; endYear: number },
): Map<string, string> {
  const lookup = new Map<string, string>();
  for (const occ of occurrences) {
    const parts = parseDateParts(occ.week_label);
    if (!parts) continue;
    const key = mondayKey(toSchoolDate(parts.sm, parts.sd, years));
    lookup.set(`${key}|${occ.mode}`, occ.week_label);
    if (!lookup.has(key)) {
      lookup.set(key, occ.week_label);
    }
  }
  return lookup;
}

function inferModeFromText(text: string): '周中' | '周末' | '' {
  const normalized = normalizeSpace(text);
  if (!normalized) return '';
  if (/周末|周六|周日|周天/.test(normalized)) return '周末';
  if (/周中|周内|周一|周二|周三|周四|周五/.test(normalized)) return '周中';
  return '';
}

function detectDatasetHasGrade(classes: MakeupClassMeta[]): boolean {
  return classes.some((item) => !!normalizeSpace(item.grade));
}

export async function parseXlsxImport(file: File, stageOverride?: StageKey): Promise<MakeupDataset> {
  const XLSX = await loadXlsx();
  const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), {type:'array'});
  return extractScheduleWorkbook({filename:file.name,sheets:wb.SheetNames.map(name=>({
    name,rows:XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name],{header:1,raw:false,dateNF:'yyyy-mm-dd'}),merges:wb.Sheets[name]['!merges'],
  }))},{stage:stageOverride??detectStageFromName(file.name),calendar:academicCalendar.currentTerm});
}

// Historical implementation retained only for explicit migration comparisons.
// Normal imports never fall back to this parser or its bundled old timetable.
export async function parseLegacyXlsxImport(file: File, stageOverride?: StageKey): Promise<MakeupDataset> {
  const XLSX = await loadXlsx();
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
  const detectedStage = stageOverride ?? detectStageFromName(file.name);

  const sheetCandidates = wb.SheetNames.map((sheetName) => ({
    sheetName,
    rows: XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], { header: 1, raw: false, dateNF: 'HH:mm:ss' }),
  }));
  const preferredSheet =
    sheetCandidates.find((item) => item.sheetName.includes('班主任查阅') && isBatchProgressSheet(item.rows))
    || sheetCandidates.find((item) => item.sheetName.includes('数据表') && isBatchProgressSheet(item.rows))
    || sheetCandidates.find((item) => item.sheetName.includes('进度表') && isRecognizedProgressSheet(item.rows))
    || sheetCandidates.find((item) => isRecognizedProgressSheet(item.rows))
    || sheetCandidates.find((item) => isBatchProgressSheet(item.rows))
    || sheetCandidates.find((item) => isRowBasedProgressSheet(item.rows));

  if (!preferredSheet) {
    throw new Error('找不到可识别的进度表工作表，请确认文件里包含班级、时间和进度日期列');
  }

  const rows = preferredSheet.rows;
  if (rows.length < 2) throw new Error('进度表为空');

  if (isRowBasedProgressSheet(rows)) {
    return parseRowBasedProgressSheet(rows, file.name, wb, detectedStage, XLSX);
  }

  if (isRecognizedProgressSheet(rows)) {
    // Fall through to the standard total-sheet parser below.
  } else if (isBatchProgressSheet(rows)) {
    return parseBatchProgressSheet(rows, file.name, wb, detectedStage, XLSX);
  }

  const headerRowIndex = findHeaderRow(rows);
  const helperRows = rows.slice(0, headerRowIndex);
  const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const headerRow = rows[headerRowIndex] as unknown[];
  const headers = Array.from({ length: columnCount }, (_, idx) => normalizeSpace(headerRow[idx]).replace(/\n/g, ' '));
  const years = getSchoolYears(file.name);

  const classIdx = indexOfNth(headers, '班级', 1);
  const batchIdx = indexOfAnyNth(headers, ['开班批次', '入学时间'], 1);
  const typeIdx = indexOfAnyNth(headers, ['类型(细分)', '班级类型', '类型', '课程类型'], 1);
  const gradeIdx = indexOfAnyNth(headers, ['年级', '主体年级', '所属年级', '学生年级', 'Grade'], 1);
  const studentCountIdx = indexOfAnyNth(headers, ['班级人数', '人数(权威)', '人数', '学生数'], 1);
  const { dayIdx: weekdayDayIdx, timeIdx: weekdayTimeIdx } = resolveScheduleColumnPair(
    headers,
    ['周内星期', '周中星期', '周内日期', '周中日期', '上课时间(周中)', '上课时间（周中）'],
    ['周内时间', '周中时间'],
    ['周内上课时间', '周中上课时间'],
  );
  const { dayIdx: weekendDayIdx, timeIdx: weekendTimeIdx } = resolveScheduleColumnPair(
    headers,
    ['周末星期', '周末日期', '上课时间(周末)', '上课时间（周末）'],
    ['周末时间'],
    ['周末上课时间'],
  );
  const weekdayTeacherIdx = indexOfAnyNth(headers, ['周内教师', '周中教师', '周中任课教师'], 1);
  const weekendTeacherIdx = indexOfAnyNth(headers, ['周末教师', '周末任课教师'], 1);
  const headTeacherIdx = indexOfAnyNth(headers, ['周内班主任', '班主任', '班主任匹配'], 1);
  const weekdayRoomIdx = indexOfAnyNth(headers, ['周内教室', '周中教室'], 1);
  const weekendRoomIdx = indexOfNth(headers, '周末教室', 1);
  const lessonStartIdx = Math.max(
    headers.findIndex((h) => isDateLikeHeader(h)),
    headers.findIndex((h) => h.includes('开学第一节')),
    headers.findIndex((h) => h.includes('上学期常规课')),
  );
  if (classIdx < 0 || lessonStartIdx < 0) {
    throw new Error('进度表表头结构无法识别，请确认是否仍为总表原始格式');
  }

  const weekCols: Array<{ colIdx: number; labels: Array<{ mode: '周中' | '周末'; weekLabel: string }> }> = [];
  const invalidWeekLabels: string[] = [];
  for (let i = lessonStartIdx; i < headers.length; i++) {
    const rawLabel = headers[i];
    const helperText = helperRows.map((row) => normalizeSpace((row as unknown[])[i])).filter(Boolean).join(' ');
    if (!rawLabel && !helperText) continue;

    const parts = parseDateParts(rawLabel);
    const modes = inferModes(rawLabel, helperText, parts);
    if (!parts || modes.length === 0) {
      if (rawLabel && !invalidWeekLabels.includes(rawLabel)) invalidWeekLabels.push(rawLabel);
      continue;
    }

    const explicitWeekNum = parseExplicitWeekNumber(rawLabel);
    const weekBaseLabel = buildWeekBaseLabel(parts, years, explicitWeekNum);
    weekCols.push({
      colIdx: i,
      labels: modes.map((mode) => ({
        mode,
        weekLabel: weekBaseLabel.replace(' [', ` ${mode} [`),
      })),
    });
  }

  const classes: Record<string, MakeupClassMeta> = {};
  const occurrences: MakeupOccurrence[] = [];
  const slotOrder: Record<string, MakeupSlot> = {};

  for (let r = headerRowIndex + 1; r < rows.length; r++) {
    const row = rows[r] as unknown[];
    const classCode = normalizeSpace(row[classIdx]).toUpperCase();
    if (!classCode) continue;

    const weekdayRoom = weekdayRoomIdx >= 0 ? normalizeSpace(row[weekdayRoomIdx]) : '';
    const weekendRoom = weekendRoomIdx >= 0 ? normalizeSpace(row[weekendRoomIdx]) : '';
    const batch = batchIdx >= 0 ? normalizeSpace(row[batchIdx]) : '';

    const meta: MakeupClassMeta = {
      class_code: classCode,
      batch,
      type: typeIdx >= 0 ? normalizeSpace(row[typeIdx]) : '',
      head_teacher: headTeacherIdx >= 0 ? normalizeSpace(row[headTeacherIdx]) : '',
      grade: inferGrade(gradeIdx >= 0 ? row[gradeIdx] : '', batch),
      student_count: studentCountIdx >= 0 ? normalizeSpace(row[studentCountIdx]) : '',
      weekday: {
        day: weekdayDayIdx >= 0 ? normalizeDay(row[weekdayDayIdx]) : '',
        time: weekdayTimeIdx >= 0 ? normalizeTime(row[weekdayTimeIdx]) : '',
        teacher: weekdayTeacherIdx >= 0 ? normalizeSpace(row[weekdayTeacherIdx]) : '',
        campus: inferCampus(weekdayRoom),
        room: weekdayRoom,
      },
      weekend: {
        day: weekendDayIdx >= 0 ? normalizeDay(row[weekendDayIdx]) : '',
        time: weekendTimeIdx >= 0 ? normalizeTime(row[weekendTimeIdx]) : '',
        teacher: weekendTeacherIdx >= 0 ? normalizeSpace(row[weekendTeacherIdx]) : '',
        campus: inferCampus(weekendRoom),
        room: weekendRoom,
      },
    };

    const bundledMeta = bundledScheduleMetaMap[classCode];
    if (bundledMeta?.weekday && (!meta.weekday.day || !meta.weekday.time)) {
      meta.weekday = {
        day: meta.weekday.day || bundledMeta.weekday.day,
        time: meta.weekday.time || bundledMeta.weekday.time,
        teacher: meta.weekday.teacher,
        campus: meta.weekday.campus || bundledMeta.weekday.campus,
        room: meta.weekday.room || bundledMeta.weekday.room,
      };
    }
    if (bundledMeta?.weekend && (!meta.weekend.day || !meta.weekend.time)) {
      meta.weekend = {
        day: meta.weekend.day || bundledMeta.weekend.day,
        time: meta.weekend.time || bundledMeta.weekend.time,
        teacher: meta.weekend.teacher,
        campus: meta.weekend.campus || bundledMeta.weekend.campus,
        room: meta.weekend.room || bundledMeta.weekend.room,
      };
    }
    classes[classCode] = meta;

    for (const schedule of [meta.weekday, meta.weekend]) {
      if (schedule.day && schedule.time) {
        const key = `${schedule.day} ${schedule.time}`;
        slotOrder[key] ??= { day: schedule.day, time: schedule.time };
      }
    }

    for (const { colIdx, labels } of weekCols) {
      const lesson = normalizeLesson(row[colIdx]);
      if (shouldSkipLesson(lesson)) continue;
      for (const { mode, weekLabel } of labels) {
        const schedule = mode === '周中' ? meta.weekday : meta.weekend;
        if (!schedule.day || !schedule.time) continue;
        occurrences.push({
          id: `${classCode}__${weekLabel}__${mode}`,
          class_code: classCode,
          week_label: weekLabel,
          week_col: colIdx + 1,
          mode,
          lesson,
          day: schedule.day,
          time: schedule.time,
          teacher: schedule.teacher,
          campus: schedule.campus,
          room: schedule.room,
          grade: meta.grade,
          type: meta.type,
          head_teacher: meta.head_teacher,
          student_count: meta.student_count,
        });
      }
    }
  }

  const slots = Object.values(slotOrder).sort((a, b) => (DAY_SORT[a.day] ?? 9) - (DAY_SORT[b.day] ?? 9) || a.time.localeCompare(b.time));
  const classList = Object.values(classes).sort((a, b) => a.class_code.localeCompare(b.class_code));
  if (!classList.length) throw new Error('没有识别到任何班级，请确认班级列是否存在');
  if (!occurrences.length) throw new Error('没有识别到任何课次，请确认总表仍包含日期列和进度内容');

  // Extract stage catalog from other sheets
  const supportedStages = extractStageCatalog(wb, classList.length, occurrences.length, XLSX);

  const baseDataset: MakeupDataset = {
    classes: classList,
    occurrences: mergeConsecutiveOccurrences(occurrences),
    slots,
    meta: {
      active_stage: detectedStage,
      supported_stages: supportedStages,
      source_name: file.name,
      imported_at: new Date().toISOString().replace(/\.\d+Z$/, ''),
      invalid_week_labels: invalidWeekLabels,
      has_grade: detectDatasetHasGrade(classList),
      data_format_version: AMBER_DATA_FORMAT_VERSION,
    },
  };

  return mergeMissingRowBasedClasses(baseDataset, wb, detectedStage, XLSX);
}

function parseBatchProgressSheet(
  rows: unknown[][],
  sourceName: string,
  wb: XLSX.WorkBook,
  detectedStage: StageKey,
  XLSX: typeof import('xlsx'),
): MakeupDataset {
  const firstRow = rows[0] as unknown[];
  const header = Array.from({ length: firstRow.length }, (_, idx) => normalizeSpace(firstRow[idx]).replace(/\n/g, ' '));
  const batchIdx = indexOfAnyNth(header, ['批次', '班级', '班级号'], 1);
  const headTeacherIdx = indexOfAnyNth(header, ['班主任', '现班主任', '班主任匹配'], 1);
  const weekdayDayIdx = indexOfAnyNth(header, ['周中时间', '周内时间', '周中星期', '周内星期'], 1);
  const weekdayTimeIdx = indexOfAnyNth(header, ['课程时间', '周中上课时间', '周内上课时间'], 1);
  const weekdayCampusIdx = indexOfAnyNth(header, ['周中校区', '周内校区'], 1);
  const weekdayRoomIdx = indexOfAnyNth(header, ['周中地点', '周内地点', '周中教室', '周内教室'], 1);
  const weekdayTeacherIdx = indexOfAnyNth(header, ['周中教师', '周内教师'], 1);
  const weekendDayIdx = indexOfAnyNth(header, ['周末时间', '周末星期'], 1);
  const weekendTimeIdx = indexOfNth(header, '课程时间', 2) >= 0
    ? indexOfNth(header, '课程时间', 2)
    : indexOfAnyNth(header, ['周末上课时间'], 1);
  const weekendCampusIdx = indexOfAnyNth(header, ['周末校区'], 1);
  const weekendRoomIdx = indexOfAnyNth(header, ['周末地点', '周末教室'], 1);
  const weekendTeacherIdx = indexOfAnyNth(header, ['周末教师'], 1);
  const lessonStartIdx = Math.max(
    header.findIndex((h) => isDateLikeHeader(h)),
    header.findIndex((h) => h.includes('进度')),
    header.findIndex((h) => /^Week\s*\d+/i.test(h)),
  );

  if (batchIdx < 0 || weekdayDayIdx < 0 || weekendDayIdx < 0 || lessonStartIdx < 0) {
    throw new Error('Amber 学段批次表结构不完整，缺少批次、周中/周末时间或进度列');
  }

  const years = getSchoolYears(sourceName);
  const invalidWeekLabels: string[] = [];
  const weekCols: Array<{ colIdx: number; weekBaseLabel: string; mode: '周中' | '周末' | '' }> = [];
  let syntheticWeekNum = 1;
  for (let i = lessonStartIdx; i < header.length; i++) {
    const rawLabel = header[i];
    const sampleValue = rows.slice(1).map((row) => normalizeLesson((row as unknown[])[i])).find((item) => !!item) || '';
    if (!rawLabel && !sampleValue) continue;
    const parts = parseDateParts(rawLabel);
    if (!parts) {
      const mode = modeFromWeekLabel(rawLabel) || inferModeFromText(rawLabel) || inferModeFromText(sampleValue);
      weekCols.push({
        colIdx: i,
        weekBaseLabel: `W${syntheticWeekNum++} [列${i + 1}]`,
        mode,
      });
      if (rawLabel && !invalidWeekLabels.includes(rawLabel)) invalidWeekLabels.push(rawLabel);
      continue;
    }
    const explicitWeekNum = parseExplicitWeekNumber(rawLabel);
    weekCols.push({
      colIdx: i,
      weekBaseLabel: buildWeekBaseLabel(parts, years, explicitWeekNum),
      mode: modeFromWeekLabel(rawLabel),
    });
  }

  const classes = new Map<string, MakeupClassMeta>();
  const occurrences = new Map<string, MakeupOccurrence>();
  const slotOrder = new Map<string, MakeupSlot>();

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] as unknown[];
    const classCode = normalizeSpace(row[batchIdx]).toUpperCase();
    if (!classCode) continue;

    const headTeacher = headTeacherIdx >= 0 ? normalizeSpace(row[headTeacherIdx]) : '';
    const weekdayDay = normalizeDay(row[weekdayDayIdx]);
    const weekdayTime = weekdayTimeIdx >= 0 ? normalizeTime(row[weekdayTimeIdx]) : '';
    const weekdayCampus = weekdayCampusIdx >= 0 ? normalizeSpace(row[weekdayCampusIdx]) : '';
    const weekdayRoom = weekdayRoomIdx >= 0 ? normalizeSpace(row[weekdayRoomIdx]) : '';
    const weekdayTeacher = weekdayTeacherIdx >= 0 ? normalizeSpace(row[weekdayTeacherIdx]) : '';
    const weekendDay = normalizeDay(row[weekendDayIdx]);
    const weekendTime = weekendTimeIdx >= 0 ? normalizeTime(row[weekendTimeIdx]) : '';
    const weekendCampus = weekendCampusIdx >= 0 ? normalizeSpace(row[weekendCampusIdx]) : '';
    const weekendRoom = weekendRoomIdx >= 0 ? normalizeSpace(row[weekendRoomIdx]) : '';
    const weekendTeacher = weekendTeacherIdx >= 0 ? normalizeSpace(row[weekendTeacherIdx]) : '';

    const existing = classes.get(classCode) || {
      class_code: classCode,
      batch: classCode,
      type: detectedStage,
      head_teacher: headTeacher,
      grade: '',
      student_count: '',
      weekday: { day: '', time: '', teacher: '', campus: '', room: '' },
      weekend: { day: '', time: '', teacher: '', campus: '', room: '' },
    };

    if (weekdayDay && weekdayTime && !existing.weekday.day) {
      existing.weekday = { day: weekdayDay, time: weekdayTime, teacher: weekdayTeacher, campus: weekdayCampus || inferCampus(weekdayRoom), room: weekdayRoom };
    }
    if (weekendDay && weekendTime && !existing.weekend.day) {
      existing.weekend = { day: weekendDay, time: weekendTime, teacher: weekendTeacher, campus: weekendCampus || inferCampus(weekendRoom), room: weekendRoom };
    }
    if (!existing.head_teacher) existing.head_teacher = headTeacher;
    classes.set(classCode, existing);

    for (const [day, time] of [[weekdayDay, weekdayTime], [weekendDay, weekendTime]] as const) {
      if (day && time) slotOrder.set(`${day}|${time}`, { day, time });
    }

    for (const week of weekCols) {
      const lesson = normalizeLesson(row[week.colIdx]);
      if (shouldSkipLesson(lesson)) continue;

      const modes = week.mode ? [week.mode] : ([
        weekdayDay && weekdayTime ? '周中' : null,
        weekendDay && weekendTime ? '周末' : null,
      ].filter(Boolean) as Array<'周中' | '周末'>);

      for (const mode of modes) {
        const schedule = mode === '周中'
          ? { day: weekdayDay, time: weekdayTime, teacher: weekdayTeacher, campus: weekdayCampus || inferCampus(weekdayRoom), room: weekdayRoom }
          : { day: weekendDay, time: weekendTime, teacher: weekendTeacher, campus: weekendCampus || inferCampus(weekendRoom), room: weekendRoom };
        if (!schedule.day || !schedule.time) continue;
        const weekLabel = week.weekBaseLabel.replace(' [', ` ${mode} [`);
        const occ: MakeupOccurrence = {
          id: `${classCode}__r${r}__${mode}__${weekLabel}`,
          class_code: classCode,
          week_label: weekLabel,
          week_col: week.colIdx + 1,
          mode,
          lesson,
          day: schedule.day,
          time: schedule.time,
          teacher: schedule.teacher,
          campus: schedule.campus,
          room: schedule.room,
          grade: '',
          type: detectedStage,
          head_teacher: headTeacher,
          student_count: '',
        };
        occurrences.set(occ.id, occ);
      }
    }
  }

  const classList = [...classes.values()].sort((a, b) => a.class_code.localeCompare(b.class_code));
  const occurrenceList = [...occurrences.values()].sort((a, b) => {
    if (a.class_code !== b.class_code) return a.class_code.localeCompare(b.class_code);
    if (a.week_col !== b.week_col) return a.week_col - b.week_col;
    return a.id.localeCompare(b.id);
  });
  const slots = [...slotOrder.values()].sort((a, b) => (DAY_SORT[a.day] ?? 9) - (DAY_SORT[b.day] ?? 9) || a.time.localeCompare(b.time));

  if (!classList.length) throw new Error('没有识别到任何批次班级，请确认 Amber 学段表是否包含批次列');
  if (!occurrenceList.length) throw new Error('没有识别到任何课次，请确认 Amber 学段表是否包含进度列');

  const mergedOccs = mergeConsecutiveOccurrences(occurrenceList);
  return {
    classes: classList,
    occurrences: mergedOccs,
    slots,
    meta: {
      active_stage: detectedStage,
      supported_stages: extractStageCatalog(wb, classList.length, mergedOccs.length, XLSX),
      source_name: sourceName,
      imported_at: new Date().toISOString().replace(/\.\d+Z$/, ''),
      invalid_week_labels: invalidWeekLabels,
      has_grade: detectDatasetHasGrade(classList),
      data_format_version: AMBER_DATA_FORMAT_VERSION,
    },
  };
}

function parseRowBasedProgressSheet(
  rows: unknown[][],
  sourceName: string,
  wb: XLSX.WorkBook,
  detectedStage: StageKey,
  XLSX: typeof import('xlsx'),
): MakeupDataset {
  const firstRow = rows[0] as unknown[];
  const header = Array.from({ length: firstRow.length }, (_, idx) => normalizeSpace(firstRow[idx]).replace(/\n/g, ' '));
  const classIdx = indexOfNth(header, '班级', 1);
  const stageIdx = indexOfAnyNth(header, ['Stage', '学段', '类型', '班级类型'], 1);
  const courseIdx = indexOfAnyNth(header, ['课程', '课程类型'], 1);
  const teacherIdx = indexOfAnyNth(header, ['教师', '老师'], 1);
  const headTeacherIdx = indexOfAnyNth(header, ['现班主任', '班主任'], 1);
  const dayIdx = indexOfAnyNth(header, ['星期', '上课星期', '周几'], 1);
  const campusIdx = indexOfAnyNth(header, ['校区'], 1);
  const roomIdx = indexOfAnyNth(header, ['教室'], 1);
  const courseInfoIdx = indexOfNth(header, '课程信息', 1);
  const lessonStartIdx = Math.max(
    header.findIndex((h) => isDateLikeHeader(h)),
    header.findIndex((h) => h.includes('进度')),
  );

  if (classIdx < 0 || dayIdx < 0 || lessonStartIdx < 0) {
    throw new Error('Amber 学段表结构不完整，缺少班级、星期或进度列');
  }

  const years = getSchoolYears(sourceName);
  const invalidWeekLabels: string[] = [];
  const weekCols: Array<{ colIdx: number; weekBaseLabel: string }> = [];
  for (let i = lessonStartIdx; i < header.length; i++) {
    const rawLabel = header[i];
    if (!rawLabel) continue;
    const parts = parseDateParts(rawLabel);
    if (!parts) {
      if (!invalidWeekLabels.includes(rawLabel)) invalidWeekLabels.push(rawLabel);
      continue;
    }
    const explicitWeekNum = parseExplicitWeekNumber(rawLabel);
    weekCols.push({
      colIdx: i,
      weekBaseLabel: buildWeekBaseLabel(parts, years, explicitWeekNum),
    });
  }

  const classes = new Map<string, MakeupClassMeta>();
  const occurrences = new Map<string, MakeupOccurrence>();
  const slotOrder = new Map<string, MakeupSlot>();

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] as unknown[];
    const classCode = normalizeSpace(row[classIdx]).toUpperCase();
    if (!classCode) continue;

    const detail = courseInfoIdx >= 0 ? parseCourseInfoDetail(row[courseInfoIdx]) : { day: '', time: '', room: '', classCode: '', stage: '', course: '', teacher: '', headTeacher: '', note: '', studentCount: '', grade: '' };
    const rawDay = normalizeDay(row[dayIdx]);
    const day = rawDay || detail.day;
    const room = (roomIdx >= 0 ? normalizeSpace(row[roomIdx]) : '') || detail.room;
    const campus = (campusIdx >= 0 ? normalizeSpace(row[campusIdx]) : '') || inferCampus(room);
    const time = detail.time;
    const teacher = (teacherIdx >= 0 ? normalizeSpace(row[teacherIdx]) : '') || detail.teacher;
    const headTeacher = (headTeacherIdx >= 0 ? normalizeSpace(row[headTeacherIdx]) : '') || detail.headTeacher;
    const grade = detail.grade || normalizeGrade(row[indexOfAnyNth(header, ['年级', '所属年级', 'Grade'], 1)]);
    const stageValue = (stageIdx >= 0 ? normalizeSpace(row[stageIdx]) : '') || detail.stage || detectedStage;
    const courseName = (courseIdx >= 0 ? normalizeSpace(row[courseIdx]) : '') || detail.course;
    const studentCount = detail.studentCount;
    const batch = normalizeSpace(sourceName);

    const existing = classes.get(classCode) || {
      class_code: classCode,
      batch,
      type: stageValue,
      head_teacher: headTeacher,
      grade,
      student_count: studentCount,
      weekday: { day: '', time: '', teacher: '', campus: '', room: '' },
      weekend: { day: '', time: '', teacher: '', campus: '', room: '' },
    };

    const target = day === '周六' || day === '周日' ? existing.weekend : existing.weekday;
    if (day && time) {
      target.day = day;
      target.time = time;
      target.teacher = teacher;
      target.campus = campus;
      target.room = room;
      slotOrder.set(`${day}|${time}`, { day, time });
    }
    if (!existing.head_teacher) existing.head_teacher = headTeacher;
    if (!existing.grade) existing.grade = grade;
    if (!existing.student_count) existing.student_count = studentCount;
    if (!existing.type) existing.type = stageValue;
    classes.set(classCode, existing);

    const mode = day === '周六' || day === '周日' ? '周末' : '周中';
    for (const week of weekCols) {
      const lesson = normalizeLesson(row[week.colIdx]);
      if (shouldSkipLesson(lesson) || !day || !time) continue;
      const weekLabel = week.weekBaseLabel.replace(' [', ` ${mode} [`);
      const occ: MakeupOccurrence = {
        id: `${classCode}__${courseName || lesson}__${weekLabel}`,
        class_code: classCode,
        week_label: weekLabel,
        week_col: week.colIdx + 1,
        mode,
        lesson,
        day,
        time,
        teacher,
        campus,
        room,
        grade,
        type: stageValue,
        head_teacher: headTeacher,
        student_count: studentCount,
      };
      occurrences.set(occ.id, occ);
    }
  }

  const classList = [...classes.values()].sort((a, b) => a.class_code.localeCompare(b.class_code));
  const occurrenceList = [...occurrences.values()].sort((a, b) => {
    if (a.class_code !== b.class_code) return a.class_code.localeCompare(b.class_code);
    if (a.week_col !== b.week_col) return a.week_col - b.week_col;
    return a.id.localeCompare(b.id);
  });
  const slots = [...slotOrder.values()].sort((a, b) => (DAY_SORT[a.day] ?? 9) - (DAY_SORT[b.day] ?? 9) || a.time.localeCompare(b.time));

  if (!classList.length) throw new Error('没有识别到任何班级，请确认 Amber 学段表是否包含班级列');
  if (!occurrenceList.length) throw new Error('没有识别到任何课次，请确认 Amber 学段表是否包含进度列');

  const mergedOccs2 = mergeConsecutiveOccurrences(occurrenceList);
  return {
    classes: classList,
    occurrences: mergedOccs2,
    slots,
    meta: {
      active_stage: detectedStage,
      supported_stages: extractStageCatalog(wb, classList.length, mergedOccs2.length, XLSX),
      source_name: sourceName,
      imported_at: new Date().toISOString().replace(/\.\d+Z$/, ''),
      invalid_week_labels: invalidWeekLabels,
      has_grade: detectDatasetHasGrade(classList),
      data_format_version: AMBER_DATA_FORMAT_VERSION,
    },
  };
}

function extractStageCatalog(
  wb: XLSX.WorkBook,
  classCount: number,
  lessonCount: number,
  XLSX: typeof import('xlsx'),
): MakeupDataset['meta']['supported_stages'] {
  const counts: Record<string, Record<string, number>> = { weekday: {}, weekend: {} };
  for (const [sheetName, bucket] of [['周中', 'weekday'], ['周末', 'weekend']] as const) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1 });
    for (let r = 1; r < rows.length; r++) {
      const family = normalizeStageFamily(normalizeSpace((rows[r] as unknown[])[1]));
      if (family) counts[bucket][family] = (counts[bucket][family] || 0) + 1;
    }
  }

  const allKeys = new Set([...Object.keys(counts.weekday), ...Object.keys(counts.weekend)]);
  const sorted = [...allKeys].sort((a, b) => (a === 'L2' ? -1 : b === 'L2' ? 1 : a.localeCompare(b)));

  const stages = sorted.map((key) => ({
    key,
    label: key,
    enabled: key === 'L2',
    status: key === 'L2' ? '已接入' : '预留中',
    weekday_count: counts.weekday[key] || 0,
    weekend_count: counts.weekend[key] || 0,
    entry_count: (counts.weekday[key] || 0) + (counts.weekend[key] || 0),
    note: key === 'L2' ? '当前可直接补课匹配' : '已预留学段位，后续补进度映射即可启用',
    ...(key === 'L2' ? { class_count: classCount, lesson_count: lessonCount } : {}),
  }));

  if (!stages.some((s) => s.key === 'L2')) {
    stages.unshift({
      key: 'L2', label: 'L2', enabled: true, status: '已接入',
      weekday_count: 0, weekend_count: 0, entry_count: 0,
      note: '当前可直接补课匹配', class_count: classCount, lesson_count: lessonCount,
    });
  }
  return stages;
}

function mergeMissingRowBasedClasses(
  baseDataset: MakeupDataset,
  wb: XLSX.WorkBook,
  detectedStage: StageKey,
  XLSX: typeof import('xlsx'),
): MakeupDataset {
  const existingClassCodes = new Set(baseDataset.classes.map((item) => item.class_code));
  const extraClassMap = new Map<string, MakeupClassMeta>();
  const extraOccurrenceMap = new Map<string, MakeupOccurrence>();
  const slotMap = new Map<string, MakeupSlot>(
    baseDataset.slots.map((slot) => [`${slot.day}|${slot.time}`, slot]),
  );
  const years = getSchoolYears(baseDataset.meta.source_name);
  const weekLabelLookup = buildWeekLabelLookup(baseDataset.occurrences, years);

  for (const [sheetName, bucket] of [['周中', 'weekday'], ['周末', 'weekend']] as const) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, dateNF: 'HH:mm:ss' });
    if (isRowBasedProgressSheet(rows)) {
      const parsed = parseRowBasedProgressSheet(rows, `${baseDataset.meta.source_name}#${sheetName}`, wb, detectedStage, XLSX);
      for (const meta of parsed.classes) {
        if (existingClassCodes.has(meta.class_code)) continue;
        const current = extraClassMap.get(meta.class_code) || {
          ...meta,
          weekday: { day: '', time: '', teacher: '', campus: '', room: '' },
          weekend: { day: '', time: '', teacher: '', campus: '', room: '' },
        };
        const sourceSchedule = bucket === 'weekday' ? meta.weekday : meta.weekend;
        const targetSchedule = bucket === 'weekday' ? current.weekday : current.weekend;
        if (sourceSchedule.day) {
          targetSchedule.day = sourceSchedule.day;
          targetSchedule.time = sourceSchedule.time;
          targetSchedule.teacher = sourceSchedule.teacher;
          targetSchedule.campus = sourceSchedule.campus;
          targetSchedule.room = sourceSchedule.room;
        }
        if (!current.type) current.type = meta.type;
        if (!current.head_teacher) current.head_teacher = meta.head_teacher;
        if (!current.grade) current.grade = meta.grade;
        if (!current.student_count) current.student_count = meta.student_count;
        extraClassMap.set(meta.class_code, current);
      }
      for (const occ of parsed.occurrences) {
        if (existingClassCodes.has(occ.class_code)) continue;
        extraOccurrenceMap.set(occ.id, occ);
        slotMap.set(`${occ.day}|${occ.time}`, { day: occ.day, time: occ.time });
      }
      continue;
    }
    if (!isOccurrenceScheduleSheet(rows)) continue;

    const headerRow = rows[0] as unknown[];
    const header = Array.from({ length: headerRow.length }, (_, idx) => normalizeSpace(headerRow[idx]).replace(/\n/g, ' '));
    const classIdx = indexOfNth(header, '班级', 1);
    const stageIdx = indexOfAnyNth(header, ['Stage', '学段', '类型', '班级类型'], 1);
    const courseIdx = indexOfAnyNth(header, ['课程', '课程类型'], 1);
    const teacherIdx = indexOfAnyNth(header, ['教师', '老师'], 1);
    const headTeacherIdx = indexOfAnyNth(header, ['现班主任', '班主任'], 1);
    const dayIdx = indexOfAnyNth(header, ['星期', '上课星期', '周几'], 1);
    const campusIdx = indexOfAnyNth(header, ['校区'], 1);
    const roomIdx = indexOfAnyNth(header, ['教室'], 1);
    const courseInfoIdx = indexOfNth(header, '课程信息', 1);
    const startTimeIdx = indexOfAnyNth(header, ['上课时间'], 1);
    const endTimeIdx = indexOfAnyNth(header, ['下课时间'], 1);

    for (let r = 1; r < rows.length; r++) {
      const row = rows[r] as unknown[];
      const classCode = normalizeSpace(row[classIdx]).toUpperCase();
      if (!classCode || existingClassCodes.has(classCode)) continue;

      const detail = parseCourseInfoDetail(row[courseInfoIdx]);
      const dateInfo = parseDateCellParts(row[dayIdx]);
      const day = dateInfo.day || detail.day;
      const time = normalizeTime(row[startTimeIdx]) || detail.time;
      const endTime = normalizeTime(row[endTimeIdx]);
      if (!day || !time || !dateInfo.date) continue;
      const room = (roomIdx >= 0 ? normalizeSpace(row[roomIdx]) : '') || detail.room;
      const campus = (campusIdx >= 0 ? normalizeSpace(row[campusIdx]) : '') || inferCampus(room);
      const teacher = (teacherIdx >= 0 ? normalizeSpace(row[teacherIdx]) : '') || detail.teacher;
      const headTeacher = (headTeacherIdx >= 0 ? normalizeSpace(row[headTeacherIdx]) : '') || detail.headTeacher;
      const grade = detail.grade || normalizeGrade(row[indexOfAnyNth(header, ['年级', '所属年级', 'Grade'], 1)]);
      const stageValue = (stageIdx >= 0 ? normalizeSpace(row[stageIdx]) : '') || detail.stage || detectedStage;
      const lesson = (courseIdx >= 0 ? normalizeSpace(row[courseIdx]) : '') || detail.course || '常规课';
      const studentCount = detail.studentCount;
      const mode: '周中' | '周末' = (day === '周六' || day === '周日') ? '周末' : '周中';

      const current = extraClassMap.get(classCode) || {
        class_code: classCode,
        batch: `${baseDataset.meta.source_name}#${sheetName}`,
        type: stageValue,
        head_teacher: headTeacher,
        grade,
        student_count: studentCount,
        weekday: { day: '', time: '', teacher: '', campus: '', room: '' },
        weekend: { day: '', time: '', teacher: '', campus: '', room: '' },
      };
      const targetSchedule = mode === '周末' ? current.weekend : current.weekday;
      targetSchedule.day = day;
      targetSchedule.time = time;
      targetSchedule.teacher = teacher;
      targetSchedule.campus = campus;
      targetSchedule.room = room;
      if (!current.type) current.type = stageValue;
      if (!current.head_teacher) current.head_teacher = headTeacher;
      if (!current.grade) current.grade = grade;
      if (!current.student_count) current.student_count = studentCount;
      extraClassMap.set(classCode, current);

      const monday = new Date(dateInfo.date);
      monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      const friday = new Date(monday);
      friday.setDate(monday.getDate() + 4);
      const saturday = new Date(monday);
      saturday.setDate(monday.getDate() + 5);
      const weekKey = `${mondayKey(dateInfo.date)}|${mode}`;
      const matchedWeekLabel = weekLabelLookup.get(weekKey) || weekLabelLookup.get(mondayKey(dateInfo.date));
      const weekTagMatch = matchedWeekLabel?.match(/W\d+/i);
      const weekTag = weekTagMatch ? weekTagMatch[0].toUpperCase() : 'W0';
      const rangeStart = mode === '周末' ? formatMonthDay(saturday) : formatMonthDay(monday);
      const rangeEnd = mode === '周末' ? formatMonthDay(sunday) : formatMonthDay(friday);
      const weekLabel = `${weekTag} ${mode} [${rangeStart}-${rangeEnd}]`;

      const occ: MakeupOccurrence = {
        id: `${classCode}__${weekLabel}__${time}`,
        class_code: classCode,
        week_label: weekLabel,
        week_col: 10000 + r,
        mode,
        lesson,
        day,
        time,
        teacher,
        campus,
        room,
        grade,
        type: stageValue,
        head_teacher: headTeacher,
        student_count: studentCount,
      };
      extraOccurrenceMap.set(occ.id, occ);
      slotMap.set(`${day}|${time}`, { day, time });
      if (endTime) {
        slotMap.set(`${day}|${endTime}`, { day, time: endTime });
      }
    }
  }

  if (extraClassMap.size === 0 && extraOccurrenceMap.size === 0) {
    return baseDataset;
  }

  const classes = [...baseDataset.classes, ...extraClassMap.values()]
    .sort((a, b) => a.class_code.localeCompare(b.class_code));
  const occurrences = [...baseDataset.occurrences, ...extraOccurrenceMap.values()]
    .sort((a, b) => {
      if (a.class_code !== b.class_code) return a.class_code.localeCompare(b.class_code);
      if (a.week_col !== b.week_col) return a.week_col - b.week_col;
      return a.id.localeCompare(b.id);
    });
  const slots = [...slotMap.values()]
    .sort((a, b) => (DAY_SORT[a.day] ?? 9) - (DAY_SORT[b.day] ?? 9) || a.time.localeCompare(b.time));

  return {
    ...baseDataset,
    classes,
    occurrences,
    slots,
    meta: {
      ...baseDataset.meta,
      has_grade: detectDatasetHasGrade(classes),
    },
  };
}

function normalizeStageFamily(val: string): string {
  if (!val) return '';
  const patterns: [RegExp, string][] = [
    [/L0/i, 'L0'], [/L1/i, 'L1'], [/L2/i, 'L2'], [/L3/i, 'L3'],
    [/L4/i, 'L4'], [/L5/i, 'L5'], [/L6/i, 'L6'],
    [/PreA\+/i, 'PreA+'], [/S班/, 'S班'], [/二段/, '二段'], [/中文/, '中文'],
  ];
  for (const [re, family] of patterns) {
    if (re.test(val)) return family;
  }
  return val;
}
