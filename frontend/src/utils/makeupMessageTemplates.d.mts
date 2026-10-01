import type { MakeupOccurrence } from '../types/makeup';
export function generateParentMessage(origin: MakeupOccurrence, target: MakeupOccurrence, studentName: string, options?: {specialMode?: boolean}): string;
export function generateTeacherMessage(origin: MakeupOccurrence, target: MakeupOccurrence, studentName: string, options?: {specialMode?: boolean}): string;
