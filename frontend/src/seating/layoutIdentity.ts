import {
  defaultRotationConfig,
  getCampGroupCountFromGroups,
  getCircularGroupCountFromGroups,
  getFourGroupCountFromGroups,
  getRowsGroupCountFromGroups,
  rowGroupsToSlotGroups,
} from './layouts';
import {
  getLayoutGroupSeatCapacity,
  makeEmptyCampGroups,
  makeEmptyCircularGroups,
  makeEmptyFourGroups,
  makeEmptyRowGroups,
} from './state';
import type {
  LayoutPositionAssignment,
  LayoutSeatSnapshot,
  LayoutType,
  SeatingLayoutIdentityState,
  SeatingStudentIdentity,
  TimeModeData,
} from './types';

type SeatEntry = {
  displayName: string;
  layoutPositionId: string;
  groupIndex: number;
};

const deepCopy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const cleanName = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const pad = (value: number): string => String(value).padStart(2, '0');
const smallGroupId = (groupIndex: number): string => `SG-${pad(groupIndex + 1)}`;
const largeGroupId = (groupIndex: number): string => `LG-${pad(groupIndex + 1)}`;

const hashText = (value: string): string => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

const identityOrdinal = (identity: SeatingStudentIdentity): number => {
  const match = identity.seatingAssignmentId.match(/(\d+)$/);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
};

const groupIndexFromId = (value: string, prefix: 'SG' | 'LG'): number | null => {
  const match = value.match(new RegExp(`^${prefix}-(\\d+)$`));
  if (!match) return null;
  const parsed = Number(match[1]) - 1;
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
};

const deriveLargeGroupIndex = (smallIndex: number, smallCount: number): number => {
  if (smallCount <= 1) return 0;
  return Math.min(3, Math.floor((smallIndex * 4) / smallCount));
};

export const getLayoutGroupCount = (mode: TimeModeData): number => {
  if (mode.layout === 'rows') return Math.max(1, getRowsGroupCountFromGroups(mode.rowGroups || makeEmptyRowGroups()));
  if (mode.layout === 'four') return Math.max(3, getFourGroupCountFromGroups(mode.fourGroups || makeEmptyFourGroups()));
  if (mode.layout === 'camp') return getCampGroupCountFromGroups(mode.groups || makeEmptyCampGroups());
  return Math.max(1, getCircularGroupCountFromGroups(mode.groups || makeEmptyCircularGroups()));
};

const enumerateSeatSlots = (mode: TimeModeData): SeatEntry[] => {
  const entries: SeatEntry[] = [];
  const append = (displayName: unknown, layoutPositionId: string, groupIndex: number) => {
    entries.push({ displayName: cleanName(displayName), layoutPositionId, groupIndex });
  };

  if (mode.layout === 'rows') {
    (mode.rowGroups?.rows || []).forEach((row, rowIndex) => {
      row.left.forEach((name, seatIndex) => append(name, `ROWS-R${pad(rowIndex + 1)}-L-S${pad(seatIndex + 1)}`, rowIndex * 2));
      row.right.forEach((name, seatIndex) => append(name, `ROWS-R${pad(rowIndex + 1)}-R-S${pad(seatIndex + 1)}`, rowIndex * 2 + 1));
    });
    return entries;
  }

  if (mode.layout === 'four') {
    (mode.fourGroups?.groups || []).slice(0, mode.fourGroups?.groupCount || 4).forEach((group, groupIndex) => {
      group.forEach((name, seatIndex) => append(name, `FOUR-G${pad(groupIndex + 1)}-S${pad(seatIndex + 1)}`, groupIndex));
    });
    return entries;
  }

  const prefix = mode.layout === 'camp' ? 'CAMP' : 'CIRCULAR';
  (mode.groups || []).forEach((group, groupIndex) => {
    group.forEach((name, seatIndex) => append(name, `${prefix}-G${pad(groupIndex + 1)}-S${pad(seatIndex + 1)}`, groupIndex));
  });
  return entries;
};

const enumerateSeats = (mode: TimeModeData): SeatEntry[] =>
  enumerateSeatSlots(mode).filter((entry) => entry.displayName);

const rosterSignature = (students: SeatingStudentIdentity[]): string =>
  students.map((student) => student.studentId).sort().join('|');

