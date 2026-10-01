import { useEffect, useMemo, useState } from 'react';
import type { ClassInfo } from '../types';
import { appendSeatingTodoNote, loadSeatingNotesByClass } from '../services/seatingStorage';
import { loadWelcomeTodoMeta, saveWelcomeTodoMeta } from '../services/welcomeStorage';
import { buildTodoItems, getNextDateForClassDays, toDateKey } from '../services/welcomeTodoRules';
import { getClassDays } from '../utils/classSchedule';
import { getCurrentWeek } from '../utils/weekNumber';

export function useWelcomeTodoState(classes: ClassInfo[]) {
  const [meta, setMeta] = useState(loadWelcomeTodoMeta);
  const [storageUnavailable, setStorageUnavailable] = useState(false);
  const [notesVersion, setNotesVersion] = useState(0);
  const [weeklyClass, setWeeklyClass] = useState('');
  const [weeklyNote, setWeeklyNote] = useState('');

  useEffect(() => {
    setStorageUnavailable(!saveWelcomeTodoMeta(meta));
  }, [meta]);

  const classDaysByCode = useMemo(
    () => Object.fromEntries(classes.map((item) => [item.name.toUpperCase(), getClassDays(item.name)])),
    [classes],
  );
  const notesByClass = useMemo(() => loadSeatingNotesByClass(), [notesVersion]);
  const items = useMemo(
    () => buildTodoItems({ classes, classDaysByCode, meta, notesByClass }),
    [classes, classDaysByCode, meta, notesByClass],
  );

  const currentWeek = getCurrentWeek();
  const weeklyDone = meta.weeklyConfirmedWeek === currentWeek;
  const pendingCount = items.filter((item) => !item.done).length;

  function setEnabled(enabled: boolean) {
    setMeta((current) => ({ ...current, enabled }));
  }

  function toggleDone(itemKey: string) {
    const todayKey = toDateKey();
    setMeta((current) => {
      const completed = new Set(current.completedByDate[todayKey] || []);
      if (completed.has(itemKey)) completed.delete(itemKey);
      else completed.add(itemKey);

      return {
        ...current,
        completedByDate: {
          ...current.completedByDate,
          [todayKey]: Array.from(completed),
        },
      };
    });
  }

  function handleWeeklyConfirm() {
    if (weeklyClass && weeklyNote.trim()) {
      appendSeatingTodoNote(
        weeklyClass,
        weeklyNote.trim(),
        getNextDateForClassDays(classDaysByCode[weeklyClass.toUpperCase()] || [], new Date()),
        'weekly',
      );
      setWeeklyNote('');
      setWeeklyClass('');
      setNotesVersion((value) => value + 1);
    }

    setMeta((current) => ({
      ...current,
      weeklyConfirmedWeek: currentWeek,
      weeklyConfirmedAt: new Date().toISOString(),
    }));
  }

  return {
    storageUnavailable,
    enabled: meta.enabled,
    weeklyDone,
    weeklyClass,
    weeklyNote,
    items,
    pendingCount,
    setEnabled,
    setWeeklyClass,
    setWeeklyNote,
    toggleDone,
    handleWeeklyConfirm,
  };
}
