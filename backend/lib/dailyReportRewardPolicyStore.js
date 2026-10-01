const fs = require('node:fs/promises');
const path = require('node:path');
const { ownerHash } = require('./taskRewardLedger');

const SYSTEM_POLICY = Object.freeze({
  version: 1,
  report: {
    mode: 'standard',
    includeSpeaking: true,
    minSpeakingDays: 2,
    testPassScore: null,
    aiVoicePassRate: 75,
  },
  sources: { basic: true, speaking: true },
  basic: { schemeId: 'scheme2', allDoneAmount: 0.5, customName: '', customRules: [] },
  speaking: {
    basePerDay: 0.1,
    streakThreshold: 3,
    streakMultiplier: 1,
    rewardMode: 'fixed',
    thresholdBonus: 0,
    ignoreSupplementVariance: false,
  },
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function finite(value, fallback, min = 0, max = 100) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function normalizeRules(value) {
  return (Array.isArray(value) ? value : []).slice(0, 40).map((rule) => ({
    templateId: String(rule?.templateId || '').trim().slice(0, 80),
    enabled: Boolean(rule?.enabled),
    amount: finite(rule?.amount, 0, 0, 100),
    threshold: finite(rule?.threshold, 0, 0, 1),
  })).filter((rule) => rule.templateId);
}

function normalizePolicy(value = {}) {
  const schemeId = ['scheme1', 'scheme2', 'custom'].includes(value?.basic?.schemeId)
    ? value.basic.schemeId
    : SYSTEM_POLICY.basic.schemeId;
  return {
    version: 1,
    report: {
      mode: ['standard', 'detail', 'senior'].includes(value?.report?.mode)
        ? value.report.mode
        : SYSTEM_POLICY.report.mode,
      includeSpeaking: value?.report?.includeSpeaking !== false,
      minSpeakingDays: Math.round(finite(value?.report?.minSpeakingDays, 2, 0, 7)),
      testPassScore: value?.report?.testPassScore === '' || value?.report?.testPassScore == null
        ? null
        : finite(value.report.testPassScore, null, 0, 100),
      aiVoicePassRate: finite(value?.report?.aiVoicePassRate, 75, 0, 100),
    },
    sources: {
      basic: value?.sources?.basic !== false,
      speaking: Boolean(value?.sources?.speaking),
    },
    basic: {
      schemeId,
      allDoneAmount: finite(value?.basic?.allDoneAmount, 0.5, 0, 100),
      customName: String(value?.basic?.customName || '').trim().slice(0, 80),
      customRules: normalizeRules(value?.basic?.customRules),
    },
    speaking: {
      basePerDay: finite(value?.speaking?.basePerDay ?? value?.speaking?.amountPerDay, 0.1, 0, 2),
      streakThreshold: Math.round(finite(value?.speaking?.streakThreshold, 3, 2, 14)),
      streakMultiplier: finite(value?.speaking?.streakMultiplier, 1, 1, 3),
      rewardMode: ['fixed', 'multiplier'].includes(value?.speaking?.rewardMode) ? value.speaking.rewardMode : 'fixed',
      thresholdBonus: finite(value?.speaking?.thresholdBonus, 0, 0, 20),
      ignoreSupplementVariance: Boolean(value?.speaking?.ignoreSupplementVariance),
    },
  };
}

function createDailyReportRewardPolicyStore({ storePath, now = () => new Date() }) {
  let state = { version: 1, teachers: {} };
  let loaded = false;
  let mutation = Promise.resolve();

  async function load() {
    if (loaded) return;
    loaded = true;
    try {
      const parsed = JSON.parse(await fs.readFile(storePath, 'utf8'));
      if (parsed?.version === 1 && parsed?.teachers) state = parsed;
    } catch {
      state = { version: 1, teachers: {} };
    }
  }

  async function persist() {
    await fs.mkdir(path.dirname(storePath), { recursive: true });
    const tempPath = `${storePath}.${process.pid}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(state, null, 2), { mode: 0o600 });
    await fs.rename(tempPath, storePath);
    await fs.chmod(storePath, 0o600);
  }

  function mutate(task) {
    const next = mutation.then(task, task);
    mutation = next.catch(() => {});
    return next;
  }

  async function get(username, classId) {
    await load();
    const teacher = state.teachers[ownerHash(username)] || {};
    const normalizedClassId = String(classId || '').trim().toUpperCase();
    if (teacher.classes?.[normalizedClassId]) {
      return { policy: normalizePolicy(teacher.classes[normalizedClassId].policy), scope: 'class', updatedAt: teacher.classes[normalizedClassId].updatedAt || '' };
    }
    if (teacher.default?.policy) {
      return { policy: normalizePolicy(teacher.default.policy), scope: 'teacher', updatedAt: teacher.default.updatedAt || '' };
    }
    return { policy: clone(SYSTEM_POLICY), scope: 'system', updatedAt: '' };
  }

  async function save(username, classId, scope, policy) {
    return mutate(async () => {
      await load();
      const hash = ownerHash(username);
      const normalizedClassId = String(classId || '').trim().toUpperCase();
      const normalizedPolicy = normalizePolicy(policy);
      const updatedAt = new Date(now()).toISOString();
      state.teachers[hash] ||= { default: null, classes: {} };
      if (scope === 'teacher') {
        state.teachers[hash].default = { policy: normalizedPolicy, updatedAt };
      } else if (scope === 'class' && normalizedClassId) {
        state.teachers[hash].classes[normalizedClassId] = { policy: normalizedPolicy, updatedAt };
      } else {
        throw new Error('奖励规则保存范围无效');
      }
      await persist();
      return get(username, normalizedClassId);
    });
  }

  async function clearClass(username, classId) {
    return mutate(async () => {
      await load();
      const teacher = state.teachers[ownerHash(username)];
      const normalizedClassId = String(classId || '').trim().toUpperCase();
      if (teacher?.classes) delete teacher.classes[normalizedClassId];
      await persist();
      return get(username, normalizedClassId);
    });
  }

  return { get, save, clearClass };
}

module.exports = { SYSTEM_POLICY, createDailyReportRewardPolicyStore, normalizePolicy };
