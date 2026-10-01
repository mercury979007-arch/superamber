import type { RuleTemplate, SchemeRuleConfig, SavedCustomScheme, StudentData } from '../types';
import { parsePercent } from './parseExcel';

export const RULE_TEMPLATES: RuleTemplate[] = [
  { id: 'all_done',           label: '全勤奖励 · 所有基础挑战全部完成', group: '全局',     hasThreshold: false, defaultAmount: 0.5, defaultThreshold: 0 },
  { id: 'completion_rate',    label: '完成比例 · 基础挑战达到阈值', group: '全局',         hasThreshold: true,  defaultAmount: 0.5, defaultThreshold: 0.8 },
  { id: 'audio_done',         label: '音频 · 完成',                  group: '音频',         hasThreshold: false, defaultAmount: 0.1, defaultThreshold: 0 },
  { id: 'theme_done',         label: '主题表达积累 · 完成',           group: '主题表达积累', hasThreshold: false, defaultAmount: 0.1, defaultThreshold: 0 },
  { id: 'theme_wordking',     label: '主题表达积累 · 成为词王',       group: '主题表达积累', hasThreshold: false, defaultAmount: 0.2, defaultThreshold: 0 },
  { id: 'theme_wordking_acc', label: '主题表达积累 · 词王准确率 ≥ 阈值', group: '主题表达积累', hasThreshold: true, defaultAmount: 0.2, defaultThreshold: 0.75 },
  { id: 'theme_repeat_avg_acc', label: '主题表达积累 · 重复环节平均正确率 ≥ 阈值', group: '主题表达积累', hasThreshold: true, defaultAmount: 0.2, defaultThreshold: 0.75 },
  { id: 'theme_repeat_first_acc', label: '主题表达积累 · 重复环节首次正确率 ≥ 阈值', group: '主题表达积累', hasThreshold: true, defaultAmount: 0.2, defaultThreshold: 0.75 },
  { id: 'challenge_done',     label: '小挑战 · 完成',                 group: '小挑战',       hasThreshold: false, defaultAmount: 0.1, defaultThreshold: 0 },
  { id: 'ai_done',            label: 'AI语音 · 完成',                 group: 'AI语音',       hasThreshold: false, defaultAmount: 0.1, defaultThreshold: 0 },
  { id: 'ai_score',           label: 'AI语音 · 平均分 ≥ 阈值',        group: 'AI语音',       hasThreshold: true,  defaultAmount: 0.2, defaultThreshold: 0.75 },
  { id: 'test_done',          label: '测试 · 完成',                   group: '测试',         hasThreshold: false, defaultAmount: 0.1, defaultThreshold: 0 },
  { id: 'test_score',         label: '测试 · 得分率 ≥ 阈值',          group: '测试',         hasThreshold: true,  defaultAmount: 0.2, defaultThreshold: 0.75 },
  { id: 'composite_done',     label: '复合资源 · 完成',               group: '复合资源',     hasThreshold: false, defaultAmount: 0.1, defaultThreshold: 0 },
  { id: 'video_done',         label: '视频 · 完成',                   group: '视频',         hasThreshold: false, defaultAmount: 0.1, defaultThreshold: 0 },
  { id: 'interactive_done',   label: '互动视频 · 完成',               group: '互动视频',     hasThreshold: false, defaultAmount: 0.1, defaultThreshold: 0 },
  { id: 'reading_done',       label: '高阶阅读 · 完成',               group: '高阶阅读',     hasThreshold: false, defaultAmount: 0.1, defaultThreshold: 0 },
];

const STORAGE_KEY = 'amber_custom_schemes';

export function loadSavedSchemes(): SavedCustomScheme[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as SavedCustomScheme[];
  } catch {
    return [];
  }
}

