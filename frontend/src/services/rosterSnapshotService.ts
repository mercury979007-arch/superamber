import { savePreciseStudentList } from '../utils/classProfiles';

export type RosterSnapshotStudent = {
  no: string;
  chName: string;
  enName: string;
};

export type RosterSnapshotClass = {
  classId: string;
  squadId: string;
  students: RosterSnapshotStudent[];
  updatedAt: string;
};

export type RosterSnapshotWeekTask = {
  id: string;
  name: string;
  resourceCount: number;
  addedAt?: string;
  startAt?: string;
  endAt?: string;
  status?: number | string | null;
  statusText?: string;
  lifecycle?: 'upcoming' | 'active' | 'ended' | 'unknown';
  studentVisible?: boolean;
  skuId?: string;
  collectionName?: string;
  declaredTerm?: string;
  weekNumber?: number | null;
};

export type RosterSnapshot = {
  context?: {
    dataDate?: string;
    academicWeek?: number;
    week1Start?: string;
    timezone?: string;
  };
  classes: Array<{ id: string; name: string; squadId?: string }>;
  rosters: RosterSnapshotClass[];
  failures: Array<{ classId: string; error: string }>;
  dailyReportTasks?: Array<{
    classId: string;
    preferredSemester?: string;
    weekTasks: RosterSnapshotWeekTask[];
    defaultSelectedWeekIds?: string[];
    defaultCheckinRange?: { start?: string; end?: string };
    updatedAt: string;
  }>;
  taskFailures?: Array<{ classId: string; error: string }>;
  speakingChallenges?: Array<{
    classId: string;
    challengeId: string;
    rangeStart: string;
    rangeEnd: string;
    studentCount: number;
    updatedAt: string;
  }>;
  speakingFailures?: Array<{ classId: string; error: string }>;
  updatedAt: string;
  lastCompleteAt?: string | null;
  totalStudents: number;
};

export type RosterSnapshotResponse = {
  status: 'success' | 'partial';
  snapshot: RosterSnapshot | null;
  state?: 'empty' | 'fresh' | 'stale' | 'partial';
  stale?: boolean;
  deduplicated?: boolean;
  skipped?: boolean;
  error?: string;
};

export type PreparedDailyReportState = {
  state: 'unknown' | 'ready-data' | 'ready-empty' | 'failed';
  taskCount: number;
  updatedAt: string;
  error: string;
};

export type RosterSnapshotSummary = {
  checkedTaskClassCount: number;
  taskDataClassCount: number;
  taskEmptyClassCount: number;
  taskFailureClassCount: number;
  speakingClassCount: number;
  speakingFailureClassCount: number;
};

export class RosterSnapshotApiError extends Error {
  status: number;
  snapshot: RosterSnapshot | null;

  constructor(message: string, status: number, snapshot: RosterSnapshot | null = null) {
    super(message);
    this.name = 'RosterSnapshotApiError';
    this.status = status;
    this.snapshot = snapshot;
  }
}

async function readResponse(response: Response): Promise<RosterSnapshotResponse> {
  const data = await response.json().catch(() => ({} as RosterSnapshotResponse));
  if (!response.ok) {
    throw new RosterSnapshotApiError(data.error || '数据同步失败', response.status, data.snapshot || null);
  }
  return data;
}

export async function getRosterSnapshot(): Promise<RosterSnapshotResponse> {
  const response = await fetch('/api/data/roster-snapshot', {
    method: 'GET',
    credentials: 'include',
    cache: 'no-store',
  });
  return readResponse(response);
}

export async function refreshRosterSnapshot(reason: 'homepage' | 'manual' = 'manual'): Promise<RosterSnapshotResponse> {
  const response = await fetch('/api/data/roster-snapshot/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ reason }),
  });
  return readResponse(response);
}

export function applyRosterSnapshot(snapshot: RosterSnapshot | null): { classCount: number; studentCount: number } {
  if (!snapshot) return { classCount: 0, studentCount: 0 };
  let classCount = 0;
  let studentCount = 0;
  for (const roster of snapshot.rosters || []) {
    if (!roster.classId || !Array.isArray(roster.students)) continue;
    savePreciseStudentList(roster.classId, roster.students.map((student) => ({
      studentId: student.no || '',
      chineseName: student.chName || '',
      englishName: student.enName || '',
    })));
    classCount += 1;
    studentCount += roster.students.length;
  }
  return { classCount, studentCount };
}

export function summarizeRosterSnapshot(snapshot: RosterSnapshot | null): RosterSnapshotSummary {
  const taskSnapshots = snapshot?.dailyReportTasks || [];
  return {
    checkedTaskClassCount: taskSnapshots.length,
    taskDataClassCount: taskSnapshots.filter((item) => (item.weekTasks || []).length > 0).length,
    taskEmptyClassCount: taskSnapshots.filter((item) => (item.weekTasks || []).length === 0).length,
    taskFailureClassCount: snapshot?.taskFailures?.length || 0,
    speakingClassCount: snapshot?.speakingChallenges?.length || 0,
    speakingFailureClassCount: snapshot?.speakingFailures?.length || 0,
  };
}

export function getPreparedDailyReportStates(
  snapshot: RosterSnapshot | null,
  classes: Array<{ id: string; name: string }>,
): Record<string, PreparedDailyReportState> {
  const taskByClass = new Map((snapshot?.dailyReportTasks || []).map((item) => [
    String(item.classId || '').trim().toUpperCase(),
    item,
  ]));
  const failureByClass = new Map((snapshot?.taskFailures || []).map((item) => [
    String(item.classId || '').trim().toUpperCase(),
    String(item.error || '').trim(),
  ]));

  return Object.fromEntries(classes.map((classInfo) => {
    const classId = String(classInfo.name || classInfo.id || '').trim().toUpperCase();
    const taskSnapshot = taskByClass.get(classId);
    const error = failureByClass.get(classId) || '';
    if (taskSnapshot) {
      const taskCount = (taskSnapshot.weekTasks || []).length;
      return [classId, {
        state: taskCount > 0 ? 'ready-data' : 'ready-empty',
        taskCount,
        updatedAt: taskSnapshot.updatedAt || snapshot?.updatedAt || '',
        error,
      } satisfies PreparedDailyReportState];
    }
    return [classId, {
      state: error ? 'failed' : 'unknown',
      taskCount: 0,
      updatedAt: snapshot?.updatedAt || '',
      error,
    } satisfies PreparedDailyReportState];
  }).filter(([classId]) => Boolean(classId)));
}

function formatSnapshotTime(raw: string): string {
  if (!raw) return '';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatRosterSnapshotTime(snapshot: RosterSnapshot | null): string {
  return formatSnapshotTime(snapshot?.lastCompleteAt || snapshot?.updatedAt || '');
}

export function formatRosterSnapshotGeneratedTime(snapshot: RosterSnapshot | null): string {
  return formatSnapshotTime(snapshot?.updatedAt || '');
}
