import { useEffect, useMemo, useState } from 'react';
import { L2_DAILY_SCHEDULE } from '../data/l2DailySchedule';
import type { CampMajorLevel } from '../data/campReportCatalog';
import {
  CAMP_THEME_UPDATED_EVENT,
  buildCampThemeVars,
  resolveCampReportTheme,
} from '../utils/campReportTheme';
import { loadCampReportThemeConfigs, loadSummerCampLaunchPreference, saveSummerCampLaunchPreference } from '../utils/campReportStorage';
import './CampScheduleApp.css';

interface OpenReportOptions {
  majorCamp: CampMajorLevel;
  minorCamp: string;
  reportDate?: string;
}

interface Props {
  onBack: () => void;
  onOpenReport: (options?: OpenReportOptions) => void;
  onOpenSeating: () => void;
}

type ViewMode = 'external' | 'internal';

interface LessonSlot {
  period: number;
  internalCourse: string;
  externalCourse: string;
  teacher: string;
  room: string;
  kind: 'course' | 'activity' | 'empty';
  activityKey: string;
  activityLocation: string;
  activityTitle: string;
  activityDescription: string;
  activitySupplies: string;
}

interface DayData {
  date: string;
  slots: LessonSlot[];
}

interface CampData {
  camp: string;
  classroom: string;
  days: DayData[];
}

const SCHEDULE_DATA = L2_DAILY_SCHEDULE as unknown as readonly CampData[];

const SCHEDULE_ROWS = [
  { type: 'lesson', period: 1, label: '第1节课', time: '8:30-9:20' },
  { type: 'transition', label: '课间', time: '9:20-9:30', internalOnly: true },
  { type: 'lesson', period: 2, label: '第2节课', time: '9:30-10:20' },
  { type: 'break', label: '大课间', time: '10:20-10:40' },
  { type: 'lesson', period: 3, label: '第3节课', time: '10:40-11:30' },
  { type: 'transition', label: '课间', time: '11:30-11:40', internalOnly: true },
  { type: 'lesson', period: 4, label: '第4节课', time: '11:40-12:30' },
  { type: 'lunch', label: '午休', time: '12:30-13:30' },
  { type: 'lesson', period: 5, label: '第5节课', time: '13:40-14:30' },
  { type: 'transition', label: '课间', time: '14:30-14:40', internalOnly: true },
  { type: 'lesson', period: 6, label: '第6节课', time: '14:40-15:30' },
  { type: 'transition', label: '课间', time: '15:30-15:40', internalOnly: true },
  { type: 'lesson', period: 7, label: '第7节课', time: '15:40-16:30' },
] as const;

function formatDateLabel(date: string) {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  const weekday = '日一二三四五六'[parsed.getDay()];
  return `${parsed.getMonth() + 1}月${parsed.getDate()}日 周${weekday}`;
}

function getCampNumber(camp: string) {
  const match = camp.match(/\d+/);
  return match ? Number(match[0]) : 1;
}

function getMinorCampFromCampName(camp: string) {
  return `Camp ${getCampNumber(camp)}`;
}

function getScheduleCampNameFromMinorCamp(minorCamp: string | undefined) {
  const campName = `营${getCampNumber(minorCamp || '')}`;
  return SCHEDULE_DATA.find((camp) => camp.camp === campName)?.camp || SCHEDULE_DATA[0]?.camp || '营1';
}

function getInitialScheduleSelection() {
  const launchPreference = loadSummerCampLaunchPreference();
  const initialCampName = launchPreference?.majorCamp === 'L2'
    ? getScheduleCampNameFromMinorCamp(launchPreference.minorCamp)
    : SCHEDULE_DATA[0]?.camp || '营1';
  const initialCamp = SCHEDULE_DATA.find((camp) => camp.camp === initialCampName) || SCHEDULE_DATA[0];
  const initialDate = launchPreference?.reportDate
    && initialCamp?.days.some((day) => day.date === launchPreference.reportDate)
    ? launchPreference.reportDate
    : initialCamp?.days[0]?.date || '2026-07-20';
  return { campName: initialCampName, selectedDate: initialDate };
}

function getLessonSlot(day: DayData | undefined, period: number) {
  return day?.slots.find((slot) => slot.period === period) || null;
}

