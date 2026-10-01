import {
  readStorageValue,
  removeStorageValue,
  storageKeys,
  writeCurrentStorageValueSafely,
  writeStorageValue
} from './appMeta';
import type { ClassData, ReminderMeta, UserProfile } from './types';
import { makeDefaultProfile, makeDefaultReminderMeta } from './state';

const VALID_THEMES = new Set(['paper', 'classic', 'mint', 'rose', 'apricot', 'golden', 'plum']);
const isThemeName = (theme: string): theme is UserProfile['theme'] => VALID_THEMES.has(theme);

function parseClassData(raw: string | null): ClassData {
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as ClassData;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export const loadClassData = (): ClassData => {
  const merged: ClassData = {};

  [...storageKeys.classData.legacy, storageKeys.classData.current].forEach((key) => {
    Object.assign(merged, parseClassData(window.localStorage.getItem(key)));
  });

  return merged;
};

export const saveClassData = (classData: ClassData): boolean => {
  return writeCurrentStorageValueSafely(storageKeys.classData, JSON.stringify(classData));
};

export const loadBatchUndoData = (): ClassData | null => {
  const saved = readStorageValue(storageKeys.batchUndo);
  if (!saved) {
    return null;
  }

  try {
    return JSON.parse(saved) as ClassData;
  } catch {
    return null;
  }
};

export const saveBatchUndoData = (classData: ClassData): boolean => {
  return writeCurrentStorageValueSafely(storageKeys.batchUndo, JSON.stringify(classData));
};

export const clearBatchUndoData = (): void => {
  removeStorageValue(storageKeys.batchUndo);
};

export const loadUserProfile = (): UserProfile => {
  const saved = readStorageValue(storageKeys.userProfile);
  if (!saved) {
    return makeDefaultProfile();
  }

  try {
    const parsed = JSON.parse(saved) as Record<string, unknown>;
    const username = typeof parsed.username === 'string' ? parsed.username : '';
    const rawTheme = typeof parsed.theme === 'string' ? parsed.theme : undefined;
    const legacyTheme = rawTheme === 'sky'
      ? 'mint'
      : rawTheme === 'sunny'
        ? 'golden'
        : rawTheme;

    return {
      username: username.trim(),
      theme: legacyTheme && isThemeName(legacyTheme) ? legacyTheme : 'paper'
    };
  } catch {
    return makeDefaultProfile();
  }
};

export const saveUserProfile = (profile: UserProfile): void => {
  writeStorageValue(storageKeys.userProfile, JSON.stringify(profile));
};

export const loadReminderMeta = (): ReminderMeta => {
  const saved = readStorageValue(storageKeys.reminderMeta);
  if (!saved) {
    return makeDefaultReminderMeta();
  }

  try {
    const parsed = JSON.parse(saved) as Partial<ReminderMeta>;
    return {
      enabled: parsed.enabled === true,
      panelCollapsed: parsed.panelCollapsed === true,
      weeklyConfirmedWeek: Number.isFinite(parsed.weeklyConfirmedWeek) ? Number(parsed.weeklyConfirmedWeek) : 0,
      weeklyConfirmedAt: typeof parsed.weeklyConfirmedAt === 'string' ? parsed.weeklyConfirmedAt : '',
      lastAlertDate: typeof parsed.lastAlertDate === 'string' ? parsed.lastAlertDate : ''
    };
  } catch {
    return makeDefaultReminderMeta();
  }
};

export const saveReminderMeta = (meta: ReminderMeta): void => {
  writeStorageValue(storageKeys.reminderMeta, JSON.stringify(meta));
};

export const clearReminderMeta = (): void => {
  removeStorageValue(storageKeys.reminderMeta);
};

// Startup only consolidates data that already exists. It never creates an old
// alias or normalizes/rotates seating. A failed write leaves the source intact.
export function migrateSeatingStorage(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const hasLegacy = storageKeys.classData.legacy.some((key) => localStorage.getItem(key) !== null);
    if (!hasLegacy) return true;
    const data = loadClassData();
    if (!Object.keys(data).length) return true;
    return saveClassData(data);
  } catch { return false; }
}
