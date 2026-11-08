// 小窝互动 API（Cloudflare Worker + D1）。
// GET  /events?since=<id>   拿 id 之后的互动记录（最多 200 条）
// POST /events              写一条：{ who, kind, item?, n?, box? }
// 认证：Authorization: Bearer <令牌>，令牌由页面密码派生，这里只存它的 sha256（ACCESS_HASH）。
// 自由文字只以密文（box）存；服务器能看到的只有类型、食物 id、次数和时间。
// POST /subscribe  存 Zilong 手机的网页推送订阅；她有动作时发一个"空"推送（不带内容），
//                  手机上的 service worker 自己来 /events 取新动态并显示通知。
// POST /push-test  给所有订阅发一个测试推送。

const KINDS = new Set(["feed", "angry", "hit", "calm", "sorry", "flower", "note"]);
const FOODS = { rice: "饭团", cake: "小蛋糕", tea: "奶茶", berry: "草莓", noodle: "一碗面", veggie: "青菜" };
const MAX_BOX = 4096;
const DAILY_CAP = 3000;

export default {
  async fetch(req, env, ctx) {
    const cors = corsHeaders(req, env);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const url = new URL(req.url);
    if (!["/events", "/push-test", "/subscribe"].includes(url.pathname)) return json({ error: "not found" }, 404, cors);
    if (!(await authorized(req, env))) return json({ error: "unauthorized" }, 401, cors);

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
      const ts = Date.now();
      const r = await env.DB.prepare("INSERT INTO events (ts, who, kind, item, n, box) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(ts, e.who, e.kind, e.item ?? null, e.n ?? null, e.box ?? null).run();
      ctx.waitUntil(push(env, e).catch(() => {}));
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

function corsHeaders(req, env) {
  const origin = req.headers.get("origin") || "";
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim());
  return {
    "access-control-allow-origin": allowed.includes(origin) ? origin : allowed[0] || "",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type",
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
  if (e.who !== "her" || !["feed", "angry", "hit", "calm", "note"].includes(e.kind)) return;
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
