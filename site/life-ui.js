// 小岛生活（v15）的界面：背包、小屋（做饭 / 孵蛋 / 宠物 / 信箱 / 菜谱 / 相册）、岛民、出海、突发事件、拍照、图鉴 2.0。
// 后端是 /life 和 /photos（worker/src/life.js、index.js），游戏数据和后端共用 lifedata.js / fishdata.js。
// 依赖 social.js 挂出来的 window.NEST_SOCIAL（令牌、加解密、say、钱包…）和 scene3d.js 的 window.NEST3D（3D 那一侧）。
import { FISH, FISH_IDS } from "./fishdata.js?v=15.1";
import * as L from "./lifedata.js?v=15.1";

window.NEST_FISH = FISH;
const S = window.NEST_SOCIAL;
const R = () => window.NEST3D || {};
const $ = (q, el = document) => el.querySelector(q);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const RAR = { common: ["普通", "#8d99a6"], rare: ["稀有", "#2f8fd8"], epic: ["史诗", "#9b59d0"], legend: ["传说", "#e0a000"] };
const SPOT = { sea: "码头", pool: "瀑布水潭", "far:sakura": "樱花岛（出海）", "far:snow": "雪岛（出海）", "far:volcano": "火山岛（出海）" };
const TIME = { dawn: "清晨", day: "白天", dusk: "傍晚", night: "夜里" }, SEASON = { spring: "春", summer: "夏", autumn: "秋", winter: "冬" }, WEATHER = { rain: "下雨", snow: "下雪", clear: "晴天" };
const LIFE_KINDS = new Set(["cook", "hatch", "visit", "sail", "voyage", "evt", "claim", "photo", "fish", "dfish", "farm"]);

let life = null, homeSub = "cook", pot = [], inside = false, bookTab = "all", voyPick = [], visitFocus = null, busy = false;
const thumbs = new Map(), sils = new Map();


