import { describe, expect, it } from 'vitest';
import type { SavedCustomScheme, StudentData } from '../types';
import { calculateMP } from './calculateMP';
import { calcCustomScheme, defaultRuleConfigs, defaultRuleConfigsForResourceTypes } from './customScheme';

function student(resources: StudentData['resources']): StudentData {
  return {
    studentId: 's1', chineseName: '小安', englishName: 'Amber', classCode: 'J328',
    resources, dailyCheckIns: 0, classParticipation: 0, bonusItems: [],
  };
}

describe('task reward rules', () => {
  it('enables default custom rules only for resource types present in the report', () => {
    const rules = defaultRuleConfigsForResourceTypes(['主题表达积累', '测试']);
    expect(rules.filter((rule) => rule.enabled).map((rule) => rule.templateId)).toEqual([
      'theme_done',
      'theme_wordking',
      'theme_wordking_acc',
      'test_done',
      'test_score',
    ]);
  });

  it('scheme2 requires every required task but does not let optional work block the reward', () => {
    const data = student([
      { resourceName: '[音频] 必做', resourceType: '音频', columns: { 是否完成: '已完成' } },
      { resourceName: '[选做] 拓展', resourceType: '视频', columns: { 是否完成: '未完成' } },
    ]);
    const [result] = calculateMP([data], 'scheme2', 0.1, new Set(['基础落实']), undefined, { scheme2AllDoneAmount: 0.5 });
    expect(result.基础落实).toBe(0.5);
  });

  it('custom completion threshold is calculated from required tasks only', () => {
    const data = student([
      { resourceName: '[音频] A', resourceType: '音频', columns: { 是否完成: '已完成' } },
      { resourceName: '[视频] B', resourceType: '视频', columns: { 是否完成: '未完成' } },
      { resourceName: '【选做】C', resourceType: '视频', columns: { 是否完成: '未完成' } },
    ]);
    const rules = defaultRuleConfigs().map((rule) => rule.templateId === 'completion_rate'
      ? { ...rule, enabled: true, amount: 0.4, threshold: 0.5 }
      : rule);
    const scheme: SavedCustomScheme = { id: 'custom_test', name: '达到一半', rules, createdAt: 1 };
    expect(calcCustomScheme(data, scheme)).toBe(0.4);
  });

  it('keeps repeat accuracy rewards opt-in and evaluates both exported metrics independently', () => {
    const defaults = defaultRuleConfigsForResourceTypes(['主题表达积累']);
    expect(defaults.find((rule) => rule.templateId === 'theme_repeat_avg_acc')?.enabled).toBe(false);
    expect(defaults.find((rule) => rule.templateId === 'theme_repeat_first_acc')?.enabled).toBe(false);

    const data = student([{
      resourceName: '主题表达',
      resourceType: '主题表达积累',
      columns: {
        '是否完成': '已完成',
        '是否达到词王': '否',
        '【不是词王pk数据！！！重复环节首次完成正确率】': '72%',
        '【不是词王pk数据！！！重复环节平均正确率】': '82%',
      },
    }]);
    const rules = defaultRuleConfigs().map((rule) => {
      if (rule.templateId === 'theme_repeat_avg_acc') return { ...rule, enabled: true, amount: 0.3, threshold: 0.8 };
      if (rule.templateId === 'theme_repeat_first_acc') return { ...rule, enabled: true, amount: 0.4, threshold: 0.75 };
      return rule;
    });
    const scheme: SavedCustomScheme = { id: 'repeat_accuracy', name: '重复准确率', rules, createdAt: 1 };
    expect(calcCustomScheme(data, scheme)).toBe(0.3);
  });
});
