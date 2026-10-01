import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import type { ClassInfo } from '../types';
import {
  ensureDailyReportSession,
  fetchAutoWeekTasks,
  requestAutoDailyReport,
  requestUploadDailyReport,
} from '../services/dailyReportApi';
import type { WeekTask } from '../services/dailyReportApi';
import { getCurrentWeek, getWeekRange } from '../utils/weekNumber';
import academicCalendar from '../../../config/academic-calendar.json';
import ReLoginModal from './ReLoginModal';
import './DailyReportApp.css';

interface Props {
  classInfo: ClassInfo;
  classes?: ClassInfo[];
  onBack: () => void;
  onBackToHome?: () => void;
  onSwitchClass?: (name: string) => void;
}

type ReportMode = 'standard' | 'detail' | 'senior';
type ReportSourceMode = 'upload' | 'auto';
type UploadKind = 'student' | 'checkin';
const AUTO_REPORT_ENABLED = true;

interface UploadedFileState {
  file: File | null;
  name: string;
}

const ACCEPTED_EXTENSIONS = ['.xlsx', '.xls'];

function isExcelFile(file: File) {
  const lower = file.name.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((suffix) => lower.endsWith(suffix));
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      if (!base64) {
        reject(new Error('文件读取失败'));
        return;
      }
      resolve(base64);
    };
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsDataURL(file);
  });
}

function getDownloadName(header: string | null, fallback: string) {
  if (!header) return fallback;
  const utfMatch = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (utfMatch?.[1]) {
    try {
      return decodeURIComponent(utfMatch[1]);
    } catch {
      return utfMatch[1];
    }
  }
  const plainMatch = header.match(/filename="?([^"]+)"?/i);
  return plainMatch?.[1] || fallback;
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function getReportFilenameSuffix(reportMode: ReportMode) {
  if (reportMode === 'detail') return '明细版本';
  if (reportMode === 'senior') return '大龄版';
  return '完成公示';
}

