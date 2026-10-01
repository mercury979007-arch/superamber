import academicCalendar from '../../../config/academic-calendar.json';
import type { RosterSnapshotWeekTask } from './rosterSnapshotService';

export type ClassControlTaskSummary = {
  available: boolean;
  completionRate: number | null;
  fullyCompletedCount: number;
  totalStudents: number;
  requiredTaskCount: number;
  optionalTaskCount: number;
  incompleteStudents: string[];
  averageAccuracy: number | null;
  accuracyStudentCount: number;
  completionDistribution: ClassControlDistribution;
  accuracyDistribution: ClassControlDistribution;
  taskBreakdown: ClassControlTaskBreakdown[];
  studentProfiles: ClassControlStudentProfile[];
};

export type ClassControlDistribution = {
  excellent: number;
  good: number;
  watch: number;
  critical: number;
  noData: number;
  total: number;
};

export type ClassControlTaskBreakdown = {
  id: string;
  title: string;
  completionRate: number | null;
  completedCount: number;
  totalStudents: number;
  incompleteStudents: string[];
  averageAccuracy: number | null;
  accuracyStudentCount: number;
};

export type ClassControlStudentProfile = {
  name: string;
  completionRate: number | null;
  completedTaskCount: number;
  requiredTaskCount: number;
  incompleteTaskCount: number;
  incompleteTasks: string[];
  averageAccuracy: number | null;
  accuracyTaskCount: number;
};

export type ClassControlSpeakingSummary = {
  available: boolean;
  averageDays: number | null;
  zeroStudents: string[];
  supplementCount: number;
  totalStudents: number;
  studentProfiles?: Array<{
    name: string;
    days: number;
    supplementCount: number;
  }>;
};

export type ClassControlAttendanceSummary = {
  available: boolean;
  studentProfiles: Array<{
    name: string;
    absenceCount: number;
    lateCount: number;
    attendanceRate: number | null;
  }>;
};

export type ClassControlCycle = {
  role: 'review' | 'current' | 'trend';
  weekNumber: number | null;
  weekLabel: string;
  weekIds: string[];
  rangeStart: string;
  rangeEnd: string;
  openedAt: string;
  openedHours: number;
  historical: boolean;
  task: ClassControlTaskSummary | null;
  taskError?: string;
  speaking: ClassControlSpeakingSummary | null;
  taskRetained?: boolean;
  speakingRetained?: boolean;
};

export type ClassControlSummary = {
  classId: string;
  preferredSemester: string;
  historical: boolean;
  taskState?: 'ready' | 'empty';
  taskCount?: number;
  review: ClassControlCycle | null;
  current: ClassControlCycle | null;
  trend?: ClassControlCycle[];
  trendPlanKeys?: string[];
  trendExpectedCount?: number;
  trendComplete?: boolean;
  trendUpdatedAt?: string;
  speakingError?: string;
  attendance?: ClassControlAttendanceSummary | null;
  attendanceError?: string;
  updatedAt: string;
};

export type ClassTaskReport = {
  classId: string;
  preferredSemester: string;
  selectedWeekIds: string[];
  selectedTasks: RosterSnapshotWeekTask[];
  selectionFingerprint: string;
  task: ClassControlTaskSummary;
  detail: DailyReportDetail;
  speakingAvailable: boolean;
  speakingError?: string;
  source?: 'snapshot' | 'live' | 'snapshot-fallback';
  dataUpdatedAt?: string;
  refreshError?: string;
  snapshotUpdatedAt: string;
  updatedAt: string;
};

export type DailyReportMode = 'standard' | 'detail' | 'senior';

export type DailyReportCell = {
  taskId: string;
  label: string;
  type: string;
  optional: boolean;
  complete: boolean;
  king: boolean;
  metrics: Record<string, string | number | null>;
  quality: { kind: 'test' | 'audio' | 'word' | 'none'; value: number | null; total: number | null };
  level: number;
  display: string;
};

