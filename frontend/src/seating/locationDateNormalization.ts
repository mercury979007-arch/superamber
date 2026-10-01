import type { LocationInfo } from './types';
import { dateKeyToMonthDay, monthDayToDateKey } from './calendar';

export function normalizeLocationDate(
  location: Partial<LocationInfo>,
): Pick<LocationInfo, 'fullDate' | 'date' | 'day' | 'weekday'> {
  const fullDate = location.fullDate || monthDayToDateKey(String(location.date || ''), String(location.day || '')) || '';
  const converted = dateKeyToMonthDay(fullDate);

  if (!converted) {
    return {
      fullDate,
      date: String(location.date || ''),
      day: String(location.day || ''),
      weekday: String(location.weekday || ''),
    };
  }

  return {
    fullDate,
    date: converted.month,
    day: converted.day,
    weekday: converted.weekday,
  };
}
