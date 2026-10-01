const crypto = require('crypto');
const express = require('express');
const fs = require('fs/promises');
const path = require('path');

const MAX_HISTORY = 5;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeText(value, maxLength = 400) {
  return String(value ?? '').slice(0, maxLength);
}

function getClassCount(classData) {
  return isPlainObject(classData) ? Object.keys(classData).length : 0;
}

function parseDateKey(value) {
  const text = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const timestamp = Date.parse(`${text}T12:00:00Z`);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function modeLooksLikeStaleWeeklyRotation(incomingMode, latestMode) {
  if (!isPlainObject(incomingMode) || !isPlainObject(latestMode)) return false;
  const incomingDate = parseDateKey(incomingMode.locationInfo?.fullDate);
  const latestDate = parseDateKey(latestMode.locationInfo?.fullDate);
  const incomingArrangement = Number(incomingMode.currentArrangement);
  const latestArrangement = Number(latestMode.currentArrangement);
  return incomingDate !== null
    && latestDate !== null
    && latestDate - incomingDate === 7 * 24 * 60 * 60 * 1000
    && Number.isFinite(incomingArrangement)
    && Number.isFinite(latestArrangement)
    && latestArrangement === incomingArrangement + 1;
}

function preserveNewerWeeklyRotations(incomingBackup, latestBackup) {
  if (!isPlainObject(incomingBackup?.classData) || !isPlainObject(latestBackup?.classData)) return 0;
  let preservedClassCount = 0;

  Object.entries(incomingBackup.classData).forEach(([className, incomingConfig]) => {
    const latestConfig = latestBackup.classData[className];
    if (!isPlainObject(incomingConfig) || !isPlainObject(latestConfig)) return;
    const staleWeekday = modeLooksLikeStaleWeeklyRotation(incomingConfig.weekday, latestConfig.weekday);
    const staleWeekend = modeLooksLikeStaleWeeklyRotation(incomingConfig.weekend, latestConfig.weekend);
    if (!staleWeekday && !staleWeekend) return;

    // Keep non-seating edits from the incoming browser, but do not let an old
    // tab move the shared seating dates and arrangements back by one week.
    incomingBackup.classData[className] = {
      ...incomingConfig,
      theme: latestConfig.theme,
      previousWeek: latestConfig.previousWeek,
      weekday: latestConfig.weekday,
      weekend: latestConfig.weekend,
    };
    preservedClassCount += 1;
  });

  return preservedClassCount;
}

function normalizeAcademicTermLaunch(value) {
  if (!isPlainObject(value)
    || typeof value.termId !== 'string'
    || typeof value.week1Start !== 'string'
    || typeof value.completedAt !== 'string'
    || !Array.isArray(value.rotatedClassCodes)) {
    return undefined;
  }
  return {
    termId: sanitizeText(value.termId, 80),
    week1Start: sanitizeText(value.week1Start, 20),
    completedAt: sanitizeText(value.completedAt, 80),
    rotatedClassCodes: [...new Set(value.rotatedClassCodes
      .map((code) => sanitizeText(code, 80).trim().toUpperCase())
      .filter(Boolean))],
  };
}

function normalizeBackupPayload(input) {
  const raw = isPlainObject(input?.backup) ? input.backup : input;
  if (!isPlainObject(raw) || !isPlainObject(raw.classData) || getClassCount(raw.classData) === 0) {
    return null;
  }

  return {
    app: {
      name: sanitizeText(raw.app?.name || 'Super Amber', 120),
      slug: sanitizeText(raw.app?.slug || 'superamber', 80),
    },
    exportedAt: typeof raw.exportedAt === 'string' ? sanitizeText(raw.exportedAt, 80) : new Date().toISOString(),
    sourceOrigin: sanitizeText(raw.sourceOrigin, 240),
    classData: raw.classData,
    userProfile: {
      username: sanitizeText(raw.userProfile?.username, 120),
      theme: sanitizeText(raw.userProfile?.theme || 'paper', 40),
    },
    reminderMeta: isPlainObject(raw.reminderMeta) ? raw.reminderMeta : undefined,
    batchUndo: isPlainObject(raw.batchUndo) ? raw.batchUndo : null,
    academicTermLaunch: normalizeAcademicTermLaunch(raw.academicTermLaunch),
  };
}

function hashBackupPayload(backup) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({
      classData: backup.classData,
      userProfile: backup.userProfile,
      reminderMeta: backup.reminderMeta || null,
      batchUndo: backup.batchUndo || null,
      academicTermLaunch: backup.academicTermLaunch || null,
    }))
    .digest('hex');
}

function normalizeStore(input) {
  if (!isPlainObject(input)) {
    return { latest: null, history: [] };
  }
  return {
    latest: isPlainObject(input.latest) ? input.latest : null,
    history: Array.isArray(input.history) ? input.history.filter(isPlainObject).slice(0, MAX_HISTORY) : [],
  };
}

