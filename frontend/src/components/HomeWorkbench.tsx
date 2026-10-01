import { useState, type ReactNode } from 'react';
import './HomeWorkbench.css';

export type HomeDataTab = 'daily-report' | 'speaking' | 'overview';
export interface HomeTool { label: string; icon: string; disabled?: boolean; onOpen: () => void }
interface Props {
  teacherName: string;
  week: number;
  dateRange: string;
  currentClass: string;
  tools: HomeTool[];
  moreTools: HomeTool[];
  sync: ReactNode;
  version: ReactNode;
  tab: HomeDataTab;
  onTabChange: (tab: HomeDataTab) => void;
  showClassControl: boolean;
  onShowUpdates: () => void;
  onFeedback: () => void;
  onLogout: () => void;
  todoCount: number | null;
  todos: ReactNode;
  children: ReactNode;
}

const tabs: { value: HomeDataTab; label: string }[] = [
  { value: 'daily-report', label: '班级日报' },
  { value: 'speaking', label: '每日开口' },
  { value: 'overview', label: '班级概览' },
];

function ToolLink({ tool }: { tool: HomeTool }) {
  return <button type="button" className="home-tool" title={tool.label} aria-label={tool.label} disabled={tool.disabled} onClick={tool.onOpen}>
    <span className="home-tool-icon" aria-hidden="true">{tool.icon}</span>
    <span className="home-tool-name">{tool.label}</span>
    <span className="home-tool-arrow" aria-hidden="true">↗</span>
  </button>;
}

export default function HomeWorkbench(props: Props) {
  const [collapsed, setCollapsed] = useState(() => {
    try { const saved = localStorage.getItem(`amber_home_sidebar_${props.teacherName}`); return saved === null ? window.matchMedia('(max-width: 900px)').matches : saved === 'closed'; } catch { return false; }
  });
  const [todoCollapsed, setTodoCollapsed] = useState(false);
  function toggleSidebar() {
    setCollapsed(current => {
      try { localStorage.setItem(`amber_home_sidebar_${props.teacherName}`, current ? 'open' : 'closed'); } catch {}
      return !current;
    });
  }

  return <div className={`home-workbench${collapsed ? ' has-compact-sidebar' : ''}${todoCollapsed ? ' has-compact-todos' : ''}`}>
    <aside className="home-sidebar" aria-label="问候与工具箱">
      <div className="home-sidebar-scroll">
        <div className="home-brand-row">
          <h1>Super Amber</h1>
          <button type="button" className="home-sidebar-toggle" onClick={toggleSidebar} aria-expanded={!collapsed} aria-label={collapsed ? '展开工具栏' : '收起工具栏'}><span aria-hidden="true">☰</span><span className="home-mobile-label">工具箱</span></button>
        </div>
        <header className="home-identity">
          <p className="home-greeting">Hello! {props.teacherName || 'Teacher'}!</p>
          <p className="home-tagline">C&amp;F School · 班级事务助手</p>
          <div className="home-week"><strong>Week {props.week}</strong><span>{props.dateRange}</span></div>
        </header>
        <div className="home-sync-slot">{props.sync}</div>
        <nav className="home-tools" aria-label="常用工具">
          <div className="home-section-heading"><h2>工具箱</h2><span>{props.currentClass || '选择班级'}</span></div>
          <div className="home-tool-list">{props.tools.map(tool => <ToolLink key={tool.label} tool={tool}/>)}</div>
        </nav>
        <details className="home-more-tools"><summary>更多工具</summary><div>{props.moreTools.map(tool => <ToolLink key={tool.label} tool={tool}/>)}</div></details>
      </div>
      <footer className="home-sidebar-footer">
        <button type="button" className="home-feedback" onClick={props.onFeedback} aria-label="用户反馈"><span aria-hidden="true">✉</span><span className="home-feedback-label">用户反馈</span><span className="home-tool-arrow" aria-hidden="true">↗</span></button>
        <div className="home-account"><details className="home-version"><summary>版本信息</summary>{props.version}</details><button type="button" onClick={props.onLogout}>退出登录</button></div>
      </footer>
    </aside>
    <main className="home-main" aria-label="班级工作区">
      <header className="home-topbar">
        <nav className="home-tabs" role="tablist" aria-label="首页学习数据">{tabs.filter(tab => props.showClassControl || tab.value === 'speaking').map(tab => <button key={tab.value} type="button" role="tab" aria-selected={props.tab === tab.value} onClick={() => props.onTabChange(tab.value)}>{tab.label}</button>)}</nav>
        <button type="button" className="home-updates" onClick={props.onShowUpdates}><span aria-hidden="true">✦</span> 功能更新 <span aria-hidden="true">↗</span></button>
      </header>
      <div className="home-content">{props.children}</div>
    </main>
    <aside className="home-todos" aria-label="待办区域">
      <button type="button" className="home-todo-toggle" aria-expanded={!todoCollapsed} aria-controls="home-todo-content" onClick={() => setTodoCollapsed(current => !current)}><span>今日待办 <b>{props.todoCount ?? '未开启'}</b></span><span>{todoCollapsed ? '展开' : '收起'}</span></button>
      <div id="home-todo-content" hidden={todoCollapsed}>{props.todos}</div>
    </aside>
  </div>;
}
