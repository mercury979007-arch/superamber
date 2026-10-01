function displayNumber(value, { percent = false } = {}) {
  if (value === null || value === undefined || value === '') return '';
  const number = Number(value);
  if (!Number.isFinite(number)) return '';
  const normalized = Number.isInteger(number) ? String(number) : String(Number(number.toFixed(4)));
  return percent ? `${normalized}%` : normalized;
}

function completionLabel(value) {
  return value === true ? '已完成' : '未完成';
}

function resultFields(row) {
  const prefix = `${row.taskId}_${row.resourceId}`;
  const result = row.result || {};
  if (row.resourceTable === 'online_word_pack') {
    return {
      [`${prefix}_packAttr`]: completionLabel(result.completed),
      [`${prefix}_packAttr_rank`]: result.wordKing ? '是' : '否',
      [`${prefix}_packAttr_pk_count`]: displayNumber(result.pkAttempts),
      [`${prefix}_packAttr_pk_ratio`]: displayNumber(result.pkAccuracy, { percent: true }),
      [`${prefix}_packAttr_first_ratio`]: displayNumber(result.repetitionFirstAccuracy, { percent: true }),
      [`${prefix}_packAttr_ratio`]: displayNumber(result.repetitionAccuracy, { percent: true }),
    };
  }
  if (row.resourceTable === 'online_voice') {
    return {
      [`${prefix}_voice`]: completionLabel(result.completed),
      [`${prefix}_voicescore`]: displayNumber(result.averageScore),
      [`${prefix}_voicecount`]: displayNumber(result.voiceCount),
      [`${prefix}_voicefirst`]: displayNumber(result.firstScore),
      // Keep the upstream spelling because existing report conversion expects it.
      [`${prefix}_voiceheighest`]: displayNumber(result.highestScore),
    };
  }
  if (row.resourceTable === 'online_test') {
    return {
      [`${prefix}_test`]: completionLabel(result.completed),
      [`${prefix}_testscore`]: displayNumber(result.realScore),
      [`${prefix}_testscoretotal`]: displayNumber(result.allScore),
    };
  }
  return {};
}

function buildLegacyRowMaps(payload) {
  const rows = Array.isArray(payload?.data) ? payload.data : (Array.isArray(payload) ? payload : []);
  return {
    byId: new Map(rows.map((row) => [Number(row?.id), row])),
    byNo: new Map(rows.map((row) => [String(row?.no || row?.student_no || ''), row])),
  };
}

function buildPublicityPayload(databaseRows, {
  legacyPayload = null,
  preferredIdToName = {},
  preferredTaskKeys = [],
  preferredTaskMeta = {},
} = {}) {
  const supportedRows = (databaseRows || []).filter((row) => row.supported && row.result);
  const legacy = buildLegacyRowMaps(legacyPayload);
  const students = new Map();
  const idToName = {};
  const taskMetaByKey = {};
  const orderedTaskKeys = [];
  const orderedTaskKeySet = new Set();

  for (const row of supportedRows) {
    const studentKey = `${row.squadId}:${row.studentId}`;
    if (!students.has(studentKey)) {
      const existing = legacy.byId.get(Number(row.studentId))
        || legacy.byNo.get(String(row.studentNo || ''))
        || {};
      students.set(studentKey, {
        ...existing,
        id: Number(row.studentId),
        no: String(row.studentNo || existing.no || existing.student_no || ''),
        ch_name: String(row.studentChName || existing.ch_name || ''),
        en_name: String(row.studentEnName || existing.en_name || ''),
      });
    }
    Object.assign(students.get(studentKey), resultFields(row));

    const taskKey = `${row.taskId}_${row.resourceId}`;
    if (!orderedTaskKeySet.has(taskKey)) {
      orderedTaskKeySet.add(taskKey);
      orderedTaskKeys.push(taskKey);
    }
    const typeLabel = row.resourceTable === 'online_word_pack'
      ? '主题表达积累'
      : row.resourceTable === 'online_voice'
        ? '语音'
        : row.resourceTable === 'online_test' ? '测试' : '';
    idToName[taskKey] = preferredIdToName[taskKey]
      || `${row.resourceName || row.taskShowName || row.taskName || taskKey}${typeLabel ? ` 类型:${typeLabel}` : ''}`;
    taskMetaByKey[taskKey] = {
      ...(preferredTaskMeta[taskKey] || {}),
      title: String(preferredTaskMeta[taskKey]?.title || row.resourceName || row.taskShowName || row.taskName || taskKey),
      groupTitle: String(preferredTaskMeta[taskKey]?.groupTitle || row.taskShowName || row.taskName || ''),
      groupOrder: Number.isFinite(preferredTaskMeta[taskKey]?.groupOrder)
        ? preferredTaskMeta[taskKey].groupOrder : orderedTaskKeys.length - 1,
      sourceOrder: Number.isFinite(preferredTaskMeta[taskKey]?.sourceOrder)
        ? preferredTaskMeta[taskKey].sourceOrder : orderedTaskKeys.length - 1,
      ...(row.resourceTable === 'online_test' && row.result?.allScore != null
        ? { scoreTotal: Number(row.result.allScore) }
        : {}),
    };
  }

  const data = [...students.values()].sort((left, right) => (
    String(left.no || '').localeCompare(String(right.no || ''), 'zh-CN', { numeric: true })
    || String(left.en_name || '').localeCompare(String(right.en_name || ''), 'en')
  ));
  // The legacy converter discovers columns from its first student. Historical
  // assignment-only students may not have unsupported legacy fields, so make
  // the row shape uniform before handing it to the unchanged report code.
  const allKeys = new Set(data.flatMap((row) => Object.keys(row)));
  for (const row of data) {
    for (const key of allKeys) {
      if (!Object.prototype.hasOwnProperty.call(row, key)) row[key] = '';
    }
  }
  const preferred = [...new Set((preferredTaskKeys || []).map(String))]
    .filter((taskKey) => orderedTaskKeySet.has(taskKey));
  const finalTaskKeys = [
    ...preferred,
    ...orderedTaskKeys.filter((taskKey) => !preferred.includes(taskKey)),
  ];
  return { data, idToName, orderedTaskKeys: finalTaskKeys, taskMetaByKey };
}

module.exports = {
  buildPublicityPayload,
  completionLabel,
  displayNumber,
  resultFields,
};