const makeSnapshot = (
  mode: TimeModeData,
  positions: LayoutPositionAssignment[],
  signature: string,
): LayoutSeatSnapshot => ({
  layout: mode.layout,
  groupCount: getLayoutGroupCount(mode),
  rosterSignature: signature,
  layoutPositionIds: enumerateSeatSlots(mode).map((entry) => entry.layoutPositionId),
  groups: mode.groups ? deepCopy(mode.groups) : null,
  groupOrder: mode.groupOrder ? [...mode.groupOrder] : null,
  groupLabels: mode.groupLabels ? [...mode.groupLabels] : null,
  rowGroups: mode.rowGroups ? deepCopy(mode.rowGroups) : null,
  fourGroups: mode.fourGroups ? deepCopy(mode.fourGroups) : null,
  currentArrangement: mode.currentArrangement || 0,
  rotationConfig: mode.rotationConfig ? { ...mode.rotationConfig } : null,
  positions,
});

export const sanitizeSeatingLayoutIdentity = (raw: unknown): SeatingLayoutIdentityState | null => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const candidate = raw as Partial<SeatingLayoutIdentityState>;
  if (candidate.schemaVersion !== 1 || !Array.isArray(candidate.students) || !candidate.snapshots || typeof candidate.snapshots !== 'object') {
    return null;
  }
  const students = candidate.students.filter((student): student is SeatingStudentIdentity => Boolean(
    student
      && typeof student.studentId === 'string'
      && typeof student.seatingAssignmentId === 'string'
      && typeof student.displayName === 'string'
      && typeof student.largeGroupId === 'string'
      && typeof student.smallGroupId === 'string'
  )).map((student) => ({ ...student }));
  if (new Set(students.map((student) => student.studentId)).size !== students.length) return null;
  return {
    schemaVersion: 1,
    groupingRevision: Number.isInteger(candidate.groupingRevision) ? Number(candidate.groupingRevision) : 0,
    students,
    snapshots: deepCopy(candidate.snapshots),
  };
};

export const captureLayoutIdentity = (
  mode: TimeModeData,
  previous: SeatingLayoutIdentityState | null | undefined,
  options: { regroupLogicalGroups?: boolean; preserveOtherSnapshots?: boolean } = {},
): SeatingLayoutIdentityState => {
  const prior = sanitizeSeatingLayoutIdentity(previous);
  const entries = enumerateSeats(mode);
  const previousStudents = prior?.students || [];
  const priorSnapshot = prior?.snapshots?.[mode.layout];
  const priorPositionMap = new Map((priorSnapshot?.positions || []).map((position) => [position.layoutPositionId, position]));
  const byId = new Map(previousStudents.map((student) => [student.studentId, student]));
  const byName = new Map<string, SeatingStudentIdentity[]>();
  previousStudents.forEach((student) => {
    const bucket = byName.get(student.displayName) || [];
    bucket.push(student);
    bucket.sort((a, b) => identityOrdinal(a) - identityOrdinal(b));
    byName.set(student.displayName, bucket);
  });

  const used = new Set<string>();
  let nextAssignment = previousStudents.reduce((max, student) => Math.max(max, identityOrdinal(student)), 0) + 1;
  const sameNameOccurrence = new Map<string, number>();
  const groupCount = getLayoutGroupCount(mode);
  const students: SeatingStudentIdentity[] = [];
  const positions: LayoutPositionAssignment[] = [];

  entries.forEach((entry) => {
    const positionMatch = priorPositionMap.get(entry.layoutPositionId);
    let identity = positionMatch?.displayName === entry.displayName ? byId.get(positionMatch.studentId) : undefined;
    if (identity && used.has(identity.studentId)) identity = undefined;
    if (!identity) identity = (byName.get(entry.displayName) || []).find((item) => !used.has(item.studentId));

    if (!identity) {
      const occurrence = (sameNameOccurrence.get(entry.displayName) || 0) + 1;
      sameNameOccurrence.set(entry.displayName, occurrence);
      const assignment = nextAssignment++;
      const smallIndex = mode.layout === 'four' ? Math.min(groupCount - 1, entry.groupIndex) : entry.groupIndex;
      const largeIndex = mode.layout === 'four'
        ? entry.groupIndex
        : deriveLargeGroupIndex(smallIndex, groupCount);
      identity = {
        studentId: `STU-${hashText(entry.displayName)}-${pad(occurrence)}`,
        seatingAssignmentId: `A-${String(assignment).padStart(3, '0')}`,
        displayName: entry.displayName,
        largeGroupId: largeGroupId(largeIndex),
        smallGroupId: smallGroupId(smallIndex),
      };
    } else {
      identity = { ...identity, displayName: entry.displayName };
    }

    if (options.regroupLogicalGroups) {
      if (mode.layout === 'four') {
        identity.largeGroupId = largeGroupId(entry.groupIndex);
      } else {
        identity.smallGroupId = smallGroupId(entry.groupIndex);
        identity.largeGroupId = largeGroupId(deriveLargeGroupIndex(entry.groupIndex, groupCount));
      }
    }

    used.add(identity.studentId);
    students.push(identity);
    positions.push({
      studentId: identity.studentId,
      displayName: identity.displayName,
      layoutPositionId: entry.layoutPositionId,
      largeGroupId: identity.largeGroupId,
      smallGroupId: identity.smallGroupId,
    });
  });

  students.sort((a, b) => identityOrdinal(a) - identityOrdinal(b));
  const signature = rosterSignature(students);
  const rosterChanged = prior ? signature !== rosterSignature(prior.students) : false;
  const resetOtherSnapshots = Boolean(
    rosterChanged || (options.regroupLogicalGroups && !options.preserveOtherSnapshots)
  );
  const snapshots = resetOtherSnapshots ? {} : deepCopy(prior?.snapshots || {});
  snapshots[mode.layout] = makeSnapshot(mode, positions, signature);

  return {
    schemaVersion: 1,
    groupingRevision: (prior?.groupingRevision || 0) + (options.regroupLogicalGroups ? 1 : 0),
    students,
    snapshots,
  };
};

