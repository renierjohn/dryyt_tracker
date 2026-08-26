CREATE TABLE workflow_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  customer_name TEXT NOT NULL,
  customer_contact TEXT,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'hold'
    CHECK (status IN ('hold', 'in_progress', 'done', 'ready_to_pickup')),
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
