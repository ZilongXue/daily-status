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

const KINDS = new Set(["feed", "angry", "hit", "calm", "sorry", "flower", "note", "nudge", "buy", "place"]);
// 装饰的价格（星星）。"snow" 是天气：买了以后可以开关下雪。
const SHOP = {
  flowers_bed: 5, mushrooms: 6, fence: 6, mailbox: 8, bench: 8, lamppost: 10, lights: 12, gifts: 12,
  campfire: 15, snowman: 15, snow: 15, telescope: 18, swing: 20, tent: 20, sakura: 25, pond: 25,
  balloon: 30, windmill: 35, cabin: 45,
};
const STAR_RE = /^[a-z0-9_]{2,20}(:[0-9-]{4,10})?$/;
const FOODS = { rice: "饭团", cake: "小蛋糕", tea: "奶茶", berry: "草莓", noodle: "一碗面", veggie: "青菜" };
const MAX_BOX = 4096;
const DAILY_CAP = 3000;

export default {
  async fetch(req, env, ctx) {
    const cors = corsHeaders(req, env);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const url = new URL(req.url);
    if (!["/events", "/push-test", "/subscribe", "/wallet", "/mint"].includes(url.pathname)) return json({ error: "not found" }, 404, cors);
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
      const { results } = await env.DB.prepare(
        "SELECT id, ts, who, kind, item, n, box FROM events WHERE id > ? ORDER BY id DESC LIMIT 200").bind(since).all();
      return json({ events: results.reverse(), now: Date.now() }, 200, cors);
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
        if (w.balance < SHOP[e.item]) return json({ error: "not enough stars", balance: w.balance }, 402, cors);
        e.n = SHOP[e.item]; // 价格以服务器为准
      }
      if (e.kind === "place") {
        const w = await wallet(env);
        if (!w.owned.includes(e.item)) return json({ error: "not owned" }, 409, cors);
      }
      const ts = Date.now();
      const r = await env.DB.prepare("INSERT INTO events (ts, who, kind, item, n, box) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(ts, e.who, e.kind, e.item ?? null, e.n ?? null, e.box ?? null).run();
      ctx.waitUntil(Promise.all([push(env, e), rewards(env, e)]).catch(() => {}));
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
  if ((e.kind === "buy" || e.kind === "place") && !(e.item in SHOP)) return "bad shop item";
  if (e.kind === "place" && e.n !== 0 && e.n !== 1) return "bad place";
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
  if (!m || !env.ACCESS_HASH) return false;
  const got = await sha256hex(m[1]);
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
  const { spent } = await env.DB.prepare("SELECT COALESCE(SUM(n), 0) AS spent FROM events WHERE kind = 'buy'").first();
  const { results: buys } = await env.DB.prepare("SELECT item FROM events WHERE kind = 'buy' ORDER BY id").all();
  const { results: places } = await env.DB.prepare("SELECT item, n FROM events WHERE kind = 'place' ORDER BY id").all();
  const { results: recent } = await env.DB.prepare("SELECT ts, item, n FROM events WHERE who = 'sys' AND kind = 'star' ORDER BY id DESC LIMIT 30").all();
  const shown = {};
  for (const b of buys) shown[b.item] = 1;
  for (const p of places) shown[p.item] = p.n;
  return { balance: earned - spent, earned, owned: buys.map((b) => b.item), shown, recent, prices: SHOP };
}

// 你们俩互动触发的星星（按北京时间算"一天"，她在国内）
const bjDay = (ts = Date.now()) => new Date(ts + 8 * 3600000).toISOString().slice(0, 10);
async function rewards(env, e) {
  const day = bjDay();
  if (e.kind === "feed" && e.who === "her") await mint(env, `feed:${day}`, 1);
  if (e.kind === "calm") await mint(env, `calm:${day}`, 1);
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
  if (e.who !== "her" || !["feed", "angry", "hit", "calm", "note", "nudge", "buy"].includes(e.kind)) return;
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
