export type DateRange = { start: string; end: string };

function shanghaiDateKey(value: Date): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function addDays(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T12:00:00+08:00`);
  date.setUTCDate(date.getUTCDate() + days);
  return shanghaiDateKey(date);
}

export function previousShanghaiWeekRange(now = new Date()): DateRange {
  const today = shanghaiDateKey(now);
  const weekday = new Date(`${today}T12:00:00+08:00`).getUTCDay();
  const daysSinceMonday = weekday === 0 ? 6 : weekday - 1;
  const start = addDays(today, -daysSinceMonday - 7);
  return { start, end: addDays(start, 6) };
}

export function currentShanghaiWeekToDateRange(now = new Date()): DateRange {
  const today = shanghaiDateKey(now);
  const weekday = new Date(`${today}T12:00:00+08:00`).getUTCDay();
  const daysSinceMonday = weekday === 0 ? 6 : weekday - 1;
  return { start: addDays(today, -daysSinceMonday), end: today };
}

export function shanghaiExportTimestamp(now = new Date()): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}_${parts.hour}-${parts.minute}-${parts.second}`;
}
