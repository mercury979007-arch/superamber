import type { StudentRecord, ResourceEntry, StudentData } from '../types';
import { getXlsx, readWorkbookFromFile } from './xlsxFile';

function parsePercent(val: unknown): number | null {
  if (val === null || val === undefined || val === '' || val === 'NaN') return null;
  const s = String(val).trim().replace('%', '');
  const n = parseFloat(s);
  return isNaN(n) ? null : n / 100;
}

function extractClassCode(filename: string): string {
  const m = filename.match(/([A-Z]\d{2,4})/);
  return m ? m[1] : '';
}

export interface ParsedBasicData {
  classCode: string;
  students: StudentData[];
}

export function parseBasicFile(file: File): Promise<ParsedBasicData> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const XLSX = await getXlsx();
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array' });

        const classCode = extractClassCode(file.name);
        const ws = wb.Sheets['数据底表'];
        if (!ws) throw new Error('未找到"数据底表" sheet');

        const raw: (string | number | null)[][] = XLSX.utils.sheet_to_json(ws, {
          header: 1,
          defval: null,
        }) as (string | number | null)[][];

        if (raw.length < 4) throw new Error('数据底表行数不足');

        const row0 = raw[0];
        const row1 = raw[1];
        const row2 = raw[2];

        const resourceBlocks: Array<{
          name: string;
          type: string;
          startCol: number;
          endCol: number;
          subCols: string[];
        }> = [];

        let currentBlock: (typeof resourceBlocks)[0] | null = null;

        for (let ci = 0; ci < row1.length; ci++) {
          const cell = row1[ci];
          if (cell && typeof cell === 'string' && cell.includes('[')) {
            const typeMatch = cell.match(/\[(.+?)\]/);
            if (typeMatch) {
              if (currentBlock) {
                currentBlock.endCol = ci - 1;
                resourceBlocks.push(currentBlock);
              }
              currentBlock = {
                name: cell,
                type: typeMatch[1],
                startCol: ci,
                endCol: ci,
                subCols: [],
              };
            }
          }
          if (currentBlock && row2[ci] !== null && row2[ci] !== undefined) {
            currentBlock.subCols.push(String(row2[ci]));
          }
        }
        if (currentBlock) {
          currentBlock.endCol = row1.length - 1;
          resourceBlocks.push(currentBlock);
        }

        const students: StudentData[] = [];
        for (let ri = 3; ri < raw.length; ri++) {
          const row = raw[ri];
          const studentId = row[1] !== null ? String(row[1]).trim() : '';
          if (!studentId || studentId === '学号') continue;

          const chineseName = row[2] !== null ? String(row[2]).trim() : '';
          const englishName = row[3] !== null ? String(row[3]).trim() : '';

          const resources: ResourceEntry[] = [];
          for (const block of resourceBlocks) {
            const cols: Record<string, string | number | null> = {};
            let colIdx = block.startCol;
            for (const subCol of block.subCols) {
              if (colIdx <= block.endCol) {
                const rawVal = row[colIdx] ?? null;
                cols[subCol] = rawVal !== null ? rawVal : null;
              }
              colIdx++;
            }
            resources.push({
              resourceName: block.name,
              resourceType: block.type,
              columns: cols,
            });
          }

          students.push({
            studentId,
            chineseName,
            englishName,
            classCode,
            resources,
            dailyCheckIns: 0,
            classParticipation: 0,
            bonusItems: [],
          });
        }

        resolve({ classCode, students });
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

export function parseDailyCheckFile(
  file: File,
  students: StudentData[]
): Promise<StudentData[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const XLSX = await getXlsx();
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array' });
        const ws = wb.Sheets['data'] || wb.Sheets[wb.SheetNames[0]];
        const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(ws, { defval: null });

        const checkMap = new Map<string, number>();
        for (const row of rows) {
          const sid = row['学号'] !== null ? String(row['学号']).trim() : '';
          const total = row['总计'];
          if (sid) checkMap.set(sid, Number(total) || 0);
        }

        const updated = students.map((s) => ({
          ...s,
          dailyCheckIns: checkMap.get(s.studentId) ?? 0,
        }));
        resolve(updated);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

export async function generateOutputExcel(
  students: StudentData[],
  mpMap: Map<string, number>
): Promise<ArrayBuffer> {
  const XLSX = await getXlsx();
  const wb = XLSX.utils.book_new();
  const rows = students
    .filter((s) => (mpMap.get(s.studentId) ?? 0) > 0)
    .map((s) => ({
      英文名: s.englishName,
      中文名: s.chineseName,
      学号: s.studentId,
      发放MP数量: mpMap.get(s.studentId) ?? 0,
    }));
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [{ wch: 16 }, { wch: 12 }, { wch: 14 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, ws, '学生列表');
  const raw: unknown = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  const u8 = raw instanceof Uint8Array ? raw : new Uint8Array(raw as number[]);
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

export async function parseNameListWorkbook(file: File): Promise<string[]> {
  const workbook = await readWorkbookFromFile(file);
  const firstSheetName = workbook.SheetNames[0];
  const XLSX = await getXlsx();
  const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(workbook.Sheets[firstSheetName], {
    header: 1,
  });

  return rows
    .flatMap((row) => row.map((cell) => String(cell ?? '').trim()))
    .filter(Boolean);
}

export { parsePercent };
