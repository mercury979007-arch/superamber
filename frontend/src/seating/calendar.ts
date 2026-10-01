import { getWeek1StartDate, getWeekNumberForDate } from '../utils/weekNumber';

const toLocalDateKey = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const fromDateKey = (dateKey: string): Date | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    return null;
  }
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
};

const weekdayMap = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

export const formatTodayLabel = (now = new Date()): string => {
  return `${now.getMonth() + 1}月${now.getDate()}日`;
};

export const getChineseWeekday = (now = new Date()): string => {
  return weekdayMap[now.getDay()] ?? '';
};

export const getWeekNumber = (now = new Date()): number => {
  const todayKey = toLocalDateKey(now);
  const today = fromDateKey(todayKey);
  if (!today) {
    return 1;
  }
  return getWeekNumberForDate(today);
};

export const addDays = (dateKey: string, days: number): string | null => {
  const date = fromDateKey(dateKey);
  if (!date) {
    return null;
  }

  date.setDate(date.getDate() + days);
  return toLocalDateKey(date);
};

export const monthDayToDateKey = (month: string, day: string): string | null => {
  const monthNum = Number.parseInt(month, 10);
  const dayNum = Number.parseInt(day, 10);
  if (!Number.isFinite(monthNum) || !Number.isFinite(dayNum)) {
    return null;
  }
  if (monthNum < 1 || monthNum > 12 || dayNum < 1 || dayNum > 31) {
    return null;
  }

  const week1Start = getWeek1StartDate();
  const week1Month = week1Start.getMonth() + 1;
  const year = monthNum < week1Month
    ? week1Start.getFullYear() + 1
    : week1Start.getFullYear();
  const date = new Date(year, monthNum - 1, dayNum);
  if (date.getMonth() !== monthNum - 1 || date.getDate() !== dayNum) {
    return null;
  }

  return toLocalDateKey(date);
};

export const dateKeyToMonthDay = (dateKey: string): { month: string; day: string; weekday: string } | null => {
  const date = fromDateKey(dateKey);
  if (!date) {
    return null;
  }

  return {
    month: String(date.getMonth() + 1),
    day: String(date.getDate()),
    weekday: weekdayMap[date.getDay()] ?? ''
  };
};

export const parseDateFromClassTime = (classTime: string): string | null => {
  const match = classTime.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (!match) {
    return null;
  }

  return monthDayToDateKey(match[1], match[2]);
};
