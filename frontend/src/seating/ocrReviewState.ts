import type { OCRClassDraft } from './ocr';
import type { LayoutType, TimeMode } from './types';

export interface OCRDraftView {
  id: string;
  fileName: string;
  source: string;
  errorMessage: string;
  className: string;
  layout: LayoutType;
  mode: TimeMode;
  overwrite: boolean;
  groupsText: string;
  detectedStudentCount: number;
  placedStudentCount: number;
  confidence: number;
  date: string;
  day: string;
  weekday: string;
  time: string;
  campus: string;
  floor: string;
  room: string;
  fullDate: string;
}

export function createOcrDraftView(
  result: OCRClassDraft,
  options: {
    groupsToText: (layout: LayoutType, groups: string[][]) => string;
    makeId?: () => string;
  },
): OCRDraftView {
  const draftClassName = result.className || result.fileName.replace(/\.[^.]+$/, '').slice(0, 12);

  return {
    id: options.makeId ? options.makeId() : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    fileName: result.fileName,
    source: result.source || 'unknown',
    errorMessage: '',
    className: draftClassName,
    layout: result.layout,
    mode: 'weekday',
    overwrite: true,
    groupsText: options.groupsToText(result.layout, result.groups),
    detectedStudentCount: result.detectedStudentCount,
    placedStudentCount: result.placedStudentCount,
    confidence: result.confidence,
    date: result.info.date,
    day: result.info.day,
    weekday: result.info.weekday,
    time: result.info.time,
    campus: result.info.campus,
    floor: result.info.floor,
    room: result.info.room,
    fullDate: result.info.fullDate,
  };
}

export function createFailedOcrDraftView(
  fileName: string,
  engine: string,
  errorMessage: string,
  options: {
    makeId?: () => string;
  } = {},
): OCRDraftView {
  return {
    id: options.makeId ? options.makeId() : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    fileName,
    source: `failed:${engine}`,
    errorMessage,
    className: fileName.replace(/\.[^.]+$/, ''),
    layout: 'circular',
    mode: 'weekday',
    overwrite: true,
    groupsText: '',
    detectedStudentCount: 0,
    placedStudentCount: 0,
    confidence: 0,
    date: '',
    day: '',
    weekday: '',
    time: '',
    campus: '',
    floor: '',
    room: '',
    fullDate: '',
  };
}

export function buildOcrReviewCardHtml(
  draft: OCRDraftView,
  escapeHtml: (value: string) => string,
): string {
  const mismatch = Math.abs(draft.detectedStudentCount - draft.placedStudentCount);
  const warning =
    mismatch > 0
      ? `<div class="error">识别人数(${draft.detectedStudentCount}) 与落座人数(${draft.placedStudentCount}) 不一致，请核对。</div>`
      : `<div class="success">识别人数与落座人数一致：${draft.placedStudentCount}</div>`;
  const errorLine = draft.errorMessage
    ? `<div class="error">失败原因：${escapeHtml(draft.errorMessage)}</div>`
    : '';

  return `
    <div class="ocr-card" data-id="${escapeHtml(draft.id)}">
      <h3>${escapeHtml(draft.fileName)}</h3>
      <div class="ocr-source">识别来源：${escapeHtml(draft.source)}</div>
      ${errorLine}
      <div class="ocr-card-grid">
        <label>班级名<input data-field="className" value="${escapeHtml(draft.className)}" /></label>
        <label>模式
          <select data-field="mode">
            <option value="weekday" ${draft.mode === 'weekday' ? 'selected' : ''}>周中</option>
            <option value="weekend" ${draft.mode === 'weekend' ? 'selected' : ''}>周末</option>
          </select>
        </label>
        <label>布局
          <select data-field="layout">
            <option value="circular" ${draft.layout === 'circular' ? 'selected' : ''}>圆桌</option>
            <option value="rows" ${draft.layout === 'rows' ? 'selected' : ''}>三横排</option>
            <option value="four" ${draft.layout === 'four' ? 'selected' : ''}>四大组</option>
            <option value="camp" ${draft.layout === 'camp' ? 'selected' : ''}>夏令营</option>
          </select>
        </label>
        <label>覆盖同名班级
          <select data-field="overwrite">
            <option value="true" ${draft.overwrite ? 'selected' : ''}>覆盖</option>
            <option value="false" ${!draft.overwrite ? 'selected' : ''}>新建</option>
          </select>
        </label>
        <label>月<input data-field="date" value="${escapeHtml(draft.date)}" /></label>
        <label>日<input data-field="day" value="${escapeHtml(draft.day)}" /></label>
        <label>星期<input data-field="weekday" value="${escapeHtml(draft.weekday)}" /></label>
        <label>时间<input data-field="time" value="${escapeHtml(draft.time)}" /></label>
        <label>校区<input data-field="campus" value="${escapeHtml(draft.campus)}" /></label>
        <label>楼层<input data-field="floor" value="${escapeHtml(draft.floor)}" /></label>
        <label>教室<input data-field="room" value="${escapeHtml(draft.room)}" /></label>
      </div>
      ${warning}
      <label>座位文本（可修改）
        <textarea data-field="groupsText">${escapeHtml(draft.groupsText)}</textarea>
      </label>
    </div>
  `;
}
