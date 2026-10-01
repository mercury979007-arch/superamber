import type { DayOfWeek } from '../types';
import { getClassScheduleMeta, type ScheduleMetaSlot } from '../utils/classScheduleMeta';

// The official timetable adapter is ready, but the new-term timetable is not
// complete yet. Keep the existing in-system schedule active until this flag is
// deliberately switched after the timetable has stabilised.
export const OFFICIAL_TEACHER_SCHEDULE_ENABLED = false;

export type OfficialTeacherScheduleSlot = {
  id: string;
  classCode: string;
  date: string;
  day: DayOfWeek;
  time: string;
  endTime: string;
  campus: string;
  room: string;
  classroomName: string;
  courseName: string;
  teacherName: string;
  tutorName: string;
  source: 'official_schedule';
  sampleCount: number;
  latestDate: string;
};

export type OfficialTeacherScheduleMap = Record<string, OfficialTeacherScheduleSlot[]>;

export type ClassControlSession = {
  day: DayOfWeek | '';
  time: string;
  campus: string;
  room: string;
  source: 'official_schedule' | 'schedule' | 'manual';
};

export type ConfirmedClassControlSchedule = {
  classCode: string;
  sessions: ClassControlSession[];
  confirmedAt: number;
};

export type NextClassSession = ClassControlSession & {
  dayOffset: number;
  dayLabel: string;
  minutesUntil: number;
};

type OfficialScheduleResponse = {
  status: 'success';
  source: 'official_schedule';
  classes: OfficialTeacherScheduleMap;
  updatedAt: string;
};

export class OfficialScheduleApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'OfficialScheduleApiError';
    this.status = status;
  }
}

const OFFICIAL_STORAGE_PREFIX = 'superamber_class_control_schedule_v2';
const LEGACY_STORAGE_KEY = 'superamber_class_control_schedule_v1';
const LEGACY_STORAGE_PREFIX = 'superamber_class_control_schedule_legacy_v2';
export const CLASS_DAYS: DayOfWeek[] = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

function normalizeClassCode(value: string): string {
  return String(value || '').trim().toUpperCase();
}

function normalizeOwner(value: string): string {
  return String(value || 'teacher').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_') || 'teacher';
}

function storageKey(teacherName: string): string {
  return OFFICIAL_TEACHER_SCHEDULE_ENABLED
    ? `${OFFICIAL_STORAGE_PREFIX}:${normalizeOwner(teacherName)}`
    : `${LEGACY_STORAGE_PREFIX}:${normalizeOwner(teacherName)}`;
}

function normalizeDay(value: string): DayOfWeek | '' {
  const hit = String(value || '').match(/周[一二三四五六日]/)?.[0] || '';
  return CLASS_DAYS.includes(hit as DayOfWeek) ? hit as DayOfWeek : '';
}

function normalizeTime(value: string): string {
  const hit = String(value || '').match(/(\d{1,2}):([0-5]\d)/);
  return hit ? `${hit[1].padStart(2, '0')}:${hit[2]}` : '';
}

function sanitizeSession(session: Partial<ClassControlSession>): ClassControlSession {
  return {
    day: normalizeDay(String(session.day || '')),
    time: normalizeTime(String(session.time || '')),
    campus: String(session.campus || '').trim(),
    room: String(session.room || '').trim(),
    source: session.source === 'official_schedule' || session.source === 'schedule'
      ? session.source
      : 'manual',
  };
}

function legacySlotToSession(slot: ScheduleMetaSlot | undefined): ClassControlSession | null {
  if (!slot) return null;
  const session = sanitizeSession({
    day: slot.day as DayOfWeek,
    time: slot.time,
    campus: slot.campus,
    room: slot.room,
    source: 'schedule',
  });
  return session.day ? session : null;
}

export function getLegacyClassControlSessions(classCode: string): ClassControlSession[] {
  const meta = getClassScheduleMeta(classCode);
  return [legacySlotToSession(meta?.weekday), legacySlotToSession(meta?.weekend)]
    .filter((session): session is ClassControlSession => Boolean(session))
    .slice(0, 2);
}

export function officialSlotToSession(slot: OfficialTeacherScheduleSlot): ClassControlSession | null {
  const session = sanitizeSession({ ...slot, source: 'official_schedule' });
  return session.day ? session : null;
}

export async function fetchOfficialTeacherSchedule(): Promise<{
  classes: OfficialTeacherScheduleMap;
  updatedAt: string;
}> {
  const response = await fetch('/api/data/class-control/schedule', {
    credentials: 'include',
    cache: 'no-store',
  });
  const data = await response.json().catch(() => ({} as Partial<OfficialScheduleResponse> & { error?: string }));
  if (!response.ok || !data.classes) {
    throw new OfficialScheduleApiError(
      response.status === 401 ? '未登录，请先登录' : data.error || '官网课表读取失败',
      response.status,
    );
  }
  return { classes: data.classes, updatedAt: data.updatedAt || '' };
}

