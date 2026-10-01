import type { ClassInfo, DayOfWeek } from '../types';
import { getStudentCount } from '../utils/classProfiles';
import { ALL_DAYS, getClassDays, getClassTimeOnDay, getResolvedSchedule, sortClassesBySchedule } from '../utils/classSchedule';

export interface WelcomeClassCard {
  classInfo: ClassInfo;
  days: DayOfWeek[];
  studentCount: number;
}

export interface WelcomeDayClassCard {
  classInfo: ClassInfo;
  time: string;
  studentCount: number;
}

export interface WelcomeDayGroup {
  day: DayOfWeek;
  classes: WelcomeDayClassCard[];
}

export function buildWelcomeClassCards(classes: ClassInfo[]): WelcomeClassCard[] {
  return sortClassesBySchedule(classes).map((classInfo) => ({
    classInfo,
    days: getClassDays(classInfo.name),
    studentCount: getStudentCount(classInfo.name),
  }));
}

export function buildWelcomeDayGroups(displayClasses: ClassInfo[]): WelcomeDayGroup[] {
  const resolvedSchedule = getResolvedSchedule(displayClasses.map((item) => item.name));
  const result: WelcomeDayGroup[] = [];

  for (const day of ALL_DAYS) {
    const codes = resolvedSchedule[day] ?? [];
    if (codes.length === 0) continue;

    const classes = codes
      .map((code) => displayClasses.find((item) => item.name === code))
      .filter((item): item is ClassInfo => Boolean(item))
      .map((classInfo) => ({
        classInfo,
        time: getClassTimeOnDay(classInfo.name, day),
        studentCount: getStudentCount(classInfo.name),
      }));

    if (classes.length > 0) {
      result.push({ day, classes });
    }
  }

  return result;
}
