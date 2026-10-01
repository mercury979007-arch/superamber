import { useEffect, useMemo, useState } from 'react';
import type { ClassInfo } from '../types';
import {
  getClassProfile,
  listKnownClassCodes,
  savePreciseStudentList,
} from '../utils/classProfiles';
import './ClassRosterApp.css';

interface Props {
  classInfo?: ClassInfo | null;
  knownClasses: ClassInfo[];
  onBack: () => void;
  onBackToHome?: () => void;
  onSessionExpired?: () => void;
}

interface EditableStudentRow {
  id: string;
  studentId: string;
  chineseName: string;
  englishName: string;
}

interface ParsedRosterRow {
  classCode: string;
  studentId: string;
  chineseName: string;
  englishName: string;
}

function normalizeClassCode(raw: string): string {
  return String(raw || '').trim().toUpperCase();
}

function normalizeCell(raw: unknown): string {
  return String(raw ?? '').replace(/\s+/g, ' ').trim();
}

function createEditableRow(studentId = '', chineseName = '', englishName = ''): EditableStudentRow {
  return {
    id: `roster_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    studentId,
    chineseName,
    englishName,
  };
}

function parseRosterText(raw: string, fallbackClassCode = ''): ParsedRosterRow[] {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const rows: ParsedRosterRow[] = [];
  let currentClassCode = normalizeClassCode(fallbackClassCode);

  for (const line of lines) {
    const text = line.trim();
    if (!text) continue;

    const classOnly = text.match(/^([A-Za-z]{1,3}\d{2,4})$/);
    if (classOnly) {
      currentClassCode = normalizeClassCode(classOnly[1]);
      continue;
    }

    const parts = text
      .split(/\t|,|，|\s{2,}/)
      .map((item) => normalizeCell(item))
      .filter(Boolean);

    if (parts.length < 2) continue;

    let classCode = currentClassCode;
    let studentId = '';
    let chineseName = '';
    let englishName = '';

    if (/^[A-Za-z]{1,3}\d{2,4}$/.test(parts[0])) {
      classCode = normalizeClassCode(parts[0]);
      studentId = parts[1] || '';
      chineseName = parts[2] || '';
      englishName = parts[3] || '';
    } else {
      studentId = parts[0] || '';
      chineseName = parts[1] || '';
      englishName = parts[2] || '';
    }

    if (!classCode && fallbackClassCode) classCode = normalizeClassCode(fallbackClassCode);
    if (!classCode || !chineseName) continue;

    rows.push({
      classCode,
      studentId,
      chineseName,
      englishName,
    });
  }

  return rows;
}

function dedupeRows(rows: EditableStudentRow[]): EditableStudentRow[] {
  const seen = new Set<string>();
  const result: EditableStudentRow[] = [];
  for (const row of rows) {
    const chineseName = normalizeCell(row.chineseName);
    if (!chineseName) continue;
    const key = chineseName;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      ...row,
      studentId: normalizeCell(row.studentId),
      chineseName,
      englishName: normalizeCell(row.englishName),
    });
  }
  return result;
}

async function parseRosterFile(file: File): Promise<ParsedRosterRow[]> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls') || lower.endsWith('.csv')) {
    const { getXlsx, readWorkbookFromFile } = await import('../utils/xlsxFile');
    const workbook = await readWorkbookFromFile(file);
    const { utils } = await getXlsx();
    const parsed: ParsedRosterRow[] = [];

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const rows = utils.sheet_to_json<(string | number | null)[]>(sheet, { header: 1, defval: '' });
      if (!rows.length) continue;

      const headerRow = rows[0].map((cell) => normalizeCell(cell));
      const classIdx = headerRow.findIndex((cell) => /班级|班级号/.test(cell));
      const studentIdIdx = headerRow.findIndex((cell) => /学号/.test(cell));
      const chineseIdx = headerRow.findIndex((cell) => /中文名|姓名/.test(cell));
      const englishIdx = headerRow.findIndex((cell) => /英文名/.test(cell));
      const fallbackClassCode = normalizeClassCode(sheetName.match(/([A-Za-z]{1,3}\d{2,4})/)?.[1] || '');

      if (studentIdIdx === -1 || chineseIdx === -1) {
        const text = rows.map((row) => row.map((cell) => normalizeCell(cell)).join('\t')).join('\n');
        parsed.push(...parseRosterText(text, fallbackClassCode));
        continue;
      }

      for (const row of rows.slice(1)) {
        const classCode = normalizeClassCode(String(classIdx >= 0 ? row[classIdx] : fallbackClassCode));
        const chineseName = normalizeCell(row[chineseIdx]);
        if (!classCode || !chineseName) continue;
        parsed.push({
          classCode,
          studentId: normalizeCell(row[studentIdIdx]),
          chineseName,
          englishName: normalizeCell(englishIdx >= 0 ? row[englishIdx] : ''),
        });
      }
    }

    return parsed;
  }

  const text = await file.text();
  return parseRosterText(text);
}

export default function ClassRosterApp({ classInfo, knownClasses, onBack, onBackToHome, onSessionExpired }: Props) {
  const [refreshKey, setRefreshKey] = useState(0);
  const [batchInput, setBatchInput] = useState('');
  const [batchRows, setBatchRows] = useState<ParsedRosterRow[]>([]);
  const [batchNotice, setBatchNotice] = useState('');
  const [activeClassCode, setActiveClassCode] = useState(() => normalizeClassCode(classInfo?.name || ''));
  const [editorRows, setEditorRows] = useState<EditableStudentRow[]>([]);
  const [quickPasteInput, setQuickPasteInput] = useState('');
  const [editorNotice, setEditorNotice] = useState('');
  const [syncBusy, setSyncBusy] = useState(false);

  const classCodes = useMemo(
    () => listKnownClassCodes(knownClasses.map((item) => item.name)),
    [knownClasses, refreshKey],
  );

  const batchGroups = useMemo(() => {
    const grouped = new Map<string, ParsedRosterRow[]>();
    for (const row of batchRows) {
      const key = normalizeClassCode(row.classCode);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)?.push(row);
    }
    return [...grouped.entries()].sort((a, b) => a[0].localeCompare(b[0], 'en', { sensitivity: 'base' }));
  }, [batchRows]);

  useEffect(() => {
    if (!activeClassCode && classCodes.length > 0) {
      setActiveClassCode(classCodes[0]);
    }
  }, [activeClassCode, classCodes]);

  useEffect(() => {
    if (!activeClassCode) {
      setEditorRows([]);
      return;
    }
    const profile = getClassProfile(activeClassCode);
    const rows = (profile?.students || []).map((student) =>
      createEditableRow(student.studentId || '', student.chineseName, student.englishName || ''),
    );
    setEditorRows(rows.length ? rows : [createEditableRow()]);
  }, [activeClassCode, refreshKey]);

  function applyBatchRows(rows: ParsedRosterRow[]) {
    setBatchRows(rows);
    setBatchNotice(rows.length ? `已识别 ${rows.length} 条学生信息。` : '没有识别到可用数据。');
  }

  async function handleSyncFromSystem() {
    if (syncBusy) return;
    const targetClass = activeClassCode || classInfo?.name;
    if (!targetClass) {
      setBatchNotice('请先选择一个班级。');
      return;
    }
    setSyncBusy(true);
    setBatchNotice(`正在从教务系统抓取 ${targetClass} 的学生名单...`);
    try {
      const resp = await fetch('/api/scraper/get-student-list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ classId: targetClass }),
      });
      const data = await resp.json().catch(() => ({} as Record<string, unknown>));
      if (resp.status === 401) {
        setBatchNotice('登录已失效，请重新登录后再抓名单。');
        onSessionExpired?.();
        return;
      }
      if (!resp.ok) {
        throw new Error((data as { error?: string }).error || `请求失败 (${resp.status})`);
      }
      const students = ((data as { data?: { no: string; chName: string; enName: string }[] }).data || []);
      if (students.length === 0) {
        setBatchNotice(`${targetClass} 暂无学生数据。`);
        return;
      }
      const rows: ParsedRosterRow[] = students.map((s) => ({
        classCode: normalizeClassCode(targetClass),
        studentId: s.no || '',
        chineseName: s.chName || '',
        englishName: s.enName || '',
      }));
      applyBatchRows(rows);
      setBatchNotice(`已从教务系统获取 ${targetClass}，共 ${rows.length} 名学生。`);
    } catch (err) {
      setBatchNotice(err instanceof Error ? err.message : '抓取失败');
    } finally {
      setSyncBusy(false);
    }
  }

  async function handleBatchFile(file: File | null) {
    if (!file) return;
    const rows = await parseRosterFile(file);
    applyBatchRows(rows);
  }

  function handleParseBatchText() {
    applyBatchRows(parseRosterText(batchInput));
  }

  function writeBatchGroup(classCode: string, rows: ParsedRosterRow[]) {
    savePreciseStudentList(classCode, rows);
    setRefreshKey((value) => value + 1);
    setBatchNotice(`已写入 ${classCode}，共 ${rows.length} 人。`);
  }

  function writeAllBatchGroups() {
    for (const [classCode, rows] of batchGroups) {
      savePreciseStudentList(classCode, rows);
    }
    setRefreshKey((value) => value + 1);
    setBatchNotice(`已写入 ${batchGroups.length} 个班级。`);
  }

  function updateEditorRow(id: string, field: keyof EditableStudentRow, value: string) {
    setEditorRows((rows) => rows.map((row) => (row.id === id ? { ...row, [field]: value } : row)));
  }

  function removeEditorRow(id: string) {
    setEditorRows((rows) => {
      const next = rows.filter((row) => row.id !== id);
      return next.length ? next : [createEditableRow()];
    });
  }

  function saveCurrentClass() {
    if (!activeClassCode) {
      setEditorNotice('先确定班级号。');
      return;
    }
    const cleaned = dedupeRows(editorRows);
    savePreciseStudentList(activeClassCode, cleaned);
    setEditorRows(cleaned.length ? cleaned : [createEditableRow()]);
    setRefreshKey((value) => value + 1);
    setEditorNotice(`已保存 ${activeClassCode}，共 ${cleaned.length} 人。`);
  }

  function applyQuickPaste() {
    const rows = parseRosterText(quickPasteInput, activeClassCode).filter(
      (row) => normalizeClassCode(row.classCode) === normalizeClassCode(activeClassCode),
    );
    if (!rows.length) {
      setEditorNotice('右侧粘贴区没有识别到当前班级的数据。');
      return;
    }
    setEditorRows((current) =>
      dedupeRows([
        ...current,
        ...rows.map((row) => createEditableRow(row.studentId, row.chineseName, row.englishName)),
      ]),
    );
    setQuickPasteInput('');
    setEditorNotice(`已追加 ${rows.length} 条到 ${activeClassCode}。`);
  }

  return (
    <div className="roster-shell fade-in">
      {onBackToHome && (
        <button className="tool-home-rail" onClick={onBackToHome}>
          <span className="tool-home-rail-icon">←</span>
          <span>返回主页</span>
        </button>
      )}
      <div className="roster-topbar">
        <button className="tool-back-btn" onClick={onBack}>← 返回</button>
        <div className="roster-title">
          <strong>批量导入名单</strong>
          <span>把学号 / 中文名 / 英文名整理在一起，后面查班级和继续处理都会更方便</span>
        </div>
      </div>

      <div className="roster-layout">
        <section className="roster-panel card">
          <div className="roster-panel-head">
            <h3>批量导入</h3>
            <p>一次导多个班，识别后再落库。</p>
          </div>
          <div className="roster-import-actions">
            <label className="btn btn-ghost btn-sm">
              上传表格 / 文本
              <input
                type="file"
                hidden
                accept=".xlsx,.xls,.csv,.txt,.md"
                onChange={(event) => {
                  void handleBatchFile(event.target.files?.[0] ?? null);
                  event.target.value = '';
                }}
              />
            </label>
            <button className="btn btn-primary btn-sm" onClick={handleParseBatchText}>识别粘贴内容</button>
            <button className="btn btn-ghost btn-sm" onClick={writeAllBatchGroups} disabled={batchGroups.length === 0}>全部写入</button>
          </div>
          <textarea
            className="roster-textarea"
            rows={9}
            placeholder={'E102\n1001 李晓彤 Daisy\n1002 周子然 Zora\n\nG205\n2001 王一诺 Enid'}
            value={batchInput}
            onChange={(event) => setBatchInput(event.target.value)}
          />
          {batchNotice && <div className="roster-notice">{batchNotice}</div>}
          <div className="roster-batch-list">
            {batchGroups.length === 0 && <div className="roster-empty">还没有待导入班级。</div>}
            {batchGroups.map(([classCode, rows]) => (
              <article key={classCode} className="roster-batch-card">
                <div>
                  <strong>{classCode}</strong>
                  <p>{rows.length} 人待写入</p>
                </div>
                <button className="btn btn-ghost btn-sm" onClick={() => writeBatchGroup(classCode, rows)}>
                  写入这个班
                </button>
              </article>
            ))}
          </div>
        </section>

        <section className="roster-panel card">
          <div className="roster-panel-head">
            <h3>单班核对</h3>
            <p>支持新增、删除、手动改名；识别到班级号后也能直接在右侧补。</p>
          </div>

          <div className="roster-class-switch">
            <select value={activeClassCode} onChange={(event) => setActiveClassCode(event.target.value)}>
              {classCodes.map((code) => (
                <option key={code} value={code}>{code}</option>
              ))}
            </select>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => void handleSyncFromSystem()}
              disabled={syncBusy || !activeClassCode}
            >
              {syncBusy ? '抓取中...' : '抓核心名单'}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setEditorRows((rows) => [...rows, createEditableRow()])}>
              + 新增一行
            </button>
          </div>

          <div className="roster-quick-paste">
            <textarea
              rows={4}
              placeholder="右侧小口：直接粘贴当前班级的 学号 中文名 英文名"
              value={quickPasteInput}
              onChange={(event) => setQuickPasteInput(event.target.value)}
            />
            <button className="btn btn-ghost btn-sm" onClick={applyQuickPaste}>追加到当前班级</button>
          </div>

          <div className="roster-table">
            <div className="roster-head">学号</div>
            <div className="roster-head">中文名</div>
            <div className="roster-head">英文名</div>
            <div className="roster-head">操作</div>
            {editorRows.map((row) => (
              <div key={row.id} className="roster-row">
                <input value={row.studentId} onChange={(event) => updateEditorRow(row.id, 'studentId', event.target.value)} />
                <input value={row.chineseName} onChange={(event) => updateEditorRow(row.id, 'chineseName', event.target.value)} />
                <input value={row.englishName} onChange={(event) => updateEditorRow(row.id, 'englishName', event.target.value)} />
                <button className="btn btn-ghost btn-sm" onClick={() => removeEditorRow(row.id)}>删除</button>
              </div>
            ))}
          </div>

          {editorNotice && <div className="roster-notice">{editorNotice}</div>}

          <div className="roster-footer">
            <span>当前班会以这里的名单为准，后面概览和 MP 都优先读这份数据。</span>
            <button className="btn btn-primary btn-sm" onClick={saveCurrentClass}>保存当前班级</button>
          </div>
        </section>
      </div>
    </div>
  );
}
