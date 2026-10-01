import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { resolveSeatingKey } from '../utils/classProfiles';
import { loadCampReportThemeConfigs, loadSummerCampLaunchPreference } from '../utils/campReportStorage';
import { buildCampThemeVars, CAMP_THEME_UPDATED_EVENT, resolveCampReportTheme } from '../utils/campReportTheme';
import SummerCampThemeManager from './SummerCampThemeManager';

interface Props {
  classCode: string;
  classes?: { id: string; name: string }[];
  onBack: () => void;
  onBackToHome?: () => void;
  onSwitchClass?: (name: string) => void;
  active: boolean;
  siteMode?: 'standard' | 'summer-camp';
}

const DAILY_SCHEDULE_URL = 'https://example.invalid/public-pages/daily/index.html';
const DAILY_SCHEDULE_DATA_URL = '/assets/l2-daily-schedule-data.js';
const SUMMER_CAMP_SELECTION_CHANGE_EVENT = 'superamber:summer-camp-selection-change';

type ScheduleReminder = {
  date: string;
  camp: string;
  period?: string;
  time?: string;
  display?: string;
  activityName?: string;
  location?: string;
  teacherReminder?: string;
  attachment?: string;
};

type DailyScheduleData = {
  dates?: string[];
  classActivityReminders?: ScheduleReminder[];
};

type ScheduleContext = {
  majorCamp: string;
  camp: string;
  reportDate?: string;
};

type ScheduleDateTarget = {
  label: string;
  iso: string;
  title: string;
};

function resolveScheduleContext(classCode: string): ScheduleContext {
  const preference = loadSummerCampLaunchPreference();
  const fromClassCode = extractCampNumber(classCode);
  const fromPreference = extractCampNumber(preference?.minorCamp || '');
  const campNumber = fromClassCode || fromPreference || '1';

  return {
    majorCamp: preference?.majorCamp || 'L2',
    camp: `营${Number(campNumber)}`,
    reportDate: preference?.reportDate,
  };
}

function resolveScheduleContextFromSelection(
  majorCamp: string,
  minorCamp: string,
  fallback: ScheduleContext,
  reportDate?: string,
): ScheduleContext {
  const campNumber = extractCampNumber(minorCamp) || extractCampNumber(fallback.camp) || '1';
  return {
    majorCamp: String(majorCamp || fallback.majorCamp || 'L2').trim() || 'L2',
    camp: `营${Number(campNumber)}`,
    reportDate: normalizeIsoDate(reportDate || fallback.reportDate || ''),
  };
}

function readEmbeddedScheduleContext(host: HTMLDivElement | null, classCode: string): ScheduleContext {
  const fallback = resolveScheduleContext(classCode);
  const root = host?.shadowRoot;
  if (!root) {
    return fallback;
  }

  const major = root.querySelector<HTMLSelectElement>('#summerCampMajorSelect')?.value || fallback.majorCamp;
  const minor = root.querySelector<HTMLSelectElement>('#summerCampMinorSelect')?.value || fallback.camp;
  const reportDate = root.querySelector<HTMLSelectElement>('#summerCampDateSelect')?.value || fallback.reportDate;
  return resolveScheduleContextFromSelection(major, minor, fallback, reportDate);
}

function extractCampNumber(value: string) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.match(/营\s*(\d+)/)?.[1]
    || raw.match(/camp\s*(\d+)/i)?.[1]
    || raw.match(/(\d+)/)?.[1]
    || '';
}

function pad2(value: number) {
  return String(value).padStart(2, '0');
}

function getShanghaiIsoDate(offsetDays = 0) {
  const base = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
  base.setDate(base.getDate() + offsetDays);
  return `${base.getFullYear()}-${pad2(base.getMonth() + 1)}-${pad2(base.getDate())}`;
}

function dateLabelToIso(label: string) {
  const match = String(label || '').match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (!match) return '';
  return `${match[1]}-${pad2(Number(match[2]))}-${pad2(Number(match[3]))}`;
}

function normalizeIsoDate(value: string) {
  const raw = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return dateLabelToIso(raw);
}

function resolveScheduleDateTargets(data: DailyScheduleData): ScheduleDateTarget[] {
  const dates = (data.dates || [])
    .map((label) => ({ label, iso: dateLabelToIso(label) }))
    .filter((item) => item.iso)
    .sort((a, b) => a.iso.localeCompare(b.iso));
  if (dates.length === 0) return [];

  const tomorrowIso = getShanghaiIsoDate(1);
  const tomorrow = dates.find((date) => date.iso === tomorrowIso);
  if (tomorrow) {
    return [{ ...tomorrow, title: '明天活动课' }];
  }

  const todayIso = getShanghaiIsoDate(0);
  const next = dates.find((date) => date.iso > todayIso) || dates[0];
  return next ? [{ ...next, title: '下一上课日活动课' }] : [];
}

