-- Agent Intern: the whole data model.

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE rounds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  opens_at INTEGER NOT NULL,
  closes_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closing', 'closed')),
  winner_proposal_id INTEGER,
  closed_at INTEGER
);
CREATE INDEX rounds_status ON rounds(status);

CREATE TABLE nonces (
  nonce TEXT PRIMARY KEY,
  wallet TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE INDEX nonces_created ON nonces(created_at);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  wallet TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id INTEGER NOT NULL REFERENCES rounds(id),
  wallet TEXT NOT NULL,
  text TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('screening', 'open', 'rejected', 'won', 'lost')),
  reason TEXT,
  rejected_by TEXT CHECK (rejected_by IN ('rules', 'agent')),
  message TEXT NOT NULL,
  signature TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX proposals_round ON proposals(round_id, status);
CREATE UNIQUE INDEX one_proposal_per_round ON proposals(round_id, wallet) WHERE status != 'rejected';

CREATE TABLE votes (
  round_id INTEGER NOT NULL REFERENCES rounds(id),
  wallet TEXT NOT NULL,
  proposal_id INTEGER NOT NULL REFERENCES proposals(id),
  message TEXT NOT NULL,
  signature TEXT NOT NULL,
  slot INTEGER NOT NULL,
  balance TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  close_balance TEXT,
  close_slot INTEGER,
  close_checked_at INTEGER,
  counted INTEGER,
  PRIMARY KEY (round_id, wallet)
);
CREATE INDEX votes_proposal ON votes(proposal_id);

CREATE TABLE tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id INTEGER UNIQUE,
  proposal_id INTEGER,
  text TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('holder', 'intern')),
  proposer TEXT,
  votes INTEGER NOT NULL DEFAULT 0,
  backlog_id TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'in-shift', 'shipped', 'refused', 'failed', 'rolled-back')),
  created_at INTEGER NOT NULL
);
CREATE INDEX tasks_status ON tasks(status, id);

CREATE TABLE shifts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id),
  status TEXT NOT NULL DEFAULT 'live'
    CHECK (status IN ('live', 'gate', 'shipped', 'refused', 'failed', 'rolled-back')),
  state TEXT NOT NULL DEFAULT 'reading',
  attempt INTEGER NOT NULL DEFAULT 1,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  summary TEXT,
  note TEXT,
  version TEXT,
  commit_sha TEXT,
  pr_url TEXT,
  diff_url TEXT,
  run_url TEXT,
  hand_edited INTEGER NOT NULL DEFAULT 0,
  rehearsal INTEGER NOT NULL DEFAULT 0,
  files_changed INTEGER,
  lines_added INTEGER,
  lines_removed INTEGER
);
-- One shift at a time, enforced by the database.
CREATE UNIQUE INDEX one_open_shift ON shifts((1)) WHERE status IN ('live', 'gate');

CREATE TABLE shift_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shift_id INTEGER NOT NULL REFERENCES shifts(id),
  at INTEGER NOT NULL,
  kind TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX shift_events_shift ON shift_events(shift_id, id);

CREATE TABLE gate_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shift_id INTEGER NOT NULL REFERENCES shifts(id),
  attempt INTEGER NOT NULL,
  stage TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pass', 'fail')),
  detail TEXT,
  run_url TEXT,
  at INTEGER NOT NULL
);
CREATE INDEX gate_results_shift ON gate_results(shift_id, id);

CREATE TABLE shift_media (
  shift_id INTEGER NOT NULL REFERENCES shifts(id),
  kind TEXT NOT NULL CHECK (kind IN ('before', 'after')),
  bytes BLOB NOT NULL,
  PRIMARY KEY (shift_id, kind)
);

CREATE TABLE scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  score INTEGER NOT NULL,
  tasks INTEGER NOT NULL,
  duration REAL NOT NULL,
  version TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX scores_top ON scores(score DESC);

CREATE TABLE test_balances (
  wallet TEXT PRIMARY KEY,
  balance TEXT NOT NULL
);

CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);
