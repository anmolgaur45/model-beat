-- Fake-door waitlist for "AI Stack Watch" (monetization validation, 2026-06-22).
-- Additive, standalone table — captures early-access interest plus optional
-- free-text on which models/tools a person depends on (qualitative signal).
CREATE TABLE IF NOT EXISTS waitlist (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email      text NOT NULL,
  stack      text,
  source     text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Case-insensitive dedupe so the same person can't pad the count.
CREATE UNIQUE INDEX IF NOT EXISTS waitlist_email_key ON waitlist (lower(email));
