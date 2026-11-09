"use strict";
/* 小窝：读加密的 data.enc.json，在浏览器里用密码解密后渲染。?demo / ?demo=green|yellow|red|sleep 用假数据预览。 */

const $ = (s) => document.querySelector(s);
const KEY_PREFIX = "nest.key.";
const POKE_KEY = "nest.pokes";
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

/* ---------------------------------------------------------------- crypto */
const b64d = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64e = (u8) => btoa(String.fromCharCode(...new Uint8Array(u8)));

async function deriveKey(pw, blob) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: b64d(blob.salt), iterations: blob.iter, hash: "SHA-256" },
    base, { name: "AES-GCM", length: 256 }, true, ["decrypt"]);
}
async function decrypt(key, blob) {
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64d(blob.iv) }, key, b64d(blob.ct));
  return JSON.parse(new TextDecoder().decode(pt));
}
async function cachedKey(blob) {
  const raw = store.get(KEY_PREFIX + blob.salt);
  if (!raw) return null;
  try { return await crypto.subtle.importKey("raw", b64d(raw), "AES-GCM", true, ["decrypt"]); } catch { return null; }
}
const BLOB_KEY = "nest.blob"; // 上一次成功解密的密文（只存密文），网络抖动 / 正在部署时拿它顶上
async function fetchOnce() {
  const r = await fetch("data.enc.json?t=" + Date.now(), { cache: "no-store" });
  if (!r.ok) throw new Error("没拿到数据（" + r.status + "）");
  const b = await r.json();
  if (!b || !b.ct || !b.salt) throw new Error("数据不完整");
  return b;
}
async function fetchBlob() {
  let err;
  for (const wait of [0, 1500, 4000]) {
    if (wait) await new Promise((r) => setTimeout(r, wait));
    try { return await fetchOnce(); } catch (e) { err = e; }
  }
  const cached = store.get(BLOB_KEY);
  if (cached) { try { return JSON.parse(cached); } catch {} }
  throw err;
}

/* ---------------------------------------------------------------- boot */
let DATA = null;
let BLOB = null;
let KEY = null;

async function boot() {
  const demo = new URLSearchParams(location.search).get("demo");
  if (demo !== null) { show(demoData(demo || "yellow")); return; }
  try { BLOB = await fetchBlob(); } catch (e) { lockScreen(String(e.message || e)); return; }
  KEY = await cachedKey(BLOB);
  if (KEY) {
    try { show(await decrypt(KEY, BLOB)); return; } catch {}
    // 记住的密钥对不上这份数据：先用上次缓存的密文试试（可能刚好在部署中途），还不行才是真的换了密码
    try { const old = JSON.parse(store.get(BLOB_KEY) || "null"); if (old) { const d = await decrypt(KEY, old); BLOB = old; show(d); return; } } catch {}
    KEY = null;
  }
  lockScreen();
}

function lockScreen(msg) {
  $("#app").hidden = true;
  $("#lock").hidden = false;
  if (msg) $("#lock-msg").textContent = msg;
  setTimeout(() => $("#pw").focus(), 50);
}

$("#lock-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const btn = $("#unlock-btn");
  btn.disabled = true; btn.textContent = "开门中…";
  $("#lock-msg").textContent = "";
  try {
    if (!BLOB) BLOB = await fetchBlob();
    const key = await deriveKey($("#pw").value, BLOB);
    const data = await decrypt(key, BLOB);
    KEY = key;
    if ($("#remember").checked) store.set(KEY_PREFIX + BLOB.salt, b64e(await crypto.subtle.exportKey("raw", key)));
    $("#pw").value = "";
    hearts(innerWidth / 2, innerHeight / 2, 40);
    show(data);
  } catch (e) {
    $("#lock-msg").textContent = e && e.name === "OperationError" ? "暗号不对哦" : String(e.message || e);
    const card = $(".lock-card"); card.classList.remove("shake"); void card.offsetWidth; card.classList.add("shake");
  } finally {
    btn.disabled = false; btn.textContent = "进门";
  }
});

