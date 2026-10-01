import { useState } from 'react';
import type { DailyReportDetail } from '../services/classControlApi';
import './ReportCoach.css';

export default function ReportQualityAnalysis({ tiers, visibleNames, students }: {
  tiers: DailyReportDetail['qualityTiers'];
  visibleNames: Set<string>;
  students: DailyReportDetail['problemStudents'];
}) {
  const [selectedTier, setSelectedTier] = useState<keyof typeof tiers | null>(null);
  const [showAll, setShowAll] = useState(false);
  const names = selectedTier ? tiers[selectedTier].filter(name => visibleNames.has(name)) : [];
  const rows = showAll ? students : students.slice(0, 6);
  return <section className="class-daily-home-teacher-analysis report-coach is-compact">
    <header><div><span>班主任工作区 · 不导出</span><h3>落实质量分析</h3></div></header>
    <div className="report-coach-tier-bar" aria-label="查看质量分组名单">{(['A', 'B', 'C', 'D'] as const).map(tier => {
      const count = tiers[tier].filter(name => visibleNames.has(name)).length;
      return <button type="button" key={tier} disabled={!count} aria-pressed={selectedTier === tier} className={`tier-${tier.toLowerCase()}`} onClick={() => setSelectedTier(current => current === tier ? null : tier)}><span>{tier} 类</span><strong>{count}<small> 人</small></strong><i aria-hidden="true">{count ? selectedTier === tier ? '−' : '+' : '—'}</i></button>;
    })}</div>
    {selectedTier && <div className="report-coach-name-list" aria-label={`${selectedTier} 类学生`}>{names.map(name => <span key={name}>{name}</span>)}</div>}
    <div className="report-coach-followup"><header><h4>需跟进学生</h4><span>{students.length} 人</span><small>点击学生展开明细</small></header>
      {rows.length ? <div className="report-coach-followup-list">{rows.map(student => {
        const items = student.diagnosis.split(/[；;]/).map(text => text.trim()).filter(Boolean);
        return <details key={student.studentId || student.englishName}><summary><strong>{student.englishName || student.chineseName}</strong><span>{student.chineseName !== student.englishName ? student.chineseName : ''}</span><small>{items.length} 项跟进</small><i aria-hidden="true">⌄</i></summary><div className="report-coach-diagnosis">{items.map((item, index) => <p key={index}>{item}{index < items.length - 1 ? '；' : ''}</p>)}</div></details>;
      })}</div> : <p>本次暂无需跟进项 🌱</p>}
      {students.length > 6 && <button type="button" className="report-coach-expand" onClick={() => setShowAll(value => !value)}>{showAll ? '收起名单' : `查看全部 ${students.length} 人`}</button>}
    </div>
  </section>;
}