/* ------------------------------------------------------------ 基础 */
function boot() {
  // 面板：挂到钱包下面，和原来的面板一起由 social.openPanel 管开关
  const tabs = $("#tabs"), wal = $("#wallet");
  tabs.insertAdjacentHTML("afterbegin", `<button type="button" data-lpanel="home">🏡 小屋</button><button type="button" data-lpanel="bag">🎒 背包</button>
    <button type="button" data-lpanel="visit">🦊 岛民<i class="dot" id="l-vdot" hidden></i></button><button type="button" data-lpanel="voyage">⛵ 出海<i class="dot" id="l-sdot" hidden></i></button>`);
  for (const id of ["home", "bag", "visit", "voyage"]) wal.insertAdjacentHTML("beforeend", `<div class="panel lpanel" id="l-${id}" hidden></div>`);
  Object.assign(S.PANELS, { home: "#l-home", bag: "#l-bag", visit: "#l-visit", voyage: "#l-voyage" });
  document.querySelectorAll("[data-lpanel]").forEach((b) => b.setAttribute("data-panel", b.dataset.lpanel));
  // 场景上的浮层：事件横幅、拍照按钮、出门按钮
  const scene = $("#scene");
  scene.insertAdjacentHTML("beforeend", `<div class="l-evt" id="l-evt" hidden></div>
    <button type="button" class="l-cam" id="l-cam" title="拍照">📷</button>
    <button type="button" class="l-door" id="l-door" hidden>🚪 出门</button>`);
  document.body.insertAdjacentHTML("beforeend", `<div class="l-photo" id="l-photo" hidden></div><div class="l-modal" id="l-modal" hidden></div>`);
  $("#l-cam").addEventListener("click", startPhoto);
  $("#l-evt").addEventListener("click", () => $("#l-evt").classList.toggle("open"));
  $("#l-door").addEventListener("click", () => leaveHome());
  document.addEventListener("click", onClick, true);
  addEventListener("nest:tap", onTap);
  addEventListener("nest:home", (ev) => { inside = !!ev.detail.inside; $("#l-door").hidden = !inside; $("#l-cam").hidden = inside; $("#scene").classList.toggle("inside", inside); });
  addEventListener("nest:lifeready", () => push3d());
  addEventListener("nest:update", () => refresh());
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
  setInterval(() => { if (!document.hidden) refresh(); }, 60000);
  setInterval(tickBanner, 1000);
  // 床上的小伙伴选哪种：存到后端，两边同步（以前只存在各自的浏览器里）
  document.addEventListener("click", (e) => {
    if (!e.target.closest("[data-species]")) return;
    setTimeout(() => { const k = R().species && R().species(); if (k && S.me()) { lastBed = k; api("bedpet", { kind: k }).catch(() => {}); } }, 60);
  });
  window.NEST_LIFE = { line, remote, renderBook, refresh, state: () => life };
  refresh();
}
async function token() { return S.token(); }
async function api(op, body = {}) {
  const r = await fetch(S.API + "/life", { method: "POST", headers: { authorization: "Bearer " + (await token()), "content-type": "application/json" }, body: JSON.stringify({ who: S.me(), op, ...body }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || "api " + r.status), { j });
  return j;
}
let loading = null;
async function refresh() {
  if (!S.me() || loading) return loading;
  loading = (async () => {
    try {
      const r = await fetch(S.API + "/life?who=" + S.me(), { headers: { authorization: "Bearer " + (await token()) } });
      if (r.ok) { life = await r.json(); push3d(); renderAll(); syncBed(); }
    } catch {}
  })().finally(() => { loading = null; });
  return loading;
}
let refTimer = 0;
const softRefresh = () => { clearTimeout(refTimer); refTimer = setTimeout(refresh, 400); };
let lastBed = null;
function syncBed() {
  if (!life.bedpet || life.bedpet === lastBed) return;
  lastBed = life.bedpet;
  if (R().species && R().species() !== life.bedpet && R().setSpecies) R().setSpecies(life.bedpet);
}
function push3d() { if (life && R().setLife) R().setLife(life, S.me()); }
const ERR = { "not in bag": "背包里没有这个", "not what they want": "它想要的不是这个", "boat is out": "小船还在海上", "not back yet": "小船还没回来", "not ready": "还没准备好", "egg is full": "这颗蛋已经吃饱了", "pocket full": "口袋装满啦", "already braced": "这里已经加固好了", "no event": "事件已经结束了", "already": "已经摸过啦", "already done": "已经帮过它了", "already collected": "今天的信已经收过了", "busy, try again": "人有点多，再点一次" };
const errText = (e) => ERR[e.message] || e.message;
async function act(op, body, ok) {
  if (busy) return null;
  busy = true;
  try { const j = await api(op, body); if (ok) await ok(j); await refresh(); S.loadWallet(); return j; }
  catch (e) { S.say("没成功：" + errText(e)); return null; }
  finally { busy = false; }
}

/* ------------------------------------------------------------ 名字 / 图标 */
export function itemInfo(k) {
  if (k.startsWith("f:")) { const f = FISH[k.slice(2)]; return f ? { name: f.name, emoji: f.emoji, kind: "fish", fish: k.slice(2) } : { name: k, emoji: "🐟", kind: "fish" }; }
  if (k.startsWith("d:")) {
    const [, id, pond] = k.split(":");
    const r = id === "dark" ? L.DARK_DISH : L.RECIPES[id];
    return { name: (r ? r.name : id) + (pond ? "·水潭" : ""), emoji: r ? r.emoji : "🍽", kind: "dish", q: r ? r.q : 0, tag: r && r.tag };
  }
  const g = L.GOODS[k];
  return g ? { name: g[0], emoji: g[1], kind: "good", cat: g[2] } : { name: k, emoji: "❔", kind: "good" };
}
const chip = (k, n) => { const i = itemInfo(k); return `${i.emoji} ${esc(i.name)}${n > 1 ? " ×" + n : ""}`; };
const hours = (ms) => { const m = Math.max(0, Math.round(ms / 60000)); return m >= 60 ? `${Math.floor(m / 60)} 小时 ${m % 60} 分` : `${m} 分钟`; };
const petLook = (p) => { const looks = R().petLooks && R().petLooks(); const v = looks && looks[p.species] && looks[p.species].variants[p.variant]; return v ? v.name : ["一号色", "二号色", "三号色", "闪光"][p.variant]; };
const fishThumb = async (ids, silhouette) => {
  const cache = silhouette ? sils : thumbs;
  const need = ids.filter((id) => !cache.has(id));
  if (need.length && R().fishThumbs) { try { const m = await R().fishThumbs(need, { silhouette }); for (const [k, v] of m) cache.set(k, v); } catch {} }
  return cache;
};

/* ------------------------------------------------------------ 日记 / 对方的动作 */
function line(e, w) {
  const V = L.VISITORS, P = L.PETS;
  if (e.kind === "cook") { if (e.item === "dark") return `${w}做出了一锅黑暗料理 🌑`; const r = L.RECIPES[e.item]; return r ? `${w}做了一道${r.name} ${r.emoji}` : ""; }
  if (e.kind === "hatch") { const p = P[e.item]; return p ? `${w}孵出了一只${p.name} ${p.emoji}${e.n === 3 ? "（闪光的！✨）" : ""}` : ""; }
  if (e.kind === "visit") { const v = V[e.item]; return v ? `${w}满足了${v.name}的心愿${e.n ? "，它决定搬到岛上住啦 🏡" : " 💝"}` : ""; }
  if (e.kind === "sail") { const d = L.VOYAGE[e.item]; return d ? `${w}派小船去${d.name}啦 ⛵` : ""; }
  if (e.kind === "voyage") { const d = L.VOYAGE[e.item]; return d ? `小船从${d.name}回来了，带回 ${e.n} 样东西 ⛵` : ""; }
  if (e.kind === "evt") {
    return { typhoon: e.n ? `台风被挡住了！${w}加固了最后一处 🌀` : `${w}加固了一处 🔨`, parrot: `${w}把偷东西的鹦鹉赶跑了 🦜`, meteor: `${w}捡完了流星碎片 🌠`, lowtide: `${w}在退潮的沙滩捡了一兜贝壳 🐚`, whale: `${w}摸了摸路过的鲸鱼 🐋` }[e.item] || "";
  }
  if (e.kind === "claim") return `图鉴集到 ${e.item} 种，领到了奖励 🎁`;
  if (e.kind === "photo") return `${w}拍了一张照片 📷`;
  return "";
}
function remote(e) {
  if (!LIFE_KINDS.has(e.kind)) return;
  softRefresh();
  if (e.who === S.me() || Date.now() - e.ts > 120000) return;
  const w = S.whoName(e.who);
  if (e.kind === "hatch") { S.say(`🐣 ${line(e, w)}`); S.burst(); }
  else if (e.kind === "photo") { S.say(`📷 ${w}拍了一张照片，去小屋的照片墙看看`); albumDirty = true; }
  else if (["cook", "visit", "sail", "voyage", "evt", "claim"].includes(e.kind)) { const t = line(e, w); if (t) S.say(t); }
}

/* ------------------------------------------------------------ 点击 */
async function onClick(ev) {
  const b = ev.target.closest("[data-l]");
  if (b) { ev.preventDefault(); ev.stopPropagation(); await handle(b.dataset.l, b.dataset, b); return; }
  const t = ev.target.closest("[data-lpanel]");
  if (t) {
    if (t.dataset.lpanel === "home") { ev.preventDefault(); ev.stopPropagation(); if (S.panel() === "home" && inside) leaveHome(); else enterHome(); return; }
    setTimeout(renderAll, 0);
  }
}
async function handle(k, d, el) {
  const me = S.me();
  switch (k) {
    case "sub": homeSub = d.v; renderHome(); if (R().homeFocus) R().homeFocus(d.v); break;
    case "pot": if (pot.length < 3 && countLeft(d.v) > 0) { pot.push(d.v); S.sfx("pop"); } renderHome(); break;
    case "unpot": pot.splice(Number(d.i), 1); renderHome(); break;
    case "cook": {
      if (pot.length < 2) { S.say("至少放两样食材进锅里"); break; }
      R().lifeFx && R().lifeFx("cook");
      const items = pot.slice();
      await act("cook", { items }, async (j) => {
        pot = [];
        const i = itemInfo(j.dish);
        await new Promise((r) => setTimeout(r, 900));
        card(j.recipe === "dark" ? "🌑" : i.emoji, j.recipe === "dark" ? "黑暗料理……" : i.name,
          j.recipe === "dark" ? `<p class="muted">好像哪里不对……但宠物蛋不挑食（可能会孵出小黄鸭）</p>` : `${j.first ? `<p class="first">新菜谱！收进菜谱本 📖</p>` : ""}${j.stars ? `<p class="gain">+${j.stars} ⭐</p>` : ""}<p class="muted">放进背包了，可以喂蛋、送岛民、当出海的补给</p>`);
      });
      break;
    }
    case "feed": {
      const dishes = Object.keys(life.bag).filter((x) => x.startsWith("d:"));
      if (!dishes.length) { S.say("背包里还没有菜，先去灶台做一道吧 🍳"); homeSub = "cook"; renderHome(); break; }
      modal(`<h3>喂这颗蛋吃什么？</h3><p class="muted small">孵出什么宠物，看喂过的菜是什么口味（海鲜→小海豹、蔬菜→小兔、甜的→小刺猬、花→小鹿、冰的→北极狐、辣的→小火蜥、星星→星星团子、水潭的鱼→六角恐龙）</p>
        <div class="shop">${dishes.map((x) => `<button class="item" data-l="feed2" data-egg="${d.egg}" data-v="${x}"><span class="emo">${itemInfo(x).emoji}</span><b>${esc(itemInfo(x).name)}</b><small>${tagName(itemInfo(x).tag)} ×${life.bag[x]}</small></button>`).join("")}</div>`);
      break;
    }
    case "feed2": closeModal(); await act("feed", { egg: Number(d.egg), dish: d.v }, (j) => { R().lifeFx && R().lifeFx("feed", { egg: Number(d.egg) }); S.say(j.ready ? "吃饱啦！可以孵化了 🐣" : `喂好了（${j.feeds}/${L.EGG_FEEDS}）${j.feeds >= L.EGG_FEEDS ? `，${hours(j.readyAt - Date.now())}后就能孵` : ""}`); }); break;
    case "hatch": {
      R().lifeFx && R().lifeFx("hatch", { egg: Number(d.egg) });
      await new Promise((r) => setTimeout(r, 1600));
      await act("hatch", { egg: Number(d.egg) }, (j) => {
        const p = L.PETS[j.pet.species];
        card(p.emoji, `${p.name}`, `<small style="color:${j.pet.variant === 3 ? "#e0a000" : "#9a857b"}">${j.pet.variant === 3 ? "✨ 闪光的！" : petLook(j.pet)}</small>
          <p class="muted">${j.both ? "你们俩都喂过它，它最喜欢你们了 💕" : "它会在岛上到处溜达"}</p><p class="gain">+3 ⭐</p>
          <button data-l="rename" data-pet="${j.pet.id}">给它起个名字</button>`);
        S.burst();
      });
      break;
    }
    case "rename": {
      const nm = prompt("给它起个名字（只有你们俩看得到）", "");
      if (!nm || !nm.trim()) break;
      const box = await S.seal(nm.trim().slice(0, 12));
      document.querySelectorAll(".catch-card").forEach((c) => c.remove());
      await act("name", { pet: Number(d.pet), box }, () => { names.delete(Number(d.pet)); S.say("名字起好啦 🏷"); });
      break;
    }
    case "mail": await act("mail", {}, (j) => card("📮", "岛民的信", j.got.map((g) => `<p>${L.VISITORS[g.from].name}：送来了 ${chip(g.good)}</p>`).join(""))); break;
    case "give": {
      const v = life.visitors.find((x) => x.id === d.v);
      if (!v) break;
      const item = v.req.type === "dish" ? Object.keys(life.bag).find((x) => x.startsWith("d:" + v.req.recipe)) : v.req.type === "fish" ? "f:" + v.req.fish : v.req.good;
      await act("give", { visitor: v.id, item }, (j) => {
        R().lifeFx && R().lifeFx("give", { visitor: v.id });
        card("💝", L.VISITORS[v.id].name, `<p>「${esc(j.thanks)}」</p><p class="gain">+${j.stars} ⭐</p><p class="muted">回礼：${chip(j.gift, j.giftN)}${j.egg ? " · 还有一颗蛋 🥚" : ""}</p>
          <p class="muted">好感 ${"💗".repeat(Math.min(j.affinity, L.MOVE_IN))}${"🤍".repeat(Math.max(0, L.MOVE_IN - j.affinity))}</p>${j.movedIn ? `<p class="first">${L.VISITORS[v.id].name}决定搬到岛上住啦 🏡 以后每天都会往信箱里塞小礼物</p>` : ""}`);
      });
      break;
    }
    case "dest": voyDest = d.v; renderVoyage(); break;
    case "vdish": { const i = voyPick.indexOf(d.v); if (i >= 0) voyPick.splice(i, 1); else if (voyPick.length < 3 && countFree(d.v) > 0) voyPick.push(d.v); renderVoyage(); break; }
    case "sail": if (!voyPick.length) { S.say("至少带一道菜当补给"); break; } await act("sail", { dest: voyDest, dishes: voyPick }, () => { voyPick = []; R().lifeFx && R().lifeFx("sail"); S.say("小船出发啦 ⛵ 一路顺风"); }); break;
    case "unload": await act("unload", {}, (j) => {
      R().lifeFx && R().lifeFx("unload");
      const D = L.VOYAGE[j.dest];
      card("⛵", `从${D.name}回来啦`, `<p>${Object.entries(j.loot).map(([k, n]) => chip(k, n)).join(" · ")}</p>${j.fish ? `<p class="first">还钓到了一条${FISH[j.fish].name} ${FISH[j.fish].emoji}（${j.cm} cm）</p>` : ""}${j.egg ? `<p class="first">捡到一颗蛋 🥚</p>` : ""}
        <p class="gain">+${j.stars} ⭐</p><p class="muted">航程 ${j.miles} 海里</p>${j.found.map((f) => `<p class="first">发现了新的小岛：${L.VOYAGE[f].name} ${L.VOYAGE[f].emoji}！</p>`).join("")}`);
    }); break;
    case "claim": await act("claim", { n: Number(d.n) }, (j) => { const m = L.BOOK_MILESTONES.find((x) => x.n === j.claimed); card("🎁", `图鉴 ${j.claimed} 种`, `<p>领到了：${esc(m.text)}</p>`); S.burst(); }); break;
    case "btab": bookTab = d.v; renderBook($("#book"), S.wallet()); break;
    case "fish": fishDetail(d.v); break;
    case "close": closeModal(); break;
    case "album": openAlbum(); break;
    case "photo": viewPhoto(Number(d.id)); break;
    case "delphoto": if (confirm("删掉这张照片？删了就找不回来了")) { await delPhoto(Number(d.id)); } break;
    case "yearbook": yearbook(); break;
    case "cam": closeModal(); leaveHome().then(startPhoto); break;
    case "frame": photoFrame = d.v; renderPhotoBar(); break;
    case "pose": R().play && R().play(d.v, me); break;
    case "shoot": shoot(); break;
    case "pclose": stopPhoto(); break;
    case "psave": savePhoto(); break;
    case "pdown": downloadPhoto(); break;
    case "pretake": $("#l-modal").hidden = true; break;
    case "evtgo": evtHint(); break;
  }
}
const tagName = (t) => ({ sea: "海鲜味", land: "田园味", sweet: "甜的", flower: "花香", cold: "冰的", hot: "辣的", star: "星星味", dark: "黑暗系" }[t] || "");
const countLeft = (k) => (life.bag[k] || 0) - pot.filter((x) => x === k).length;
const countFree = (k) => (life.bag[k] || 0) - voyPick.filter((x) => x === k).length;
let voyDest = "near";

/* ------------------------------------------------------------ 3D 里点到的东西 */
async function onTap(ev) {
  const d = ev.detail || {};
  if (d.what === "house") { enterHome(); return; }
  if (d.what === "hotspot") {
    const map = { stove: "cook", incubator: "eggs", photowall: "album", aquarium: "book", shelf: "bag", mailbox: "mail", recipes: "recipes" };
    if (d.id === "door") { leaveHome(); return; }
    if (map[d.id] === "book") { S.openPanel("book"); return; }
    if (map[d.id] === "album") { homeSub = "album"; renderHome(); openAlbum(); return; }
    if (map[d.id]) { homeSub = map[d.id]; if (S.panel() !== "home") S.openPanel("home"); renderHome(); scrollPanel(); }
    return;
  }
  if (d.what === "visitor") { visitFocus = d.id; if (S.panel() !== "visit") S.openPanel("visit"); renderVisit(); scrollPanel(); return; }
  if (d.what === "boat") { if (S.panel() !== "voyage") S.openPanel("voyage"); renderVoyage(); scrollPanel(); return; }
  if (d.what === "lifepet") {
    const p = life && life.pets.find((x) => x.id === d.id);
    if (p) { const nm = await petName(p); S.say(`${L.PETS[p.species].emoji} ${nm}蹭了蹭你`); S.hearts(d.x, d.y, 6); R().lifeFx && R().lifeFx("petHappy", { id: p.id }); }
    return;
  }
  if (d.what === "knocked") { await act("repair", { decor: d.id }, () => { R().lifeFx && R().lifeFx("repair", { id: d.id }); S.say("扶好了 🔨 +1 ⭐"); }); return; }
  if (d.what === "evt" && life && life.event && !life.event.over) {
    const e = life.event;
    if (e.kind === "typhoon") await act("brace", { i: d.index }, (j) => { R().lifeFx && R().lifeFx("brace", { i: d.index }); S.say(j.done ? `台风挡住啦！🌀 +${j.stars} ⭐` : "加固好一处 🔨"); if (j.done) S.burst(); });
    if (e.kind === "parrot") await act("shoo", {}, (j) => { R().lifeFx && R().lifeFx("shoo", { done: j.done }); S.say(j.done ? `鹦鹉吓跑了，丢下了${j.returned ? chip(j.returned) + "（还多给了一份）" : "什么也没有"} 🦜` : `嘎！（${j.hits}/${L.EVENTS.parrot.hits}）`); });
    if (e.kind === "meteor" || e.kind === "lowtide") await act("collect", { i: d.index }, (j) => { R().lifeFx && R().lifeFx("collect", { i: d.index }); S.say(`捡到 ${chip(j.item)}（${j.got}/${j.per}）`); });
    if (e.kind === "whale") await act("whale", {}, (j) => { R().lifeFx && R().lifeFx("whale"); card("🐋", "鲸鱼喷了你一身水", `<p>它送了你：${Object.entries(j.items).map(([k, n]) => chip(k, n)).join(" · ")}</p>${j.egg ? `<p class="first">还有一颗海浪花纹的蛋 🥚</p>` : ""}<p class="gain">+${j.stars} ⭐</p>`); });
    return;
  }
  if (d.what === "pool") S.say("🏞 瀑布下的水潭：点下面的「水潭钓鱼」在这里钓，有些鱼只在这里出没");
}
function scrollPanel() { const p = document.querySelector(".lpanel:not([hidden])") || $("#book"); if (p && innerWidth < 760) setTimeout(() => p.scrollIntoView({ behavior: "smooth", block: "nearest" }), 60); }

/* ------------------------------------------------------------ 小屋 */
async function enterHome() {
  if (S.panel() !== "home") S.openPanel("home");
  renderHome();
  if (R().enterHome) { await R().enterHome(); } else inside = true;
}
async function leaveHome() {
  if (S.panel() === "home") S.openPanel("home");
  if (R().exitHome) await R().exitHome();
  inside = false;
}
function renderAll() {
  if (!life) return;
  const p = S.panel();
  if (p === "home") renderHome();
  if (p === "bag") renderBag();
  if (p === "visit") renderVisit();
  if (p === "voyage") renderVoyage();
  if (p === "book") renderBook($("#book"), S.wallet());
  const vd = $("#l-vdot"), sd = $("#l-sdot");
  if (vd) vd.hidden = !life.visitors.some((v) => !v.done);
  if (sd) sd.hidden = !(life.voyage && Date.now() >= life.voyage.eta);
  tickBanner();
}
function renderHome() {
  const el = $("#l-home");
  if (!el || !life) return;
  const tabs = [["cook", "🍳 做饭"], ["eggs", "🥚 孵蛋"], ["pets", "🐾 宠物"], ["recipes", "📖 菜谱"], ["mail", `📮 信箱${life.mailReady ? " •" : ""}`], ["album", "📷 相册"]];
  let body = "";
  if (homeSub === "cook") body = cookView();
  if (homeSub === "eggs") body = eggsView();
  if (homeSub === "pets") body = petsView();
  if (homeSub === "recipes") body = recipesView();
  if (homeSub === "mail") body = mailView();
  if (homeSub === "album") body = albumView();
  if (homeSub === "bag") { homeSub = "cook"; body = cookView(); }
  el.innerHTML = `<div class="ltabs">${tabs.map(([k, n]) => `<button data-l="sub" data-v="${k}" class="${homeSub === k ? "on" : ""}">${n}</button>`).join("")}</div>${body}`;
  if (homeSub === "pets") fillPetNames();
  if (homeSub === "album") fillAlbum();
}
function cookView() {
  const items = Object.keys(life.bag).filter((k) => !k.startsWith("d:") && life.bag[k] > 0);
  const slots = [0, 1, 2].map((i) => pot[i] ? `<button class="slot full" data-l="unpot" data-i="${i}">${itemInfo(pot[i]).emoji}<small>${esc(itemInfo(pot[i]).name)}</small></button>` : `<span class="slot">＋</span>`).join("");
  const goods = items.filter((k) => !k.startsWith("f:")), fish = items.filter((k) => k.startsWith("f:"));
  const cell = (k) => `<button class="item ${countLeft(k) <= 0 ? "poor" : ""}" data-l="pot" data-v="${k}"><span class="emo">${itemInfo(k).emoji}</span><b>${esc(itemInfo(k).name)}</b><small>×${countLeft(k)}</small></button>`;
  return `<div class="potrow"><div class="pot">${slots}</div><button class="bigbtn" data-l="cook" ${pot.length < 2 ? "disabled" : ""}>🔥 开火</button></div>
    <p class="muted small">放 2–3 样东西进锅里试试。组合对了会解锁新菜（第一次 +2 ⭐），不对……就是一锅黑暗料理 🌑</p>
    ${goods.length ? `<h4>食材</h4><div class="shop">${goods.map(cell).join("")}</div>` : ""}
    ${fish.length ? `<h4>鱼</h4><div class="shop">${fish.map(cell).join("")}</div>` : `<p class="muted small">钓到的鱼也能下锅（码头 / 水潭钓鱼）</p>`}
    ${!items.length ? `<p class="muted">背包空空的：去菜地收菜、钓鱼、出海，都能带回食材</p>` : ""}`;
}
function eggsView() {
  const inc = life.eggs.filter((e) => e.inc), wait = life.eggs.filter((e) => !e.inc);
  const egg = (e) => {
    const readyAt = e.at + L.EGG_MIN_HOURS * 3600000, full = e.feeds.length >= L.EGG_FEEDS, ready = full && Date.now() >= readyAt;
    const feeds = e.feeds.map((f) => `<span title="${S.whoName(f.who)}喂的">${(L.RECIPES[f.dish] || L.DARK_DISH).emoji}</span>`).join("") + "<span class=\"muted\">○</span>".repeat(L.EGG_FEEDS - e.feeds.length);
    return `<div class="egg"><span class="emo">🥚</span><div><b>${eggName(e.pattern)}</b><div class="feeds">${feeds}</div>
      <small class="muted">${ready ? "可以孵化了！" : full ? `吃饱了，${hours(readyAt - Date.now())}后孵化` : `还要喂 ${L.EGG_FEEDS - e.feeds.length} 道菜${Date.now() < readyAt ? `，最早 ${hours(readyAt - Date.now())}后孵化` : ""}`}</small></div>
      ${ready ? `<button class="bigbtn" data-l="hatch" data-egg="${e.id}">🐣 孵化</button>` : full ? "" : `<button data-l="feed" data-egg="${e.id}">🍽 喂一道菜</button>`}</div>`;
  };
  return `<p class="muted small">孵蛋器里能放 ${L.INCUBATOR_SLOTS} 颗蛋。每颗喂 ${L.EGG_FEEDS} 道菜（放进去至少 ${L.EGG_MIN_HOURS} 小时）就能孵化；你们俩都喂过，出闪光宠物的机会翻倍 ✨</p>
    ${inc.length ? inc.map(egg).join("") : `<p class="muted">孵蛋器空着。蛋可以从岛民的回礼、出海、鲸鱼、图鉴奖励里得到</p>`}
    ${wait.length ? `<h4>排队中的蛋（${wait.length}）</h4><p>${wait.map((e) => eggName(e.pattern)).join("、")}</p>` : ""}`;
}
const eggName = (p) => ({ speckle: "斑点蛋", stripe: "条纹蛋", heart: "爱心蛋", star: "星星蛋", sea: "海浪蛋", flower: "花花蛋", snow: "雪花蛋", flame: "火焰蛋" }[p] || "神秘的蛋");
const names = new Map();
async function petName(p) {
  if (!p.name) return L.PETS[p.species].name;
  if (!names.has(p.id)) names.set(p.id, await S.open(p.name));
  return names.get(p.id);
}
function petsView() {
  if (!life.pets.length) return `<p class="muted">还没有宠物。去「孵蛋」喂蛋吧 🥚</p>`;
  return `<p class="muted small">最新的 ${L.PETS_ON_ISLAND} 只会在岛上溜达，其余的在小屋里睡觉。点 3D 里的它们会蹭你</p><div class="shop">${life.pets.slice().reverse().map((p) => `<div class="item"><span class="emo">${L.PETS[p.species].emoji}</span><b data-petname="${p.id}">${L.PETS[p.species].name}</b><small>${p.variant === 3 ? "✨闪光" : petLook(p)} · ${new Date(p.born).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })}</small><button class="mini" data-l="rename" data-pet="${p.id}">改名</button></div>`).join("")}</div>`;
}
async function fillPetNames() {
  for (const el of document.querySelectorAll("[data-petname]")) { const p = life.pets.find((x) => x.id === Number(el.dataset.petname)); if (p && p.name) el.textContent = await petName(p); }
}
function recipesView() {
  const all = Object.entries(L.RECIPES);
  const got = all.filter(([k]) => life.recipes[k]).length;
  return `<p class="small">菜谱 ${got} / ${all.length}</p><div class="shop">${all.map(([k, r]) => {
    const g = life.recipes[k];
    const ing = r.in.map((x) => x[0] === "#" ? (L.GOOD_TAGS[x.slice(1)] || "?") : (g ? itemInfo(x).name : "？")).join(" + ");
    return g ? `<div class="item"><span class="emo">${r.emoji}</span><b>${r.name}</b><small>${esc(ing)}</small><small>${tagName(r.tag)} · 做过 ${g.n} 次</small></div>`
      : `<div class="item none"><span class="emo">❔</span><b>？？？</b><small>${esc(ing)}</small></div>`;
  }).join("")}</div>`;
}
function mailView() {
  if (!life.residents.length) return `<p class="muted">还没有岛民住下来。满足同一位岛民 ${L.MOVE_IN} 次请求，它就会搬来岛上，之后每天往信箱里塞小礼物 📮</p>`;
  return `<p>住在岛上的：${life.residents.map((r) => L.VISITORS[r].name).join("、")}</p>${life.mailReady ? `<button class="bigbtn" data-l="mail">📮 收今天的信</button>` : `<p class="muted">今天的信收过了，明天再来</p>`}`;
}

