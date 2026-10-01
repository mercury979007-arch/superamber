import { describe, expect, it } from 'vitest';
import { buildReportColumnLayout, distributeReportColumnWidths, type ReportColumnSpec } from './classDailyReportLayout';

describe('report column allocation', () => {
  const summary: ReportColumnSpec[] = [
    { key: 'student', kind: 'student', values: ['Amelia', '王阡陌'] },
    { key: 'progress', kind: 'progress' }, { key: 'speaking', kind: 'speaking' },
  ];
  it.each([1, 3, 8, 12])('balances %i task columns and preserves room to read each column', count => {
    const layout = buildReportColumnLayout([...summary, ...Array.from({ length: count }, (_, i) => ({ key: String(i), kind: 'task' as const, label: '开学第一课绘本' }))]);
    for (const available of [640, 900, 1600]) {
      const widths = distributeReportColumnWidths(layout.columns.map(c => c.width), Math.max(available, layout.minWidth));
      expect(Math.max(...widths) / Math.min(...widths)).toBeLessThan(2);
      expect(widths[0]).toBeGreaterThanOrEqual(84);
      expect(widths.reduce((sum, width) => sum + width, 0)).toBeCloseTo(Math.max(available, layout.minWidth));
    }
  });
  it('reacts to long content and hidden columns without allowing the name to dominate', () => {
    const short = buildReportColumnLayout(summary);
    const long = buildReportColumnLayout([{ ...summary[0], values: ['Alexander Williamson 张三'] }, summary[1]]);
    expect(long.columns[0].width).toBeGreaterThan(short.columns[0].width);
    expect(long.columns[0].width).toBeLessThanOrEqual(128);
    expect(long.columns.reduce((sum, c) => sum + c.percent, 0)).toBeCloseTo(100);
    expect(buildReportColumnLayout([]).columns).toEqual([]);
  });
});