function uniqueActivitySlots(slots: readonly LessonSlot[]) {
  const seen = new Set<string>();
  return slots.filter((slot) => {
    if (slot.kind !== 'activity' || !slot.activityKey) return false;
    const key = `${slot.activityKey}:${slot.activityLocation}:${slot.activitySupplies}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getSlotTitle(slot: LessonSlot, viewMode: ViewMode) {
  return viewMode === 'external' ? slot.externalCourse : slot.internalCourse;
}

export default function CampScheduleApp({ onBack, onOpenReport, onOpenSeating }: Props) {
  const [initialSelection] = useState(() => getInitialScheduleSelection());
  const [themeConfigs, setThemeConfigs] = useState(() => loadCampReportThemeConfigs());
  const [campName, setCampName] = useState<string>(() => initialSelection.campName);
  const [selectedDate, setSelectedDate] = useState<string>(() => initialSelection.selectedDate);
  const [viewMode, setViewMode] = useState<ViewMode>('external');

  const themeVars = useMemo(
    () => buildCampThemeVars(resolveCampReportTheme('L2', themeConfigs)),
    [themeConfigs],
  );

  useEffect(() => {
    const refreshTheme = () => setThemeConfigs(loadCampReportThemeConfigs());
    window.addEventListener(CAMP_THEME_UPDATED_EVENT, refreshTheme);
    window.addEventListener('storage', refreshTheme);
    return () => {
      window.removeEventListener(CAMP_THEME_UPDATED_EVENT, refreshTheme);
      window.removeEventListener('storage', refreshTheme);
    };
  }, []);

  const selectedCamp = useMemo(
    () => SCHEDULE_DATA.find((camp) => camp.camp === campName) || SCHEDULE_DATA[0],
    [campName],
  );
  const selectedDay = useMemo(
    () => selectedCamp?.days.find((day) => day.date === selectedDate) || selectedCamp?.days[0],
    [selectedCamp, selectedDate],
  );
  const selectedDayIndex = selectedCamp?.days.findIndex((day) => day.date === selectedDay?.date) ?? -1;
  const nextDay = selectedDayIndex >= 0 ? selectedCamp?.days[selectedDayIndex + 1] : undefined;
  const todayActivities = uniqueActivitySlots(selectedDay?.slots || []);
  const nextActivities = uniqueActivitySlots(nextDay?.slots || []);
  const emptySlots = selectedDay?.slots.filter((slot) => slot.kind === 'empty') || [];

  useEffect(() => {
    if (!selectedCamp?.days.some((day) => day.date === selectedDate)) {
      setSelectedDate(selectedCamp?.days[0]?.date || selectedDate);
    }
  }, [selectedCamp, selectedDate]);

  useEffect(() => {
    if (!selectedDay?.date) return;
    saveSummerCampLaunchPreference({
      majorCamp: 'L2',
      minorCamp: getMinorCampFromCampName(selectedCamp?.camp || campName),
      reportDate: selectedDay.date,
      lastTool: 'report',
    });
  }, [campName, selectedCamp?.camp, selectedDay?.date]);

  return (
    <div className="camp-schedule-wrap fade-in" style={themeVars}>
      <button className="tool-home-rail camp-schedule-back" onClick={onBack}>
        <span className="tool-home-rail-icon">←</span>
        <span>返回夏令营</span>
      </button>

      <main className="camp-schedule-shell">
        <header className="camp-schedule-head">
          <div>
            <span className="camp-schedule-kicker">L2 Sparkchat · Schedule</span>
            <h1>当日课表</h1>
            <p>L2 单营当日安排：课表、活动预告、日报与座位表入口集中查看。</p>
          </div>

          <div className="camp-schedule-controls" aria-label="课表筛选">
            <label>
              <span>营号</span>
              <select value={campName} onChange={(event) => setCampName(event.target.value)}>
                {SCHEDULE_DATA.map((camp) => (
                  <option key={camp.camp} value={camp.camp}>{camp.camp}</option>
                ))}
              </select>
            </label>
            <label>
              <span>日期</span>
              <select value={selectedDay?.date || selectedDate} onChange={(event) => setSelectedDate(event.target.value)}>
                {selectedCamp?.days.map((day) => (
                  <option key={day.date} value={day.date}>{formatDateLabel(day.date)}</option>
                ))}
              </select>
            </label>
            <div className="camp-schedule-view-toggle" role="group" aria-label="视角切换">
              <button className={viewMode === 'external' ? 'active' : ''} onClick={() => setViewMode('external')}>家长版</button>
              <button className={viewMode === 'internal' ? 'active' : ''} onClick={() => setViewMode('internal')}>内部版</button>
            </div>
          </div>
        </header>

        <section className="camp-schedule-layout">
          <section className="camp-day-card" aria-label="单营当日课表">
            <div className="camp-day-top">
              <div>
                <span>L2 · Camp {getCampNumber(selectedCamp?.camp || campName)}</span>
                <h2>{selectedCamp?.camp || campName}课表</h2>
              </div>
              <div className="camp-day-room">
                <small>固定教室</small>
                <strong>{selectedCamp?.classroom || '待确认'}</strong>
              </div>
            </div>

            <div className="camp-day-date-line">
              <strong>{selectedDay ? formatDateLabel(selectedDay.date) : selectedDate}</strong>
              <span>{viewMode === 'external' ? '家长展示版：只保留课程与活动信息' : '内部管理版：老师、地点、空课与课间留白'}</span>
            </div>

            <div className="camp-timeline">
              {SCHEDULE_ROWS.map((row) => {
                if ('internalOnly' in row && row.internalOnly && viewMode !== 'internal') {
                  return null;
                }

                if (row.type !== 'lesson') {
                  const restTitle = row.type === 'lunch' ? '午休' : '课间留白';
                  const restCopy = viewMode === 'internal'
                    ? '留给课件、转场或临时补充安排。'
                    : '孩子休整时间。';
                  return (
                    <article key={`${row.type}:${row.time}`} className={`camp-timeline-row is-${row.type}`}>
                      <div className="camp-time-block">
                        <strong>{row.label}</strong>
                        <span>{row.time}</span>
                      </div>
                      <div className="camp-slot-card">
                        <strong>{restTitle}</strong>
                        <span>{restCopy}</span>
                      </div>
                    </article>
                  );
                }

                const slot = getLessonSlot(selectedDay, row.period);
                const title = slot ? getSlotTitle(slot, viewMode) : '待安排';
                return (
                  <article key={`lesson:${row.period}`} className={`camp-timeline-row is-${slot?.kind || 'missing'}`}>
                    <div className="camp-time-block">
                      <strong>{row.label}</strong>
                      <span>{row.time}</span>
                    </div>
                    <div className="camp-slot-card">
                      <div className="camp-slot-main">
                        <strong>{title}</strong>
                        {slot?.kind === 'activity' && <span className="camp-slot-pill">活动课</span>}
                        {slot?.kind === 'empty' && viewMode === 'internal' && <span className="camp-slot-pill danger">待解决</span>}
                      </div>
                      {viewMode === 'internal' && slot && (
                        <div className="camp-slot-meta">
                          {slot.teacher && <span>师：{slot.teacher}</span>}
                          {slot.kind === 'activity'
                            ? <span>活动地点：{slot.activityLocation || '待确认'}</span>
                            : slot.room && <span>地：{slot.room}</span>}
                        </div>
                      )}
                      {viewMode === 'external' && slot?.kind === 'activity' && (
                        <div className="camp-slot-meta">
                          <span>{slot.activityTitle || slot.activityKey}</span>
                        </div>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>

          <aside className="camp-schedule-side">
            <section className="camp-side-panel camp-side-actions">
              <span className="camp-side-label">Today Tools</span>
              <h2>今日操作</h2>
              <button
                className="camp-side-primary"
                onClick={() => onOpenReport({
                  majorCamp: 'L2',
                  minorCamp: getMinorCampFromCampName(selectedCamp?.camp || campName),
                  reportDate: selectedDay?.date,
                })}
              >
                进入日报
              </button>
              <button onClick={onOpenSeating}>进入座位表</button>
            </section>

            <section className="camp-side-panel">
              <span className="camp-side-label">Activity</span>
              <h2>今日活动</h2>
              {todayActivities.length > 0 ? (
                todayActivities.map((activity) => (
                  <article className="camp-activity-card" key={`${activity.activityKey}:${activity.period}`}>
                    <div>
                      <strong>{activity.activityTitle || activity.activityKey}</strong>
                      <span>{activity.activityLocation || '地点待确认'}</span>
                    </div>
                    <p>{activity.activityDescription}</p>
                    <small>物资：{activity.activitySupplies || '无需额外准备物资。'}</small>
                  </article>
                ))
              ) : (
                <p className="camp-muted-copy">今天没有匹配到活动课。</p>
              )}
              {viewMode === 'internal' && emptySlots.length > 0 && (
                <div className="camp-empty-note">
                  <strong>内部空课</strong>
                  <span>{emptySlots.length} 节已标记为【空课，待解决】。</span>
                </div>
              )}
            </section>

            <section className="camp-side-panel">
              <span className="camp-side-label">Report Preview</span>
              <h2>日报活动预告</h2>
              {nextDay && nextActivities.length > 0 ? (
                <>
                  <p className="camp-muted-copy">{formatDateLabel(nextDay.date)} 将自动带入这些提醒。</p>
                  {nextActivities.map((activity) => (
                    <article className="camp-report-preview-card" key={`${nextDay.date}:${activity.activityKey}:${activity.period}`}>
                      <strong>{activity.activityTitle || activity.activityKey}</strong>
                      <p>{activity.activityDescription}</p>
                      <span>明天准备：{activity.activitySupplies || '无需额外准备物资。'}</span>
                    </article>
                  ))}
                </>
              ) : (
                <p className="camp-muted-copy">下一上课日暂无活动课，日报里不插入活动物资提醒。</p>
              )}
            </section>
          </aside>
        </section>
      </main>
    </div>
  );
}
