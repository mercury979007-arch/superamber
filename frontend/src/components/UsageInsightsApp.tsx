import { useEffect, useMemo, useState } from 'react';
import './UsageInsightsApp.css';

interface Props {
  onBack: () => void;
}

interface CountEntry {
  count: number;
  event?: string;
  teacherName?: string;
  module?: string;
  tool?: string;
}

interface DailyEntry {
  day: string;
  events: number;
  activeUsers: number;
}

interface ActivityEntry {
  ts: string;
  teacherName: string;
  tool: string;
  action: string;
  className?: string;
  mpTotal?: number;
  studentCount?: number;
  successCount?: number;
  failedCount?: number;
}

interface SpeakingMiniPinEntry {
  ts: string;
  teacherName: string;
  className?: string;
  totalMP: number;
  studentCount: number;
  successCount: number;
  failedCount: number;
}

interface UsageSummary {
  totalEvents: number;
  uniqueUsers: number;
  byEvent: CountEntry[];
  byUser: CountEntry[];
  byModule: CountEntry[];
  byTool: Array<CountEntry & { tool?: string }>;
  minipin: {
    totalMP: number;
    totalActions: number;
    totalStudents: number;
  };
  speakingMinipin: {
    totalMP: number;
    totalActions: number;
    totalStudents: number;
    recent: SpeakingMiniPinEntry[];
  };
  daily: DailyEntry[];
  recentActivity: ActivityEntry[];
  dataQuality: {
    unidentifiedEventCount: number;
    unverifiedEventCount?: number;
    unverifiedUserCount?: number;
    caseVariantMergeCount?: number;
  };
  identity?: {
    verifiedUsers: number;
    observedUsers: number;
    unverifiedUsers: number;
    mergedCaseVariants: number;
  };
}

const DAY_OPTIONS = [7, 30, 90, 180];

function formatMpValue(value: number | null | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(1) : '0.0';
}

function getShanghaiDay(offset = 0) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offset);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function formatDayLabel(day: string) {
  const [, month, date] = day.split('-');
  return `${Number(month)}.${Number(date)}`;
}

function formatShanghaiDateTime(value: string) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return '时间未知';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(parsed);
}

function MetricCard({ label, value, unit, note, primary = false }: {
  label: string;
  value: string | number;
  unit?: string;
  note: string;
  primary?: boolean;
}) {
  return (
    <section className={`usage-metric${primary ? ' primary' : ''}`}>
      <span>{label}</span>
      <strong>{value}{unit ? <small>{unit}</small> : null}</strong>
      <p>{note}</p>
    </section>
  );
}

function ActivityList({ items }: { items: ActivityEntry[] }) {
  return (
    <section className="usage-panel usage-activity-panel">
      <header className="usage-panel-head">
        <div>
          <span>实时流水</span>
          <h3>最近真实操作</h3>
        </div>
        <small>北京时间</small>
      </header>
      <div className="usage-activity-list">
        {items.length > 0 ? items.slice(0, 24).map((item, index) => {
          const isMiniPin = item.action === '发放 MiniPin';
          const resultCount = Number(item.successCount) || Number(item.studentCount) || 0;
          return (
            <div key={`${item.ts}:${item.teacherName}:${item.tool}:${index}`} className="usage-activity-row">
              <time>{formatShanghaiDateTime(item.ts)}</time>
              <div className="usage-activity-person">
                <strong>{item.teacherName}</strong>
                <span>{item.className || '未选择班级'}</span>
              </div>
              <div className="usage-activity-main">
                <strong>{item.tool}</strong>
                <span>
                  {item.action}
                  {isMiniPin ? ` · ${formatMpValue(item.mpTotal)} MP / ${resultCount}人` : ''}
                </span>
              </div>
            </div>
          );
        }) : <div className="usage-empty">所选时间内暂无真实功能操作</div>}
      </div>
    </section>
  );
}

