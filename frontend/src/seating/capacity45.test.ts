import { describe, expect, it } from 'vitest';
import { sanitizeModeData } from './app';
import { buildCircularImportState, buildFourImportState, buildRowsImportState } from './layoutOperations';
import { makeEmptyLocationInfo } from './state';
import type { ImportedLayoutState } from './layoutOperations';
import type { TimeModeData } from './types';

const names = Array.from({ length: 45 }, (_, index) => `S${index + 1}`);

const asMode = (imported: ImportedLayoutState): TimeModeData => ({
  layout: imported.currentLayout,
  groups: imported.groups,
  groupOrder: imported.currentGroupOrder,
  groupLabels: imported.currentGroupLabels,
  rowGroups: imported.rowGroups,
  fourGroups: imported.fourGroups,
  currentArrangement: 0,
  locationInfo: makeEmptyLocationInfo(),
});

describe('45-person persisted data migration', () => {
  it.each([
    ['circular', buildCircularImportState],
    ['rows', buildRowsImportState],
    ['four', buildFourImportState],
  ] as const)('keeps all 45 students in %s while sanitizing saved data', (layout, build) => {
    const sanitized = sanitizeModeData(asMode(build(names)));
    const count = layout === 'circular'
      ? sanitized.groups?.flat().filter(Boolean).length
      : layout === 'rows'
        ? sanitized.rowGroups?.rows.flatMap((row) => [...row.left, ...row.right]).filter(Boolean).length
        : sanitized.fourGroups?.groups.flat().filter(Boolean).length;
    expect(count).toBe(45);
  });
});
