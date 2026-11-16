CREATE TABLE IF NOT EXISTS jobs (
  device TEXT NOT NULL,
  id TEXT NOT NULL,
  due INTEGER NOT NULL,
  subscription TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  available INTEGER NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 0,
  sent INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (device, id)
);
CREATE INDEX IF NOT EXISTS jobs_pending ON jobs (sent, available);