const splitEvenly = (students: SeatingStudentIdentity[], groupCount: number): SeatingStudentIdentity[][] => {
  const result = Array.from({ length: groupCount }, () => [] as SeatingStudentIdentity[]);
  const base = Math.floor(students.length / groupCount);
  const extra = students.length % groupCount;
  let cursor = 0;
  for (let groupIndex = 0; groupIndex < groupCount; groupIndex += 1) {
    const count = base + (groupIndex < extra ? 1 : 0);
    result[groupIndex] = students.slice(cursor, cursor + count);
    cursor += count;
  }
  return result;
};

const buildLogicalGroups = (
  identity: SeatingLayoutIdentityState,
  targetLayout: LayoutType,
  groupCount: number,
  capacity: number,
): SeatingStudentIdentity[][] => {
  const groupKind = targetLayout === 'four' ? 'LG' : 'SG';
  const buckets = Array.from({ length: groupCount }, () => [] as SeatingStudentIdentity[]);
  let canPreserve = true;
  const ordered = [...identity.students].sort((a, b) => identityOrdinal(a) - identityOrdinal(b));
  ordered.forEach((student) => {
    const index = groupIndexFromId(groupKind === 'LG' ? student.largeGroupId : student.smallGroupId, groupKind);
    if (index === null || index >= groupCount) {
      canPreserve = false;
      return;
    }
    buckets[index].push(student);
  });
  const counts = buckets.map(bucket => bucket.length);
  if (canPreserve && buckets.every((bucket) => bucket.length <= capacity)
    && Math.max(...counts) - Math.min(...counts) <= 1) return buckets;
  return splitEvenly(ordered, groupCount);
};

const names = (students: SeatingStudentIdentity[], capacity: number): string[] => {
  if (students.length > capacity) throw new Error('当前组数容纳不下全部学生，请增加组数后再切换。');
  return [...students.map((student) => student.displayName), ...Array(capacity - students.length).fill('')];
};

