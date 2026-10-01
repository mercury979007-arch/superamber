import { L2_DAILY_SCHEDULE } from './l2DailySchedule';
import {
  CAMP_ACTIVITY_NOTICE_ALIASES,
  CAMP_ACTIVITY_NOTICE_ENTRIES,
  CAMP_ACTIVITY_NOTICE_TEXT,
  type CampActivityNoticeEntry,
} from './campActivityNotices';
import {
  findSparkchatDailyGoalEntry,
  getSparkchatActivityNoticeEntries,
  getSparkchatActivityNoticeText,
  getSparkchatTopicContent,
  isSparkchatReportMajor,
  type SparkchatActivityNoticeEntry,
  type SparkchatDailyGoalEntry,
  type SparkchatTopicContent,
} from './campReportLatestStandard';

export type CampMajorLevel = 'L0' | 'L1大' | 'L1小' | 'L2' | 'L3' | 'L4' | 'S';

const GOAL_SECTION_TITLE = '今日竞赛里程';
const TEACHING_GOAL_TITLE = '冲刺目标';
const MORAL_GOAL_TITLE = '运行目标';
const CHALLENGE_SECTION_TITLE = '赛后加油站';
const REMINDER_SECTION_TITLE = '明日提醒';

export interface CampMajorOption {
  level: CampMajorLevel;
  campName: string;
  label: string;
}

export interface CampDayPlan {
  majorLevel: CampMajorLevel;
  majorCampName: string;
  minorCamp: string;
  date: string;
  dayIndex: number;
  dayLabel: string;
  topic: string;
  teachingGoals: string[];
  moralGoals: string[];
  afterClass: string;
  activity: string;
  supplies: string;
  courseSummary: string;
  tomorrowActivityPreview: string;
}

interface ScheduleSlot {
  period: number;
  internalCourse: string;
  externalCourse: string;
  kind: 'course' | 'activity' | 'empty';
  activityKey: string;
  activityTitle: string;
  activityDescription: string;
  activitySupplies: string;
}

interface ScheduleDay {
  date: string;
  slots: ScheduleSlot[];
}

interface ScheduleCamp {
  camp: string;
  days: ScheduleDay[];
}

interface TopicContent {
  teachingGoals: string[];
  moralGoals: string[];
  afterClass: string;
}

const L2_SCHEDULE_DATA = L2_DAILY_SCHEDULE as unknown as readonly ScheduleCamp[];
const NO_TOMORROW_ACTIVITY_TEXT = '明日暂未匹配到额外活动提醒，按常规准备营服、水杯与学习物资。';
const LESSON_PERIOD_LABELS: Record<number, string> = {
  1: '第1节',
  2: '第2节',
  3: '第3节',
  4: '第4节',
  5: '第5节',
  6: '第6节',
  7: '第7节',
};
const LESSON_PERIOD_TIMES: Record<number, string> = {
  1: '8:30-9:20',
  2: '9:30-10:20',
  3: '10:40-11:30',
  4: '11:40-12:30',
  5: '13:40-14:30',
  6: '14:40-15:30',
  7: '15:40-16:30',
};

const TOPIC_CONTENT: Record<string, TopicContent> = Object.fromEntries(
  ['Topic 1', 'Topic 2', 'Topic 3', 'Topic 4', 'Topic 5', 'Topic 6', 'Topic 7', 'Topic 8', 'Review 1', 'Review 2', 'Review 3']
    .map((topic) => [topic, {
      teachingGoals: ['请填写本日教学目标。'],
      moralGoals: ['请填写本日成长目标。'],
      afterClass: '请填写课后内容。',
    }]),
);

