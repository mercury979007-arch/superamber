import type { AppScreen, ClassInfo } from '../types';
import { getCurrentWeek } from '../utils/weekNumber';
import { getClassDays } from '../utils/classSchedule';
import { getStudentCount, hasSeatingData } from '../utils/classProfiles';
import { getFeatureCapability, isFeatureEnabled } from '../services/featureRegistry';
import { useVersionStatus } from '../hooks/useVersionStatus';
import './ClassHub.css';

interface Props {
  classInfo: ClassInfo;
  classes?: ClassInfo[];
  onNavigate: (target: AppScreen) => void;
  onBack: () => void;
  onSwitchClass?: (name: string) => void;
}

interface FeatureItem {
  icon: string;
  title: string;
  desc: string;
  target: AppScreen;
}

const FEATURES: FeatureItem[] = [
  { icon: '🪑', title: '座位表',       desc: '查看座位、名单、上课时间；图片识别后先在这里确认', target: 'seating' },
  { icon: '📗', title: '班级公示',     desc: '上传两份 Excel，直接生成公示表或明细版',   target: 'daily-report' },
  { icon: '🏆', title: 'MP积分管理',   desc: 'MP 发放、回收、计算与导出',            target: 'flow' },
  { icon: '📋', title: '课程概览',     desc: '简报制作，模块拼接导出',                target: 'overview' },
  { icon: '🤦🏻', title: '测试成绩录入', desc: '按名单或按分组快速录分，直接回写教务测试待办', target: 'test-score-entry' },
  { icon: '🧾', title: '班级名单检查', desc: '把学号、中文名、英文名一次性整理好，后面会更省事', target: 'roster' },
];

const HIDDEN_TOOL_TARGETS = new Set<AppScreen>(['roster']);

export default function ClassHub({ classInfo, classes, onNavigate, onBack, onSwitchClass }: Props) {
  const { versionInfo } = useVersionStatus();
  const week = getCurrentWeek();
  const displayName = classInfo.id === 'manual'
    ? (classInfo.name === '手动输入' ? '手动模式' : classInfo.name)
    : classInfo.name;

  const days = getClassDays(classInfo.name);
  const studentCount = getStudentCount(classInfo.name);
  const hasSeating = hasSeatingData(classInfo.name);

  function handleCard(item: FeatureItem) {
    onNavigate(item.target);
  }

  return (
    <div className="hub-wrap fade-in">
      <button className="tool-home-rail" onClick={onBack}>
        <span className="tool-home-rail-icon">←</span>
        <span>返回主页</span>
      </button>

      <div className="hub-topbar">
        <div className="hub-class-tag">
          {classes && classes.length > 1 && onSwitchClass ? (
            <select
              className="tool-class-switch"
              value={classInfo.name}
              onChange={(e) => onSwitchClass(e.target.value)}
            >
              {classes.map((c) => (
                <option key={c.id} value={c.name}>{c.name}</option>
              ))}
            </select>
          ) : (
            <span className="hub-class-code">{displayName}</span>
          )}
          <span className="hub-week">W{week}</span>
        </div>
      </div>

      {(days.length > 0 || studentCount > 0 || hasSeating) && (
        <div className="hub-class-meta">
          {days.length > 0 && (
            <span className="hub-meta-item">📅 {days.join(' · ')}</span>
          )}
          {studentCount > 0 && (
            <span className="hub-meta-item">👥 {studentCount}人</span>
          )}
          {hasSeating && (
            <span className="hub-meta-item">🪑 座位表已录入</span>
          )}
        </div>
      )}

      <div className="hub-grid">
        {FEATURES
          .filter((f) => !HIDDEN_TOOL_TARGETS.has(f.target))
          .filter((f) => isFeatureEnabled(f.target, versionInfo))
          .map((f) => (
          <button
            key={f.title}
            className="hub-card"
            onClick={() => handleCard(f)}
          >
            <div className="hub-card-icon">{f.icon}</div>
            <div className="hub-card-title">
              <span>{f.title}</span>
              {getFeatureCapability(f.target).badge && <span className="hub-test-badge">【{getFeatureCapability(f.target).badge}】</span>}
            </div>
            <div className="hub-card-desc">{f.desc}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
