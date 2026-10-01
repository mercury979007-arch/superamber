import { useEffect, useRef, useState } from 'react';
import type { ClassInfo } from '../types';
import './ClassroomAgentApp.css';

type Props = {
  teacherName: string;
  classes: ClassInfo[];
  onBack: () => void;
};

type DelegationResponse = {
  token?: string;
  username?: string;
  classCount?: number;
  error?: string;
};

export default function ClassroomAgentApp({ teacherName, classes, onBack }: Props) {
  const [frameSrc, setFrameSrc] = useState('');
  const [error, setError] = useState('');
  const frameRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const updateViewport = () => {
      const viewport = window.visualViewport;
      const height = Math.round(viewport?.height || window.innerHeight || document.documentElement.clientHeight);
      document.documentElement.style.setProperty('--classroom-agent-visual-height', `${height}px`);
    };
    updateViewport();
    window.addEventListener('resize', updateViewport);
    window.addEventListener('orientationchange', updateViewport);
    window.visualViewport?.addEventListener('resize', updateViewport);
    return () => {
      window.removeEventListener('resize', updateViewport);
      window.removeEventListener('orientationchange', updateViewport);
      window.visualViewport?.removeEventListener('resize', updateViewport);
      document.documentElement.style.removeProperty('--classroom-agent-visual-height');
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function delegateCurrentSession() {
      try {
        setError('');
        const response = await fetch('/api/classroom-agent/delegation', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        });
        const payload = await response.json().catch(() => ({} as DelegationResponse));
        if (!response.ok || !payload.token) {
          throw new Error(payload.error || '无法继承当前测试站登录状态。');
        }
        if (!cancelled) {
          setFrameSrc(`/classroom-agent/#delegate=${encodeURIComponent(payload.token)}`);
        }
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : '班级助理连接失败。');
        }
      }
    }
    void delegateCurrentSession();
    return () => { cancelled = true; };
  }, [classes.length, teacherName]);

  useEffect(() => {
    let refreshing = false;
    async function restoreAgentAuthorization(event: MessageEvent) {
      if (
        event.origin !== window.location.origin
        || event.source !== frameRef.current?.contentWindow
        || event.data?.type !== 'superamber-agent-auth-required'
        || refreshing
      ) return;
      refreshing = true;
      try {
        const response = await fetch('/api/classroom-agent/delegation', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        });
        const payload = await response.json().catch(() => ({} as DelegationResponse));
        if (!response.ok || !payload.token) throw new Error(payload.error || '无法恢复当前登录权限。');
        frameRef.current?.contentWindow?.postMessage({
          type: 'superamber-agent-delegation',
          token: payload.token,
        }, window.location.origin);
      } catch (cause) {
        frameRef.current?.contentWindow?.postMessage({
          type: 'superamber-agent-delegation-error',
          message: cause instanceof Error ? cause.message : '登录权限恢复失败。',
        }, window.location.origin);
      } finally {
        refreshing = false;
      }
    }
    window.addEventListener('message', restoreAgentAuthorization);
    return () => window.removeEventListener('message', restoreAgentAuthorization);
  }, []);

  if (error) {
    return (
      <main className="classroom-agent-shell is-error">
        <section>
          <strong>暂时无法连接 Amber</strong>
          <p>{error}</p>
          <button type="button" onClick={onBack}>返回 Super Amber</button>
        </section>
      </main>
    );
  }

  if (!frameSrc) {
    return (
      <main className="classroom-agent-shell is-loading" aria-live="polite">
        <section>
          <strong>Hello, {teacherName || 'Teacher'}.</strong>
          <p>Super Amber 已识别当前登录，正在核验 {classes.length} 个班级权限并连接 Amber…</p>
        </section>
      </main>
    );
  }

  return (
    <main className="classroom-agent-shell">
      <iframe
        ref={frameRef}
        className="classroom-agent-frame"
        src={frameSrc}
        title="Amber 班级助理"
        allow="clipboard-read; clipboard-write"
      />
    </main>
  );
}
