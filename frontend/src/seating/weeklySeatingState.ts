import type { ClassConfig, ClassData, ClassSnapshot, TimeMode } from './types';

export function buildWeeklyRotatedClassData(
  classData: ClassData,
  options: {
    snapshotFromConfig: (config: ClassConfig) => ClassSnapshot;
    rotateSingleClassMode: (mode: ClassConfig[TimeMode], rotateDate: boolean) => ClassConfig[TimeMode];
  },
): ClassData {
  const next: ClassData = {};

  Object.entries(classData).forEach(([className, current]) => {
    next[className] = {
      theme: current.theme,
      previousWeek: options.snapshotFromConfig(current),
      weekday: options.rotateSingleClassMode(current.weekday, true),
      weekend: options.rotateSingleClassMode(current.weekend, true),
      cnf: current.cnf || null,
      todoNotes: current.todoNotes || [],
    };
  });

  return next;
}

export function restorePreviousWeekConfig(
  current: ClassConfig | undefined,
  options: {
    snapshotFromConfig: (config: ClassConfig) => ClassSnapshot;
    sanitizeClassSnapshot: (snapshot: Partial<ClassSnapshot> | undefined) => ClassSnapshot;
  },
): ClassConfig | null {
  const previousWeek = current?.previousWeek;
  if (!current || !previousWeek) {
    return null;
  }

  const currentSnapshot = options.snapshotFromConfig(current);
  return {
    ...options.sanitizeClassSnapshot(previousWeek),
    previousWeek: currentSnapshot,
    cnf: current.cnf || null,
    todoNotes: current.todoNotes || [],
  };
}
