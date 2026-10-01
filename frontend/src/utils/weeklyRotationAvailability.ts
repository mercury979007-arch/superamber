import { getWeek1StartDate } from './weekNumber';

/** Catch-up is available daily; future weekly generation opens Sunday in Shanghai. */
export function weeklyRotationAvailability(targetWeek: number | undefined, now = new Date()): { allowed: boolean; reason: string } {
  if (!targetWeek) return { allowed: false, reason: '请先保存座位表。' };
  const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const day = new Date(`${dayKey}T00:00:00Z`);
  const start = getWeek1StartDate();
  const startMs = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const currentWeek = Math.max(1, Math.floor((day.getTime() - startMs) / (7 * 86400000)) + 1);
  const allowed = targetWeek <= currentWeek || (day.getUTCDay() === 0 && targetWeek === currentWeek + 1);
  return { allowed, reason: allowed ? '' : targetWeek > currentWeek + 1 ? `Week ${targetWeek} 尚未开放，请在前一周周日生成。` : '仅周日可生成下一周座位表（北京时间）。' };
}
