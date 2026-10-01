import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ClassInfo, AppScreen } from '../types';
import { formatDateShort } from '../utils/weekNumber';
import WelcomeTodoPanel from './WelcomeTodoPanel';
import ReLoginModal from './ReLoginModal';
import SpeakingChallengeApp from './SpeakingChallengeApp';
import ClassControlPanel from './ClassControlPanel';
import ClassDailyReportHome from './ClassDailyReportHome';
import { getClassDisplaySession } from '../services/classControlSchedule';
import { useWelcomePageState } from '../hooks/useWelcomePageState';
import { useWelcomeTodoState } from '../hooks/useWelcomeTodoState';
import type { TodoAction } from '../services/welcomeTodoRules';
import { isFeatureEnabled } from '../services/featureRegistry';
import { formatRosterSnapshotGeneratedTime, formatRosterSnapshotTime } from '../services/rosterSnapshotService';
import './Welcome.css';
import HomeWorkbench, { type HomeDataTab, type HomeTool } from './HomeWorkbench';
import './HomeReportControls.css';

interface Props {
  teacherName: string;
  classes: ClassInfo[];
  onSelectClass: (cls: ClassInfo) => void;
  onLogout: () => void;
  onSessionRestored: (classes: ClassInfo[]) => void;
  onNavigate: (target: AppScreen) => void;
  onOpenTodoTarget: (cls: ClassInfo, target: Extract<AppScreen, 'hub' | 'seating' | 'overview' | 'flow' | 'daily-report' | 'test-score-entry'>) => void;
  onOpenTaskDistribution: (cls: ClassInfo, selectedWeekIds: string[], snapshotUpdatedAt: string) => void;
}

function useElapsedSeconds(active: boolean, startedAt: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active || !startedAt) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active, startedAt]);
  return active && startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0;
}

