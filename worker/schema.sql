-- 小窝的互动记录。自由文字（留言、道歉卡）只存浏览器加密后的密文（box），后端看不到内容。
CREATE TABLE IF NOT EXISTS events (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  ts   INTEGER NOT NULL,                              -- 毫秒时间戳（服务器时间）
  who  TEXT    NOT NULL CHECK (who IN ('me', 'her', 'sys')), -- me = Zilong，her = 她，sys = 按数据发的星星
  kind TEXT    NOT NULL,                              -- feed / angry / hit / calm / sorry / flower / note
  item TEXT,                                          -- 食物或礼物的 id（明文，只用于推送文案）
  n    INTEGER,                                       -- 揍了几下等
  box  TEXT                                           -- AES-GCM 密文：base64(iv) "." base64(ct)
);
CREATE INDEX IF NOT EXISTS events_ts ON events (ts);
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS subs (endpoint TEXT PRIMARY KEY, who TEXT NOT NULL, ts INTEGER NOT NULL);  -- 网页推送订阅
-- v15：每一条渔获（图鉴、尺寸纪录）和相册（只存密文）
CREATE TABLE IF NOT EXISTS catches (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, who TEXT NOT NULL, fish TEXT NOT NULL, cm INTEGER, spot TEXT);
CREATE INDEX IF NOT EXISTS catches_fish ON catches (fish);
CREATE TABLE IF NOT EXISTS photos (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, who TEXT NOT NULL, thumb TEXT NOT NULL, full TEXT NOT NULL);
