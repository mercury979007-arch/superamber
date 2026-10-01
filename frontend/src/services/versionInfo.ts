export interface VersionInfo {
  environment: string;
  version: string;
  commit: string;
  deployedAt: string;
  fingerprint: string;
}

export const VERSION_STORAGE_KEY = '__amber_version_info';
export const VERSION_FINGERPRINT_KEY = '__amber_version_fingerprint';

function clean(value: unknown): string {
  return String(value || '').trim();
}

export function buildVersionFingerprint(input: Partial<VersionInfo>): string {
  return [
    clean(input.environment) || 'unknown',
    clean(input.version) || 'unknown',
    clean(input.commit) || 'unknown',
    clean(input.deployedAt) || 'unknown',
  ].join(':');
}

export function normalizeVersionInfo(input: unknown): VersionInfo | null {
  if (!input || typeof input !== 'object') {
    return null;
  }

  const raw = input as Partial<VersionInfo>;
  const environment = clean(raw.environment);
  const version = clean(raw.version);
  const commit = clean(raw.commit);
  const deployedAt = clean(raw.deployedAt);
  const fingerprint = clean(raw.fingerprint) || buildVersionFingerprint({ environment, version, commit, deployedAt });

  if (!environment && !version && !commit && !deployedAt) {
    return null;
  }

  return {
    environment,
    version,
    commit,
    deployedAt,
    fingerprint,
  };
}

export function persistVersionInfo(info: VersionInfo): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(VERSION_STORAGE_KEY, JSON.stringify(info));
    window.localStorage.setItem(VERSION_FINGERPRINT_KEY, info.fingerprint);
  } catch {
    // Ignore storage failures and keep runtime state only.
  }
}

export function readPersistedVersionInfo(): VersionInfo | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const stored = window.localStorage.getItem(VERSION_STORAGE_KEY);
    if (!stored) {
      return null;
    }
    return normalizeVersionInfo(JSON.parse(stored));
  } catch {
    return null;
  }
}

export async function fetchVersionInfo(): Promise<VersionInfo | null> {
  const resp = await fetch('/api/version', { cache: 'no-store' });
  if (!resp.ok) {
    return null;
  }

  const data = await resp.json();
  return normalizeVersionInfo(data);
}

export function shouldShowVersionVisibility(info: VersionInfo | null): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  const host = window.location.hostname;
  if (host === '127.0.0.1' || host === 'localhost' || host.includes('superamber-test')) {
    return true;
  }

  return info?.environment === 'test' || info?.environment === 'staging';
}
