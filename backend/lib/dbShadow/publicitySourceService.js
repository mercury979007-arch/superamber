const { filterVideoPublicitySelection, videoTasksIgnored } = require('../videoTaskPolicy');
const { buildPublicityPayload } = require('./publicityAdapter');
const { reconcileRows } = require('./reconcile');
const { normalizeTeacherFilterPayload } = require('./teacherReference');
const { buildSpeakingLeaderboard } = require('../speakingChallenge');
const {
  addOneDay,
  buildCheckinPayload,
  buildRosterPayload,
  compareCheckinRows,
  compareLeaderboards,
  compareRosters,
} = require('./supplementalAdapter');

function normalizeClassCode(value) {
  return String(value || '').trim().toUpperCase();
}

async function resolveAuthorizedClass(scraper, classId) {
  if (!scraper || typeof scraper.getClassMap !== 'function') {
    const error = new Error('当前登录会话没有可验证的班级权限');
    error.code = 'DB_SOURCE_LOGIN_REQUIRED';
    throw error;
  }
  const classMap = await scraper.getClassMap();
  const requested = normalizeClassCode(classId);
  const match = (classMap || []).find((item) => (
    normalizeClassCode(item?.classCode) === requested
    || String(item?.squadId || '').trim() === String(classId || '').trim()
  ));
  if (!match || !Number.isInteger(Number(match.squadId)) || Number(match.squadId) <= 0) {
    const error = new Error('所选班级不属于当前登录老师');
    error.code = 'DB_SOURCE_SCOPE_DENIED';
    throw error;
  }
  return { classCode: normalizeClassCode(match.classCode || classId), squadId: Number(match.squadId) };
}

function stripInternal(value, { source, fallback }) {
  const publicity = value?.publicity || value;
  const { sourcePayload: _sourcePayload, ...safe } = publicity || {};
  return {
    ...safe,
    meta: {
      ...(safe.meta || {}),
      dataSource: source,
      databaseFallback: Boolean(fallback),
    },
  };
}

function normalizeEnabledDomains(value) {
  const source = Array.isArray(value) ? value : String(value || 'publicity').split(',');
  return new Set(source.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean));
}

