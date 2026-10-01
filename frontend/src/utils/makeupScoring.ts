import type { MakeupOccurrence, MakeupClassMeta, ScoredCandidate } from '../types/makeup';
import { getWeekNumber } from './makeupParser';

// Weights (total up to 100)
const W_BASE = 30;        // same lesson content (prerequisite)
const W_TYPE = 25;        // same class type
const W_GRADE = 18;       // same grade
const W_CAMPUS = 10;      // same campus
const W_TEACHER = 7;      // same primary teacher
const W_WEEK = 5;         // same week label
const W_NEAR_WEEK = 3;    // adjacent week for fuzzy lesson labels
const W_BRIDGE = 3;       // teacher continuity across weekday/weekend
const W_ENROLL_MAX = 2;   // low enrollment bonus
const MAX_FUZZY_WEEK_GAP = 1;
const MAX_SPECIAL_WEEK_GAP = 2;

type LessonSignature = {
  family: string;
  seq: string;
};

type LessonMatchInfo = {
  matched: boolean;
  exact: boolean;
  fuzzy: boolean;
  weekGap: number | null;
  reason: string;
};

const CHINESE_DIGITS: Record<string, string> = {
  '零': '0',
  '一': '1',
  '二': '2',
  '三': '3',
  '四': '4',
  '五': '5',
  '六': '6',
  '七': '7',
  '八': '8',
  '九': '9',
  '十': '10',
};

const LESSON_FAMILY_PATTERNS: Array<{ family: string; pattern: RegExp }> = [
  { family: '字母专题课', pattern: /字母专题课\s*([0-9]+(?:-[0-9]+)?)/i },
  { family: '拼读专题课', pattern: /拼读专题课\s*([0-9]+(?:-[0-9]+)?)/i },
  { family: '开学第一课', pattern: /开学第1课\s*([0-9]+(?:-[0-9]+)?)/i },
  { family: '图片描述', pattern: /图片描述\s*([0-9]+(?:-[0-9]+)?)/i },
  { family: '字母专题', pattern: /字母专题\s*([0-9]+(?:-[0-9]+)?)/i },
  { family: '拼读专题', pattern: /拼读专题\s*([0-9]+(?:-[0-9]+)?)/i },
  { family: '新课程', pattern: /新课程\s*([0-9]+(?:-[0-9]+)?)/i },
  { family: 'lesson', pattern: /lesson\s*([0-9]+(?:-[0-9]+)?)/i },
  { family: '绘本', pattern: /绘本\s*([0-9]+(?:-[0-9]+)?)/i },
  { family: '看剧', pattern: /看剧\s*t?\s*([0-9]+(?:-[0-9]+)?)/i },
  { family: '拼读', pattern: /拼读\s*([0-9]+(?:-[0-9]+)?)/i },
  { family: '字母', pattern: /字母\s*([0-9]+(?:-[0-9]+)?)/i },
];

function sameWeekLabel(a: MakeupOccurrence, b: MakeupOccurrence): boolean {
  return a.week_label === b.week_label;
}

function samePrimaryTeacher(origin: MakeupOccurrence, candidate: MakeupOccurrence): boolean {
  return !!origin.teacher && origin.teacher === candidate.teacher;
}

function sameTeacherBridge(originMeta: MakeupClassMeta | undefined, candidate: MakeupOccurrence): boolean {
  if (!originMeta) return false;
  const otherTeacher = candidate.mode === '周中' ? originMeta.weekend.teacher : originMeta.weekday.teacher;
  return !!otherTeacher && otherTeacher === candidate.teacher;
}