$("#logout").addEventListener("click", (ev) => {
  ev.preventDefault();
  Object.keys(localStorage).filter((k) => k.startsWith(KEY_PREFIX)).forEach((k) => store.del(k));
  store.del(BLOB_KEY);
  location.reload();
});

// 每 10 分钟悄悄刷新一次（页面在前台时）
setInterval(async () => {
  if (document.hidden || !KEY || !DATA) return;
  try { BLOB = await fetchBlob(); show(await decrypt(KEY, BLOB), true); } catch {}
}, 10 * 60 * 1000);
setInterval(() => DATA && renderClocks(DATA), 30 * 1000);

/* ---------------------------------------------------------------- time helpers */
// 他那边的"墙上时间"：用数据里的 UTC 偏移换算（不依赖看的人在哪个时区）
function offsetMin(tz) { const m = /^([+-])(\d\d):(\d\d)$/.exec(tz || "+00:00"); return m ? (m[1] === "-" ? -1 : 1) * (+m[2] * 60 + +m[3]) : 0; }
function hisNow(d) { return new Date(Date.now() + offsetMin(d.tz) * 60000); } // 用 getUTC* 读
const pad = (n) => String(n).padStart(2, "0");
const hm = (date) => pad(date.getUTCHours()) + ":" + pad(date.getUTCMinutes());
const clockOf = (iso) => iso ? iso.slice(11, 16) : "—";
const toMin = (s) => { const [h, m] = s.split(":").map(Number); return h * 60 + m; };
function ago(iso) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 2) return "刚刚";
  if (mins < 60) return mins + " 分钟前";
  if (mins < 60 * 24) return Math.round(mins / 60) + " 小时前";
  return Math.round(mins / 1440) + " 天前";
}
function inWindow(nowMin, a, b) { return a <= b ? nowMin >= a && nowMin < b : nowMin >= a || nowMin < b; }

function probablyAsleep(d) {
  const w = d.week || {};
  if (!w.usual_bed || !w.usual_wake) return false;
  const now = hisNow(d);
  const nowMin = now.getUTCHours() * 60 + now.getUTCMinutes();
  // 用平时作息窗口（前后各放宽 30 分钟），并且最近一次睡眠已经是 10 小时以前结束的（说明这一觉还没记录下来）
  const bed = (toMin(w.usual_bed) - 30 + 1440) % 1440, wake = (toMin(w.usual_wake) + 30) % 1440;
  const lastEnd = d.last_sleep && d.last_sleep.end ? new Date(d.last_sleep.end).getTime() : 0;
  return inWindow(nowMin, bed, wake) && Date.now() - lastEnd > 10 * 3600 * 1000;
}

/* ---------------------------------------------------------------- render */
const BAND = { green: ["var(--green)", "满电"], yellow: ["var(--yellow)", "还行"], red: ["var(--red)", "需要充电"] };
const STRAIN = { light: "轻松的一天", moderate: "适度活动", high: "运动量挺大", all_out: "拼尽全力" };
const SPORT = { badminton: "🏸", "tai-chi": "🥋", running: "🏃", walking: "🚶", cycling: "🚴", swimming: "🏊", basketball: "🏀",
  tennis: "🎾", yoga: "🧘", weightlifting: "🏋️", "functional-fitness": "💪", hiking: "🥾", activity: "✨" };
const SPORT_ZH = { badminton: "羽毛球", "tai-chi": "太极", running: "跑步", walking: "散步", cycling: "骑车", swimming: "游泳",
  basketball: "篮球", tennis: "网球", yoga: "瑜伽", weightlifting: "力量训练", "functional-fitness": "体能训练", hiking: "徒步", activity: "活动" };
const WD = ["日", "一", "二", "三", "四", "五", "六"];

