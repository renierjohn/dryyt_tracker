CREATE TABLE theme_preferences (
  owner_id INTEGER PRIMARY KEY REFERENCES users(id),
  flavor TEXT NOT NULL DEFAULT 'default',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
