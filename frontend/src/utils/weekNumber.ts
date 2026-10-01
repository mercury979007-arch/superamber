import academicCalendar from '../../../config/academic-calendar.json';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_WEEK1_START = academicCalendar.currentTerm.week1Start;

function parseDateKey(raw: string): Date | null {
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, year, month, day] = match.map(Number);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return date;
}

function resolveWeek1Start(): Date {
  const raw = import.meta.env.VITE_WEEK1_START || DEFAULT_WEEK1_START;
  return parseDateKey(raw) || parseDateKey(DEFAULT_WEEK1_START)!;
}

const WEEK1_START = resolveWeek1Start();

export function getWeek1StartDate(): Date {
  return new Date(WEEK1_START);
}

export function getWeekNumberForDate(input: Date): number {
  const inputDay = Date.UTC(input.getFullYear(), input.getMonth(), input.getDate());
  const startDay = Date.UTC(WEEK1_START.getFullYear(), WEEK1_START.getMonth(), WEEK1_START.getDate());
  const days = Math.floor((inputDay - startDay) / DAY_MS);
  return Math.max(1, Math.floor(days / 7) + 1);
}

export function getCurrentWeek(): number {
  return getWeekNumberForDate(new Date());
}

export function getWeekRange(week: number): { start: Date; end: Date } {
  const start = new Date(WEEK1_START);
  start.setDate(start.getDate() + (week - 1) * 7);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return { start, end };
}

export function formatDateShort(date: Date): string {
  return `${date.getMonth() + 1}/${date.getDate()}`;
}
