ALTER TABLE batch_items ADD COLUMN retry_class TEXT;
ALTER TABLE batch_items ADD COLUMN deferred_until TEXT;

CREATE TABLE IF NOT EXISTS provider_circuit_states (
  provider TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  reason_code TEXT,
  opened_at TEXT,
  next_probe_at TEXT,
  last_healthy_at TEXT,
  updated_at TEXT NOT NULL
);
