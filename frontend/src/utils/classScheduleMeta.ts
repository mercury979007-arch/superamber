import type * as XLSX from 'xlsx';
import type { ClassInfo, DayOfWeek } from '../types';
import defaultScheduleMetaData from '../data/defaultClassScheduleMeta.json';
import { getXlsx } from './xlsxFile';
import { saveAppCacheValue } from './appPersistence';

const STORAGE_KEY = 'amber_class_schedule_meta_v1';

export interface ScheduleMetaSlot {
  day: string;
  time: string;
  campus: string;
  floor?: string;
  room: string;
  rawCount: number;
}

export interface ClassScheduleMeta {
  classCode: string;
  weekday?: ScheduleMetaSlot;
  weekend?: ScheduleMetaSlot;
  updatedAt: number;
}

type ScheduleMetaMap = Record<string, ClassScheduleMeta>;

type ParsedRow = {
  classCode: string;
  day: string;
  time: string;
  campus: string;
  floor: string;
  room: string;
};

type RoomPieces = {
  campus: string;
  floor: string;
  room: string;
};

const DAY_MAP: Record<string, DayOfWeek> = {
  '星期一': '周一',
  '星期二': '周二',
  '星期三': '周三',
  '星期四': '周四',
  '星期五': '周五',
  '星期六': '周六',
  '星期日': '周日',
  '星期天': '周日',
  '周一': '周一',
  '周二': '周二',
  '周三': '周三',
  '周四': '周四',
  '周五': '周五',
  '周六': '周六',
  '周日': '周日',
  '周天': '周日',
};

const DAY_ORDER: Record<string, number> = {
  '周一': 1,
  '周二': 2,
  '周三': 3,
  '周四': 4,
  '周五': 5,
  '周六': 6,
  '周日': 7,
};

const loadXlsxModule = (): Promise<typeof XLSX> => getXlsx();

function normalizeText(value: unknown): string {
  return String(value ?? '').replace(/\r/g, '').replace(/\s+/g, ' ').trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeClassCode(value: unknown): string {
  return normalizeText(value).toUpperCase();
}

function normalizeDay(value: unknown): string {
  return DAY_MAP[normalizeText(value)] || normalizeText(value);
}

function normalizeTime(value: unknown): string {
  const text = normalizeText(value);
  if (!text) return '';
  const matched = text.match(/(\d{1,2}):(\d{2})(?::\d{2})?/);
  if (!matched) return text;
  return `${matched[1].padStart(2, '0')}:${matched[2]}`;
}

function normalizeTimeRange(start: unknown, end: unknown): string {
  const startText = normalizeTime(start);
  const endText = normalizeTime(end);
  if (startText && endText) return `${startText}-${endText}`;
  return startText || endText;
}

function normalizeCampus(value: unknown): string {
  const text = normalizeText(value);
  if (!text) return '';
  const pieces = text.split('/').map((item) => item.trim()).filter(Boolean).map((item) => {
    if (item === 'C86' || item === 'C86校区') return 'C86校区';
    if (item === '七彩' || item === '七彩校区') return '七彩校区';
    if (item === '十中' || item === '十中校区') return '十中校区';
    return item;
  });
  return [...new Set(pieces)].join(' / ');
}

function normalizeRoomPieces(campusValue: unknown, roomValue: unknown): RoomPieces {
  const campus = normalizeCampus(campusValue);
  let room = normalizeText(roomValue);
  if (!room) {
    return { campus, floor: '', room: '' };
  }

  room = room.replace(/[（(][^）)]*[）)]/g, '').trim();

  const campusAliases = [
    campus,
    campus.replace(/校区/g, ''),
    'C86校区',
    'C86',
    '七彩校区',
    '七彩',
    '十中校区',
    '十中',
  ].filter(Boolean);

  for (const alias of campusAliases) {
    room = room.replace(new RegExp(escapeRegExp(alias), 'g'), '').trim();
  }

  room = room.replace(/^[-—\s]+/, '').trim();

  let floor = '';
  const floorMatch = room.match(/(\d+)楼/);
  if (floorMatch?.[1]) {
    floor = floorMatch[1];
  } else {
    const splitMatch = room.match(/^(\d+)[-—](\d+)$/);
    if (splitMatch?.[1]) {
      floor = splitMatch[1];
    } else {
      const numberMatch = room.match(/^(\d{3,4})$/);
      if (numberMatch?.[1]) {
        floor = numberMatch[1][0];
      }
    }
  }

  if (/^\d+楼[-—]?\d+$/.test(room)) {
    const match = room.match(/^(\d+楼)[-—]?(\d+)$/);
    if (match) {
      room = `${match[1]}${match[2]}教室`;
    }
  } else if (/^\d+[-—]\d+$/.test(room)) {
    const match = room.match(/^(\d+)[-—](\d+)$/);
    if (match) {
      room = `${match[1]}楼${match[2]}教室`;
    }
  } else if (/^\d{3,4}$/.test(room)) {
    room = `${room}教室`;
  } else if (/^[A-Za-z]\d+$/.test(room)) {
    room = `${room}教室`;
  }

  return { campus, floor, room };
}

