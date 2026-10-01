import UserFeedback from './components/UserFeedback';
import { useState, useEffect, useCallback, lazy, Suspense, startTransition } from 'react';
const NewestSeatingFrame = lazy(() => import('./components/NewestSeatingFrame'));
import { flushLoginPerf, markLoginPerf } from './utils/loginPerf';
import { inferModuleFromScreen, trackUsageEvent } from './utils/usageTracking';
import Login from './components/Login';
import { isFeatureEnabled } from './services/featureRegistry';

function lazyWithReload<T extends { default: React.ComponentType<any> }>(
  loader: () => Promise<T>,
) {
  return lazy(async () => {
    try {
      const mod = await loader();
      if (typeof window !== 'undefined') {
        sessionStorage.removeItem('amber_lazy_reload_once');
      }
      return mod;
    } catch (error) {
      if (typeof window !== 'undefined') {
        const message = error instanceof Error ? error.message : String(error);
        const isChunkLoadError =
          /Failed to fetch dynamically imported module/i.test(message)
          || /Importing a module script failed/i.test(message)
          || /ChunkLoadError/i.test(message);

        if (isChunkLoadError && !sessionStorage.getItem('amber_lazy_reload_once')) {
          sessionStorage.setItem('amber_lazy_reload_once', '1');
          window.location.reload();
          return await new Promise<T>(() => {});
        }
      }
      throw error;
    }
  });
}

const OverviewApp = lazyWithReload(() => import('./components/OverviewApp'));
const CommunicationPlannerApp = lazyWithReload(() => import('./components/CommunicationPlannerApp'));
const ClassRosterApp = lazyWithReload(() => import('./components/ClassRosterApp'));
const DataReviewApp = lazyWithReload(() => import('./components/DataReviewApp'));
const DistributionFlow = lazyWithReload(() => import('./components/DistributionFlow'));
const MakeupTool = lazyWithReload(() => import('./components/MakeupTool'));
const CampReportApp = lazyWithReload(() => import('./components/CampReportApp'));
const CampScheduleApp = lazyWithReload(() => import('./components/CampScheduleApp'));
const DailyReportApp = lazyWithReload(() => import('./components/DailyReportApp'));
const ClassroomAgentApp = lazyWithReload(() => import('./components/ClassroomAgentApp'));
const TestScoreEntryApp = lazyWithReload(() => import('./components/TestScoreEntryApp'));
const UsageInsightsApp = lazyWithReload(() => import('./components/UsageInsightsApp'));
const SummerCampPortal = lazyWithReload(() => import('./components/SummerCampPortal'));
const Welcome = lazyWithReload(() => import('./components/Welcome'));
const ClassHub = lazyWithReload(() => import('./components/ClassHub'));
const ReLoginModal = lazyWithReload(() => import('./components/ReLoginModal'));
import type { AppScreen, ClassInfo } from './types';
import { saveAppState, loadAppState, saveAppCacheValue } from './utils/appPersistence';
import { saveSummerCampLaunchPreference } from './utils/campReportStorage';
import type { CampMajorLevel } from './data/campReportCatalog';
import VersionStatusRail from './components/VersionStatusRail';
import { useVersionStatus } from './hooks/useVersionStatus';
import { resolveAuthenticatedLanding } from './services/authenticatedLanding';

function ScreenLoading() {
  return <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>加载中...</div>;
}

function BootScreen() {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'linear-gradient(180deg, #fffaf2, #fff)',
      padding: 24,
      boxSizing: 'border-box',
    }}>
      <div style={{
        width: 'min(440px, 100%)',
        border: '1px solid rgba(221,217,208,0.7)',
        borderRadius: 20,
        background: '#fff',
        boxShadow: '0 16px 40px rgba(0,0,0,0.05)',
        padding: 28,
        textAlign: 'center',
      }}>
        <div style={{ fontSize: 34, marginBottom: 8 }}>🌿</div>
        <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 6 }}>Super Amber is here!</div>
        <div style={{ color: '#777', fontSize: 14 }}>正在载入页面...</div>
      </div>
    </div>
  );
}

