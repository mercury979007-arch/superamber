import { useState, useRef, useEffect } from 'react';
import type { ClassInfo, Module, StudentData, MPBreakdown, SchemeId, BonusItem, SavedCustomScheme, SchemeSettings, StudentRecord } from '../types';
import { calculateMP, SCHEMES } from '../utils/calculateMP';
import { getCurrentWeek } from '../utils/weekNumber';
import { loadSavedSchemes, saveScheme, deleteScheme } from '../utils/customScheme';
import { saveBonusRecord, getBonusNames, getLastAmount, getHistoryForBonus } from '../utils/bonusHistory';
import {
  buildQuickTemplateRows,
  loadQuickRoster,
  mergeQuickDraftRewards,
  parseQuickChineseRewardText,
  parseQuickEnglishRewardText,
  QuickInputMode,
  QuickDraftReward,
  saveQuickRoster,
  sortStudentList,
  StudentSortKey,
  STUDENT_SORT_OPTIONS,
  resolveQuickRewards,
} from '../services/distributionQuickFlow';
import {
  DistributionSubmitError,
  downloadDistributionFallbackExcel,
  fetchDistributionBalance,
  fetchMinipinRecoveryContext,
  fetchDistributionRoster,
  importDistributionBasicFileFromAcademicSystem,
  importDistributionDailyCheckFileFromAcademicSystem,
  resolveDistributionClassFromSession,
  submitDistributionRewards,
  submitMinipinRecovery,
} from '../services/distributionQuickApi';
import { createBonusItemDraft, describeDistributionScheme } from '../services/distributionPreviewRules';
import CustomSchemeEditor from './CustomSchemeEditor';
import ResultView from './ResultView';
import './DistributionFlow.css';

interface Props {
  classInfo: ClassInfo;
  classes?: ClassInfo[];
  onBack: () => void;
  onBackToHome?: () => void;
  onSwitchClass?: (name: string) => void;
  onSessionExpired?: () => void;
  initialTaskSelection?: {
    classId: string;
    selectedWeekIds: string[];
    snapshotUpdatedAt: string;
  } | null;
}

const ALL_MODULES: Module[] = ['基础落实', '每日开口', '课堂参与', '个性化奖励'];

const MODULE_DESC: Record<Module, string> = {
  基础落实: '基于官网下载的学生个人数据表',
  每日开口: '基于打卡情况表，按天数发放',
  课堂参与: '默认发放 + 手动调整PK获胜者',
  个性化奖励: '老师自定义挑战与金额',
};

const MODULE_REQUIRED: Record<Module, boolean> = {
  基础落实: true,
  每日开口: false,
  课堂参与: false,
  个性化奖励: false,
};

