import { describe, expect, it } from 'vitest';
import { buildTodayTodoSummary, formatTodoHeadline, sanitizeReminderNotes } from './reminderRules';
import type { ClassData } from './types';

function makeClassData(): ClassData {
  return {
    J101: {
      theme: 'paper',
      previousWeek: null,
      cnf: null,
      todoNotes: [
        {
          id: 'n1',
          text: '带练习册',
          dueDate: '2026-04-14',
          source: 'manual',
          completed: false,
          createdAt: '2026-04-13T08:00:00.000Z',
          completedAt: null,
        },
      ],
      weekday: {
        layout: 'rows',
        groups: null,
        groupOrder: null,
        rowGroups: { rows: [{ left: ['Amy'], right: [] }] },
        fourGroups: null,
        currentArrangement: 1,
        locationInfo: {
          date: '4/14',
          day: '14',
          weekday: '周二',
          time: '18:00',
          campus: '',
          floor: '',
          room: '',
          arrivalMessage: '',
          notes: '',
          fullDate: '2026-04-14',
        },
      },
      weekend: {
        layout: 'rows',
        groups: null,
        groupOrder: null,
        rowGroups: { rows: [] },
        fourGroups: null,
        currentArrangement: 1,
        locationInfo: {
          date: '',
          day: '',
          weekday: '',
          time: '',
          campus: '',
          floor: '',
          room: '',
          arrivalMessage: '',
          notes: '',
          fullDate: '',
        },
      },
    },
  };
}

describe('reminderRules', () => {
  it('sanitizes reminder notes and orders incomplete notes first', () => {
    const notes = sanitizeReminderNotes([
      { id: '2', text: '  B  ', dueDate: '2026-04-15', completed: true, createdAt: '2026-04-12T00:00:00.000Z' },
      { id: '1', text: 'A', dueDate: '2026-04-14', completed: false, createdAt: '2026-04-11T00:00:00.000Z' },
      null,
    ]);

    expect(notes.map((item) => item.text)).toEqual(['A', 'B']);
    expect(notes[0]?.completed).toBe(false);
  });

  it('builds auto and manual todos for the current day', () => {
    const items = buildTodayTodoSummary({
      classData: makeClassData(),
      currentTimeMode: 'weekday',
      todayKey: '2026-04-14',
      countStudentsInMode: (mode) => mode.rowGroups?.rows.flatMap((row) => [...row.left, ...row.right]).filter(Boolean).length || 0,
      getModeDateKey: (mode) => mode.locationInfo.fullDate,
    });

    expect(items.map((item) => item.title)).toContain('带练习册');
    expect(items.map((item) => item.title)).toContain('发课后资料【板书+课件+概览】');
    expect(items.map((item) => item.title)).toContain('发本周积分 / minipin');
  });

  it('formats grouped auto reminders into readable headlines', () => {
    expect(formatTodoHeadline({
      key: 'x',
      title: '发座位表',
      classes: ['J101', 'J102'],
      kind: 'auto',
    })).toBe('发 J101 & J102 座位表');
  });
});