function parseFirstJsonObject(raw) {
  const text = String(raw || '');
  const start = text.search(/\S/);
  if (start < 0 || text[start] !== '{') return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, index + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function createSeatingBackupRoutes({ backupStorePath } = {}) {
  const router = express.Router();
  const resolvedBackupStorePath = backupStorePath || path.resolve(process.cwd(), 'data/seating-backup.json');
  let mutationQueue = Promise.resolve();

  function enqueueMutation(task) {
    const current = mutationQueue.catch(() => {}).then(task);
    mutationQueue = current;
    return current.finally(() => {
      if (mutationQueue === current) mutationQueue = Promise.resolve();
    });
  }

  async function readStore() {
    try {
      const raw = await fs.readFile(resolvedBackupStorePath, 'utf8');
      try {
        return { store: normalizeStore(JSON.parse(raw)), recovered: false, raw };
      } catch (error) {
        const recovered = parseFirstJsonObject(raw);
        if (!recovered) throw error;
        return { store: normalizeStore(recovered), recovered: true, raw };
      }
    } catch (error) {
      if (error.code === 'ENOENT') {
        return { store: { latest: null, history: [] }, recovered: false, raw: '' };
      }
      throw error;
    }
  }

  async function readClassLocks() {
    const locksPath = `${resolvedBackupStorePath}.locks.json`;
    try {
      const raw = await fs.readFile(locksPath, 'utf8');
      const parsed = JSON.parse(raw);
      return isPlainObject(parsed?.classData) ? parsed.classData : {};
    } catch (error) {
      if (error.code === 'ENOENT') return {};
      throw error;
    }
  }

  async function applyClassLocks(backup) {
    const lockedClassData = await readClassLocks();
    Object.entries(lockedClassData).forEach(([className, classConfig]) => {
      if (isPlainObject(classConfig)) {
        backup.classData[className] = classConfig;
      }
    });
    return backup;
  }

  async function writeStore(store) {
    await fs.mkdir(path.dirname(resolvedBackupStorePath), { recursive: true });
    const tempPath = `${resolvedBackupStorePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tempPath, `${JSON.stringify(normalizeStore(store), null, 2)}\n`, { mode: 0o600 });
    await fs.rename(tempPath, resolvedBackupStorePath);
    await fs.chmod(resolvedBackupStorePath, 0o600).catch(() => {});
  }

  async function repairStoreIfNeeded() {
    const snapshot = await readStore();
    if (!snapshot.recovered) return snapshot.store;
    const quarantinePath = `${resolvedBackupStorePath}.corrupt-${Date.now()}`;
    await fs.copyFile(resolvedBackupStorePath, quarantinePath);
    await fs.chmod(quarantinePath, 0o600).catch(() => {});
    await writeStore(snapshot.store);
    console.warn(`⚠️ 座位表备份文件已从首个完整快照恢复，损坏原件保留为 ${path.basename(quarantinePath)}`);
    return snapshot.store;
  }

  router.get('/seating/backup', async (_req, res) => {
    try {
      const store = await enqueueMutation(repairStoreIfNeeded);
      res.json({
        status: 'success',
        backup: store.latest?.backup || null,
        updatedAt: store.latest?.updatedAt || null,
        classCount: Number(store.latest?.classCount) || 0,
        historyCount: store.history.length,
      });
    } catch (error) {
      console.error('❌ 读取座位表备份失败:', error.message);
      res.status(500).json({ error: '读取座位表备份失败' });
    }
  });

  router.post('/seating/backup', async (req, res) => {
    try {
      const backup = normalizeBackupPayload(req.body);
      const allowDateRegression = req.body?.allowDateRegression === true;
      if (!backup) {
        return res.status(400).json({ error: '座位表备份为空，已拒绝覆盖现有备份' });
      }
      const result = await enqueueMutation(async () => {
        const store = await repairStoreIfNeeded();
        const preservedClassCount = allowDateRegression
          ? 0
          : preserveNewerWeeklyRotations(backup, store.latest?.backup);
        await applyClassLocks(backup);
        const hash = hashBackupPayload(backup);
        const classCount = getClassCount(backup.classData);
        if (store.latest?.hash === hash) {
          return {
            status: 'success',
            unchanged: true,
            updatedAt: store.latest.updatedAt,
            classCount,
            preservedClassCount,
          };
        }

        const latest = {
          updatedAt: new Date().toISOString(),
          classCount,
          hash,
          backup,
        };
        const history = [store.latest, ...store.history].filter(isPlainObject).slice(0, MAX_HISTORY);
        await writeStore({ latest, history });
        return {
          status: 'success',
          updatedAt: latest.updatedAt,
          classCount,
          historyCount: history.length,
          preservedClassCount,
        };
      });
      res.json(result);
    } catch (error) {
      console.error('❌ 保存座位表备份失败:', error.message);
      res.status(500).json({ error: '保存座位表备份失败' });
    }
  });

  return router;
}

module.exports = {
  createSeatingBackupRoutes,
  modeLooksLikeStaleWeeklyRotation,
  normalizeBackupPayload,
  parseFirstJsonObject,
  preserveNewerWeeklyRotations,
};
