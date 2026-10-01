import { describe, expect, it } from 'vitest';
import { createBonusItemDraft, describeDistributionScheme } from './distributionPreviewRules';

describe('distributionPreviewRules', () => {
  it('validates bonus drafts before adding them', () => {
    expect(createBonusItemDraft('', '', []).error).toBe('请填写：奖励名称、MP金额、至少选一名学生');
  });

  it('builds a bonus item draft when inputs are complete', () => {
    const result = createBonusItemDraft('加分', '0.5', ['001', '002']);
    expect(result.error).toBeNull();
    expect(result.item).toEqual({
      name: '加分',
      amount: 0.5,
      studentIds: ['001', '002'],
    });
  });

  it('describes scheme2 using the current settings', () => {
    expect(describeDistributionScheme('scheme2', { scheme2AllDoneAmount: 0.8 })).toContain('0.8 MP');
  });
});
