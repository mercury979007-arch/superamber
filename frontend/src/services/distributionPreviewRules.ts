import type { BonusItem, SavedCustomScheme, SchemeId, SchemeSettings } from '../types';
import { SCHEMES } from '../utils/calculateMP';

export function createBonusItemDraft(
  bonusName: string,
  bonusAmount: string,
  studentIds: Iterable<string>,
): { error: string | null; item: BonusItem | null } {
  const amount = parseFloat(bonusAmount);
  const selectedStudentIds = Array.from(studentIds);
  const missing: string[] = [];

  if (!bonusName.trim()) missing.push('奖励名称');
  if (Number.isNaN(amount)) missing.push('MP金额');
  if (selectedStudentIds.length === 0) missing.push('至少选一名学生');

  if (missing.length > 0) {
    return {
      error: `请填写：${missing.join('、')}`,
      item: null,
    };
  }

  return {
    error: null,
    item: {
      name: bonusName.trim(),
      amount,
      studentIds: selectedStudentIds,
    },
  };
}

export function describeDistributionScheme(
  scheme: SchemeId,
  schemeSettings: SchemeSettings,
  customSchemeData?: SavedCustomScheme,
): string {
  const builtin = SCHEMES.find((item) => item.id === scheme);
  if (builtin) {
    if (builtin.id === 'scheme2') {
      return `固定全勤奖励：只有所有基础挑战全部完成时，基础落实才发放 ${schemeSettings.scheme2AllDoneAmount} MP；不再叠加词王、准确率、AI语音、测试这些条件奖励`;
    }
    return builtin.description;
  }

  if (customSchemeData) {
    const enabled = customSchemeData.rules.filter((rule) => rule.enabled);
    return `自定义方案 · ${enabled.length} 条规则已启用`;
  }

  return '';
}
