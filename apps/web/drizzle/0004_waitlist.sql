-- Waitlist table for landing page email capture + device interest
-- See: /docs/customer-discovery-research.md §6 (MVP Must-Haves)

CREATE TABLE waitlist (
  id          SERIAL          PRIMARY KEY,
  email       VARCHAR(320)    NOT NULL UNIQUE,
  devices     VARCHAR(500),
  created_at  TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);
