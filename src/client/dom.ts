type Child = Node | string | number | null | undefined | false;

// Client-side text always lands as text. There is no innerHTML anywhere in the client.
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string | boolean | undefined> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
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

export const byId = <T extends HTMLElement>(id: string): T | null => document.getElementById(id) as T | null;

export function need<T extends HTMLElement>(id: string): T {
  const element = byId<T>(id);
  if (!element) throw new Error(`missing #${id}`);
  return element;
}

export function say(element: HTMLElement | null, text: string, tone: 'ok' | 'error' | '' = ''): void {
  if (!element) return;
  element.textContent = text;
  element.className = tone;
}

export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly code: string) {
    super(message);
  }
}

async function parse<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as { error?: string; code?: string };
  if (!response.ok) throw new ApiError(response.status, body.error ?? 'Something went wrong.', body.code ?? 'error');
  return body as T;
}

export const get = async <T>(path: string): Promise<T> => parse<T>(await fetch(path, { cache: 'no-store' }));

export const post = async <T>(path: string, body: unknown): Promise<T> =>
  parse<T>(await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));

export const reducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function store(key: string, value?: string): string | null {
  try {
    if (value !== undefined) localStorage.setItem(key, value);
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