const buildModeForLayout = (
  source: TimeModeData,
  targetLayout: LayoutType,
  groupCount: number,
  identity: SeatingLayoutIdentityState,
): TimeModeData => {
  const capacity = getLayoutGroupSeatCapacity(targetLayout, identity.students.length, groupCount);
  const metadataCount = targetLayout === 'camp' ? groupCount : 6;
  const base: TimeModeData = {
    layout: targetLayout,
    groups: null,
    groupOrder: Array.from({ length: metadataCount }, (_, index) => index + 1),
    groupLabels: Array.from({ length: metadataCount }, (_, index) => String(index + 1)),
    rowGroups: null,
    fourGroups: null,
    currentArrangement: 0,
    locationInfo: deepCopy(source.locationInfo),
    rotationConfig: defaultRotationConfig(targetLayout),
    layoutIdentity: identity,
  };

  if (targetLayout === 'circular') {
    const logical = buildLogicalGroups(identity, targetLayout, groupCount, capacity);
    const groups = makeEmptyCircularGroups(capacity);
    logical.forEach((group, index) => { groups[index] = names(group, capacity); });
    base.groups = groups;
  } else if (targetLayout === 'rows') {
    const logical = buildLogicalGroups(identity, targetLayout, groupCount, capacity);
    const rows = makeEmptyRowGroups(capacity);
    logical.forEach((group, index) => {
      const rowIndex = Math.floor(index / 2);
      const side = index % 2 === 0 ? 'left' : 'right';
      if (rows.rows[rowIndex]) rows.rows[rowIndex][side] = names(group, capacity);
    });
    base.rowGroups = rows;
  } else if (targetLayout === 'four') {
    const logical = buildLogicalGroups(identity, targetLayout, groupCount, capacity);
    const four = makeEmptyFourGroups(capacity);
    four.groupCount = groupCount;
    logical.forEach((group, index) => { four.groups[index] = names(group, capacity); });
    base.fourGroups = four;
  } else {
    const logical = buildLogicalGroups(identity, targetLayout, groupCount, capacity);
    const groups = makeEmptyCampGroups(groupCount);
    logical.forEach((group, index) => { groups[index] = names(group, capacity); });
    base.groups = groups;
  }
  return base;
};

const restoreSnapshot = (
  source: TimeModeData,
  snapshot: LayoutSeatSnapshot,
  identity: SeatingLayoutIdentityState,
): TimeModeData => ({
  layout: snapshot.layout,
  groups: snapshot.groups ? deepCopy(snapshot.groups) : null,
  groupOrder: snapshot.groupOrder ? [...snapshot.groupOrder] : null,
  groupLabels: snapshot.groupLabels ? [...snapshot.groupLabels] : null,
  rowGroups: snapshot.rowGroups ? deepCopy(snapshot.rowGroups) : null,
  fourGroups: snapshot.fourGroups ? deepCopy(snapshot.fourGroups) : null,
  currentArrangement: snapshot.currentArrangement,
  locationInfo: deepCopy(source.locationInfo),
  rotationConfig: snapshot.rotationConfig ? { ...snapshot.rotationConfig } : defaultRotationConfig(snapshot.layout),
  layoutIdentity: identity,
});

export const previewLayoutWithIdentity = (
  currentMode: TimeModeData,
  targetLayout: LayoutType,
  targetGroupCount: number,
): { mode: TimeModeData; identity: SeatingLayoutIdentityState; restoredSnapshot: boolean } => {
  const captured = captureLayoutIdentity(currentMode, currentMode.layoutIdentity);
  const signature = rosterSignature(captured.students);
  const snapshot = captured.snapshots[targetLayout];
  if (snapshot && snapshot.rosterSignature === signature && snapshot.groupCount === targetGroupCount) {
    const mode = restoreSnapshot(currentMode, snapshot, captured);
    return { mode, identity: captured, restoredSnapshot: true };
  }

  const projected = buildModeForLayout(currentMode, targetLayout, targetGroupCount, captured);
  const identity = captureLayoutIdentity(projected, captured, targetLayout === 'four'
    ? { regroupLogicalGroups: true, preserveOtherSnapshots: true }
    : {});
  projected.layoutIdentity = identity;
  return { mode: projected, identity, restoredSnapshot: false };
};

export const updateIdentityAfterRegroup = (mode: TimeModeData): SeatingLayoutIdentityState =>
  captureLayoutIdentity(mode, mode.layoutIdentity, { regroupLogicalGroups: true });

