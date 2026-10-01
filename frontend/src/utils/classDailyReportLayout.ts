export const REPORT_COLUMN_WIDTHS = { student: 96, minip: 96, progress: 116, speaking: 86, task: 120 };
export type ReportColumnKind = keyof typeof REPORT_COLUMN_WIDTHS;
export type ReportColumnSpec = { key: string; kind: ReportColumnKind; label?: string; values?: string[] };

function textUnits(value: string): number {
  return Array.from(value).reduce((total, char) => total + (/[^\u0000-\u00ff]/.test(char) ? 1 : .58), 0);
}

/** All visible columns share spare space, including reports with one task. */
export function buildReportColumnLayout(columns: ReportColumnSpec[]) {
  const widths = columns.map(column => {
    if (column.kind === 'student') {
      const longest = Math.max(0, ...(column.values || []).map(textUnits));
      return Math.round(Math.max(84, Math.min(128, longest * 10 + 24)));
    }
    if (column.kind === 'task') return Math.round(Math.max(116, Math.min(160, textUnits(column.label || '') * 4 + 96)));
    return REPORT_COLUMN_WIDTHS[column.kind];
  });
  const total = widths.reduce((sum, width) => sum + width, 0);
  return {
    columns: columns.map((column, index) => ({ ...column, width: widths[index], percent: total ? widths[index] / total * 100 : 0 })),
    minWidth: Math.max(640, total),
  };
}

export function distributeReportColumnWidths(widths: number[], availableWidth: number): number[] {
  const total = widths.reduce((sum, width) => sum + width, 0);
  const scale = total ? Math.max(total, availableWidth) / total : 1;
  return widths.map(width => width * scale);
}
