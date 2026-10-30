-- Count refused link attempts separately from accepted messages, so someone guessing which links
-- are blocked gets only a few tries an hour, while a person fixing a typo is never affected.
ALTER TABLE submissions ADD COLUMN kind TEXT NOT NULL DEFAULT 'accepted';  -- 'accepted' or 'refused'
CREATE INDEX submissions_ip_kind ON submissions (ip_hash, kind, created_at);
