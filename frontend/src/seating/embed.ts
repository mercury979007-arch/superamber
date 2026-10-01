import { APP_TITLE } from './appMeta';
import { disposeApp, initApp, setAppMountOptions, type AppMountOptions } from './app';
import styleText from './style.css?raw';
import { appTemplate } from './template';

export interface EmbedMountOptions extends Omit<AppMountOptions, 'queryRoot' | 'hostElement'> {
  setDocumentTitle?: boolean;
  campThemeVars?: Record<string, string>;
}

const normalizeStyleText = (css: string): string =>
  css.replace(/url\((['"]?)\/fonts\//g, "url($1/seating/fonts/");

export const mountSuperamberApp = (
  host: HTMLElement,
  options: EmbedMountOptions = {},
): (() => void) => {
  disposeApp();

  const queryRoot = options.embedded ? (host.shadowRoot || host.attachShadow({ mode: 'open' })) : host;
  queryRoot.innerHTML = `${options.embedded ? `<style>${normalizeStyleText(styleText)}</style>` : ''}${appTemplate}`;

  const shell = queryRoot.querySelector<HTMLElement>('#superamberShell');
  if (shell && options.campThemeVars) {
    Object.entries(options.campThemeVars).forEach(([key, value]) => {
      shell.style.setProperty(key, value);
    });
  }
  setAppMountOptions({
    launchClassName: options.launchClassName,
    availableClassNames: options.availableClassNames,
    embedded: options.embedded,
    queryRoot,
    hostElement: shell,
    siteMode: options.siteMode,
    defaultLayout: options.defaultLayout,
    onReady: options.onReady,
    disableRemoteBackup: options.disableRemoteBackup,
    rotationPreset: options.rotationPreset,
    preserveRotationConfigOnLayoutChange: options.preserveRotationConfigOnLayoutChange,
    availableLayouts: options.availableLayouts,
  });

  if (options.setDocumentTitle !== false) {
    document.title = APP_TITLE;
  }

  initApp();

  return () => {
    disposeApp();
    queryRoot.innerHTML = '';
  };
};
