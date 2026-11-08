#!/usr/bin/env python3
"""按手环数据给小岛发星星（每小时跟在 publish.py 后面跑）。

规则（每条每天 / 每晚只发一次，后端用唯一键去重，重复跑没关系）：
  bed:<夜>      在约定时间前睡着（state/profile.json 的 bedtime，默认 04:30，你那边的时间）  +3
  sleep7:<日>   当天睡够 7 小时（含午睡）                                                    +2
  green:<日>    恢复是绿色                                                                    +1
  regular:<日>  作息规律度（SRI）≥ 80                                                         +1
  active:<日>   负荷 ≥ 10（"今天动起来了"），只算已经过完的天                                  +1
  streak3:<夜>  连续 3 晚按时睡（每满 3 晚一次）                                              +5
  nudge:<夜>    她点了"该睡觉啦"，30 分钟内你真的睡着了                                        +3
  welcome       开张礼包（只一次）                                                            +10
互动类的星星（每天第一次喂食、纸条往来、和好）由后端自己发。

只读 whoop.db；用 state/sys_token 调 /mint（网页拿不到这个令牌，所以只有这里能按数据发星星）。
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import sqlite3
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
STATE = ROOT / "state"
WHOOP = Path.home() / "Documents" / "health" / "whoop"
API = "https://api.hizilo.com"
UA = "nest-stars/1.0"
START = dt.date(2026, 11, 7)  # 从这天起算（之前的数据不补发）

sys.path.insert(0, str(WHOOP))
import export_status as ex  # noqa: E402


def call(path: str, *, body: dict | None = None, headers: dict | None = None) -> dict:
    req = urllib.request.Request(API + path, data=json.dumps(body).encode() if body is not None else None,
                                 method="POST" if body is not None else "GET",
                                 headers={"user-agent": UA, "content-type": "application/json", **(headers or {})})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read())


def night_of(start_local: dt.datetime) -> dt.date:
    """一觉算哪一晚：中午 12 点前入睡算前一晚（凌晨 4 点睡 = 前一天的"晚上"）。"""
    return (start_local - dt.timedelta(hours=12)).date()


def clock_min(t: dt.datetime, pivot_h: int = 12) -> int:
    """以中午为起点的分钟数，这样凌晨 4:30 > 晚上 23:00，可以直接比大小。"""
    return ((t.hour * 60 + t.minute) - pivot_h * 60) % 1440


def main() -> int:
    profile = json.loads((STATE / "profile.json").read_text()) if (STATE / "profile.json").exists() else {}
    bh, bm = map(int, profile.get("bedtime", "04:30").split(":"))
    target = clock_min(dt.datetime(2000, 1, 1, bh, bm))

    con = sqlite3.connect(f"file:{ex.DB}?mode=ro", uri=True)
    now = dt.datetime.now(dt.timezone.utc)
    data = ex.build(con, now)  # 复用导出脚本的每日统计（sleep_h / nap_h / band / sri / strain）
    con.row_factory = sqlite3.Row
    mains = con.execute("SELECT start_utc, end_utc, timezone_offset FROM sleeps WHERE nap = 0 AND end_utc IS NOT NULL ORDER BY start_utc").fetchall()
    con.close()
    tz = ex.tzinfo(data.get("tz"))
    today = ex.day_of(now, tz)

    want: dict[str, int] = {"welcome": 10}

    # 按时睡 + 连续 3 晚
    nights: dict[dt.date, dt.datetime] = {}
    for s in mains:
        st = ex.parse_utc(s["start_utc"])
        nights.setdefault(night_of(st.astimezone(tz)), st)  # 一晚取第一觉
    on_time = sorted(n for n, st in nights.items() if n >= START and clock_min(st.astimezone(tz)) <= target)
    for n in on_time:
        want[f"bed:{n}"] = 3
    run = 0
    for n in sorted(nights):
        if n < START:
            continue
        run = run + 1 if n in on_time else 0
        if run and run % 3 == 0:
            want[f"streak3:{n}"] = 5

    # 每日规则（今天还没过完的只算睡眠类，负荷要等一天结束）
    for d in data.get("days", []):
        day = dt.date.fromisoformat(d["d"])
        if day < START:
            continue
        if (d.get("sleep_h") or 0) + (d.get("nap_h") or 0) >= 7:
            want[f"sleep7:{day}"] = 2
        if d.get("band") == "green":
            want[f"green:{day}"] = 1
        if (d.get("sri") or 0) >= 80:
            want[f"regular:{day}"] = 1
        if day < today and (d.get("strain") or 0) >= 10:
            want[f"active:{day}"] = 1

    # 催睡成功：拿她的 nudge 事件（需要页面令牌），看 30 分钟内有没有入睡
    try:
        sys.path.insert(0, str(ROOT))
        import publish  # noqa: E402
        token = hashlib.sha256(publish.derive_key(publish.password()) + b"nest-api-v1").hexdigest()
        events, since = [], 0
        while True:
            batch = call(f"/events?since={since}", headers={"authorization": "Bearer " + token}).get("events", [])
            events += batch
            if len(batch) < 200:
                break
            since = batch[-1]["id"]
        for e in events:
            if e["kind"] != "nudge" or e["who"] != "her":
                continue
            t = dt.datetime.fromtimestamp(e["ts"] / 1000, dt.timezone.utc)
            for n, st in nights.items():
                if t <= st <= t + dt.timedelta(minutes=30) and n >= START:
                    want[f"nudge:{n}"] = 3
    except Exception as err:  # 拿不到就下次再算
        print(f"催睡判定跳过：{err}")

    sys_token = (STATE / "sys_token").read_text().strip()
    made = 0
    for item, n in want.items():
        r = call("/mint", body={"item": item, "n": n}, headers={"x-nest-sys": sys_token})
        made += bool(r.get("minted"))
    print(f"星星：检查 {len(want)} 条规则，新发 {made} 条")
    return 0


if __name__ == "__main__":
    sys.exit(main())
