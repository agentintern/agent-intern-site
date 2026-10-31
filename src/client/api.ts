export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly code: string) {
    super(message);
  }
}

async function parse<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as { error?: string; code?: string };
  if (!response.ok) {
    throw new ApiError(response.status, body.error ?? 'Something went wrong.', body.code ?? 'error');
  }
  return body as T;
}

export const get = async <T>(path: string): Promise<T> => parse<T>(await fetch(path));

export const post = async <T>(path: string, body: unknown): Promise<T> =>
  parse<T>(await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));

export interface Task {
  id: number;
  text: string;
  kind: 'holder' | 'intern';
  proposer: string | null;
  votes: number;
  round: number | null;
}

export interface Proposal {
  id: number;
  wallet: string;
  by: string;
  text: string | null;
  status: string;
  reason: string | null;
  rejectedBy: string | null;
  at: number;
  votes: number;
}

export interface Round {
  id: number;
  status: string;
  opensAt: number;
  closesAt: number;
}

export interface Shift {
  id: number;
  status: string;
  state: string;
  attempt: number;
  startedAt: number;
  endedAt: number | null;
  task: string;
  kind: 'holder' | 'intern';
  proposer: string | null;
  votes: number;
  round: number | null;
  version: string | null;
  commit: string | null;
  summary: string | null;
  note: string | null;
  prUrl: string | null;
  diffUrl: string | null;
  runUrl: string | null;
  handEdited: boolean;
  rehearsal: boolean;
  filesChanged: number | null;
  linesAdded: number | null;
  linesRemoved: number | null;
}

export interface Pause {
  paused: boolean;
  reason: string | null;
}

export interface State {
  config: { mode: 'test' | 'live'; threshold: number; closesUtc: string[]; repos: { site: string; game: string }; gameOrigin: string };
  pause: Pause;
  round: Round;
  shift: Shift | null;
  queue: Task[];
  top: Proposal[];
  version: string | null;
  rpc: { state: string };
}
