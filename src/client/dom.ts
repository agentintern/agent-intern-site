type Child = Node | string | number | null | undefined | false;

// The only way this site puts anything on a page. Text always lands as text, so a stranger's task
// can never become markup. There is no innerHTML anywhere in the client.
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | boolean | undefined> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    element.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    element.append(typeof child === 'number' ? String(child) : child);
  }
  return element;
}

export function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`missing #${id}`);
  return element as T;
}

export function maybeId<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

export function fill(parent: HTMLElement, ...children: Child[]): void {
  parent.replaceChildren();
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.append(typeof child === 'number' ? String(child) : child);
  }
}

export function setText(id: string, text: string): void {
  const element = maybeId(id);
  if (element) element.textContent = text;
}

export function countdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor(total / 60) % 60)}:${pad(total % 60)}`;
}

export function timer(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const body = `${String(Math.floor(total / 60) % 60).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  return hours ? `${hours}:${body}` : body;
}

export function when(at: number | null | undefined): string {
  if (!at) return '';
  return new Date(at).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

export function clockTime(at: number): string {
  return new Date(at).toISOString().slice(11, 19);
}

// Polls while the tab is visible, so a tab left in the background costs nothing.
export function poll(run: () => Promise<void> | void, everyMs: () => number): void {
  let handle = 0;
  const loop = async (): Promise<void> => {
    window.clearTimeout(handle);
    if (!document.hidden) {
      try {
        await run();
      } catch (cause) {
        console.warn(cause);
      }
    }
    handle = window.setTimeout(() => void loop(), everyMs());
  };
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void loop();
  });
  void loop();
}
