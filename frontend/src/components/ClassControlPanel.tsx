import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ClassInfo } from '../types';
import type {
  ClassTaskReport,
  ClassControlCycle,
  ClassControlDistribution,
  ClassControlStudentProfile,
  ClassControlSummary,
  ClassControlTaskBreakdown,
  ClassControlTaskSummary,
} from '../services/classControlApi';
import { fetchClassTaskCatalog, fetchClassTaskReport, formatClassControlTime } from '../services/classControlApi';
import {
  formatSessionLocation,
  fetchOfficialTeacherSchedule,
  getNextClassSession,
  getClassDisplaySession,
  getSuggestedClassControlSessions,
  isClassControlScheduleConfirmed,
  type NextClassSession,
  OFFICIAL_TEACHER_SCHEDULE_ENABLED,
  OfficialScheduleApiError,
  type OfficialTeacherScheduleMap,
  type OfficialTeacherScheduleSlot,
} from '../services/classControlSchedule';
import { useClassControlDashboard } from '../hooks/useClassControlDashboard';
import type { PreparedDailyReportState, RosterSnapshot, RosterSnapshotWeekTask } from '../services/rosterSnapshotService';
import ClassControlScheduleDialog from './ClassControlScheduleDialog';
import { recommendTasksForMatchingSession } from '../services/taskSessionSelection';

interface Props {
  classes: ClassInfo[];
  teacherName: string;
  preparedSnapshot?: RosterSnapshot | null;
  onOpenReport: (classInfo: ClassInfo) => void;
  onAuthenticationRequired?: () => void;
  autoRefreshPrepared?: boolean;
  activeClassCode?: string;
  onActiveClassChange?: (code: string) => void;
}

type NamesPanel = {
  title: string;
  names: string[];
  copyPrefix: string;
} | null;

type AnalysisTab = 'overview' | 'students' | 'tasks';

function percent(value: number | null | undefined): string {
  return Number.isFinite(value) ? `${value}%` : '—';
}

