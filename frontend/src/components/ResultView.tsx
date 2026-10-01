import { useMemo, useRef, useState } from 'react';
import type { BonusItem, ClassInfo, MPBreakdown, StudentData, SchemeSettings } from '../types';
import { generateOutputExcel } from '../utils/parseExcel';
import {
  DistributionSubmitError,
  downloadDistributionFallbackExcel,
  submitDistributionRewards,
} from '../services/distributionQuickApi';
import './ResultView.css';

interface Props {
  results: MPBreakdown[];
  students: StudentData[];
  bonusItems: BonusItem[];
  classCode: string;
  classInfo: ClassInfo;
  week: number;
  schemeSettings: SchemeSettings;
  onBack: () => void;
  onSessionExpired?: () => void;
  taskSelection?: {
    source: 'class-daily-report';
    selectedWeekIds: string[];
    snapshotUpdatedAt: string;
  } | null;
}

type SortKey = 'total_desc' | 'total_asc' | 'en_asc' | 'en_desc' | 'zh_asc' | 'zh_desc';

function fmt(mp: number): string {
  if (mp <= 0) return '—';
  if (mp >= 1) return `${parseFloat(mp.toFixed(1))} MP`;
  return `${Math.round(mp * 10)} CP`;
}

function fmtStar(mp: number, isMax: boolean): string {
  const text = fmt(mp);
  if (!isMax || mp <= 0) return text;
  return `✨ ${text} ✨`;
}

function getUniqueMax(values: number[]): number | null {
  const positives = values.filter((value) => value > 0);
  if (positives.length === 0) return null;
  const max = Math.max(...positives);
  return positives.filter((value) => value === max).length === 1 ? max : null;
}

function sortResults(list: MPBreakdown[], key: SortKey): MPBreakdown[] {
  const r = [...list];
  switch (key) {
    case 'total_desc': return r.sort((a, b) => b.total - a.total);
    case 'total_asc':  return r.sort((a, b) => a.total - b.total);
    case 'en_asc':  return r.sort((a, b) => a.englishName.localeCompare(b.englishName));
    case 'en_desc': return r.sort((a, b) => b.englishName.localeCompare(a.englishName));
    case 'zh_asc':  return r.sort((a, b) => a.chineseName.localeCompare(b.chineseName, 'zh'));
    case 'zh_desc': return r.sort((a, b) => b.chineseName.localeCompare(a.chineseName, 'zh'));
  }
}

type Theme = 'forest' | 'ocean' | 'sakura' | 'sunshine';

const THEMES: { id: Theme; label: string }[] = [
  { id: 'forest',   label: '绿意' },
  { id: 'ocean',    label: '海蓝' },
  { id: 'sakura',   label: '樱粉' },
  { id: 'sunshine', label: '暖阳' },
];

