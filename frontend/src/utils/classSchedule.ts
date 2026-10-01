import type { ClassInfo, DayOfWeek } from '../types';
import { loadMergedSeatingClassData } from '../services/seatingStorage';
import { loadScheduleMetaMap } from './classScheduleMeta';

export type WeeklySchedule = Partial<Record<DayOfWeek, string[]>>;
export interface ClassScheduleDetail {
  classCode: string;
  day: DayOfWeek;
  time: string;
  sortValue: number;
  source: 'seating' | 'manual' | 'makeup' | 'meta';
}

const STORAGE_KEY = 'amber_weekly_schedule';
export const ALL_DAYS: DayOfWeek[] = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

// ── Per-frame cache: avoid repeated JSON.parse of the same localStorage keys ──
let _cacheFrame = 0;
const _cache = new Map<string, unknown>();

function cachedRead<T>(key: string): T | null {
  const frame = typeof requestAnimationFrame !== 'undefined' ? Date.now() : 0;
  // Invalidate cache each ~16ms (one frame) or when explicitly cleared
  if (frame - _cacheFrame > 16) {
    _cache.clear();
    _cacheFrame = frame;
  }
  if (_cache.has(key)) return _cache.get(key) as T;
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) as T : null;
    _cache.set(key, parsed);
    return parsed;
  } catch {
    _cache.set(key, null);
    return null;
  }
}

function loadMergedSeatingData<T extends Record<string, unknown>>(): T | null {
  const merged = loadMergedSeatingClassData() as T;
  return Object.keys(merged).length > 0 ? merged : null;
}

const DAY_ORDER: Record<DayOfWeek, number> = {
  '周一': 1, '周二': 2, '周三': 3, '周四': 4,
  '周五': 5, '周六': 6, '周日': 7,
};

const NO_TIME_SORT_VALUE = 24 * 60 + 59;

export function loadWeeklySchedule(): WeeklySchedule {
  return cachedRead<WeeklySchedule>(STORAGE_KEY) ?? {};
}

export function saveWeeklySchedule(schedule: WeeklySchedule): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(schedule));
}

function normalizeDayToken(token: string): DayOfWeek | null {
  const normalized = token.replace(/\s+/g, '');
  const map: Record<string, DayOfWeek> = {
    '周一': '周一',
    '星期一': '周一',
    '周二': '周二',
    '星期二': '周二',
    '周三': '周三',
    '星期三': '周三',
    '周四': '周四',
    '星期四': '周四',
    '周五': '周五',
    '星期五': '周五',
    '周六': '周六',
    '星期六': '周六',
    '周日': '周日',
    '星期日': '周日',
    '星期天': '周日',
    '周天': '周日'
  };
  return map[normalized] ?? null;
}

function extractDaysFromClassTime(classTime: string): DayOfWeek[] {
  const matches = classTime.match(/(?:星期|周)\s*[一二三四五六日天]/g) ?? [];
  const days = matches
    .map((item) => normalizeDayToken(item))
    .filter((item): item is DayOfWeek => Boolean(item));
  return [...new Set(days)];
}

function extractTimeToken(raw: string): string {
  const normalized = raw.replace(/\s+/g, '');
  const matched = normalized.match(/(\d{1,2})[:：](\d{2})/);
  if (!matched) return '';
  const hour = matched[1].padStart(2, '0');
  return `${hour}:${matched[2]}`;
}

