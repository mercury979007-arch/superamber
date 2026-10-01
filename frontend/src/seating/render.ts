import {
  getCampGroupCountFromGroups,
  getCircularSlotMap,
  getCircularVisibleGroupCountFromGroups,
  getFourGroupCountFromGroups,
  getRowsOccupiedSlotsFromGroups
} from './layouts';
import { CAMP_GROUP_SIZE } from './state';
import type { AppState, LayoutType, TimeModeData } from './types';

interface RenderHandlers {
  handleSeatChange: (groupIndex: number, seatIndex: number, value: string) => void;
  handleRowSeatChange: (rowIndex: number, side: 'left' | 'right', seatIndex: number, value: string) => void;
  handleFourSeatChange: (groupIndex: number, seatIndex: number, value: string) => void;
}

let renderQueryRoot: ParentNode = document;

export const setRenderQueryRoot = (root: ParentNode): void => {
  renderQueryRoot = root;
};

const asElement = <T extends Element>(selector: string): T => {
  const node = renderQueryRoot.querySelector(selector);
  if (!node) {
    throw new Error(`Element not found: ${selector}`);
  }
  return node as T;
};

const makeInput = (value: string, fontSize: number, readonly: boolean): HTMLInputElement => {
  const input = document.createElement('input');
  input.type = 'text';
  input.value = value;
  input.style.fontSize = `${fontSize}px`;
  if (readonly) {
    input.readOnly = true;
  }
  return input;
};

const maxNameLength = (names: string[], fallback = 1): number =>
  Math.max(...names.filter((name) => name).map((name) => name.length), fallback);

const formatGroupTitle = (label: string, layout: LayoutType = 'circular'): string => {
  const clean = String(label || '').trim();
  if (!clean) {
    return '空组';
  }
  const legacyChineseGroup = clean.match(/^第\s*(\d+)\s*组$/);
  if (layout === 'camp' && legacyChineseGroup) {
    return `Group ${legacyChineseGroup[1]}`;
  }
  if (/^\d+$/.test(clean)) {
    return layout === 'camp' ? `Group ${clean}` : `第${clean}组`;
  }
  return clean;
};

const hasStudents = (names: string[]): boolean => names.some((name) => name.trim());

const countLayoutStudents = (state: AppState): number => {
  if (state.currentLayout === 'rows') {
    return state.rowGroups.rows.reduce((count, row) => count
      + row.left.filter((name) => name.trim()).length
      + row.right.filter((name) => name.trim()).length, 0);
  }
  if (state.currentLayout === 'four') {
    return state.fourGroups.groups.flat().filter((name) => name.trim()).length;
  }
  return state.groups.flat().filter((name) => name.trim()).length;
};

