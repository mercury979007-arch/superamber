const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

function ownerHash(username = '') {
  return crypto.createHash('sha256').update(String(username).trim().toLowerCase()).digest('hex');
}

function normalizeIds(values, limit = 100) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean))].slice(0, limit);
}

function normalizeRewards(values) {
  return (Array.isArray(values) ? values : []).map((reward) => ({
    studentId: String(reward?.studentId || '').trim(),
    studentName: String(reward?.studentName || '').trim(),
    chineseName: String(reward?.chineseName || '').trim(),
    amount: Number(reward?.amount) || 0,
    sourceKeys: normalizeIds(reward?.sourceKeys, 80),
  })).filter((reward) => reward.studentId && reward.amount > 0);
}

function publicEntry(entry) {
  if (!entry) return null;
  const successful = new Set(normalizeIds(entry.successfulStudentIds));
  const failed = new Set(normalizeIds(entry.failedStudentIds));
  return {
    id: entry.id,
    classId: entry.classId,
    status: entry.status,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    error: String(entry.error || ''),
    students: normalizeRewards(entry.rewards).map((reward) => ({
      studentId: reward.studentId,
      studentName: reward.studentName,
      chineseName: reward.chineseName,
      amount: reward.amount,
      status: successful.has(reward.studentId) ? 'confirmed' : failed.has(reward.studentId) ? 'not-received' : 'unresolved',
    })),
  };
}