export type DailyReportStudent = {
  studentId: string;
  chineseName: string;
  englishName: string;
  speaking: {
    days: number;
    supplementCount: number;
    daily: Array<{ date: string; status: 'normal' | 'supplement' | 'missed' }>;
  };
  incompleteCount: number;
  issueLevel: number;
  cells: DailyReportCell[];
  diagnosis: string;
  tier: 'A' | 'B' | 'C' | 'D';
  rewardResources: Array<{
    resourceName: string;
    resourceType: string;
    columns: Record<string, string | number | null>;
  }>;
};

export type DailyReportDetail = {
  options: {
    mode: DailyReportMode;
    includeSpeaking: boolean;
    minSpeakingDays: number;
    testPassScore: number | null;
    aiVoicePassRate: number;
    speakingRangeStart: string;
    speakingRangeEnd: string;
  };
  tasks: Array<{ id: string; title: string; label: string; type: string; optional: boolean }>;
  students: DailyReportStudent[];
  qualityTiers: Record<'A' | 'B' | 'C' | 'D', string[]>;
  problemStudents: Array<{ studentId: string; chineseName: string; englishName: string; diagnosis: string }>;
};

export type DailyReportRewardPolicy = {
  version: 1;
  report: {
    mode: DailyReportMode;
    includeSpeaking: boolean;
    minSpeakingDays: number;
    testPassScore: number | null;
    aiVoicePassRate: number;
  };
  sources: { basic: boolean; speaking: boolean };
  basic: {
    schemeId: 'scheme1' | 'scheme2' | 'custom';
    allDoneAmount: number;
    customName: string;
    customRules: Array<{ templateId: string; enabled: boolean; amount: number; threshold: number }>;
  };
  speaking: {
    basePerDay: number;
    streakThreshold: number;
    streakMultiplier: number;
    rewardMode: 'fixed' | 'multiplier';
    thresholdBonus: number;
    ignoreSupplementVariance: boolean;
  };
};

export type DailyReportRewardPolicyResult = {
  policy: DailyReportRewardPolicy;
  scope: 'system' | 'teacher' | 'class';
  updatedAt: string;
};

export type ClassTaskCatalog = {
  classId: string;
  preferredSemester: string;
  weekTasks: RosterSnapshotWeekTask[];
  defaultSelectedWeekIds: string[];
  defaultCheckinRange: { start?: string; end?: string };
  updatedAt: string;
};

export type ClassControlTrendBatch = {
  classId: string;
  preferredSemester: string;
  historical: boolean;
  trend: ClassControlCycle[];
  trendPlanKeys: string[];
  trendExpectedCount: number;
  trendRemainingCount: number;
  trendComplete: boolean;
  updatedAt: string;
};

type ClassControlResponse = {
  status: 'success';
  summary: ClassControlSummary;
  deduplicated?: boolean;
};

type ClassControlTrendResponse = {
  status: 'success';
  batch: ClassControlTrendBatch;
  deduplicated?: boolean;
};

type ClassControlAttendanceResponse = {
  status: 'success';
  result: {
    classId: string;
    attendance: ClassControlAttendanceSummary | null;
    attendanceError: string;
  };
  deduplicated?: boolean;
};

type ClassTaskReportResponse = {
  status: 'success';
  report: ClassTaskReport;
  deduplicated?: boolean;
};

type StoredCache = {
  version: 6;
  termId: string;
  teacherKey: string;
  summaries: Record<string, ClassControlSummary>;
};

const CURRENT_TERM_ID = String(academicCalendar.currentTerm.id || 'current');
const CACHE_PREFIX = 'superamber_class_control_v6';

export class ClassControlApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ClassControlApiError';
    this.status = status;
  }
}

function teacherKey(teacherName: string): string {
  return String(teacherName || 'teacher').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_') || 'teacher';
}

function cacheKey(teacherName: string): string {
  return `${CACHE_PREFIX}:${teacherKey(teacherName)}`;
}

