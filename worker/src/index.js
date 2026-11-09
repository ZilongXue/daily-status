// 小窝互动 API（Cloudflare Worker + D1）。
// GET  /events?since=<id>   拿 id 之后的互动记录（最多 200 条）
// POST /events              写一条：{ who, kind, item?, n?, box? }
// 认证：Authorization: Bearer <令牌>，令牌由页面密码派生，这里只存它的 sha256（ACCESS_HASH）。
// 自由文字只以密文（box）存；服务器能看到的只有类型、食物 id、次数和时间。
// POST /subscribe  存 Zilong 手机的网页推送订阅；她有动作时发一个"空"推送（不带内容），
//                  手机上的 service worker 自己来 /events 取新动态并显示通知。
// POST /push-test  给所有订阅发一个测试推送。
// GET  /wallet     星星金库（两个人共用）：余额、累计、已买的装饰、显示开关、最近的入账。
// POST /mint       只给 Mac 用（X-Nest-Sys 系统令牌）：按手环数据发星星，item 是唯一键（同一天同一条规则只发一次）。
// 购买走 POST /events {kind:"buy", item}：价格以这里的 SHOP 为准，余额不够或已经买过会被拒绝。
// POST /fish {who, pay?}  钓一竿：结果在这里抽（网页改不了概率）。每人每天 3 竿免费，之后每竿 2 颗星，每天最多 10 竿。
//                         连续 14 竿没出史诗以上，第 15 竿保底。漂流瓶会捞起对方以前写的一张纸条（密文，网页自己解）。
// GET /events?who=her|me  顺便记下"谁刚刚在线"，返回里带 presence。
// POST /gacha {who, pay?}  扭蛋：每人每天免费 1 次，之后每次 3 颗星，每天最多 6 次。圣诞季（11/20–1/2，北京时间）有限定款。
//                          重复的装饰换成 2 颗星。奖池里还有种子包和星星袋。
// POST /farm {who, act, plot, crop?}  种菜：plant（有种子用种子，没有就花星星买）/ water（每块地每天一次）/ harvest（浇够天数才能收）。
// GET  /qa                 每日一问：今天的问题、最近 14 天的问答（答案是密文）。回答走 POST /events {kind:"answer", item:日期, box}。
// GET  /world              两座城市此刻的天气和时区（Open-Meteo，后端代取，缓存 20 分钟；坐标在密钥 CITIES 里）。
// GET  /rt  (Upgrade: websocket)  实时通道，转给 Durable Object「Room」（全站只有一个实例 idFromName("nest")）。
//      不走 Authorization 头（浏览器 WebSocket 设不了头），令牌也不进 URL：连上后 5 秒内第一条消息必须是
//      {"t":"auth","token":"<64 位十六进制>","who":"me"|"her"}，校验方式和 Bearer 一样（sha256 对 ACCESS_HASH），失败关闭 4001。
//      Origin 必须在 ALLOWED_ORIGINS 里。协议：
//        服务器 → {"t":"welcome","online":{me,her}}            认证成功
//        双向   {"t":"pos","x","z"}  → 转发给其他连接 {"t":"pos","who","x","z"}（|x|,|z| < 10）
//        双向   {"t":"act","kind","item"?} → 转发给其他连接 {"t":"act","who","kind","item"}（临时动作，不入库）
//        客户端 {"t":"ping"} → {"t":"pong"}（运行时自动回，不唤醒 DO）
//        服务器 → {"t":"presence","online":{me,her}}          某人第一个连接上线 / 最后一个连接下线
//        服务器 → {"t":"ev","who","kind","id"}                 有新的写入（/events POST、/fish、/gacha、/farm），页面马上拉一次 /events
//      每个连接每秒最多约 20 条、每条最多 512 字节，多的直接丢掉。GET /events 的返回带 rt: true 表示有这个通道。

import { DurableObject } from "cloudflare:workers";

const KINDS = new Set(["feed", "angry", "hit", "calm", "sorry", "flower", "note", "nudge", "buy", "place", "mood", "sleep", "wake", "act", "answer", "night", "tuck", "wear", "move"]);
const MOODS = new Set(["happy", "tired", "miss", "angry", "sleepy"]);
const ACTS = new Set(["hug", "pat", "highfive", "poke", "ride", "kiss"]);
// 钓鱼奖池：[id, 稀有度, 权重, 星星]。chest 的星星是 5–10 随机。第一次钓到某样东西再 +1。
const POOL = [
  ["crucian", "common", 14, 0], ["clown", "common", 14, 0], ["puffer", "common", 12, 0], ["shrimp", "common", 12, 0], ["boot", "common", 8, 0],
  ["koi", "rare", 8, 2], ["jelly", "rare", 7, 0], ["octopus", "rare", 7, 0], ["bottle", "rare", 6, 0],
  ["whale", "epic", 4, 3], ["turtle", "epic", 4, 3], ["chest", "epic", 2, -1],
  ["goldkoi", "legend", 0.8, 10], ["mermaid", "legend", 0.6, 8], ["star", "legend", 0.6, 15],
];
const RARITY = Object.fromEntries(POOL.map(([id, r]) => [id, r]));
const FREE_CASTS = 3, CAST_PRICE = 2, MAX_CASTS = 10, PITY = 15;
// 装饰的价格（星星）。"snow" 是天气：买了以后可以开关下雪。
const SHOP = {
  flowers_bed: 5, mushrooms: 6, fence: 6, mailbox: 8, bench: 8, lamppost: 10, lights: 12, gifts: 12,
  campfire: 15, snowman: 15, snow: 15, telescope: 18, swing: 20, tent: 20, sakura: 25, pond: 25,
  balloon: 30, windmill: 35, cabin: 45,
};
// 小猫的衣橱（星星价格）
const OUTFITS = {
  santa_hat: 8, beanie: 6, flower_crown: 8, beret: 6, witch_hat: 10, crown: 15, bunny_ears: 8,
  round_glasses: 5, heart_sunglasses: 8, red_scarf: 5, knit_scarf: 6, bow_tie: 5,
};
const OUTFIT_SLOT = { santa_hat: "head", beanie: "head", flower_crown: "head", beret: "head", witch_hat: "head", crown: "head", bunny_ears: "head",
  round_glasses: "face", heart_sunglasses: "face", red_scarf: "neck", knit_scarf: "neck", bow_tie: "neck" };
