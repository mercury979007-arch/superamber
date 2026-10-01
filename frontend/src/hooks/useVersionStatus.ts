import { useMemo } from 'react';
import { shouldShowVersionVisibility } from '../services/versionInfo';
import { useTestVersionSyncState } from './useTestVersionSyncState';
import { reloadToLatestVersion } from '../utils/testVersionSync';

export function useVersionStatus() {
  const versionSync = useTestVersionSyncState();
  const versionInfo = useMemo(() => {
    if (!versionSync.versionInfo) {
      return null;
    }
    return {
      ...versionSync.versionInfo,
      fingerprint: [
        versionSync.versionInfo.environment || 'unknown',
        versionSync.versionInfo.version || 'unknown',
        versionSync.versionInfo.commit || 'unknown',
        versionSync.versionInfo.deployedAt || 'unknown',
      ].join(':'),
    };
  }, [versionSync.versionInfo]);
  const currentFingerprint = versionSync.currentVersion;
  const latestFingerprint = versionSync.latestVersion || currentFingerprint;
  const hasUpdate = versionSync.stale;
  const shouldShow = useMemo(
    () => versionSync.enabled && shouldShowVersionVisibility(versionInfo),
    [versionSync.enabled, versionInfo],
  );

  return {
    versionInfo,
    currentFingerprint,
    latestFingerprint,
    hasUpdate,
    shouldShow,
    refreshing: versionSync.refreshing,
    autoReloadBlocked: versionSync.autoReloadBlocked,
    reloadToLatestVersion,
  };
}
