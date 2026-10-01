import { addDays } from './calendar';
import type { ClassConfig, ClassData, ReminderNote, TimeMode } from './types';

export interface GeneratedTodoItem {
  key: string;
  title: string;
  classes: string[];
  detail?: string;
  kind: 'auto' | 'manual';
  alert?: boolean;
}

export function createReminderNote(
  text: string,
  dueDate: string,
  source: ReminderNote['source'],
): ReminderNote {
  return {
    id: `todo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    text: text.trim(),
    dueDate,
    source,
    completed: false,
    createdAt: new Date().toISOString(),
    completedAt: null,
  };
}

export function sanitizeReminderNotes(notesInput: unknown): ReminderNote[] {
  if (!Array.isArray(notesInput)) {
    return [];
  }

  return notesInput
    .map((note): ReminderNote | null => {
      if (!note || typeof note !== 'object') {
        return null;
      }

      const parsed = note as Partial<ReminderNote>;
      const text = typeof parsed.text === 'string' ? parsed.text.trim() : '';
      const dueDate = typeof parsed.dueDate === 'string' ? parsed.dueDate : '';
      if (!text || !dueDate) {
        return null;
      }

      return {
        id: typeof parsed.id === 'string' && parsed.id ? parsed.id : `todo-${Math.random().toString(36).slice(2, 8)}`,
        text,
        dueDate,
        source: parsed.source === 'weekly' ? 'weekly' : 'manual',
        completed: Boolean(parsed.completed),
        createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : new Date().toISOString(),
        completedAt: typeof parsed.completedAt === 'string' ? parsed.completedAt : null,
      };
    })
    .filter((note): note is ReminderNote => Boolean(note))
    .sort((left, right) => {
      if (left.completed !== right.completed) {
        return left.completed ? 1 : -1;
      }
      return left.dueDate.localeCompare(right.dueDate) || left.createdAt.localeCompare(right.createdAt);
    });
}

export function getClassMaterialNotesForDate(notes: ReminderNote[], dateKey: string): ReminderNote[] {
  return sanitizeReminderNotes(notes).filter((note) => !note.completed && note.dueDate === dateKey);
}

export function buildTodayTodoSummary({
  classData,
  currentTimeMode,
  todayKey,
  countStudentsInMode,
  getModeDateKey,
}: {
  classData: ClassData;
  currentTimeMode: TimeMode;
  todayKey: string;
  countStudentsInMode: (mode: ClassConfig[TimeMode]) => number;
  getModeDateKey: (mode: ClassConfig[TimeMode]) => string;
}): GeneratedTodoItem[] {
  const items = new Map<string, GeneratedTodoItem>();

  const addAuto = (title: string, className: string, detail?: string): void => {
    const key = `${title}::${detail || ''}`;
    const current = items.get(key);
    if (current) {
      if (!current.classes.includes(className)) {
        current.classes.push(className);
      }
      return;
    }

    items.set(key, {
      key,
      title,
      detail,
      classes: [className],
      kind: 'auto',
      alert: true,
    });
  };

  const addManual = (className: string, note: ReminderNote): void => {
    items.set(`note-${className}-${note.id}`, {
      key: `note-${className}-${note.id}`,
      title: note.text,
      detail: note.source === 'weekly' ? '学段资料包补充提醒' : '手动备忘',
      classes: [className],
      kind: 'manual',
      alert: true,
    });
  };

  Object.entries(classData).forEach(([className, config]) => {
    const weekdayCount = countStudentsInMode(config.weekday);
    const weekendCount = countStudentsInMode(config.weekend);
    const classNotesToday = getClassMaterialNotesForDate(config.todoNotes || [], todayKey);
    classNotesToday.forEach((note) => addManual(className, note));

    const weekdayDate = weekdayCount > 0 ? getModeDateKey(config.weekday) : '';
    if (weekdayDate) {
      if (addDays(weekdayDate, -1) === todayKey) {
        addAuto('发座位表', className);
        addAuto('发班级公示', className);
      }

      if (weekdayDate === todayKey) {
        if (classNotesToday.length > 0) {
          addAuto('物资确认', className, classNotesToday.map((note) => note.text).join('、'));
        }
        addAuto('发课后资料【板书+课件+概览】', className);
        addAuto('发本周积分 / minipin', className);
      }
    }

    const weekendDate = weekendCount > 0 ? getModeDateKey(config.weekend) : '';
    if (!weekendDate) {
      return;
    }

    const isPureWeekendClass = weekdayCount === 0 && weekendCount > 0;
    if (isPureWeekendClass) {
      if (addDays(weekendDate, -1) === todayKey) {
        addAuto('发座位表', className);
        addAuto('发班级公示', className);
      }

      if (weekendDate === todayKey) {
        if (classNotesToday.length > 0) {
          addAuto('物资确认', className, classNotesToday.map((note) => note.text).join('、'));
        }
        addAuto('发课后资料【板书+课件+概览】', className);
        addAuto('发本周积分 / minipin', className);
      }
      return;
    }

    if (weekendDate === todayKey && currentTimeMode) {
      addAuto('发课后资料【板书+课件+概览】', className);
    }
  });

  return Array.from(items.values()).sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === 'auto' ? -1 : 1;
    }
    return left.title.localeCompare(right.title, 'zh-Hans-CN');
  });
}

export function formatTodoHeadline(item: GeneratedTodoItem): string {
  if (item.kind !== 'auto') {
    return item.title;
  }

  if (item.title === '发座位表') {
    return `发 ${item.classes.join(' & ')} 座位表`;
  }
  if (item.title === '发班级公示') {
    return `发 ${item.classes.join(' & ')} 班级公示`;
  }
  if (item.title === '发课后资料【板书+课件+概览】') {
    return `发 ${item.classes.join(' & ')} 课后资料【板书+课件+概览】`;
  }
  if (item.title === '发本周积分 / minipin') {
    return `发 ${item.classes.join(' & ')} 本周积分 / minipin`;
  }
  if (item.title === '物资确认') {
    return `${item.classes.join(' & ')} 物资确认`;
  }

  return `${item.title}：${item.classes.join(' & ')}`;
}
