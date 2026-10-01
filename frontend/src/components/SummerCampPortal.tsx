import { useEffect, useMemo, useState } from 'react';
import type { MouseEvent } from 'react';
import {
  loadCampReportThemeConfigs,
  loadSummerCampLaunchPreference,
  saveSummerCampLaunchPreference,
  type SummerCampLaunchPreference,
} from '../utils/campReportStorage';
import { buildCampThemeVars, CAMP_THEME_UPDATED_EVENT, resolveCampReportTheme } from '../utils/campReportTheme';
import {
  CAMP_MAJOR_OPTIONS,
  CAMP_MINOR_OPTIONS,
  getDefaultCampReportDate,
  resolveCampReportLaunchDate,
  type CampMajorLevel,
} from '../data/campReportCatalog';
import SummerCampThemeManager from './SummerCampThemeManager';
import './SummerCampPortal.css';

interface Props {
  onOpenReport: () => void;
  onOpenSeating: () => void;
  onBack?: () => void;
}

type NormalizedLaunchPreference = SummerCampLaunchPreference & {
  majorCamp: CampMajorLevel;
  minorCamp: string;
};

const CAMP_LAUNCH_META: Record<CampMajorLevel, {
  eyebrow: string;
  tagline: string;
  summary: string;
  chips: string[];
}> = {
  L0: {
    eyebrow: 'Voice Start Grid',
    tagline: 'Super Speak launch lane',
    summary: '更轻、更快、更敢开口的预热营区。',
    chips: ['Warm-up', 'Voice', 'Launch'],
  },
  'L1大': {
    eyebrow: 'Rocky Squad Rally',
    tagline: 'Big team social speedway',
    summary: '更热闹的社交冲线感，适合大队列切换。',
    chips: ['Social', 'Big Team', 'Rally'],
  },
  'L1小': {
    eyebrow: 'Chatty Team Launch',
    tagline: 'Small group sparkle lane',
    summary: '更灵巧的小队开聊感，节奏轻快但不乱。',
    chips: ['Chatty', 'Spark', 'Team'],
  },
  L2: {
    eyebrow: 'Sparkchat Speedway',
    tagline: 'Core flagship racing deck',
    summary: '今年最完整的主战场，保留原有绿黄赛车感。',
    chips: ['Flagship', 'Racing', 'Spark'],
  },
  L3: {
    eyebrow: 'Curiosity Pit Lane',
    tagline: 'Formula curiosity workshop',
    summary: '红蓝黄的实验感更强，适合做出“项目作品”的气质。',
    chips: ['Formula', 'Curiosity', 'Lab'],
  },
  L4: {
    eyebrow: 'Formula Writing Run',
    tagline: 'Precision writing circuit',
    summary: '更利落、更成熟，适合带出写作冲线感。',
    chips: ['Writing', 'Precision', 'Circuit'],
  },
  S: {
    eyebrow: 'Drama Spotlight Track',
    tagline: 'Stage-first spotlight arena',
    summary: '戏剧感和舞台感更足，适合把品牌做得更亮。',
    chips: ['Drama', 'Spotlight', 'Stage'],
  },
};

const DEFAULT_MAJOR_CAMP: CampMajorLevel = 'L2';
const DEFAULT_MINOR_CAMP = 'Camp 1';
const FALLBACK_CAMP_LOGO = '/assets/public-placeholder.svg';
const PORTAL_L2_LOGO = '/assets/public-placeholder.svg';

function isCampMajorLevel(value: string): value is CampMajorLevel {
  return CAMP_MAJOR_OPTIONS.some((item) => item.level === value);
}

function normalizeMinorCamp(value: string | undefined) {
  return value && CAMP_MINOR_OPTIONS.includes(value) ? value : DEFAULT_MINOR_CAMP;
}

function normalizeLaunchPreference(preference: SummerCampLaunchPreference | null): NormalizedLaunchPreference | null {
  if (!preference || !isCampMajorLevel(preference.majorCamp)) {
    return null;
  }
  return {
    ...preference,
    majorCamp: preference.majorCamp,
    minorCamp: normalizeMinorCamp(preference.minorCamp),
  };
}

function getPortalLogo(majorCamp: CampMajorLevel, themeLogo: string) {
  return majorCamp === 'L2' ? PORTAL_L2_LOGO : themeLogo || FALLBACK_CAMP_LOGO;
}

