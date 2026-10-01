import { getWeek1StartDate, getWeekNumberForDate, getWeekRange } from '../utils/weekNumber';

const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

function parseDateKey(dateKey: string): Date | null {
  const match = dateKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, year, month, day] = match.map(Number);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return date;
}

function formatMonthDay(date: Date): string {
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

export function buildAcademicWeekContext(dateKey: string): string {
  const classDate = parseDateKey(dateKey) || getWeek1StartDate();
  const week = getWeekNumberForDate(classDate);
  const range = getWeekRange(week);
  const rangeLabel = `${formatMonthDay(range.start)}—${formatMonthDay(range.end)}`;
  const classDateLabel = parseDateKey(dateKey);

  if (!classDateLabel) {
    return `Week ${week}｜周区间 ${rangeLabel}`;
  }

  return `Week ${week}｜周区间 ${rangeLabel}｜本班上课 ${formatMonthDay(classDateLabel)} ${WEEKDAYS[classDateLabel.getDay()]}`;
}
