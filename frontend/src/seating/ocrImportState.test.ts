import { describe, expect, it } from 'vitest';
import { draftToModeData } from './ocrImportState';

describe('ocrImportState', () => {
  it('builds circular mode data from parsed groups', () => {
    const mode = draftToModeData({
      layout: 'circular',
      groupsText: 'ignored',
      date: '4',
      day: '14',
      weekday: '周二',
      time: '19:00',
      campus: '人民广场',
      floor: '3F',
      room: '301',
      fullDate: '',
    }, {
      parseGroupsText: () => [['Alice', 'Bob'], ['Cara']],
    });

    expect(mode.layout).toBe('circular');
    expect(mode.groups?.[0].slice(0, 2)).toEqual(['Alice', 'Bob']);
    expect(mode.groups?.[1][0]).toBe('Cara');
    expect(mode.locationInfo.fullDate).toBe('2027-04-14');
  });

  it('builds row layout mode data with slot mapping', () => {
    const mode = draftToModeData({
      layout: 'rows',
      groupsText: 'ignored',
      date: '4',
      day: '14',
      weekday: '周二',
      time: '19:00',
      campus: '',
      floor: '',
      room: '',
      fullDate: '2026-04-14',
    }, {
      parseGroupsText: () => [['A1'], ['B1'], ['C1'], ['D1']],
    });

    expect(mode.layout).toBe('rows');
    expect(mode.rowGroups?.rows[0].left[0]).toBe('A1');
    expect(mode.rowGroups?.rows[0].right[0]).toBe('B1');
    expect(mode.locationInfo.fullDate).toBe('2026-04-14');
  });

  it('builds camp layout mode data with 8 groups', () => {
    const mode = draftToModeData({
      layout: 'camp',
      groupsText: 'ignored',
      date: '4',
      day: '14',
      weekday: '周二',
      time: '19:00',
      campus: '',
      floor: '',
      room: '',
      fullDate: '2026-04-14',
    }, {
      parseGroupsText: () => Array.from(
        { length: 8 },
        (_, groupIndex) => groupIndex === 0
          ? ['C1', '', '', '', '', '', '', 'C1-Seat8']
          : [`C${groupIndex + 1}`],
      ),
    });

    expect(mode.layout).toBe('camp');
    expect(mode.groups).toHaveLength(8);
    expect(mode.groups?.[0][0]).toBe('C1');
    expect(mode.groups?.[0][1]).toBe('');
    expect(mode.groups?.[0][7]).toBe('C1-Seat8');
    expect(mode.groups?.[7][0]).toBe('C8');
    expect(mode.groupLabels).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
  });

  it('keeps 45 students from an expanded circular OCR draft', () => {
    const students = Array.from({ length: 45 }, (_, index) => `S${index + 1}`);
    const parsedGroups = [8, 8, 8, 7, 7, 7].map((count, groupIndex) => {
      const start = [0, 8, 16, 24, 31, 38][groupIndex];
      return students.slice(start, start + count);
    });
    const mode = draftToModeData({
      layout: 'circular', groupsText: 'ignored', date: '', day: '', weekday: '', time: '', campus: '', floor: '', room: '', fullDate: '',
    }, { parseGroupsText: () => parsedGroups });

    expect(mode.groups?.flat().filter(Boolean)).toHaveLength(45);
    expect(mode.groups?.every((group) => group.length === 8)).toBe(true);
  });

  it('rejects the 46th student from OCR', () => {
    const students = Array.from({ length: 46 }, (_, index) => `S${index + 1}`);
    expect(() => draftToModeData({
      layout: 'four', groupsText: 'ignored', date: '', day: '', weekday: '', time: '', campus: '', floor: '', room: '', fullDate: '',
    }, { parseGroupsText: () => [students.slice(0, 12), students.slice(12, 24), students.slice(24, 36), students.slice(36)] }))
      .toThrow('所有布局最多45人');
  });
});