function show(d, quiet) {
  DATA = d;
  if (BLOB) store.set(BLOB_KEY, JSON.stringify(BLOB));
  $("#lock").hidden = true;
  $("#app").hidden = false;
  renderClocks(d);
  renderScene(d, quiet);
  renderTiles(d);
  renderWeek(d);
  if (!quiet) renderHeat(d);
  window.NEST = { data: d, mood: moodOf(d) };
  dispatchEvent(new Event("nest:update"));
}

function renderClocks(d) {
  const his = hisNow(d);
  const you = new Date();
  const sameTz = -you.getTimezoneOffset() === offsetMin(d.tz);
  $("#clock-his").innerHTML = `他那边 <b>${hm(his)}</b>`;
  $("#clock-you").innerHTML = sameTz ? "" : `你那边 <b>${pad(you.getHours())}:${pad(you.getMinutes())}</b>`;
  $("#synced").textContent = "数据更新于 " + ago(d.updated_at);
  paintSky(you.getHours() + you.getMinutes() / 60); // 天色跟着"正在看的人"自己的时间走（对方那边看对面的小岛）
}

function paintSky(h) {
  const scene = $("#scene");
  let sky, hill, night = false;
  if (h >= 5 && h < 7.5) { sky = "linear-gradient(#ffb199, #ffe3c2 70%)"; hill = "#a7d98b"; }
  else if (h >= 7.5 && h < 17) { sky = "linear-gradient(#7cc8ff, #d7f0ff 75%)"; hill = "#9be38a"; }
  else if (h >= 17 && h < 19.5) { sky = "linear-gradient(#7b6cd9, #ff9a8b 60%, #ffd29d)"; hill = "#8ccf7e"; }
  else { sky = "linear-gradient(#1d2357, #3b3f8f 70%, #6a5fa8)"; hill = "#4f7a5a"; night = true; }
  scene.style.setProperty("--sky", sky);
  scene.style.setProperty("--hill", hill);
  scene.classList.toggle("night", night);
  const orb = scene.querySelector(".orb");
  // 太阳/月亮沿弧线走
  const t = night ? ((h + 24 - 19.5) % 24) / 9.5 : (h - 5) / 14.5;
  orb.style.left = `calc(${8 + t * 76}% - 28px)`; orb.style.right = "auto";
  orb.style.top = `${70 - Math.sin(Math.PI * Math.min(Math.max(t, 0), 1)) * 46}px`;
}

function moodOf(d) {
  if (probablyAsleep(d)) return "sleep";
  const b = d.today && d.today.band;
  return b === "green" ? "happy" : b === "red" ? "tired" : "chill";
}

function lines(d) {
  const t = d.today || {}, s = d.last_sleep || {}, w = d.week || {}, st = d.streaks || {};
  const out = [];
  const mood = moodOf(d);
  if (mood === "sleep") out.push("呼…呼…（按平时的作息，他这会儿大概在睡觉）", "嘘——小声点，他在充电中 🌙");
  if (t.band === "green") out.push(`今天恢复 ${t.recovery}%，满电出发！✨`, "精神很好，适合约会 😎");
  if (t.band === "yellow") out.push(`今天恢复 ${t.recovery}%，状态还行，慢慢来～`, "电量一半，可以再来点鼓励 💪");
  if (t.band === "red") out.push(`今天电量只有 ${t.recovery}%…需要你的抱抱充电 🥺`, "今天有点累，提醒他早点休息吧");
  if (s.hours != null && s.hours >= 8) out.push(`昨晚睡了 ${s.hours} 小时，美滋滋 😴`);
  if (s.hours != null && s.hours < 6) out.push(`昨晚只睡了 ${s.hours} 小时…快催他早点睡！`);
  const recent = null; // 运动记录不导出、不显示
  if (recent) out.push(`最近一次运动：${SPORT_ZH[recent.sport] || recent.sport} ${SPORT[recent.sport] || "✨"}${recent.minutes ? "，" + fmtDur(recent.minutes) : ""}`);
  if (t.steps) out.push(`今天走了 ${t.steps.toLocaleString()} 步 👣`);
  if (st.regular_sleep >= 2) out.push(`已经连续 ${st.regular_sleep} 天作息规律，夸夸他！`);
  if (w.sleep_regularity != null && w.sleep_regularity < 70) out.push("这周作息有点乱，监督他按时睡觉 ⏰");
  out.push("戳我一下试试 👉", "按住我可以摸头哦", "点草地我会跑过去～", "今天也想你了 💌");
  return out;
}
const fmtDur = (m) => m >= 60 ? `${Math.floor(m / 60)} 小时${m % 60 ? " " + (m % 60) + " 分" : ""}` : `${m} 分钟`;

