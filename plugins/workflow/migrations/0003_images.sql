-- Photos attached to a transaction (captured/uploaded on registration). The
-- bytes live in the TRANSACTION_IMAGES R2 bucket under r2_key; resized
-- client-side and capped at 1 MB server-side.
CREATE TABLE workflow_transaction_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id INTEGER NOT NULL REFERENCES workflow_transactions(id),
  r2_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_workflow_transaction_images_txn ON workflow_transaction_images(transaction_id);