/* ------------------------------------------------------------ 背包 */
function renderBag() {
  const el = $("#l-bag");
  if (!el || !life) return;
  const ks = Object.keys(life.bag).filter((k) => life.bag[k] > 0);
  const grp = { good: [], fish: [], dish: [] };
  for (const k of ks) grp[itemInfo(k).kind].push(k);
  const cell = (k) => `<div class="item"><span class="emo">${itemInfo(k).emoji}</span><b>${esc(itemInfo(k).name)}</b><small>×${life.bag[k]}${itemInfo(k).kind === "dish" ? " · " + tagName(itemInfo(k).tag) : ""}</small></div>`;
  el.innerHTML = `<p class="muted small">两个人共用一个背包。食材和鱼拿去小屋做饭，做好的菜可以喂蛋、送岛民、当出海补给</p>
    <h4>🍽 做好的菜</h4>${grp.dish.length ? `<div class="shop">${grp.dish.map(cell).join("")}</div>` : `<p class="muted small">还没有，去 🏡 小屋的灶台做一道</p>`}
    <h4>🥕 食材</h4>${grp.good.length ? `<div class="shop">${grp.good.map(cell).join("")}</div>` : `<p class="muted small">菜地收成、出海、岛民回礼都会带回食材</p>`}
    <h4>🐟 鱼</h4>${grp.fish.length ? `<div class="shop">${grp.fish.map(cell).join("")}</div>` : `<p class="muted small">钓到的能吃的鱼会放进来</p>`}
    <p><button data-lpanel="home" data-panel="home">🏡 去小屋做饭</button></p>`;
}

