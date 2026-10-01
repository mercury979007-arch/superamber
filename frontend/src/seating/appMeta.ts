export const APP_NAME = 'Super Amber';
export const APP_SLUG = 'superamber';
export const APP_TITLE = `${APP_NAME} | 班级排座与轮转`;
export const BACKUP_FILE_PREFIX = `${APP_SLUG}-backup`;

type StorageKeySpec = {
  current: string;
  legacy: string[];
};

const createStorageKeySpec = (current: string, legacy: string[] = []): StorageKeySpec => ({
  current,
  legacy
});

export const storageKeys = {
  classData: createStorageKeySpec('superamberClassData', ['classSeatingData']),
  userProfile: createStorageKeySpec('superamberUserProfile', ['classSeatingProfile']),
  batchUndo: createStorageKeySpec('superamberBatchUndoData', ['classSeatingBatchUndoData']),
  ocrSettings: createStorageKeySpec('superamberOCRSettings', ['classSeatingOCRSettings']),
  cnfSyncProfile: createStorageKeySpec('superamberCnfSyncProfile', ['classSeatingCnfSyncProfile']),
  usageGuideDismissed: createStorageKeySpec('superamberUsageGuideDismissed', ['classSeatingUsageGuideDismissed']),
  notesPanelWidth: createStorageKeySpec('superamberNotesPanelWidth', ['classSeatingNotesPanelWidth']),
  notesSectionHeight: createStorageKeySpec('superamberNotesSectionHeight', ['classSeatingNotesSectionHeight']),
  notesToolbarCollapsed: createStorageKeySpec('superamberNotesToolbarCollapsed', ['classSeatingNotesToolbarCollapsed']),
  editorToolsCollapsed: createStorageKeySpec('superamberEditorToolsCollapsed', ['classSeatingEditorToolsCollapsed']),
  summerCampToolsCollapsed: createStorageKeySpec('superamberSummerCampToolsCollapsed'),
  reminderMeta: createStorageKeySpec('superamberReminderMeta')
} as const;

export const readStorageValue = (spec: StorageKeySpec): string | null => {
  const currentValue = window.localStorage.getItem(spec.current);
  if (currentValue !== null) {
    return currentValue;
  }

  for (const key of spec.legacy) {
    const legacyValue = window.localStorage.getItem(key);
    if (legacyValue !== null) {
      return legacyValue;
    }
  }

  return null;
};

export const writeStorageValue = (spec: StorageKeySpec, value: string): void => {
  window.localStorage.setItem(spec.current, value);
  spec.legacy.forEach((key) => window.localStorage.setItem(key, value));
};

export const writeCurrentStorageValue = (spec: StorageKeySpec, value: string): void => {
  window.localStorage.setItem(spec.current, value);
  spec.legacy.forEach((key) => window.localStorage.removeItem(key));
};

// Only server-derived caches may be evicted. Never remove teacher edits, seat
// records, undo snapshots, credentials, or unknown keys to make a write fit.
function clearRefetchableCaches(): void {
  const keys = Array.from({ length: window.localStorage.length }, (_, i) => window.localStorage.key(i));
  keys.forEach((key) => {
    if (key && (/^superamber_class_control_v\d+:/.test(key) || /^amber_speaking_class_cache:v\d+:/.test(key))) {
      window.localStorage.removeItem(key);
    }
  });
}

function alreadyContainedInCurrent(current: string | null, legacy: string): boolean {
  if (current === null) return false;
  if (current === legacy) return true;
  try {
    const a = JSON.parse(current), b = JSON.parse(legacy);
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) || Array.isArray(b)) return false;
    return Object.entries(b).every(([key, value]) => JSON.stringify(a[key]) === JSON.stringify(value));
  } catch { return false; }
}

export const writeCurrentStorageValueSafely = (spec: StorageKeySpec, value: string): boolean => {
  const commit = (): boolean => {
    window.localStorage.setItem(spec.current, value);
    if (window.localStorage.getItem(spec.current) !== value) return false;
    // Cleanup is optional and occurs only after durable readback succeeds.
    spec.legacy.forEach((key) => { try { window.localStorage.removeItem(key); } catch { /* keep duplicate */ } });
    return true;
  };
  try { return commit(); } catch { /* Reclaim only verified duplicates and refetchable caches. */ }
  try {
    const current = window.localStorage.getItem(spec.current);
    spec.legacy.forEach((key) => {
      const legacy = window.localStorage.getItem(key);
      if (legacy !== null && alreadyContainedInCurrent(current, legacy)) window.localStorage.removeItem(key);
    });
    clearRefetchableCaches();
    return commit();
  } catch {
    return false;
  }
};

export const removeStorageValue = (spec: StorageKeySpec): void => {
  window.localStorage.removeItem(spec.current);
  spec.legacy.forEach((key) => window.localStorage.removeItem(key));
};
