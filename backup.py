#!/usr/bin/env python3
"""每天一次：把线上 D1（小窝的互动、背包、相册密文…）逐表导出成 JSON，存到 state/backup/（不进 git），只留最近 14 天。
hourly.sh 每 10 分钟调一次，今天已经备份过就什么都不做。（wrangler 3 的 d1 export 鉴权会失败，所以用 SELECT * 逐表导；恢复时按表写回，先确认再做。）"""
import datetime, json, os, pathlib, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parent
OUT = ROOT / "state" / "backup"
NODE_BIN = pathlib.Path.home() / ".nvm/versions/node/v22.13.1/bin"
KEEP = 14
TABLES = ["events", "meta", "catches", "photos"]  # subs（推送订阅）不备份


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    day = datetime.date.today().isoformat()
    dest = OUT / f"nest-{day}.json"
    if dest.exists() and dest.stat().st_size > 0:
        return 0
    env = {**os.environ, "PATH": f"{NODE_BIN}:{os.environ.get('PATH', '/usr/bin:/bin')}"}
    out = {"day": day}
    for table in TABLES:
        r = subprocess.run(["npx", "wrangler", "d1", "execute", "nest", "--remote", "--json", "--command", f"SELECT * FROM {table}"],
                           cwd=ROOT / "worker", env=env, capture_output=True, text=True, timeout=300)
        try:
            out[table] = json.loads(r.stdout)[0]["results"]
        except Exception:
            if "no such table" in r.stdout + r.stderr:
                out[table] = []
                continue
            print(f"备份失败（{table}）：", (r.stderr or r.stdout)[-400:], file=sys.stderr)
            return 1
    tmp = dest.with_suffix(".tmp")
    tmp.write_text(json.dumps(out, ensure_ascii=False))
    tmp.replace(dest)
    print(f"已备份 -> {dest.relative_to(ROOT)} ({dest.stat().st_size // 1024} KB, " + ", ".join(f"{t} {len(out[t])}" for t in TABLES) + ")")
    for old in sorted(OUT.glob("nest-*.json"))[:-KEEP]:
        old.unlink()
    return 0


if __name__ == "__main__":
    sys.exit(main())
