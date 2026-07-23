CREATE TABLE IF NOT EXISTS llm_usage_logs (
  id TEXT PRIMARY KEY,
  run_id TEXT,
  task TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_hash TEXT NOT NULL,
  cache_hit INTEGER NOT NULL CHECK (cache_hit IN (0, 1)),
  input_tokens INTEGER,
  output_tokens INTEGER,
  cost_usd REAL,
  status TEXT NOT NULL,
  error_message TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_llm_usage_run ON llm_usage_logs(run_id);
CREATE INDEX IF NOT EXISTS idx_llm_usage_prompt ON llm_usage_logs(prompt_hash);
