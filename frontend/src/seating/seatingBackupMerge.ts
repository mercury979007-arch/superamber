import type { ClassConfig, ClassData } from './types';

// Existing browser records, including intentionally empty seating, always win.
export function mergeMissingBackupClassData(
  localClassData: ClassData,
  backupClassData: ClassData,
  _hasSavedSeating: (config: ClassConfig | null | undefined) => boolean,
): { classData: ClassData; changed: boolean } {
  const merged: ClassData = { ...localClassData };
  let changed = false;
  Object.entries(backupClassData).forEach(([className, config]) => {
    if (!Object.prototype.hasOwnProperty.call(localClassData, className)) {
      merged[className] = config;
      changed = true;
    }
  });
  return { classData: merged, changed };
}

// Automatic embedded restore only needs the current teacher's class list.
// Existing browser records remain untouched, including historical classes.
export function selectBackupClasses(backup: ClassData, classNames?: string[]): ClassData {
  if (!classNames) return backup;
  const allowed = new Set(classNames.map((name) => name.trim().toUpperCase()));
  return Object.fromEntries(Object.entries(backup).filter(([name]) => allowed.has(name.trim().toUpperCase())));
}
