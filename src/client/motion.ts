import { reducedMotion } from './dom';

// Numbers count up when they come into view. The real number is already in the HTML, so with no JS it's just there.
const seen = new WeakSet<HTMLElement>();

function run(element: HTMLElement): void {
  const end = Number(element.dataset.count);
  if (!end) return;
  const start = performance.now();
  const step = (time: number): void => {
    const k = Math.min(1, (time - start) / 700);
    element.textContent = String(Math.round(end * (1 - (1 - k) ** 3)));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export function countUp(): void {
  if (reducedMotion()) return;
  const watcher = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      watcher.unobserve(entry.target);
      run(entry.target as HTMLElement);
    }
  }, { threshold: 0.6 });
  for (const element of document.querySelectorAll<HTMLElement>('[data-count]')) {
    if (seen.has(element)) continue;
    seen.add(element);
    watcher.observe(element);
  }
}
