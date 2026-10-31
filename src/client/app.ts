import { startRefresh } from './refresh';

const pad = (n: number): string => String(n).padStart(2, '0');

function tickClocks(): void {
  const now = Date.now();
  for (const el of document.querySelectorAll<HTMLElement>('[data-countdown]')) {
    const total = Math.max(0, Math.floor((Number(el.dataset.countdown) - now) / 1000));
    el.textContent = `${pad(Math.floor(total / 3600))}:${pad(Math.floor(total / 60) % 60)}:${pad(total % 60)}`;
  }
  for (const el of document.querySelectorAll<HTMLElement>('[data-elapsed]')) {
    const total = Math.max(0, Math.floor((now - Number(el.dataset.elapsed)) / 1000));
    el.textContent = `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
  }
}

document.addEventListener('click', (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>('[data-copy], [data-copy-from]');
  if (!target) return;
  const from = target.dataset.copyFrom;
  const text = from ? (document.getElementById(from) as HTMLTextAreaElement | null)?.value : target.dataset.copy;
  if (!text) return;
  void navigator.clipboard.writeText(text).then(() => {
    const before = target.textContent;
    target.textContent = 'Copied';
    setTimeout(() => { target.textContent = before; }, 1500);
  });
});

const hooks: (() => void)[] = [tickClocks];

async function boot(): Promise<void> {
  // For recording a video. It changes no data and only puts a label on the screen.
  if (new URLSearchParams(location.search).get('demo') === '1') document.body.dataset.demo = '1';
  tickClocks();
  setInterval(tickClocks, 1000);
  const page = document.body.dataset.page;

  if (document.getElementById('stage-art')) void import('./stage').then((m) => { m.startStage(); hooks.push(m.syncStage); });
  if (document.querySelector('[data-count]')) void import('./motion').then((m) => { m.countUp(); hooks.push(m.countUp); });
  if (document.getElementById('scene')) void import('./scene').then((m) => { m.startScene(); hooks.push(m.syncScene); });
  if (page === 'board') {
    const m = await import('./board');
    await m.startBoard();
    hooks.push(m.afterSwap);
  }
  if (page === 'play') void import('./play').then((m) => m.startPlay());
  if (page === 'practice' || page === 'break') void import('./practice').then((m) => m.startPractice());
  if (page === 'shift') void import('./shift').then((m) => m.startShift());
  if (page === 'proof' && document.getElementById('sandbox-start')) void import('./sandbox').then((m) => m.startSandbox());
  if (document.getElementById('notify')) void import('./notify').then((m) => m.startNotify());
  void import('./sound').then((m) => m.startSound());

  startRefresh(Number(document.body.dataset.refresh ?? 0), () => hooks.forEach((hook) => hook()));
}

void boot();
