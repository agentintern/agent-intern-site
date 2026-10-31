import { get, type Pause, type Shift, type State } from './api';
import { byId, h, maybeId } from './dom';

declare const __MINT__: string;
declare const __SITE_ORIGIN__: string;

// Signatures name one domain, so the old address has to send people to the real one.
if (location.hostname.endsWith('.pages.dev')) {
  location.replace(`${__SITE_ORIGIN__}${location.pathname}${location.search}`);
}

// Compiled in at build time. With the mint empty, this whole block and its words drop out of the
// bundle, so test mode really does mention none of it.
export function showMintChip(): void {
  if (!__MINT__) return;
  const slot = maybeId('ca-slot');
  if (!slot) return;
  const short = `${__MINT__.slice(0, 4)}...${__MINT__.slice(-4)}`;
  const copy = h('button', { class: 'pill', type: 'button', 'aria-label': 'Copy the contract address' }, `CA ${short}`);
  copy.addEventListener('click', () => {
    void navigator.clipboard.writeText(__MINT__).then(() => { copy.textContent = 'Copied'; });
  });
  slot.append(copy, ' ', h('a', { class: 'pill', href: `https://solscan.io/token/${__MINT__}` }, 'Solscan'));
}

export function showShiftPill(shift: Pick<Shift, 'state' | 'id'> | null, pause: Pause): void {
  const pill = byId('pill');
  const label = pill.querySelector('span') as HTMLSpanElement;
  pill.classList.remove('on', 'paused');
  if (pause.paused) {
    pill.classList.add('paused');
    label.textContent = 'paused';
  } else if (shift) {
    pill.classList.add('on');
    label.textContent = `on shift: ${shift.state}`;
  } else {
    label.textContent = 'off shift';
  }
  const notice = byId('pause-notice');
  notice.hidden = !pause.paused;
  notice.textContent = pause.paused ? `Paused: ${pause.reason ?? 'no reason given'}` : '';
}

export async function initChrome(state?: State): Promise<State | null> {
  showMintChip();
  try {
    const current = state ?? (await get<State>('/api/state'));
    showShiftPill(current.shift, current.pause);
    return current;
  } catch {
    return null;
  }
}
