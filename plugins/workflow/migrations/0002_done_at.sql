-- When the transaction last moved to 'done' — the "end" of its work. Kept
-- through 'ready_to_pickup', cleared if it's moved back to hold/in_progress.
ALTER TABLE workflow_transactions ADD COLUMN done_at TEXT;