export default function Welcome({ teacherName, classes, onSelectClass, onLogout, onSessionRestored, onNavigate, onOpenTodoTarget, onOpenTaskDistribution }: Props) {
  const [homeDataTab, setHomeDataTab] = useState<HomeDataTab>('daily-report');
  const [activeHomeClassCode, setActiveHomeClassCode] = useState('');
  const [reportRefresh, setReportRefresh] = useState<{ busy: boolean; classCode: string; startedAt: number | null }>({
    busy: false,
    classCode: '',
    startedAt: null,
  });
  const updateNoticeKey = `amber_home_update_20260907_batch_${teacherName}`;
  const [showUpdateNotice, setShowUpdateNotice] = useState(() => {
    try { return localStorage.getItem(updateNoticeKey) !== 'seen'; } catch { return true; }
  });
  const {
    week,
    start,
    end,
    showGuide,
    guideSrc,
    view,
    setView,
    toggleGuide,
    displayClasses,
    showingLocalDrafts,
    classCards,
    daySchedule,
    versionInfo,
    versionStatus,
    batchFetchBusy,
    batchFetchStartedAt,
    batchFetchDurationSeconds,
    batchFetchRevision,
    batchFetchStatus,
    batchFetchDone,
    rosterSnapshot,
    showReLogin,
    scheduleImportStatus,
    handleBatchFetchAll,
    handleReLoginSuccess: handlePageReLoginSuccess,
    handleReLoginDismiss,
    handleAuthenticationRequired,
    seatingClassCount,
    rotationPanelState,
    currentSeatingWeek,
    latestSeatingWeek,
    pendingSeatingModes,
    isSeatingCatchUp,
    nextSeatingWeek,
    rotationUnavailableReason,
    rotationDescription,
    rotationMsg,
    rotationBusy,
    canRunWeeklyRotation,
    canUndoWeeklyRotation,
    handleWeeklyRotation,
    handleUndoRotation,
    termLaunch,
    dismissTermLaunch,
    handleForceRefresh,
    handleVersionReload,
  } = useWelcomePageState(classes);
  useEffect(() => {
    const nextClasses = rosterSnapshot?.classes;
    if (!nextClasses?.length) return;
    const signature = (items: ClassInfo[]) => JSON.stringify(items.map(item => [item.id, item.name, item.squadId || '']).sort());
    if (signature(nextClasses) !== signature(classes)) onSessionRestored(nextClasses);
  }, [rosterSnapshot, classes, onSessionRestored]);
  const todoState = useWelcomeTodoState(displayClasses);
  const classInfoByCode = useMemo(
    () => new Map(displayClasses.map((item) => [item.name.toUpperCase(), item])),
    [displayClasses],
  );
  const showUsageInsights = isFeatureEnabled('usage-insights', versionInfo);
  const showClassroomAgent = isFeatureEnabled('classroom-agent', versionInfo);
  const showCampReport = isFeatureEnabled('camp-report', versionInfo);
  const showDataReview = isFeatureEnabled('data-review', versionInfo);
  const showTestScoreEntry = isFeatureEnabled('test-score-entry', versionInfo);
  const showClassControl = isFeatureEnabled('class-control', versionInfo);
  const activeHomeDataTab = showClassControl ? homeDataTab : 'speaking';
  const activeHomeClass = classInfoByCode.get(activeHomeClassCode.toUpperCase()) || displayClasses[0] || null;
  const syncBusy = batchFetchBusy || reportRefresh.busy;
  const syncStartedAt = batchFetchBusy ? batchFetchStartedAt : reportRefresh.startedAt;
  const syncElapsedSeconds = useElapsedSeconds(syncBusy, syncStartedAt);
  const snapshotGeneratedAt = formatRosterSnapshotGeneratedTime(rosterSnapshot);
  const snapshotLastCompleteAt = formatRosterSnapshotTime(rosterSnapshot);
  const handleReportRefreshStateChange = useCallback((busy: boolean, classCode: string) => {
    setReportRefresh((current) => ({
      busy,
      classCode: classCode || current.classCode,
      startedAt: busy ? (current.busy && current.classCode === classCode ? current.startedAt : Date.now()) : null,
    }));
  }, []);

  useEffect(() => {
    if (activeHomeClassCode && classInfoByCode.has(activeHomeClassCode.toUpperCase())) return;
    const ranked = [...displayClasses].sort((a, b) => (getClassDisplaySession(a.name, [], new Date(), teacherName)?.minutesUntil ?? Infinity) - (getClassDisplaySession(b.name, [], new Date(), teacherName)?.minutesUntil ?? Infinity) || a.name.localeCompare(b.name));
    setActiveHomeClassCode(String(ranked[0]?.name || '').toUpperCase());
  }, [activeHomeClassCode, classInfoByCode, displayClasses, teacherName]);

  function handleReLoginSuccess(nextClasses: ClassInfo[]) {
    onSessionRestored(nextClasses);
    handlePageReLoginSuccess(nextClasses);
  }

  function handleManualStart() {
    onSelectClass({ id: 'manual', name: '手动输入' });
  }

  function formatDeploymentTime(raw: string): string {
    if (!raw) return '部署时间未知';
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) {
      return raw;
    }
    return date.toLocaleString('zh-CN', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function handleTodoAction(action: TodoAction) {
    const classInfo = classInfoByCode.get(action.classCode.toUpperCase());
    if (!classInfo) {
      return;
    }
    onOpenTodoTarget(classInfo, action.target);
  }

  function openHomeTool(target: Extract<AppScreen, 'seating' | 'overview' | 'flow' | 'daily-report' | 'test-score-entry'>) {
    if (!activeHomeClass) return;
    onOpenTodoTarget(activeHomeClass, target);
  }

  function dismissUpdateNotice() {
    setShowUpdateNotice(false);
    try { localStorage.setItem(updateNoticeKey, 'seen'); } catch {}
  }

  const tools: HomeTool[] = [
    { label: '座位表', icon: '🪑', disabled: !activeHomeClass, onOpen: () => openHomeTool('seating') },
    { label: '补课助手', icon: '💊', onOpen: () => onNavigate('makeup') },
    { label: 'MiniPin', icon: '🎁', disabled: !activeHomeClass, onOpen: () => openHomeTool('flow') },
    { label: '班级公示', icon: '📗', disabled: !activeHomeClass, onOpen: () => openHomeTool('daily-report') },
    { label: '课程概览', icon: '📊', disabled: !activeHomeClass, onOpen: () => openHomeTool('overview') },
    ...(showTestScoreEntry ? [{ label: '测试录入', icon: '✏️', disabled: !activeHomeClass, onOpen: () => openHomeTool('test-score-entry') }] : []),
  ];
  const moreTools: HomeTool[] = [
    { label: '编辑名单', icon: '☷', onOpen: () => onNavigate('roster') },
    ...(showDataReview ? [{ label: '核对数据', icon: '▤', onOpen: () => onNavigate('data-review') }] : []),
    ...(showClassroomAgent ? [{ label: 'Amber 班级助理', icon: '🐻', onOpen: () => onNavigate('classroom-agent') }] : []),
    ...(showCampReport ? [{ label: '苦令营日报', icon: '🏕️', onOpen: () => onNavigate('camp-report') }] : []),
    ...(showUsageInsights ? [{ label: '使用情况', icon: '📈', onOpen: () => onNavigate('usage-insights') }] : []),
  ];

  return (
    <>
      {termLaunch && (
        <div className="term-launch-backdrop" role="presentation">
          <section className="term-launch-card" role="dialog" aria-modal="true" aria-labelledby="term-launch-title">
            <div className="term-launch-confetti" aria-hidden="true">
              <span>✦</span><span>●</span><span>◆</span><span>✦</span><span>●</span>
            </div>
            <div className="term-launch-emoji" aria-hidden="true">🎉</div>
            <div className="term-launch-kicker">2026 秋季学期</div>
            <h2 id="term-launch-title">新学期，开场！</h2>
            <p className="term-launch-week">Week 1 · 8/31–9/6</p>
            <p className="term-launch-copy">
              {termLaunch.performed
                ? `已为 ${termLaunch.classCount} 个本学期班级完成一次座位轮转，日期也已统一到第一周。`
                : '第一周座位表已经准备好了，日期与轮转状态都已同步。'}
            </p>
            <button className="btn btn-primary term-launch-enter" onClick={dismissTermLaunch} autoFocus>
              进入 Week 1
            </button>
          </section>
        </div>
      )}
      {showUpdateNotice && !termLaunch && (
        <div className="welcome-update-backdrop" onClick={dismissUpdateNotice}>
          <section className="welcome-update-dialog" role="dialog" aria-modal="true" aria-labelledby="welcome-update-title" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === 'Escape') dismissUpdateNotice(); }}>
            <span aria-hidden="true">✨</span><h2 id="welcome-update-title">功能更新</h2>
            <p>班级公示和课程概览已移到首页常用工具。下一周座位表在周日开放生成。</p>
            <p>座位表统一为 16:9，三横排缺少第六组时，第五组自动居中；布局直接切换和交叉轮换保留。</p>
            <p>班级日报恢复单页，可调整显示大小；点「日报设置」展开统计与奖励规则，保存后可以反复沿用。</p>
            <p>遇到问题，可以从左下方「用户反馈」提交文字和截图。</p>
            <a href="/guide.html" target="_blank" rel="noreferrer">查看使用说明 ↗</a>
            <button className="btn btn-primary" type="button" autoFocus onClick={dismissUpdateNotice}>知道了</button>
          </section>
        </div>
      )}

      <HomeWorkbench
        teacherName={teacherName} week={week} dateRange={`${formatDateShort(start)} – ${formatDateShort(end)}`}
        currentClass={activeHomeClass?.name || ''} tools={tools} moreTools={moreTools}
        tab={activeHomeDataTab} onTabChange={setHomeDataTab} showClassControl={showClassControl}
        onShowUpdates={() => setShowUpdateNotice(true)} onLogout={onLogout}
        onFeedback={() => window.dispatchEvent(new CustomEvent('superamber:open-feedback', { detail: { classCode: activeHomeClass?.name || '', screen: `welcome/${activeHomeDataTab}` } }))}
        sync={classes.length > 0 && (
        <section className={`home-sync${syncBusy ? ' is-syncing' : ''}`} aria-label="数据同步状态">
          <div className="home-sync-icon" aria-hidden="true">↻</div>
          <div className="home-sync-copy">
            <div className="home-sync-freshness"><span>当前快照生成于</span><strong>{snapshotGeneratedAt || '读取中…'}</strong></div>
            <strong>{batchFetchBusy ? `整批更新中 · ${classes.length} 个班` : reportRefresh.busy ? `当前日报同步中 · ${reportRefresh.classCode}` : batchFetchDone ? '数据已更新，可以直接使用' : '正在准备班级数据'}</strong>
            {syncBusy && <>
              <div className="home-sync-progress" role="progressbar" aria-label="数据更新进行中"><i /></div>
              <span className="home-sync-timing" role="status" aria-live="polite">已用 {syncElapsedSeconds} 秒 · {batchFetchBusy ? '整批通常约 20–30 秒' : '当前班级通常约 5–15 秒'}</span>
            </>}
            <span className="home-sync-summary">{reportRefresh.busy && !batchFetchBusy ? '正在核对当前日报的最新完成记录；等待期间可以继续查看已有内容。' : batchFetchStatus || '进入主页后会先显示已保存数据，并自动检查最新内容。'}</span>
            {!syncBusy && batchFetchDurationSeconds !== null && <span className="home-sync-last-duration">最近一次更新用时 {batchFetchDurationSeconds} 秒</span>}
            <details className="home-sync-details"><summary>同步内容与课表详情</summary>
            {snapshotLastCompleteAt && snapshotLastCompleteAt !== snapshotGeneratedAt && <small>上次全部成功：{snapshotLastCompleteAt}</small>}
            {scheduleImportStatus && <small>{scheduleImportStatus}</small>}</details>
          </div>
        <section className={`home-rotation ${rotationPanelState}`} aria-label="座位表周期与轮转">
          <div className="home-rotation-cycle"><span>本地座位表周期</span><strong>{currentSeatingWeek ? latestSeatingWeek !== currentSeatingWeek ? `W${currentSeatingWeek}–W${latestSeatingWeek}` : `Week ${currentSeatingWeek}` : '尚未设置'}</strong></div>
          <button type="button" className="home-rotation-generate" onClick={handleWeeklyRotation} disabled={!canRunWeeklyRotation || rotationBusy}>
            {rotationBusy ? '正在生成并保存…' : nextSeatingWeek ? `${isSeatingCatchUp ? '补生成' : '生成'} W${nextSeatingWeek} 座位表` : '生成下一周座位表'}
          </button>
          <small className="home-rotation-availability">{canRunWeeklyRotation ? `${isSeatingCatchUp ? '补齐已到周次' : '将生成'} Week ${nextSeatingWeek} · ${seatingClassCount} 个班级` : rotationUnavailableReason}</small>
          {isSeatingCatchUp && <small className="home-rotation-availability">本周为 W{week}，部分本地座位仍在 W{currentSeatingWeek}；点击补生成后保存，已到较新周次的座位不动。</small>}
          {latestSeatingWeek !== currentSeatingWeek && <small className="home-rotation-availability">各场次周次不一致，先补齐 W{currentSeatingWeek} 的场次。</small>}
          {pendingSeatingModes.length > 0 && <details className="home-rotation-pending"><summary>查看待生成场次（{pendingSeatingModes.length}）</summary><small>{pendingSeatingModes.map((item) => `${item.classCode} ${item.mode === 'weekday' ? '周中' : '周末'} · W${item.week}`).join('；')}</small></details>}
          {rotationMsg && <div className="home-rotation-status" role="status">{rotationMsg}</div>}
          <details className="home-rotation-details"><summary>轮转说明{canUndoWeeklyRotation ? '与撤回' : ''}</summary><p>{rotationDescription}</p>
            {canUndoWeeklyRotation && <button type="button" className="btn btn-ghost btn-sm" onClick={handleUndoRotation} disabled={rotationBusy}>撤回上次轮转</button>}
          </details>
        </section>

          <div className="home-sync-actions"><button className="btn btn-primary btn-sm" onClick={handleBatchFetchAll} disabled={syncBusy}>{batchFetchBusy ? `整批更新中 · ${syncElapsedSeconds}s` : reportRefresh.busy ? `日报同步中 · ${syncElapsedSeconds}s` : '更新全部班级数据'}</button></div>
        </section>
      )}
        version={versionInfo && (
              <div className={`home-version-card${versionStatus.hasUpdate ? ' is-stale' : ''}`}>
                <div className="home-version-top">
                  <span className="home-version-env">{versionInfo.environment || 'unknown'}</span>
                  <span className="home-version-value">{versionInfo.version || 'n/a'}</span>
                </div>
                <div className="home-version-meta">
                  <span>{versionInfo.commit || 'unknown'}</span>
                  <span>{formatDeploymentTime(versionInfo.deployedAt)}</span>
                </div>
                <button className="home-force-refresh" onClick={handleForceRefresh}>
                  强制刷新
                </button>
                {versionStatus.hasUpdate && (
                  <div className="home-version-refresh">
                    <div className="home-version-refresh-copy">
                      <strong>{versionStatus.refreshing ? '检测到新版本，正在刷新…' : '当前页面不是最新版本'}</strong>
                      <span>
                        当前 {versionStatus.currentFingerprint || 'unknown'} → 最新 {versionStatus.latestFingerprint || 'unknown'}
                      </span>
                    </div>
                    {!versionStatus.refreshing && (
                      <button className="btn btn-ghost btn-sm" onClick={handleVersionReload}>
                        {versionStatus.autoReloadBlocked ? '再试一次' : '立即刷新'}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
        todoCount={todoState.enabled ? todoState.pendingCount : null}
        todos={          <WelcomeTodoPanel
            classes={displayClasses}
            enabled={todoState.enabled}
            storageUnavailable={todoState.storageUnavailable}
            weeklyDone={todoState.weeklyDone}
            weeklyClass={todoState.weeklyClass}
            weeklyNote={todoState.weeklyNote}
            items={todoState.items}
            pendingCount={todoState.pendingCount}
            onEnabledChange={todoState.setEnabled}
            onWeeklyClassChange={todoState.setWeeklyClass}
            onWeeklyNoteChange={todoState.setWeeklyNote}
            onWeeklyConfirm={todoState.handleWeeklyConfirm}
            onToggleDone={(item) => todoState.toggleDone(item.key)}
            onOpenAction={handleTodoAction}
          />}>

        <div className="home-data-panels">
          {showClassControl && (
            <div hidden={activeHomeDataTab !== 'daily-report'}>
              <ClassDailyReportHome
                classes={displayClasses}
                teacherName={teacherName}
                preparedSnapshot={rosterSnapshot}
                activeClassCode={activeHomeClassCode}
                onActiveClassChange={setActiveHomeClassCode}
                onOpenDistribution={onOpenTaskDistribution}
                onAuthenticationRequired={handleAuthenticationRequired}
                onRefreshData={() => { void handleBatchFetchAll(); }}
                batchRefreshBusy={batchFetchBusy}
                batchRefreshElapsedSeconds={syncElapsedSeconds}
                refreshRevision={batchFetchRevision}
                onRefreshStateChange={handleReportRefreshStateChange}
              />
            </div>
          )}
          <div hidden={activeHomeDataTab !== 'speaking'}>
            <SpeakingChallengeApp
              classes={classes}
              teacherName={teacherName}
              activeClassCode={activeHomeClassCode}
              onActiveClassChange={setActiveHomeClassCode}
              onAuthenticationRequired={handleAuthenticationRequired}
            />
          </div>
          {showClassControl && (
            <div hidden={activeHomeDataTab !== 'overview'}>
              <ClassControlPanel
                key={teacherName}
                classes={displayClasses}
                teacherName={teacherName}
                preparedSnapshot={rosterSnapshot}
                autoRefreshPrepared={activeHomeDataTab === 'overview'}
                activeClassCode={activeHomeClassCode}
                onActiveClassChange={setActiveHomeClassCode}
                onOpenReport={(classInfo) => onOpenTodoTarget(classInfo, 'daily-report')}
                onAuthenticationRequired={handleAuthenticationRequired}
              />
            </div>
          )}
        </div>

        <details className="home-all-classes"><summary>全部班级与课表</summary>
          <div className="welcome-classes-area">
            {displayClasses.length > 0 ? (
              <>
                <div className="section-title">
                  <div className="view-toggle">
                    <button
                      className={`view-toggle-btn${view === 'byClass' ? ' active' : ''}`}
                      onClick={() => setView('byClass')}
                    >
                      按班级
                    </button>
                    <button
                      className={`view-toggle-btn${view === 'byDate' ? ' active' : ''}`}
                      onClick={() => setView('byDate')}
                    >
                      按日期
                    </button>
                  </div>
                  <div className="section-title-right">
                    <span className="section-count">{displayClasses.length} 个班级</span>
                  </div>
                </div>

                {showingLocalDrafts && (
                  <div className="empty-classes card" style={{ marginBottom: 14 }}>
                    <div className="empty-icon">🗂️</div>
                    <div className="empty-text">
                      <strong>教务班级暂时没拉回来，先显示本机已保存班级</strong>
                      <p>你之前录过的班级草稿还在，可以先直接点进班级继续用</p>
                    </div>
                  </div>
                )}

                {view === 'byClass' ? (
                  <div className="class-grid">
                    {[...classCards].sort((a, b) => (getClassDisplaySession(a.classInfo.name, [], new Date(), teacherName)?.minutesUntil ?? Infinity) - (getClassDisplaySession(b.classInfo.name, [], new Date(), teacherName)?.minutesUntil ?? Infinity) || a.classInfo.name.localeCompare(b.classInfo.name)).map(({ classInfo, days, studentCount }) => {
                      return (
                        <button
                          key={classInfo.id}
                          className={`class-card${activeHomeClass?.name.toUpperCase() === classInfo.name.toUpperCase() ? ' is-active' : ''}`}
                          aria-pressed={activeHomeClass?.name.toUpperCase() === classInfo.name.toUpperCase()}
                          onClick={() => setActiveHomeClassCode(classInfo.name.toUpperCase())}
                        >
                          <div className="class-code">{classInfo.name}</div>
                          {classInfo.relationship === 'co-head-teacher' && (
                            <div className="class-relationship">双班主任班级</div>
                          )}
                          {classInfo.relationship === 'manageable' && (
                            <div className="class-relationship">其他可管理班级</div>
                          )}
                          {days.length > 0 && (
                            <div className="class-days">{days.join(' · ')}</div>
                          )}
                          {studentCount > 0 && (
                            <div className="class-student-count">{studentCount}人</div>
                          )}
                          <div className="class-action">{activeHomeClass?.name.toUpperCase() === classInfo.name.toUpperCase() ? '当前班级 ✓' : '设为当前 →'}</div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="day-view">
                    {daySchedule.length > 0 ? (
                      daySchedule.map(({ day, classes: dayClasses }) => (
                        <div key={day} className="day-group">
                          <div className="day-group-label">{day}</div>
                          <div className="day-group-classes">
                            {dayClasses.map(({ classInfo, studentCount, time }) => {
                              return (
                                <button
                                  key={classInfo.id}
                                  className={`day-class-card${activeHomeClass?.name.toUpperCase() === classInfo.name.toUpperCase() ? ' is-active' : ''}`}
                                  aria-pressed={activeHomeClass?.name.toUpperCase() === classInfo.name.toUpperCase()}
                                  onClick={() => setActiveHomeClassCode(classInfo.name.toUpperCase())}
                                >
                                  <span className="day-class-code">{classInfo.name}</span>
                                  {time && <span className="day-class-time">{time}</span>}
                                  {studentCount > 0 && <span className="day-class-count">{studentCount}人</span>}
                                  <span className="day-class-action">→</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="empty-classes card">
                        <div className="empty-icon">📅</div>
                        <div className="empty-text">
                          <strong>当前班级还没有匹配到管理员课表</strong>
                          <p>时间地点现在统一由管理员维护，后续我这边更新内置课表后会自动生效</p>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : (
              <div className="empty-classes card">
                <div className="empty-icon">📂</div>
                <div className="empty-text">
                  <strong>未绑定教务系统</strong>
                  <p>班级号将在上传文件时自动从文件名中读取</p>
                </div>
                <button className="btn btn-primary" onClick={handleManualStart}>
                  直接开始 →
                </button>
              </div>
            )}
          </div>
        </details>

        <div className="guide-panel card">
          <button
            className="guide-toggle"
            onClick={toggleGuide}
          >
            <span className="guide-toggle-icon">📖</span>
            <span>使用说明</span>
            <span className="guide-toggle-arrow">{showGuide ? '▲' : '▼'}</span>
          </button>
          {showGuide && (
            <iframe
              src={guideSrc}
              className="guide-frame"
              title="使用说明"
              sandbox="allow-same-origin allow-scripts allow-forms allow-top-navigation-by-user-activation"
            />
          )}
        </div>


      </HomeWorkbench>
      {showReLogin && (
        <ReLoginModal
          defaultUsername={teacherName}
          onSuccess={handleReLoginSuccess}
          onDismiss={handleReLoginDismiss}
        />
      )}
    </>
  );
}
