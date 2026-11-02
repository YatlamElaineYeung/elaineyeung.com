-- Short-lived record used only to recognise a repeated form. Holds a hash of the fields (never the content)
-- and whether the optional request was switched on; kept for the repeat window, independent of message delivery.
CREATE TABLE recent_forms (
  fingerprint TEXT NOT NULL,
  requested   INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX recent_forms_fingerprint ON recent_forms (fingerprint, created_at);
