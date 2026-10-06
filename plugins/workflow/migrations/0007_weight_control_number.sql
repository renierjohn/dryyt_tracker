-- Weight of the items in kg (optional), and the owner's control number: a
-- zero-padded sequence per owner ("000001", "000002", ...), assigned on
-- registration unless the owner types one. NULL for older transactions.
ALTER TABLE workflow_transactions ADD COLUMN weight_kg REAL;
ALTER TABLE workflow_transactions ADD COLUMN control_number TEXT;
CREATE UNIQUE INDEX idx_workflow_transactions_control_number ON workflow_transactions(created_by, control_number);