function sanitizeSlot(slot: ScheduleMetaSlot | undefined): ScheduleMetaSlot | undefined {
  if (!slot) return undefined;
  const campus = normalizeCampus(slot.campus);
  const floorPieces = String(slot.floor || '')
    .split('/')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => item.match(/(\d+)/)?.[1] || '')
    .filter(Boolean);
  const roomPieces = String(slot.room || '').split('/').map((item) => item.trim()).filter(Boolean);
  const cleanedRooms = roomPieces.map((room) => normalizeRoomPieces(campus, room));
  const floors = [...new Set([...floorPieces, ...cleanedRooms.map((item) => item.floor).filter(Boolean)])];
  const rooms = [...new Set(cleanedRooms.map((item) => item.room).filter(Boolean))];

  return {
    ...slot,
    campus,
    floor: floors.join(' / '),
    room: rooms.join(' / '),
  };
}

function sanitizeScheduleMetaMap(map: ScheduleMetaMap): ScheduleMetaMap {
  const next: ScheduleMetaMap = {};
  for (const [classCode, meta] of Object.entries(map || {})) {
    next[normalizeClassCode(classCode)] = {
      ...meta,
      classCode: normalizeClassCode(meta.classCode || classCode),
      weekday: sanitizeSlot(meta.weekday),
      weekend: sanitizeSlot(meta.weekend),
    };
  }
  return next;
}

const defaultScheduleMetaMap = sanitizeScheduleMetaMap(defaultScheduleMetaData as ScheduleMetaMap);

async function readWorkbook(file: File): Promise<XLSX.WorkBook> {
  const [XLSX, buffer] = await Promise.all([
    loadXlsxModule(),
    file.arrayBuffer(),
  ]);
  return XLSX.read(buffer, { type: 'array' });
}

function detectMode(rows: unknown[][], sheetName: string): 'weekday' | 'weekend' {
  const header = (rows[0] ?? []).map(normalizeText);
  if (header.includes('周中时间') || header.includes('周内时间')) return 'weekday';
  if (header.includes('周末时间')) return 'weekend';
  if (/周中|周内|工作日/i.test(sheetName)) return 'weekday';
  if (/周末/i.test(sheetName)) return 'weekend';

  const sampleDays = rows
    .slice(1, 24)
    .map((row) => normalizeDay(row[1]))
    .filter(Boolean);
  const weekendCount = sampleDays.filter((day) => day === '周六' || day === '周日').length;
  return weekendCount >= Math.ceil(Math.max(sampleDays.length, 1) * 0.6) ? 'weekend' : 'weekday';
}

function groupSlot(rows: ParsedRow[]): ScheduleMetaSlot | undefined {
  const valid = rows.filter((row) => row.day || row.time || row.campus || row.room);
  if (valid.length === 0) return undefined;

  const uniqueDays = [...new Set(valid.map((row) => row.day).filter(Boolean))]
    .sort((a, b) => (DAY_ORDER[a] || 99) - (DAY_ORDER[b] || 99));
  const uniqueTimes = [...new Set(valid.map((row) => row.time).filter(Boolean))];
  const uniqueCampuses = [...new Set(valid.map((row) => row.campus).filter(Boolean))];
  const uniqueFloors = [...new Set(valid.map((row) => row.floor).filter(Boolean))];
  const uniqueRooms = [...new Set(valid.map((row) => row.room).filter(Boolean))];

  return sanitizeSlot({
    day: uniqueDays.join(' / '),
    time: uniqueTimes.join(' / '),
    campus: uniqueCampuses.join(' / '),
    floor: uniqueFloors.join(' / '),
    room: uniqueRooms.join(' / '),
    rawCount: valid.length,
  });
}

