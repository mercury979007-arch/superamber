import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cacheFullUiFontAfterReveal,
  loadUiFontBeforeReveal,
  UI_FONT_CRITICAL_URL,
  UI_FONT_FULL_URL,
  UI_FONT_TIMEOUT_MS,
} from './uiFont';

class LoadedFontFace {
  static families: string[] = [];
  family: string;

  constructor(family: string, source: string) {
    this.family = family;
    LoadedFontFace.families.push(`${family}:${source}`);
  }

  async load(): Promise<FontFace> {
    return this as unknown as FontFace;
  }
}

describe('UI font preparation', () => {
  afterEach(() => {
    document.documentElement.className = '';
    LoadedFontFace.families = [];
    vi.useRealTimers();
  });

  it('uses the small UI subset before revealing the page', async () => {
    const added: FontFace[] = [];
    const result = await loadUiFontBeforeReveal({
      FontFaceCtor: LoadedFontFace as unknown as typeof FontFace,
      fontSet: { add: (face) => {
        added.push(face);
        return {} as FontFaceSet;
      } },
      timeoutMs: 100,
    });

    expect(result).toBe('critical');
    expect(added).toHaveLength(1);
    expect(LoadedFontFace.families).toEqual([
      `Smiley Sans UI:url('${UI_FONT_CRITICAL_URL}') format('woff2')`,
    ]);
    expect(document.documentElement.classList.contains('amber-font-critical')).toBe(true);
    expect(document.documentElement.classList.contains('amber-font-loading')).toBe(false);
  });

  it('uses a five-second default deadline', () => {
    expect(UI_FONT_TIMEOUT_MS).toBe(5_000);
  });

  it('freezes the system fallback if the subset exceeds the reveal deadline', async () => {
    vi.useFakeTimers();
    class SlowFontFace {
      load(): Promise<FontFace> {
        return new Promise(() => {});
      }
    }

    const pending = loadUiFontBeforeReveal({
      FontFaceCtor: SlowFontFace as unknown as typeof FontFace,
      fontSet: { add: vi.fn() },
      timeoutMs: 50,
    });
    await vi.advanceTimersByTimeAsync(50);

    await expect(pending).resolves.toBe('fallback');
    expect(document.documentElement.classList.contains('amber-font-fallback')).toBe(true);
    expect(document.documentElement.classList.contains('amber-font-critical')).toBe(false);
  });

  it('uses the system fallback immediately when the FontFace API is unavailable', async () => {
    const result = await loadUiFontBeforeReveal({
      FontFaceCtor: null,
      fontSet: null,
    });

    expect(result).toBe('fallback');
    expect(document.documentElement.classList.contains('amber-font-fallback')).toBe(true);
  });

  it('downloads the complete font only after reveal without registering a new face', async () => {
    const arrayBuffer = vi.fn().mockResolvedValue(new ArrayBuffer(8));
    const fetcher = vi.fn().mockResolvedValue({ ok: true, arrayBuffer });
    let scheduled: (() => void) | undefined;

    cacheFullUiFontAfterReveal({
      fetcher: fetcher as unknown as typeof fetch,
      schedule: (task) => { scheduled = task; },
    });

    expect(fetcher).not.toHaveBeenCalled();
    scheduled?.();
    await vi.waitFor(() => expect(arrayBuffer).toHaveBeenCalledOnce());
    expect(fetcher).toHaveBeenCalledWith(UI_FONT_FULL_URL, { cache: 'force-cache' });
  });
});
