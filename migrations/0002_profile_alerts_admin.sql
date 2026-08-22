ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;

CREATE TABLE alerts (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_by INTEGER NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK (type IN ('info','success','warning','danger')),
  visibility TEXT NOT NULL CHECK (visibility IN ('dashboard','public','both')) DEFAULT 'public',
  body_html TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_alerts_user ON alerts(user_id);

INSERT INTO roles (name, permissions) VALUES ('admin', '["manage_users"]');
