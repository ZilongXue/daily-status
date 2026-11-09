#!/bin/sh
# launchd（com.zilong.whoop-sync）每 10 分钟跑一次：同步 WHOOP -> 导出 + 加密 + 推送状态页。
# 失败时弹系统通知，但最多每 6 小时一次（断网时不至于一直弹）。日志在 ~/Library/Logs/whoop-sync.log。
PY=/opt/homebrew/anaconda3/bin/python3
STAMP="$HOME/Library/Caches/whoop-status-notify"

notify() {
  if [ -z "$(find "$STAMP" -mmin -360 2>/dev/null)" ]; then
    /usr/bin/osascript -e "display notification \"看 ~/Library/Logs/whoop-sync.log\" with title \"$1\""
    touch "$STAMP"
  fi
}

echo "=== $(date '+%Y-%m-%d %H:%M:%S')"
"$PY" "$HOME/Documents/health/whoop/whoop.py" sync || { notify "WHOOP 同步失败"; exit 1; }
"$PY" "$HOME/Documents/whoop-status-page/publish.py" || { notify "状态页发布失败"; exit 1; }
"$PY" "$HOME/Documents/whoop-status-page/stars.py" || notify "星星结算失败"
"$PY" "$HOME/Documents/whoop-status-page/backup.py" || notify "小窝数据备份失败"
