import type { StudentData, SavedCustomScheme } from '../types';
import { calcCustomScheme, defaultRuleConfigs, RULE_TEMPLATES } from './customScheme';

export function reportRewardScheme(basic: { schemeId: string; allDoneAmount: number; customRules: SavedCustomScheme['rules'] }): SavedCustomScheme {
  const presetRuleIds = new Set([
    'audio_done', 'theme_done', 'theme_wordking', 'theme_wordking_acc',
    'challenge_done', 'ai_done', 'ai_score', 'test_done', 'test_score',
    'composite_done', 'video_done', 'interactive_done', 'reading_done',
  ]);
  const rules = basic.schemeId === 'custom' ? basic.customRules : defaultRuleConfigs().map(rule => ({
    ...rule,
    enabled: basic.schemeId === 'scheme2' ? rule.templateId === 'all_done' : presetRuleIds.has(rule.templateId),
    amount: basic.schemeId === 'scheme2' && rule.templateId === 'all_done' ? basic.allDoneAmount : rule.amount,
  }));
  return { id: 'custom_explanation', name: '当前奖励明细', createdAt: 0, rules };
}

export function reportRuleLabel(rule: SavedCustomScheme['rules'][number]): string {
  const template = RULE_TEMPLATES.find(item => item.id === rule.templateId);
  return (template?.label || rule.templateId).replace('阈值', `${Math.round(rule.threshold * 10000) / 100}%`);
}

export function reportRewardDetails(student: StudentData, scheme: SavedCustomScheme) {
  return scheme.rules.filter(rule => rule.enabled).flatMap(rule => {
    const template = RULE_TEMPLATES.find(item => item.id === rule.templateId);
    const global = template?.group === '全局';
    const required = student.resources.filter(resource => !/(?:【|\[|\()\s*选做\s*(?:】|\]|\))|\boptional\b/i.test(resource.resourceName));
    const subjects = global ? [student] : student.resources.filter(resource => resource.resourceType === template?.group).map(resource => ({ ...student, resources: [resource] }));
    return subjects.map(subject => ({
      task: global ? '全部基础挑战' : subject.resources[0].resourceName,
      rule: reportRuleLabel(rule),
      evidence: global ? `${required.filter(resource => String(resource.columns['是否完成']) === '已完成').length}/${required.length} 项必做完成（选做不计入全勤）` : Object.entries(subject.resources[0].columns).map(([key, value]) => `${key}：${value ?? '无数据'}`).join('；'),
      amount: calcCustomScheme(subject, { ...scheme, rules: [rule] }),
    }));
  });
}