/* ------------------------------------------------------------ 岛民 */
function reqText(r) {
  if (r.type === "dish") { const x = L.RECIPES[r.recipe]; return `想吃一份${x.name} ${x.emoji}`; }
  if (r.type === "fish") { const f = FISH[r.fish]; return `想看看${f.name} ${f.emoji}`; }
  return `想要 ${r.n} 份${itemInfo(r.good).name} ${itemInfo(r.good).emoji}`;
}
function have(r) {
  if (r.type === "dish") return Object.keys(life.bag).some((x) => x.startsWith("d:" + r.recipe + ":") || x === "d:" + r.recipe);
  if (r.type === "fish") return (life.bag["f:" + r.fish] || 0) > 0;
  return (life.bag[r.good] || 0) >= r.n;
}
function where(r) {
  if (r.type === "dish") { const x = L.RECIPES[r.recipe]; return `做法：${x.in.map((s) => s[0] === "#" ? "任意" + L.GOOD_TAGS[s.slice(1)] : itemInfo(s).name).join(" + ")}，去小屋做一份`; }
  if (r.type === "fish") { const f = FISH[r.fish]; return `在${SPOT[f.spot] || "海边"}钓`; }
  return "去菜地种";
}
function renderVisit() {
  const el = $("#l-visit");
  if (!el || !life) return;
  const vs = life.visitors;
  el.innerHTML = (vs.length ? vs.map((v) => {
    const V = L.VISITORS[v.id], aff = life.affinity[v.id] || 0;
    const hi = V.hi[(new Date().getDate() + v.id.length) % V.hi.length];
    return `<div class="visitor ${visitFocus === v.id ? "focus" : ""}"><b>${V.name}</b> <span class="small">${"💗".repeat(Math.min(aff, L.MOVE_IN))}${"🤍".repeat(Math.max(0, L.MOVE_IN - aff))}</span>
      <p>「${esc(hi)}」${esc(reqText(v.req))}</p>
      ${v.done ? `<p class="muted small">✅ ${S.whoName(v.done.who)}已经帮过它了</p>` : have(v.req) ? `<button class="bigbtn" data-l="give" data-v="${v.id}">💝 给它</button>` : `<p class="muted small">背包里还没有 · ${esc(where(v.req))}</p>`}</div>`;
  }).join("") : `<p class="muted">今天还没有岛民来</p>`) +
    `<p class="muted small">每天（北京时间）会有 1–3 位岛民坐船来，请求今天之内有效。同一位帮够 ${L.MOVE_IN} 次，它就搬来岛上住${life.residents.length ? `（已经住下：${life.residents.map((r) => L.VISITORS[r].name).join("、")}）` : ""}</p>`;
}

