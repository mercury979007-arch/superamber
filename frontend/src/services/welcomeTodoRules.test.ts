import { describe, expect, it } from 'vitest';
import type { ReminderNote } from '../seating/types';
import { buildTodoItems, getNextDateForClassDays, type TodoMetaState } from './welcomeTodoRules';

const baseMeta: TodoMetaState = {
  enabled: true,
  weeklyConfirmedWeek: 0,
  weeklyConfirmedAt: '',
  completedByDate: {},
};

function makeNote(id: string, text: string, dueDate: string): ReminderNote {
  return {
    id,
    text,
    dueDate,
    source: 'manual',
    completed: false,
    createdAt: '2026-04-14T09:00:00.000Z',
    completedAt: null,
  };
}

describe('welcomeTodoRules', () => {
  it('calculates the next matching class date', () => {
    expect(getNextDateForClassDays(['周三'], new Date('2026-04-14T09:00:00'))).toBe('2026-04-15');
    expect(getNextDateForClassDays([], new Date('2026-04-14T09:00:00'))).toBe('2026-04-14');
  });

  it('builds grouped auto tasks and due manual reminders', () => {
    const items = buildTodoItems({
      classes: [
        { id: '1', name: 'J101' },
        { id: '2', name: 'W201' },
      ],
      classDaysByCode: {
        J101: ['周三'],
        W201: ['周二'],
      },
      meta: baseMeta,
      notesByClass: {
        W201: [makeNote('note-1', '课后资料检查', '2026-04-14')],
      },
      today: new Date('2026-04-14T09:00:00'),
    });

    expect(items.map((item) => item.title)).toContain('发 J101 座位表');
    expect(items.map((item) => item.title)).toContain('发 J101 班级公示');
    expect(items.map((item) => item.title)).toContain('W201 物资确认');
    expect(items.map((item) => item.title)).toContain('W201 · 课后资料检查');

    const manual = items.find((item) => item.title === 'W201 · 课后资料检查');
    expect(manual?.detail).toBe('DDL：4/14 周二');
    expect(manual?.actions[0]?.target).toBe('overview');
  });
});
