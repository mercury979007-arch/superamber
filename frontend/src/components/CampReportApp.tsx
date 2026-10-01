import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, CSSProperties, DragEvent, FocusEvent, KeyboardEvent, MouseEvent, PointerEvent, SyntheticEvent } from 'react';
import {
  deleteCampReportThemeConfig,
  getCampReportDraft,
  getCampTemplateKey,
  loadSummerCampLaunchPreference,
  loadCampReportThemeConfigs,
  loadCampReportTemplates,
  saveSummerCampLaunchPreference,
  saveCampReportTemplates,
  type CampReportCustomImage,
  type CampReportCustomImageFit,
  type CampReportCustomImageSize,
  type CampReportCustomSection,
  type CampReportDraft,
  type CampReportFooterBlock,
  type CampReportHighlight,
  type CampReportHighlightColumns,
  type CampReportHighlightFrame,
  type CampReportOptionalSectionKey,
  type CampReportPerformanceRow,
  type CampReportPrepSections,
  type CampReportTextAlign,
  type CampReportTemplate,
  type CampReportThemeConfig,
  upsertCampReportDraft,
  upsertCampReportThemeConfig,
} from '../utils/campReportStorage';
import {
  buildCampThemeVars,
  CAMP_THEME_UPDATED_EVENT,
  createPaletteFromAccent,
  extractDominantColorFromImage,
  getDefaultCampTheme,
  normalizePalette,
  resolveCampReportTheme,
  type CampReportPalette,
} from '../utils/campReportTheme';
import {
  CAMP_DAY_OPTIONS,
  CAMP_MAJOR_OPTIONS,
  CAMP_MINOR_OPTIONS,
  buildGoalTextFromPlan,
  buildPrepTextFromPlan,
  findCampDayPlan,
  getCampReportDateOptions,
  getDefaultCampReportDate,
  getMajorCampName,
  resolveCampReportLaunchDate,
  type CampMajorLevel,
} from '../data/campReportCatalog';
import './CampReportApp.css';

interface Props {
  onBack: () => void;
}

type ViewMode = 'editor' | 'config';
type ImportedGoalEntry = { title: string; body: string };
type ImportedTopicGoalMap = Record<string, ImportedGoalEntry[]>;

const MINOR_CAMPS = CAMP_MINOR_OPTIONS;
const DAY_OPTIONS = CAMP_DAY_OPTIONS;
const ADMIN_SESSION_KEY = 'amber_camp_report_admin_unlocked_v1';
const CAMP_REPORT_TEMPLATES_ENDPOINT = '/api/camp-report/templates';
const CAMP_REPORT_TEMPLATE_BULK_ENDPOINT = '/api/camp-report/templates/bulk';
const CAMP_REPORT_ADMIN_UNLOCK_ENDPOINT = '/api/camp-report/admin/unlock';
const AUTOSAVE_DRAFT_DELAY_MS = 900;
const TEMPLATE_IMPORT_SAMPLE_TEXT = [
  '日期\t对应营内日期\t对应营内话题\t大营\t小营\t词句掌握目标\t对话掌握目标\t课堂运行目标\t课堂习惯目标',
  '2026-07-20\tD1\tTopic 1\tSparkchat\tCamp 1，3，5，7\t建立礼貌请求沟通路径\t练习 Can I borrow...? 等句型\t培养礼貌求助和协商意识\t',
].join('\n');
const DEFAULT_MAJOR_CAMP: CampMajorLevel = 'L2';
const DEFAULT_MINOR_CAMP = 'Camp 1';
const DEFAULT_REPORT_DATE = getDefaultCampReportDate(DEFAULT_MAJOR_CAMP, DEFAULT_MINOR_CAMP);
const LAST_BASIC_SELECTION_KEY = 'amber_camp_report_last_basic_v1';
const FALLBACK_DAY_INDEX = 3;
const STUDENT_ROW_COUNT = 45;
const LEGACY_AFTER_CLASS_IMAGE = '/assets/public-placeholder.svg';
const LEGACY_SUPPLIES_IMAGE = '/assets/public-placeholder.svg';
const MAX_UPLOAD_IMAGE_EDGE = 1600;
const MAX_UPLOAD_IMAGE_DATA_URL_LENGTH = 950_000;
const IMAGE_READY_TIMEOUT_MS = 12_000;
const L2_AFTER_CLASS_IMAGE = '/assets/public-placeholder.svg';
const GOAL_SECTION_TITLE = '今日竞赛里程';
const TEACHING_GOAL_TITLE = '冲刺目标';
const MORAL_GOAL_TITLE = '运行目标';
const SUMMARY_SECTION_TITLE = '竞速巅峰榜单';
const CHALLENGE_SECTION_TITLE = '赛后加油站';
const REMINDER_SECTION_TITLE = '明日提醒';
const HIGHLIGHTS_SECTION_TITLE = '精彩瞬间';
const DEFAULT_CLASSROOM_OBSERVATION_TITLE = SUMMARY_SECTION_TITLE;
const DEFAULT_PERFORMANCE_COLUMN_LABELS = ['英文名', '中文名', '词句掌握', '对话掌握', '考勤到课', '落实完成', '竞速称号', '文字备注'];
type CampReportPerformanceField = 'englishName' | 'chineseName' | 'wordMastery' | 'dialogueMastery' | 'attendance' | 'implementation' | 'racingTitle' | 'remark';
const PERFORMANCE_ROW_FIELDS: CampReportPerformanceField[] = [
  'englishName',
  'chineseName',
  'wordMastery',
  'dialogueMastery',
  'attendance',
  'implementation',
  'racingTitle',
  'remark',
];
const DEFAULT_CUSTOM_IMAGE_SIZE: CampReportCustomImageSize = 'half';
const DEFAULT_CUSTOM_IMAGE_FIT: CampReportCustomImageFit = 'contain';
const DEFAULT_HIGHLIGHT_COLUMNS: CampReportHighlightColumns = 2;
const DEFAULT_HIGHLIGHT_FRAME: CampReportHighlightFrame = 'crown';
const DEFAULT_FOOTER_TEXT_FONT_SIZE = 16;
const MIN_FOOTER_TEXT_FONT_SIZE = 10;
const MAX_FOOTER_TEXT_FONT_SIZE = 22;
const FOOTER_TEXT_COLOR_FALLBACK = '#164A35';
type CampReportFooterTarget = 'afterClass' | 'supplies';
type ImageCropTarget =
  | { kind: 'footer'; target: CampReportFooterTarget; id: string; image: string }
  | { kind: 'highlight'; id: string; image: string }
  | { kind: 'custom'; sectionId: string; imageId: string; image: string };
type CropSelection = { x: number; y: number; width: number; height: number };
type CropDragMode = 'create' | 'move' | 'nw' | 'ne' | 'sw' | 'se';
type CropPoint = { x: number; y: number };
type CropDragState = {
  mode: CropDragMode;
  startPoint: CropPoint;
  startSelection: CropSelection;
};
const DEFAULT_CROP_SELECTION: CropSelection = { x: 10, y: 10, width: 80, height: 80 };
const MIN_CROP_PERCENT = 6;
const HIGHLIGHT_COLUMN_OPTIONS: Array<{ value: CampReportHighlightColumns; label: string }> = [
  { value: 1, label: '每行 1 张' },
  { value: 2, label: '每行 2 张' },
  { value: 3, label: '每行 3 张' },
];
const FOOTER_TEXT_ALIGN_OPTIONS: Array<{ value: CampReportTextAlign; label: string }> = [
  { value: 'left', label: '左对齐' },
  { value: 'center', label: '居中' },
  { value: 'right', label: '右对齐' },
];
const HIGHLIGHT_FRAME_OPTIONS: Array<{ value: CampReportHighlightFrame; label: string }> = [
  { value: 'none', label: '不使用外框' },
  { value: 'crown', label: '1 · 绿色手绘 Super Star' },
  { value: 'racing', label: '2 · 黄色手绘 Good Job' },
  { value: 'excellent', label: '3 · 拍立得 Super Star' },
  { value: 'good-job', label: '4 · 赛道边框 Nice Work' },
  { value: 'spark', label: '5 · 奖章虚线 Great' },
  { value: 'all-star', label: '6 · 白边大贴纸 All Star' },
];
const DEFAULT_SECTION_VISIBILITY: Record<CampReportOptionalSectionKey, boolean> = {
  summary: true,
  challenge: false,
  reminder: false,
  highlights: true,
};
const DEFAULT_SECTION_ORDER: CampReportOptionalSectionKey[] = ['summary', 'challenge', 'reminder', 'highlights'];
type ExportAction = 'download' | 'clipboard';
const OPTIONAL_SECTION_LABELS: Record<CampReportOptionalSectionKey, string> = {
  summary: SUMMARY_SECTION_TITLE,
  challenge: CHALLENGE_SECTION_TITLE,
  reminder: REMINDER_SECTION_TITLE,
  highlights: HIGHLIGHTS_SECTION_TITLE,
};
const DEFAULT_COLLAPSED_EDITOR_SECTIONS: Record<string, boolean> = {
  moduleManager: true,
  goals: true,
  challenge: true,
  reminder: true,
  highlights: true,
  customSections: true,
  background: true,
};
const THEME_COLOR_FIELDS: Array<{ key: keyof CampReportPalette; label: string }> = [
  { key: 'accent', label: '主色' },
  { key: 'accentStrong', label: '深主色' },
  { key: 'accentSoft', label: '浅底色' },
  { key: 'paper', label: '画布底色' },
  { key: 'moduleWarm', label: '模块色 A' },
  { key: 'moduleCool', label: '模块色 B' },
  { key: 'border', label: '边框色' },
  { key: 'ink', label: '文字色' },
  { key: 'highlight', label: '强调色' },
];

