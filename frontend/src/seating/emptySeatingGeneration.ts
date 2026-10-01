import { buildCampImportState, buildCircularImportState, type ImportedLayoutState } from './layoutOperations';
import {
  collectStudentsFromCamp,
  collectStudentsFromCircular,
  collectStudentsFromFour,
  collectStudentsFromRows,
  defaultRotationConfig,
} from './layouts';
import type { ClassConfig, LayoutType, LocationInfo, TimeModeData } from './types';

export const countModeStudents = (mode: TimeModeData): number => {
  if (mode.layout === 'circular') {
    return collectStudentsFromCircular(mode.groups || []).length;
  }
  if (mode.layout === 'camp') {
    return collectStudentsFromCamp(mode.groups || []).length;
  }
  if (mode.layout === 'rows') {
    return collectStudentsFromRows(mode.rowGroups || { rows: [] }).length;
  }
  return collectStudentsFromFour(mode.fourGroups || { groups: [], groupCount: 0 }).length;
};

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export const classConfigHasAnySeating = (config: ClassConfig | null | undefined): boolean =>
  Boolean(config && (countModeStudents(config.weekday) > 0 || countModeStudents(config.weekend) > 0));

const makeModeFromImport = (imported: ImportedLayoutState, locationInfo: LocationInfo): TimeModeData => ({
  layout: imported.currentLayout,
  groups: imported.currentLayout === 'circular' || imported.currentLayout === 'camp'
    ? clone(imported.groups)
    : null,
  groupOrder: [...imported.currentGroupOrder],
  groupLabels: [...imported.currentGroupLabels],
  rowGroups: imported.currentLayout === 'rows' ? clone(imported.rowGroups) : null,
  fourGroups: imported.currentLayout === 'four' ? clone(imported.fourGroups) : null,
  currentArrangement: imported.currentArrangement,
  locationInfo: clone(locationInfo),
  rotationConfig: defaultRotationConfig(imported.currentLayout),
});

export const populateEmptyClassWithStudents = (
  config: ClassConfig,
  students: string[],
  layout: LayoutType = 'circular',
): boolean => {
  if (classConfigHasAnySeating(config) || students.length === 0) {
    return false;
  }

  const imported = layout === 'camp'
    ? buildCampImportState(students)
    : buildCircularImportState(students);
  const weekdayLocation = config.weekday.locationInfo;
  const weekendLocation = config.weekend.locationInfo;
  config.weekday = makeModeFromImport(imported, weekdayLocation);
  config.weekend = makeModeFromImport(imported, weekendLocation);
  return true;
};
