import type { AppScreen, ClassInfo, DayOfWeek } from '../types';
import type { ReminderNote } from '../seating/types';

export type TodoTarget = Extract<AppScreen, 'hub' | 'seating' | 'overview' | 'flow' | 'daily-report'>;

export interface TodoMetaState {
  enabled: boolean;
  weeklyConfirmedWeek: number;
  weeklyConfirmedAt: string;
  completedByDate: Record<string, string[]>;
}

export interface TodoAction {
  classCode: string;
  target: TodoTarget;
  label: string;
}

export interface TodoItem {
  key: string;
  title: string;
  detail?: string;
  kind: 'auto' | 'manual';
  done: boolean;
  actions: TodoAction[];
}

export interface BuildTodoItemsInput {
  classes: ClassInfo[];
  classDaysByCode: Record<string, DayOfWeek[]>;
  meta: TodoMetaState;
  notesByClass: Record<string, ReminderNote[]>;
  today?: Date;
}

export const DEFAULT_TODO_META: TodoMetaState = {
  enabled: false,
  weeklyConfirmedWeek: 0,
  weeklyConfirmedAt: '',
  completedByDate: {},
};

const DAY_LABELS: DayOfWeek[] = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const WEEK_ORDER: DayOfWeek[] = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

export function toDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(date: Date, amount: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

export function formatDateLabel(dateKey: string): string {
  const date = new Date(`${dateKey}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return dateKey;
  }

  return `${date.getMonth() + 1}/${date.getDate()} ${DAY_LABELS[date.getDay()]}`;
}

function isWeekendDay(day: DayOfWeek): boolean {
  return day === '周六' || day === '周日';
}

function previousDay(day: DayOfWeek): DayOfWeek {
  const index = WEEK_ORDER.indexOf(day);
  return WEEK_ORDER[(index + WEEK_ORDER.length - 1) % WEEK_ORDER.length];
}

export function getNextDateForClassDays(days: DayOfWeek[], from = new Date()): string {
  if (days.length === 0) {
    return toDateKey(from);
  }

  for (let offset = 0; offset < 7; offset += 1) {
    const candidate = addDays(from, offset);
    const dayLabel = DAY_LABELS[candidate.getDay()];
    if (days.includes(dayLabel)) {
      return toDateKey(candidate);
    }
  }

  return toDateKey(from);
}

function targetForReminderNote(text: string): TodoTarget {
  if (/积分|minipin/i.test(text)) {
    return 'flow';
  }
  if (/公示/i.test(text)) {
    return 'daily-report';
  }
  if (/概览|课后资料|板书|课件/i.test(text)) {
    return 'overview';
  }
  if (/座位/i.test(text)) {
    return 'seating';
  }
  return 'hub';
}

export function targetForAutoAction(action: string): TodoTarget {
  if (action.includes('积分') || action.includes('minipin')) {
    return 'flow';
  }
  if (action.includes('公示') || action.includes('课后资料')) {
    return action.includes('公示') ? 'daily-report' : 'overview';
  }
  return 'seating';
}

export function headlineForAction(action: string, classCodes: string[]): string {
  if (action === '发座位表') return `发 ${classCodes.join(' & ')} 座位表`;
  if (action === '发班级公示') return `发 ${classCodes.join(' & ')} 班级公示`;
  if (action === '发课后资料【板书+课件+概览】') return `发 ${classCodes.join(' & ')} 课后资料【板书+课件+概览】`;
  if (action === '发本周积分 / minipin') return `发 ${classCodes.join(' & ')} 本周积分 / minipin`;
  if (action === '物资确认') return `${classCodes.join(' & ')} 物资确认`;
  return `${action}：${classCodes.join(' & ')}`;
}

export function buttonLabel(action: TodoAction, single: boolean): string {
  if (!single) {
    return `${action.classCode} →`;
  }
  if (action.target === 'seating') return '去座位表';
  if (action.target === 'overview') return '去概览';
  if (action.target === 'daily-report') return '去日报';
  if (action.target === 'flow') return '去积分';
  return '去班级';
}

export function buildTodoItems({
  classes,
  classDaysByCode,
  meta,
  notesByClass,
  today = new Date(),
}: BuildTodoItemsInput): TodoItem[] {
  const todayKey = toDateKey(today);
  const todayDay = DAY_LABELS[today.getDay()];
  const completedToday = new Set(meta.completedByDate[todayKey] || []);
  const autoMap = new Map<string, { action: string; classCodes: string[]; details: string[] }>();
  const manualItems: TodoItem[] = [];

  const addAuto = (action: string, classCode: string, detail?: string) => {
    const entry = autoMap.get(action) || { action, classCodes: [], details: [] };
    if (!entry.classCodes.includes(classCode)) {
      entry.classCodes.push(classCode);
    }
    if (detail) {
      entry.details.push(`${classCode}：${detail}`);
    }
    autoMap.set(action, entry);
  };

  classes.forEach((cls) => {
    const classCode = cls.name.toUpperCase();
    const days = classDaysByCode[classCode] || [];
    const hasWeekday = days.some((day) => !isWeekendDay(day));
    const isPureWeekend = days.length > 0 && days.every((day) => isWeekendDay(day));
    const notes = (notesByClass[classCode] || []).filter((note) => !note.completed);
    const dueNotes = notes.filter((note) => note.dueDate <= todayKey);

    dueNotes.forEach((note) => {
      const target = targetForReminderNote(note.text);
      manualItems.push({
        key: `manual:${classCode}:${note.id}`,
        title: `${classCode} · ${note.text}`,
        detail: `DDL：${formatDateLabel(note.dueDate)}`,
        kind: 'manual',
        done: completedToday.has(`manual:${classCode}:${note.id}`),
        actions: [{ classCode, target, label: target === 'hub' ? '去班级' : '去处理' }],
      });
    });

    days.forEach((day) => {
      if (!isWeekendDay(day)) {
        if (previousDay(day) === todayDay) {
          addAuto('发座位表', classCode);
          addAuto('发班级公示', classCode);
        }
        if (day === todayDay) {
          if (dueNotes.length > 0) {
            addAuto('物资确认', classCode, dueNotes.map((note) => note.text).join('、'));
          }
          addAuto('发课后资料【板书+课件+概览】', classCode);
          addAuto('发本周积分 / minipin', classCode);
        }
        return;
      }

      if (isPureWeekend) {
        if (previousDay(day) === todayDay) {
          addAuto('发座位表', classCode);
          addAuto('发班级公示', classCode);
        }
        if (day === todayDay) {
          if (dueNotes.length > 0) {
            addAuto('物资确认', classCode, dueNotes.map((note) => note.text).join('、'));
          }
          addAuto('发课后资料【板书+课件+概览】', classCode);
          addAuto('发本周积分 / minipin', classCode);
        }
        return;
      }

      if (day === todayDay) {
        addAuto('发课后资料【板书+课件+概览】', classCode);
      }

      if (!hasWeekday && day === todayDay) {
        addAuto('发课后资料【板书+课件+概览】', classCode);
      }
    });
  });

  const autoItems = Array.from(autoMap.values()).map((entry) => {
    const sortedCodes = [...entry.classCodes].sort();
    const key = `auto:${todayKey}:${entry.action}:${sortedCodes.join('|')}`;

    return {
      key,
      title: headlineForAction(entry.action, sortedCodes),
      detail: entry.details.length > 0 ? entry.details.join('；') : undefined,
      kind: 'auto' as const,
      done: completedToday.has(key),
      actions: sortedCodes.map((classCode) => ({
        classCode,
        target: targetForAutoAction(entry.action),
        label: classCode,
      })),
    };
  });

  return [...autoItems, ...manualItems].sort((left, right) => {
    if (left.done !== right.done) return left.done ? 1 : -1;
    if (left.kind !== right.kind) return left.kind === 'auto' ? -1 : 1;
    return left.title.localeCompare(right.title, 'zh-Hans-CN');
  });
}
