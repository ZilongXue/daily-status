# 小窝：带密码的 WHOOP 状态页

一个静态页面（`site/`），只给知道暗号的人看。数据在 Mac 上加密后才上传，网上只有密文。

## 数据流

```
launchd（每 10 分钟）
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
运动记录（项目、时间、时长）在同一文件的 `hide()` 里整块不导出，页面上也没有"最近运动"卡片；负荷和步数照常显示。

## 安全边界（诚实版）

- 密文是公开的，所以密码强度就是全部的防线：用 4 个以上随机词组成的短语，别用生日之类。
- 知道密码的人可以把密码转给别人；要撤销只能换密码。需要按人授权/撤销，就换成 Cloudflare Pages + Cloudflare Access（邮箱验证码登录）。
- 页面代码（不含数据）是公开的。
- 只在 Mac 醒着的时候更新；Mac 睡着时数据停在最后一次同步。要 24 小时更新需要把同步搬到云端（cron），
  但那样 refresh token 就得放到云上，而且 Mac 上的同步要停掉（refresh token 会轮换，只能有一个写入方）。

## 页面上的东西

- 3D 小岛（`site/scene3d.js`）和小伙伴（`site/pet3d.js`：猫猫 / 企鹅 / 小鸡）都是用 Three.js 基础几何体现搭的原创模型。
  水晶 = 恢复，花 = 今天的负荷（开花数 = strain），小床 = 昨晚睡眠，树 = 作息规律度。
- 动态 emoji：Google Noto Animated Emoji（CC BY 4.0），本地副本在 `site/vendor/noto/`。署名放在 `site/index.html` 底部的注释里（页面上不显示文字）。
- Three.js r170、lottie-web 5.13.0、标题字体（ZCOOL KuaiLe 子集，OFL）全部放在 `site/vendor/`：她在国内，Google Fonts / jsDelivr 打不开或不稳定，页面不能有任何外部请求。

## 每 10 分钟自动更新

`hourly.sh` 由 `~/Library/LaunchAgents/com.zilong.whoop-sync.plist` 每 10 分钟调用（StartInterval 600）：先 `whoop.py sync`，成功后 `publish.py`。

launchd 起的 `/bin/sh` 读不了 `~/Documents`，所以实际跑的是装到外面的一份副本；改了 `hourly.sh` 要重新装：

```bash
install -m 755 hourly.sh ~/Library/Scripts/whoop-status-hourly.sh
launchctl kickstart gui/$(id -u)/com.zilong.whoop-sync     # 手动跑一次，日志在 ~/Library/Logs/whoop-sync.log
```

网址：https://zilongxue.github.io/daily-status/

## 星星和小岛商店（2026-11-08）

- 星星是两个人共用的金库，只用来装扮小岛。余额、购买、摆放都由后端（`worker/`）核算，网页改不了价格也刷不了星星。
- 手环规则在 `stars.py`（每次跟在 publish 后面跑，用 `state/sys_token` 调 `/mint`，每条规则每天只发一次）：
  按时睡（`state/profile.json` 的 `bedtime`）+3、睡够 7 小时 +2、恢复绿 +1、作息规律 +1、负荷 ≥ 10 +1、连续 3 晚按时睡 +5、她催睡后 30 分钟内睡着 +3、开张礼包 +10。
- 互动规则在 Worker：每天第一次喂食 +1、同一天互相留言 +1、和好 +1。
- 装饰：`site/decor3d.js`（固定摆位、下雪、等级饰品），模型在 `site/vendor/decor/`（CC0 / CC-BY 3.0，署名见 `CREDITS.md`）。
- 等级按累计星星：20 / 50 / 100 / 200 颗分别升到 Lv.2–5（头上的小花、围巾、皇冠）。

## 第三版：海岛、她的小猫和小马、钓鱼（2026-11-08）

- **场景**（`site/world3d.js`）：
  - 整座岛是一块连续的高度场地形。中间是平的草地，所有装饰和角色都站在 y = 0 上。往外是缓坡和背面的岩层悬崖，然后是沙滩和浅水。顶点按高度和坡度上色，没有外部模型。
  - 海面用 shader 画，白浪沿着真实海岸线走（海岸半径预先算好，存成一张一维贴图）。
  - 其他元素：树旁的泉眼和瀑布、会随风摆动的草丛（实例化）、码头。
  - 远处有三座小岛和一块礁石：灯塔岛、椰子树岛、远山岛，用的是同一个地形生成器。
  - 环境效果：雾、云、海鸥、蝴蝶、萤火虫、偶尔跳出水面的鱼。
  - 影子来自太阳光的 shadow map。
- **她的角色**（`site/her3d.js` 是模型，`site/cast3d.js` 负责编排动作）：
  - 奶白色的小猫系粉色蝴蝶结，再配一匹薄荷绿的小马（她姓马）。
  - 她在线时（3 分钟内打开过页面），小猫在家附近溜达。不在线或者点了"我睡啦"，小猫就趴在小马背上睡觉。
  - 心情显示成小猫头顶的 emoji，同时会改变小猫的姿势。
  - 互动会在岛上真的演出来：小猫跑过去揍、端饭、抱抱、摸头、亲、击掌、戳；骑小马绕岛一圈。他那边有摸头、抱抱、亲、击掌、戳，送花时恐龙走过去，认错时恐龙对着小猫鞠躬。
  - 对方的动作会在你的页面上重演一遍（轮询间隔 12 秒）。
- **钓鱼**（`site/fish3d.js` 是模型；后端是 `POST /fish`）：
  - 抽奖在 Worker 里完成，用 `crypto.getRandomValues`，网页改不了概率。
  - 每人每天 3 竿免费，之后每竿 2 颗星，每天最多 10 竿。连续 14 竿没出史诗以上，第 15 竿保底。
  - 奖池有 15 样，分普通、稀有、史诗、传说四档。锦鲤、鲸鱼、海龟、宝箱和传说级的东西会给星星，第一次钓到新东西再加 1 颗。
  - 漂流瓶会随机捞起对方以前写的一张纸条（取出来的是密文，由网页自己解）。
  - 钓到过的鱼会在浅水区游来游去，图鉴里能看到收集进度。
- **后端新增**：
  - 事件类型 `mood`（只有她能发，每天第一次 +1 星）、`sleep`、`wake`、`act`。
  - `GET /events?who=` 会顺便记下在线状态，返回结果里带 `presence`。
  - `/wallet` 多返回三项：`fishbook`、`casts`、`fishRules`。
- **缓存**：静态资源带 `?v=10`。改了前端以后要把这个版本号加一，不然 GitHub Pages 最多 10 分钟内可能返回旧文件。

### 第四版地形（2026-11-08）
- 主岛移到了 `site/island3d.js`，地形按设计好的轮廓生成，不再是在圆上加噪声：
  - 用三条手摆的闭合样条描轮廓：海岸线 `COAST`、草地 `MEADOW`、后面的高台 `UPPER`。每条都换算成带符号的距离场，几层高度取最大值。
  - 正面是缓坡沙滩，两侧是矮崖，后面是高 1.5 的高台，背面就是海崖。高台左端有一条缓坡可以走上去。
- 水路依次是：高台上的泉眼和小溪 → 高台前沿的大瀑布 → 水潭 → 往左弯的小河 → 小木桥 → 流进左边的海湾。
- 颜色按坡度上：
  - 平地：草地，有成块的深浅色斑和小土路。
  - 陡坡：一层层岩石，顶点有起伏。
  - 低处：沙子和湿沙。
- 草地平面仍然在 y = 0，角色和装饰都站在这一层。
- 为了避开河道，帐篷挪到了右后方，路灯挪到了水潭旁边。

## 本地测试环境（和线上完全隔离）
```sh
./dev.sh          # 启动本地后端（本地 SQLite 版 D1）+ 本地页面；第一次会自动建表并塞 100 颗测试星星
./dev.sh reset    # 清空本地测试数据库重来
```
- 打开 `http://localhost:8765/?demo=green`：页面用演示数据（不用密码），所有互动走本地后端 `localhost:8787`，用测试密钥 `sha256("nest-dev")`。
- 两个浏览器窗口分别选"我是她"和"我是 Zilong"，可以互相看到对方的动作（12 秒轮询）。
- `worker/.dev.vars` 里的 ACCESS_HASH / SYS_HASH 只是测试值（系统令牌是 64 个 `a`）；线上密钥用 `wrangler secret` 设置，本地拿不到。
- 想单独测接口：`curl -H "authorization: Bearer <测试令牌>" localhost:8787/wallet`。测试令牌 = sha256(sha256("nest-dev") 的原始字节 + "nest-api-v1")。

