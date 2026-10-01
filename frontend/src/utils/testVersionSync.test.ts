import { afterEach, expect, it, vi } from 'vitest';
import { checkTestVersion, getTestVersionSyncState, initTestVersionSync, reloadToLatestVersion } from './testVersionSync';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); localStorage.clear(); sessionStorage.clear(); });

it('preserves the current report on screenshot/app-return checks and reloads only when requested', async () => {
  vi.useFakeTimers();
  window.__AMBER_PAGE_BUILD__ = 'original';
  let version = 'original';
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ version, environment: 'test' }) })));
  initTestVersionSync();
  await checkTestVersion('boot');
  version = 'new-build';
  for (const reason of ['focus', 'visibility', 'pageshow', 'interval', 'online'] as const) {
    await checkTestVersion(reason);
    expect(getTestVersionSyncState()).toMatchObject({ stale: true, refreshing: false });
  }
  window.dispatchEvent(new Event('focus'));
  document.dispatchEvent(new Event('visibilitychange'));
  expect(getTestVersionSyncState().refreshing).toBe(false);
  reloadToLatestVersion();
  expect(getTestVersionSyncState().refreshing).toBe(true);
  vi.clearAllTimers();
});
