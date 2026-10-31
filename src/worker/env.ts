export interface AiBinding {
  run(model: string, input: unknown): Promise<unknown>;
}

export interface Env {
  DB: D1Database;
  AI?: AiBinding;
  ASSETS?: { fetch: typeof fetch };
  SHIFT_TOKEN?: string;
  WATCHER_TOKEN?: string;
  GATE_TOKEN?: string;
  RPC_URL?: string;
  IP_SALT?: string;
  // Local development only. Production always takes these from config/site.json.
  SITE_ORIGIN?: string;
}

export interface Ctx {
  waitUntil(promise: Promise<unknown>): void;
}