## 第五版：扭蛋、种菜、每日一问、晚安、换装、布置、两座城市（2026-11-09）
- 前端模块：`extras3d.js` 负责场景编排；模型分在 `gacha3d.js`、`xmas3d.js`、`farm3d.js`、`outfit3d.js`、`weather3d.js` 里。每个模型文件都有对应的 `*-preview.html` 预览页。
- 后端新增 4 个接口：
  - `POST /gacha`：每人每天免费 1 次，之后每次 3 颗星，每天最多 6 次。11/20–1/2 有圣诞限定款。
  - `POST /farm`：种（plant）、浇水（water）、收获（harvest）。共 6 块地。
  - `GET /qa`：每日一问。题库按北京日期轮换，答案是密文。
  - `GET /world`：两座城市的天气和时区，后端从 Open-Meteo 代取并缓存 20 分钟。坐标存在密钥 `CITIES` 里（`wrangler secret put CITIES`）。
- 后端新增事件类型：
  - `answer`：回答每日一问
  - `night`：说晚安
  - `tuck`：给对方盖被子。对方 12 小时内说过晚安才能盖，盖了 +1 星
  - `wear`：小猫穿衣服或脱衣服
  - `move`：装饰的位置，n 的编码见 `decor3d.js` 的 `encodePos`
