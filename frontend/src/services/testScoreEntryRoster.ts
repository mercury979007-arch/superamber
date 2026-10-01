import type { ScoreBookRow } from './testScoreEntryApi';
export function buildScoreEntryRoster(classCode: string, rows: ScoreBookRow[]) {
  return rows.map((row) => {
    return {
      studentId: row.studentId || `score-book:${row.rowId}`,
      chineseName: row.chName || '',
      englishName: row.enName || '',
      classCode,
    };
  });
}
