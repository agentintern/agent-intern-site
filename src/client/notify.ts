import { byId, need, post, say } from './dom';

function toBytes(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

export function startNotify(): void {
  const button = need<HTMLButtonElement>('notify');
  const key = button.dataset.key;
  if (!key || !('serviceWorker' in navigator) || !('PushManager' in window)) return;
  button.hidden = false;
  button.addEventListener('click', () => {
    const message = byId('notify-message');
    navigator.serviceWorker.register('/sw.js')
      .then((registration) => registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toBytes(key) }))
      .then((subscription) => post('/api/push/subscribe', subscription.toJSON()))
      .then(() => say(message, "You'll hear when a shift starts, a vote is closing or a task ships. Turn it off in your browser settings.", 'ok'))
      .catch(() => say(message, 'That did not work, or notifications are blocked in this browser.', 'error'));
  });
}