function resolveScheduleReminderMessage(title: string) {
  if (title === '明天活动课') return '明天没有具体活动课。';
  return '这一天没有具体活动课。';
}

function scheduleReminderKey(item: ScheduleReminder, index: number) {
  return `${item.date}-${item.camp}-${item.period}-${item.time}-${item.activityName}-${index}`;
}

function remindersForTarget(data: DailyScheduleData, camp: string, target: ScheduleDateTarget) {
  return (data.classActivityReminders || []).filter((item) => (
    item.camp === camp && item.date === target.label
  ));
}

function buildDailyScheduleUrl(camp: string, isoDate: string) {
  const params = new URLSearchParams({ camp, date: isoDate });
  return `${DAILY_SCHEDULE_URL}?${params.toString()}`;
}

function loadDailyScheduleData(): Promise<DailyScheduleData> {
  const scheduleWindow = window as Window & {
    L2_SCHEDULE_DATA?: DailyScheduleData;
    __L2_DAILY_SCHEDULE_PROMISE__?: Promise<DailyScheduleData>;
  };

  if (scheduleWindow.L2_SCHEDULE_DATA?.classActivityReminders) {
    return Promise.resolve(scheduleWindow.L2_SCHEDULE_DATA);
  }
  if (scheduleWindow.__L2_DAILY_SCHEDULE_PROMISE__) {
    return scheduleWindow.__L2_DAILY_SCHEDULE_PROMISE__;
  }

  scheduleWindow.__L2_DAILY_SCHEDULE_PROMISE__ = fetch(`${DAILY_SCHEDULE_DATA_URL}?v=${Date.now()}`, { cache: 'no-store' })
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`日程数据加载失败：${response.status}`);
      }
      const text = await response.text();
      const jsonText = text
        .replace(/^\s*window\.L2_SCHEDULE_DATA\s*=\s*/, '')
        .replace(/;\s*$/, '');
      const nextData = JSON.parse(jsonText) as DailyScheduleData;
      scheduleWindow.L2_SCHEDULE_DATA = nextData;
      return nextData;
    })
    .catch((error) => {
      scheduleWindow.__L2_DAILY_SCHEDULE_PROMISE__ = undefined;
      throw error;
    });

  return scheduleWindow.__L2_DAILY_SCHEDULE_PROMISE__;
}

