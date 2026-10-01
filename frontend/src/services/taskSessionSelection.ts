import type { DayOfWeek } from '../types';
import type { ClassControlSession } from './classControlSchedule';
import type { RosterSnapshotWeekTask } from './rosterSnapshotService';

const DAY_ORDER: DayOfWeek[] = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export type TaskSessionRecommendation = {
  selectedWeekIds: string[];
  targetSessionDate: string;
  previousMatchingSessionDate: string;
  targetDay: DayOfWeek | '';
  confidence: 'exact' | 'fallback' | 'none';
  needsConfirmation: boolean;
  reason: string;
};

function shanghaiDateParts(date: Date): { dateKey: string; day: DayOfWeek } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).formatToParts(date).map((part) => [part.type, part.value]));
  const weekday = String(parts.weekday || '').replace('星期', '周') as DayOfWeek;
  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    day: DAY_ORDER.includes(weekday) ? weekday : '周日',
  };
}

function addDateKeyDays(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T12:00:00+08:00`);
  date.setUTCDate(date.getUTCDate() + days);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}

function taskStartDate(task: RosterSnapshotWeekTask): string {
  const raw = String(task.startAt || task.addedAt || '').trim();
  if (!raw) return '';
  const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T');
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized);
  const parsed = new Date(hasZone ? normalized : `${normalized}+08:00`);
  return Number.isNaN(parsed.getTime()) ? raw.slice(0, 10) : shanghaiDateParts(parsed).dateKey;
}

function uniqueIds(values: string[]): string[] {
  return [...new Set(values.map(String).filter(Boolean))];
}

export function recommendTasksForMatchingSession({
  tasks,
  defaultSelectedWeekIds = [],
  sessions,
  now = new Date(),
}: {
  tasks: RosterSnapshotWeekTask[];
  defaultSelectedWeekIds?: string[];
  sessions: ClassControlSession[];
  now?: Date;
}): TaskSessionRecommendation {
  const availableIds = new Set(tasks.map((task) => String(task.id)));
  const fallbackIds = uniqueIds(defaultSelectedWeekIds).filter((id) => availableIds.has(id));
  const current = shanghaiDateParts(now);
  const sessionDays = uniqueIds(sessions.map((session) => session.day))
    .filter((day): day is DayOfWeek => DAY_ORDER.includes(day as DayOfWeek));

  if (sessionDays.length === 0) {
    return {
      selectedWeekIds: fallbackIds,
      targetSessionDate: '',
      previousMatchingSessionDate: '',
      targetDay: '',
      confidence: fallbackIds.length ? 'fallback' : 'none',
      needsConfirmation: true,
      reason: fallbackIds.length ? '课程场次尚未确认，暂用系统推荐' : '课程场次和系统推荐都不可用',
    };
  }

  const currentDayIndex = DAY_ORDER.indexOf(current.day);
  const todaySession = sessionDays.includes(current.day);
  const targetDay = todaySession
    ? current.day
    : [...sessionDays].sort((left, right) => (
      ((DAY_ORDER.indexOf(left) - currentDayIndex + 7) % 7)
      - ((DAY_ORDER.indexOf(right) - currentDayIndex + 7) % 7)
    ))[0];
  const dayOffset = todaySession ? 0 : (DAY_ORDER.indexOf(targetDay) - currentDayIndex + 7) % 7;
  const targetSessionDate = addDateKeyDays(current.dateKey, dayOffset);
  const previousMatchingSessionDate = addDateKeyDays(targetSessionDate, -7);
  const exactIds = tasks
    .filter((task) => taskStartDate(task) === previousMatchingSessionDate)
    .map((task) => String(task.id));

  if (exactIds.length > 0) {
    return {
      selectedWeekIds: uniqueIds(exactIds),
      targetSessionDate,
      previousMatchingSessionDate,
      targetDay,
      confidence: 'exact',
      needsConfirmation: exactIds.length > 1,
      reason: exactIds.length > 1
        ? `上一对应场次有 ${exactIds.length} 轮挑战，请确认单选或多选`
        : `已匹配上一${targetDay}场次`,
    };
  }

  // A task can be published before the lesson. Never fall forward to this
  // week's tasks (or a different later session) just because it is newest.
  const previousOtherSession = sessionDays.filter((day) => day !== targetDay)
    .map((day) => (DAY_ORDER.indexOf(targetDay) - DAY_ORDER.indexOf(day) + 7) % 7)
    .sort((a, b) => a - b)[0] || 7;
  const windowStart = addDateKeyDays(previousMatchingSessionDate, -previousOtherSession);
  const priorTasks = tasks.filter((task) => {
    const date = taskStartDate(task);
    return Number(task.resourceCount) > 0 && date > windowStart && date < previousMatchingSessionDate;
  });
  const closestDate = priorTasks.map(taskStartDate).sort().slice(-1)[0];
  const priorIds = closestDate
    ? priorTasks.filter((task) => taskStartDate(task) === closestDate).map((task) => String(task.id))
    : [];
  const safeFallbackIds = fallbackIds.filter((id) => {
    const date = taskStartDate(tasks.find((task) => String(task.id) === id)!);
    return date && date <= previousMatchingSessionDate;
  });
  // New-term classes may have no previous-session records at all. Offer the
  // latest real activity package as a labelled preview, not a safety/resource
  // collection merely because it was published most recently.
  const availableActivityTasks = tasks.filter((task) => (
    (String(task.skuId || '') === '5' || String(task.collectionName || '').includes('活动计划'))
    && Number(task.resourceCount) > 0 && taskStartDate(task) && taskStartDate(task) <= current.dateKey
  ));
  const latestActivityDate = availableActivityTasks.map(taskStartDate).sort().slice(-1)[0];
  const latestActivityIds = availableActivityTasks.filter((task) => taskStartDate(task) === latestActivityDate).map((task) => String(task.id));
  const selectedWeekIds = priorIds.length ? uniqueIds(priorIds)
    : safeFallbackIds.length ? safeFallbackIds : latestActivityIds;
  return {
    selectedWeekIds,
    targetSessionDate,
    previousMatchingSessionDate,
    targetDay,
    confidence: selectedWeekIds.length ? 'fallback' : 'none',
    needsConfirmation: true,
    reason: priorIds.length
      ? `未找到 ${previousMatchingSessionDate} 当天开始的挑战，暂用课前最近一轮（${closestDate}），可调整`
      : safeFallbackIds.length
      ? `未找到 ${previousMatchingSessionDate} 的精确场次挑战，暂用系统推荐`
      : latestActivityIds.length
      ? `暂无上一对应场次的挑战，先展示最近可用的落实挑战（${latestActivityDate}），请核对`
      : `未找到 ${previousMatchingSessionDate} 的场次挑战，请手动选择`,
  };
}

export function sortTaskCatalog(tasks: RosterSnapshotWeekTask[]): RosterSnapshotWeekTask[] {
  return [...tasks].sort((left, right) => (
    taskStartDate(right).localeCompare(taskStartDate(left))
    || String(right.startAt || '').localeCompare(String(left.startAt || ''))
    || String(left.name || '').localeCompare(String(right.name || ''), 'zh-CN')
  ));
}
