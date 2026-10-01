import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { ClassInfo } from '../types';
import type {
  ChallengeItem,
  CommunicationGroup,
  CommunicationPlan,
  CommunicationPlanEntry,
  CommunicationPlanMode,
  CommunicationPlanStatus,
  CommunicationSlotType,
  CommunicationSnapshot,
  CustomBlock,
  ListeningFontOption,
  ListeningMaterialItem,
  MediaAnnotation,
  MediaItem,
  OverviewContent,
  OverviewThemeOption,
  PhaseChallengeRow,
  SavedCommunicationPlan,
} from '../types/overview';
import { getResolvedStudents } from '../utils/classProfiles';
import type { StudentInfo } from '../types';
import { ALL_DAYS, getOrderedChallengeDays } from '../utils/classSchedule';
import {
  addCommunicationRecord,
  createChallengeItem,
  createCustomBlock,
  createEmptyContent,
  createListeningItem,
  createMediaAnnotation,
  getCommunicationStats,
  listCommunicationSnapshots,
  listSavedCommunicationPlans,
  loadDraft,
  loadOverviewRoster,
  normalizeCommunicationPlan,
  rememberReusableContent,
  saveDraft,
  saveCommunicationPlanPreset,
  saveCommunicationSnapshot,
  saveOverviewRoster,
} from '../utils/overviewData';
import {
  formatDisplayNames,
  formatDisplayName,
  syncOverviewContent,
  toggleStudentTierWithMemory,
} from '../services/overviewContentRules';
import { buildListeningMaterials, extractListeningPairs } from '../utils/wordTranslation';
import { sortStudentNames } from '../utils/classProfiles';
import { getWeekRange, getCurrentWeek, formatDateShort } from '../utils/weekNumber';
import './OverviewApp.css';

interface Props {
  classInfo: ClassInfo;
  classes?: ClassInfo[];
  onBack: () => void;
  onBackToHome?: () => void;
  onSwitchClass?: (name: string) => void;
  onOpenCommunicationPlanner?: () => void;
}

type NormalizedCommunicationPlan = CommunicationPlan & {
  planName: string;
  roundLabel: string;
  status: CommunicationPlanStatus;
  cycleWeeks: number;
  deadlineDate: string;
  mode: CommunicationPlanMode;
  suggestedGroupSize: number;
  availableSlots: CommunicationSlotType[];
  defaultTeacherName: string;
  defaultLocationText: string;
  entries: CommunicationPlanEntry[];
};

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function fileToText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

