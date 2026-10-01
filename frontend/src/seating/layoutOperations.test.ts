import { describe, expect, it } from 'vitest';
import { buildCampImportState, buildCircularImportState, buildFourImportState, buildRowsImportState, rotateTimeModeData } from './layoutOperations';
import { captureLayoutIdentity } from './layoutIdentity';
import { makeEmptyCampGroups, makeEmptyFourGroups, makeEmptyLocationInfo, makeEmptyRowGroups } from './state';
import type { TimeModeData } from './types';
import {
  applyManualGrouping,
  collectStudentsFromCamp,
  collectStudentsFromCircular,
  collectStudentsFromFour,
  collectStudentsFromRows,
  convertStudentsToRows,
  defaultRotationConfig,
  rotateCircularLayoutForWeek,
  rotateCircularGroupLabelsForWeek,
  rotateCircularGroupOrderForWeek,
  rotateFourLayoutForWeek,
  rotateFourGroupLabelsForWeek,
  rotateFourGroupOrderForWeek,
  rotateCampLayoutForWeek,
  rotateCampGroupLabelsForWeek,
  rotateCampGroupOrderForWeek,
  rotateRowsGroupLabelsForWeek,
  rotateRowsGroupOrderForWeek,
  rotateRowsLayoutForWeek,
} from './layouts';

const sorted = (values: string[]): string[] => [...values].sort((a, b) => a.localeCompare(b));

