import type * as XLSX from 'xlsx';

let xlsxModulePromise: Promise<typeof import('xlsx')> | null = null;

export async function getXlsx(): Promise<typeof import('xlsx')> {
  if (!xlsxModulePromise) {
    xlsxModulePromise = import('xlsx');
  }
  return xlsxModulePromise;
}

export async function readWorkbookFromFile(file: File): Promise<XLSX.WorkBook> {
  const XLSX = await getXlsx();
  const buffer = await file.arrayBuffer();
  return XLSX.read(buffer, { type: 'array' });
}