export const refreshSeating = (state: AppState, handlers: RenderHandlers): void => {
  const classroom = asElement<HTMLDivElement>('#classroom');
  classroom.innerHTML = '';

  if (state.currentLayout === 'circular') {
    classroom.className = 'classroom';
    refreshCircularSeating(state, handlers);
  } else if (state.currentLayout === 'rows') {
    classroom.className = 'classroom three-rows-layout';
    refreshRowSeating(state, handlers);
  } else if (state.currentLayout === 'four') {
    classroom.className = 'classroom four-layout';
    classroom.style.setProperty('--four-group-count', String(getFourGroupCountFromGroups(state.fourGroups)));
    refreshFourSeating(state, handlers);
  } else if (state.currentLayout === 'camp') {
    const groupCount = getCampGroupCountFromGroups(state.groups);
    classroom.className = 'classroom camp-layout';
    classroom.style.setProperty('--camp-group-count', String(groupCount));
    classroom.style.setProperty('--camp-grid-columns', String(groupCount === 8 ? 4 : 3));
    refreshCampSeating(state, handlers);
  }

  classroom.classList.toggle('expanded-density', countLayoutStudents(state) > 36);
  const cards = [...classroom.querySelectorAll<HTMLElement>('.table:not(.table-empty), .four-group-card')];
  classroom.dataset.visibleGroups = String(cards.length);
  const maxSeats = Math.max(1, ...cards.map(card => card.querySelectorAll('.seat').length));
  classroom.style.setProperty('--seat-rows', String(Math.ceil(maxSeats / 2)));
  const rowGroups = [...classroom.querySelectorAll<HTMLElement>('.seats-row')];
  const rowSeats = Math.max(4, ...rowGroups.map(group => group.querySelectorAll('.seat').length));
  classroom.style.setProperty('--row-seat-count', String(rowSeats));
  // The board has fixed logical dimensions; fit names after its layout and font settle.
  const fitNames = () => {
    if (!classroom.isConnected) return;
    if (classroom.closest('.seating-fixed-viewport') && cards.length) {
      const cardRows = state.currentLayout === 'four' ? 1 : Math.ceil(cards.length / 3);
      const seatRows = Math.ceil(maxSeats / 2);
      const chrome = Math.max(...cards.map(card => card.offsetHeight - (card.querySelector<HTMLElement>('.seats, .four-seats')?.offsetHeight || 0)));
      const room = (classroom.clientHeight - (cardRows - 1) * 18) / cardRows;
      const seatHeight = Math.max(32, Math.min(64, Math.floor((room - chrome - (seatRows - 1) * 8) / seatRows)));
      classroom.style.setProperty('--seat-height', `${seatHeight}px`);
    }
    const context = document.createElement('canvas').getContext('2d');
    if (!context) return;
    classroom.querySelectorAll<HTMLInputElement>('.seat input').forEach(input => {
      const style = getComputedStyle(input);
      const width = input.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - 4;
      if (width <= 0) return;
      context.font = `22px ${style.fontFamily}`;
      const measured = context.measureText(input.value).width;
      input.style.setProperty('font-size', `${Math.max(10, Math.min(22, 22 * width / Math.max(measured, 1)))}px`, 'important');
    });
  };
  requestAnimationFrame(fitNames);
  void document.fonts?.ready.then(fitNames);
};

export const renderModePreview = (container: HTMLDivElement, modeData: TimeModeData): void => {
  container.innerHTML = '';

  if (modeData.layout === 'circular') {
    renderPreviewCircular(container, modeData.groups || [], modeData.groupLabels || []);
    return;
  }

  if (modeData.layout === 'rows') {
    renderPreviewRows(container, modeData.rowGroups, modeData.groupLabels || []);
    return;
  }

  if (modeData.layout === 'four') {
    const fourGroups = modeData.fourGroups;
    if (!fourGroups) {
      return;
    }
    container.style.setProperty('--four-group-count', String(getFourGroupCountFromGroups(fourGroups)));
    renderPreviewFour(container, fourGroups, modeData.groupLabels || []);
    return;
  }

  if (modeData.layout === 'camp') {
    const groups = modeData.groups || [];
    const groupCount = getCampGroupCountFromGroups(groups);
    container.style.setProperty('--camp-group-count', String(groupCount));
    container.style.setProperty('--camp-grid-columns', String(groupCount === 8 ? 4 : 3));
    renderPreviewCamp(container, groups, modeData.groupLabels || []);
  }
};

