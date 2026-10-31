import { h, need } from './dom';

export function startSandbox(): void {
  const results = need('sandbox-results');
  const frame = need<HTMLIFrameElement>('sandbox-frame');
  need('sandbox-start').addEventListener('click', () => {
    results.replaceChildren(h('li', {}, h('span', {}, 'Running in your browser...')));
    frame.src = `/proof/sandbox-frame?run=${Date.now()}`;
  });
  window.addEventListener('message', (event) => {
    if (event.source !== frame.contentWindow) return;
    const data = event.data as { type?: unknown; report?: Record<string, string> };
    if (data?.type !== 'sandbox-report' || !data.report) return;
    results.replaceChildren(...Object.entries(data.report).map(([name, outcome]) => {
      const blocked = /^blocked/.test(String(outcome));
      return h('li', {}, h('span', {}, name), h('b', { class: blocked ? 'pass' : 'fail' }, blocked ? 'Blocked' : `Reached: ${String(outcome).slice(0, 40)}`));
    }));
  });
}
