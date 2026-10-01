import type { DayOfWeek } from './index';

export type PhaseChallengeKey = '夯实基础' | '维稳达标' | '突破拔高';
export type ListeningFontOption = 'print' | 'guide' | 'rounded';
export type CustomBlockMode = 'text' | 'table' | 'image';
export type MediaAnnotationType = 'box' | 'text';
export type OverviewThemeOption = 'green' | 'amber' | 'blue' | 'rose' | 'graphite' | 'rainbow' | 'starry';

export interface WeeklyChallengeDay {
  day: DayOfWeek;
  task: string;
}

export interface PhaseChallengeRow {
  id: string;
  key: PhaseChallengeKey;
  label: string;
  selectedStudents: string[];
  challengeContent: string;
  method: string;
}

export interface MediaAnnotation {
  id: string;
  type: MediaAnnotationType;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  color: string;
}

export interface MediaItem {
  id: string;
  src: string;
  name: string;
  caption: string;
  displayWidth?: number;
  annotations: MediaAnnotation[];
}

export interface ChallengeItem {
  id: string;
  title: string;
  detail: string;
  media: MediaItem[];
}

export interface ListeningMaterialItem {
  id: string;
  english: string;
  chinese: string;
}

export interface CommunicationGroup {
  id: string;
  label: string;
  selectedStudents: string[];
  teacherName: string;
  slotType?: CommunicationSlotType;
  locationText?: string;
  scheduleText: string;
  note: string;
  sourceEntryId?: string;
  isManual?: boolean;
}

export type CommunicationSlotType =
  | 'weekday_before'
  | 'weekday_after'
  | 'weekend_before'
  | 'weekend_middle'
  | 'weekend_after';

export type CommunicationPlanMode = 'alphabet' | 'phase' | 'manual';
export type CommunicationPlanStatus = 'draft' | 'active' | 'done' | 'archived';

export interface CommunicationPlanEntry {
  id: string;
  label: string;
  weekIndex: number;
  slotType: CommunicationSlotType;
  selectedStudents: string[];
  teacherName: string;
  locationText: string;
  scheduleText: string;
  note: string;
  isManual?: boolean;
}

export interface CommunicationPlan {
  planName?: string;
  roundLabel?: string;
  status?: CommunicationPlanStatus;
  cycleWeeks?: number;
  deadlineDate?: string;
  mode?: CommunicationPlanMode;
  suggestedGroupSize?: number;
  availableSlots?: CommunicationSlotType[];
  defaultTeacherName?: string;
  defaultLocationText?: string;
  entries?: CommunicationPlanEntry[];
  groups: CommunicationGroup[];
  selectedStudents: string[];
  teacherName: string;
  scheduleText: string;
  note: string;
}

export interface CommunicationRecord {
  id: string;
  week: number;
  studentNames: string[];
  teacherName: string;
  scheduleText: string;
  note: string;
  groupLabel?: string;
  createdAt: number;
}

export interface SavedCommunicationPlan {
  id: string;
  classCode: string;
  planName: string;
  roundLabel: string;
  status: CommunicationPlanStatus;
  cycleWeeks: number;
  deadlineDate: string;
  mode: CommunicationPlanMode;
  suggestedGroupSize: number;
  availableSlots: CommunicationSlotType[];
  defaultTeacherName: string;
  defaultLocationText: string;
  entries: CommunicationPlanEntry[];
  savedAt: number;
}

export interface CommunicationSnapshot {
  id: string;
  classCode: string;
  week: number;
  roundLabel: string;
  planName: string;
  groups: CommunicationGroup[];
  createdAt: number;
}

export interface CustomTableData {
  columns: string[];
  rows: string[][];
}

export interface CustomBlock {
  id: string;
  title: string;
  mode: CustomBlockMode;
  text: string;
  table: CustomTableData;
  media: MediaItem[];
}

export interface OverviewContent {
  classCode: string;
  week: number;
  theme: OverviewThemeOption;
  challengeStartDay: DayOfWeek;
  weeklyChallenges: WeeklyChallengeDay[];
  phaseChallenges: PhaseChallengeRow[];
  challengeItems: ChallengeItem[];
  listeningMaterials: ListeningMaterialItem[];
  listeningFont: ListeningFontOption;
  communicationPlan: CommunicationPlan;
  customBlocks: CustomBlock[];
}

export interface OverviewDraft {
  content: OverviewContent;
  updatedAt: number;
}

export interface OverviewClassMemory {
  classCode: string;
  preferredCommunicationTeacher: string;
  preferredCommunicationSchedule: string;
  preferredCommunicationLocation: string;
  communicationGroups: CommunicationGroup[];
  phaseChallenges: PhaseChallengeRow[];
  customBlocks: CustomBlock[];
  communicationHistory: CommunicationRecord[];
  savedCommunicationPlans: SavedCommunicationPlan[];
  communicationSnapshots: CommunicationSnapshot[];
  updatedAt: number;
}
