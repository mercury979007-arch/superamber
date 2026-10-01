export const UI_FONT_CRITICAL_URL = '/fonts/SmileySans-UI-Critical.woff2?v=20260906';
export const UI_FONT_FULL_URL = '/fonts/SmileySans-Oblique.ttf.woff2?v=20260906';
export const UI_FONT_TIMEOUT_MS = 5_000;

type UiFontFace = FontFace & { load: () => Promise<FontFace> };
type UiFontFaceConstructor = new (
  family: string,
  source: string,
  descriptors?: FontFaceDescriptors,
) => UiFontFace;

interface UiFontLoadOptions {
  root?: HTMLElement;
  fontSet?: Pick<FontFaceSet, 'add'> | null;
  FontFaceCtor?: UiFontFaceConstructor | null;
  timeoutMs?: number;
}

interface FullFontCacheOptions {
  fetcher?: typeof fetch | null;
  schedule?: (task: () => void) => void;
}

type IdleWindow = Window & {
  requestIdleCallback?: (
    callback: () => void,
    options?: { timeout: number },
  ) => number;
};

export type UiFontLoadResult = 'critical' | 'fallback';

const CRITICAL_CLASS = 'amber-font-critical';
const FALLBACK_CLASS = 'amber-font-fallback';
const LOADING_CLASS = 'amber-font-loading';
const READY_CLASS = 'amber-font-ready';

function useFallback(root: HTMLElement): UiFontLoadResult {
  root.classList.remove(LOADING_CLASS, READY_CLASS, CRITICAL_CLASS);
  root.classList.add(FALLBACK_CLASS);
  return 'fallback';
}

export async function loadUiFontBeforeReveal(
  options: UiFontLoadOptions = {},
): Promise<UiFontLoadResult> {
  if (typeof document === 'undefined') return 'fallback';

  const root = options.root || document.documentElement;
  if (root.classList.contains(CRITICAL_CLASS)) return 'critical';

  const FontFaceCtor = options.FontFaceCtor === undefined
    ? (typeof FontFace === 'undefined' ? undefined : FontFace as UiFontFaceConstructor)
    : options.FontFaceCtor;
  const fontSet = options.fontSet === undefined ? document.fonts : options.fontSet;
  if (!FontFaceCtor || !fontSet?.add) return useFallback(root);

  root.classList.remove(FALLBACK_CLASS, READY_CLASS, CRITICAL_CLASS);
  root.classList.add(LOADING_CLASS);

  let acceptLoadedFace = true;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const source = `url('${UI_FONT_CRITICAL_URL}') format('woff2')`;
  const fontPromise = new FontFaceCtor(
    'Smiley Sans UI',
    source,
    { style: 'normal', weight: '100 900' },
  ).load().then((face) => {
    if (!acceptLoadedFace) return false;
    fontSet.add(face);
    return true;
  }).catch(() => false);

  const timeoutPromise = new Promise<false>((resolve) => {
    timeoutId = setTimeout(() => resolve(false), options.timeoutMs ?? UI_FONT_TIMEOUT_MS);
  });

  const loaded = await Promise.race([fontPromise, timeoutPromise]);
  acceptLoadedFace = false;
  if (timeoutId !== undefined) clearTimeout(timeoutId);

  if (!loaded) return useFallback(root);
  root.classList.remove(LOADING_CLASS, FALLBACK_CLASS, READY_CLASS);
  root.classList.add(CRITICAL_CLASS);
  return 'critical';
}

/**
 * Warm the complete font only after the app is visible. Reading the body makes
 * sure the browser has finished storing the response instead of only receiving
 * its headers. The face is deliberately not added in this view, so it cannot
 * trigger a late layout shift.
 */
export function cacheFullUiFontAfterReveal(
  options: FullFontCacheOptions = {},
): void {
  const fetcher = options.fetcher === undefined
    ? (typeof fetch === 'undefined' ? undefined : fetch)
    : options.fetcher;
  if (!fetcher) return;

  const schedule = options.schedule || ((task: () => void) => {
    const idleWindow = typeof window === 'undefined' ? undefined : window as IdleWindow;
    if (idleWindow?.requestIdleCallback) {
      idleWindow.requestIdleCallback(task, { timeout: 2_000 });
      return;
    }
    setTimeout(task, 1_000);
  });
  schedule(() => {
    void fetcher(UI_FONT_FULL_URL, { cache: 'force-cache' })
      .then((response) => {
        if (!response.ok) return undefined;
        return response.arrayBuffer();
      })
      .catch(() => undefined);
  });
}