const refreshCircularSeating = (state: AppState, handlers: RenderHandlers): void => {
  const classroom = asElement<HTMLDivElement>('#classroom');
  const activeGroupCount = getCircularVisibleGroupCountFromGroups(state.groups);
  const slotMap = getCircularSlotMap(activeGroupCount);

  for (let slotIndex = 0; slotIndex < 6; slotIndex += 1) {
    const logicalGroupIndex = slotMap[slotIndex];
    const table = document.createElement('div');

    if (logicalGroupIndex === null) {
      table.className = 'table table-empty';
      table.innerHTML = '<h3>空组</h3><div class="seats seats-empty"></div>';
      classroom.appendChild(table);
      continue;
    }

    const visualGroup = state.currentGroupOrder[logicalGroupIndex] || logicalGroupIndex + 1;
    table.className = `table group-${((visualGroup - 1) % 6) + 1}`;

    const title = document.createElement('h3');
    title.dataset.groupLabelIndex = String(logicalGroupIndex);
    title.textContent = formatGroupTitle(state.currentGroupLabels[logicalGroupIndex] || String(visualGroup));
    table.appendChild(title);

    const seats = document.createElement('div');
    seats.className = 'seats';

    const maxLength = maxNameLength(state.groups[logicalGroupIndex], 1);
    const fontSize = Math.min(16, Math.max(10, Math.floor(140 / maxLength)));

    const groupStudents = state.groups[logicalGroupIndex] || [];
    const seatEntries = state.isEditMode
      ? Array.from({ length: Math.max(6, groupStudents.length) }, (_, seatIndex) => ({
        student: groupStudents[seatIndex] || '',
        seatIndex,
      }))
      : groupStudents
        .map((student, seatIndex) => ({ student: student.trim(), seatIndex }))
        .filter((entry) => entry.student);

    seatEntries.forEach(({ student, seatIndex }) => {
      const seat = document.createElement('div');
      seat.className = 'seat';
      const input = makeInput(student, fontSize, !state.isEditMode);
      input.onchange = () => handlers.handleSeatChange(logicalGroupIndex, seatIndex, input.value);
      seat.appendChild(input);
      seats.appendChild(seat);
    });

    table.appendChild(seats);
    classroom.appendChild(table);
  }
};

const refreshRowSeating = (state: AppState, handlers: RenderHandlers): void => {
  const classroom = asElement<HTMLDivElement>('#classroom');
  const occupiedSlots = new Set(getRowsOccupiedSlotsFromGroups(state.rowGroups));

  const rows = [
    { leftSlot: 0, rightSlot: 1 },
    { leftSlot: 2, rightSlot: 3 },
    { leftSlot: 4, rightSlot: 5 }
  ];

  rows.forEach((rowMeta, rowIndex) => {
    const leftData = state.rowGroups.rows[rowIndex].left;
    const rightData = state.rowGroups.rows[rowIndex].right;
    const leftGroupIndex = occupiedSlots.has(rowMeta.leftSlot) || hasStudents(leftData) ? rowMeta.leftSlot : null;
    const rightGroupIndex = occupiedSlots.has(rowMeta.rightSlot) || hasStudents(rightData) ? rowMeta.rightSlot : null;

    if (leftGroupIndex === null && rightGroupIndex === null) {
      return;
    }

    const rowElement = document.createElement('div');
    rowElement.className = 'row';

    const isSingleCenter = leftGroupIndex !== null && rightGroupIndex === null;
    if (isSingleCenter) {
      rowElement.classList.add('single-center');
    }

    const buildGroup = (position: 'left' | 'right'): HTMLDivElement => {
      const group = document.createElement('div');
      group.className = position === 'left' ? 'group-left' : 'group-right';

      const currentGroupIndex = position === 'left' ? leftGroupIndex : rightGroupIndex;
      const currentData = position === 'left' ? leftData : rightData;
      const sideKey = position;

      // Apply group color class using groupOrder (like circular)
      if (currentGroupIndex !== null) {
        const visualGroup = state.currentGroupOrder[currentGroupIndex] || currentGroupIndex + 1;
        group.classList.add(`group-${((visualGroup - 1) % 6) + 1}`);
      }

      const title = document.createElement('h3');
      title.dataset.groupLabelIndex = currentGroupIndex === null ? '' : String(currentGroupIndex);
      title.textContent = currentGroupIndex === null
        ? '空组'
        : formatGroupTitle(state.currentGroupLabels[currentGroupIndex] || String(state.currentGroupOrder[currentGroupIndex] || currentGroupIndex + 1));
      group.appendChild(title);

      const seats = document.createElement('div');
      seats.className = 'seats-row';

      const maxLength = maxNameLength(currentData, 1);
      const fontSize = Math.min(16, Math.max(10, Math.floor(140 / maxLength)));

      const seatEntries = state.isEditMode
        ? currentData.map((student, seatIndex) => ({ student, seatIndex }))
        : currentData
          .map((student, seatIndex) => ({ student: student.trim(), seatIndex }))
          .filter((entry) => entry.student);

      seatEntries.forEach(({ student, seatIndex }) => {

        const seat = document.createElement('div');
        seat.className = 'seat';
        const input = makeInput(student, fontSize, !state.isEditMode || currentGroupIndex === null);
        input.onchange = () => handlers.handleRowSeatChange(rowIndex, sideKey, seatIndex, input.value);
        seat.appendChild(input);
        seats.appendChild(seat);
      });

      group.appendChild(seats);
      return group;
    };

    const leftGroup = buildGroup('left');
    const rightGroup = buildGroup('right');

    if (isSingleCenter) {
      leftGroup.classList.add('group-center');
      rowElement.appendChild(leftGroup);
    } else {
      rowElement.appendChild(leftGroup);
      rowElement.appendChild(rightGroup);
    }

    classroom.appendChild(rowElement);
  });
};

