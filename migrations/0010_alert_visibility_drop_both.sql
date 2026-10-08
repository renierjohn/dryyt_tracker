-- 'both' is no longer offered; existing rows keep their public-page visibility.
-- The CHECK constraint still allows 'both' (SQLite can't alter it in place);
-- the API rejects it on create/update.
UPDATE alerts SET visibility = 'public' WHERE visibility = 'both';
