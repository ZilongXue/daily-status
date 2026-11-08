// 小窝互动 API（Cloudflare Worker + D1）。
// GET  /events?since=<id>   拿 id 之后的互动记录（最多 200 条）
// POST /events              写一条：{ who, kind, item?, n?, box? }
// 认证：Authorization: Bearer <令牌>，令牌由页面密码派生，这里只存它的 sha256（ACCESS_HASH）。
// 自由文字只以密文（box）存；服务器能看到的只有类型、食物 id、次数和时间。

const KINDS = new Set(["feed", "angry", "hit", "calm", "sorry", "flower", "note"]);
const FOODS = { rice: "饭团", cake: "小蛋糕", tea: "奶茶", berry: "草莓", noodle: "一碗面", veggie: "青菜" };
const MAX_BOX = 4096;
const DAILY_CAP = 3000;

export default {
  async fetch(req, env, ctx) {
    const cors = corsHeaders(req, env);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const url = new URL(req.url);
    if (url.pathname !== "/events") return json({ error: "not found" }, 404, cors);
    if (!(await authorized(req, env))) return json({ error: "unauthorized" }, 401, cors);

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

// ---------------------------------------------------------------- 推送到 Zilong 的 iPhone（Bark）
// 只推她那边的动作；揍人类的高频动作做节流。推送文案只用类型 / 食物 / 次数，不含任何留言内容。
async function push(env, e) {
  if (!env.BARK_KEY || e.who !== "her") return;
  let title = "小窝", body = "";
  if (e.kind === "feed") body = `她喂了你${FOODS[e.item] || "好吃的"} 🍽`;
  else if (e.kind === "angry") { title = "⚠️ 她生气了"; body = "快去小窝哄哄她"; }
  else if (e.kind === "hit") {
    const last = await env.DB.prepare("SELECT v FROM meta WHERE k = 'push_hit'").first();
    if (last && Date.now() - Number(last.v) < 10 * 60000) return; // 10 分钟最多推一次
    await env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('push_hit', ?)").bind(String(Date.now())).run();
    body = `她揍了你 ${e.n || 1} 下 😵`;
  } else if (e.kind === "calm") body = "她气消了 🌈";
  else if (e.kind === "note") body = "她给你留了一张纸条 💌";
  else return;
  await fetch("https://api.day.app/push", {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ device_key: env.BARK_KEY, title, body, group: "nest" }),
  });
}