export const buildIdentityTokenMode = (
  mode: TimeModeData,
  identity: SeatingLayoutIdentityState,
): TimeModeData => {
  const positionToStudent = new Map(
    (identity.snapshots[mode.layout]?.positions || []).map((position) => [position.layoutPositionId, position.studentId]),
  );
  const tokenFor = (layoutPositionId: string): string => positionToStudent.get(layoutPositionId) || '';
  const tokenMode = deepCopy(mode);

  if (mode.layout === 'rows') {
    const rows = deepCopy(mode.rowGroups || makeEmptyRowGroups());
    rows.rows.forEach((row, rowIndex) => {
      row.left = row.left.map((_, seatIndex) => tokenFor(`ROWS-R${pad(rowIndex + 1)}-L-S${pad(seatIndex + 1)}`));
      row.right = row.right.map((_, seatIndex) => tokenFor(`ROWS-R${pad(rowIndex + 1)}-R-S${pad(seatIndex + 1)}`));
    });
    tokenMode.rowGroups = rows;
    tokenMode.groups = null;
    tokenMode.fourGroups = null;
    return tokenMode;
  }

  if (mode.layout === 'four') {
    const four = deepCopy(mode.fourGroups || makeEmptyFourGroups());
    four.groupCount = mode.fourGroups?.groupCount || 4;
    four.groups = four.groups.map((group, groupIndex) => group.map((_, seatIndex) =>
      tokenFor(`FOUR-G${pad(groupIndex + 1)}-S${pad(seatIndex + 1)}`)));
    tokenMode.fourGroups = four;
    tokenMode.groups = null;
    tokenMode.rowGroups = null;
    return tokenMode;
  }

  const prefix = mode.layout === 'camp' ? 'CAMP' : 'CIRCULAR';
  const sourceGroups = mode.groups || (mode.layout === 'camp' ? makeEmptyCampGroups() : makeEmptyCircularGroups());
  tokenMode.groups = sourceGroups.map((group, groupIndex) => group.map((_, seatIndex) =>
    tokenFor(`${prefix}-G${pad(groupIndex + 1)}-S${pad(seatIndex + 1)}`)));
  tokenMode.rowGroups = null;
  tokenMode.fourGroups = null;
  return tokenMode;
};

export const getStudentIdPositionMap = (tokenMode: TimeModeData): Record<string, string> =>
  Object.fromEntries(enumerateSeats(tokenMode).map((entry) => [entry.layoutPositionId, entry.displayName]));

export const captureRotatedLayoutIdentity = (
  mode: TimeModeData,
  previous: SeatingLayoutIdentityState,
  studentIdByPosition: Record<string, string>,
): SeatingLayoutIdentityState => {
  const prior = sanitizeSeatingLayoutIdentity(previous);
  if (!prior) return captureLayoutIdentity(mode, null);

  const byId = new Map(prior.students.map((student) => [student.studentId, student]));
  const used = new Set<string>();
  const positions: LayoutPositionAssignment[] = [];
  const namesById = new Map<string, string>();

  for (const entry of enumerateSeats(mode)) {
    const studentId = studentIdByPosition[entry.layoutPositionId];
    const identity = byId.get(studentId);
    if (!identity || used.has(studentId)) {
      return captureLayoutIdentity(mode, prior);
    }
    used.add(studentId);
    namesById.set(studentId, entry.displayName);
    positions.push({
      studentId,
      displayName: entry.displayName,
      layoutPositionId: entry.layoutPositionId,
      largeGroupId: identity.largeGroupId,
      smallGroupId: identity.smallGroupId,
    });
  }

  if (used.size !== prior.students.length) {
    return captureLayoutIdentity(mode, prior);
  }

  const students = prior.students.map((student) => ({
    ...student,
    displayName: namesById.get(student.studentId) || student.displayName,
  }));
  const signature = rosterSignature(students);
  const snapshots = deepCopy(prior.snapshots);
  snapshots[mode.layout] = makeSnapshot(mode, positions, signature);
  return {
    schemaVersion: 1,
    groupingRevision: prior.groupingRevision,
    students,
    snapshots,
  };
};

export const getLayoutPositionIdForStudent = (
  identity: SeatingLayoutIdentityState | null | undefined,
  layout: LayoutType,
  studentId: string,
): string | null => identity?.snapshots?.[layout]?.positions.find((position) => position.studentId === studentId)?.layoutPositionId || null;

export const getSnapshotStudentOrder = (
  identity: SeatingLayoutIdentityState | null | undefined,
  layout: LayoutType,
): string[] => identity?.snapshots?.[layout]?.positions.map((position) => position.studentId) || [];

export const getRowsSlotGroupsForIdentityTests = (mode: TimeModeData): string[][] =>
  rowGroupsToSlotGroups(mode.rowGroups || makeEmptyRowGroups());