const CAMP_DAY_DATES = [
  { date: '2026-07-20', dayIndex: 1, phaseIndex: 1 },
  { date: '2026-07-21', dayIndex: 2, phaseIndex: 1 },
  { date: '2026-07-22', dayIndex: 3, phaseIndex: 1 },
  { date: '2026-07-23', dayIndex: 4, phaseIndex: 1 },
  { date: '2026-07-24', dayIndex: 5, phaseIndex: 1 },
  { date: '2026-07-25', dayIndex: 6, phaseIndex: 1 },
  { date: '2026-07-27', dayIndex: 7, phaseIndex: 1 },
  { date: '2026-07-28', dayIndex: 8, phaseIndex: 1 },
  { date: '2026-07-29', dayIndex: 9, phaseIndex: 1 },
  { date: '2026-07-30', dayIndex: 10, phaseIndex: 1 },
  { date: '2026-07-31', dayIndex: 11, phaseIndex: 1 },
  { date: '2026-08-03', dayIndex: 1, phaseIndex: 2 },
  { date: '2026-08-04', dayIndex: 2, phaseIndex: 2 },
  { date: '2026-08-05', dayIndex: 3, phaseIndex: 2 },
  { date: '2026-08-06', dayIndex: 4, phaseIndex: 2 },
  { date: '2026-08-07', dayIndex: 5, phaseIndex: 2 },
  { date: '2026-08-08', dayIndex: 6, phaseIndex: 2 },
  { date: '2026-08-10', dayIndex: 7, phaseIndex: 2 },
  { date: '2026-08-11', dayIndex: 8, phaseIndex: 2 },
  { date: '2026-08-12', dayIndex: 9, phaseIndex: 2 },
  { date: '2026-08-13', dayIndex: 10, phaseIndex: 2 },
  { date: '2026-08-14', dayIndex: 11, phaseIndex: 2 },
];

const CAMP_REPORT_DEFAULT_DATE = CAMP_DAY_DATES[0]?.date || '2026-07-20';
const CAMP_NEXT_DAY_PROMPT_MINUTES = 11 * 60 + 30;

const TOPICS_BY_DAY: Record<number, { odd: string; even: string; all?: string }> = {
  1: { odd: 'Topic 1', even: 'Topic 2' },
  2: { odd: 'Topic 2', even: 'Topic 1' },
  3: { odd: 'Review 1', even: 'Review 1', all: 'Review 1' },
  4: { odd: 'Topic 3', even: 'Topic 4' },
  5: { odd: 'Topic 4', even: 'Topic 3' },
  6: { odd: 'Review 2', even: 'Review 2', all: 'Review 2' },
  7: { odd: 'Topic 5', even: 'Topic 6' },
  8: { odd: 'Topic 6', even: 'Topic 5' },
  9: { odd: 'Review 3', even: 'Review 3', all: 'Review 3' },
  10: { odd: 'Topic 7', even: 'Topic 8' },
  11: { odd: 'Topic 8', even: 'Topic 7' },
};

const ACTIVITY_SUPPLIES: Record<string, string> = {
  '活动1': 'O1',
  '活动2': 'O2',
  '活动3': 'O3',
  '活动4': 'O4',
  '活动5': 'O5',
  '活动6': 'O6',
  '活动7': 'O7',
  '活动8': 'O8',
  '活动9': 'O9',
  '活动10': 'O10',
};

function isCatalogPointer(value: string) {
  return /^[A-Z]{1,3}\d+$/i.test(value.trim());
}

function displayCatalogText(value: string, fallback: string) {
  const cleanValue = value.trim();
  if (!cleanValue || isCatalogPointer(cleanValue)) return fallback;
  return cleanValue;
}

export const CAMP_MAJOR_OPTIONS: CampMajorOption[] = [
  { level: 'L0', campName: 'Super Speak', label: 'L0 · Super Speak' },
  { level: 'L1大', campName: 'Rocky Party', label: 'L1大 · Rocky Party' },
  { level: 'L1小', campName: 'Chatty Party', label: 'L1小 · Chatty Party' },
  { level: 'L2', campName: 'Sparkchat', label: 'L2 · Sparkchat' },
  { level: 'L3', campName: 'Curiosity Formula', label: 'L3 · Curiosity Formula' },
  { level: 'L4', campName: 'Formula Write', label: 'L4 · Formula Write' },
  { level: 'S', campName: 'Dramaland', label: 'S · Dramaland' },
];

