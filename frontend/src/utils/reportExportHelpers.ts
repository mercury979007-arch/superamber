import { getWeekNumber, monthDayToDateKey } from '../seating/calendar';
import type { LocationInfo } from '../seating/types';
import { prepareExportFont } from './exportFontGuard.mjs';

export function downloadBackupPayload(
  payload: { exportedAt: string },
  filePrefix: string,
  body: string,
): void {
  const stamp = payload.exportedAt.slice(0, 19).replace(/[:T]/g, '-');
  const blob = new Blob([body], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${filePrefix}-${stamp}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

export function formatExportLocation(info: LocationInfo): string {
  const campus = String(info.campus || '').trim();
  const floor = String(info.floor || '').trim();
  let room = String(info.room || '').trim();
  if (floor && room.startsWith(floor)) {
    room = room.slice(floor.length).trim().replace(/^[-—\s]+/, '');
  }
  return [campus, floor, room].filter(Boolean).join('');
}

export function resolveExportWeek(info: LocationInfo): number | null {
  const candidates = [
    info.fullDate,
    monthDayToDateKey(info.date, info.day),
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    const parsed = new Date(candidate);
    if (!Number.isNaN(parsed.getTime())) {
      const week = getWeekNumber(parsed);
      if (Number.isFinite(week)) {
        return week;
      }
    }
  }

  return getWeekNumber();
}

export function buildExportScript(info: LocationInfo): string {
  const week = resolveExportWeek(info);
  const timeText = [info.weekday, info.time].filter(Boolean).join(' ');
  const locationText = formatExportLocation(info);

  return [
    '❤️各位爸爸妈妈和孩子们：',
    `请查收【W${week ?? ''}素养实践活动安排】`,
    '',
    `⏰时间：${timeText || '待补充'}`,
    `🏫地点：${locationText || '待补充'}`,
    '',
    '🎒课前准备：姓名牌&水杯',
  ].join('\n');
}

const hasNotesContent = (noteRoot: HTMLElement): boolean =>
  noteRoot.textContent?.trim().length > 0 || noteRoot.querySelector('img') !== null;

const copyResolvedStyles = (source: Element, target: Element): void => {
  if (!(source instanceof HTMLElement) || !(target instanceof HTMLElement)) {
    return;
  }

  const computed = window.getComputedStyle(source);
  for (let index = 0; index < computed.length; index += 1) {
    const property = computed[index];
    target.style.setProperty(property, computed.getPropertyValue(property), computed.getPropertyPriority(property));
  }

  const sourceChildren = Array.from(source.children);
  const targetChildren = Array.from(target.children);
  for (let index = 0; index < sourceChildren.length; index += 1) {
    if (targetChildren[index]) {
      copyResolvedStyles(sourceChildren[index], targetChildren[index]);
    }
  }
};

const syncExportFormState = (source: Element, target: Element): void => {
  if (source instanceof HTMLInputElement && target instanceof HTMLInputElement) {
    target.value = source.value;
  }

  if (source instanceof HTMLSelectElement && target instanceof HTMLSelectElement) {
    target.value = source.value;
  }

  if (source instanceof HTMLTextAreaElement && target instanceof HTMLTextAreaElement) {
    target.value = source.value;
  }

  if (source instanceof HTMLElement && target instanceof HTMLElement && source.isContentEditable) {
    target.innerHTML = source.innerHTML;
    target.removeAttribute('contenteditable');
  }

  const sourceChildren = Array.from(source.children);
  const targetChildren = Array.from(target.children);
  for (let index = 0; index < sourceChildren.length; index += 1) {
    if (targetChildren[index]) {
      syncExportFormState(sourceChildren[index], targetChildren[index]);
    }
  }
};

const setInlineStyles = (element: HTMLElement | null, styles: Partial<CSSStyleDeclaration>): void => {
  if (!element) {
    return;
  }
  Object.entries(styles).forEach(([property, value]) => {
    if (typeof value === 'string') {
      element.style.setProperty(property.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`), value);
    }
  });
};

const setInlineStylesForAll = (
  root: ParentNode,
  selector: string,
  styles: Partial<CSSStyleDeclaration>,
): void => {
  root.querySelectorAll<HTMLElement>(selector).forEach((element) => setInlineStyles(element, styles));
};

const makeExportDecoration = (
  documentRef: Document,
  className: string,
  text: string,
  styles: Partial<CSSStyleDeclaration>,
): HTMLElement => {
  const element = documentRef.createElement('div');
  element.className = className;
  element.textContent = text;
  element.setAttribute('aria-hidden', 'true');
  setInlineStyles(element, styles);
  return element;
};

const SUMMER_CAMP_LOGO_ASSET = '/assets/public-placeholder.svg';
const SUMMER_CAMP_RACE_CARS_ASSET = '/assets/public-placeholder.svg';

interface SummerCampExportTheme {
  accent: string;
  accentStrong: string;
  ink: string;
  paper: string;
  panel: string;
  border: string;
  moduleWarm: string;
  moduleCool: string;
  highlight: string;
  logoAsset: string;
}

const SUMMER_CAMP_EXPORT_FALLBACK_THEME: SummerCampExportTheme = {
  accent: '#079447',
  accentStrong: '#008E3F',
  ink: '#123F32',
  paper: '#F8F0CF',
  panel: '#FFF8DC',
  border: '#E8E0BF',
  moduleWarm: '#FFF8E4',
  moduleCool: '#EDF7DF',
  highlight: '#F7D84F',
  logoAsset: SUMMER_CAMP_LOGO_ASSET,
};

const readCssVar = (source: HTMLElement, name: string, fallback: string): string => {
  const value = window.getComputedStyle(source).getPropertyValue(name).trim();
  return value || fallback;
};

const cssUrlToAsset = (value: string, fallback: string): string => {
  const clean = value.trim();
  const match = clean.match(/^url\((['"]?)(.*?)\1\)$/);
  if (!match) {
    return fallback;
  }
  return match[2] || fallback;
};

const resolveSummerCampExportTheme = (source: HTMLElement): SummerCampExportTheme => {
  const shell = source.closest<HTMLElement>('.superamber-shell');
  if (!shell || shell.dataset.campMajor === 'L2') {
    return SUMMER_CAMP_EXPORT_FALLBACK_THEME;
  }

  return {
    accent: readCssVar(source, '--camp-accent', SUMMER_CAMP_EXPORT_FALLBACK_THEME.accent),
    accentStrong: readCssVar(source, '--camp-accent-strong', SUMMER_CAMP_EXPORT_FALLBACK_THEME.accentStrong),
    ink: readCssVar(source, '--camp-ink', SUMMER_CAMP_EXPORT_FALLBACK_THEME.ink),
    paper: readCssVar(source, '--camp-paper', SUMMER_CAMP_EXPORT_FALLBACK_THEME.paper),
    panel: readCssVar(source, '--camp-panel', SUMMER_CAMP_EXPORT_FALLBACK_THEME.panel),
    border: readCssVar(source, '--camp-border', SUMMER_CAMP_EXPORT_FALLBACK_THEME.border),
    moduleWarm: readCssVar(source, '--camp-module-warm', SUMMER_CAMP_EXPORT_FALLBACK_THEME.moduleWarm),
    moduleCool: readCssVar(source, '--camp-module-cool', SUMMER_CAMP_EXPORT_FALLBACK_THEME.moduleCool),
    highlight: readCssVar(source, '--camp-highlight', SUMMER_CAMP_EXPORT_FALLBACK_THEME.highlight),
    logoAsset: cssUrlToAsset(readCssVar(source, '--camp-header-logo', ''), SUMMER_CAMP_EXPORT_FALLBACK_THEME.logoAsset),
  };
};

const makeExportImageDecoration = (
  documentRef: Document,
  className: string,
  src: string,
  styles: Partial<CSSStyleDeclaration>,
): HTMLImageElement => {
  const image = documentRef.createElement('img');
  image.className = className;
  image.src = src;
  image.alt = '';
  image.setAttribute('aria-hidden', 'true');
  setInlineStyles(image, styles);
  return image;
};

const buildSummerCampNotesClone = (notesSection: HTMLElement, theme: SummerCampExportTheme): HTMLElement => {
  const notesClone = notesSection.cloneNode(true) as HTMLElement;
  syncExportFormState(notesSection, notesClone);
  copyResolvedStyles(notesSection, notesClone);
  notesClone.querySelectorAll('.todo-board, .notes-toolbar, .notes-width-handle, .notes-height-handle')
    .forEach((node) => node.remove());
  notesClone.querySelectorAll('[contenteditable="true"]').forEach((node) => node.removeAttribute('contenteditable'));

  let header = notesClone.querySelector<HTMLElement>('.notes-header');
  if (!header) {
    header = notesSection.ownerDocument.createElement('div');
    header.className = 'notes-header';
    notesClone.insertBefore(header, notesClone.firstChild);
  }
  header.innerHTML = '<div><strong>Notes</strong><span>今日提醒 / 备注</span></div>';

  setInlineStyles(notesClone, {
    position: 'relative',
    zIndex: '1',
    flex: '0 0 336px',
    width: '336px',
    height: '100%',
    minHeight: '0',
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
    padding: '22px',
    margin: '0',
    boxSizing: 'border-box',
    border: `3px solid color-mix(in srgb, ${theme.ink} 18%, transparent)`,
    borderRadius: '24px',
    background: `linear-gradient(180deg, color-mix(in srgb, ${theme.panel} 96%, #ffffff), color-mix(in srgb, ${theme.moduleCool} 93%, #ffffff))`,
    boxShadow: `0 18px 46px color-mix(in srgb, ${theme.ink} 14%, transparent)`,
    overflow: 'hidden',
  });
  setInlineStyles(header, {
    flex: '0 0 auto',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '10px',
    margin: '0',
    padding: '12px 14px',
    border: `2px solid color-mix(in srgb, ${theme.ink} 12%, transparent)`,
    borderRadius: '16px',
    background: theme.ink,
    color: theme.panel,
    boxShadow: `0 10px 20px color-mix(in srgb, ${theme.ink} 12%, transparent)`,
  });
  setInlineStylesForAll(notesClone, '.notes-header strong', {
    display: 'block',
    color: theme.panel,
    fontSize: '22px',
    lineHeight: '1',
    fontWeight: '900',
  });
  setInlineStylesForAll(notesClone, '.notes-header span', {
    display: 'block',
    marginTop: '4px',
    color: `color-mix(in srgb, ${theme.panel} 78%, transparent)`,
    fontSize: '14px',
    lineHeight: '1.2',
    fontWeight: '800',
  });
  setInlineStyles(notesClone.querySelector<HTMLElement>('.notes-content'), {
    flex: '1 1 auto',
    minHeight: '0',
    width: '100%',
    padding: '18px',
    boxSizing: 'border-box',
    border: `2px solid color-mix(in srgb, ${theme.ink} 12%, transparent)`,
    borderRadius: '18px',
    background: `color-mix(in srgb, ${theme.panel} 92%, #ffffff)`,
    color: theme.ink,
    fontSize: '22px',
    lineHeight: '1.35',
    fontWeight: '800',
    overflow: 'hidden',
    boxShadow: `inset 0 0 0 2px color-mix(in srgb, ${theme.highlight} 18%, transparent)`,
  });
  setInlineStylesForAll(notesClone, '.notes-content img', {
    maxWidth: '100%',
    height: 'auto',
    borderRadius: '14px',
    border: `2px solid color-mix(in srgb, ${theme.ink} 12%, transparent)`,
  });

  return notesClone;
};

const buildSummerCampExportSnapshot = (args: {
  editorView: HTMLElement;
  leftSection: HTMLElement;
  notesSection: HTMLElement | null;
}): HTMLElement => {
  const documentRef = args.editorView.ownerDocument;
  const exportTheme = resolveSummerCampExportTheme(args.leftSection);
  const notesClone = args.notesSection ? buildSummerCampNotesClone(args.notesSection, exportTheme) : null;
  const wrapper = documentRef.createElement('div');
  setInlineStyles(wrapper, {
    position: 'fixed',
    left: '-20000px',
    top: '0',
    zIndex: '-1',
    width: '1600px',
    height: '900px',
    padding: '0',
    margin: '0',
    background: exportTheme.paper,
    boxSizing: 'border-box',
  });
  wrapper.dataset.exportRoot = '1';
  wrapper.dataset.exportRatio = '16:9';

  const frame = documentRef.createElement('div');
  setInlineStyles(frame, {
    position: 'relative',
    width: '1600px',
    height: '900px',
    padding: '34px',
    overflow: 'hidden',
    boxSizing: 'border-box',
    border: `8px solid ${exportTheme.ink}`,
    borderRadius: '34px',
    background: `linear-gradient(135deg, ${exportTheme.panel} 0%, color-mix(in srgb, ${exportTheme.moduleWarm} 72%, #ffffff) 42%, ${exportTheme.moduleCool} 100%)`,
    boxShadow: `inset 0 0 0 8px ${exportTheme.highlight}, inset 0 0 0 14px color-mix(in srgb, ${exportTheme.border} 56%, ${exportTheme.panel})`,
    fontFamily: "'Avenir Next', 'Trebuchet MS', 'PingFang SC', 'Microsoft YaHei', sans-serif",
  });

  frame.append(
    makeExportDecoration(documentRef, 'summer-race-track-top', '', {
      position: 'absolute',
      left: '38px',
      right: '38px',
      top: '18px',
      height: '18px',
      borderRadius: '999px',
      background: `repeating-linear-gradient(90deg, ${exportTheme.ink} 0 18px, ${exportTheme.highlight} 18px 36px)`,
      opacity: '0.22',
    }),
    makeExportDecoration(documentRef, 'summer-race-track-bottom', '', {
      position: 'absolute',
      left: '38px',
      right: '38px',
      bottom: '18px',
      height: '18px',
      borderRadius: '999px',
      background: `repeating-linear-gradient(90deg, #ffffff 0 16px, ${exportTheme.ink} 16px 32px)`,
      opacity: '0.28',
    }),
    makeExportDecoration(documentRef, 'summer-race-flag-left', '🏁', {
      position: 'absolute',
      left: '48px',
      top: '74px',
      fontSize: '46px',
      transform: 'rotate(-12deg)',
      filter: `drop-shadow(0 6px 0 color-mix(in srgb, ${exportTheme.ink} 12%, transparent))`,
    }),
    makeExportDecoration(documentRef, 'summer-race-car', '🏎️', {
      position: 'absolute',
      right: '64px',
      top: '66px',
      fontSize: '54px',
      transform: 'rotate(6deg)',
      filter: `drop-shadow(0 8px 0 color-mix(in srgb, ${exportTheme.ink} 14%, transparent))`,
    }),
    makeExportImageDecoration(documentRef, 'summer-camp-logo-mark', exportTheme.logoAsset, {
      position: 'absolute',
      left: '54px',
      top: '56px',
      width: '132px',
      height: 'auto',
      objectFit: 'contain',
      opacity: '0.22',
      filter: `drop-shadow(0 8px 0 color-mix(in srgb, ${exportTheme.ink} 10%, transparent))`,
    }),
    makeExportImageDecoration(documentRef, 'summer-camp-race-cars-mark', SUMMER_CAMP_RACE_CARS_ASSET, {
      position: 'absolute',
      right: '44px',
      bottom: '54px',
      width: '152px',
      height: 'auto',
      objectFit: 'contain',
      opacity: notesClone ? '0.12' : '0.2',
      filter: `drop-shadow(0 8px 0 color-mix(in srgb, ${exportTheme.ink} 10%, transparent))`,
    }),
    makeExportDecoration(documentRef, 'summer-race-badge', 'SPARKCHAT SPEEDWAY', {
      position: 'absolute',
      right: '126px',
      bottom: '42px',
      padding: '8px 18px',
      borderRadius: '999px',
      background: exportTheme.ink,
      color: exportTheme.panel,
      fontSize: '18px',
      fontWeight: '900',
      letterSpacing: '1px',
      boxShadow: `0 8px 18px color-mix(in srgb, ${exportTheme.ink} 18%, transparent)`,
    }),
    makeExportDecoration(documentRef, 'summer-race-lane-a', '', {
      position: 'absolute',
      right: '-120px',
      top: '158px',
      width: '430px',
      height: '72px',
      transform: 'rotate(-18deg)',
      borderRadius: '999px',
      background: `color-mix(in srgb, ${exportTheme.highlight} 42%, transparent)`,
    }),
    makeExportDecoration(documentRef, 'summer-race-lane-b', '', {
      position: 'absolute',
      left: '-140px',
      bottom: '166px',
      width: '520px',
      height: '76px',
      transform: 'rotate(16deg)',
      borderRadius: '999px',
      background: `color-mix(in srgb, ${exportTheme.accent} 16%, transparent)`,
    }),
  );

  const content = documentRef.createElement('div');
  setInlineStyles(content, {
    position: 'relative',
    zIndex: '1',
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'stretch',
    justifyContent: notesClone ? 'space-between' : 'center',
    gap: notesClone ? '22px' : '0',
    boxSizing: 'border-box',
  });

  const leftClone = args.leftSection.cloneNode(true) as HTMLElement;
  syncExportFormState(args.leftSection, leftClone);
  copyResolvedStyles(args.leftSection, leftClone);
  leftClone.querySelectorAll('.roster-diff-banner').forEach((node) => node.remove());
  leftClone.querySelectorAll('[contenteditable="true"]').forEach((node) => node.removeAttribute('contenteditable'));
  leftClone.querySelectorAll<HTMLInputElement>('input').forEach((input) => {
    input.setAttribute('readonly', 'true');
    input.setAttribute('tabindex', '-1');
  });

  setInlineStyles(leftClone, {
    position: 'relative',
    zIndex: '1',
    flex: notesClone ? '1 1 0' : '0 0 1390px',
    width: notesClone ? 'auto' : '1390px',
    maxWidth: notesClone ? 'none' : '1390px',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
    padding: '26px 34px 30px',
    margin: '0',
    boxSizing: 'border-box',
    border: `3px solid color-mix(in srgb, ${exportTheme.ink} 18%, transparent)`,
    borderRadius: '24px',
    background: `color-mix(in srgb, ${exportTheme.panel} 92%, #ffffff)`,
    boxShadow: `0 18px 46px color-mix(in srgb, ${exportTheme.ink} 16%, transparent)`,
    overflow: 'hidden',
  });

  setInlineStyles(leftClone.querySelector<HTMLElement>('.header'), {
    flex: '0 0 68px',
    height: '68px',
    minHeight: '68px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    margin: '0',
    padding: '0 70px',
    border: '0',
    background: 'transparent',
    boxShadow: 'none',
  });
  setInlineStyles(leftClone.querySelector<HTMLElement>('.summer-camp-seat-title'), {
    width: '100%',
    display: 'block',
    color: exportTheme.ink,
    fontSize: notesClone ? '34px' : '40px',
    lineHeight: '1',
    fontWeight: '900',
    letterSpacing: '0',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textAlign: 'center',
    textShadow: '0 3px 0 rgba(255,255,255,0.76)',
  });
  setInlineStyles(leftClone.querySelector<HTMLElement>('.info-section'), {
    flex: '0 0 58px',
    minHeight: '58px',
    margin: '0',
    padding: '8px 20px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: `2px solid color-mix(in srgb, ${exportTheme.ink} 12%, transparent)`,
    borderRadius: '18px',
    background: exportTheme.panel,
    boxShadow: `inset 0 0 0 2px color-mix(in srgb, ${exportTheme.highlight} 18%, transparent)`,
  });
  setInlineStyles(leftClone.querySelector<HTMLElement>('.camp-arrival-display'), {
    width: '100%',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    gap: '12px',
  });
  setInlineStyles(leftClone.querySelector<HTMLElement>('.camp-arrival-display .emoji'), {
    fontSize: '30px',
  });
  setInlineStyles(leftClone.querySelector<HTMLElement>('.camp-arrival-input'), {
    flex: '0 1 auto',
    width: 'auto',
    minWidth: notesClone ? '720px' : '900px',
    minHeight: '0',
    border: '0',
    padding: '0',
    background: 'transparent',
    color: exportTheme.ink,
    fontSize: '28px',
    lineHeight: '1.15',
    fontWeight: '900',
    textAlign: 'center',
    boxShadow: 'none',
  });
  setInlineStyles(leftClone.querySelector<HTMLElement>('.screen-banner'), {
    flex: '0 0 54px',
    height: '54px',
    minHeight: '54px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    margin: '0',
    padding: '0',
    borderRadius: '18px',
    background: exportTheme.accent,
    color: exportTheme.panel,
    fontSize: '28px',
    fontWeight: '900',
    letterSpacing: '1px',
    boxShadow: `0 10px 20px color-mix(in srgb, ${exportTheme.accent} 18%, transparent)`,
  });
  setInlineStyles(leftClone.querySelector<HTMLElement>('.classroom'), {
    flex: '1 1 0',
    width: '100%',
    height: 'auto',
    maxWidth: 'none',
    maxHeight: 'none',
    minHeight: '0',
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gridTemplateRows: 'repeat(2, auto)',
    gridAutoRows: 'auto',
    gap: '16px 18px',
    alignItems: 'start',
    alignContent: 'center',
    margin: '0',
  });
  setInlineStylesForAll(leftClone, '.camp-group-card', {
    width: '100%',
    minHeight: '0',
    height: 'auto',
    maxWidth: 'none',
    maxHeight: 'none',
    boxSizing: 'border-box',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    padding: '10px',
    borderRadius: '18px',
    borderWidth: '2px',
    boxShadow: `0 8px 18px color-mix(in srgb, ${exportTheme.ink} 9%, transparent)`,
  });
  setInlineStylesForAll(leftClone, '.camp-group-card h3', {
    width: '100%',
    boxSizing: 'border-box',
    flex: '0 0 auto',
    margin: '0 0 8px',
    padding: '8px 10px',
    borderRadius: '12px',
    fontSize: '24px',
    lineHeight: '1.05',
    fontWeight: '900',
  });
  setInlineStylesForAll(leftClone, '.camp-seats', {
    width: '100%',
    flex: '0 0 auto',
    minHeight: '0',
    height: 'auto',
    maxHeight: 'none',
    boxSizing: 'border-box',
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gridAutoRows: 'auto',
    gap: '8px',
    alignContent: 'start',
  });
  setInlineStylesForAll(leftClone, '.camp-seat', {
    width: '100%',
    minHeight: '52px',
    height: '52px',
    boxSizing: 'border-box',
    overflow: 'hidden',
    borderRadius: '12px',
    borderWidth: '2px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  });
  setInlineStylesForAll(leftClone, '.camp-seat input', {
    width: '100%',
    height: '100%',
    minHeight: '0',
    minWidth: '0',
    boxSizing: 'border-box',
    border: '0',
    padding: '0 8px',
    background: 'transparent',
    color: exportTheme.ink,
    fontSize: '22px',
    lineHeight: '1',
    fontWeight: '900',
    textAlign: 'center',
    boxShadow: 'none',
  });

  content.appendChild(leftClone);
  if (notesClone) {
    content.appendChild(notesClone);
  }
  frame.appendChild(content);
  wrapper.appendChild(frame);
  documentRef.body.appendChild(wrapper);
  return wrapper;
};

export function buildExportSnapshot(args: {
  editorView: HTMLElement;
  notesRoot: HTMLElement;
}): HTMLElement | null {
  const leftSection = args.editorView.querySelector<HTMLElement>('.left-section');
  const notesSection = hasNotesContent(args.notesRoot)
    ? args.editorView.querySelector<HTMLElement>('.notes-section')
    : null;

  if (!leftSection) {
    return null;
  }

  if (args.editorView.closest('.is-summer-camp-site')) {
    return buildSummerCampExportSnapshot({
      editorView: args.editorView,
      leftSection,
      notesSection,
    });
  }

  const documentRef = args.editorView.ownerDocument;
  const wrapper = documentRef.createElement('div');
  wrapper.style.position = 'fixed';
  wrapper.style.left = '-20000px';
  wrapper.style.top = '0';
  wrapper.style.zIndex = '-1';
  wrapper.style.padding = '0';
  wrapper.style.margin = '0';
  wrapper.style.background = '#ffffff';
  wrapper.style.display = 'flex';
  wrapper.style.gap = '24px';
  wrapper.style.alignItems = 'flex-start';
  wrapper.dataset.exportRoot = '1';

  const leftClone = leftSection.cloneNode(true) as HTMLElement;
  syncExportFormState(leftSection, leftClone);
  copyResolvedStyles(leftSection, leftClone);
  leftClone.style.position = 'static';
  wrapper.appendChild(leftClone);

  if (notesSection) {
    const notesClone = notesSection.cloneNode(true) as HTMLElement;
    syncExportFormState(notesSection, notesClone);
    copyResolvedStyles(notesSection, notesClone);
    notesClone.style.position = 'static';
    notesClone.querySelectorAll('.notes-header, .notes-toolbar, .notes-width-handle, .notes-height-handle').forEach((node) => node.remove());
    wrapper.appendChild(notesClone);
  }

  documentRef.body.appendChild(wrapper);
  return wrapper;
}

type ExportImageOptions = {
  preferCanvas?: boolean;
  backgroundColor?: string;
};

export async function requestExportImageBlob(exportTarget: HTMLElement, options: ExportImageOptions = {}): Promise<Blob> {
  const font = await prepareExportFont({ target: exportTarget });
  const { toBlob } = await import('html-to-image');
  const { default: html2canvas } = await import('html2canvas');
  const backgroundColor = options.backgroundColor || '#ffffff';
  // Only the dedicated off-screen seating export root needs repositioning. A visible
  // report must stay in place while it is rendered, otherwise the page flashes white.
  const shouldReposition = exportTarget.dataset.exportRoot === '1';
  const originalLeft = exportTarget.style.left;
  const originalTop = exportTarget.style.top;
  const originalZIndex = exportTarget.style.zIndex;
  if (shouldReposition) {
    exportTarget.style.left = '0';
    exportTarget.style.top = '0';
    exportTarget.style.zIndex = '-1';
  }
  const width = Math.max(exportTarget.scrollWidth, exportTarget.offsetWidth, 1);
  const height = Math.max(exportTarget.scrollHeight, exportTarget.offsetHeight, 1);
  const maxPixels = 16_000_000;
  const adaptiveScale = Math.max(0.1, Math.min(1.6, 4096 / width, 4096 / height, Math.sqrt(maxPixels / (width * height))));

  const renderWithCanvas = async (): Promise<Blob> => {
    const canvas = await html2canvas(exportTarget, {
      backgroundColor,
      scale: adaptiveScale,
      useCORS: true,
      logging: false,
      width,
      height,
      windowWidth: Math.max(document.documentElement.clientWidth, width),
      windowHeight: Math.max(document.documentElement.clientHeight, height),
      onclone: async (clonedDocument: Document) => {
        // html2canvas has its own document and FontFaceSet: loading the parent
        // document alone does not make the export copy ready.
        await prepareExportFont({ document: clonedDocument, source: font.dataUrl });
      },
    });
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob || blob.size === 0) throw new Error('图片生成失败');
    return blob;
  };

  const renderWithHtmlToImage = async (): Promise<Blob> => {
    const imageBlob = await toBlob(exportTarget, {
      cacheBust: true,
      pixelRatio: adaptiveScale,
      backgroundColor,
      width,
      height,
      fontEmbedCSS: font.css,
    });
    if (!imageBlob || imageBlob.size === 0) throw new Error('图片生成失败');
    return imageBlob;
  };

  try {
    if (options.preferCanvas) {
      try { return await renderWithCanvas(); } catch (error) {
        if ((error as { code?: string })?.code === 'EXPORT_FONT_UNAVAILABLE') throw error;
        return renderWithHtmlToImage();
      }
    }
    try { return await renderWithHtmlToImage(); } catch (error) {
      if ((error as { code?: string })?.code === 'EXPORT_FONT_UNAVAILABLE') throw error;
      return renderWithCanvas();
    }
  } finally {
    if (shouldReposition) {
      exportTarget.style.left = originalLeft;
      exportTarget.style.top = originalTop;
      exportTarget.style.zIndex = originalZIndex;
    }
  }
}

export async function deliverExportImageBlob(
  blob: Blob,
  _className: string,
  options: { alwaysDownload?: boolean } = {},
): Promise<string> {
  const fileBaseName = String(_className || '').trim() || '座位表';
  const fileName = `${fileBaseName.replace(/[\\/:*?"<>|]+/g, '_')}.png`;
  const downloadImage = (): void => {
    if (typeof URL.createObjectURL !== 'function') {
      throw new Error('当前浏览器不支持导出图片，请改用微信内打开或桌面浏览器。');
    }

    const imageUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = imageUrl;
    link.download = fileName;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    document.body.appendChild(link);
    link.click();
    window.setTimeout(() => {
      link.remove();
    }, 1000);
    window.setTimeout(() => {
      URL.revokeObjectURL(imageUrl);
    }, 60000);
  };

  if (options.alwaysDownload) downloadImage();

  const canWriteImage = typeof ClipboardItem !== 'undefined'
    && !!navigator.clipboard
    && typeof navigator.clipboard.write === 'function';

  if (canWriteImage) {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      return options.alwaysDownload
        ? '座位表已下载，同时已复制到剪贴板，可直接粘贴发送。'
        : '座位表已生成，图片已复制到剪贴板，可直接粘贴发送。';
    } catch {
      if (!options.alwaysDownload) downloadImage();
      return options.alwaysDownload
        ? '图片已下载；当前浏览器未允许自动复制，可直接发送下载的文件。'
        : '当前浏览器限制了直接复制图片，已改为下载或打开图片。请长按保存，或直接发送图片。';
    }
  }

  if (!options.alwaysDownload) downloadImage();
  return options.alwaysDownload
    ? '图片已下载；当前浏览器不支持自动复制图片。'
    : '当前浏览器不支持自动复制图片，已改为下载或打开图片。请长按保存，或直接发送图片。';
}
