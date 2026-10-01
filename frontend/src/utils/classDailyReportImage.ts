import { REPORT_COLUMN_WIDTHS as columnWidths, distributeReportColumnWidths } from './classDailyReportLayout';
import { prepareExportFont } from './exportFontGuard.mjs';
export async function ensureReportFont(): Promise<void> {
  await prepareExportFont({ family: 'ReportSmiley' });
}

function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.quadraticCurveTo(x + width, y, x + width, y + r);
  context.lineTo(x + width, y + height - r);
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  context.lineTo(x + r, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
  context.closePath();
}

function balancedTwoLines(context: CanvasRenderingContext2D, source: string, maxWidth: number): string[] | null {
  const characters = Array.from(source);
  let best: { lines: [string, string]; score: number } | null = null;
  for (let index = 1; index < characters.length; index++) {
    const first = characters.slice(0, index).join('').trimEnd();
    const second = characters.slice(index).join('').trimStart();
    if (!first || !second) continue;
    const firstWidth = context.measureText(first).width;
    const secondWidth = context.measureText(second).width;
    if (firstWidth > maxWidth || secondWidth > maxWidth) continue;
    const secondLength = Array.from(second.replace(/\s/g, '')).length;
    const splitInsideLatinWord = /[A-Za-z0-9]/.test(characters[index - 1]) && /[A-Za-z0-9]/.test(characters[index]);
    const badPunctuationBreak = /[（(\[【《〈「『]$/.test(first) || /^[）)\]】》〉」』、，。！？：；,.!?;:%]/.test(second);
    const whitespaceBreak = /\s/.test(characters[index - 1]) || /\s/.test(characters[index]);
    const score = Math.abs(firstWidth - secondWidth)
      + (secondLength === 1 ? maxWidth * 20 : secondLength === 2 ? maxWidth * 3 : 0)
      + (splitInsideLatinWord ? maxWidth * 12 : 0)
      + (badPunctuationBreak ? maxWidth * 16 : 0)
      - (whitespaceBreak ? maxWidth * .2 : 0);
    if (!best || score < best.score) best = { lines: [first, second], score };
  }
  return best?.lines || null;
}

export function wrapReportText(context: CanvasRenderingContext2D, value: string, maxWidth: number, maxLines = 2): string[] {
  const source = String(value || '').replace(/\s+/g, ' ').trim();
  if (!source) return [''];
  if (context.measureText(source).width <= maxWidth) return [source];
  if (maxLines >= 2) {
    const balanced = balancedTwoLines(context, source, maxWidth);
    if (balanced) return balanced;
  }
  const lines: string[] = [];
  let current = '';
  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (current && context.measureText(current + character).width > maxWidth) {
      if (lines.length >= maxLines - 1) {
        while (current && context.measureText(current + '…').width > maxWidth) current = current.slice(0, -1);
        lines.push(current + '…'); return lines;
      }
      lines.push(current); current = character;
    } else current += character;
  }
  lines.push(current); return lines;

}

function drawCenteredLines(
  context: CanvasRenderingContext2D,
  lines: string[],
  centerX: number,
  centerY: number,
  lineHeight: number,
) {
  const firstY = centerY - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((line, index) => context.fillText(line, centerX, firstY + index * lineHeight));
}

function columnWidth(header: HTMLTableCellElement): number {
  if (header.classList.contains('is-student')) return columnWidths.student;
  if (header.classList.contains('is-progress')) return columnWidths.progress;
  if (header.classList.contains('is-metric')) return columnWidths.speaking;
  if (header.classList.contains('is-minip')) return columnWidths.minip;
  return columnWidths.task;
}

function cellText(cell: HTMLTableCellElement): { primary: string; secondary: string } {
  const primary = cell.querySelector('strong, b, .class-daily-home-cell-mark')?.textContent?.trim() || cell.textContent?.trim() || '';
  const secondary = cell.querySelector('small')?.textContent?.trim() || '';
  return { primary, secondary };
}

