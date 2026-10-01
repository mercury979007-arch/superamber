// @vitest-environment jsdom
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { afterEach, expect, it, vi } from 'vitest';
import Login from './Login';

vi.mock('../utils/loginPerf', () => ({ beginLoginPerf: vi.fn(), flushLoginPerf: vi.fn(), markLoginPerf: vi.fn() }));
let root: Root | undefined;
afterEach(() => { root?.unmount(); document.body.innerHTML = ''; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('finishes a successful server login even when the username cache cannot be saved', async () => {
  localStorage.clear();
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ classes: [{ id: 'K218', name: 'K218' }] }) }));
  const onLogin = vi.fn();
  const container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  flushSync(() => root!.render(<Login onLogin={onLogin} />));
  for (const [placeholder, value] of [['请输入教务系统账号', 'Teacher'], ['请输入密码', 'test-only']]) {
    const input = document.querySelector<HTMLInputElement>(`input[placeholder="${placeholder}"]`)!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    flushSync(() => input.dispatchEvent(new Event('input', { bubbles: true })));
  }
  flushSync(() => document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  await vi.waitFor(() => expect(onLogin).toHaveBeenCalledWith('Teacher', [{ id: 'K218', name: 'K218' }]));
});
