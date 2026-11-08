# 小窝：带密码的 WHOOP 状态页

一个静态页面（`site/`），只给知道暗号的人看。数据在 Mac 上加密后才上传，网上只有密文。

## 数据流

```
launchd（每小时）
  └─ ~/Documents/health/whoop/whoop.py sync          # 拉 WHOOP API -> whoop.db（不变）
  └─ python3 publish.py
       ├─ whoop/export_status.py -> whoop/data/status.json   # 明文，只在本机，字段白名单在 FIELDS
       ├─ AES-256-GCM 加密（密码在钥匙串，PBKDF2-SHA256 600k 轮）-> site/data.enc.json
       └─ site/ 做成一个孤儿提交，强推到 gh-pages        # 公开历史里只有最新一份
浏览器：输入暗号 -> WebCrypto 推导同一把密钥 -> 本地解密 -> 渲染
```

- 浏览器从不接触 WHOOP API，也不持有任何 token。
- 页面密码只存在两个地方：你 Mac 的钥匙串（service `daily-status-page`），以及看的人自己的脑子 /
  设备（勾了"记住这台设备"会在她的浏览器里存派生出来的密钥，点页脚"退出这台设备"清掉）。
- 换密码：`python3 publish.py --set-password`，然后 `python3 publish.py`。salt 会一起换，旧设备上记住的密钥自动失效。

## 常用命令

```bash
python3 publish.py --local                 # 只生成 site/data.enc.json，不推送
python3 publish.py                         # 生成 + 推送
python3 -m http.server 8765 -d site        # 本地预览 http://localhost:8765/
# http://localhost:8765/?demo=green|yellow|red|sleep   假数据预览各种心情，不用密码
```

## 页面上显示什么

见 `~/Documents/health/whoop/export_status.py` 的 `FIELDS` 和 `build()`。改白名单就是改别人能看到的东西。
不想给看的运动类型放在同一文件的 `HIDE_SPORTS` 里（目前是 `activity`，也就是 WHOOP 自动识别、没标项目的"活动"），导出时就删掉，密文里也没有。
页面对缺失的字段是容错的：没有负荷数据时"今日活动"卡片会自动隐藏。

## 安全边界（诚实版）

- 密文是公开的，所以密码强度就是全部的防线：用 4 个以上随机词组成的短语，别用生日之类。
- 知道密码的人可以把密码转给别人；要撤销只能换密码。需要按人授权/撤销，就换成 Cloudflare Pages + Cloudflare Access（邮箱验证码登录）。
- 页面代码（不含数据）是公开的。
- 只在 Mac 醒着的时候更新；Mac 睡着时数据停在最后一次同步。要 24 小时更新需要把同步搬到云端（cron），
  但那样 refresh token 就得放到云上，而且 Mac 上的同步要停掉（refresh token 会轮换，只能有一个写入方）。

## 页面上的东西

- 3D 小岛（`site/scene3d.js`）和小伙伴（`site/pet3d.js`：猫猫 / 企鹅 / 小鸡）都是用 Three.js 基础几何体现搭的原创模型。
  水晶 = 恢复，花 = 今天的负荷（开花数 = strain），小床 = 昨晚睡眠，树 = 作息规律度。
- 动态 emoji：Google Noto Animated Emoji（CC BY 4.0），直接引用 fonts.gstatic.com。署名放在 `site/index.html` 底部的注释里（页面上不显示文字）。
- Three.js r170 / lottie-web 5.13.0 走 CDN（jsDelivr / cdnjs）。

## 每小时自动更新

`hourly.sh` 由 `~/Library/LaunchAgents/com.zilong.whoop-sync.plist` 每小时调用：先 `whoop.py sync`，成功后 `publish.py`。

launchd 起的 `/bin/sh` 读不了 `~/Documents`，所以实际跑的是装到外面的一份副本；改了 `hourly.sh` 要重新装：

```bash
install -m 755 hourly.sh ~/Library/Scripts/whoop-status-hourly.sh
launchctl kickstart gui/$(id -u)/com.zilong.whoop-sync     # 手动跑一次，日志在 ~/Library/Logs/whoop-sync.log
```

网址：https://zilongxue.github.io/daily-status/
