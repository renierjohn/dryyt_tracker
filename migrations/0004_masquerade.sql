ALTER TABLE sessions ADD COLUMN impersonator_id INTEGER REFERENCES users(id);
