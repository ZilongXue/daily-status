-- 2026-11-09 v15：渔获表 + 相册表；把以前的钓鱼 / 钓鱼大赛记录搬进渔获表（以前没有尺寸，cm 为空）。只跑一次。
CREATE TABLE IF NOT EXISTS catches (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, who TEXT NOT NULL, fish TEXT NOT NULL, cm INTEGER, spot TEXT);
CREATE INDEX IF NOT EXISTS catches_fish ON catches (fish);
CREATE TABLE IF NOT EXISTS photos (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, who TEXT NOT NULL, thumb TEXT NOT NULL, full TEXT NOT NULL);
INSERT INTO catches (ts, who, fish, cm, spot)
  SELECT ts, who, item, NULL, 'sea' FROM events WHERE kind IN ('fish', 'dfish') AND item IS NOT NULL AND item != 'miss' AND NOT EXISTS (SELECT 1 FROM catches) ORDER BY id;