const buildFourGroupCard = (
  groupIndex: number,
  students: string[],
  visualGroup: number,
  groupLabel: string,
  readonly: boolean,
  onChange: (seatIndex: number, value: string) => void
): HTMLDivElement => {
  const group = document.createElement('div');
  group.className = `four-group-card group-${((visualGroup - 1) % 6) + 1}`;

  const title = document.createElement('h3');
  title.dataset.groupLabelIndex = String(groupIndex);
  title.textContent = formatGroupTitle(groupLabel || String(visualGroup), 'four');
  group.appendChild(title);

  const seats = document.createElement('div');
  seats.className = 'four-seats';
  const maxLength = maxNameLength(students, 1);
  const fontSize = Math.min(16, Math.max(10, Math.floor(140 / maxLength)));
  const seatEntries = readonly
    ? students
      .map((student, seatIndex) => ({ student: student.trim(), seatIndex }))
      .filter((entry) => entry.student)
    : students.map((student, seatIndex) => ({ student, seatIndex }));

  seatEntries.forEach(({ student, seatIndex }, visibleIndex) => {
    const seat = document.createElement('div');
    seat.className = 'seat four-seat';
    if (visibleIndex === seatEntries.length - 1 && seatEntries.length % 2 === 1) {
      seat.classList.add('four-seat-last');
    }
    const input = makeInput(student, fontSize, readonly);
    input.onchange = () => onChange(seatIndex, input.value);
    seat.appendChild(input);
    seats.appendChild(seat);
  });

  group.appendChild(seats);
  return group;
};

const refreshFourSeating = (state: AppState, handlers: RenderHandlers): void => {
  const classroom = asElement<HTMLDivElement>('#classroom');
  const activeGroupCount = getFourGroupCountFromGroups(state.fourGroups);

  for (let groupIndex = 0; groupIndex < activeGroupCount; groupIndex += 1) {
    if (!state.isEditMode && !hasStudents(state.fourGroups.groups[groupIndex] || [])) continue;
    const visualGroup = state.currentGroupOrder[groupIndex] || groupIndex + 1;
    classroom.appendChild(buildFourGroupCard(
      groupIndex,
      state.fourGroups.groups[groupIndex] || [],
      visualGroup,
      state.currentGroupLabels[groupIndex] || String(visualGroup),
      !state.isEditMode,
      (seatIndex, value) => handlers.handleFourSeatChange(groupIndex, seatIndex, value)
    ));
  }
};