let lineIdx = 0;
function say(text) {
  const b = $("#bubble");
  b.textContent = text;
  b.style.animation = "none"; void b.offsetWidth; b.style.animation = "";
}

function renderScene(d, quiet) {
  const wrap = $("#pet-wrap");
  const mood = moodOf(d);
  wrap.className = "pet-wrap mood-" + (mood === "sleep" ? "tired" : mood);
  if (!quiet) { lineIdx = 0; say(lines(d)[0]); }
  renderPokes();
}

function renderPokes() {
  const p = JSON.parse(store.get(POKE_KEY) || "{}");
  const today = new Date().toDateString();
  const n = p.day === today ? p.n : 0;
  $("#poke-count").textContent = n ? `今天戳了它 ${n} 次` : "";
}

function poked(x, y) {
  hearts(x, y, 14);
  if (DATA) { const ls = lines(DATA); lineIdx = (lineIdx + 1) % ls.length; say(ls[lineIdx]); }
  const p = JSON.parse(store.get(POKE_KEY) || "{}");
  const today = new Date().toDateString();
  store.set(POKE_KEY, JSON.stringify({ day: today, n: (p.day === today ? p.n : 0) + 1 }));
  renderPokes();
}
$("#pet").addEventListener("click", () => {
  if (window.NEST_MODE === "angry") return; // 生气模式下点它是揍（social.js 处理）
  const pet = $("#pet");
  pet.classList.remove("boing"); void pet.offsetWidth; pet.classList.add("boing");
  const r = pet.getBoundingClientRect();
  poked(r.left + r.width / 2, r.top + r.height * 0.35);
});

// 换小伙伴时，2D 备用版和锁屏也跟着换
const PET_EMOJI = { dino: "🦖", cat: "🐱", penguin: "🐧", chick: "🐥" };
function syncPetEmoji(kind) { document.querySelectorAll("[data-pet-emoji]").forEach((e) => { e.textContent = PET_EMOJI[kind] || "🦖"; }); }
syncPetEmoji(store.get("nest.species"));
addEventListener("nest:species", (ev) => syncPetEmoji(ev.detail.kind));

