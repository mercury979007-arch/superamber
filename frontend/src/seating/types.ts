export type TimeMode = 'weekday' | 'weekend';
export type LayoutType = 'circular' | 'rows' | 'four' | 'camp';
export type ThemeName = 'paper' | 'classic' | 'mint' | 'rose' | 'apricot' | 'golden' | 'plum';
export type GroupRotation = 'clockwise' | 'counterclockwise' | 'snake' | 'row-left' | 'row-right' | 'row-swap' | 'front-back-swap';
export type InternalRotation = 'none' | 'right1' | 'right2' | 'left1' | 'left2';
export type LabelRotationMode = 'fixed' | 'rotate' | 'custom';
export type LabelNameMode = 'standard' | 'custom';

export interface RotationConfig {
  groupRotation: GroupRotation;
  internalRotation: InternalRotation;
  labelRotation: LabelRotationMode;
  labelNameMode?: LabelNameMode;
}

export type OcrEngineMode = 'hybrid' | 'tencent' | 'local';
export type TencentOcrAction = 'Auto' | 'ExtractDocMulti' | 'GeneralAccurateOCR' | 'GeneralBasicOCR';

export interface LocationInfo {
  date: string;
  day: string;
  weekday: string;
  time: string;
  campus: string;
  floor: string;
  room: string;
  arrivalMessage: string;
  notes: string;
  notesHidden?: boolean;
  fullDate: string;
  seatTitle?: string;
}

export interface RowGroup {
  left: string[];
  right: string[];
}

export interface RowGroups {
  rows: RowGroup[];
}

export interface FourGroups {
  groups: string[][];
  groupCount: number;
}

export interface SeatingStudentIdentity {
  studentId: string;
  seatingAssignmentId: string;
  displayName: string;
  largeGroupId: string;
  smallGroupId: string;
}

export interface LayoutPositionAssignment {
  studentId: string;
  displayName: string;
  layoutPositionId: string;
  largeGroupId: string;
  smallGroupId: string;
}

export interface LayoutSeatSnapshot {
  layout: LayoutType;
  groupCount: number;
  rosterSignature: string;
  layoutPositionIds?: string[];
  groups: string[][] | null;
  groupOrder: number[] | null;
  groupLabels: string[] | null;
  rowGroups: RowGroups | null;
  fourGroups: FourGroups | null;
  currentArrangement: number;
  rotationConfig: RotationConfig | null;
  positions: LayoutPositionAssignment[];
}

export interface SeatingLayoutIdentityState {
  schemaVersion: 1;
  groupingRevision: number;
  students: SeatingStudentIdentity[];
  snapshots: Partial<Record<LayoutType, LayoutSeatSnapshot>>;
}

export interface TimeModeData {
  layout: LayoutType;
  groups: string[][] | null;
  groupOrder: number[] | null;
  groupLabels?: string[] | null;
  rowGroups: RowGroups | null;
  fourGroups: FourGroups | null;
  currentArrangement: number;
  locationInfo: LocationInfo;
  rotationConfig?: RotationConfig | null;
  layoutIdentity?: SeatingLayoutIdentityState | null;
  rotationConfigsByLayout?: Partial<Record<LayoutType, RotationConfig>>;
}

export interface ClassSnapshot {
  theme: ThemeName;
  weekday: TimeModeData;
  weekend: TimeModeData;
}

export interface ReminderNote {
  id: string;
  text: string;
  dueDate: string;
  source: 'manual' | 'weekly';
  completed: boolean;
  createdAt: string;
  completedAt: string | null;
}

export interface CnfBinding {
  squadId: string;
  squadType: 'offline' | 'online';
  sessionToken: string;
  loginUsername: string;
  lastSyncedAt: string;
}

export interface ClassConfig extends ClassSnapshot {
  previousWeek: ClassSnapshot | null;
  cnf: CnfBinding | null;
  todoNotes: ReminderNote[];
  rosterMirror?: Array<{
    id: string;
    studentId?: string;
    chineseName: string;
    englishName?: string;
  }>;
}

export type ClassData = Record<string, ClassConfig>;

export interface AcademicTermLaunchMeta {
  termId: string;
  week1Start: string;
  completedAt: string;
  rotatedClassCodes: string[];
}

export interface UserProfile {
  username: string;
  theme: ThemeName;
}

export interface ReminderMeta {
  enabled: boolean;
  panelCollapsed: boolean;
  weeklyConfirmedWeek: number;
  weeklyConfirmedAt: string;
  lastAlertDate: string;
}

export interface OCRSettings {
  engine: OcrEngineMode;
  allowLocalFallback: boolean;
  tencentEndpoint: string;
  tencentRegion: string;
  tencentAction: TencentOcrAction;
}

export interface AppState {
  isEditMode: boolean;
  currentArrangement: number;
  currentTimeMode: TimeMode;
  currentLayout: LayoutType;
  currentView: 'home' | 'editor';
  groups: string[][];
  currentGroupOrder: number[];
  currentGroupLabels: string[];
  rowGroups: RowGroups;
  fourGroups: FourGroups;
  classData: ClassData;
  userProfile: UserProfile;
  rotationConfig: RotationConfig;
  rotationConfigsByLayout: Partial<Record<LayoutType, RotationConfig>>;
}