export async function refreshClassControlSummary(
  classId: string,
  { includeTrend = false }: { includeTrend?: boolean } = {},
): Promise<ClassControlSummary> {
  const response = await fetch('/api/data/class-control/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    cache: 'no-store',
    body: JSON.stringify({ classId, includeTrend }),
  });
  const data = await response.json().catch(() => ({} as Partial<ClassControlResponse> & { error?: string }));
  if (!response.ok || !data.summary) {
    throw new ClassControlApiError(
      response.status === 401 ? '未登录，请先登录' : data.error || '班级监控数据读取失败',
      response.status,
    );
  }
  return data.summary;
}

export async function fetchClassTaskReport(
  classId: string,
  selectedWeekIds: string[],
  options?: {
    mode: DailyReportMode;
    includeSpeaking: boolean;
    minSpeakingDays: number;
    testPassScore: number | null;
    aiVoicePassRate: number;
    speakingRangeStart?: string;
    speakingRangeEnd?: string;
  },
  forceRefresh = false,
): Promise<ClassTaskReport> {
  const response = await fetch('/api/data/class-control/task-report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    cache: 'no-store',
    body: JSON.stringify({ classId, selectedWeekIds, options, refresh: forceRefresh }),
  });
  const data = await response.json().catch(() => ({} as Partial<ClassTaskReportResponse> & { error?: string }));
  if (!response.ok || !data.report) {
    throw new ClassControlApiError(
      response.status === 401 ? '未登录，请先登录' : data.error || '班级日报数据读取失败',
      response.status,
    );
  }
  return data.report;
}

export async function fetchClassTaskCatalog(classId: string): Promise<ClassTaskCatalog> {
  const response = await fetch('/api/data/class-control/task-catalog', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    cache: 'no-store',
    body: JSON.stringify({ classId }),
  });
  const data = await response.json().catch(() => ({} as { error?: string; catalog?: ClassTaskCatalog }));
  if (!response.ok || !data.catalog) {
    throw new ClassControlApiError(
      response.status === 401 ? '未登录，请先登录' : data.error || '挑战目录读取失败',
      response.status,
    );
  }
  return data.catalog as ClassTaskCatalog;
}

export async function fetchDailyReportRewardPolicy(classId: string): Promise<DailyReportRewardPolicyResult> {
  const response = await fetch(`/api/data/class-control/reward-policy?classId=${encodeURIComponent(classId)}`, {
    credentials: 'include',
    cache: 'no-store',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.policy) {
    throw new ClassControlApiError(response.status === 401 ? '未登录，请先登录' : data.error || '奖励规则读取失败', response.status);
  }
  return data as DailyReportRewardPolicyResult;
}

export async function saveDailyReportRewardPolicy(
  classId: string,
  scope: 'teacher' | 'class',
  policy: DailyReportRewardPolicy,
): Promise<DailyReportRewardPolicyResult> {
  const response = await fetch('/api/data/class-control/reward-policy', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ classId, scope, policy }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.policy) {
    throw new ClassControlApiError(response.status === 401 ? '未登录，请先登录' : data.error || '奖励规则保存失败', response.status);
  }
  return data as DailyReportRewardPolicyResult;
}

