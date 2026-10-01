import { useEffect, useMemo, useState } from 'react';
import type { ClassInfo, StudentInfo } from '../types';
import type {
  CommunicationGroup,
  CommunicationPlan,
  CommunicationPlanEntry,
  CommunicationPlanMode,
  CommunicationPlanStatus,
  CommunicationSlotType,
  SavedCommunicationPlan,
  PhaseChallengeRow,
} from '../types/overview';
import {
  createEmptyContent,
  listSavedCommunicationPlans,
  loadDraft,
  loadOverviewRoster,
  normalizeCommunicationPlan,
  rememberReusableContent,
  saveCommunicationPlanPreset,
  saveDraft,
} from '../utils/overviewData';
import { getResolvedStudents, sortStudentNames } from '../utils/classProfiles';
import { getCurrentWeek } from '../utils/weekNumber';
import { getOrderedChallengeDays } from '../utils/classSchedule';
import { formatDisplayName, formatDisplayNames } from '../services/overviewContentRules';
import './OverviewApp.css';

interface Props {
  classInfo: ClassInfo;
  classes?: ClassInfo[];
  onBack: () => void;
  onBackToHome?: () => void;
  onSwitchClass?: (name: string) => void;
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

function getOverviewStudents(classCode: string): StudentInfo[] {
  const localRoster = loadOverviewRoster(classCode);
  return localRoster?.length ? localRoster : getResolvedStudents(classCode);
}

function getSlotLabel(slotType: CommunicationSlotType): string {
  return COMMUNICATION_SLOT_OPTIONS.find((item) => item.value === slotType)?.label ?? '未选时段';
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
    slotType: group.slotType || 'weekday_after',
    locationText: group.locationText || '教室',
    selectedStudents: sortStudentNames(group.selectedStudents),
  }));
}