function sortEnglishNames(names: string[]): string[] {
  return [...new Set(names.map((name) => String(name || '').trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, 'en', { sensitivity: 'base', numeric: true }));
}

function ProgressBar({ value, compact = false }: { value: number | null | undefined; compact?: boolean }) {
  const normalized = Number.isFinite(value) ? Math.max(0, Math.min(100, Number(value))) : 0;
  return (
    <div
      className={`class-control-progress${compact ? ' is-compact' : ''}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Number.isFinite(value) ? normalized : undefined}
      aria-label={Number.isFinite(value) ? `完成度 ${normalized}%` : '暂无完成度'}
    >
      <span style={{ width: `${normalized}%` }} />
    </div>
  );
}

const DISTRIBUTION_SEGMENTS: Array<{
  key: keyof Pick<ClassControlDistribution, 'excellent' | 'good' | 'watch' | 'critical' | 'noData'>;
  label: string;
}> = [
  { key: 'excellent', label: '90–100' },
  { key: 'good', label: '80–89' },
  { key: 'watch', label: '60–79' },
  { key: 'critical', label: '<60' },
  { key: 'noData', label: '无数据' },
];

const DISTRIBUTION_COLORS: Record<(typeof DISTRIBUTION_SEGMENTS)[number]['key'], string> = {
  excellent: 'var(--class-data-excellent)',
  good: 'var(--class-data-good)',
  watch: 'var(--class-data-watch)',
  critical: 'var(--class-data-critical)',
  noData: 'var(--class-data-no-data)',
};

type DistributionTone = 'complete' | 'near' | 'partial' | 'not-started' | 'excellent' | 'good' | 'watch' | 'critical' | 'no-data';

const DISTRIBUTION_TONE_COLORS: Record<DistributionTone, string> = {
  complete: 'var(--class-data-complete)',
  near: 'var(--class-data-near)',
  partial: 'var(--class-data-watch)',
  'not-started': 'var(--class-data-critical)',
  excellent: 'var(--class-data-excellent)',
  good: 'var(--class-data-good)',
  watch: 'var(--class-data-watch)',
  critical: 'var(--class-data-critical)',
  'no-data': 'var(--class-data-no-data)',
};

type DistributionBarSegment = {
  key: string;
  label: string;
  shortLabel: string;
  count: number;
  names: string[];
  namesComplete: boolean;
  tone: DistributionTone;
};

function buildCompletionSegments(task: ClassControlTaskSummary | null | undefined): DistributionBarSegment[] {
  const profiles = task?.studentProfiles || [];
  const group = (predicate: (profile: ClassControlStudentProfile) => boolean) => (
    profiles.filter(predicate).map((profile) => profile.name)
  );
  const complete = group((profile) => Number(profile.completionRate) === 100);
  const near = group((profile) => Number.isFinite(profile.completionRate)
    && Number(profile.completionRate) >= 80 && Number(profile.completionRate) < 100);
  const partial = group((profile) => Number.isFinite(profile.completionRate)
    && Number(profile.completionRate) > 0 && Number(profile.completionRate) < 80);
  const notStarted = group((profile) => Number(profile.completionRate) === 0);
  const noData = group((profile) => !Number.isFinite(profile.completionRate));
  const total = Number(task?.totalStudents || 0);

  if (profiles.length < total) {
    const fullyCompletedCount = Math.min(total, Math.max(0, Number(task?.fullyCompletedCount || 0)));
    const incompleteNames = sortEnglishNames(task?.incompleteStudents || []);
    const incompleteCount = Math.min(Math.max(0, total - fullyCompletedCount), incompleteNames.length);
    const detailPendingCount = Math.max(0, total - fullyCompletedCount - incompleteCount);
    return [
      {
        key: 'complete', label: '全部基础挑战已完成', shortLabel: '全完成', count: fullyCompletedCount,
        names: complete, namesComplete: complete.length === fullyCompletedCount, tone: 'complete',
      },
      {
        key: 'incomplete', label: '仍有基础挑战欠项', shortLabel: '有欠项', count: incompleteCount,
        names: incompleteNames.slice(0, incompleteCount), namesComplete: incompleteNames.length >= incompleteCount, tone: 'partial',
      },
      {
        key: 'detail-pending', label: '人数已统计，学生名单还在更新', shortLabel: '名单更新中', count: detailPendingCount,
        names: [], namesComplete: false, tone: 'no-data',
      },
    ];
  }

  return [
    { key: 'complete', label: '全部基础挑战已完成', shortLabel: '全完成', count: complete.length, names: complete, namesComplete: true, tone: 'complete' },
    { key: 'near', label: '完成度80%–99%', shortLabel: '少量欠项', count: near.length, names: near, namesComplete: true, tone: 'near' },
    { key: 'partial', label: '完成度1%–79%', shortLabel: '明显欠项', count: partial.length, names: partial, namesComplete: true, tone: 'partial' },
    { key: 'not-started', label: '尚未开始基础挑战', shortLabel: '未开始', count: notStarted.length, names: notStarted, namesComplete: true, tone: 'not-started' },
    { key: 'no-data', label: '暂无完成数据', shortLabel: '无数据', count: noData.length, names: noData, namesComplete: true, tone: 'no-data' },
  ];
}

function buildQualitySegments(task: ClassControlTaskSummary | null | undefined): DistributionBarSegment[] {
  const profiles = task?.studentProfiles || [];
  const group = (predicate: (profile: ClassControlStudentProfile) => boolean) => (
    profiles.filter(predicate).map((profile) => profile.name)
  );
  const excellent = group((profile) => Number.isFinite(profile.averageAccuracy) && Number(profile.averageAccuracy) >= 90);
  const good = group((profile) => Number.isFinite(profile.averageAccuracy)
    && Number(profile.averageAccuracy) >= 80 && Number(profile.averageAccuracy) < 90);
  const watch = group((profile) => Number.isFinite(profile.averageAccuracy)
    && Number(profile.averageAccuracy) >= 60 && Number(profile.averageAccuracy) < 80);
  const critical = group((profile) => Number.isFinite(profile.averageAccuracy) && Number(profile.averageAccuracy) < 60);
  const noData = group((profile) => !Number.isFinite(profile.averageAccuracy));
  const distribution = task?.accuracyDistribution;
  const count = (key: keyof Pick<ClassControlDistribution, 'excellent' | 'good' | 'watch' | 'critical' | 'noData'>, names: string[]) => (
    Number.isFinite(distribution?.[key]) ? Number(distribution?.[key]) : names.length
  );
  const excellentCount = count('excellent', excellent);
  const goodCount = count('good', good);
  const watchCount = count('watch', watch);
  const criticalCount = count('critical', critical);
  const noDataCount = count('noData', noData);
  return [
    { key: 'excellent', label: '完成质量90分以上', shortLabel: '90+', count: excellentCount, names: excellent, namesComplete: excellent.length === excellentCount, tone: 'excellent' },
    { key: 'good', label: '完成质量80–89分', shortLabel: '80–89', count: goodCount, names: good, namesComplete: good.length === goodCount, tone: 'good' },
    { key: 'watch', label: '完成质量60–79分', shortLabel: '60–79', count: watchCount, names: watch, namesComplete: watch.length === watchCount, tone: 'watch' },
    { key: 'critical', label: '完成质量低于60分', shortLabel: '<60', count: criticalCount, names: critical, namesComplete: critical.length === criticalCount, tone: 'critical' },
    { key: 'no-data', label: '暂无质量数据', shortLabel: '无数据', count: noDataCount, names: noData, namesComplete: noData.length === noDataCount, tone: 'no-data' },
  ];
}

function DistributionBar({
  title,
  segments,
  total,
  onSelect,
}: {
  title: string;
  segments: DistributionBarSegment[];
  total: number;
  onSelect?: (segment: DistributionBarSegment) => void;
}) {
  const readable = segments.filter((segment) => segment.count > 0);
  const description = readable.map((segment) => `${segment.shortLabel}${segment.count}人`).join('，');
  return (
    <div className="class-control-distribution-bar">
      <div className="class-control-distribution-bar-title">
        <strong>{title}</strong>
        <span>{total ? `${total}人` : '暂无数据'}</span>
      </div>
      <div className="class-control-xray-viz-stage">
        <div className="class-control-distribution-track" role="img" aria-label={`${title}：${description || '暂无数据'}`}>
          {total > 0 ? readable.map((segment) => (
            <span
              key={segment.key}
              className={`is-${segment.tone}`}
              style={{ width: `${(segment.count / total) * 100}%` }}
              title={`${segment.label} · ${segment.count}人`}
            />
          )) : <span className="is-no-data" style={{ width: '100%' }} />}
        </div>
      </div>
      <div className="class-control-distribution-bar-legend">
        {readable.map((segment) => onSelect && segment.names.length && segment.namesComplete ? (
          <button type="button" key={segment.key} onClick={() => onSelect(segment)} title={`查看${segment.label}学生`}>
            <i className={`is-${segment.tone}`} />{segment.shortLabel} {segment.count}
          </button>
        ) : (
          <span key={segment.key} title={segment.namesComplete ? undefined : '汇总人数已计入，完整学生名单仍在同步'}>
            <i className={`is-${segment.tone}`} />{segment.shortLabel} {segment.count}
          </span>
        ))}
      </div>
    </div>
  );
}

function CompactDistributionPie({
  title,
  segments,
  total,
  onSelect,
}: {
  title: string;
  segments: DistributionBarSegment[];
  total: number;
  onSelect?: (segment: DistributionBarSegment) => void;
}) {
  const readable = segments.filter((segment) => segment.count > 0);
  const description = readable.map((segment) => `${segment.shortLabel}${segment.count}人`).join('，');
  let cursor = 0;
  const slices = total > 0 ? readable.map((segment) => {
    const start = cursor;
    cursor += (segment.count / total) * 100;
    return `${DISTRIBUTION_TONE_COLORS[segment.tone]} ${start}% ${cursor}%`;
  }) : [];
  return (
    <div className="class-control-xray-quality">
      <div className="class-control-distribution-bar-title">
        <strong>{title}</strong>
        <span>{total ? `${total}人` : '暂无数据'}</span>
      </div>
      <div className="class-control-xray-viz-stage">
        <div
          className="class-control-xray-quality-pie"
          style={{ background: slices.length ? `conic-gradient(from -90deg, ${slices.join(', ')})` : 'var(--class-data-no-data)' }}
          role="img"
          aria-label={`${title}：${description || '暂无数据'}`}
          title={description}
        />
      </div>
      <div className="class-control-distribution-bar-legend">
        {readable.map((segment) => onSelect && segment.names.length && segment.namesComplete ? (
          <button type="button" key={segment.key} onClick={() => onSelect(segment)} title={`查看${segment.label}学生`}>
            <i className={`is-${segment.tone}`} />{segment.shortLabel} {segment.count}
          </button>
        ) : (
          <span key={segment.key} title={segment.namesComplete ? undefined : '汇总人数已计入，完整学生名单仍在同步'}>
            <i className={`is-${segment.tone}`} />{segment.shortLabel} {segment.count}
          </span>
        ))}
      </div>
    </div>
  );
}

function DistributionPie({
  title,
  distribution,
}: {
  title: string;
  distribution: ClassControlDistribution | undefined;
}) {
  const total = distribution?.total || 0;
  let cursor = 0;
  const slices = total > 0 ? DISTRIBUTION_SEGMENTS.flatMap(({ key }) => {
    const count = distribution?.[key] || 0;
    if (!count) return [];
    const start = cursor;
    cursor += (count / total) * 100;
    return [`${DISTRIBUTION_COLORS[key]} ${start}% ${cursor}%`];
  }) : [];
  return (
    <div className="class-control-distribution">
      <div className="class-control-analysis-subheading">
        <strong>{title}</strong>
        <span>{total ? `${total} 人` : '暂无数据'}</span>
      </div>
      <div className="class-control-distribution-body">
        <div
          className="class-control-distribution-pie"
          style={{ background: slices.length ? `conic-gradient(${slices.join(', ')})` : 'rgba(95,121,86,0.09)' }}
          role="img"
          aria-label={`${title}，共 ${total} 人`}
        />
        <div className="class-control-distribution-legend">
          {DISTRIBUTION_SEGMENTS.map(({ key, label }) => {
            const count = distribution?.[key] || 0;
            const ratio = total ? Math.round((count / total) * 100) : 0;
            return (
              <span key={key} className={count ? '' : 'is-empty'}>
                <i className={`is-${key}`} />{label} · {count}人 · {ratio}%
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function TrendChart({
  cycles,
  loading,
  expectedCount = 4,
}: {
  cycles: ClassControlCycle[] | undefined;
  loading: boolean;
  expectedCount?: number;
}) {
  const ordered = [...(cycles || [])].sort((left, right) => left.rangeStart.localeCompare(right.rangeStart));
  const width = 360;
  const height = 154;
  const left = 34;
  const right = 12;
  const top = 14;
  const bottom = 34;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const point = (index: number, value: number) => ({
    x: left + (ordered.length > 1 ? (plotWidth * index) / (ordered.length - 1) : plotWidth / 2),
    y: top + ((100 - Math.max(0, Math.min(100, value))) / 100) * plotHeight,
  });
  const completionPoints = ordered
    .map((cycle, index) => Number.isFinite(cycle.task?.completionRate)
      ? { ...point(index, Number(cycle.task?.completionRate)), value: Number(cycle.task?.completionRate), label: cycle.weekLabel }
      : null)
    .filter((value): value is NonNullable<typeof value> => Boolean(value));
  const accuracyPoints = ordered
    .map((cycle, index) => Number.isFinite(cycle.task?.averageAccuracy)
      ? { ...point(index, Number(cycle.task?.averageAccuracy)), value: Number(cycle.task?.averageAccuracy), label: cycle.weekLabel }
      : null)
    .filter((value): value is NonNullable<typeof value> => Boolean(value));
  const pointsString = (points: typeof completionPoints) => points.map(({ x, y }) => `${x},${y}`).join(' ');

  return (
    <div className="class-control-trend">
      <div className="class-control-analysis-subheading">
        <strong>最近四轮变化</strong>
        <span>{ordered.length}/{expectedCount} 轮数据{loading ? ' · 更新中' : ''} · <i className="is-completion" />完成率 <i className="is-accuracy" />完成质量</span>
      </div>
      {ordered.length > 0 ? <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="最近四轮完成率与完成质量变化">
        {[0, 50, 100].map((value) => {
          const y = point(0, value).y;
          return (
            <g key={value}>
              <line x1={left} y1={y} x2={width - right} y2={y} className="class-control-chart-grid" />
              <text x={left - 7} y={y + 4} textAnchor="end">{value}</text>
            </g>
          );
        })}
        {completionPoints.length > 1 && <polyline points={pointsString(completionPoints)} className="class-control-line is-completion" />}
        {accuracyPoints.length > 1 && <polyline points={pointsString(accuracyPoints)} className="class-control-line is-accuracy" />}
        {completionPoints.map(({ x, y, value, label }) => (
          <g key={`completion-${label}`}>
            <circle cx={x} cy={y} r="4" className="class-control-point is-completion" />
            <text x={x} y={y - 8} textAnchor="middle" className="class-control-chart-value">{value}%</text>
          </g>
        ))}
        {accuracyPoints.map(({ x, y, value, label }) => (
          <g key={`accuracy-${label}`}>
            <circle cx={x} cy={y} r="4" className="class-control-point is-accuracy" />
            <text x={x} y={y + 15} textAnchor="middle" className="class-control-chart-value is-accuracy">{value}%</text>
          </g>
        ))}
        {ordered.map((cycle, index) => (
          <text key={cycle.weekLabel} x={point(index, 0).x} y={height - 10} textAnchor="middle" className="class-control-chart-week">
            {cycle.weekLabel}
          </text>
        ))}
      </svg> : (
        <div className="class-control-trend-empty">
          {loading ? '正在补充最近四轮数据…' : '暂时还没有足够的历史数据'}
        </div>
      )}
    </div>
  );
}

function signedPercent(value: number): string {
  if (!Number.isFinite(value) || value === 0) return '持平';
  return `${value > 0 ? '+' : ''}${Math.round(value * 10) / 10} 个百分点`;
}

function changePhrase(value: number): string {
  if (!Number.isFinite(value) || value === 0) return '持平';
  return `${value > 0 ? '提高' : '下降'} ${Math.abs(Math.round(value * 10) / 10)} 个百分点`;
}

function studentRisk(profile: ClassControlStudentProfile) {
  const completion = Number.isFinite(profile.completionRate) ? Number(profile.completionRate) : 0;
  const accuracy = Number.isFinite(profile.averageAccuracy) ? Number(profile.averageAccuracy) : null;
  if (completion < 60 || (accuracy !== null && accuracy < 60)) {
    return { label: '优先跟进', tone: 'critical', score: 300 + (100 - completion) + (accuracy === null ? 0 : 100 - accuracy) };
  }
  if (completion < 80 && accuracy !== null && accuracy < 80) {
    return { label: '完成与质量', tone: 'critical', score: 250 + (80 - completion) + (80 - accuracy) };
  }
  if (completion < 80) {
    return { label: '完成不足', tone: 'completion', score: 180 + (80 - completion) };
  }
  if (accuracy !== null && accuracy < 80) {
    return { label: '质量不足', tone: 'quality', score: 160 + (80 - accuracy) };
  }
  if (accuracy === null) {
    return { label: '暂无质量数据', tone: 'unknown', score: 80 };
  }
  return { label: '表现稳定', tone: 'stable', score: 0 };
}

function InsightSummary({ summary }: { summary: ClassControlSummary }) {
  const trend = [...(summary.trend || [])].sort((left, right) => left.rangeStart.localeCompare(right.rangeStart));
  const target = trend[trend.length - 1] || summary.review || summary.current;
  const comparison = trend[trend.length - 2] || (summary.current?.historical ? summary.current : null);
  const profiles = target?.task?.studentProfiles || [];
  const assessments = profiles.map((profile) => buildStudentFollowReasons(profile, summary));
  const atRisk = assessments.filter((assessment) => assessment.reasons.length > 0);
  const urgent = assessments.filter((assessment) => assessment.reasons.some((reason) => reason.weight >= 180));
  const weakestTask = [...(target?.task?.taskBreakdown || [])]
    .filter((task) => Number.isFinite(task.completionRate))
    .sort((left, right) => Number(left.completionRate) - Number(right.completionRate))[0];
  const completionDelta = Number.isFinite(target?.task?.completionRate) && Number.isFinite(comparison?.task?.completionRate)
    ? Number(target?.task?.completionRate) - Number(comparison?.task?.completionRate)
    : null;
  const accuracyDelta = Number.isFinite(target?.task?.averageAccuracy) && Number.isFinite(comparison?.task?.averageAccuracy)
    ? Number(target?.task?.averageAccuracy) - Number(comparison?.task?.averageAccuracy)
    : null;

  return (
    <section className="class-control-insights" aria-label="班级数据重点">
      <div className="class-control-insight-heading">
        <div>
          <span>CLASS NOTES</span>
          <strong>{target?.weekLabel || '上一轮'} 值得关注</strong>
        </div>
        <small>根据当前班级数据整理</small>
      </div>
      <div className="class-control-insight-grid">
        <article className={completionDelta !== null && completionDelta < 0 ? 'is-warning' : 'is-positive'}>
          <span>和上一轮比</span>
          <strong>{completionDelta === null ? percent(target?.task?.completionRate) : signedPercent(completionDelta)}</strong>
          <p>
            {comparison && completionDelta !== null
              ? `完成率比 ${comparison.weekLabel} ${changePhrase(completionDelta)}；完成质量${accuracyDelta === null ? '暂无对比' : changePhrase(accuracyDelta)}`
              : '这是最近一轮挑战结果；有更多历史数据后再进行趋势比较'}
          </p>
        </article>
        <article className={urgent.length ? 'is-critical' : atRisk.length ? 'is-warning' : 'is-positive'}>
          <span>需要关注</span>
          <strong>{atRisk.length} 人</strong>
          <p>{urgent.length ? `${urgent.length} 人建议优先跟进，其余可按完成、质量、考勤和近期变化继续查看` : '暂时没有明确需要跟进的学生'}</p>
        </article>
        <article className={weakestTask && Number(weakestTask.completionRate) < 80 ? 'is-warning' : 'is-positive'}>
          <span>最需关注的作业</span>
          <strong>{weakestTask ? percent(weakestTask.completionRate) : '—'}</strong>
          <p title={weakestTask?.title}>{weakestTask ? weakestTask.title : '暂时没有可比较的作业'}</p>
        </article>
      </div>
    </section>
  );
}

function StudentQuadrant({ profiles }: { profiles: ClassControlStudentProfile[] }) {
  const plotted = profiles.filter((profile) => (
    Number.isFinite(profile.completionRate) && Number.isFinite(profile.averageAccuracy)
  ));
  const noQuality = profiles.length - plotted.length;
  const width = 420;
  const height = 260;
  const left = 40;
  const right = 16;
  const top = 22;
  const bottom = 38;
  const x = (value: number) => left + (Math.max(0, Math.min(100, value)) / 100) * (width - left - right);
  const y = (value: number) => top + ((100 - Math.max(0, Math.min(100, value))) / 100) * (height - top - bottom);

  return (
    <section className="class-control-quadrant">
      <div className="class-control-analysis-subheading">
        <strong>学生完成与质量分布</strong>
        <span>{plotted.length} 人已有完整数据{noQuality ? ` · ${noQuality} 人暂无质量记录` : ''}</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="学生完成率与完成质量分布图">
        <rect x={x(80)} y={top} width={x(100) - x(80)} height={y(80) - top} className="class-control-quadrant-zone is-stable" />
        <rect x={left} y={top} width={x(80) - left} height={y(80) - top} className="class-control-quadrant-zone is-completion" />
        <rect x={x(80)} y={y(80)} width={x(100) - x(80)} height={y(0) - y(80)} className="class-control-quadrant-zone is-quality" />
        <rect x={left} y={y(80)} width={x(80) - left} height={y(0) - y(80)} className="class-control-quadrant-zone is-critical" />
        {[0, 50, 80, 100].map((value) => (
          <g key={`x-${value}`}>
            <line x1={x(value)} y1={top} x2={x(value)} y2={y(0)} className="class-control-chart-grid" />
            <text x={x(value)} y={height - 15} textAnchor="middle">{value}</text>
          </g>
        ))}
        {[0, 50, 80, 100].map((value) => (
          <g key={`y-${value}`}>
            <line x1={left} y1={y(value)} x2={x(100)} y2={y(value)} className="class-control-chart-grid" />
            <text x={left - 7} y={y(value) + 4} textAnchor="end">{value}</text>
          </g>
        ))}
        <text x={(left + x(80)) / 2} y={top + 13} textAnchor="middle" className="class-control-quadrant-label">补完成</text>
        <text x={(x(80) + x(100)) / 2} y={top + 13} textAnchor="middle" className="class-control-quadrant-label">表现稳定</text>
        <text x={(left + x(80)) / 2} y={y(80) + 15} textAnchor="middle" className="class-control-quadrant-label">优先关注</text>
        <text x={(x(80) + x(100)) / 2} y={y(80) + 15} textAnchor="middle" className="class-control-quadrant-label">提质量</text>
        {plotted.map((profile) => {
          const risk = studentRisk(profile);
          return (
            <circle
              key={profile.name}
              cx={x(Number(profile.completionRate))}
              cy={y(Number(profile.averageAccuracy))}
              r="5"
              className={`class-control-student-point is-${risk.tone}`}
            >
              <title>{`${profile.name} · 完成率 ${percent(profile.completionRate)} · 完成质量 ${percent(profile.averageAccuracy)}`}</title>
            </circle>
          );
        })}
        <text x={(left + x(100)) / 2} y={height - 1} textAnchor="middle" className="class-control-axis-title">完成率 →</text>
        <text x="10" y={(top + y(0)) / 2} textAnchor="middle" className="class-control-axis-title" transform={`rotate(-90 10 ${(top + y(0)) / 2})`}>完成质量 →</text>
      </svg>
    </section>
  );
}

type StudentFollowReason = {
  key: 'completion' | 'accuracy' | 'attendance' | 'fluctuation';
  label: string;
  detail: string;
  tone: 'critical' | 'completion' | 'quality' | 'attendance' | 'fluctuation';
  weight: number;
};

function findStudentProfile(cycle: ClassControlCycle, name: string): ClassControlStudentProfile | undefined {
  return cycle.task?.studentProfiles.find((profile) => profile.name.localeCompare(name, 'en', { sensitivity: 'base' }) === 0);
}

function studentTrend(summary: ClassControlSummary, name: string) {
  const samples = [...(summary.trend || [])]
    .sort((left, right) => left.rangeStart.localeCompare(right.rangeStart))
    .slice(-3)
    .map((cycle) => {
      const profile = findStudentProfile(cycle, name);
      if (!profile) return null;
      const values = [profile.completionRate, profile.averageAccuracy].filter(Number.isFinite).map(Number);
      if (!values.length) return null;
      return {
        cycle,
        profile,
        score: values.reduce((sum, value) => sum + value, 0) / values.length,
      };
    })
    .filter((sample): sample is NonNullable<typeof sample> => Boolean(sample));
  if (samples.length < 3) return { label: '样本不足', tone: 'unknown', delta: null, samples } as const;
  const delta = Math.round((samples[samples.length - 1].score - samples[0].score) * 10) / 10;
  if (delta >= 8) return { label: '明显进步', tone: 'improving', delta, samples } as const;
  if (delta <= -8) return { label: '持续下降', tone: 'declining', delta, samples } as const;
  return { label: '基本稳定', tone: 'stable', delta, samples } as const;
}

function buildStudentFollowReasons(
  profile: ClassControlStudentProfile,
  summary: ClassControlSummary,
): { reasons: StudentFollowReason[]; trend: ReturnType<typeof studentTrend> } {
  const reasons: StudentFollowReason[] = [];
  if (profile.incompleteTaskCount > 0) {
    reasons.push({
      key: 'completion',
      label: '作业有欠项',
      detail: `还差 ${profile.incompleteTaskCount} 项`,
      tone: 'completion',
      weight: 180 + profile.incompleteTaskCount * 5,
    });
  }

  const classAverage = (summary.review || summary.current)?.task?.averageAccuracy;
  if (Number.isFinite(profile.averageAccuracy) && Number.isFinite(classAverage)) {
    const gap = Math.round((Number(classAverage) - Number(profile.averageAccuracy)) * 10) / 10;
    if (gap >= 5) {
      reasons.push({
        key: 'accuracy',
        label: '完成质量偏低',
        detail: `比班级均分低 ${gap} 个百分点`,
        tone: 'quality',
        weight: 150 + gap,
      });
    }
  }

  const attendance = summary.attendance?.studentProfiles.find((item) => (
    item.name.localeCompare(profile.name, 'en', { sensitivity: 'base' }) === 0
  ));
  if (attendance && (
    attendance.absenceCount > 0
    || attendance.lateCount > 0
    || (Number.isFinite(attendance.attendanceRate) && Number(attendance.attendanceRate) < 90)
  )) {
    const details = [];
    if (attendance.absenceCount > 0) details.push(`缺勤 ${attendance.absenceCount} 次`);
    if (attendance.lateCount > 0) details.push(`迟到 ${attendance.lateCount} 次`);
    if (!details.length && Number.isFinite(attendance.attendanceRate)) details.push(`出勤率 ${attendance.attendanceRate}%`);
    reasons.push({
      key: 'attendance',
      label: '考勤',
      detail: details.join('，'),
      tone: 'attendance',
      weight: 170 + attendance.absenceCount * 20 + attendance.lateCount * 8,
    });
  }

  const trend = studentTrend(summary, profile.name);
  const latest = trend.samples[trend.samples.length - 1]?.profile;
  const previous = trend.samples[trend.samples.length - 2]?.profile;
  if (latest && previous) {
    const completionDrop = Number.isFinite(latest.completionRate) && Number.isFinite(previous.completionRate)
      ? Number(previous.completionRate) - Number(latest.completionRate)
      : 0;
    const accuracyDrop = Number.isFinite(latest.averageAccuracy) && Number.isFinite(previous.averageAccuracy)
      ? Number(previous.averageAccuracy) - Number(latest.averageAccuracy)
      : 0;
    const details = [];
    if (completionDrop >= 10) details.push(`完成率比上一轮下降 ${Math.round(completionDrop * 10) / 10} 个百分点`);
    if (accuracyDrop >= 8) details.push(`完成质量比上一轮下降 ${Math.round(accuracyDrop * 10) / 10} 个百分点`);
    if (details.length) {
      reasons.push({
        key: 'fluctuation',
        label: '状态波动',
        detail: details.join('；'),
        tone: 'fluctuation',
        weight: 140 + Math.max(completionDrop, accuracyDrop),
      });
    }
  }
  return { reasons, trend };
}

function StudentPriorityList({
  summary,
  attendanceLoading = false,
}: {
  summary: ClassControlSummary;
  attendanceLoading?: boolean;
}) {
  const profiles = (summary.review || summary.current)?.task?.studentProfiles || [];
  const ordered = profiles
    .map((profile) => {
      const assessment = buildStudentFollowReasons(profile, summary);
      return {
        profile,
        ...assessment,
        score: assessment.reasons.reduce((sum, reason) => sum + reason.weight, 0),
      };
    })
    .sort((left, right) => right.score - left.score || left.profile.name.localeCompare(right.profile.name, 'en'));
  return (
    <section className="class-control-priority-list">
      <div className="class-control-analysis-subheading">
        <strong>重点学生</strong>
        <span>先按需要处理的原因排序，再看最近三轮变化</span>
      </div>
      {ordered.length ? ordered.map(({ profile, reasons, trend }) => {
        const attendance = summary.attendance?.studentProfiles.find((item) => (
          item.name.localeCompare(profile.name, 'en', { sensitivity: 'base' }) === 0
        ));
        return (
        <div className="class-control-priority-row" key={profile.name}>
          <div className="class-control-priority-name">
            <strong>{profile.name}</strong>
            <span className={`is-${trend.tone}`}>{trend.label}</span>
          </div>
          <div className="class-control-priority-measure">
            <span>完成率 {percent(profile.completionRate)}</span>
            <ProgressBar value={profile.completionRate} compact />
          </div>
          <div className="class-control-priority-measure">
            <span>完成质量 {percent(profile.averageAccuracy)}</span>
            <ProgressBar value={profile.averageAccuracy} compact />
          </div>
          <div className="class-control-priority-attendance">
            <span>考勤</span>
            <strong>{attendance
              ? `缺 ${attendance.absenceCount} · 迟 ${attendance.lateCount}`
              : attendanceLoading ? '读取中…' : '暂无数据'}</strong>
          </div>
          <div className="class-control-priority-reasons">
            {reasons.length ? reasons.map((reason) => (
              <span key={reason.key} className={`is-${reason.tone}`}>
                <strong>{reason.label}</strong>{reason.detail}
              </span>
            )) : <span className="is-stable"><strong>表现稳定</strong>暂无明确跟进原因</span>}
          </div>
        </div>
        );
      }) : <div className="class-control-analysis-empty">暂时没有可查看的学生数据</div>}
    </section>
  );
}

function TaskBreakdownList({
  cycle,
  onShowNames,
}: {
  cycle: ClassControlCycle;
  onShowNames: (title: string, names: string[], copyPrefix: string) => void;
}) {
  const tasks = [...(cycle.task?.taskBreakdown || [])].sort((left, right) => (
    Number(left.completionRate ?? 101) - Number(right.completionRate ?? 101)
    || left.title.localeCompare(right.title)
  ));
  return (
    <div className="class-control-task-section">
      <div className="class-control-analysis-subheading">
        <strong>{cycle.weekLabel} · 作业明细</strong>
        <span>{tasks.length ? `${tasks.length} 项基础挑战` : '暂无作业数据'}</span>
      </div>
      {tasks.length > 0 && (
        <div className="class-control-task-list">
          {tasks.map((task: ClassControlTaskBreakdown) => (
            <div className="class-control-task-row" key={`${cycle.weekLabel}-${task.id}`}>
              <div className="class-control-task-main">
                <strong title={task.title}>{task.title}</strong>
                <ProgressBar value={task.completionRate} compact />
              </div>
              <div className="class-control-task-stat">
                <span>完成率</span>
                <strong>{percent(task.completionRate)}</strong>
              </div>
              <div className="class-control-task-stat">
                <span>完成质量</span>
                <strong>{percent(task.averageAccuracy)}</strong>
              </div>
              {task.incompleteStudents.length > 0 ? (
                <button
                  className="class-control-expand-button"
                  onClick={() => onShowNames(
                    `${cycle.weekLabel} · ${task.title}`,
                    task.incompleteStudents,
                    '待完成',
                  )}
                >
                  查看未完成学生 · {task.incompleteStudents.length}人
                </button>
              ) : <span className="class-control-task-complete">全部完成</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CycleMetrics({
  cycle,
  onShowNames,
}: {
  cycle: ClassControlCycle;
  onShowNames: (title: string, names: string[], copyPrefix: string) => void;
}) {
  const task = cycle.task;
  const speaking = cycle.speaking;
  const incomplete = task?.incompleteStudents || [];
  const zeroStudents = speaking?.zeroStudents || [];

  return (
    <div className="class-control-review-body">
      <div className="class-control-metrics">
        <div className="class-control-metric">
          <span>作业完成</span>
          <strong>{percent(task?.completionRate)}</strong>
          <ProgressBar value={task?.completionRate} />
          <small>{task?.available ? `${task.fullyCompletedCount} / ${task.totalStudents} 人已全部完成` : '暂无作业完成数据'}</small>
        </div>
        <div className="class-control-metric">
          <span>完成质量</span>
          <strong>{percent(task?.averageAccuracy)}</strong>
          <small>{task?.accuracyStudentCount ? `${task.accuracyStudentCount} 人有质量记录` : '暂无质量记录'}</small>
        </div>
        <div className="class-control-metric">
          <span>每日开口</span>
          <strong>{Number.isFinite(speaking?.averageDays) ? `${speaking?.averageDays} 天` : '—'}</strong>
          <small>{speaking?.available ? `${zeroStudents.length} 人还未开口` : '暂无每日开口数据'}</small>
        </div>
      </div>

      <div className="class-control-exceptions">
        <div className={incomplete.length ? 'has-exception' : ''}>
          <span>还有欠项 {incomplete.length} 人</span>
          {incomplete.length > 0 ? (
            <button className="class-control-expand-button" onClick={() => onShowNames(`${cycle.weekLabel} 基础挑战未完成`, incomplete, '待完成')}>
              查看名单 · {incomplete.length}人
            </button>
          ) : <strong>全部完成</strong>}
        </div>
        <div className={zeroStudents.length ? 'has-exception' : ''}>
          <span>还未开口 {zeroStudents.length} 人</span>
          {zeroStudents.length > 0 ? (
            <button className="class-control-expand-button" onClick={() => onShowNames(`${cycle.weekLabel} 每日开口 0 天`, zeroStudents, '开口0天')}>
              查看名单 · {zeroStudents.length}人
            </button>
          ) : <strong>无人缺卡</strong>}
        </div>
      </div>
    </div>
  );
}

type CurrentCycleStatus = {
  tone: 'waiting' | 'active' | 'watch' | 'urgent' | 'complete' | 'unknown';
  label: string;
  deadline: string;
  detail: string;
  quality: string;
  timePercent: number | null;
};

function formatRemainingTime(minutes: number): string {
  if (minutes <= 0) return '已经上课';
  if (minutes < 60) return `不足 ${Math.max(1, Math.ceil(minutes))} 分钟`;
  if (minutes < 24 * 60) return `${Math.ceil(minutes / 60)} 小时`;
  return `${Math.ceil(minutes / (24 * 60))} 天`;
}

function buildCurrentCycleStatus(
  cycle: ClassControlCycle | null | undefined,
  nextSession: NextClassSession | null,
  scheduleConfirmed: boolean,
): CurrentCycleStatus {
  const task = cycle?.task;
  if (!cycle || !task?.available) {
    return {
      tone: 'waiting',
      label: '本轮未开始',
      deadline: '本轮作业还未开放',
      detail: '开放后开始统计',
      quality: '暂无本轮质量记录',
      timePercent: null,
    };
  }
  const total = Number(task.totalStudents || 0);
  const completed = Number(task.fullyCompletedCount || 0);
  const incomplete = Math.max(0, total - completed);
  const coverage = total > 0 ? Number(task.accuracyStudentCount || 0) / total : 0;
  const quality = Number.isFinite(task.averageAccuracy)
    ? coverage >= 0.7
      ? `本轮质量 ${percent(task.averageAccuracy)} · ${task.accuracyStudentCount}/${total} 人有记录`
      : `${task.accuracyStudentCount}/${total} 人有质量记录 · 样本暂不足`
    : '暂无本轮质量记录';

  if (!scheduleConfirmed || !nextSession) {
    return {
      tone: 'unknown',
      label: '待补上课时间',
      deadline: '补充下次上课时间后，再判断是否需要提醒',
      detail: `${completed}/${total || '—'} 人已完成全部基础挑战`,
      quality,
      timePercent: null,
    };
  }

  const elapsedMinutes = Math.max(0, Number(cycle.openedHours || 0) * 60);
  const remainingMinutes = Math.max(0, Number(nextSession.minutesUntil || 0));
  const totalMinutes = elapsedMinutes + remainingMinutes;
  const timePercent = totalMinutes > 0 ? Math.round((elapsedMinutes / totalMinutes) * 100) : 100;
  const deadline = `距${nextSession.dayLabel}${nextSession.time ? ` ${nextSession.time}` : ''} 上课还有 ${formatRemainingTime(remainingMinutes)}`;
  const detail = `${completed}/${total || '—'} 人已完成全部基础挑战`;

  if (incomplete === 0 && total > 0) {
    return { tone: 'complete', label: '全班已完成', deadline, detail, quality, timePercent };
  }
  if (remainingMinutes <= 24 * 60) {
    return { tone: 'urgent', label: '上课前需跟进', deadline, detail, quality, timePercent };
  }
  if (timePercent >= 75) {
    return { tone: 'watch', label: '建议开始跟进', deadline, detail, quality, timePercent };
  }
  return {
    tone: 'active',
    label: timePercent < 40 ? '刚开始' : '进度正常',
    deadline,
    detail,
    quality,
    timePercent,
  };
}

function CurrentCycleStrip({ cycle, status }: { cycle: ClassControlCycle; status: CurrentCycleStatus }) {
  return (
    <div className={`class-control-current is-${status.tone}`}>
      <div className="class-control-current-label">
        <span>{cycle.weekLabel} · 本轮作业</span>
        <strong className={`class-control-cycle-status is-${status.tone}`}>{status.label}</strong>
      </div>
      <div className="class-control-current-timing">
        <strong>{status.deadline}</strong>
        <span>{status.detail}</span>
        {status.timePercent !== null && (
          <div className="class-control-time-progress" role="progressbar" aria-label={`本轮时间进度 ${status.timePercent}%`} aria-valuenow={status.timePercent} aria-valuemin={0} aria-valuemax={100}>
            <span style={{ width: `${status.timePercent}%` }} />
          </div>
        )}
      </div>
      <div className="class-control-current-stat">
        <span>当前完成率</span>
        <strong>{percent(cycle.task?.completionRate)}</strong>
      </div>
      <div className="class-control-current-stat">
        <span>当前质量</span>
        <strong>{status.quality}</strong>
      </div>
    </div>
  );
}

type ClassPortfolioRow = {
  classInfo: ClassInfo;
  classCode: string;
  summary?: ClassControlSummary;
  resultCycle: ClassControlCycle | null;
  selectedWeekIds: string[];
  taskLabel: string;
  hasTaskData: boolean;
  isPending: boolean;
  preparedState?: PreparedDailyReportState;
  nextSession: NextClassSession | null;
  location: string;
  completion: number | null;
  accuracy: number | null;
  speakingDays: number | null;
  studentCount: number;
  completionIssueCount: number;
  qualityIssueCount: number;
  noQualityCount: number;
  attentionCount: number;
  delta: number | null;
  currentStatus: CurrentCycleStatus;
  completionSegments: DistributionBarSegment[];
  qualitySegments: DistributionBarSegment[];
  reasons: string[];
  score: number;
};

type PortfolioTaskOverride = {
  task: ClassTaskReport['task'];
  weekIds: string[];
  weekLabel: string;
};

function comparableCompletedCycles(summary: ClassControlSummary | undefined): ClassControlCycle[] {
  if (!summary) return [];
  const cycles = [...(summary.trend || [])];
  if (summary.review?.task) cycles.push({ ...summary.review, role: 'trend' });
  if (summary.historical && summary.current?.task) cycles.push({ ...summary.current, role: 'trend' });
  const byKey = new Map<string, ClassControlCycle>();
  cycles.forEach((cycle) => byKey.set(`${cycle.rangeStart}|${cycle.rangeEnd}|${cycle.weekIds.join(',')}`, cycle));
  return [...byKey.values()].sort((left, right) => left.rangeStart.localeCompare(right.rangeStart));
}

function classCompletionDelta(summary: ClassControlSummary | undefined): number | null {
  const cycles = comparableCompletedCycles(summary).filter((cycle) => Number.isFinite(cycle.task?.completionRate));
  if (cycles.length < 2) return null;
  return Math.round((Number(cycles[cycles.length - 1].task?.completionRate) - Number(cycles[cycles.length - 2].task?.completionRate)) * 10) / 10;
}

function portfolioRow(
  classInfo: ClassInfo,
  summary: ClassControlSummary | undefined,
  nextSession: NextClassSession | null,
  scheduleConfirmed: boolean,
  preparedState?: PreparedDailyReportState,
  taskOverride?: PortfolioTaskOverride,
  taskOptions: RosterSnapshotWeekTask[] = [],
  overviewHydrating = false,
): ClassPortfolioRow {
  const sourceCycle = summary?.review || summary?.current || null;
  const resultCycle = taskOverride
    ? {
      ...(sourceCycle || {
        role: 'review' as const,
        weekNumber: null,
        rangeStart: '',
        rangeEnd: '',
        openedAt: '',
        openedHours: 0,
        historical: false,
        speaking: null,
      }),
      weekIds: taskOverride.weekIds,
      weekLabel: taskOverride.weekLabel,
      task: taskOverride.task,
    }
    : sourceCycle;
  const task = resultCycle?.task;
  const selectedWeekIds = resultCycle?.weekIds || [];
  const selectedTaskNames = selectedWeekIds
    .map((weekId) => taskOptions.find((item) => String(item.id) === String(weekId))?.name)
    .filter((name): name is string => Boolean(name));
  const isPending = Boolean(!taskOverride && !summary && (
    overviewHydrating || preparedState?.state !== 'ready-empty'
  ));
  const taskLabel = taskOverride?.weekLabel
    || (selectedTaskNames.length ? selectedTaskNames.join(' + ') : resultCycle?.weekLabel || (isPending ? '正在核对挑战…' : '暂无可统计挑战'));
  const hasTaskData = Boolean(
    task?.available
    && selectedWeekIds.length
    && Number(task.requiredTaskCount || 0) + Number(task.optionalTaskCount || 0) > 0,
  );
  const speaking = resultCycle?.speaking;
  const profiles = hasTaskData ? task?.studentProfiles || [] : [];
  const completion = hasTaskData && Number.isFinite(task?.completionRate) ? Number(task?.completionRate) : null;
  const accuracy = hasTaskData && Number.isFinite(task?.averageAccuracy) ? Number(task?.averageAccuracy) : null;
  const speakingDays = Number.isFinite(speaking?.averageDays) ? Number(speaking?.averageDays) : null;
  const studentCount = hasTaskData ? Number(task?.totalStudents || 0) : 0;
  const completionIssueCount = hasTaskData ? task?.incompleteStudents?.length
    ?? profiles.filter((profile) => Number(profile.incompleteTaskCount || 0) > 0).length : 0;
  const qualityIssueCount = hasTaskData && task?.accuracyDistribution
    ? task.accuracyDistribution.watch + task.accuracyDistribution.critical
    : hasTaskData ? profiles.filter((profile) => (
      Number.isFinite(profile.averageAccuracy) && Number(profile.averageAccuracy) < 80
    )).length : 0;
  const noQualityCount = hasTaskData
    ? task?.accuracyDistribution?.noData ?? profiles.filter((profile) => !Number.isFinite(profile.averageAccuracy)).length
    : 0;
  const profileAttention = profiles.filter((profile) => (
    Number(profile.completionRate) < 80
    || (Number.isFinite(profile.averageAccuracy) && Number(profile.averageAccuracy) < 80)
  )).length;
  const attentionCount = Math.max(completionIssueCount, qualityIssueCount, profileAttention);
  const delta = classCompletionDelta(summary);
  const currentStatus = buildCurrentCycleStatus(summary?.current, nextSession, scheduleConfirmed);
  const reasons: string[] = [];
  let score = 0;
  if (isPending) {
    reasons.push('正在读取挑战');
  } else if (!hasTaskData) {
    reasons.push('暂无可统计挑战');
  } else if (!summary?.review && summary?.current) {
    reasons.push(`当前统计 ${taskLabel}`);
  } else if (!summary?.review && preparedState?.state === 'ready-empty') {
    reasons.push('本学期暂无挑战');
  } else if (!summary?.review && preparedState?.state === 'failed') {
    reasons.push('本次更新失败');
    score += 80;
  } else if (!summary?.review) {
    reasons.push('数据更新中');
    score += 240;
  }
  if (completion !== null && completion < 80) {
    reasons.push(`完成率 ${Math.round(completion)}%`);
    score += 120 + (80 - completion);
  }
  if (accuracy !== null && accuracy < 80) {
    reasons.push(`质量 ${Math.round(accuracy)}%`);
    score += 100 + (80 - accuracy);
  }
  if (hasTaskData && speakingDays !== null && speakingDays < 3) {
    reasons.push(`开口 ${Math.round(speakingDays * 10) / 10} 天`);
    score += 70 + (3 - speakingDays) * 10;
  }
  if (hasTaskData && (speaking?.zeroStudents?.length || 0) > 0) {
    reasons.push(`${speaking?.zeroStudents.length} 人开口 0 天`);
    score += Math.min(50, (speaking?.zeroStudents.length || 0) * 6);
  }
  if (hasTaskData && delta !== null && delta <= -5) {
    reasons.push(`比上一轮下降 ${Math.abs(delta)} 点`);
    score += 90 + Math.abs(delta);
  }
  if (hasTaskData && currentStatus.tone === 'urgent') {
    reasons.unshift('上课前需跟进');
    score += 160;
  } else if (hasTaskData && currentStatus.tone === 'watch') {
    reasons.unshift('建议开始跟进');
    score += 55;
  }
  score += Math.min(60, attentionCount * 4);
  return {
    classInfo,
    classCode: classInfo.name.toUpperCase(),
    summary,
    resultCycle,
    selectedWeekIds,
    taskLabel,
    hasTaskData,
    isPending,
    preparedState,
    nextSession,
    location: formatSessionLocation(nextSession),
    completion,
    accuracy,
    speakingDays,
    studentCount,
    completionIssueCount,
    qualityIssueCount,
    noQualityCount,
    attentionCount,
    delta,
    currentStatus,
    completionSegments: hasTaskData ? buildCompletionSegments(task) : [],
    qualitySegments: hasTaskData ? buildQualitySegments(task) : [],
    reasons,
    score,
  };
}

function portfolioPhasePriority(row: ClassPortfolioRow): number {
  return row.currentStatus.tone === 'urgent' ? 2 : row.currentStatus.tone === 'watch' ? 1 : 0;
}

function comparePortfolioRowsByRisk(left: ClassPortfolioRow, right: ClassPortfolioRow): number {
  return portfolioPhasePriority(right) - portfolioPhasePriority(left)
    || right.score - left.score
    || (left.nextSession?.minutesUntil ?? Number.POSITIVE_INFINITY) - (right.nextSession?.minutesUntil ?? Number.POSITIVE_INFINITY)
    || left.classCode.localeCompare(right.classCode);
}

function comparePortfolioRowsBySchedule(left: ClassPortfolioRow, right: ClassPortfolioRow): number {
  return (left.nextSession?.minutesUntil ?? Number.POSITIVE_INFINITY) - (right.nextSession?.minutesUntil ?? Number.POSITIVE_INFINITY)
    || right.score - left.score
    || left.classCode.localeCompare(right.classCode);
}

function TeacherPortfolio({
  rows,
  selectedClassCode,
  onOpenClass,
  onShowNames,
  taskPickerClass,
  taskOptions,
  taskSwitchingClass,
  onToggleTaskPicker,
  onSelectTask,
  updatedAt,
  refreshingAll,
  allSchedulesConfirmed,
  onRefreshAll,
  onOpenSchedule,
}: {
  rows: ClassPortfolioRow[];
  selectedClassCode: string;
  onOpenClass: (classCode: string) => void;
  onShowNames: (classCode: string, title: string, names: string[], copyPrefix: string) => void;
  taskPickerClass: string;
  taskOptions: Record<string, RosterSnapshotWeekTask[]>;
  taskSwitchingClass: string;
  onToggleTaskPicker: (classCode: string) => void;
  onSelectTask: (classCode: string, task: RosterSnapshotWeekTask) => void;
  updatedAt: string;
  refreshingAll: boolean;
  allSchedulesConfirmed: boolean;
  onRefreshAll: () => void;
  onOpenSchedule: () => void;
}) {
  const [sortMode, setSortMode] = useState<'risk' | 'schedule'>('risk');
  const displayedRows = [...rows].sort((left, right) => {
    return sortMode === 'risk'
      ? comparePortfolioRowsByRisk(left, right)
      : comparePortfolioRowsBySchedule(left, right);
  });
  return (
    <section className="class-control-portfolio" aria-label="逐班完成与质量概览">
      <div className="class-control-xray-toolbar">
        <div>
          <strong>逐班查看</strong>
          <span>点击挑战名称可切换统计口径</span>
        </div>
        <div className="class-control-xray-toolbar-actions">
          <div className="class-control-xray-sort" aria-label="班级排序方式">
            <button className={sortMode === 'risk' ? 'is-active' : ''} onClick={() => setSortMode('risk')}>完成度优先</button>
            <button className={sortMode === 'schedule' ? 'is-active' : ''} onClick={() => setSortMode('schedule')}>按上课时间</button>
          </div>
          {updatedAt && <span>更新于 {formatClassControlTime(updatedAt)}</span>}
          <button className="btn btn-ghost btn-sm" onClick={onOpenSchedule}>{allSchedulesConfirmed ? '调整课程安排' : '确认课程安排'}</button>
          <button className="btn btn-primary btn-sm" onClick={onRefreshAll} disabled={refreshingAll}>{refreshingAll ? '更新中…' : '更新全部'}</button>
        </div>
      </div>

      <div className="class-control-xray-table" role="table" aria-label="全部班级完成与质量对比">
        <div className="class-control-xray-head" role="row">
          <span>班级 / 下次上课</span>
          <span>当前统计挑战 · 完成情况</span>
          <span>当前统计挑战 · 完成质量</span>
          <span>本轮 · 上课前进度</span>
          <span>比上一轮</span>
          <span>学生</span>
        </div>
        {displayedRows.map((row) => {
          const task = row.resultCycle?.task;
          const current = row.summary?.current;
          const coverage = task?.totalStudents ? `${task.accuracyStudentCount}/${task.totalStudents} 人有记录` : '暂无记录';
          return (
            <div
              className={`class-control-xray-row ${row.hasTaskData ? `is-${row.currentStatus.tone}` : row.isPending ? 'is-loading' : 'is-empty'}${row.score >= 90 ? ' has-risk' : ''}${selectedClassCode === row.classCode ? ' is-selected' : ''}`}
              role="row"
              key={row.classCode}
            >
              <div className="class-control-xray-class">
                <strong>{row.classCode}</strong>
                <span>{row.nextSession
                  ? `${row.nextSession.dayLabel}${row.nextSession.time ? ` ${row.nextSession.time}` : ''}${row.location ? ` · ${row.location}` : ''}`
                  : '待补上课时间'}</span>
                <button
                  type="button"
                  className="class-control-task-switch"
                  aria-expanded={taskPickerClass === row.classCode}
                  onClick={() => onToggleTaskPicker(row.classCode)}
                >
                  <span>统计挑战</span>
                  <b>{taskSwitchingClass === row.classCode ? '切换中…' : row.taskLabel}</b>
                  <i>⌄</i>
                </button>
                {taskPickerClass === row.classCode && (
                  <div className="class-control-task-options" role="listbox" aria-label={`${row.classCode} 可统计挑战`}>
                    {(taskOptions[row.classCode] || []).length ? (taskOptions[row.classCode] || []).map((taskOption) => (
                      <button
                        type="button"
                        role="option"
                        aria-selected={row.selectedWeekIds.includes(String(taskOption.id))}
                        key={taskOption.id}
                        disabled={taskSwitchingClass === row.classCode}
                        onClick={() => onSelectTask(row.classCode, taskOption)}
                      >
                        <strong>{taskOption.name}</strong>
                        <small>{String(taskOption.startAt || taskOption.addedAt || '').slice(0, 10) || '日期待确认'} · {taskOption.resourceCount || 0} 个资源</small>
                      </button>
                    )) : <span>正在读取可统计挑战…</span>}
                  </div>
                )}
              </div>
              {!row.hasTaskData ? (
                <div className="class-control-xray-empty">
                  <strong>{row.isPending ? '正在核对可统计挑战' : '暂无可统计挑战'}</strong>
                  <span>{row.isPending ? '正在补齐这个班的真实挑战与完成数据，请稍候。' : '当前不计算完成率，也不会把全班标为未完成；这不是加载中，可点击左侧“统计挑战”重新选择。'}</span>
                </div>
              ) : (
                <>
                  <DistributionBar
                    title={`完成率 ${percent(row.completion)}`}
                    segments={row.completionSegments}
                    total={row.studentCount}
                    onSelect={(segment) => onShowNames(row.classCode, `${row.taskLabel} · ${segment.label}`, segment.names, segment.shortLabel)}
                  />
                  <CompactDistributionPie
                    title={`质量 ${percent(row.accuracy)} · ${coverage}`}
                    segments={row.qualitySegments}
                    total={row.studentCount}
                    onSelect={(segment) => onShowNames(row.classCode, `${row.taskLabel} · ${segment.label}`, segment.names, segment.shortLabel)}
                  />
                  <div className="class-control-xray-current">
                    <div><strong className={`is-${row.currentStatus.tone}`}>{row.currentStatus.label}</strong><span>{current?.weekLabel || '本轮'}</span></div>
                    <p>{row.currentStatus.deadline}</p>
                    <small>{row.currentStatus.detail}</small>
                    <small>{row.currentStatus.quality}</small>
                  </div>
                  <div className="class-control-xray-delta">
                    <span>完成率</span>
                    <strong className={row.delta === null ? '' : row.delta < 0 ? 'is-down' : 'is-up'}>
                      {row.delta === null ? '暂无对比' : `${row.delta > 0 ? '+' : ''}${row.delta}点`}
                    </strong>
                  </div>
                </>
              )}
              <button
                className={`class-control-xray-open${selectedClassCode === row.classCode ? ' is-active' : ''}`}
                onClick={() => onOpenClass(row.classCode)}
                aria-current={selectedClassCode === row.classCode ? 'true' : undefined}
              >
                <strong>{row.studentCount || '—'}人</strong>
                <span>{selectedClassCode === row.classCode ? '当前班级' : '看学生'}</span>
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ClassControlCard({
  classInfo,
  summary,
  preparedState,
  busy,
  error,
  onRefresh,
  onLoadTrend,
  onLoadAttendance,
  onOpenReport,
  onShowNames,
  scheduleNonce,
  teacherName,
  officialSessions,
  trendLoading,
  attendanceLoading,
}: {
  classInfo: ClassInfo;
  summary?: ClassControlSummary;
  preparedState?: PreparedDailyReportState;
  busy: boolean;
  error?: string;
  onRefresh: () => void;
  onLoadTrend: () => void;
  onLoadAttendance: () => void;
  onOpenReport: () => void;
  onShowNames: (title: string, names: string[], copyPrefix: string) => void;
  scheduleNonce: number;
  teacherName: string;
  officialSessions: OfficialTeacherScheduleSlot[];
  trendLoading: boolean;
  attendanceLoading: boolean;
}) {
  const [analysisTab, setAnalysisTab] = useState<AnalysisTab>('overview');
  const trendAutoRequested = useRef(false);
  const classCode = classInfo.name.toUpperCase();
  const nextSession = useMemo(
    () => getNextClassSession(classCode, officialSessions, new Date(), teacherName),
    [classCode, officialSessions, scheduleNonce, teacherName],
  );
  const confirmed = useMemo(
    () => isClassControlScheduleConfirmed(classCode, teacherName),
    [classCode, scheduleNonce, teacherName],
  );
  const currentStatus = buildCurrentCycleStatus(summary?.current, nextSession, confirmed);
  const location = formatSessionLocation(nextSession);
  const cycles = [summary?.review, summary?.current].filter((cycle): cycle is ClassControlCycle => Boolean(cycle));
  const displayCycle = summary?.review || summary?.current || null;
  const hasNoTasks = (preparedState?.state === 'ready-empty' || summary?.taskState === 'empty')
    && !summary?.review && !summary?.current;
  const waitingCopy = summary?.current && !summary.review
    ? '正在读取本轮挑战数据。'
    : hasNoTasks
    ? '本学期暂未布置作业，挑战目录已经检查完成。'
    : preparedState?.state === 'ready-data'
      ? '挑战目录已准备，正在生成学生完成与质量分析…'
      : preparedState?.state === 'failed'
        ? preparedState.error || '本次挑战目录更新失败，稍后可重新刷新。'
        : '正在等待今日挑战目录…';

  useEffect(() => {
    if (!summary?.review || busy || trendLoading) return;
    const trendAge = summary?.trendUpdatedAt ? Date.now() - Date.parse(summary.trendUpdatedAt) : Number.POSITIVE_INFINITY;
    const trendFresh = Number.isFinite(trendAge) && trendAge < 6 * 60 * 60 * 1000;
    const expectedTrendCount = summary?.trendExpectedCount ?? 4;
    const needsTrend = !summary.trendComplete || (summary.trend?.length || 0) < expectedTrendCount || !trendFresh;
    if (!needsTrend) {
      trendAutoRequested.current = false;
      return;
    }
    if (trendAutoRequested.current) return;
    trendAutoRequested.current = true;
    onLoadTrend();
  }, [busy, onLoadTrend, summary, trendLoading]);

  const selectAnalysisTab = (tab: AnalysisTab) => {
    setAnalysisTab(tab);
    if (tab === 'students' && summary?.attendance === undefined) onLoadAttendance();
  };

  return (
    <article className="class-control-card is-expanded" id={`class-control-${classCode}`}>
      <header className="class-control-card-header">
        <div>
          <div className="class-control-class-row">
            <h3>{classCode}</h3>
            {summary?.historical && <span className="class-control-history-tag">历史验证数据</span>}
          </div>
          <p>
            {nextSession
              ? `${nextSession.dayLabel}${nextSession.time ? ` ${nextSession.time}` : ''} 上课${location ? ` · ${location}` : ''}`
              : confirmed ? '待补上课时间' : '上课时间待确认'}
          </p>
        </div>
        <div className="class-control-card-actions">
          {!confirmed && <span className="class-control-unconfirmed">待确认</span>}
          <button className="class-control-icon-button" onClick={onRefresh} disabled={busy || hasNoTasks} aria-label={`刷新${classCode}`}>
            {busy ? '同步中' : hasNoTasks ? '已检查' : '刷新'}
          </button>
          <button className="class-control-report-button" onClick={onOpenReport}>日报 →</button>
        </div>
      </header>

      {displayCycle ? (
        <section className="class-control-review">
          <div className="class-control-cycle-heading">
            <strong>{displayCycle.weekLabel} · {summary?.review ? '上一轮回顾' : '本轮数据'}</strong>
            <span>{displayCycle.rangeStart} — {displayCycle.rangeEnd}</span>
          </div>
          <CycleMetrics cycle={displayCycle} onShowNames={onShowNames} />
        </section>
      ) : (
        <div className={`class-control-empty${hasNoTasks ? ' is-resolved-empty' : ''}`}>
          {busy ? '正在读取上一轮数据…' : error || waitingCopy}
        </div>
      )}

      {summary?.current && summary?.review && (
        <CurrentCycleStrip cycle={summary.current} status={currentStatus} />
      )}

      {!hasNoTasks && <section className="class-control-analysis-shell">
          <div className="class-control-analysis-heading">
            <span>
              <strong>进一步分析</strong>
              <small>看趋势、找学生、查具体作业</small>
            </span>
          </div>
          <div className="class-control-analysis-panel">
            <nav className="class-control-analysis-tabs" aria-label="分析视图">
              {([
                ['overview', '整体情况'],
                ['students', '重点学生'],
                ['tasks', '具体作业'],
              ] as Array<[AnalysisTab, string]>).map(([tab, label]) => (
                <button
                  key={tab}
                  className={analysisTab === tab ? 'is-active' : ''}
                  onClick={() => selectAnalysisTab(tab)}
                  aria-pressed={analysisTab === tab}
                >
                  {label}
                </button>
              ))}
            </nav>

            {analysisTab === 'overview' && (summary ? (
                <div className="class-control-analysis-view">
                  <InsightSummary summary={summary} />
                  <div className="class-control-analysis-overview">
                    <TrendChart
                      cycles={summary.trend}
                      loading={trendLoading}
                      expectedCount={summary.trendExpectedCount ?? 4}
                    />
                    <div className="class-control-distribution-stack">
                      <DistributionPie title={`${displayCycle?.weekLabel || ''} 完成情况`} distribution={displayCycle?.task?.completionDistribution} />
                      <DistributionPie title={`${displayCycle?.weekLabel || ''} 完成质量`} distribution={displayCycle?.task?.accuracyDistribution} />
                    </div>
                  </div>
                </div>
            ) : (
              <div className="class-control-analysis-empty">{busy ? '正在更新班级数据…' : error || '暂时没有可分析的数据，可更新后再试'}</div>
            ))}

            {analysisTab === 'students' && (summary ? (
                <div className="class-control-student-analysis">
                  <StudentQuadrant profiles={displayCycle?.task?.studentProfiles || []} />
                  <StudentPriorityList summary={summary} attendanceLoading={attendanceLoading} />
                </div>
            ) : (
              <div className="class-control-analysis-empty">{busy ? '正在更新学生数据…' : '暂时没有可查看的学生数据'}</div>
            ))}

            {analysisTab === 'tasks' && (cycles.length > 0 ? (
                <div className="class-control-analysis-view">
                  {cycles.map((cycle) => (
                    <TaskBreakdownList key={`${cycle.role}-${cycle.weekLabel}`} cycle={cycle} onShowNames={onShowNames} />
                  ))}
                </div>
            ) : (
              <div className="class-control-analysis-empty">{busy ? '正在更新作业数据…' : '暂时没有作业明细'}</div>
            ))}
          </div>
      </section>}

      {(summary?.review?.taskError || summary?.current?.taskError || summary?.speakingError || summary?.attendanceError || error) && (
        <div className="class-control-partial-warning">
          {error || summary?.review?.taskError || summary?.current?.taskError || summary?.speakingError || summary?.attendanceError}
          {(summary?.review?.taskRetained || summary?.review?.speakingRetained || summary?.current?.taskRetained || summary?.current?.speakingRetained)
            ? '，已保留最近可用结果'
            : '，可稍后重新刷新'}
        </div>
      )}
    </article>
  );
}

export default function ClassControlPanel({
  classes,
  teacherName,
  preparedSnapshot = null,
  onOpenReport,
  onAuthenticationRequired,
  autoRefreshPrepared = true,
  activeClassCode,
  onActiveClassChange,
}: Props) {
  const {
    summaries,
    busyClasses,
    trendBusyClasses,
    attendanceBusyClasses,
    preparedTaskStates = {},
    errors,
    refreshingAll,
    updatedAt,
    refreshAll,
    refreshOne,
    loadTrend,
    loadAttendance,
  } = useClassControlDashboard(
    classes,
    teacherName,
    onAuthenticationRequired,
    preparedSnapshot,
    autoRefreshPrepared,
  );
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleNonce, setScheduleNonce] = useState(0);
  const [officialSchedules, setOfficialSchedules] = useState<OfficialTeacherScheduleMap>({});
  const [scheduleLoading, setScheduleLoading] = useState(true);
  const [scheduleError, setScheduleError] = useState('');
  const [namesPanel, setNamesPanel] = useState<NamesPanel>(null);
  const [copied, setCopied] = useState(false);
  const [selectedClass, setSelectedClass] = useState<string | null>(null);
  const [portfolioTaskCatalogs, setPortfolioTaskCatalogs] = useState<Record<string, RosterSnapshotWeekTask[]>>({});
  const [portfolioTaskOverrides, setPortfolioTaskOverrides] = useState<Record<string, PortfolioTaskOverride>>({});
  const [taskPickerClass, setTaskPickerClass] = useState('');
  const [taskSwitchingClass, setTaskSwitchingClass] = useState('');
  const overviewRefreshStarted = useRef(false);
  const defaultTaskJobs = useRef(new Set<string>());
  const manualTaskClasses = useRef(new Set<string>());
  const authenticationRequiredRef = useRef(onAuthenticationRequired);
  authenticationRequiredRef.current = onAuthenticationRequired;

  useEffect(() => {
    if (!autoRefreshPrepared || overviewRefreshStarted.current) return;
    overviewRefreshStarted.current = true;
    void refreshAll();
  }, [autoRefreshPrepared, refreshAll]);

  const portfolioTaskOptions = useMemo(() => {
    const next: Record<string, RosterSnapshotWeekTask[]> = { ...portfolioTaskCatalogs };
    for (const item of preparedSnapshot?.dailyReportTasks || []) {
      const classCode = String(item.classId || '').toUpperCase();
      if (item.weekTasks?.length) next[classCode] = item.weekTasks;
    }
    return next;
  }, [portfolioTaskCatalogs, preparedSnapshot]);

  useEffect(() => {
    if (!autoRefreshPrepared) return;
    // Overview and daily report use the same session recommendation. The weekly
    // aggregate is not a substitute for the previous corresponding lesson.
    for (const classInfo of classes) {
      const classCode = classInfo.name.toUpperCase();
      const tasks = portfolioTaskOptions[classCode] || [];
      if (!tasks.length || defaultTaskJobs.current.has(classCode) || manualTaskClasses.current.has(classCode)) continue;
      const recommendation = recommendTasksForMatchingSession({
        tasks,
        sessions: getSuggestedClassControlSessions(classCode, officialSchedules[classCode] || [], teacherName),
      });
      if (!recommendation.selectedWeekIds.length) continue;
      const existing = summaries[classCode]?.review || summaries[classCode]?.current;
      if (existing?.task?.available
        && existing.weekIds.slice().sort().join(',') === recommendation.selectedWeekIds.slice().sort().join(',')) continue;
      defaultTaskJobs.current.add(classCode);
      void fetchClassTaskReport(classCode, recommendation.selectedWeekIds, {
        mode: 'standard', includeSpeaking: false, minSpeakingDays: 2, testPassScore: null, aiVoicePassRate: 75,
      }, false).then((report) => {
        if (manualTaskClasses.current.has(classCode)) return;
        setPortfolioTaskOverrides((current) => ({ ...current, [classCode]: {
          task: report.task,
          weekIds: recommendation.selectedWeekIds,
          weekLabel: tasks.filter((task) => recommendation.selectedWeekIds.includes(String(task.id))).map((task) => task.name).join(' + '),
        } }));
      }).catch((error) => {
        if (String(error?.message || '').includes('未登录')) authenticationRequiredRef.current?.();
      });
    }
  }, [autoRefreshPrepared, classes, officialSchedules, portfolioTaskOptions, summaries, teacherName]);

  const toggleTaskPicker = (classCode: string) => {
    const opening = taskPickerClass !== classCode;
    setTaskPickerClass(opening ? classCode : '');
    if (!opening || portfolioTaskOptions[classCode]?.length) return;
    void fetchClassTaskCatalog(classCode).then((catalog) => {
      setPortfolioTaskCatalogs((current) => ({ ...current, [classCode]: catalog.weekTasks || [] }));
    }).catch((nextError) => {
      if (String((nextError as Error)?.message || '').includes('未登录')) onAuthenticationRequired?.();
      setPortfolioTaskCatalogs((current) => ({ ...current, [classCode]: [] }));
    });
  };

  const selectPortfolioTask = (classCode: string, task: RosterSnapshotWeekTask) => {
    manualTaskClasses.current.add(classCode);
    setTaskSwitchingClass(classCode);
    void fetchClassTaskReport(classCode, [String(task.id)], {
      mode: 'standard',
      includeSpeaking: false,
      minSpeakingDays: 2,
      testPassScore: null,
      aiVoicePassRate: 75,
    }, false).then((nextReport) => {
      setPortfolioTaskOverrides((current) => ({
        ...current,
        [classCode]: { task: nextReport.task, weekIds: [String(task.id)], weekLabel: task.name },
      }));
      setTaskPickerClass('');
    }).catch((nextError) => {
      if (String((nextError as Error)?.message || '').includes('未登录')) onAuthenticationRequired?.();
    }).finally(() => setTaskSwitchingClass(''));
  };

  useEffect(() => {
    let active = true;
    if (!OFFICIAL_TEACHER_SCHEDULE_ENABLED) {
      setOfficialSchedules({});
      setScheduleError('');
      setScheduleLoading(false);
      return () => { active = false; };
    }
    setScheduleLoading(true);
    setScheduleError('');
    void fetchOfficialTeacherSchedule().then((result) => {
      if (!active) return;
      setOfficialSchedules(result.classes);
    }).catch((error) => {
      if (!active) return;
      setOfficialSchedules({});
      setScheduleError(error instanceof Error ? error.message : '官网课表读取失败');
      if (error instanceof OfficialScheduleApiError && error.status === 401) {
        onAuthenticationRequired?.();
      }
    }).finally(() => {
      if (active) setScheduleLoading(false);
    });
    return () => { active = false; };
  }, [teacherName, onAuthenticationRequired]);

  const allSchedulesConfirmed = useMemo(() => classes.every((classInfo) => (
    isClassControlScheduleConfirmed(classInfo.name, teacherName)
  )), [classes, scheduleNonce, teacherName]);

  const showNames = (classCode: string, title: string, names: string[], copyPrefix: string) => {
    setCopied(false);
    setNamesPanel({
      title: `${classCode} · ${title}`,
      names: sortEnglishNames(names),
      copyPrefix,
    });
  };

  const copyNames = async () => {
    if (!namesPanel) return;
    const text = `${namesPanel.copyPrefix}：${namesPanel.names.join('、')}`;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        textarea.remove();
      }
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const sortedClasses = useMemo(() => [...classes].sort((left, right) => {
    const leftCode = left.name.toUpperCase();
    const rightCode = right.name.toUpperCase();
    const leftSession = getClassDisplaySession(leftCode, officialSchedules[leftCode] || [], new Date(), teacherName);
    const rightSession = getClassDisplaySession(rightCode, officialSchedules[rightCode] || [], new Date(), teacherName);
    return (leftSession?.minutesUntil ?? Number.POSITIVE_INFINITY) - (rightSession?.minutesUntil ?? Number.POSITIVE_INFINITY)
      || leftCode.localeCompare(rightCode);
  }), [classes, officialSchedules, scheduleNonce, teacherName]);

  const portfolioRows = useMemo(() => sortedClasses.map((classInfo) => {
    const classCode = classInfo.name.toUpperCase();
    const nextSession = getClassDisplaySession(classCode, officialSchedules[classCode] || [], new Date(), teacherName);
    const confirmed = isClassControlScheduleConfirmed(classCode, teacherName);
    const preparedState = preparedTaskStates[classCode];
    const visibleSummary = preparedState?.state === 'ready-empty' ? undefined : summaries[classCode];
    return portfolioRow(
      classInfo,
      visibleSummary,
      nextSession,
      confirmed,
      preparedState,
      portfolioTaskOverrides[classCode],
      portfolioTaskOptions[classCode] || [],
      refreshingAll,
    );
  }), [officialSchedules, portfolioTaskOptions, portfolioTaskOverrides, preparedTaskStates, refreshingAll, scheduleNonce, sortedClasses, summaries, teacherName]);

  const defaultDetailClassCode = useMemo(
    () => [...portfolioRows].sort(comparePortfolioRowsByRisk)[0]?.classCode || '',
    [portfolioRows],
  );
  const selectedClassStillExists = Boolean(selectedClass && sortedClasses.some(
    (classInfo) => classInfo.name.toUpperCase() === selectedClass,
  ));
  const selectedClassCode = activeClassCode && sortedClasses.some((item) => item.name.toUpperCase() === activeClassCode)
    ? activeClassCode : selectedClassStillExists ? selectedClass || '' : defaultDetailClassCode;
  const selectedDetailClass = sortedClasses.find(
    (classInfo) => classInfo.name.toUpperCase() === selectedClassCode,
  ) || null;

  useEffect(() => {
    if (!autoRefreshPrepared) return;
    if (!selectedDetailClass || !selectedClassCode) return;
    if (preparedTaskStates[selectedClassCode]?.state === 'ready-empty') return;
    if (summaries[selectedClassCode] || busyClasses.has(selectedClassCode) || errors[selectedClassCode]) return;
    void refreshOne(selectedDetailClass);
  }, [
    busyClasses,
    autoRefreshPrepared,
    errors,
    refreshOne,
    preparedTaskStates,
    selectedClassCode,
    selectedDetailClass,
    summaries,
  ]);

  const openClass = (classCode: string) => {
    setSelectedClass(classCode);
    onActiveClassChange?.(classCode);
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      document.getElementById(`class-control-${classCode}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
  };

  if (classes.length === 0) return null;

  return (
    <section className="class-control-panel" aria-label="班级数据概览">
      <TeacherPortfolio
        rows={portfolioRows}
        selectedClassCode={selectedClassCode}
        onOpenClass={openClass}
        onShowNames={showNames}
        taskPickerClass={taskPickerClass}
        taskOptions={portfolioTaskOptions}
        taskSwitchingClass={taskSwitchingClass}
        onToggleTaskPicker={toggleTaskPicker}
        onSelectTask={selectPortfolioTask}
        updatedAt={updatedAt}
        refreshingAll={refreshingAll}
        allSchedulesConfirmed={allSchedulesConfirmed}
        onRefreshAll={() => void refreshAll()}
        onOpenSchedule={() => setScheduleOpen(true)}
      />

      <div className="class-control-detail-heading">
        <div><strong>班级详细情况</strong><span>{selectedDetailClass ? `正在查看 ${selectedClassCode}：学生、作业和趋势` : '暂无可查看班级'}</span></div>
        <small>点击上方班级可切换</small>
      </div>

      <div className="class-control-list">
        {selectedDetailClass ? (
          <ClassControlCard
            key={selectedDetailClass.id || selectedClassCode}
            classInfo={selectedDetailClass}
            summary={preparedTaskStates[selectedClassCode]?.state === 'ready-empty' ? undefined : summaries[selectedClassCode]}
            preparedState={preparedTaskStates[selectedClassCode]}
            busy={busyClasses.has(selectedClassCode)}
            error={errors[selectedClassCode]}
            onRefresh={() => void refreshOne(selectedDetailClass)}
            onLoadTrend={() => void loadTrend(selectedDetailClass)}
            onLoadAttendance={() => void loadAttendance(selectedDetailClass)}
            onOpenReport={() => onOpenReport(selectedDetailClass)}
            onShowNames={(title, names, copyPrefix) => showNames(selectedClassCode, title, names, copyPrefix)}
            scheduleNonce={scheduleNonce}
            teacherName={teacherName}
            officialSessions={officialSchedules[selectedClassCode] || []}
            trendLoading={trendBusyClasses.has(selectedClassCode)}
            attendanceLoading={attendanceBusyClasses.has(selectedClassCode)}
          />
        ) : (
          <div className="class-control-detail-empty">暂时没有可查看的班级。</div>
        )}
      </div>

      <ClassControlScheduleDialog
        open={scheduleOpen}
        classes={classes}
        teacherName={teacherName}
        officialSchedules={officialSchedules}
        scheduleError={scheduleError}
        onClose={() => setScheduleOpen(false)}
        onSaved={() => setScheduleNonce((value) => value + 1)}
      />

      {namesPanel && createPortal((
        <div className="class-control-names-backdrop" role="presentation" onMouseDown={() => setNamesPanel(null)}>
          <section className="class-control-names-sheet" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div>
                <div className="class-control-kicker">STUDENTS</div>
                <h2>{namesPanel.title}</h2>
              </div>
              <button onClick={() => setNamesPanel(null)} aria-label="关闭">×</button>
            </header>
            <div className="class-control-copy-row">
              <span>{namesPanel.copyPrefix} · {namesPanel.names.length} 人（英文名升序）</span>
              <button onClick={() => void copyNames()}>{copied ? '已复制' : '复制名单'}</button>
            </div>
            <div className="class-control-name-list">
              {namesPanel.names.map((name, index) => <span key={`${name}-${index}`}>{name}</span>)}
            </div>
          </section>
        </div>
      ), document.body)}
    </section>
  );
}