export const CAMP_MINOR_OPTIONS = Array.from({ length: 15 }, (_, index) => `Camp ${index + 1}`);
export const CAMP_DAY_OPTIONS = Array.from({ length: 11 }, (_, index) => index + 1);

function getMinorCampNumber(minorCamp: string) {
  const match = String(minorCamp || '').match(/\d+/);
  return match ? Number(match[0]) : 1;
}

function getTopicForDay(dayIndex: number, minorCamp: string) {
  const topicRule = TOPICS_BY_DAY[dayIndex] || TOPICS_BY_DAY[1];
  if (topicRule.all) return topicRule.all;
  return getMinorCampNumber(minorCamp) % 2 === 0 ? topicRule.even : topicRule.odd;
}

function getActivityForDay(dayIndex: number) {
  if (dayIndex < 1 || dayIndex > 10) return '';
  return `活动${dayIndex}`;
}

function getTopicContent(topic: string, majorLevel: string): TopicContent | SparkchatTopicContent | undefined {
  return getSparkchatTopicContent(topic, majorLevel) || TOPIC_CONTENT[topic];
}

export function getMajorCampName(level: string) {
  return CAMP_MAJOR_OPTIONS.find((item) => item.level === level)?.campName || level;
}

function toLocalDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getCampReportDateIndex(date: string) {
  return CAMP_DAY_DATES.findIndex((item) => item.date === date);
}

export function getCampReportPhase(date: string): number | null {
  return CAMP_DAY_DATES.find((item) => item.date === date)?.phaseIndex || null;
}

export function getNextCampReportDate(date: string): string | null {
  const index = getCampReportDateIndex(date);
  if (index < 0) {
    return null;
  }
  return CAMP_DAY_DATES[index + 1]?.date || null;
}

function getL2ScheduleCamp(minorCamp: string) {
  const campName = `营${getMinorCampNumber(minorCamp)}`;
  return L2_SCHEDULE_DATA.find((camp) => camp.camp === campName) || null;
}

function findL2ScheduleDay(date: string, majorLevel: string, minorCamp: string) {
  if (!isSparkchatReportMajor(majorLevel)) return null;
  const camp = getL2ScheduleCamp(minorCamp);
  return camp?.days.find((day) => day.date === date) || null;
}

function getSlotExternalCourse(slot: ScheduleSlot) {
  return (slot.externalCourse || slot.internalCourse || '待安排').trim();
}

function buildCourseSummaryFromDay(day: ScheduleDay | null) {
  if (!day) return '';
  return day.slots
    .map((slot) => {
      const periodLabel = LESSON_PERIOD_LABELS[slot.period] || `第${slot.period}节`;
      const periodTime = LESSON_PERIOD_TIMES[slot.period] || '';
      const course = getSlotExternalCourse(slot);
      return `${periodLabel}${periodTime ? ` ${periodTime}` : ''} ${course}`;
    })
    .filter(Boolean)
    .join('\n');
}

function isPreviewableActivitySlot(slot: ScheduleSlot) {
  const internalCourse = String(slot.internalCourse || '');
  const externalCourse = getSlotExternalCourse(slot);
  if (slot.kind !== 'activity') return false;
  if (!slot.activityKey && !slot.activityTitle) return false;
  if (internalCourse.includes('空课') || externalCourse.includes('班级PK挑战')) return false;
  return true;
}

