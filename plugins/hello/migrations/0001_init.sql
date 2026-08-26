CREATE TABLE hello_plugin_visits (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  count INTEGER NOT NULL DEFAULT 0
);