// 3D 小岛上点到的东西（scene3d.js 派发）
addEventListener("nest:tap", (ev) => {
  const { what, x, y } = ev.detail;
  if (!DATA) return;
  if (what === "pet") {
    if (window.NEST_MODE === "angry") return;
    poked(x, y);
    if (ev.detail.react === "wave") say("嗨～ 👋 今天也想你了");
    if (ev.detail.react === "blush") say("被你戳得脸红了 ☺️");
    if (ev.detail.react === "stir") say("唔…再睡五分钟…（他大概真的在睡觉）");
    return;
  }
  if (what === "gift") { say("他送的花 🌹（会在花瓶里放两天）"); hearts(x, y, 8); return; }
  if (what === "pet-hold") { hearts(x, y, 10); say("被摸头了，好舒服～ 💕"); return; }
  if (what === "ground-sleep") { say("嘘——小声点，它在充电中 🌙"); return; }
  const t = DATA.today || {}, s = DATA.last_sleep || {}, w = DATA.week || {}, b = DATA.bio || {}, st = DATA.streaks || {};
  let text = "";
  if (what === "crystal") {
    text = `电量水晶：今天恢复 ${t.recovery ?? "—"}%（${(BAND[t.band] || [, "等待数据"])[1]}）`;
    if (b.hrv != null) text += `\nHRV ${b.hrv}${b.hrv_avg7 ? `（前 7 天平均 ${b.hrv_avg7}）` : ""} · 静息心率 ${b.rhr ?? "—"}${b.rhr_avg7 ? `（平均 ${b.rhr_avg7}）` : ""}`;
  } else if (what === "flowers") {
    if (t.strain == null) text = "小花们在晒太阳 🌼";
    else {
      const n = Math.max(0, Math.min(21, Math.round(t.strain || 0)));
      text = `今天的活动开了 ${n} 朵花 🌸（负荷 ${t.strain ?? "—"}/21${t.steps ? `，${t.steps.toLocaleString()} 步` : ""}）`;
    }
  } else if (what === "bed") {
    text = s.hours != null ? `小床：昨晚 ${clockOf(s.start)} 睡、${clockOf(s.end)} 醒，睡了 ${s.hours} 小时，睡眠表现 ${s.performance ?? "—"}%` : "小床：还没有睡眠记录";
  } else if (what === "house") {
    text = "我们的小木屋 🏡 晚上窗户会亮灯，烟囱一直冒着烟～";
  } else if (what === "tree") {
    text = `规律树：这周作息规律度 ${w.sleep_regularity ?? "—"}/100${st.regular_sleep ? `，已经连续规律 ${st.regular_sleep} 天` : "，树会越长越好的"} 🌳`;
  }
  if (text) { say(text); hearts(x, y, 6); }
});