export function saveScheme(scheme: SavedCustomScheme): void {
  const list = loadSavedSchemes().filter((s) => s.id !== scheme.id);
  list.push(scheme);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

export function deleteScheme(id: string): void {
  const list = loadSavedSchemes().filter((s) => s.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

export function defaultRuleConfigs(): SchemeRuleConfig[] {
  return RULE_TEMPLATES.map((t) => ({
    templateId: t.id,
    enabled: false,
    amount: t.defaultAmount,
    threshold: t.defaultThreshold,
  }));
}

const RESOURCE_RULE_TYPES: Record<string, string> = {
  audio_done: '音频',
  theme_done: '主题表达积累',
  theme_wordking: '主题表达积累',
  theme_wordking_acc: '主题表达积累',
  theme_repeat_avg_acc: '主题表达积累',
  theme_repeat_first_acc: '主题表达积累',
  challenge_done: '小挑战',
  ai_done: 'AI语音',
  ai_score: 'AI语音',
  test_done: '测试',
  test_score: '测试',
  composite_done: '复合资源',
  video_done: '视频',
  interactive_done: '互动视频',
  reading_done: '高阶阅读',
};

export function defaultRuleConfigsForResourceTypes(resourceTypes: Iterable<string>): SchemeRuleConfig[] {
  const availableTypes = new Set(Array.from(resourceTypes, (value) => String(value || '').trim()).filter(Boolean));
  return defaultRuleConfigs().map((rule) => ({
    ...rule,
    // New accuracy dimensions stay opt-in so opening an existing custom plan
    // cannot silently add another reward for the same resource.
    enabled: !['theme_repeat_avg_acc', 'theme_repeat_first_acc'].includes(rule.templateId)
      && Boolean(RESOURCE_RULE_TYPES[rule.templateId] && availableTypes.has(RESOURCE_RULE_TYPES[rule.templateId])),
  }));
}

function isCompleted(val: unknown): boolean {
  return String(val ?? '').trim() === '已完成';
}

function isWordKing(val: unknown): boolean {
  return val !== null && val !== undefined && String(val).trim() === '是';
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function isOptionalResource(resourceName: string): boolean {
  return /(?:【|\[|\()\s*选做\s*(?:】|\]|\))|\boptional\b/i.test(String(resourceName || ''));
}

function testScoreRatio(columns: Record<string, string | number | null>): number | null {
  for (const [label, value] of Object.entries(columns)) {
    const match = label.match(/^分数[（(]\s*([\d.]+)\s*[）)]$/);
    const score = Number(value);
    const total = match ? Number(match[1]) : 0;
    if (Number.isFinite(score) && Number.isFinite(total) && total > 0) return score / total;
  }
  return null;
}

function percentFromAliases(
  columns: Record<string, string | number | null>,
  aliases: string[],
): number | null {
  for (const alias of aliases) {
    const value = parsePercent(columns[alias]);
    if (value !== null) return value;
  }
  return null;
}

export function calcCustomScheme(student: StudentData, scheme: SavedCustomScheme): number {
  const getRule = (id: string) => scheme.rules.find((r) => r.templateId === id);
  let mp = 0;

  const allDoneRule = getRule('all_done');
  if (allDoneRule?.enabled) {
    const requiredResources = student.resources.filter((res) => !isOptionalResource(res.resourceName));
    const allDone = requiredResources.length > 0
      && requiredResources.every((res) => isCompleted(res.columns['是否完成']));
    if (allDone) mp += allDoneRule.amount;
  }

  const completionRateRule = getRule('completion_rate');
  if (completionRateRule?.enabled) {
    const requiredResources = student.resources.filter((res) => !isOptionalResource(res.resourceName));
    const completedCount = requiredResources.filter((res) => isCompleted(res.columns['是否完成'])).length;
    const completionRate = requiredResources.length > 0 ? completedCount / requiredResources.length : 0;
    if (completionRate >= completionRateRule.threshold) mp += completionRateRule.amount;
  }

  for (const res of student.resources) {
    const c = res.columns;
    const type = res.resourceType;

    if (type === '音频') {
      const r = getRule('audio_done');
      if (r?.enabled && isCompleted(c['是否完成'])) mp += r.amount;
    } else if (type === '主题表达积累') {
      const doneR = getRule('theme_done');
      if (doneR?.enabled && isCompleted(c['是否完成'])) mp += doneR.amount;
      if (isWordKing(c['是否达到词王'])) {
        const wkR = getRule('theme_wordking');
        if (wkR?.enabled) mp += wkR.amount;
        const accR = getRule('theme_wordking_acc');
        if (accR?.enabled) {
          const acc = parsePercent(c['词王平均正确率']);
          if (acc !== null && acc >= accR.threshold) mp += accR.amount;
        }
      }
      const repeatAverageRule = getRule('theme_repeat_avg_acc');
      if (repeatAverageRule?.enabled) {
        const accuracy = percentFromAliases(c, [
          '重复环节平均正确率',
          '【不是词王pk数据！！！重复环节平均正确率】',
        ]);
        if (accuracy !== null && accuracy >= repeatAverageRule.threshold) mp += repeatAverageRule.amount;
      }
      const repeatFirstRule = getRule('theme_repeat_first_acc');
      if (repeatFirstRule?.enabled) {
        const accuracy = percentFromAliases(c, [
          '重复环节首次完成正确率',
          '【不是词王pk数据！！！重复环节首次完成正确率】',
        ]);
        if (accuracy !== null && accuracy >= repeatFirstRule.threshold) mp += repeatFirstRule.amount;
      }
    } else if (type === '小挑战') {
      const r = getRule('challenge_done');
      if (r?.enabled && isCompleted(c['是否完成'])) mp += r.amount;
    } else if (type === 'AI语音') {
      const doneR = getRule('ai_done');
      if (doneR?.enabled && isCompleted(c['是否完成'])) mp += doneR.amount;
      const scoreR = getRule('ai_score');
      if (scoreR?.enabled) {
        const avg = parsePercent(c['平均分']);
        if (avg !== null && avg >= scoreR.threshold) mp += scoreR.amount;
      }
    } else if (type === '测试') {
      const doneR = getRule('test_done');
      if (doneR?.enabled && isCompleted(c['是否完成'])) mp += doneR.amount;
      const scoreR = getRule('test_score');
      if (scoreR?.enabled) {
        const scoreRatio = testScoreRatio(c);
        if (scoreRatio !== null && scoreRatio >= scoreR.threshold) mp += scoreR.amount;
      }
    } else if (type === '复合资源') {
      const r = getRule('composite_done');
      if (r?.enabled && isCompleted(c['是否完成'])) mp += r.amount;
    } else if (type === '视频') {
      const r = getRule('video_done');
      if (r?.enabled && isCompleted(c['是否完成'])) mp += r.amount;
    } else if (type === '互动视频') {
      const r = getRule('interactive_done');
      if (r?.enabled && isCompleted(c['是否完成'])) mp += r.amount;
    } else if (type === '高阶阅读') {
      const r = getRule('reading_done');
      if (r?.enabled && isCompleted(c['是否完成'])) mp += r.amount;
    }
  }

  return round2(mp);
}