async function filesToMediaItems(files: File[]): Promise<MediaItem[]> {
  const uploaded: MediaItem[] = [];
  for (const file of files) {
    const src = await fileToDataUrl(file);
    uploaded.push({
      id: `media_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      src,
      name: file.name,
      caption: '',
      displayWidth: 160,
      annotations: [],
    });
  }
  return uploaded;
}

function formatHistoryDate(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function orderDaysFromStart(startDay: string): string[] {
  const startIndex = ALL_DAYS.indexOf(startDay as typeof ALL_DAYS[number]);
  if (startIndex === -1) return [...ALL_DAYS];
  return [...ALL_DAYS.slice(startIndex), ...ALL_DAYS.slice(0, startIndex)];
}

function hasWeeklyChallenges(content: OverviewContent): boolean {
  return content.weeklyChallenges.some((item) => item.task.trim());
}

function hasPhaseChallenges(content: OverviewContent): boolean {
  return content.phaseChallenges.some((item) =>
    item.selectedStudents.length > 0 || item.challengeContent.trim() || item.method.trim(),
  );
}

function hasChallengeItems(content: OverviewContent): boolean {
  return content.challengeItems.some((item) =>
    item.title.trim() || item.detail.trim() || item.media.length > 0,
  );
}

function hasListeningMaterials(content: OverviewContent): boolean {
  return content.listeningMaterials.some((item) => item.english.trim() || item.chinese.trim());
}

function hasCommunicationPlan(content: OverviewContent): boolean {
  const plan = normalizeCommunicationPlan(content.communicationPlan);
  if ((plan.entries || []).length > 0) return true;
  return content.communicationPlan.groups.some((group) =>
    group.selectedStudents.length > 0 ||
    group.teacherName.trim() ||
    (((group.locationText || '').trim()) && (group.locationText || '').trim() !== '教室') ||
    group.scheduleText.trim() ||
    group.note.trim(),
  );
}

function parseStudentNames(raw: string): string[] {
  return sortStudentNames(
    raw
      .split(/[\n,，、;；]+/)
      .map((item) => item.replace(/^[\d.、)\]-]+\s*/, '').trim())
      .filter(Boolean),
  );
}

function sortStudentsForOverview(students: StudentInfo[]): StudentInfo[] {
  return [...students].sort((a, b) => a.chineseName.localeCompare(b.chineseName, 'zh-Hans-CN', { sensitivity: 'base', numeric: true }));
}

function getOverviewStudents(classCode: string): StudentInfo[] {
  const localRoster = loadOverviewRoster(classCode);
  if (localRoster) return sortStudentsForOverview(localRoster);
  return sortStudentsForOverview(getResolvedStudents(classCode));
}

const OVERVIEW_THEME_OPTIONS: Array<{ value: OverviewThemeOption; label: string }> = [
  { value: 'green', label: '森林绿' },
  { value: 'amber', label: '琥珀金' },
  { value: 'blue', label: '海盐蓝' },
  { value: 'rose', label: '玫瑰粉' },
  { value: 'graphite', label: '石墨灰' },
  { value: 'rainbow', label: '🌈 彩虹乐园' },
  { value: 'starry', label: '⭐ 星空童话' },
];

type StudentPickerTone = 'neutral' | 'foundation' | 'steady' | 'boost';

type ClearTargetKey =
  | 'weeklyChallenges'
  | 'phaseDetails'
  | 'challengeItems'
  | 'listeningMaterials'
  | 'communicationPlan'
  | 'customBlocks';

const CLEAR_TARGET_OPTIONS: Array<{ key: ClearTargetKey; label: string; description: string }> = [
  { key: 'weeklyChallenges', label: '本周挑战', description: '清空每一天的挑战内容' },
  { key: 'phaseDetails', label: '分层挑战内容', description: '只清空分层文字，保留学生分层名单' },
  { key: 'challengeItems', label: '本周挑战内容', description: '清空挑战卡片与图片' },
  { key: 'listeningMaterials', label: '下周听读语料', description: '清空听读英文与中文' },
  { key: 'communicationPlan', label: '交流名单说明', description: '清空交流人/时间/说明，保留勾选学生' },
  { key: 'customBlocks', label: '自定义补充区', description: '清空自定义补充内容' },
];

function getPhaseTone(key: PhaseChallengeRow['key']): StudentPickerTone {
  if (key === '突破拔高') return 'boost';
  if (key === '维稳达标') return 'steady';
  return 'foundation';
}

const PHASE_TIER_ORDER: PhaseChallengeRow['key'][] = ['突破拔高', '维稳达标', '夯实基础'];
const COMMUNICATION_SLOT_OPTIONS: Array<{ value: CommunicationSlotType; label: string }> = [
  { value: 'weekday_before', label: '周中课前' },
  { value: 'weekday_after', label: '周中课后' },
  { value: 'weekend_before', label: '周末课前' },
  { value: 'weekend_middle', label: '周末课中' },
  { value: 'weekend_after', label: '周末课后' },
];

const COMMUNICATION_STATUS_OPTIONS: Array<{ value: CommunicationPlanStatus; label: string }> = [
  { value: 'draft', label: '草稿' },
  { value: 'active', label: '进行中' },
  { value: 'done', label: '已完成' },
  { value: 'archived', label: '已归档' },
];

const COMMUNICATION_MODE_OPTIONS: Array<{ value: CommunicationPlanMode; label: string }> = [
  { value: 'alphabet', label: '按字母粗排' },
  { value: 'phase', label: '按分层粗排' },
  { value: 'manual', label: '手工排布' },
];

function StudentPicker({
  studentNames,
  selected,
  onToggle,
  tone = 'neutral',
  nameMap,
}: {
  studentNames: string[];
  selected: string[];
  onToggle: (name: string) => void;
  tone?: StudentPickerTone;
  nameMap?: Map<string, string>;
}) {
  if (studentNames.length === 0) {
    return <p className="ov-empty-hint">当前班级还没有导入学生名单。</p>;
  }

  const sorted = nameMap
    ? [...studentNames].sort((a, b) => (nameMap.get(a) || a).localeCompare(nameMap.get(b) || b, 'en', { sensitivity: 'base' }))
    : sortStudentNames(studentNames);

  return (
    <div className="ov-student-grid">
      {sorted.map((name) => (
        <label
          key={name}
          className={`ov-student-chip ov-student-chip-tone-${tone}${selected.includes(name) ? ' active' : ''}`}
        >
          <input
            type="checkbox"
            checked={selected.includes(name)}
            onChange={() => onToggle(name)}
          />
          <span>{nameMap?.get(name) || name}</span>
        </label>
      ))}
    </div>
  );
}

function ExpandableTextarea({
  value,
  onChange,
  placeholder,
  collapsedRows = 3,
  expandedRows = 6,
  className,
  onPaste,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  collapsedRows?: number;
  expandedRows?: number;
  className?: string;
  onPaste?: React.ClipboardEventHandler<HTMLTextAreaElement>;
}) {
  const [expanded, setExpanded] = useState(false);
  const shouldShowToggle = expandedRows > collapsedRows;

  return (
    <div className={`ov-expandable-field${expanded ? ' is-expanded' : ''}${className ? ` ${className}` : ''}`}>
      <textarea
        rows={expanded ? expandedRows : collapsedRows}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        onPaste={onPaste}
      />
      {shouldShowToggle && (
        <button
          type="button"
          className="btn btn-ghost btn-sm ov-expand-toggle"
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? '收起长输入' : '展开长输入'}
        </button>
      )}
    </div>
  );
}

function AutoGrowTextarea({
  value,
  onChange,
  placeholder,
  minRows = 2,
  className,
  onPaste,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  minRows?: number;
  className?: string;
  onPaste?: React.ClipboardEventHandler<HTMLTextAreaElement>;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [value]);

  return (
    <div className={`ov-autogrow-field${className ? ` ${className}` : ''}`}>
      <textarea
        ref={textareaRef}
        rows={minRows}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        onPaste={onPaste}
      />
    </div>
  );
}

function MediaEditor({
  items,
  onChange,
}: {
  items: MediaItem[];
  onChange: (items: MediaItem[]) => void;
}) {
  function getEditorPreviewWidth(displayWidth?: number): string {
    const width = Math.max(320, Math.min(900, Math.round((displayWidth ?? 160) * 4)));
    return `min(100%, ${width}px)`;
  }

  async function appendFiles(files: File[]) {
    if (files.length === 0) return;
    const uploaded = await filesToMediaItems(files);
    onChange([...items, ...uploaded]);
  }

  async function handleUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    await appendFiles(Array.from(files));
  }

  function updateItem(id: string, updater: (item: MediaItem) => MediaItem) {
    onChange(items.map((item) => (item.id === id ? updater(item) : item)));
  }

  function removeItem(id: string) {
    onChange(items.filter((item) => item.id !== id));
  }

  function updateAnnotation(itemId: string, annotationId: string, field: keyof MediaAnnotation, value: string | number) {
    updateItem(itemId, (item) => ({
      ...item,
      annotations: item.annotations.map((annotation) =>
        annotation.id === annotationId ? { ...annotation, [field]: value } : annotation,
      ),
    }));
  }

  function addAnnotation(itemId: string, type: MediaAnnotation['type']) {
    updateItem(itemId, (item) => ({
      ...item,
      annotations: [...item.annotations, createMediaAnnotation(type)],
    }));
  }

  function removeAnnotation(itemId: string, annotationId: string) {
    updateItem(itemId, (item) => ({
      ...item,
      annotations: item.annotations.filter((annotation) => annotation.id !== annotationId),
    }));
  }

  return (
    <div
      className="ov-media-editor"
      onPaste={(event) => {
        const pastedFiles = Array.from(event.clipboardData?.files ?? []).filter((file) => file.type.startsWith('image/'));
        if (pastedFiles.length === 0) return;
        event.preventDefault();
        void appendFiles(pastedFiles);
      }}
    >
      <label className="btn btn-ghost btn-sm ov-upload-btn">
        上传图片
        <input
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(event) => {
            void handleUpload(event.target.files);
            event.target.value = '';
          }}
        />
      </label>

      {items.length === 0 && <p className="ov-empty-hint">支持多图上传，也可以给图片加框选和文字标注。</p>}
      <p className="ov-empty-hint">也支持直接 `Ctrl+V` / 粘贴图片。</p>

      {items.map((item) => (
        <div key={item.id} className="ov-media-card">
          <div className="ov-media-preview" style={{ width: getEditorPreviewWidth(item.displayWidth) }}>
            <img src={item.src} alt={item.name || '上传图片'} />
            {item.annotations.map((annotation) => (
              <div
                key={annotation.id}
                className={`ov-media-annotation ov-media-annotation-${annotation.type}`}
                style={{
                  left: `${annotation.x}%`,
                  top: `${annotation.y}%`,
                  width: `${annotation.width}%`,
                  height: `${annotation.height}%`,
                  borderColor: annotation.color,
                  color: annotation.color,
                }}
              >
                {annotation.type === 'text' && <span>{annotation.text || '文字'}</span>}
              </div>
            ))}
          </div>

          <div className="ov-media-actions">
            <button className="btn btn-ghost btn-sm" onClick={() => addAnnotation(item.id, 'box')}>+ 框选</button>
            <button className="btn btn-ghost btn-sm" onClick={() => addAnnotation(item.id, 'text')}>+ 文字</button>
            <button className="btn btn-ghost btn-sm" onClick={() => removeItem(item.id)}>删除图片</button>
          </div>

          <div className="ov-slider-grid ov-media-size-grid">
            <label>
              <span>图片宽度</span>
              <input
                type="range"
                min={100}
                max={220}
                value={item.displayWidth ?? 160}
                onChange={(event) => updateItem(item.id, (current) => ({
                  ...current,
                  displayWidth: Number(event.target.value),
                }))}
              />
            </label>
          </div>

          <input
            className="input-field"
            placeholder="图片说明"
            value={item.caption}
            onChange={(event) => updateItem(item.id, (current) => ({ ...current, caption: event.target.value }))}
          />

          {item.annotations.map((annotation) => (
            <div key={annotation.id} className="ov-annotation-editor">
              <div className="ov-annotation-head">
                <strong>{annotation.type === 'box' ? '框选' : '文字标注'}</strong>
                <button className="btn btn-ghost btn-sm" onClick={() => removeAnnotation(item.id, annotation.id)}>删除</button>
              </div>
              {annotation.type === 'text' && (
                <input
                  className="input-field"
                  placeholder="标注文字"
                  value={annotation.text}
                  onChange={(event) => updateAnnotation(item.id, annotation.id, 'text', event.target.value)}
                />
              )}
              <div className="ov-slider-grid">
                {[
                  ['x', '横向'],
                  ['y', '纵向'],
                  ['width', '宽度'],
                  ['height', '高度'],
                ].map(([field, label]) => (
                  <label key={field}>
                    <span>{label}</span>
                    <input
                      type="range"
                      min={0}
                      max={field === 'width' || field === 'height' ? 100 : 95}
                      value={annotation[field as keyof MediaAnnotation] as number}
                      onChange={(event) =>
                        updateAnnotation(item.id, annotation.id, field as keyof MediaAnnotation, Number(event.target.value))
                      }
                    />
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function CustomTableEditor({
  block,
  onChange,
}: {
  block: CustomBlock;
  onChange: (block: CustomBlock) => void;
}) {
  function updateColumn(index: number, value: string) {
    onChange({
      ...block,
      table: {
        ...block.table,
        columns: block.table.columns.map((column, columnIndex) => (columnIndex === index ? value : column)),
      },
    });
  }

  function updateCell(rowIndex: number, cellIndex: number, value: string) {
    onChange({
      ...block,
      table: {
        ...block.table,
        rows: block.table.rows.map((row, currentRowIndex) =>
          currentRowIndex === rowIndex
            ? row.map((cell, currentCellIndex) => (currentCellIndex === cellIndex ? value : cell))
            : row,
        ),
      },
    });
  }

  function addRow() {
    onChange({
      ...block,
      table: {
        ...block.table,
        rows: [...block.table.rows, block.table.columns.map(() => '')],
      },
    });
  }

  function addColumn() {
    onChange({
      ...block,
      table: {
        columns: [...block.table.columns, `列${block.table.columns.length + 1}`],
        rows: block.table.rows.map((row) => [...row, '']),
      },
    });
  }

  return (
    <div className="ov-custom-table-editor">
      <div className="ov-table-grid" style={{ gridTemplateColumns: `repeat(${block.table.columns.length}, minmax(120px, 1fr))` }}>
        {block.table.columns.map((column, index) => (
          <input
            key={`head_${index}`}
            className="input-field ov-table-head-input"
            value={column}
            onChange={(event) => updateColumn(index, event.target.value)}
          />
        ))}
        {block.table.rows.map((row, rowIndex) =>
          row.map((cell, cellIndex) => (
            <input
              key={`${rowIndex}_${cellIndex}`}
              className="input-field"
              value={cell}
              onChange={(event) => updateCell(rowIndex, cellIndex, event.target.value)}
            />
          )),
        )}
      </div>
      <div className="ov-inline-actions">
        <button className="btn btn-ghost btn-sm" onClick={addRow}>+ 增加一行</button>
        <button className="btn btn-ghost btn-sm" onClick={addColumn}>+ 增加一列</button>
      </div>
    </div>
  );
}

function createCommunicationGroup(overrides: Partial<CommunicationGroup> = {}): CommunicationGroup {
  return {
    id: `comm_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    label: '第1组',
    selectedStudents: [],
    teacherName: '',
    slotType: 'weekday_after',
    locationText: '教室',
    scheduleText: '',
    note: '',
    ...overrides,
  };
}

function normalizeCommunicationGroups(groups: CommunicationGroup[]): CommunicationGroup[] {
  return (groups.length > 0 ? groups : [createCommunicationGroup()]).map((group) => ({
    ...group,
    selectedStudents: sortStudentNames(group.selectedStudents),
    slotType: group.slotType || 'weekday_after',
    locationText: String(group.locationText || '教室'),
  }));
}

function syncCommunicationPlan(
  groups: CommunicationGroup[],
  base?: OverviewContent['communicationPlan'],
): OverviewContent['communicationPlan'] {
  const normalizedGroups = normalizeCommunicationGroups(groups);
  return normalizeCommunicationPlan({
    ...base,
    groups: normalizedGroups,
    selectedStudents: normalizedGroups.flatMap((group) => group.selectedStudents),
    teacherName: normalizedGroups[0]?.teacherName ?? base?.teacherName ?? '',
    scheduleText: normalizedGroups[0]?.scheduleText ?? base?.scheduleText ?? '',
    note: normalizedGroups[0]?.note ?? base?.note ?? '',
  });
}

function getSlotLabel(slotType: CommunicationSlotType): string {
  return COMMUNICATION_SLOT_OPTIONS.find((item) => item.value === slotType)?.label ?? '未选时段';
}

function getPlanStatusLabel(status: CommunicationPlanStatus): string {
  return COMMUNICATION_STATUS_OPTIONS.find((item) => item.value === status)?.label ?? '草稿';
}

function getCycleWeek(week: number, cycleWeeks: number): number {
  return ((week - 1) % Math.max(1, cycleWeeks)) + 1;
}

function hasCommunicationGroupContent(group: CommunicationGroup): boolean {
  return group.selectedStudents.length > 0
    || group.teacherName.trim().length > 0
    || (((group.locationText || '').trim().length > 0) && (group.locationText || '').trim() !== '教室')
    || group.scheduleText.trim().length > 0
    || group.note.trim().length > 0;
}

function shouldShowCustomBlock(block: CustomBlock): boolean {
  if (block.mode === 'text') {
    return Boolean(block.text.trim() || (block.title.trim() && block.title.trim() !== '补充内容'));
  }

  if (block.mode === 'table') {
    return block.table.rows.some((row) => row.some((cell) => cell.trim()))
      || Boolean(block.title.trim() && block.title.trim() !== '补充内容');
  }

  return block.media.length > 0 || Boolean(block.title.trim() && block.title.trim() !== '补充内容');
}

export default function OverviewApp({ classInfo, classes, onBack, onBackToHome, onSwitchClass, onOpenCommunicationPlanner }: Props) {
  function getPaperMediaWidth(displayWidth?: number): string {
    const width = Math.max(360, Math.min(820, Math.round((displayWidth ?? 160) * 5)));
    return `min(100%, ${width}px)`;
  }

  const classCode = classInfo.name;
  const [resolvedStudents, setResolvedStudents] = useState<StudentInfo[]>(() => getOverviewStudents(classCode));
  const [studentNames, setStudentNames] = useState<string[]>(() =>
    sortStudentNames(getOverviewStudents(classCode).map((student) => student.chineseName)),
  );
  const [rosterDraftRows, setRosterDraftRows] = useState<StudentInfo[]>(() => getOverviewStudents(classCode));
  const orderedDays = useMemo(() => getOrderedChallengeDays(classCode), [classCode]);
  const [week, setWeek] = useState(() => getCurrentWeek());
  const [content, setContent] = useState<OverviewContent>(() =>
    loadDraft(classCode, getCurrentWeek()) ?? createEmptyContent(classCode, getCurrentWeek(), { orderedDays, studentNames }),
  );
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState('');
  const [listeningBatchInput, setListeningBatchInput] = useState('');
  const [translating, setTranslating] = useState(false);
  const [studentImportInput, setStudentImportInput] = useState('');
  const [studentListCollapsed, setStudentListCollapsed] = useState(false);
  const [collapsedCommunicationPickers, setCollapsedCommunicationPickers] = useState<Record<string, boolean>>({});
  const [phaseTierCollapsed, setPhaseTierCollapsed] = useState(false);
  const [activePhaseTier, setActivePhaseTier] = useState<PhaseChallengeRow['key']>('维稳达标');
  const [clearPanelMode, setClearPanelMode] = useState<'hidden' | 'choose' | 'partial'>('hidden');
  const [tierReturnMap, setTierReturnMap] = useState<Record<string, PhaseChallengeRow['key'] | null>>({});
  const [partialClearTargets, setPartialClearTargets] = useState<Record<ClearTargetKey, boolean>>({
    weeklyChallenges: true,
    phaseDetails: true,
    challengeItems: true,
    listeningMaterials: true,
    communicationPlan: true,
    customBlocks: true,
  });
  const cardRef = useRef<HTMLDivElement>(null);
  const communicationSectionRef = useRef<HTMLElement>(null);
  const previousPhaseTierRef = useRef<PhaseChallengeRow['key']>('维稳达标');
  const [savedCommunicationPlans, setSavedCommunicationPlans] = useState<SavedCommunicationPlan[]>(() => listSavedCommunicationPlans(classCode));
  const [communicationSnapshots, setCommunicationSnapshots] = useState<CommunicationSnapshot[]>(() => listCommunicationSnapshots(classCode));

  // Map Chinese name → English name for display throughout the overview
  const englishNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of resolvedStudents) {
      if (s.englishName) map.set(s.chineseName, s.englishName);
    }
    return map;
  }, [resolvedStudents]);

  /** Translate a Chinese name to its English display name (falls back to Chinese). */
  function displayName(chineseName: string): string {
    return formatDisplayName(chineseName, englishNameMap);
  }

  /** Translate an array of Chinese names to English display names, sorted by English name and joined. */
  function displayNames(chineseNames: string[]): string {
    return formatDisplayNames(chineseNames, englishNameMap);
  }

  useEffect(() => {
    const nextResolved = getOverviewStudents(classCode);
    const nextNames = sortStudentNames(nextResolved.map((student) => student.chineseName));
    setResolvedStudents(nextResolved);
    setStudentNames(nextNames);
    setRosterDraftRows(nextResolved);
    setStudentListCollapsed(nextNames.length > 12);
    setCollapsedCommunicationPickers({});
    setSavedCommunicationPlans(listSavedCommunicationPlans(classCode));
    setCommunicationSnapshots(listCommunicationSnapshots(classCode));
    previousPhaseTierRef.current = '维稳达标';
    setActivePhaseTier('维稳达标');
    setClearPanelMode('hidden');
    setTierReturnMap({});
    const draft = loadDraft(classCode, week);
    setContent(draft ?? createEmptyContent(classCode, week, { orderedDays, studentNames: nextNames }));
  }, [classCode, orderedDays, week]);

  useEffect(() => {
    const timer = setTimeout(() => {
      saveDraft(content);
      rememberReusableContent(content, studentNames);
    }, 400);
    return () => clearTimeout(timer);
  }, [content, studentNames]);

  useEffect(() => {
    setContent((current) => syncOverviewContent(current, orderedDays, studentNames));
  }, [orderedDays, studentNames]);

  function updateContent(updater: (current: OverviewContent) => OverviewContent) {
    setContent((current) => {
      const next = updater(current);
      return {
        ...next,
        classCode,
        week,
        communicationPlan: normalizeCommunicationPlan(next.communicationPlan),
      };
    });
  }

  function jumpToCommunicationPlanner() {
    if (onOpenCommunicationPlanner) {
      onOpenCommunicationPlanner();
      return;
    }
    communicationSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setNotice('已定位到交流名单区域。');
  }

  function toggleCommunicationPicker(groupId: string) {
    setCollapsedCommunicationPickers((current) => ({
      ...current,
      [groupId]: !(current[groupId] ?? true),
    }));
  }

  function isCommunicationPickerCollapsed(groupId: string): boolean {
    return collapsedCommunicationPickers[groupId] ?? true;
  }

  function getOrderedStudentsForPlan(mode: CommunicationPlanMode): string[] {
    if (mode === 'alphabet') {
      return [...studentNames].sort((a, b) => displayName(a).localeCompare(displayName(b), 'en', { sensitivity: 'base' }));
    }

    if (mode === 'phase') {
      const tierOrder: PhaseChallengeRow['key'][] = ['夯实基础', '维稳达标', '突破拔高'];
      const seen = new Set<string>();
      const ordered: string[] = [];
      for (const tier of tierOrder) {
        const row = content.phaseChallenges.find((item) => item.key === tier);
        const names = [...(row?.selectedStudents ?? [])].sort((a, b) => displayName(a).localeCompare(displayName(b), 'en', { sensitivity: 'base' }));
        for (const name of names) {
          if (!seen.has(name)) {
            seen.add(name);
            ordered.push(name);
          }
        }
      }
      const remaining = studentNames
        .filter((name) => !seen.has(name))
        .sort((a, b) => displayName(a).localeCompare(displayName(b), 'en', { sensitivity: 'base' }));
      return [...ordered, ...remaining];
    }

    return [];
  }

  function buildPlanEntries(): CommunicationPlanEntry[] {
    const plan = normalizeCommunicationPlan(content.communicationPlan) as NormalizedCommunicationPlan;
    if (plan.mode === 'manual') {
      const manualEntries = plan.groups
        .filter(hasCommunicationGroupContent)
        .map((group, index) => ({
          id: group.sourceEntryId || `plan_entry_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 6)}`,
          label: group.label || `第${index + 1}组`,
          weekIndex: currentCycleWeek,
          slotType: group.slotType || 'weekday_after',
          selectedStudents: group.selectedStudents,
          teacherName: group.teacherName,
          locationText: group.locationText || plan.defaultLocationText || '教室',
          scheduleText: group.scheduleText || getSlotLabel(group.slotType || 'weekday_after'),
          note: group.note,
          isManual: true,
        }));
      if (manualEntries.length === 0) {
        setNotice('手工排布模式下，请先在本周执行区补好分组，再保存为本轮计划。');
        return [];
      }
      const otherWeeks = (plan.entries || []).filter((entry) => entry.weekIndex !== currentCycleWeek);
      return [...otherWeeks, ...manualEntries];
    }

    const orderedStudents = getOrderedStudentsForPlan(plan.mode || 'phase');
    if (orderedStudents.length === 0) {
      setNotice(plan.mode === 'phase' ? '分层名单还没有学生，暂时无法按分层粗排。' : '当前还没有可安排的学生。');
      return [];
    }

    const availableSlots: CommunicationSlotType[] = (plan.availableSlots?.length ?? 0) > 0
      ? plan.availableSlots!
      : ['weekday_after'];
    const groupSize = Math.max(1, plan.suggestedGroupSize || 2);
    const chunks: string[][] = [];
    for (let index = 0; index < orderedStudents.length; index += groupSize) {
      chunks.push(orderedStudents.slice(index, index + groupSize));
    }

    const positions = Math.max(1, plan.cycleWeeks || 1) * availableSlots.length;
    return chunks.map((students, index) => {
      const positionIndex = index % positions;
      const weekIndex = Math.floor(positionIndex / availableSlots.length) + 1;
      const slotType = availableSlots[positionIndex % availableSlots.length];
      const slotLabel = getSlotLabel(slotType);
      const repeatIndex = Math.floor(index / positions);

      return {
        id: `plan_entry_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 6)}`,
        label: repeatIndex > 0 ? `第${weekIndex}周 ${slotLabel} · 第${repeatIndex + 1}组` : `第${weekIndex}周 ${slotLabel}`,
        weekIndex,
        slotType,
        selectedStudents: students,
        teacherName: plan.defaultTeacherName || '',
        locationText: plan.defaultLocationText || '教室',
        scheduleText: slotLabel,
        note: '',
      };
    });
  }

  function generateCommunicationPlan() {
    const entries = buildPlanEntries();
    if (entries.length === 0) return;
    updateContent((current) => ({
      ...current,
      communicationPlan: normalizeCommunicationPlan({
        ...current.communicationPlan,
        status: current.communicationPlan.status === 'archived' ? 'draft' : current.communicationPlan.status,
        entries,
      }),
    }));
    setNotice(`已生成 ${entries.length} 条交流计划草案。`);
  }

  function restoreSavedPlan(plan: SavedCommunicationPlan) {
    const cycleWeek = getCycleWeek(week, plan.cycleWeeks || 1);
    const currentGroups = (plan.entries || [])
      .filter((entry) => entry.weekIndex === cycleWeek)
      .map((entry, index) => createCommunicationGroup({
        label: entry.label || `第${index + 1}组`,
        selectedStudents: entry.selectedStudents,
        teacherName: entry.teacherName || plan.defaultTeacherName,
        slotType: entry.slotType,
        locationText: entry.locationText || plan.defaultLocationText || '教室',
        scheduleText: entry.scheduleText || getSlotLabel(entry.slotType),
        note: entry.note,
        sourceEntryId: entry.id,
      }));

    updateContent((current) => ({
      ...current,
      communicationPlan: normalizeCommunicationPlan({
        ...current.communicationPlan,
        planName: plan.planName,
        roundLabel: plan.roundLabel,
        status: plan.status || 'draft',
        cycleWeeks: plan.cycleWeeks || 4,
        deadlineDate: plan.deadlineDate,
        mode: plan.mode || 'phase',
        suggestedGroupSize: plan.suggestedGroupSize,
        availableSlots: plan.availableSlots || ['weekday_after'],
        defaultTeacherName: plan.defaultTeacherName || '',
        defaultLocationText: plan.defaultLocationText || '教室',
        entries: plan.entries || [],
        groups: currentGroups.length > 0 ? currentGroups : [createCommunicationGroup({
          teacherName: plan.defaultTeacherName,
          locationText: plan.defaultLocationText || '教室',
        })],
      }),
    }));
    setNotice(`已载入 ${plan.roundLabel} · ${plan.planName}。`);
  }

  function saveCurrentPlanPreset() {
    const saved = saveCommunicationPlanPreset(classCode, normalizeCommunicationPlan(content.communicationPlan));
    setSavedCommunicationPlans(listSavedCommunicationPlans(classCode));
    setNotice(`已保存到本地历史：${saved.roundLabel} · ${saved.planName}`);
  }

  function syncCurrentWeekFromPlan() {
    const plan = normalizeCommunicationPlan(content.communicationPlan) as NormalizedCommunicationPlan;
    const currentCycleWeek = getCycleWeek(week, plan.cycleWeeks || 1);
    const currentEntries = (plan.entries || []).filter((entry) => entry.weekIndex === currentCycleWeek);
    if (currentEntries.length === 0) {
      setNotice('当前轮次的这一周还没有计划条目，请先生成草案或手动补计划。');
      return;
    }

    const hasConflict = content.communicationPlan.groups.some(hasCommunicationGroupContent);
    if (hasConflict) {
      const shouldOverride = window.confirm('本周交流名单已有手动内容，重新同步会覆盖当前分组。是否继续覆盖为计划版本？');
      if (!shouldOverride) return;
    }

    const nextGroups = currentEntries.map((entry, index) => createCommunicationGroup({
      label: entry.label || `第${index + 1}组`,
      selectedStudents: entry.selectedStudents,
      teacherName: entry.teacherName || plan.defaultTeacherName,
      slotType: entry.slotType,
      locationText: entry.locationText || plan.defaultLocationText || '教室',
      scheduleText: entry.scheduleText || getSlotLabel(entry.slotType),
      note: entry.note,
      sourceEntryId: entry.id,
    }));

    const nextPlan = normalizeCommunicationPlan({
      ...plan,
      status: plan.status === 'draft' ? 'active' : plan.status,
      groups: nextGroups,
    });

    updateContent((current) => ({
      ...current,
      communicationPlan: nextPlan,
    }));
    saveCommunicationSnapshot(classCode, week, nextPlan);
    setCommunicationSnapshots(listCommunicationSnapshots(classCode));
    setCollapsedCommunicationPickers({});
    setNotice(`已把 ${nextPlan.roundLabel} 的第 ${currentCycleWeek} 周同步到本周交流名单。`);
  }

  function persistOverviewRoster(nextStudents: StudentInfo[], options?: { notice?: string }) {
    const saved = saveOverviewRoster(classCode, nextStudents);
    const nextNames = sortStudentNames(saved.map((student) => student.chineseName));
    setResolvedStudents(saved);
    setStudentNames(nextNames);
    setRosterDraftRows(saved);
    if (options?.notice) setNotice(options.notice);
  }

  function updateRosterDraft(studentId: string, field: 'chineseName' | 'englishName', value: string) {
    setRosterDraftRows((current) => current.map((student) =>
      student.id === studentId
        ? { ...student, [field]: field === 'chineseName' ? value : value.trim() || undefined }
        : student,
    ));
  }

  function saveRosterDraft(studentId?: string) {
    if (studentId) {
      persistOverviewRoster(rosterDraftRows.map((student) =>
        student.id === studentId
          ? {
              ...student,
              chineseName: student.chineseName.trim(),
              englishName: String(student.englishName || '').trim() || undefined,
            }
          : student,
      ));
      return;
    }

    persistOverviewRoster(rosterDraftRows.map((student) => ({
      ...student,
      chineseName: student.chineseName.trim(),
      englishName: String(student.englishName || '').trim() || undefined,
    })));
  }

  function removeRosterStudent(studentId: string) {
    setRosterDraftRows((current) => current.filter((student) => student.id !== studentId));
    persistOverviewRoster(
      resolvedStudents.filter((student) => student.id !== studentId),
      { notice: '已从班级概览局部名单中删除学生。' },
    );
  }

  function addRosterStudent() {
    persistOverviewRoster(
      [
        ...resolvedStudents,
        {
          id: `overview_${classCode}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          chineseName: `新同学${resolvedStudents.length + 1}`,
          englishName: '',
        },
      ],
      { notice: '已新增一位学生到班级概览局部名单。' },
    );
  }

  function getStudentPhase(name: string): PhaseChallengeRow['key'] | null {
    for (const row of content.phaseChallenges) {
      if (row.selectedStudents.includes(name)) return row.key;
    }
    return null;
  }

  function handlePhaseTabClick(tier: PhaseChallengeRow['key']) {
    setActivePhaseTier((current) => {
      if (current === tier) {
        return previousPhaseTierRef.current || current;
      }
      previousPhaseTierRef.current = current;
      return tier;
    });
  }

  function handleWeekChange(nextWeek: number) {
    setWeek(nextWeek);
    const draft = loadDraft(classCode, nextWeek);
    setContent(draft ?? createEmptyContent(classCode, nextWeek, { orderedDays, studentNames }));
  }

  async function handleListeningBatchImport() {
    const pairs = extractListeningPairs(listeningBatchInput);
    const words = pairs.map((pair) => pair.english).filter(Boolean);
    if (words.length === 0) {
      setNotice('先把英文单词整段贴进来。');
      return;
    }

    setTranslating(true);
    try {
      const materials = await buildListeningMaterials(listeningBatchInput);
      if (materials.length === 0) {
        setNotice('没有识别到可用单词。');
        return;
      }
      updateContent((current) => ({
        ...current,
        listeningMaterials: materials,
      }));
      setNotice(`已识别 ${materials.length} 个单词，中文释义优先保留你粘贴的内容。`);
    } catch {
      setNotice('英文识别到了，但自动补中文失败了。我已经改成后端翻译链路，刷新后再试一次。');
    } finally {
      setTranslating(false);
    }
  }

  function applyStudentNames(names: string[]) {
    const incoming = names.map((name, index) => ({
      id: `overview_import_${classCode}_${Date.now()}_${index}`,
      chineseName: name,
      englishName: '',
    }));
    persistOverviewRoster([...resolvedStudents, ...incoming], {
      notice: `已把 ${names.length} 位学生合并到班级概览局部名单。`,
    });
  }

  async function handleStudentFileImport(file: File | null) {
    if (!file) return;
    const lowerName = file.name.toLowerCase();

    if (lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls')) {
      const buffer = await file.arrayBuffer();
      const { read, utils } = await import('xlsx');
      const workbook = read(buffer, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      const rows = utils.sheet_to_json<(string | number | null)[]>(workbook.Sheets[firstSheetName], {
        header: 1,
      });
      const names = rows
        .flatMap((row) => row.map((cell) => String(cell ?? '').trim()))
        .filter(Boolean);
      applyStudentNames(names);
      return;
    }

    const text = await fileToText(file);
    applyStudentNames(parseStudentNames(text));
  }

  function handleManualStudentImport() {
    const names = parseStudentNames(studentImportInput);
    if (names.length === 0) {
      setNotice('先粘贴学生名单。');
      return;
    }
    applyStudentNames(names);
    setStudentImportInput('');
  }

  function toggleName(list: string[], name: string): string[] {
    return list.includes(name) ? list.filter((item) => item !== name) : [...list, name];
  }

  function toggleSortedName(list: string[], name: string): string[] {
    return sortStudentNames(toggleName(list, name));
  }

  function togglePhaseStudent(rowId: string, name: string) {
    updateContent((current) => {
      const currentRow = current.phaseChallenges.find((row) => row.id === rowId);
      const removing = currentRow?.selectedStudents.includes(name);

      return {
        ...current,
        phaseChallenges: current.phaseChallenges.map((row) => {
          if (row.id === rowId) {
            return {
              ...row,
              selectedStudents: removing
                ? sortStudentNames(row.selectedStudents.filter((item) => item !== name))
                : sortStudentNames([...row.selectedStudents.filter((item) => item !== name), name]),
            };
          }

          return removing
            ? row
            : { ...row, selectedStudents: sortStudentNames(row.selectedStudents.filter((item) => item !== name)) };
        }),
      };
    });
  }

  function clearCustomBlocks(blocks: CustomBlock[]): CustomBlock[] {
    if (blocks.length === 0) return [createCustomBlock()];
    return blocks.map((block) => ({
      ...block,
      text: '',
      table: {
        columns: [...block.table.columns],
        rows: block.table.rows.length > 0 ? block.table.rows.map((row) => row.map(() => '')) : [['', '']],
      },
      media: [],
    }));
  }

  function clearOverviewContent(targets: Record<ClearTargetKey, boolean>) {
    updateContent((current) => ({
      ...current,
      weeklyChallenges: targets.weeklyChallenges
        ? current.weeklyChallenges.map((item) => ({ ...item, task: '' }))
        : current.weeklyChallenges,
      phaseChallenges: current.phaseChallenges.map((row) => ({
        ...row,
        challengeContent: targets.phaseDetails ? '' : row.challengeContent,
        method: targets.phaseDetails ? '' : row.method,
      })),
      challengeItems: targets.challengeItems ? [] : current.challengeItems,
      listeningMaterials: targets.listeningMaterials ? [] : current.listeningMaterials,
      communicationPlan: targets.communicationPlan
        ? syncCommunicationPlan(current.communicationPlan.groups.map((group) => ({
            ...group,
            teacherName: '',
            locationText: current.communicationPlan.defaultLocationText || '教室',
            scheduleText: '',
            note: '',
          })), current.communicationPlan)
        : current.communicationPlan,
      customBlocks: targets.customBlocks ? clearCustomBlocks(current.customBlocks) : current.customBlocks,
    }));
  }

  function handleClearAll() {
    clearOverviewContent({
      weeklyChallenges: true,
      phaseDetails: true,
      challengeItems: true,
      listeningMaterials: true,
      communicationPlan: true,
      customBlocks: true,
    });
    setClearPanelMode('hidden');
    setNotice('已清空概览内容，并保留学生分层名单与名单勾选状态。');
  }

  function handlePartialClear() {
    if (!Object.values(partialClearTargets).some(Boolean)) {
      setNotice('至少勾选一项再清空。');
      return;
    }
    clearOverviewContent(partialClearTargets);
    setClearPanelMode('hidden');
    setNotice('已按选择清空对应部分，并保留学生分层名单与名单勾选状态。');
  }

  async function handleExport() {
    if (!cardRef.current) return;
    setExporting(true);
    try {
      const { default: html2canvas } = await import('html2canvas');
      const canvas = await html2canvas(cardRef.current, {
        backgroundColor: null,
        scale: 2,
        useCORS: true,
      });
      const link = document.createElement('a');
      link.download = `${classCode}_W${week}_课程概览.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } finally {
      setExporting(false);
    }
  }

  function logCommunication(group: CommunicationGroup) {
    if (group.selectedStudents.length === 0) {
      setNotice('先勾选交流学生。');
      return;
    }

    addCommunicationRecord(classCode, {
      week,
      studentNames: sortStudentNames(group.selectedStudents),
      teacherName: group.teacherName,
      scheduleText: [group.scheduleText, group.locationText || ''].filter(Boolean).join(' · '),
      note: group.note,
      groupLabel: group.label,
    });

    setNotice('交流名单已记忆，下次会继续提醒哪些学生已交流。');
  }

  const communicationStats = useMemo(
    () => getCommunicationStats(classCode, studentNames),
    [classCode, studentNames, content.communicationPlan.groups],
  );
  const communicationPlan = useMemo(
    () => normalizeCommunicationPlan(content.communicationPlan) as NormalizedCommunicationPlan,
    [content.communicationPlan],
  );
  const weekRange = getWeekRange(week);
  const orderedChallengeDays = useMemo(
    () => orderDaysFromStart(content.challengeStartDay || orderedDays[0] || '周一'),
    [content.challengeStartDay, orderedDays],
  );
  const weeklyChallengeRows = useMemo(
    () => orderedChallengeDays.map((day) => content.weeklyChallenges.find((item) => item.day === day) ?? { day, task: '' }),
    [content.weeklyChallenges, orderedChallengeDays],
  );
  const showWeeklyChallenges = hasWeeklyChallenges(content);
  const showCommunicationSection = hasCommunicationPlan(content);
  const currentCycleWeek = getCycleWeek(week, communicationPlan.cycleWeeks);
  const communicationGroups = communicationPlan.groups.length > 0
    ? communicationPlan.groups
    : [createCommunicationGroup()];
  const currentWeekPlanEntries = communicationPlan.entries.filter((entry) => entry.weekIndex === currentCycleWeek);
  const previewCommunicationGroups = communicationGroups.filter((group) =>
    group.selectedStudents.length > 0 ||
    group.teacherName.trim() ||
    (((group.locationText || '').trim()) && (group.locationText || '').trim() !== '教室') ||
    group.scheduleText.trim() ||
    group.note.trim(),
  );
  const visibleCustomBlocks = content.customBlocks.filter(shouldShowCustomBlock);
  const previewTheme = content.theme || 'green';
  const phasePreviewRows = PHASE_TIER_ORDER
    .map((tierKey) => content.phaseChallenges.find((r) => r.key === tierKey)!)
    .filter((row) => row && row.selectedStudents.length > 0 && (row.challengeContent.trim() || row.method.trim()));
  const challengePreviewItems = content.challengeItems.filter(
    (item) => item.title.trim() || item.detail.trim() || item.media.length > 0,
  );
  const listeningPreviewItems = content.listeningMaterials.filter(
    (item) => item.english.trim() || item.chinese.trim(),
  );
  const previewSectionNumbers = useMemo(() => {
    let index = 0;
    return {
      weekly: showWeeklyChallenges ? ++index : 0,
      phase: phasePreviewRows.length > 0 ? ++index : 0,
      challenges: challengePreviewItems.length > 0 ? ++index : 0,
      listening: listeningPreviewItems.length > 0 ? ++index : 0,
      communication: showCommunicationSection ? ++index : 0,
      customStart: index,
    };
  }, [
    challengePreviewItems.length,
    listeningPreviewItems.length,
    phasePreviewRows.length,
    showCommunicationSection,
    showWeeklyChallenges,
  ]);

  return (
    <div className="ov-shell fade-in">
      {onBackToHome && (
        <button className="tool-home-rail" onClick={onBackToHome}>
          <span className="tool-home-rail-icon">←</span>
          <span>返回主页</span>
        </button>
      )}
      <div className="ov-toolbar">
        <div className="tool-topbar">
          <button className="tool-back-btn" onClick={onBack}>← 返回</button>
          {classes && classes.length > 1 && onSwitchClass ? (
            <select className="tool-class-switch" value={classCode} onChange={(e) => onSwitchClass(e.target.value)}>
              {classes.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
            </select>
          ) : (
            <span className="tool-class-switch" style={{ cursor: 'default' }}>{classCode}</span>
          )}
          <span className="tool-topbar-label">{formatDateShort(weekRange.start)} - {formatDateShort(weekRange.end)}</span>
        </div>
        <div className="ov-toolbar-actions">
          <select
            value={previewTheme}
            onChange={(event) =>
              updateContent((current) => ({ ...current, theme: event.target.value as OverviewThemeOption }))
            }
          >
            {OVERVIEW_THEME_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <select value={week} onChange={(event) => handleWeekChange(Number(event.target.value))}>
            {Array.from({ length: 52 }, (_, index) => index + 1).map((item) => (
              <option key={item} value={item}>W{item}</option>
            ))}
          </select>
          <button className="btn btn-primary btn-sm" onClick={handleExport} disabled={exporting}>
            {exporting ? '导出中...' : '导出图片'}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setClearPanelMode((mode) => mode === 'hidden' ? 'choose' : 'hidden')}>
            清空
          </button>
        </div>
      </div>

      {notice && <div className="ov-notice">{notice}</div>}
      {clearPanelMode !== 'hidden' && (
        <div className="ov-clear-panel">
          <div className="ov-clear-head">
            <strong>清空班级概览</strong>
            <span>即使全部清空，也保留学生分层名单和名单勾选状态。</span>
          </div>
          <div className="ov-inline-actions ov-inline-actions-start">
            <button className="btn btn-primary btn-sm" onClick={handleClearAll}>全部清空</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setClearPanelMode('partial')}>只清空指定部分</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setClearPanelMode('hidden')}>取消</button>
          </div>
          {clearPanelMode === 'partial' && (
            <>
              <div className="ov-clear-grid">
                {CLEAR_TARGET_OPTIONS.map((item) => (
                  <label key={item.key} className="ov-clear-option">
                    <input
                      type="checkbox"
                      checked={partialClearTargets[item.key]}
                      onChange={() =>
                        setPartialClearTargets((current) => ({ ...current, [item.key]: !current[item.key] }))
                      }
                    />
                    <span>{item.label}</span>
                    <small>{item.description}</small>
                  </label>
                ))}
              </div>
              <div className="ov-inline-actions ov-inline-actions-start">
                <button className="btn btn-primary btn-sm" onClick={handlePartialClear}>确认清空所选部分</button>
              </div>
            </>
          )}
        </div>
      )}

      <div className="ov-layout">
        <div className="ov-editor card">
          <div className="ov-editor-quickbar">
            <div className="ov-quick-card">
              <span className="ov-quick-label">编辑顺序</span>
              <strong>名单 → 挑战 → 记录 → 预览导出</strong>
            </div>
            <div className="ov-quick-card">
              <span className="ov-quick-label">当前状态</span>
              <strong>W{week} · {studentNames.length} 人 · 自动暂存中</strong>
            </div>
            <div className="ov-quick-card ov-quick-card-action">
              <span className="ov-quick-label">交流名单</span>
              <strong>{communicationPlan.roundLabel} · 第 {currentCycleWeek} 周</strong>
              <button className="btn btn-primary btn-sm" onClick={jumpToCommunicationPlanner}>交流名单制定</button>
            </div>
          </div>
          <section className="ov-editor-section ov-editor-section-compact">
            <div className="ov-section-head">
              <h3>学生名单</h3>
              <div className="ov-section-head-actions">
                <p>{studentNames.length > 0 ? `当前概览名单 ${studentNames.length} 人` : '当前还没有可用名单'}</p>
                {studentNames.length > 0 && (
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => setStudentListCollapsed((collapsed) => !collapsed)}
                  >
                    {studentListCollapsed ? '展开名单' : '收起名单'}
                  </button>
                )}
              </div>
            </div>
            {studentNames.length > 0 && !studentListCollapsed ? (
              <div className="ov-roster-table">
                <div className="ov-roster-head">英文名</div>
                <div className="ov-roster-head ov-roster-head-action">操作</div>
                {[...rosterDraftRows]
                  .sort((a, b) => (a.englishName || a.chineseName).localeCompare(b.englishName || b.chineseName, 'en', { sensitivity: 'base' }))
                  .map((student) => (
                    <Fragment key={student.id}>
                      <input
                        value={student.englishName || ''}
                        onChange={(event) => updateRosterDraft(student.id, 'englishName', event.target.value)}
                        onBlur={() => saveRosterDraft(student.id)}
                        placeholder={student.chineseName || '英文名'}
                        aria-label={`英文名 ${student.chineseName}`}
                      />
                      <button className="btn btn-ghost btn-sm" onClick={() => removeRosterStudent(student.id)}>删除</button>
                    </Fragment>
                  ))}
              </div>
            ) : studentNames.length > 0 ? (
              <div className="ov-empty-state-inline">
                <p>名单已收起，下面导入区和各层级勾选仍然可用。</p>
              </div>
            ) : (
              <div className="ov-empty-state-inline">
                <p>没有读到班级名单。我会优先从座位表回收；如果这边还没有，再在下面导入一次。</p>
              </div>
            )}
            <div className="ov-student-import">
              <ExpandableTextarea
                collapsedRows={3}
                expandedRows={6}
                placeholder="粘贴学生名单，支持换行、逗号、分号分隔；会合并进概览局部名单"
                value={studentImportInput}
                onChange={setStudentImportInput}
              />
              <div className="ov-inline-actions">
                <button className="btn btn-ghost btn-sm" onClick={handleManualStudentImport}>导入粘贴名单</button>
                <button className="btn btn-ghost btn-sm" onClick={addRosterStudent}>+ 增加学生</button>
                <label className="btn btn-ghost btn-sm ov-upload-btn">
                  上传名单文件
                  <input
                    type="file"
                    accept=".txt,.csv,.xlsx,.xls"
                    hidden
                    onChange={(event) => {
                      void handleStudentFileImport(event.target.files?.[0] ?? null);
                      event.target.value = '';
                    }}
                  />
                </label>
              </div>
            </div>
          </section>

          <section className="ov-editor-section">
            <div className="ov-section-head">
              <h3>① 本周挑战</h3>
              <p>横排填写，预览里只保留干净的表格。</p>
            </div>
            <div className="ov-inline-actions ov-inline-actions-start">
              <span className="ov-field-caption">第一天</span>
              <select
                value={content.challengeStartDay || orderedDays[0]}
                onChange={(event) =>
                  updateContent((current) => ({
                    ...current,
                    challengeStartDay: event.target.value as OverviewContent['challengeStartDay'],
                  }))
                }
              >
                {ALL_DAYS.map((day) => (
                  <option key={day} value={day}>{day}</option>
                ))}
              </select>
            </div>
            <div className="ov-week-table-wrap">
              <div className="ov-week-table" style={{ gridTemplateColumns: `repeat(${weeklyChallengeRows.length}, minmax(220px, 1fr))` }}>
                {weeklyChallengeRows.map((item) => (
                  <div key={`${item.day}_head`} className="ov-week-head">{item.day}</div>
                ))}
                {weeklyChallengeRows.map((item) => (
                  <ExpandableTextarea
                    key={item.day}
                    className="ov-week-field"
                    collapsedRows={4}
                    expandedRows={7}
                    placeholder="这一天的具体挑战"
                    value={item.task}
                    onChange={(value) =>
                      updateContent((current) => ({
                        ...current,
                        weeklyChallenges: current.weeklyChallenges.map((currentItem) =>
                          currentItem.day === item.day ? { ...currentItem, task: value } : currentItem,
                        ),
                      }))
                    }
                  />
                ))}
              </div>
            </div>
          </section>

          <section className="ov-editor-section">
            <div className="ov-section-head">
              <h3>② 分阶段挑战</h3>
              <div className="ov-section-head-actions">
                <p>先选层级，再点学生名字把他刷成那个层级。所有学生默认「维稳达标」。</p>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => setPhaseTierCollapsed((v) => !v)}
                >
                  {phaseTierCollapsed ? '展开分层' : '收起分层'}
                </button>
              </div>
            </div>

            {!phaseTierCollapsed && (
              <>
                {/* Tier selector tabs — pick which "brush" to paint with */}
                <div className="ov-phase-tabs">
                  {PHASE_TIER_ORDER.map((tierKey) => {
                    const tone = getPhaseTone(tierKey);
                    const row = content.phaseChallenges.find((r) => r.key === tierKey);
                    const count = row?.selectedStudents.length ?? 0;
                    return (
                      <button
                        key={tierKey}
                        className={`ov-phase-tab ov-phase-tab-${tone}${activePhaseTier === tierKey ? ' active' : ''}`}
                        onClick={() => handlePhaseTabClick(tierKey)}
                      >
                        {tierKey}
                        <span className="ov-phase-tab-count">{count}</span>
                      </button>
                    );
                  })}
                </div>

                {/* All students always visible, colored by their current tier */}
                <div className="ov-student-grid ov-phase-tier-grid">
                  {[...studentNames]
                    .sort((a, b) => (englishNameMap.get(a) || a).localeCompare(englishNameMap.get(b) || b, 'en', { sensitivity: 'base' }))
                    .map((name) => {
                      const currentPhase = getStudentPhase(name) ?? '维稳达标';
                      const tone = getPhaseTone(currentPhase);
                      const isActiveTier = currentPhase === activePhaseTier;
                      return (
                        <span
                          key={name}
                          className={`ov-student-chip ov-student-chip-tone-${tone} active${isActiveTier ? ' ov-chip-selected-tier' : ''}`}
                          onClick={() => {
                            const toggled = toggleStudentTierWithMemory(
                              content.phaseChallenges,
                              name,
                              activePhaseTier,
                              tierReturnMap,
                            );
                            setTierReturnMap(toggled.previousTierMap);
                            updateContent((current) => ({
                              ...current,
                              phaseChallenges: toggled.rows,
                            }));
                          }}
                          title={`${englishNameMap.get(name) || name}（${currentPhase}）— 点击移到「${activePhaseTier}」`}
                        >
                          {englishNameMap.get(name) || name}
                        </span>
                      );
                    })}
                </div>
              </>
            )}

            {/* Per-tier challenge content + method */}
            <div className="ov-phase-editor-list">
              {PHASE_TIER_ORDER
                .map((tierKey) => content.phaseChallenges.find((r) => r.key === tierKey)!)
                .filter((row) => row && row.selectedStudents.length > 0)
                .map((row) => (
                  <section key={row.id} className="ov-phase-editor-card">
                    <div className={`ov-phase-editor-title ov-phase-title-${getPhaseTone(row.key)}`}>
                      {row.label}
                      <span className="ov-phase-title-count">
                        {row.selectedStudents.map((n) => englishNameMap.get(n) || n).sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })).join('、')}
                      </span>
                    </div>
                    <div className="ov-phase-editor-detail-grid">
                      <div className="ov-phase-cell">
                        <div className="ov-phase-subtitle">具体挑战内容</div>
                        <ExpandableTextarea
                          collapsedRows={4}
                          expandedRows={7}
                          value={row.challengeContent}
                          placeholder="比如：固定跟读、句型复述、单词滚动复盘"
                          onChange={(value) =>
                            updateContent((current) => ({
                              ...current,
                              phaseChallenges: current.phaseChallenges.map((phase) =>
                                phase.id === row.id ? { ...phase, challengeContent: value } : phase,
                              ),
                            }))
                          }
                        />
                      </div>
                      <div className="ov-phase-cell">
                        <div className="ov-phase-subtitle">达成途径</div>
                        <ExpandableTextarea
                          collapsedRows={4}
                          expandedRows={7}
                          value={row.method}
                          placeholder="比如：每天 10 分钟 + 课堂抽查"
                          onChange={(value) =>
                            updateContent((current) => ({
                              ...current,
                              phaseChallenges: current.phaseChallenges.map((phase) =>
                                phase.id === row.id ? { ...phase, method: value } : phase,
                              ),
                            }))
                          }
                        />
                      </div>
                    </div>
                  </section>
                ))}
            </div>
          </section>

          <section className="ov-editor-section">
            <div className="ov-section-head">
              <h3>③ 本周挑战内容</h3>
              <p>支持多个挑战，每个挑战都可以配文字和图片。</p>
            </div>
            <div className="ov-inline-actions">
              <button className="btn btn-ghost btn-sm" onClick={() => updateContent((current) => ({
                ...current,
                challengeItems: [...current.challengeItems, createChallengeItem()],
              }))}>
                + 添加挑战
              </button>
            </div>
            {content.challengeItems.length === 0 && <p className="ov-empty-hint">还没有挑战内容。</p>}
            {content.challengeItems.map((item: ChallengeItem, index) => (
              <div key={item.id} className="ov-block-card ov-record-card">
                <div className="ov-record-card-head">
                  <span className="ov-record-index">挑战 {index + 1}</span>
                  <button className="btn btn-ghost btn-sm" onClick={() =>
                    updateContent((current) => ({
                      ...current,
                      challengeItems: current.challengeItems.filter((challenge) => challenge.id !== item.id),
                    }))
                  }>
                    删除
                  </button>
                </div>
                <input
                  className="input-field"
                  placeholder="挑战标题"
                  value={item.title}
                  onChange={(event) =>
                    updateContent((current) => ({
                      ...current,
                      challengeItems: current.challengeItems.map((challenge) =>
                        challenge.id === item.id ? { ...challenge, title: event.target.value } : challenge,
                      ),
                    }))
                  }
                />
                <AutoGrowTextarea
                  minRows={2}
                  placeholder="挑战要求"
                  value={item.detail}
                  onPaste={(event) => {
                    const pastedImages = Array.from(event.clipboardData?.files ?? []).filter((file) => file.type.startsWith('image/'));
                    if (pastedImages.length === 0) return;
                    event.preventDefault();
                    void filesToMediaItems(pastedImages).then((uploaded) =>
                      updateContent((current) => ({
                        ...current,
                        challengeItems: current.challengeItems.map((challenge) =>
                          challenge.id === item.id
                            ? { ...challenge, media: [...challenge.media, ...uploaded] }
                            : challenge,
                        ),
                      })),
                    );
                  }}
                  onChange={(value) =>
                    updateContent((current) => ({
                      ...current,
                      challengeItems: current.challengeItems.map((challenge) =>
                        challenge.id === item.id ? { ...challenge, detail: value } : challenge,
                      ),
                    }))
                  }
                />
                <MediaEditor
                  items={item.media}
                  onChange={(media) =>
                    updateContent((current) => ({
                      ...current,
                      challengeItems: current.challengeItems.map((challenge) =>
                        challenge.id === item.id ? { ...challenge, media } : challenge,
                      ),
                    }))
                  }
                />
              </div>
            ))}
          </section>

          <section className="ov-editor-section">
            <div className="ov-section-head">
              <h3>④ 下周听读语料</h3>
              <p>整段粘贴英文后自动拆词补中文，中文仍保留手动修改权限。</p>
            </div>
            <ExpandableTextarea
              collapsedRows={4}
              expandedRows={8}
              placeholder="直接粘贴一整段单词或英文短语，例如: apple, banana, pear"
              value={listeningBatchInput}
              onChange={setListeningBatchInput}
            />
            <div className="ov-inline-actions">
              <select
                value={content.listeningFont}
                onChange={(event) =>
                  updateContent((current) => ({ ...current, listeningFont: event.target.value as ListeningFontOption }))
                }
              >
                <option value="guide">四线三格</option>
                <option value="print">标准印刷</option>
                <option value="rounded">圆润手写</option>
              </select>
              <button className="btn btn-primary btn-sm" onClick={() => void handleListeningBatchImport()} disabled={translating}>
                {translating ? '识别中...' : '识别英文并补中文'}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => updateContent((current) => ({
                ...current,
                listeningMaterials: [...current.listeningMaterials, createListeningItem()],
              }))}>
                + 手动补一条
              </button>
            </div>
            <div className="ov-record-card-list">
              {content.listeningMaterials.length === 0 && <p className="ov-empty-hint">还没有听读语料。</p>}
              {content.listeningMaterials.map((item: ListeningMaterialItem, index) => (
                <div key={item.id} className="ov-record-card ov-listening-card">
                  <div className="ov-record-card-head">
                    <span className="ov-record-index">语料 {index + 1}</span>
                    <button className="btn btn-ghost btn-sm" onClick={() =>
                      updateContent((current) => ({
                        ...current,
                        listeningMaterials: current.listeningMaterials.filter((material) => material.id !== item.id),
                      }))
                    }>
                      删除
                    </button>
                  </div>
                  <input
                    className="input-field"
                    placeholder="English"
                    value={item.english}
                    onChange={(event) =>
                      updateContent((current) => ({
                        ...current,
                        listeningMaterials: current.listeningMaterials.map((material) =>
                          material.id === item.id ? { ...material, english: event.target.value } : material,
                        ),
                      }))
                    }
                  />
                  <input
                    className="input-field"
                    placeholder="中文释义"
                    value={item.chinese}
                    onChange={(event) =>
                      updateContent((current) => ({
                        ...current,
                        listeningMaterials: current.listeningMaterials.map((material) =>
                          material.id === item.id ? { ...material, chinese: event.target.value } : material,
                        ),
                      }))
                    }
                  />
                </div>
              ))}
            </div>
          </section>

          <section ref={communicationSectionRef} className="ov-editor-section">
            <div className="ov-section-head">
              <h3>⑤ 交流名单</h3>
              <p>这里只承接本周同步结果；完整制定请进入新的交流名单页面。</p>
            </div>

            <div className="ov-plan-panel">
              <div className="ov-plan-panel-head">
                <div>
                  <strong>去新的制定页面完成排期</strong>
                  <p>计划名称、周期、时段、分组、历史和复用都在新页面里处理；这里仅同步并承接本周结果。</p>
                </div>
                <div className="ov-summary-strip">
                  <span className="chip">{getPlanStatusLabel(communicationPlan.status)}</span>
                  <span className="chip">{communicationPlan.roundLabel}</span>
                  <span className="chip">第 {currentCycleWeek} / {communicationPlan.cycleWeeks} 周</span>
                </div>
              </div>
              <div className="ov-inline-actions ov-inline-actions-start">
                <button className="btn btn-primary btn-sm" onClick={jumpToCommunicationPlanner}>交流名单制定</button>
                <button className="btn btn-ghost btn-sm" onClick={syncCurrentWeekFromPlan}>同步本周</button>
              </div>
              <div className="ov-plan-generated">
                <div className="ov-plan-generated-head">
                  <strong>当前计划摘要</strong>
                  <span>{communicationPlan.entries.length > 0 ? `已生成 ${communicationPlan.entries.length} 条计划，本周命中 ${currentWeekPlanEntries.length} 条` : '还没有保存好的计划草案'}</span>
                </div>
                <div className="ov-summary-strip">
                  <span className="chip">模式：{COMMUNICATION_MODE_OPTIONS.find((item) => item.value === communicationPlan.mode)?.label ?? '按分层粗排'}</span>
                  <span className="chip">截止：{communicationPlan.deadlineDate || '未设置'}</span>
                  <span className="chip">{(communicationPlan.availableSlots?.length ?? 0) > 0 ? `${communicationPlan.availableSlots.length} 个可用时段` : '未选择时段'}</span>
                </div>
              </div>
            </div>

            <div className="ov-summary-strip">
              <span className="chip">已交流 {communicationStats.contacted.length} 人</span>
              <span className="chip">待交流 {communicationStats.pending.length} 人</span>
              <span className="chip">本周 {communicationGroups.length} 组</span>
            </div>
            <div className="ov-inline-actions ov-inline-actions-start">
              <button
                className="btn btn-ghost btn-sm"
                onClick={() =>
                  updateContent((current) => ({
                    ...current,
                    communicationPlan: syncCommunicationPlan([
                      ...current.communicationPlan.groups,
                      createCommunicationGroup({
                        label: `第${current.communicationPlan.groups.length + 1}组`,
                        teacherName: current.communicationPlan.defaultTeacherName,
                        locationText: current.communicationPlan.defaultLocationText || '教室',
                      }),
                    ], current.communicationPlan),
                  }))
                }
              >
                + 增加一组
              </button>
              <button className="btn btn-ghost btn-sm" onClick={jumpToCommunicationPlanner}>去制定页调整</button>
            </div>
            <div className="ov-comm-group-list">
              {communicationGroups.map((group, index) => (
                <section key={group.id} className="ov-comm-group-card ov-record-card">
                  <div className="ov-comm-group-head">
                    <div className="ov-record-card-head">
                      <span className="ov-record-index">{group.label || `第 ${index + 1} 组`}</span>
                      <div className="ov-inline-actions">
                        <button className="btn btn-ghost btn-sm" onClick={() => toggleCommunicationPicker(group.id)}>
                          {isCommunicationPickerCollapsed(group.id) ? '展开选人' : '收起选人'}
                        </button>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => logCommunication(group)}
                        >
                          记为已交流
                        </button>
                      </div>
                    </div>
                    <div className="ov-comm-meta-grid">
                      <select
                        value={group.slotType || 'weekday_after'}
                        onChange={(event) =>
                          updateContent((current) => ({
                            ...current,
                            communicationPlan: syncCommunicationPlan(
                              current.communicationPlan.groups.map((item) =>
                                item.id === group.id ? { ...item, slotType: event.target.value as CommunicationSlotType } : item,
                              ),
                              current.communicationPlan,
                            ),
                          }))
                        }
                      >
                        {COMMUNICATION_SLOT_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                      <input
                        className="input-field"
                        placeholder="交流老师（选填）"
                        value={group.teacherName}
                        onChange={(event) =>
                          updateContent((current) => ({
                            ...current,
                            communicationPlan: syncCommunicationPlan(
                              current.communicationPlan.groups.map((item) =>
                                item.id === group.id ? { ...item, teacherName: event.target.value } : item,
                              ),
                              current.communicationPlan,
                            ),
                          }))
                        }
                      />
                      <input
                        className="input-field"
                        placeholder="交流地点"
                        value={group.locationText || ''}
                        onChange={(event) =>
                          updateContent((current) => ({
                            ...current,
                            communicationPlan: syncCommunicationPlan(
                              current.communicationPlan.groups.map((item) =>
                                item.id === group.id ? { ...item, locationText: event.target.value } : item,
                              ),
                              current.communicationPlan,
                            ),
                          }))
                        }
                      />
                      <input
                        className="input-field"
                        placeholder="周几 / 课前课后 / 备注"
                        value={group.scheduleText}
                        onChange={(event) =>
                          updateContent((current) => ({
                            ...current,
                            communicationPlan: syncCommunicationPlan(
                              current.communicationPlan.groups.map((item) =>
                                item.id === group.id ? { ...item, scheduleText: event.target.value } : item,
                              ),
                              current.communicationPlan,
                            ),
                          }))
                        }
                      />
                    </div>
                  </div>
                  <div className="ov-comm-inline-summary">
                    <span>{group.selectedStudents.length > 0 ? displayNames(group.selectedStudents) : '先写时间地点，再按需展开选人。'}</span>
                  </div>
                  {!isCommunicationPickerCollapsed(group.id) && (
                    <StudentPicker
                      studentNames={studentNames}
                      selected={group.selectedStudents}
                      onToggle={(name) =>
                        updateContent((current) => ({
                          ...current,
                          communicationPlan: syncCommunicationPlan(
                            current.communicationPlan.groups.map((item) =>
                              item.id === group.id
                                ? { ...item, selectedStudents: toggleSortedName(item.selectedStudents, name), isManual: true }
                                : item,
                            ),
                            current.communicationPlan,
                          ),
                        }))
                      }
                      nameMap={englishNameMap}
                    />
                  )}
                  <div className="ov-inline-actions ov-inline-actions-start">
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() =>
                        updateContent((current) => {
                          const nextGroups = current.communicationPlan.groups.filter((item) => item.id !== group.id);
                          return {
                            ...current,
                            communicationPlan: syncCommunicationPlan(nextGroups, current.communicationPlan),
                          };
                        })
                      }
                      disabled={communicationGroups.length === 1}
                    >
                      删除组
                    </button>
                  </div>
                  <ExpandableTextarea
                    collapsedRows={3}
                    expandedRows={6}
                    placeholder="交流补充说明（默认收起，写长说明时再展开）"
                    value={group.note}
                    onChange={(value) =>
                      updateContent((current) => ({
                        ...current,
                        communicationPlan: syncCommunicationPlan(
                          current.communicationPlan.groups.map((item) =>
                            item.id === group.id ? { ...item, note: value } : item,
                          ),
                          current.communicationPlan,
                        ),
                      }))
                    }
                  />
                </section>
              ))}
            </div>
            {communicationStats.contacted.length > 0 && (
              <div className="ov-history-list">
                {[...communicationStats.contacted].sort((a, b) => displayName(a).localeCompare(displayName(b), 'en', { sensitivity: 'base' })).map((name) => {
                  const record = communicationStats.latestByStudent[name];
                  return (
                    <div key={name} className="ov-history-item">
                      <strong>{displayName(name)}</strong>
                      <span>{record.teacherName || '未写交流人'} · {record.scheduleText || '未写时间地点'} · {formatHistoryDate(record.createdAt)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="ov-editor-section">
            <div className="ov-section-head">
              <h3>⑥ 自定义补充区</h3>
              <p>区域名可改，内容可以是文字、表格或者图片。</p>
            </div>
            <div className="ov-inline-actions">
              <button className="btn btn-ghost btn-sm" onClick={() => updateContent((current) => ({
                ...current,
                customBlocks: [...current.customBlocks, createCustomBlock()],
              }))}>
                + 添加区域
              </button>
            </div>
            {content.customBlocks.map((block) => (
              <div key={block.id} className="ov-block-card">
                <div className="ov-inline-actions">
                  <input
                    className="input-field"
                    value={block.title}
                    onChange={(event) =>
                      updateContent((current) => ({
                        ...current,
                        customBlocks: current.customBlocks.map((item) =>
                          item.id === block.id ? { ...item, title: event.target.value } : item,
                        ),
                      }))
                    }
                  />
                  <select
                    value={block.mode}
                    onChange={(event) =>
                      updateContent((current) => ({
                        ...current,
                        customBlocks: current.customBlocks.map((item) =>
                          item.id === block.id ? { ...item, mode: event.target.value as CustomBlock['mode'] } : item,
                        ),
                      }))
                    }
                  >
                    <option value="text">文字</option>
                    <option value="table">表格</option>
                    <option value="image">图片</option>
                  </select>
                  <button className="btn btn-ghost btn-sm" onClick={() =>
                    updateContent((current) => ({
                      ...current,
                      customBlocks: current.customBlocks.filter((item) => item.id !== block.id),
                    }))
                  }>
                    删除
                  </button>
                </div>
                {block.mode === 'text' && (
                  <ExpandableTextarea
                    collapsedRows={4}
                    expandedRows={7}
                    value={block.text}
                    onChange={(value) =>
                      updateContent((current) => ({
                        ...current,
                        customBlocks: current.customBlocks.map((item) =>
                          item.id === block.id ? { ...item, text: value } : item,
                        ),
                      }))
                    }
                  />
                )}
                {block.mode === 'table' && (
                  <CustomTableEditor
                    block={block}
                    onChange={(nextBlock) =>
                      updateContent((current) => ({
                        ...current,
                        customBlocks: current.customBlocks.map((item) => (item.id === block.id ? nextBlock : item)),
                      }))
                    }
                  />
                )}
                {block.mode === 'image' && (
                  <MediaEditor
                    items={block.media}
                    onChange={(media) =>
                      updateContent((current) => ({
                        ...current,
                        customBlocks: current.customBlocks.map((item) =>
                          item.id === block.id ? { ...item, media } : item,
                        ),
                      }))
                    }
                  />
                )}
              </div>
            ))}
          </section>
        </div>

        <div className="ov-preview">
          <div className={`ov-preview-paper ov-theme-${previewTheme}`} ref={cardRef}>
            <header className="ov-paper-header">
              <div className="ov-paper-class-code">{classCode} Week {week}</div>
            </header>

            {showWeeklyChallenges && (
              <section className="ov-paper-section">
                <div className="ov-paper-title">{previewSectionNumbers.weekly}. 本周挑战</div>
                <div className="ov-paper-week-table" style={{ gridTemplateColumns: `repeat(${weeklyChallengeRows.length}, minmax(0, 1fr))` }}>
                  {weeklyChallengeRows.map((item) => (
                    <div key={`${item.day}_preview_head`} className="ov-paper-week-head">{item.day}</div>
                  ))}
                  {weeklyChallengeRows.map((item) => (
                    <div key={`${item.day}_preview_body`} className="ov-paper-week-cell">{item.task.trim()}</div>
                  ))}
                </div>
              </section>
            )}

            {phasePreviewRows.length > 0 && (
              <section className="ov-paper-section">
                <div className="ov-paper-title">{previewSectionNumbers.phase}. 分阶段挑战</div>
                <div className="ov-paper-phase-table">
                  <div className="ov-paper-phase-head">阶段</div>
                  <div className="ov-paper-phase-head">学生名单</div>
                  <div className="ov-paper-phase-head">具体挑战内容</div>
                  <div className="ov-paper-phase-head">达成途径</div>
                  {phasePreviewRows.map((row: PhaseChallengeRow) => (
                      <Fragment key={row.id}>
                        <div key={`${row.id}_stage`} className="ov-paper-phase-stage">{row.label}</div>
                        <div key={`${row.id}_students`} className="ov-paper-phase-cell">{displayNames(row.selectedStudents)}</div>
                        <div key={`${row.id}_content`} className="ov-paper-phase-cell">{row.challengeContent.trim()}</div>
                        <div key={`${row.id}_method`} className="ov-paper-phase-cell">{row.method.trim()}</div>
                      </Fragment>
                  ))}
                </div>
              </section>
            )}

            {challengePreviewItems.length > 0 && (
              <section className="ov-paper-section">
                <div className="ov-paper-title">{previewSectionNumbers.challenges}. 本周挑战内容</div>
                <div className="ov-paper-stack">
                  {challengePreviewItems.map((item: ChallengeItem, index) => (
                      <article key={item.id} className="ov-paper-task">
                        {(item.title || item.detail) && <div className="ov-paper-task-index">挑战 {index + 1}</div>}
                        {item.title.trim() && <h4>{item.title.trim()}</h4>}
                        {item.detail.trim() && <p>{item.detail.trim()}</p>}
                        {item.media.length > 0 && (
                          <div className="ov-paper-media-grid">
                            {item.media.map((media) => (
                              <figure key={media.id} className="ov-paper-figure" style={{ width: getPaperMediaWidth(media.displayWidth) }}>
                                <img src={media.src} alt={media.name || item.title || '挑战图片'} />
                                {media.caption && <figcaption>{media.caption}</figcaption>}
                              </figure>
                            ))}
                          </div>
                        )}
                      </article>
                    ))}
                </div>
              </section>
            )}

            {listeningPreviewItems.length > 0 && (
              <section className="ov-paper-section">
                <div className="ov-paper-title">{previewSectionNumbers.listening}. 下周听读语料</div>
                <div className={`ov-paper-listening ov-paper-listening-${content.listeningFont}`}>
                  {listeningPreviewItems.map((item: ListeningMaterialItem) => (
                      <div key={item.id} className="ov-paper-listening-row">
                        <span className="ov-paper-word">{item.english.trim()}</span>
                        <span className="ov-paper-meaning">{item.chinese.trim()}</span>
                      </div>
                  ))}
                </div>
              </section>
            )}

            {showCommunicationSection && (
              <section className="ov-paper-section">
                <div className="ov-paper-title">{previewSectionNumbers.communication}. 交流名单</div>
                <div className="ov-paper-comm-groups">
                  {previewCommunicationGroups.map((group, index) => (
                    <article key={group.id} className="ov-paper-comm-group">
                      <div className="ov-paper-comm-meta">
                        <span>{group.label || `第 ${index + 1} 组`}</span>
                        {group.teacherName && <span>交流人：{group.teacherName}</span>}
                        {(group.scheduleText || group.locationText) && <span>时间地点：{[group.scheduleText, group.locationText].filter(Boolean).join(' · ')}</span>}
                      </div>
                      {group.selectedStudents.length > 0 && (
                        <div className="ov-paper-comm-students">{displayNames(group.selectedStudents)}</div>
                      )}
                      {group.note && <p className="ov-paper-comm-note">{group.note}</p>}
                    </article>
                  ))}
                </div>
              </section>
            )}

            {visibleCustomBlocks.map((block, index) => (
              <section key={block.id} className="ov-paper-section">
                <div className="ov-paper-title">{previewSectionNumbers.customStart + index + 1}. {block.title.trim() || '补充内容'}</div>
                {block.mode === 'text' && <p className="ov-paper-paragraph">{block.text.trim() || '暂无内容'}</p>}
                {block.mode === 'table' && (
                  <div className="ov-paper-custom-table" style={{ gridTemplateColumns: `repeat(${block.table.columns.length}, minmax(0, 1fr))` }}>
                    {block.table.columns.map((column, index) => (
                      <div key={`column_${index}`} className="ov-paper-custom-head">{column}</div>
                    ))}
                    {block.table.rows.flatMap((row, rowIndex) =>
                      row.map((cell, cellIndex) => (
                        <div key={`${rowIndex}_${cellIndex}`} className="ov-paper-custom-cell">{cell || ' '}</div>
                      )),
                    )}
                  </div>
                )}
                {block.mode === 'image' && (
                  <div className="ov-paper-media-grid">
                    {block.media.map((media) => (
                      <figure key={media.id} className="ov-paper-figure" style={{ width: getPaperMediaWidth(media.displayWidth) }}>
                        <img src={media.src} alt={media.name || block.title} />
                        {media.caption && <figcaption>{media.caption}</figcaption>}
                      </figure>
                    ))}
                    {block.media.length === 0 && <div className="ov-paper-empty">暂无图片</div>}
                  </div>
                )}
              </section>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