export function loadConfirmedClassControlSchedules(teacherName = ''): Record<string, ConfirmedClassControlSchedule> {
  try {
    const scoped = localStorage.getItem(storageKey(teacherName));
    const legacy = OFFICIAL_TEACHER_SCHEDULE_ENABLED ? null : localStorage.getItem(LEGACY_STORAGE_KEY);
    const parsed = JSON.parse(scoped || legacy || '{}') as Record<string, ConfirmedClassControlSchedule>;
    return Object.fromEntries(Object.entries(parsed).map(([classCode, schedule]) => [
      normalizeClassCode(classCode),
      {
        classCode: normalizeClassCode(schedule.classCode || classCode),
        sessions: (schedule.sessions || []).map(sanitizeSession).filter((session) => session.day),
        confirmedAt: Number(schedule.confirmedAt) || 0,
      },
    ]));
  } catch {
    return {};
  }
}

export function saveConfirmedClassControlSchedule(
  classCode: string,
  sessions: ClassControlSession[],
  teacherName = '',
): void {
  const normalizedCode = normalizeClassCode(classCode);
  const all = loadConfirmedClassControlSchedules(teacherName);
  all[normalizedCode] = {
    classCode: normalizedCode,
    sessions: sessions.map(sanitizeSession).filter((session) => session.day),
    confirmedAt: Date.now(),
  };
  localStorage.setItem(storageKey(teacherName), JSON.stringify(all));
}

export function isClassControlScheduleConfirmed(classCode: string, teacherName = ''): boolean {
  const confirmed = loadConfirmedClassControlSchedules(teacherName)[normalizeClassCode(classCode)];
  return Boolean(confirmed?.confirmedAt);
}

export function getOfficialClassControlSessions(
  slots: OfficialTeacherScheduleSlot[] = [],
): ClassControlSession[] {
  const deduplicated = new Map<string, ClassControlSession>();
  for (const slot of slots) {
    const session = officialSlotToSession(slot);
    if (!session) continue;
    const key = `${session.day}|${session.time}|${session.campus}|${session.room}`;
    if (!deduplicated.has(key)) deduplicated.set(key, session);
  }
  return [...deduplicated.values()].slice(0, 2);
}

export function getSuggestedClassControlSessions(
  classCode: string,
  officialSlots: OfficialTeacherScheduleSlot[] = [],
  teacherName = '',
): ClassControlSession[] {
  const confirmed = loadConfirmedClassControlSchedules(teacherName)[normalizeClassCode(classCode)];
  if (confirmed?.sessions.length) return confirmed.sessions;
  return OFFICIAL_TEACHER_SCHEDULE_ENABLED
    ? getOfficialClassControlSessions(officialSlots)
    : getLegacyClassControlSessions(classCode);
}

function currentShanghaiClock(now: Date): { day: DayOfWeek; minuteOfDay: number } {
  const formatter = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(formatter.formatToParts(now).map((part) => [part.type, part.value]));
  const day = normalizeDay(String(parts.weekday || '').replace('星期', '周')) || '周一';
  const hour = Number.parseInt(parts.hour || '0', 10) || 0;
  const minute = Number.parseInt(parts.minute || '0', 10) || 0;
  return { day, minuteOfDay: hour * 60 + minute };
}

export function getNextClassSession(
  classCode: string,
  officialSlots: OfficialTeacherScheduleSlot[] = [],
  now = new Date(),
  teacherName = '',
): NextClassSession | null {
  const sessions = getSuggestedClassControlSessions(classCode, officialSlots, teacherName).filter((session) => session.day);
  if (sessions.length === 0) return null;
  const current = currentShanghaiClock(now);
  const todayIndex = CLASS_DAYS.indexOf(current.day);
  const ranked = sessions.map((session) => {
    const sessionIndex = CLASS_DAYS.indexOf(session.day as DayOfWeek);
    let dayOffset = (sessionIndex - todayIndex + 7) % 7;
    const [hour = 0, minute = 0] = session.time.split(':').map((value) => Number.parseInt(value, 10) || 0);
    const sessionMinute = session.time ? hour * 60 + minute : current.minuteOfDay;
    let minutesUntil = dayOffset * 24 * 60 + sessionMinute - current.minuteOfDay;
    if (minutesUntil < 0) {
      dayOffset += 7;
      minutesUntil += 7 * 24 * 60;
    }
    return {
      ...session,
      dayOffset,
      dayLabel: dayOffset === 0 ? '今天' : session.day,
      minutesUntil,
    };
  }).sort((left, right) => (
    left.minutesUntil - right.minutesUntil
    || left.time.localeCompare(right.time)
  ));
  return ranked[0] || null;
}

export function formatSessionLocation(session: Pick<ClassControlSession, 'campus' | 'room'> | null): string {
  if (!session) return '';
  const campus = String(session.campus || '').trim();
  const room = String(session.room || '').trim();
  if (!campus) return room;
  if (!room) return campus;
  return room.startsWith(campus) ? room : `${campus} · ${room}`;
}

// Display order is anchored to the school day, not the next future minute.
// A class taught earlier today must stay ahead of tomorrow's classes.
export function getClassDisplaySession(classCode: string, officialSlots: OfficialTeacherScheduleSlot[] = [], now = new Date(), teacherName = ''): NextClassSession | null {
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  return getNextClassSession(classCode, officialSlots, new Date(`${date}T00:00:00+08:00`), teacherName);
}
