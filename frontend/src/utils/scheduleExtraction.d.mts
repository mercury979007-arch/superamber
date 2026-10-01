import type { MakeupDataset } from '../types/makeup';
export const EXTRACTION_VERSION: string;
export function scheduleWeek(date:string,week1Start:string):number;
export function unavailableStageMessage(stage?:string,available?:string[]):string;
export function extractScheduleWorkbook(workbook:{filename:string;sheets:{name:string;rows:unknown[][];merges?:unknown[]}[]},options:{stage?:string;calendar:{academicYear:number;week1Start:string};columnMappings?:Record<string,Record<number,string>>}):MakeupDataset;
