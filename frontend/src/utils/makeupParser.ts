import type { MakeupOccurrence, WeekContext, QuickParseResult } from '../types/makeup';
import { getWeekNumber as getCurrentSchoolWeekNumber } from '../seating/calendar';

const DAY_CHAR_MAP: Record<string, string> = {
  '一': '周一', '二': '周二', '三': '周三', '四': '周四',
  '五': '周五', '六': '周六', '日': '周日', '天': '周日',
};

const MISSED_KEYWORDS = ['请假', '缺课', '缺了', '请了假', '缺'];
const WEEKDAY_DAYS = ['周一', '周二', '周三', '周四', '周五'];
const WEEKEND_DAYS = ['周六', '周日'];
const GENERAL_MAKEUP_INTENT_RE = /想补|补课|调课|调到|改到|挪到|换到|特殊调整|考虑补课|需要补课|要补课|安排补课|补一下课|补一节课|补上这节课|补这节课|补回这节课/;

const INPUT_NORMALIZATION_RULES: Array<[RegExp, string]> = [
  [/(?:请)?病假|生病了?|发烧了?|不舒服|身体不舒服|去医院|看医生|临时有事|有事情|有事|来不了|不能来|上不了课|不能上课|没法上课/g, '请假'],
  [/(?:考虑|需要|要|安排|打算|准备|计划|想要)(?:去|来|在)?补(?:一下|一节)?课/g, '想补课'],
  [/(?:补回|补上)(?:这节|这堂)?课/g, '想补课'],
  [/(?:调|改|挪|换)(?:到|去|在)?(周中|周末)/g, '想在$1补课'],
  [/（/g, '('],
  [/）/g, ')'],
];

const CHINESE_DIGIT_MAP: Record<string, number> = {
  '零': 0, '〇': 0,
  '一': 1, '二': 2, '两': 2, '三': 3, '四': 4,
  '五': 5, '六': 6, '七': 7, '八': 8, '九': 9,
};

function parseNumberToken(text: string | undefined): number | null {
  const value = String(text || '').trim();
  if (!value) return null;
  if (/^\d+$/.test(value)) return parseInt(value, 10);
  if (value === '十') return 10;

  let total = 0;
  let current = 0;
  for (const ch of value) {
    if (ch === '十') {
      total += (current || 1) * 10;
      current = 0;
      continue;
    }
    const digit = CHINESE_DIGIT_MAP[ch];
    if (digit == null) return null;
    current = current * 10 + digit;
  }

  return total + current;
}

