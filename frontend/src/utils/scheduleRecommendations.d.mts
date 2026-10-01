import type { MakeupDataset, MakeupOccurrence } from '../types/makeup';
export function recommendScheduleMakeup(dataset:MakeupDataset,text:string,now?:Date):{status:string;message:string;origin?:MakeupOccurrence;candidates:MakeupOccurrence[]};
export function makeupCandidateLine(candidate: MakeupOccurrence): string;
