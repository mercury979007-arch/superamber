import type { BackupPayload } from '../seating/backupData';

const SEATING_BACKUP_ENDPOINT = '/api/seating/backup';
const STARTUP_BACKUP_TIMEOUT_MS = 1600;

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isBackupPayload(value: unknown): value is BackupPayload {
  return isObject(value)
    && isObject(value.app)
    && isObject(value.classData)
    && Object.keys(value.classData).length > 0
    && isObject(value.userProfile);
}

async function parseJsonResponse(response: Response): Promise<Record<string, unknown>> {
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(String(isObject(payload) ? payload.error || '请求失败' : '请求失败'));
  }
  if (!contentType.includes('application/json') || !isObject(payload)) {
    throw new Error('座位表备份接口返回格式无效');
  }
  return payload;
}

export async function fetchSeatingBackup(): Promise<BackupPayload | null> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), STARTUP_BACKUP_TIMEOUT_MS);
  try {
    const response = await fetch(SEATING_BACKUP_ENDPOINT, {
      cache: 'no-store',
      credentials: 'same-origin',
      signal: controller.signal,
    });
    const payload = await parseJsonResponse(response);
    return isBackupPayload(payload.backup) ? payload.backup : null;
  } finally {
    window.clearTimeout(timer);
  }
}

export async function saveSeatingBackup(
  backup: BackupPayload,
  options: { allowDateRegression?: boolean } = {},
): Promise<boolean> {
  const response = await fetch(SEATING_BACKUP_ENDPOINT, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      backup,
      allowDateRegression: options.allowDateRegression === true,
    }),
  });
  await parseJsonResponse(response);
  return true;
}