export async function parseScheduleWorkbook(file: File): Promise<{ map: ScheduleMetaMap; importedClassCount: number }> {
  const [XLSX, workbook] = await Promise.all([
    loadXlsxModule(),
    readWorkbook(file),
  ]);
  const grouped = new Map<string, { weekday: ParsedRow[]; weekend: ParsedRow[] }>();

  for (const sheetName of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, raw: false });
    if (rows.length === 0) continue;
    const mode = detectMode(rows, sheetName);

    for (const row of rows.slice(1)) {
      const classCode = normalizeClassCode(row[0]);
      const day = normalizeDay(row[1]);
      const time = normalizeTimeRange(row[2], row[3]);
      const cleaned = normalizeRoomPieces(row[4], row[5]);
      const campus = cleaned.campus;
      const floor = cleaned.floor;
      const room = cleaned.room;
      if (!classCode || (!day && !time && !campus && !room)) continue;

      const bucket = grouped.get(classCode) || { weekday: [], weekend: [] };
      bucket[mode].push({ classCode, day, time, campus, floor, room });
      grouped.set(classCode, bucket);
    }
  }

  const map: ScheduleMetaMap = {};
  const now = Date.now();
  for (const [classCode, value] of grouped.entries()) {
    map[classCode] = {
      classCode,
      weekday: groupSlot(value.weekday),
      weekend: groupSlot(value.weekend),
      updatedAt: now,
    };
  }

  return { map, importedClassCount: Object.keys(map).length };
}

export function loadScheduleMetaMap(): ScheduleMetaMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultScheduleMetaMap;
    const parsed = JSON.parse(raw) as ScheduleMetaMap;
    return parsed && typeof parsed === 'object' ? sanitizeScheduleMetaMap(parsed) : defaultScheduleMetaMap;
  } catch {
    return defaultScheduleMetaMap;
  }
}

export function getClassScheduleMeta(classCode: string): ClassScheduleMeta | null {
  const normalized = normalizeClassCode(classCode);
  return loadScheduleMetaMap()[normalized] ?? null;
}

export function saveScheduleMetaForClasses(classes: Array<ClassInfo | string>, importedMap: ScheduleMetaMap): { keptClassCount: number; matchedClassCount: number } {
  const allowed = new Set(classes.map((item) => normalizeClassCode(typeof item === 'string' ? item : item.name)).filter(Boolean));
  const next: ScheduleMetaMap = {};
  let matchedClassCount = 0;

  for (const classCode of allowed) {
    const matched = importedMap[classCode];
    if (!matched) continue;
    next[classCode] = {
      ...matched,
      weekday: sanitizeSlot(matched.weekday),
      weekend: sanitizeSlot(matched.weekend),
    };
    matchedClassCount += 1;
  }

  // Automatic homepage cache only; bundled schedules remain available when
  // quota is exhausted. Never sacrifice teacher-owned seating to cache this.
  saveAppCacheValue(STORAGE_KEY, JSON.stringify(next));
  return { keptClassCount: allowed.size, matchedClassCount };
}

export function hasStoredScheduleMeta(): boolean {
  return Object.keys(loadScheduleMetaMap()).length > 0;
}

export function getBundledScheduleMetaMap(): ScheduleMetaMap {
  return defaultScheduleMetaMap;
}

export function inferThisWeekDate(dayLabel: string, now = new Date()): { month: string; day: string; fullDate: string } | null {
  const matchedDay = (dayLabel.match(/周[一二三四五六日]|星期[一二三四五六日天]/)?.[0] || '').replace('星期', '周').replace('天', '日');
  const targetOrder = DAY_ORDER[matchedDay];
  if (!targetOrder) return null;

  const current = new Date(now);
  const mondayOffset = (current.getDay() + 6) % 7;
  current.setDate(current.getDate() - mondayOffset + (targetOrder - 1));

  const year = current.getFullYear();
  const month = String(current.getMonth() + 1);
  const day = String(current.getDate());
  const fullDate = `${year}-${String(current.getMonth() + 1).padStart(2, '0')}-${String(current.getDate()).padStart(2, '0')}`;
  return { month, day, fullDate };
}

export function shouldRefreshRecurringDate(currentFullDate: string, dayLabel: string, now = new Date()): boolean {
  const inferred = inferThisWeekDate(dayLabel, now);
  if (!inferred?.fullDate || !/^\d{4}-\d{2}-\d{2}$/.test(String(currentFullDate || ''))) {
    return false;
  }

  return currentFullDate < inferred.fullDate;
}