export default function SummerCampPortal({ onOpenReport, onOpenSeating, onBack }: Props) {
  const [themeConfigs, setThemeConfigs] = useState(() => loadCampReportThemeConfigs());
  const [lastLaunchPreference, setLastLaunchPreference] = useState(() => normalizeLaunchPreference(loadSummerCampLaunchPreference()));
  const [selectedMajor, setSelectedMajor] = useState<CampMajorLevel>(() => {
    const preferred = normalizeLaunchPreference(loadSummerCampLaunchPreference());
    return preferred ? preferred.majorCamp : DEFAULT_MAJOR_CAMP;
  });
  const [selectedMinor, setSelectedMinor] = useState(() => {
    const preferred = normalizeLaunchPreference(loadSummerCampLaunchPreference());
    return preferred ? preferred.minorCamp : DEFAULT_MINOR_CAMP;
  });

  const currentTheme = useMemo(() => resolveCampReportTheme(selectedMajor, themeConfigs), [selectedMajor, themeConfigs]);
  const themeVars = useMemo(() => buildCampThemeVars(currentTheme), [currentTheme]);
  const selectedOption = useMemo(
    () => CAMP_MAJOR_OPTIONS.find((item) => item.level === selectedMajor) || CAMP_MAJOR_OPTIONS[0],
    [selectedMajor],
  );
  const selectedMeta = CAMP_LAUNCH_META[selectedMajor];
  const selectedLogo = getPortalLogo(selectedMajor, currentTheme.logoImage);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = '2026 Summer Camp';
    return () => {
      document.title = previousTitle;
    };
  }, [selectedMajor]);

  useEffect(() => {
    const handlePortalRefresh = () => {
      setThemeConfigs(loadCampReportThemeConfigs());
      setLastLaunchPreference(normalizeLaunchPreference(loadSummerCampLaunchPreference()));
    };
    window.addEventListener(CAMP_THEME_UPDATED_EVENT, handlePortalRefresh);
    window.addEventListener('storage', handlePortalRefresh);
    return () => {
      window.removeEventListener(CAMP_THEME_UPDATED_EVENT, handlePortalRefresh);
      window.removeEventListener('storage', handlePortalRefresh);
    };
  }, []);

  const persistLaunchPreference = (
    tool: 'report' | 'seating',
    majorCamp = selectedMajor,
    minorCamp = selectedMinor,
  ) => {
    const normalizedMinor = normalizeMinorCamp(minorCamp);
    const keepPrevious = lastLaunchPreference?.majorCamp === majorCamp && lastLaunchPreference.minorCamp === normalizedMinor
      ? lastLaunchPreference
      : null;
    saveSummerCampLaunchPreference({
      majorCamp,
      minorCamp: normalizedMinor,
      reportDate: resolveCampReportLaunchDate(
        keepPrevious?.reportDate || getDefaultCampReportDate(majorCamp, normalizedMinor),
      ),
      lastTool: tool,
    });
    setLastLaunchPreference(normalizeLaunchPreference(loadSummerCampLaunchPreference()));
  };

  const openReport = (event?: MouseEvent<HTMLElement>, majorCamp = selectedMajor, minorCamp = selectedMinor) => {
    event?.preventDefault();
    persistLaunchPreference('report', majorCamp, minorCamp);
    onOpenReport();
  };

  const openSeating = (event?: MouseEvent<HTMLElement>, majorCamp = selectedMajor, minorCamp = selectedMinor) => {
    event?.preventDefault();
    persistLaunchPreference('seating', majorCamp, minorCamp);
    onOpenSeating();
  };

  const continueLastCamp = () => {
    if (!lastLaunchPreference || !isCampMajorLevel(lastLaunchPreference.majorCamp)) {
      return;
    }

    setSelectedMajor(lastLaunchPreference.majorCamp);
    setSelectedMinor(normalizeMinorCamp(lastLaunchPreference.minorCamp));
    if (lastLaunchPreference.lastTool === 'report') {
      openReport(undefined, lastLaunchPreference.majorCamp, lastLaunchPreference.minorCamp);
      return;
    }
    if (lastLaunchPreference.lastTool === 'seating') {
      openSeating(undefined, lastLaunchPreference.majorCamp, lastLaunchPreference.minorCamp);
      return;
    }
    openReport(undefined, lastLaunchPreference.majorCamp, lastLaunchPreference.minorCamp);
  };

  const lastToolLabel = lastLaunchPreference?.lastTool === 'seating'
    ? '座位表'
    : lastLaunchPreference?.lastTool === 'report'
      ? '日报'
      : '首页';

  return (
    <div className="summer-camp-wrap fade-in" style={themeVars}>
      {onBack && (
        <button className="tool-home-rail summer-camp-back" onClick={onBack}>
          <span className="tool-home-rail-icon">←</span>
          <span>返回主页</span>
        </button>
      )}

      <main className="summer-camp-shell">
        <section className="summer-camp-hero">
          <div className="summer-camp-hero-copy">
            <span className="summer-camp-kicker">夏令营入口</span>
            <h1>夏令营主控台</h1>
            {lastLaunchPreference && isCampMajorLevel(lastLaunchPreference.majorCamp) && (
              <button className="summer-camp-continue" onClick={continueLastCamp}>
                <span>继续上次</span>
                <strong>{CAMP_MAJOR_OPTIONS.find((item) => item.level === lastLaunchPreference.majorCamp)?.label || lastLaunchPreference.majorCamp} · {lastLaunchPreference.minorCamp}</strong>
                <small>{lastToolLabel}</small>
              </button>
            )}

            <div className="summer-camp-quick-select" aria-label="选择夏令营入口">
              <label>
                <span>大营号</span>
                <select value={selectedMajor} onChange={(event) => setSelectedMajor(event.target.value as CampMajorLevel)}>
                  {CAMP_MAJOR_OPTIONS.map((item) => (
                    <option key={item.level} value={item.level}>{item.label}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>小营号</span>
                <select value={selectedMinor} onChange={(event) => setSelectedMinor(normalizeMinorCamp(event.target.value))}>
                  {CAMP_MINOR_OPTIONS.map((item) => (
                    <option key={item} value={item}>{item}</option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          <div className="summer-camp-stage">
            <div className="summer-camp-stage-stripe summer-camp-stage-stripe-top" aria-hidden="true" />
            <div className="summer-camp-stage-stripe summer-camp-stage-stripe-bottom" aria-hidden="true" />
            <div className="summer-camp-stage-current">
              <img
                className="summer-camp-stage-logo"
                src={selectedLogo}
                alt={`${selectedOption.campName} logo`}
              />
              <div className="summer-camp-stage-copy-block">
                <span className="summer-camp-stage-code">{selectedOption.level}</span>
                <span className="summer-camp-stage-minor">{selectedMinor}</span>
                <strong>{selectedOption.campName}</strong>
                <p>{selectedMeta.summary}</p>
              </div>
            </div>
            <div className="summer-camp-stage-actions">
              <button className="summer-camp-stage-action primary" onClick={openReport}>
                <span>Report</span>
                <strong>进入日报</strong>
              </button>
              <button className="summer-camp-stage-action" onClick={openSeating}>
                <span>Seating</span>
                <strong>进入座位表</strong>
              </button>
            </div>
          </div>
        </section>

        <section className="summer-camp-selector" aria-label="选择大营">
          <div className="summer-camp-selector-head">
            <div>
              <span>Camp Select</span>
              <h2>选一个大营做今天的主场</h2>
            </div>
          </div>

          <div className="summer-camp-selector-grid">
            {CAMP_MAJOR_OPTIONS.map((item) => {
              const campTheme = resolveCampReportTheme(item.level, themeConfigs);
              const cardVars = buildCampThemeVars(campTheme);
              const meta = CAMP_LAUNCH_META[item.level];
              const selected = item.level === selectedMajor;
              const cardLogo = getPortalLogo(item.level, campTheme.logoImage);
              return (
                <button
                  key={item.level}
                  type="button"
                  className={`summer-camp-select-card${selected ? ' is-selected' : ''}`}
                  style={cardVars}
                  onClick={() => setSelectedMajor(item.level)}
                >
                  <span className="summer-camp-select-code">{item.level}</span>
                  <span className="summer-camp-select-logo-frame">
                    <img
                      className="summer-camp-select-logo"
                      src={cardLogo}
                      alt={`${item.campName} logo`}
                    />
                  </span>
                  <div className="summer-camp-select-copy">
                    <strong>{item.campName}</strong>
                    <small>{meta.tagline}</small>
                  </div>
                  <div className="summer-camp-select-tags">
                    {meta.chips.map((chip) => <span key={chip}>{chip}</span>)}
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <section className="summer-camp-config-wrap">
          <SummerCampThemeManager
            key={`theme-manager:${selectedMajor}`}
            defaultMajorCamp={selectedMajor}
            onThemeChange={() => setThemeConfigs(loadCampReportThemeConfigs())}
          />
        </section>
      </main>
    </div>
  );
}
