// Everything on a page goes through html``. Interpolated values are escaped unless they are
// already Safe, so a stranger's task text can't become markup by accident.
export class Safe {
  constructor(readonly value: string) {}
  toString(): string {
    return this.value;
  }
}

export type Part = Safe | string | number | boolean | null | undefined | Part[];

const ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ENTITIES[c] as string);
}

function part(value: Part): string {
  if (value === null || value === undefined || value === false || value === true) return '';
  if (value instanceof Safe) return value.value;
  if (Array.isArray(value)) return value.map(part).join('');
  return esc(value);
}

export function html(strings: TemplateStringsArray, ...values: Part[]): Safe {
  let out = strings[0] as string;
  values.forEach((value, i) => {
    out += part(value) + (strings[i + 1] as string);
  });
  return new Safe(out);
}

export const raw = (value: string): Safe => new Safe(value);

export const when = (at: number | null | undefined): string =>
  at ? `${new Date(at).toISOString().replace('T', ' ').slice(0, 16)} UTC` : '';

export const isoDate = (at: number): string => new Date(at).toISOString();

export const shortAddress = (wallet: string): string => `${wallet.slice(0, 4)}...${wallet.slice(-4)}`;
