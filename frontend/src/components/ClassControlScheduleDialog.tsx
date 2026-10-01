import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ClassInfo, DayOfWeek } from '../types';
import {
  CLASS_DAYS,
  getOfficialClassControlSessions,
  getLegacyClassControlSessions,
  getSuggestedClassControlSessions,
  isClassControlScheduleConfirmed,
  OFFICIAL_TEACHER_SCHEDULE_ENABLED,
  saveConfirmedClassControlSchedule,
  type ClassControlSession,
  type OfficialTeacherScheduleMap,
} from '../services/classControlSchedule';

interface Props {
  open: boolean;
  classes: ClassInfo[];
  teacherName: string;
  officialSchedules: OfficialTeacherScheduleMap;
  scheduleError?: string;
  onClose: () => void;
  onSaved: () => void;
}

const EMPTY_SESSION: ClassControlSession = {
  day: '',
  time: '',
  campus: '',
  room: '',
  source: 'manual',
};

function normalizeTwoSessions(sessions: ClassControlSession[]): ClassControlSession[] {
  return [
    { ...(sessions[0] || EMPTY_SESSION) },
    { ...(sessions[1] || EMPTY_SESSION) },
  ];
}

export default function ClassControlScheduleDialog({
  open,
  classes,
  teacherName,
  officialSchedules,
  scheduleError,
  onClose,
  onSaved,
}: Props) {
  const [drafts, setDrafts] = useState<Record<string, ClassControlSession[]>>({});
  const firstConfirmation = classes.some((classInfo) => (
    !isClassControlScheduleConfirmed(classInfo.name, teacherName)
  ));

  useEffect(() => {
    if (!open) return;
    setDrafts(Object.fromEntries(classes.map((classInfo) => {
      const classCode = classInfo.name.toUpperCase();
      const sessions = getSuggestedClassControlSessions(classCode, officialSchedules[classCode] || [], teacherName);
      return [classCode, normalizeTwoSessions(sessions)];
    })));
  }, [classes, officialSchedules, open, teacherName]);

  if (!open) return null;

  function updateSession(classCode: string, sessionIndex: number, patch: Partial<ClassControlSession>) {
    setDrafts((current) => {
      const sessions = normalizeTwoSessions(current[classCode] || []);
      sessions[sessionIndex] = { ...sessions[sessionIndex], ...patch, source: 'manual' };
      return { ...current, [classCode]: sessions };
    });
  }

  function resetFromActiveSchedule(classCode: string) {
    const sessions = OFFICIAL_TEACHER_SCHEDULE_ENABLED
      ? getOfficialClassControlSessions(officialSchedules[classCode] || [])
      : getLegacyClassControlSessions(classCode);
    setDrafts((current) => ({ ...current, [classCode]: normalizeTwoSessions(sessions) }));
  }

  function handleSave() {
    for (const classInfo of classes) {
      const classCode = classInfo.name.toUpperCase();
      saveConfirmedClassControlSchedule(classCode, drafts[classCode] || [], teacherName);
    }
    onSaved();
    onClose();
  }

  return createPortal((
    <div className="class-control-dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="class-control-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="class-control-schedule-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="class-control-dialog-header">
          <div>
            <div className="class-control-kicker">课程时间</div>
            <h2 id="class-control-schedule-title">{firstConfirmation ? '首次确认班级上课安排' : '调整班级上课安排'}</h2>
            <p>{OFFICIAL_TEACHER_SCHEDULE_ENABLED
              ? '已从教务官网课表带入上课时间和教室。首次确认后不再打扰，之后可随时调整或重新按官网课表同步。'
              : '新学期官网课表仍在生成，当前先使用系统原课表。确认一次后不再打扰，之后仍可随时调整。'}</p>
            {scheduleError && <p className="class-control-schedule-error">{scheduleError}</p>}
          </div>
          <button className="class-control-dialog-close" onClick={onClose} aria-label="关闭">×</button>
        </header>

        <div className="class-control-schedule-list">
          {classes.map((classInfo) => {
            const classCode = classInfo.name.toUpperCase();
            const sessions = normalizeTwoSessions(drafts[classCode] || []);
            const officialSlots = officialSchedules[classCode] || [];
            const scheduleDates = officialSlots.map((slot) => slot.latestDate || slot.date).filter(Boolean).sort();
            const latestDate = scheduleDates[scheduleDates.length - 1] || '';
            return (
              <article className="class-control-schedule-card" key={classCode}>
                <div className="class-control-schedule-title-row">
                  <strong>{classCode}</strong>
                  <div className="class-control-schedule-source">
                    <span>{OFFICIAL_TEACHER_SCHEDULE_ENABLED
                      ? officialSlots.length > 0
                        ? `官网课表已读取 ${officialSlots.length} 个课次${latestDate ? ` · 更新到 ${latestDate}` : ''}`
                        : '官网课表暂未生成，请手动补充'
                      : '当前使用系统原课表，可手动修改'}</span>
                    {(!OFFICIAL_TEACHER_SCHEDULE_ENABLED || officialSlots.length > 0) && (
                      <button type="button" onClick={() => resetFromActiveSchedule(classCode)}>
                        {OFFICIAL_TEACHER_SCHEDULE_ENABLED ? '按课表重置' : '按原课表重置'}
                      </button>
                    )}
                  </div>
                </div>
                <div className="class-control-session-grid">
                  {sessions.map((session, index) => (
                    <div className="class-control-session-row" key={`${classCode}-${index}`}>
                      <span className="class-control-session-label">第{index + 1}次课</span>
                      <select
                        aria-label={`${classCode}第${index + 1}次课星期`}
                        value={session.day}
                        onChange={(event) => updateSession(classCode, index, { day: event.target.value as DayOfWeek | '' })}
                      >
                        <option value="">选择星期</option>
                        {CLASS_DAYS.map((day) => <option value={day} key={day}>{day}</option>)}
                      </select>
                      <input
                        aria-label={`${classCode}第${index + 1}次课时间`}
                        type="time"
                        value={session.time}
                        onChange={(event) => updateSession(classCode, index, { time: event.target.value })}
                      />
                      <input
                        aria-label={`${classCode}第${index + 1}次课校区`}
                        value={session.campus}
                        placeholder="校区"
                        onChange={(event) => updateSession(classCode, index, { campus: event.target.value })}
                      />
                      <input
                        aria-label={`${classCode}第${index + 1}次课教室`}
                        value={session.room}
                        placeholder="教室"
                        onChange={(event) => updateSession(classCode, index, { room: event.target.value })}
                      />
                    </div>
                  ))}
                </div>
              </article>
            );
          })}
        </div>

        <footer className="class-control-dialog-actions">
          <button className="btn btn-ghost" onClick={onClose}>稍后确认</button>
          <button className="btn btn-primary" onClick={handleSave}>确认课程安排</button>
        </footer>
      </section>
    </div>
  ), document.body);
}
