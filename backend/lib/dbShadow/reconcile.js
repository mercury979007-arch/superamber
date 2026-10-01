const FIELD_TOLERANCE = 0.01;

function normalizeReferenceRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.rows)) return payload.rows;
  throw new Error('对账文件必须是数组，或包含 rows 数组');
}

function valuesEqual(actual, expected, tolerance = FIELD_TOLERANCE) {
  if (actual === null || actual === undefined || actual === '') {
    return expected === null || expected === undefined || expected === '';
  }
  if (typeof actual === 'boolean' || typeof expected === 'boolean') {
    return Boolean(actual) === Boolean(expected);
  }
  const actualNumber = Number(actual);
  const expectedNumber = Number(expected);
  if (Number.isFinite(actualNumber) && Number.isFinite(expectedNumber)) {
    return Math.abs(actualNumber - expectedNumber) <= tolerance;
  }
  return String(actual).trim() === String(expected).trim();
}

function reconcileRows(databaseRows, referencePayload, options = {}) {
  const referenceRows = normalizeReferenceRows(referencePayload);
  const referenceByKey = new Map(referenceRows.map((row) => [row.key, row]));
  const differences = [];
  let comparedFields = 0;

  for (const databaseRow of databaseRows) {
    const reference = referenceByKey.get(databaseRow.key);
    if (!reference) {
      differences.push({ type: 'missing-reference', key: databaseRow.key });
      continue;
    }
    referenceByKey.delete(databaseRow.key);
    const expectedResult = reference.result || {};
    for (const [field, expected] of Object.entries(expectedResult)) {
      comparedFields += 1;
      const actual = databaseRow.result?.[field];
      if (!valuesEqual(actual, expected, options.tolerance)) {
        differences.push({ type: 'value', key: databaseRow.key, field, actual, expected });
      }
    }
  }

  for (const key of referenceByKey.keys()) {
    differences.push({ type: 'missing-database', key });
  }

  const valueDifferenceCount = differences.filter((item) => item.type === 'value').length;
  const missingReferenceCount = differences.filter((item) => item.type === 'missing-reference').length;
  const missingDatabaseCount = differences.filter((item) => item.type === 'missing-database').length;
  return {
    passed: differences.length === 0,
    calculationsPassed: valueDifferenceCount === 0,
    databaseRows: databaseRows.length,
    referenceRows: referenceRows.length,
    comparedFields,
    differenceCount: differences.length,
    valueDifferenceCount,
    missingReferenceCount,
    missingDatabaseCount,
    differences,
  };
}

module.exports = {
  normalizeReferenceRows,
  reconcileRows,
  valuesEqual,
};