/* ------------------------------------------------------------ 出海 */
function renderVoyage() {
  const el = $("#l-voyage");
  if (!el || !life) return;
  const v = life.voyage;
  if (v) {
    const D = L.VOYAGE[v.dest], left = v.eta - Date.now(), k = Math.min(1, 1 - left / (v.eta - v.at));
    el.innerHTML = left > 0 ? `<p>⛵ 小船正在去${D.name}的路上，${hours(left)}后回来</p><div class="meter"><i style="width:${(k * 100).toFixed(0)}%"></i></div>`
      : `<p>⛵ 小船从${D.name}回来啦！</p><button class="bigbtn" data-l="unload">📦 卸货</button>`;
    return;
  }
  const dishes = Object.keys(life.bag).filter((x) => x.startsWith("d:") && life.bag[x] > 0);
  const nextIsland = Object.entries(L.VOYAGE).find(([k, d]) => d.unlock && !life.islands.includes(k));
  el.innerHTML = `<p class="small">已航行 ${life.miles} 海里${nextIsland ? ` · 再走 ${nextIsland[1].unlock - life.miles} 海里会发现${nextIsland[1].name}` : ""}</p>
    <div class="dests">${Object.entries(L.VOYAGE).map(([k, d]) => life.islands.includes(k)
      ? `<button class="dest ${voyDest === k ? "on" : ""}" data-l="dest" data-v="${k}">${d.emoji} ${d.name}<small>${d.hours} 小时 · ${d.loot.slice(0, 3).map((g) => itemInfo(g).emoji).join("")}${d.fish ? " · 远洋鱼" : ""}</small></button>`
      : `<span class="dest locked">🔒 ？？？<small>航行 ${d.unlock} 海里后发现</small></span>`).join("")}</div>
    <h4>带上补给（1–3 道菜，越好吃带回来越多）</h4>
    ${dishes.length ? `<div class="shop">${dishes.map((x) => `<button class="item ${voyPick.includes(x) ? "on" : ""}" data-l="vdish" data-v="${x}"><span class="emo">${itemInfo(x).emoji}</span><b>${esc(itemInfo(x).name)}</b><small>×${countFree(x)}${voyPick.filter((y) => y === x).length ? ` · 带 ${voyPick.filter((y) => y === x).length}` : ""}</small></button>`).join("")}</div>` : `<p class="muted small">背包里没有菜，先去小屋做几道 🍳</p>`}
    <p><button class="bigbtn" data-l="sail" ${voyPick.length ? "" : "disabled"}>⛵ 出发去${L.VOYAGE[voyDest].name}</button></p>`;
}

