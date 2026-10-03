-- 'owner' already exists as a manually-added role in deployed databases (id 4,
-- permissions '["*"]") — OR IGNORE makes this a no-op there while still seeding
-- it for fresh/test databases that only ran migrations up to this point.
INSERT OR IGNORE INTO roles (name, permissions) VALUES ('owner', '["*"]');

ALTER TABLE users ADD COLUMN parent_id INTEGER REFERENCES users(id);
