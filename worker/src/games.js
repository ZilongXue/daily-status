// 小游戏：岛上藏宝 / 钓鱼大赛 / 默契大考验，外加赢家拿到的"愿望券"。
// 游戏状态存在 meta 表（一个 key 一个 JSON），不放 events —— events 会原样发给两边的浏览器，
// 藏宝位置、对方的答案在揭晓前不能出现在那里。events 里只记"发生了什么"（给动态流和推送用）。
//
// GET  /games?who=me|her        → 全部游戏状态（按 who 过滤掉不该看到的）
// POST /games {who, game, op, ...}
//   hunt  : hide {x, z, box?} / dig {x, z} / cancel
//   derby : challenge / cast / reel {cid, react} / quit
//   quiz  : submit {self:[5], guess:[5]}
// 愿望券：赢家拿到 wishgrant（服务器发），写内容走 POST /events kind=wish（item = grant 的 id，box = 密文），
//         对方兑现后发 kind=wishdone（item = wish 的 id）。

export const GAME_KINDS = ["wish", "wishdone"];

// ---------------------------------------------------------------- 工具
const now = () => Date.now();
const rand01 = () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
const other = (who) => (who === "me" ? "her" : "me");
async function getMeta(env, k, dflt = null) {
  const r = await env.DB.prepare("SELECT v FROM meta WHERE k = ?").bind(k).first();
  if (!r) return dflt;
  try { return JSON.parse(r.v); } catch { return dflt; }
}
const setMeta = (env, k, v) => env.DB.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)").bind(k, JSON.stringify(v)).run();
async function addEvent(env, who, kind, item = null, n = null) {
  const r = await env.DB.prepare("INSERT INTO events (ts, who, kind, item, n) VALUES (?, ?, ?, ?, ?)").bind(now(), who, kind, item, n).run();
  return r.meta.last_row_id;
}
const num = (v, lo, hi) => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
const r2 = (v) => Math.round(v * 100) / 100;