function normalizeClasses(raw: unknown): ClassInfo[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.reduce<ClassInfo[]>((list, item) => {
    if (!item || typeof item !== 'object') {
      return list;
    }

    const data = item as Partial<ClassInfo>;
    const name = String(data.name || '').trim();
    if (!name) {
      return list;
    }

    const normalized: ClassInfo = {
      id: String(data.id || name),
      name,
    };

    if (typeof data.squadId === 'string' && data.squadId.trim()) {
      normalized.squadId = data.squadId;
    }
    if (data.relationship === 'current-head-teacher' || data.relationship === 'co-head-teacher' || data.relationship === 'manageable') {
      normalized.relationship = data.relationship;
    }
    if (Array.isArray(data.sources)) {
      normalized.sources = data.sources.map(String).filter(Boolean);
    }
    if (data.type === 'offline' || data.type === 'online') {
      normalized.type = data.type;
    }

    list.push(normalized);
    return list;
  }, []);
}

const CLASS_LIST_REFRESH_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

function shouldForceWeeklyClassRefresh(): boolean {
  try {
    const lastRefresh = Number(localStorage.getItem('amber_class_list_refreshed_at') || 0);
    return !Number.isFinite(lastRefresh) || lastRefresh <= 0 || Date.now() - lastRefresh >= CLASS_LIST_REFRESH_INTERVAL_MS;
  } catch {
    return false;
  }
}

function markClassListRefreshed(): void {
  saveAppCacheValue('amber_class_list_refreshed_at', String(Date.now()));
}

const WARMABLE_FEATURE_LOADERS = {
  roster: () => import('./components/ClassRosterApp'),
  'data-review': () => import('./components/DataReviewApp'),
  flow: () => import('./components/DistributionFlow'),
  'daily-report': () => import('./components/DailyReportApp'),
  'camp-report': () => import('./components/CampReportApp'),
  'camp-schedule': () => import('./components/CampScheduleApp'),
  overview: () => import('./components/OverviewApp'),
  seating: () => import('./components/NewestSeatingFrame'),
} as const;
const WARMABLE_FEATURE_SCREENS = Object.keys(WARMABLE_FEATURE_LOADERS) as Array<keyof typeof WARMABLE_FEATURE_LOADERS>;

function warmFeatureModules(versionInfo: ReturnType<typeof useVersionStatus>['versionInfo']) {
  const screens = WARMABLE_FEATURE_SCREENS.filter((screen) => isFeatureEnabled(screen, versionInfo));
  return Promise.all(screens.map((screen) => WARMABLE_FEATURE_LOADERS[screen]()));
}

function shouldWarmFeatureModules() {
  if (typeof navigator === 'undefined') {
    return true;
  }

  const connection = (navigator as Navigator & {
    connection?: { saveData?: boolean; effectiveType?: string };
  }).connection;
  if (connection?.saveData) {
    return false;
  }

  const effectiveType = String(connection?.effectiveType || '').toLowerCase();
  return effectiveType !== 'slow-2g' && effectiveType !== '2g';
}

function scheduleBackgroundWarmup(task: () => void, timeoutMs: number) {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const idleWindow = window as Window & {
    requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
    cancelIdleCallback?: (id: number) => void;
  };

  if (typeof idleWindow.requestIdleCallback === 'function') {
    const idleId = idleWindow.requestIdleCallback(task, { timeout: timeoutMs });
    return () => idleWindow.cancelIdleCallback?.(idleId);
  }

  const timerId = window.setTimeout(task, timeoutMs);
  return () => window.clearTimeout(timerId);
}