export async function clearClassDailyReportRewardPolicy(classId: string): Promise<DailyReportRewardPolicyResult> {
  const response = await fetch(`/api/data/class-control/reward-policy?classId=${encodeURIComponent(classId)}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.policy) {
    throw new ClassControlApiError(response.status === 401 ? '未登录，请先登录' : data.error || '恢复默认规则失败', response.status);
  }
  return data as DailyReportRewardPolicyResult;
}

export function classControlCycleKey(cycle: Pick<ClassControlCycle, 'rangeStart' | 'rangeEnd' | 'weekIds'>): string {
  return `${cycle.rangeStart}|${cycle.rangeEnd}|${cycle.weekIds.map(String).join(',')}`;
}

export async function fetchClassControlTrendBatch(
  classId: string,
  knownCycleKeys: string[],
): Promise<ClassControlTrendBatch> {
  const response = await fetch('/api/data/class-control/trend', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    cache: 'no-store',
    body: JSON.stringify({ classId, knownCycleKeys }),
  });
  const data = await response.json().catch(() => ({} as Partial<ClassControlTrendResponse> & { error?: string }));
  if (!response.ok || !data.batch) {
    throw new ClassControlApiError(
      response.status === 401 ? '未登录，请先登录' : data.error || '四周趋势读取失败',
      response.status,
    );
  }
  return data.batch;
}

export async function fetchClassControlAttendance(classId: string): Promise<{
  attendance: ClassControlAttendanceSummary | null;
  attendanceError: string;
}> {
  const response = await fetch('/api/data/class-control/attendance', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    cache: 'no-store',
    body: JSON.stringify({ classId }),
  });
  const data = await response.json().catch(() => ({} as Partial<ClassControlAttendanceResponse> & { error?: string }));
  if (!response.ok || !data.result) {
    throw new ClassControlApiError(
      response.status === 401 ? '未登录，请先登录' : data.error || '考勤数据读取失败',
      response.status,
    );
  }
  return {
    attendance: data.result.attendance,
    attendanceError: data.result.attendanceError || '',
  };
}

export function loadClassControlCache(teacherName: string): Record<string, ClassControlSummary> {
  try {
    const raw = localStorage.getItem(cacheKey(teacherName));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as StoredCache;
    if (parsed?.version !== 6
      || parsed.termId !== CURRENT_TERM_ID
      || parsed.teacherKey !== teacherKey(teacherName)
      || !parsed.summaries) return {};
    return parsed.summaries;
  } catch {
    return {};
  }
}

export function saveClassControlCache(
  teacherName: string,
  summaries: Record<string, ClassControlSummary>,
): void {
  try {
    const allowed = Object.fromEntries(Object.entries(summaries).map(([classId, summary]) => [
      String(classId || '').trim().toUpperCase(),
      summary,
    ]));
    const payload: StoredCache = {
      version: 6,
      termId: CURRENT_TERM_ID,
      teacherKey: teacherKey(teacherName),
      summaries: allowed,
    };
    localStorage.setItem(cacheKey(teacherName), JSON.stringify(payload));
  } catch {
    // Browser storage is an acceleration layer only. Live refresh still works.
  }
}

function sameCycle(left: ClassControlCycle | null, right: ClassControlCycle | null): boolean {
  if (!left || !right) return false;
  return left.role === right.role
    && left.weekLabel === right.weekLabel
    && left.weekIds.join('|') === right.weekIds.join('|');
}

function mergeCycle(
  previous: ClassControlCycle | null,
  incoming: ClassControlCycle | null,
): ClassControlCycle | null {
  if (!incoming || !sameCycle(previous, incoming)) return incoming;
  const keepTask = !incoming.task && Boolean(previous?.task?.available);
  const keepSpeaking = !incoming.speaking && Boolean(previous?.speaking?.available);
  return {
    ...incoming,
    task: keepTask ? previous?.task || null : incoming.task,
    speaking: keepSpeaking ? previous?.speaking || null : incoming.speaking,
    taskRetained: keepTask,
    speakingRetained: keepSpeaking,
  };
}

export function mergeClassControlSummary(
  previous: ClassControlSummary | undefined,
  incoming: ClassControlSummary,
): ClassControlSummary {
  if (!previous || previous.classId !== incoming.classId) return incoming;
  return {
    ...incoming,
    review: mergeCycle(previous.review, incoming.review),
    current: mergeCycle(previous.current, incoming.current),
    trend: incoming.trend === undefined ? previous.trend : incoming.trend,
    trendPlanKeys: incoming.trendPlanKeys === undefined ? previous.trendPlanKeys : incoming.trendPlanKeys,
    trendExpectedCount: incoming.trendExpectedCount === undefined ? previous.trendExpectedCount : incoming.trendExpectedCount,
    trendComplete: incoming.trendComplete === undefined ? previous.trendComplete : incoming.trendComplete,
    trendUpdatedAt: incoming.trendUpdatedAt === undefined ? previous.trendUpdatedAt : incoming.trendUpdatedAt,
    attendance: incoming.attendance === undefined ? previous.attendance : incoming.attendance,
    attendanceError: incoming.attendanceError === undefined ? previous.attendanceError : incoming.attendanceError,
  };
}

export function formatClassControlTime(raw: string): string {
  const date = new Date(raw);
  if (!raw || Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
