// Reads only, against a local stack. Never point this at production.
const SITE = process.argv[2] ?? 'http://localhost:8788';
if (!/localhost|127\.0\.0\.1/.test(SITE)) throw new Error('local only');
const PATHS = ['/', '/board', '/api/state', '/api/board', '/live', '/status'];
const total = Number(process.argv[3] ?? 3000);
const concurrency = Number(process.argv[4] ?? 100);
const times = [];
let failed = 0;
let next = 0;
async function worker() {
  while (next < total) {
    const path = PATHS[next++ % PATHS.length];
    const started = performance.now();
    try {
      const response = await fetch(`${SITE}${path}`);
      await response.arrayBuffer();
      if (!response.ok) failed++;
    } catch {
      failed++;
    }
    times.push(performance.now() - started);
  }
}
const start = performance.now();
await Promise.all(Array.from({ length: concurrency }, worker));
const seconds = (performance.now() - start) / 1000;
times.sort((a, b) => a - b);
const at = (p) => Math.round(times[Math.floor(times.length * p)]);
console.log(`${total} reads, ${concurrency} at once: ${Math.round(total / seconds)}/s, p50 ${at(0.5)} ms, p95 ${at(0.95)} ms, p99 ${at(0.99)} ms, ${failed} failed`);