function getUniqueActivitySlots(day: ScheduleDay | null) {
  if (!day) return [];
  const seen = new Set<string>();
  return day.slots.filter((slot) => {
    if (!isPreviewableActivitySlot(slot)) return false;
    const key = [
      slot.activityKey,
      slot.activityTitle,
      slot.activitySupplies,
      slot.period,
    ].join(':');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildActivityPreviewFromSlots(slots: ScheduleSlot[]) {
  return slots
    .map((slot) => {
      const title = slot.activityTitle || slot.activityKey || getSlotExternalCourse(slot);
      const description = slot.activityDescription.trim();
      const supplies = slot.activitySupplies.trim() || '无需额外准备物资。';
      return [
        `🌟【${title}】预告`,
        description,
        `明天准备：${supplies}`,
      ].filter(Boolean).join('\n');
    })
    .join('\n\n');
}

function getNormalizedMinorCamp(minorCamp: string) {
  return `Camp ${getMinorCampNumber(minorCamp)}`;
}

function getActivityNoticeText(entry: CampActivityNoticeEntry | SparkchatActivityNoticeEntry) {
  if ('noticeText' in entry) {
    return getSparkchatActivityNoticeText(entry);
  }
  const noticeKey = CAMP_ACTIVITY_NOTICE_ALIASES[entry.activityName] || entry.activityName;
  const notice = CAMP_ACTIVITY_NOTICE_TEXT[noticeKey]?.trim();
  if (notice) return notice;
  return `各位家长好✨\n明天苦令营将迎来【${entry.activityName}】活动课！\n\n请孩子听从老师安排，积极参与活动；如孩子身体不适，请提前联系班主任老师。`;
}

function buildActivityPreviewFromNotices(entries: readonly (CampActivityNoticeEntry | SparkchatActivityNoticeEntry)[]) {
  return entries
    .map((entry) => {
      const scheduleLine = [
        '🌟明日活动',
        entry.periodLabel,
        entry.time,
        entry.activityName,
      ].filter(Boolean).join('｜');
      return [
        scheduleLine,
        getActivityNoticeText(entry),
      ].filter(Boolean).join('\n');
    })
    .join('\n\n');
}

function getCampActivityNoticeEntries(date: string, majorLevel: string, minorCamp: string) {
  const normalizedMinorCamp = getNormalizedMinorCamp(minorCamp);
  const sparkchatEntries = getSparkchatActivityNoticeEntries(date, majorLevel, normalizedMinorCamp);
  if (sparkchatEntries.length > 0) {
    return sparkchatEntries;
  }
  return CAMP_ACTIVITY_NOTICE_ENTRIES.filter((entry) => (
    entry.date === date
    && entry.majorLevel === majorLevel
    && entry.minorCamp === normalizedMinorCamp
  ));
}

function buildTomorrowActivityPreview(date: string, majorLevel: string, minorCamp: string) {
  const nextDate = getNextCampReportDate(date);
  if (!nextDate) return '';
  const activityNotices = getCampActivityNoticeEntries(nextDate, majorLevel, minorCamp);
  if (activityNotices.length > 0) {
    return buildActivityPreviewFromNotices(activityNotices);
  }
  return buildActivityPreviewFromSlots(getUniqueActivitySlots(findL2ScheduleDay(nextDate, majorLevel, minorCamp)));
}

export function getCurrentCampReportDate(now = new Date()) {
  const todayKey = toLocalDateKey(now);
  return CAMP_DAY_DATES.find((item) => item.date >= todayKey)?.date
    || CAMP_DAY_DATES[CAMP_DAY_DATES.length - 1]?.date
    || CAMP_REPORT_DEFAULT_DATE;
}

export function resolveCampReportLaunchDate(preferredDate: string | undefined, now = new Date()) {
  const operationalDate = getCurrentCampReportDate(now);
  const operationalIndex = getCampReportDateIndex(operationalDate);
  const preferredIndex = preferredDate ? getCampReportDateIndex(preferredDate) : -1;
  return preferredIndex >= operationalIndex
    ? preferredDate || operationalDate
    : operationalDate;
}

export function shouldPromptForNextCampReportDate(currentDate: string, now = new Date()) {
  if (currentDate !== toLocalDateKey(now)) {
    return false;
  }
  if (!getNextCampReportDate(currentDate)) {
    return false;
  }
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  return currentMinutes >= CAMP_NEXT_DAY_PROMPT_MINUTES;
}

export function getDefaultCampReportDate(majorLevel = 'L2', minorCamp = 'Camp 1', now = new Date()) {
  const date = getCurrentCampReportDate(now);
  return findCampDayPlan(date, majorLevel, minorCamp)?.date || date || CAMP_REPORT_DEFAULT_DATE;
}

export function getCampReportDateOptions() {
  return CAMP_DAY_DATES.map((item) => ({
    date: item.date,
    dayIndex: item.dayIndex,
    phaseIndex: item.phaseIndex,
    dayLabel: `Day ${item.dayIndex}`,
  }));
}

export function findCampDayPlan(date: string, majorLevel: string, minorCamp: string): CampDayPlan | null {
  const day = CAMP_DAY_DATES.find((item) => item.date === date);
  if (!day) return null;

  const majorCampName = getMajorCampName(majorLevel);
  const sparkchatDailyGoal = findSparkchatDailyGoalEntry(date, majorLevel, getNormalizedMinorCamp(minorCamp));
  const topic = sparkchatDailyGoal?.topic || getTopicForDay(day.dayIndex, minorCamp);
  const content = sparkchatDailyGoal || getTopicContent(topic, majorLevel);
  if (!content) return null;

  const activity = getActivityForDay(day.dayIndex);
  const scheduleDay = findL2ScheduleDay(date, majorLevel, minorCamp);
  return {
    majorLevel: majorLevel as CampMajorLevel,
    majorCampName,
    minorCamp,
    date,
    dayIndex: day.dayIndex,
    dayLabel: `Day ${day.dayIndex}`,
    topic,
    teachingGoals: [...content.teachingGoals],
    moralGoals: [...content.moralGoals],
    afterClass: content.afterClass,
    activity,
    supplies: activity ? ACTIVITY_SUPPLIES[activity] || '' : '',
    courseSummary: buildCourseSummaryFromDay(scheduleDay),
    tomorrowActivityPreview: buildTomorrowActivityPreview(date, majorLevel, minorCamp),
  };
}

export function buildCourseTextFromPlan(plan: CampDayPlan | null) {
  if (!plan?.courseSummary) return '';
  return `今日课程\n${plan.courseSummary}`;
}

export function buildTomorrowActivityPreviewText(plan: CampDayPlan | null) {
  return plan?.tomorrowActivityPreview || '';
}

export function buildGoalTextFromPlan(plan: CampDayPlan | null, fallbackCampName: string) {
  if (!plan) {
    return [
      `${fallbackCampName} ${GOAL_SECTION_TITLE}`,
      `${TEACHING_GOAL_TITLE}：待补充`,
      `${MORAL_GOAL_TITLE}：待补充`,
    ].join('\n');
  }

  return [
    `${plan.majorCampName} ${plan.minorCamp} ${plan.dayLabel} ${GOAL_SECTION_TITLE}`,
    `今日话题：${plan.topic}`,
    ...plan.teachingGoals.map((goal, index) => `${TEACHING_GOAL_TITLE}${index + 1}：${displayCatalogText(goal, `${TEACHING_GOAL_TITLE}待补充。`)}`),
    ...plan.moralGoals.map((goal, index) => `${MORAL_GOAL_TITLE}${index + 1}：${displayCatalogText(goal, `${MORAL_GOAL_TITLE}待补充。`)}`),
  ].join('\n');
}

export function buildPrepTextFromPlan(plan: CampDayPlan | null) {
  const afterClassText = plan
    ? displayCatalogText(plan.afterClass, '赛后加油内容待补充。')
    : '待补充赛后加油内容。';
  const suppliesText = plan?.tomorrowActivityPreview
    ? plan.tomorrowActivityPreview
    : plan
      ? NO_TOMORROW_ACTIVITY_TEXT
      : '今日暂无本地模板活动物资。';

  return [
    CHALLENGE_SECTION_TITLE,
    afterClassText,
    REMINDER_SECTION_TITLE,
    suppliesText,
  ].join('\n');
}