function normalizeLessonText(lesson: string): string {
  return lesson
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[零一二三四五六七八九十]/g, (char) => CHINESE_DIGITS[char] ?? char)
    .replace(/[（【]/g, '(')
    .replace(/[）】]/g, ')')
    .replace(/[：]/g, ':')
    .replace(/\(\s*跳(?:过)?[^)]*\)/g, '')
    .replace(/跳(?:过)?\s*\d+(?:[，,、]\s*\d+)*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getLessonSignature(lesson: string): LessonSignature | null {
  const normalized = normalizeLessonText(lesson);
  for (const { family, pattern } of LESSON_FAMILY_PATTERNS) {
    const match = normalized.match(pattern);
    if (match) {
      return { family, seq: match[1] };
    }
  }
  return null;
}

function parseSequenceNumber(seq: string): number | null {
  const match = String(seq || '').match(/^\d+/);
  if (!match) return null;
  return parseInt(match[0], 10);
}

function getWeekGap(originOcc: MakeupOccurrence, candidate: MakeupOccurrence): number | null {
  const originWeek = getWeekNumber(originOcc.week_label);
  const candidateWeek = getWeekNumber(candidate.week_label);
  if (originWeek === null || candidateWeek === null) return null;
  return Math.abs(originWeek - candidateWeek);
}

function evaluateLessonMatchWithGap(
  originOcc: MakeupOccurrence,
  candidate: MakeupOccurrence,
  maxIndexedWeekGap: number,
): LessonMatchInfo {
  const originText = normalizeLessonText(originOcc.lesson);
  const candidateText = normalizeLessonText(candidate.lesson);
  const weekGap = getWeekGap(originOcc, candidate);
  const originSignature = getLessonSignature(originOcc.lesson);
  const candidateSignature = getLessonSignature(candidate.lesson);
  const sameSignature = !!originSignature
    && !!candidateSignature
    && originSignature.family === candidateSignature.family
    && originSignature.seq === candidateSignature.seq;
  if (originText === candidateText) {
    if (weekGap !== null && weekGap > maxIndexedWeekGap) {
      return {
        matched: false,
        exact: true,
        fuzzy: false,
        weekGap,
        reason: `同名但周次相差 ${weekGap} 周`,
      };
    }
    return {
      matched: true,
      exact: true,
      fuzzy: false,
      weekGap,
      reason: '进度相同',
    };
  }

  if (sameSignature) {
    if (weekGap !== null && weekGap > maxIndexedWeekGap) {
      return {
        matched: false,
        exact: false,
        fuzzy: true,
        weekGap,
        reason: `${originSignature.family}${originSignature.seq} 但周次相差 ${weekGap} 周`,
      };
    }
    return {
      matched: true,
      exact: false,
      fuzzy: true,
      weekGap,
      reason: `${originSignature.family}${originSignature.seq} 近似匹配`,
    };
  }

  return {
    matched: false,
    exact: false,
    fuzzy: false,
    weekGap,
    reason: '进度不同',
  };
}

export function evaluateLessonMatch(originOcc: MakeupOccurrence, candidate: MakeupOccurrence): LessonMatchInfo {
  return evaluateLessonMatchWithGap(originOcc, candidate, MAX_FUZZY_WEEK_GAP);
}

export function evaluateSpecialLessonMatch(originOcc: MakeupOccurrence, candidate: MakeupOccurrence): LessonMatchInfo {
  const match = evaluateLessonMatchWithGap(originOcc, candidate, MAX_SPECIAL_WEEK_GAP);
  if (match.matched) {
    if (match.weekGap === null || match.weekGap <= MAX_FUZZY_WEEK_GAP) {
      return {
        ...match,
        matched: false,
        reason: '主链已覆盖，不进入特殊调整',
      };
    }
    return {
      ...match,
      reason: `特殊调整：${match.reason}`,
    };
  }

  const originSignature = getLessonSignature(originOcc.lesson);
  const candidateSignature = getLessonSignature(candidate.lesson);
  const weekGap = getWeekGap(originOcc, candidate);
  const sameFamily = !!originSignature
    && !!candidateSignature
    && originSignature.family === candidateSignature.family;
  const originSeq = originSignature ? parseSequenceNumber(originSignature.seq) : null;
  const candidateSeq = candidateSignature ? parseSequenceNumber(candidateSignature.seq) : null;

  if (!sameFamily || originSeq == null || candidateSeq == null || weekGap == null || weekGap > MAX_SPECIAL_WEEK_GAP) {
    return match;
  }

  const seqDelta = candidateSeq - originSeq;
  if (Math.abs(seqDelta) !== 1) {
    return match;
  }

  return {
    matched: true,
    exact: false,
    fuzzy: true,
    weekGap,
    reason: `特殊调整：同系列${seqDelta > 0 ? '快一课' : '慢一课'}（${candidate.lesson}）`,
  };
}

export function evaluateCoverageFallbackMatch(originOcc: MakeupOccurrence, candidate: MakeupOccurrence): LessonMatchInfo {
  if (!originOcc.type || !candidate.type || originOcc.type !== candidate.type) {
    return {
      matched: false,
      exact: false,
      fuzzy: false,
      weekGap: getWeekGap(originOcc, candidate),
      reason: '进度表不足，且候选类型不一致',
    };
  }

  return {
    matched: true,
    exact: false,
    fuzzy: true,
    weekGap: getWeekGap(originOcc, candidate),
    reason: '进度表不足：按同类型课表弱匹配',
  };
}

export function calcScore(
  originOcc: MakeupOccurrence,
  candidate: MakeupOccurrence,
  slotOrder: number,
  classesByCode: Map<string, MakeupClassMeta>,
  options?: { considerGrade?: boolean; specialMode?: boolean; coverageMode?: boolean },
): ScoredCandidate {
  const originMeta = classesByCode.get(originOcc.class_code);
  const lessonMatch = options?.coverageMode
    ? evaluateCoverageFallbackMatch(originOcc, candidate)
    : options?.specialMode
    ? evaluateSpecialLessonMatch(originOcc, candidate)
    : evaluateLessonMatch(originOcc, candidate);
  const considerGrade = options?.considerGrade ?? true;
  const reasons: ScoredCandidate['reasons'] = [{ text: lessonMatch.reason, good: lessonMatch.matched }];
  let pct = options?.coverageMode ? 12 : options?.specialMode ? 18 : W_BASE;

  if (options?.coverageMode) {
    reasons.push({ text: '当前周次进度缺失，按同类型未来班级弱推荐', good: false });
  } else if (options?.specialMode) {
    reasons.push({ text: '无最佳补课方案，作为特殊调整备选', good: false });
  }

  if (originOcc.type && originOcc.type === candidate.type) {
    pct += W_TYPE;
    reasons.push({ text: '同类型', good: true });
  } else {
    reasons.push({ text: `跨类型：${candidate.type || '未知'}`, good: false });
  }

  if (sameWeekLabel(originOcc, candidate)) {
    pct += W_WEEK;
    reasons.push({ text: '同一周次', good: true });
  } else if (lessonMatch.weekGap === 1) {
    pct += W_NEAR_WEEK;
    reasons.push({ text: '相邻周次', good: true });
  } else {
    reasons.push({ text: `候选周次：${candidate.week_label}`, good: false });
  }

  if (considerGrade && originOcc.grade && originOcc.grade === candidate.grade) {
    pct += W_GRADE;
    reasons.push({ text: '同年级', good: true });
  }

  if (originOcc.campus && originOcc.campus === candidate.campus) {
    pct += W_CAMPUS;
    reasons.push({ text: '同校区', good: true });
  }

  if (samePrimaryTeacher(originOcc, candidate)) {
    pct += W_TEACHER;
    reasons.push({ text: '同教师', good: true });
  }

  if (sameTeacherBridge(originMeta, candidate)) {
    pct += W_BRIDGE;
    reasons.push({ text: '教师衔接优先', good: true });
  }

  const count = parseInt(candidate.student_count, 10);
  if (!Number.isNaN(count)) {
    const enrollBonus = Math.max(0, Math.round(W_ENROLL_MAX * (1 - count / 25)));
    if (enrollBonus > 0) {
      pct += enrollBonus;
      reasons.push({ text: `人数少(${count}人)`, good: true });
    } else {
      reasons.push({ text: `${count}人`, good: false });
    }
  }

  pct = Math.min(100, Math.max(0, pct));
  // Same-week candidates MUST sort before non-same-week, regardless of other factors.
  // Tier: 2 = same week, 1 = adjacent week, 0 = farther
  const weekTier = sameWeekLabel(originOcc, candidate) ? 2 : (lessonMatch.weekGap === 1 ? 1 : 0);
  const sortKey = weekTier * 1000000 + (10 - slotOrder) * 10000 + pct * 100;
  return { candidate, pct, sortKey, weekTier, reasons };
}
