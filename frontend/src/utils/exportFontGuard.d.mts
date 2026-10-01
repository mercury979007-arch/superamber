export function prepareExportFont(options?: {
  document?: Document; family?: string; source?: string; timeoutMs?: number;
  target?: HTMLElement; selector?: string;
}): Promise<{ family: string; css: string; dataUrl: string; verified: boolean }>;