/* ------------------------------------------------------------ 突发事件横幅 */
function tickBanner() {
  const el = $("#l-evt");
  if (!el) return;
  const e = life && life.event;
  if (!e || e.over || Date.now() >= e.end || Date.now() < e.start) { el.hidden = true; return; }
  let prog = "";
  if (e.kind === "typhoon") prog = `已加固 ${e.braced.filter(Boolean).length}/3`;
  if (e.kind === "parrot") prog = `${e.stolen ? `叼走了${chip(e.stolen)} · ` : ""}${e.hits}/${e.need}`;
  if (e.kind === "meteor" || e.kind === "lowtide") prog = `我捡了 ${e.got}/${e.per}`;
  if (e.kind === "whale") prog = e.pat ? "已经摸过啦" : "点它！";
  el.hidden = false;
  el.innerHTML = `<b>${e.emoji} ${esc(e.name)}</b> <span>${esc(prog)}</span><small>${esc(e.desc)} · 还剩 ${hours(e.end - Date.now())}</small>`;
}
function evtHint() {}

/* ------------------------------------------------------------ 图鉴 2.0 */
function renderBook(el, wallet) {
  if (!el) return;
  const book = (wallet && wallet.fishbook) || {}, rec = (wallet && wallet.fishrec) || {};
  const got = FISH_IDS.filter((k) => book[k]).length;
  const tabs = [["all", "全部"], ["sea", "码头"], ["pool", "水潭"], ["far", "远洋"], ["cond", "限定"]];
  const ids = FISH_IDS.filter((k) => bookTab === "all" || (bookTab === "far" ? FISH[k].spot.startsWith("far:") : bookTab === "cond" ? !!FISH[k].cond : FISH[k].spot === bookTab));
  const ms = L.BOOK_MILESTONES.map((m) => {
    const claimed = life && life.claims.includes(m.n), can = got >= m.n && !claimed;
    return `<span class="ms ${claimed ? "done" : can ? "can" : ""}">${can ? `<button data-l="claim" data-n="${m.n}">🎁 ${m.n} 种：${esc(m.text)}</button>` : `${claimed ? "✅" : "🔒"} ${m.n} 种：${esc(m.text)}`}</span>`;
  }).join("");
  el.innerHTML = `<p class="small">图鉴 <b>${got}</b> / ${FISH_IDS.length} · 两个人一起凑 · 点开看纪录和线索</p><div class="milestones">${ms}</div>
    <div class="ltabs">${tabs.map(([k, n]) => `<button data-l="btab" data-v="${k}" class="${bookTab === k ? "on" : ""}">${n}</button>`).join("")}</div>
    <div class="shop fishgrid">${ids.map((k) => {
      const F = FISH[k], c = book[k], r = RAR[F.rarity];
      return `<button class="item book ${c ? "r-" + F.rarity : "none"}" data-l="fish" data-v="${k}"><img class="fth" data-fth="${k}" alt=""><b>${c ? esc(F.name) : "？？？"}</b><small style="color:${r[1]}">${r[0]}${c ? ` · ×${c}${rec[k] && rec[k].cm ? ` · ${rec[k].cm}cm` : ""}` : ""}</small></button>`;
    }).join("")}</div>`;
  const caught = ids.filter((k) => book[k]), unc = ids.filter((k) => !book[k]);
  fishThumb(caught, false).then((m) => fillThumbs(el, m, caught));
  fishThumb(unc, true).then((m) => fillThumbs(el, m, unc));
}
function fillThumbs(el, m, ids) {
  for (const k of ids) { const img = el.querySelector(`img[data-fth="${k}"]`); if (img && m.get(k)) img.src = m.get(k); else if (img) img.replaceWith(Object.assign(document.createElement("span"), { className: "emo", textContent: S.wallet() && S.wallet().fishbook[k] ? FISH[k].emoji : "❔" })); }
}
async function fishDetail(k) {
  const F = FISH[k], w = S.wallet() || {}, c = (w.fishbook || {})[k], rec = (w.fishrec || {})[k] || {}, r = RAR[F.rarity];
  const cond = F.cond ? [F.cond.time && F.cond.time.map((x) => TIME[x]).join("/"), F.cond.season && F.cond.season.map((x) => SEASON[x]).join("/") + "天", F.cond.weather && F.cond.weather.map((x) => WEATHER[x]).join("/"), F.cond.moon && "满月夜"].filter(Boolean).join(" · ") : "随时";
  const m = await fishThumb([k], !c);
  modal(`<div class="fdetail"><img src="${m.get(k) || ""}" alt=""><h3>${c ? esc(F.name) : "？？？"} <small style="color:${r[1]}">${r[0]}</small></h3>
    ${c ? `<p>${esc(F.desc || "")}</p><p class="small">📍 ${SPOT[F.spot] || F.spot} · 🕒 ${cond}</p>
      <p class="small">钓到 ${c} 次${rec.cm ? ` · 最大的一条 <b>${rec.cm} cm</b>` : ""}${rec.by ? ` · 第一次是${S.whoName(rec.by)}钓到的（${new Date(rec.ts).toLocaleDateString("zh-CN")}）` : ""}${F.food ? " · 能做菜 🍳" : ""}</p>`
      : `<p class="muted">线索：${esc(F.hint || "还没人见过它")}</p><p class="small">📍 ${SPOT[F.spot] || F.spot}</p>`}
    <button data-l="close">好</button></div>`);
}

