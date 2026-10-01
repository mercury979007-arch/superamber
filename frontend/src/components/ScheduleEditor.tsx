import { useState } from 'react';
import type { ClassInfo, DayOfWeek } from '../types';
import { ALL_DAYS, WeeklySchedule, loadWeeklySchedule, saveWeeklySchedule } from '../utils/classSchedule';
import './ScheduleEditor.css';

interface Props {
  classes: ClassInfo[];
  onClose: () => void;
  onSaved: () => void;
}

export default function ScheduleEditor({ classes, onClose, onSaved }: Props) {
  const [schedule, setSchedule] = useState<WeeklySchedule>(() => loadWeeklySchedule());

  function getList(day: DayOfWeek): string[] {
    return schedule[day] ?? [];
  }

  function update(day: DayOfWeek, list: string[]) {
    const next = { ...schedule, [day]: list };
    setSchedule(next);
  }

  function addToDay(day: DayOfWeek, classCode: string) {
    if (!classCode) return;
    const list = getList(day);
    if (!list.includes(classCode)) update(day, [...list, classCode]);
  }

  function removeFromDay(day: DayOfWeek, classCode: string) {
    update(day, getList(day).filter((c) => c !== classCode));
  }

  function moveUp(day: DayOfWeek, idx: number) {
    if (idx === 0) return;
    const list = [...getList(day)];
    [list[idx - 1], list[idx]] = [list[idx], list[idx - 1]];
    update(day, list);
  }

  function moveDown(day: DayOfWeek, idx: number) {
    const list = getList(day);
    if (idx >= list.length - 1) return;
    const next = [...list];
    [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
    update(day, next);
  }

  function handleSave() {
    saveWeeklySchedule(schedule);
    onSaved();
    onClose();
  }

  return (
    <div className="se-wrap card fade-in">
      <div className="se-header">
        <span className="se-title">管理上课时间</span>
        <span className="se-hint">为每天分配班级并拖动排序，未添加的班级排在最后</span>
      </div>

      <div className="se-days">
        {ALL_DAYS.map((day) => {
          const list = getList(day);
          const available = classes.map((c) => c.name).filter((n) => !list.includes(n));
          return (
            <div key={day} className="se-day-row">
              <div className="se-day-label">{day}</div>
              <div className="se-day-classes">
                {list.map((code, i) => (
                  <div key={code} className="se-class-chip">
                    <span>{code}</span>
                    <div className="se-chip-btns">
                      <button className="se-arrow" onClick={() => moveUp(day, i)} disabled={i === 0}>↑</button>
                      <button className="se-arrow" onClick={() => moveDown(day, i)} disabled={i === list.length - 1}>↓</button>
                      <button className="se-remove" onClick={() => removeFromDay(day, code)}>×</button>
                    </div>
                  </div>
                ))}
                {available.length > 0 && (
                  <select
                    className="se-add-select"
                    value=""
                    onChange={(e) => { addToDay(day, e.target.value); e.target.value = ''; }}
                  >
                    <option value="">＋ 添加班级</option>
                    {available.map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="se-actions">
        <button className="btn btn-ghost btn-sm" onClick={onClose}>取消</button>
        <button className="btn btn-primary btn-sm" onClick={handleSave}>保存</button>
      </div>
    </div>
  );
}