describe('layoutOperations import ordering', () => {
  it('rejects an empty or non-integer manual group count before any regrouping', () => {
    const students = ['A', 'B', 'C'];
    expect(() => applyManualGrouping('rows', Number.NaN, students)).toThrow('组数必须是有效整数');
    expect(() => applyManualGrouping('circular', 2.5, students)).toThrow('组数必须是有效整数');
    expect(() => applyManualGrouping('four', Number.NaN, students)).toThrow('组数必须是有效整数');
  });

  it('keeps all 26 students and balances every supported manual regroup', () => {
    const students = Array.from({ length: 26 }, (_, index) => `S${index + 1}`);
    const cases = [
      applyManualGrouping('circular', 5, students),
      applyManualGrouping('circular', 6, students),
      applyManualGrouping('rows', 5, students),
      applyManualGrouping('rows', 6, students),
      applyManualGrouping('four', 3, students),
      applyManualGrouping('four', 4, students),
      applyManualGrouping('camp', 6, students),
      applyManualGrouping('camp', 8, students),
    ];

    cases.forEach((result) => {
      const actual = result.layout === 'rows'
        ? collectStudentsFromRows(result.rowGroups)
        : result.layout === 'four'
          ? collectStudentsFromFour(result.fourGroups)
          : result.layout === 'camp'
            ? collectStudentsFromCamp(result.groups)
            : collectStudentsFromCircular(result.groups);
      expect(sorted(actual)).toEqual(sorted(students));
      const groups = result.layout === 'rows'
        ? result.rowGroups.rows.flatMap((row) => [row.left, row.right]).filter((group) => group.some(Boolean))
        : result.layout === 'four'
          ? result.fourGroups.groups.slice(0, result.fourGroups.groupCount)
          : result.groups.filter((group) => group.some(Boolean));
      const counts = groups.map((group) => group.filter(Boolean).length);
      expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    });
  });

  it('balances ordinary imports at every supported roster size while preserving the roster', () => {
    for (let count = 1; count <= 45; count++) {
      const students = Array.from({ length: count }, (_, index) => index < 2 ? 'Alex' : `S${index}`);
      for (const build of [buildCircularImportState, buildRowsImportState, buildFourImportState]) {
        const result = build(students);
        const groups = result.currentLayout === 'rows'
          ? result.rowGroups.rows.flatMap(row => [row.left, row.right])
          : result.currentLayout === 'four' ? result.fourGroups.groups : result.groups;
        expect(groups.flat().filter(Boolean)).toEqual(students);
        const counts = groups.filter(group => group.some(Boolean)).map(group => group.filter(Boolean).length);
        expect(Math.max(...counts) - Math.min(...counts), `${count} ${result.currentLayout}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('imports 45 camp students evenly across 6 groups', () => {
    const students = Array.from({ length: 45 }, (_, index) => `C${index + 1}`);
    const imported = buildCampImportState(students);

    expect(imported.currentLayout).toBe('camp');
    expect(imported.groups).toHaveLength(6);
    expect(imported.groups[0].slice(0, 8)).toEqual(['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8']);
    expect(imported.groups.map((group) => group.filter(Boolean).length)).toEqual([8, 8, 8, 7, 7, 7]);
    expect(imported.groups[5].filter(Boolean)).toEqual(['C39', 'C40', 'C41', 'C42', 'C43', 'C44', 'C45']);
    expect(imported.currentGroupLabels).toEqual(['1', '2', '3', '4', '5', '6']);
  });

  it('rejects over-capacity camp import', () => {
    const students = Array.from({ length: 46 }, (_, index) => `C${index + 1}`);
    expect(() => buildCampImportState(students)).toThrow('夏令营布局最多45人');
  });

  it.each([
    ['circular', buildCircularImportState, [8, 8, 8, 7, 7, 7]],
    ['rows', buildRowsImportState, [8, 7, 8, 7, 8, 7]],
    ['four', buildFourImportState, [12, 11, 11, 11]],
  ] as const)('supports 45 students in %s with balanced expanded density', (_layout, build, expectedCounts) => {
    const students = Array.from({ length: 45 }, (_, index) => `S${index + 1}`);
    const imported = build(students);
    const counts = imported.currentLayout === 'circular'
      ? imported.groups.map((group) => group.filter(Boolean).length)
      : imported.currentLayout === 'rows'
        ? imported.rowGroups.rows.flatMap((row) => [row.left, row.right]).map((group) => group.filter(Boolean).length)
        : imported.fourGroups.groups.map((group) => group.filter(Boolean).length);
    expect(counts).toEqual(expectedCounts);
  });

  it.each([
    ['circular', buildCircularImportState],
    ['rows', buildRowsImportState],
    ['four', buildFourImportState],
  ] as const)('rejects the 46th student in %s', (_layout, build) => {
    const students = Array.from({ length: 46 }, (_, index) => `S${index + 1}`);
    expect(() => build(students)).toThrow('最多45人');
  });
});

describe('weekly rotation across seating layouts', () => {
  it.each([
    ['circular', buildCircularImportState, (imported: ReturnType<typeof buildCircularImportState>) =>
      collectStudentsFromCircular(rotateCircularLayoutForWeek(imported.groups, defaultRotationConfig('circular')))],
    ['rows', buildRowsImportState, (imported: ReturnType<typeof buildRowsImportState>) =>
      collectStudentsFromRows(rotateRowsLayoutForWeek(imported.rowGroups, defaultRotationConfig('rows')))],
    ['four', buildFourImportState, (imported: ReturnType<typeof buildFourImportState>) =>
      collectStudentsFromFour(rotateFourLayoutForWeek(imported.fourGroups, defaultRotationConfig('four')))],
    ['camp', buildCampImportState, (imported: ReturnType<typeof buildCampImportState>) =>
      collectStudentsFromCamp(rotateCampLayoutForWeek(imported.groups, defaultRotationConfig('camp')))],
  ] as const)('preserves all 45 students when rotating %s', (_layout, build, rotateAndCollect) => {
    const students = Array.from({ length: 45 }, (_, index) => `S${index + 1}`);
    const imported = build(students);
    expect(sorted(rotateAndCollect(imported as never))).toEqual(sorted(students));
  });

  it('rotates names inside a single circular group', () => {
    const groups = [
      ['A1', 'A2', 'A3', 'A4', '', ''],
      ['', '', '', '', '', ''],
      ['', '', '', '', '', ''],
      ['', '', '', '', '', ''],
      ['', '', '', '', '', ''],
      ['', '', '', '', '', ''],
    ];

    const rotated = rotateCircularLayoutForWeek(groups, {
      groupRotation: 'clockwise',
      internalRotation: 'right1',
      labelRotation: 'rotate',
    });

    expect(rotated[0].slice(0, 4)).toEqual(['A4', 'A1', 'A2', 'A3']);
  });

  it('rotates sparse circular groups by occupied visual slots', () => {
    const groups = [
      ['A1', 'A2', '', '', '', ''],
      ['B1', 'B2', '', '', '', ''],
      ['', '', '', '', '', ''],
      ['D1', 'D2', '', '', '', ''],
      ['', '', '', '', '', ''],
      ['', '', '', '', '', ''],
    ];
    const rotationConfig = {
      groupRotation: 'clockwise' as const,
      internalRotation: 'right1' as const,
      labelRotation: 'rotate' as const,
    };

    const rotated = rotateCircularLayoutForWeek(groups, rotationConfig);
    const rotatedOrder = rotateCircularGroupOrderForWeek([1, 2, 3, 4, 5, 6], [0, 1, 3], rotationConfig);
    const rotatedLabels = rotateCircularGroupLabelsForWeek(['1', '2', '3', '4', '5', '6'], [0, 1, 3], rotationConfig);

    expect(rotated[0].slice(0, 2)).toEqual(['D2', 'D1']);
    expect(rotated[1].slice(0, 2)).toEqual(['A2', 'A1']);
    expect(rotated[2].filter(Boolean)).toEqual([]);
    expect(rotated[3].slice(0, 2)).toEqual(['B2', 'B1']);
    expect(rotatedOrder.slice(0, 4)).toEqual([4, 1, 3, 2]);
    expect(rotatedLabels.slice(0, 4)).toEqual(['4', '1', '3', '2']);
  });

  it('rotates names inside a single rows group', () => {
    const rowGroups = makeEmptyRowGroups();
    rowGroups.rows[0].left = ['R1', 'R2', 'R3', 'R4', '', ''];

    const rotated = rotateRowsLayoutForWeek(rowGroups, {
      groupRotation: 'snake',
      internalRotation: 'right1',
      labelRotation: 'rotate',
    });

    expect(rotated.rows[0].left.slice(0, 4)).toEqual(['R4', 'R1', 'R2', 'R3']);
  });

  it('rotates sparse rows groups by occupied slot instead of inferred group count', () => {
    const rowGroups = makeEmptyRowGroups();
    rowGroups.rows[0].left = ['A1', 'A2', '', '', '', ''];
    rowGroups.rows[0].right = ['B1', 'B2', '', '', '', ''];
    rowGroups.rows[1].right = ['D1', 'D2', '', '', '', ''];

    const rotationConfig = {
      groupRotation: 'snake' as const,
      internalRotation: 'right1' as const,
      labelRotation: 'rotate' as const,
    };

    const rotated = rotateRowsLayoutForWeek(rowGroups, rotationConfig);
    const rotatedOrder = rotateRowsGroupOrderForWeek([1, 2, 3, 4, 5, 6], [0, 1, 3], rotationConfig);
    const rotatedLabels = rotateRowsGroupLabelsForWeek(['1', '2', '3', '4', '5', '6'], [0, 1, 3], rotationConfig);

    expect(rotated.rows[0].left.slice(0, 2)).toEqual(['D2', 'D1']);
    expect(rotated.rows[0].right.slice(0, 2)).toEqual(['A2', 'A1']);
    expect(rotated.rows[1].left.filter(Boolean)).toEqual([]);
    expect(rotated.rows[1].right.slice(0, 2)).toEqual(['B2', 'B1']);
    expect(rotatedOrder.slice(0, 4)).toEqual([4, 1, 3, 2]);
    expect(rotatedLabels.slice(0, 4)).toEqual(['4', '1', '3', '2']);
  });

  it('uses the intended snake, cross, and perimeter paths in the three-row layout', () => {
    const rowGroups = makeEmptyRowGroups();
    const labels = ['A1', 'B1', 'C1', 'D1', 'E1', 'F1'];
    rowGroups.rows.forEach((row, rowIndex) => {
      row.left[0] = labels[rowIndex * 2];
      row.right[0] = labels[rowIndex * 2 + 1];
    });

    const rotate = (groupRotation: 'snake' | 'front-back-swap' | 'clockwise' | 'counterclockwise') => {
      const rotated = rotateRowsLayoutForWeek(rowGroups, {
        groupRotation,
        internalRotation: 'none',
        labelRotation: 'rotate',
      });
      return rotated.rows.flatMap((row) => [row.left[0], row.right[0]]);
    };

    expect(rotate('snake')).toEqual(['F1', 'A1', 'D1', 'B1', 'C1', 'E1']);
    expect(rotate('front-back-swap')).toEqual(['F1', 'E1', 'B1', 'A1', 'D1', 'C1']);
    expect(rotate('clockwise')).toEqual(['C1', 'A1', 'E1', 'B1', 'F1', 'D1']);
    expect(rotate('counterclockwise')).toEqual(['B1', 'D1', 'A1', 'F1', 'C1', 'E1']);
  });

  it('skips an empty three-row slot without breaking snake or cross paths', () => {
    const rowGroups = makeEmptyRowGroups();
    ['A1', 'B1', '', 'D1', 'E1', 'F1'].forEach((name, slotIndex) => {
      const row = rowGroups.rows[Math.floor(slotIndex / 2)];
      const side = slotIndex % 2 === 0 ? 'left' : 'right';
      row[side][0] = name;
    });

    const rotate = (groupRotation: 'snake' | 'front-back-swap') => {
      const rotated = rotateRowsLayoutForWeek(rowGroups, {
        groupRotation,
        internalRotation: 'none',
        labelRotation: 'rotate',
      });
      return rotated.rows.flatMap((row) => [row.left[0], row.right[0]]);
    };

    expect(rotate('snake')).toEqual(['F1', 'A1', '', 'B1', 'D1', 'E1']);
    expect(rotate('front-back-swap')).toEqual(['F1', 'E1', '', 'A1', 'D1', 'B1']);

    const activeSlots = [0, 1, 3, 4, 5];
    const snakeConfig = { groupRotation: 'snake' as const, internalRotation: 'none' as const, labelRotation: 'rotate' as const };
    const crossConfig = { ...snakeConfig, groupRotation: 'front-back-swap' as const };
    expect(rotateRowsGroupOrderForWeek([1, 2, 3, 4, 5, 6], activeSlots, snakeConfig)).toEqual([6, 1, 3, 2, 4, 5]);
    expect(rotateRowsGroupLabelsForWeek(['1', '2', '3', '4', '5', '6'], activeSlots, crossConfig)).toEqual(['6', '5', '3', '1', '4', '2']);
  });

  it('rotates names inside the active four-group layout', () => {
    const fourGroups = makeEmptyFourGroups();
    fourGroups.groupCount = 3;
    fourGroups.groups[0] = ['F1', 'F2', 'F3', 'F4', '', '', '', '', ''];

    const rotated = rotateFourLayoutForWeek(fourGroups, {
      groupRotation: 'clockwise',
      internalRotation: 'right1',
      labelRotation: 'rotate',
    });

    expect(rotated.groups[0].slice(0, 4)).toEqual(['F4', 'F1', 'F2', 'F3']);
    expect(rotated.groupCount).toBe(3);
  });

  it('rotates sparse four-group data without moving an empty group through the class', () => {
    const fourGroups = makeEmptyFourGroups();
    fourGroups.groupCount = 4;
    fourGroups.groups[0] = ['A1', 'A2', '', '', '', '', '', '', ''];
    fourGroups.groups[1] = ['B1', 'B2', '', '', '', '', '', '', ''];
    fourGroups.groups[3] = ['D1', 'D2', '', '', '', '', '', '', ''];
    const rotationConfig = {
      groupRotation: 'clockwise' as const,
      internalRotation: 'right1' as const,
      labelRotation: 'rotate' as const,
    };

    const rotated = rotateFourLayoutForWeek(fourGroups, rotationConfig);
    const rotatedOrder = rotateFourGroupOrderForWeek([1, 2, 3, 4, 5, 6], [0, 1, 3], rotationConfig);
    const rotatedLabels = rotateFourGroupLabelsForWeek(['1', '2', '3', '4', '5', '6'], [0, 1, 3], rotationConfig);

    expect(rotated.groups[0].slice(0, 2)).toEqual(['D2', 'D1']);
    expect(rotated.groups[1].slice(0, 2)).toEqual(['A2', 'A1']);
    expect(rotated.groups[2].filter(Boolean)).toEqual([]);
    expect(rotated.groups[3].slice(0, 2)).toEqual(['B2', 'B1']);
    expect(rotatedOrder.slice(0, 4)).toEqual([4, 1, 3, 2]);
    expect(rotatedLabels.slice(0, 4)).toEqual(['4', '1', '3', '2']);
  });

  it('rotates camp layout across 8 groups by row-left while keeping every student once', () => {
    const groups = makeEmptyCampGroups(8);
    groups[0] = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6'];
    groups[1] = ['B1', 'B2', 'B3', 'B4', 'B5', 'B6'];
    groups[7] = ['H1', 'H2', 'H3', 'H4', 'H5', 'H6'];
    const rotationConfig = {
      groupRotation: 'row-left' as const,
      internalRotation: 'right1' as const,
      labelRotation: 'rotate' as const,
    };

    const rotated = rotateCampLayoutForWeek(groups, rotationConfig);
    const rotatedOrder = rotateCampGroupOrderForWeek([1, 2, 3, 4, 5, 6, 7, 8], [0, 1, 7], rotationConfig, 8);
    const rotatedLabels = rotateCampGroupLabelsForWeek(['1', '2', '3', '4', '5', '6', '7', '8'], [0, 1, 7], rotationConfig, 8);

    expect(sorted(collectStudentsFromCamp(rotated))).toEqual(sorted(collectStudentsFromCamp(groups)));
    expect(rotated[0].slice(0, 2)).toEqual(['H6', 'H1']);
    expect(rotated[1].slice(0, 2)).toEqual(['A6', 'A1']);
    expect(rotated[7].slice(0, 2)).toEqual(['B6', 'B1']);
    expect(rotatedOrder[0]).toBe(8);
    expect(rotatedOrder[1]).toBe(1);
    expect(rotatedOrder[7]).toBe(2);
    expect(rotatedLabels[0]).toBe('8');
    expect(rotatedLabels[1]).toBe('1');
    expect(rotatedLabels[7]).toBe('2');
  });

  it('uses the named camp rotation paths consistently', () => {
    const groups = makeEmptyCampGroups(6);
    groups[0] = ['A1', '', '', '', '', '', '', ''];
    groups[1] = ['B1', '', '', '', '', '', '', ''];
    groups[2] = ['C1', '', '', '', '', '', '', ''];
    groups[3] = ['D1', '', '', '', '', '', '', ''];
    groups[4] = ['E1', '', '', '', '', '', '', ''];
    groups[5] = ['F1', '', '', '', '', '', '', ''];

    const rotate = (groupRotation: 'row-left' | 'clockwise' | 'counterclockwise') =>
      rotateCampLayoutForWeek(groups, {
        groupRotation,
        internalRotation: 'none',
        labelRotation: 'rotate',
      }).map((group) => group[0]);

    expect(rotate('row-left')).toEqual(['F1', 'A1', 'B1', 'C1', 'D1', 'E1']);
    expect(rotate('clockwise')).toEqual(['D1', 'A1', 'B1', 'E1', 'F1', 'C1']);
    expect(rotate('counterclockwise')).toEqual(['B1', 'C1', 'F1', 'A1', 'D1', 'E1']);
  });

  it('rotates camp groups by row to the right', () => {
    const groups = makeEmptyCampGroups(6);
    groups[0] = ['A1', 'A2', '', '', '', '', '', ''];
    groups[1] = ['B1', 'B2', '', '', '', '', '', ''];
    groups[2] = ['C1', 'C2', '', '', '', '', '', ''];
    groups[3] = ['D1', 'D2', '', '', '', '', '', ''];
    groups[4] = ['E1', 'E2', '', '', '', '', '', ''];
    groups[5] = ['F1', 'F2', '', '', '', '', '', ''];
    const rotationConfig = {
      groupRotation: 'row-right' as const,
      internalRotation: 'none' as const,
      labelRotation: 'rotate' as const,
    };

    const rotated = rotateCampLayoutForWeek(groups, rotationConfig);
    const rotatedOrder = rotateCampGroupOrderForWeek([1, 2, 3, 4, 5, 6], [0, 1, 2, 3, 4, 5], rotationConfig, 6);
    const rotatedLabels = rotateCampGroupLabelsForWeek(['1', '2', '3', '4', '5', '6'], [0, 1, 2, 3, 4, 5], rotationConfig, 6);

    expect(rotated.map((group) => group[0])).toEqual(['C1', 'A1', 'B1', 'F1', 'D1', 'E1']);
    expect(rotatedOrder).toEqual([3, 1, 2, 6, 4, 5]);
    expect(rotatedLabels).toEqual(['3', '1', '2', '6', '4', '5']);
  });

  it('swaps camp rows by column', () => {
    const groups = makeEmptyCampGroups(6);
    groups[0] = ['A1', '', '', '', '', '', '', ''];
    groups[1] = ['B1', '', '', '', '', '', '', ''];
    groups[2] = ['C1', '', '', '', '', '', '', ''];
    groups[3] = ['D1', '', '', '', '', '', '', ''];
    groups[4] = ['E1', '', '', '', '', '', '', ''];
    groups[5] = ['F1', '', '', '', '', '', '', ''];
    const rotationConfig = {
      groupRotation: 'row-swap' as const,
      internalRotation: 'none' as const,
      labelRotation: 'rotate' as const,
    };

    const rotated = rotateCampLayoutForWeek(groups, rotationConfig);
    const rotatedOrder = rotateCampGroupOrderForWeek([1, 2, 3, 4, 5, 6], [0, 1, 2, 3, 4, 5], rotationConfig, 6);
    const rotatedLabels = rotateCampGroupLabelsForWeek(['1', '2', '3', '4', '5', '6'], [0, 1, 2, 3, 4, 5], rotationConfig, 6);

    expect(rotated.map((group) => group[0])).toEqual(['D1', 'E1', 'F1', 'A1', 'B1', 'C1']);
    expect(rotatedOrder).toEqual([4, 5, 6, 1, 2, 3]);
    expect(rotatedLabels).toEqual(['4', '5', '6', '1', '2', '3']);
  });

  it('uses front-back swap as the default camp rotation path', () => {
    expect(defaultRotationConfig('camp').groupRotation).toBe('front-back-swap');

    const groups = makeEmptyCampGroups(6);
    groups[0] = ['A1', '', '', '', '', '', '', ''];
    groups[1] = ['B1', '', '', '', '', '', '', ''];
    groups[2] = ['C1', '', '', '', '', '', '', ''];
    groups[3] = ['D1', '', '', '', '', '', '', ''];
    groups[4] = ['E1', '', '', '', '', '', '', ''];
    groups[5] = ['F1', '', '', '', '', '', '', ''];
    const rotationConfig = {
      groupRotation: 'front-back-swap' as const,
      internalRotation: 'none' as const,
      labelRotation: 'rotate' as const,
    };

    const day2 = rotateCampLayoutForWeek(groups, rotationConfig);
    const day3 = rotateCampLayoutForWeek(day2, rotationConfig);
    const rotatedOrder = rotateCampGroupOrderForWeek([1, 2, 3, 4, 5, 6], [0, 1, 2, 3, 4, 5], rotationConfig, 6);
    const rotatedLabels = rotateCampGroupLabelsForWeek(['1', '2', '3', '4', '5', '6'], [0, 1, 2, 3, 4, 5], rotationConfig, 6);

    expect(day2.map((group) => group[0])).toEqual(['F1', 'D1', 'E1', 'C1', 'A1', 'B1']);
    expect(day3.map((group) => group[0])).toEqual(['B1', 'C1', 'A1', 'E1', 'F1', 'D1']);
    expect(rotatedOrder).toEqual([6, 4, 5, 3, 1, 2]);
    expect(rotatedLabels).toEqual(['6', '4', '5', '3', '1', '2']);
  });

  it('keeps camp labels on physical positions for fixed and custom label modes', () => {
    const rotationConfig = {
      groupRotation: 'front-back-swap' as const,
      internalRotation: 'none' as const,
      labelRotation: 'fixed' as const,
    };
    const customConfig = { ...rotationConfig, labelRotation: 'custom' as const };

    expect(rotateCampGroupLabelsForWeek(['1', '2', '3', '4', '5', '6'], [0, 1, 2, 3, 4, 5], rotationConfig, 6))
      .toEqual(['1', '2', '3', '4', '5', '6']);
    expect(rotateCampGroupLabelsForWeek(['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta'], [0, 1, 2, 3, 4, 5], customConfig, 6))
      .toEqual(['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta']);
  });

  it('can rotate custom camp labels with members', () => {
    const rotationConfig = {
      groupRotation: 'front-back-swap' as const,
      internalRotation: 'none' as const,
      labelRotation: 'rotate' as const,
      labelNameMode: 'custom' as const,
    };

    expect(rotateCampGroupLabelsForWeek(['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta'], [0, 1, 2, 3, 4, 5], rotationConfig, 6))
      .toEqual(['Zeta', 'Delta', 'Epsilon', 'Gamma', 'Alpha', 'Beta']);
  });

  it('keeps every student exactly once across all circular group counts', () => {
    for (let groupCount = 1; groupCount <= 6; groupCount += 1) {
      const groups = Array.from({ length: 6 }, (_, groupIndex) =>
        groupIndex < groupCount ? [`C${groupIndex + 1}A`, `C${groupIndex + 1}B`, '', '', '', ''] : ['', '', '', '', '', ''],
      );
      const before = collectStudentsFromCircular(groups);
      const rotated = rotateCircularLayoutForWeek(groups, {
        groupRotation: 'clockwise',
        internalRotation: 'right1',
        labelRotation: 'rotate',
      });

      expect(sorted(collectStudentsFromCircular(rotated))).toEqual(sorted(before));
      expect(rotated[0].slice(0, 2)).not.toEqual(groups[0].slice(0, 2));
    }
  });

  it('keeps every student exactly once across all rows group counts', () => {
    for (let groupCount = 1; groupCount <= 6; groupCount += 1) {
      const students = Array.from({ length: groupCount * 2 }, (_, index) => `R${index + 1}`);
      const rowGroups = convertStudentsToRows(students, groupCount);
      const rotated = rotateRowsLayoutForWeek(rowGroups, {
        groupRotation: 'snake',
        internalRotation: 'right1',
        labelRotation: 'rotate',
      });

      expect(sorted(collectStudentsFromRows(rotated))).toEqual(sorted(students));
      expect(rotated.rows[0].left.slice(0, 2)).not.toEqual(rowGroups.rows[0].left.slice(0, 2));
    }
  });

  it('keeps every student exactly once across supported four-group counts', () => {
    for (const groupCount of [3, 4]) {
      const fourGroups = makeEmptyFourGroups();
      fourGroups.groupCount = groupCount;
      for (let groupIndex = 0; groupIndex < groupCount; groupIndex += 1) {
        fourGroups.groups[groupIndex] = [`F${groupIndex + 1}A`, `F${groupIndex + 1}B`, '', '', '', '', '', '', ''];
      }
      const before = collectStudentsFromFour(fourGroups);
      const rotated = rotateFourLayoutForWeek(fourGroups, {
        groupRotation: 'clockwise',
        internalRotation: 'right1',
        labelRotation: 'rotate',
      });

      expect(sorted(collectStudentsFromFour(rotated))).toEqual(sorted(before));
      expect(rotated.groups[0].slice(0, 2)).not.toEqual(fourGroups.groups[0].slice(0, 2));
    }
  });

  it('moves stable student assignments through numbered positions with the production rotation', () => {
    const groups = Array.from({ length: 6 }, () => Array(6).fill(''));
    groups[0] = ['Alex', 'Bee', 'Alex', 'Cara', '', ''];
    const mode: TimeModeData = {
      layout: 'circular',
      groups,
      groupOrder: [1, 2, 3, 4, 5, 6],
      groupLabels: ['1', '2', '3', '4', '5', '6'],
      rowGroups: null,
      fourGroups: null,
      currentArrangement: 0,
      locationInfo: makeEmptyLocationInfo(),
      rotationConfig: {
        groupRotation: 'clockwise',
        internalRotation: 'right1',
        labelRotation: 'rotate',
      },
      layoutIdentity: null,
    };
    const identity = captureLayoutIdentity(mode, null);
    const beforeIds = identity.snapshots.circular!.positions.map((position) => position.studentId);
    const rotated = rotateTimeModeData({ ...mode, layoutIdentity: identity }, mode.locationInfo);
    const after = rotated.layoutIdentity!.snapshots.circular!;

    expect(rotated.groups?.[0].slice(0, 4)).toEqual(['Cara', 'Alex', 'Bee', 'Alex']);
    expect(after.positions.map((position) => position.studentId)).toEqual([
      beforeIds[3],
      beforeIds[0],
      beforeIds[1],
      beforeIds[2],
    ]);
    expect(after.positions.map((position) => position.layoutPositionId)).toEqual([
      'CIRCULAR-G01-S01',
      'CIRCULAR-G01-S02',
      'CIRCULAR-G01-S03',
      'CIRCULAR-G01-S04',
    ]);
    expect(new Set(rotated.layoutIdentity!.students.map((student) => student.seatingAssignmentId))).toEqual(
      new Set(identity.students.map((student) => student.seatingAssignmentId)),
    );
  });
});