export default function NewestSeatingFrame({ classCode, classes, onBack, onBackToHome, onSwitchClass, active, siteMode = 'standard' }: Props) {
  const seatingKey = classCode ? (resolveSeatingKey(classCode) ?? classCode) : '';
  const isSummerCampMode = siteMode === 'summer-camp';
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [loadError, setLoadError] = useState('');
  const [seatingReady, setSeatingReady] = useState(false);
  const [themePanelOpen, setThemePanelOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleError, setScheduleError] = useState('');
  const [scheduleData, setScheduleData] = useState<DailyScheduleData | null>(null);
  const [themeConfigs, setThemeConfigs] = useState(() => loadCampReportThemeConfigs());
  const [scheduleContext, setScheduleContext] = useState(() => resolveScheduleContext(classCode));
  const syncScheduleContext = useCallback(() => {
    setScheduleContext((current) => {
      const next = isSummerCampMode
        ? readEmbeddedScheduleContext(hostRef.current, classCode)
        : resolveScheduleContext(classCode);
      return next.majorCamp === current.majorCamp
        && next.camp === current.camp
        && next.reportDate === current.reportDate
        ? current
        : next;
    });
  }, [classCode, isSummerCampMode]);
  const scheduleDateTargets = useMemo(
    () => (scheduleData ? resolveScheduleDateTargets(scheduleData) : []),
    [scheduleData],
  );
  const primaryScheduleDate = scheduleDateTargets[0] || null;
  const scheduleSections = useMemo(() => {
    if (!scheduleData) return [];
    return scheduleDateTargets.map((target) => ({
      ...target,
      reminders: remindersForTarget(scheduleData, scheduleContext.camp, target),
    }));
  }, [scheduleContext.camp, scheduleData, scheduleDateTargets]);
  const currentTheme = useMemo(() => resolveCampReportTheme('L2', themeConfigs), [themeConfigs]);
  const themeVars = useMemo(() => buildCampThemeVars(currentTheme), [currentTheme]);
  const seatingThemeVars = useMemo(
    () => Object.fromEntries(
      Object.entries(themeVars).filter(([, value]) => typeof value === 'string'),
    ) as Record<string, string>,
    [themeVars],
  );

  useEffect(() => {
    const handleThemeUpdate = () => setThemeConfigs(loadCampReportThemeConfigs());
    window.addEventListener(CAMP_THEME_UPDATED_EVENT, handleThemeUpdate);
    window.addEventListener('storage', handleThemeUpdate);
    return () => {
      window.removeEventListener(CAMP_THEME_UPDATED_EVENT, handleThemeUpdate);
      window.removeEventListener('storage', handleThemeUpdate);
    };
  }, []);

  useEffect(() => {
    if (!isSummerCampMode) {
      setScheduleContext(resolveScheduleContext(classCode));
      return;
    }

    const handleSelectionChange = (event: Event) => {
      const detail = (event as CustomEvent<{
        majorCamp?: string;
        minorCamp?: string;
        camp?: string;
        reportDate?: string;
      }>).detail;
      if (detail?.majorCamp || detail?.minorCamp || detail?.camp || detail?.reportDate) {
        setScheduleContext((current) => {
          const next = resolveScheduleContextFromSelection(
            detail.majorCamp || current.majorCamp,
            detail.minorCamp || detail.camp || current.camp,
            current,
            detail.reportDate || current.reportDate,
          );
          return next.majorCamp === current.majorCamp
            && next.camp === current.camp
            && next.reportDate === current.reportDate
            ? current
            : next;
        });
        return;
      }
      syncScheduleContext();
    };

    window.addEventListener(SUMMER_CAMP_SELECTION_CHANGE_EVENT, handleSelectionChange);
    const initialSyncTimer = window.setTimeout(syncScheduleContext, 300);
    return () => {
      window.removeEventListener(SUMMER_CAMP_SELECTION_CHANGE_EVENT, handleSelectionChange);
      window.clearTimeout(initialSyncTimer);
    };
  }, [classCode, isSummerCampMode, syncScheduleContext]);

  useEffect(() => {
    if (!scheduleOpen || scheduleData) {
      return;
    }

    let cancelled = false;
    setScheduleLoading(true);
    setScheduleError('');

    loadDailyScheduleData()
      .then((nextData) => {
        if (!cancelled) setScheduleData(nextData);
      })
      .catch((error) => {
        if (!cancelled) setScheduleError(error instanceof Error ? error.message : '日程数据加载失败');
      })
      .finally(() => {
        if (!cancelled) setScheduleLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [scheduleData, scheduleOpen]);

  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | undefined;

    async function mountEmbeddedApp() {
      if (!hostRef.current) {
        return;
      }

      setLoadError('');
      setSeatingReady(false);

      try {
        const { mountSuperamberApp } = await import('../seating/embed');
        if (cancelled || !hostRef.current) {
          return;
        }

        cleanup = mountSuperamberApp(hostRef.current, {
          launchClassName: seatingKey,
          availableClassNames: classes?.map((item) => item.name) || [],
          embedded: true,
          setDocumentTitle: false,
          siteMode,
          defaultLayout: isSummerCampMode ? 'camp' : undefined,
          campThemeVars: seatingThemeVars,
          onReady: () => {
            if (!cancelled) setSeatingReady(true);
          },
        });

      } catch (error) {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : '座位表加载失败');
        }
      }
    }

    void mountEmbeddedApp();

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [classes, isSummerCampMode, seatingKey, siteMode]);

  return (
    <div
      aria-hidden={!active}
      style={active ? {
        position: 'fixed',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        background: '#fff',
        zIndex: 50,
        ...themeVars,
      } : {
        position: 'absolute',
        inset: 0,
        width: 1,
        height: 1,
        overflow: 'hidden',
        opacity: 0,
        pointerEvents: 'none',
      }}
    >
      {active && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 16px',
          borderBottom: '1px solid rgba(221,217,208,0.4)',
          background: 'rgba(255,255,255,0.95)',
          flexShrink: 0,
        }}>
          {onBackToHome && (
            <button className="tool-home-rail" style={{ position: 'static' }} onClick={onBackToHome}>
              <span className="tool-home-rail-icon">←</span>
              <span>主页</span>
            </button>
          )}
          <button className="tool-back-btn" onClick={onBack}>← 返回</button>
          {classCode && classes && classes.length > 1 && onSwitchClass ? (
            <select className="tool-class-switch" value={classCode} onChange={(e) => onSwitchClass(e.target.value)}>
              {classes.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
            </select>
          ) : classCode ? (
            <span className="tool-class-switch" style={{ cursor: 'default' }}>{classCode}</span>
          ) : null}
          <span className="tool-topbar-label">· {isSummerCampMode ? '夏令营座位表' : '座位表'}</span>
          {isSummerCampMode && (
            <button
              type="button"
              className="tool-back-btn"
              style={{ marginLeft: 8 }}
              onClick={() => setThemePanelOpen((current) => !current)}
            >
              {themePanelOpen ? '收起配色' : '主题配色'}
            </button>
          )}
          {isSummerCampMode && scheduleContext.majorCamp === 'L2' && (
            <div className="schedule-peek-wrap">
              <button
                type="button"
                className={`schedule-peek-trigger${scheduleOpen ? ' is-open' : ''}`}
                onClick={() => {
                  syncScheduleContext();
                  setScheduleOpen((current) => !current);
                }}
              >
                日程查看
              </button>
              {scheduleOpen && (
                <section className="schedule-peek-panel" aria-label="明天活动课">
                  <div className="schedule-peek-head">
                    <div>
                      <span>{scheduleContext.camp}</span>
                      <strong>明天活动课</strong>
                    </div>
                    <button type="button" onClick={() => setScheduleOpen(false)}>×</button>
                  </div>
                  <div className="schedule-peek-body">
                    <div className="schedule-peek-list">
                      {scheduleLoading && <p className="schedule-peek-muted">正在读取最新日程...</p>}
                      {!scheduleLoading && scheduleError && <p className="schedule-peek-error">{scheduleError}</p>}
                      {!scheduleLoading && !scheduleError && scheduleSections.length > 0 && (
                        <>
                          {scheduleSections.map((section) => (
                            <div className="schedule-peek-section" key={section.iso}>
                              <p className="schedule-peek-date">{section.title} · {section.label}</p>
                              {section.reminders.length > 0 ? (
                                section.reminders.map((item, index) => (
                                  <article className="schedule-peek-item" key={scheduleReminderKey(item, index)}>
                                    <span>{[item.period, item.time].filter(Boolean).join(' · ')}</span>
                                    <strong>{item.activityName || item.display || '活动课'}</strong>
                                    <small>{[item.location, item.teacherReminder].filter(Boolean).join('｜')}</small>
                                    {item.attachment && <em>{item.attachment}</em>}
                                  </article>
                                ))
                              ) : (
                                <p className="schedule-peek-muted">{resolveScheduleReminderMessage(section.title)}</p>
                              )}
                            </div>
                          ))}
                        </>
                      )}
                      {!scheduleLoading && !scheduleError && scheduleSections.length === 0 && (
                        <p className="schedule-peek-muted">没有可匹配的活动日期。</p>
                      )}
                    </div>
                    {primaryScheduleDate && (
                      <a
                        className="schedule-peek-link"
                        href={buildDailyScheduleUrl(scheduleContext.camp, primaryScheduleDate.iso)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        跳转日程
                      </a>
                    )}
                  </div>
                </section>
              )}
            </div>
          )}
        </div>
      )}
      {active && isSummerCampMode && themePanelOpen && (
        <div style={{
          flexShrink: 0,
          padding: '12px 16px',
          borderBottom: '1px solid color-mix(in srgb, var(--camp-border) 80%, #ffffff)',
          background: 'color-mix(in srgb, var(--camp-paper) 88%, #ffffff)',
        }}>
          <SummerCampThemeManager compact onThemeChange={() => setThemeConfigs(loadCampReportThemeConfigs())} />
        </div>
      )}
      {active && loadError && (
        <div style={{ padding: 40, textAlign: 'center', color: '#c24d4d' }}>{loadError}</div>
      )}
      {active && !loadError && !seatingReady && (
        <div
          role="status"
          aria-live="polite"
          style={{
            flex: 1,
            display: 'grid',
            placeItems: 'center',
            color: '#537168',
            background: '#f7faf8',
            fontSize: 15,
          }}
        >
          正在打开座位表…
        </div>
      )}
      <div
        ref={hostRef}
        style={{
          flex: seatingReady ? 1 : 0,
          minHeight: 0,
          overflowY: 'auto',
          opacity: active && !loadError && seatingReady ? 1 : 0,
          pointerEvents: active && !loadError && seatingReady ? 'auto' : 'none',
          transition: 'opacity 0.2s',
        }}
      />
    </div>
  );
}
