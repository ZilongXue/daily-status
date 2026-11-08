#!/bin/sh
# 本地测试环境：本地后端（Cloudflare Worker + 本地 SQLite 版 D1）+ 本地静态页面。和线上数据完全隔离。
#   ./dev.sh          启动（第一次会自动建表、塞一点测试星星）
#   ./dev.sh reset    清空本地测试数据库，重新建表 + 塞测试星星
# 打开 http://localhost:8765/?demo=green
#   - 页面用演示数据（不用密码），互动全部走本地后端 http://localhost:8787，用的是测试密钥 sha256("nest-dev")。
#   - 在页面里点"我是她 / 我是 Zilong"切换身份；两个浏览器窗口各选一个身份，就能互相看到对方的动作。
# 后端在 worker/.dev.vars 里用测试用的 ACCESS_HASH / SYS_HASH（系统令牌是 64 个 a），不是线上的密钥。
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
W="$ROOT/worker"
STATE="$W/.wrangler/state"
SYS=$(printf 'a%.0s' $(seq 1 64))

cd "$W"
if [ "$1" = "reset" ]; then
  rm -rf "$STATE/v3/d1"
  echo "本地测试数据库已清空"
fi
FRESH=0
[ -d "$STATE/v3/d1" ] || FRESH=1
if [ "$FRESH" = 1 ]; then
  npx wrangler d1 execute nest --local --file schema.sql >/dev/null
  echo "本地数据库已建表"
fi

# 后端
npx wrangler dev --local --port 8787 >"$ROOT/.dev-worker.log" 2>&1 &
WPID=$!
# 页面
(cd "$ROOT/site" && python3 -m http.server 8765 >"$ROOT/.dev-site.log" 2>&1) &
SPID=$!
trap 'kill $WPID $SPID 2>/dev/null; echo; echo "已停止"' INT TERM EXIT

# 等后端起来
i=0
until curl -s -o /dev/null http://localhost:8787/events; do i=$((i+1)); [ $i -gt 60 ] && echo "后端没起来，看 .dev-worker.log" && exit 1; sleep 0.5; done
if [ "$FRESH" = 1 ]; then
  for k in 1 2 3 4 5; do  # 单条最多 20 颗
    curl -s -X POST http://localhost:8787/mint -H "x-nest-sys: $SYS" -H "content-type: application/json" -d "{\"item\":\"seed$k\",\"n\":20}" >/dev/null
  done
  echo "塞了 100 颗测试星星"
fi
echo "本地后端  http://localhost:8787   （日志 .dev-worker.log）"
echo "本地页面  http://localhost:8765/?demo=green"
echo "Ctrl+C 停止"
wait
