-- An owner's Tracker queries filter by status and sort by created_at; without
-- this they read every one of the owner's transactions (D1 bills rows read).
CREATE INDEX idx_workflow_transactions_owner_status ON workflow_transactions(created_by, status, created_at);
-- A customer's /my-transactions list; without this it scans the whole table.
CREATE INDEX idx_workflow_transactions_customer ON workflow_transactions(customer_user_id);
