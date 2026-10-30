-- Private storage for contact form messages (Cloudflare D1).
-- A message stays here only until Resend confirms it reached the inbox, then it is deleted.

CREATE TABLE messages (
  id          TEXT PRIMARY KEY,           -- random id, also shown in the email as a reference
  created_at  INTEGER NOT NULL,           -- milliseconds since 1970
  status      TEXT NOT NULL,              -- 'queued' (not yet accepted by Resend), 'sent' (accepted, awaiting delivery), 'failed' (bounced)
  attempts    INTEGER NOT NULL DEFAULT 0,
  last_error  TEXT,                       -- short reason only, never message content
  resend_id   TEXT,                       -- Resend's id, used to match delivery reports
  fingerprint TEXT NOT NULL,              -- hash of sender email + message, to spot accidental repeats
  payload     TEXT NOT NULL               -- the form fields as JSON
);
CREATE INDEX messages_status ON messages (status, created_at);
CREATE INDEX messages_resend ON messages (resend_id);
CREATE INDEX messages_fingerprint ON messages (fingerprint, created_at);

-- One row per accepted submission, for the per-hour limit. Holds a salted hash, never the visitor's IP itself.
CREATE TABLE submissions (
  ip_hash    TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX submissions_ip ON submissions (ip_hash, created_at);

-- Small key-value table, e.g. when the last "Action needed" alert went out
CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