- 场景：
  - 天色跟着正在看的人自己的时间走。
  - 主岛显示自己城市的天气，对面那座岛显示对方城市的天气、昼夜和城市灯光，岛上有标牌。
  - 两个人同时在线时，两座岛之间出现彩虹桥。
  - 圣诞季（加 `?xmas` 可以提前预览）会出现圣诞树、拐杖糖、圣诞帽和小雪。

## 第六版：角色比例 + 实时同步（2026-11-09）
- **角色缩小**：小恐龙 0.88 倍，小猫 0.68 倍，小马 0.66 倍，大约齐到小木屋的门。两只角色互动、扭蛋、浇水的时候，镜头会自动推近拍特写（`scene3d.js` 的 `setFocus`），结束后退回全景。
- **谁点草地谁的角色走**：她点草地走的是小猫，他点走的是小恐龙。走到哪里会实时发给对方，对方屏幕上那只角色也会走过去。
- **实时房间**：`GET /rt` 是 WebSocket 接口，背后是一个 Durable Object（`Room`，SQLite 版，免费计划可用），前端连接代码在 `site/realtime.js`。
  - 鉴权：连上以后发的第一条消息里带令牌（`{"t":"auth","token","who"}`），令牌不放在网址里。
  - 实时同步的内容：
    - 走路位置（`pos`）；
    - 生气时揍的每一下（`act`）；
    - 新动态通知（`ev`）：收到后马上去拉 `/events`；
    - 在线状态（`presence`）：关掉页面后对方马上能看到。
  - 断线会自动重连；连不上的时候照旧每 12 秒轮询一次兜底。
  - 有频率限制：每个连接每秒最多 20 条消息，每条最多 512 字节。