function RankedList({ title, kicker, items, labelField }: {
  title: string;
  kicker: string;
  items: CountEntry[];
  labelField: 'teacherName' | 'tool';
}) {
  const max = Math.max(1, ...items.map((item) => Number(item.count) || 0));
  return (
    <section className="usage-panel usage-ranking-panel">
      <header className="usage-panel-head">
        <div>
          <span>{kicker}</span>
          <h3>{title}</h3>
        </div>
      </header>
      <div className="usage-ranking-list">
        {items.length > 0 ? items.slice(0, 8).map((item, index) => (
          <div key={`${labelField}:${item[labelField]}`} className="usage-ranking-row">
            <span className="usage-rank">{index + 1}</span>
            <div>
              <div className="usage-ranking-copy">
                <strong>{item[labelField] || '未命名'}</strong>
                <span>{item.count}次</span>
              </div>
              <i style={{ width: `${Math.max(8, ((Number(item.count) || 0) / max) * 100)}%` }} />
            </div>
          </div>
        )) : <div className="usage-empty">暂无数据</div>}
      </div>
    </section>
  );
}

function DailyTrend({ items }: { items: DailyEntry[] }) {
  const days = items.slice(-10);
  const max = Math.max(1, ...days.map((item) => item.activeUsers));
  return (
    <section className="usage-panel usage-trend-panel">
      <header className="usage-panel-head">
        <div>
          <span>去重账号</span>
          <h3>每日活跃趋势</h3>
        </div>
        <small>最多显示10天</small>
      </header>
      <div className="usage-trend-list">
        {days.length > 0 ? days.map((item) => (
          <div key={item.day} className="usage-trend-row">
            <time>{formatDayLabel(item.day)}</time>
            <div><i style={{ width: `${Math.max(3, (item.activeUsers / max) * 100)}%` }} /></div>
            <strong>{item.activeUsers}<small>人</small></strong>
            <span>{item.events}次</span>
          </div>
        )) : <div className="usage-empty">暂无每日活跃数据</div>}
      </div>
    </section>
  );
}

function SpeakingMiniPinBlock({ data }: { data: UsageSummary['speakingMinipin'] }) {
  return (
    <section className="usage-panel usage-speaking-panel">
      <header className="usage-panel-head">
        <div>
          <span>业务结果</span>
          <h3>每日开口 MiniPin</h3>
        </div>
      </header>
      <div className="usage-speaking-totals">
        <div><strong>{formatMpValue(data.totalMP)}</strong><span>累计 MP</span></div>
        <div><strong>{data.totalStudents || 0}</strong><span>成功学生</span></div>
        <div><strong>{data.totalActions || 0}</strong><span>发放批次</span></div>
      </div>
      <div className="usage-speaking-list">
        {data.recent.length > 0 ? data.recent.slice(0, 5).map((item, index) => (
          <div key={`${item.ts}:${item.teacherName}:${index}`} className="usage-speaking-row">
            <div><strong>{item.teacherName}</strong><span>{item.className || '未记录班级'} · {formatShanghaiDateTime(item.ts)}</span></div>
            <div><strong>{formatMpValue(item.totalMP)} MP</strong><span>{item.successCount || item.studentCount}人成功</span></div>
          </div>
        )) : <div className="usage-empty">所选时间内暂无发放记录</div>}
      </div>
    </section>
  );
}

