import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildExportScript, deliverExportImageBlob, formatExportLocation, requestExportImageBlob, resolveExportWeek } from './reportExportHelpers';
import type { LocationInfo } from '../seating/types';
import { prepareExportFont } from './exportFontGuard.mjs';
vi.mock('./exportFontGuard.mjs', () => ({ prepareExportFont: vi.fn().mockResolvedValue({ css: 'embedded-font', dataUrl: 'data:font/woff2;base64,test', verified: true }) }));

const renderMocks = vi.hoisted(() => ({
  toBlob: vi.fn(),
  html2canvas: vi.fn(),
}));

vi.mock('html-to-image', () => ({ toBlob: renderMocks.toBlob }));
vi.mock('html2canvas', () => ({ default: renderMocks.html2canvas }));

const baseInfo: LocationInfo = {
  date: '4',
  day: '14',
  weekday: '周二',
  time: '19:00-20:30',
  campus: '人民广场',
  floor: '3F',
  room: '3F-301',
  arrivalMessage: '',
  notes: '',
  fullDate: '2026-04-14',
};

const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

afterEach(() => {
  vi.restoreAllMocks();
  renderMocks.toBlob.mockReset();
  renderMocks.html2canvas.mockReset();
  vi.useRealTimers();
  document.body.innerHTML = '';
  delete (globalThis as Record<string, unknown>).ClipboardItem;
  Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
  Object.defineProperty(URL, 'createObjectURL', { value: originalCreateObjectURL, configurable: true });
  Object.defineProperty(URL, 'revokeObjectURL', { value: originalRevokeObjectURL, configurable: true });
});

describe('exportHelpers', () => {
  it('does not fall back to either renderer if the font is missing', async () => {
    vi.mocked(prepareExportFont).mockRejectedValueOnce(Object.assign(new Error('font unavailable'), { code: 'EXPORT_FONT_UNAVAILABLE' }));
    await expect(requestExportImageBlob(document.createElement('section'))).rejects.toMatchObject({ code: 'EXPORT_FONT_UNAVAILABLE' });
    expect(renderMocks.toBlob).not.toHaveBeenCalled(); expect(renderMocks.html2canvas).not.toHaveBeenCalled();
  });
  it('font failure in the cloned document is not swallowed by a fallback', async () => {
    renderMocks.html2canvas.mockRejectedValueOnce(Object.assign(new Error('clone font unavailable'), { code: 'EXPORT_FONT_UNAVAILABLE' }));
    await expect(requestExportImageBlob(document.createElement('section'), { preferCanvas: true })).rejects.toMatchObject({ code: 'EXPORT_FONT_UNAVAILABLE' });
    expect(renderMocks.toBlob).not.toHaveBeenCalled();
  });
  it('does not move or hide a visible report while exporting it', async () => {
    const report = document.createElement('section');
    report.style.left = '14px';
    report.style.top = '20px';
    report.style.zIndex = '7';
    document.body.appendChild(report);
    renderMocks.toBlob.mockImplementation(async (target: HTMLElement) => {
      expect(target.style.left).toBe('14px');
      expect(target.style.top).toBe('20px');
      expect(target.style.zIndex).toBe('7');
      return new Blob(['image'], { type: 'image/png' });
    });

    const blob = await requestExportImageBlob(report);

    expect(blob.size).toBeGreaterThan(0);
    expect(report.style.left).toBe('14px');
    expect(report.style.top).toBe('20px');
    expect(report.style.zIndex).toBe('7');
  });

  it('formats export locations without duplicating the floor prefix', () => {
    expect(formatExportLocation(baseInfo)).toBe('人民广场3F301');
  });

  it('resolves export week and builds the default parent script', () => {
    expect(resolveExportWeek(baseInfo)).toBeGreaterThan(0);
    expect(buildExportScript(baseInfo)).toContain('请查收【W');
    expect(buildExportScript(baseInfo)).toContain('⏰时间：周二 19:00-20:30');
    expect(buildExportScript(baseInfo)).toContain('🏫地点：人民广场3F301');
  });

  it('writes the image to clipboard when clipboard image support is available', async () => {
    const write = vi.fn().mockResolvedValue(undefined);

    class ClipboardItemMock {
      constructor(public items: Record<string, Blob>) {}
    }

    Object.defineProperty(globalThis, 'ClipboardItem', { value: ClipboardItemMock, configurable: true });
    Object.defineProperty(navigator, 'clipboard', { value: { write }, configurable: true });

    const message = await deliverExportImageBlob(new Blob(['ok'], { type: 'image/png' }), 'Camp 9');

    expect(write).toHaveBeenCalledTimes(1);
    expect(message).toContain('已复制到剪贴板');
  });

  it('can download and copy the same exported image as two independent deliveries', async () => {
    vi.useFakeTimers();
    const write = vi.fn().mockResolvedValue(undefined);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:report-export'), configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });

    class ClipboardItemMock {
      constructor(public items: Record<string, Blob>) {}
    }

    Object.defineProperty(globalThis, 'ClipboardItem', { value: ClipboardItemMock, configurable: true });
    Object.defineProperty(navigator, 'clipboard', { value: { write }, configurable: true });

    const message = await deliverExportImageBlob(
      new Blob(['ok'], { type: 'image/png' }),
      'Class report',
      { alwaysDownload: true },
    );

    expect(click).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledTimes(1);
    expect(message).toContain('已下载');
    expect(message).toContain('已复制');
  });

  it('falls back to opening or downloading the image when clipboard write is blocked', async () => {
    vi.useFakeTimers();
    const write = vi.fn().mockRejectedValue(new Error('The request is not allowed'));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const createObjectURL = vi.fn(() => 'blob:seat-export');
    const revokeObjectURL = vi.fn();

    class ClipboardItemMock {
      constructor(public items: Record<string, Blob>) {}
    }

    Object.defineProperty(globalThis, 'ClipboardItem', { value: ClipboardItemMock, configurable: true });
    Object.defineProperty(navigator, 'clipboard', { value: { write }, configurable: true });
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, configurable: true });

    const message = await deliverExportImageBlob(new Blob(['ok'], { type: 'image/png' }), 'Camp/9');

    const link = document.body.querySelector('a');
    expect(write).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(link).toBeInstanceOf(HTMLAnchorElement);
    expect((link as HTMLAnchorElement).download).toBe('Camp_9.png');
    expect(message).toContain('已改为下载或打开图片');

    vi.advanceTimersByTime(60000);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:seat-export');
  });

  it('falls back to opening or downloading the image when clipboard image APIs are unavailable', async () => {
    vi.useFakeTimers();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const createObjectURL = vi.fn(() => 'blob:seat-export-unsupported');
    const revokeObjectURL = vi.fn();

    Object.defineProperty(globalThis, 'ClipboardItem', { value: undefined, configurable: true });
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, configurable: true });

    const message = await deliverExportImageBlob(new Blob(['ok'], { type: 'image/png' }), 'Camp 10');

    const link = document.body.querySelector('a');
    expect(click).toHaveBeenCalledTimes(1);
    expect(link).toBeInstanceOf(HTMLAnchorElement);
    expect((link as HTMLAnchorElement).download).toBe('Camp 10.png');
    expect(message).toContain('已改为下载或打开图片');

    vi.advanceTimersByTime(60000);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:seat-export-unsupported');
  });
});
