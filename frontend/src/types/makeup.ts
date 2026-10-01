export interface MakeupScheduleDetail {
  day: string;
  time: string;
  teacher: string;
  campus: string;
  room: string;
}

export interface MakeupClassMeta {
  class_code: string;
  batch: string;
  type: string;
  head_teacher: string;
  grade: string;
  student_count: string;
  weekday: MakeupScheduleDetail;
  weekend: MakeupScheduleDetail;
}

export interface MakeupOccurrence {
  date?: string;
  id: string;
  class_code: string;
  week_label: string;
  week_col: number;
  mode: '周中' | '周末';
  lesson: string;
  day: string;
  time: string;
  teacher: string;
  campus: string;
  room: string;
  grade: string;
  type: string;
  head_teacher: string;
  student_count: string;
}

export interface MakeupSlot {
  day: string;
  time: string;
}

export interface StageMeta {
  key: string;
  label: string;
  enabled: boolean;
  status: string;
  weekday_count: number;
  weekend_count: number;
  entry_count: number;
  note: string;
  class_count?: number;
  lesson_count?: number;
}

export interface MakeupDataset {
  classes: MakeupClassMeta[];
  occurrences: MakeupOccurrence[];
  slots: MakeupSlot[];
  meta: {
    bundle_revision?: string;
    schedule_revision?: string;
    warnings?: string[];
    time_status?: string;
    calendar?: {academicYear:number;week1Start:string};
    extraction?: {
      version:string;
      tables:unknown[];
      review_items:{code:string;message:string;source?:{sheet:string;cell:string}}[];
      skipped_records:unknown[];
      recognized_records:number;
      missing_field_counts:Record<string,number>;
    };
    active_stage: string;
    supported_stages: StageMeta[];
    source_name: string;
    source_kind?: 'amber_bundle' | 'file';
    imported_at: string;
    invalid_week_labels: string[];
    has_grade?: boolean;
    data_format_version?: number;
  };
}

export interface ScoredCandidate {
  candidate: MakeupOccurrence;
  pct: number;
  sortKey: number;
  weekTier: number; // 2=same week, 1=adjacent week, 0=farther
  reasons: { text: string; good: boolean }[];
}

export interface QuickParseResult {
  classCode: string | null;
  missedDay: string | null;
  missedOccId: string | null;
  makeupRequests: { day: string; time: string; endTime?: string; mode: 'exact' | 'after' | 'before' | 'range'; raw: string }[];
  makeupPairs: { day: string; time: string }[];
  makeupDaysOnly: string[];
  weekTag: string | null;
  weekSource: string | null;
  feedbackLines: string[];
  selectionError: string | null;
}

export interface WeekContext {
  currentWeek: string | null;
  currentWeekMode: '周中' | '周末';
  weekDateMap: Map<string, { start: Date; end: Date }>;
  invalidWeekLabels: string[];
}

export const ALL_STAGES = ['L0', 'L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8', 'L9'] as const;
export type StageKey = typeof ALL_STAGES[number];

export interface StageSlot {
  stage: StageKey;
  dataset: MakeupDataset;
}

export interface MultiStageStore {
  stages: Partial<Record<StageKey, MakeupDataset>>;
  activeStage: StageKey;
}