/* ------------------------------------------------------------ 弹窗 */
function card(emo, title, html) {
  const el = document.createElement("div");
  el.className = "catch-card";
  el.innerHTML = `<div class="cc-in"><div class="cc-emo">${emo}</div><b>${esc(title)}</b>${html}<button>好</button></div>`;
  document.body.appendChild(el);
  S.sfx("chime");
  el.addEventListener("click", (e) => { if ((e.target.tagName === "BUTTON" && !e.target.dataset.l) || e.target === el) el.remove(); });
}
function modal(html) { const m = $("#l-modal"); m.innerHTML = `<div class="lm-in">${html}</div>`; m.hidden = false; m.onclick = (e) => { if (e.target === m) closeModal(); }; }
function closeModal() { $("#l-modal").hidden = true; }

/* ------------------------------------------------------------ 相册 */
let album = [], albumMore = false, albumTotal = 0, albumDirty = true;
async function loadAlbum(before) {
  const r = await fetch(S.API + "/photos" + (before ? "?before=" + before : ""), { headers: { authorization: "Bearer " + (await token()) } });
  if (!r.ok) throw new Error("api " + r.status);
  const j = await r.json();
  const list = await Promise.all(j.photos.map(async (p) => ({ ...p, src: await S.open(p.thumb) })));
  album = before ? album.concat(list) : list;
  albumMore = j.more; albumTotal = j.total; albumDirty = false;
  if (R().setHomePhotos) R().setHomePhotos(album.slice(0, 6).map((p) => p.src));
}
function albumView() {
  return `<p><button class="bigbtn" data-l="cam">📷 去岛上拍一张</button> <button data-l="yearbook">📕 小岛年鉴</button></p><div class="album" id="l-album"><p class="muted">加载中…</p></div>`;
}
async function fillAlbum() {
  try { if (albumDirty || !album.length) await loadAlbum(); } catch { $("#l-album").innerHTML = `<p class="muted">相册暂时打不开</p>`; return; }
  const el = $("#l-album");
  if (!el) return;
  el.innerHTML = album.length ? album.map((p) => `<button class="ph" data-l="photo" data-id="${p.id}"><img src="${p.src}" alt=""><small>${new Date(p.ts).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })}</small></button>`).join("") : `<p class="muted">还没有照片。点 📷 在岛上摆好姿势拍一张，会挂到小屋的照片墙上</p>`;
}
function openAlbum() { if (S.panel() !== "home") S.openPanel("home"); homeSub = "album"; renderHome(); }
async function viewPhoto(id) {
  modal(`<p class="muted">打开中…</p>`);
  try {
    const r = await fetch(S.API + "/photos?id=" + id, { headers: { authorization: "Bearer " + (await token()) } });
    const j = await r.json();
    const src = await S.open(j.full);
    modal(`<img class="phbig" src="${src}" alt=""><p class="small muted">${S.whoName(j.who)}拍的 · ${new Date(j.ts).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</p>
      <p><a class="btnlike" download="小岛-${j.id}.jpg" href="${src}">⬇️ 存到手机</a> ${j.who === S.me() ? `<button data-l="delphoto" data-id="${j.id}">🗑 删除</button>` : ""} <button data-l="close">关闭</button></p>`);
  } catch { modal(`<p>打不开这张照片</p><button data-l="close">关闭</button>`); }
}
async function delPhoto(id) {
  const r = await fetch(S.API + "/photos", { method: "POST", headers: { authorization: "Bearer " + (await token()), "content-type": "application/json" }, body: JSON.stringify({ who: S.me(), op: "del", id }) });
  if (r.ok) { closeModal(); albumDirty = true; renderHome(); S.say("删掉了"); } else S.say("删不了（只能删自己拍的）");
}
async function yearbook() {
  try { while (albumMore) await loadAlbum(album[album.length - 1].id); } catch {}
  const w = S.wallet() || {}, book = w.fishbook || {};
  const y = new Date().getFullYear();
  const fishN = Object.values(book).reduce((a, b) => a + b, 0), kinds = Object.keys(book).length;
  const dishes = Object.values(life.recipes).reduce((a, r) => a + r.n, 0);
  const helped = Object.values(life.affinity).reduce((a, b) => a + b, 0);
  const months = {};
  for (const p of album) { const d = new Date(p.ts); if (d.getFullYear() !== y) continue; (months[d.getMonth() + 1] ||= []).push(p); }
  const stat = (n, t) => `<div><b>${n}</b><small>${t}</small></div>`;
  modal(`<div class="yb"><h2>我们的小岛 · ${y}</h2>
    <div class="ybstats">${stat(fishN, "条鱼")}${stat(kinds + " / " + FISH_IDS.length, "种图鉴")}${stat(dishes, "道菜")}${stat(Object.keys(life.recipes).length, "个菜谱")}${stat(life.pets.length, "只宠物")}${stat(helped, "次帮岛民")}${stat(life.miles, "海里航程")}${stat(albumTotal, "张照片")}</div>
    ${Object.keys(months).sort((a, b) => b - a).map((m) => `<h3>${m} 月</h3><div class="album">${months[m].map((p) => `<img src="${p.src}" alt="">`).join("")}</div>`).join("") || `<p class="muted">今年还没有照片</p>`}
    <p class="noprint"><button onclick="window.print()">🖨 打印 / 存成 PDF</button> <button data-l="close">关闭</button></p></div>`);
}

