const calendarConfig = require('../../config/academic-calendar.json');

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const FALLBACK_WEEK1_START = '2026-08-31';
const FALLBACK_TIMEZONE = 'Asia/Shanghai';

function isValidDateKey(value) {
  const match = String(value || '').match(DATE_KEY_PATTERN);
  if (!match) return false;
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function resolveWeek1Start(value = '') {
  const configured = String(value || calendarConfig?.currentTerm?.week1Start || '').trim();
  return isValidDateKey(configured) ? configured : FALLBACK_WEEK1_START;
}

function resolveAcademicTimezone(value = '') {
  const configured = String(value || calendarConfig?.timezone || '').trim();
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: configured }).format(new Date());
    return configured;
  } catch {
    return FALLBACK_TIMEZONE;
  }
}

function dateKeyToOrdinal(value) {
  const match = String(value || '').match(DATE_KEY_PATTERN);
  if (!match) return Number.NaN;
  const [, year, month, day] = match.map(Number);
  return Date.UTC(year, month - 1, day) / DAY_MS;
}

function ordinalToDate(ordinal) {
  return new Date(Number(ordinal) * DAY_MS + 12 * 60 * 60 * 1000);
}

function formatDateKeyInTimezone(date = new Date(), timezone = resolveAcademicTimezone()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: resolveAcademicTimezone(timezone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function getAcademicWeekNumber(now = new Date(), options = {}) {
  const week1Start = resolveWeek1Start(options.week1Start);
  const timezone = resolveAcademicTimezone(options.timezone);
  const todayOrdinal = dateKeyToOrdinal(formatDateKeyInTimezone(now, timezone));
  const startOrdinal = dateKeyToOrdinal(week1Start);
  const days = Math.floor(todayOrdinal - startOrdinal);
  return Math.max(1, Math.floor(days / 7) + 1);
}

function getAcademicWeekRange(weekNumber, options = {}) {
  const week1Start = resolveWeek1Start(options.week1Start);
  const normalizedWeek = Math.max(1, Number.parseInt(weekNumber, 10) || 1);
  const startOrdinal = dateKeyToOrdinal(week1Start) + (normalizedWeek - 1) * 7;
  return {
    week: normalizedWeek,
    start: ordinalToDate(startOrdinal),
    end: ordinalToDate(startOrdinal + 6),
  };
}

function getPreviousAcademicWeekRange(now = new Date(), options = {}) {
  const week1Start = resolveWeek1Start(options.week1Start);
  const currentWeek = getAcademicWeekNumber(now, options);
  const startOrdinal = dateKeyToOrdinal(week1Start) + Math.max(0, currentWeek - 2) * 7;
  return {
    currentWeek,
    previousWeek: Math.max(1, currentWeek - 1),
    start: ordinalToDate(startOrdinal),
    end: ordinalToDate(startOrdinal + 6),
  };
}

function getPreferredAcademicWindow(now = new Date(), options = {}) {
  const dateKey = formatDateKeyInTimezone(now, options.timezone);
  const [year, month] = dateKey.split('-').map(Number);
  const spring = month <= 7;
  return {
    preferredYear: String(year),
    preferredSemester: `${year}学年${spring ? '春季' : '秋季'}学期`,
  };
}

module.exports = {
  calendarConfig,
  formatDateKeyInTimezone,
  getAcademicWeekRange,
  getAcademicWeekNumber,
  getPreviousAcademicWeekRange,
  getPreferredAcademicWindow,
  isValidDateKey,
  resolveAcademicTimezone,
  resolveWeek1Start,
};
