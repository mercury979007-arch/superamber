import { addDays } from './calendar';
import { rotateTimeModeData } from './layoutOperations';
import type { ClassConfig, TimeMode, TimeModeData } from './types';

const modeKeys: TimeMode[] = ['weekday', 'weekend'];

const namesSignature = (values: Array<string | null | undefined> = []): string =>
  values.map((name) => String(name || '').trim()).join('|');

export const seatingSignature = (mode: TimeModeData): string => {
  if (mode.layout === 'circular') {
    return (mode.groups || []).map((group) => namesSignature(group)).join('||');
  }

  if (mode.layout === 'camp') {
    return (mode.groups || []).map((group) => namesSignature(group)).join('||');
  }

  if (mode.layout === 'rows') {
    return (mode.rowGroups?.rows || [])
      .flatMap((row) => [row.left, row.right])
      .map((group) => namesSignature(group))
      .join('||');
  }

  if (mode.layout === 'four') {
    return (mode.fourGroups?.groups || []).map((group) => namesSignature(group)).join('||');
  }

  return '';
};

const isOneWeekAfter = (previous: TimeModeData, current: TimeModeData): boolean => {
  const previousKey = previous.locationInfo?.fullDate || '';
  const currentKey = current.locationInfo?.fullDate || '';
  return Boolean(previousKey && currentKey && addDays(previousKey, 7) === currentKey);
};

const shouldRepairMode = (previous: TimeModeData, current: TimeModeData): boolean => {
  if (previous.layout !== current.layout) {
    return false;
  }
  if (!isOneWeekAfter(previous, current)) {
    return false;
  }
  return seatingSignature(previous) === seatingSignature(current);
};

export function repairDateOnlyRotation(config: ClassConfig): ClassConfig {
  if (!config.previousWeek) {
    return config;
  }

  let changed = false;
  const next: ClassConfig = { ...config };

  modeKeys.forEach((mode) => {
    const previousMode = config.previousWeek?.[mode];
    const currentMode = config[mode];
    if (!previousMode || !shouldRepairMode(previousMode, currentMode)) {
      return;
    }

    // This repairs data written before the new physical three-row paths existed.
    // Replaying the historical path keeps the one-time repair deterministic.
    next[mode] = rotateTimeModeData(previousMode, currentMode.locationInfo, { legacyRowsPath: true });
    changed = true;
  });

  return changed ? next : config;
}
