import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderClassDailyReportImage, wrapReportText } from './classDailyReportImage';
import { prepareExportFont } from './exportFontGuard.mjs';
vi.mock('./exportFontGuard.mjs', () => ({ prepareExportFont: vi.fn().mockResolvedValue({ verified: true }) }));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('renderClassDailyReportImage', () => {
  it('balances two-line headers without leaving a single glyph or closing bracket alone', () => {
    const context = {
      measureText: vi.fn((value: string) => ({ width: Array.from(String(value)).length * 10 })),
    } as unknown as CanvasRenderingContext2D;
    const speaking = wrapReportText(context, '2 本周周末温故 AI语音', 80, 3);
    const optional = wrapReportText(context, '5 本周小挑战（选做）', 80, 3);
    const reentry = wrapReportText(context, '6【Re-entry】2/3+U4 L1预习', 110, 3);

    for (const [lines, maxWidth] of [[speaking, 80], [optional, 80], [reentry, 110]] as const) {
      expect(lines).toHaveLength(2);
      expect(lines.every((line) => context.measureText(line).width <= maxWidth)).toBe(true);
      expect(Array.from(lines[1].replace(/\s/g, '')).length).toBeGreaterThan(1);
      expect(lines[0]).not.toMatch(/[（(\[【《〈「『]$/);
      expect(lines[1]).not.toMatch(/^[）)\]】》〉」』、，。！？：；,.!?;:%]/);
    }
    expect(speaking.join('')).toContain('AI语音');
    expect(optional.join('')).toContain('（选做）');
    expect(reentry.some((line) => line.includes('Re-entry'))).toBe(true);
    expect(reentry.some((line) => line.includes('2/3+U4'))).toBe(true);
  });

  it('does not draw or export when the real font guard fails', async () => {
    vi.mocked(prepareExportFont).mockRejectedValueOnce(Object.assign(new Error('font unavailable'), { code: 'EXPORT_FONT_UNAVAILABLE' }));
    const draw = vi.spyOn(HTMLCanvasElement.prototype, 'getContext');
    await expect(renderClassDailyReportImage(document.createElement('section'))).rejects.toMatchObject({ code: 'EXPORT_FONT_UNAVAILABLE' });
    expect(draw).not.toHaveBeenCalled();
  });
  it('draws a non-empty report directly from visible table data', async () => {
    vi.stubGlobal('FontFace', class { async load() { return this; } });
    Object.defineProperty(document, 'fonts', { value: { add: vi.fn() }, configurable: true });
    const calls: string[] = [];
    const context = {
      scale: vi.fn(), fillRect: vi.fn(() => calls.push('fillRect')), strokeRect: vi.fn(),
      beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), quadraticCurveTo: vi.fn(), closePath: vi.fn(),
      fill: vi.fn(), stroke: vi.fn(), fillText: vi.fn((value: string) => calls.push(String(value))),
      measureText: vi.fn((value: string) => ({ width: String(value).length * 7 })),
      fillStyle: '', strokeStyle: '', font: '', textAlign: '', textBaseline: '',
    } as unknown as CanvasRenderingContext2D;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(new Blob(['png'], { type: 'image/png' })));
    const report = document.createElement('section');
    report.innerHTML = `
      <header class="class-daily-home-poster-head"><h2>J328 班级挑战完成日报</h2><p>标准版 · 今日</p></header>
      <div class="class-daily-home-report-summary"><div><span>全部完成</span><strong>1</strong><small>/ 2 人</small></div></div>
      <table class="class-daily-home-matrix"><thead><tr><th class="is-student">学生</th><th class="is-task">挑战一</th></tr></thead>
      <tbody><tr><td class="is-student"><strong>Amy</strong><small>艾米</small></td><td class="is-task level-0"><span class="class-daily-home-cell-mark">✅</span></td></tr></tbody></table>
      <footer class="class-daily-home-parent-reward-note">完成全部基础挑战可获得奖励</footer>`;

    const blob = await renderClassDailyReportImage(report);

    expect(blob.size).toBeGreaterThan(0);
    expect(calls).toContain('fillRect');
    expect(calls).toContain('J328 班级挑战完成日报');
    expect(calls).toContain('Amy');
    expect(calls).toContain('✅');
    const tbody = report.querySelector('tbody')!;
    const template = tbody.rows[0].outerHTML;
    tbody.innerHTML = Array.from({ length: 27 }, (_, index) => template.replace('Amy', `Name${index + 1}`)).join('');
    const singlePage = await renderClassDailyReportImage(report);
    expect(singlePage.size).toBeGreaterThan(0);
    for (let index = 1; index <= 27; index++) expect(calls.filter(value => value === `Name${index}`)).toHaveLength(1);

  });
});