export default function UsageInsightsApp({ onBack }: Props) {
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [sourceEnvironment, setSourceEnvironment] = useState('current');
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadSummary() {
      setLoading(true);
      setError('');
      try {
        const response = await fetch(`/api/admin/usage-summary?days=${days}`, { credentials: 'include' });
        const data = await response.json().catch(() => null);
        if (!response.ok) throw new Error(data?.error || '使用统计加载失败');
        if (!cancelled) {
          setSummary(data.summary || null);
          setSourceEnvironment(data.sourceEnvironment || 'current');
          setLoadedAt(new Date());
        }
      } catch (nextError) {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : '使用统计加载失败');
          setSummary(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadSummary();
    return () => { cancelled = true; };
  }, [days]);

  const today = getShanghaiDay();
  const yesterday = getShanghaiDay(-1);
  const recent = useMemo(() => ({
    today: summary?.daily.find((item) => item.day === today),
    yesterday: summary?.daily.find((item) => item.day === yesterday),
  }), [summary, today, yesterday]);

  const identity = summary?.identity || {
    verifiedUsers: summary?.uniqueUsers || 0,
    observedUsers: summary?.uniqueUsers || 0,
    unverifiedUsers: 0,
    mergedCaseVariants: 0,
  };

  return (
    <div className="usage-wrap fade-in">
      <header className="usage-topbar">
        <button className="back-btn" onClick={onBack}>← 返回</button>
        <div className="usage-title-group">
          <span className="usage-kicker">SUPER AMBER · 运营数据</span>
          <h2>使用分析</h2>
          <p>看真实账号、真实操作和功能结果</p>
        </div>
        <div className="usage-topbar-actions">
          {!loading && !error && (
            <span className={`usage-source-badge ${sourceEnvironment === 'production' ? 'live' : ''}`}>
              <i />{sourceEnvironment === 'production' ? '主站数据' : '当前环境'}
            </span>
          )}
          <div className="usage-range-switch" aria-label="统计时间范围">
            {DAY_OPTIONS.map((option) => (
              <button
                key={option}
                className={`usage-range-btn${days === option ? ' active' : ''}`}
                onClick={() => setDays(option)}
              >
                {option}天
              </button>
            ))}
          </div>
        </div>
      </header>

      {loading && <div className="usage-loading">正在读取主站数据…</div>}
      {error && <div className="usage-error">{error}</div>}

      {!loading && !error && summary && (
        <main className="usage-dashboard">
          <div className="usage-metrics-grid">
            <MetricCard
              primary
              label="认证活跃账号"
              value={identity.verifiedUsers}
              note={`近${days}天去重，不跨天重复累计`}
            />
            <MetricCard label="今日活跃" value={recent.today?.activeUsers || 0} unit="人" note={`${recent.today?.events || 0} 条有效操作`} />
            <MetricCard label="昨日活跃" value={recent.yesterday?.activeUsers || 0} unit="人" note={`${recent.yesterday?.events || 0} 条有效操作`} />
            <MetricCard label="有效操作" value={summary.totalEvents} note={`更新于 ${loadedAt?.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) || '--:--'}`} />
          </div>

          <section className="usage-quality-bar">
            <div>
              <strong>账号口径已校正</strong>
              <span>用户名忽略大小写；核心指标只计入有登录认证依据的账号。</span>
            </div>
            <div className="usage-quality-facts">
              <span><strong>{identity.mergedCaseVariants}</strong> 个大小写重复已合并</span>
              <span><strong>{identity.unverifiedUsers}</strong> 个待核验账号未计入</span>
              <span><strong>{summary.dataQuality.unidentifiedEventCount || 0}</strong> 条匿名记录已排除</span>
            </div>
          </section>

          <div className="usage-content-grid">
            <ActivityList items={summary.recentActivity || []} />
            <aside className="usage-side-stack">
              <RankedList title="操作活跃账号" kicker="TOP 8" items={summary.byUser || []} labelField="teacherName" />
              <RankedList title="常用功能" kicker="打开次数" items={summary.byTool || []} labelField="tool" />
            </aside>
          </div>

          <div className="usage-lower-grid">
            <DailyTrend items={summary.daily || []} />
            <SpeakingMiniPinBlock data={summary.speakingMinipin || { totalMP: 0, totalActions: 0, totalStudents: 0, recent: [] }} />
          </div>
        </main>
      )}
    </div>
  );
}