function cellFill(cell: HTMLTableCellElement, rowIndex: number): string {
  if (cell.classList.contains('is-minip')) return '#fffaf0';
  if (cell.classList.contains('level-1')) return '#fff1bb';
  if (cell.classList.contains('level-2')) return '#fcf0eb';
  if (cell.classList.contains('level-3')) return '#fbecea';
  if (cell.classList.contains('is-student') && cell.parentElement?.classList.contains('is-incomplete')) return '#fbecea';
  return rowIndex % 2 === 0 ? '#ffffff' : '#fbfcfa';
}

export async function renderClassDailyReportImage(report: HTMLElement): Promise<Blob> {
  await ensureReportFont();
  const table = report.querySelector('table.class-daily-home-matrix') as HTMLTableElement | null;
  const headers = table ? Array.from(table.tHead?.rows[0]?.cells || []) : [];
  const rows = table ? Array.from(table.tBodies[0]?.rows || []) : [];
  if (!table || headers.length === 0 || rows.length === 0) throw new Error('日报表格尚未准备完成');

  const padding = 30;
  const webWidths = Array.from(table.querySelectorAll('col')).map(col => Number(col.dataset.reportWidth));
  const naturalWidths = headers.map((header, index) => webWidths[index] > 0 ? webWidths[index] : columnWidth(header));
  const naturalTableWidth = naturalWidths.reduce((sum, width) => sum + width, 0);
  const panelCount = rows.length > 18 && headers.length <= 7 ? 2 : 1;
  const rowsPerPanel = Math.ceil(rows.length / panelCount);
  const panelGap = 24;
  const panelWidth = Math.max(780, naturalTableWidth);
  const logicalWidth = panelWidth * panelCount + padding * 2 + panelGap * (panelCount - 1);
  const widths = distributeReportColumnWidths(naturalWidths, panelWidth);
  const headerHeight = 100;
  const summaryHeight = 76;
  const tableHeaderHeight = 52;
  const rowHeight = 46;
  const rewardNote = report.querySelector('.class-daily-home-parent-reward-note') as HTMLElement | null;
  const footerHeight = rewardNote ? 78 : 26;
  const logicalHeight = headerHeight + summaryHeight + tableHeaderHeight + rowsPerPanel * rowHeight + footerHeight + padding;
  const maxPixels = 15_000_000;
  const scale = Math.max(0.1, Math.min(2, 4096 / logicalWidth, 4096 / logicalHeight, Math.sqrt(maxPixels / (logicalWidth * logicalHeight))));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(logicalWidth * scale));
  canvas.height = Math.max(1, Math.round(logicalHeight * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('当前浏览器无法创建日报图片');
  context.scale(scale, scale);
  context.fillStyle = '#fffdf8';
  context.fillRect(0, 0, logicalWidth, logicalHeight);
  context.textAlign = 'center';
  context.textBaseline = 'middle';

  const title = report.querySelector('.class-daily-home-poster-head h2')?.textContent?.trim() || '班级挑战完成日报';
  const subtitle = report.querySelector('.class-daily-home-poster-head p')?.textContent?.trim() || '';
  context.fillStyle = '#638260';
  context.font = '800 13px ReportSmiley, sans-serif';
  context.fillText('🌟 CLASS CHALLENGE DAILY REPORT', logicalWidth / 2, 25);
  context.fillStyle = '#354e3a';
  context.font = '900 27px ReportSmiley, sans-serif';
  context.fillText(title, logicalWidth / 2, 58);
  context.fillStyle = '#7d887d';
  context.font = '600 12px ReportSmiley, sans-serif';
  context.fillText(subtitle, logicalWidth / 2, 88);

  const summaries = Array.from(report.querySelectorAll('.class-daily-home-report-summary > div'));
  const cardGap = 12;
  const cardWidth = (logicalWidth - padding * 2 - cardGap * Math.max(0, summaries.length - 1)) / Math.max(1, summaries.length);
  summaries.forEach((card, index) => {
    const x = padding + index * (cardWidth + cardGap);
    roundedRect(context, x, headerHeight, cardWidth, 68, 14);
    context.fillStyle = index === 1 ? '#fff9e9' : index === 2 ? '#f1f7fb' : '#f2f8f0';
    context.fill();
    context.strokeStyle = '#e2e8dd';
    context.stroke();
    context.fillStyle = '#7d877e';
    context.font = '700 11px ReportSmiley, sans-serif';
    context.fillText(card.querySelector('span')?.textContent?.trim() || '', x + cardWidth / 2, headerHeight + 16);
    context.fillStyle = '#3d5842';
    context.font = '900 22px ReportSmiley, sans-serif';
    const value = `${card.querySelector('strong')?.textContent?.trim() || ''} ${card.querySelector('small')?.textContent?.trim() || ''}`;
    context.fillText(value, x + cardWidth / 2, headerHeight + 43);
  });

  let y = headerHeight + summaryHeight;
  for (let panel = 0; panel < panelCount; panel++) {
  y = headerHeight + summaryHeight;
  const panelX = padding + panel * (panelWidth + panelGap);
  let x = panelX;
  headers.forEach((header, index) => {
    const width = widths[index];
    context.fillStyle = header.classList.contains('is-task') ? '#f3f7f1' : '#edf4e9';
    context.fillRect(x, y, width, tableHeaderHeight);
    context.strokeStyle = '#e2e6de';
    context.strokeRect(x, y, width, tableHeaderHeight);
    context.fillStyle = '#526754';
    context.font = '600 16px ReportSmiley, sans-serif';
    const subtitle = header.querySelector('small')?.textContent || '';
    const label = Array.from(header.childNodes).filter(node => node.nodeName !== 'SMALL').map(node => node.textContent).join(' ');
    drawCenteredLines(context, wrapReportText(context, label, width - 18, subtitle ? 2 : 3), x + width / 2, y + tableHeaderHeight / 2 - (subtitle ? 8 : 0), 16);
    if (subtitle) { context.font = '400 11px ReportSmiley, sans-serif'; context.fillText(subtitle, x + width / 2, y + tableHeaderHeight - 10); }
    x += width;
  });
  y += tableHeaderHeight;

  rows.slice(panel * rowsPerPanel, (panel + 1) * rowsPerPanel).forEach((row, rowIndex) => {
    x = panelX;
    Array.from(row.cells).forEach((cell, columnIndex) => {
      const width = widths[columnIndex] || 130;
      context.fillStyle = cellFill(cell, rowIndex);
      context.fillRect(x, y, width, rowHeight);
      context.strokeStyle = '#e7e8e2';
      context.strokeRect(x, y, width, rowHeight);
      const { primary, secondary } = cellText(cell);
      context.fillStyle = cell.classList.contains('level-3') ? '#a2605d' : cell.classList.contains('is-minip') ? '#9a742b' : '#46584a';
      context.font = '600 19px ReportSmiley, sans-serif';
      const primaryY = secondary ? y + 17 : y + rowHeight / 2;
      drawCenteredLines(context, wrapReportText(context, primary, width - 14, 2), x + width / 2, primaryY, 15);
      if (secondary) {
        context.fillStyle = '#8a918b';
        context.font = '400 12px ReportSmiley, sans-serif';
        context.fillText(secondary, x + width / 2, y + 35);
      }
      x += width;
    });
    y += rowHeight;
  });

  }
  y = headerHeight + summaryHeight + tableHeaderHeight + rowsPerPanel * rowHeight;
  if (rewardNote) {
    roundedRect(context, padding, y + 14, logicalWidth - padding * 2, 50, 12);
    context.fillStyle = '#fff8e9';
    context.fill();
    context.strokeStyle = '#eadfca';
    context.stroke();
    context.fillStyle = '#6e644e';
    context.font = '750 11px ReportSmiley, sans-serif';
    drawCenteredLines(context, wrapReportText(context, Array.from(rewardNote.children).map(node => node.textContent).join(' · '), logicalWidth - padding * 2 - 28, 2), logicalWidth / 2, y + 39, 15);
  }

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob || blob.size === 0) throw new Error('日报图片生成失败');
  return blob;
}