function matchGrantRecords(entry, records) {
  const createdAt = Date.parse(entry?.createdAt || '');
  if (!Number.isFinite(createdAt)) return [];
  const groups = new Map();
  for (const record of Array.isArray(records) ? records : []) {
    const occurredAt = Date.parse(record?.occurredAt || '');
    const studentId = String(record?.studentNo || '').trim();
    if (!studentId || !Number.isFinite(occurredAt)
      || occurredAt < createdAt - 30_000 || occurredAt > createdAt + 5 * 60_000) continue;
    const type = String(record?.type || '');
    const tagName = String(record?.tagName || '');
    if ((type && type !== '1' && !type.includes('发放')) || (tagName && !/MP|MiniPin/i.test(tagName))) continue;
    const key = JSON.stringify([studentId, record.occurredAt, record.addedBy || '', tagName]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  const matched = [];
  for (const reward of normalizeRewards(entry?.rewards)) {
    const candidates = [...groups.values()].filter((rows) => (
      String(rows[0]?.studentNo || '').trim() === reward.studentId
      && rows.every((row) => Number(row?.amount) > 0)
      && Math.abs(rows.reduce((sum, row) => sum + Number(row.amount), 0) - reward.amount) < 0.001
    ));
    if (candidates.length === 1) matched.push(reward.studentId);
  }
  return matched;
}

function overlaps(left, right) {
  const rightSet = new Set(right);
  return left.some((value) => rightSet.has(value));
}

function createTaskRewardLedger({ storePath, now = () => new Date() }) {
  let loaded = false;
  let entries = [];
  let mutation = Promise.resolve();

  async function load() {
    if (loaded) return;
    loaded = true;
    try {
      const raw = JSON.parse(await fs.readFile(storePath, 'utf8'));
      entries = Array.isArray(raw?.entries) ? raw.entries : [];
    } catch {
      entries = [];
    }
  }

  async function persist() {
    await fs.mkdir(path.dirname(storePath), { recursive: true });
    const tempPath = `${storePath}.${process.pid}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify({ version: 1, entries: entries.slice(-5000) }, null, 2), { mode: 0o600 });
    await fs.rename(tempPath, storePath);
    await fs.chmod(storePath, 0o600);
  }

  function runMutation(task) {
    const next = mutation.then(task, task);
    mutation = next.catch(() => {});
    return next;
  }

  async function begin({ username, classId, selectedWeekIds, rewards }) {
    return runMutation(async () => {
      await load();
      const normalizedClassId = String(classId || '').trim().toUpperCase();
      const normalizedWeekIds = normalizeIds(selectedWeekIds, 20);
      const normalizedRewards = normalizeRewards(rewards);
      if (!normalizedClassId || normalizedRewards.length === 0
        || normalizedRewards.some((reward) => reward.sourceKeys.length === 0 && normalizedWeekIds.length === 0)) {
        throw new Error('任务奖励结算信息不完整');
      }
      const hash = ownerHash(username);
      const conflictingStudents = new Set();
      for (const entry of entries) {
        if (entry.ownerHash !== hash || entry.classId !== normalizedClassId) continue;
        const protectedIds = entry.status === 'complete'
          ? normalizeIds(entry.successfulStudentIds)
          : normalizeIds((entry.rewards || []).map((reward) => reward.studentId));
        const protectedSet = new Set(protectedIds);
        for (const reward of normalizedRewards) {
          if (!protectedSet.has(reward.studentId)) continue;
          const previousReward = (entry.rewards || []).find((item) => String(item?.studentId || '') === reward.studentId);
          const previousKeys = normalizeIds(previousReward?.sourceKeys?.length ? previousReward.sourceKeys : entry.selectedWeekIds, 100);
          const nextKeys = reward.sourceKeys.length ? reward.sourceKeys : normalizedWeekIds;
          if (overlaps(previousKeys, nextKeys)) conflictingStudents.add(reward.studentId);
        }
      }
      if (conflictingStudents.size > 0) {
        return { ok: false, conflictingStudentIds: [...conflictingStudents] };
      }
      const entry = {
        id: crypto.randomUUID(),
        ownerHash: hash,
        classId: normalizedClassId,
        selectedWeekIds: normalizedWeekIds,
        rewards: normalizedRewards,
        status: 'pending',
        successfulStudentIds: [],
        failedStudentIds: [],
        createdAt: new Date(now()).toISOString(),
        updatedAt: new Date(now()).toISOString(),
      };
      entries.push(entry);
      await persist();
      return { ok: true, entryId: entry.id };
    });
  }

  async function complete(entryId, { successfulStudentIds = [], failedStudentIds = [] } = {}) {
    return runMutation(async () => {
      await load();
      const entry = entries.find((item) => item.id === entryId);
      if (!entry) return;
      entry.status = 'complete';
      entry.successfulStudentIds = normalizeIds(successfulStudentIds);
      entry.failedStudentIds = normalizeIds(failedStudentIds);
      entry.updatedAt = new Date(now()).toISOString();
      await persist();
    });
  }

  async function uncertain(entryId, message = '') {
    return runMutation(async () => {
      await load();
      const entry = entries.find((item) => item.id === entryId);
      if (!entry) return;
      entry.status = 'uncertain';
      entry.error = String(message || '').slice(0, 300);
      entry.updatedAt = new Date(now()).toISOString();
      await persist();
    });
  }

  async function latest({ username, classId, status = '' }) {
    await load();
    const hash = ownerHash(username);
    const normalizedClassId = String(classId || '').trim().toUpperCase();
    const entry = [...entries].reverse().find((item) => item.ownerHash === hash
      && item.classId === normalizedClassId && (!status || item.status === status));
    return publicEntry(entry);
  }

  async function recoverable({ username, classId, pendingTimeoutMs = 5 * 60_000 }) {
    return runMutation(async () => {
      await load();
      const hash = ownerHash(username);
      const normalizedClassId = String(classId || '').trim().toUpperCase();
      const entry = [...entries].reverse().find((item) => item.ownerHash === hash
        && item.classId === normalizedClassId
        && (item.status === 'pending' || item.status === 'uncertain'));
      if (!entry) return null;
      const age = new Date(now()).getTime() - Date.parse(entry.createdAt || '');
      if (entry.status === 'pending' && Number.isFinite(age) && age >= pendingTimeoutMs) {
        entry.status = 'uncertain';
        entry.error = entry.error || '服务在发放处理中断，结果需要核对';
        entry.updatedAt = new Date(now()).toISOString();
        await persist();
      }
      return publicEntry(entry);
    });
  }

  async function reconcile({ username, classId, entryId, records }) {
    return runMutation(async () => {
      await load();
      const entry = entries.find((item) => item.id === entryId
        && item.ownerHash === ownerHash(username)
        && item.classId === String(classId || '').trim().toUpperCase());
      if (!entry || (entry.status !== 'pending' && entry.status !== 'uncertain')) return null;
      const matched = new Set([...normalizeIds(entry.successfulStudentIds), ...matchGrantRecords(entry, records)]);
      entry.successfulStudentIds = [...matched];
      entry.updatedAt = new Date(now()).toISOString();
      if (matched.size === normalizeRewards(entry.rewards).length) {
        entry.status = 'complete';
        entry.failedStudentIds = [];
        entry.error = '';
      } else if (matched.size > 0) {
        entry.status = 'uncertain';
        entry.error = entry.error || '仅核对到部分学生到账';
      }
      await persist();
      return publicEntry(entry);
    });
  }

  async function releaseUnconfirmed({ username, classId, entryId, acknowledgedNotReceived }) {
    if (acknowledgedNotReceived !== true) throw new Error('请先确认已在官网核对未到账学生');
    return runMutation(async () => {
      await load();
      const entry = entries.find((item) => item.id === entryId
        && item.ownerHash === ownerHash(username)
        && item.classId === String(classId || '').trim().toUpperCase());
      if (!entry || entry.status !== 'uncertain') return null;
      const successful = new Set(normalizeIds(entry.successfulStudentIds));
      entry.failedStudentIds = normalizeRewards(entry.rewards).map((reward) => reward.studentId).filter((id) => !successful.has(id));
      entry.status = 'complete';
      entry.error = '';
      entry.updatedAt = new Date(now()).toISOString();
      await persist();
      return publicEntry(entry);
    });
  }

  return { begin, complete, uncertain, latest, recoverable, reconcile, releaseUnconfirmed };
}

module.exports = { createTaskRewardLedger, ownerHash, matchGrantRecords };
