import type { StudentData, MPBreakdown, SchemeId, Module, SavedCustomScheme, SchemeSettings } from '../types';
import { parsePercent } from './parseExcel';
import { calcCustomScheme } from './customScheme';

function isCompleted(val: unknown): boolean {
  return String(val ?? '').trim() === '已完成';
}

function isWordKing(val: unknown): boolean {
  return val !== null && val !== undefined && String(val).trim() === '是';
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

function calcScheme1(student: StudentData): number {
  let mp = 0;
  for (const res of student.resources) {
    const c = res.columns;
    const type = res.resourceType;
    if (type === '音频') {
      if (isCompleted(c['是否完成'])) mp += 0.1;
    } else if (type === '主题表达积累') {
      if (isCompleted(c['是否完成'])) mp += 0.1;
      if (isWordKing(c['是否达到词王'])) {
        mp += 0.2;
        const acc = parsePercent(c['词王平均正确率']);
        if (acc !== null && acc >= 0.75) mp += 0.2;
      }
    } else if (type === '小挑战') {
      if (isCompleted(c['是否完成'])) mp += 0.1;
    } else if (type === 'AI语音') {
      if (isCompleted(c['是否完成'])) mp += 0.1;
      const avg = parsePercent(c['平均分']);
      if (avg !== null && avg >= 0.75) mp += 0.2;
    } else if (type === '测试') {
      if (isCompleted(c['是否完成'])) mp += 0.1;
      const scoreRatio = testScoreRatio(c);
      if (scoreRatio !== null && scoreRatio >= 0.75) mp += 0.2;
    } else if (type === '复合资源') {
      if (isCompleted(c['是否完成'])) mp += 0.1;
    } else if (type === '视频') {
      if (isCompleted(c['是否完成'])) mp += 0.1;
    } else if (type === '互动视频') {
      if (isCompleted(c['是否完成'])) mp += 0.1;
    } else if (type === '高阶阅读') {
      if (isCompleted(c['是否完成'])) mp += 0.1;
    }
  }
  return round2(mp);
}

function calcScheme2(student: StudentData, allDoneAmount: number): number {
  const requiredResources = student.resources.filter((res) => !isOptionalResource(res.resourceName));
  const allDone = requiredResources.length > 0
    && requiredResources.every((res) => isCompleted(res.columns['是否完成']));
  return round2(allDone ? allDoneAmount : 0);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function calculateMP(
  students: StudentData[],
  scheme: SchemeId,
  dailyCheckInRate: number,
  modules: Set<Module>,
  customSchemeData?: SavedCustomScheme,
  schemeSettings: SchemeSettings = { scheme2AllDoneAmount: 0.5 }
): MPBreakdown[] {
  return students.map((s) => {
    let 基础落实: number;
    if (!modules.has('基础落实')) {
      基础落实 = 0;
    } else if (scheme === 'scheme1') {
      基础落实 = calcScheme1(s);
    } else if (scheme === 'scheme2') {
      基础落实 = calcScheme2(s, schemeSettings.scheme2AllDoneAmount);
    } else if (scheme.startsWith('custom_') && customSchemeData) {
      基础落实 = calcCustomScheme(s, customSchemeData);
    } else {
      基础落实 = 0;
    }

    const 每日开口 = modules.has('每日开口') ? round2(s.dailyCheckIns * dailyCheckInRate) : 0;
    const 课堂参与 = modules.has('课堂参与') ? round2(s.classParticipation) : 0;
    const 个性化奖励 = modules.has('个性化奖励')
      ? round2(s.bonusItems.reduce((acc, b) => acc + b.amount, 0))
      : 0;
    const total = round2(基础落实 + 每日开口 + 课堂参与 + 个性化奖励);
    return {
      studentId: s.studentId,
      chineseName: s.chineseName,
      englishName: s.englishName,
      基础落实,
      每日开口,
      课堂参与,
      个性化奖励,
      total,
    };
  });
}

export const SCHEMES = [
  {
    id: 'scheme1' as SchemeId,
    name: '方案一',
    description: '逐项累计：每完成一个挑战得 0.1 MP，成为词王额外 +0.2，词王准确率 ≥75% 再 +0.2，AI语音平均分 ≥75% 额外 +0.2，测试得分率 ≥75% 额外 +0.2',
  },
  {
    id: 'scheme2' as SchemeId,
    name: '方案二',
    description: '固定全勤奖励：只有所有基础挑战全部完成时，基础落实才发放你设置的固定 MP 值，不再叠加其他条件奖励',
  },
];