function syncCommunicationPlan(
  groups: CommunicationGroup[],
  base?: CommunicationPlan,
): CommunicationPlan {
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

function StudentPicker({
  studentNames,
  selected,
  onToggle,
  nameMap,
}: {
  studentNames: string[];
  selected: string[];
  onToggle: (name: string) => void;
  nameMap?: Map<string, string>;
}) {
  if (studentNames.length === 0) {
    return <p className="ov-empty-hint">当前班级还没有导入学生名单。</p>;
  }

  const sorted = [...studentNames].sort((a, b) => (nameMap?.get(a) || a).localeCompare(nameMap?.get(b) || b, 'en', { sensitivity: 'base' }));

  return (
    <div className="ov-student-grid">
      {sorted.map((name) => (
        <label key={name} className={`ov-student-chip${selected.includes(name) ? ' active' : ''}`}>
          <input type="checkbox" checked={selected.includes(name)} onChange={() => onToggle(name)} />
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
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  collapsedRows?: number;
  expandedRows?: number;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`ov-expandable-field${expanded ? ' is-expanded' : ''}`}>
      <textarea
        rows={expanded ? expandedRows : collapsedRows}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
      <button type="button" className="btn btn-ghost btn-sm ov-expand-toggle" onClick={() => setExpanded((current) => !current)}>
        {expanded ? '收起长输入' : '展开长输入'}
      </button>
    </div>
  );
}

export default function CommunicationPlannerApp({ classInfo, classes, onBack, onBackToHome, onSwitchClass }: Props) {
  const classCode = classInfo.name;
  const orderedDays = useMemo(() => getOrderedChallengeDays(classCode), [classCode]);
  const [week] = useState(() => getCurrentWeek());
  const [resolvedStudents, setResolvedStudents] = useState<StudentInfo[]>(() => getOverviewStudents(classCode));
  const [studentNames, setStudentNames] = useState<string[]>(() => sortStudentNames(getOverviewStudents(classCode).map((student) => student.chineseName)));
  const [content, setContent] = useState(() =>
    loadDraft(classCode, week) ?? createEmptyContent(classCode, week, { orderedDays, studentNames: sortStudentNames(getOverviewStudents(classCode).map((student) => student.chineseName)) }),
  );
  const [notice, setNotice] = useState('');
  const [collapsedPickers, setCollapsedPickers] = useState<Record<string, boolean>>({});
  const [savedPlans, setSavedPlans] = useState<SavedCommunicationPlan[]>(() => listSavedCommunicationPlans(classCode));

  const englishNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const student of resolvedStudents) {
      if (student.englishName) map.set(student.chineseName, student.englishName);
    }
    return map;
  }, [resolvedStudents]);

  const communicationPlan = useMemo(
    () => normalizeCommunicationPlan(content.communicationPlan) as NormalizedCommunicationPlan,
    [content.communicationPlan],
  );

  const currentCycleWeek = getCycleWeek(week, communicationPlan.cycleWeeks);
  const currentGroups = communicationPlan.groups.length > 0 ? communicationPlan.groups : [createCommunicationGroup()];

  useEffect(() => {
    const nextStudents = getOverviewStudents(classCode);
    const nextNames = sortStudentNames(nextStudents.map((student) => student.chineseName));
    setResolvedStudents(nextStudents);
    setStudentNames(nextNames);
    setSavedPlans(listSavedCommunicationPlans(classCode));
    setCollapsedPickers({});
    const draft = loadDraft(classCode, week);
    setContent(draft ?? createEmptyContent(classCode, week, { orderedDays, studentNames: nextNames }));
  }, [classCode, orderedDays, week]);

  useEffect(() => {
    const timer = setTimeout(() => {
      saveDraft(content);
      rememberReusableContent(content, studentNames);
    }, 300);
    return () => clearTimeout(timer);
  }, [content, studentNames]);

  function displayName(chineseName: string): string {
    return formatDisplayName(chineseName, englishNameMap);
  }

  function displayNames(chineseNames: string[]): string {
    return formatDisplayNames(chineseNames, englishNameMap);
  }

  function updateContent(updater: (current: typeof content) => typeof content) {
    setContent((current) => ({
      ...updater(current),
      communicationPlan: normalizeCommunicationPlan(updater(current).communicationPlan),
    }));
  }

  function togglePicker(groupId: string) {
    setCollapsedPickers((current) => ({ ...current, [groupId]: !(current[groupId] ?? true) }));
  }

  function isPickerCollapsed(groupId: string): boolean {
    return collapsedPickers[groupId] ?? true;
  }

  function getOrderedStudentsForMode(mode: CommunicationPlanMode): string[] {
    if (mode === 'alphabet') {
      return [...studentNames].sort((a, b) => displayName(a).localeCompare(displayName(b), 'en', { sensitivity: 'base' }));
    }

    if (mode === 'phase') {
      const order: PhaseChallengeRow['key'][] = ['夯实基础', '维稳达标', '突破拔高'];
      const seen = new Set<string>();
      const ordered: string[] = [];
      for (const key of order) {
        const row = content.phaseChallenges.find((item) => item.key === key);
        const names = [...(row?.selectedStudents || [])].sort((a, b) => displayName(a).localeCompare(displayName(b), 'en', { sensitivity: 'base' }));
        for (const name of names) {
          if (!seen.has(name)) {
            seen.add(name);
            ordered.push(name);
          }
        }
      }
      return [...ordered, ...studentNames.filter((name) => !seen.has(name)).sort((a, b) => displayName(a).localeCompare(displayName(b), 'en', { sensitivity: 'base' }))];
    }

    return [];
  }

  function buildPlanEntries(): CommunicationPlanEntry[] {
    const plan = communicationPlan;

    if (plan.mode === 'manual') {
      const manualEntries = currentGroups
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
        setNotice('手工排布模式下，请先在当前周下面补好分组。');
        return [];
      }
      return [...plan.entries.filter((entry) => entry.weekIndex !== currentCycleWeek), ...manualEntries];
    }

    const orderedStudents = getOrderedStudentsForMode(plan.mode);
    if (orderedStudents.length === 0) {
      setNotice(plan.mode === 'phase' ? '分层名单还没有学生，暂时无法按分层粗排。' : '当前还没有可安排的学生。');
      return [];
    }

    const slots: CommunicationSlotType[] = plan.availableSlots.length > 0 ? plan.availableSlots : ['weekday_after'];
    const size = Math.max(1, plan.suggestedGroupSize || 2);
    const chunks: string[][] = [];
    for (let index = 0; index < orderedStudents.length; index += size) {
      chunks.push(orderedStudents.slice(index, index + size));
    }

    const positions = Math.max(1, plan.cycleWeeks) * slots.length;
    return chunks.map((students, index) => {
      const positionIndex = index % positions;
      const weekIndex = Math.floor(positionIndex / slots.length) + 1;
      const slotType = slots[positionIndex % slots.length];
      const slotLabel = getSlotLabel(slotType);
      return {
        id: `plan_entry_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 6)}`,
        label: `第${weekIndex}周 ${slotLabel}`,
        weekIndex,
        slotType,
        selectedStudents: students,
        teacherName: plan.defaultTeacherName,
        locationText: plan.defaultLocationText,
        scheduleText: slotLabel,
        note: '',
      };
    });
  }

  function generatePlan() {
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
    setNotice(`已生成 ${entries.length} 条交流计划草案。回到概览后可同步本周。`);
  }

  function savePlan() {
    const saved = saveCommunicationPlanPreset(classCode, communicationPlan);
    setSavedPlans(listSavedCommunicationPlans(classCode));
    setNotice(`已保存到本地历史：${saved.roundLabel} · ${saved.planName}`);
  }

  function restorePlan(plan: SavedCommunicationPlan) {
    const cycleWeek = getCycleWeek(week, plan.cycleWeeks);
    const groups = plan.entries
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
        ...plan,
        groups: groups.length > 0 ? groups : [createCommunicationGroup({ locationText: plan.defaultLocationText || '教室' })],
      }),
    }));
    setNotice(`已载入 ${plan.roundLabel} · ${plan.planName}。`);
  }

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
          <button className="tool-back-btn" onClick={onBack}>← 返回概览</button>
        </div>
        <div className="ov-toolbar-center">
          <strong>{classCode} · 交流名单制定</strong>
          <span>先在这里干净地排好一轮，再回概览同步本周</span>
        </div>
        <div className="ov-toolbar-actions">
          {classes && classes.length > 1 && onSwitchClass ? (
            <select value={classInfo.name} onChange={(event) => onSwitchClass(event.target.value)}>
              {classes.map((item) => (
                <option key={item.id} value={item.name}>{item.name}</option>
              ))}
            </select>
          ) : null}
        </div>
      </div>

      {notice && <div className="ov-notice">{notice}</div>}

      <div className="ov-editor card">
        <section className="ov-editor-section">
          <div className="ov-section-head">
            <h3>交流名单制定</h3>
            <p>这里是独立制定页。概览只负责入口和本周同步结果。</p>
          </div>

          <div className="ov-plan-panel">
            <div className="ov-plan-grid">
              <input className="input-field" placeholder="计划名称" value={communicationPlan.planName} onChange={(event) => updateContent((current) => ({
                ...current,
                communicationPlan: normalizeCommunicationPlan({ ...current.communicationPlan, planName: event.target.value }),
              }))} />
              <input className="input-field" placeholder="轮次名称" value={communicationPlan.roundLabel} onChange={(event) => updateContent((current) => ({
                ...current,
                communicationPlan: normalizeCommunicationPlan({ ...current.communicationPlan, roundLabel: event.target.value }),
              }))} />
              <select value={communicationPlan.status} onChange={(event) => updateContent((current) => ({
                ...current,
                communicationPlan: normalizeCommunicationPlan({ ...current.communicationPlan, status: event.target.value as CommunicationPlanStatus }),
              }))}>
                {COMMUNICATION_STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              <input className="input-field" type="number" min={1} max={12} value={communicationPlan.cycleWeeks} onChange={(event) => updateContent((current) => ({
                ...current,
                communicationPlan: normalizeCommunicationPlan({ ...current.communicationPlan, cycleWeeks: Number(event.target.value || 1) }),
              }))} />
              <input className="input-field" type="date" value={communicationPlan.deadlineDate} onChange={(event) => updateContent((current) => ({
                ...current,
                communicationPlan: normalizeCommunicationPlan({ ...current.communicationPlan, deadlineDate: event.target.value }),
              }))} />
              <select value={communicationPlan.mode} onChange={(event) => updateContent((current) => ({
                ...current,
                communicationPlan: normalizeCommunicationPlan({ ...current.communicationPlan, mode: event.target.value as CommunicationPlanMode }),
              }))}>
                {COMMUNICATION_MODE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              <input className="input-field" type="number" min={1} max={8} value={communicationPlan.suggestedGroupSize} onChange={(event) => updateContent((current) => ({
                ...current,
                communicationPlan: normalizeCommunicationPlan({ ...current.communicationPlan, suggestedGroupSize: Number(event.target.value || 1) }),
              }))} />
              <input className="input-field" placeholder="默认交流老师（选填）" value={communicationPlan.defaultTeacherName} onChange={(event) => updateContent((current) => ({
                ...current,
                communicationPlan: normalizeCommunicationPlan({ ...current.communicationPlan, defaultTeacherName: event.target.value }),
              }))} />
              <input className="input-field" placeholder="默认地点" value={communicationPlan.defaultLocationText} onChange={(event) => updateContent((current) => ({
                ...current,
                communicationPlan: normalizeCommunicationPlan({ ...current.communicationPlan, defaultLocationText: event.target.value }),
              }))} />
            </div>

            <div className="ov-slot-selector">
              {COMMUNICATION_SLOT_OPTIONS.map((option) => {
                const checked = communicationPlan.availableSlots.includes(option.value);
                return (
                  <label key={option.value} className={`ov-slot-chip${checked ? ' is-active' : ''}`}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        updateContent((current) => {
                          const currentSlots = current.communicationPlan.availableSlots || [];
                          const nextSlots = checked
                            ? currentSlots.filter((slot) => slot !== option.value)
                            : [...currentSlots, option.value];
                          return {
                            ...current,
                            communicationPlan: normalizeCommunicationPlan({ ...current.communicationPlan, availableSlots: nextSlots }),
                          };
                        })
                      }
                    />
                    <span>{option.label}</span>
                  </label>
                );
              })}
            </div>

            <div className="ov-inline-actions ov-inline-actions-start">
              <button className="btn btn-primary btn-sm" onClick={generatePlan}>生成本轮草案</button>
              <button className="btn btn-ghost btn-sm" onClick={savePlan}>保存到本地历史</button>
            </div>
          </div>

          <div className="ov-plan-generated">
            <div className="ov-plan-generated-head">
              <strong>本轮计划草案</strong>
              <span>{communicationPlan.entries.length > 0 ? `共 ${communicationPlan.entries.length} 条` : '还没有草案'}</span>
            </div>
            {communicationPlan.entries.length > 0 ? (
              <div className="ov-plan-entry-list">
                {communicationPlan.entries.map((entry) => (
                  <div key={entry.id} className={`ov-plan-entry-card${entry.weekIndex === currentCycleWeek ? ' is-current' : ''}`}>
                    <strong>{entry.label}</strong>
                    <span>第 {entry.weekIndex} 周 · {getSlotLabel(entry.slotType)}</span>
                    <span>{displayNames(entry.selectedStudents)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="ov-empty-hint">先在上面定参数，再生成一轮交流草案。</p>
            )}
          </div>
        </section>

        <section className="ov-editor-section">
          <div className="ov-section-head">
            <h3>当前周手工调整</h3>
            <p>这里只用于手工排本周，或手工模式下把当前周写进计划；真正同步请回概览操作。</p>
          </div>
          <div className="ov-inline-actions ov-inline-actions-start">
            <button className="btn btn-ghost btn-sm" onClick={() => updateContent((current) => ({
              ...current,
              communicationPlan: syncCommunicationPlan([
                ...current.communicationPlan.groups,
                createCommunicationGroup({
                  label: `第${currentGroups.length + 1}组`,
                  teacherName: communicationPlan.defaultTeacherName,
                  locationText: communicationPlan.defaultLocationText || '教室',
                }),
              ], current.communicationPlan),
            }))}>+ 增加一组</button>
          </div>
          <div className="ov-comm-group-list">
            {currentGroups.map((group, index) => (
              <section key={group.id} className="ov-comm-group-card ov-record-card">
                <div className="ov-record-card-head">
                  <span className="ov-record-index">{group.label || `第${index + 1}组`}</span>
                  <button className="btn btn-ghost btn-sm" onClick={() => togglePicker(group.id)}>
                    {isPickerCollapsed(group.id) ? '展开选人' : '收起选人'}
                  </button>
                </div>
                <div className="ov-comm-meta-grid">
                  <select value={group.slotType || 'weekday_after'} onChange={(event) => updateContent((current) => ({
                    ...current,
                    communicationPlan: syncCommunicationPlan(
                      current.communicationPlan.groups.map((item) => item.id === group.id ? { ...item, slotType: event.target.value as CommunicationSlotType } : item),
                      current.communicationPlan,
                    ),
                  }))}>
                    {COMMUNICATION_SLOT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                  <input className="input-field" placeholder="交流老师（选填）" value={group.teacherName} onChange={(event) => updateContent((current) => ({
                    ...current,
                    communicationPlan: syncCommunicationPlan(
                      current.communicationPlan.groups.map((item) => item.id === group.id ? { ...item, teacherName: event.target.value } : item),
                      current.communicationPlan,
                    ),
                  }))} />
                  <input className="input-field" placeholder="交流地点" value={group.locationText || ''} onChange={(event) => updateContent((current) => ({
                    ...current,
                    communicationPlan: syncCommunicationPlan(
                      current.communicationPlan.groups.map((item) => item.id === group.id ? { ...item, locationText: event.target.value } : item),
                      current.communicationPlan,
                    ),
                  }))} />
                  <input className="input-field" placeholder="周几 / 课前课后 / 备注" value={group.scheduleText} onChange={(event) => updateContent((current) => ({
                    ...current,
                    communicationPlan: syncCommunicationPlan(
                      current.communicationPlan.groups.map((item) => item.id === group.id ? { ...item, scheduleText: event.target.value } : item),
                      current.communicationPlan,
                    ),
                  }))} />
                </div>
                <div className="ov-comm-inline-summary">
                  <span>{group.selectedStudents.length > 0 ? displayNames(group.selectedStudents) : '先写时间地点，再按需展开选人。'}</span>
                </div>
                {!isPickerCollapsed(group.id) && (
                  <StudentPicker
                    studentNames={studentNames}
                    selected={group.selectedStudents}
                    onToggle={(name) =>
                      updateContent((current) => ({
                        ...current,
                        communicationPlan: syncCommunicationPlan(
                          current.communicationPlan.groups.map((item) =>
                            item.id === group.id
                              ? { ...item, selectedStudents: sortStudentNames(item.selectedStudents.includes(name) ? item.selectedStudents.filter((student) => student !== name) : [...item.selectedStudents, name]) }
                              : item,
                          ),
                          current.communicationPlan,
                        ),
                      }))
                    }
                    nameMap={englishNameMap}
                  />
                )}
                <ExpandableTextarea
                  value={group.note}
                  placeholder="交流补充说明（默认收起，写长说明时再展开）"
                  onChange={(value) => updateContent((current) => ({
                    ...current,
                    communicationPlan: syncCommunicationPlan(
                      current.communicationPlan.groups.map((item) => item.id === group.id ? { ...item, note: value } : item),
                      current.communicationPlan,
                    ),
                  }))}
                />
              </section>
            ))}
          </div>
        </section>

        <section className="ov-editor-section">
          <div className="ov-section-head">
            <h3>本地计划历史</h3>
            <p>这里只放计划复用，不把历史堆回概览页。</p>
          </div>
          {savedPlans.length > 0 ? (
            <div className="ov-plan-history-list">
              {savedPlans.slice(0, 8).map((plan) => (
                <button key={plan.id} className="ov-history-card" onClick={() => restorePlan(plan)}>
                  <strong>{plan.roundLabel} · {plan.planName}</strong>
                  <span>{COMMUNICATION_STATUS_OPTIONS.find((item) => item.value === plan.status)?.label || '草稿'} · {plan.cycleWeeks} 周</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="ov-empty-hint">还没有保存过本地计划。</p>
          )}
        </section>
      </div>
    </div>
  );
}
