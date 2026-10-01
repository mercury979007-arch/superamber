type LoginPerfMark = {
  name: string;
  at: number;
  sinceStartMs: number;
  data?: unknown;
};

type LoginPerfState = {
  runId: string;
  baseAt: number;
  marks: LoginPerfMark[];
};

declare global {
  interface Window {
    __amberLoginPerf?: LoginPerfState;
  }
}

function getState() {
  if (typeof window === 'undefined') return null;
  return window.__amberLoginPerf || null;
}

export function beginLoginPerf(data?: unknown) {
  if (typeof window === 'undefined') return undefined;
  const state: LoginPerfState = {
    runId: `login-${Date.now()}`,
    baseAt: performance.now(),
    marks: [],
  };
  window.__amberLoginPerf = state;
  markLoginPerf('submit_clicked', data);
  return state.runId;
}

export function markLoginPerf(name: string, data?: unknown) {
  const state = getState();
  if (!state) return;
  const at = performance.now();
  const mark: LoginPerfMark = {
    name,
    at,
    sinceStartMs: Number((at - state.baseAt).toFixed(1)),
    ...(typeof data === 'undefined' ? {} : { data }),
  };
  state.marks.push(mark);
  console.log('[login-perf-mark]', JSON.stringify(mark));
}

export function flushLoginPerf(finalStage: string, data?: unknown) {
  const state = getState();
  if (!state) return;

  markLoginPerf(finalStage, data);
  const marks = state.marks;
  const byName = Object.fromEntries(marks.map((mark) => [mark.name, mark.sinceStartMs]));
  const between = (start: string, end: string) => {
    if (typeof byName[start] !== 'number' || typeof byName[end] !== 'number') return null;
    return Number((byName[end] - byName[start]).toFixed(1));
  };

  const summary = {
    runId: state.runId,
    totalMs: byName[finalStage] ?? null,
    requestMs: between('request_started', 'response_received'),
    responseParseMs: between('response_received', 'response_parsed'),
    handoffMs: between('handoff_to_app', 'app_handle_login'),
    renderMs: between('app_handle_login', 'welcome_interactive'),
    marks,
  };

  console.log('[login-perf-summary]', JSON.stringify(summary));

  const payload = JSON.stringify({
    traceId: state.runId,
    location: window.location.href,
    userAgent: navigator.userAgent,
    ...summary,
  });
  void fetch('/api/traces/login-client', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
    keepalive: true,
  }).catch(() => {});

  if (typeof window !== 'undefined') {
    delete window.__amberLoginPerf;
  }
}

export {};