export default function ResultView({
  results,
  students,
  bonusItems,
  classCode,
  classInfo,
  week,
  schemeSettings,
  onBack,
  onSessionExpired,
  taskSelection = null,
}: Props) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('total_desc');
  const [showRules, setShowRules] = useState(false);
  const [theme, setTheme] = useState<Theme>('forest');
  const [submitting, setSubmitting] = useState(false);
  const [submitMessage, setSubmitMessage] = useState('');

  const rulesText = useMemo(() => {
    const scheme2Text = `· 方案二（固定全勤奖励）：所有基础挑战全部完成方可获得 ${schemeSettings.scheme2AllDoneAmount} MP 基础分；选做挑战不阻断，不再叠加词王 / AI语音 / 测试得分率等额外基础落实奖励`;
    return `MP 发放原则

本次 MP 由以下几个部分构成：

【基础落实】（必选）
· 方案一（逐项累计）：每完成一个挑战 +0.1 MP；成为词王 +0.2 MP；词王准确率 ≥75% 再 +0.2 MP；AI语音平均分 ≥75% +0.2 MP；测试得分率 ≥75% +0.2 MP
${scheme2Text}
本次基础落实数据包含：音频、视频、互动视频、主题表达积累（含词王）、小挑战、AI语音、测试、高阶阅读、复合资源

【每日开口】（可选）
打卡天数 × 每次打卡 MP 值，按实际打卡情况发放

【课堂参与】（可选）
全班默认值 + PK 获胜者额外奖励，由老师手动调整

【个性化奖励】（可选）
老师自定义奖励挑战，指定学生与金额，灵活叠加`;
  }, [schemeSettings.scheme2AllDoneAmount]);

  const mpMap = new Map(results.map((r) => [r.studentId, r.total]));

  const showBasic = results.some((r) => r.基础落实 > 0);
  const showDaily = results.some((r) => r.每日开口 > 0);
  const showClass = results.some((r) => r.课堂参与 > 0);

  const bonusCols = bonusItems.filter((b) =>
    results.some((r) => b.studentIds.includes(r.studentId) && b.amount > 0)
  );

  function getBonusAmount(studentId: string, bonus: BonusItem): number {
    return bonus.studentIds.includes(studentId) ? bonus.amount : 0;
  }

  const sorted = sortResults(results, sortKey);
  const totalMP = results.reduce((s, r) => s + r.total, 0);
  const maxBasic = showBasic ? getUniqueMax(results.map((r) => r.基础落实)) : null;
  const maxDaily = showDaily ? getUniqueMax(results.map((r) => r.每日开口)) : null;
  const maxClass = showClass ? getUniqueMax(results.map((r) => r.课堂参与)) : null;
  const maxBonusAmounts = bonusCols.map(b =>
    getUniqueMax(results.map((r) => getBonusAmount(r.studentId, b)))
  );
  const maxTotal = getUniqueMax(results.map((r) => r.total));

  const medalMap = new Map<string, string>(
    maxTotal === null
      ? []
      : [...results]
          .sort((a, b) => b.total - a.total)
          .slice(0, 3)
          .map((r, i) => [r.studentId, i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉'])
  );

  async function handleDownloadImage() {
    if (!cardRef.current) return;
    setExporting(true);
    try {
      const { default: html2canvas } = await import('html2canvas');
      const canvas = await html2canvas(cardRef.current, {
        backgroundColor: '#f7faf2',
        scale: 2,
        useCORS: true,
      });
      const link = document.createElement('a');
      link.download = `${classCode}_Week${week}_MP发放公示.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } finally {
      setExporting(false);
    }
  }

  function handleDownloadExcel() {
    void (async () => {
      const buf = await generateOutputExcel(students, mpMap);
      const blob = new Blob([buf], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `${classCode}_Week${week}_MP发放.xlsx`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 5000);
    })();
  }

  async function handleSubmitToSystem() {
    if (!classInfo.squadId) {
      setSubmitMessage('当前班级没有官网班级ID，暂时不能直接发放。');
      return;
    }

    const rewards = results
      .filter((r) => r.total > 0)
      .map((r) => ({
        studentId: r.studentId,
        studentName: r.englishName,
        chineseName: r.chineseName,
        aliases: [r.englishName, r.chineseName].filter(Boolean),
        amount: r.total,
      }));

    if (rewards.length === 0) {
      setSubmitMessage('当前没有可发放的奖励。');
      return;
    }

    const selectionCopy = taskSelection
      ? `\n本次绑定 ${taskSelection.selectedWeekIds.length} 个日报挑战列表，重叠挑战的重复发放会被拦截。`
      : '';
    const ok = window.confirm(`将为 ${rewards.length} 名学生直接发放奖励，是否继续？${selectionCopy}`);
    if (!ok) {
      return;
    }

    setSubmitting(true);
    setSubmitMessage('');
    try {
      const { expired, data } = await submitDistributionRewards({
        squadId: classInfo.squadId,
        className: classCode,
        rewards,
        taskSelection: taskSelection || undefined,
      });
      if (expired) {
        onSessionExpired?.();
        setSubmitMessage('会话已过期，请重新登录后再试');
        return;
      }
      const failedStudentIds = Array.isArray(data.failedStudentIds)
        ? data.failedStudentIds.map((item: unknown) => String(item))
        : [];
      if (failedStudentIds.length > 0) {
        const failedRewards = rewards.filter((reward) => failedStudentIds.includes(reward.studentId));
        const downloaded = await downloadDistributionFallbackExcel({
          rewards: failedRewards,
          classCode,
          fileName: `${classCode}_Week${week}_MP发放失败兜底.xlsx`,
        });
        setSubmitMessage(`已发放 ${data.success ?? 0} 人，失败 ${data.failed ?? 0} 人。已自动下载 ${downloaded} 人的兜底 Excel。`);
        return;
      }
      setSubmitMessage(`已发放 ${data.success ?? 0} 人，失败 ${data.failed ?? 0} 人。`);
    } catch (error) {
      if (error instanceof DistributionSubmitError) {
        if (error.responseData.code === 'TASK_REWARD_OVERLAP' || error.responseData.code === 'TASK_SNAPSHOT_CHANGED') {
          setSubmitMessage(error.message);
          return;
        }
        await downloadDistributionFallbackExcel({
          rewards,
          classCode,
          fileName: `${classCode}_Week${week}_MP发放失败兜底.xlsx`,
        });
        setSubmitMessage(`${error.message}，已自动下载兜底 Excel。`);
        return;
      }
      setSubmitMessage(error instanceof Error ? error.message : '发放失败');
    } finally {
      setSubmitting(false);
    }
  }

  const SORT_OPTIONS: { key: SortKey; label: string }[] = [
    { key: 'total_desc', label: '总量 ↓' },
    { key: 'total_asc',  label: '总量 ↑' },
    { key: 'en_asc',  label: '英文名 A→Z' },
    { key: 'en_desc', label: '英文名 Z→A' },
  ];

  return (
    <div className="result-wrap fade-in">
      <div className="result-topbar">
        <button className="back-btn" onClick={onBack}>← 返回</button>
        <div className="result-controls">
          <div className="theme-selector">
            {THEMES.map((t) => (
              <button
                key={t.id}
                className={`theme-dot theme-dot-${t.id}${theme === t.id ? ' active' : ''}`}
                title={t.label}
                onClick={() => setTheme(t.id)}
              />
            ))}
          </div>
          <select className="sort-select" value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}>
            {SORT_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
          <button
            className="btn btn-ghost btn-sm"
            onClick={handleSubmitToSystem}
            disabled={submitting || !classInfo.squadId}
            title={classInfo.squadId ? '把当前结果直接发到官网' : '手动模式暂不支持直接发放'}
          >
            {submitting ? '发放中...' : '发到官网'}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={handleDownloadExcel}>↓ Excel</button>
          <button className="btn btn-primary btn-sm" onClick={handleDownloadImage} disabled={exporting}>
            {exporting ? '生成中...' : '↓ 图片'}
          </button>
        </div>
      </div>

      <div className="result-card card" ref={cardRef} data-theme={theme}>
        <div className="result-header">
          <div className="result-class-info">
            <span className="result-class-code">{classCode}</span>
            <span className="result-week-badge">Week {week}</span>
            <span className="result-meta">{results.length} 人 · 合计 {fmt(totalMP)}</span>
          </div>
        </div>

        <div className="result-table-wrap">
          <table className="result-table">
            <thead>
              <tr>
                <th className="col-rank-h">#</th>
                <th>英文名</th>
                {showBasic && <th>基础落实</th>}
                {showDaily && <th>每日开口</th>}
                {showClass && <th>课堂参与</th>}
                {bonusCols.map((b) => <th key={b.name}>{b.name}</th>)}
                <th>合计</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r, i) => (
                <tr key={r.studentId} className={i % 2 === 0 ? 'row-even' : 'row-odd'}>
                  <td className="col-rank">
                    {medalMap.get(r.studentId) ?? ''}
                  </td>
                  <td className="col-name-en">{r.englishName || r.chineseName}</td>
                  {showBasic && <td className={maxBasic !== null && r.基础落实 === maxBasic ? 'col-star' : ''}>{fmtStar(r.基础落实, maxBasic !== null && r.基础落实 === maxBasic)}</td>}
                  {showDaily && <td className={maxDaily !== null && r.每日开口 === maxDaily ? 'col-star' : ''}>{fmtStar(r.每日开口, maxDaily !== null && r.每日开口 === maxDaily)}</td>}
                  {showClass && <td className={maxClass !== null && r.课堂参与 === maxClass ? 'col-star' : ''}>{fmtStar(r.课堂参与, maxClass !== null && r.课堂参与 === maxClass)}</td>}
                  {bonusCols.map((b, bi) => {
                    const amt = getBonusAmount(r.studentId, b);
                    return <td key={b.name} className={maxBonusAmounts[bi] !== null && amt === maxBonusAmounts[bi] ? 'col-star' : ''}>{fmtStar(amt, maxBonusAmounts[bi] !== null && amt === maxBonusAmounts[bi])}</td>;
                  })}
                  <td className={`col-total-val${maxTotal !== null && r.total === maxTotal ? ' col-star' : ''}`}>{fmtStar(r.total, maxTotal !== null && r.total === maxTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="result-rules-toggle-row">
          <button
            className={`btn btn-ghost btn-sm${showRules ? ' btn-rules-active' : ''}`}
            onClick={() => setShowRules((v) => !v)}
          >
            {showRules ? '隐藏发放规则' : '显示发放规则'}
          </button>
        </div>

        {showRules && (
          <div className="result-rules">
            <pre>{rulesText}</pre>
          </div>
        )}
        {submitMessage && <div className="result-submit-message">{submitMessage}</div>}
      </div>
    </div>
  );
}
