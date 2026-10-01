import { useState } from 'react';
import type { ClassInfo } from '../types';
import './ReLoginModal.css';

interface Props {
  defaultUsername: string;
  onSuccess: (classes: ClassInfo[]) => void;
  onDismiss: () => void;
}

export default function ReLoginModal({ defaultUsername, onSuccess, onDismiss }: Props) {
  const [username, setUsername] = useState(defaultUsername);
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password.trim()) {
      setError('请填写账号和密码');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/scraper/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username: username.trim(), password: password.trim() }),
        signal: AbortSignal.timeout(40000),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data as { error?: string }).error || '登录失败');
      }
      const classes: ClassInfo[] = ((data as { classes?: ClassInfo[] }).classes || []).map((c) => ({
        id: c.id || c.name,
        name: c.name,
        squadId: c.squadId,
      }));
      onSuccess(classes);
    } catch (err) {
      setError(err instanceof Error ? err.message : '连接失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relogin-overlay" onClick={onDismiss}>
      <div className="relogin-modal card" onClick={(e) => e.stopPropagation()}>
        <div className="relogin-header">
          <h3>会话已过期</h3>
          <p>需要重新连接教务系统才能继续操作</p>
        </div>
        <form onSubmit={handleSubmit} className="relogin-form">
          <input
            className="input-field"
            type="text"
            placeholder="账号"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={loading}
            autoComplete="username"
          />
          <input
            className="input-field"
            type="password"
            placeholder="密码"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={loading}
            autoComplete="current-password"
            autoFocus
          />
          {error && <div className="relogin-error">{error}</div>}
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? <><span className="spinner" /> 连接中...</> : '重新连接'}
          </button>
        </form>
        <button className="relogin-dismiss" onClick={onDismiss}>取消</button>
      </div>
    </div>
  );
}
