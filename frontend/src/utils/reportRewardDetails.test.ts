import { describe, expect, it } from 'vitest';
import { reportRewardDetails, reportRewardScheme } from './reportRewardDetails';
import { calculateMP } from './calculateMP';
import { defaultRuleConfigs } from './customScheme';
import type { StudentData, SchemeId } from '../types';

describe('report reward explanations', () => {
  for (const complete of ['已完成', '未完成']) for (const score of ['74%', '75%', '100%', '']) for (const schemeId of ['scheme1', 'scheme2', 'custom']) {
    it(`${schemeId} ${complete} ${score}: explained amounts equal the existing award calculation`, () => {
      const student: StudentData = { studentId:'1', chineseName:'李', englishName:'Demo复姓', classCode:'J328',dailyCheckIns:0,classParticipation:0,bonusItems:[],resources:[
        {resourceName:'昨天 AI 语音',resourceType:'AI语音',columns:{'是否完成':complete,'平均分':score}},
        {resourceName:'昨天词王',resourceType:'主题表达积累',columns:{'是否完成':complete,'是否达到词王':'是','词王平均正确率':score}},
        {resourceName:'【选做】测试',resourceType:'测试',columns:{'是否完成':complete,'分数(100)':75}},
      ]};
      const basic = {schemeId,allDoneAmount:0.8,customRules:defaultRuleConfigs().map(r=>({...r, enabled:true}))};
      const scheme=reportRewardScheme(basic);
      const expected=calculateMP([student], (schemeId==='custom'?'custom_explanation':schemeId) as SchemeId,0,new Set(['基础落实']),scheme,{scheme2AllDoneAmount:.8})[0].基础落实;
      const items=reportRewardDetails(student,scheme);
      expect(Math.round(items.reduce((sum,item)=>sum+item.amount,0)*100)/100).toBe(expected);
      if(schemeId==='scheme1') {expect(items.some(item=>item.task==='昨天 AI 语音'&&item.evidence.includes(score))).toBe(true);expect(items.some(item=>item.rule.includes('75%'))).toBe(true);}
      if(schemeId==='scheme1') expect(scheme.rules.filter(rule => rule.enabled).map(rule => rule.templateId)).not.toContain('theme_repeat_avg_acc');
    });
  }
});
