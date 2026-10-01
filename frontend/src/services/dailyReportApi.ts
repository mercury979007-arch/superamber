export interface DailyReportSessionStatus {
  loggedIn: boolean;
  username: string;
}

export interface WeekTask {
  id: string;
  name: string;
  resourceCount: number;
  addedAt?: string;
}

export interface AutoWeekTaskResult {
  weekTasks: WeekTask[];
  preferredSemester: string;
  defaultSelectedWeekIds: string[];
  defaultCheckinRange: {
    start?: string;
    end?: string;
  };
  source: 'snapshot' | 'live' | 'shared-refresh' | '';
  updatedAt: string;
}

interface UploadReportRequest {
  className: string;
  reportMode: 'standard' | 'detail' | 'senior';
  minCheckinDays: number;
  detailTestPassScore: string;
  studentFile: {
    name: string;
    content: string;
  };
  checkinFile: {
    name: string;
    content: string;
  };
}

interface AutoReportRequest {
  classId: string;
  className: string;
  reportMode: 'standard' | 'detail' | 'senior';
  minCheckinDays: number;
  detailTestPassScore: string;
  selectedWeekIds: string[];
  includeCheckin: boolean;
  checkinRangeStart: string;
  checkinRangeEnd: string;
}

async function readJsonOrNull(response: Response) {
  return response.json().catch(() => null);
}

function extractErrorMessage(data: unknown, fallback: string) {
  if (data && typeof data === 'object' && typeof (data as { error?: unknown }).error === 'string') {
    return (data as { error: string }).error;
  }
  return fallback;
}

function normalizeWeekTasks(data: unknown): WeekTask[] {
  const rawTasks = data && typeof data === 'object'
    ? (data as { weekTasks?: unknown }).weekTasks
    : null;
  if (!Array.isArray(rawTasks)) {
    return [];
  }

  return rawTasks.map((item) => {
    const value = item && typeof item === 'object' ? item as {
      id?: unknown;
      name?: unknown;
      resourceCount?: unknown;
      addedAt?: unknown;
    } : {};

    return {
      id: String(value.id || ''),
      name: String(value.name || ''),
      resourceCount: Number(value.resourceCount || 0),
      addedAt: String(value.addedAt || ''),
    };
  }).filter((item) => item.id);
}

function normalizeSelectedWeekIds(data: unknown): string[] {
  const rawIds = data && typeof data === 'object'
    ? (data as { defaultSelectedWeekIds?: unknown }).defaultSelectedWeekIds
    : null;
  if (!Array.isArray(rawIds)) {
    return [];
  }
  return rawIds.map((item) => String(item || '')).filter(Boolean);
}

function normalizeCheckinRange(data: unknown): AutoWeekTaskResult['defaultCheckinRange'] {
  const rawRange = data && typeof data === 'object'
    ? (data as { defaultCheckinRange?: unknown }).defaultCheckinRange
    : null;
  if (!rawRange || typeof rawRange !== 'object') {
    return {};
  }

  const value = rawRange as { start?: unknown; end?: unknown };
  return {
    start: typeof value.start === 'string' ? value.start : undefined,
    end: typeof value.end === 'string' ? value.end : undefined,
  };
}

export async function ensureDailyReportSession(fetchImpl: typeof fetch = fetch): Promise<DailyReportSessionStatus> {
  const response = await fetchImpl('/api/health', {
    credentials: 'include',
    cache: 'no-store',
  });
  const data = await readJsonOrNull(response);

  return {
    loggedIn: Boolean(response.ok && data && typeof data === 'object' && (data as { loggedIn?: unknown }).loggedIn),
    username: data && typeof data === 'object' && typeof (data as { username?: unknown }).username === 'string'
      ? (data as { username: string }).username
      : '',
  };
}

export async function fetchAutoWeekTasks(classId: string, fetchImpl: typeof fetch = fetch): Promise<AutoWeekTaskResult> {
  const response = await fetchImpl('/api/reports/auto-daily-report/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ classId }),
  });

  const data = await readJsonOrNull(response);
  if (!response.ok) {
    throw new Error(extractErrorMessage(data, '读取周挑战失败'));
  }

  return {
    weekTasks: normalizeWeekTasks(data),
    preferredSemester: data && typeof data === 'object' && typeof (data as { preferredSemester?: unknown }).preferredSemester === 'string'
      ? (data as { preferredSemester: string }).preferredSemester
      : '',
    defaultSelectedWeekIds: normalizeSelectedWeekIds(data),
    defaultCheckinRange: normalizeCheckinRange(data),
    source: data && typeof data === 'object' && typeof (data as { source?: unknown }).source === 'string'
      ? (data as { source: AutoWeekTaskResult['source'] }).source
      : '',
    updatedAt: data && typeof data === 'object' && typeof (data as { updatedAt?: unknown }).updatedAt === 'string'
      ? (data as { updatedAt: string }).updatedAt
      : '',
  };
}

export async function requestUploadDailyReport(payload: UploadReportRequest, fetchImpl: typeof fetch = fetch): Promise<Response> {
  const response = await fetchImpl('/api/reports/class-daily-report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const data = await readJsonOrNull(response);
    throw new Error(extractErrorMessage(data, '班级日报生成失败'));
  }

  return response;
}

export async function requestAutoDailyReport(payload: AutoReportRequest, fetchImpl: typeof fetch = fetch): Promise<Response> {
  const response = await fetchImpl('/api/reports/auto-daily-report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const data = await readJsonOrNull(response);
    throw new Error(extractErrorMessage(data, '自动日报生成失败'));
  }

  return response;
}