const BUYABLE = { ...SHOP, ...OUTFITS };
// 扭蛋奖池：[奖品, 稀有度, 权重, 季节]。奖品是装饰 id，或 seeds（随机 2 包种子）/ stars3 / stars8（星星袋）。
const GACHA = [
  ["paper_lantern", "common", 9], ["pinwheel", "common", 9], ["mushroom_lamp", "common", 9], ["bird_house", "common", 9],
  ["seeds", "common", 16], ["stars3", "common", 10],
  ["cat_tower", "rare", 7], ["hammock", "rare", 7], ["star_lamp", "rare", 7], ["stars8", "rare", 4],
  ["carousel", "epic", 2.5], ["hot_air_heart", "epic", 2.5],
  ["candy_lane", "common", 12, "xmas"], ["gingerbread", "rare", 8, "xmas"], ["snow_family", "rare", 8, "xmas"],
  ["xmas_tree", "rare", 6, "xmas"], ["reindeer", "epic", 3, "xmas"],
];
const GACHA_DECOR = new Set(GACHA.filter(([id]) => !/^(seeds|stars\d+)$/.test(id)).map(([id]) => id));
const GACHA_RARITY = Object.fromEntries(GACHA.map(([id, r]) => [id, r]));
const GACHA_PRICE = 3, GACHA_MAX = 6;
// 菜地：6 块地；days = 浇几天水能收，seed = 种子价，reward = 收获的星星
const PLOTS = 6;
const CROPS = {
  tomato: { days: 2, seed: 2, reward: 4 }, strawberry: { days: 3, seed: 3, reward: 6 }, carrot: { days: 2, seed: 2, reward: 4 },
  sunflower: { days: 3, seed: 3, reward: 6 }, tulip: { days: 2, seed: 2, reward: 4 }, pumpkin: { days: 4, seed: 4, reward: 9 },
  poinsettia: { days: 3, seed: 3, reward: 7, season: "xmas" },
};
const isXmas = (ts = Date.now()) => { const d = bjDay(ts).slice(5); return d >= "11-20" || d <= "01-02"; };
// 每日一问（按北京日期轮换）
const QUESTIONS = [
  "今天最开心的一件小事是什么？", "最近一次想我是在干嘛的时候？", "如果明天就能见面，第一件事想做什么？", "最想和我一起去的地方是哪里？",
  "今天吃到最好吃的是什么？", "你觉得我身上最可爱的一个小习惯是？", "最近有什么让你有点烦的事吗？说出来我陪你骂", "我们第一次见面你记得最清楚的细节是？",
  "如果我们一起养一只宠物，叫什么名字？", "最近循环最多的一首歌？", "今天给自己打几分（满分 10）？为什么？", "最想让我学会做的一道菜？",
  "你小时候最喜欢的动画片？", "如果有一天假期，我们宅在家要做什么？", "你觉得我们俩谁更粘人？", "最近一次被我感动是什么时候？",
  "想对一年后的我们说一句什么？", "今天有没有一个瞬间特别想发消息给我？", "如果可以瞬移，现在最想出现在哪？", "你最喜欢我叫你的哪个称呼？",
  "下次见面想一起吃什么？", "这周最期待的一件事？", "你觉得自己最近哪里变好了？", "如果我们一起开一家小店，卖什么？",
  "最近一次大笑是因为什么？", "你最喜欢的季节，为什么？", "睡前一般会想什么？", "有什么一直想试但还没试过的事？",
  "如果用一种食物形容我，是什么？", "今天有没有好好喝水？喝了几杯？", "最想收到的礼物是什么？", "你觉得异地最难的是什么？我们可以怎么做得更好？",
  "最近看了什么好看的剧或电影？", "如果给我们的小岛再加一样东西，加什么？", "你最喜欢我们的哪一张合照？", "今天穿了什么颜色的衣服？",
  "一个人的时候最喜欢做什么？", "如果明天下雪，你想干嘛？", "你觉得我们的恋爱像什么天气？", "最近有没有想吃但没吃到的东西？",
  "如果能回到过去某一天，选哪一天？", "最近一次夸自己是什么时候？", "你心里的理想周末长什么样？", "如果我们一起旅行，你负责什么我负责什么？",
  "今天的天空是什么颜色的？", "给今天的自己一个小奖励，你选什么？", "你最怕什么小动物？", "如果我现在在你旁边，你想我做什么？",
  "最近学到的一个新东西？", "你觉得我最近累不累？想对我说什么？", "今年最想完成的一件事？", "如果要给小猫起个外号，叫什么？",
  "最喜欢的零食 Top 3？", "你会怎么形容我们的第一次约会？", "今天有没有遇到可爱的陌生人或小动物？", "等我们老了，想住在什么样的地方？",
  "最近一次哭是因为什么？（可以不说～）", "如果今天可以不上班/上课，你会去哪？", "你最想和我一起完成的一件小事？", "现在最想听我说的一句话是什么？",
];
const STAR_RE = /^[a-z0-9_]{2,20}(:[0-9-]{4,10})?$/;
const FOODS = { rice: "饭团", cake: "小蛋糕", tea: "奶茶", berry: "草莓", noodle: "一碗面", veggie: "青菜" };
const MAX_BOX = 4096;
const DAILY_CAP = 3000;