function setRing(tile, frac, color) {
  const bar = tile.querySelector(".bar");
  tile.style.setProperty("--c", color);
  requestAnimationFrame(() => requestAnimationFrame(() => { bar.style.strokeDashoffset = String(314.16 * (1 - Math.max(0, Math.min(1, frac)))); }));
}
function countUp(el, to, digits = 0) {
  if (to == null) { el.textContent = "—"; return; }
  const t0 = performance.now(), dur = 1100;
  const step = (t) => {
    const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
    el.textContent = (to * e).toFixed(digits);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function renderTiles(d) {
  const t = d.today || {}, s = d.last_sleep || {}, w = d.week || {}, st = d.streaks || {};
  const [rc, rl] = BAND[t.band] || ["var(--muted)", "等待数据"];
  setRing($("#t-recovery"), (t.recovery || 0) / 100, rc);
  countUp($('[data-k="recovery"]'), t.recovery);
  $("#recovery-tag").textContent = rl + (t.calibrating ? "（还在校准）" : "");
  const b = d.bio || {};
  $("#bio").textContent = b.hrv != null ? `HRV ${b.hrv} · 静息心率 ${b.rhr ?? "—"}` : "";
  $("#t-recovery").style.setProperty("--c", rc);
  emo($("#e-recovery"), t.band === "red" ? "1faab" : "1f50b", t.band === "red" ? "🪫" : "🔋");
  emo($("#e-sleep"), "1f634", "😴");
  emo($("#e-strain"), "1f4aa", "💪");
  emo($("#e-regular"), "1f31d", "🌝");

  countUp($('[data-k="sleep"]'), s.hours, 1);
  $("#sleep-times").textContent = s.start ? `${clockOf(s.start)} 睡 → ${clockOf(s.end)} 醒（他那边）` : "";
  const sh = s.stages_h || {};
  const total = ["sws", "rem", "light", "awake"].reduce((a, k) => a + (sh[k] || 0), 0) || 1;
  $("#stages").innerHTML = ["sws", "rem", "light", "awake"].map((k) => `<i class="${k}" data-w="${(sh[k] || 0) / total * 100}"></i>`).join("");
  requestAnimationFrame(() => requestAnimationFrame(() => $("#stages").querySelectorAll("i").forEach((i) => { i.style.width = i.dataset.w + "%"; })));

  // 活动数据可能被导出端藏起来（export_status.py 的 HIDE），没有就整张卡片不显示
  const act = t.strain != null;
  $("#t-strain").hidden = !act;
  $(".tiles").classList.toggle("three", !act);
  const sc = { light: "#5bb8f5", moderate: "var(--green)", high: "var(--yellow)", all_out: "var(--red)" }[t.strain_band] || "var(--muted)";
  setRing($("#t-strain"), (t.strain || 0) / 21, sc);
  countUp($('[data-k="strain"]'), t.strain, 1);
  $("#strain-tag").textContent = STRAIN[t.strain_band] || "—";
  $("#t-strain").style.setProperty("--c", sc);
  $("#steps").textContent = t.steps ? `👣 ${t.steps.toLocaleString()} 步` : "";

  countUp($('[data-k="sri"]'), w.sleep_regularity);
  const n = st.regular_sleep || 0;
  $("#streak").innerHTML = n > 0 ? `<span class="emo flame" id="e-flame">🔥</span>连续规律 ${n} 天` : (st.wear ? `⌚ 连续佩戴 ${st.wear} 天` : "");
  if (n > 0) emo($("#e-flame"), "1f525", "🔥");
}

function renderWeek(d) {
  const days = (d.days || []).slice(-7);
  const max = Math.max(9, ...days.map((x) => (x.sleep_h || 0) + (x.nap_h || 0)));
  const todayIso = d.today && d.today.date;
  $("#week").innerHTML = days.map((x) => {
    const h = (x.sleep_h || 0) + (x.nap_h || 0);
    const c = x.band ? `var(--${x.band})` : "var(--heat0)";
    const wd = WD[new Date(x.d + "T12:00:00Z").getUTCDay()];
    return `<div class="day${x.d === todayIso ? " today" : ""}"><span class="h">${h ? h.toFixed(1) : "—"}</span><div class="bar" style="--c:${c}" data-h="${h / max * 100}"></div><span class="lbl">${x.d === todayIso ? "今天" : "周" + wd}</span></div>`;
  }).join("");
  requestAnimationFrame(() => requestAnimationFrame(() => $("#week").querySelectorAll(".bar").forEach((b) => { b.style.height = `calc(${b.dataset.h}% - 40px)`; })));
  const w = d.week || {}, mix = w.recovery_mix || {};
  $("#week-note").textContent = `柱子高度是每天睡了几小时（含午睡），颜色是睡醒后的恢复：绿 ${mix.green || 0} 天 · 黄 ${mix.yellow || 0} 天 · 红 ${mix.red || 0} 天。平均每晚 ${w.avg_sleep_h ?? "—"} 小时。`;
}

function renderHeat(d) {
  const byDay = Object.fromEntries((d.days || []).map((x) => [x.d, x]));
  const end = new Date((d.today && d.today.date || new Date().toISOString().slice(0, 10)) + "T12:00:00Z");
  const start = new Date(end); start.setUTCDate(start.getUTCDate() - 83 - end.getUTCDay()); // 对齐到周日开头
  const cells = [];
  for (let t = new Date(start), i = 0; t <= end; t.setUTCDate(t.getUTCDate() + 1), i++) {
    const iso = t.toISOString().slice(0, 10), x = byDay[iso];
    cells.push(`<i class="l${x ? x.lv : 0}" data-d="${iso}" style="animation-delay:${i * 8}ms"></i>`);
  }
  $("#heat").innerHTML = cells.join("");
}
$("#heat").addEventListener("click", (ev) => {
  const c = ev.target.closest("i[data-d]");
  if (!c || !DATA) return;
  $("#heat").querySelectorAll(".sel").forEach((x) => x.classList.remove("sel"));
  c.classList.add("sel");
  const x = (DATA.days || []).find((y) => y.d === c.dataset.d);
  const date = c.dataset.d.slice(5).replace("-", "/");
  if (!x) { $("#heat-tip").textContent = `${date}：没有数据`; return; }
  const bits = [];
  if (x.sri != null) bits.push(`规律度 ${Math.round(x.sri)}`);
  if (x.sleep_h != null) bits.push(`睡了 ${x.sleep_h} 小时${x.nap_h ? "（+午睡 " + x.nap_h + "）" : ""}`);
  if (x.rec != null) bits.push(`恢复 ${x.rec}%`);
  if (x.steps) bits.push(`${x.steps.toLocaleString()} 步`);
  $("#heat-tip").textContent = `${date}：${bits.join(" · ") || "数据不全"}`;
});


/* ---------------------------------------------------------------- Noto 动态 emoji（Lottie，CC BY 4.0） */
const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
const anims = new Map();
function emo(el, cp, fallback) {
  if (!el || el.dataset.cp === cp) return;
  for (const [k, a] of anims) if (!k.isConnected) { a.destroy(); anims.delete(k); }  // 重绘后被替换掉的节点
  el.dataset.cp = cp;
  if (anims.has(el)) { anims.get(el).destroy(); anims.delete(el); }
  el.textContent = "";
  if (!window.lottie) { el.textContent = fallback; return; }
  const a = lottie.loadAnimation({ container: el, renderer: "svg", loop: true, autoplay: !REDUCED,
    path: `vendor/noto/${cp}.json` }); // Noto Animated Emoji（CC BY 4.0），本地副本
  a.addEventListener("data_failed", () => { a.destroy(); anims.delete(el); el.textContent = fallback; });
  if (REDUCED) a.addEventListener("DOMLoaded", () => a.goToAndStop(0, true));
  anims.set(el, a);
}

/* ---------------------------------------------------------------- hearts fx */
const fx = $("#fx"), ctx = fx.getContext("2d");
let parts = [], running = false;
function resize() { const r = devicePixelRatio || 1; fx.width = innerWidth * r; fx.height = innerHeight * r; ctx.setTransform(r, 0, 0, r, 0, 0); }
addEventListener("resize", resize); resize();
function hearts(x, y, n) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const colors = ["#ff6b8b", "#ff8fab", "#ffb3c6", "#ff7a50", "#ffd166"];
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2, v = 3 + Math.random() * 5;
    parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, s: 7 + Math.random() * 9, c: colors[i % colors.length], life: 1, rot: (Math.random() - 0.5) * 0.6 });
  }
  if (!running) { running = true; requestAnimationFrame(tick); }
}
function heart(x, y, s, rot, c) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(s / 16, s / 16); ctx.fillStyle = c;
  ctx.beginPath(); ctx.moveTo(0, 5); ctx.bezierCurveTo(-14, -4, -6, -14, 0, -7); ctx.bezierCurveTo(6, -14, 14, -4, 0, 5); ctx.fill(); ctx.restore();
}
function tick() {
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  parts = parts.filter((p) => p.life > 0);
  for (const p of parts) {
    p.x += p.vx; p.y += p.vy; p.vy += 0.15; p.vx *= 0.99; p.life -= 0.012;
    ctx.globalAlpha = Math.max(0, p.life); heart(p.x, p.y, p.s, p.rot, p.c);
  }
  ctx.globalAlpha = 1;
  if (parts.length) requestAnimationFrame(tick); else { running = false; ctx.clearRect(0, 0, innerWidth, innerHeight); }
}

