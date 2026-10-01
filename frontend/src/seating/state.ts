import type {
  AppState,
  ClassData,
  FourGroups,
  LayoutType,
  RotationConfig,
  LocationInfo,
  RowGroups,
  ReminderMeta,
  ThemeName,
  TimeModeData,
  UserProfile
} from './types';

export const CIRCULAR_GROUP_SIZE = 6;
export const ROW_GROUP_SIZE = 6;
export const FOUR_GROUP_SIZE = 9;
export const CAMP_GROUP_SIZE = 8;
export const CIRCULAR_EXPANDED_GROUP_SIZE = 8;
export const ROW_EXPANDED_GROUP_SIZE = 8;
export const FOUR_EXPANDED_GROUP_SIZE = 12;
export const STANDARD_STUDENT_LIMIT = 36;
export const MAX_STUDENT_LIMIT = 45;
export const CAMP_DEFAULT_GROUP_COUNT = 6;
export const CAMP_ALLOWED_GROUP_COUNTS = [6, 8] as const;

export const getLayoutGroupSeatCapacity = (
  layout: LayoutType,
  studentCount = 0,
  groupCount = layout === 'four' ? 4 : 6,
): number => {
  if (layout === 'camp') return CAMP_GROUP_SIZE;

  const safeGroupCount = Math.max(1, groupCount);
  const required = Math.ceil(Math.max(0, studentCount) / safeGroupCount);
  if (layout === 'four') {
    return Math.max(FOUR_GROUP_SIZE, Math.min(FOUR_EXPANDED_GROUP_SIZE, required));
  }
  if (layout === 'rows') {
    return Math.max(ROW_GROUP_SIZE, Math.min(ROW_EXPANDED_GROUP_SIZE, required));
  }
  return Math.max(CIRCULAR_GROUP_SIZE, Math.min(CIRCULAR_EXPANDED_GROUP_SIZE, required));
};

export const makeEmptyCircularGroups = (seatCapacity = CIRCULAR_GROUP_SIZE): string[][] =>
  Array.from({ length: 6 }, () => Array(seatCapacity).fill(''));

export const makeEmptyCampGroups = (groupCount: number = CAMP_DEFAULT_GROUP_COUNT): string[][] => {
  const normalizedGroupCount = CAMP_ALLOWED_GROUP_COUNTS.includes(groupCount as 6 | 8)
    ? groupCount
    : CAMP_DEFAULT_GROUP_COUNT;
  return Array.from({ length: normalizedGroupCount }, () => Array(CAMP_GROUP_SIZE).fill(''));
};

export const makeEmptyRowGroups = (seatCapacity = ROW_GROUP_SIZE): RowGroups => ({
  rows: Array.from({ length: 3 }, () => ({
    left: Array(seatCapacity).fill(''),
    right: Array(seatCapacity).fill('')
  }))
});

export const makeEmptyFourGroups = (seatCapacity = FOUR_GROUP_SIZE): FourGroups => ({
  groups: Array.from({ length: 4 }, () => Array(seatCapacity).fill('')),
  groupCount: 4
});

export const makeEmptyLocationInfo = (): LocationInfo => ({
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
  seatTitle: ''
});

export const makeModeData = (layout: LayoutType = 'circular'): TimeModeData => ({
  layout,
  groups: null,
  groupOrder: null,
  groupLabels: null,
  rowGroups: null,
  fourGroups: null,
  currentArrangement: 0,
  locationInfo: makeEmptyLocationInfo(),
  layoutIdentity: null,
});

export const makeClassShell = (layout: LayoutType = 'circular', theme: ThemeName = 'paper') => ({
  theme,
  weekday: makeModeData(layout),
  weekend: makeModeData(layout),
  previousWeek: null,
  cnf: null,
  todoNotes: []
});

export const makeDefaultProfile = (): UserProfile => ({
  username: '',
  theme: 'paper' as ThemeName
});

export const makeDefaultReminderMeta = (): ReminderMeta => ({
  enabled: false,
  panelCollapsed: false,
  weeklyConfirmedWeek: 0,
  weeklyConfirmedAt: '',
  lastAlertDate: ''
});

export const createInitialState = (): AppState => ({
  isEditMode: false,
  currentArrangement: 0,
  currentTimeMode: 'weekday',
  currentLayout: 'circular',
  currentView: 'home',
  groups: makeEmptyCircularGroups(),
  currentGroupOrder: [1, 2, 3, 4, 5, 6],
  currentGroupLabels: ['1', '2', '3', '4', '5', '6'],
  rowGroups: makeEmptyRowGroups(),
  fourGroups: makeEmptyFourGroups(),
  classData: {} as ClassData,
  userProfile: makeDefaultProfile(),
  rotationConfig: { groupRotation: 'clockwise', internalRotation: 'right2', labelRotation: 'rotate', labelNameMode: 'standard' },
  rotationConfigsByLayout: {}
});
