-- Social media links a user sets on their dashboard profile: a JSON array of
-- { "platform": "facebook" | "instagram" | ..., "url": "https://..." }.
-- NULL when none.
ALTER TABLE users ADD COLUMN social_links TEXT;
