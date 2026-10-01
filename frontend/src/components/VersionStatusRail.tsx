import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { VersionInfo } from '../services/versionInfo';

const POSITION_KEY = 'amber_version_status_position';

interface Props {
  versionInfo: VersionInfo | null;
  currentFingerprint: string;
  hasUpdate: boolean;
  latestFingerprint?: string;
  refreshing?: boolean;
  autoReloadBlocked?: boolean;
  onReload?: () => void;
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

function loadSavedPosition() {
  if (typeof window === 'undefined') {
    return { x: 0, y: 0 };
  }
  try {
    const raw = window.localStorage.getItem(POSITION_KEY);
    if (!raw) {
      return { x: 0, y: 0 };
    }
    const parsed = JSON.parse(raw) as { x?: number; y?: number };
    return {
      x: Number.isFinite(parsed?.x) ? Number(parsed.x) : 0,
      y: Number.isFinite(parsed?.y) ? Number(parsed.y) : 0,
    };
  } catch {
    return { x: 0, y: 0 };
  }
}

export default function VersionStatusRail({
  versionInfo,
  currentFingerprint,
  hasUpdate,
  latestFingerprint = '',
  refreshing = false,
  autoReloadBlocked = false,
  onReload,
}: Props) {
  if (!versionInfo) {
    return null;
  }

  const [collapsed, setCollapsed] = useState(true);
  const [position, setPosition] = useState(loadSavedPosition);
  const positionRef = useRef(position);

  useEffect(() => {
    positionRef.current = position;
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(POSITION_KEY, JSON.stringify(position));
    }
  }, [position]);

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest('button')) {
      return;
    }
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const base = positionRef.current;

    const onMove = (moveEvent: PointerEvent) => {
      setPosition({
        x: base.x + (moveEvent.clientX - startX),
        y: base.y + (moveEvent.clientY - startY),
      });
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  return (
    <div
      className={`version-status-rail${hasUpdate ? ' is-stale' : ''}${collapsed ? ' is-collapsed' : ''}`}
      style={{ transform: `translate(${position.x}px, ${position.y}px)` }}
    >
      <div className="version-status-rail-head" onPointerDown={handlePointerDown}>
        <span className="version-status-drag" aria-hidden="true">⋮⋮</span>
        <div className="version-status-pill-copy">
          <div className="version-status-rail-top">
            <span className="version-status-env">{versionInfo.environment || 'unknown'}</span>
            <span className="version-status-version">{versionInfo.version || 'n/a'}</span>
          </div>
          <div className="version-status-summary">
            {hasUpdate ? '有新版本可刷新' : formatDeploymentTime(versionInfo.deployedAt)}
          </div>
        </div>
        {hasUpdate && <span className="version-status-alert">NEW</span>}
        <button
          className="version-status-toggle"
          type="button"
          onClick={() => setCollapsed((value) => !value)}
        >
          {collapsed ? '展开' : '收起'}
        </button>
      </div>
      {!collapsed && (
        <div className="version-status-rail-body">
          <div className="version-status-meta">
            <span>{versionInfo.commit || 'unknown'}</span>
            <span>{formatDeploymentTime(versionInfo.deployedAt)}</span>
          </div>
          <div className="version-status-fingerprint">{currentFingerprint || versionInfo.fingerprint}</div>
          <div className="version-status-state">
            {hasUpdate ? (refreshing ? '检测到新版本，正在刷新…' : '检测到新版本，返回页面时会自动刷新') : '当前标签页版本已对齐'}
          </div>
          {hasUpdate && (
            <div className="version-status-state">
              {`当前 ${currentFingerprint || 'unknown'} → 最新 ${latestFingerprint || versionInfo.version || 'unknown'}`}
            </div>
          )}
          {hasUpdate && !refreshing && onReload && (
            <button className="btn btn-ghost btn-sm" onClick={onReload}>
              {autoReloadBlocked ? '手动刷新' : '立即刷新'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
