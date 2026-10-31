import { ROBOT_COLORS, robotRows, type RobotState } from '../shared/robot';
import { ApiError, byId, need, post, reducedMotion, say } from './dom';
import { anySigner, signedBody } from './session';

function playBack(): void {
  const lines = [...need('replay').children] as HTMLElement[];
  if (reducedMotion()) return;
  lines.forEach((line) => { line.hidden = true; });
  lines.forEach((line, i) => setTimeout(() => { line.hidden = false; }, 400 + i * (6000 / Math.max(1, lines.length))));
}

const MOOD: Record<string, RobotState> = { shipped: 'celebrating', refused: 'refusing', failed: 'panicking', 'rolled-back': 'panicking' };

// Draws the shift into a vertical canvas and records it. It all happens in this browser.
async function saveClip(button: HTMLButtonElement): Promise<void> {
  const replay = need('replay');
  const lines = [...replay.children].map((li) => li.textContent ?? '');
  const canvas = document.createElement('canvas');
  canvas.width = 720;
  canvas.height = 1280;
  const ctx = canvas.getContext('2d');
  if (!ctx || typeof MediaRecorder === 'undefined') {
    button.textContent = 'Not supported here';
    return;
  }
  const rows = robotRows(MOOD[replay.dataset.status ?? ''] ?? 'working');
  const seconds = 10;
  const chunks: Blob[] = [];
  const recorder = new MediaRecorder(canvas.captureStream(30), { mimeType: MediaRecorder.isTypeSupported('video/webm') ? 'video/webm' : '' });
  recorder.ondataavailable = (event) => chunks.push(event.data);
  const done = new Promise<void>((resolve) => { recorder.onstop = () => resolve(); });
  recorder.start();
  button.disabled = true;
  const started = performance.now();
  const frame = (now: number): void => {
    const t = Math.min(1, (now - started) / (seconds * 1000));
    ctx.fillStyle = '#0b1020';
    ctx.fillRect(0, 0, 720, 1280);
    ctx.fillStyle = '#ff9a3c';
    ctx.font = '700 44px monospace';
    ctx.fillText(`AGENT INTERN · SHIFT ${replay.dataset.id ?? ''}`, 40, 90);
    ctx.fillStyle = '#f5ebd8';
    ctx.font = '30px monospace';
    (replay.dataset.task ?? '').match(/.{1,34}(\s|$)/g)?.slice(0, 4).forEach((line, i) => ctx.fillText(line.trim(), 40, 160 + i * 40));
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const color = ROBOT_COLORS[row[x] as string];
        if (color) { ctx.fillStyle = color; ctx.fillRect(220 + x * 14, 360 + y * 14, 14, 14); }
      }
    });
    ctx.font = '24px monospace';
    ctx.fillStyle = '#7cffb2';
    lines.slice(0, Math.ceil(lines.length * t)).slice(-10).forEach((line, i) => ctx.fillText(line.slice(0, 44), 40, 730 + i * 34));
    if (t < 1) requestAnimationFrame(frame);
    else recorder.stop();
  };
  requestAnimationFrame(frame);
  await done;
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob(chunks, { type: 'video/webm' }));
  link.download = `agent-intern-shift-${replay.dataset.id ?? ''}.webm`;
  link.click();
  button.disabled = false;
}

export function startShift(): void {
  byId('replay-play')?.addEventListener('click', playBack);
  const clip = byId<HTMLButtonElement>('replay-clip');
  clip?.addEventListener('click', () => void saveClip(clip));

  const review = byId('review');
  if (!review) return;
  const message = byId('review-message');
  review.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>('[data-stars]');
    if (!button) return;
    const stars = Number(button.dataset.stars);
    const shift = Number(review.dataset.shift);
    say(message, 'Check your wallet to sign.');
    anySigner()
      .then(async (signer) => {
        await post('/api/auth/sign-in', await signedBody(signer, { action: 'sign-in' }));
        return post<{ average: number; count: number }>('/api/ratings', { ...(await signedBody(signer, { action: 'rate', shift, stars })), shift, stars });
      })
      .then((result) => say(message, `Filed. ${result.average} of 5, from ${result.count}.`, 'ok'))
      .catch((cause: unknown) => say(message, cause instanceof ApiError || cause instanceof Error ? cause.message : 'That did not work.', 'error'));
  });
}
