import { describe, expect, it } from 'vitest';
import { makeClassShell } from './state';
import type { ClassConfig, TimeModeData } from './types';
import { repairDateOnlyRotation, seatingSignature } from './dateOnlyRotationRepair';

const makeLocation = (fullDate: string, date: string, day: string, weekday: string) => ({
  date,
  day,
  weekday,
  time: '',
  campus: '',
  floor: '',
  room: '',
  arrivalMessage: '',
  notes: '',
  fullDate,
});

const makeK214Weekday = (fullDate: string, date: string, day: string): TimeModeData => ({
  layout: 'circular',
  groups: [
    ['Leo', 'Isa', 'Camillie', 'Ann', 'Aaron', 'Aurora'],
    ['Mulan', 'Bella', 'Sam', 'Qadir', 'Demo乙', 'Allen'],
    ['Demo丙', 'Michael', 'Mario', 'Albert', 'Sara', 'Asher'],
    ['', '', '', '', '', ''],
    ['', '', '', '', '', ''],
    ['', '', '', '', '', ''],
  ],
  groupOrder: [2, 3, 1, 4, 5, 6],
  groupLabels: ['2', '3', '1', '4', '5', '6'],
  rowGroups: null,
  fourGroups: null,
  currentArrangement: 0,
  locationInfo: makeLocation(fullDate, date, day, '星期五'),
  rotationConfig: { groupRotation: 'clockwise', internalRotation: 'right2', labelRotation: 'rotate' },
});

const makeK214Weekend = (fullDate: string, date: string, day: string): TimeModeData => ({
  layout: 'rows',
  groups: null,
  groupOrder: [2, 1, 4, 3, 5, 6],
  groupLabels: ['2', '1', '4', '3', '5', '6'],
  rowGroups: {
    rows: [
      { left: ['Ann', 'Leo', 'Michael', 'Demo丙', 'Camillie', ''], right: ['Bella', 'Aaron', 'Aurora', 'Mulan', '', ''] },
      { left: ['Mario', 'Isa', 'Asher', 'Allen', 'Sam', ''], right: ['Albert', 'Sara', 'Allen', 'Qadir', 'Demo乙', ''] },
      { left: ['', '', '', '', '', ''], right: ['', '', '', '', '', ''] },
    ],
  },
  fourGroups: null,
  currentArrangement: 0,
  locationInfo: makeLocation(fullDate, date, day, '星期日'),
  rotationConfig: { groupRotation: 'snake', internalRotation: 'right1', labelRotation: 'rotate' },
});

describe('repairDateOnlyRotation', () => {
  it('repairs K214-shaped data when date advanced but seating stayed unchanged', () => {
    const config = makeClassShell('circular') as ClassConfig;
    config.weekday = makeK214Weekday('2026-06-12', '6', '12');
    config.weekend = makeK214Weekend('2026-06-07', '6', '7');
    config.previousWeek = {
      theme: config.theme,
      weekday: makeK214Weekday('2026-06-05', '6', '5'),
      weekend: makeK214Weekend('2026-05-31', '5', '31'),
    };

    expect(seatingSignature(config.weekday)).toBe(seatingSignature(config.previousWeek.weekday));
    expect(seatingSignature(config.weekend)).toBe(seatingSignature(config.previousWeek.weekend));

    const repaired = repairDateOnlyRotation(config);

    expect(repaired.weekday.locationInfo.fullDate).toBe('2026-06-12');
    expect(repaired.weekend.locationInfo.fullDate).toBe('2026-06-07');
    expect(seatingSignature(repaired.weekday)).not.toBe(seatingSignature(config.previousWeek.weekday));
    expect(seatingSignature(repaired.weekend)).not.toBe(seatingSignature(config.previousWeek.weekend));
    expect(repaired.weekday.groups?.[0]?.slice(0, 2)).toEqual(['Sara', 'Asher']);
    expect(repaired.weekend.rowGroups?.rows[0].left.slice(0, 2)).toEqual(['Demo乙', 'Albert']);
  });

  it('does not touch data when current seating already differs from previous week', () => {
    const config = makeClassShell('circular') as ClassConfig;
    config.weekday = makeK214Weekday('2026-06-12', '6', '12');
    config.weekday.groups![0][0] = 'Changed';
    config.weekend = makeK214Weekend('2026-06-07', '6', '7');
    config.previousWeek = {
      theme: config.theme,
      weekday: makeK214Weekday('2026-06-05', '6', '5'),
      weekend: makeK214Weekend('2026-05-31', '5', '31'),
    };

    const repaired = repairDateOnlyRotation(config);

    expect(repaired.weekday).toBe(config.weekday);
    expect(repaired.weekend).not.toBe(config.weekend);
  });
});