function parseTimeSortValue(time: string): number {
  if (!time) return NO_TIME_SORT_VALUE;
  const matched = time.match(/^(\d{2}):(\d{2})$/);
  if (!matched) return NO_TIME_SORT_VALUE;
  const hour = Number(matched[1]);
  const minute = Number(matched[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return NO_TIME_SORT_VALUE;
  return hour * 60 + minute;
}

function loadAllMakeupClasses(): Array<{ class_code: string; weekday?: { day: string; time?: string }; weekend?: { day: string; time?: string } }> {
  let allClasses: Array<{ class_code: string; weekday?: { day: string; time?: string }; weekend?: { day: string; time?: string } }> = [];

  const store = cachedRead<{ stages?: Record<string, { classes?: typeof allClasses }> }>('amber_makeup_stages');
  if (store?.stages) {
    for (const dataset of Object.values(store.stages)) {
      if (Array.isArray(dataset?.classes)) allClasses.push(...dataset.classes);
    }
  }

  if (allClasses.length === 0) {
    const data = cachedRead<{ classes?: typeof allClasses }>('amber_makeup_data');
    if (Array.isArray(data?.classes)) allClasses = data.classes;
  }

  return allClasses;
}

function loadMakeupSchedule(): WeeklySchedule {
  try {
    const allClasses = loadAllMakeupClasses();

    if (allClasses.length === 0) return {};

    const schedule: WeeklySchedule = {};
    for (const cls of allClasses) {
      for (const slot of [cls.weekday, cls.weekend]) {
        const day = slot?.day as DayOfWeek | undefined;
        if (day && ALL_DAYS.includes(day)) {
          const list = schedule[day] ?? [];
          if (!list.includes(cls.class_code)) {
            list.push(cls.class_code);
            schedule[day] = list;
          }
        }
      }
    }
    return schedule;
  } catch {
    return {};
  }
}

function loadMakeupDetails(): ClassScheduleDetail[] {
  const details: ClassScheduleDetail[] = [];
  try {
    const allClasses = loadAllMakeupClasses();

    for (const cls of allClasses) {
      for (const slot of [cls.weekday, cls.weekend]) {
        const day = normalizeDayToken(slot?.day ?? '');
        if (!day) continue;
        const time = extractTimeToken(slot?.time ?? '');
        details.push({
          classCode: cls.class_code,
          day,
          time,
          sortValue: parseTimeSortValue(time),
          source: 'makeup',
        });
      }
    }
  } catch {
    return [];
  }
  return details;
}

type SeatingData = Record<string, {
  weekday?: { locationInfo?: { weekday?: string; time?: string } };
  weekend?: { locationInfo?: { weekday?: string; time?: string } };
}>;

function loadSeatingSchedule(): WeeklySchedule {
  try {
    const parsed = loadMergedSeatingData<SeatingData>();
    if (!parsed) return {};

    const schedule: WeeklySchedule = {};
    for (const day of ALL_DAYS) {
      schedule[day] = [];
    }

    for (const [rawCode, config] of Object.entries(parsed ?? {})) {
      // Normalize to uppercase to match scraper output
      const classCode = rawCode.toUpperCase();
      const inferredDays = [
        ...(config?.weekday?.locationInfo?.weekday ? extractDaysFromClassTime(config.weekday.locationInfo.weekday) : []),
        ...extractDaysFromClassTime(
          [
            config?.weekday?.locationInfo?.weekday ?? '',
            config?.weekday?.locationInfo?.time ?? '',
            config?.weekend?.locationInfo?.weekday ?? '',
            config?.weekend?.locationInfo?.time ?? ''
          ].join(' ')
        )
      ];

      for (const day of [...new Set(inferredDays)]) {
        const current = schedule[day] ?? [];
        if (!current.includes(classCode)) {
          current.push(classCode);
          schedule[day] = current;
        }
      }
    }

    return schedule;
  } catch {
    return {};
  }
}

function loadSeatingDetails(): ClassScheduleDetail[] {
  try {
    const parsed = loadMergedSeatingData<SeatingData>();
    if (!parsed) return [];

    const details: ClassScheduleDetail[] = [];

    for (const [rawCode, config] of Object.entries(parsed ?? {})) {
      const classCode = rawCode.toUpperCase();
      for (const slot of [config?.weekday?.locationInfo, config?.weekend?.locationInfo]) {
        const rawText = [slot?.weekday ?? '', slot?.time ?? ''].join(' ');
        const days = extractDaysFromClassTime(rawText);
        const time = extractTimeToken(rawText);
        for (const day of days) {
          details.push({
            classCode,
            day,
            time,
            sortValue: parseTimeSortValue(time),
            source: 'seating',
          });
        }
      }
    }

    return details;
  } catch {
    return [];
  }
}

function loadManualDetails(): ClassScheduleDetail[] {
  const manual = loadWeeklySchedule();
  const details: ClassScheduleDetail[] = [];
  for (const day of ALL_DAYS) {
    for (const classCode of manual[day] ?? []) {
      details.push({
        classCode,
        day,
        time: '',
        sortValue: NO_TIME_SORT_VALUE,
        source: 'manual',
      });
    }
  }
  return details;
}

function loadMetaDetails(): ClassScheduleDetail[] {
  const details: ClassScheduleDetail[] = [];
  try {
    const all = loadScheduleMetaMap();
    for (const [classCode, meta] of Object.entries(all)) {
      for (const slot of [meta.weekday, meta.weekend]) {
        if (!slot) continue;
        const days = extractDaysFromClassTime(slot.day);
        const time = extractTimeToken(slot.time);
        for (const day of days) {
          details.push({
            classCode,
            day,
            time,
            sortValue: parseTimeSortValue(time),
            source: 'meta',
          });
        }
      }
    }
  } catch {
    return [];
  }
  return details;
}

function loadMetaSchedule(): WeeklySchedule {
  const schedule: WeeklySchedule = {};
  for (const detail of loadMetaDetails()) {
    const list = schedule[detail.day] ?? [];
    if (!list.includes(detail.classCode)) {
      list.push(detail.classCode);
      schedule[detail.day] = list;
    }
  }
  return schedule;
}

function uniqueDetails(details: ClassScheduleDetail[]): ClassScheduleDetail[] {
  const seen = new Set<string>();
  return details.filter((detail) => {
    const key = `${detail.classCode}_${detail.day}_${detail.time}_${detail.source}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function getClassScheduleDetails(classCode: string): ClassScheduleDetail[] {
  return uniqueDetails([
    ...loadMetaDetails(),
    ...loadSeatingDetails(),
    ...loadManualDetails(),
    ...loadMakeupDetails(),
  ])
    .filter((item) => item.classCode === classCode)
    .sort((a, b) => {
      if (DAY_ORDER[a.day] !== DAY_ORDER[b.day]) return DAY_ORDER[a.day] - DAY_ORDER[b.day];
      if (a.sortValue !== b.sortValue) return a.sortValue - b.sortValue;
      return a.classCode.localeCompare(b.classCode);
    });
}

export function getResolvedSchedule(classCodes: string[]): WeeklySchedule {
  const meta = loadMetaSchedule();
  const seating = loadSeatingSchedule();
  const manual = loadWeeklySchedule();
  const makeup = loadMakeupSchedule();
  const resolved: WeeklySchedule = {};

  for (const day of ALL_DAYS) {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const source of [meta, seating, manual, makeup]) {
      for (const code of source[day] ?? []) {
        if (classCodes.includes(code) && !seen.has(code)) {
          seen.add(code);
          result.push(code);
        }
      }
    }
    resolved[day] = result;
  }

  const detailMap = new Map<string, ClassScheduleDetail>();
  for (const detail of uniqueDetails([
    ...loadMetaDetails(),
    ...loadSeatingDetails(),
    ...loadManualDetails(),
    ...loadMakeupDetails(),
  ])) {
    if (!classCodes.includes(detail.classCode)) continue;
    const key = `${detail.classCode}_${detail.day}`;
    const existing = detailMap.get(key);
    if (!existing || detail.sortValue < existing.sortValue) {
      detailMap.set(key, detail);
    }
  }

  for (const day of ALL_DAYS) {
    resolved[day] = [...(resolved[day] ?? [])].sort((a, b) => {
      const detailA = detailMap.get(`${a}_${day}`);
      const detailB = detailMap.get(`${b}_${day}`);
      const sortA = detailA?.sortValue ?? NO_TIME_SORT_VALUE;
      const sortB = detailB?.sortValue ?? NO_TIME_SORT_VALUE;
      if (sortA !== sortB) return sortA - sortB;
      return a.localeCompare(b);
    });
  }

  return resolved;
}

export function getClassDays(classCode: string): DayOfWeek[] {
  const sched = getResolvedSchedule([classCode]);
  return ALL_DAYS.filter((d) => (sched[d] ?? []).includes(classCode));
}

/** Returns the start time string (e.g. "18:20") for a class on a given day, or '' if unknown. */
export function getClassTimeOnDay(classCode: string, day: DayOfWeek): string {
  const details = getClassScheduleDetails(classCode);
  const match = details.find((d) => d.day === day && d.time);
  return match?.time ?? '';
}

export function sortClassesBySchedule(classes: ClassInfo[]): ClassInfo[] {
  const detailMap = new Map<string, ClassScheduleDetail[]>();
  for (const item of classes) {
    detailMap.set(item.name, getClassScheduleDetails(item.name));
  }

  return [...classes].sort((a, b) => {
    const detailA = detailMap.get(a.name) ?? [];
    const detailB = detailMap.get(b.name) ?? [];
    const minA = detailA.length ? DAY_ORDER[detailA[0].day] : 8;
    const minB = detailB.length ? DAY_ORDER[detailB[0].day] : 8;
    if (minA !== minB) return minA - minB;
    const timeA = detailA[0]?.sortValue ?? NO_TIME_SORT_VALUE;
    const timeB = detailB[0]?.sortValue ?? NO_TIME_SORT_VALUE;
    if (timeA !== timeB) return timeA - timeB;
    return a.name.localeCompare(b.name);
  });
}

export function getOrderedChallengeDays(classCode: string): DayOfWeek[] {
  const details = getClassScheduleDetails(classCode);
  const firstDay = details[0]?.day ?? getClassDays(classCode)[0] ?? '周一';
  const startIndex = ALL_DAYS.indexOf(firstDay);
  if (startIndex === -1) return [...ALL_DAYS];
  return [...ALL_DAYS.slice(startIndex), ...ALL_DAYS.slice(0, startIndex)];
}
