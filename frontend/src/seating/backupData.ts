import type { AcademicTermLaunchMeta, ClassConfig, ClassData, ClassSnapshot, ReminderMeta, ReminderNote, ThemeName, TimeMode } from './types';

export interface BackupPayload {
  app: {
    name: string;
    slug: string;
  };
  exportedAt: string;
  sourceOrigin: string;
  classData: ClassData;
  userProfile: {
    username: string;
    theme: string;
  };
  reminderMeta?: ReminderMeta;
  batchUndo: ClassData | null;
  academicTermLaunch?: AcademicTermLaunchMeta;
}

export function sanitizeImportedTheme(theme: string | undefined): ThemeName {
  if (theme === 'classic'
    || theme === 'mint'
    || theme === 'rose'
    || theme === 'apricot'
    || theme === 'golden'
    || theme === 'plum'
    || theme === 'paper') {
    return theme;
  }
  return 'paper';
}

export function snapshotFromConfig<T extends ClassConfig>(
  config: T,
  deepCopy: <V>(value: V) => V,
): ClassSnapshot {
  return {
    theme: config.theme,
    weekday: deepCopy(config.weekday),
    weekend: deepCopy(config.weekend),
  };
}

export function sanitizeClassSnapshot(
  snapshot: Partial<ClassSnapshot> | undefined,
  options: {
    defaultTheme: ThemeName;
    makeClassShell: () => ClassConfig;
    sanitizeModeData: (mode: ClassConfig[TimeMode]) => ClassConfig[TimeMode];
  },
): ClassSnapshot {
  const shell = options.makeClassShell();
  return {
    theme: snapshot?.theme || options.defaultTheme || 'paper',
    weekday: options.sanitizeModeData(snapshot?.weekday || shell.weekday),
    weekend: options.sanitizeModeData(snapshot?.weekend || shell.weekend),
  };
}

export function sanitizeClassDataMap(
  loaded: ClassData,
  options: {
    defaultTheme: ThemeName;
    makeClassShell: () => ClassConfig;
    sanitizeModeData: (mode: ClassConfig[TimeMode]) => ClassConfig[TimeMode];
    sanitizeReminderNotes: (notes: unknown) => ReminderNote[];
  },
): ClassData {
  const sanitized: Record<string, ClassConfig> = {};

  Object.entries(loaded).forEach(([className, config]) => {
    const shell = options.makeClassShell();
    const snapshot = sanitizeClassSnapshot(config, {
      defaultTheme: options.defaultTheme,
      makeClassShell: options.makeClassShell,
      sanitizeModeData: options.sanitizeModeData,
    });
    shell.theme = snapshot.theme;
    shell.weekday = snapshot.weekday;
    shell.weekend = snapshot.weekend;
    shell.previousWeek = config.previousWeek
      ? sanitizeClassSnapshot(config.previousWeek, {
          defaultTheme: options.defaultTheme,
          makeClassShell: options.makeClassShell,
          sanitizeModeData: options.sanitizeModeData,
        })
      : null;
    shell.cnf = config.cnf || null;
    shell.todoNotes = options.sanitizeReminderNotes(config.todoNotes);
    sanitized[className] = shell;
  });

  return sanitized;
}

export function buildBackupPayload(args: {
  appName: string;
  appSlug: string;
  sourceOrigin: string;
  classData: ClassData;
  userProfile: { username: string; theme: ThemeName };
  reminderMeta: ReminderMeta;
  batchUndo: ClassData | null;
  academicTermLaunch?: AcademicTermLaunchMeta | null;
  deepCopy: <T>(value: T) => T;
}): BackupPayload {
  return {
    app: {
      name: args.appName,
      slug: args.appSlug,
    },
    exportedAt: new Date().toISOString(),
    sourceOrigin: args.sourceOrigin,
    classData: args.deepCopy(args.classData),
    userProfile: {
      username: args.userProfile.username,
      theme: args.userProfile.theme,
    },
    reminderMeta: args.deepCopy(args.reminderMeta),
    batchUndo: args.deepCopy(args.batchUndo),
    academicTermLaunch: args.academicTermLaunch ? args.deepCopy(args.academicTermLaunch) : undefined,
  };
}
