// 小岛生活（v15）：背包、料理、宠物蛋、岛民来访、出海、突发事件、图鉴奖励。
// 状态是 meta 表里的一行 JSON（k = 'life'），两个人共用一份。写的时候做 compare-and-swap（UPDATE … WHERE v = 旧值），
// 两个人同时操作也不会互相覆盖；副作用（发星星、写 events、写 catches）只在写成功以后才执行，重试不会重复发。
// 游戏数据（菜谱、岛民、出海、事件）在 site/lifedata.js，鱼在 site/fishdata.js，和网页共用。
//
// GET  /life?who=me|her  → 状态
// POST /life {who, op, ...}
//   cook {items:[2–3 个背包 id]}              做菜（背包 id：食材 "tomato"、鱼 "f:koi"、菜 "d:sushi" / "d:sushi:pond"）
//   feed {egg, dish}  / hatch {egg}           喂蛋 / 孵化
//   name {pet, box}                           给宠物起名（密文）
//   give {visitor, item}                      满足岛民的请求
//   mail                                      收住在岛上的岛民今天送的礼物
//   sail {dest, dishes:[1–3]} / unload        出海 / 船回来了卸货
//   brace {i} / repair {decor} / shoo / collect {i} / whale    突发事件
//   claim {n}                                 领图鉴奖励
//   bedpet {kind}                             床上的宠物选哪种（两边同步）
import { FISH } from "../../site/fishdata.js";
import {
  GOODS, RECIPES, DARK_DISH, EGG_FEEDS, EGG_MIN_HOURS, INCUBATOR_SLOTS, HATCH, PETS, SHINY_P, EGG_PATTERNS,
  MOVE_IN, VISITORS, VISIT_REWARD, VOYAGE, VOYAGE_EGG_P, VOYAGE_FISH_P, EVENTS, EVENT_P, EVENT_HOURS, BOOK_MILESTONES, STARTER,
} from "../../site/lifedata.js";