type EntryMode = 'standard' | 'quick';
export default function DistributionFlow({ classInfo, classes, onBack, onBackToHome, onSwitchClass, onSessionExpired, initialTaskSelection = null }: Props) {
  const isManual = classInfo.id === 'manual';
  const [manualCode, setManualCode] = useState('');
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [entryMode, setEntryMode] = useState<EntryMode>('standard');
  const [selectedModules, setSelectedModules] = useState<Set<Module>>(new Set(['基础落实']));
  const [basicFile, setBasicFile] = useState<File | null>(null);
  const [dailyFile, setDailyFile] = useState<File | null>(null);
  const [students, setStudents] = useState<StudentData[]>([]);
  const [scheme, setScheme] = useState<SchemeId>('scheme1');
  const [customSchemeData, setCustomSchemeData] = useState<SavedCustomScheme | undefined>();
  const [dailyRate, setDailyRate] = useState(0.1);
  const [schemeSettings, setSchemeSettings] = useState<SchemeSettings>({ scheme2AllDoneAmount: 0.5 });
  const [defaultParticipation, setDefaultParticipation] = useState(0.2);
  const [bonusItems, setBonusItems] = useState<BonusItem[]>([]);
  const [mpResults, setMpResults] = useState<MPBreakdown[]>([]);
  const [loading, setLoading] = useState(false);
  const [autoImporting, setAutoImporting] = useState<'basic' | 'daily' | null>(null);
  const [error, setError] = useState('');
  const [studentSortKey, setStudentSortKey] = useState<StudentSortKey>('en_asc');
  const taskLaunchStarted = useRef(false);
  const week = getCurrentWeek();
  const displayCode = isManual ? (manualCode || '手动输入') : classInfo.name;

  useEffect(() => {
    if (taskLaunchStarted.current || !initialTaskSelection?.selectedWeekIds?.length) return;
    if (initialTaskSelection.classId !== String(classInfo.name || '').toUpperCase()) return;
    taskLaunchStarted.current = true;
    setEntryMode('standard');
    setSelectedModules(new Set(['基础落实']));
    setScheme('scheme2');
    setSchemeSettings({ scheme2AllDoneAmount: 0.5 });
    setStep(2);
    setError('');
    setAutoImporting('basic');
    void importDistributionBasicFileFromAcademicSystem({
      classId: classInfo.name,
      className: classInfo.name,
      selectedWeekIds: initialTaskSelection.selectedWeekIds,
      taskSnapshotUpdatedAt: initialTaskSelection.snapshotUpdatedAt,
    }).then(async (file) => {
      setBasicFile(file);
      const { parseBasicFile } = await import('../utils/parseExcel');
      const parsed = await parseBasicFile(file);
      const preparedStudents = parsed.students.map((student) => ({
        ...student,
        classParticipation: defaultParticipation,
        bonusItems: [],
      }));
      saveQuickRoster(parsed.classCode || classInfo.name, preparedStudents);
      setStudents(preparedStudents);
      setStep(3);
    }).catch((nextError) => {
      setError(nextError instanceof Error ? nextError.message : '所选日报挑战导入失败');
      setStep(2);
    }).finally(() => {
      setAutoImporting(null);
    });
  }, [classInfo.name, defaultParticipation, initialTaskSelection]);

  function toggleModule(m: Module) {
    if (MODULE_REQUIRED[m]) return;
    setSelectedModules((prev) => {
      const next = new Set(prev);
      next.has(m) ? next.delete(m) : next.add(m);
      return next;
    });
  }

  async function handleLoadFiles() {
    if (!basicFile) { setError('请上传基础落实文件'); return; }
    setError('');
    setLoading(true);
    try {
      const { parseBasicFile, parseDailyCheckFile } = await import('../utils/parseExcel');
      const parsed = await parseBasicFile(basicFile);
      let stud = parsed.students;

      if (selectedModules.has('每日开口') && dailyFile) {
        stud = await parseDailyCheckFile(dailyFile, stud);
      }

      stud = stud.map((s) => ({
        ...s,
        classParticipation: defaultParticipation,
        bonusItems: [],
      }));

      saveQuickRoster(parsed.classCode || classInfo.name || manualCode, stud);
      setStudents(stud);
      setStep(3);
    } catch (err) {
      setError(`解析文件失败: ${err instanceof Error ? err.message : err}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleAutoImport(kind: 'basic' | 'daily') {
    const classId = String(displayCode || '').trim();
    if (!classId || classId === '手动输入') {
      setError('请先填写班级号，再使用教务系统导入。');
      return;
    }

    setError('');
    setAutoImporting(kind);
    try {
      const file = kind === 'basic'
        ? await importDistributionBasicFileFromAcademicSystem({
            classId,
            className: displayCode,
          })
        : await importDistributionDailyCheckFileFromAcademicSystem({
            classId,
            className: displayCode,
          });

      if (kind === 'basic') {
        setBasicFile(file);
      } else {
        setDailyFile(file);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '教务系统导入失败');
    } finally {
      setAutoImporting(null);
    }
  }

  function applyResults() {
    const studWithBonus = students.map((s) => ({
      ...s,
      bonusItems: bonusItems.filter((b) => b.studentIds.includes(s.studentId)),
    }));
    const results = calculateMP(
      studWithBonus,
      scheme,
      dailyRate,
      selectedModules,
      customSchemeData,
      schemeSettings
    );
    bonusItems.forEach((b) => {
      const names = students
        .filter((s) => b.studentIds.includes(s.studentId))
        .map((s) => s.englishName);
      saveBonusRecord(b.name, displayCode, week, names, b.amount);
    });
    setMpResults(results);
    setStep(4);
  }

  const STEPS = entryMode === 'quick'
    ? [
        { n: 1, label: '选择方式' },
        { n: 2, label: '快捷生成' },
      ]
    : [
        { n: 1, label: '选择方式' },
        { n: 2, label: '上传文件' },
        { n: 3, label: '确认明细' },
        { n: 4, label: '生成输出' },
      ];

  return (
    <div className="flow-wrap fade-in">
      {onBackToHome && (
        <button className="tool-home-rail" onClick={onBackToHome}>
          <span className="tool-home-rail-icon">←</span>
          <span>返回主页</span>
        </button>
      )}
      <div className="tool-topbar flow-topbar">
        <button className="tool-back-btn" onClick={onBack}>← 返回</button>
        {isManual ? (
          <input
            className="flow-class-input"
            type="text"
            placeholder="输入班级号"
            value={manualCode}
            onChange={(e) => setManualCode(e.target.value)}
          />
        ) : classes && classes.length > 1 && onSwitchClass ? (
          <select className="tool-class-switch" value={classInfo.name} onChange={(e) => onSwitchClass(e.target.value)}>
            {classes.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
          </select>
        ) : (
          <span className="flow-class-code">{classInfo.name}</span>
        )}
        <span className="tool-topbar-label">Week {week}</span>
      </div>

      <div className="step-indicator">
        {STEPS.map((s, i) => (
          <div key={s.n} className="step-item">
            <div className={`step-dot ${step === s.n ? 'active' : step > s.n ? 'done' : ''}`}>
              {step > s.n ? '✓' : s.n}
            </div>
            <span className={`step-label ${step === s.n ? 'active' : ''}`}>{s.label}</span>
            {i < STEPS.length - 1 && <div className={`step-line ${step > s.n ? 'done' : ''}`} />}
          </div>
        ))}
      </div>

      {error && <div className="flow-error">{error}</div>}

      {initialTaskSelection?.selectedWeekIds?.length && (
        <div className="flow-task-selection-note">
          已从首页班级日报带入 {initialTaskSelection.selectedWeekIds.length} 个挑战列表；本页计算与首页展示使用同一选择。
        </div>
      )}

      {step === 1 && (
        <StepEntry
          mode={entryMode}
          onModeChange={setEntryMode}
          selected={selectedModules}
          onToggle={toggleModule}
          onQuickSelect={() => {
            setEntryMode('quick');
            setStep(2);
          }}
          onNext={() => setStep(2)}
        />
      )}
      {step === 2 && entryMode === 'standard' && (
        <StepUpload
          classCode={displayCode}
          modules={selectedModules}
          basicFile={basicFile}
          dailyFile={dailyFile}
          onBasicFile={setBasicFile}
          onDailyFile={setDailyFile}
          onAutoImport={handleAutoImport}
          onBack={() => setStep(1)}
          onNext={handleLoadFiles}
          loading={loading}
          autoImporting={autoImporting}
        />
      )}
      {step === 2 && entryMode === 'quick' && (
          <StepQuick
            classCode={displayCode}
            classInfo={classInfo}
            studentSortKey={studentSortKey}
            onStudentSortChange={setStudentSortKey}
            onBack={() => setStep(1)}
            onSessionExpired={onSessionExpired}
            onClassInfoUpdate={(updated) => {
              // Propagate squadId to parent so ResultView also gets it
              if (updated.squadId) classInfo.squadId = updated.squadId;
            }}
          />
      )}
      {step === 3 && (
        <StepPreview
          students={students}
          scheme={scheme}
          customSchemeData={customSchemeData}
          schemeSettings={schemeSettings}
          dailyRate={dailyRate}
          defaultParticipation={defaultParticipation}
          bonusItems={bonusItems}
          studentSortKey={studentSortKey}
          onStudentSortChange={setStudentSortKey}
          modules={selectedModules}
          onSchemeChange={(id, data) => { setScheme(id); setCustomSchemeData(data); }}
          onDailyRateChange={setDailyRate}
          onSchemeSettingsChange={(patch) =>
            setSchemeSettings((prev) => ({ ...prev, ...patch }))
          }
          onParticipationChange={(sid, val) => {
            setStudents((prev) =>
              prev.map((s) => s.studentId === sid ? { ...s, classParticipation: val } : s)
            );
          }}
          onBulkParticipation={(sids, val) => {
            setStudents((prev) =>
              prev.map((s) => sids.includes(s.studentId) ? { ...s, classParticipation: val } : s)
            );
          }}
          onDefaultParticipationChange={(val) => {
            setDefaultParticipation(val);
            setStudents((prev) => prev.map((s) => ({ ...s, classParticipation: val })));
          }}
          onAddBonus={(b) => setBonusItems((prev) => [...prev, b])}
          onRemoveBonus={(i) => setBonusItems((prev) => prev.filter((_, idx) => idx !== i))}
          classCode={displayCode}
          classInfo={classInfo}
          week={week}
          onBack={() => setStep(2)}
          onGenerate={applyResults}
        />
      )}
      {step === 4 && (
        <ResultView
          results={mpResults}
          students={students}
          bonusItems={bonusItems}
          classCode={displayCode}
          classInfo={classInfo}
          week={week}
          schemeSettings={schemeSettings}
          onBack={() => setStep(3)}
          onSessionExpired={onSessionExpired}
          taskSelection={initialTaskSelection ? {
            source: 'class-daily-report',
            selectedWeekIds: initialTaskSelection.selectedWeekIds,
            snapshotUpdatedAt: initialTaskSelection.snapshotUpdatedAt,
          } : null}
        />
      )}
    </div>
  );
}

function StepEntry({
  mode,
  onModeChange,
  selected,
  onToggle,
  onQuickSelect,
  onNext,
}: {
  mode: EntryMode;
  onModeChange: (mode: EntryMode) => void;
  selected: Set<Module>;
  onToggle: (m: Module) => void;
  onQuickSelect: () => void;
  onNext: () => void;
}) {
  return (
    <div className="step-card card">
      <h3 className="step-heading">选择生成方式</h3>
      <p className="step-sub">先决定走标准流程还是快捷流程，原来的上传和勾选逻辑仍然保留。</p>

      <div className="mode-list">
        <button
          type="button"
          className={`mode-card ${mode === 'standard' ? 'selected' : ''}`}
          onClick={() => onModeChange('standard')}
        >
          <div className="mode-card-head">
            <strong>标准生成</strong>
            <span className="tag tag-green">完整流程</span>
          </div>
          <p>上传基础落实、打卡文件，继续走后面的确认和勾选。</p>
        </button>
        <button
          type="button"
          className={`mode-card ${mode === 'quick' ? 'selected' : ''}`}
          onClick={onQuickSelect}
        >
          <div className="mode-card-head">
            <strong>快捷生成</strong>
            <span className="tag">快速入口</span>
          </div>
          <p>输入“姓名 + 数量”，直接发放或回收 MP；支持多人批量操作。</p>
        </button>
      </div>

      {mode === 'standard' && (
        <>
          <div>
            <h4 className="sub-section-title">标准流程模块</h4>
            <p className="sub-section-sub">勾选本次需要计算的项目，基础落实为必选。</p>
          </div>
          <div className="module-list">
            {ALL_MODULES.map((m) => (
              <label key={m} className={`module-item ${selected.has(m) ? 'selected' : ''} ${MODULE_REQUIRED[m] ? 'required' : ''}`}>
                <input
                  type="checkbox"
                  checked={selected.has(m)}
                  onChange={() => onToggle(m)}
                  disabled={MODULE_REQUIRED[m]}
                />
                <div className="module-info">
                  <span className="module-name">{m}</span>
                  {MODULE_REQUIRED[m] && <span className="tag tag-green" style={{ fontSize: 11, padding: '1px 7px' }}>必选</span>}
                  <p className="module-desc">{MODULE_DESC[m]}</p>
                </div>
              </label>
            ))}
          </div>
        </>
      )}

      {mode === 'standard' && (
        <div className="step-actions">
          <button className="btn btn-primary" onClick={onNext}>
            进入上传 →
          </button>
        </div>
      )}
    </div>
  );
}

function StepUpload({
  classCode,
  modules,
  basicFile,
  dailyFile,
  onBasicFile,
  onDailyFile,
  onAutoImport,
  onBack,
  onNext,
  loading,
  autoImporting,
}: {
  classCode: string;
  modules: Set<Module>;
  basicFile: File | null;
  dailyFile: File | null;
  onBasicFile: (f: File) => void;
  onDailyFile: (f: File) => void;
  onAutoImport: (kind: 'basic' | 'daily') => void;
  onBack: () => void;
  onNext: () => void;
  loading: boolean;
  autoImporting: 'basic' | 'daily' | null;
}) {
  return (
    <div className="step-card card">
      <h3 className="step-heading">上传数据文件</h3>
      <p className="step-sub">上传仍然是主入口；也可以用教务系统导出作为测试中的辅助入口。</p>

      <div className="upload-list">
        <UploadField
          label="基础落实（必须）"
          hint="文件名格式：J328_学生个人数据_*.xlsx"
          accept=".xlsx"
          file={basicFile}
          onChange={onBasicFile}
          secondaryActionLabel="教务系统导出（测试中）"
          secondaryActionLoadingLabel="导出中..."
          secondaryActionBusy={autoImporting === 'basic'}
          onSecondaryAction={() => onAutoImport('basic')}
        />
        {modules.has('每日开口') && (
          <UploadField
            label="每日开口（打卡情况）"
            hint="文件名格式：打卡情况*.xlsx"
            accept=".xlsx"
            file={dailyFile}
            onChange={onDailyFile}
            secondaryActionLabel="教务系统抓取（测试中）"
            secondaryActionLoadingLabel="抓取中..."
            secondaryActionBusy={autoImporting === 'daily'}
            onSecondaryAction={() => onAutoImport('daily')}
          />
        )}
      </div>

      <div className="quick-template-hint">
        当前班级：{classCode}。如果教务系统导入失败，直接改回上传文件即可，不影响原流程。
      </div>

      <div className="step-actions">
        <button className="btn btn-ghost" onClick={onBack}>← 上一步</button>
        <button className="btn btn-primary" onClick={onNext} disabled={loading || !!autoImporting || !basicFile}>
          {loading ? <><span className="spinner" /> 解析中...</> : '解析文件 →'}
        </button>
      </div>
    </div>
  );
}

function StepQuick({
  classCode,
  classInfo: classInfoProp,
  studentSortKey,
  onStudentSortChange,
  onBack,
  onSessionExpired,
  onClassInfoUpdate,
}: {
  classCode: string;
  classInfo: ClassInfo;
  studentSortKey: StudentSortKey;
  onStudentSortChange: (value: StudentSortKey) => void;
  onBack: () => void;
  onSessionExpired?: () => void;
  onClassInfoUpdate?: (info: ClassInfo) => void;
}) {
  // ── 登录 & 实时名单拉取 ─────────────────────────────────────────────────
  const [classInfo, setClassInfo] = useState<ClassInfo>(classInfoProp);
  const [liveRoster, setLiveRoster] = useState<StudentRecord[]>([]);
  const [loginError, setLoginError] = useState('');
  const [sessionChecking, setSessionChecking] = useState(false);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [balanceValue, setBalanceValue] = useState<number | null>(null);
  const [balanceLabel, setBalanceLabel] = useState('未查询');
  const [operation, setOperation] = useState<'issue' | 'recover'>('issue');
  const [recoveryLoading, setRecoveryLoading] = useState(false);
  const [recoveryAvailable, setRecoveryAvailable] = useState<Record<string, number>>({});
  const [recoveryReasons, setRecoveryReasons] = useState<string[]>([]);
  const [recoveryReason, setRecoveryReason] = useState('行为习惯');
  const [recoveryReadAt, setRecoveryReadAt] = useState('');
  const recoverySubmitting = useRef(false);
  const [recoveryUncertain, setRecoveryUncertain] = useState(false);
  const recoveryRequestId = useRef('');

  useEffect(() => {
    setClassInfo(classInfoProp);
  }, [classInfoProp]);

  const isLoggedIn = !!classInfo.squadId;

  useEffect(() => {
    if (classInfo.squadId) {
      fetchRoster(classInfo.squadId);
      void fetchBalance(classInfo.squadId, classInfo.name);
      return;
    }
    void restoreSharedSession();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classInfo.squadId, classInfo.name, classCode]);

  async function restoreSharedSession() {
    setSessionChecking(true);
    setLoginError('');
    try {
      const { loggedIn, matchedClass: matched } = await resolveDistributionClassFromSession(classCode);
      if (!loggedIn) {
        setLoginError('当前还没连接教务系统。先连接一次，日报和 MP 会共用这次登录态。');
        return;
      }
      if (matched) {
        setClassInfo(matched);
        onClassInfoUpdate?.(matched);
        await fetchRoster(matched.squadId!);
        void fetchBalance(matched.squadId || matched.name, matched.name);
      } else {
        setLoginError(`当前账号已连接，但未找到班级 ${classCode}，请确认账号有该班级权限。`);
      }
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : '登录态检查失败');
    } finally {
      setSessionChecking(false);
    }
  }

  async function fetchRoster(squadId: string) {
    setRosterLoading(true);
    try {
      const { expired, students } = await fetchDistributionRoster(squadId, classCode);
      if (expired) {
        setClassInfo((prev) => ({ ...prev, squadId: undefined }));
        onSessionExpired?.();
        return;
      }
      if (!students.length) return;
      setLiveRoster(students);
      if (students.length > 0) {
        saveQuickRoster(classCode, students as unknown as StudentData[]);
      }
    } catch {
      // Fall back to cached roster silently
    } finally {
      setRosterLoading(false);
    }
  }

  async function fetchBalance(classRef: string, fallbackRef?: string): Promise<number | null> {
    setBalanceLoading(true);
    try {
      const result = await fetchDistributionBalance([classRef, fallbackRef || '']);
      if (result.expired) {
        setClassInfo((prev) => ({ ...prev, squadId: undefined }));
        onSessionExpired?.();
        return null;
      }
      setBalanceValue(result.value);
      setBalanceLabel(result.label);
      return result.value;
    } catch {
      setBalanceValue(null);
      setBalanceLabel('查询失败');
      return null;
    } finally {
      setBalanceLoading(false);
    }
  }

  async function loadRecoveryContext(classRef: string) {
    setRecoveryLoading(true);
    try {
      const { expired, context } = await fetchMinipinRecoveryContext(classRef);
      if (expired) {
        setClassInfo((prev) => ({ ...prev, squadId: undefined }));
        onSessionExpired?.();
        return null;
      }
      if (!context) return null;
      setRecoveryAvailable(Object.fromEntries(context.students.map((student) => [student.no, student.availableMp])));
      setRecoveryReasons(context.tags.map((tag) => tag.name));
      setRecoveryReason((current) => context.tags.some((tag) => tag.name === current)
        ? current
        : context.defaultReason || '行为习惯');
      setRecoveryReadAt(context.readAt);
      const students = context.students.map((student) => ({
        studentId: student.no,
        chineseName: student.chName,
        englishName: student.enName,
        classCode: classCode.toUpperCase(),
      }));
      setLiveRoster(students);
      saveQuickRoster(classCode, students as unknown as StudentData[]);
      return context;
    } catch (error) {
      setQuickMessageTone('error');
      setQuickMessage(error instanceof Error ? error.message : '学生 MiniPin 余额读取失败');
      return null;
    } finally {
      setRecoveryLoading(false);
    }
  }

  // Use live roster if available, otherwise fall back to localStorage cache
  const cachedRoster = loadQuickRoster(classCode);
  const rememberedRoster = liveRoster.length > 0 ? liveRoster : cachedRoster;
  const sortedRoster = sortStudentList(rememberedRoster, studentSortKey);

  // ── 原有快捷发放逻辑 ────────────────────────────────────────────────────
  const [inputMode, setInputMode] = useState<QuickInputMode>('english');
  const [quickInput, setQuickInput] = useState('');
  const [quickMessage, setQuickMessage] = useState('');
  const [quickMessageTone, setQuickMessageTone] = useState<'info' | 'success' | 'error'>('info');
  const [draftRewards, setDraftRewards] = useState<QuickDraftReward[]>([]);
  const [selectedStudentIds, setSelectedStudentIds] = useState<Set<string>>(new Set());
  const [pickerAmount, setPickerAmount] = useState('');
  const draftTotalMP = Number(draftRewards.reduce((sum, item) => sum + item.amount, 0).toFixed(1));
  const allPickerSelected = sortedRoster.length > 0 && sortedRoster.every((student) => selectedStudentIds.has(student.studentId));

  useEffect(() => {
    if (operation === 'recover' && classInfo.squadId) void loadRecoveryContext(classInfo.squadId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operation, classInfo.squadId]);

  function switchOperation(next: 'issue' | 'recover') {
    if (recoverySubmitting.current || submitting) return;
    if (next === operation) return;
    setOperation(next);
    setDraftRewards([]);
    setSelectedStudentIds(new Set());
    setQuickInput('');
    setQuickMessageTone('info');
    setQuickMessage(next === 'recover' ? '正在读取学生实时余额和回收原因…' : '已切换到发放。');
  }

  function togglePickerStudent(studentId: string) {
    setSelectedStudentIds((prev) => {
      const next = new Set(prev);
      next.has(studentId) ? next.delete(studentId) : next.add(studentId);
      return next;
    });
  }

  function toggleAllPickerStudents() {
    if (!sortedRoster.length) return;
    setSelectedStudentIds((prev) => {
      if (sortedRoster.every((student) => prev.has(student.studentId))) {
        return new Set();
      }
      return new Set(sortedRoster.map((student) => student.studentId));
    });
  }

  function appendParsedRewards(mode: Exclude<QuickInputMode, 'picker'>) {
    if (submitting || recoverySubmitting.current) return;
    if (!rememberedRoster.length) {
      setQuickMessageTone('error');
      setQuickMessage('这个班目前还没有记住学号名单。先完整上传一次基础落实文件，后面这里就能反复直接生成。');
      return;
    }

    const parsed = mode === 'english'
      ? parseQuickEnglishRewardText(quickInput)
      : parseQuickChineseRewardText(quickInput);
    if (operation === 'recover' && parsed.some((item) => Math.abs(item.amount * 10 - Math.round(item.amount * 10)) > 1e-8)) {
      setQuickMessageTone('error');
      setQuickMessage('回收数量请按 0.1 MP 递增，例如 0.1、0.5、1。');
      return;
    }
    if (!parsed.length) {
      setQuickMessageTone('error');
      setQuickMessage(
        mode === 'english'
          ? '请输入“英文名 + 数量”，一行一个；多人请用逗号或顿号隔开，再写数量。'
          : '请输入“中文名 + 数量”；多人可同一行输入，例如：李晓彤 周子然 0.5',
      );
      return;
    }

    const { resolved, missingNames, ambiguousNames } = resolveQuickRewards(rememberedRoster, parsed, mode);
    if (!resolved.length) {
      const issues: string[] = [];
      if (missingNames.length) issues.push(`未匹配：${missingNames.join('、')}`);
      if (ambiguousNames.length) {
        issues.push(`英文重名待人工校验：${ambiguousNames.map((item) => item.name).join('、')}`);
      }
      setQuickMessageTone('error');
      setQuickMessage(issues.join('；') || '没有匹配到可用学生。');
      return;
    }

    setDraftRewards((prev) => mergeQuickDraftRewards(prev, resolved));
    setQuickInput('');

    const messages = [`已加入 ${resolved.length} 人`];
    if (missingNames.length) messages.push(`未匹配：${missingNames.join('、')}`);
    if (ambiguousNames.length) {
      messages.push(
        `英文重名待人工校验：${ambiguousNames
          .map((item) => `${item.name}（${item.matches.map((student) => student.chineseName).join(' / ')}）`)
          .join('；')}`,
      );
    }
    setQuickMessageTone(ambiguousNames.length > 0 || missingNames.length > 0 ? 'info' : 'success');
    setQuickMessage(messages.join('；'));
  }

  function appendPickerRewards() {
    if (submitting || recoverySubmitting.current) return;
    if (!rememberedRoster.length) {
      setQuickMessageTone('error');
      setQuickMessage('这个班目前还没有记住学号名单。先完整上传一次基础落实文件，后面这里就能反复直接生成。');
      return;
    }
    const amount = Number(pickerAmount);
    if (operation === 'recover' && Math.abs(amount * 10 - Math.round(amount * 10)) > 1e-8) {
      setQuickMessageTone('error');
      setQuickMessage('回收数量请按 0.1 MP 递增。');
      return;
    }
    if (!(amount > 0) || selectedStudentIds.size === 0) {
      setQuickMessageTone('error');
      setQuickMessage('先勾选学生，再填写要加的数量。');
      return;
    }

    const additions = rememberedRoster
      .filter((student) => selectedStudentIds.has(student.studentId))
      .map((student) => ({
        studentId: student.studentId,
        chineseName: student.chineseName,
        englishName: student.englishName,
        classCode: student.classCode,
        amount,
      }));

    setDraftRewards((prev) => mergeQuickDraftRewards(prev, additions));
    setSelectedStudentIds(new Set());
    setPickerAmount('');
    setQuickMessageTone('success');
    setQuickMessage(`已批量加入 ${additions.length} 人，每人 ${amount} MP。`);
  }

  function removeDraftReward(studentId: string) {
    if (submitting || recoverySubmitting.current) return;
    setDraftRewards((prev) => prev.filter((item) => item.studentId !== studentId));
  }

  function clearDraftRewards() {
    if (submitting || recoverySubmitting.current) return;
    setDraftRewards([]);
    setQuickMessageTone('info');
    setQuickMessage(`已清空待${operation === 'recover' ? '回收' : '发'}名单。`);
  }

  async function downloadQuickTemplate() {
    if (!rememberedRoster.length) {
      setQuickMessageTone('error');
      setQuickMessage('这个班目前还没有记住学号名单。先完整上传一次基础落实文件，后面这里就能反复直接生成。');
      return;
    }
    if (!draftRewards.length) {
      setQuickMessageTone('error');
      setQuickMessage('先把待发学生加入下面的列表，再生成标准模板。');
      return;
    }

    const { students, mpMap } = buildQuickTemplateRows(draftRewards);
    const { generateOutputExcel } = await import('../utils/parseExcel');
    const buffer = await generateOutputExcel(students, mpMap);
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${classCode}_快捷MP模板.xlsx`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 5000);

    setQuickMessageTone('success');
    setQuickMessage(`已生成 ${students.length} 人的标准模板。`);
  }

  const [submitting, setSubmitting] = useState(false);

  async function handleDirectSubmit() {
    if (submitting || recoverySubmitting.current || (operation === 'recover' && recoveryUncertain)) return;
    if (!classInfo.squadId) {
      setQuickMessageTone('error');
      setQuickMessage(`当前班级没有官网班级ID，暂时不能直接${operation === 'recover' ? '回收' : '发放'}。请连接教务系统后再试。`);
      return;
    }
    if (!draftRewards.length) {
      setQuickMessageTone('error');
      setQuickMessage(`先把待${operation === 'recover' ? '回收' : '发'}学生加入下面的列表。`);
      return;
    }

    const rewards = draftRewards.map((r) => ({
      studentId: r.studentId,
      studentName: r.englishName,
      chineseName: r.chineseName,
      aliases: [r.englishName, r.chineseName].filter(Boolean),
      amount: r.amount,
    }));

    const totalMP = rewards.reduce((sum, r) => sum + r.amount, 0);
    if (operation === 'recover') {
      recoverySubmitting.current = true;
      setSubmitting(true);
      try {
      const context = await loadRecoveryContext(classInfo.squadId);
      if (!context) return;
      const liveBalance = new Map(context.students.map((student) => [student.no, student.availableMp]));
      const invalid = rewards.find((reward) => (
        !liveBalance.has(reward.studentId)
        || Number(liveBalance.get(reward.studentId)) < reward.amount
      ));
      if (invalid) {
        setQuickMessageTone('error');
        setQuickMessage(`${invalid.studentName || invalid.chineseName} 当前可回收 ${liveBalance.get(invalid.studentId) ?? 0} MP，不足 ${invalid.amount} MP；整批未提交。`);
        return;
      }
      const ok = window.confirm(
        `确认回收：${rewards.length} 名学生，共 ${parseFloat(totalMP.toFixed(1))} MP\n原因：${recoveryReason}\n\n提交前已重新读取实时余额。回收后不可在这里自动撤销，是否继续？`
      );
      if (!ok) return;
      recoveryRequestId.current ||= crypto.randomUUID();
      setSubmitting(true);
      setQuickMessageTone('info');
      setQuickMessage('正在一次性提交批量回收…');
      try {
        const { expired, data } = await submitMinipinRecovery({
          requestId: recoveryRequestId.current,
          squadId: classInfo.squadId,
          className: classInfo.name,
          reason: recoveryReason,
          recoveries: rewards.map((reward) => ({ studentId: reward.studentId, amount: reward.amount })),
        });
        if (expired) {
          onSessionExpired?.();
          setQuickMessageTone('error');
          setQuickMessage('会话已过期，请重新登录后再试');
          return;
        }
        setDraftRewards([]);
        recoveryRequestId.current = '';
        setQuickMessageTone('success');
        setQuickMessage(`回收成功：${data.success ?? rewards.length} 人，共 ${data.totalMP ?? totalMP} MP；原因：${data.reason || recoveryReason}。`);
        void loadRecoveryContext(classInfo.squadId);
      } catch (error) {
        setRecoveryUncertain(true);
        setQuickMessageTone('error');
        setQuickMessage(error instanceof Error ? error.message : '回收失败；名单已保留，请先核对再决定是否重试');
      } finally {
        setSubmitting(false);
      }
      } finally {
        recoverySubmitting.current = false;
        setSubmitting(false);
      }
      return;
    }
    const ok = window.confirm(
      `确认发放：${rewards.length} 名学生，共 ${parseFloat(totalMP.toFixed(1))} MP\n\n系统将直接提交到教务后台，是否继续？`
    );
    if (!ok) return;

    setSubmitting(true);
    setQuickMessageTone('info');
    setQuickMessage('正在提交到教务系统...');
    const balanceBefore = balanceValue;
    try {
      const { expired, data } = await submitDistributionRewards({
        squadId: classInfo.squadId,
        className: classInfo.name,
        rewards,
      });
      if (expired) {
        onSessionExpired?.();
        setQuickMessageTone('error');
        setQuickMessage('会话已过期，请重新登录后再试');
        return;
      }
      const parts = [`已成功发放 ${data.success ?? 0} 人`];
      if (data.totalMP) parts.push(`共 ${data.totalMP} MP`);
      if (data.failed > 0) parts.push(`${data.failed} 人失败`);
      const failedStudentIds = Array.isArray(data.failedStudentIds)
        ? data.failedStudentIds.map((item: unknown) => String(item))
        : [];
      const failedRewards = failedStudentIds.length > 0
        ? draftRewards.filter((reward) => failedStudentIds.includes(reward.studentId))
        : [];
      if (failedRewards.length > 0) {
        const downloaded = await downloadDistributionFallbackExcel({
          rewards: failedRewards.map((reward) => ({
            studentId: reward.studentId,
            studentName: reward.englishName,
            chineseName: reward.chineseName,
            aliases: [reward.englishName, reward.chineseName].filter(Boolean),
            amount: reward.amount,
          })),
          classCode,
          fileName: `${classCode}_MP发放失败兜底.xlsx`,
        });
        setQuickMessageTone('error');
        setQuickMessage(`本次发放部分失败。${parts.join('，')}。已自动下载 ${downloaded} 人的兜底 Excel。`);
        setDraftRewards(failedRewards);
      } else {
        setQuickMessageTone('success');
        setQuickMessage(`本次发放成功。${parts.join('，')}。`);
        setDraftRewards([]);
      }
      void fetchBalance(classInfo.squadId, classInfo.name).then((balanceAfter) => {
        if (typeof balanceBefore === 'number' && typeof balanceAfter === 'number') {
          const balanceMessage = `班内余额 ${balanceBefore} → ${balanceAfter}。`;
          if (failedRewards.length > 0) {
            setQuickMessageTone('error');
            setQuickMessage(`本次发放部分失败。${parts.join('，')}。${balanceMessage} 已自动下载兜底 Excel。`);
          } else {
            setQuickMessageTone('success');
            setQuickMessage(`本次发放成功。${parts.join('，')}。${balanceMessage}`);
          }
        }
      });
    } catch (error) {
      if (error instanceof DistributionSubmitError) {
        await downloadDistributionFallbackExcel({
          rewards,
          classCode,
          fileName: `${classCode}_MP发放失败兜底.xlsx`,
        });
        setQuickMessageTone('error');
        setQuickMessage(`${error.message}，已自动下载兜底 Excel。`);
        return;
      }
      setQuickMessageTone('error');
      setQuickMessage(error instanceof Error ? error.message : '发放失败');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={`step-card card${operation === 'recover' ? ' is-mp-recovery' : ''}`}>
      <h3 className="step-heading">{operation === 'recover' ? '快捷 MP 回收' : '快捷 MP 管理'}</h3>
      <p className="step-sub">选择学生、设定金额，直接在教务系统发放或回收。</p>

      <div className="quick-mode-tabs" aria-label="MiniPin 操作">
        <button type="button" className={`quick-mode-tab${operation === 'issue' ? ' active' : ''}`} onClick={() => switchOperation('issue')}>发放</button>
        <button type="button" className={`quick-mode-tab${operation === 'recover' ? ' active' : ''}`} onClick={() => switchOperation('recover')}>回收</button>
      </div>
      {operation === 'recover' && <p className="recovery-mode-notice" role="status">当前为回收模式：将从学生余额中扣回 MP，不是发放奖励。请核对姓名、数量和原因。</p>}

      {/* 登录区域 */}
      {!isLoggedIn && (
        <div className="quick-template-box" style={{ marginBottom: 16 }}>
          <div className="quick-template-head">
            <div>
              <strong>连接教务系统</strong>
              <p>这里现在直接复用全局登录态，不再单独保存一套账号密码。</p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 8 }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={sessionChecking}
              onClick={() => {
                if (onSessionExpired) {
                  onSessionExpired();
                } else {
                  setLoginError('当前页面未挂接补登入口，请先回主页连接教务系统。');
                }
              }}
              style={{ whiteSpace: 'nowrap' }}
            >
              连接教务系统
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={sessionChecking}
              onClick={() => { void restoreSharedSession(); }}
              style={{ whiteSpace: 'nowrap' }}
            >
              {sessionChecking ? '检查中...' : '重新检查当前登录态'}
            </button>
          </div>
          {loginError && <div className="quick-template-message" style={{ color: '#c0392b', marginTop: 8 }}>{loginError}</div>}
        </div>
      )}

      {isLoggedIn && (
        <div className="quick-status-row">
          <span>已连接教务系统</span>
          {rosterLoading && <span className="spinner" />}
          <span className="quick-template-badge active">
            {rememberedRoster.length} 人
          </span>
          <span className={`quick-balance-badge${balanceValue !== null ? ' active' : ''}`}>
            当前班内余额：{balanceLoading ? '查询中...' : balanceLabel}
          </span>
        </div>
      )}

      <div className="quick-template-box">
        <div className="quick-template-head">
          <div>
            <strong>快捷{operation === 'recover' ? '回收' : '发放'}</strong>
            <p>默认英文名优先；未识别时会自动再匹配一次中文名。</p>
          </div>
          <span className={`quick-template-badge${rememberedRoster.length ? ' active' : ''}`}>
            {rememberedRoster.length ? `${rememberedRoster.length} 人` : '暂无名单'}
          </span>
        </div>

        {operation === 'recover' && (
          <div className="quick-picker-head" style={{ marginBottom: 12 }}>
            <span className="quick-template-hint">
              {recoveryLoading ? '正在刷新实时余额…' : `余额已实时读取${recoveryReadAt ? ` · ${new Date(recoveryReadAt).toLocaleTimeString()}` : ''}`}
            </span>
            <label>
              回收原因&nbsp;
              <select className="input-field quick-sort-select" value={recoveryReason} onChange={(event) => setRecoveryReason(event.target.value)}>
                {recoveryReasons.map((reason) => <option key={reason} value={reason}>{reason}</option>)}
              </select>
            </label>
          </div>
        )}

        <div className="quick-mode-tabs">
          <button
            type="button"
            className={`quick-mode-tab${inputMode === 'english' ? ' active' : ''}`}
            onClick={() => setInputMode('english')}
          >
            英文名
          </button>
          <button
            type="button"
            className={`quick-mode-tab${inputMode === 'chinese' ? ' active' : ''}`}
            onClick={() => setInputMode('chinese')}
          >
            中文名
          </button>
          <button
            type="button"
            className={`quick-mode-tab${inputMode === 'picker' ? ' active' : ''}`}
            onClick={() => setInputMode('picker')}
          >
            展开勾选
          </button>
        </div>

        {inputMode !== 'picker' ? (
          <>
            <textarea
              className="input-field quick-template-input"
              rows={8}
              placeholder={
                inputMode === 'english'
                  ? 'Amy Lee 0.5\nSally, Chris 1'
                  : '李晓彤 0.5\n周子然 王一诺 1'
              }
              value={quickInput}
              onChange={(event) => setQuickInput(event.target.value)}
            />
            <div className="quick-template-actions">
              <button
                className="btn btn-ghost"
                type="button"
                onClick={() => appendParsedRewards(inputMode)}
              >
                加入待{operation === 'recover' ? '回收' : '发'}名单
              </button>
              <span className="quick-template-hint">
                {inputMode === 'english'
                  ? '英文名支持；如果重名，会提示人工校验，不会自动乱配。'
                  : '中文名同一行可写多个人名，但人名之间仍要有空格、顿号或逗号。'}
              </span>
            </div>
          </>
        ) : (
          <>
            <div className="quick-picker-head">
              <span className="quick-template-hint">直接点选学生，再批量加几；可以反复加多轮。</span>
              <div className="quick-picker-bar">
                <button className="btn btn-ghost btn-sm" type="button" onClick={toggleAllPickerStudents} disabled={!sortedRoster.length}>
                  {allPickerSelected ? '取消全选' : '全选名单'}
                </button>
                <select
                  className="input-field quick-sort-select"
                  value={studentSortKey}
                  onChange={(event) => onStudentSortChange(event.target.value as StudentSortKey)}
                >
                  {STUDENT_SORT_OPTIONS.map((option) => (
                    <option key={option.key} value={option.key}>{option.label}</option>
                  ))}
                </select>
                <input
                  className="input-field quick-picker-input"
                  type="number"
                  step="0.1"
                  min="0"
                  placeholder={operation === 'recover' ? '收多少' : '加几'}
                  value={pickerAmount}
                  onChange={(event) => setPickerAmount(event.target.value)}
                />
                <span className="config-unit">MP</span>
                <button className="btn btn-ghost" type="button" onClick={appendPickerRewards}>
                  批量加入
                </button>
              </div>
            </div>
            <div className="quick-picker-list">
              {sortedRoster.map((student) => (
                <label
                  key={student.studentId}
                  className={`student-chip ${selectedStudentIds.has(student.studentId) ? 'selected' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={selectedStudentIds.has(student.studentId)}
                    onChange={() => togglePickerStudent(student.studentId)}
                  />
                  <span>{student.englishName || student.chineseName}</span>
                  {student.englishName && <span className="chip-sub">{student.chineseName}</span>}
                  {operation === 'recover' && <span className="chip-sub">可收 {recoveryAvailable[student.studentId] ?? '—'} MP</span>}
                </label>
              ))}
            </div>
          </>
        )}

        <div className="quick-draft-panel">
            <div className="quick-draft-head">
              <strong>待{operation === 'recover' ? '回收' : '发'}名单</strong>
              <div className="quick-draft-actions">
                <span className="quick-template-badge active">{draftRewards.length} 人</span>
                <span className="quick-total-badge">本次{operation === 'recover' ? '回收' : '发放'}总额 {draftTotalMP} MP</span>
                {draftRewards.length > 0 && (
                  <button className="btn btn-ghost btn-sm" type="button" onClick={clearDraftRewards}>
                    清空
                </button>
              )}
            </div>
          </div>
          {draftRewards.length > 0 ? (
            <div className="quick-draft-list">
              {draftRewards.map((reward) => (
                <div key={reward.studentId} className="quick-draft-item">
                  <div>
                    <strong>{reward.englishName || reward.chineseName}</strong>
                    {operation === 'recover' && <span className="quick-template-hint"> 当前可回收 {recoveryAvailable[reward.studentId] ?? '—'} MP</span>}
                  </div>
                  <div className="quick-draft-right">
                    <span>{reward.amount} MP</span>
                    <button type="button" onClick={() => removeDraftReward(reward.studentId)}>×</button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="quick-template-hint">还没有加入任何学生。</div>
          )}
        </div>

        <div className="quick-template-actions">
          <button className="btn btn-primary" type="button" onClick={handleDirectSubmit} disabled={submitting || recoveryLoading || (operation === 'recover' && recoveryUncertain) || !classInfo.squadId || !draftRewards.length}>
            {submitting ? (operation === 'recover' ? '回收中...' : '发放中...') : (operation === 'recover' ? '确认回收' : '发到官网')}
          </button>
          {operation === 'issue' && <button className="btn btn-ghost" type="button" onClick={downloadQuickTemplate}>↓ 生成Excel</button>}
          <span className="quick-template-hint">
            {operation === 'recover' ? '回收会在确认前再次校验每名学生的实时余额，并一次性批量提交。' : '「发到官网」直接提交到教务系统，不需要再手动上传 Excel。'}
          </span>
        </div>
        {quickMessage && <div className={`quick-template-message ${quickMessageTone}`}>{quickMessage}</div>}
        {operation === 'recover' && recoveryUncertain && <p className="quick-template-message error">此批次已停止再次提交。请先到教务系统核对回收记录，确认结果后重新打开本功能。</p>}
      </div>

      <div className="step-actions">
        <button className="btn btn-ghost" onClick={onBack}>← 上一步</button>
      </div>
    </div>
  );
}

function UploadField({
  label,
  hint,
  accept,
  file,
  onChange,
  secondaryActionLabel,
  secondaryActionLoadingLabel,
  secondaryActionBusy = false,
  onSecondaryAction,
}: {
  label: string;
  hint: string;
  accept: string;
  file: File | null;
  onChange: (f: File) => void;
  secondaryActionLabel?: string;
  secondaryActionLoadingLabel?: string;
  secondaryActionBusy?: boolean;
  onSecondaryAction?: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div
      className={`upload-zone ${file ? 'uploaded' : ''}`}
      onClick={() => inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        style={{ display: 'none' }}
        onChange={(e) => e.target.files?.[0] && onChange(e.target.files[0])}
      />
      <div className="upload-icon">{file ? '✅' : '📄'}</div>
      <div className="upload-text">
        <strong>{label}</strong>
        <span>{file ? file.name : hint}</span>
      </div>
      {onSecondaryAction && (
        <button
          type="button"
          className="upload-secondary-btn"
          onClick={(event) => {
            event.stopPropagation();
            onSecondaryAction();
          }}
          disabled={secondaryActionBusy}
        >
          {secondaryActionBusy ? (secondaryActionLoadingLabel || '处理中...') : secondaryActionLabel}
        </button>
      )}
    </div>
  );
}

function StepPreview({
  students,
  scheme,
  customSchemeData,
  schemeSettings,
  dailyRate,
  defaultParticipation,
  bonusItems,
  studentSortKey,
  onStudentSortChange,
  modules,
  onSchemeChange,
  onDailyRateChange,
  onSchemeSettingsChange,
  onParticipationChange,
  onBulkParticipation,
  onDefaultParticipationChange,
  onAddBonus,
  onRemoveBonus,
  classCode,
  classInfo,
  week,
  onBack,
  onGenerate,
}: {
  students: StudentData[];
  scheme: SchemeId;
  customSchemeData: SavedCustomScheme | undefined;
  schemeSettings: SchemeSettings;
  dailyRate: number;
  defaultParticipation: number;
  bonusItems: BonusItem[];
  studentSortKey: StudentSortKey;
  onStudentSortChange: (value: StudentSortKey) => void;
  modules: Set<Module>;
  onSchemeChange: (id: SchemeId, data?: SavedCustomScheme) => void;
  onDailyRateChange: (v: number) => void;
  onSchemeSettingsChange: (patch: Partial<SchemeSettings>) => void;
  onParticipationChange: (sid: string, val: number) => void;
  onBulkParticipation: (sids: string[], val: number) => void;
  onDefaultParticipationChange: (val: number) => void;
  onAddBonus: (b: BonusItem) => void;
  onRemoveBonus: (i: number) => void;
  classCode: string;
  classInfo: ClassInfo;
  week: number;
  onBack: () => void;
  onGenerate: () => void;
}) {
  const [selectedSids, setSelectedSids] = useState<Set<string>>(new Set());
  const [bulkVal, setBulkVal] = useState('');
  const [bonusName, setBonusName] = useState('');
  const [bonusAmount, setBonusAmount] = useState('');
  const [bonusStudents, setBonusStudents] = useState<Set<string>>(new Set());
  const [bonusError, setBonusError] = useState('');
  const [expandedHistory, setExpandedHistory] = useState<number | null>(null);
  const [bonusNameSuggestions] = useState<string[]>(() => getBonusNames());

  const [savedSchemes, setSavedSchemes] = useState<SavedCustomScheme[]>([]);
  const [showEditor, setShowEditor] = useState(false);
  const [editingScheme, setEditingScheme] = useState<SavedCustomScheme | undefined>();
  const sortedStudents = sortStudentList(students, studentSortKey);

  useEffect(() => {
    setSavedSchemes(loadSavedSchemes());
  }, []);

  function toggleStudent(sid: string) {
    setSelectedSids((prev) => {
      const next = new Set(prev);
      next.has(sid) ? next.delete(sid) : next.add(sid);
      return next;
    });
  }

  function applyBulk() {
    const val = parseFloat(bulkVal);
    if (isNaN(val) || selectedSids.size === 0) return;
    onBulkParticipation(Array.from(selectedSids), val);
    setSelectedSids(new Set());
    setBulkVal('');
  }

  function addBonus() {
    const draft = createBonusItemDraft(bonusName, bonusAmount, bonusStudents);
    if (!draft.item) {
      setBonusError(draft.error || '奖励信息不完整');
      return;
    }
    setBonusError('');
    onAddBonus(draft.item);
    setBonusName('');
    setBonusAmount('');
    setBonusStudents(new Set());
  }

  function handleSaveCustomScheme(s: SavedCustomScheme) {
    saveScheme(s);
    const updated = loadSavedSchemes();
    setSavedSchemes(updated);
    setShowEditor(false);
    setEditingScheme(undefined);
    onSchemeChange(s.id, s);
  }

  function handleDeleteScheme(id: string) {
    deleteScheme(id);
    setSavedSchemes(loadSavedSchemes());
    if (scheme === id) onSchemeChange('scheme1', undefined);
  }

  return (
    <div className="step-card card">
      <h3 className="step-heading">确认发放明细</h3>

      <div className="preview-config">
        <div className="config-row">
          <span className="config-label">发放方案</span>
          <div className="scheme-selector">
            <div className="scheme-tabs">
              {SCHEMES.map((s) => (
                <button
                  key={s.id}
                  className={`scheme-tab ${scheme === s.id ? 'active' : ''}`}
                  onClick={() => { onSchemeChange(s.id, undefined); setShowEditor(false); }}
                >
                  {s.name}
                </button>
              ))}
              {savedSchemes.map((s) => (
                <div key={s.id} className="scheme-tab-custom-wrap">
                  <button
                    className={`scheme-tab scheme-tab-custom ${scheme === s.id ? 'active' : ''}`}
                    onClick={() => { onSchemeChange(s.id, s); setShowEditor(false); }}
                  >
                    {s.name}
                  </button>
                  <button
                    className="scheme-tab-edit"
                    title="编辑方案"
                    onClick={() => { setEditingScheme(s); setShowEditor(true); onSchemeChange(s.id, s); }}
                  >✎</button>
                  <button
                    className="scheme-tab-del"
                    title="删除方案"
                    onClick={() => handleDeleteScheme(s.id)}
                  >×</button>
                </div>
              ))}
              <button
                className="scheme-tab-new"
                onClick={() => { setEditingScheme(undefined); setShowEditor((v) => !v); }}
              >
                {showEditor && !editingScheme ? '收起' : '+ 新建方案'}
              </button>
            </div>
            <p className="scheme-desc">{describeDistributionScheme(scheme, schemeSettings, customSchemeData)}</p>

            {showEditor && (
              <CustomSchemeEditor
                existing={editingScheme}
                onSave={handleSaveCustomScheme}
                onCancel={() => { setShowEditor(false); setEditingScheme(undefined); }}
              />
            )}
          </div>
        </div>
        {scheme === 'scheme2' && (
          <div className="config-row">
            <span className="config-label">全部完成奖励 =</span>
            <input
              className="input-field config-input"
              type="number"
              step="0.1"
              min="0"
              value={schemeSettings.scheme2AllDoneAmount}
              onChange={(e) =>
                onSchemeSettingsChange({ scheme2AllDoneAmount: parseFloat(e.target.value) || 0 })
              }
            />
            <span className="config-unit">MP</span>
          </div>
        )}
        {modules.has('每日开口') && (
          <div className="config-row">
            <span className="config-label">每次打卡 =</span>
            <input
              className="input-field config-input"
              type="number"
              step="0.05"
              min="0"
              value={dailyRate}
              onChange={(e) => onDailyRateChange(parseFloat(e.target.value) || 0)}
            />
            <span className="config-unit">MP / 次</span>
          </div>
        )}
      </div>

      {modules.has('课堂参与') && (
        <div className="participation-section">
          <div className="list-toolbar">
            <div className="section-mini-title">课堂参与</div>
            <select
              className="input-field quick-sort-select"
              value={studentSortKey}
              onChange={(event) => onStudentSortChange(event.target.value as StudentSortKey)}
            >
              {STUDENT_SORT_OPTIONS.map((option) => (
                <option key={option.key} value={option.key}>{option.label}</option>
              ))}
            </select>
          </div>
          <div className="default-row">
            <span className="config-label">全班默认值</span>
            <input
              className="input-field row-mp-input"
              type="number"
              step="0.1"
              min="0"
              value={defaultParticipation}
              onChange={(e) => onDefaultParticipationChange(parseFloat(e.target.value) || 0)}
            />
            <span className="config-unit">MP（修改后自动同步到所有人）</span>
          </div>
          <p className="section-mini-desc">勾选PK获胜学生，一键批量改值</p>
          <div className="student-select-list">
            {sortedStudents.map((s) => (
              <label key={s.studentId} className={`student-chip ${selectedSids.has(s.studentId) ? 'selected' : ''}`}>
                <input type="checkbox" checked={selectedSids.has(s.studentId)} onChange={() => toggleStudent(s.studentId)} />
                <span>{s.englishName}</span>
                <span className="chip-val">{s.classParticipation} MP</span>
              </label>
            ))}
          </div>
          {selectedSids.size > 0 && (
            <div className="bulk-bar">
              <span>{selectedSids.size} 人已选，批量设定为：</span>
              <input
                className="input-field"
                style={{ width: 80 }}
                type="number"
                step="0.1"
                placeholder="0.5"
                value={bulkVal}
                onChange={(e) => setBulkVal(e.target.value)}
              />
              <span>MP</span>
              <button className="btn btn-primary btn-sm" onClick={applyBulk}>确定</button>
            </div>
          )}
        </div>
      )}

      {modules.has('个性化奖励') && (
        <div className="bonus-section">
          <div className="list-toolbar">
            <div className="section-mini-title">个性化奖励</div>
            <select
              className="input-field quick-sort-select"
              value={studentSortKey}
              onChange={(event) => onStudentSortChange(event.target.value as StudentSortKey)}
            >
              {STUDENT_SORT_OPTIONS.map((option) => (
                <option key={option.key} value={option.key}>{option.label}</option>
              ))}
            </select>
          </div>
          <div className="bonus-add-row">
            <input
              className="input-field"
              placeholder="奖励名称"
              value={bonusName}
              list="bonus-name-list"
              onChange={(e) => {
                const v = e.target.value;
                setBonusName(v);
                const last = getLastAmount(v);
                if (last !== null && bonusAmount === '') setBonusAmount(String(last));
              }}
              style={{ flex: 2 }}
            />
            <datalist id="bonus-name-list">
              {bonusNameSuggestions.map((n) => <option key={n} value={n} />)}
            </datalist>
            <input className="input-field" placeholder="MP" type="number" step="0.1" value={bonusAmount} onChange={(e) => setBonusAmount(e.target.value)} style={{ width: 80 }} />
          </div>
          <div className="student-select-list">
            {sortedStudents.map((s) => (
              <label key={s.studentId} className={`student-chip ${bonusStudents.has(s.studentId) ? 'selected' : ''}`}>
                <input type="checkbox" checked={bonusStudents.has(s.studentId)} onChange={() => setBonusStudents((p) => { const n = new Set(p); n.has(s.studentId) ? n.delete(s.studentId) : n.add(s.studentId); return n; })} />
                <span>{s.englishName}</span>
              </label>
            ))}
          </div>
          {bonusError && <p className="bonus-error">{bonusError}</p>}
          <button className="btn btn-ghost btn-sm" onClick={addBonus}>
            + 添加奖励
          </button>
          {bonusItems.length > 0 && (
            <div className="bonus-list">
              {bonusItems.map((b, i) => {
                const hist = getHistoryForBonus(b.name);
                const isOpen = expandedHistory === i;
                return (
                  <div key={i} className="bonus-tag-wrap">
                    <div className="bonus-tag">
                      <span>{b.name}: {b.amount} MP × {b.studentIds.length}人</span>
                      {hist.length > 0 && (
                        <button
                          className="bonus-hist-btn"
                          title="查看历史"
                          onClick={() => setExpandedHistory(isOpen ? null : i)}
                        >📋</button>
                      )}
                      <button onClick={() => { onRemoveBonus(i); if (expandedHistory === i) setExpandedHistory(null); }}>×</button>
                    </div>
                    {isOpen && hist.length > 0 && (
                      <div className="bonus-history-panel">
                        <div className="bonus-history-title">历史记录</div>
                        {hist.map((rec, ri) => (
                          <div key={ri} className="bonus-history-row">
                            <span className="bonus-history-meta">Week {rec.week} · {rec.classCode}</span>
                            <span>{rec.studentNames.join('、')}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className="step-actions">
        <button className="btn btn-ghost" onClick={onBack}>← 上一步</button>
        <button className="btn btn-primary" onClick={onGenerate}>生成结果 →</button>
      </div>
    </div>
  );
}
