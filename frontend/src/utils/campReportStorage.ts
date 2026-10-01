export interface CampReportTemplate {
  id: string;
  majorCamp: string;
  minorCamp: string;
  dayIndex: number;
  defaultDisplayCampName: string;
  goalText: string;
  prepText: string;
  backgroundImage: string;
  updatedAt: number;
}

export interface CampReportPalette {
  accent: string;
  accentSoft: string;
  accentStrong: string;
  ink: string;
  paper: string;
  panel: string;
  border: string;
  moduleWarm: string;
  moduleCool: string;
  moduleWarmBorder: string;
  moduleCoolBorder: string;
  highlight: string;
}

export interface CampReportThemeConfig {
  majorCamp: string;
  logoImage: string;
  palette: CampReportPalette;
  source: 'default' | 'logo' | 'image' | 'manual';
  updatedAt: number;
}

export interface CampReportPerformanceRow {
  id: string;
  englishName: string;
  chineseName: string;
  wordMastery: string;
  dialogueMastery: string;
  attendance: string;
  implementation: string;
  racingTitle: string;
  remark: string;
  studentName?: string;
  initiative?: string;
  dialogue?: string;
  supplies?: string;
}

export type CampReportHighlightFrame = 'none' | 'crown' | 'racing' | 'excellent' | 'good-job' | 'spark' | 'all-star';
export type CampReportHighlightColumns = 1 | 2 | 3;
export type CampReportTextAlign = 'left' | 'center' | 'right';

export interface CampReportHighlight {
  id: string;
  image: string;
  title: string;
  reason: string;
  fit?: CampReportCustomImageFit;
  frame?: CampReportHighlightFrame;
}

export interface CampReportPrepSections {
  afterClassTitle: string;
  afterClassText: string;
  suppliesTitle: string;
  suppliesText: string;
}

export type CampReportCustomImageSize = 'third' | 'half' | 'full';
export type CampReportCustomImageFit = 'cover' | 'contain';

export interface CampReportFooterBlock {
  id: string;
  type: 'text' | 'image';
  text?: string;
  image?: string;
  fontSize?: number;
  align?: CampReportTextAlign;
  color?: string;
  fit?: CampReportCustomImageFit;
}

export interface CampReportCustomImage {
  id: string;
  image: string;
  caption: string;
  size: CampReportCustomImageSize;
  fit: CampReportCustomImageFit;
}

export interface CampReportCustomSection {
  id: string;
  title: string;
  body: string;
  images: CampReportCustomImage[];
}

export type CampReportOptionalSectionKey = 'summary' | 'challenge' | 'reminder' | 'highlights';

export interface CampReportDraft {
  id: string;
  reportDate: string;
  dayLabel: string;
  majorCamp: string;
  minorCamp: string;
  displayCampName: string;
  goalText: string;
  classroomObservationTitle?: string;
  classroomObservation?: string;
  performanceRawText: string;
  performanceColumnLabels?: string[];
  performanceRows: CampReportPerformanceRow[];
  prepText: string;
  prepSections?: CampReportPrepSections;
  afterClassImage: string;
  suppliesImage: string;
  afterClassBlocks?: CampReportFooterBlock[];
  suppliesBlocks?: CampReportFooterBlock[];
  highlights: CampReportHighlight[];
  highlightColumns?: CampReportHighlightColumns;
  customSections?: CampReportCustomSection[];
  sectionVisibility?: Partial<Record<CampReportOptionalSectionKey, boolean>>;
  sectionOrder?: CampReportOptionalSectionKey[];
  backgroundImage: string;
  updatedAt: number;
}

export interface SummerCampLaunchPreference {
  majorCamp: string;
  minorCamp?: string;
  reportDate?: string;
  lastTool?: 'report' | 'seating';
  updatedAt: number;
}

const TEMPLATE_KEY = 'amber_camp_report_templates_v1';
const DRAFT_KEY = 'amber_camp_report_drafts_v1';
const THEME_KEY = 'amber_camp_report_themes_v1';
const LAUNCH_PREFERENCE_STORAGE_ID = 'amber_summer_camp_launch_pref_v1';

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value));
}

export function getCampTemplateKey(majorCamp: string, minorCamp: string, dayIndex: number) {
  return `${String(majorCamp).trim()}__${String(minorCamp).trim()}__${Number(dayIndex) || 0}`;
}