// ---------------------------------------------------------------- 岛上藏宝
// 坐标是小岛自己的坐标系（和 3D 场景 world 组一致），只允许藏在中间那片平草地上（半径 3.3 以内）。
const HUNT_MAX = 8, FOUND_R = 0.45;
const BANDS = [[0.9, "hot"], [1.6, "warm"], [2.6, "cool"], [Infinity, "cold"]];
const LANDMARKS = [
  ["大树", 1.95, -1.25], ["小床", -1.55, -0.85], ["路灯", -2.6, 0.1], ["码头", 0.59, 2.38],
  ["扭蛋机", 2.95, 1.75], ["花瓶", 1.35, 1.45], ["瀑布", -1.25, -2.95], ["岛中心", 0, 0],
];
function huntHint(h) {
  const d = (l) => Math.hypot(l[1] - h.x, l[2] - h.z);
  const near = [...LANDMARKS].sort((a, b) => d(a) - d(b))[0];
  if (h.digs.length === 3) return `宝藏离【${near[0]}】最近`;
  if (h.digs.length === 6) return `宝藏在【${near[0]}】旁边大约 ${Math.max(1, Math.round(d(near) / 0.5))} 步`;
  return null;
}
function huntView(h, who) {
  if (!h) return null;
  const v = { id: h.id, hider: h.hider, ts: h.ts, max: h.max, status: h.status, digs: h.digs, hints: h.hints, box: h.status === "live" && who !== h.hider ? null : h.box };
  if (who === h.hider || h.status !== "live") { v.x = h.x; v.z = h.z; }
  return v;
}
async function hunt(env, b, deps) {
  const h = await getMeta(env, "hunt");
  const live = h && h.status === "live";
  if (b.op === "hide") {
    if (live) return { error: "a hunt is already live", status: 409 };
    if (!num(b.x, -4, 4) || !num(b.z, -4, 4) || Math.hypot(b.x, b.z) > 3.4) return { error: "bad spot", status: 400 };
    if (b.box != null && (typeof b.box !== "string" || b.box.length > 2048 || !/^[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$/.test(b.box))) return { error: "bad box", status: 400 };
    const id = now();
    const nh = { id, hider: b.who, x: r2(b.x), z: r2(b.z), ts: id, max: HUNT_MAX, digs: [], hints: [], status: "live", box: b.box || null };
    await setMeta(env, "hunt", nh);
    const eid = await addEvent(env, b.who, "hunt", "hide", null);
    return { ok: true, hunt: huntView(nh, b.who), eid, push: { kind: "hunt", item: "hide" } };
  }
  if (!live) return { error: "no live hunt", status: 409 };
  if (b.op === "cancel") {
    if (b.who !== h.hider || h.digs.length) return { error: "cannot cancel", status: 409 };
    h.status = "cancel";
    await setMeta(env, "hunt", h);
    const eid = await addEvent(env, b.who, "hunt", "cancel", null);
    return { ok: true, hunt: huntView(h, b.who), eid };
  }
  if (b.op === "dig") {
    if (b.who === h.hider) return { error: "hider cannot dig", status: 409 };
    if (!num(b.x, -4, 4) || !num(b.z, -4, 4)) return { error: "bad spot", status: 400 };
    const dist = Math.hypot(b.x - h.x, b.z - h.z);
    const found = dist <= FOUND_R;
    const band = found ? "found" : BANDS.find(([r]) => dist < r)[1];
    h.digs.push({ x: r2(b.x), z: r2(b.z), band, ts: now() });
    const hint = found ? null : huntHint(h);
    if (hint) h.hints.push(hint);
    let result = null;
    if (found || h.digs.length >= h.max) {
      h.status = found ? "found" : "lost";
      const winner = found ? b.who : h.hider;
      const stars = found ? 1 + (h.max - h.digs.length) : 2;
      await deps.mint(env, `hunt:${h.id}`, stars);
      await grantWish(env, winner, `hunt:${h.id}`);
      await pushHist(env, "hunt_hist", { id: h.id, hider: h.hider, digs: h.digs.length, found, winner });
      result = { winner, stars, found };
    }
    await setMeta(env, "hunt", h);
    const eid = await addEvent(env, b.who, "dig", band, h.digs.length);
    if (result) await addEvent(env, result.winner, "hunt", found ? "found" : "lost", h.digs.length);
    return { ok: true, band, dist: found ? 0 : null, hint, result, hunt: huntView(h, b.who), eid, push: result ? { kind: "hunt", item: found ? "found" : "lost" } : null };
  }
  return { error: "bad op", status: 400 };
}

// ---------------------------------------------------------------- 钓鱼大赛
// 每人 5 竿，24 小时内打完（同时在线就一起钓，看得到对方实时的收获）。
// 甩竿时服务器只定"多久咬钩"；拉竿时才抽鱼，所以提前看不到结果。拉得快（≤400ms）抽两次取好的，>1500ms 鱼就跑了。
// 分数 = 稀有度底分 × 尺寸系数（0.8–1.3），今日幸运鱼 ×2。
const DERBY_CASTS = 5, DERBY_TTL = 24 * 3600000;
const PTS = { common: 10, rare: 25, epic: 60, legend: 150 };
const SIZE_CM = { crucian: 22, clown: 9, puffer: 18, shrimp: 7, boot: 28, koi: 45, jelly: 30, octopus: 60, bottle: 25, whale: 900, turtle: 80, chest: 40, goldkoi: 55, mermaid: 120, star: 35 };
const LUCKY_FROM = ["crucian", "clown", "puffer", "shrimp", "koi", "jelly", "octopus", "turtle"];
export function luckyFish(day) {
  const n = Math.floor(Date.parse(day + "T00:00:00Z") / 86400000);
  return LUCKY_FROM[((n * 7 + 3) % LUCKY_FROM.length + LUCKY_FROM.length) % LUCKY_FROM.length];
}
function rollFish(pool) {
  const total = pool.reduce((a, p) => a + p[2], 0);
  let x = rand01() * total;
  for (const p of pool) if ((x -= p[2]) < 0) return p;
  return pool[0];
}
function scoreOf(pick, lucky) {
  const [id, rarity] = pick;
  const k = 0.8 + rand01() * 0.5;
  let pts = Math.round((id === "boot" ? 3 : PTS[rarity]) * k);
  if (id === lucky) pts *= 2;
  return { f: id, rarity, pts, cm: Math.max(1, Math.round((SIZE_CM[id] || 20) * k)), lucky: id === lucky };
}
const derbyTotal = (p) => p.casts.reduce((a, c) => a + c.pts, 0);
function derbyView(d) {
  if (!d) return null;
  const strip = (p) => ({ casts: p.casts, total: derbyTotal(p), pending: !!p.pend });
  return { id: d.id, by: d.by, ts: d.ts, until: d.until, max: d.max, lucky: d.lucky, status: d.status, winner: d.winner ?? null, p: { me: strip(d.p.me), her: strip(d.p.her) } };
}
async function derbyFinish(env, d, deps, force) {
  if (d.status !== "live") return null;
  d.status = "done";
  const a = derbyTotal(d.p.me), b = derbyTotal(d.p.her);
  d.winner = force || (a === b ? null : a > b ? "me" : "her");
  await deps.mint(env, `derby:${d.id}`, 3);
  if (d.winner) {
    await grantWish(env, d.winner, `derby:${d.id}`);
    await setMeta(env, "trophy", { who: d.winner, game: "derby", pts: Math.max(a, b), until: now() + 7 * 86400000 });
  }
  await pushHist(env, "derby_hist", { id: d.id, me: a, her: b, winner: d.winner });
  await addEvent(env, d.winner || "sys", "derby", "end", null);
  return { winner: d.winner, me: a, her: b };
}
async function derbyLoad(env, deps) {
  const d = await getMeta(env, "derby");
  if (d && d.status === "live" && now() > d.until) { await derbyFinish(env, d, deps); await setMeta(env, "derby", d); }
  return d;
}
async function derby(env, b, deps) {
  const d = await derbyLoad(env, deps);
  const live = d && d.status === "live";
  if (b.op === "challenge") {
    if (live) return { error: "a derby is already live", status: 409 };
    const id = now();
    const nd = { id, by: b.who, ts: id, until: id + DERBY_TTL, max: DERBY_CASTS, lucky: luckyFish(deps.bjDay()), status: "live", p: { me: { casts: [], pend: null }, her: { casts: [], pend: null } } };
    await setMeta(env, "derby", nd);
    const eid = await addEvent(env, b.who, "derby", "start", null);
    return { ok: true, derby: derbyView(nd), eid, push: { kind: "derby", item: "start" } };
  }
  if (!live) return { error: "no live derby", status: 409 };
  const me = d.p[b.who];
  if (b.op === "quit") { // 认输：直接结束，对方赢
    me.casts.push(...Array.from({ length: d.max - me.casts.length }, () => ({ f: null, pts: 0, quit: true, ts: now() })));
    const result = await derbyFinish(env, d, deps, other(b.who));
    await setMeta(env, "derby", d);
    return { ok: true, result, derby: derbyView(d), eid: 0 };
  }
  if (b.op === "cast") {
    if (me.casts.length >= d.max) return { error: "no casts left", status: 409 };
    me.pend = { cid: crypto.getRandomValues(new Uint32Array(1))[0], at: now(), bite: Math.round(1600 + rand01() * 2800) };
    await setMeta(env, "derby", d);
    return { ok: true, cid: me.pend.cid, bite: me.pend.bite, used: me.casts.length, max: d.max };
  }
  if (b.op === "reel") {
    const p = me.pend;
    if (!p || p.cid !== b.cid) return { error: "no such cast", status: 409 };
    me.pend = null;
    const react = num(b.react, 0, 60000) ? Math.round(b.react) : null;
    const early = now() - p.at < p.bite - 400; // 咬钩之前就拉 = 空竿
    let rec;
    if (early || react == null || react > 1500) rec = { f: null, pts: 0, react, miss: early ? "early" : "slow", ts: now() };
    else {
      let pick = rollFish(deps.POOL);
      let quick = false;
      if (react <= 400) { // 快手：再抽一次，取分高的
        const alt = rollFish(deps.POOL);
        if (PTS[alt[1]] > PTS[pick[1]]) pick = alt;
        quick = true;
      }
      rec = { ...scoreOf(pick, d.lucky), react, quick, ts: now() };
    }
    me.casts.push(rec);
    const eid = await addEvent(env, b.who, "dfish", rec.f || "miss", rec.pts);
    let result = null;
    if (d.p.me.casts.length >= d.max && d.p.her.casts.length >= d.max) result = await derbyFinish(env, d, deps);
    await setMeta(env, "derby", d);
    return { ok: true, cast: rec, used: me.casts.length, max: d.max, result, derby: derbyView(d), eid };
  }
  return { error: "bad op", status: 400 };
}

// ---------------------------------------------------------------- 默契大考验
// 每天 5 道选择题（按北京时间的日期固定），每人先选自己的答案，再猜对方会选什么。
// 两人都交卷才揭晓：猜中对方一题 +1，满分 10。答案存在 meta 里，交卷前对方拿不到。
const QUIZ = [
  ["周末最理想的早上是？", ["睡到自然醒", "早起去吃早餐", "赖床刷手机", "起来运动一下"]],
  ["突然多出一天假，你会？", ["在家躺平", "出门逛街", "约朋友吃饭", "说走就走去旅行"]],
  ["吵架以后你更希望对方？", ["马上来哄", "先让我冷静一下", "直接抱抱", "认真讲清楚道理"]],
  ["最想一起去的地方？", ["海边", "雪山", "热闹的大城市", "安静的小镇"]],
  ["奶茶甜度你一般点？", ["全糖", "七分糖", "三分糖", "不要糖"]],
  ["最喜欢的约会方式？", ["一起吃好吃的", "看电影", "逛街压马路", "宅家打游戏"]],
  ["火锅锅底选？", ["牛油麻辣", "鸳鸯锅", "番茄锅", "菌汤锅"]],
  ["收到礼物最开心的是？", ["手写的信", "想要很久的东西", "意外的小惊喜", "一起体验的活动"]],
  ["心情不好时最想？", ["一个人待着", "找人聊天", "吃顿好的", "睡一觉"]],
  ["最想养的宠物？", ["猫", "狗", "兔子", "仓鼠"]],
  ["旅行时你是哪种人？", ["做好详细攻略", "大概有个计划", "走到哪算哪", "跟着对方走"]],
  ["更喜欢哪个季节？", ["春天", "夏天", "秋天", "冬天"]],
  ["晚上几点睡最舒服？", ["11 点前", "12 点左右", "1 点左右", "2 点以后"]],
  ["最拿手的一件事？", ["做饭", "收拾整理", "安慰人", "找好吃的"]],
  ["拍照时你更喜欢？", ["拍别人", "被拍", "自拍", "拍风景"]],
  ["最受不了对方哪种行为？", ["不回消息", "迟到", "敷衍", "乱花钱"]],
  ["一起看电影选？", ["爱情片", "喜剧片", "恐怖片", "动画片"]],
  ["点外卖最常点？", ["米饭快餐", "麻辣烫/面", "汉堡炸鸡", "轻食沙拉"]],
  ["更想住在？", ["市中心的公寓", "郊区带院子的房子", "海边", "山里"]],
  ["遇到难题你会？", ["自己硬扛", "马上问人", "先放一放", "上网查"]],
  ["最想一起学的东西？", ["做饭", "跳舞", "一门外语", "一种乐器"]],
  ["生日最想怎么过？", ["两个人安静过", "一群朋友热闹过", "出去旅行", "收到惊喜就好"]],
  ["你觉得自己更像？", ["小猫", "小狗", "小熊", "小兔子"]],
  ["零食首选？", ["薯片", "巧克力", "辣条", "水果"]],
  ["表达喜欢的方式更像？", ["说出来", "做行动", "送东西", "黏在一起"]],
  ["假期睡懒觉能睡到？", ["9 点", "11 点", "下午 1 点", "看心情"]],
  ["一起出门你负责？", ["规划路线", "拍照", "找吃的", "拎包"]],
  ["下雨天最想做什么？", ["在家听雨", "睡觉", "看剧", "出去踩水"]],
  ["最怕的东西？", ["虫子", "黑", "打针", "高处"]],
  ["理想中的晚饭？", ["自己做", "下馆子", "点外卖", "随便吃点"]],
  ["和对方视频时你更常在？", ["床上", "书桌前", "沙发上", "路上"]],
  ["最想收到对方哪句话？", ["我想你了", "辛苦了", "我在呢", "你最棒"]],
  ["压力大的时候会？", ["疯狂吃东西", "刷手机", "运动", "找人倾诉"]],
  ["你更像早鸟还是夜猫？", ["早鸟", "夜猫", "看情况", "都不是，一直困"]],
  ["喜欢的天气？", ["大晴天", "阴天", "下雨", "下雪"]],
  ["生气时你通常会？", ["不说话", "直接说出来", "哭", "过一会儿就好"]],
  ["如果中了一百万？", ["存起来", "去旅行", "买房", "给家人"]],
  ["网购时你是？", ["看到就买", "加购物车等打折", "比价很久", "很少网购"]],
  ["更喜欢哪种见面方式？", ["机场接机", "约在餐厅", "直接到对方家", "给对方一个惊喜"]],
  ["最喜欢的颜色系？", ["粉色系", "蓝色系", "绿色系", "黑白灰"]],
  ["朋友聚会时你是？", ["气氛担当", "安静吃饭", "负责拍照", "照顾大家"]],
  ["最想一起完成的事？", ["一起旅行", "一起养宠物", "一起装修小家", "一起做顿大餐"]],
];
function quizFor(day) {
  const n = Math.floor(Date.parse(day + "T00:00:00Z") / 86400000);
  // 按天轮换：每天取 5 道，大约 8 天一轮，起点错开避免总是同样的组合
  const start = (((n * 5) % QUIZ.length) + QUIZ.length) % QUIZ.length;
  return Array.from({ length: 5 }, (_, i) => (start + i * 3) % QUIZ.length);
}
const validPicks = (a) => Array.isArray(a) && a.length === 5 && a.every((x) => Number.isInteger(x) && x >= 0 && x <= 3);
function quizScore(a, b) {
  let s = 0, same = 0;
  for (let i = 0; i < 5; i++) {
    if (a.guess[i] === b.self[i]) s++;
    if (b.guess[i] === a.self[i]) s++;
    if (a.self[i] === b.self[i]) same++;
  }
  return { score: s, same };
}
async function quizState(env, who, deps) {
  const day = deps.bjDay();
  const qs = quizFor(day);
  const mine = await getMeta(env, `quiz:${day}:${who}`);
  const theirs = await getMeta(env, `quiz:${day}:${other(who)}`);
  const both = !!(mine && theirs);
  const hist = await getMeta(env, "quiz_hist", []);
  return {
    day, questions: qs.map((i) => ({ q: QUIZ[i][0], opts: QUIZ[i][1] })),
    mine, theirsDone: !!theirs, theirs: mine ? theirs : null,
    result: both ? quizScore(who === "me" ? mine : theirs, who === "me" ? theirs : mine) : null,
    total: hist.reduce((a, h) => a + h.score, 0), rounds: hist.length, hist: hist.slice(-14),
  };
}
async function quiz(env, b, deps) {
  if (b.op !== "submit") return { error: "bad op", status: 400 };
  if (!validPicks(b.self) || !validPicks(b.guess)) return { error: "bad picks", status: 400 };
  const day = deps.bjDay();
  if (await getMeta(env, `quiz:${day}:${b.who}`)) return { error: "already submitted", status: 409 };
  await setMeta(env, `quiz:${day}:${b.who}`, { self: b.self, guess: b.guess, ts: now() });
  const eid = await addEvent(env, b.who, "quiz", day, null);
  const theirs = await getMeta(env, `quiz:${day}:${other(b.who)}`);
  let result = null;
  if (theirs) {
    const mine = { self: b.self, guess: b.guess };
    const r = quizScore(b.who === "me" ? mine : theirs, b.who === "me" ? theirs : mine);
    const stars = r.score === 10 ? 5 : 1 + Math.floor(r.score / 3);
    await deps.mint(env, `quiz:${day}`, stars);
    await pushHist(env, "quiz_hist", { day, score: r.score, same: r.same }, 400);
    result = { ...r, stars };
  }
  return { ok: true, eid, result, quiz: await quizState(env, b.who, deps), push: { kind: "quiz", item: result ? "done" : "submit" } };
}

// ---------------------------------------------------------------- 愿望券 / 历史
async function grantWish(env, who, source) { await addEvent(env, who, "wishgrant", source, null); }
async function pushHist(env, k, rec, keep = 30) {
  const h = await getMeta(env, k, []);
  h.push(rec);
  await setMeta(env, k, h.slice(-keep));
}
async function wishes(env) {
  const { results } = await env.DB.prepare("SELECT id, ts, who, kind, item, box FROM events WHERE kind IN ('wishgrant', 'wish', 'wishdone') ORDER BY id").all();
  const grants = [];
  const byGrant = {};
  for (const r of results) {
    if (r.kind === "wishgrant") { const g = { id: r.id, ts: r.ts, who: r.who, source: r.item, wish: null, done: null }; grants.push(g); byGrant[r.id] = g; }
    else if (r.kind === "wish") { const g = byGrant[Number(r.item)]; if (g && !g.wish) g.wish = { id: r.id, ts: r.ts, box: r.box }; }
  }
  for (const r of results) if (r.kind === "wishdone") { const g = grants.find((x) => x.wish && x.wish.id === Number(r.item)); if (g) g.done = { ts: r.ts, who: r.who }; }
  return grants.reverse().slice(0, 40);
}
// POST /events 里 wish / wishdone 的额外校验（index.js 调用）
export async function checkWishEvent(env, e) {
  if (e.kind === "wish") {
    if (!/^\d+$/.test(e.item || "") || !e.box) return "bad wish";
    const g = await env.DB.prepare("SELECT who FROM events WHERE id = ? AND kind = 'wishgrant'").bind(Number(e.item)).first();
    if (!g || g.who !== e.who) return "not your coupon";
    if (await env.DB.prepare("SELECT 1 FROM events WHERE kind = 'wish' AND item = ?").bind(e.item).first()) return "already written";
  }
  if (e.kind === "wishdone") {
    if (!/^\d+$/.test(e.item || "")) return "bad wish";
    const w = await env.DB.prepare("SELECT who FROM events WHERE id = ? AND kind = 'wish'").bind(Number(e.item)).first();
    if (!w || w.who === e.who) return "not yours to fulfil";
    if (await env.DB.prepare("SELECT 1 FROM events WHERE kind = 'wishdone' AND item = ?").bind(e.item).first()) return "already done";
  }
  return null;
}

// ---------------------------------------------------------------- 入口
export async function gamesGet(env, who, deps) {
  const trophy = await getMeta(env, "trophy");
  return {
    now: now(),
    hunt: huntView(await getMeta(env, "hunt"), who),
    huntHist: await getMeta(env, "hunt_hist", []),
    derby: derbyView(await derbyLoad(env, deps)),
    derbyHist: await getMeta(env, "derby_hist", []),
    lucky: luckyFish(deps.bjDay()),
    quiz: await quizState(env, who, deps),
    wishes: await wishes(env),
    trophy: trophy && trophy.until > now() ? trophy : null,
  };
}
export async function gamesPost(env, b, deps) {
  if (b.game === "hunt") return hunt(env, b, deps);
  if (b.game === "derby") return derby(env, b, deps);
  if (b.game === "quiz") return quiz(env, b, deps);
  return { error: "bad game", status: 400 };
}
