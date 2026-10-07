-- A customer ('user' role) can belong to several owners. users.parent_id stays
-- as the customer's first/home owner (theme resolution reads it); this table is
-- the full membership that owner-facing lists and access checks use.
CREATE TABLE owner_customers (
  owner_id INTEGER NOT NULL REFERENCES users(id),
  customer_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (owner_id, customer_id)
);

CREATE INDEX idx_owner_customers_customer ON owner_customers(customer_id);

INSERT INTO owner_customers (owner_id, customer_id)
SELECT parent_id, id FROM users WHERE parent_id IS NOT NULL;