/* ---------------------------------------------------------------- stars */
(function makeStars() {
  const s = document.querySelector(".stars");
  for (let i = 0; i < 40; i++) {
    const e = document.createElement("i");
    e.style.left = Math.random() * 100 + "%"; e.style.top = Math.random() * 60 + "%";
    e.style.animationDelay = (Math.random() * 3).toFixed(2) + "s";
    if (Math.random() < 0.2) { e.style.width = e.style.height = "4px"; }
    s.appendChild(e);
  }
})();

/* ---------------------------------------------------------------- demo */
function demoData(kind) {
  const band = ["green", "yellow", "red"].includes(kind) ? kind : "yellow";
  const rec = { green: 82, yellow: 52, red: 28 }[band];
  const now = new Date();
  const days = [];
  for (let i = 83; i >= 0; i--) {
    const t = new Date(now.getTime() - i * 86400000), sri = 55 + Math.round(40 * Math.abs(Math.sin(i * 1.7)));
    const r = Math.round(30 + 60 * Math.abs(Math.sin(i * 0.9)));
    days.push({ d: t.toISOString().slice(0, 10), rec: r, band: r >= 67 ? "green" : r >= 34 ? "yellow" : "red",
      sleep_h: +(5.5 + 3 * Math.abs(Math.cos(i))).toFixed(1), nap_h: i % 5 ? null : 0.8, strain: +(6 + 10 * Math.abs(Math.sin(i))).toFixed(1),
      steps: 3000 + (i * 977) % 8000, sri: i ? sri : null, lv: i ? (sri < 60 ? 1 : sri < 75 ? 2 : sri < 88 ? 3 : 4) : 0 });
  }
  days[days.length - 1] = { ...days[days.length - 1], rec, band };
  const off = -now.getTimezoneOffset(), tz = (off < 0 ? "-" : "+") + pad(Math.floor(Math.abs(off) / 60)) + ":" + pad(Math.abs(off) % 60);
  const iso = (ms) => new Date(ms + off * 60000).toISOString().slice(0, 16) + tz;
  const sleepEnd = kind === "sleep" ? now.getTime() - 20 * 3600000 : now.getTime() - 3 * 3600000;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const d = {
    v: 1, updated_at: iso(now.getTime() - 25 * 60000), tz,
    today: { date: days[days.length - 1].d, recovery: rec, band, calibrating: false, strain: { green: 12.4, yellow: 8.6, red: 4.1 }[band],
      strain_band: { green: "moderate", yellow: "light", red: "light" }[band], steps: 6234, workouts: [] },
    last_sleep: { start: iso(sleepEnd - 7.6 * 3600000), end: iso(sleepEnd), hours: { green: 8.4, yellow: 7.1, red: 5.2 }[band],
      performance: 88, efficiency: 94, stages_h: { light: 3.4, sws: 1.6, rem: 2.0, awake: 0.6 } },
    week: kind === "sleep"
      ? { usual_bed: pad(Math.floor(((nowMin - 60 + 1440) % 1440) / 60)) + ":00", usual_wake: pad(Math.floor(((nowMin + 300) % 1440) / 60)) + ":00",
          sleep_regularity: 78, avg_sleep_h: 7.2, avg_strain: 9.4, recovery_mix: { green: 2, yellow: 4, red: 1 }, workouts: [] }
      : { usual_bed: "04:50", usual_wake: "12:00", sleep_regularity: { green: 89, yellow: 74, red: 58 }[band], avg_sleep_h: 7.2, avg_strain: 9.4,
          recovery_mix: { green: 2, yellow: 4, red: 1 },
          workouts: [{ sport: "tai-chi", strain: 6.2, start: iso(now.getTime() - 3 * 86400000), minutes: 54 },
                     { sport: "badminton", strain: 16.8, start: iso(now.getTime() - 86400000), minutes: 120 }] },
    days, streaks: { regular_sleep: { green: 5, yellow: 2, red: 0 }[band], slept_7h: 1, wear: 30 },
    bio: { hrv: { green: 68, yellow: 50, red: 34 }[band], rhr: { green: 56, yellow: 60, red: 67 }[band], hrv_avg7: 52, rhr_avg7: 60 },
  };
  return d;
}

// 3D 小岛 6 秒内没出来（网络慢 / 不支持 WebGL / ?flat），就用 2D 版
setTimeout(() => $("#scene").classList.remove("loading3d"), new URLSearchParams(location.search).has("flat") ? 0 : 6000);

boot();