const buildCampGroupCard = (
  groupIndex: number,
  students: string[],
  visualGroup: number,
  groupLabel: string,
  readonly: boolean,
  onChange: (seatIndex: number, value: string) => void
): HTMLDivElement => {
  const group = document.createElement('div');
  group.className = `camp-group-card group-${((visualGroup - 1) % 6) + 1}`;

  const title = document.createElement('h3');
  title.dataset.groupLabelIndex = String(groupIndex);
  title.textContent = formatGroupTitle(groupLabel || String(visualGroup), 'camp');
  group.appendChild(title);

  const seats = document.createElement('div');
  seats.className = 'camp-seats';
  if (readonly) {
    seats.classList.add('camp-seats-display');
  }
  const seatEntries = readonly
    ? students
      .map((student, seatIndex) => ({ student: student.trim(), seatIndex }))
      .filter((entry) => entry.student)
    : Array.from({ length: CAMP_GROUP_SIZE }, (_, seatIndex) => ({
      student: students[seatIndex] || '',
      seatIndex,
    }));
  const maxLength = maxNameLength(seatEntries.map((entry) => entry.student), 1);
  const fontSize = Math.min(22, Math.max(14, Math.floor(180 / maxLength)));

  seatEntries.forEach(({ student, seatIndex }) => {
    const seat = document.createElement('div');
    seat.className = 'seat camp-seat';
    const input = makeInput(student, fontSize, readonly);
    input.onchange = () => onChange(seatIndex, input.value);
    seat.appendChild(input);
    seats.appendChild(seat);
  });

  group.appendChild(seats);
  return group;
};

const refreshCampSeating = (state: AppState, handlers: RenderHandlers): void => {
  const classroom = asElement<HTMLDivElement>('#classroom');
  const groupCount = getCampGroupCountFromGroups(state.groups);

  for (let groupIndex = 0; groupIndex < groupCount; groupIndex += 1) {
    const visualGroup = state.currentGroupOrder[groupIndex] || groupIndex + 1;
    classroom.appendChild(buildCampGroupCard(
      groupIndex,
      state.groups[groupIndex] || [],
      visualGroup,
      state.currentGroupLabels[groupIndex] || String(visualGroup),
      !state.isEditMode,
      (seatIndex, value) => handlers.handleSeatChange(groupIndex, seatIndex, value)
    ));
  }
};

const renderPreviewCircular = (container: HTMLDivElement, groups: string[][], groupLabels: string[]): void => {
  const activeGroupCount = getCircularVisibleGroupCountFromGroups(groups);
  const slotMap = getCircularSlotMap(activeGroupCount);

  for (let slotIndex = 0; slotIndex < 6; slotIndex += 1) {
    const logicalGroupIndex = slotMap[slotIndex];
    const table = document.createElement('div');

    if (logicalGroupIndex === null) {
      table.className = 'table table-empty';
      table.innerHTML = '<h3>空组</h3><div class="seats seats-empty"></div>';
      container.appendChild(table);
      continue;
    }

    table.className = `table group-${(logicalGroupIndex % 6) + 1}`;
    const title = document.createElement('h3');
    title.textContent = formatGroupTitle(groupLabels[logicalGroupIndex] || String(logicalGroupIndex + 1));
    table.appendChild(title);

    const seats = document.createElement('div');
    seats.className = 'seats';
    const maxLength = maxNameLength(groups[logicalGroupIndex] || [], 1);
    const fontSize = Math.min(16, Math.max(10, Math.floor(140 / maxLength)));

    (groups[logicalGroupIndex] || [])
      .map((student, seatIndex) => ({ student: student.trim(), seatIndex }))
      .filter((entry) => entry.student)
      .forEach(({ student }) => {
      const seat = document.createElement('div');
      seat.className = 'seat';
      seat.appendChild(makeInput(student, fontSize, true));
      seats.appendChild(seat);
      });

    table.appendChild(seats);
    container.appendChild(table);
  }
};