function createPublicitySourceService({
  sourceSwitch,
  runtimeFactory,
  logger = console,
  enabledDomains = 'publicity',
  supplementMode = 'legacy-compatible',
} = {}) {
  if (!sourceSwitch || typeof sourceSwitch.execute !== 'function') {
    throw new Error('publicity source service requires a source switch');
  }
  let runtimePromise = null;
  let lastComparison = null;
  const lastComparisons = {};
  const domains = normalizeEnabledDomains(enabledDomains);

  function domainEnabled(domain) {
    return domains.has('*') || domains.has(domain);
  }

  function getRuntime() {
    if (!runtimePromise) runtimePromise = Promise.resolve().then(runtimeFactory).catch(error => { runtimePromise = null; throw error; });
    return runtimePromise;
  }

  function recordComparison(domain, reconciliation) {
    const summary = {
      at: new Date().toISOString(),
      status: reconciliation?.calculationsPassed ? 'pass' : 'fail',
      comparedFields: Number(reconciliation?.comparedFields) || 0,
      valueDifferenceCount: Number(reconciliation?.valueDifferenceCount) || 0,
      identity: reconciliation?.identity || null,
    };
    lastComparisons[domain] = summary;
    if (domain === 'publicity') lastComparison = summary;
    return reconciliation;
  }

  return {
    async fetch({ teacherIdentity, scraper, classId, selection = {} }) {
      const authorized = await resolveAuthorizedClass(scraper, classId);
      selection = filterVideoPublicitySelection(selection);
      const selectedIds = selection?.preparedSelection?.taskIds || [];
      const taskIds = [];
      const selectedResources = new Set();
      let unmapped = selectedIds.length === 0;
      for (const value of selectedIds) {
        const encoded = String(value).match(/^\d+_(\d+)_(\d+)_(packAttr|voice|test)$/);
        if (encoded) {
          taskIds.push(Number(encoded[1]));
          const table = { packAttr: 'online_word_pack', voice: 'online_voice', test: 'online_test' }[encoded[3]];
          selectedResources.add(`${Number(encoded[1])}:${Number(encoded[2])}:${table}`);
        } else if (/^[1-9]\d*$/.test(String(value))) {
          taskIds.push(Number(value));
        } else unmapped = true;
      }
      if (selectedResources.size && selectedIds.some(value => /^[1-9]\d*$/.test(String(value)))) unmapped = true;
      const mode = sourceSwitch.health().mode;

      const legacy = async () => {
        const publicity = await scraper.scrapePublicityExportData(classId, {
          ...selection,
          includeSourcePayload: mode === 'shadow',
        });
        return { publicity };
      };

      if (!domainEnabled('publicity')) return stripInternal(await legacy(), { source: 'legacy' });

      const database = async () => {
        if (unmapped || taskIds.length === 0) {
          const error = new Error('当前任务选择没有稳定 task_id，保留原链路');
          error.code = 'DB_SOURCE_UNMAPPED_TASK';
          throw error;
        }
        const runtime = await getRuntime();
        const rawSnapshot = await runtime.run({ taskIds: [...new Set(taskIds)], squadIds: [authorized.squadId] });
        const snapshot = selectedResources.size ? {
          ...rawSnapshot,
          rows: rawSnapshot.rows.filter(row => selectedResources.has(`${row.taskId}:${row.resourceId}:${row.resourceTable}`)),
        } : rawSnapshot;
        if (selectedResources.size) {
          const found = new Set(snapshot.rows.map(row => `${row.taskId}:${row.resourceId}:${row.resourceTable}`));
          if ([...selectedResources].some(key => !found.has(key))) {
            const error = new Error('数据库缺少所选资源，保留完整原链路结果');
            error.code = 'DB_SOURCE_UNSUPPORTED_SCOPE';
            throw error;
          }
          snapshot.summary = { ...snapshot.summary, unsupportedAssignmentRows: snapshot.rows.filter(row => !row.supported).length };
        }
        if (mode !== 'shadow' && snapshot.summary.unsupportedAssignmentRows > 0) {
          const error = new Error('当前选择包含本轮未接入的资源，保留完整原链路结果');
          error.code = 'DB_SOURCE_UNSUPPORTED_SCOPE';
          throw error;
        }
        const adapted = buildPublicityPayload(snapshot.rows, {
          preferredIdToName: selection?.preparedSelection?.idToName || {},
          preferredTaskKeys: selection?.preparedSelection?.orderedTaskKeys || [],
          preferredTaskMeta: selection?.preparedSelection?.taskMetaByKey || {},
        });
        const tableRows = scraper.convertStudentFilterToTableRows(
          adapted,
          adapted.idToName,
          adapted.orderedTaskKeys,
          adapted.taskMetaByKey,
        );
        if (!Array.isArray(tableRows) || tableRows.length <= 3) {
          throw new Error('数据库结果无法生成有效公示表');
        }
        return {
          snapshot,
          publicity: {
            classId: authorized.classCode,
            squadId: authorized.squadId,
            week: null,
            tableRows,
            selectedTaskResult: { matched: selection.selectedTasks || [], missing: [] },
            meta: {
              transport: 'database-read-only',
              rowCount: tableRows.length,
              colCount: tableRows[0]?.length || 0,
            },
          },
        };
      };

      const compare = async (databaseValue, legacyValue) => {
        const teacherPayload = legacyValue?.publicity?.sourcePayload?.studentData;
        if (!teacherPayload) {
          lastComparison = {
            at: new Date().toISOString(),
            status: 'unavailable',
            reason: 'legacy-source-payload-unavailable',
          };
          return { calculationsPassed: null };
        }
        const supportedRows = databaseValue.snapshot.rows.filter((row) => row.supported && row.result);
        const normalized = normalizeTeacherFilterPayload(teacherPayload, supportedRows);
        const reconciliation = reconcileRows(supportedRows, normalized);
        return recordComparison('publicity', reconciliation);
      };

      const selected = await sourceSwitch.execute({
        teacherIdentity,
        requestedSquadIds: [authorized.squadId],
        authorizedSquadIds: [authorized.squadId],
        legacy,
        database,
        compare,
      });
      return stripInternal(selected.value, selected);
    },
    async fetchRoster({ teacherIdentity, scraper, classId, legacy }) {
      const authorized = await resolveAuthorizedClass(scraper, classId);
      if (!domainEnabled('roster')) return legacy(authorized);
      const selected = await sourceSwitch.execute({
        teacherIdentity,
        requestedSquadIds: [authorized.squadId],
        authorizedSquadIds: [authorized.squadId],
        legacy: async () => legacy(authorized),
        database: async () => {
          const runtime = await getRuntime();
          const snapshot = await runtime.readRoster({ squadIds: [authorized.squadId] });
          return buildRosterPayload(snapshot.rows, authorized);
        },
        compare: async (databaseValue, legacyValue) => (
          recordComparison('roster', compareRosters(databaseValue, legacyValue))
        ),
      });
      return selected.value;
    },
    async fetchCheckinRows({
      teacherIdentity,
      scraper,
      classId,
      rangeStart,
      rangeEnd,
      legacy,
    }) {
      const authorized = await resolveAuthorizedClass(scraper, classId);
      if (!domainEnabled('checkin')) return legacy(authorized);
      const selected = await sourceSwitch.execute({
        teacherIdentity,
        requestedSquadIds: [authorized.squadId],
        authorizedSquadIds: [authorized.squadId],
        legacy: async () => legacy(authorized),
        database: async () => {
          const runtime = await getRuntime();
          const roster = await runtime.readRoster({ squadIds: [authorized.squadId] });
          const attendance = await runtime.readAttendance({
            studentIds: roster.rows.map((row) => row.studentId),
            from: rangeStart,
            toExclusive: addOneDay(rangeEnd),
          });
          return buildCheckinPayload(roster.rows, attendance.rows, {
            ...authorized,
            rangeStart,
            rangeEnd,
            supplementMode,
          });
        },
        compare: async (databaseValue, legacyValue) => (
          recordComparison('checkin', compareCheckinRows(databaseValue, legacyValue))
        ),
      });
      return selected.value;
    },
    async fetchSpeakingChallenge({ teacherIdentity, scraper, classId, window, legacy }) {
      const authorized = await resolveAuthorizedClass(scraper, classId);
      if (!domainEnabled('speaking')) return legacy(authorized);
      const selected = await sourceSwitch.execute({
        teacherIdentity,
        requestedSquadIds: [authorized.squadId],
        authorizedSquadIds: [authorized.squadId],
        legacy: async () => legacy(authorized),
        database: async () => {
          const runtime = await getRuntime();
          const roster = await runtime.readRoster({ squadIds: [authorized.squadId] });
          const attendance = await runtime.readAttendance({
            studentIds: roster.rows.map((row) => row.studentId),
            from: window.start,
            toExclusive: addOneDay(window.end),
          });
          const checkin = buildCheckinPayload(roster.rows, attendance.rows, {
            ...authorized,
            rangeStart: window.start,
            rangeEnd: window.end,
            supplementMode,
          });
          return {
            ...buildSpeakingLeaderboard({
              classCode: authorized.classCode,
              squadId: authorized.squadId,
              roster: checkin.rows,
              rows: checkin.rows,
              window,
            }),
            updatedAt: new Date().toISOString(),
          };
        },
        compare: async (databaseValue, legacyValue) => (
          recordComparison('speaking', compareLeaderboards(databaseValue, legacyValue))
        ),
      });
      return selected.value;
    },
    health() {
      return {
        ...sourceSwitch.health(),
        enabledDomains: [...domains].sort(),
        supplementMode,
        ignoredVideoTasks: videoTasksIgnored(),
        lastComparison,
        lastComparisons: { ...lastComparisons },
      };
    },
    async close() {
      await sourceSwitch.drain();
      if (!runtimePromise) return;
      const runtime = await runtimePromise.catch(() => null);
      await runtime?.close?.();
    },
  };
}

module.exports = {
  createPublicitySourceService,
  normalizeEnabledDomains,
  resolveAuthorizedClass,
  stripInternal,
};
