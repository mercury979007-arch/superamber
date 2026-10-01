import {
  collectStudentsFromCamp,
  collectStudentsFromCircular,
  collectStudentsFromFour,
  collectStudentsFromRows,
  getCampGroupCountFromGroups,
} from './layouts';
import type { FourGroups, LayoutType, RotationConfig, RowGroups, SeatingLayoutIdentityState } from './types';

export type ManualSeatRef =
  | { key: string; label: string; kind: 'circular'; groupIndex: number; seatIndex: number }
  | { key: string; label: string; kind: 'camp'; groupIndex: number; seatIndex: number }
  | { key: string; label: string; kind: 'rows'; rowIndex: number; side: 'left' | 'right'; seatIndex: number }
  | { key: string; label: string; kind: 'four'; groupIndex: number; seatIndex: number };

export interface ManualTuneDraft {
  layout: LayoutType;
  groups: string[][];
  rowGroups: RowGroups;
  fourGroups: FourGroups;
  groupCount: number;
  selectedSeatKey: string | null;
  editingSeatKey: string | null;
  isDirty: boolean;
  sourceLayout?: LayoutType;
  baselineStudents?: string[];
  requiresBalancedGroups?: boolean;
  resetGroupMeta?: boolean;
  studentSetEdited?: boolean;
  layoutIdentity?: SeatingLayoutIdentityState | null;
  restoredLayoutSnapshot?: boolean;
  groupOrder?: number[] | null;
  groupLabels?: string[] | null;
  rotationConfig?: RotationConfig | null;
  currentArrangement?: number;
}

export function collectManualDraftStudents(draft: ManualTuneDraft): string[] {
  return draft.layout === 'circular'
    ? collectStudentsFromCircular(draft.groups)
    : draft.layout === 'camp'
      ? collectStudentsFromCamp(draft.groups)
      : draft.layout === 'rows'
        ? collectStudentsFromRows(draft.rowGroups)
        : collectStudentsFromFour(draft.fourGroups);
}

function countStudents(values: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  values.map((value) => value.trim()).filter(Boolean).forEach((value) => {
    counts.set(value, (counts.get(value) || 0) + 1);
  });
  return counts;
}

export function compareStudentMultisets(
  before: string[],
  after: string[],
): { ok: boolean; missing: string[]; added: string[] } {
  const beforeCounts = countStudents(before);
  const afterCounts = countStudents(after);
  const names = new Set([...beforeCounts.keys(), ...afterCounts.keys()]);
  const missing: string[] = [];
  const added: string[] = [];

  names.forEach((name) => {
    const beforeCount = beforeCounts.get(name) || 0;
    const afterCount = afterCounts.get(name) || 0;
    for (let index = afterCount; index < beforeCount; index += 1) missing.push(name);
    for (let index = beforeCount; index < afterCount; index += 1) added.push(name);
  });

  return { ok: missing.length === 0 && added.length === 0, missing, added };
}

export function getManualDraftGroupCounts(draft: ManualTuneDraft): number[] {
  const groupCount = Math.max(0, Number.isInteger(draft.groupCount) ? draft.groupCount : 0);
  if (draft.layout === 'rows') {
    return draft.rowGroups.rows
      .flatMap((row) => [row.left, row.right])
      .slice(0, groupCount)
      .map((group) => group.filter((name) => name.trim()).length);
  }
  if (draft.layout === 'four') {
    return draft.fourGroups.groups
      .slice(0, groupCount)
      .map((group) => group.filter((name) => name.trim()).length);
  }
  return draft.groups
    .slice(0, groupCount)
    .map((group) => group.filter((name) => name.trim()).length);
}

export function validateBalancedManualGroups(draft: ManualTuneDraft): { ok: boolean; counts: number[] } {
  const counts = getManualDraftGroupCounts(draft);
  if (counts.length !== draft.groupCount || counts.length === 0) {
    return { ok: false, counts };
  }
  return {
    ok: Math.max(...counts) - Math.min(...counts) <= 1,
    counts,
  };
}