const renderPreviewRows = (container: HTMLDivElement, rowGroups: TimeModeData['rowGroups'], groupLabels: string[]): void => {
  if (!rowGroups) {
    return;
  }

  const occupiedSlots = new Set(getRowsOccupiedSlotsFromGroups(rowGroups));
  const rows = [
    { leftSlot: 0, rightSlot: 1 },
    { leftSlot: 2, rightSlot: 3 },
    { leftSlot: 4, rightSlot: 5 }
  ];

  rows.forEach((rowMeta, rowIndex) => {
    const leftData = rowGroups.rows[rowIndex].left;
    const rightData = rowGroups.rows[rowIndex].right;
    const leftGroupIndex = occupiedSlots.has(rowMeta.leftSlot) || hasStudents(leftData) ? rowMeta.leftSlot : null;
    const rightGroupIndex = occupiedSlots.has(rowMeta.rightSlot) || hasStudents(rightData) ? rowMeta.rightSlot : null;

    if (leftGroupIndex === null && rightGroupIndex === null) {
      return;
    }

    const rowElement = document.createElement('div');
    rowElement.className = 'row';
    const isSingleCenter = leftGroupIndex !== null && rightGroupIndex === null;

    if (isSingleCenter) {
      rowElement.classList.add('single-center');
    }

    const buildGroup = (position: 'left' | 'right'): HTMLDivElement => {
      const group = document.createElement('div');
      group.className = position === 'left' ? 'group-left' : 'group-right';
      const currentGroupIndex = position === 'left' ? leftGroupIndex : rightGroupIndex;
      const currentData = position === 'left' ? leftData : rightData;
      const title = document.createElement('h3');
      title.textContent = currentGroupIndex === null ? '空组' : formatGroupTitle(groupLabels[currentGroupIndex] || String(currentGroupIndex + 1));
      group.appendChild(title);

      const seats = document.createElement('div');
      seats.className = 'seats-row';
      const maxLength = maxNameLength(currentData, 1);
      const fontSize = Math.min(16, Math.max(10, Math.floor(140 / maxLength)));

      currentData.forEach((student) => {
        if (!student) {
          return;
        }
        const seat = document.createElement('div');
        seat.className = 'seat';
        seat.appendChild(makeInput(student, fontSize, true));
        seats.appendChild(seat);
      });

      group.appendChild(seats);
      return group;
    };

    const leftGroup = buildGroup('left');
    const rightGroup = buildGroup('right');
    if (isSingleCenter) {
      leftGroup.classList.add('group-center');
      rowElement.appendChild(leftGroup);
    } else {
      rowElement.appendChild(leftGroup);
      rowElement.appendChild(rightGroup);
    }

    container.appendChild(rowElement);
  });
};

const renderPreviewFour = (container: HTMLDivElement, fourGroups: TimeModeData['fourGroups'], groupLabels: string[]): void => {
  if (!fourGroups) {
    return;
  }

  container.className = 'previous-week-preview four-layout';
  const activeGroupCount = getFourGroupCountFromGroups(fourGroups);
  container.style.setProperty('--four-group-count', String(activeGroupCount));
  for (let groupIndex = 0; groupIndex < activeGroupCount; groupIndex += 1) {
    container.appendChild(buildFourGroupCard(
      groupIndex,
      fourGroups.groups[groupIndex] || [],
      groupIndex + 1,
      groupLabels[groupIndex] || String(groupIndex + 1),
      true,
      () => {}
    ));
  }
};

const renderPreviewCamp = (container: HTMLDivElement, groups: string[][], groupLabels: string[]): void => {
  const groupCount = getCampGroupCountFromGroups(groups);
  container.className = 'previous-week-preview camp-layout';
  container.style.setProperty('--camp-group-count', String(groupCount));
  container.style.setProperty('--camp-grid-columns', String(groupCount === 8 ? 4 : 3));

  for (let groupIndex = 0; groupIndex < groupCount; groupIndex += 1) {
    container.appendChild(buildCampGroupCard(
      groupIndex,
      groups[groupIndex] || [],
      groupIndex + 1,
      groupLabels[groupIndex] || String(groupIndex + 1),
      true,
      () => {}
    ));
  }
};
