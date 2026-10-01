export interface TestVersionInfo {
  environment: string;
  version: string;
  commit: string;
  deployedAt: string;
}

export interface TestVersionSyncState {
  enabled: boolean;
  currentVersion: string;
  latestVersion: string;
  stale: boolean;
  refreshing: boolean;
  autoReloadBlocked: boolean;
  versionInfo: TestVersionInfo | null;
  lastCheckedAt: number | null;
}

type VersionSyncReason =
  | 'boot'
  | 'interval'
  | 'visibility'
  | 'focus'
  | 'pageshow'
  | 'online'
  | 'manual'
  | 'storage';

declare global {
  interface Window {
    __AMBER_PAGE_BUILD__?: string;
  }
}

const LATEST_VERSION_KEY = '__amber_test_latest_version_v2';
const RELOAD_TARGET_KEY = '__amber_test_reload_target_v2';
const VERSION_SEARCH_PARAM = '__amberv';
const FORCE_REFRESH_SEARCH_PARAM = '__amberforce';
const FORCE_REFRESH_STORAGE_PREFIX = '__amber_test_forced_refresh_';
export const TERM_CELEBRATION_REFRESH_SESSION_KEY = '__amber_term_celebration_after_refresh';
const CHECK_INTERVAL_MS = 3 * 60 * 1000;
const ACTIVE_CHECK_DEBOUNCE_MS = 15 * 1000;
const RELOAD_DELAY_MS = 350;

const listeners = new Set<() => void>();

let initialized = false;
let inFlightCheck: Promise<void> | null = null;
let reloadTimerId: number | null = null;
let state: TestVersionSyncState = {
  enabled: false,
  currentVersion: '',
  latestVersion: '',
  stale: false,
  refreshing: false,
  autoReloadBlocked: false,
  versionInfo: null,
  lastCheckedAt: null,
};

function emitChange() {
  for (const listener of listeners) {
    listener();
  }
}

export function isTestVersionSyncEnabled(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  const host = window.location.hostname;
  return host === '127.0.0.1' || host === 'localhost' || host.includes('superamber-test');
}

function getCurrentPageBuildVersion(): string {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return '';
  }

  const bootVersion = String(window.__AMBER_PAGE_BUILD__ || '').trim();
  if (bootVersion) {
    return bootVersion;
  }

  const moduleScript = document.querySelector<HTMLScriptElement>('script[type="module"][src]');
  const src = moduleScript?.getAttribute('src') || '';
  const buildMatch = src.match(/(?:index|main)-([^.]+)\.js(?:$|\?)/);
  if (buildMatch?.[1]) {
    return buildMatch[1];
  }
  if (/\/src\/main\.tsx(?:$|\?)/.test(src)) {
    return 'dev';
  }
  return '';
}

function parseVersionInfo(raw: unknown): TestVersionInfo | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const data = raw as Partial<TestVersionInfo>;
  const version = String(data.version || '').trim();
  if (!version) {
    return null;
  }
  return {
    environment: String(data.environment || '').trim(),
    version,
    commit: String(data.commit || '').trim(),
    deployedAt: String(data.deployedAt || '').trim(),
  };
}

function readBroadcastVersionInfo(): TestVersionInfo | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return parseVersionInfo(JSON.parse(window.localStorage.getItem(LATEST_VERSION_KEY) || 'null'));
  } catch {
    return null;
  }
}

function writeBroadcastVersionInfo(info: TestVersionInfo) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(LATEST_VERSION_KEY, JSON.stringify(info));
  } catch {
    // Ignore localStorage write failures and keep single-tab behavior.
  }
}

function shouldAttemptAutoReload(reason: VersionSyncReason): boolean {
  // Returning from a screenshot, download, or another mobile app emits focus
  // and visibility events. Those checks should show the update prompt without
  // replacing the teacher's current report. Only initial boot may auto-reload.
  return reason === 'boot';
}

function buildLatestNavigationUrl(targetVersion: string): string {
  const url = new URL(window.location.href);
  url.searchParams.set(VERSION_SEARCH_PARAM, targetVersion);
  return url.toString();
}