function getRequestedStandaloneScreen(): AppScreen | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const url = new URL(window.location.href);
  const normalizedPath = url.pathname.replace(/\/+$/, '') || '/';
  const requested =
    url.searchParams.get('screen')
    || url.searchParams.get('tool')
    || url.hash.replace(/^#\/?/, '');

  if (normalizedPath === '/classroom-agent' || requested === 'classroom-agent') {
    return 'classroom-agent';
  }
  if (normalizedPath === '/camp-report' || requested === 'camp-report') {
    return 'camp-report';
  }

  if (
    normalizedPath === '/summer-camp/report'
    || normalizedPath === '/camp/report'
    || requested === 'summer-camp/report'
    || requested === 'camp/report'
  ) {
    return 'camp-report';
  }

  if (
    normalizedPath === '/summer-camp/seating'
    || normalizedPath === '/camp/seating'
    || normalizedPath === '/seating'
    || normalizedPath === '/class-seating'
    || requested === 'summer-camp/seating'
    || requested === 'camp/seating'
    || requested === 'seating'
    || requested === 'class-seating'
  ) {
    return 'seating';
  }

  if (
    normalizedPath === '/summer-camp/schedule'
    || normalizedPath === '/camp/schedule'
    || requested === 'summer-camp/schedule'
    || requested === 'camp/schedule'
  ) {
    return 'camp-schedule';
  }

  if (
    normalizedPath === '/summer-camp'
    || normalizedPath === '/camp'
    || requested === 'summer-camp'
    || requested === 'camp'
  ) {
    return 'summer-camp';
  }

  return null;
}

function isRequestedSummerCampContext(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  const url = new URL(window.location.href);
  const normalizedPath = url.pathname.replace(/\/+$/, '') || '/';
  const requested =
    url.searchParams.get('screen')
    || url.searchParams.get('tool')
    || url.hash.replace(/^#\/?/, '');

  return (
    normalizedPath === '/summer-camp'
    || normalizedPath.startsWith('/summer-camp/')
    || normalizedPath === '/camp'
    || normalizedPath.startsWith('/camp/')
    || normalizedPath === '/seating'
    || normalizedPath === '/class-seating'
    || requested === 'summer-camp'
    || requested === 'camp'
    || requested.startsWith('summer-camp/')
    || requested.startsWith('camp/')
  );
}

const SUMMER_CAMP_CLASS: ClassInfo = {
  id: 'summer-camp-l2',
  name: 'Sparkchat Camp',
};

function getRestoreCampClass(): ClassInfo | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    const raw = new URL(window.location.href).searchParams.get('restoreCamp')?.trim() || '';
    const campNo = raw.match(/\d+/)?.[0] || '';
    return campNo ? { id: `summer-camp-l2-camp-${campNo}`, name: `L2第一期-营${campNo}` } : null;
  } catch {
    return null;
  }
}

type ActiveSite = 'standard' | 'summer-camp';
type SummerCampOpenReportOptions = {
  majorCamp?: CampMajorLevel;
  minorCamp?: string;
  reportDate?: string;
};

function getSummerCampPathForScreen(screen: AppScreen): string | null {
  if (screen === 'camp-report') return '/summer-camp/report';
  if (screen === 'camp-schedule') return '/summer-camp/schedule';
  if (screen === 'seating') return '/summer-camp/seating';
  if (screen === 'summer-camp') return '/summer-camp';
  return null;
}

function updateBrowserPath(path: string, mode: 'push' | 'replace' = 'push') {
  if (typeof window === 'undefined') return;
  if (window.location.protocol === 'file:') {
    const nextHash = `#${path.replace(/^\/+/, '')}`;
    if (window.location.hash === nextHash) return;
    window.history.replaceState({}, '', `${window.location.pathname}${window.location.search}${nextHash}`);
    return;
  }
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (current === path) return;
  const method = mode === 'replace' ? 'replaceState' : 'pushState';
  window.history[method]({}, '', path);
}