function normalizeNaturalTime(period: string | undefined, hourText: string, minuteText?: string, preferAfternoon = false): string | null {
  let hour = parseNumberToken(hourText);
  if (hour == null) return null;
  let minute = 0;
  if (minuteText === '半') minute = 30;
  else if (minuteText != null && minuteText !== '') {
    const parsedMinute = parseNumberToken(minuteText);
    if (parsedMinute == null) return null;
    minute = parsedMinute;
  }
  if (Number.isNaN(minute) || minute < 0 || minute > 59) return null;
  if ((period === '下午' || period === '晚上' || period === '傍晚') && hour < 12) hour += 12;
  if (period === '中午' && hour < 11) hour += 12;
  if (!period && preferAfternoon && hour >= 1 && hour <= 7) hour += 12;
  if (hour > 23) return null;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function pushTimedRequest(
  requests: { day: string; time: string; endTime?: string; mode: 'exact' | 'after' | 'before' | 'range'; pos: number; raw: string }[],
  day: string,
  raw: string,
  pos: number,
  time: string,
  mode: 'exact' | 'after' | 'before' | 'range',
  endTime?: string,
): void {
  requests.push({ day, time, endTime, mode, pos, raw });
}

function parseTimeExpression(segment: string): { time: string; length: number } | null {
  const colon = segment.match(/^(上午|早上|中午|下午|晚上|傍晚)?\s*([零〇一二两三四五六七八九十\d]{1,3})\s*[:：]\s*([零〇一二三四五六七八九十\d]{1,2})/);
  if (colon) {
    const time = normalizeNaturalTime(colon[1], colon[2], colon[3], true);
    if (time) return { time, length: colon[0].length };
  }

  const chinese = segment.match(/^(上午|早上|中午|下午|晚上|傍晚)?\s*([零〇一二两三四五六七八九十\d]{1,3})\s*(?:点|时)(?:\s*(半|[零〇一二三四五六七八九十\d]{1,2}))?(?:\s*分)?/);
  if (chinese) {
    const time = normalizeNaturalTime(chinese[1], chinese[2], chinese[3], true);
    if (time) return { time, length: chinese[0].length };
  }

  return null;
}

function extractTimedRequests(text: string): { day: string; time: string; endTime?: string; mode: 'exact' | 'after' | 'before' | 'range'; pos: number; raw: string }[] {
  const requests: { day: string; time: string; endTime?: string; mode: 'exact' | 'after' | 'before' | 'range'; pos: number; raw: string }[] = [];
  const dayRe = /(?:周|星期)([一二三四五六日天])/g;

  let match: RegExpExecArray | null;
  while ((match = dayRe.exec(text)) !== null) {
    const day = DAY_CHAR_MAP[match[1]] || `周${match[1]}`;
    const tail = text.slice(match.index + match[0].length);
    const cleanTail = tail.replace(/^[\s,，、]*(?:在)?\s*/, '');
    const offset = tail.length - cleanTail.length;
    const start = parseTimeExpression(cleanTail);
    if (!start) continue;

    const afterStart = cleanTail.slice(start.length);
    const rangeMatch = afterStart.match(/^\s*(?:到|至|-|—|~|～)\s*/);
    if (rangeMatch) {
      const end = parseTimeExpression(afterStart.slice(rangeMatch[0].length));
      if (end) {
        pushTimedRequest(
          requests,
          day,
          match[0] + tail.slice(0, offset + start.length + rangeMatch[0].length + end.length),
          match.index,
          start.time,
          'range',
          end.time,
        );
        continue;
      }
    }

    const qualifierMatch = afterStart.match(/^\s*(?:点)?\s*(左右|前|后|以前|以后|之前|之后)?/);
    const qualifier = qualifierMatch?.[1] || '';
    let mode: 'exact' | 'after' | 'before' | 'range' = 'exact';
    if (qualifier === '后' || qualifier === '以后' || qualifier === '之后') mode = 'after';
    else if (qualifier === '前' || qualifier === '以前' || qualifier === '之前') mode = 'before';

    pushTimedRequest(
      requests,
      day,
      match[0] + tail.slice(0, offset + start.length + (qualifierMatch?.[0]?.length || 0)),
      match.index,
      start.time,
      mode,
    );
  }

  return requests.sort((a, b) => a.pos - b.pos);
}

function nearestDay(
  days: { day: string; pos: number; paired: boolean }[],
  pivot: number,
): { day: string; dist: number } | null {
  return days.reduce<{ day: string; dist: number } | null>((best, d) => {
    const dist = Math.abs(d.pos - pivot);
    return (!best || dist < best.dist) ? { day: d.day, dist } : best;
  }, null);
}

function normalizeInputText(text: string): string {
  let normalized = String(text || '');
  for (const [pattern, replacement] of INPUT_NORMALIZATION_RULES) {
    normalized = normalized.replace(pattern, replacement);
  }
  normalized = normalized.replace(/[，,、；;]+/g, '，');
  normalized = normalized.replace(/\s+/g, ' ').trim();
  return normalized;
}

function hasMakeupIntentAround(text: string, pos: number): boolean {
  const windowText = text.slice(Math.max(0, pos - 4), Math.min(text.length, pos + 6));
  return GENERAL_MAKEUP_INTENT_RE.test(windowText);
}

function detectMakeupModeDays(text: string, pivot: number): string[] {
  const tail = pivot >= 0 ? text.slice(pivot) : text;
  if (/补到周中|补去周中|补在周中|调到周中|改到周中|挪到周中|想补到周中|想在周中补|想周中补|周中补课/.test(tail)) {
    return WEEKDAY_DAYS;
  }
  if (/补到周末|补去周末|补在周末|调到周末|改到周末|挪到周末|想补到周末|想在周末补|想周末补|周末补课/.test(tail)) {
    return WEEKEND_DAYS;
  }
  return [];
}

// ── Week helpers ──

export function getWeekNumber(val: string | null): number | null {
  if (!val) return null;
  const m = val.match(/^W(\d+)/i);
  return m ? parseInt(m[1], 10) : null;
}

export function getWeekTag(val: string | null): string | null {
  const n = getWeekNumber(val);
  return n !== null ? `W${n}` : null;
}

export function sameWeekTag(a: string, b: string): boolean {
  return !!a && !!b && getWeekTag(a) === getWeekTag(b);
}

// ── Week detection ──

export function initWeekDetection(occurrences: MakeupOccurrence[]): WeekContext {
  const weekDateMap = new Map<string, { start: Date; end: Date }>();
  const invalidWeekLabels: string[] = [];
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const thisYear = today.getFullYear();

  for (const occ of occurrences) {
    const wm = occ.week_label.match(/^(W\d+)/);
    const dm = occ.week_label.match(/[\[【](\d{1,2})\.(\d{1,2})\s*-\s*(\d{1,2})\.(\d{1,2})[\]】]/);
    if (!wm || !dm) continue;
    const weekNum = wm[1];
    const s = new Date(thisYear, parseInt(dm[1], 10) - 1, parseInt(dm[2], 10));
    const e = new Date(thisYear, parseInt(dm[3], 10) - 1, parseInt(dm[4], 10), 23, 59, 59);
    if (!weekDateMap.has(weekNum)) {
      weekDateMap.set(weekNum, { start: s, end: e });
    } else {
      const entry = weekDateMap.get(weekNum)!;
      if (s < entry.start) entry.start = s;
      if (e > entry.end) entry.end = e;
    }
  }

  const calendarWeek = `W${getCurrentSchoolWeekNumber(today)}`;
  let currentWeek: string | null = calendarWeek;

  const dow = today.getDay();
  const currentWeekMode: '周中' | '周末' = (dow === 0 || dow === 6) ? '周末' : '周中';

  return { currentWeek, currentWeekMode, weekDateMap, invalidWeekLabels };
}

// ── Resolve requested week ──

function resolveRequestedWeek(text: string, currentWeek: string | null): { weekTag: string; source: string } | null {
  const norm = text.replace(/\s+/g, '');
  const explicitSource = text;
  const explicitPatterns = [
    /(?:^|[^A-Za-z\d])W(\d{1,2})(?!\d)/i,
    /(?:^|[^A-Za-z\d])WK(\d{1,2})(?!\d)/i,
    /(?:^|[^A-Za-z\d])WEEK(\d{1,2})(?!\d)/i,
    /(?:^|[^A-Za-z\d])第?(\d{1,2})周/,
  ];
  for (const pat of explicitPatterns) {
    const m = explicitSource.match(pat);
    if (m) return { weekTag: `W${parseInt(m[1], 10)}`, source: `明确周次 W${parseInt(m[1], 10)}` };
  }
  const cwn = getWeekNumber(currentWeek);
  if (!cwn) return null;

  const relativeRules: { pattern: RegExp; offset: number; label: string }[] = [
    { pattern: /下下下周|下下下星期|下下下礼拜/, offset: 3, label: '下下下周' },
    { pattern: /下下周|下下星期|下下礼拜/, offset: 2, label: '下下周' },
    { pattern: /下周|下星期|下礼拜/, offset: 1, label: '下周' },
    { pattern: /这周|本周|这星期|本星期|这礼拜|本礼拜/, offset: 0, label: '本周' },
    { pattern: /上周|上星期|上礼拜/, offset: -1, label: '上周' },
  ];
  for (const rule of relativeRules) {
    if (rule.pattern.test(norm)) {
      const target = cwn + rule.offset;
      if (target > 0) return { weekTag: `W${target}`, source: `${rule.label} -> W${target}` };
    }
  }
  return null;
}

// ── Compare occurrences by week ──

function compareOccByWeek(a: MakeupOccurrence, b: MakeupOccurrence): number {
  const colA = Number.isFinite(a.week_col) ? a.week_col : Number.MAX_SAFE_INTEGER;
  const colB = Number.isFinite(b.week_col) ? b.week_col : Number.MAX_SAFE_INTEGER;
  if (colA !== colB) return colA - colB;
  const weekA = getWeekNumber(a.week_label) ?? Number.MAX_SAFE_INTEGER;
  const weekB = getWeekNumber(b.week_label) ?? Number.MAX_SAFE_INTEGER;
  if (weekA !== weekB) return weekA - weekB;
  if (a.mode !== b.mode) return a.mode === '周中' ? -1 : 1;
  if (a.day !== b.day) return a.day.localeCompare(b.day, 'zh-CN');
  return a.time.localeCompare(b.time, 'zh-CN');
}

export function getSortedWeekLabels(occs: MakeupOccurrence[]): string[] {
  const labels: string[] = [];
  for (const occ of occs.slice().sort(compareOccByWeek)) {
    if (occ.week_label && !labels.includes(occ.week_label)) labels.push(occ.week_label);
  }
  return labels;
}

function getSortedWeekTags(occs: MakeupOccurrence[]): string[] {
  return [...new Set(occs.map((o) => getWeekTag(o.week_label)).filter(Boolean) as string[])]
    .sort((a, b) => (getWeekNumber(a) ?? Infinity) - (getWeekNumber(b) ?? Infinity));
}

function buildWeekCoverageError(preferredWeekTag: string, availableWeekLabels: string[]): string {
  const preferredWeekNum = getWeekNumber(preferredWeekTag);
  const availableWeekTags = availableWeekLabels
    .map((label) => getWeekTag(label))
    .filter(Boolean) as string[];
  const latestCoveredWeekTag = preferredWeekNum == null
    ? (availableWeekTags[availableWeekTags.length - 1] || null)
    : (() => {
        const covered = availableWeekTags
          .filter((tag) => {
            const weekNum = getWeekNumber(tag);
            return weekNum != null && weekNum <= preferredWeekNum;
          })
          .sort((a, b) => (getWeekNumber(a) ?? Infinity) - (getWeekNumber(b) ?? Infinity));
        return covered[covered.length - 1] || null;
      })();
  const coverageText = latestCoveredWeekTag
    ? `，当前进度表只到 ${latestCoveredWeekTag}，请更新进度表`
    : `，当前未找到 ${preferredWeekTag} 及之前的对应课次，请更新进度表`;
  const availableText = availableWeekLabels.length ? `，当前只找到 ${availableWeekLabels.join(' / ')}` : '';
  return `目标周次 ${preferredWeekTag} 没有对应课次${coverageText}${availableText}`;
}

// ── Select missed lesson occurrence ──

export function selectMissedLesson(
  classCode: string,
  missedDay: string,
  preferredWeekTag: string | null,
  occByClass: Map<string, MakeupOccurrence[]>,
  missedModeHint?: '周中' | '周末' | null,
): {
  selected: MakeupOccurrence | null;
  matchedExactly: boolean;
  error: string | null;
  availableWeekLabels: string[];
} {
  if (!classCode || (!missedDay && !missedModeHint)) {
    return { selected: null, matchedExactly: false, error: null, availableWeekLabels: [] };
  }
  const allMatches = occByClass.get(classCode) || [];
  const missedMode = missedModeHint || ((missedDay === '周六' || missedDay === '周日') ? '周末' : '周中');
  const dayMatches = missedDay ? allMatches.filter((o) => o.day === missedDay) : [];
  const modeMatches = allMatches.filter((o) => o.mode === missedMode);
  const pickFallbackWithinCoverage = (matches: MakeupOccurrence[]): MakeupOccurrence | null => {
    const sorted = matches.slice().sort(compareOccByWeek);
    if (!preferredWeekTag) return sorted[0] || null;
    const prefNum = getWeekNumber(preferredWeekTag);
    if (prefNum == null) return sorted[0] || null;
    const notAfter = sorted.filter((o) => {
      const weekNum = getWeekNumber(o.week_label);
      return weekNum != null && weekNum <= prefNum;
    });
    if (notAfter.length) return notAfter[notAfter.length - 1] || null;
    return null;
  };

  if (!dayMatches.length) {
    if (!missedDay && modeMatches.length) {
      const availableWeekLabels = getSortedWeekLabels(modeMatches);
      if (preferredWeekTag) {
        const exact = modeMatches.find((o) => sameWeekTag(o.week_label, preferredWeekTag));
        if (exact) return { selected: exact, matchedExactly: true, error: null, availableWeekLabels };
        const prefNum = getWeekNumber(preferredWeekTag);
        if (prefNum !== null) {
          return {
            selected: pickFallbackWithinCoverage(modeMatches),
            matchedExactly: false,
            error: buildWeekCoverageError(preferredWeekTag, availableWeekLabels),
            availableWeekLabels,
          };
        }
      }
      const fallback = modeMatches.slice().sort(compareOccByWeek);
      return { selected: fallback[0] || null, matchedExactly: false, error: null, availableWeekLabels };
    }
    return {
      selected: null,
      matchedExactly: false,
      error: missedDay ? `该班级没有 ${missedDay} 的课次数据` : `该班级没有 ${missedMode} 的课次数据`,
      availableWeekLabels: [],
    };
  }
  const narrowedModeMatches = dayMatches.filter((o) => o.mode === missedMode);
  const pool = narrowedModeMatches.length ? narrowedModeMatches : dayMatches;
  const availableWeekLabels = getSortedWeekLabels(pool);

  if (preferredWeekTag) {
    const exact = pool.find((o) => sameWeekTag(o.week_label, preferredWeekTag));
    if (exact) return { selected: exact, matchedExactly: true, error: null, availableWeekLabels };
    const prefNum = getWeekNumber(preferredWeekTag);
    if (prefNum !== null) {
      return {
        selected: pickFallbackWithinCoverage(pool),
        matchedExactly: false,
        error: buildWeekCoverageError(preferredWeekTag, availableWeekLabels),
        availableWeekLabels,
      };
    }
  }
  const fallback = pool.slice().sort(compareOccByWeek);
  return { selected: fallback[0] || null, matchedExactly: false, error: null, availableWeekLabels };
}

// ── Quick input parser ──

export function parseQuickInput(
  text: string,
  classesByCode: Map<string, unknown>,
  occByClass: Map<string, MakeupOccurrence[]>,
  weekCtx: WeekContext,
): QuickParseResult {
  const result: QuickParseResult = {
    classCode: null, missedDay: null, missedOccId: null,
    makeupRequests: [],
    makeupPairs: [], makeupDaysOnly: [],
    weekTag: null, weekSource: null, feedbackLines: [], selectionError: null,
  };
  if (!text.trim()) return result;
  const normalizedText = normalizeInputText(text);

  // 1. Class code
  const classMatches = [...normalizedText.matchAll(/(?<![A-Za-z0-9])([A-Za-z]{1,2}\d{1,3})(?![A-Za-z0-9])/g)]
    .map((match) => match[1].toUpperCase());
  let unmatchedClassCode: string | null = null;
  for (const code of classMatches) {
    if (classesByCode.has(code)) {
      result.classCode = code;
      unmatchedClassCode = null;
      break;
    }
    if (!unmatchedClassCode) unmatchedClassCode = code;
  }
  if (!result.classCode && unmatchedClassCode) {
    result.feedbackLines.push(`⚠️ ${unmatchedClassCode} 不在当前学段的进度表中，请确认学段是否正确`);
  }

  // 2. Day+time pairs
  const timedRequests = extractTimedRequests(normalizedText);

  // 3. Day-only references
  const allDays: { day: string; pos: number; paired: boolean }[] = [];
  const dayRe = /(?:周|星期)([一二三四五六日天])/g;
  let dm: RegExpExecArray | null;
  while ((dm = dayRe.exec(normalizedText)) !== null) {
    const day = DAY_CHAR_MAP[dm[1]] || `周${dm[1]}`;
    const paired = timedRequests.some((p) => p.pos === dm!.index);
    allDays.push({ day, pos: dm.index, paired });
  }

  // 4. Detect missed keyword
  let missedPos = -1;
  for (const kw of MISSED_KEYWORDS) {
    const idx = normalizedText.indexOf(kw);
    if (idx >= 0) { missedPos = idx; break; }
  }

  // 5. Interpret
  let missedDay: string | null = null;
  let missedModeHint: '周中' | '周末' | null = null;
  const makeupRequests: { day: string; time: string; endTime?: string; mode: 'exact' | 'after' | 'before' | 'range'; raw: string }[] = [];
  const makeupDaysOnly: string[] = [];

  if (missedPos >= 0) {
    const missedWindow = normalizedText.slice(Math.max(0, missedPos - 10), Math.min(normalizedText.length, missedPos + 10));
    if (/周末/.test(missedWindow)) missedModeHint = '周末';
    else if (/周中|周内/.test(missedWindow)) missedModeHint = '周中';

    const unpaired = allDays.filter((d) => !d.paired);
    const beforeDays = unpaired.filter((d) => d.pos < missedPos);
    const makeupTaggedDays = new Set(
      unpaired
        .filter((d) => d.pos > missedPos && hasMakeupIntentAround(normalizedText, d.pos))
        .map((d) => `${d.day}@${d.pos}`),
    );
    const closestBefore = nearestDay(beforeDays, missedPos);
    const closestAny = nearestDay(unpaired.filter((d) => !makeupTaggedDays.has(`${d.day}@${d.pos}`)), missedPos);
    if (closestBefore && closestBefore.dist < 20) {
      missedDay = closestBefore.day;
    } else if (!missedModeHint && closestAny && closestAny.dist < 20) {
      missedDay = closestAny.day;
    }
    if (!missedDay && !missedModeHint && timedRequests.length > 0) {
      const cp = timedRequests.reduce<{ ref: typeof timedRequests[0]; dist: number } | null>((best, p) => {
        const dist = Math.abs(p.pos - missedPos);
        return (!best || dist < best.dist) ? { ref: p, dist } : best;
      }, null);
      if (cp && cp.dist < 20) {
        missedDay = cp.ref.day;
        timedRequests.splice(timedRequests.indexOf(cp.ref), 1);
      }
    }
    for (const req of timedRequests) makeupRequests.push({ day: req.day, time: req.time, endTime: req.endTime, mode: req.mode, raw: req.raw });
    for (const d of allDays) {
      if (d.paired) continue;
      if (d.day === missedDay && Math.abs(d.pos - missedPos) < 20) continue;
      if (d.pos > missedPos && hasMakeupIntentAround(normalizedText, d.pos)) {
        if (!makeupDaysOnly.includes(d.day)) makeupDaysOnly.push(d.day);
        continue;
      }
      if (missedModeHint && d.pos > missedPos) continue;
      if (!makeupDaysOnly.includes(d.day)) makeupDaysOnly.push(d.day);
    }
    for (const day of detectMakeupModeDays(normalizedText, missedPos)) {
      if (!makeupDaysOnly.includes(day)) makeupDaysOnly.push(day);
    }
  } else if (timedRequests.length >= 2) {
    missedDay = timedRequests[0].day;
    for (let i = 1; i < timedRequests.length; i++) {
      makeupRequests.push({ day: timedRequests[i].day, time: timedRequests[i].time, endTime: timedRequests[i].endTime, mode: timedRequests[i].mode, raw: timedRequests[i].raw });
    }
  } else if (timedRequests.length === 1) {
    makeupRequests.push({ day: timedRequests[0].day, time: timedRequests[0].time, endTime: timedRequests[0].endTime, mode: timedRequests[0].mode, raw: timedRequests[0].raw });
  } else {
    const unpaired = allDays.filter((d) => !d.paired);
    if (unpaired.length >= 2) {
      missedDay = unpaired[0].day;
      for (let i = 1; i < unpaired.length; i++) {
        if (!makeupDaysOnly.includes(unpaired[i].day)) makeupDaysOnly.push(unpaired[i].day);
      }
    }
  }

  // 6. Week resolution
  const reqWeek = resolveRequestedWeek(normalizedText, weekCtx.currentWeek);
  const targetWeekTag = reqWeek?.weekTag || weekCtx.currentWeek;
  result.weekTag = targetWeekTag;
  result.weekSource = reqWeek?.source || null;

  // 7. Select missed lesson
  if ((missedDay || missedModeHint) && result.classCode) {
    const sel = selectMissedLesson(result.classCode, missedDay || '', targetWeekTag, occByClass, missedModeHint);
    if (sel.selected) result.missedOccId = sel.selected.id;
    result.selectionError = sel.error;
    if (!missedDay && sel.selected) missedDay = sel.selected.day;
  } else if (result.classCode && (makeupRequests.length || makeupDaysOnly.length)) {
    result.selectionError = '请补充请假的上课日，或说明是周中还是周末请假';
  }

  result.missedDay = missedDay;
  result.makeupRequests = makeupRequests;
  result.makeupPairs = makeupRequests.filter((item) => item.mode === 'exact').map((item) => ({ day: item.day, time: item.time }));
  result.makeupDaysOnly = makeupDaysOnly;

  // 8. Feedback
  const fb: string[] = [];
  if (result.classCode) fb.push('班级：' + result.classCode);
  if (reqWeek) fb.push('识别周次：' + reqWeek.source);
  if (missedDay) fb.push('缺课日：' + missedDay + (targetWeekTag ? `（${targetWeekTag}）` : ''));
  if (result.missedOccId) {
    const occ = (occByClass.get(result.classCode!) || []).find((o) => o.id === result.missedOccId);
    if (occ) fb.push('缺课内容：' + occ.lesson + '｜' + occ.week_label);
  }
  if (result.selectionError) {
    fb.push('缺课内容：' + result.selectionError);
  }
  if (makeupRequests.length) fb.push('补课时间：' + makeupRequests.map((p) => p.raw).join('、'));
  if (makeupDaysOnly.length) fb.push('补课时间：' + makeupDaysOnly.join('、') + '（全部时段）');
  result.feedbackLines = fb;

  return result;
}