/* ------------------------------------------------------------ 拍照 */
let photoFrame = "polaroid", shot = null;
const FRAMES = { none: "无边框", polaroid: "拍立得", hearts: "爱心", film: "胶片", stamp: "邮票" };
function startPhoto() {
  if (!R().snapshot) { S.say("3D 还没加载好"); return; }
  R().setPhotoMode && R().setPhotoMode(true);
  document.body.classList.add("photo-on");
  $("#l-photo").hidden = false;
  renderPhotoBar();
  $("#scene").scrollIntoView({ behavior: "smooth", block: "start" });
}
function stopPhoto() { R().setPhotoMode && R().setPhotoMode(false); document.body.classList.remove("photo-on"); $("#l-photo").hidden = true; }
function renderPhotoBar() {
  const poses = [["hug", "🤗"], ["kiss", "😘"], ["highfive", "🙌"], ["pat", "🫳"], ["ride", "🐴"]];
  $("#l-photo").innerHTML = `<div class="pbar"><div class="prow">${Object.entries(FRAMES).map(([k, n]) => `<button data-l="frame" data-v="${k}" class="${photoFrame === k ? "on" : ""}">${n}</button>`).join("")}</div>
    <div class="prow">${poses.map(([k, e]) => `<button data-l="pose" data-v="${k}">${e}</button>`).join("")}<span class="muted small">摆个姿势，拖动转镜头</span></div>
    <div class="prow"><button data-l="pclose">✕</button><button class="shutter" data-l="shoot">📸 咔嚓</button></div></div>`;
}
async function shoot() {
  const src = R().snapshot();
  if (!src) return;
  S.sfx("pop");
  const flash = document.createElement("div"); flash.className = "flash"; document.body.appendChild(flash); setTimeout(() => flash.remove(), 400);
  shot = compose(src, photoFrame);
  modal(`<img class="phbig" src="${shot.toDataURL("image/jpeg", 0.85)}" alt=""><p><button class="bigbtn" data-l="psave">💾 存进相册</button> <button data-l="pdown">⬇️ 存到手机</button> <button data-l="pretake">重拍</button></p>`);
}
function compose(src, frame) {
  const maxW = 1080, k = Math.min(1, maxW / src.width);
  const w = Math.round(src.width * k), h = Math.round(src.height * k);
  const pad = frame === "none" ? 0 : Math.round(w * 0.05), bottom = frame === "polaroid" ? Math.round(w * 0.16) : pad;
  const c = document.createElement("canvas");
  c.width = w + pad * 2; c.height = h + pad + bottom;
  const g = c.getContext("2d");
  const bg = { polaroid: "#fffdf7", hearts: "#ffd6e3", film: "#2b2522", stamp: "#fff8ec", none: "#fff" }[frame];
  g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(src, 0, 0, src.width, src.height, pad, pad, w, h);
  const date = new Date().toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" });
  g.textAlign = "center";
  if (frame === "polaroid") { g.fillStyle = "#6b5448"; g.font = `${Math.round(w * 0.045)}px "ZCOOL KuaiLe", "PingFang SC", sans-serif`; g.fillText(`我们的小岛 · ${date}`, c.width / 2, h + pad + bottom * 0.6); }
  if (frame === "hearts") { g.font = `${Math.round(pad * 0.8)}px sans-serif`; for (let i = 0; i < 14; i++) { const t = i / 14; g.fillText("💗", pad / 2 + t * (c.width - pad), pad * 0.8); g.fillText("💗", pad / 2 + t * (c.width - pad), c.height - pad * 0.2); } }
  if (frame === "film") { g.fillStyle = "#f2e8dc"; for (let x = pad; x < c.width - pad; x += pad * 0.9) { g.fillRect(x, pad * 0.25, pad * 0.45, pad * 0.5); g.fillRect(x, c.height - pad * 0.75, pad * 0.45, pad * 0.5); } }
  if (frame === "stamp") { g.fillStyle = bg; const r = pad * 0.28; for (let x = 0; x <= c.width; x += r * 3) { g.beginPath(); g.arc(x, 0, r, 0, 7); g.arc(x, c.height, r, 0, 7); g.fill(); } for (let y = 0; y <= c.height; y += r * 3) { g.beginPath(); g.arc(0, y, r, 0, 7); g.arc(c.width, y, r, 0, 7); g.fill(); } g.fillStyle = "#c9573a"; g.font = `bold ${Math.round(w * 0.035)}px sans-serif`; g.textAlign = "right"; g.fillText(date, c.width - pad * 1.5, c.height - pad * 1.4); }
  if (frame === "none") { g.fillStyle = "rgba(255,255,255,.85)"; g.font = `bold ${Math.round(w * 0.03)}px sans-serif`; g.textAlign = "right"; g.fillText(date, w - w * 0.03, h - w * 0.03); }
  return c;
}
function jpeg(c, maxW, maxLen) {
  let cv = c;
  if (c.width > maxW) { cv = document.createElement("canvas"); cv.width = maxW; cv.height = Math.round(c.height * maxW / c.width); cv.getContext("2d").drawImage(c, 0, 0, cv.width, cv.height); }
  for (let q = 0.85; q > 0.3; q -= 0.1) { const u = cv.toDataURL("image/jpeg", q); if (u.length <= maxLen) return u; }
  return cv.toDataURL("image/jpeg", 0.3);
}
async function savePhoto() {
  if (!shot || busy) return;
  busy = true;
  try {
    const full = await S.seal(jpeg(shot, 1080, Math.floor(L.PHOTO_LIMITS.full * 0.72)));
    const thumb = await S.seal(jpeg(shot, 360, Math.floor(L.PHOTO_LIMITS.thumb * 0.72)));
    const r = await fetch(S.API + "/photos", { method: "POST", headers: { authorization: "Bearer " + (await token()), "content-type": "application/json" }, body: JSON.stringify({ who: S.me(), full, thumb }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "api " + r.status);
    closeModal(); stopPhoto(); albumDirty = true;
    S.say("存进相册了 📷 会挂在小屋的照片墙上"); S.loadWallet(); S.poll();
    loadAlbum().catch(() => {});
  } catch (e) { S.say("没存上：" + (e.message === "too many photos today" ? "今天拍太多啦" : e.message)); }
  finally { busy = false; }
}
function downloadPhoto() {
  if (!shot) return;
  const a = document.createElement("a");
  a.href = shot.toDataURL("image/jpeg", 0.9); a.download = `小岛-${new Date().toISOString().slice(0, 10)}.jpg`;
  document.body.appendChild(a); a.click(); a.remove();
}

if (S) boot(); // 放在最后：上面的 let 都初始化完了再启动
