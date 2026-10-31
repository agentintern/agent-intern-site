-- Who actually did a shift's work. Only 'intern' counts toward the Promotion Track.
ALTER TABLE shifts ADD COLUMN worked_by TEXT NOT NULL DEFAULT 'intern';
UPDATE shifts SET worked_by = 'rehearsal' WHERE rehearsal = 1;

ALTER TABLE tasks ADD COLUMN team INTEGER NOT NULL DEFAULT 0;

-- A daily run's day number. Empty for free play.
ALTER TABLE scores ADD COLUMN day INTEGER;
CREATE INDEX scores_day ON scores(day, score DESC);

CREATE TABLE ratings (
  shift_id INTEGER NOT NULL REFERENCES shifts(id),
  wallet TEXT NOT NULL,
  stars INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
  message TEXT NOT NULL,
  signature TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (shift_id, wallet)
);

-- Counts only. Text from the practice box and the attempt page is never stored.
CREATE TABLE screen_counts (
  category TEXT PRIMARY KEY,
  n INTEGER NOT NULL
);

CREATE TABLE founding_bosses (
  wallet TEXT PRIMARY KEY,
  n INTEGER NOT NULL UNIQUE,
  at INTEGER NOT NULL
);

CREATE TABLE push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE push_sent (
  key TEXT PRIMARY KEY,
  at INTEGER NOT NULL
);

CREATE INDEX proposals_wallet ON proposals(wallet);
CREATE INDEX votes_wallet ON votes(wallet);
CREATE INDEX tasks_proposer ON tasks(proposer);