function createId(prefix: string) {
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now()}_${random}`;
}

interface EditablePreviewTextProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  multiline?: boolean;
  placeholder?: string;
  style?: CSSProperties;
}

function EditablePreviewText({
  value,
  onChange,
  className = '',
  multiline = false,
  placeholder = '',
  style,
}: EditablePreviewTextProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const editorRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!editing) {
      setDraft(value);
    }
  }, [editing, value]);

  useEffect(() => {
    if (!editing) return;
    const target = editorRef.current;
    if (!target) return;
    target.focus();
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      target.select();
    }
  }, [editing]);

  function commit(nextValue: string) {
    const normalized = multiline ? nextValue.replace(/\n{3,}/g, '\n\n').trim() : nextValue.replace(/\s+/g, ' ').trim();
    setEditing(false);
    setDraft(normalized);
    if (normalized !== value) {
      onChange(normalized);
    }
  }

  if (editing) {
    const commonProps = {
      className: `camp-editable-preview is-editing ${className}`.trim(),
      style,
      spellCheck: false,
      value: draft,
      onClick: (event: MouseEvent<HTMLInputElement | HTMLTextAreaElement>) => event.stopPropagation(),
      onBlur: (event: FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => commit(event.currentTarget.value),
      onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(event.currentTarget.value),
      onKeyDown: (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        event.stopPropagation();
        if (event.key === 'Escape') {
          event.preventDefault();
          setEditing(false);
          setDraft(value);
        }
        if (event.key === 'Enter' && !multiline) {
          event.preventDefault();
          commit(event.currentTarget.value);
        }
      },
    };
    const setEditorElement = (element: HTMLInputElement | HTMLTextAreaElement | null) => {
      editorRef.current = element;
    };

    return multiline
      ? <textarea {...commonProps} ref={setEditorElement} rows={Math.max(2, draft.split(/\n/).length)} />
      : <input {...commonProps} ref={setEditorElement} />;
  }

  return (
    <div
      className={`camp-editable-preview ${className}`.trim()}
      style={style}
      title="双击编辑"
      onDoubleClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setDraft(value);
        setEditing(true);
      }}
    >
      {value || placeholder}
    </div>
  );
}

function formatDateLabel(date: string) {
  const parsed = new Date(`${date}T00:00:00`);
  const safeDate = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  return safeDate.toLocaleDateString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
  });
}

function buildDefaultDisplayName(majorCamp: string, minorCamp: string) {
  return [getMajorCampName(majorCamp), minorCamp].filter(Boolean).join(' ');
}

interface CampReportBasicSelection {
  majorCamp: CampMajorLevel;
  minorCamp: string;
  reportDate: string;
  displayCampName: string;
}

const DEFAULT_BASIC_SELECTION: CampReportBasicSelection = {
  majorCamp: DEFAULT_MAJOR_CAMP,
  minorCamp: DEFAULT_MINOR_CAMP,
  reportDate: DEFAULT_REPORT_DATE,
  displayCampName: buildDefaultDisplayName(DEFAULT_MAJOR_CAMP, DEFAULT_MINOR_CAMP),
};

function isCampMajorLevel(value: string): value is CampMajorLevel {
  return CAMP_MAJOR_OPTIONS.some((item) => item.level === value);
}

function loadLastBasicSelection(): CampReportBasicSelection {
  if (typeof window === 'undefined') return DEFAULT_BASIC_SELECTION;

  try {
    const saved = window.localStorage.getItem(LAST_BASIC_SELECTION_KEY);
    const parsed = saved ? JSON.parse(saved) as Partial<CampReportBasicSelection> : null;
    const launchPreference = loadSummerCampLaunchPreference();
    const preferredMajor = typeof launchPreference?.majorCamp === 'string' && isCampMajorLevel(launchPreference.majorCamp)
      ? launchPreference.majorCamp
      : '';
    const preferredMinor = typeof launchPreference?.minorCamp === 'string' && MINOR_CAMPS.includes(launchPreference.minorCamp)
      ? launchPreference.minorCamp
      : '';
    const majorCamp = preferredMajor
      || (typeof parsed?.majorCamp === 'string' && isCampMajorLevel(parsed.majorCamp) ? parsed.majorCamp : DEFAULT_MAJOR_CAMP);
    const minorCamp = preferredMinor
      || (typeof parsed?.minorCamp === 'string' && MINOR_CAMPS.includes(parsed.minorCamp) ? parsed.minorCamp : DEFAULT_MINOR_CAMP);
    const dateOptions = getCampReportDateOptions();
    const preferredDate = resolveCampReportLaunchDate(
      typeof launchPreference?.reportDate === 'string'
        ? launchPreference.reportDate
        : typeof parsed?.reportDate === 'string'
          ? parsed.reportDate
          : undefined,
    );
    const reportDate = preferredDate && dateOptions.some((item) => item.date === preferredDate)
      ? preferredDate
      : getDefaultCampReportDate(majorCamp, minorCamp);
    const fallbackDisplayName = buildDefaultDisplayName(majorCamp, minorCamp);
    const displayCampName = typeof parsed?.displayCampName === 'string'
      && parsed?.majorCamp === majorCamp
      && parsed?.minorCamp === minorCamp
      ? parsed.displayCampName
      : fallbackDisplayName;

    return {
      majorCamp,
      minorCamp,
      reportDate,
      displayCampName,
    };
  } catch (error) {
    console.warn('读取日报基础信息本地记忆失败', error);
    return DEFAULT_BASIC_SELECTION;
  }
}

function saveLastBasicSelection(selection: CampReportBasicSelection) {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(LAST_BASIC_SELECTION_KEY, JSON.stringify(selection));
    saveSummerCampLaunchPreference({
      majorCamp: selection.majorCamp,
      minorCamp: selection.minorCamp,
      reportDate: selection.reportDate,
      lastTool: 'report',
    });
  } catch (error) {
    console.warn('保存日报基础信息本地记忆失败', error);
  }
}

function isAdminSessionUnlocked() {
  if (typeof window === 'undefined') return false;
  return window.sessionStorage.getItem(ADMIN_SESSION_KEY) === 'true';
}

function setAdminSessionUnlocked() {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(ADMIN_SESSION_KEY, 'true');
}

function getTemplateFromMap(
  templates: Record<string, CampReportTemplate>,
  majorCamp: string,
  minorCamp: string,
  dayIndex: number,
) {
  return templates[getCampTemplateKey(majorCamp, minorCamp, dayIndex)] || null;
}

function getDefaultAfterClassImage(majorCamp: string) {
  return majorCamp === 'L2' ? L2_AFTER_CLASS_IMAGE : '';
}

function isTemplateNewerThanDraft(
  template: CampReportTemplate | null,
  draft: CampReportDraft | null,
) {
  if (!template || !draft) return false;
  return (Number(template.updatedAt) || 0) > (Number(draft.updatedAt) || 0);
}

function isLegacyGoalDraft(goalText: string) {
  const text = String(goalText || '');
  return !text.includes('今日总里程')
    && /(冲刺目标|运行目标|教学目标|德育目标)\d*：/.test(text);
}

function shouldUseSharedTemplateOverDraft(
  template: CampReportTemplate | null,
  draft: CampReportDraft | null,
) {
  if (!template || !draft) return false;
  if (isTemplateNewerThanDraft(template, draft)) return true;
  return template.goalText.includes('今日总里程') && isLegacyGoalDraft(draft.goalText ?? '');
}

function normalizeTemplateMap(value: unknown): Record<string, CampReportTemplate> {
  if (!value || typeof value !== 'object') return {};
  return Object.entries(value as Record<string, CampReportTemplate>).reduce<Record<string, CampReportTemplate>>((result, [key, template]) => {
    if (template && typeof template === 'object') {
      result[key] = template;
    }
    return result;
  }, {});
}

export async function parseTemplateApiResponse(response: Response) {
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(String((payload as { error?: unknown } | null)?.error || '请求失败'));
  }
  if (!contentType.includes('application/json') || !payload || typeof payload !== 'object') {
    throw new Error('模板接口返回格式无效');
  }
  return {
    ...payload,
    templates: normalizeTemplateMap(payload?.templates),
  };
}

async function fetchSharedCampReportTemplates() {
  const response = await fetch(CAMP_REPORT_TEMPLATES_ENDPOINT, {
    credentials: 'same-origin',
  });
  return parseTemplateApiResponse(response);
}

async function verifyCampReportAdminPassword(password: string) {
  const response = await fetch(CAMP_REPORT_ADMIN_UNLOCK_ENDPOINT, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  return parseTemplateApiResponse(response);
}

async function saveSharedCampReportTemplate(password: string, template: CampReportTemplate) {
  const response = await fetch(CAMP_REPORT_TEMPLATES_ENDPOINT, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password, template }),
  });
  return parseTemplateApiResponse(response);
}

async function saveSharedCampReportTemplates(password: string, templates: CampReportTemplate[]) {
  const response = await fetch(CAMP_REPORT_TEMPLATE_BULK_ENDPOINT, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password, templates }),
  });
  return parseTemplateApiResponse(response);
}

function normalizeTemplateImportHeader(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, '');
}

function parseDelimitedImportLine(line: string, delimiter: string) {
  const cells: string[] = [];
  let current = '';
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"') {
      if (quoted && next === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (char === delimiter && !quoted) {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }

  cells.push(current.trim());
  return cells;
}

function parseImportRows(rawText: string) {
  const rows = rawText
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (rows.length === 0) return [];
  const delimiter = rows[0].includes('\t') ? '\t' : ',';
  return rows.map((line) => parseDelimitedImportLine(line, delimiter));
}

function cleanImportedTemplateBlock(value: unknown) {
  return String(value ?? '').replace(/\\n/g, '\n').trim();
}

function getImportCell(
  record: Record<string, unknown>,
  aliases: string[],
) {
  const normalizedRecord = Object.entries(record).reduce<Record<string, unknown>>((result, [key, value]) => {
    result[normalizeTemplateImportHeader(key)] = value;
    return result;
  }, {});
  const targetKeys = aliases.map(normalizeTemplateImportHeader);
  const matchedKey = targetKeys.find((key) => key in normalizedRecord);
  return matchedKey ? cleanImportedTemplateBlock(normalizedRecord[matchedKey]) : '';
}

function normalizeImportedMajorCamp(value: string): CampMajorLevel | null {
  const normalized = value.trim();
  if (!normalized) return null;
  const exact = CAMP_MAJOR_OPTIONS.find((item) => item.level === normalized);
  if (exact) return exact.level;
  const matched = CAMP_MAJOR_OPTIONS.find((item) => item.label.includes(normalized) || normalized.includes(item.level));
  return matched?.level || null;
}

function normalizeImportedMinorCamp(value: string) {
  const normalized = value.trim();
  const compact = normalized.replace(/\s+/g, '').toLowerCase();
  return MINOR_CAMPS.find((item) => item === normalized || item.replace(/\s+/g, '').toLowerCase() === compact) || '';
}

function expandImportedMinorCamps(value: string) {
  const direct = normalizeImportedMinorCamp(value);
  if (direct) return [direct];

  const matchedNumbers = Array.from(value.matchAll(/\d+/g))
    .map((match) => Number(match[0]))
    .filter((number) => Number.isFinite(number));
  const camps = matchedNumbers
    .map((number) => `Camp ${number}`)
    .filter((camp) => MINOR_CAMPS.includes(camp));

  return Array.from(new Set(camps));
}

function normalizeImportedDayIndex(value: string) {
  const matched = value.match(/\d+/);
  const dayIndex = matched ? Number(matched[0]) : Number(value);
  return DAY_OPTIONS.includes(dayIndex) ? dayIndex : 0;
}

function cleanImportedOptionalCell(
  record: Record<string, unknown>,
  aliases: string[],
) {
  const value = getImportCell(record, aliases);
  return cleanImportedOptionalValue(value);
}

function cleanImportedOptionalValue(value: unknown) {
  const text = cleanImportedTemplateBlock(value);
  return /^(0|0\.0+|nan|null|undefined)$/i.test(text) ? '' : text;
}

function isImportedGoalHeader(normalizedHeader: string) {
  return normalizedHeader.includes('目标') || normalizedHeader.includes('goal');
}

function normalizeImportedTopicKey(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, '');
}

function isImportedTemplateMetaHeader(normalizedHeader: string) {
  return [
    '日期',
    '对应营内日期',
    '营内日期',
    '对应营内话题',
    '营内话题',
    '话题',
    'topic',
    '大营',
    '大营名',
    '营级',
    'level',
    'major',
    'majorcamp',
    '小营',
    '小营号',
    '营',
    '班',
    '营期',
    'period',
    'term',
    'camp',
    'minor',
    'minorcamp',
    '营名称',
    '营名',
    '展示名',
    'name',
    'displaycampname',
    'defaultdisplaycampname',
    '明日准备',
    '赛后加油站',
    '明日提醒',
    '课表',
    '新课表',
    '课后布置',
    'prep',
    'preptext',
    '活动课',
    '活动名称',
    '活动',
    'activity',
    '活动课物资',
    '活动准备',
    '物资',
    'supplies',
    '背景图',
    'background',
    'backgroundimage',
    '今日竞赛里程',
    '课程目标',
    '教学目标',
    '目标',
    'goals',
    'goaltext',
  ].includes(normalizedHeader);
}

function getImportedGoalEntries(
  record: Record<string, unknown>,
  options: { includeAnyContentColumn?: boolean } = {},
) {
  return Object.entries(record)
    .map(([header, value]) => {
      const title = header.trim();
      const normalizedHeader = normalizeTemplateImportHeader(title);
      const body = cleanImportedOptionalValue(value);
      return { title, normalizedHeader, body };
    })
    .filter((entry) => entry.title && entry.body)
    .filter((entry) => !isImportedTemplateMetaHeader(entry.normalizedHeader))
    .filter((entry) => options.includeAnyContentColumn || isImportedGoalHeader(entry.normalizedHeader))
    .map((entry) => ({ title: entry.title, body: entry.body }));
}

function resolveImportedGoalEntries(
  record: Record<string, unknown>,
  topic: string,
  topicGoalMap: ImportedTopicGoalMap,
) {
  const recordEntries = getImportedGoalEntries(record, { includeAnyContentColumn: true });
  const topicEntries = topic ? topicGoalMap[normalizeImportedTopicKey(topic)] || [] : [];
  if (topicEntries.length === 0) return recordEntries;
  if (recordEntries.length === 0) return topicEntries;
  return recordEntries.map((entry, index) => ({
    title: topicEntries[index]?.title || entry.title,
    body: entry.body,
  }));
}

function buildStructuredGoalTextFromImportRecord(
  record: Record<string, unknown>,
  majorCamp: CampMajorLevel,
  minorCamp: string,
  dayIndex: number,
  topicGoalMap: ImportedTopicGoalMap,
) {
  const explicitGoalText = getImportCell(record, [
    '今日竞赛里程',
    '教学目标',
    '目标',
    '课程目标',
    'Goal',
    'Goals',
    'goalText',
  ]);
  if (explicitGoalText) return explicitGoalText;

  const topic = cleanImportedOptionalCell(record, ['对应营内话题', '营内话题', '话题', 'Topic', 'topic']);
  const goalEntries = resolveImportedGoalEntries(record, topic, topicGoalMap);

  if (!topic && goalEntries.length === 0) return '';

  const lines = [`${buildDefaultDisplayName(majorCamp, minorCamp)} Day ${dayIndex} ${GOAL_SECTION_TITLE}`];
  if (topic) lines.push(`今日话题：${topic}`);
  goalEntries.forEach((goal) => {
    lines.push(`${goal.title}：${goal.body}`);
  });
  return lines.join('\n');
}

function buildPrepTextFromImportRecord(record: Record<string, unknown>) {
  const explicitPrepText = getImportCell(record, [
    '明日准备',
    '赛后加油站',
    '明日提醒',
    '课表',
    '新课表',
    '课后布置',
    'Prep',
    'prepText',
  ]);
  if (explicitPrepText) return explicitPrepText;

  const activityName = cleanImportedOptionalCell(record, ['活动课', '活动名称', '活动', 'Activity']);
  const activitySupplies = cleanImportedOptionalCell(record, ['活动课物资', '活动准备', '物资', 'Supplies']);
  if (!activityName && !activitySupplies) return '';

  const reminderLine = [activityName, activitySupplies].filter(Boolean).join('：');
  return [
    CHALLENGE_SECTION_TITLE,
    '按当天课堂内容完成赛后复习。',
    REMINDER_SECTION_TITLE,
    reminderLine,
  ].join('\n');
}

function createTemplatesFromImportRecord(
  record: Record<string, unknown>,
  existingTemplates: Record<string, CampReportTemplate>,
  topicGoalMap: ImportedTopicGoalMap = {},
): CampReportTemplate[] {
  const majorCamp = normalizeImportedMajorCamp(getImportCell(record, ['大营', '大营名', '营级', 'Level', 'Major', 'MajorCamp', 'majorCamp']));
  const minorCamps = expandImportedMinorCamps(getImportCell(record, ['小营', '小营号', '营', '班', 'Camp', 'Minor', 'MinorCamp', 'minorCamp']));
  const dayIndex = normalizeImportedDayIndex(getImportCell(record, ['对应营内日期', '营内日期', 'Day', 'dayIndex', '第几天', '天数', '日期']));
  if (!majorCamp || minorCamps.length === 0 || !dayIndex) return [];

  const displayCampName = getImportCell(record, ['营名称', '营名', '展示名', 'Name', 'DisplayCampName', 'defaultDisplayCampName']);
  const prepText = buildPrepTextFromImportRecord(record);
  const backgroundImage = getImportCell(record, ['背景图', 'Background', 'backgroundImage']);

  return minorCamps.flatMap((minorCamp) => {
    const goalText = buildStructuredGoalTextFromImportRecord(record, majorCamp, minorCamp, dayIndex, topicGoalMap);
    if (!displayCampName && !goalText && !prepText && !backgroundImage) return [];

    const existing = getTemplateFromMap(existingTemplates, majorCamp, minorCamp, dayIndex);
    const defaultCampName = buildDefaultDisplayName(majorCamp, minorCamp);

    return [{
      id: existing?.id || createId('template'),
      majorCamp,
      minorCamp,
      dayIndex,
      defaultDisplayCampName: displayCampName || existing?.defaultDisplayCampName || defaultCampName,
      goalText: goalText || existing?.goalText || getFallbackGoalText(majorCamp, minorCamp),
      prepText: prepText || existing?.prepText || getFallbackPrepText(),
      backgroundImage: backgroundImage || existing?.backgroundImage || '',
      updatedAt: Date.now(),
    }];
  });
}

function replaceTemplateDisplayName(text: string, sourceDisplayName: string, targetDisplayName: string) {
  if (!text || !sourceDisplayName || sourceDisplayName === targetDisplayName) return text;
  return text.split(sourceDisplayName).join(targetDisplayName);
}

function completeImportedCampTemplates(templates: CampReportTemplate[]) {
  const map = templates.reduce<Record<string, CampReportTemplate>>((result, template) => {
    result[getCampTemplateKey(template.majorCamp, template.minorCamp, template.dayIndex)] = template;
    return result;
  }, {});
  const minorCamps = new Set(templates
    .filter((template) => template.majorCamp === 'L2')
    .map((template) => template.minorCamp));

  if (!minorCamps.has('Camp 1') || !minorCamps.has('Camp 8') || minorCamps.has('Camp 9')) {
    return templates;
  }

  const completed = [...templates];
  templates
    .filter((template) => template.majorCamp === 'L2' && template.minorCamp === 'Camp 1')
    .forEach((template) => {
      const targetKey = getCampTemplateKey(template.majorCamp, 'Camp 9', template.dayIndex);
      if (map[targetKey]) return;

      const sourceDisplayName = template.defaultDisplayCampName || buildDefaultDisplayName(template.majorCamp, template.minorCamp);
      const targetDisplayName = buildDefaultDisplayName(template.majorCamp, 'Camp 9');
      const clonedTemplate: CampReportTemplate = {
        ...template,
        id: createId('template'),
        minorCamp: 'Camp 9',
        defaultDisplayCampName: targetDisplayName,
        goalText: replaceTemplateDisplayName(template.goalText, sourceDisplayName, targetDisplayName),
        prepText: replaceTemplateDisplayName(template.prepText, sourceDisplayName, targetDisplayName),
        updatedAt: Date.now(),
      };
      map[targetKey] = clonedTemplate;
      completed.push(clonedTemplate);
    });

  return completed;
}

function dedupeImportedTemplates(templates: CampReportTemplate[]) {
  const completedTemplates = completeImportedCampTemplates(templates);
  const map = completedTemplates.reduce<Record<string, CampReportTemplate>>((result, template) => {
    result[getCampTemplateKey(template.majorCamp, template.minorCamp, template.dayIndex)] = template;
    return result;
  }, {});
  return Object.values(map);
}

function createRecordFromImportRow(headers: string[], cells: unknown[]) {
  return headers.reduce<Record<string, unknown>>((record, header, index) => {
    record[header] = cells[index] ?? '';
    return record;
  }, {});
}

function isPotentialImportedGoalHeader(normalizedHeader: string) {
  if (!normalizedHeader) return false;
  if (isImportedTemplateMetaHeader(normalizedHeader)) return false;
  if (/^\d{4}[-/年]\d{1,2}/.test(normalizedHeader)) return false;
  return true;
}

function isLikelyImportHeaderRow(row: unknown[]) {
  const normalizedCells = row.map((cell) => normalizeTemplateImportHeader(String(cell ?? '')));
  const hasCamp = normalizedCells.some((cell) => ['大营', '大营名', 'major', 'majorcamp'].includes(cell));
  const hasMinorCamp = normalizedCells.some((cell) => ['小营', '小营号', 'camp', 'minor', 'minorcamp'].includes(cell));
  const hasDay = normalizedCells.some((cell) => ['对应营内日期', '营内日期', 'day', 'dayindex', '第几天', '日期'].includes(cell));
  const hasKnownContent = normalizedCells.some((cell) => isImportedGoalHeader(cell) || [
    '今日竞赛里程',
    '教学目标',
    '目标1【教学】',
    '目标2【教学】',
    '目标3',
    '目标4',
    '明日准备',
    '活动课',
    '活动课物资',
  ].includes(cell));
  const hasCustomContent = normalizedCells.some(isPotentialImportedGoalHeader);
  return hasCamp && hasMinorCamp && (hasDay || hasKnownContent) && (hasKnownContent || hasCustomContent);
}

function isLikelyTopicGoalHeaderRow(row: unknown[]) {
  const normalizedCells = row.map((cell) => normalizeTemplateImportHeader(String(cell ?? '')));
  const hasTopic = normalizedCells.some((cell) => ['话题', 'topic', '对应营内话题', '营内话题'].includes(cell));
  const hasGoalContent = normalizedCells.some((cell) => isImportedGoalHeader(cell) || isPotentialImportedGoalHeader(cell));
  return hasTopic && hasGoalContent;
}

function buildTopicGoalMapFromRows(rows: unknown[][]): ImportedTopicGoalMap {
  const cleanRows = rows
    .map((row) => row.map((cell) => String(cell ?? '').trim()))
    .filter((row) => row.some(Boolean));
  const headerIndex = cleanRows.findIndex(isLikelyTopicGoalHeaderRow);
  if (headerIndex < 0) return {};

  const headers = cleanRows[headerIndex].map((header) => header.trim());
  return cleanRows.slice(headerIndex + 1).reduce<ImportedTopicGoalMap>((result, cells) => {
    const record = createRecordFromImportRow(headers, cells);
    const topic = cleanImportedOptionalCell(record, ['话题', 'Topic', 'topic', '对应营内话题', '营内话题']);
    if (!topic) return result;
    const entries = getImportedGoalEntries(record, { includeAnyContentColumn: true });
    if (entries.length === 0) return result;
    result[normalizeImportedTopicKey(topic)] = entries;
    return result;
  }, {});
}

function parseCampTemplateImportRows(
  rows: unknown[][],
  existingTemplates: Record<string, CampReportTemplate>,
  topicGoalMap: ImportedTopicGoalMap = {},
) {
  const cleanRows = rows
    .map((row) => row.map((cell) => String(cell ?? '').trim()))
    .filter((row) => row.some(Boolean));
  const headerIndex = cleanRows.findIndex(isLikelyImportHeaderRow);
  if (headerIndex < 0) return [];

  const headers = cleanRows[headerIndex].map((header) => header.trim());
  const templates = cleanRows.slice(headerIndex + 1)
    .flatMap((cells) => createTemplatesFromImportRecord(createRecordFromImportRow(headers, cells), existingTemplates, topicGoalMap));
  return dedupeImportedTemplates(templates);
}

function parseCampTemplateImportText(rawText: string, existingTemplates: Record<string, CampReportTemplate>) {
  const source = rawText.trim();
  if (!source) return [];

  if (source.startsWith('{') || source.startsWith('[')) {
    const payload = JSON.parse(source) as unknown;
    const rows = Array.isArray(payload)
      ? payload
      : typeof payload === 'object' && payload !== null && Array.isArray((payload as { templates?: unknown[] }).templates)
        ? (payload as { templates: unknown[] }).templates
        : [];
    return dedupeImportedTemplates(rows
      .flatMap((row) => (typeof row === 'object' && row !== null ? createTemplatesFromImportRecord(row as Record<string, unknown>, existingTemplates) : [])));
  }

  const rows = parseImportRows(source);
  if (rows.length < 2) return [];
  const headers = rows[0].map((header) => header.trim());
  return dedupeImportedTemplates(rows.slice(1)
    .flatMap((cells) => createTemplatesFromImportRecord(createRecordFromImportRow(headers, cells), existingTemplates)));
}

async function parseCampTemplateImportFile(file: File, existingTemplates: Record<string, CampReportTemplate>) {
  const fileName = file.name.toLowerCase();
  if (fileName.endsWith('.numbers')) {
    throw new Error('Numbers 文件请先导出为 Excel（.xlsx）后上传；现在系统可直接读取 Excel，不需要再导 CSV。');
  }

  const isExcelFile = /\.(xlsx|xls|xlsm)$/i.test(file.name)
    || file.type.includes('spreadsheet')
    || file.type.includes('excel');
  if (!isExcelFile) {
    const text = await readFileAsText(file);
    return parseCampTemplateImportText(text, existingTemplates);
  }

  const [{ getXlsx, readWorkbookFromFile }] = await Promise.all([
    import('../utils/xlsxFile'),
  ]);
  const XLSX = await getXlsx();
  const workbook = await readWorkbookFromFile(file);
  const workbookRows = workbook.SheetNames.map((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const rows = sheet ? XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: '',
      raw: false,
      dateNF: 'yyyy-mm-dd',
    }) : [];
    return { sheetName, rows };
  });
  const topicGoalMap = workbookRows.reduce<ImportedTopicGoalMap>((result, { rows }) => ({
    ...result,
    ...buildTopicGoalMapFromRows(rows),
  }), {});
  const templates = workbookRows.flatMap(({ rows }) => parseCampTemplateImportRows(rows, existingTemplates, topicGoalMap));
  return dedupeImportedTemplates(templates);
}

function getFallbackGoalText(majorCamp: string, minorCamp: string) {
  const campName = buildDefaultDisplayName(majorCamp, minorCamp);
  return buildGoalTextFromPlan(null, campName);
}

function getFallbackPrepText() {
  return [
    CHALLENGE_SECTION_TITLE,
    '回看 2 遍当天相关动画或课堂视频，帮助磨耳朵。',
    '和家长完成 1 次大声朗读或关键词复述。',
    REMINDER_SECTION_TITLE,
    '提前准备第二天营服、水杯与常规学习物资。',
    '睡前再检查书包和个人物品是否收整完成。',
  ].join('\n');
}

function createEmptyPrepSections(): CampReportPrepSections {
  return {
    afterClassTitle: '',
    afterClassText: '',
    suppliesTitle: '',
    suppliesText: '',
  };
}

function isGoalHeading(line: string) {
  return line.includes(GOAL_SECTION_TITLE) || line.includes('今日课程目标') || line.includes('当日课程目标');
}

function normalizeGoalHeading(line: string) {
  return line
    .replace(/今日课程目标/g, GOAL_SECTION_TITLE)
    .replace(/当日课程目标/g, GOAL_SECTION_TITLE);
}

function isChallengeHeading(line: string) {
  return [CHALLENGE_SECTION_TITLE, '今日挑战', '今天挑战', '课后挑战'].some((label) => line.includes(label));
}

function isReminderHeading(line: string) {
  return [REMINDER_SECTION_TITLE, '物资提醒'].some((label) => line.includes(label));
}

function normalizeAfterClassTitle(title: string) {
  const cleanTitle = title.trim();
  if (!cleanTitle) return '';
  return ['今日挑战', '今天挑战', '课后挑战'].some((label) => cleanTitle === label || cleanTitle.startsWith(`${label}：`) || cleanTitle.startsWith(`${label}:`))
    ? CHALLENGE_SECTION_TITLE
    : cleanTitle;
}

function normalizeSuppliesTitle(title: string) {
  const cleanTitle = title.trim();
  if (!cleanTitle) return '';
  return cleanTitle === '物资提醒' || cleanTitle.startsWith('物资提醒：') || cleanTitle.startsWith('物资提醒:')
    ? REMINDER_SECTION_TITLE
    : cleanTitle;
}

function normalizeClassroomObservationTitle(title?: string) {
  if (title === undefined) return DEFAULT_CLASSROOM_OBSERVATION_TITLE;
  return title === '课堂观察' || title === '今日总结' ? DEFAULT_CLASSROOM_OBSERVATION_TITLE : title;
}

function serializeGoalBlock(item: { title: string; body: string }) {
  return `${item.title ?? ''}：${item.body ?? ''}`;
}

function serializePrepSectionsValue(sections: CampReportPrepSections) {
  return [
    sections.afterClassTitle ?? '',
    sections.afterClassText ?? '',
    sections.suppliesTitle ?? '',
    sections.suppliesText ?? '',
  ].join('\n');
}

function createEmptyRow(): CampReportPerformanceRow {
  return {
    id: createId('perf'),
    englishName: '',
    chineseName: '',
    wordMastery: '',
    dialogueMastery: '',
    attendance: '',
    implementation: '',
    racingTitle: '',
    remark: '',
  };
}

function createBlankStudentRows(count = STUDENT_ROW_COUNT): CampReportPerformanceRow[] {
  return Array.from({ length: count }, () => createEmptyRow());
}

function normalizeStudentRows(rows: CampReportPerformanceRow[], count = STUDENT_ROW_COUNT): CampReportPerformanceRow[] {
  const safeRows = Array.isArray(rows) ? rows.slice(0, count) : [];
  while (safeRows.length < count) safeRows.push(createEmptyRow());
  return safeRows.map((row) => ({
    id: row.id || createId('perf'),
    englishName: row.englishName ?? row.studentName ?? '',
    chineseName: row.chineseName ?? '',
    wordMastery: row.wordMastery ?? row.initiative ?? '',
    dialogueMastery: row.dialogueMastery ?? row.dialogue ?? '',
    attendance: row.attendance ?? row.supplies ?? '',
    implementation: row.implementation ?? '',
    racingTitle: row.racingTitle ?? '',
    remark: row.remark ?? '',
  }));
}

function normalizePerformanceColumnLabels(labels?: string[]) {
  if (!Array.isArray(labels)) return [...DEFAULT_PERFORMANCE_COLUMN_LABELS];
  return DEFAULT_PERFORMANCE_COLUMN_LABELS.map((fallback, index) => (
    index < labels.length ? String(labels[index] ?? '') : fallback
  ));
}

function createEmptyHighlight(frame: CampReportHighlightFrame = DEFAULT_HIGHLIGHT_FRAME): CampReportHighlight {
  return {
    id: createId('highlight'),
    image: '',
    title: '',
    reason: '',
    fit: DEFAULT_CUSTOM_IMAGE_FIT,
    frame,
  };
}

function createDefaultHighlights(): CampReportHighlight[] {
  return [
    createEmptyHighlight('crown'),
    createEmptyHighlight('racing'),
  ];
}

function createEmptyCustomImage(): CampReportCustomImage {
  return {
    id: createId('custom_img'),
    image: '',
    caption: '',
    size: DEFAULT_CUSTOM_IMAGE_SIZE,
    fit: DEFAULT_CUSTOM_IMAGE_FIT,
  };
}

function createEmptyCustomSection(): CampReportCustomSection {
  return {
    id: createId('custom_section'),
    title: '自定义板块',
    body: '',
    images: [],
  };
}

function normalizeCustomSections(sections?: CampReportCustomSection[]): CampReportCustomSection[] {
  if (!Array.isArray(sections)) return [];
  return sections.map((section) => ({
    id: section.id || createId('custom_section'),
    title: section.title ?? '自定义板块',
    body: section.body ?? '',
    images: Array.isArray(section.images)
      ? section.images.map((image) => ({
        id: image.id || createId('custom_img'),
        image: image.image ?? '',
        caption: image.caption ?? '',
        size: image.size || DEFAULT_CUSTOM_IMAGE_SIZE,
        fit: image.fit || DEFAULT_CUSTOM_IMAGE_FIT,
      }))
      : [],
  }));
}

function normalizeFooterTextAlign(value: unknown): CampReportTextAlign {
  return value === 'left' || value === 'center' || value === 'right' ? value : 'left';
}

function normalizeFooterTextFontSize(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_FOOTER_TEXT_FONT_SIZE;
  return Math.min(MAX_FOOTER_TEXT_FONT_SIZE, Math.max(MIN_FOOTER_TEXT_FONT_SIZE, Math.round(numeric)));
}

function normalizeFooterTextColor(value: unknown) {
  const color = String(value ?? '').trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color : '';
}

function normalizeFooterBlock(block: Partial<CampReportFooterBlock>): CampReportFooterBlock {
  const type: CampReportFooterBlock['type'] = block.type === 'image' ? 'image' : 'text';
  return {
    id: block.id || createId('footer_block'),
    type,
    text: type === 'text' ? String(block.text ?? '') : '',
    image: type === 'image' ? sanitizeFooterImage(String(block.image ?? '')) : '',
    fontSize: normalizeFooterTextFontSize(block.fontSize),
    align: normalizeFooterTextAlign(block.align),
    color: normalizeFooterTextColor(block.color),
    fit: block.fit === 'cover' ? 'cover' : DEFAULT_CUSTOM_IMAGE_FIT,
  };
}

function createFooterTextBlock(text = ''): CampReportFooterBlock {
  return normalizeFooterBlock({
    id: createId('footer_text'),
    type: 'text',
    text,
    fontSize: DEFAULT_FOOTER_TEXT_FONT_SIZE,
    align: 'left',
  });
}

function createFooterImageBlock(image = ''): CampReportFooterBlock {
  return normalizeFooterBlock({
    id: createId('footer_image'),
    type: 'image',
    image,
    fit: DEFAULT_CUSTOM_IMAGE_FIT,
  });
}

function normalizeFooterBlocks(blocks?: CampReportFooterBlock[]) {
  if (!Array.isArray(blocks)) return [];
  return blocks.map((block) => normalizeFooterBlock(block));
}

function buildLegacyFooterBlocks(text: string, image: string) {
  const blocks: CampReportFooterBlock[] = [];
  const cleanImage = sanitizeFooterImage(image);
  if (cleanImage) blocks.push(createFooterImageBlock(cleanImage));
  if (text.trim()) blocks.push(createFooterTextBlock(text));
  return blocks;
}

function resolveFooterBlocks(blocks: CampReportFooterBlock[] | undefined, text: string, image: string) {
  return Array.isArray(blocks) ? normalizeFooterBlocks(blocks) : buildLegacyFooterBlocks(text, image);
}

function getFooterBlocksText(blocks: CampReportFooterBlock[]) {
  return blocks
    .filter((block) => block.type === 'text' && block.text?.trim())
    .map((block) => block.text?.trim() || '')
    .join('\n');
}

function getFirstFooterBlockImage(blocks: CampReportFooterBlock[]) {
  return blocks.find((block) => block.type === 'image' && block.image)?.image || '';
}

function hasFooterBlockContent(block: CampReportFooterBlock) {
  return block.type === 'image' ? Boolean(block.image) : Boolean(block.text?.trim());
}

function normalizeHighlights(highlights?: CampReportHighlight[], useDefaultWhenMissing = false): CampReportHighlight[] {
  if (!Array.isArray(highlights) || (useDefaultWhenMissing && highlights.length === 0)) {
    return useDefaultWhenMissing ? createDefaultHighlights() : [];
  }

  return highlights
    ? highlights.map((item) => ({
      id: item.id || createId('highlight'),
      image: item.image ?? '',
      title: item.title ?? '',
      reason: item.reason ?? '',
      fit: item.fit || DEFAULT_CUSTOM_IMAGE_FIT,
      frame: HIGHLIGHT_FRAME_OPTIONS.some((option) => option.value === item.frame) ? item.frame : DEFAULT_HIGHLIGHT_FRAME,
    }))
    : [];
}

function normalizeHighlightColumns(value: unknown): CampReportHighlightColumns {
  const numeric = Number(value);
  return numeric === 1 || numeric === 2 || numeric === 3 ? numeric : DEFAULT_HIGHLIGHT_COLUMNS;
}

function normalizeSectionVisibility(visibility?: Partial<Record<CampReportOptionalSectionKey, boolean>>) {
  return {
    ...DEFAULT_SECTION_VISIBILITY,
    ...(visibility || {}),
  };
}

function normalizeSectionOrder(order?: CampReportOptionalSectionKey[]) {
  const result: CampReportOptionalSectionKey[] = [];
  const source = Array.isArray(order) ? order : [];
  [...source, ...DEFAULT_SECTION_ORDER].forEach((section) => {
    if (DEFAULT_SECTION_ORDER.includes(section) && !result.includes(section)) {
      result.push(section);
    }
  });
  return result;
}

function normalizeFirstCell(value: string) {
  return value.replace(/^[\d.\-、)\]\s]+/, '').trim();
}

function parsePerformanceRows(rawText: string): CampReportPerformanceRow[] {
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const rows = lines.map((line) => {
    const cells = line.includes('\t')
      ? line.split('\t').map((item) => item.trim())
      : line.includes('，') || line.includes(',')
        ? line.split(/[，,]/).map((item) => item.trim())
        : line.split(/\s{2,}|\s\|\s| \- /).map((item) => item.trim());

    if (!cells.some(Boolean)) return null;

    const normalized = [...cells];
    normalized[0] = normalizeFirstCell(normalized[0] || '');

    while (normalized.length < PERFORMANCE_ROW_FIELDS.length) normalized.push('');
    if (normalized.length > PERFORMANCE_ROW_FIELDS.length) {
      normalized.splice(
        PERFORMANCE_ROW_FIELDS.length - 1,
        normalized.length - PERFORMANCE_ROW_FIELDS.length + 1,
        normalized.slice(PERFORMANCE_ROW_FIELDS.length - 1).join(' / '),
      );
    }

    return {
      id: createId('perf'),
      englishName: normalized[0] || '',
      chineseName: normalized[1] || '',
      wordMastery: normalized[2] || '',
      dialogueMastery: normalized[3] || '',
      attendance: normalized[4] || '',
      implementation: normalized[5] || '',
      racingTitle: normalized[6] || '',
      remark: normalized[7] || '',
    };
  }).filter((row): row is CampReportPerformanceRow => !!row);

  return normalizeStudentRows(rows);
}

function hasPerformanceRowContent(row: CampReportPerformanceRow) {
  return PERFORMANCE_ROW_FIELDS.some((field) => Boolean(row[field]));
}

function getPerformanceStatusClass(value: string) {
  const normalized = value.trim();
  if (!normalized) return '';
  if (/未到|缺勤|旷课|请假|迟到|早退/.test(normalized)) return 'is-danger';
  if (/未完成|未交|漏|待补|补交|缺/.test(normalized)) return 'is-warning';
  if (/已到|到课|完成|已完成|全勤/.test(normalized)) return 'is-ok';
  return '';
}

function isAbsentAttendance(value: string) {
  return /未到|缺勤|旷课|请假/.test(value.trim());
}

function hasClassroomObservation(row: CampReportPerformanceRow) {
  return Boolean(row.wordMastery.trim() || row.dialogueMastery.trim());
}

function getAbsentObservationRows(rows: CampReportPerformanceRow[]) {
  return rows.filter((row) => isAbsentAttendance(row.attendance) && hasClassroomObservation(row));
}

function buildAbsentObservationSignature(rows: CampReportPerformanceRow[]) {
  return getAbsentObservationRows(rows)
    .map((row, index) => [
      row.id || index,
      row.englishName,
      row.chineseName,
      row.wordMastery,
      row.dialogueMastery,
      row.attendance,
    ].join('|'))
    .join('||');
}

function clearAbsentClassroomObservations(rows: CampReportPerformanceRow[]) {
  return rows.map((row) => (
    isAbsentAttendance(row.attendance)
      ? { ...row, wordMastery: '', dialogueMastery: '' }
      : row
  ));
}

function serializePerformanceRows(rows: CampReportPerformanceRow[]) {
  return rows
    .filter(hasPerformanceRowContent)
    .map((row) => PERFORMANCE_ROW_FIELDS.map((field) => row[field] ?? '').join('\t'))
    .join('\n');
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return window.btoa(binary);
}

async function readFileAsDataUrlFallback(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const mime = file.type || 'application/octet-stream';
  return `data:${mime};base64,${arrayBufferToBase64(buffer)}`;
}

async function readFileAsDataUrlFromObjectUrl(file: File): Promise<string> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const response = await fetch(objectUrl);
    const blob = await response.blob();
    const buffer = await blob.arrayBuffer();
    const mime = blob.type || file.type || 'application/octet-stream';
    return `data:${mime};base64,${arrayBufferToBase64(buffer)}`;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function readFileAsDataUrlRaw(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => {
      readFileAsDataUrlFallback(file)
        .then(resolve)
        .catch(() => readFileAsDataUrlFromObjectUrl(file).then(resolve, () => reject(new Error('文件读取失败'))));
    };
    reader.readAsDataURL(file);
  });
}

function shouldOptimizeUploadedImage(file: File) {
  if (!file.type.startsWith('image/')) return false;
  return file.type !== 'image/svg+xml';
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('图片加载失败'));
    image.src = src;
  });
}

async function resizeImageDataUrlForStorage(dataUrl: string, file: File): Promise<string> {
  if (!shouldOptimizeUploadedImage(file)) return dataUrl;

  let image: HTMLImageElement;
  try {
    image = await loadImageElement(dataUrl);
  } catch {
    throw new Error('图片格式暂不支持，请换成 JPG 或 PNG 后重新上传。');
  }

  const naturalWidth = image.naturalWidth || image.width;
  const naturalHeight = image.naturalHeight || image.height;
  if (!naturalWidth || !naturalHeight) return dataUrl;

  const edgeScale = Math.min(1, MAX_UPLOAD_IMAGE_EDGE / Math.max(naturalWidth, naturalHeight));
  let targetWidth = Math.max(1, Math.round(naturalWidth * edgeScale));
  let targetHeight = Math.max(1, Math.round(naturalHeight * edgeScale));

  if (edgeScale >= 1 && dataUrl.length <= MAX_UPLOAD_IMAGE_DATA_URL_LENGTH) {
    return dataUrl;
  }

  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return dataUrl;

  let result = dataUrl;
  let quality = 0.84;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    context.clearRect(0, 0, targetWidth, targetHeight);
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, targetWidth, targetHeight);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, 0, 0, targetWidth, targetHeight);
    result = canvas.toDataURL('image/jpeg', quality);
    if (result.length <= MAX_UPLOAD_IMAGE_DATA_URL_LENGTH) break;
    quality = Math.max(0.68, quality - 0.06);
    targetWidth = Math.max(1, Math.round(targetWidth * 0.84));
    targetHeight = Math.max(1, Math.round(targetHeight * 0.84));
    if ((targetWidth <= 900 || targetHeight <= 900) && quality <= 0.68) break;
  }

  return result;
}

async function readFileAsDataUrl(file: File): Promise<string> {
  const dataUrl = await readFileAsDataUrlRaw(file);
  return resizeImageDataUrlForStorage(dataUrl, file);
}

function waitForImageReady(image: HTMLImageElement): Promise<void> {
  if (!image.currentSrc && !image.src) return Promise.resolve();
  if (image.complete && image.naturalWidth > 0) {
    return image.decode ? image.decode().catch(() => undefined) : Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    let timer = 0;
    function cleanup() {
      window.clearTimeout(timer);
      image.removeEventListener('load', handleLoad);
      image.removeEventListener('error', handleError);
    }
    function handleLoad() {
      cleanup();
      resolve();
    }
    function handleError() {
      cleanup();
      reject(new Error('图片加载失败'));
    }
    timer = window.setTimeout(() => {
      cleanup();
      reject(new Error('图片加载超时'));
    }, IMAGE_READY_TIMEOUT_MS);
    image.addEventListener('load', handleLoad, { once: true });
    image.addEventListener('error', handleError, { once: true });
  });
}

async function waitForReportImagesReady(root: HTMLElement) {
  const images = Array.from(root.querySelectorAll('img'));
  if (images.length === 0) return;
  try {
    await Promise.all(images.map((image) => waitForImageReady(image)));
  } catch {
    throw new Error('有图片还没有加载成功，请重新上传或删除后再下载。');
  }
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizeCropSelection(selection: CropSelection): CropSelection {
  const width = clampNumber(selection.width, MIN_CROP_PERCENT, 100);
  const height = clampNumber(selection.height, MIN_CROP_PERCENT, 100);
  return {
    x: clampNumber(selection.x, 0, 100 - width),
    y: clampNumber(selection.y, 0, 100 - height),
    width,
    height,
  };
}

function createCropSelectionFromPoints(startPoint: CropPoint, currentPoint: CropPoint): CropSelection {
  const left = Math.min(startPoint.x, currentPoint.x);
  const top = Math.min(startPoint.y, currentPoint.y);
  const width = Math.abs(currentPoint.x - startPoint.x);
  const height = Math.abs(currentPoint.y - startPoint.y);
  return normalizeCropSelection({ x: left, y: top, width, height });
}

function resizeCropSelection(selection: CropSelection, mode: CropDragMode, dx: number, dy: number): CropSelection {
  let left = selection.x;
  let top = selection.y;
  let right = selection.x + selection.width;
  let bottom = selection.y + selection.height;

  if (mode.includes('n')) top += dy;
  if (mode.includes('s')) bottom += dy;
  if (mode.includes('w')) left += dx;
  if (mode.includes('e')) right += dx;

  left = clampNumber(left, 0, 100);
  top = clampNumber(top, 0, 100);
  right = clampNumber(right, 0, 100);
  bottom = clampNumber(bottom, 0, 100);

  if (right - left < MIN_CROP_PERCENT) {
    if (mode.includes('w')) left = right - MIN_CROP_PERCENT;
    else right = left + MIN_CROP_PERCENT;
  }
  if (bottom - top < MIN_CROP_PERCENT) {
    if (mode.includes('n')) top = bottom - MIN_CROP_PERCENT;
    else bottom = top + MIN_CROP_PERCENT;
  }

  return normalizeCropSelection({
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  });
}

async function cropImageDataUrl(src: string, selection: CropSelection): Promise<string> {
  const image = await loadImageElement(src);
  const naturalWidth = image.naturalWidth || image.width;
  const naturalHeight = image.naturalHeight || image.height;
  if (!naturalWidth || !naturalHeight) throw new Error('图片尺寸读取失败');

  const normalized = normalizeCropSelection(selection);
  const sourceX = Math.round((normalized.x / 100) * naturalWidth);
  const sourceY = Math.round((normalized.y / 100) * naturalHeight);
  const sourceWidth = Math.max(1, Math.round((normalized.width / 100) * naturalWidth));
  const sourceHeight = Math.max(1, Math.round((normalized.height / 100) * naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = sourceWidth;
  canvas.height = sourceHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('当前浏览器不支持图片裁剪');
  context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, sourceWidth, sourceHeight);
  return canvas.toDataURL('image/png');
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsText(file);
  });
}

function isManageEnabled() {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname;
  return host === '127.0.0.1' || host === 'localhost' || host.includes('superamber-test');
}

async function writePngBlobToClipboard(blob: Blob) {
  const ClipboardItemCtor = (window as Window & {
    ClipboardItem?: new (items: Record<string, Blob>) => ClipboardItem;
  }).ClipboardItem;
  if (!navigator.clipboard?.write || !ClipboardItemCtor) {
    throw new Error('当前设备不支持直接复制图片到剪贴板，请使用下载图片。');
  }
  await navigator.clipboard.write([
    new ClipboardItemCtor({ [blob.type || 'image/png']: blob }),
  ]);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function parseGoalBlocks(goalText: string) {
  const lines = goalText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const body = isGoalHeading(lines[0] || '') ? lines.slice(1) : lines;
  return body.slice(0, 5).map((line, index) => {
    const [title, ...rest] = line.split(/[：:]/);
    return {
      id: `goal_${index}`,
      sourceIndex: index,
      title: rest.length > 0 ? title : `目标 ${index + 1}`,
      body: rest.length > 0 ? rest.join('：').trim() : line,
    };
  });
}

function isPreviewGoalBlockVisible(title: string) {
  return !/今日话题|话题|topic/i.test(title.trim());
}

function parsePrepSections(prepText: string) {
  const lines = prepText.split(/\r?\n/).map((line) => line.trim());
  if (!lines.some(Boolean)) return createEmptyPrepSections();

  const challengeIndex = lines.findIndex(isChallengeHeading);
  const suppliesIndex = lines.findIndex(isReminderHeading);
  if (challengeIndex < 0 && suppliesIndex < 0) {
    return {
      afterClassTitle: normalizeAfterClassTitle(lines[0] ?? ''),
      afterClassText: lines[1] ?? '',
      suppliesTitle: normalizeSuppliesTitle(lines[2] ?? ''),
      suppliesText: lines.slice(3).join('\n'),
    };
  }

  const afterTitleIndex = challengeIndex >= 0 ? challengeIndex : 0;
  const suppliesTitleIndex = suppliesIndex >= 0 ? suppliesIndex : lines.length;
  const afterClassTitle = normalizeAfterClassTitle(lines[afterTitleIndex] ?? '');
  const suppliesTitle = normalizeSuppliesTitle(suppliesIndex >= 0 ? lines[suppliesIndex] : '');
  const afterClassLines = lines.slice(afterTitleIndex + 1, suppliesTitleIndex);
  const suppliesLines = suppliesIndex >= 0 ? lines.slice(suppliesIndex + 1) : [];
  return {
    afterClassTitle,
    afterClassText: afterClassLines.join('\n'),
    suppliesTitle,
    suppliesText: suppliesLines.join('\n'),
  };
}

function normalizePrepSections(sections?: Partial<CampReportPrepSections> | null): CampReportPrepSections {
  if (!sections) return createEmptyPrepSections();
  return {
    afterClassTitle: normalizeAfterClassTitle(sections.afterClassTitle ?? ''),
    afterClassText: sections.afterClassText ?? '',
    suppliesTitle: normalizeSuppliesTitle(sections.suppliesTitle ?? ''),
    suppliesText: sections.suppliesText ?? '',
  };
}

function serializeGoalBlocks(goalText: string, sourceIndex: number, field: 'title' | 'body', value: string) {
  const lines = goalText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const hasHeading = isGoalHeading(lines[0] || '');
  const heading = hasHeading ? normalizeGoalHeading(lines[0]) : '';
  const blocks = parseGoalBlocks(goalText);
  const nextBlocks = blocks.map((item) => (
    item.sourceIndex === sourceIndex
      ? { ...item, [field]: field === 'body' ? value.replace(/\r?\n/g, ' ').trim() : value }
      : item
  ));
  return [
    heading,
    ...nextBlocks.map(serializeGoalBlock),
  ].filter(Boolean).join('\n');
}

function serializeVisibleGoalBlocks(goalText: string, nextVisibleBlocks: Array<{ title: string; body: string }>) {
  const lines = goalText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const hasHeading = isGoalHeading(lines[0] || '');
  const heading = hasHeading ? normalizeGoalHeading(lines[0]) : '';
  const hiddenBlocks = parseGoalBlocks(goalText).filter((item) => !isPreviewGoalBlockVisible(item.title));
  return [
    heading,
    ...hiddenBlocks.map(serializeGoalBlock),
    ...nextVisibleBlocks.map(serializeGoalBlock),
  ].filter(Boolean).join('\n');
}

function sanitizeFooterImage(image: string) {
  if (!image) return '';
  if (image === LEGACY_AFTER_CLASS_IMAGE || image === LEGACY_SUPPLIES_IMAGE) return '';
  return image;
}

function formatDraftSaveTime() {
  return new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

export default function CampReportApp({ onBack }: Props) {
  const cardRef = useRef<HTMLDivElement>(null);
  const previewFrameRef = useRef<HTMLDivElement>(null);
  const cropStageRef = useRef<HTMLDivElement>(null);
  const editorFocusTimerRef = useRef<number | null>(null);
  const previewFocusTimerRef = useRef<number | null>(null);
  const didLoadInitialBasicSelectionRef = useRef(false);
  const autoSaveDraftReadyRef = useRef(false);
  const autoSaveDraftTimerRef = useRef<number | null>(null);
  const draftHydrationTokenRef = useRef(0);
  const absentObservationPromptSignatureRef = useRef('');
  const initialBasicSelection = useMemo(() => loadLastBasicSelection(), []);
  const manageEnabled = useMemo(() => isManageEnabled(), []);
  const [viewMode, setViewMode] = useState<ViewMode>('editor');
  const [adminUnlocked, setAdminUnlocked] = useState(() => isAdminSessionUnlocked());
  const [adminPassword, setAdminPassword] = useState('');
  const [notice, setNotice] = useState('');
  const [draftSaveStatus, setDraftSaveStatus] = useState('草稿会自动保存');
  const [exporting, setExporting] = useState(false);
  const [exportAction, setExportAction] = useState<ExportAction | ''>('');
  const [cropTarget, setCropTarget] = useState<ImageCropTarget | null>(null);
  const [cropSelection, setCropSelection] = useState<CropSelection>(DEFAULT_CROP_SELECTION);
  const [cropDragState, setCropDragState] = useState<CropDragState | null>(null);
  const [focusedEditorSection, setFocusedEditorSection] = useState('');
  const [focusedPreviewSection, setFocusedPreviewSection] = useState('');
  const [collapsedEditorSections, setCollapsedEditorSections] = useState<Record<string, boolean>>(DEFAULT_COLLAPSED_EDITOR_SECTIONS);
  const [reportDate, setReportDate] = useState(initialBasicSelection.reportDate);
  const [majorCamp, setMajorCamp] = useState<CampMajorLevel>(initialBasicSelection.majorCamp);
  const [minorCamp, setMinorCamp] = useState(initialBasicSelection.minorCamp);
  const [displayCampName, setDisplayCampName] = useState(initialBasicSelection.displayCampName);
  const [goalText, setGoalText] = useState('');
  const [classroomObservationTitle, setClassroomObservationTitle] = useState(DEFAULT_CLASSROOM_OBSERVATION_TITLE);
  const [classroomObservation, setClassroomObservation] = useState('');
  const [performanceRawText, setPerformanceRawText] = useState('');
  const [performanceColumnLabels, setPerformanceColumnLabels] = useState(DEFAULT_PERFORMANCE_COLUMN_LABELS);
  const [performanceRows, setPerformanceRows] = useState<CampReportPerformanceRow[]>([]);
  const [performanceExpanded, setPerformanceExpanded] = useState(false);
  const [summaryDetailsExpanded, setSummaryDetailsExpanded] = useState(false);
  const [columnLabelsExpanded, setColumnLabelsExpanded] = useState(false);
  const [prepSections, setPrepSections] = useState<CampReportPrepSections>(() => createEmptyPrepSections());
  const [afterClassImage, setAfterClassImage] = useState('');
  const [suppliesImage, setSuppliesImage] = useState('');
  const [afterClassBlocks, setAfterClassBlocks] = useState<CampReportFooterBlock[]>([]);
  const [suppliesBlocks, setSuppliesBlocks] = useState<CampReportFooterBlock[]>([]);
  const [highlights, setHighlights] = useState<CampReportHighlight[]>(() => createDefaultHighlights());
  const [highlightColumns, setHighlightColumns] = useState<CampReportHighlightColumns>(DEFAULT_HIGHLIGHT_COLUMNS);
  const [customSections, setCustomSections] = useState<CampReportCustomSection[]>([]);
  const [sectionVisibility, setSectionVisibility] = useState<Record<CampReportOptionalSectionKey, boolean>>(DEFAULT_SECTION_VISIBILITY);
  const [sectionOrder, setSectionOrder] = useState<CampReportOptionalSectionKey[]>(DEFAULT_SECTION_ORDER);
  const [backgroundImage, setBackgroundImage] = useState('');

  const [configMajorCamp, setConfigMajorCamp] = useState<CampMajorLevel>(DEFAULT_MAJOR_CAMP);
  const [configMinorCamp, setConfigMinorCamp] = useState(DEFAULT_MINOR_CAMP);
  const [configDayIndex, setConfigDayIndex] = useState(FALLBACK_DAY_INDEX);
  const [configDisplayCampName, setConfigDisplayCampName] = useState(buildDefaultDisplayName(DEFAULT_MAJOR_CAMP, DEFAULT_MINOR_CAMP));
  const [configGoalText, setConfigGoalText] = useState('');
  const [configPrepText, setConfigPrepText] = useState('');
  const [configBackgroundImage, setConfigBackgroundImage] = useState('');
  const [templateMap, setTemplateMap] = useState<Record<string, CampReportTemplate>>(() => loadCampReportTemplates());
  const [templateImportText, setTemplateImportText] = useState('');
  const [themeConfigs, setThemeConfigs] = useState<Record<string, CampReportThemeConfig>>(() => loadCampReportThemeConfigs());
  const [configThemeLogo, setConfigThemeLogo] = useState('');
  const [configThemeReferenceImage, setConfigThemeReferenceImage] = useState('');
  const [configThemePalette, setConfigThemePalette] = useState<CampReportPalette>(() => getDefaultCampTheme(DEFAULT_MAJOR_CAMP).palette);
  const [configThemeSource, setConfigThemeSource] = useState<CampReportThemeConfig['source']>('default');

  const templateCount = useMemo(() => Object.keys(templateMap).length, [templateMap]);
  const themeConfigCount = useMemo(() => Object.keys(themeConfigs).length, [themeConfigs]);
  const dateOptions = useMemo(() => getCampReportDateOptions(), []);
  const reportPlan = useMemo(() => findCampDayPlan(reportDate, majorCamp, minorCamp), [reportDate, majorCamp, minorCamp]);
  const currentDayIndex = reportPlan?.dayIndex || FALLBACK_DAY_INDEX;
  const currentDayLabel = reportPlan?.dayLabel || `Day ${currentDayIndex}`;
  const currentTheme = useMemo(() => resolveCampReportTheme(majorCamp, themeConfigs), [majorCamp, themeConfigs]);
  const configThemePreview = useMemo(() => ({
    ...getDefaultCampTheme(configMajorCamp),
    logoImage: configThemeLogo,
    palette: normalizePalette(configThemePalette, getDefaultCampTheme(configMajorCamp).palette),
  }), [configMajorCamp, configThemeLogo, configThemePalette]);
  const configThemeVars = useMemo(() => buildCampThemeVars(configThemePreview), [configThemePreview]);

  useEffect(() => () => {
    if (editorFocusTimerRef.current) {
      window.clearTimeout(editorFocusTimerRef.current);
    }
    if (previewFocusTimerRef.current) {
      window.clearTimeout(previewFocusTimerRef.current);
    }
    if (autoSaveDraftTimerRef.current) {
      window.clearTimeout(autoSaveDraftTimerRef.current);
    }
  }, []);

  useEffect(() => {
    if (!cropTarget) return;
    setCropSelection(DEFAULT_CROP_SELECTION);
    setCropDragState(null);
  }, [cropTarget]);

  useEffect(() => {
    let cancelled = false;
    fetchSharedCampReportTemplates()
      .then((payload) => {
        if (cancelled) return;
        setTemplateMap(payload.templates);
        saveCampReportTemplates(payload.templates);
      })
      .catch((error) => {
        console.warn('读取共享夏令营日报模板失败，暂用本地缓存', error);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const hydrationToken = draftHydrationTokenRef.current + 1;
    draftHydrationTokenRef.current = hydrationToken;
    autoSaveDraftReadyRef.current = false;
    if (autoSaveDraftTimerRef.current) {
      window.clearTimeout(autoSaveDraftTimerRef.current);
      autoSaveDraftTimerRef.current = null;
    }
    const markDraftReady = () => {
      window.setTimeout(() => {
        if (draftHydrationTokenRef.current === hydrationToken) {
          autoSaveDraftReadyRef.current = true;
        }
      }, 0);
    };
    const isInitialBasicSelection = !didLoadInitialBasicSelectionRef.current;
    didLoadInitialBasicSelectionRef.current = true;
    const draft = getCampReportDraft(reportDate, majorCamp, minorCamp, currentDayLabel);
    const template = getTemplateFromMap(templateMap, majorCamp, minorCamp, currentDayIndex);
    const defaultAfterClassImage = getDefaultAfterClassImage(majorCamp);
    if (draft) {
      const useSharedTemplate = shouldUseSharedTemplateOverDraft(template, draft);
      const freshTemplate = useSharedTemplate && template ? template : null;
      const draftPerformanceRows = normalizeStudentRows(Array.isArray(draft.performanceRows) ? draft.performanceRows : []);
      const parsedPerformanceRows = parsePerformanceRows(draft.performanceRawText ?? '');
      const nextPerformanceRows = draftPerformanceRows.some(hasPerformanceRowContent)
        ? draftPerformanceRows
        : parsedPerformanceRows.some(hasPerformanceRowContent)
          ? parsedPerformanceRows
          : draftPerformanceRows;
      const nextPrepSections = normalizePrepSections(freshTemplate
        ? parsePrepSections(freshTemplate.prepText)
        : draft.prepSections ?? parsePrepSections(draft.prepText ?? ''));
      const nextAfterClassImage = sanitizeFooterImage(freshTemplate
        ? defaultAfterClassImage || draft.afterClassImage || ''
        : draft.afterClassImage ?? '');
      const nextSuppliesImage = sanitizeFooterImage(draft.suppliesImage ?? '');
      setDisplayCampName(freshTemplate
        ? freshTemplate.defaultDisplayCampName
        : draft.displayCampName ?? (isInitialBasicSelection ? initialBasicSelection.displayCampName : buildDefaultDisplayName(majorCamp, minorCamp)));
      setGoalText(freshTemplate ? freshTemplate.goalText : draft.goalText ?? '');
      setClassroomObservationTitle(normalizeClassroomObservationTitle(draft.classroomObservationTitle));
      setClassroomObservation(draft.classroomObservation ?? '');
      setPerformanceRawText(draft.performanceRawText ?? '');
      setPerformanceColumnLabels(normalizePerformanceColumnLabels(draft.performanceColumnLabels));
      setPerformanceRows(nextPerformanceRows);
      setPrepSections(nextPrepSections);
      setAfterClassImage(nextAfterClassImage);
      setSuppliesImage(nextSuppliesImage);
      setAfterClassBlocks(resolveFooterBlocks(draft.afterClassBlocks, nextPrepSections.afterClassText, nextAfterClassImage));
      setSuppliesBlocks(resolveFooterBlocks(draft.suppliesBlocks, nextPrepSections.suppliesText, nextSuppliesImage));
      setHighlights(normalizeHighlights(draft.highlights, true));
      setHighlightColumns(normalizeHighlightColumns(draft.highlightColumns));
      setCustomSections(normalizeCustomSections(draft.customSections));
      setSectionVisibility(normalizeSectionVisibility(draft.sectionVisibility));
      setSectionOrder(normalizeSectionOrder(draft.sectionOrder));
      setBackgroundImage(freshTemplate?.backgroundImage || draft.backgroundImage || '');
      setDraftSaveStatus(`已载入草稿 ${formatDraftSaveTime()}`);
      markDraftReady();
      return;
    }

    const defaultCampName = buildDefaultDisplayName(majorCamp, minorCamp);
    setDisplayCampName(isInitialBasicSelection ? initialBasicSelection.displayCampName : template ? template.defaultDisplayCampName : defaultCampName);
    setGoalText(template ? template.goalText : buildGoalTextFromPlan(reportPlan, defaultCampName));
    setClassroomObservationTitle(DEFAULT_CLASSROOM_OBSERVATION_TITLE);
    setClassroomObservation('');
    setPerformanceRawText('');
    setPerformanceColumnLabels([...DEFAULT_PERFORMANCE_COLUMN_LABELS]);
    setPerformanceRows(createBlankStudentRows());
    const defaultPrepSections = normalizePrepSections(parsePrepSections(template ? template.prepText : buildPrepTextFromPlan(reportPlan)));
    setPrepSections(defaultPrepSections);
    setAfterClassImage(defaultAfterClassImage);
    setSuppliesImage('');
    setAfterClassBlocks(buildLegacyFooterBlocks(defaultPrepSections.afterClassText, defaultAfterClassImage));
    setSuppliesBlocks(buildLegacyFooterBlocks(defaultPrepSections.suppliesText, ''));
    setHighlights(createDefaultHighlights());
    setHighlightColumns(DEFAULT_HIGHLIGHT_COLUMNS);
    setCustomSections([]);
    setSectionVisibility(DEFAULT_SECTION_VISIBILITY);
    setSectionOrder(DEFAULT_SECTION_ORDER);
    setBackgroundImage(template?.backgroundImage ?? '');
    setDraftSaveStatus('草稿会自动保存');
    markDraftReady();
  }, [reportDate, majorCamp, minorCamp, currentDayIndex, currentDayLabel, reportPlan, initialBasicSelection.displayCampName, templateMap]);

  useEffect(() => {
    saveLastBasicSelection({
      majorCamp,
      minorCamp,
      reportDate,
      displayCampName,
    });
  }, [majorCamp, minorCamp, reportDate, displayCampName]);

  useEffect(() => {
    const template = getTemplateFromMap(templateMap, configMajorCamp, configMinorCamp, configDayIndex);
    setConfigDisplayCampName(template ? template.defaultDisplayCampName : buildDefaultDisplayName(configMajorCamp, configMinorCamp));
    setConfigGoalText(template ? template.goalText : getFallbackGoalText(configMajorCamp, configMinorCamp));
    setConfigPrepText(template ? template.prepText : getFallbackPrepText());
    setConfigBackgroundImage(template?.backgroundImage ?? '');
  }, [configMajorCamp, configMinorCamp, configDayIndex, templateMap]);

  useEffect(() => {
    const defaultTheme = getDefaultCampTheme(configMajorCamp);
    const savedTheme = themeConfigs[configMajorCamp];
    const nextLogo = savedTheme?.logoImage || defaultTheme.logoImage;
    setConfigThemeLogo(nextLogo);
    setConfigThemeReferenceImage(nextLogo);
    setConfigThemePalette(normalizePalette(savedTheme?.palette, defaultTheme.palette));
    setConfigThemeSource(savedTheme?.source || 'default');
  }, [configMajorCamp, themeConfigs]);

  useEffect(() => {
    const handleThemeUpdate = () => setThemeConfigs(loadCampReportThemeConfigs());
    window.addEventListener(CAMP_THEME_UPDATED_EVENT, handleThemeUpdate);
    window.addEventListener('storage', handleThemeUpdate);
    return () => {
      window.removeEventListener(CAMP_THEME_UPDATED_EVENT, handleThemeUpdate);
      window.removeEventListener('storage', handleThemeUpdate);
    };
  }, []);

  const previewHighlights = highlights;
  const previewCustomSections = useMemo(
    () => customSections.filter((section) => (
      section.title.trim() ||
      section.body.trim() ||
      section.images.some((image) => image.image || image.caption.trim())
    )),
    [customSections],
  );
  const todayLabel = useMemo(() => formatDateLabel(reportDate), [reportDate]);
  const themeVars = useMemo(() => buildCampThemeVars(currentTheme), [currentTheme]);
  const goalBlocks = useMemo(() => parseGoalBlocks(goalText), [goalText]);
  const visibleGoalBlocks = useMemo(
    () => goalBlocks.filter((item) => isPreviewGoalBlockVisible(item.title)),
    [goalBlocks],
  );
  const previewPerformanceRows = useMemo(
    () => performanceRows.filter(hasPerformanceRowContent),
    [performanceRows],
  );
  const filledPerformanceCount = useMemo(
    () => performanceRows.filter(hasPerformanceRowContent).length,
    [performanceRows],
  );

  function saveDraft(options: { silent?: boolean } = {}) {
    const nextPrepSections = {
      ...prepSections,
      afterClassText: getFooterBlocksText(afterClassBlocks),
      suppliesText: getFooterBlocksText(suppliesBlocks),
    };
    const draft: CampReportDraft = {
      id: createId('draft'),
      reportDate,
      dayLabel: currentDayLabel,
      majorCamp,
      minorCamp,
      displayCampName,
      goalText,
      classroomObservationTitle,
      classroomObservation,
      performanceRawText,
      performanceColumnLabels,
      performanceRows,
      prepText: serializePrepSectionsValue(nextPrepSections),
      prepSections: nextPrepSections,
      afterClassImage: getFirstFooterBlockImage(afterClassBlocks) || afterClassImage,
      suppliesImage: getFirstFooterBlockImage(suppliesBlocks) || suppliesImage,
      afterClassBlocks,
      suppliesBlocks,
      highlights,
      highlightColumns,
      customSections,
      sectionVisibility,
      sectionOrder,
      backgroundImage,
      updatedAt: Date.now(),
    };
    try {
      upsertCampReportDraft(draft);
      setDraftSaveStatus(`已保存 ${formatDraftSaveTime()}`);
      if (!options.silent) {
        setNotice('已保存当前草稿。');
      }
    } catch (error) {
      console.error('Failed to save camp report draft', error);
      const message = '草稿保存失败：图片可能过多或过大，请删除不用的图片后再保存。';
      setDraftSaveStatus(message);
      if (!options.silent) {
        setNotice(message);
      }
    }
  }

  useEffect(() => {
    if (!autoSaveDraftReadyRef.current) {
      return;
    }
    setDraftSaveStatus('正在自动保存...');
    const timer = window.setTimeout(() => {
      saveDraft({ silent: true });
    }, AUTOSAVE_DRAFT_DELAY_MS);
    autoSaveDraftTimerRef.current = timer;
    return () => {
      window.clearTimeout(timer);
      if (autoSaveDraftTimerRef.current === timer) {
        autoSaveDraftTimerRef.current = null;
      }
    };
  }, [
    reportDate,
    currentDayLabel,
    majorCamp,
    minorCamp,
    displayCampName,
    goalText,
    classroomObservationTitle,
    classroomObservation,
    performanceRawText,
    performanceColumnLabels,
    performanceRows,
    prepSections,
    afterClassImage,
    suppliesImage,
    afterClassBlocks,
    suppliesBlocks,
    highlights,
    highlightColumns,
    customSections,
    sectionVisibility,
    sectionOrder,
    backgroundImage,
  ]);

  function handleParsePerformance() {
    const rows = parsePerformanceRows(performanceRawText);
    const hasContent = rows.some(hasPerformanceRowContent);
    const hadAbsentObservationConflicts = hasContent && getAbsentObservationRows(rows).length > 0;
    const checkedRows = hasContent ? resolveAbsentObservationConflicts(rows) : createBlankStudentRows();
    setPerformanceRows(checkedRows);
    if (hasContent && checkedRows !== rows) {
      setPerformanceRawText(serializePerformanceRows(checkedRows));
      return;
    }
    if (hadAbsentObservationConflicts) return;
    setNotice(hasContent ? `已识别并补齐 ${STUDENT_ROW_COUNT} 行名单 / 观察行。` : `没有识别到有效内容，已保留 ${STUDENT_ROW_COUNT} 行空表格。`);
  }

  function handlePerformanceRawTextChange(value: string) {
    setPerformanceRawText(value);
    const rows = parsePerformanceRows(value);
    if (!rows.some(hasPerformanceRowContent)) {
      setPerformanceRows(createBlankStudentRows());
      return;
    }
    const checkedRows = resolveAbsentObservationConflicts(rows);
    setPerformanceRows(checkedRows);
    if (checkedRows !== rows) {
      setPerformanceRawText(serializePerformanceRows(checkedRows));
    }
  }

  function resolveAbsentObservationConflicts(rows: CampReportPerformanceRow[]) {
    const conflicts = getAbsentObservationRows(rows);
    if (conflicts.length === 0) {
      absentObservationPromptSignatureRef.current = '';
      return rows;
    }

    const signature = buildAbsentObservationSignature(rows);
    if (signature && absentObservationPromptSignatureRef.current === signature) return rows;
    absentObservationPromptSignatureRef.current = signature;

    const confirmed = window.confirm(`有 ${conflicts.length} 人标记为未到课，但仍然填写了课堂观察。是否将这部分学生的词句掌握和对话掌握设置为空？`);
    if (!confirmed) {
      setNotice(`已保留 ${conflicts.length} 名未到课学生的课堂观察。`);
      return rows;
    }

    setNotice(`已清空 ${conflicts.length} 名未到课学生的课堂观察。`);
    return clearAbsentClassroomObservations(rows);
  }

  function updatePerformanceRow(id: string, field: CampReportPerformanceField, value: string) {
    const rows = performanceRows.map((row) => (row.id === id ? { ...row, [field]: value } : row));
    const checkedRows = resolveAbsentObservationConflicts(rows);
    setPerformanceRows(checkedRows);
    if (checkedRows !== rows && performanceRawText.trim()) {
      setPerformanceRawText(serializePerformanceRows(checkedRows));
    }
  }

  function updatePerformanceColumnLabel(index: number, value: string) {
    setPerformanceColumnLabels((labels) => labels.map((label, currentIndex) => (
      currentIndex === index ? value : label
    )));
  }

  function updateGoalBlock(sourceIndex: number, field: 'title' | 'body', value: string) {
    setGoalText((current) => serializeGoalBlocks(current, sourceIndex, field, value));
  }

  function addGoalBlock() {
    setGoalText((current) => {
      const visibleBlocks = parseGoalBlocks(current).filter((item) => isPreviewGoalBlockVisible(item.title));
      if (visibleBlocks.length >= 4) return current;
      return serializeVisibleGoalBlocks(current, [
        ...visibleBlocks.map((item) => ({ title: item.title, body: item.body })),
        { title: `${TEACHING_GOAL_TITLE}${visibleBlocks.length + 1}`, body: '' },
      ]);
    });
  }

  function removeGoalBlock(sourceIndex: number) {
    setGoalText((current) => {
      const visibleBlocks = parseGoalBlocks(current).filter((item) => isPreviewGoalBlockVisible(item.title));
      if (visibleBlocks.length <= 1) return current;
      const nextBlocks = visibleBlocks
        .filter((item) => item.sourceIndex !== sourceIndex)
        .map((item) => ({ title: item.title, body: item.body }));
      return serializeVisibleGoalBlocks(current, nextBlocks.length > 0 ? nextBlocks : visibleBlocks.slice(0, 1));
    });
  }

  function updatePrepSection(target: 'afterClass' | 'supplies', field: 'title' | 'body', value: string) {
    setPrepSections((current) => {
      const next = { ...current };
      if (target === 'afterClass') {
        if (field === 'title') next.afterClassTitle = value;
        else next.afterClassText = value;
      } else if (field === 'title') {
        next.suppliesTitle = value;
      } else {
        next.suppliesText = value;
      }
      return next;
    });
  }

  function syncFooterSectionFromBlocks(target: CampReportFooterTarget, blocks: CampReportFooterBlock[]) {
    const text = getFooterBlocksText(blocks);
    const image = getFirstFooterBlockImage(blocks);
    setPrepSections((current) => ({
      ...current,
      ...(target === 'afterClass' ? { afterClassText: text } : { suppliesText: text }),
    }));
    if (target === 'afterClass') {
      setAfterClassImage(image);
    } else {
      setSuppliesImage(image);
    }
  }

  function updateFooterBlocks(
    target: CampReportFooterTarget,
    mapper: (blocks: CampReportFooterBlock[]) => CampReportFooterBlock[],
  ) {
    const currentBlocks = target === 'afterClass' ? afterClassBlocks : suppliesBlocks;
    const nextBlocks = mapper(currentBlocks).map((block) => normalizeFooterBlock(block));
    if (target === 'afterClass') {
      setAfterClassBlocks(nextBlocks);
    } else {
      setSuppliesBlocks(nextBlocks);
    }
    syncFooterSectionFromBlocks(target, nextBlocks);
  }

  function addFooterTextBlock(target: CampReportFooterTarget) {
    updateFooterBlocks(target, (blocks) => [...blocks, createFooterTextBlock('')]);
  }

  function addFooterImageBlock(target: CampReportFooterTarget) {
    updateFooterBlocks(target, (blocks) => [...blocks, createFooterImageBlock('')]);
  }

  function updateFooterBlock(target: CampReportFooterTarget, id: string, patch: Partial<CampReportFooterBlock>) {
    updateFooterBlocks(target, (blocks) => blocks.map((block) => (
      block.id === id ? { ...block, ...patch } : block
    )));
  }

  function removeFooterBlock(target: CampReportFooterTarget, id: string) {
    updateFooterBlocks(target, (blocks) => blocks.filter((block) => block.id !== id));
  }

  function moveFooterBlock(target: CampReportFooterTarget, id: string, direction: -1 | 1) {
    updateFooterBlocks(target, (blocks) => {
      const next = [...blocks];
      const index = next.findIndex((block) => block.id === id);
      const targetIndex = index + direction;
      if (index < 0 || targetIndex < 0 || targetIndex >= next.length) return next;
      const [item] = next.splice(index, 1);
      next.splice(targetIndex, 0, item);
      return next;
    });
  }

  function moveFooterBlockToIndex(target: CampReportFooterTarget, id: string, targetIndex: number) {
    updateFooterBlocks(target, (blocks) => {
      const sourceIndex = blocks.findIndex((block) => block.id === id);
      if (sourceIndex < 0 || sourceIndex === targetIndex) return blocks;
      const next = [...blocks];
      const [item] = next.splice(sourceIndex, 1);
      next.splice(Math.max(0, Math.min(targetIndex, next.length)), 0, item);
      return next;
    });
  }

  function handleFooterBlockDragStart(event: DragEvent<HTMLDivElement>, target: CampReportFooterTarget, id: string) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/x-camp-footer-block', JSON.stringify({ target, id }));
  }

  function handleFooterBlockDrop(event: DragEvent<HTMLDivElement>, target: CampReportFooterTarget, targetIndex: number) {
    const raw = event.dataTransfer.getData('application/x-camp-footer-block');
    if (!raw) return;
    event.preventDefault();
    try {
      const payload = JSON.parse(raw) as { target?: CampReportFooterTarget; id?: string };
      if (payload.target !== target || !payload.id) return;
      moveFooterBlockToIndex(target, payload.id, targetIndex);
    } catch {
      return;
    }
  }

  function moveHighlightToIndex(id: string, targetIndex: number) {
    setHighlights((items) => {
      const sourceIndex = items.findIndex((item) => item.id === id);
      if (sourceIndex < 0 || sourceIndex === targetIndex) return items;
      const next = [...items];
      const [item] = next.splice(sourceIndex, 1);
      next.splice(Math.max(0, Math.min(targetIndex, next.length)), 0, item);
      return next;
    });
  }

  function handleHighlightDragStart(event: DragEvent<HTMLDivElement>, id: string) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/x-camp-highlight', id);
  }

  function handleHighlightDrop(event: DragEvent<HTMLDivElement>, targetIndex: number) {
    const id = event.dataTransfer.getData('application/x-camp-highlight');
    if (!id) return;
    event.preventDefault();
    moveHighlightToIndex(id, targetIndex);
  }

  function setOptionalSectionVisible(section: CampReportOptionalSectionKey, visible: boolean) {
    setSectionVisibility((current) => ({ ...current, [section]: visible }));
    if (visible) {
      setCollapsedEditorSections((current) => ({ ...current, [section]: false }));
    }
  }

  function moveOptionalSection(section: CampReportOptionalSectionKey, direction: -1 | 1) {
    setSectionOrder((current) => {
      const next = normalizeSectionOrder(current);
      const index = next.indexOf(section);
      const targetIndex = index + direction;
      if (index < 0 || targetIndex < 0 || targetIndex >= next.length) return next;
      const [item] = next.splice(index, 1);
      next.splice(targetIndex, 0, item);
      return next;
    });
  }

  function resetPerformanceRows() {
    setPerformanceRows(createBlankStudentRows());
    setPerformanceRawText('');
    setNotice('已清空名单 / 观察表。');
  }

  function updateHighlight(id: string, field: keyof Omit<CampReportHighlight, 'id'>, value: string) {
    setHighlights((items) => items.map((item) => (item.id === id ? { ...item, [field]: value } : item)));
  }

  async function handleHighlightImageChange(id: string, event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const image = await readFileAsDataUrl(file);
      setHighlights((items) => items.map((item) => {
        if (item.id !== id) return item;
        const shouldUseDefaultFrame = !item.image && (!item.frame || item.frame === 'none');
        return {
          ...item,
          image,
          frame: shouldUseDefaultFrame ? DEFAULT_HIGHLIGHT_FRAME : item.frame,
        };
      }));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '图片读取失败。');
    } finally {
      input.value = '';
    }
  }

  function addHighlightGroup() {
    setHighlights((items) => [...items, createEmptyHighlight()]);
    setCollapsedEditorSections((current) => ({ ...current, highlights: false }));
    setNotice('已新增一组精彩瞬间，可以上传图片并选择外框。');
  }

  async function handleBackgroundUpload(event: ChangeEvent<HTMLInputElement>, target: 'editor' | 'config') {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const image = await readFileAsDataUrl(file);
      if (target === 'editor') {
        setBackgroundImage(image);
        setNotice('已替换当前日报背景图。');
        return;
      }
      setConfigBackgroundImage(image);
      setNotice('已更新配置背景图，记得保存配置。');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '图片读取失败。');
    } finally {
      input.value = '';
    }
  }

  async function applyConfigThemeImagePalette(image: string, nextSource: CampReportThemeConfig['source'], label: string) {
    setConfigThemeReferenceImage(image);
    try {
      const accent = await extractDominantColorFromImage(image);
      setConfigThemePalette(createPaletteFromAccent(accent));
      setConfigThemeSource(nextSource);
      setNotice(`已识别${label}主色 ${accent}，可以继续微调或保存主题。`);
    } catch (error) {
      setConfigThemeSource('manual');
      setNotice(error instanceof Error ? error.message : `${label}主色识别失败，可以手动选择主色。`);
    }
  }

  async function handleThemeLogoUpload(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const image = await readFileAsDataUrl(file);
      setConfigThemeLogo(image);
      await applyConfigThemeImagePalette(image, 'logo', 'Logo');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '图片读取失败。');
    } finally {
      input.value = '';
    }
  }

  async function handleThemeReferenceImageUpload(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const image = await readFileAsDataUrl(file);
      await applyConfigThemeImagePalette(image, 'image', '参考图');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '图片读取失败。');
    } finally {
      input.value = '';
    }
  }

  async function reExtractThemeFromLogo() {
    const image = configThemeReferenceImage || configThemeLogo;
    if (!image) {
      setNotice('请先上传 Logo 或参考图。');
      return;
    }
    try {
      const accent = await extractDominantColorFromImage(image);
      setConfigThemePalette(createPaletteFromAccent(accent));
      setConfigThemeSource(configThemeSource === 'logo' ? 'logo' : 'image');
      setNotice(`已重新识别主色 ${accent}。`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '参考图主色识别失败。');
    }
  }

  function updateConfigThemeColor(key: keyof CampReportPalette, value: string) {
    setConfigThemePalette((current) => normalizePalette({ ...current, [key]: value }, getDefaultCampTheme(configMajorCamp).palette));
    setConfigThemeSource('manual');
  }

  function regenerateConfigThemeFromAccent() {
    setConfigThemePalette((current) => createPaletteFromAccent(current.accent));
    setConfigThemeSource('manual');
    setNotice('已根据当前主色重新生成整套配色。');
  }

  function saveConfigTheme() {
    const defaultTheme = getDefaultCampTheme(configMajorCamp);
    upsertCampReportThemeConfig({
      majorCamp: configMajorCamp,
      logoImage: configThemeLogo,
      palette: normalizePalette(configThemePalette, defaultTheme.palette),
      source: configThemeSource === 'default' ? 'manual' : configThemeSource,
      updatedAt: Date.now(),
    });
    setThemeConfigs(loadCampReportThemeConfigs());
    window.dispatchEvent(new CustomEvent(CAMP_THEME_UPDATED_EVENT, { detail: { majorCamp: configMajorCamp } }));
    setNotice(`已保存 ${configMajorCamp} 主题。`);
  }

  function resetConfigTheme() {
    deleteCampReportThemeConfig(configMajorCamp);
    setThemeConfigs(loadCampReportThemeConfigs());
    const defaultTheme = getDefaultCampTheme(configMajorCamp);
    setConfigThemeLogo(defaultTheme.logoImage);
    setConfigThemeReferenceImage(defaultTheme.logoImage);
    setConfigThemePalette(defaultTheme.palette);
    setConfigThemeSource('default');
    window.dispatchEvent(new CustomEvent(CAMP_THEME_UPDATED_EVENT, { detail: { majorCamp: configMajorCamp } }));
    setNotice(`已恢复 ${configMajorCamp} 默认主题。`);
  }

  async function handleFooterImageUpload(event: ChangeEvent<HTMLInputElement>, target: 'afterClass' | 'supplies') {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const image = await readFileAsDataUrl(file);
      if (target === 'afterClass') {
        setAfterClassImage(image);
        updateFooterBlocks('afterClass', (blocks) => (
          blocks.some((block) => block.type === 'image')
            ? blocks.map((block) => (block.type === 'image' ? { ...block, image } : block))
            : [createFooterImageBlock(image), ...blocks]
        ));
        setNotice(`已更新${CHALLENGE_SECTION_TITLE}图片区。`);
        return;
      }
      setSuppliesImage(image);
      updateFooterBlocks('supplies', (blocks) => (
        blocks.some((block) => block.type === 'image')
          ? blocks.map((block) => (block.type === 'image' ? { ...block, image } : block))
          : [createFooterImageBlock(image), ...blocks]
      ));
      setNotice(`已更新${REMINDER_SECTION_TITLE}图片区。`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '图片读取失败。');
    } finally {
      input.value = '';
    }
  }

  async function handleFooterBlockImageUpload(target: CampReportFooterTarget, id: string, event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const image = await readFileAsDataUrl(file);
      updateFooterBlock(target, id, { image });
      setNotice('已更新板块图片。');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '图片读取失败。');
    } finally {
      input.value = '';
    }
  }

  function updateCustomSection(id: string, field: 'title' | 'body', value: string) {
    setCustomSections((sections) => sections.map((section) => (
      section.id === id ? { ...section, [field]: value } : section
    )));
  }

  function addCustomSectionImage(sectionId: string) {
    setCustomSections((sections) => sections.map((section) => (
      section.id === sectionId
        ? { ...section, images: [...section.images, createEmptyCustomImage()] }
        : section
    )));
  }

  function updateCustomSectionImage(
    sectionId: string,
    imageId: string,
    field: keyof Omit<CampReportCustomImage, 'id'>,
    value: string,
  ) {
    patchCustomSectionImage(sectionId, imageId, { [field]: value });
  }

  function patchCustomSectionImage(
    sectionId: string,
    imageId: string,
    patch: Partial<Omit<CampReportCustomImage, 'id'>>,
  ) {
    setCustomSections((sections) => sections.map((section) => (
      section.id === sectionId
        ? {
          ...section,
          images: section.images.map((image) => (
            image.id === imageId ? { ...image, ...patch } : image
          )),
        }
        : section
    )));
  }

  function moveCustomSectionImageToIndex(sectionId: string, imageId: string, targetIndex: number) {
    setCustomSections((sections) => sections.map((section) => {
      if (section.id !== sectionId) return section;
      const sourceIndex = section.images.findIndex((image) => image.id === imageId);
      if (sourceIndex < 0 || sourceIndex === targetIndex) return section;
      const images = [...section.images];
      const [image] = images.splice(sourceIndex, 1);
      images.splice(Math.max(0, Math.min(targetIndex, images.length)), 0, image);
      return { ...section, images };
    }));
  }

  function handleCustomImageDragStart(event: DragEvent<HTMLDivElement>, sectionId: string, imageId: string) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/x-camp-custom-image', JSON.stringify({ sectionId, imageId }));
  }

  function handleCustomImageDrop(event: DragEvent<HTMLDivElement>, sectionId: string, targetIndex: number) {
    const raw = event.dataTransfer.getData('application/x-camp-custom-image');
    if (!raw) return;
    event.preventDefault();
    try {
      const payload = JSON.parse(raw) as { sectionId?: string; imageId?: string };
      if (payload.sectionId !== sectionId || !payload.imageId) return;
      moveCustomSectionImageToIndex(sectionId, payload.imageId, targetIndex);
    } catch {
      return;
    }
  }

  async function handleCustomSectionImageUpload(sectionId: string, imageId: string, event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const image = await readFileAsDataUrl(file);
      updateCustomSectionImage(sectionId, imageId, 'image', image);
      setNotice('已更新自定义板块图片。');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '图片读取失败。');
    } finally {
      input.value = '';
    }
  }

  function removeCustomSectionImage(sectionId: string, imageId: string) {
    setCustomSections((sections) => sections.map((section) => (
      section.id === sectionId
        ? { ...section, images: section.images.filter((image) => image.id !== imageId) }
        : section
    )));
  }

  function openImageCrop(target: ImageCropTarget) {
    if (!target.image) {
      setNotice('请先上传图片，再进行裁剪。');
      return;
    }
    setCropTarget(target);
  }

  function getCropPointerPoint(event: PointerEvent<HTMLElement>): CropPoint | null {
    const stage = cropStageRef.current;
    if (!stage) return null;
    const rect = stage.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
      x: clampNumber(((event.clientX - rect.left) / rect.width) * 100, 0, 100),
      y: clampNumber(((event.clientY - rect.top) / rect.height) * 100, 0, 100),
    };
  }

  function startCropDrag(mode: CropDragMode, event: PointerEvent<HTMLElement>) {
    const point = getCropPointerPoint(event);
    if (!point) return;
    event.preventDefault();
    event.stopPropagation();
    cropStageRef.current?.setPointerCapture(event.pointerId);
    if (mode === 'create') {
      const nextSelection = normalizeCropSelection({
        x: point.x,
        y: point.y,
        width: MIN_CROP_PERCENT,
        height: MIN_CROP_PERCENT,
      });
      setCropSelection(nextSelection);
      setCropDragState({ mode, startPoint: point, startSelection: nextSelection });
      return;
    }
    setCropDragState({ mode, startPoint: point, startSelection: cropSelection });
  }

  function handleCropPointerMove(event: PointerEvent<HTMLElement>) {
    if (!cropDragState) return;
    const point = getCropPointerPoint(event);
    if (!point) return;
    event.preventDefault();
    const dx = point.x - cropDragState.startPoint.x;
    const dy = point.y - cropDragState.startPoint.y;
    if (cropDragState.mode === 'create') {
      setCropSelection(createCropSelectionFromPoints(cropDragState.startPoint, point));
      return;
    }
    if (cropDragState.mode === 'move') {
      setCropSelection(normalizeCropSelection({
        ...cropDragState.startSelection,
        x: cropDragState.startSelection.x + dx,
        y: cropDragState.startSelection.y + dy,
      }));
      return;
    }
    setCropSelection(resizeCropSelection(cropDragState.startSelection, cropDragState.mode, dx, dy));
  }

  function finishCropDrag(event: PointerEvent<HTMLElement>) {
    if (!cropDragState) return;
    event.preventDefault();
    setCropDragState(null);
    setCropSelection((selection) => normalizeCropSelection(selection));
  }

  async function applyCropSelection() {
    if (!cropTarget) return;
    try {
      const croppedImage = await cropImageDataUrl(cropTarget.image, cropSelection);
      if (cropTarget.kind === 'footer') {
        updateFooterBlock(cropTarget.target, cropTarget.id, { image: croppedImage, fit: 'contain' });
      } else if (cropTarget.kind === 'highlight') {
        setHighlights((items) => items.map((item) => (
          item.id === cropTarget.id ? { ...item, image: croppedImage, fit: 'contain' } : item
        )));
      } else {
        patchCustomSectionImage(cropTarget.sectionId, cropTarget.imageId, { image: croppedImage, fit: 'contain' });
      }
      setCropTarget(null);
      setNotice('已按框选区域裁剪图片。');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '图片裁剪失败。');
    }
  }

  function focusEditorSection(section: string) {
    setCollapsedEditorSections((current) => {
      const next = { ...current, [section]: false };
      if (section.startsWith('custom-')) {
        next.customSections = false;
      }
      return next;
    });
    window.requestAnimationFrame(() => {
      const target = document.querySelector<HTMLElement>(`[data-camp-editor-section="${section}"]`);
      if (!target) return;
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setFocusedEditorSection(section);
      if (editorFocusTimerRef.current) {
        window.clearTimeout(editorFocusTimerRef.current);
      }
      editorFocusTimerRef.current = window.setTimeout(() => {
        setFocusedEditorSection((current) => (current === section ? '' : current));
        editorFocusTimerRef.current = null;
      }, 1600);
    });
  }

  function focusPreviewSection(section: string, behavior: ScrollBehavior = 'smooth') {
    const container = previewFrameRef.current;
    const target = container?.querySelector<HTMLElement>(`[data-camp-preview-section="${section}"]`);
    if (!container) return;
    if (!target) return;
    const targetTop = target.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
    container.scrollTo({ top: Math.max(targetTop - 12, 0), behavior });
    setFocusedPreviewSection(section);
    if (previewFocusTimerRef.current) {
      window.clearTimeout(previewFocusTimerRef.current);
    }
    previewFocusTimerRef.current = window.setTimeout(() => {
      setFocusedPreviewSection((current) => (current === section ? '' : current));
      previewFocusTimerRef.current = null;
    }, 1400);
  }

  function handleEditorSectionActive(event: SyntheticEvent<HTMLElement>, behavior: ScrollBehavior = 'smooth') {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-camp-editor-section]');
    const section = target?.dataset.campEditorSection;
    if (!section) return;
    focusPreviewSection(section, behavior);
  }

  function getPreviewJumpProps(section: string) {
    return {
      role: 'button',
      tabIndex: 0,
      onClick: () => focusEditorSection(section),
      onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          focusEditorSection(section);
        }
      },
    };
  }

  function getEditorSectionClass(baseClass: string, section: string) {
    return [
      baseClass,
      focusedEditorSection === section ? 'is-editor-focused' : '',
      collapsedEditorSections[section] ? 'is-editor-collapsed' : '',
    ].filter(Boolean).join(' ');
  }

  function getPreviewSectionClass(baseClass: string, section: string) {
    return [
      baseClass,
      focusedPreviewSection === section ? 'is-preview-focused' : '',
    ].filter(Boolean).join(' ');
  }

  function toggleEditorSectionCollapsed(section: string) {
    setCollapsedEditorSections((current) => ({
      ...current,
      [section]: !current[section],
    }));
  }

  function renderEditorCollapseButton(section: string) {
    const collapsed = Boolean(collapsedEditorSections[section]);
    return (
      <button
        type="button"
        className="btn btn-ghost btn-sm camp-editor-collapse-btn"
        onClick={() => toggleEditorSectionCollapsed(section)}
        aria-expanded={!collapsed}
      >
        {collapsed ? '展开' : '折叠'}
      </button>
    );
  }

  async function createReportImageExport() {
    if (!cardRef.current) throw new Error('没有找到可导出的日报预览。');
    const fileName = `${displayCampName || `${majorCamp}_${minorCamp}`}_${reportDate}_日报.png`;
    const exportTarget = cardRef.current;
    let primaryError: unknown = null;
    await waitForReportImagesReady(exportTarget);

    try {
      const { toBlob } = await import('html-to-image');
      const imageBlob = await withTimeout(toBlob(exportTarget, {
        cacheBust: true,
        pixelRatio: 2,
        backgroundColor: '#ffffff',
      }), 45000, '导出图片生成超时，请刷新页面后重试。');
      if (imageBlob && imageBlob.size > 0) {
        return { blob: imageBlob, fileName };
      }
      primaryError = new Error('导出图片为空');
    } catch (error) {
      primaryError = error;
    }

    try {
      const { default: html2canvas } = await import('html2canvas');
      const canvas = await withTimeout(html2canvas(exportTarget, {
        backgroundColor: '#ffffff',
        scale: 2,
        useCORS: true,
        logging: false,
        onclone: (clonedDocument) => {
          clonedDocument.querySelectorAll('style, link[rel="stylesheet"]').forEach((node) => node.remove());
        },
      }), 30000, '备用导出生成超时');
      const fallbackBlob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((nextBlob) => {
          if (nextBlob && nextBlob.size > 0) {
            resolve(nextBlob);
            return;
          }
          reject(new Error('导出图片生成失败'));
        }, 'image/png');
      });
      return { blob: fallbackBlob, fileName };
    } catch (fallbackError) {
      const reason = fallbackError instanceof Error
        ? fallbackError.message
        : primaryError instanceof Error
          ? primaryError.message
          : '未知错误';
      throw new Error(`导出图片生成失败：${reason}`);
    }
  }

  function downloadExportImage(blob: Blob, fileName: string) {
    const imageUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.download = fileName;
    link.href = imageUrl;
    document.body.appendChild(link);
    requestAnimationFrame(() => {
      link.click();
    });
    window.setTimeout(() => {
      link.remove();
    }, 1000);
    window.setTimeout(() => {
      URL.revokeObjectURL(imageUrl);
    }, 60000);
  }

  async function handleDownloadImage() {
    setExporting(true);
    setExportAction('download');
    try {
      const { blob, fileName } = await createReportImageExport();
      downloadExportImage(blob, fileName);
      saveDraft();
      setNotice('已下载日报图片。');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '导出图片失败。');
    } finally {
      setExporting(false);
      setExportAction('');
    }
  }

  async function handleCopyImageToClipboard() {
    setExporting(true);
    setExportAction('clipboard');
    try {
      const { blob } = await createReportImageExport();
      try {
        await writePngBlobToClipboard(blob);
        saveDraft();
        setNotice('已复制日报图片。');
      } catch (clipboardError) {
        saveDraft();
        setNotice(clipboardError instanceof Error
          ? `${clipboardError.message} 请改用“下载图片”。`
          : '复制到剪贴板失败，请改用“下载图片”。');
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '导出图片失败。');
    } finally {
      setExporting(false);
      setExportAction('');
    }
  }

  function renderPreviewFooterBlocks(target: CampReportFooterTarget, blocks: CampReportFooterBlock[], title: string) {
    const visibleBlocks = blocks.filter(hasFooterBlockContent);
    return visibleBlocks.map((block) => {
      if (block.type === 'image') {
        return (
          <figure key={block.id} className={`camp-footer-rich-image fit-${block.fit || DEFAULT_CUSTOM_IMAGE_FIT}`}>
            <img src={block.image} alt={title || '板块图片'} />
          </figure>
        );
      }

      return (
        <EditablePreviewText
          key={block.id}
          className="camp-preview-copy camp-footer-rich-text whitespace"
          multiline
          value={block.text || ''}
          onChange={(value) => updateFooterBlock(target, block.id, { text: value })}
          style={{
            fontSize: `${normalizeFooterTextFontSize(block.fontSize)}px`,
            textAlign: normalizeFooterTextAlign(block.align),
            color: block.color || undefined,
          }}
        />
      );
    });
  }

  function renderFooterBlockEditor(target: CampReportFooterTarget) {
    const blocks = target === 'afterClass' ? afterClassBlocks : suppliesBlocks;
    return (
      <div className="camp-footer-block-workspace">
        <div className="camp-image-upload-row">
          <button className="btn btn-primary btn-sm camp-add-block-btn" onClick={() => addFooterTextBlock(target)}>新增文字</button>
          <button className="btn btn-primary btn-sm camp-add-block-btn" onClick={() => addFooterImageBlock(target)}>新增图片</button>
        </div>
        <div className="camp-footer-block-list">
          {blocks.length === 0 && <div className="camp-performance-empty">这个板块还没有内容，可以新增文字或图片。</div>}
          {blocks.map((block, index) => (
            <div
              key={block.id}
              className={`camp-footer-block-editor is-${block.type} is-drag-sortable`}
              draggable
              onDragStart={(event) => handleFooterBlockDragStart(event, target, block.id)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => handleFooterBlockDrop(event, target, index)}
            >
              <div className="camp-footer-block-head">
                <strong>{block.type === 'image' ? '图片块' : '文字块'} <span>拖动排序</span></strong>
                <div className="camp-inline-actions">
                  <button className="btn btn-ghost btn-sm" onClick={() => moveFooterBlock(target, block.id, -1)} disabled={index === 0}>上移</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => moveFooterBlock(target, block.id, 1)} disabled={index === blocks.length - 1}>下移</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => removeFooterBlock(target, block.id)}>删除</button>
                </div>
              </div>
              {block.type === 'image' ? (
                <div className="camp-footer-image-block-editor">
                  <label className={`camp-footer-image-block-thumb is-upload-target${block.image ? ' has-image' : ''}`}>
                    {block.image ? <img src={block.image} alt="板块图片" /> : <span>点击上传图片</span>}
                    <input type="file" hidden accept="image/*" onChange={(event) => { void handleFooterBlockImageUpload(target, block.id, event); }} />
                  </label>
                  <div className="camp-footer-image-block-fields">
                    <div className="camp-image-upload-row">
                      <label className="btn btn-ghost btn-sm">
                        上传图片
                        <input type="file" hidden accept="image/*" onChange={(event) => { void handleFooterBlockImageUpload(target, block.id, event); }} />
                      </label>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => openImageCrop({ kind: 'footer', target, id: block.id, image: block.image || '' })}
                        disabled={!block.image}
                      >
                        裁剪图片
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => updateFooterBlock(target, block.id, { fit: (block.fit || DEFAULT_CUSTOM_IMAGE_FIT) === 'cover' ? 'contain' : 'cover' })}
                      >
                        {(block.fit || DEFAULT_CUSTOM_IMAGE_FIT) === 'cover' ? '完整显示' : '填满框'}
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <label className="camp-field camp-field-detail">
                    <span>文字内容</span>
                    <textarea
                      rows={4}
                      value={block.text || ''}
                      onChange={(event) => updateFooterBlock(target, block.id, { text: event.target.value })}
                    />
                  </label>
                  <div className="camp-grid-three camp-footer-text-controls">
                    <label className="camp-field">
                      <span>字号</span>
                      <input
                        type="number"
                        min={MIN_FOOTER_TEXT_FONT_SIZE}
                        max={MAX_FOOTER_TEXT_FONT_SIZE}
                        value={normalizeFooterTextFontSize(block.fontSize)}
                        onChange={(event) => updateFooterBlock(target, block.id, { fontSize: Number(event.target.value) })}
                      />
                    </label>
                    <label className="camp-field">
                      <span>居中方式</span>
                      <select
                        value={normalizeFooterTextAlign(block.align)}
                        onChange={(event) => updateFooterBlock(target, block.id, { align: normalizeFooterTextAlign(event.target.value) })}
                      >
                        {FOOTER_TEXT_ALIGN_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </label>
                    <label className="camp-field camp-footer-color-field">
                      <span>字体颜色</span>
                      <input
                        type="color"
                        value={block.color || FOOTER_TEXT_COLOR_FALLBACK}
                        onChange={(event) => updateFooterBlock(target, block.id, { color: event.target.value })}
                      />
                      <button className="btn btn-ghost btn-sm" onClick={() => updateFooterBlock(target, block.id, { color: '' })}>主题色</button>
                    </label>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  function renderPreviewOptionalSection(section: CampReportOptionalSectionKey) {
    if (!sectionVisibility[section]) return null;

    if (section === 'summary') {
      return (
        <section
          key={section}
          {...getPreviewJumpProps('summary')}
          data-camp-preview-section="summary"
          className={getPreviewSectionClass('camp-preview-section is-clickable camp-module-summary camp-module-cool', 'summary')}
        >
          {classroomObservationTitle && (
            <EditablePreviewText
              className="camp-preview-section-title"
              value={classroomObservationTitle}
              onChange={setClassroomObservationTitle}
            />
          )}
          {classroomObservation && (
            <EditablePreviewText
              className="camp-preview-copy whitespace"
              multiline
              value={classroomObservation}
              onChange={setClassroomObservation}
            />
          )}
          {previewPerformanceRows.length > 0 && (
            <div className="camp-summary-racer-grid">
              <div className="camp-summary-racer-head" aria-hidden="true">
                <span>学生</span>
                <span>课堂观察</span>
                <span>到课 / 完成</span>
                <span>{performanceColumnLabels[6]}</span>
                <span>{performanceColumnLabels[7]}</span>
              </div>
              {previewPerformanceRows.map((row, index) => {
                const primaryName = row.englishName || row.chineseName || `Student ${index + 1}`;
                const secondaryName = row.chineseName && row.chineseName !== primaryName ? row.chineseName : '';
                const observationItems = [
                  { label: performanceColumnLabels[2], value: row.wordMastery, field: 'wordMastery' as const },
                  { label: performanceColumnLabels[3], value: row.dialogueMastery, field: 'dialogueMastery' as const },
                ].filter((item) => item.value);
                const statusItems = [
                  { value: row.attendance, field: 'attendance' as const },
                  { value: row.implementation, field: 'implementation' as const },
                ].filter((item) => item.value);
                return (
                  <article key={row.id} className="camp-summary-racer-card">
                    <div className="camp-summary-racer-person">
                      <div className="camp-summary-racer-name">
                        <EditablePreviewText
                          className="camp-summary-racer-name-main"
                          value={primaryName}
                          onChange={(value) => updatePerformanceRow(row.id, row.englishName ? 'englishName' : 'chineseName', value)}
                        />
                        {secondaryName && (
                          <EditablePreviewText
                            className="camp-summary-racer-name-sub"
                            value={secondaryName}
                            onChange={(value) => updatePerformanceRow(row.id, 'chineseName', value)}
                          />
                        )}
                      </div>
                    </div>
                    <div className="camp-summary-racer-observe">
                      {observationItems.map((item, itemIndex) => (
                        <div key={`${item.label}_${itemIndex}`}>
                          <span>{item.label}</span>
                          <EditablePreviewText
                            className="camp-summary-racer-observe-value"
                            value={item.value}
                            onChange={(value) => updatePerformanceRow(row.id, item.field, value)}
                          />
                        </div>
                      ))}
                    </div>
                    <div className="camp-summary-racer-status">
                      {statusItems.map((item, itemIndex) => (
                        <EditablePreviewText
                          key={`${item.value}_${itemIndex}`}
                          className={getPerformanceStatusClass(item.value)}
                          value={item.value}
                          onChange={(value) => updatePerformanceRow(row.id, item.field, value)}
                        />
                      ))}
                    </div>
                    <EditablePreviewText
                      className={`camp-summary-racer-title${row.racingTitle ? '' : ' is-empty'}`}
                      value={row.racingTitle}
                      placeholder="—"
                      onChange={(value) => updatePerformanceRow(row.id, 'racingTitle', value)}
                    />
                    <EditablePreviewText
                      className={`camp-summary-racer-note${row.remark ? '' : ' is-empty'}`}
                      multiline
                      value={row.remark}
                      placeholder="—"
                      onChange={(value) => updatePerformanceRow(row.id, 'remark', value)}
                    />
                  </article>
                );
              })}
            </div>
          )}
        </section>
      );
    }

    if (section === 'challenge') {
      return (
        <section
          key={section}
          {...getPreviewJumpProps('challenge')}
          data-camp-preview-section="challenge"
          className={getPreviewSectionClass('camp-preview-section is-clickable camp-module-challenge camp-module-warm', 'challenge')}
        >
          {prepSections.afterClassTitle && (
            <EditablePreviewText
              className="camp-preview-section-title"
              value={prepSections.afterClassTitle}
              onChange={(value) => updatePrepSection('afterClass', 'title', value)}
            />
          )}
          <article className="camp-footer-preview-card camp-footer-preview-card-wide camp-footer-preview-card-challenge">
            {renderPreviewFooterBlocks('afterClass', afterClassBlocks, prepSections.afterClassTitle || CHALLENGE_SECTION_TITLE)}
          </article>
        </section>
      );
    }

    if (section === 'reminder') {
      return (
        <section
          key={section}
          {...getPreviewJumpProps('reminder')}
          data-camp-preview-section="reminder"
          className={getPreviewSectionClass('camp-preview-section is-clickable camp-module-reminder camp-module-cool', 'reminder')}
        >
          {prepSections.suppliesTitle && (
            <EditablePreviewText
              className="camp-preview-section-title"
              value={prepSections.suppliesTitle}
              onChange={(value) => updatePrepSection('supplies', 'title', value)}
            />
          )}
          <article className="camp-footer-preview-card camp-footer-preview-card-wide camp-footer-preview-card-supplies">
            {renderPreviewFooterBlocks('supplies', suppliesBlocks, prepSections.suppliesTitle || REMINDER_SECTION_TITLE)}
          </article>
        </section>
      );
    }

    return (
      <section
        key={section}
        {...getPreviewJumpProps('highlights')}
        data-camp-preview-section="highlights"
        className={getPreviewSectionClass('camp-preview-section is-clickable camp-module-highlights camp-module-warm', 'highlights')}
      >
        <div className="camp-preview-section-title">{HIGHLIGHTS_SECTION_TITLE}</div>
        {previewHighlights.length > 0 && (
          <div className={`camp-preview-highlights columns-${highlightColumns}`}>
            {previewHighlights.map((item) => (
              <article key={item.id} className={`camp-preview-highlight-card fit-${item.fit || DEFAULT_CUSTOM_IMAGE_FIT} frame-${item.frame || DEFAULT_HIGHLIGHT_FRAME}`}>
                {item.image ? (
                  <div className={`camp-preview-highlight-image has-image frame-${item.frame || DEFAULT_HIGHLIGHT_FRAME}`}>
                    <img src={item.image} alt={item.title || HIGHLIGHTS_SECTION_TITLE} />
                    <span className="camp-highlight-frame-border" aria-hidden="true" />
                  </div>
                ) : (
                  <label
                    className={`camp-preview-highlight-image has-image is-empty is-upload-target frame-${item.frame || DEFAULT_HIGHLIGHT_FRAME}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      focusEditorSection('highlights');
                    }}
                  >
                    <span>点击上传</span>
                    <input type="file" hidden accept="image/*" onChange={(event) => { void handleHighlightImageChange(item.id, event); }} />
                  </label>
                )}
                {item.title && (
                  <EditablePreviewText
                    className="camp-preview-highlight-title"
                    value={item.title}
                    onChange={(value) => updateHighlight(item.id, 'title', value)}
                  />
                )}
                {item.reason && (
                  <EditablePreviewText
                    className="camp-preview-highlight-reason whitespace"
                    multiline
                    value={item.reason}
                    onChange={(value) => updateHighlight(item.id, 'reason', value)}
                  />
                )}
              </article>
            ))}
          </div>
        )}
      </section>
    );
  }

  async function ensureAdminPassword() {
    if (adminPassword) return adminPassword;
    const password = window.prompt('请输入管理密码');
    if (!password) return '';
    try {
      await verifyCampReportAdminPassword(password);
      setAdminSessionUnlocked();
      setAdminUnlocked(true);
      setAdminPassword(password);
      return password;
    } catch (error) {
      setAdminUnlocked(false);
      setAdminPassword('');
      setNotice(error instanceof Error ? error.message : '管理密码不正确。');
      return '';
    }
  }

  async function openManagementMode() {
    if (viewMode === 'config') {
      setViewMode('editor');
      return;
    }

    const password = await ensureAdminPassword();
    if (!password) return;
    try {
      const payload = await fetchSharedCampReportTemplates();
      applyTemplateMapUpdate(payload.templates);
    } catch (error) {
      console.warn('进入管理模式时刷新共享模板失败', error);
    }
    setViewMode('config');
  }

  function applyTemplateMapUpdate(templates: Record<string, CampReportTemplate>) {
    setTemplateMap(templates);
    saveCampReportTemplates(templates);
  }

  function applyCurrentTemplateToEditor(template: CampReportTemplate) {
    const nextPrepSections = normalizePrepSections(parsePrepSections(template.prepText));
    const defaultAfterClassImage = getDefaultAfterClassImage(template.majorCamp);
    setDisplayCampName(template.defaultDisplayCampName);
    setGoalText(template.goalText);
    setPrepSections(nextPrepSections);
    setAfterClassBlocks(buildLegacyFooterBlocks(nextPrepSections.afterClassText, defaultAfterClassImage || afterClassImage));
    setSuppliesBlocks(buildLegacyFooterBlocks(nextPrepSections.suppliesText, suppliesImage));
    setBackgroundImage(template.backgroundImage);
  }

  function applyImportedTemplates(templates: CampReportTemplate[], nextTemplateMap?: Record<string, CampReportTemplate>) {
    if (nextTemplateMap) {
      applyTemplateMapUpdate(nextTemplateMap);
    }
    const currentTemplate = templates.find((template) => (
      template.majorCamp === majorCamp &&
      template.minorCamp === minorCamp &&
      template.dayIndex === currentDayIndex
    ));
    if (currentTemplate) {
      applyCurrentTemplateToEditor(currentTemplate);
    }
    setNotice(`已导入 ${templates.length} 条课程目标 / 课表配置。`);
  }

  async function importCampTemplatesFromText(rawText = templateImportText) {
    try {
      const templates = parseCampTemplateImportText(rawText, templateMap);
      if (templates.length === 0) {
        setNotice('没有识别到可导入的课程目标 / 课表配置，请检查字段名。');
        return;
      }
      const password = await ensureAdminPassword();
      if (!password) return;
      const payload = await saveSharedCampReportTemplates(password, templates);
      applyImportedTemplates(templates, payload.templates);
      setTemplateImportText('');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '导入失败，请检查文件格式。');
    }
  }

  async function handleTemplateImportFile(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const templates = await parseCampTemplateImportFile(file, templateMap);
      if (templates.length === 0) {
        setNotice('没有识别到可导入的课程目标 / 课表配置，请检查 Excel 表头。');
        return;
      }
      const password = await ensureAdminPassword();
      if (!password) return;
      const payload = await saveSharedCampReportTemplates(password, templates);
      applyImportedTemplates(templates, payload.templates);
      setTemplateImportText('');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '文件读取失败。');
    } finally {
      input.value = '';
    }
  }

  async function saveCurrentTemplate() {
    const template = {
      id: createId('template'),
      majorCamp: configMajorCamp,
      minorCamp: configMinorCamp,
      dayIndex: configDayIndex,
      defaultDisplayCampName: configDisplayCampName,
      goalText: configGoalText,
      prepText: configPrepText,
      backgroundImage: configBackgroundImage,
      updatedAt: Date.now(),
    };
    const password = await ensureAdminPassword();
    if (!password) return;
    try {
      const payload = await saveSharedCampReportTemplate(password, template);
      applyTemplateMapUpdate(payload.templates);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '保存配置失败。');
      return;
    }
    if (
      configMajorCamp === majorCamp &&
      configMinorCamp === minorCamp &&
      configDayIndex === currentDayIndex
    ) {
      applyCurrentTemplateToEditor(template);
    }
    setNotice(`已保存 ${configMajorCamp} · ${configMinorCamp} · Day ${configDayIndex} 配置。`);
  }

  return (
    <div className={`camp-report-wrap fade-in camp-major-${majorCamp.toLowerCase().replace(/[^a-z0-9]+/g, '-')}${currentTheme.visualStyle === 'racing' ? ' camp-report-theme-racing' : ''}`} style={themeVars}>
      <button className="tool-home-rail" onClick={onBack}>
        <span className="tool-home-rail-icon">←</span>
        <span>返回主页</span>
      </button>

      <div className="camp-report-topbar">
        <div>
          <div className="camp-report-kicker">2026 Summer Camp</div>
          <h2 className="camp-report-title">2026 Summer Camp 日报</h2>
          <div className="camp-report-meta">{todayLabel} · {currentDayLabel}</div>
        </div>
        <div className="camp-report-topbar-actions">
          <span className="camp-draft-save-pill">{draftSaveStatus}</span>
          <details className="camp-quick-help">
            <summary>使用说明</summary>
            <div>
              <p>先选大营、小营和日期，再粘贴学生表现。</p>
              <p>左侧增删板块和上传图片，右侧会同步预览最终日报。</p>
              <p>完成后点“下载图片”，也可以复制图片到剪贴板。</p>
            </div>
          </details>
          {manageEnabled && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => { void openManagementMode(); }}
            >
              {viewMode === 'editor' ? '管理模式' : '返回编辑'}
            </button>
          )}
        </div>
      </div>

      {notice && <div className="camp-report-notice">{notice}</div>}

      {viewMode === 'config' && manageEnabled && adminUnlocked ? (
        <div className="camp-report-layout single">
          <section className="camp-report-panel card">
            <div className="camp-section-head">
              <div>
                <h3>管理模式</h3>
                <p>负责人维护营主题、每日目标和新课表内容；保存后其他老师也能使用。</p>
              </div>
              <div className="camp-config-count">{templateCount} 条配置</div>
            </div>

            <div className="camp-grid-three">
                <label className="camp-field">
                  <span>大营</span>
                  <select value={configMajorCamp} onChange={(event) => setConfigMajorCamp(event.target.value as CampMajorLevel)}>
                    {CAMP_MAJOR_OPTIONS.map((item) => <option key={item.level} value={item.level}>{item.label}</option>)}
                  </select>
                </label>
              <label className="camp-field">
                <span>小营</span>
                <select value={configMinorCamp} onChange={(event) => setConfigMinorCamp(event.target.value)}>
                  {MINOR_CAMPS.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </label>
                <label className="camp-field">
                  <span>Day</span>
                  <select value={configDayIndex} onChange={(event) => setConfigDayIndex(Number(event.target.value) || FALLBACK_DAY_INDEX)}>
                    {DAY_OPTIONS.map((item) => <option key={item} value={item}>Day {item}</option>)}
                  </select>
                </label>
            </div>

            <section className="camp-template-import">
              <div className="camp-section-head">
                <div>
                  <h3>批量上传课程目标 / 新课表</h3>
                  <p>支持 Excel、CSV、TSV、JSON；Excel 会按“每日目标汇总”等表头自动识别大营、小营、D1/D2。目标列会直接使用文件里的列名作为日报目标标题。</p>
                </div>
              </div>
              <div className="camp-image-upload-row">
                <label className="btn btn-ghost btn-sm">
                  上传 Excel / 文件
                  <input
                    type="file"
                    hidden
                    accept=".xlsx,.xls,.xlsm,.csv,.tsv,.txt,.json,.numbers,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv,text/tab-separated-values,application/json"
                    onChange={(event) => { void handleTemplateImportFile(event); }}
                  />
                </label>
                <button className="btn btn-primary btn-sm" onClick={() => { void importCampTemplatesFromText(); }}>
                  导入粘贴内容
                </button>
              </div>
              <textarea
                className="camp-raw-input camp-template-import-input"
                rows={6}
                value={templateImportText}
                placeholder={TEMPLATE_IMPORT_SAMPLE_TEXT}
                onChange={(event) => setTemplateImportText(event.target.value)}
              />
              <div className="camp-template-import-help">
                Excel 支持直接上传 .xlsx / .xls；Numbers 文件请先导出为 Excel。单元格内换行可写成 \n；留空的目标或准备内容会沿用原有模板。
              </div>
            </section>

            <section className="camp-theme-config" style={configThemeVars}>
              <div className="camp-section-head">
                <div>
                  <h3>营主题</h3>
                  <p>按大营保存主题；Logo 会替换页面标识，参考图只取色，也可以手动微调每个色块。</p>
                </div>
                <div className="camp-config-count">{themeConfigCount} 套主题</div>
              </div>

              <div className="camp-theme-config-grid">
                <div className="camp-theme-logo-card">
                  <div className={`camp-theme-logo-preview ${configThemePreview.visualStyle === 'racing' ? 'is-racing' : ''}`}>
                    {configThemeLogo ? <img src={configThemeLogo} alt={`${configMajorCamp} logo`} /> : <span>暂无 logo</span>}
                  </div>
                  <div className="camp-image-upload-row">
                    <label className="btn btn-ghost btn-sm">
                      上传 Logo 并替换
                      <input type="file" hidden accept="image/*" onChange={(event) => { void handleThemeLogoUpload(event); }} />
                    </label>
                    <label className="btn btn-ghost btn-sm">
                      仅参考图取色
                      <input type="file" hidden accept="image/*" onChange={(event) => { void handleThemeReferenceImageUpload(event); }} />
                    </label>
                    <button className="btn btn-ghost btn-sm" onClick={() => { void reExtractThemeFromLogo(); }}>
                      重新识别
                    </button>
                  </div>
                  <div className="camp-theme-source">
                    当前来源：{configThemeSource === 'logo' ? 'logo 自动识别' : configThemeSource === 'image' ? '参考图自动识别' : configThemeSource === 'manual' ? '人工调整' : '默认主题'}
                  </div>
                </div>

                <div className="camp-theme-preview-card">
                  <div className="camp-theme-preview-title">主题预览</div>
                  <div className="camp-theme-preview-header">
                    <span>Day 1</span>
                    <strong>{configDisplayCampName || buildDefaultDisplayName(configMajorCamp, configMinorCamp)}</strong>
                  </div>
                  <div className="camp-theme-preview-blocks">
                    <span className="warm">模块色 A</span>
                    <span className="cool">模块色 B</span>
                  </div>
                </div>
              </div>

              <div className="camp-theme-color-grid">
                {THEME_COLOR_FIELDS.map((field) => (
                  <label key={field.key} className="camp-theme-color-field">
                    <span>{field.label}</span>
                    <input
                      type="color"
                      value={configThemePalette[field.key]}
                      onChange={(event) => updateConfigThemeColor(field.key, event.target.value)}
                    />
                    <code>{configThemePalette[field.key]}</code>
                  </label>
                ))}
              </div>

              <div className="camp-action-row">
                <button className="btn btn-ghost" onClick={regenerateConfigThemeFromAccent}>按主色重算配色</button>
                <button className="btn btn-ghost" onClick={resetConfigTheme}>恢复默认主题</button>
                <button className="btn btn-primary" onClick={saveConfigTheme}>保存主题</button>
              </div>
            </section>

            <label className="camp-field">
              <span>默认营名展示</span>
              <input value={configDisplayCampName} onChange={(event) => setConfigDisplayCampName(event.target.value)} />
            </label>

            <label className="camp-field">
              <span>{GOAL_SECTION_TITLE}</span>
              <textarea rows={6} value={configGoalText} onChange={(event) => setConfigGoalText(event.target.value)} />
            </label>

            <label className="camp-field">
              <span>明日准备</span>
              <textarea rows={6} value={configPrepText} onChange={(event) => setConfigPrepText(event.target.value)} />
            </label>

            <div className="camp-field">
              <span>默认背景图</span>
              <div className="camp-image-upload-row">
                <label className="btn btn-ghost btn-sm">
                  上传背景图
                  <input type="file" hidden accept="image/*" onChange={(event) => { void handleBackgroundUpload(event, 'config'); }} />
                </label>
                {configBackgroundImage && <span className="camp-upload-tag">已上传</span>}
              </div>
              {configBackgroundImage && <img className="camp-bg-thumb" src={configBackgroundImage} alt="背景图预览" />}
            </div>

            <div className="camp-action-row">
              <button className="btn btn-primary" onClick={() => { void saveCurrentTemplate(); }}>保存配置</button>
            </div>
          </section>
        </div>
      ) : (
        <div className="camp-report-layout">
          <div
            className="camp-report-editor"
            onClick={handleEditorSectionActive}
            onFocusCapture={handleEditorSectionActive}
            onInputCapture={(event) => handleEditorSectionActive(event, 'auto')}
          >
            <section className={getEditorSectionClass('camp-report-panel card camp-module-basic camp-module-cool', 'basic')}>
              <div className="camp-section-head">
                <div>
                  <h3>基础信息</h3>
                  <p>先选大营、小营和日期，系统会带出当天内容；也可以手动修改或导入文件。</p>
                </div>
                {renderEditorCollapseButton('basic')}
              </div>

              <div className="camp-grid-three">
                <label className="camp-field">
                  <span>大营</span>
                  <select value={majorCamp} onChange={(event) => setMajorCamp(event.target.value as CampMajorLevel)}>
                    {CAMP_MAJOR_OPTIONS.map((item) => <option key={item.level} value={item.level}>{item.label}</option>)}
                  </select>
                </label>
                <label className="camp-field">
                  <span>小营</span>
                  <select value={minorCamp} onChange={(event) => setMinorCamp(event.target.value)}>
                    {MINOR_CAMPS.map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                </label>
                <label className="camp-field">
                  <span>日期 / Day</span>
                  <select value={reportDate} onChange={(event) => setReportDate(event.target.value)}>
                    {dateOptions.map((item) => (
                      <option key={item.date} value={item.date}>{item.date} · {item.dayLabel}</option>
                    ))}
                  </select>
                </label>
              </div>

            </section>

            <section className={getEditorSectionClass('camp-report-panel card camp-module-manager camp-module-cool', 'moduleManager')}>
              <div className="camp-section-head">
                <div>
                  <h3>模块管理</h3>
                  <p>控制固定板块是否进入导出，并调整它们在右侧日报里的顺序。</p>
                </div>
                {renderEditorCollapseButton('moduleManager')}
              </div>
              <div className="camp-module-manager-list">
                {sectionOrder.map((section, index) => (
                  <div key={section} className={`camp-module-manager-row camp-module-${section} ${sectionVisibility[section] ? 'is-visible' : 'is-hidden'}`}>
                    <div>
                      <strong>{OPTIONAL_SECTION_LABELS[section]}</strong>
                      <span>{sectionVisibility[section] ? '已显示' : '已隐藏'}</span>
                    </div>
                    <div className="camp-module-manager-actions">
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => setOptionalSectionVisible(section, !sectionVisibility[section])}
                      >
                        {sectionVisibility[section] ? '删除' : '新增'}
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => moveOptionalSection(section, -1)}
                        disabled={index === 0}
                      >
                        上移
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => moveOptionalSection(section, 1)}
                        disabled={index === sectionOrder.length - 1}
                      >
                        下移
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section
              data-camp-editor-section="goals"
              className={getEditorSectionClass('camp-report-panel card camp-module-goals camp-module-warm', 'goals')}
            >
              <div className="camp-section-head">
                <div>
                  <h3>{GOAL_SECTION_TITLE}</h3>
                  <p>支持 1-4 个目标；目标 2 开始可以按需删除。</p>
                </div>
                <div className="camp-inline-actions">
                  <button className="btn btn-ghost btn-sm" onClick={addGoalBlock} disabled={visibleGoalBlocks.length >= 4}>新增目标</button>
                  {renderEditorCollapseButton('goals')}
                </div>
              </div>
              <div className="camp-structured-editor">
                {visibleGoalBlocks.map((item, index) => (
                  <div key={item.id} className="camp-structured-row">
                    {index > 0 && (
                      <div className="camp-structured-row-actions">
                        <button className="btn btn-ghost btn-sm" onClick={() => removeGoalBlock(item.sourceIndex)}>删除目标</button>
                      </div>
                    )}
                    <label className="camp-field">
                      <span>小标题</span>
                      <input
                        value={item.title}
                        onChange={(event) => updateGoalBlock(item.sourceIndex, 'title', event.target.value)}
                      />
                    </label>
                    <label className="camp-field camp-field-detail">
                      <span>明细</span>
                      <textarea
                        rows={3}
                        value={item.body}
                        onChange={(event) => updateGoalBlock(item.sourceIndex, 'body', event.target.value)}
                      />
                    </label>
                  </div>
                ))}
              </div>
            </section>

            {sectionVisibility.summary && (
            <section
              data-camp-editor-section="summary"
              className={getEditorSectionClass('camp-report-panel card camp-module-summary camp-module-cool', 'summary')}
            >
              <div className="camp-section-head">
                <div>
                  <h3>{SUMMARY_SECTION_TITLE}</h3>
                  <p>把学生数据粘贴到下方输入框，右侧会同步预览；需要时可以手动刷新格式。</p>
                </div>
                <div className="camp-inline-actions">
                  <button className="btn btn-ghost btn-sm" onClick={() => setOptionalSectionVisible('summary', false)}>删除板块</button>
                  {renderEditorCollapseButton('summary')}
                </div>
              </div>

              <button
                type="button"
                className="camp-collapse-toggle camp-collapse-toggle-secondary"
                onClick={() => setSummaryDetailsExpanded((current) => !current)}
                aria-expanded={summaryDetailsExpanded}
              >
                <span>标题和课堂说明</span>
                <span>{summaryDetailsExpanded ? '收起' : '默认折叠'}</span>
              </button>

              {summaryDetailsExpanded && (
                <div className="camp-secondary-editor">
                  <label className="camp-field">
                    <span>标题</span>
                    <input value={classroomObservationTitle} onChange={(event) => setClassroomObservationTitle(event.target.value)} />
                  </label>
                  <label className="camp-field camp-field-detail">
                    <span>课堂说明</span>
                    <textarea
                      rows={4}
                      value={classroomObservation}
                      placeholder={'示例：\n今天孩子们在情景对话里更敢开口，能主动用完整句回应老师。\n需要继续提醒：排队和物资收整速度。'}
                      onChange={(event) => setClassroomObservation(event.target.value)}
                    />
                  </label>
                </div>
              )}

              <div className="camp-primary-paste-box">
                <div className="camp-primary-paste-head">
                  <div>
                    <strong>粘贴学生数据</strong>
                    <span>顺序：英文名 / 中文名 / 词句掌握 / 对话掌握 / 考勤到课 / 落实完成 / 竞速称号 / 文字备注</span>
                  </div>
                  <span>{filledPerformanceCount}/{STUDENT_ROW_COUNT} 行</span>
                </div>
                <textarea
                  className="camp-raw-input camp-raw-input-primary"
                  rows={8}
                  placeholder={'Allen\t陈安然\t关键词熟练\t完整问答\t已到课\t已完成\t极速表达星\t今天主动带读小组\nDiana\t王迪娜\t短句稳定\t反应很快\t已到课\t待补1项\t稳准小车手\t复述声音更自信'}
                  value={performanceRawText}
                  onChange={(event) => handlePerformanceRawTextChange(event.target.value)}
                />
                <div className="camp-primary-paste-actions">
                  <button className="btn btn-primary btn-sm" onClick={handleParsePerformance}>重新识别</button>
                  <button className="btn btn-ghost btn-sm" onClick={resetPerformanceRows}>清空 {STUDENT_ROW_COUNT} 行</button>
                </div>
              </div>

              <button
                type="button"
                className="camp-collapse-toggle"
                onClick={() => setColumnLabelsExpanded((current) => !current)}
                aria-expanded={columnLabelsExpanded}
              >
                <span>列名设置</span>
                <span>{columnLabelsExpanded ? '收起' : '默认折叠'}</span>
              </button>

              {columnLabelsExpanded && (
                <div className="camp-column-label-editor">
                  <div className="camp-column-label-title">列名可全部自定义，也可以删空</div>
                  <div className="camp-column-label-grid">
                    {performanceColumnLabels.map((label, index) => (
                      <label key={`performance_label_${index}`} className="camp-field">
                        <span>{DEFAULT_PERFORMANCE_COLUMN_LABELS[index]}</span>
                        <input
                          value={label}
                          onChange={(event) => updatePerformanceColumnLabel(index, event.target.value)}
                        />
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <button
                type="button"
                className="camp-collapse-toggle"
                onClick={() => setPerformanceExpanded((current) => !current)}
                aria-expanded={performanceExpanded}
              >
                <span>逐行微调</span>
                <span>{filledPerformanceCount}/{STUDENT_ROW_COUNT} 行</span>
              </button>

              {performanceExpanded && (
                <>
                  <div className="camp-score-legend">粘贴列顺序：英文名 / 中文名 / 词句掌握 / 对话掌握 / 考勤到课 / 落实完成 / 竞速称号 / 文字备注</div>

                  <div className="camp-performance-table">
                    {performanceColumnLabels.map((label, index) => (
                      <div key={`performance_head_${index}`} className="camp-performance-head">{label}</div>
                    ))}
                    {performanceRows.map((row) => (
                      <div key={row.id} className="camp-performance-row">
                        <input value={row.englishName} onChange={(event) => updatePerformanceRow(row.id, 'englishName', event.target.value)} />
                        <input value={row.chineseName} onChange={(event) => updatePerformanceRow(row.id, 'chineseName', event.target.value)} />
                        <input value={row.wordMastery} onChange={(event) => updatePerformanceRow(row.id, 'wordMastery', event.target.value)} />
                        <input value={row.dialogueMastery} onChange={(event) => updatePerformanceRow(row.id, 'dialogueMastery', event.target.value)} />
                        <input value={row.attendance} onChange={(event) => updatePerformanceRow(row.id, 'attendance', event.target.value)} />
                        <input value={row.implementation} onChange={(event) => updatePerformanceRow(row.id, 'implementation', event.target.value)} />
                        <input value={row.racingTitle} onChange={(event) => updatePerformanceRow(row.id, 'racingTitle', event.target.value)} />
                        <input value={row.remark} onChange={(event) => updatePerformanceRow(row.id, 'remark', event.target.value)} />
                      </div>
                    ))}
                  </div>
                </>
              )}
            </section>
            )}

            {sectionVisibility.challenge && (
            <section
              data-camp-editor-section="challenge"
              className={getEditorSectionClass('camp-report-panel card camp-module-challenge camp-module-warm', 'challenge')}
            >
              <div className="camp-section-head">
                <div>
                  <h3>{CHALLENGE_SECTION_TITLE}</h3>
                  <p>与其它板块平级展示，可添加多段文字和多张图片，并调整顺序。</p>
                </div>
                <div className="camp-inline-actions">
                  <button className="btn btn-ghost btn-sm" onClick={() => setOptionalSectionVisible('challenge', false)}>删除板块</button>
                  {renderEditorCollapseButton('challenge')}
                </div>
              </div>
              <div className="camp-structured-row">
                <label className="camp-field">
                  <span>标题</span>
                  <input
                    value={prepSections.afterClassTitle}
                    onChange={(event) => updatePrepSection('afterClass', 'title', event.target.value)}
                  />
                </label>
                {renderFooterBlockEditor('afterClass')}
              </div>
            </section>
            )}

            {sectionVisibility.reminder && (
            <section
              data-camp-editor-section="reminder"
              className={getEditorSectionClass('camp-report-panel card camp-module-reminder camp-module-cool', 'reminder')}
            >
              <div className="camp-section-head">
                <div>
                  <h3>{REMINDER_SECTION_TITLE}</h3>
                  <p>与{CHALLENGE_SECTION_TITLE}分开展示，可添加多段文字和多张图片，并调整顺序。</p>
                </div>
                <div className="camp-inline-actions">
                  <button className="btn btn-ghost btn-sm" onClick={() => setOptionalSectionVisible('reminder', false)}>删除板块</button>
                  {renderEditorCollapseButton('reminder')}
                </div>
              </div>
              <div className="camp-structured-row">
                <label className="camp-field">
                  <span>标题</span>
                  <input
                    value={prepSections.suppliesTitle}
                    onChange={(event) => updatePrepSection('supplies', 'title', event.target.value)}
                  />
                </label>
                {renderFooterBlockEditor('supplies')}
              </div>
            </section>
            )}

            {sectionVisibility.highlights && (
            <section
              data-camp-editor-section="highlights"
              className={getEditorSectionClass('camp-report-panel card camp-module-highlights camp-module-warm', 'highlights')}
            >
              <div className="camp-section-head">
                <div>
                  <h3>{HIGHLIGHTS_SECTION_TITLE}</h3>
                  <p>支持多组图文内容；上传学生照片后，可选择是否加外框。</p>
                </div>
                <div className="camp-inline-actions">
                  <button className="btn btn-ghost btn-sm" onClick={addHighlightGroup}>新增一组</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setOptionalSectionVisible('highlights', false)}>删除板块</button>
                  {renderEditorCollapseButton('highlights')}
                </div>
              </div>

              <div className="camp-highlight-layout-options">
                <label className="camp-field">
                  <span>每行图片数</span>
                  <select
                    value={highlightColumns}
                    onChange={(event) => setHighlightColumns(normalizeHighlightColumns(event.target.value))}
                  >
                    {HIGHLIGHT_COLUMN_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="camp-highlights-list">
                {highlights.length === 0 && <div className="camp-performance-empty">还没有精彩瞬间。</div>}
                {highlights.map((item, index) => (
                  <div
                    key={item.id}
                    className={`camp-highlight-editor is-drag-sortable fit-${item.fit || DEFAULT_CUSTOM_IMAGE_FIT} frame-${item.frame || DEFAULT_HIGHLIGHT_FRAME}`}
                    draggable
                    onDragStart={(event) => handleHighlightDragStart(event, item.id)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => handleHighlightDrop(event, index)}
                  >
                    <label className={`camp-highlight-thumb is-upload-target${item.image ? ' has-image' : ''} frame-${item.frame || DEFAULT_HIGHLIGHT_FRAME}`}>
                      {item.image ? <img src={item.image} alt={item.title || HIGHLIGHTS_SECTION_TITLE} /> : <span>点击上传图片</span>}
                      {item.image && <span className="camp-highlight-frame-border" aria-hidden="true" />}
                      <input type="file" hidden accept="image/*" onChange={(event) => { void handleHighlightImageChange(item.id, event); }} />
                    </label>
                    <div className="camp-highlight-fields">
                      <div className="camp-image-upload-row">
                        <label className="btn btn-ghost btn-sm">
                          上传图片
                          <input type="file" hidden accept="image/*" onChange={(event) => { void handleHighlightImageChange(item.id, event); }} />
                        </label>
                        <button className="btn btn-ghost btn-sm" onClick={() => setHighlights((items) => items.filter((row) => row.id !== item.id))}>
                          删除
                        </button>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => openImageCrop({ kind: 'highlight', id: item.id, image: item.image || '' })}
                          disabled={!item.image}
                        >
                          裁剪图片
                        </button>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => updateHighlight(item.id, 'fit', (item.fit || DEFAULT_CUSTOM_IMAGE_FIT) === 'cover' ? 'contain' : 'cover')}
                        >
                          {(item.fit || DEFAULT_CUSTOM_IMAGE_FIT) === 'cover' ? '完整显示' : '填满框'}
                        </button>
                      </div>
                      <label className="camp-field">
                        <span>照片外框</span>
                        <select
                          value={item.frame || DEFAULT_HIGHLIGHT_FRAME}
                          onChange={(event) => updateHighlight(item.id, 'frame', event.target.value)}
                        >
                          {HIGHLIGHT_FRAME_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </label>
                      <input
                        placeholder="名称"
                        value={item.title}
                        onChange={(event) => updateHighlight(item.id, 'title', event.target.value)}
                      />
                      <textarea
                        rows={3}
                        placeholder="点赞原因"
                        value={item.reason}
                        onChange={(event) => updateHighlight(item.id, 'reason', event.target.value)}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </section>
            )}

            <section className={getEditorSectionClass('camp-report-panel card camp-module-custom camp-module-cool', 'customSections')}>
              <div className="camp-section-head">
                <div>
                  <h3>自定义板块</h3>
                  <p>可自定义板块名称，输入文本，添加多张图片；每张图都可写注释、调整大小和裁剪方式。</p>
                </div>
                <div className="camp-inline-actions">
                  <button className="btn btn-ghost btn-sm" onClick={() => setCustomSections((items) => [...items, createEmptyCustomSection()])}>新增板块</button>
                  {renderEditorCollapseButton('customSections')}
                </div>
              </div>

              <div className="camp-custom-section-list">
                {customSections.length === 0 && <div className="camp-performance-empty">还没有自定义板块。</div>}
                {customSections.map((section) => (
                  <div
                    key={section.id}
                    data-camp-editor-section={`custom-${section.id}`}
                    className={getEditorSectionClass('camp-custom-section-editor', `custom-${section.id}`)}
                  >
                    <div className="camp-custom-section-head">
                      <strong>{section.title || '未命名板块'}</strong>
                      <div className="camp-inline-actions">
                        <button className="btn btn-ghost btn-sm" onClick={() => setCustomSections((items) => items.filter((item) => item.id !== section.id))}>
                          删除板块
                        </button>
                        {renderEditorCollapseButton(`custom-${section.id}`)}
                      </div>
                    </div>
                    <label className="camp-field">
                      <span>标题</span>
                      <input value={section.title} onChange={(event) => updateCustomSection(section.id, 'title', event.target.value)} />
                    </label>
                    <label className="camp-field camp-field-detail">
                      <span>文本</span>
                      <textarea
                        rows={4}
                        value={section.body}
                        onChange={(event) => updateCustomSection(section.id, 'body', event.target.value)}
                      />
                    </label>
                    <div className="camp-image-upload-row">
                      <button className="btn btn-ghost btn-sm" onClick={() => addCustomSectionImage(section.id)}>新增图片</button>
                    </div>
                    <div className="camp-custom-image-list">
                      {section.images.map((image, index) => (
                        <div
                          key={image.id}
                          className={`camp-custom-image-editor is-drag-sortable fit-${image.fit || DEFAULT_CUSTOM_IMAGE_FIT}`}
                          draggable
                          onDragStart={(event) => handleCustomImageDragStart(event, section.id, image.id)}
                          onDragOver={(event) => event.preventDefault()}
                          onDrop={(event) => handleCustomImageDrop(event, section.id, index)}
                        >
                          <label className={`camp-custom-image-thumb is-upload-target${image.image ? ' has-image' : ''}`}>
                            {image.image ? <img src={image.image} alt={image.caption || section.title || '自定义图片'} /> : <span>点击上传图片</span>}
                            <input type="file" hidden accept="image/*" onChange={(event) => { void handleCustomSectionImageUpload(section.id, image.id, event); }} />
                          </label>
                          <div className="camp-custom-image-fields">
                            <div className="camp-image-upload-row">
                              <label className="btn btn-ghost btn-sm">
                                上传图片
                                <input type="file" hidden accept="image/*" onChange={(event) => { void handleCustomSectionImageUpload(section.id, image.id, event); }} />
                              </label>
                              <button className="btn btn-ghost btn-sm" onClick={() => removeCustomSectionImage(section.id, image.id)}>删除图片</button>
                            </div>
                            <label className="camp-field">
                              <span>图片注释</span>
                              <input
                                value={image.caption}
                                onChange={(event) => updateCustomSectionImage(section.id, image.id, 'caption', event.target.value)}
                              />
                            </label>
                            <div className="camp-grid-three camp-custom-image-controls">
                              <label className="camp-field">
                                <span>图片大小</span>
                                <select
                                  value={image.size}
                                  onChange={(event) => updateCustomSectionImage(section.id, image.id, 'size', event.target.value)}
                                >
                                  <option value="third">一行三张</option>
                                  <option value="half">一行两张</option>
                                  <option value="full">整行</option>
                                </select>
                              </label>
                              <div className="camp-field camp-crop-toggle-field">
                                <span>裁剪</span>
                                <button
                                  className="btn btn-ghost btn-sm"
                                  onClick={() => openImageCrop({ kind: 'custom', sectionId: section.id, imageId: image.id, image: image.image || '' })}
                                  disabled={!image.image}
                                >
                                  裁剪图片
                                </button>
                                <button
                                  className="btn btn-ghost btn-sm"
                                  onClick={() => updateCustomSectionImage(section.id, image.id, 'fit', (image.fit || DEFAULT_CUSTOM_IMAGE_FIT) === 'cover' ? 'contain' : 'cover')}
                                >
                                  {(image.fit || DEFAULT_CUSTOM_IMAGE_FIT) === 'cover' ? '完整显示' : '填满框'}
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {manageEnabled && (
              <section className={getEditorSectionClass('camp-report-panel card', 'background')}>
                <div className="camp-section-head">
                  <div>
                    <h3>背景图</h3>
                    <p>上传背景图后，右侧预览会立即更新。</p>
                  </div>
                  {renderEditorCollapseButton('background')}
                </div>
                <div className="camp-image-upload-row">
                  <label className="btn btn-ghost btn-sm">
                    上传背景图
                    <input type="file" hidden accept="image/*" onChange={(event) => { void handleBackgroundUpload(event, 'editor'); }} />
                  </label>
                  {backgroundImage && <span className="camp-upload-tag">当前已设置</span>}
                </div>
              </section>
            )}

            <div className="camp-action-row sticky">
              <span className="camp-draft-save-status">{draftSaveStatus}</span>
              <button className="btn btn-ghost" onClick={() => saveDraft()}>保存草稿</button>
              <button className="btn btn-primary" onClick={() => { void handleDownloadImage(); }} disabled={exporting}>
                {exportAction === 'download' ? '下载中...' : '下载图片'}
              </button>
              <button className="btn btn-ghost" onClick={() => { void handleCopyImageToClipboard(); }} disabled={exporting}>
                {exportAction === 'clipboard' ? '复制中...' : '复制图片'}
              </button>
            </div>

          </div>

          <aside className="camp-report-preview">
            <div className="camp-preview-frame" ref={previewFrameRef}>
              <div
                ref={cardRef}
                className="camp-preview-paper"
                style={backgroundImage ? { backgroundImage: `linear-gradient(color-mix(in srgb, var(--camp-paper) 76%, transparent), color-mix(in srgb, var(--camp-accent-soft) 84%, transparent)), url(${backgroundImage})` } : undefined}
              >
                <div className={`camp-preview-header${currentTheme.logoImage ? ' has-logo' : ''}`}>
                  <div className="camp-preview-badge">{currentDayLabel}</div>
                  <EditablePreviewText
                    className="camp-preview-title"
                    value={displayCampName}
                    onChange={setDisplayCampName}
                  />
                  <div className="camp-preview-date">{reportDate} · 夏令营日报</div>
                </div>

                <section
                  {...getPreviewJumpProps('goals')}
                  data-camp-preview-section="goals"
                  className={getPreviewSectionClass('camp-preview-section is-clickable camp-module-goals camp-module-warm', 'goals')}
                >
                  <div className="camp-preview-section-title">{GOAL_SECTION_TITLE}</div>
                  <div className={`camp-goal-cards count-${Math.min(Math.max(visibleGoalBlocks.length, 1), 4)}`}>
                    {visibleGoalBlocks.map((item) => (
                      <article key={item.id} className="camp-goal-card">
                        {item.title && (
                          <EditablePreviewText
                            className="camp-goal-card-title"
                            value={item.title}
                            onChange={(value) => updateGoalBlock(item.sourceIndex, 'title', value)}
                          />
                        )}
                        {item.body && (
                          <EditablePreviewText
                            className="camp-goal-card-body whitespace"
                            multiline
                            value={item.body}
                            onChange={(value) => updateGoalBlock(item.sourceIndex, 'body', value)}
                          />
                        )}
                      </article>
                    ))}
                  </div>
                </section>

                {sectionOrder.map((section) => renderPreviewOptionalSection(section))}

                {previewCustomSections.map((section) => (
                  <section
                    key={section.id}
                    {...getPreviewJumpProps(`custom-${section.id}`)}
                    data-camp-preview-section={`custom-${section.id}`}
                    className={getPreviewSectionClass('camp-preview-section is-clickable camp-module-custom camp-module-cool', `custom-${section.id}`)}
                  >
                    {section.title && (
                      <EditablePreviewText
                        className="camp-preview-section-title"
                        value={section.title}
                        onChange={(value) => updateCustomSection(section.id, 'title', value)}
                      />
                    )}
                    {section.body && (
                      <EditablePreviewText
                        className="camp-preview-copy whitespace"
                        multiline
                        value={section.body}
                        onChange={(value) => updateCustomSection(section.id, 'body', value)}
                      />
                    )}
                    {section.images.length > 0 && (
                      <div className="camp-preview-custom-images">
                        {section.images.filter((image) => image.image || image.caption).map((image) => (
                          <figure
                            key={image.id}
                            className={`camp-preview-custom-image is-${image.size || DEFAULT_CUSTOM_IMAGE_SIZE} fit-${image.fit || DEFAULT_CUSTOM_IMAGE_FIT}`}
                          >
                            {image.image && (
                              <div className="camp-preview-custom-image-frame">
                                <img src={image.image} alt={image.caption || section.title || '自定义图片'} />
                              </div>
                            )}
                            {image.caption && (
                              <EditablePreviewText
                                className="camp-preview-custom-caption"
                                value={image.caption}
                                onChange={(value) => updateCustomSectionImage(section.id, image.id, 'caption', value)}
                              />
                            )}
                          </figure>
                        ))}
                      </div>
                    )}
                  </section>
                ))}
              </div>
            </div>
          </aside>
        </div>
      )}
      {cropTarget && (
        <div className="camp-crop-modal" role="dialog" aria-modal="true" aria-label="裁剪图片">
          <div className="camp-crop-panel">
            <div className="camp-crop-head">
              <div>
                <strong>裁剪图片</strong>
                <span>拖动框选要保留的区域，确认后会生成新的裁剪图。</span>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => setCropTarget(null)}>关闭</button>
            </div>
            <div className="camp-crop-stage-shell">
              <div
                ref={cropStageRef}
                className="camp-crop-stage"
                onPointerDown={(event) => startCropDrag('create', event)}
                onPointerMove={handleCropPointerMove}
                onPointerUp={finishCropDrag}
                onPointerCancel={finishCropDrag}
              >
                <img src={cropTarget.image} alt="待裁剪图片" draggable={false} />
                <div
                  className="camp-crop-selection"
                  style={{
                    left: `${cropSelection.x}%`,
                    top: `${cropSelection.y}%`,
                    width: `${cropSelection.width}%`,
                    height: `${cropSelection.height}%`,
                  }}
                  onPointerDown={(event) => startCropDrag('move', event)}
                >
                  {(['nw', 'ne', 'sw', 'se'] as CropDragMode[]).map((mode) => (
                    <span
                      key={mode}
                      className={`camp-crop-handle is-${mode}`}
                      onPointerDown={(event) => startCropDrag(mode, event)}
                    />
                  ))}
                </div>
              </div>
            </div>
            <div className="camp-crop-actions">
              <button className="btn btn-ghost" onClick={() => setCropSelection(DEFAULT_CROP_SELECTION)}>重置框选</button>
              <button className="btn btn-ghost" onClick={() => setCropTarget(null)}>取消</button>
              <button className="btn btn-primary" onClick={() => { void applyCropSelection(); }}>确认裁剪</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
