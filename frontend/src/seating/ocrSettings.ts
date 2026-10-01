import { readStorageValue, storageKeys, writeStorageValue } from './appMeta';
import type { OCRSettings } from './types';

const OCR_ENDPOINT_QUERY_KEY = 'ocrEndpoint';

const isLocalDev = (): boolean =>
  location.hostname === '127.0.0.1' || location.hostname === 'localhost';

const getQueryEndpoint = (): string => {
  try {
    return new URLSearchParams(location.search).get(OCR_ENDPOINT_QUERY_KEY)?.trim().replace(/\/$/, '') || '';
  } catch {
    return '';
  }
};

const getInitialEndpoint = (): string => getQueryEndpoint() || (isLocalDev() ? 'http://127.0.0.1:8787' : location.origin);

const normalizeEndpoint = (value: string): string => {
  const trimmed = value.trim().replace(/\/$/, '');
  if (!trimmed) return getInitialEndpoint();
  // In production, override saved localhost endpoints with current origin
  if (!isLocalDev() && /^https?:\/\/(127\.0\.0\.1|localhost)/i.test(trimmed)) {
    return getInitialEndpoint();
  }
  return trimmed;
};

export const getDefaultOCREndpoint = (): string =>
  getInitialEndpoint();

export const makeDefaultOCRSettings = (): OCRSettings => ({
  engine: 'hybrid',
  allowLocalFallback: false,
  tencentEndpoint: getDefaultOCREndpoint(),
  tencentRegion: 'ap-guangzhou',
  tencentAction: 'Auto'
});

export const loadOCRSettings = (): OCRSettings => {
  const saved = readStorageValue(storageKeys.ocrSettings);
  if (!saved) {
    return makeDefaultOCRSettings();
  }

  try {
    const parsed = JSON.parse(saved) as Partial<OCRSettings>;
    const defaults = makeDefaultOCRSettings();
    return {
      engine: parsed.engine === 'local' || parsed.engine === 'tencent' || parsed.engine === 'hybrid' ? parsed.engine : defaults.engine,
      allowLocalFallback: typeof parsed.allowLocalFallback === 'boolean' ? parsed.allowLocalFallback : defaults.allowLocalFallback,
      tencentEndpoint: normalizeEndpoint(parsed.tencentEndpoint || defaults.tencentEndpoint),
      tencentRegion: (parsed.tencentRegion || defaults.tencentRegion).trim() || defaults.tencentRegion,
      tencentAction:
        parsed.tencentAction === 'ExtractDocMulti' ||
        parsed.tencentAction === 'GeneralAccurateOCR' ||
        parsed.tencentAction === 'GeneralBasicOCR' ||
        parsed.tencentAction === 'Auto'
          ? parsed.tencentAction
          : defaults.tencentAction
    };
  } catch {
    return makeDefaultOCRSettings();
  }
};

export const saveOCRSettings = (settings: OCRSettings): void => {
  const normalizedEndpoint = normalizeEndpoint(settings.tencentEndpoint);

  writeStorageValue(
    storageKeys.ocrSettings,
    JSON.stringify({
      ...settings,
      tencentEndpoint: normalizedEndpoint,
      tencentRegion: settings.tencentRegion.trim() || 'ap-guangzhou'
    })
  );
};

const activeSettings = loadOCRSettings();
if (activeSettings.tencentEndpoint !== normalizeEndpoint(activeSettings.tencentEndpoint)) {
  saveOCRSettings(activeSettings);
}