export function getCampDraftKey(reportDate: string, majorCamp: string, minorCamp: string, dayLabel: string) {
  return `${reportDate}__${String(majorCamp).trim()}__${String(minorCamp).trim()}__${String(dayLabel).trim()}`;
}

export function loadCampReportTemplates(): Record<string, CampReportTemplate> {
  return readJson<Record<string, CampReportTemplate>>(TEMPLATE_KEY, {});
}

export function saveCampReportTemplates(templates: Record<string, CampReportTemplate>) {
  writeJson(TEMPLATE_KEY, templates);
}

export function getCampReportTemplate(majorCamp: string, minorCamp: string, dayIndex: number): CampReportTemplate | null {
  const key = getCampTemplateKey(majorCamp, minorCamp, dayIndex);
  return loadCampReportTemplates()[key] || null;
}

export function upsertCampReportTemplate(template: CampReportTemplate) {
  const all = loadCampReportTemplates();
  const key = getCampTemplateKey(template.majorCamp, template.minorCamp, template.dayIndex);
  all[key] = template;
  saveCampReportTemplates(all);
}

export function loadCampReportThemeConfigs(): Record<string, CampReportThemeConfig> {
  return readJson<Record<string, CampReportThemeConfig>>(THEME_KEY, {});
}

export function saveCampReportThemeConfigs(configs: Record<string, CampReportThemeConfig>) {
  writeJson(THEME_KEY, configs);
}

export function getCampReportThemeConfig(majorCamp: string): CampReportThemeConfig | null {
  return loadCampReportThemeConfigs()[String(majorCamp).trim()] || null;
}

export function upsertCampReportThemeConfig(config: CampReportThemeConfig) {
  const all = loadCampReportThemeConfigs();
  all[String(config.majorCamp).trim()] = config;
  saveCampReportThemeConfigs(all);
}

export function deleteCampReportThemeConfig(majorCamp: string) {
  const all = loadCampReportThemeConfigs();
  delete all[String(majorCamp).trim()];
  saveCampReportThemeConfigs(all);
}

export function loadCampReportDrafts(): Record<string, CampReportDraft> {
  return readJson<Record<string, CampReportDraft>>(DRAFT_KEY, {});
}

export function saveCampReportDrafts(drafts: Record<string, CampReportDraft>) {
  writeJson(DRAFT_KEY, drafts);
}

export function getCampReportDraft(reportDate: string, majorCamp: string, minorCamp: string, dayLabel: string): CampReportDraft | null {
  const key = getCampDraftKey(reportDate, majorCamp, minorCamp, dayLabel);
  return loadCampReportDrafts()[key] || null;
}

export function upsertCampReportDraft(draft: CampReportDraft) {
  const all = loadCampReportDrafts();
  const key = getCampDraftKey(draft.reportDate, draft.majorCamp, draft.minorCamp, draft.dayLabel);
  all[key] = draft;
  saveCampReportDrafts(all);
}

export function loadSummerCampLaunchPreference(): SummerCampLaunchPreference | null {
  const preference = readJson<Partial<SummerCampLaunchPreference> | null>(LAUNCH_PREFERENCE_STORAGE_ID, null);
  if (!preference || typeof preference !== 'object') {
    return null;
  }

  const majorCamp = typeof preference.majorCamp === 'string' ? preference.majorCamp.trim() : '';
  if (!majorCamp) {
    return null;
  }

  return {
    majorCamp,
    minorCamp: typeof preference.minorCamp === 'string' ? preference.minorCamp.trim() : undefined,
    reportDate: typeof preference.reportDate === 'string' ? preference.reportDate.trim() : undefined,
    lastTool: preference.lastTool === 'report' || preference.lastTool === 'seating'
      ? preference.lastTool
      : 'report',
    updatedAt: typeof preference.updatedAt === 'number' ? preference.updatedAt : Date.now(),
  };
}

export function saveSummerCampLaunchPreference(preference: Omit<SummerCampLaunchPreference, 'updatedAt'>) {
  writeJson(LAUNCH_PREFERENCE_STORAGE_ID, {
    ...preference,
    updatedAt: Date.now(),
  });
}
