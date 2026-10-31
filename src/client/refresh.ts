// The server is the only thing that renders. To refresh, the page asks for itself and swaps the parts
// marked data-live. Nothing here builds markup from data.
export function startRefresh(seconds: number, afterSwap: () => void): void {
  if (seconds <= 0) return;
  let pending = false;
  const tick = async (): Promise<void> => {
    if (document.hidden || pending) return;
    pending = true;
    try {
      const response = await fetch(location.pathname, { headers: { accept: 'text/html' } });
      if (!response.ok) return;
      swap(new DOMParser().parseFromString(await response.text(), 'text/html'));
      afterSwap();
    } catch {
      // A missed refresh just waits for the next one.
    } finally {
      pending = false;
    }
  };
  setInterval(() => void tick(), seconds * 1000);
  document.addEventListener('visibilitychange', () => void tick());
}

export function swap(next: Document): void {
  document.body.dataset.shift = next.body.dataset.shift;
  const scene = document.getElementById('scene');
  const nextScene = next.getElementById('scene');
  if (scene && nextScene) Object.assign(scene.dataset, nextScene.dataset);
  const art = document.getElementById('stage-art');
  const nextArt = next.getElementById('stage-art');
  if (art && nextArt) art.dataset.state = nextArt.dataset.state;
  for (const incoming of next.querySelectorAll<HTMLElement>('[data-live]')) {
    const present = incoming.id ? document.getElementById(incoming.id) : null;
    if (!present || present.isEqualNode(incoming)) continue;
    present.replaceWith(document.importNode(incoming, true));
  }
}

export async function refreshNow(): Promise<void> {
  const response = await fetch(location.pathname, { cache: 'no-store' });
  if (response.ok) swap(new DOMParser().parseFromString(await response.text(), 'text/html'));
}