export function buildManualSeatSections(draft: ManualTuneDraft): Array<{ title: string; seats: ManualSeatRef[] }> {
  if (draft.layout === 'circular') {
    return draft.groups.map((group, groupIndex) => ({
      title: `第${groupIndex + 1}组`,
      seats: group.map((_, seatIndex) => ({
        key: `c-${groupIndex}-${seatIndex}`,
        label: `座位 ${seatIndex + 1}`,
        kind: 'circular',
        groupIndex,
        seatIndex,
      })),
    }));
  }

  if (draft.layout === 'camp') {
    const groupCount = getCampGroupCountFromGroups(draft.groups);
    return draft.groups.slice(0, groupCount).map((group, groupIndex) => ({
      title: `Group ${groupIndex + 1}`,
      seats: group.map((_, seatIndex) => ({
        key: `camp-${groupIndex}-${seatIndex}`,
        label: `位置 ${seatIndex + 1}`,
        kind: 'camp' as const,
        groupIndex,
        seatIndex,
      })),
    }));
  }

  if (draft.layout === 'rows') {
    const labels = [
      ['第一排左', '第一排右'],
      ['第二排左', '第二排右'],
      ['第三排左', '第三排右'],
    ] as const;

    return draft.rowGroups.rows.flatMap((row, rowIndex) => ([
      {
        title: labels[rowIndex][0],
        seats: row.left.map((_, seatIndex) => ({
          key: `r-${rowIndex}-left-${seatIndex}`,
          label: `位置 ${seatIndex + 1}`,
          kind: 'rows' as const,
          rowIndex,
          side: 'left' as const,
          seatIndex,
        })),
      },
      {
        title: labels[rowIndex][1],
        seats: row.right.map((_, seatIndex) => ({
          key: `r-${rowIndex}-right-${seatIndex}`,
          label: `位置 ${seatIndex + 1}`,
          kind: 'rows' as const,
          rowIndex,
          side: 'right' as const,
          seatIndex,
        })),
      },
    ]));
  }

  if (draft.layout === 'four') {
    return draft.fourGroups.groups.slice(0, draft.fourGroups.groupCount).map((group, groupIndex) => ({
      title: `第${groupIndex + 1}组`,
      seats: group.map((_, seatIndex) => ({
        key: `f-${groupIndex}-${seatIndex}`,
        label: `位置 ${seatIndex + 1}`,
        kind: 'four' as const,
        groupIndex,
        seatIndex,
      })),
    }));
  }
  return [];
}

export function getManualSeatValue(draft: ManualTuneDraft, seat: ManualSeatRef): string {
  if (seat.kind === 'circular' || seat.kind === 'camp') {
    return draft.groups[seat.groupIndex]?.[seat.seatIndex] || '';
  }
  if (seat.kind === 'rows') {
    return draft.rowGroups.rows[seat.rowIndex]?.[seat.side]?.[seat.seatIndex] || '';
  }
  if (seat.kind === 'four') {
    return draft.fourGroups.groups[seat.groupIndex]?.[seat.seatIndex] || '';
  }
  return '';
}

export function setManualSeatValue(draft: ManualTuneDraft, seat: ManualSeatRef, value: string): void {
  if (seat.kind === 'circular' || seat.kind === 'camp') {
    draft.groups[seat.groupIndex][seat.seatIndex] = value;
    return;
  }
  if (seat.kind === 'rows') {
    draft.rowGroups.rows[seat.rowIndex][seat.side][seat.seatIndex] = value;
    return;
  }
  if (seat.kind === 'four') {
    draft.fourGroups.groups[seat.groupIndex][seat.seatIndex] = value;
  }
}

export function findManualSeat(draft: ManualTuneDraft, key: string): ManualSeatRef | null {
  for (const section of buildManualSeatSections(draft)) {
    const hit = section.seats.find((seat) => seat.key === key);
    if (hit) {
      return hit;
    }
  }
  return null;
}

export function manualSeatSummary(seat: ManualSeatRef): string {
  if (seat.kind === 'circular') {
    return `第${seat.groupIndex + 1}组 · 位置${seat.seatIndex + 1}`;
  }
  if (seat.kind === 'camp') {
    return `Group ${seat.groupIndex + 1} · 位置${seat.seatIndex + 1}`;
  }
  if (seat.kind === 'rows') {
    return `第${seat.rowIndex + 1}排${seat.side === 'left' ? '左' : '右'}侧 · 位置${seat.seatIndex + 1}`;
  }
  if (seat.kind === 'four') {
    return `第${seat.groupIndex + 1}组 · 位置${seat.seatIndex + 1}`;
  }
  return '';
}

export function findFirstEmptyManualSeat(draft: ManualTuneDraft): ManualSeatRef | null {
  return buildManualSeatSections(draft)
    .flatMap((section) => section.seats)
    .find((seat) => !getManualSeatValue(draft, seat).trim()) || null;
}

export function shuffleManualSeatAssignments(draft: ManualTuneDraft): boolean {
  const allSeats = buildManualSeatSections(draft).flatMap((section) => section.seats);
  const occupiedSeats = allSeats.filter((seat) => getManualSeatValue(draft, seat).trim());

  if (occupiedSeats.length <= 1) {
    return false;
  }

  const names = occupiedSeats.map((seat) => getManualSeatValue(draft, seat));
  for (let i = names.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [names[i], names[j]] = [names[j], names[i]];
  }

  occupiedSeats.forEach((seat, index) => {
    setManualSeatValue(draft, seat, names[index]);
  });

  draft.selectedSeatKey = null;
  draft.editingSeatKey = null;
  return true;
}
