import type { BonusHistoryEntry, BonusHistoryRecord } from '../types';

const STORAGE_KEY = 'amber_bonus_history';

export function loadBonusHistory(): BonusHistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as BonusHistoryEntry[];
  } catch {
    return [];
  }
}

export function getBonusNames(): string[] {
  return loadBonusHistory().map((e) => e.bonusName);
}

export function getLastAmount(bonusName: string): number | null {
  const entry = loadBonusHistory().find((e) => e.bonusName === bonusName);
  return entry ? entry.lastAmount : null;
}

export function getHistoryForBonus(bonusName: string): BonusHistoryRecord[] {
  const entry = loadBonusHistory().find((e) => e.bonusName === bonusName);
  return entry ? [...entry.records].sort((a, b) => b.timestamp - a.timestamp) : [];
}

export function saveBonusRecord(
  bonusName: string,
  classCode: string,
  week: number,
  studentNames: string[],
  amount: number
): void {
  if (!bonusName.trim() || studentNames.length === 0) return;
  const list = loadBonusHistory();
  const existing = list.find((e) => e.bonusName === bonusName);
  const record: BonusHistoryRecord = { classCode, week, studentNames, amount, timestamp: Date.now() };
  if (existing) {
    existing.lastAmount = amount;
    existing.records.push(record);
  } else {
    list.push({ bonusName, lastAmount: amount, records: [record] });
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}