async function clearBrowserAssetCaches(): Promise<void> {
  try {
    if ('caches' in window) {
      const keys = await window.caches.keys();
      await Promise.all(keys.map((key) => window.caches.delete(key)));
    }
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
    }
  } catch {
    // Cache cleanup is best-effort; the cache-busting navigation still runs.
  }
}

function requestTermCelebrationAfterRefresh(): void {
  try {
    window.sessionStorage.setItem(TERM_CELEBRATION_REFRESH_SESSION_KEY, '1');
  } catch {
    // The refresh remains useful even if storage is unavailable.
  }
}

export function consumeTermCelebrationAfterRefresh(): boolean {
  try {
    const requested = window.sessionStorage.getItem(TERM_CELEBRATION_REFRESH_SESSION_KEY) === '1';
    if (requested) {
      window.sessionStorage.removeItem(TERM_CELEBRATION_REFRESH_SESSION_KEY);
    }
    return requested;
  } catch {
    return false;
  }
}

export async function runOneTimeTestForceRefresh(refreshId: string): Promise<boolean> {
  if (!isTestVersionSyncEnabled() || !refreshId) return false;

  const storageKey = `${FORCE_REFRESH_STORAGE_PREFIX}${refreshId}`;
  const url = new URL(window.location.href);
  const arrivedFromRefresh = url.searchParams.get(FORCE_REFRESH_SEARCH_PARAM) === refreshId;
  let alreadyRefreshed = arrivedFromRefresh;
  try {
    alreadyRefreshed = alreadyRefreshed || window.localStorage.getItem(storageKey) === 'done';
  } catch {
    // The URL marker still prevents a reload loop when local storage is unavailable.
  }

  if (alreadyRefreshed) {
    if (url.searchParams.has(FORCE_REFRESH_SEARCH_PARAM)) {
      url.searchParams.delete(FORCE_REFRESH_SEARCH_PARAM);
      url.searchParams.delete(VERSION_SEARCH_PARAM);
      window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    }
    return false;
  }

  try {
    window.localStorage.setItem(storageKey, 'done');
  } catch {
    // Continue with the URL marker as the loop guard.
  }
  requestTermCelebrationAfterRefresh();
  await clearBrowserAssetCaches();
  url.searchParams.set(FORCE_REFRESH_SEARCH_PARAM, refreshId);
  url.searchParams.set(VERSION_SEARCH_PARAM, Date.now().toString(36));
  window.location.replace(url.toString());
  return true;
}

export async function forceReloadTestSite(): Promise<void> {
  if (!isTestVersionSyncEnabled()) return;
  requestTermCelebrationAfterRefresh();
  await clearBrowserAssetCaches();
  const url = new URL(window.location.href);
  url.searchParams.set(FORCE_REFRESH_SEARCH_PARAM, `manual-${Date.now().toString(36)}`);
  url.searchParams.set(VERSION_SEARCH_PARAM, Date.now().toString(36));
  window.location.replace(url.toString());
}

function attemptAutoReload(targetVersion: string) {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }
  if (!state.stale || state.refreshing || document.hidden) {
    return;
  }

  const attemptedTarget = String(window.sessionStorage.getItem(RELOAD_TARGET_KEY) || '');
  if (attemptedTarget === targetVersion) {
    state = {
      ...state,
      refreshing: false,
      autoReloadBlocked: true,
    };
    emitChange();
    return;
  }

  state = {
    ...state,
    refreshing: true,
    autoReloadBlocked: false,
  };
  window.sessionStorage.setItem(RELOAD_TARGET_KEY, targetVersion);
  emitChange();

  if (reloadTimerId) {
    window.clearTimeout(reloadTimerId);
  }
  reloadTimerId = window.setTimeout(() => {
    window.location.replace(buildLatestNavigationUrl(targetVersion));
  }, RELOAD_DELAY_MS);
}

