-- Store details an 'owner' sets from their dashboard: a street address picked
-- on a map (with its coordinates, for the pin) and weekly opening hours, stored
-- as JSON — see worker/store.ts for the shape.
ALTER TABLE users ADD COLUMN address TEXT;
ALTER TABLE users ADD COLUMN lat REAL;
ALTER TABLE users ADD COLUMN lng REAL;
ALTER TABLE users ADD COLUMN opening_hours TEXT;