export default {
  async fetch(req, env, ctx) {
    const cors = corsHeaders(req, env);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const url = new URL(req.url);
    if (url.pathname === "/rt") return roomConnect(req, env);
    if (!["/events", "/push-test", "/subscribe", "/wallet", "/mint", "/fish", "/gacha", "/farm", "/qa", "/world"].includes(url.pathname)) return json({ error: "not found" }, 404, cors);
    if (url.pathname === "/mint") {
      if (req.method !== "POST" || !(await sysAuthorized(req, env))) return json({ error: "unauthorized" }, 401, cors);
      let b;
      try { b = await req.json(); } catch { return json({ error: "bad json" }, 400, cors); }
      if (!b || typeof b.item !== "string" || !STAR_RE.test(b.item) || !(Number.isInteger(b.n) && b.n > 0 && b.n <= 20)) return json({ error: "bad mint" }, 400, cors);
      const made = await mint(env, b.item, b.n);
      return json({ minted: made }, made ? 201 : 200, cors);
    }
    if (!(await authorized(req, env))) return json({ error: "unauthorized" }, 401, cors);
    if (url.pathname === "/wallet" && req.method === "GET") return json(await wallet(env), 200, cors);
    if (url.pathname === "/qa" && req.method === "GET") return json(await qa(env), 200, cors);
    if (url.pathname === "/world" && req.method === "GET") return json(await world(env, ctx), 200, cors);
    if ((url.pathname === "/gacha" || url.pathname === "/farm") && req.method === "POST") {
      let b;
      try { b = await req.json(); } catch { return json({ error: "bad json" }, 400, cors); }
      if (!b || (b.who !== "me" && b.who !== "her")) return json({ error: "bad who" }, 400, cors);
      const r = url.pathname === "/gacha" ? await gacha(env, b.who, b.pay === true) : await farm(env, b);
      if (r.error) return json(r, r.status || 400, cors);
      ctx.waitUntil(push(env, { who: b.who, kind: url.pathname.slice(1), item: r.prize || r.act }).catch(() => {}));
      ctx.waitUntil(notifyRoom(env, { who: b.who, kind: url.pathname.slice(1), id: r.id ?? null })); // /farm 的返回没有 id，传 null
      return json(r, 201, cors);
    }
    if (url.pathname === "/fish" && req.method === "POST") {
      let b;
      try { b = await req.json(); } catch { return json({ error: "bad json" }, 400, cors); }
      if (!b || (b.who !== "me" && b.who !== "her")) return json({ error: "bad who" }, 400, cors);
      const r = await fish(env, b.who, b.pay === true);
      if (r.error) return json(r, r.status, cors);
      ctx.waitUntil(push(env, { who: b.who, kind: "fish", item: r.catch }).catch(() => {}));
      ctx.waitUntil(notifyRoom(env, { who: b.who, kind: "fish", id: r.id }));
      return json(r, 201, cors);
    }

    if (url.pathname === "/push-test" && req.method === "POST") {
      const sent = await pushAll(env);
      return json({ sent }, 200, cors);
    }
    if (url.pathname === "/subscribe" && req.method === "POST") {
      let b;
      try { b = await req.json(); } catch { return json({ error: "bad json" }, 400, cors); }
      const ep = b && b.sub && b.sub.endpoint;
      if (b.who !== "me" || typeof ep !== "string" || ep.length > 1000 || !/^https:\/\//.test(ep)) return json({ error: "bad subscription" }, 400, cors);
      await env.DB.prepare("INSERT OR REPLACE INTO subs (endpoint, who, ts) VALUES (?, ?, ?)").bind(ep, "me", Date.now()).run();
      return json({ ok: true }, 201, cors);
    }

    if (req.method === "GET") {
      const since = Math.max(0, parseInt(url.searchParams.get("since") || "0", 10) || 0);
      const who = url.searchParams.get("who");
      if (who === "me" || who === "her") ctx.waitUntil(env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)").bind("seen:" + who, String(Date.now())).run());
      const { results: seen } = await env.DB.prepare("SELECT k, v FROM meta WHERE k IN ('seen:me', 'seen:her')").all();
      const presence = Object.fromEntries(seen.map((x) => [x.k.slice(5), Number(x.v)]));
      const { results } = await env.DB.prepare(
        "SELECT id, ts, who, kind, item, n, box FROM events WHERE id > ? ORDER BY id DESC LIMIT 200").bind(since).all();
      return json({ events: results.reverse(), now: Date.now(), presence, rt: true }, 200, cors);
    }

    if (req.method === "POST") {
      let e;
      try { e = await req.json(); } catch { return json({ error: "bad json" }, 400, cors); }
      const err = validate(e);
      if (err) return json({ error: err }, 400, cors);
      const dayAgo = Date.now() - 86400000;
      const { c } = await env.DB.prepare("SELECT COUNT(*) AS c FROM events WHERE ts > ?").bind(dayAgo).first();
      if (c >= DAILY_CAP) return json({ error: "too many events today" }, 429, cors);
      if (e.kind === "buy") {
        const w = await wallet(env);
        if (w.owned.includes(e.item)) return json({ error: "already owned" }, 409, cors);
        if (w.balance < BUYABLE[e.item]) return json({ error: "not enough stars", balance: w.balance }, 402, cors);
        e.n = BUYABLE[e.item]; // 价格以服务器为准
      }
      if (e.kind === "place" || e.kind === "move" || e.kind === "wear") {
        const w = await wallet(env);
        if (!w.owned.includes(e.item)) return json({ error: "not owned" }, 409, cors);
      }
      if (e.kind === "answer") {
        const today = bjDay(), yday = bjDay(Date.now() - 86400000);
        if (e.item !== today && e.item !== yday) return json({ error: "bad day" }, 400, cors);
        const dup = await env.DB.prepare("SELECT 1 FROM events WHERE kind = 'answer' AND who = ? AND item = ?").bind(e.who, e.item).first();
        if (dup) return json({ error: "already answered" }, 409, cors);
      }
      if (e.kind === "tuck") { // 给对方盖被子：对方 12 小时内说过晚安，而且我还没盖过
        const other = e.who === "me" ? "her" : "me";
        const night = await env.DB.prepare("SELECT id FROM events WHERE who = ? AND kind IN ('night', 'sleep') AND ts > ? ORDER BY id DESC LIMIT 1").bind(other, Date.now() - 12 * 3600000).first();
        if (!night) return json({ error: "nobody to tuck in" }, 409, cors);
        const done = await env.DB.prepare("SELECT 1 FROM events WHERE who = ? AND kind = 'tuck' AND id > ?").bind(e.who, night.id).first();
        if (done) return json({ error: "already tucked" }, 409, cors);
      }
      const ts = Date.now();
      const r = await env.DB.prepare("INSERT INTO events (ts, who, kind, item, n, box) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(ts, e.who, e.kind, e.item ?? null, e.n ?? null, e.box ?? null).run();
      ctx.waitUntil(Promise.all([push(env, e), rewards(env, e)]).catch(() => {}));
      ctx.waitUntil(notifyRoom(env, { who: e.who, kind: e.kind, id: r.meta.last_row_id }));
      return json({ id: r.meta.last_row_id, ts }, 201, cors);
    }
    return json({ error: "method not allowed" }, 405, cors);
  },
};

function validate(e) {
  if (!e || typeof e !== "object") return "bad body";
  if (e.who !== "me" && e.who !== "her") return "bad who";
  if (!KINDS.has(e.kind)) return "bad kind";
  if (e.kind === "feed" && !(e.item in FOODS)) return "bad food";
  if (e.kind === "buy" && !(e.item in BUYABLE)) return "bad shop item";
  if ((e.kind === "place" || e.kind === "move") && !(e.item in SHOP || GACHA_DECOR.has(e.item))) return "bad decor";
  if (e.kind === "place" && e.n !== 0 && e.n !== 1) return "bad place";
  if (e.kind === "wear" && (!(e.item in OUTFITS) || (e.n !== 0 && e.n !== 1))) return "bad wear";
  if (e.kind === "answer" && (!/^\d{4}-\d{2}-\d{2}$/.test(e.item || "") || !e.box)) return "bad answer";
  if (e.kind === "move") { if (!(Number.isInteger(e.n) && e.n >= 0 && e.n < 401 * 1000 * 8)) return "bad move"; return null; }
  if (e.kind === "mood" && (e.who !== "her" || !MOODS.has(e.item))) return "bad mood";
  if ((e.kind === "sleep" || e.kind === "wake") && e.who !== "her") return "bad sleep";
  if (e.kind === "act" && !ACTS.has(e.item)) return "bad act";
  if (e.item != null && (typeof e.item !== "string" || e.item.length > 24)) return "bad item";
  if (e.n != null && !(Number.isInteger(e.n) && e.n >= 0 && e.n <= 500)) return "bad n";
  if (e.box != null && (typeof e.box !== "string" || e.box.length > MAX_BOX || !/^[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$/.test(e.box))) return "bad box";
  return null;
}

async function sha256hex(s) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function authorized(req, env) {
  const m = /^Bearer ([0-9a-f]{64})$/.exec(req.headers.get("authorization") || "");
  return !!m && tokenOk(m[1], env);
}

// 令牌校验（HTTP 的 Bearer 和 WebSocket 的 auth 消息共用）：sha256(令牌) 和 ACCESS_HASH 做定长比较。
async function tokenOk(token, env) {
  if (typeof token !== "string" || !/^[0-9a-f]{64}$/.test(token) || !env.ACCESS_HASH) return false;
  const got = await sha256hex(token);
  const want = env.ACCESS_HASH.trim().toLowerCase();
  let diff = got.length ^ want.length;
  for (let i = 0; i < Math.min(got.length, want.length); i++) diff |= got.charCodeAt(i) ^ want.charCodeAt(i);
  return diff === 0;
}

async function sysAuthorized(req, env) {
  const t = req.headers.get("x-nest-sys") || "";
  if (!/^[0-9a-f]{64}$/.test(t) || !env.SYS_HASH) return false;
  return (await sha256hex(t)) === env.SYS_HASH.trim().toLowerCase();
}

// ---------------------------------------------------------------- 星星
// 入账都是 who='sys' 的 star 事件，item 是唯一键（例如 bed:2026-11-08），n 是颗数。
async function mint(env, item, n) {
  const dup = await env.DB.prepare("SELECT 1 FROM events WHERE who = 'sys' AND kind = 'star' AND item = ?").bind(item).first();
  if (dup) return false;
  await env.DB.prepare("INSERT INTO events (ts, who, kind, item, n) VALUES (?, 'sys', 'star', ?, ?)").bind(Date.now(), item, n).run();
  return true;
}

async function wallet(env) {
  const { earned } = await env.DB.prepare("SELECT COALESCE(SUM(n), 0) AS earned FROM events WHERE who = 'sys' AND kind = 'star'").first();
  const { spent } = await env.DB.prepare("SELECT COALESCE(SUM(n), 0) AS spent FROM events WHERE kind IN ('buy', 'fish', 'gacha', 'spend')").first();
  const { results: buys0 } = await env.DB.prepare("SELECT item FROM events WHERE kind = 'buy' ORDER BY id").all();
  const { results: gachas } = await env.DB.prepare("SELECT DISTINCT item FROM events WHERE kind = 'gacha' AND item NOT LIKE 'seed%' AND item NOT LIKE 'stars%'").all();
  const buys = [...buys0, ...gachas.filter((g) => GACHA_DECOR.has(g.item) && !buys0.some((b) => b.item === g.item))];
  const { results: places } = await env.DB.prepare("SELECT item, n FROM events WHERE kind = 'place' ORDER BY id").all();
  const { results: recent } = await env.DB.prepare("SELECT ts, item, n FROM events WHERE who = 'sys' AND kind = 'star' ORDER BY id DESC LIMIT 30").all();
  const shown = {};
  for (const b of buys) shown[b.item] = 1;
  for (const p of places) shown[p.item] = p.n;
  const { results: book } = await env.DB.prepare("SELECT item, COUNT(*) AS c FROM events WHERE kind = 'fish' GROUP BY item").all();
  const dayStart = Date.parse(bjDay() + "T00:00:00+08:00");
  const { results: today } = await env.DB.prepare("SELECT who, COUNT(*) AS c FROM events WHERE kind = 'fish' AND ts >= ? GROUP BY who").bind(dayStart).all();
  const casts = { me: 0, her: 0 };
  for (const x of today) casts[x.who] = x.c;
  const { results: moves } = await env.DB.prepare("SELECT item, n FROM events WHERE kind = 'move' ORDER BY id").all();
  const pos = {};
  for (const m of moves) pos[m.item] = m.n;
  const { results: wears } = await env.DB.prepare("SELECT item, n FROM events WHERE kind = 'wear' ORDER BY id").all();
  const worn = {};
  for (const x of wears) {
    if (x.n) { for (const k of Object.keys(worn)) if (OUTFIT_SLOT[k] === OUTFIT_SLOT[x.item]) delete worn[k]; worn[x.item] = 1; }
    else delete worn[x.item];
  }
  for (const k of Object.keys(shown)) if (k in OUTFITS) delete shown[k];
  const gday = bjDay(), gStart = Date.parse(gday + "T00:00:00+08:00");
  const { results: gToday } = await env.DB.prepare("SELECT who, COUNT(*) AS c FROM events WHERE kind = 'gacha' AND ts >= ? GROUP BY who").bind(gStart).all();
  const spins = { me: 0, her: 0 };
  for (const x of gToday) spins[x.who] = x.c;
  return { balance: earned - spent, earned, owned: buys.map((b) => b.item), shown, recent, prices: SHOP, outfits: OUTFITS, worn, pos, spins,
    gachaRules: { free: 1, price: GACHA_PRICE, max: GACHA_MAX, xmas: isXmas() }, farm: await farmState(env),
    fishbook: Object.fromEntries(book.map((x) => [x.item, x.c])), casts, fishRules: { free: FREE_CASTS, price: CAST_PRICE, max: MAX_CASTS } };
}

// ---------------------------------------------------------------- 钓鱼
async function fish(env, who, pay) {
  const dayStart = Date.parse(bjDay() + "T00:00:00+08:00");
  const { c } = await env.DB.prepare("SELECT COUNT(*) AS c FROM events WHERE kind = 'fish' AND who = ? AND ts >= ?").bind(who, dayStart).first();
  if (c >= MAX_CASTS) return { error: "no more casts today", status: 429 };
  let cost = 0;
  if (c >= FREE_CASTS) {
    if (!pay) return { error: "free casts used", status: 402, price: CAST_PRICE };
    const w = await wallet(env);
    if (w.balance < CAST_PRICE) return { error: "not enough stars", status: 402, balance: w.balance };
    cost = CAST_PRICE;
  }
  // 保底：最近 PITY-1 竿都没有史诗以上，这一竿只在史诗 / 传说里抽
  const { results: lastCasts } = await env.DB.prepare("SELECT item FROM events WHERE kind = 'fish' ORDER BY id DESC LIMIT ?").bind(PITY - 1).all();
  const pity = lastCasts.length >= PITY - 1 && lastCasts.every((x) => RARITY[x.item] === "common" || RARITY[x.item] === "rare");
  const pool = pity ? POOL.filter(([, r]) => r === "epic" || r === "legend") : POOL;
  const total = pool.reduce((a, p) => a + p[2], 0);
  let x = (crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32) * total, pick = pool[0];
  for (const p of pool) { if ((x -= p[2]) < 0) { pick = p; break; } }
  const [id, rarity, , base] = pick;
  const first = !(await env.DB.prepare("SELECT 1 FROM events WHERE kind = 'fish' AND item = ?").bind(id).first());
  const ts = Date.now();
  const r = await env.DB.prepare("INSERT INTO events (ts, who, kind, item, n) VALUES (?, ?, 'fish', ?, ?)").bind(ts, who, id, cost).run();
  const fid = r.meta.last_row_id;
  let stars = base < 0 ? 5 + (crypto.getRandomValues(new Uint8Array(1))[0] % 6) : base;
  if (first) stars += 1;
  if (stars > 0) await mint(env, `fish:${fid}`, stars);
  let note = null;
  if (id === "bottle") { // 漂流瓶：随机捞一张对方写过的纸条
    const other = who === "her" ? "me" : "her";
    const n = await env.DB.prepare("SELECT ts, box FROM events WHERE kind = 'note' AND who = ? AND box IS NOT NULL ORDER BY RANDOM() LIMIT 1").bind(other).first();
    if (n) note = { ts: n.ts, box: n.box };
  }
  return { id: fid, ts, catch: id, rarity, stars, first, cost, pity, note, used: c + 1, free: FREE_CASTS, max: MAX_CASTS };
}

// ---------------------------------------------------------------- 扭蛋
const rand01 = () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
async function gacha(env, who, pay) {
  const dayStart = Date.parse(bjDay() + "T00:00:00+08:00");
  const { c } = await env.DB.prepare("SELECT COUNT(*) AS c FROM events WHERE kind = 'gacha' AND who = ? AND ts >= ?").bind(who, dayStart).first();
  if (c >= GACHA_MAX) return { error: "no more spins today", status: 429 };
  let cost = 0;
  if (c >= 1) {
    if (!pay) return { error: "free spin used", status: 402, price: GACHA_PRICE };
    const w = await wallet(env);
    if (w.balance < GACHA_PRICE) return { error: "not enough stars", status: 402, balance: w.balance };
    cost = GACHA_PRICE;
  }
  const xmas = isXmas();
  const pool = GACHA.filter((g) => !g[3] || (g[3] === "xmas" && xmas));
  const total = pool.reduce((a, g) => a + g[2], 0);
  let x = rand01() * total, pick = pool[0];
  for (const g of pool) { if ((x -= g[2]) < 0) { pick = g; break; } }
  let [prize, rarity] = pick;
  let stars = 0, seeds = null, dup = false;
  if (prize === "stars3") stars = 3;
  if (prize === "stars8") stars = 8;
  if (prize === "seeds") {
    const ids = Object.keys(CROPS).filter((k) => !CROPS[k].season || (CROPS[k].season === "xmas" && xmas));
    seeds = [ids[Math.floor(rand01() * ids.length)], ids[Math.floor(rand01() * ids.length)]];
  }
  if (GACHA_DECOR.has(prize)) {
    const owned = await env.DB.prepare("SELECT 1 FROM events WHERE kind = 'gacha' AND item = ?").bind(prize).first();
    if (owned) { dup = true; stars = 2; }
  }
  const ts = Date.now();
  const r = await env.DB.prepare("INSERT INTO events (ts, who, kind, item, n) VALUES (?, ?, 'gacha', ?, ?)").bind(ts, who, prize, cost).run();
  const id = r.meta.last_row_id;
  if (seeds) for (const sd of seeds) await env.DB.prepare("INSERT INTO events (ts, who, kind, item, n) VALUES (?, ?, 'seed', ?, 1)").bind(ts, who, sd).run();
  if (stars) await mint(env, `gacha:${id}`, stars);
  return { id, ts, prize, rarity, stars, seeds, dup, cost, used: c + 1, max: GACHA_MAX, xmas };
}

// ---------------------------------------------------------------- 菜地
async function farmState(env) {
  const { results } = await env.DB.prepare("SELECT id, ts, kind, item, n FROM events WHERE kind IN ('farm', 'seed') ORDER BY id").all();
  const plots = Array.from({ length: PLOTS }, () => null);
  const seeds = {};
  for (const e of results) {
    if (!e.item) continue;
    if (e.kind === "seed") { seeds[e.item] = (seeds[e.item] || 0) + 1; continue; } // 扭蛋送的种子
    const [act, crop] = e.item.split(":");
    if (act === "useseed") { if (seeds[crop]) seeds[crop]--; continue; }
    const p = e.n;
    if (!(p >= 0 && p < PLOTS)) continue;
    if (act === "plant") plots[p] = { crop, planted: e.ts, days: [], lastWater: null };
    if (act === "water" && plots[p]) { const d = bjDay(e.ts); if (!plots[p].days.includes(d)) plots[p].days.push(d); plots[p].lastWater = e.ts; }
    if (act === "harvest") plots[p] = null;
  }
  const today = bjDay();
  return {
    seeds,
    plots: plots.map((x) => {
      if (!x) return null;
      const need = CROPS[x.crop] ? CROPS[x.crop].days : 3;
      const watered = x.days.length, ready = watered >= need;
      const since = Date.now() - (x.lastWater || x.planted);
      return { crop: x.crop, watered, need, ready, wateredToday: x.days.includes(today), wilted: !ready && since > 2 * 86400000 };
    }),
    crops: CROPS,
    xmas: isXmas(),
  };
}
async function farm(env, b) {
  const p = b.plot;
  if (!(Number.isInteger(p) && p >= 0 && p < PLOTS)) return { error: "bad plot" };
  const st = await farmState(env);
  const cur = st.plots[p];
  const ts = Date.now();
  const add = (item, n = p, kind = "farm") => env.DB.prepare("INSERT INTO events (ts, who, kind, item, n) VALUES (?, ?, ?, ?, ?)").bind(ts, b.who, kind, item, n).run();
  if (b.act === "plant") {
    const c = CROPS[b.crop];
    if (!c || (c.season === "xmas" && !st.xmas)) return { error: "bad crop" };
    if (cur) return { error: "plot taken", status: 409 };
    let paid = 0;
    if (st.seeds[b.crop] > 0) await add(`useseed:${b.crop}`);
    else {
      const w = await wallet(env);
      if (w.balance < c.seed) return { error: "not enough stars", status: 402, balance: w.balance };
      await add(`seed:${b.crop}`, c.seed, "spend");
      paid = c.seed;
    }
    await add(`plant:${b.crop}`);
    return { act: "plant", plot: p, crop: b.crop, paid };
  }
  if (b.act === "water") {
    if (!cur) return { error: "nothing planted", status: 409 };
    if (cur.wateredToday) return { error: "already watered today", status: 409 };
    if (cur.ready) return { error: "ready to harvest", status: 409 };
    await add("water");
    return { act: "water", plot: p, crop: cur.crop, watered: cur.watered + 1, need: cur.need };
  }
  if (b.act === "harvest") {
    if (!cur || !cur.ready) return { error: "not ready", status: 409 };
    const r = await add(`harvest:${cur.crop}`);
    const stars = CROPS[cur.crop].reward;
    await mint(env, `harvest:${r.meta.last_row_id}`, stars);
    return { act: "harvest", plot: p, crop: cur.crop, stars };
  }
  return { error: "bad act" };
}

// ---------------------------------------------------------------- 每日一问
function questionFor(day) {
  const n = Math.floor(Date.parse(day + "T00:00:00Z") / 86400000);
  return QUESTIONS[((n % QUESTIONS.length) + QUESTIONS.length) % QUESTIONS.length];
}
async function qa(env) {
  const today = bjDay();
  const since = bjDay(Date.now() - 14 * 86400000);
  const { results } = await env.DB.prepare("SELECT ts, who, item, box FROM events WHERE kind = 'answer' AND item >= ? ORDER BY id").bind(since).all();
  const days = {};
  for (const r of results) (days[r.item] ||= { day: r.item, question: questionFor(r.item), answers: [] }).answers.push({ who: r.who, ts: r.ts, box: r.box });
  days[today] ||= { day: today, question: questionFor(today), answers: [] };
  return { today, days: Object.values(days).sort((a, b) => (a.day < b.day ? 1 : -1)) };
}

// ---------------------------------------------------------------- 两座城市的天气（Open-Meteo，后端代取）
const WMO = (c) => (c <= 1 ? "clear" : c <= 3 ? "cloudy" : c === 45 || c === 48 ? "fog" : c >= 95 ? "storm" : (c >= 71 && c <= 77) || c === 85 || c === 86 ? "snow" : (c >= 51 && c <= 67) || (c >= 80 && c <= 82) ? "rain" : "cloudy");
async function world(env, ctx) {
  const cached = await env.DB.prepare("SELECT v FROM meta WHERE k = 'world'").first();
  if (cached) { const w = JSON.parse(cached.v); if (Date.now() - w.at < 20 * 60000) return w; }
  let cities = {};
  try { cities = JSON.parse(env.CITIES || "{}"); } catch {}
  const out = { at: Date.now() };
  for (const who of ["me", "her"]) {
    const c = cities[who];
    if (!c) continue;
    try {
      const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${c.lat}&longitude=${c.lon}&current=temperature_2m,weather_code,is_day&timezone=auto`, { headers: { "user-agent": "nest-api/1.0" } });
      const j = await r.json();
      out[who] = { label: c.label || "", offset: Math.round((j.utc_offset_seconds || 0) / 60), temp: Math.round(j.current.temperature_2m), code: j.current.weather_code, kind: WMO(j.current.weather_code), isDay: !!j.current.is_day };
    } catch { out[who] = null; }
  }
  ctx.waitUntil(env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('world', ?)").bind(JSON.stringify(out)).run());
  return out;
}

// 你们俩互动触发的星星（按北京时间算"一天"，她在国内）
const bjDay = (ts = Date.now()) => new Date(ts + 8 * 3600000).toISOString().slice(0, 10);
async function rewards(env, e) {
  const day = bjDay();
  if (e.kind === "feed" && e.who === "her") await mint(env, `feed:${day}`, 1);
  if (e.kind === "calm") await mint(env, `calm:${day}`, 1);
  if (e.kind === "mood" && e.who === "her") await mint(env, `mood:${day}`, 1);
  if (e.kind === "answer") {
    const { results } = await env.DB.prepare("SELECT DISTINCT who FROM events WHERE kind = 'answer' AND item = ?").bind(e.item).all();
    if (results.length >= 2) await mint(env, `qa:${e.item}`, 2);
  }
  if (e.kind === "tuck") await mint(env, `tuck_${e.who}:${day}`, 1);
  if (e.kind === "note") {
    const since = Date.parse(day + "T00:00:00+08:00");
    const { results } = await env.DB.prepare("SELECT DISTINCT who FROM events WHERE kind = 'note' AND ts >= ?").bind(since).all();
    if (results.length >= 2) await mint(env, `notes:${day}`, 1);
  }
}

function corsHeaders(req, env) {
  const origin = req.headers.get("origin") || "";
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim());
  return {
    "access-control-allow-origin": allowed.includes(origin) ? origin : allowed[0] || "",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type, x-nest-sys",
    "access-control-max-age": "86400",
    vary: "origin",
  };
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, "content-type": "application/json; charset=utf-8" } });
}

// ---------------------------------------------------------------- 网页推送（发给 Zilong 的安卓 Chrome）
// 只推她那边的动作；揍人类的高频动作做节流。推送不带任何内容（payload 为空），
// 通知文字由手机上的 service worker 自己拉 /events 生成，推送服务（FCM）看不到内容。
async function push(env, e) {
  if (e.who !== "her" || !["feed", "angry", "hit", "calm", "note", "nudge", "buy", "mood", "sleep", "wake", "act", "fish", "answer", "tuck", "gacha"].includes(e.kind)) return;
  if (e.kind === "fish" && RARITY[e.item] === "common") return; // 钓到普通的不打扰你
  if (e.kind === "gacha" && GACHA_RARITY[e.item] !== "epic") return;
  if (e.kind === "hit") {
    const last = await env.DB.prepare("SELECT v FROM meta WHERE k = 'push_hit'").first();
    if (last && Date.now() - Number(last.v) < 10 * 60000) return; // 10 分钟最多推一次
    await env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('push_hit', ?)").bind(String(Date.now())).run();
  }
  await pushAll(env);
}

async function pushAll(env) {
  if (!env.VAPID_PRIVATE_JWK || !env.VAPID_PUBLIC) return 0;
  const { results } = await env.DB.prepare("SELECT endpoint FROM subs WHERE who = 'me'").all();
  let sent = 0;
  for (const { endpoint } of results) {
    const r = await fetch(endpoint, {
      method: "POST",
      headers: { TTL: "3600", Urgency: "high", "Content-Length": "0", Authorization: await vapidAuth(env, endpoint) },
    });
    if (r.status === 404 || r.status === 410) await env.DB.prepare("DELETE FROM subs WHERE endpoint = ?").bind(endpoint).run();
    else if (r.ok) sent++;
  }
  return sent;
}

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlStr = (str) => b64url(new TextEncoder().encode(str));

async function vapidAuth(env, endpoint) {
  const jwk = JSON.parse(env.VAPID_PRIVATE_JWK);
  const key = await crypto.subtle.importKey("jwk", { ...jwk, ext: true }, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const head = b64urlStr(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const body = b64urlStr(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: env.VAPID_SUBJECT }));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(head + "." + body));
  return `vapid t=${head}.${body}.${b64url(sig)}, k=${env.VAPID_PUBLIC}`;
}

// ---------------------------------------------------------------- 实时同步（Durable Object + WebSocket 休眠 API）
// 全站只有一个房间（idFromName("nest")），两个人的所有标签页 / 设备都连到这里。
// 用休眠 API（ctx.acceptWebSocket）：没有消息的时候 DO 可以被逐出内存、不计时长，连接不会断；
// 所以每个连接的状态（who / 是否已认证 / 连上的时间）放在 attachment 里，而不是对象字段。
// 内存里的东西（限流桶、上次广播的在线状态）丢了也没关系：限流桶重新开始，在线状态从存储里读回来。
const RT_AUTH_MS = 5000;        // 连上后多久内必须发 auth
const RT_MAX_BYTES = 512;       // 单条消息上限
const RT_RATE = 20;             // 每个连接每秒最多 20 条（令牌桶，容量也是 20）
const RT_MAX_SOCKETS = 32;      // 房间里最多这么多连接
const RT_MAX_PENDING = 8;       // 还没认证的连接最多这么多（防止没有令牌的人占满房间）
const RT_KIND_RE = /^[a-z_]{1,16}$/;
const RT_PING = '{"t":"ping"}', RT_PONG = '{"t":"pong"}';

const roomStub = (env) => env.ROOM.get(env.ROOM.idFromName("nest"));

function originAllowed(req, env) {
  const origin = req.headers.get("origin") || "";
  return !!origin && (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).includes(origin);
}

// GET /rt：检查 Upgrade 和 Origin，然后整个请求转给房间。
async function roomConnect(req, env) {
  if (req.method !== "GET" || (req.headers.get("upgrade") || "").toLowerCase() !== "websocket")
    return new Response("expected websocket", { status: 426, headers: { upgrade: "websocket" } });
  if (!originAllowed(req, env)) return new Response("forbidden origin", { status: 403 });
  if (!env.ROOM) return new Response("realtime unavailable", { status: 503 });
  return roomStub(env).fetch(req);
}

// 写入成功后通知房间（放在 ctx.waitUntil 里）。任何错误都吞掉：实时通道只是锦上添花，绝不能让写入失败。
async function notifyRoom(env, ev) {
  try {
    if (!env.ROOM) return;
    await roomStub(env).fetch("https://room/notify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ who: ev.who, kind: ev.kind, id: Number.isInteger(ev.id) ? ev.id : null }),
    });
  } catch {}
}

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.buckets = new WeakMap();  // ws → { tok, t }：限流令牌桶（只在内存里）
    this.authing = new WeakMap();  // ws → Promise：auth 正在校验时，后面来的消息排队等它
    this.lastOnline = null;        // 上次广播的在线状态（内存缓存，真值在 storage 的 "online"）
    // 心跳：内容恰好是 {"t":"ping"} 的消息由运行时直接回 {"t":"pong"}，不唤醒 DO、不计费时长。
    try { ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(RT_PING, RT_PONG)); } catch {}
  }

  async fetch(req) {
    const url = new URL(req.url);
    // 内部接口：只有主 Worker 通过 stub 能调到（外部请求只会以 /rt 路径转进来）
    if (url.pathname === "/notify" && req.method === "POST") {
      let b;
      try { b = await req.json(); } catch { return new Response("bad json", { status: 400 }); }
      if (!b || typeof b.who !== "string" || b.who.length > 8 || typeof b.kind !== "string" || !RT_KIND_RE.test(b.kind))
        return new Response("bad notify", { status: 400 });
      this.broadcast({ t: "ev", who: b.who, kind: b.kind, id: Number.isInteger(b.id) ? b.id : null });
      return new Response(null, { status: 204 });
    }
    if (url.pathname === "/rt" && (req.headers.get("upgrade") || "").toLowerCase() === "websocket") {
      const all = this.ctx.getWebSockets();
      const pending = all.filter((s) => !this.att(s).authed).length;
      if (all.length >= RT_MAX_SOCKETS || pending >= RT_MAX_PENDING) return new Response("room full", { status: 503 });
      const [client, server] = Object.values(new WebSocketPair());
      this.ctx.acceptWebSocket(server);
      const at = Date.now();
      server.serializeAttachment({ authed: false, at });
      await this.armAuthAlarm(at + RT_AUTH_MS);
      return new Response(null, { status: 101, webSocket: client });
    }
    return new Response("not found", { status: 404 });
  }

  att(ws) {
    try { return ws.deserializeAttachment() || {}; } catch { return {}; }
  }

  // ---- 收消息
  async webSocketMessage(ws, msg) {
    // auth 的 sha256 是异步的，期间同一个连接的后续消息先排队，保证顺序
    const wait = this.authing.get(ws);
    if (wait) await wait;
    if (ws.readyState !== 1) return; // 已经被关了（比如认证失败）
    const a = this.att(ws);
    if (!a.authed) {
      const p = this.handleAuth(ws, msg, a);
      this.authing.set(ws, p);
      try { await p; } finally { this.authing.delete(ws); }
      return;
    }
    if (!this.allow(ws)) return;                                   // 超速：丢掉
    if (typeof msg !== "string" || byteLen(msg) > RT_MAX_BYTES) return; // 二进制或太大：丢掉
    let m;
    try { m = JSON.parse(msg); } catch { return; }
    if (!m || typeof m !== "object") return;
    if (m.t === "pos") {
      const { x, z } = m;
      if (!(typeof x === "number" && typeof z === "number" && Number.isFinite(x) && Number.isFinite(z) && Math.abs(x) < 10 && Math.abs(z) < 10)) return;
      this.broadcast({ t: "pos", who: a.who, x: round3(x), z: round3(z) }, ws);
    } else if (m.t === "act") {
      if (typeof m.kind !== "string" || !RT_KIND_RE.test(m.kind)) return;
      if (m.item != null && (typeof m.item !== "string" || m.item.length > 24)) return;
      this.broadcast({ t: "act", who: a.who, kind: m.kind, item: m.item ?? null }, ws);
    } else if (m.t === "ping") {
      // 正常情况下 ping 被运行时自动回复，走到这里说明格式不完全一样（比如多了空格），手动回
      safeSend(ws, RT_PONG);
    }
    // 其他类型（包括重复的 auth）直接忽略
  }

  async handleAuth(ws, msg, a) {
    let m = null;
    if (typeof msg === "string" && byteLen(msg) <= RT_MAX_BYTES) { try { m = JSON.parse(msg); } catch {} }
    // 超过 5 秒才来的 auth 也拒绝（alarm 万一晚了，这里兜底）
    const ok = Date.now() - (a.at || 0) <= RT_AUTH_MS && m && m.t === "auth" && (m.who === "me" || m.who === "her") && (await tokenOk(m.token, this.env));
    if (!ok) { safeClose(ws, 4001, "unauthorized"); return; }
    if (ws.readyState !== 1) return; // 校验期间对方断了
    ws.serializeAttachment({ who: m.who, authed: true, at: a.at });
    const online = this.online();
    safeSend(ws, JSON.stringify({ t: "welcome", online }));
    await this.syncPresence(online); // 这个人的第一个连接 → 给所有人广播 presence
  }

  // 令牌桶：每秒补 RT_RATE 个，最多攒 RT_RATE 个
  allow(ws) {
    const now = Date.now();
    let b = this.buckets.get(ws);
    if (!b) { b = { tok: RT_RATE, t: now }; this.buckets.set(ws, b); }
    b.tok = Math.min(RT_RATE, b.tok + ((now - b.t) * RT_RATE) / 1000);
    b.t = now;
    if (b.tok < 1) return false;
    b.tok -= 1;
    return true;
  }

  // ---- 断开
  async webSocketClose(ws, code, reason) {
    // 回一个 close 完成握手（1005/1006 这种保留码不能发，就用默认）
    try { ws.close(code >= 1000 && code < 5000 && code !== 1005 && code !== 1006 && code !== 1015 ? code : 1000, "bye"); } catch {}
    await this.gone(ws);
  }
  async webSocketError(ws) {
    try { ws.close(1011, "error"); } catch {}
    await this.gone(ws);
  }
  async gone(ws) {
    this.buckets.delete(ws);
    if (this.att(ws).authed) await this.syncPresence(this.online(ws)); // 这个人的最后一个连接 → 广播
  }

  // ---- 认证超时：用 alarm 而不是 setTimeout（DO 休眠后 setTimeout 会丢）。
  // 注意：在 alarm 里 close 时，4001 关闭帧会立刻发出去，但运行时要等 DO 空闲以后才断开 TCP（本地实测 10–20 秒），
  // 所以有的客户端 onclose 会晚一点触发。服务器这边连接马上就从 getWebSockets() 里消失，不影响别人。
  async armAuthAlarm(due) {
    const cur = await this.ctx.storage.getAlarm();
    if (cur == null || cur > due) await this.ctx.storage.setAlarm(due);
  }
  async alarm() {
    const now = Date.now();
    let next = Infinity;
    for (const ws of this.ctx.getWebSockets()) {
      const a = this.att(ws);
      if (a.authed || this.authing.has(ws)) continue;
      const due = (a.at || 0) + RT_AUTH_MS;
      if (due <= now + 50) safeClose(ws, 4001, "auth timeout");
      else next = Math.min(next, due);
    }
    if (next < Infinity) await this.ctx.storage.setAlarm(next);
  }

  // ---- 在线状态：每个 who 至少有一个已认证、还开着的连接就算在线
  online(exclude) {
    const o = { me: false, her: false };
    for (const s of this.ctx.getWebSockets()) {
      if (s === exclude || s.readyState !== 1) continue;
      const a = this.att(s);
      if (a.authed && (a.who === "me" || a.who === "her")) o[a.who] = true;
    }
    return o;
  }
  // 和上次广播的比，变了才广播并记下来。这样"第一个连上 / 最后一个断开"自然只广播一次，
  // close 和 error 都触发也不会重复。
  async syncPresence(online) {
    if (!this.lastOnline) this.lastOnline = (await this.ctx.storage.get("online")) || { me: false, her: false };
    if (this.lastOnline.me === online.me && this.lastOnline.her === online.her) return;
    this.lastOnline = online;
    await this.ctx.storage.put("online", online);
    this.broadcast({ t: "presence", online });
  }

  // 发给所有已认证的连接（except 除外）
  broadcast(obj, except) {
    const s = JSON.stringify(obj);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except || ws.readyState !== 1 || !this.att(ws).authed) continue;
      safeSend(ws, s);
    }
  }
}

const round3 = (v) => Math.round(v * 1000) / 1000;
// UTF-8 字节数；短字符串（≤170 个 UTF-16 单元）最多 510 字节，不用真的编码
const byteLen = (s) => (s.length <= 170 ? s.length : new TextEncoder().encode(s).length);
function safeSend(ws, s) { try { ws.send(s); } catch {} }
function safeClose(ws, code, reason) { try { ws.close(code, reason); } catch {} }
