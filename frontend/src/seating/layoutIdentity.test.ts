import { describe, expect, it } from 'vitest';
import {
  captureLayoutIdentity,
  buildIdentityTokenMode,
  getLayoutPositionIdForStudent,
  getRowsSlotGroupsForIdentityTests,
  getSnapshotStudentOrder,
  previewLayoutWithIdentity,
  sanitizeSeatingLayoutIdentity,
  updateIdentityAfterRegroup,
} from './layoutIdentity';
import { applyManualGrouping, convertStudentsToCircular } from './layouts';
import { makeEmptyLocationInfo } from './state';
import type { LayoutType, TimeModeData } from './types';

const makeStudents = (count: number): string[] => Array.from({ length: count }, (_, index) => `Student ${index + 1}`);

const circularMode = (students: string[], groupCount = 5): TimeModeData => ({
  layout: 'circular',
  groups: convertStudentsToCircular(students, groupCount),
  groupOrder: [1, 2, 3, 4, 5, 6],
  groupLabels: ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', '6'],
  rowGroups: null,
  fourGroups: null,
  currentArrangement: 2,
  locationInfo: makeEmptyLocationInfo(),
  rotationConfig: { groupRotation: 'clockwise', internalRotation: 'right1', labelRotation: 'fixed' },
  layoutIdentity: null,
});

const studentNames = (mode: TimeModeData): string[] => {
  if (mode.layout === 'rows') return getRowsSlotGroupsForIdentityTests(mode).flat().filter(Boolean);
  if (mode.layout === 'four') return (mode.fourGroups?.groups || []).flat().filter(Boolean);
  return (mode.groups || []).flat().filter(Boolean);
};