function formatDateInput(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function parseDateInput(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);
  const date = new Date(year, month - 1, day);
  if (
    Number.isNaN(date.getTime())
    || date.getFullYear() !== year
    || date.getMonth() !== month - 1
    || date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

function addDays(date: Date, amount: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function addMonths(date: Date, amount: number) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

function getCalendarStart(date: Date) {
  const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
  const weekDay = (monthStart.getDay() + 6) % 7;
  return addDays(monthStart, -weekDay);
}

function isSameDay(left: Date | null, right: Date | null) {
  if (!left || !right) return false;
  return (
    left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate()
  );
}

function formatMonthLabel(date: Date) {
  return `${date.getFullYear()}年${date.getMonth() + 1}月`;
}

const CALENDAR_WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日'];

interface DatePickerFieldProps {
  value: string;
  onChange: (nextValue: string) => void;
}

function DatePickerField({ value, onChange }: DatePickerFieldProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedDate = useMemo(() => parseDateInput(value), [value]);
  const [open, setOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(() => {
    const base = parseDateInput(value) || new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });

  useEffect(() => {
    const base = parseDateInput(value);
    if (base) {
      setVisibleMonth(new Date(base.getFullYear(), base.getMonth(), 1));
    }
  }, [value]);

  useEffect(() => {
    if (!open) return undefined;

    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const calendarDays = useMemo(() => {
    const start = getCalendarStart(visibleMonth);
    return Array.from({ length: 42 }, (_, index) => {
      const date = addDays(start, index);
      return {
        key: formatDateInput(date),
        label: date.getDate(),
        date,
        isCurrentMonth: date.getMonth() === visibleMonth.getMonth(),
      };
    });
  }, [visibleMonth]);

  const today = useMemo(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }, []);

  return (
    <div className="dr-date-field" ref={containerRef}>
      <button
        type="button"
        className={`dr-date-trigger${open ? ' active' : ''}`}
        onClick={() => {
          const base = selectedDate || new Date();
          setVisibleMonth(new Date(base.getFullYear(), base.getMonth(), 1));
          setOpen((current) => !current);
        }}
      >
        <span className={`dr-date-trigger-value${value ? '' : ' placeholder'}`}>
          {value || '请选择日期'}
        </span>
        <span className="dr-date-trigger-badge">选择</span>
      </button>

      {open && (
        <div className="dr-date-popover">
          <div className="dr-date-popover-head">
            <button type="button" className="dr-date-nav" onClick={() => setVisibleMonth((current) => addMonths(current, -1))}>
              &lt;
            </button>
            <div className="dr-date-month">{formatMonthLabel(visibleMonth)}</div>
            <button type="button" className="dr-date-nav" onClick={() => setVisibleMonth((current) => addMonths(current, 1))}>
              &gt;
            </button>
          </div>

          <div className="dr-date-weekdays">
            {CALENDAR_WEEKDAY_LABELS.map((label) => (
              <span key={label} className="dr-date-weekday">{label}</span>
            ))}
          </div>

          <div className="dr-date-days">
            {calendarDays.map((day) => (
              <button
                key={day.key}
                type="button"
                className={[
                  'dr-date-day',
                  day.isCurrentMonth ? '' : 'outside',
                  isSameDay(day.date, selectedDate) ? 'selected' : '',
                  isSameDay(day.date, today) ? 'today' : '',
                ].filter(Boolean).join(' ')}
                onClick={() => {
                  onChange(formatDateInput(day.date));
                  setOpen(false);
                }}
              >
                {day.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function getDefaultPreviousWeekRange() {
  const currentWeek = getCurrentWeek();
  const { start } = getWeekRange(Math.max(1, currentWeek - 1));
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return { start: formatDateInput(start), end: formatDateInput(end), week: Math.max(1, currentWeek - 1) };
}

function roundToSingleDecimal(value: number) {
  return Math.round(value * 10) / 10;
}

function formatSingleDecimal(value: number) {
  return roundToSingleDecimal(value).toFixed(1);
}

async function detectDetailTestTotalScore(file: File): Promise<number | null> {
  const { getXlsx, readWorkbookFromFile } = await import('../utils/xlsxFile');
  const XLSX = await getXlsx();
  const workbook = await readWorkbookFromFile(file);
  const sheet = workbook.Sheets['数据底表'];
  if (!sheet) return null;

  const rows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: null,
  }) as Array<Array<string | number | null>>;

  if (rows.length < 3) return null;

  const titleRow = rows[1] || [];
  const subRow = rows[2] || [];
  for (let index = 0; index < subRow.length; index += 1) {
    const title = String(titleRow[index] || '').trim();
    const sub = String(subRow[index] || '').trim();
    if (!title.includes('测试')) continue;
    const match = sub.match(/^分数\(([\d.]+)\)$/);
    if (!match) continue;
    const total = Number.parseFloat(match[1]);
    if (Number.isFinite(total) && total > 0) {
      return total;
    }
  }

  return null;
}

export default function DailyReportApp({ classInfo, classes, onBack, onBackToHome, onSwitchClass }: Props) {
  const previousWeekDefault = useMemo(() => getDefaultPreviousWeekRange(), []);
  const [reportMode, setReportMode] = useState<ReportMode>('standard');
  const [reportSourceMode, setReportSourceMode] = useState<ReportSourceMode>(AUTO_REPORT_ENABLED ? 'auto' : 'upload');
  const [className, setClassName] = useState(classInfo.name);
  const [studentFile, setStudentFile] = useState<UploadedFileState>({ file: null, name: '' });
  const [checkinFile, setCheckinFile] = useState<UploadedFileState>({ file: null, name: '' });
  const [minCheckinDaysInput, setMinCheckinDaysInput] = useState('2');
  const [includeCheckin, setIncludeCheckin] = useState(false);
  const [checkinRangeStart, setCheckinRangeStart] = useState(previousWeekDefault.start);
  const [checkinRangeEnd, setCheckinRangeEnd] = useState(previousWeekDefault.end);
  const [detectedTestTotalScore, setDetectedTestTotalScore] = useState<number | null>(null);
  const [detailTestPassScore, setDetailTestPassScore] = useState('');
  const [loading, setLoading] = useState(false);
  const [taskLoading, setTaskLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [weekTasks, setWeekTasks] = useState<WeekTask[]>([]);
  const [selectedWeekIds, setSelectedWeekIds] = useState<string[]>([]);
  const [showReLogin, setShowReLogin] = useState(false);
  const [defaultUsername, setDefaultUsername] = useState('');
  const [taskSnapshotStatus, setTaskSnapshotStatus] = useState('');
  const [taskSemester, setTaskSemester] = useState('');

  const studentInputRef = useRef<HTMLInputElement>(null);
  const checkinInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setClassName(classInfo.name);
  }, [classInfo.name]);

  useEffect(() => {
    if (!AUTO_REPORT_ENABLED && reportSourceMode === 'auto') {
      setReportSourceMode('upload');
    }
  }, [reportSourceMode]);

  const ready = useMemo(() => (
    reportSourceMode === 'upload'
      ? !!studentFile.file
      : selectedWeekIds.length > 0
  ), [reportSourceMode, selectedWeekIds.length, studentFile.file]);

  const minCheckinDays = useMemo(() => {
    const parsed = Number.parseInt(minCheckinDaysInput, 10);
    if (Number.isNaN(parsed) || parsed < 0) return 2;
    return parsed;
  }, [minCheckinDaysInput]);

  function resetMessages() {
    setError('');
    setSuccess('');
  }

  function updateFile(kind: UploadKind, nextFile: File | null) {
    resetMessages();

    if (!nextFile) {
      if (kind === 'student') {
        setStudentFile({ file: null, name: '' });
        setDetectedTestTotalScore(null);
        setDetailTestPassScore('');
      }
      if (kind === 'checkin') setCheckinFile({ file: null, name: '' });
      return;
    }

    if (!isExcelFile(nextFile)) {
      setError('请上传 .xlsx 或 .xls 文件');
      return;
    }

    const nextState = { file: nextFile, name: nextFile.name };
    if (kind === 'student') {
      setStudentFile(nextState);
      void detectDetailTestTotalScore(nextFile)
        .then((total) => {
          setDetectedTestTotalScore(total);
          if (total && total > 0) {
            setDetailTestPassScore(formatSingleDecimal(total * 0.8));
            return;
          }
          setDetailTestPassScore('');
        })
        .catch(() => {
          setDetectedTestTotalScore(null);
          setDetailTestPassScore('');
        });
    }
    if (kind === 'checkin') setCheckinFile(nextState);
  }

  function onFileChange(kind: UploadKind, event: ChangeEvent<HTMLInputElement>) {
    updateFile(kind, event.target.files?.[0] || null);
    event.target.value = '';
  }

  async function ensureAutoReportLogin() {
    const session = await ensureDailyReportSession();
    if (session.username) {
      setDefaultUsername(session.username);
    }
    if (!session.loggedIn) {
      setShowReLogin(true);
      throw new Error('需要先连接教务系统');
    }
  }

  async function switchToAutoMode() {
    setReportSourceMode('auto');
    setIncludeCheckin(false);
    setCheckinRangeStart(previousWeekDefault.start);
    setCheckinRangeEnd(previousWeekDefault.end);
    resetMessages();
  }

  async function loadAutoWeekTasks() {
    setTaskLoading(true);
    resetMessages();
    try {
      await ensureAutoReportLogin();
      const data = await fetchAutoWeekTasks(classInfo.name);
      const nextTasks = data.weekTasks;
      const defaultSelected = data.defaultSelectedWeekIds;
      const nextRange = data.defaultCheckinRange;

      setWeekTasks(nextTasks);
      setSelectedWeekIds(defaultSelected);
      setTaskSemester(data.preferredSemester);
      if (nextRange.start) setCheckinRangeStart(nextRange.start);
      if (nextRange.end) setCheckinRangeEnd(nextRange.end);
      const updatedAt = data.updatedAt ? new Date(data.updatedAt) : null;
      const formattedUpdatedAt = updatedAt && !Number.isNaN(updatedAt.getTime())
        ? updatedAt.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
        : '';
      setTaskSnapshotStatus(
        data.source === 'snapshot'
          ? `已自动载入主页预抓数据${formattedUpdatedAt ? ` · 更新于 ${formattedUpdatedAt}` : ''}`
          : `已自动同步最新周挑战${formattedUpdatedAt ? ` · 更新于 ${formattedUpdatedAt}` : ''}`,
      );

      if (nextTasks.length === 0) {
        setSuccess(`${data.preferredSemester || '当前学期'}暂无周挑战`);
        return;
      }
      if (defaultSelected.length > 0) {
        const selectedNames = nextTasks
          .filter((task) => defaultSelected.includes(task.id))
          .map((task) => task.name)
          .join('、');
        setSuccess(`已读取官网完整挑战目录，共 ${nextTasks.length} 组${selectedNames ? `；当前勾选 ${selectedNames}` : ''}`);
        return;
      }
      setSuccess(`已自动准备 ${nextTasks.length} 组周挑战`);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '读取周挑战失败');
    } finally {
      setTaskLoading(false);
    }
  }

  useEffect(() => {
    if (!AUTO_REPORT_ENABLED || reportSourceMode !== 'auto' || !classInfo.name) return;
    void loadAutoWeekTasks();
  }, [classInfo.name, reportSourceMode]);

  function toggleWeekTask(weekId: string) {
    setSelectedWeekIds((current) => (
      current.includes(weekId)
        ? current.filter((item) => item !== weekId)
        : [...current, weekId]
    ));
  }

  async function generateUploadReport() {
    if (!studentFile.file) {
      setError('请先上传学生个人数据文件');
      return;
    }

    const studentContent = await readFileAsBase64(studentFile.file);
    const checkinContent = checkinFile.file ? await readFileAsBase64(checkinFile.file) : '';

    const response = await requestUploadDailyReport({
        className: className.trim() || classInfo.name,
        reportMode,
        minCheckinDays,
        detailTestPassScore: detailTestPassScore.trim(),
        studentFile: {
          name: studentFile.file.name,
          content: studentContent,
        },
        checkinFile: {
          name: checkinFile.file?.name || '',
          content: checkinContent,
        },
    });

    const blob = await response.blob();
    const fallbackName = `${className || classInfo.name}${getReportFilenameSuffix(reportMode)}.xlsx`;
    const filename = getDownloadName(response.headers.get('Content-Disposition'), fallbackName);
    triggerDownload(blob, filename);
    setSuccess(`已生成并下载：${filename}`);
  }

  async function generateAutoReport() {
    if (selectedWeekIds.length === 0) {
      setError('请至少选择一个周挑战');
      return;
    }

    await ensureAutoReportLogin();

    const response = await requestAutoDailyReport({
        classId: classInfo.name,
        className: className.trim() || classInfo.name,
        reportMode,
        minCheckinDays,
        detailTestPassScore: detailTestPassScore.trim(),
        selectedWeekIds,
        includeCheckin,
        checkinRangeStart,
        checkinRangeEnd,
    });

    const blob = await response.blob();
    const fallbackName = `${className || classInfo.name}${getReportFilenameSuffix(reportMode)}.xlsx`;
    const filename = getDownloadName(response.headers.get('Content-Disposition'), fallbackName);
    triggerDownload(blob, filename);
    setSuccess(`已自动生成并下载：${filename}`);
  }

  async function generateReport() {
    setLoading(true);
    resetMessages();
    try {
      if (reportSourceMode === 'auto') {
        await generateAutoReport();
      } else {
        await generateUploadReport();
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '班级公示生成失败');
    } finally {
      setLoading(false);
    }
  }

  const selectedTaskLabel = useMemo(() => {
    const selectedTasks = weekTasks.filter((task) => selectedWeekIds.includes(task.id));
    if (selectedTasks.length === 0) return '当前未勾选挑战';
    return `当前勾选：${selectedTasks.map((task) => (
      `${task.name}${task.addedAt ? `（${task.addedAt}）` : ''}`
    )).join('、')}`;
  }, [selectedWeekIds, weekTasks]);
  const isHistoricalTaskSource = Boolean(
    taskSemester && taskSemester !== academicCalendar.currentTerm.semesterName,
  );

  const detailTestHint = detectedTestTotalScore
    ? `已识别测试总分 ${formatSingleDecimal(detectedTestTotalScore)} 分，默认 ${formatSingleDecimal(detectedTestTotalScore * 0.8)} 分`
    : '留空时自动按识别总分的 80%';

  return (
    <div className="dr-wrap fade-in">
      <div className="dr-topbar">
        {onBackToHome && (
          <button className="tool-home-rail dr-home-inline" onClick={onBackToHome}>
            <span className="tool-home-rail-icon">←</span>
            <span>返回主页</span>
          </button>
        )}
        <button className="tool-back-btn" onClick={onBack}>← 返回</button>
        {classes && classes.length > 1 && onSwitchClass ? (
          <select className="tool-class-switch" value={classInfo.name} onChange={(e) => onSwitchClass(e.target.value)}>
            {classes.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
          </select>
        ) : (
          <span className="tool-class-switch" style={{ cursor: 'default' }}>{classInfo.name}</span>
        )}
        <span className="tool-topbar-label">· 班级公示</span>
      </div>

      <div className="dr-body">
        <div className="dr-hero">
          <div className="dr-hero-badge">快捷生成</div>
          <h2 className="dr-hero-title">班内公示图快捷生成</h2>
          <p className="dr-hero-text">
            上传源表后，下面直接生成班级公示 Excel。
            教务系统周挑战已由主页自动准备，进入班级即可直接选择并生成公示；每日打卡当前只在接口明细可信时自动带出。
          </p>
        </div>

        <div className={`dr-mode-row${AUTO_REPORT_ENABLED ? '' : ' single'}`}>
          {AUTO_REPORT_ENABLED && (
            <button
              type="button"
              className={`dr-mode-btn${reportSourceMode === 'auto' ? ' active' : ''}`}
              onClick={() => { void switchToAutoMode(); }}
            >
              教务系统抓取
            </button>
          )}
          <button
            type="button"
            className={`dr-mode-btn${reportSourceMode === 'upload' ? ' active' : ''}`}
            onClick={() => {
              setReportSourceMode('upload');
              resetMessages();
            }}
          >
            上传文件生成
          </button>
        </div>

        <div className="dr-panel">
          <div className="dr-inline-settings">
            <div className="dr-setting-card dr-version-card">
              <span className="dr-field-label">版本</span>
              <div className="dr-segmented-control">
                <button
                  type="button"
                  className={`dr-segment${reportMode === 'standard' ? ' active' : ''}`}
                  onClick={() => setReportMode('standard')}
                >
                  标准版
                </button>
                <button
                  type="button"
                  className={`dr-segment${reportMode === 'detail' ? ' active' : ''}`}
                  onClick={() => setReportMode('detail')}
                >
                  明细版
                </button>
                <button
                  type="button"
                  className={`dr-segment${reportMode === 'senior' ? ' active' : ''}`}
                  onClick={() => setReportMode('senior')}
                >
                  大龄版
                </button>
              </div>
            </div>

            <label className="dr-setting-card dr-inline-card">
              <span className="dr-field-label">班级</span>
              <input
                className="dr-input"
                value={className}
                onChange={(event) => setClassName(event.target.value)}
                placeholder={classInfo.name}
              />
            </label>

            <label className="dr-setting-card dr-inline-card">
              <span className="dr-field-label">打卡天数</span>
              <input
                className="dr-input"
                inputMode="numeric"
                value={minCheckinDaysInput}
                onChange={(event) => {
                  const next = event.target.value.replace(/[^\d]/g, '');
                  setMinCheckinDaysInput(next);
                }}
              />
            </label>

            <label className="dr-setting-card dr-inline-card dr-test-pass-card">
              <span className="dr-field-label">测试及格分</span>
              <input
                className="dr-input"
                type="number"
                min={0}
                step={0.1}
                value={detailTestPassScore}
                onChange={(event) => setDetailTestPassScore(event.target.value)}
                placeholder={detectedTestTotalScore ? formatSingleDecimal(detectedTestTotalScore * 0.8) : '自动按 80%'}
              />
            </label>
          </div>
          <div className="dr-inline-settings-note">{detailTestHint}</div>
        </div>

        {reportSourceMode === 'auto' && AUTO_REPORT_ENABLED ? (
          <>
            <div className="dr-panel">
              <div className="dr-auto-head">
                <div>
                  <div className="dr-field-label">公示周挑战</div>
                  <div className="dr-field-hint">主页已自动读取官网完整挑战目录；需要时可直接调整勾选。</div>
                </div>
                <div className={`dr-auto-data-status${taskLoading ? ' loading' : ''}`}>
                  {taskLoading ? '正在自动准备…' : taskSnapshotStatus || '等待自动同步'}
                </div>
              </div>
              <div className="dr-field-hint">
                {taskSemester
                  ? `${isHistoricalTaskSource ? '历史只读验证数据源' : '当前数据源'}：${taskSemester}`
                  : '正在确认官网挑战所属学期'}
              </div>
              <div className="dr-field-hint">{selectedTaskLabel}</div>

              {weekTasks.length > 0 ? (
                <div className="dr-week-grid">
                  {weekTasks.map((task) => {
                    const checked = selectedWeekIds.includes(task.id);
                    return (
                      <label key={task.id} className={`dr-week-card${checked ? ' active' : ''}`}>
                        <input type="checkbox" checked={checked} onChange={() => toggleWeekTask(task.id)} />
                        <span className="dr-week-name">{task.name}</span>
                        <span className="dr-week-meta">{task.addedAt ? `${task.addedAt} · ` : ''}{task.resourceCount} 个挑战</span>
                      </label>
                    );
                  })}
                </div>
              ) : (
                <div className="dr-field-hint">{taskLoading ? '正在读取本班周挑战…' : '当前学期暂无周挑战。'}</div>
              )}
            </div>

            <div className="dr-panel">
              <div className="dr-auto-head">
                <div>
                  <div className="dr-field-label">是否抓取每日打卡</div>
                  <div className="dr-field-hint">默认不勾选；只有确认本周打卡口径可信时，再手动打开并使用上周一到上周日范围。</div>
                </div>
                <label className={`dr-check-toggle${includeCheckin ? ' active' : ''}`}>
                  <input
                    type="checkbox"
                    checked={includeCheckin}
                    onChange={(event) => setIncludeCheckin(event.target.checked)}
                  />
                  <span>{includeCheckin ? '已抓取' : '不抓取'}</span>
                </label>
              </div>

              <div className="dr-date-grid">
                <div>
                  <span className="dr-field-label">开始时间</span>
                  <DatePickerField value={checkinRangeStart} onChange={setCheckinRangeStart} />
                </div>
                <div>
                  <span className="dr-field-label">结束时间</span>
                  <DatePickerField value={checkinRangeEnd} onChange={setCheckinRangeEnd} />
                </div>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="dr-upload-grid">
              <div className="dr-upload-card">
                <div className="dr-upload-kicker">文件 1</div>
                <div className="dr-upload-title">学生个人数据</div>
                <div className="dr-upload-desc">需要包含 数据底表 / 概览 / 数据情况</div>
                <input
                  ref={studentInputRef}
                  type="file"
                  accept=".xlsx,.xls"
                  className="dr-hidden-input"
                  onChange={(event) => onFileChange('student', event)}
                />
                <button className="dr-upload-btn" onClick={() => studentInputRef.current?.click()}>
                  {studentFile.name ? '重新选择' : '选择文件'}
                </button>
                <div className={`dr-file-pill${studentFile.name ? ' filled' : ''}`}>
                  {studentFile.name || '未上传'}
                </div>
              </div>

              <div className="dr-upload-card">
                <div className="dr-upload-kicker">文件 2</div>
                <div className="dr-upload-title">打卡情况</div>
                <div className="dr-upload-desc">选填；如果不传，成品里不会出现打卡列</div>
                <input
                  ref={checkinInputRef}
                  type="file"
                  accept=".xlsx,.xls"
                  className="dr-hidden-input"
                  onChange={(event) => onFileChange('checkin', event)}
                />
                <button className="dr-upload-btn" onClick={() => checkinInputRef.current?.click()}>
                  {checkinFile.name ? '重新选择' : '选择文件'}
                </button>
                <div className={`dr-file-pill${checkinFile.name ? ' filled' : ''}`}>
                  {checkinFile.name || '未上传'}
                </div>
              </div>
            </div>
          </>
        )}

        <div className="dr-tips">
          <div className="dr-tip">标准版：输出「完成公示 + 质量分析」两张 sheet。</div>
          <div className="dr-tip">明细版：按测试、AI 语音、词王准确率、小挑战生成明细公示。</div>
          <div className="dr-tip">大龄版：基于明细版展示，词王相关数据改用重复环节准确率。</div>
          <div className="dr-tip">
            {reportSourceMode === 'auto' && AUTO_REPORT_ENABLED
              ? '教务系统数据已自动准备：确认默认周挑战后直接导出；每日打卡只接受接口明细，拿不到可信数据时会明确降级。'
              : '上传模式：手里已有 Excel 时直接生成。'}
          </div>
        </div>

        {error && <div className="dr-error">{error}</div>}
        {success && <div className="dr-success">{success}</div>}

        <button className={`dr-generate-btn${loading ? ' loading' : ''}`} onClick={generateReport} disabled={loading || !ready}>
          {loading ? '生成中...' : '导出公示 Excel'}
        </button>
      </div>
      {showReLogin && (
        <ReLoginModal
          defaultUsername={defaultUsername}
          onSuccess={() => {
            setShowReLogin(false);
            setSuccess('已连接教务系统，正在自动准备周挑战');
            if (reportSourceMode === 'auto') {
              void loadAutoWeekTasks();
            }
          }}
          onDismiss={() => {
            setShowReLogin(false);
            setError('需要先连接教务系统');
          }}
        />
      )}
    </div>
  );
}