const H = 3600000;
const rand01 = () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
const pick = (a) => a[Math.floor(rand01() * a.length)];
const randInt = (lo, hi) => lo + Math.floor(rand01() * (hi - lo + 1));
const now = () => Date.now();
const RW = { common: 10, rare: 5, epic: 1.6, legend: 0.35 };
export const fishWeight = (id) => (RW[FISH[id].rarity] || 1) * (FISH[id].w ?? 1);
function weighted(ids) {
  const total = ids.reduce((a, id) => a + fishWeight(id), 0);
  let x = rand01() * total;
  for (const id of ids) if ((x -= fishWeight(id)) < 0) return id;
  return ids[0];
}
function fnv(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

// ---------------------------------------------------------------- 状态读写
function init() {
  return { v: 1, seq: 1, bag: { ...STARTER.bag }, recipes: {}, eggs: STARTER.eggs.map((p, i) => ({ id: i + 1, pattern: p, at: now(), feeds: [], inc: true })), pets: [],
    visitors: null, affinity: {}, residents: [], mailDay: null, voyage: null, miles: 0, islands: ["near"], event: null, knocked: [], claims: [], aquarium: false, bedpet: null };
}
async function load(env) {
  const r = await env.DB.prepare("SELECT v FROM meta WHERE k = 'life'").first();
  if (!r) { const s = init(); s.seq = 2; return { raw: null, s }; }
  return { raw: r.v, s: JSON.parse(r.v) };
}
async function save(env, raw, s) {
  const v = JSON.stringify(s);
  if (v === raw) return true; // 没变就不写
  if (raw === null) return (await env.DB.prepare("INSERT OR IGNORE INTO meta (k, v) VALUES ('life', ?)").bind(v).run()).meta.changes === 1;
  return (await env.DB.prepare("UPDATE meta SET v = ? WHERE k = 'life' AND v = ?").bind(v, raw).run()).meta.changes === 1;
}
// fn(s, fx) 改 s；要在写成功后才做的事 push 进 fx（async 函数）。返回 { error } 时不写。
export async function mutate(env, fn) {
  for (let i = 0; i < 8; i++) {
    const { raw, s } = await load(env);
    const fx = [];
    const out = await fn(s, fx);
    if (out && out.error) return out;
    if (await save(env, raw, s)) { for (const f of fx) await f(); return out; }
    await new Promise((r) => setTimeout(r, 20 + rand01() * 60));
  }
  return { error: "busy, try again", status: 503 };
}
const addBag = (s, k, n = 1) => { s.bag[k] = (s.bag[k] || 0) + n; if (s.bag[k] <= 0) delete s.bag[k]; };
const take = (s, k, n = 1) => { if ((s.bag[k] || 0) < n) return false; addBag(s, k, -n); return true; };
export const bagKeyForFish = (id) => (FISH[id] && FISH[id].food ? "f:" + id : null);

// 给 index.js 用：钓到鱼 / 收菜时往背包里放东西
export async function bagAdd(env, items) {
  return mutate(env, (s) => { for (const [k, n] of Object.entries(items)) if (k) addBag(s, k, n); return { ok: true }; });
}

// ---------------------------------------------------------------- 料理
function itemTags(k) {
  if (k.startsWith("f:")) {
    const f = FISH[k.slice(2)];
    if (!f) return null;
    return { tags: [k.slice(2), f.food === "shell" ? "#shell" : f.food === "fish" ? "#fish" : "#inedible"], pond: f.spot === "pool" };
  }
  if (k.startsWith("d:")) return { tags: ["#dish"] };
  const g = GOODS[k];
  return g ? { tags: [k, "#" + g[2]] } : null;
}
function matchRecipe(items) {
  const info = items.map(itemTags);
  if (info.some((x) => !x)) return null;
  const cands = Object.entries(RECIPES).filter(([, r]) => r.in.length === items.length)
    .sort((a, b) => b[1].in.filter((x) => x[0] !== "#").length - a[1].in.filter((x) => x[0] !== "#").length);
  for (const [id, r] of cands) {
    const used = new Array(items.length).fill(false);
    const ok = (si) => {
      if (si === r.in.length) return true;
      for (let i = 0; i < items.length; i++) {
        if (used[i] || !info[i].tags.includes(r.in[si])) continue;
        used[i] = true;
        if (ok(si + 1)) return true;
        used[i] = false;
      }
      return false;
    };
    if (ok(0)) return id;
  }
  return "dark";
}
export const dishInfo = (key) => {
  const [, id, pond] = key.split(":");
  const r = id === "dark" ? DARK_DISH : RECIPES[id];
  return r ? { id, name: r.name, emoji: r.emoji, tag: r.tag, q: r.q, pond: pond === "pond" } : null;
};

// ---------------------------------------------------------------- 岛民
function makeVisitors(s, day, book) {
  const dow = new Date(Date.parse(day + "T12:00:00+08:00")).getUTCDay();
  const n = dow === 0 || dow === 6 ? randInt(2, 3) : randInt(1, 2);
  let pool = Object.keys(VISITORS).filter((v) => !s.residents.includes(v));
  if (pool.length < n) pool = Object.keys(VISITORS);
  const list = [];
  while (list.length < n && pool.length) {
    const id = pool.splice(Math.floor(rand01() * pool.length), 1)[0];
    const V = VISITORS[id];
    const type = pick(["dish", "dish", "fish", "goods"]);
    let req;
    if (type === "dish") {
      // 只要求现在弄得到食材的菜：菜地 + 已解锁的出海地点 + 背包里已经有的
      const avail = new Set(["tomato", "carrot", "pumpkin", "strawberry", "sunflower", "tulip", ...Object.keys(STARTER.bag), ...Object.keys(s.bag).filter((k) => !k.includes(":"))]);
      for (const k of s.islands) for (const g of VOYAGE[k].loot) avail.add(g);
      const cats = new Set([...avail].map((g) => "#" + (GOODS[g] || [])[2]).concat(["#fish", "#shell"]));
      const feasible = (r) => r.in.every((x) => (x[0] === "#" ? cats.has(x) : avail.has(x)));
      const liked = Object.entries(RECIPES).filter(([, r]) => V.likes.includes(r.tag) && feasible(r));
      const known = liked.filter(([k]) => s.recipes[k]);
      const easy = (known.length ? known : liked.filter(([, r]) => r.q <= 2));
      const src = easy.length ? easy : Object.entries(RECIPES).filter(([, r]) => r.q === 1 && feasible(r));
      req = { type: "dish", recipe: pick(src)[0] };
    } else if (type === "fish") {
      const caught = Object.keys(book).filter((f) => FISH[f] && FISH[f].food && (FISH[f].spot === "sea" || FISH[f].spot === "pool") && FISH[f].rarity !== "legend");
      const easy = Object.keys(FISH).filter((f) => FISH[f].food && FISH[f].spot === "sea" && FISH[f].rarity === "common" && !FISH[f].cond);
      req = { type: "fish", fish: pick(caught.length ? caught : easy) };
    } else {
      req = { type: "goods", good: pick(["tomato", "carrot", "pumpkin", "strawberry", "sunflower", "tulip"]), n: 2 };
    }
    list.push({ id, req, done: null });
  }
  s.visitors = { day, list };
}
function reqOk(req, item) {
  if (req.type === "dish") return item.startsWith("d:") && item.split(":")[1] === req.recipe;
  if (req.type === "fish") return item === "f:" + req.fish;
  if (req.type === "goods") return item === req.good;
  return false;
}

// ---------------------------------------------------------------- 突发事件
export function eventFor(day) {
  if ((fnv(day + "evt") % 1000) / 1000 >= EVENT_P) return null;
  const kinds = Object.entries(EVENTS);
  const total = kinds.reduce((a, [, e]) => a + e.w, 0);
  let x = ((fnv(day + "kind") % 10000) / 10000) * total, kind = kinds[0][0];
  for (const [k, e] of kinds) if ((x -= e.w) < 0) { kind = k; break; }
  const start = Date.parse(day + "T09:00:00+08:00") + (fnv(day + "hour") % 11) * H;
  return { key: day, kind, start, end: start + EVENT_HOURS * H };
}
function settleEvent(s, deps, fx) {
  const t = now(), today = deps.bjDay(), yday = deps.bjDay(t - 86400000);
  // 结束了的事件：收尾
  if (s.event && !s.event.over && t >= s.event.end) {
    const e = s.event;
    e.over = true;
    if (e.kind === "typhoon" && e.braced.some((b) => !b)) s.damage = (s.damage || 0) + 1; // 吹倒几件装饰在 settle 外面挑（需要钱包），见 knockDecor
    if (e.kind === "parrot" && !e.returned) e.lost = e.stolen || null;
  }
  // 现在应该在进行中的事件
  const cur = [eventFor(yday), eventFor(today)].find((e) => e && t >= e.start && t < e.end);
  const forced = s.forceEvent && t < s.forceEvent.end ? s.forceEvent : null;
  const want = forced || cur;
  if (want && (!s.event || s.event.key !== want.key)) {
    const e = { key: want.key, kind: want.kind, start: want.start, end: want.end, by: [] };
    if (want.kind === "typhoon") e.braced = [null, null, null];
    if (want.kind === "parrot") {
      e.hits = 0;
      const goods = Object.keys(s.bag).filter((k) => !k.startsWith("d:") && !k.startsWith("f:"));
      const any = Object.keys(s.bag);
      const k = goods.length ? pick(goods) : any.length ? pick(any) : null;
      if (k) take(s, k);
      e.stolen = k;
    }
    if (want.kind === "meteor" || want.kind === "lowtide") e.got = { me: 0, her: 0 };
    if (want.kind === "whale") e.pat = { me: false, her: false };
    s.event = e;
  }
}
function eventView(s, who) {
  const e = s.event;
  if (!e) return null;
  const E = EVENTS[e.kind];
  return { key: e.key, kind: e.kind, name: E.name, emoji: E.emoji, desc: E.desc, start: e.start, end: e.end, over: !!e.over || now() >= e.end,
    braced: e.braced, hits: e.hits, need: E.hits, stolen: e.stolen, returned: !!e.returned, lost: e.lost,
    got: e.got ? e.got[who] : undefined, per: E.per, pat: e.pat ? e.pat[who] : undefined, by: e.by };
}

// ---------------------------------------------------------------- 视图
async function bookCount(env) {
  const r = await env.DB.prepare("SELECT COUNT(DISTINCT fish) AS n FROM catches").first();
  return r ? r.n : 0;
}
function view(s, who, extra) {
  const today = extra.today;
  return {
    bag: s.bag, recipes: s.recipes, eggs: s.eggs, pets: s.pets,
    visitors: s.visitors && s.visitors.day === today ? s.visitors.list : [], affinity: s.affinity, residents: s.residents,
    mailReady: s.residents.length > 0 && s.mailDay !== today,
    voyage: s.voyage, miles: s.miles, islands: s.islands, event: eventView(s, who), knocked: s.knocked,
    claims: s.claims, aquarium: s.aquarium, bedpet: s.bedpet, book: extra.book, now: now(),
  };
}
async function knockDecor(s, deps, env) {
  if (!s.damage) return;
  s.damage = 0;
  const shown = await deps.shownDecor(env);
  const out = [];
  while (out.length < 2 && shown.length) out.push(shown.splice(Math.floor(rand01() * shown.length), 1)[0]);
  s.knocked = [...new Set([...s.knocked, ...out])];
}
export async function lifeGet(env, who, deps) {
  const today = deps.bjDay();
  const book = await bookMap(env);
  const out = await mutate(env, async (s) => {
    settleEvent(s, deps);
    await knockDecor(s, deps, env);
    if (!s.visitors || s.visitors.day !== today) makeVisitors(s, today, book);
    return view(s, who, { today, book: Object.keys(book).length });
  });
  return out;
}
async function bookMap(env) {
  const { results } = await env.DB.prepare("SELECT fish, COUNT(*) AS c FROM catches GROUP BY fish").all();
  return Object.fromEntries(results.map((x) => [x.fish, x.c]));
}

// ---------------------------------------------------------------- 操作
export async function lifePost(env, b, deps) {
  const who = b.who, today = deps.bjDay();
  const book = b.op === "claim" ? await bookMap(env) : {};
  const log = (fx, kind, item, n = null) => fx.push(() => deps.addEvent(env, who, kind, item, n));
  const res = await mutate(env, async (s, fx) => {
    settleEvent(s, deps, fx);
    await knockDecor(s, deps, env);
    const T = now();
    switch (b.op) {
      case "cook": {
        const items = b.items;
        if (!Array.isArray(items) || items.length < 2 || items.length > 3 || items.some((k) => typeof k !== "string")) return { error: "bad items" };
        const need = {};
        for (const k of items) need[k] = (need[k] || 0) + 1;
        for (const [k, n] of Object.entries(need)) if ((s.bag[k] || 0) < n) return { error: "not in bag", status: 409, item: k };
        const rid = matchRecipe(items);
        for (const [k, n] of Object.entries(need)) take(s, k, n);
        const pond = rid !== "dark" && items.some((k) => k.startsWith("f:") && FISH[k.slice(2)] && FISH[k.slice(2)].spot === "pool");
        const key = "d:" + rid + (pond ? ":pond" : "");
        addBag(s, key);
        const first = rid !== "dark" && !s.recipes[rid];
        if (rid !== "dark") s.recipes[rid] = { n: (s.recipes[rid] ? s.recipes[rid].n : 0) + 1, by: s.recipes[rid] ? s.recipes[rid].by : who, ts: s.recipes[rid] ? s.recipes[rid].ts : T };
        log(fx, "cook", rid);
        if (first) fx.push(() => deps.mint(env, `recipe:${rid}`, 2));
        return { dish: key, recipe: rid, first, stars: first ? 2 : 0 };
      }
      case "feed": {
        const egg = s.eggs.find((e) => e.id === b.egg && e.inc);
        if (!egg) return { error: "no such egg", status: 404 };
        if (egg.feeds.length >= EGG_FEEDS) return { error: "egg is full", status: 409 };
        if (typeof b.dish !== "string" || !b.dish.startsWith("d:") || !take(s, b.dish)) return { error: "no such dish", status: 409 };
        const d = dishInfo(b.dish);
        egg.feeds.push({ who, tag: d.tag, pond: d.pond, dish: d.id, ts: T });
        return { egg: egg.id, feeds: egg.feeds.length, ready: egg.feeds.length >= EGG_FEEDS && T - egg.at >= EGG_MIN_HOURS * H, readyAt: egg.at + EGG_MIN_HOURS * H };
      }
      case "hatch": {
        const i = s.eggs.findIndex((e) => e.id === b.egg && e.inc);
        if (i < 0) return { error: "no such egg", status: 404 };
        const egg = s.eggs[i];
        if (egg.feeds.length < EGG_FEEDS || T - egg.at < EGG_MIN_HOURS * H) return { error: "not ready", status: 409, readyAt: egg.at + EGG_MIN_HOURS * H };
        const cnt = {};
        for (const f of egg.feeds) { cnt[f.tag] = (cnt[f.tag] || 0) + 1; if (f.pond) cnt.pond = (cnt.pond || 0) + 1; }
        const PRI = ["star", "pond", "cold", "hot", "flower", "sweet", "sea", "land", "dark"];
        let best = "dark";
        for (const t of PRI) if ((cnt[t] || 0) > (cnt[best] || 0)) best = t;
        if (egg.pattern === "star" && !cnt.dark) best = "star"; // 星星花纹的蛋（图鉴奖励）一定孵星星团子
        const species = HATCH[best] || "duckling";
        const both = new Set(egg.feeds.map((f) => f.who)).size >= 2;
        const shiny = rand01() < SHINY_P * (both ? 2 : 1);
        const pet = { id: s.seq++, species, variant: shiny ? 3 : randInt(0, 2), born: T, by: [...new Set(egg.feeds.map((f) => f.who))], egg: egg.pattern };
        s.pets.push(pet);
        s.eggs.splice(i, 1);
        const next = s.eggs.find((e) => !e.inc);
        if (next) { next.inc = true; next.at = T; }
        log(fx, "hatch", species, pet.variant);
        fx.push(() => deps.mint(env, `hatch:${pet.id}`, 3));
        return { pet, both };
      }
      case "name": {
        const p = s.pets.find((x) => x.id === b.pet);
        if (!p) return { error: "no such pet", status: 404 };
        if (typeof b.box !== "string" || b.box.length > 400 || !/^[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$/.test(b.box)) return { error: "bad name" };
        p.name = b.box;
        return { ok: true };
      }
      case "give": {
        if (!s.visitors || s.visitors.day !== today) return { error: "no visitors", status: 409 };
        const v = s.visitors.list.find((x) => x.id === b.visitor);
        if (!v) return { error: "no such visitor", status: 404 };
        if (v.done) return { error: "already done", status: 409 };
        const item = String(b.item || "");
        if (!reqOk(v.req, item)) return { error: "not what they want", status: 409 };
        const n = v.req.n || 1;
        if (!take(s, item, n)) return { error: "not in bag", status: 409 };
        const V = VISITORS[v.id];
        const [lo, hi] = VISIT_REWARD[v.req.type];
        const stars = randInt(lo, hi) + (v.req.type === "dish" ? (RECIPES[v.req.recipe] || { q: 1 }).q - 1 : 0);
        const gift = pick(V.gift);
        const giftN = randInt(1, 2);
        addBag(s, gift, giftN);
        let egg = null;
        if (rand01() < 0.2) { egg = pick(EGG_PATTERNS.filter((p) => p !== "star")); addEgg(s, egg); }
        s.affinity[v.id] = (s.affinity[v.id] || 0) + 1;
        const movedIn = s.affinity[v.id] >= MOVE_IN && !s.residents.includes(v.id);
        if (movedIn) s.residents.push(v.id);
        v.done = { who, ts: T };
        log(fx, "visit", v.id, movedIn ? 1 : 0);
        fx.push(() => deps.mint(env, `visit:${today}:${v.id}`, stars));
        return { visitor: v.id, stars, gift, giftN, egg, affinity: s.affinity[v.id], movedIn, thanks: V.thanks };
      }
      case "mail": {
        if (!s.residents.length) return { error: "no residents", status: 409 };
        if (s.mailDay === today) return { error: "already collected", status: 409 };
        s.mailDay = today;
        const got = s.residents.map((r) => ({ from: r, good: pick(VISITORS[r].gift) }));
        for (const g of got) addBag(s, g.good);
        return { got };
      }
      case "sail": {
        if (s.voyage) return { error: "boat is out", status: 409 };
        const D = VOYAGE[b.dest];
        if (!D || !s.islands.includes(b.dest)) return { error: "bad destination" };
        const dishes = b.dishes;
        if (!Array.isArray(dishes) || dishes.length < 1 || dishes.length > 3) return { error: "bring 1–3 dishes" };
        const need = {};
        for (const k of dishes) { if (typeof k !== "string" || !k.startsWith("d:")) return { error: "bad dish" }; need[k] = (need[k] || 0) + 1; }
        for (const [k, n] of Object.entries(need)) if ((s.bag[k] || 0) < n) return { error: "not in bag", status: 409, item: k };
        for (const [k, n] of Object.entries(need)) take(s, k, n);
        const q = dishes.reduce((a, k) => a + Math.max(0.5, (dishInfo(k) || { q: 0 }).q), 0);
        s.voyage = { dest: b.dest, at: T, eta: T + D.hours * H, q, by: who, dishes };
        log(fx, "sail", b.dest, dishes.length);
        return { voyage: s.voyage };
      }
      case "unload": {
        const v = s.voyage;
        if (!v) return { error: "no voyage", status: 409 };
        if (T < v.eta) return { error: "not back yet", status: 409, eta: v.eta };
        const D = VOYAGE[v.dest];
        const n = Math.min(9, 2 + Math.round(v.q));
        const loot = {};
        for (let i = 0; i < n; i++) { const g = pick(D.loot); loot[g] = (loot[g] || 0) + 1; addBag(s, g); }
        let egg = null, fish = null, cm = null;
        if (rand01() < VOYAGE_EGG_P + 0.03 * v.q) { egg = pick(EGG_PATTERNS.filter((p) => p !== "star")); addEgg(s, egg); }
        if (D.fish && rand01() < VOYAGE_FISH_P) {
          const ids = Object.keys(FISH).filter((f) => FISH[f].spot === D.fish);
          if (ids.length) {
            fish = weighted(ids);
            cm = sizeOf(fish);
            const k = bagKeyForFish(fish);
            if (k) addBag(s, k);
            const sailor = v.by;
            fx.push(() => env.DB.prepare("INSERT INTO catches (ts, who, fish, cm, spot) VALUES (?, ?, ?, ?, ?)").bind(T, sailor, fish, cm, D.fish).run());
          }
        }
        const before = s.islands.slice();
        s.miles += D.miles;
        for (const [k, d] of Object.entries(VOYAGE)) if (d.unlock && s.miles >= d.unlock && !s.islands.includes(k)) s.islands.push(k);
        const found = s.islands.filter((k) => !before.includes(k));
        s.voyage = null;
        log(fx, "voyage", v.dest, n);
        fx.push(() => deps.mint(env, `voyage:${v.at}`, 2));
        return { dest: v.dest, loot, egg, fish, cm, miles: s.miles, found, stars: 2 };
      }
      case "brace": case "shoo": case "collect": case "whale": {
        const e = s.event;
        if (!e || e.over || T >= e.end || T < e.start) return { error: "no event", status: 409 };
        if (!e.by.includes(who)) e.by.push(who);
        if (b.op === "brace" && e.kind === "typhoon") {
          const i = b.i;
          if (!(Number.isInteger(i) && i >= 0 && i < e.braced.length)) return { error: "bad spot" };
          if (e.braced[i]) return { error: "already braced", status: 409 };
          e.braced[i] = who;
          const done = e.braced.every(Boolean);
          let stars = 0;
          if (done) {
            const both = new Set(e.braced).size >= 2;
            stars = 5 + (both ? 3 : 0);
            fx.push(() => deps.mint(env, `typhoon:${e.key}`, stars));
            e.over = true; e.saved = true;
          }
          log(fx, "evt", "typhoon", done ? 1 : 0);
          return { braced: e.braced, done, stars };
        }
        if (b.op === "shoo" && e.kind === "parrot") {
          e.hits++;
          const done = e.hits >= EVENTS.parrot.hits;
          if (done) {
            if (e.stolen) addBag(s, e.stolen, 2);
            e.returned = true; e.over = true;
            fx.push(() => deps.mint(env, `parrot:${e.key}`, 2));
            log(fx, "evt", "parrot", 1);
          }
          return { hits: e.hits, done, returned: done ? e.stolen : null };
        }
        if (b.op === "collect" && (e.kind === "meteor" || e.kind === "lowtide")) {
          const per = EVENTS[e.kind].per;
          if (e.got[who] >= per) return { error: "pocket full", status: 409 };
          e.got[who]++;
          let item;
          if (e.kind === "meteor") item = "starbit";
          else item = rand01() < 0.1 ? "pearl" : pick(["clam", "clam", "kelp", "salt"]);
          addBag(s, item);
          if (e.got[who] === per) log(fx, "evt", e.kind, per);
          return { item, got: e.got[who], per };
        }
        if (b.op === "whale" && e.kind === "whale") {
          if (e.pat[who]) return { error: "already", status: 409 };
          e.pat[who] = true;
          let egg = null;
          const items = { pearl: 1, clam: 2, kelp: 1 };
          if (rand01() < 0.3) { egg = "sea"; addEgg(s, "sea"); }
          for (const [k, n] of Object.entries(items)) addBag(s, k, n);
          fx.push(() => deps.mint(env, `whale:${e.key}:${who}`, 2));
          log(fx, "evt", "whale", 1);
          return { items, egg, stars: 2 };
        }
        return { error: "wrong event" };
      }
      case "repair": {
        if (!s.knocked.includes(b.decor)) return { error: "not broken", status: 409 };
        s.knocked = s.knocked.filter((d) => d !== b.decor);
        fx.push(() => deps.mint(env, `repair:${T}`, 1));
        return { knocked: s.knocked, stars: 1 };
      }
      case "claim": {
        const m = BOOK_MILESTONES.find((x) => x.n === b.n);
        if (!m) return { error: "bad milestone" };
        if (s.claims.includes(m.n)) return { error: "already claimed", status: 409 };
        if (Object.keys(book).length < m.n) return { error: "not yet", status: 409 };
        s.claims.push(m.n);
        const r = m.reward;
        if (r.egg) addEgg(s, r.egg);
        if (r.aquarium) s.aquarium = true;
        if (r.stars) fx.push(() => deps.mint(env, `book:${m.n}`, r.stars));
        if (r.pet) s.pets.push({ id: s.seq++, species: r.pet, variant: 3, born: T, by: ["me", "her"], egg: "star" });
        log(fx, "claim", String(m.n));
        return { claimed: m.n, reward: r };
      }
      case "bedpet": {
        if (typeof b.kind !== "string" || !/^[a-z]{2,12}$/.test(b.kind)) return { error: "bad kind" };
        s.bedpet = b.kind;
        return { ok: true };
      }
      case "debug_event": {
        if (env.DEV !== "1" || !EVENTS[b.kind]) return { error: "nope", status: 403 };
        s.forceEvent = { key: "dbg" + T, kind: b.kind, start: T, end: T + 2 * H };
        s.event = null;
        settleEvent(s, deps, fx);
        return { ok: true };
      }
      case "debug_end": { // 本地测试：当前事件立刻结束
        if (env.DEV !== "1" || !s.event) return { error: "nope", status: 403 };
        s.event.end = T - 1; if (s.forceEvent) s.forceEvent.end = T - 1;
        return { ok: true };
      }
      case "debug_rush": { // 本地测试：蛋和船立刻就绪
        if (env.DEV !== "1") return { error: "nope", status: 403 };
        for (const e of s.eggs) e.at -= EGG_MIN_HOURS * H;
        if (s.voyage) s.voyage.eta = T - 1;
        return { ok: true };
      }
      default: return { error: "bad op" };
    }
  });
  return res;
}
function addEgg(s, pattern) {
  const inc = s.eggs.filter((e) => e.inc).length < INCUBATOR_SLOTS;
  s.eggs.push({ id: s.seq++, pattern, at: now(), feeds: [], inc });
}

// ---------------------------------------------------------------- 钓鱼用到的：条件、尺寸
export function sizeOf(id) {
  const base = (FISH[id] && FISH[id].cm) || 20;
  const k = 0.75 + rand01() * 0.6 + (rand01() < 0.05 ? 0.35 : 0); // 偶尔来一条特别大的
  return Math.max(1, Math.round(base * k));
}
const SEASON = (m) => (m >= 3 && m <= 5 ? "spring" : m >= 6 && m <= 8 ? "summer" : m >= 9 && m <= 11 ? "autumn" : "winter");
const TOD = (h) => (h >= 5 && h < 8 ? "dawn" : h >= 8 && h < 17 ? "day" : h >= 17 && h < 19 ? "dusk" : "night");
function fullMoon(t) {
  const age = (((t - Date.UTC(2000, 0, 6, 18, 14)) / 86400000) % 29.530588 + 29.530588) % 29.530588;
  return age > 13.3 && age < 16.3;
}
// 某人此刻的"钓鱼环境"：当地时段、季节、天气、满月（用 /world 缓存的城市时区和天气）
export function fishEnv(w, who, t = now()) {
  const c = w && w[who];
  const off = c ? c.offset : 8 * 60;
  const d = new Date(t + off * 60000);
  const kind = c ? c.kind : "clear";
  return { time: TOD(d.getUTCHours()), season: SEASON(d.getUTCMonth() + 1), weather: kind === "rain" || kind === "storm" ? "rain" : kind === "snow" ? "snow" : "clear", moon: fullMoon(t) ? "full" : "" };
}
export function catchable(id, spot, env) {
  const f = FISH[id];
  if (!f || f.spot !== spot) return false;
  const c = f.cond;
  if (!c) return true;
  if (c.time && !c.time.includes(env.time)) return false;
  if (c.season && !c.season.includes(env.season)) return false;
  if (c.weather && !c.weather.includes(env.weather)) return false;
  if (c.moon && env.moon !== c.moon) return false;
  return true;
}
export { weighted as rollWeighted };