function syncStateFromVersionInfo(info: TestVersionInfo, reason: VersionSyncReason) {
  const currentVersion = state.currentVersion || getCurrentPageBuildVersion();
  const stale = Boolean(currentVersion && info.version && currentVersion !== info.version);
  const attemptedTarget = typeof window === 'undefined'
    ? ''
    : String(window.sessionStorage.getItem(RELOAD_TARGET_KEY) || '');

  state = {
    ...state,
    currentVersion,
    latestVersion: info.version,
    stale,
    refreshing: stale ? state.refreshing : false,
    autoReloadBlocked: stale && attemptedTarget === info.version,
    versionInfo: info,
    lastCheckedAt: Date.now(),
  };
  emitChange();

  if (!stale) {
    if (typeof window !== 'undefined') {
      window.sessionStorage.removeItem(RELOAD_TARGET_KEY);
      const url = new URL(window.location.href);
      if (url.searchParams.get(VERSION_SEARCH_PARAM) === info.version) {
        url.searchParams.delete(VERSION_SEARCH_PARAM);
        window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
      }
    }
    if (reloadTimerId) {
      window.clearTimeout(reloadTimerId);
      reloadTimerId = null;
    }
    return;
  }

  if (shouldAttemptAutoReload(reason)) {
    attemptAutoReload(info.version);
  }
}

export async function checkTestVersion(reason: VersionSyncReason = 'manual'): Promise<TestVersionSyncState> {
  if (!state.enabled) {
    return state;
  }
  if (inFlightCheck) {
    await inFlightCheck;
    return state;
  }

  inFlightCheck = (async () => {
    try {
      const resp = await fetch('/api/version', { cache: 'no-store', credentials: 'include' });
      if (!resp.ok) {
        return;
      }

      const info = parseVersionInfo(await resp.json());
      if (!info) {
        return;
      }

      writeBroadcastVersionInfo(info);
      syncStateFromVersionInfo(info, reason);
    } catch {
      // Keep last known version state on transient errors.
    } finally {
      inFlightCheck = null;
    }
  })();

  await inFlightCheck;
  return state;
}

function checkWhenNeeded(reason: 'visibility' | 'focus' | 'pageshow') {
  const now = Date.now();
  if (state.lastCheckedAt && now - state.lastCheckedAt < ACTIVE_CHECK_DEBOUNCE_MS) {
    return;
  }
  void checkTestVersion(reason);
}

export function initTestVersionSync(): void {
  if (initialized || typeof window === 'undefined') {
    return;
  }
  initialized = true;

  state = {
    ...state,
    enabled: isTestVersionSyncEnabled(),
    currentVersion: getCurrentPageBuildVersion(),
  };

  if (!state.enabled) {
    emitChange();
    return;
  }

  const broadcastInfo = readBroadcastVersionInfo();
  if (broadcastInfo) {
    syncStateFromVersionInfo(broadcastInfo, 'storage');
  } else {
    emitChange();
  }

  void checkTestVersion('boot');
  window.setInterval(() => {
    void checkTestVersion('interval');
  }, CHECK_INTERVAL_MS);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      checkWhenNeeded('visibility');
    }
  });
  window.addEventListener('focus', () => {
    checkWhenNeeded('focus');
  });
  window.addEventListener('pageshow', () => {
    checkWhenNeeded('pageshow');
  });
  window.addEventListener('online', () => {
    void checkTestVersion('online');
  });
  window.addEventListener('storage', (event) => {
    if (event.key !== LATEST_VERSION_KEY || !event.newValue) {
      return;
    }
    try {
      const info = parseVersionInfo(JSON.parse(event.newValue));
      if (!info) {
        return;
      }
      syncStateFromVersionInfo(info, 'storage');
    } catch {
      // Ignore malformed storage payloads from older code.
    }
  });
}

export function getTestVersionSyncState(): TestVersionSyncState {
  return state;
}

export function subscribeTestVersionSync(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function reloadToLatestVersion(): void {
  if (!state.enabled || !state.latestVersion) {
    return;
  }
  // A previous automatic navigation may have reached an old edge response.
  // Manual retry must clear that loop guard, otherwise the button reports a
  // retry while attemptAutoReload immediately blocks the same target again.
  try {
    window.sessionStorage.removeItem(RELOAD_TARGET_KEY);
  } catch {
    // The cache-busting navigation can still proceed without sessionStorage.
  }
  state = {
    ...state,
    refreshing: false,
    autoReloadBlocked: false,
  };
  syncStateFromVersionInfo(state.versionInfo || {
    environment: '',
    version: state.latestVersion,
    commit: '',
    deployedAt: '',
  }, 'manual');
  attemptAutoReload(state.latestVersion);
}