export default function App() {
  const versionStatus = useVersionStatus();
  const versionInfo = versionStatus.versionInfo;
  const [standaloneScreen] = useState<AppScreen | null>(() => {
    const requestedScreen = getRequestedStandaloneScreen();
    return requestedScreen && isFeatureEnabled(requestedScreen, null) ? requestedScreen : null;
  });
  const [standaloneSummerCampContext] = useState<boolean>(() => isRequestedSummerCampContext());
  const [activeSite, setActiveSite] = useState<ActiveSite>(() => (
    standaloneSummerCampContext ? 'summer-camp' : 'standard'
  ));
  const [screen, setScreen] = useState<AppScreen>('login');
  const [teacherName, setTeacherName] = useState('');
  const [classes, setClasses] = useState<ClassInfo[]>([]);
  const [selectedClass, setSelectedClass] = useState<ClassInfo | null>(() => (
    standaloneSummerCampContext && standaloneScreen === 'seating' ? (getRestoreCampClass() || SUMMER_CAMP_CLASS) : null
  ));
  const [restored, setRestored] = useState(false);
  const [showReLogin, setShowReLogin] = useState(false);
  const [distributionTaskSelection, setDistributionTaskSelection] = useState<{
    classId: string;
    selectedWeekIds: string[];
    snapshotUpdatedAt: string;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const standaloneSelectedClass = standaloneSummerCampContext && standaloneScreen === 'seating'
      ? (getRestoreCampClass() || SUMMER_CAMP_CLASS)
      : null;

    const saved = loadAppState();
    const savedTeacherName = String(saved?.teacherName || '').trim();
    const savedClasses = normalizeClasses(saved?.classes || []);
    const restoreSavedState = () => {
      if (!savedTeacherName || savedClasses.length === 0) {
        return false;
      }

      setTeacherName(savedTeacherName);
      setClasses(savedClasses);
      const landing = resolveAuthenticatedLanding(standaloneScreen, standaloneSelectedClass);
      setSelectedClass(landing.selectedClass);
      setScreen(landing.screen);
      return true;
    };

    const restoredFromSavedState = restoreSavedState();
    if (!restoredFromSavedState && standaloneScreen && standaloneScreen !== 'classroom-agent') {
      setScreen(standaloneScreen);
    }
    setRestored(true);

    if (standaloneSummerCampContext) {
      setClasses(standaloneSelectedClass ? [standaloneSelectedClass] : []);
      if (standaloneSelectedClass) {
        setSelectedClass(standaloneSelectedClass);
      }
      return () => {
        cancelled = true;
      };
    }

    async function bootstrapSession() {
      const applyLiveClasses = (liveClasses: ClassInfo[], backendTeacherName = '') => {
        setClasses(liveClasses);
        if (backendTeacherName) {
          setTeacherName(backendTeacherName);
          saveAppCacheValue('amber_username', backendTeacherName);
        }
        const landing = resolveAuthenticatedLanding(standaloneScreen, standaloneSelectedClass);
        setSelectedClass(landing.selectedClass);
        setScreen(landing.screen);
      };

      if (savedTeacherName) {
        setTeacherName(savedTeacherName);
      }

      try {
        if (restoredFromSavedState) {
          const healthResp = await fetch('/api/health', {
            credentials: 'include',
            cache: 'no-store',
          });
          const healthData = await healthResp.json().catch(() => ({} as Record<string, unknown>));
          if (cancelled) {
            return;
          }
          if (!healthResp.ok || !healthData.loggedIn) {
            setClasses([]);
            setSelectedClass(standaloneSelectedClass);
            setScreen(standaloneScreen === 'classroom-agent' ? 'login' : (standaloneScreen || 'login'));
            return;
          }
          const backendTeacherName = String(healthData.username || '').trim();
          if (backendTeacherName) {
            setTeacherName(backendTeacherName);
            saveAppCacheValue('amber_username', backendTeacherName);
            const forceClassRefresh = shouldForceWeeklyClassRefresh();
            const classResp = await fetch('/api/scraper/get-classes', {
              method: 'POST',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ force: forceClassRefresh }),
            });
            const classData = await classResp.json().catch(() => ({} as Record<string, unknown>));
            if (cancelled) {
              return;
            }
            const liveClasses = normalizeClasses((classData as { data?: unknown }).data);
            if (classResp.ok && liveClasses.length > 0) {
              if (forceClassRefresh) markClassListRefreshed();
              applyLiveClasses(liveClasses, backendTeacherName);
            } else if (standaloneScreen === 'classroom-agent') {
              setClasses([]);
              setSelectedClass(null);
              setScreen('login');
            }
          }
          return;
        }

        const forceClassRefresh = shouldForceWeeklyClassRefresh();
        const classResp = await fetch('/api/scraper/get-classes', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ force: forceClassRefresh }),
        });
        const classData = await classResp.json().catch(() => ({} as Record<string, unknown>));

        if (cancelled) {
          return;
        }

        const liveClasses = normalizeClasses((classData as { data?: unknown }).data);
        if (classResp.ok && liveClasses.length > 0) {
          if (forceClassRefresh) markClassListRefreshed();
          const backendTeacherName = String((classData as { username?: unknown }).username || '').trim();
          applyLiveClasses(liveClasses, backendTeacherName);
          return;
        }

        if (classResp.status === 401) {
          setClasses([]);
          setSelectedClass(standaloneSelectedClass);
          setScreen(standaloneScreen === 'classroom-agent' ? 'login' : (standaloneScreen || 'login'));
          return;
        }

        const healthResp = await fetch('/api/health', {
          credentials: 'include',
          cache: 'no-store',
        });
        const healthData = await healthResp.json().catch(() => ({} as Record<string, unknown>));
        if (cancelled) {
          return;
        }
        const backendTeacherName = String(healthData.username || '').trim();
        if (backendTeacherName) {
          setTeacherName(backendTeacherName);
          saveAppCacheValue('amber_username', backendTeacherName);
        }
        if (!healthResp.ok || !healthData.loggedIn) {
          setClasses([]);
          setSelectedClass(standaloneSelectedClass);
          setScreen(standaloneScreen === 'classroom-agent' ? 'login' : (standaloneScreen || 'login'));
          return;
        }
      } catch {
        if (!cancelled && (!restoredFromSavedState || standaloneScreen === 'classroom-agent')) {
          setClasses([]);
          setSelectedClass(standaloneSelectedClass);
          setScreen(standaloneScreen === 'classroom-agent' ? 'login' : (standaloneScreen || 'login'));
        }
      }
    }

    void bootstrapSession();

    return () => {
      cancelled = true;
    };
  }, [standaloneScreen, standaloneSummerCampContext]);

  useEffect(() => {
    if (!standaloneSummerCampContext || screen !== 'seating' || selectedClass) {
      return;
    }
    setSelectedClass(getRestoreCampClass() || SUMMER_CAMP_CLASS);
  }, [screen, selectedClass, standaloneSummerCampContext]);

  useEffect(() => {
    if (!restored || activeSite !== 'summer-camp') return;
    const summerCampPath = getSummerCampPathForScreen(screen);
    if (!summerCampPath) return;
    updateBrowserPath(summerCampPath, 'replace');
  }, [activeSite, restored, screen]);

  useEffect(() => {
    if (!restored) return;
    if (screen !== 'welcome' && screen !== 'hub') return;
    if (!shouldWarmFeatureModules()) return;

    let cancelled = false;
    const cancelLightWarm = scheduleBackgroundWarmup(() => {
      if (cancelled) return;
      void warmFeatureModules(versionInfo).catch(() => {});
    }, 1200);

    const cancelHeavyWarm = scheduleBackgroundWarmup(() => {
      if (cancelled) return;
      if (document.visibilityState === 'hidden') return;
      void import('./components/MakeupTool').catch(() => {});
    }, 2800);

    return () => {
      cancelled = true;
      cancelLightWarm();
      cancelHeavyWarm();
    };
  }, [restored, screen, versionInfo]);

  // Persist state on changes (after initial restore)
  const persist = useCallback(() => {
    if (!restored) return;
    saveAppState({ screen, teacherName, classes, selectedClass });
  }, [screen, teacherName, classes, selectedClass, restored]);

  useEffect(() => { persist(); }, [persist]);

  useEffect(() => {
    if (!restored) return;
    const moduleName = inferModuleFromScreen(screen);
    if (!moduleName) return;
    void trackUsageEvent({
      event: 'screen_view',
      module: moduleName,
      screen,
      teacherName,
      className: selectedClass?.name || '',
    });
  }, [restored, screen, teacherName, selectedClass?.name]);

  useEffect(() => {
    if (isFeatureEnabled(screen, versionInfo)) return;
    startTransition(() => {
      setScreen(selectedClass ? 'hub' : 'welcome');
    });
  }, [screen, selectedClass, versionInfo]);

  function handleLogin(name: string, classList: ClassInfo[]) {
    markLoginPerf('app_handle_login', { classCount: classList.length });
    setTeacherName(name);
    setClasses(classList);
    setActiveSite('standard');
    setSelectedClass(null);
    if (standaloneScreen !== 'classroom-agent') {
      updateBrowserPath('/', 'replace');
    }
    startTransition(() => {
      setScreen(standaloneScreen === 'classroom-agent' ? 'classroom-agent' : 'welcome');
    });
  }

  useEffect(() => {
    if (screen !== 'welcome') return;

    markLoginPerf('welcome_state_committed', { classCount: classes.length });
    let raf1 = 0;
    let raf2 = 0;
    raf1 = window.requestAnimationFrame(() => {
      markLoginPerf('welcome_first_frame', { classCount: classes.length });
      raf2 = window.requestAnimationFrame(() => {
        flushLoginPerf('welcome_interactive', { classCount: classes.length });
      });
    });

    return () => {
      if (raf1) window.cancelAnimationFrame(raf1);
      if (raf2) window.cancelAnimationFrame(raf2);
    };
  }, [screen, classes.length]);

  function handleSelectClass(cls: ClassInfo) {
    setDistributionTaskSelection(null);
    void trackUsageEvent({
      event: 'select_class',
      module: 'class-hub',
      teacherName,
      className: cls.name,
      screen: 'hub',
    });
    startTransition(() => {
      setSelectedClass(cls);
      setScreen('hub');
    });
  }

  function handleNavigate(target: AppScreen) {
    if (!isFeatureEnabled(target, versionInfo)) {
      return;
    }
    setActiveSite(target === 'summer-camp' ? 'summer-camp' : 'standard');
    setDistributionTaskSelection(null);
    startTransition(() => {
      setScreen(target);
    });
  }

  function handleOpenTodoTarget(cls: ClassInfo, target: Extract<AppScreen, 'hub' | 'seating' | 'overview' | 'flow' | 'daily-report' | 'test-score-entry'>) {
    setDistributionTaskSelection(null);
    startTransition(() => {
      setSelectedClass(cls);
      setScreen(target);
    });
  }

  function handleOpenTaskDistribution(cls: ClassInfo, selectedWeekIds: string[], snapshotUpdatedAt: string) {
    setDistributionTaskSelection({
      classId: cls.name.toUpperCase(),
      selectedWeekIds: [...selectedWeekIds],
      snapshotUpdatedAt,
    });
    startTransition(() => {
      setSelectedClass(cls);
      setScreen('flow');
    });
  }

  function handleBackToHub() {
    startTransition(() => {
      setScreen('hub');
    });
  }

  function handleOpenCommunicationPlanner() {
    startTransition(() => {
      setScreen('communication-planner');
    });
  }

  function handleBackToOverview() {
    startTransition(() => {
      setScreen('overview');
    });
  }

  function handleBackToWelcome() {
    startTransition(() => {
      setActiveSite('standard');
      setSelectedClass(null);
      setScreen('welcome');
    });
  }

  function handleBackToSummerCampPortal() {
    startTransition(() => {
      updateBrowserPath('/summer-camp');
      setActiveSite('summer-camp');
      setSelectedClass(null);
      setScreen('summer-camp');
    });
  }

  function handleOpenSummerCampReport(options: SummerCampOpenReportOptions = {}) {
    if (options.majorCamp) {
      saveSummerCampLaunchPreference({
        majorCamp: options.majorCamp,
        minorCamp: options.minorCamp,
        reportDate: options.reportDate,
        lastTool: 'report',
      });
    }
    startTransition(() => {
      updateBrowserPath('/summer-camp/report');
      setActiveSite('summer-camp');
      setScreen('camp-report');
    });
  }

  function handleOpenSummerCampSeating() {
    startTransition(() => {
      updateBrowserPath('/summer-camp/seating');
      setActiveSite('summer-camp');
      setSelectedClass(SUMMER_CAMP_CLASS);
      setScreen('seating');
    });
  }

  async function handleLogout() {
    try {
      await fetch('/api/scraper/logout', {
        method: 'POST',
        credentials: 'include',
      });
    } finally {
      startTransition(() => {
        setActiveSite('standard');
        setTeacherName('');
        setClasses([]);
        setSelectedClass(null);
        setScreen('login');
      });
    }
  }

  function handleSessionExpired() {
    setShowReLogin(true);
  }

  function handleReLoginSuccess(newClasses: ClassInfo[]) {
    setShowReLogin(false);
    if (newClasses.length > 0) {
      setClasses(newClasses);
      // Update selectedClass in case squadId changed
      if (selectedClass) {
        const updated = newClasses.find((c) => c.name === selectedClass.name);
        if (updated) setSelectedClass(updated);
      }
    }
  }

  function handleSwitchClass(nextClassName: string) {
    const nextClass = classes.find((item) => item.name === nextClassName);
    if (!nextClass || nextClass.name === selectedClass?.name) {
      return;
    }

    startTransition(() => {
      setSelectedClass(nextClass);
    });
  }

  if (!restored) return null;

  const resolvedScreen = isFeatureEnabled(screen, versionInfo)
    ? screen
    : (isRequestedSummerCampContext() ? 'summer-camp' : (selectedClass ? 'hub' : 'welcome'));
  const isSummerCampContext = activeSite === 'summer-camp' || standaloneSummerCampContext;
  const isStandaloneSeatingContext = standaloneScreen === 'seating' && !isSummerCampContext;

  return (
    <Suspense fallback={<BootScreen />}>
      {versionStatus.shouldShow && resolvedScreen !== 'welcome' && resolvedScreen !== 'classroom-agent' && !isSummerCampContext && (
        <VersionStatusRail
          versionInfo={versionStatus.versionInfo}
          currentFingerprint={versionStatus.currentFingerprint}
          latestFingerprint={versionStatus.latestFingerprint}
          hasUpdate={versionStatus.hasUpdate}
          refreshing={versionStatus.refreshing}
          autoReloadBlocked={versionStatus.autoReloadBlocked}
          onReload={versionStatus.reloadToLatestVersion}
        />
      )}
      {resolvedScreen === 'login' && (
        <Login onLogin={handleLogin} />
      )}
      {resolvedScreen === 'welcome' && (
        <Welcome
          teacherName={teacherName}
          classes={classes}
          onSelectClass={handleSelectClass}
          onLogout={handleLogout}
          onSessionRestored={handleReLoginSuccess}
          onNavigate={handleNavigate}
          onOpenTodoTarget={handleOpenTodoTarget}
          onOpenTaskDistribution={handleOpenTaskDistribution}
        />
      )}
      {resolvedScreen === 'summer-camp' && (
        <Suspense fallback={<ScreenLoading />}>
          <SummerCampPortal
            onOpenReport={handleOpenSummerCampReport}
            onOpenSeating={handleOpenSummerCampSeating}
            onBack={standaloneScreen === 'summer-camp' ? undefined : handleBackToWelcome}
          />
        </Suspense>
      )}
      {resolvedScreen === 'roster' && (
        <Suspense fallback={<ScreenLoading />}>
          <ClassRosterApp
            key={`roster:${selectedClass?.name ?? 'none'}`}
            classInfo={selectedClass}
            knownClasses={classes}
            onBack={selectedClass ? handleBackToHub : handleBackToWelcome}
            onBackToHome={handleBackToWelcome}
            onSessionExpired={handleSessionExpired}
          />
        </Suspense>
      )}
      {resolvedScreen === 'data-review' && (
        <Suspense fallback={<ScreenLoading />}>
          <DataReviewApp
            classes={classes}
            teacherName={teacherName}
            onBack={handleBackToWelcome}
            onSessionExpired={handleSessionExpired}
          />
        </Suspense>
      )}
      {resolvedScreen === 'usage-insights' && (
        <Suspense fallback={<ScreenLoading />}>
          <UsageInsightsApp onBack={handleBackToWelcome} />
        </Suspense>
      )}
      {resolvedScreen === 'classroom-agent' && (
        <Suspense fallback={<ScreenLoading />}>
          <ClassroomAgentApp
            teacherName={teacherName}
            classes={classes}
            onBack={handleBackToWelcome}
          />
        </Suspense>
      )}
      {resolvedScreen === 'hub' && selectedClass && (
        <ClassHub
          classInfo={selectedClass}
          classes={classes}
          onNavigate={handleNavigate}
          onBack={handleBackToWelcome}
          onSwitchClass={handleSwitchClass}
        />
      )}
      {resolvedScreen === 'flow' && selectedClass && (
        <Suspense fallback={<ScreenLoading />}>
          <DistributionFlow
            key={`flow:${selectedClass.name}`}
            classInfo={selectedClass}
            classes={classes}
            initialTaskSelection={distributionTaskSelection?.classId === selectedClass.name.toUpperCase()
              ? distributionTaskSelection
              : null}
            onBack={handleBackToHub}
            onBackToHome={handleBackToWelcome}
            onSwitchClass={handleSwitchClass}
            onSessionExpired={handleSessionExpired}
          />
        </Suspense>
      )}
      {(selectedClass || isStandaloneSeatingContext) && resolvedScreen === 'seating' && (
        <Suspense fallback={<ScreenLoading />}>
          <NewestSeatingFrame
            classCode={selectedClass?.name || ''}
            classes={isSummerCampContext ? [SUMMER_CAMP_CLASS] : classes}
            onBack={isSummerCampContext ? handleBackToSummerCampPortal : handleBackToWelcome}
            onBackToHome={isSummerCampContext ? handleBackToSummerCampPortal : handleBackToWelcome}
            onSwitchClass={isSummerCampContext ? undefined : handleSwitchClass}
            siteMode={isSummerCampContext ? 'summer-camp' : 'standard'}
            active
          />
        </Suspense>
      )}
      {resolvedScreen === 'overview' && selectedClass && (
        <Suspense fallback={<ScreenLoading />}>
          <OverviewApp
            key={`overview:${selectedClass.name}`}
            classInfo={selectedClass}
            classes={classes}
            onBack={handleBackToHub}
            onBackToHome={handleBackToWelcome}
            onSwitchClass={handleSwitchClass}
            onOpenCommunicationPlanner={handleOpenCommunicationPlanner}
          />
        </Suspense>
      )}
      {resolvedScreen === 'communication-planner' && selectedClass && (
        <Suspense fallback={<ScreenLoading />}>
          <CommunicationPlannerApp
            key={`communication-planner:${selectedClass.name}`}
            classInfo={selectedClass}
            classes={classes}
            onBack={handleBackToOverview}
            onBackToHome={handleBackToWelcome}
            onSwitchClass={handleSwitchClass}
          />
        </Suspense>
      )}
      {resolvedScreen === 'makeup' && (
        <Suspense fallback={<ScreenLoading />}>
          <MakeupTool onBack={handleBackToWelcome} />
        </Suspense>
      )}
      {resolvedScreen === 'camp-report' && (
        <Suspense fallback={<ScreenLoading />}>
          <CampReportApp onBack={isSummerCampContext ? handleBackToSummerCampPortal : handleBackToWelcome} />
        </Suspense>
      )}
      {resolvedScreen === 'camp-schedule' && (
        <Suspense fallback={<ScreenLoading />}>
          <CampScheduleApp
            onBack={isSummerCampContext ? handleBackToSummerCampPortal : handleBackToWelcome}
            onOpenReport={handleOpenSummerCampReport}
            onOpenSeating={handleOpenSummerCampSeating}
          />
        </Suspense>
      )}
      {resolvedScreen === 'daily-report' && selectedClass && (
        <Suspense fallback={<ScreenLoading />}>
          <DailyReportApp
            key={`daily-report:${selectedClass.name}`}
            classInfo={selectedClass}
            classes={classes}
            onBack={handleBackToHub}
            onBackToHome={handleBackToWelcome}
            onSwitchClass={handleSwitchClass}
          />
        </Suspense>
      )}
      {resolvedScreen === 'test-score-entry' && selectedClass && (
        <Suspense fallback={<ScreenLoading />}>
          <TestScoreEntryApp
            key={`test-score-entry:${selectedClass.name}`}
            classInfo={selectedClass}
            classes={classes}
            onBack={handleBackToHub}
            onBackToHome={handleBackToWelcome}
            onSwitchClass={handleSwitchClass}
            onSessionExpired={handleSessionExpired}
          />
        </Suspense>
      )}
      {resolvedScreen !== 'login' && <UserFeedback screen={resolvedScreen} classCode={selectedClass?.name || ''} version={versionInfo?.commit || ''} />}
      {showReLogin && (
        <ReLoginModal
          defaultUsername={teacherName}
          onSuccess={handleReLoginSuccess}
          onDismiss={() => setShowReLogin(false)}
        />
      )}
    </Suspense>
  );
}
