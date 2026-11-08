-- 2026-11-08：允许 who = 'sys'（按手环数据发的星星）。SQLite 改不了 CHECK，只能重建表（数据原样搬过去）。
CREATE TABLE events_new (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  ts   INTEGER NOT NULL,
  who  TEXT    NOT NULL CHECK (who IN ('me', 'her', 'sys')),
  kind TEXT    NOT NULL,
  item TEXT,
  n    INTEGER,
  box  TEXT
);
INSERT INTO events_new (id, ts, who, kind, item, n, box) SELECT id, ts, who, kind, item, n, box FROM events;
DROP TABLE events;
ALTER TABLE events_new RENAME TO events;
CREATE INDEX IF NOT EXISTS events_ts ON events (ts);
CREATE INDEX IF NOT EXISTS events_kind ON events (kind, who);