describe('stable seating layout identities', () => {
  it('adds stable student, assignment, logical group and position ids without changing legacy seats', () => {
    const mode = circularMode(makeStudents(26));
    const original = JSON.stringify(mode);
    const identity = captureLayoutIdentity(mode, null);

    expect(JSON.stringify(mode)).toBe(original);
    expect(identity.students).toHaveLength(26);
    expect(new Set(identity.students.map((student) => student.studentId)).size).toBe(26);
    expect(new Set(identity.students.map((student) => student.seatingAssignmentId)).size).toBe(26);
    expect(identity.students[0]).toMatchObject({
      seatingAssignmentId: 'A-001',
      smallGroupId: 'SG-01',
      largeGroupId: 'LG-01',
    });
    expect(identity.snapshots.circular?.positions[0].layoutPositionId).toBe('CIRCULAR-G01-S01');
    expect(identity.snapshots.circular?.layoutPositionIds).toHaveLength(36);
    expect(new Set(identity.snapshots.circular?.layoutPositionIds).size).toBe(36);
  });

  it('preserves logical small groups when first projecting circular to rows', () => {
    const source = circularMode(makeStudents(26));
    const result = previewLayoutWithIdentity(source, 'rows', 5);
    const rowGroups = getRowsSlotGroupsForIdentityTests(result.mode).slice(0, 5).map((group) => group.filter(Boolean));
    const circularGroups = (source.groups || []).slice(0, 5).map((group) => group.filter(Boolean));

    expect(result.restoredSnapshot).toBe(false);
    expect(rowGroups).toEqual(circularGroups);
    expect(result.identity.students.filter((student) => student.smallGroupId === 'SG-01').map((student) => student.displayName))
      .toEqual(circularGroups[0]);
  });

  it('restores exact per-layout seat order after repeated cross-layout switching', () => {
    const original = circularMode(makeStudents(26));
    original.groups![0] = ['Student 4', 'Student 1', 'Student 3', 'Student 2', 'Student 5', 'Student 6'];
    const circularSeatJson = JSON.stringify(original.groups);

    const rows = previewLayoutWithIdentity(original, 'rows', 5);
    const four = previewLayoutWithIdentity(rows.mode, 'four', 4);
    const rowsAgain = previewLayoutWithIdentity(four.mode, 'rows', 5);
    const circularAgain = previewLayoutWithIdentity(rowsAgain.mode, 'circular', 5);

    expect(rowsAgain.restoredSnapshot).toBe(true);
    expect(circularAgain.restoredSnapshot).toBe(true);
    expect(JSON.stringify(circularAgain.mode.groups)).toBe(circularSeatJson);
    expect(circularAgain.mode.groupLabels).toEqual(original.groupLabels);
    expect(circularAgain.mode.currentArrangement).toBe(2);
  });

  it('assigns stable large-group ids from the first four-group projection without losing small groups', () => {
    const source = circularMode(makeStudents(26));
    const circularIdentity = captureLayoutIdentity(source, null);
    const smallGroupsBefore = new Map(circularIdentity.students.map((student) => [student.studentId, student.smallGroupId]));
    const four = previewLayoutWithIdentity({ ...source, layoutIdentity: circularIdentity }, 'four', 4);
    const positionGroupByStudent = new Map(
      four.identity.snapshots.four?.positions.map((position) => [
        position.studentId,
        position.layoutPositionId.match(/FOUR-G(\d+)/)?.[1],
      ]),
    );

    four.identity.students.forEach((student) => {
      expect(student.largeGroupId.slice(-2)).toBe(positionGroupByStudent.get(student.studentId));
      expect(student.smallGroupId).toBe(smallGroupsBefore.get(student.studentId));
    });
    expect(four.identity.snapshots.circular).toBeTruthy();
  });

  it('keeps duplicate display names as separate student identities and positions', () => {
    const mode = circularMode(['Alex', 'Alex', 'Bee', 'Cara'], 1);
    const identity = captureLayoutIdentity(mode, null);
    const alex = identity.students.filter((student) => student.displayName === 'Alex');

    expect(alex).toHaveLength(2);
    expect(alex[0].studentId).not.toBe(alex[1].studentId);
    expect(getLayoutPositionIdForStudent(identity, 'circular', alex[0].studentId)).toBe('CIRCULAR-G01-S01');
    expect(getLayoutPositionIdForStudent(identity, 'circular', alex[1].studentId)).toBe('CIRCULAR-G01-S02');

    const rows = previewLayoutWithIdentity({ ...mode, layoutIdentity: identity }, 'rows', 1);
    const back = previewLayoutWithIdentity(rows.mode, 'circular', 1);
    expect(back.mode.groups?.[0].slice(0, 4)).toEqual(['Alex', 'Alex', 'Bee', 'Cara']);
  });

  it('invalidates stale layout snapshots when group count is deliberately changed', () => {
    const source = circularMode(makeStudents(24), 4);
    const rows = previewLayoutWithIdentity(source, 'rows', 4);
    const regrouped = applyManualGrouping('rows', 6, studentNames(rows.mode));
    const regroupedMode: TimeModeData = {
      ...rows.mode,
      layout: 'rows',
      groups: null,
      rowGroups: regrouped.rowGroups,
      fourGroups: null,
      layoutIdentity: rows.identity,
    };
    const identity = updateIdentityAfterRegroup(regroupedMode);

    expect(identity.groupingRevision).toBe(1);
    expect(Object.keys(identity.snapshots)).toEqual(['rows']);
    expect(new Set(identity.students.map((student) => student.smallGroupId)).size).toBe(6);
  });

  it.each([37, 45])('preserves all %i students and stable ids through layout switches and rotation tokens', (count) => {
    let mode = circularMode(makeStudents(count), 6);
    mode.layoutIdentity = captureLayoutIdentity(mode, null);
    const originalIds = mode.layoutIdentity.students.map((student) => student.studentId).sort();
    for (const layout of ['rows', 'four', 'circular', 'rows', 'four', 'circular'] as LayoutType[]) {
      const next = previewLayoutWithIdentity(mode, layout, layout === 'four' ? 4 : 6);
      expect(studentNames(next.mode).sort()).toEqual(makeStudents(count).sort());
      expect(next.identity.students.map((student) => student.studentId).sort()).toEqual(originalIds);
      expect(studentNames(buildIdentityTokenMode(next.mode, next.identity)).sort()).toEqual(originalIds);
      mode = next.mode;
    }
  });

  it('round-trips valid identity metadata and rejects malformed metadata', () => {
    const identity = captureLayoutIdentity(circularMode(makeStudents(10), 2), null);
    expect(sanitizeSeatingLayoutIdentity(JSON.parse(JSON.stringify(identity)))).toEqual(identity);
    expect(sanitizeSeatingLayoutIdentity({ schemaVersion: 1, students: [], snapshots: null })).toBeNull();
  });

  it.each<LayoutType>(['circular', 'rows', 'four', 'camp'])('records a snapshot for %s', (layout) => {
    const source = circularMode(makeStudents(18), 3);
    const count = layout === 'four' ? 3 : layout === 'camp' ? 6 : 3;
    const result = previewLayoutWithIdentity(source, layout, count);
    expect(result.identity.snapshots[layout]).toBeTruthy();
    expect(getSnapshotStudentOrder(result.identity, layout)).toHaveLength(18);
  });
});


describe('balanced first layout projection', () => {
  it('repairs legacy 6/6/6/6/3 buckets when first switching while preserving the saved original', () => {
    const students = makeStudents(27);
    const source = circularMode(students);
    source.groups = Array.from({length:6}, (_,i) => students.slice(i*6,i*6+6));
    const before = JSON.stringify(source);
    const target = previewLayoutWithIdentity(source, 'rows', 5);
    expect(getRowsSlotGroupsForIdentityTests(target.mode).slice(0,5).map(g=>g.filter(Boolean).length)).toEqual([6,6,5,5,5]);
    expect(studentNames(target.mode).sort()).toEqual(students.sort());
    expect(JSON.stringify(source)).toBe(before);
    const restored = previewLayoutWithIdentity(target.mode, 'circular', 5);
    expect(restored.restoredSnapshot).toBe(true);
    expect(restored.mode.groups).toEqual(source.groups);
  });
  it('balances the first four-group projection instead of preserving uneven derived large groups', () => {
    for (let count=4;count<=45;count++) {
      const source=circularMode(makeStudents(count),count>36?6:Math.max(1,Math.ceil(count/6)));
      const target=previewLayoutWithIdentity(source,'four',4);
      const counts=target.mode.fourGroups!.groups.map(g=>g.filter(Boolean).length);
      expect(Math.max(...counts)-Math.min(...counts), String(count)).toBeLessThanOrEqual(1);
      expect(studentNames(target.mode).sort()).toEqual(studentNames(source).sort());
    }
  });
});
