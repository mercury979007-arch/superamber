import type { SpeakingChallengeStudent } from '../services/speakingChallengeApi';

function shiftDate(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
function mondayOf(date: string) {
  const value = new Date(`${date}T12:00:00Z`);
  return shiftDate(date, -(value.getUTCDay() + 6) % 7);
}

// Calendar and weekly totals use Shanghai's natural week, independent of settlement selection.
export function speakingVisibleDates(dates: string[], showHistory = false, now = new Date()) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const start = mondayOf(today);
  const end = shiftDate(start, 6);
  const sorted = [...new Set(dates)].sort();
  const current = sorted.filter(date => date >= start && date <= end);
  const history = sorted.filter(date => date < start);
  const weekStarts = [start, ...(showHistory ? [...new Set(history.map(mondayOf))].sort().reverse() : [])];
  const weeks = weekStarts.map(monday => Array.from({ length: 7 }, (_, day) => shiftDate(monday, day)));
  return { dates: showHistory ? [...current, ...history] : current, history, start, end, weeks, calendarDates: weeks.flat() };
}

export function speakingWeekMetrics(student: SpeakingChallengeStudent, start: string, end: string) {
  const days = student.daily.filter(day => day.date >= start && day.date <= end);
  const completed = days.filter(day => day.status === 'normal' || day.status === 'supplement');
  const missingWords = days.some(day => day.status !== 'missed' && day.words == null);
  const words = missingWords ? null : days.reduce((sum, day) => sum + (day.words ?? 0), 0);
  return { days: completed.length, words };
}

// Scope presentation statistics only; settlement keeps the original student and ledger.
export function speakingStudentInRange(student: SpeakingChallengeStudent, start: string, end: string): SpeakingChallengeStudent {
  const daily = student.daily.filter(day => day.date >= start && day.date <= end)
    .sort((a, b) => a.date.localeCompare(b.date));
  let runningStreak = 0;
  let streakDays = 0;
  let previousDate = '';
  for (const day of daily) {
    const consecutive = previousDate && shiftDate(previousDate, 1) === day.date;
    runningStreak = day.status === 'normal' ? (consecutive ? runningStreak : 0) + 1 : 0;
    streakDays = Math.max(streakDays, runningStreak);
    previousDate = day.date;
  }
  const normalDays = daily.filter(day => day.status === 'normal').length;
  const supplementDays = daily.filter(day => day.status === 'supplement').length;
  return { ...student, daily, normalDays, supplementDays, totalDays: normalDays + supplementDays, streakDays };
}

export type SpeakingSort = 'rank' | 'name-asc' | 'name-desc' | 'words-asc' | 'words-desc';
export function sortSpeakingStudents(students: SpeakingChallengeStudent[], sort: SpeakingSort, start: string, end: string) {
  const byName = (a: SpeakingChallengeStudent, b: SpeakingChallengeStudent) => a.englishName.localeCompare(b.englishName, 'en', { sensitivity: 'base', numeric: true });
  return [...students].sort((a, b) => {
    if (sort === 'rank') return a.rank - b.rank || byName(a, b);
    if (sort.startsWith('name')) return byName(a, b) * (sort === 'name-desc' ? -1 : 1);
    const left = speakingWeekMetrics(a, start, end).words;
    const right = speakingWeekMetrics(b, start, end).words;
    if (left == null || right == null) return left == null && right == null ? byName(a, b) : left == null ? 1 : -1;
    return (left - right) * (sort === 'words-desc' ? -1 : 1) || byName(a, b);
  });
}

export function settlementDatesInRange(dates: string[], start: string, end: string) {
  if (!start || !end || start > end) return [];
  return [...new Set(dates)].filter(date => date >= start && date <= end).sort();
}
