"use strict";
/* 小窝的双向互动：喂食、生气模式（揍一揍 + 气消条）、认错 / 送花、留言、互动时间线。
   后端是 Cloudflare Worker（window.NEST_API，见 config.js）。留言只以密文上传（和页面数据同一把密钥）。
   依赖 app.js 里的全局：$, store, KEY, DATA, say, hearts, ago, b64e, b64d。 */

(() => {
  const API = window.NEST_API || "";
  const params = new URLSearchParams(location.search);
  const LOCAL = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  if (!API) return;

  const FOODS = {
    rice: { name: "一个饭团", emoji: "🍙" }, cake: { name: "一块小蛋糕", emoji: "🍰" }, tea: { name: "一杯奶茶", emoji: "🧋" },
    berry: { name: "一颗草莓", emoji: "🍓" }, noodle: { name: "一碗面", emoji: "🍜" }, veggie: { name: "一把青菜", emoji: "🥬" },
  };
  const WEAPONS = {
    fist: { name: "小拳拳", emoji: "👊", dmg: 2 }, slipper: { name: "拖鞋", emoji: "🩴", dmg: 3 },
    flick: { name: "弹脑门", emoji: "🫵", dmg: 1 }, pillow: { name: "枕头", emoji: "🛏️", dmg: 1 },
  };
  const FEEDS_PER_DAY = 6;
  const WHO_KEY = "nest.who", MUTE_KEY = "nest.mute";

  let me = store.get(WHO_KEY);               // "her" | "me"
  let events = [], lastId = 0, token = null, devKey = null, started = false;
  let weapon = "fist", pendingHits = 0, hitTimer = 0, combo = 0, comboTimer = 0, posting = false;
  let pushState = "off"; // off | on | unsupported（网页推送，只给 Zilong 用）
  window.NEST_MODE = "normal";

  /* ------------------------------------------------------------ keys & api */
  const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  async function key() {
    if (KEY) return KEY;
    if (params.has("demo") && LOCAL) { // 本地演示用的假密钥
      devKey ||= await crypto.subtle.importKey("raw", await crypto.subtle.digest("SHA-256", new TextEncoder().encode("nest-dev")), "AES-GCM", true, ["encrypt", "decrypt"]);
      return devKey;
    }
    return null;
  }
  async function getToken() {
    if (token) return token;
    const k = await key();
    if (!k) return null;
    const raw = new Uint8Array(await crypto.subtle.exportKey("raw", k));
    const tag = new TextEncoder().encode("nest-api-v1");
    const buf = new Uint8Array(raw.length + tag.length); buf.set(raw); buf.set(tag, raw.length);
    token = hex(await crypto.subtle.digest("SHA-256", buf));
    return token;
  }
  async function api(method, body, query = "") {
    const t = await getToken();
    if (!t) throw new Error("no key");
    const r = await fetch(API + "/events" + query, {
      method, headers: { authorization: "Bearer " + t, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) throw new Error("api " + r.status);
    return r.json();
  }
  async function seal(text) {
    const k = await key(), iv = crypto.getRandomValues(new Uint8Array(12));
    const k2 = await crypto.subtle.importKey("raw", await crypto.subtle.exportKey("raw", k), "AES-GCM", false, ["encrypt"]);
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, k2, new TextEncoder().encode(text));
    return b64e(iv) + "." + b64e(ct);
  }
  async function open(box) {
    try {
      const [iv, ct] = box.split(".");
      const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64d(iv) }, await key(), b64d(ct));
      return new TextDecoder().decode(pt);
    } catch { return "（看不懂的纸条）"; }
  }
  async function post(e) {
    const r = await api("POST", { who: me, ...e });
    await poll(); // 立刻拉一次，把自己这条也拿回来
    return r;
  }

  /* ------------------------------------------------------------ sound（WebAudio 合成，无素材） */
  let ac = null;
  function sfx(kind) {
    if (store.get(MUTE_KEY) === "1") return;
    try {
      ac ||= new (window.AudioContext || window.webkitAudioContext)();
      const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime;
      const spec = { pop: ["sine", 520, 880, 0.12], thud: ["triangle", 180, 60, 0.18], chomp: ["square", 300, 180, 0.08], chime: ["sine", 660, 1320, 0.4] }[kind];
      o.type = spec[0]; o.frequency.setValueAtTime(spec[1], t); o.frequency.exponentialRampToValueAtTime(spec[2], t + spec[3]);
      g.gain.setValueAtTime(0.18, t); g.gain.exponentialRampToValueAtTime(0.001, t + spec[3]);
      o.connect(g).connect(ac.destination); o.start(t); o.stop(t + spec[3] + 0.02);
      if (kind === "chomp") setTimeout(() => sfx("pop"), 140);
    } catch {}
  }
  const buzz = (ms) => { try { navigator.vibrate && navigator.vibrate(ms); } catch {} };

  /* ------------------------------------------------------------ derived state */
  function state() {
    let anger = 0, angry = false, hits = 0;
    const now = Date.now();
    let full = 0, feedsToday = 0, flowers = 0;
    const today = new Date().toDateString();
    for (const e of events) {
      if (e.kind === "angry") { angry = true; anger = 100; hits = 0; }
      else if (e.kind === "hit" && angry) { const d = (WEAPONS[e.item] || WEAPONS.fist).dmg * (e.n || 1); anger -= d; hits += e.n || 1; }
      else if (e.kind === "sorry" && angry) anger -= 15;
      else if (e.kind === "flower" && angry) anger -= 25;
      else if (e.kind === "calm") { angry = false; anger = 0; }
      if (e.kind === "feed") {
        const h = (now - e.ts) / 3600000;
        full += 30 * Math.exp(-h / 8);
        if (new Date(e.ts).toDateString() === today) feedsToday++;
      }
      if (e.kind === "flower" && now - e.ts < 48 * 3600000) flowers++;
    }
    // 本地还没发出去的连击也算进去，气消条实时动
    if (angry && pendingHits) anger -= WEAPONS[weapon].dmg * pendingHits, hits += pendingHits;
    return { angry, anger: Math.max(0, Math.round(anger)), hits, full: Math.min(100, Math.round(full)), feedsToday, flowers: Math.min(3, flowers) };
  }

  /* ------------------------------------------------------------ rendering */
  const root = $("#social");
  const other = () => (me === "her" ? "他" : "她");
  const whoName = (w) => (w === me ? "我" : w === "me" ? "他" : "她");

  function render() {
    if (!me) { root.hidden = false; $("#who-pick").hidden = false; $("#social-main").hidden = true; return; }
    root.hidden = false; $("#who-pick").hidden = true; $("#social-main").hidden = false;
    const s = state();
    window.NEST_MODE = s.angry && me === "her" ? "angry" : "normal";
    window.NEST3D && window.NEST3D.setAngry(s.angry);
    window.NEST3D && window.NEST3D.setFlowers(s.flowers);

    // 气消条
    $("#anger").hidden = !s.angry;
    if (s.angry) {
      $("#anger-fill").style.width = s.anger + "%";
      $("#anger-text").textContent = me === "her" ? `气还剩 ${s.anger}% · 已经揍了 ${s.hits} 下` : `她在生气！已经揍了你 ${s.hits} 下，气还剩 ${s.anger}%`;
    }
    // 饱腹
    $("#full-fill").style.width = s.full + "%";
    $("#full-text").textContent = s.full < 25 ? "饿饿 🥺" : s.full < 60 ? "还能吃" : "吃饱饱 😋";

    // 按钮
    const A = [];
    if (me === "her") {
      A.push(`<button data-act="feed">🍽 喂食<small>${Math.max(0, FEEDS_PER_DAY - s.feedsToday)}/${FEEDS_PER_DAY}</small></button>`);
      A.push(s.angry ? `<button data-act="calm">😌 不气了</button>` : `<button data-act="angry">😤 我生气了</button>`);
      A.push(`<button data-act="note">💌 留言</button>`);
    } else {
      A.push(`<button data-act="sorry">🙇 认错</button>`, `<button data-act="flower">🌹 送花</button>`, `<button data-act="note">💌 写纸条</button>`);
      if (pushState !== "unsupported") A.push(pushState === "on" ? `<button data-act="push-test">🔔 通知已开<small>点一下测试</small></button>` : `<button data-act="push">🔔 开启通知</button>`);
    }
    A.push(`<button data-act="mute" class="mini" title="声音">${store.get(MUTE_KEY) === "1" ? "🔇" : "🔈"}</button>`);
    $("#actions").innerHTML = A.join("");

    // 武器栏（生气时一直显示）
    if (window.NEST_MODE === "angry") {
      $("#tray").hidden = false;
      $("#tray").className = "tray weapons";
      $("#tray").innerHTML = Object.entries(WEAPONS).map(([k, w]) => `<button data-weapon="${k}" class="${k === weapon ? "on" : ""}">${w.emoji}<small>${w.name}</small></button>`).join("") + `<p class="small muted">选好武器，点小岛上的它</p>`;
    } else if ($("#tray").classList.contains("weapons")) $("#tray").hidden = true;
  }

  async function renderTimeline() {
    const recent = events.slice(-15).reverse();
    const lines = await Promise.all(recent.map(async (e) => {
      const w = whoName(e.who);
      let t = "";
      if (e.kind === "feed") t = `${w}喂了${(FOODS[e.item] || {}).name || "好吃的"} ${(FOODS[e.item] || {}).emoji || ""}`;
      else if (e.kind === "angry") t = `${w}生气了 😤`;
      else if (e.kind === "hit") t = `${w}用${(WEAPONS[e.item] || WEAPONS.fist).name}揍了 ${e.n || 1} 下 ${(WEAPONS[e.item] || WEAPONS.fist).emoji}`;
      else if (e.kind === "calm") t = `${w}气消了 🌈`;
      else if (e.kind === "sorry") t = `${w}认错了 🙇`;
      else if (e.kind === "flower") t = `${w}送了一朵花 🌹`;
      else if (e.kind === "note") t = `${w}留言：「${await open(e.box || "")}」`;
      return `<li class="${e.who === me ? "mine" : ""}"><span>${esc(t)}</span><time>${ago(new Date(e.ts).toISOString())}</time></li>`;
    }));
    $("#timeline").innerHTML = lines.join("") || `<li class="muted">还没有互动，${me === "her" ? "先喂它点好吃的吧" : "等她来玩"} ✨</li>`;
  }
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  /* ------------------------------------------------------------ remote events → 动画 */
  async function onRemote(e) {
    if (e.who === me) return;
    const R = window.NEST3D;
    if (e.kind === "feed") { R && R.react("eat"); say(`她喂了你${(FOODS[e.item] || {}).name || "好吃的"} ${(FOODS[e.item] || {}).emoji || ""}`); }
    else if (e.kind === "angry") { say("⚠️ 她生气了！快认错！"); }
    else if (e.kind === "hit") { R && R.react("hit"); say(`她用${(WEAPONS[e.item] || WEAPONS.fist).name}揍了你 ${e.n || 1} 下 😵`); }
    else if (e.kind === "calm") { R && R.react("love"); say("她气消了 🌈"); }
    else if (e.kind === "sorry") { R && R.react("bow"); say("他认错了：对不起 🙇"); }
    else if (e.kind === "flower") { R && R.react("love"); say("他送了你一朵花 🌹"); burst(); }
    else if (e.kind === "note") { say(`${whoName(e.who)}的纸条：「${await open(e.box || "")}」`); }
  }

  async function poll(first) {
    try {
      const r = await api("GET", null, "?since=" + lastId);
      const fresh = r.events || [];
      if (!fresh.length) { if (first) { render(); renderTimeline(); } return; }
      events = events.concat(fresh);
      lastId = fresh[fresh.length - 1].id;
      if (!first) for (const e of fresh) await onRemote(e);
      render(); renderTimeline();
    } catch (e) {
      if (first) { $("#timeline").innerHTML = `<li class="muted">互动服务暂时连不上（${esc(String(e.message || e))}）</li>`; render(); }
    }
  }

  function headPos() {
    const p = window.NEST3D && window.NEST3D.headScreen();
    if (p) return p;
    const r = $("#scene").getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height * 0.55 };
  }
  function burst() { const p = headPos(); hearts(p.x, p.y, 24); sfx("chime"); }

  // 食物 / 武器从按钮飞到它头上
  function fly(emoji, from, then) {
    const el = document.createElement("span");
    el.className = "flyer"; el.textContent = emoji;
    const to = headPos();
    el.style.left = from.x + "px"; el.style.top = from.y + "px";
    document.body.appendChild(el);
    requestAnimationFrame(() => { el.style.transform = `translate(${to.x - from.x}px, ${to.y - from.y}px) scale(.7) rotate(20deg)`; el.style.opacity = "0.95"; });
    setTimeout(() => { el.remove(); then && then(); }, 520);
  }

  /* ------------------------------------------------------------ actions */
  root.addEventListener("click", async (ev) => {
    const b = ev.target.closest("button");
    if (!b) return;
    if (b.dataset.who) { me = b.dataset.who; store.set(WHO_KEY, me); if (me === "me") await checkPush(); render(); renderTimeline(); return; }
    if (b.dataset.weapon) { weapon = b.dataset.weapon; render(); sfx("pop"); return; }
    if (b.dataset.food) {
      const s = state();
      if (s.feedsToday >= FEEDS_PER_DAY) { say("今天喂太多啦，明天再来 🙅"); return; }
      const f = FOODS[b.dataset.food], r = b.getBoundingClientRect();
      $("#tray").hidden = true;
      fly(f.emoji, { x: r.left + r.width / 2, y: r.top }, () => {
        window.NEST3D && window.NEST3D.react("eat"); sfx("chomp"); buzz(20);
        say(["好吃！还要 😋", "嗷呜一口！", "最喜欢你喂的 💕", "吧唧吧唧…"][Math.floor(Math.random() * 4)]);
      });
      post({ kind: "feed", item: b.dataset.food }).catch(() => say("没喂上，网络好像不太好 😢"));
      return;
    }
    const act = b.dataset.act;
    if (!act || posting) return;
    if (act === "mute") { store.set(MUTE_KEY, store.get(MUTE_KEY) === "1" ? "0" : "1"); render(); return; }
    if (act === "push") { enablePush(); return; }
    if (act === "push-test") { pushTest(); return; }
    if (act === "feed") {
      const t = $("#tray");
      if (!t.hidden && t.classList.contains("foods")) { t.hidden = true; return; }
      t.className = "tray foods"; t.hidden = false;
      t.innerHTML = Object.entries(FOODS).map(([k, f]) => `<button data-food="${k}">${f.emoji}<small>${f.name.replace(/^一(个|块|杯|颗|碗|把)/, "")}</small></button>`).join("");
      return;
    }
    if (act === "note") { const f = $("#note-form"); f.hidden = !f.hidden; if (!f.hidden) f.querySelector("textarea").focus(); return; }
    posting = true;
    try {
      if (act === "angry") { await post({ kind: "angry" }); say("哼！看我怎么收拾你 😤（选个武器，点它）"); sfx("thud"); }
      if (act === "calm") { await flushHits(); await post({ kind: "calm" }); window.NEST3D && window.NEST3D.react("love"); say("好啦，原谅你了 🌈"); burst(); }
      if (act === "sorry") { await post({ kind: "sorry" }); window.NEST3D && window.NEST3D.react("bow"); say("对不起，我错了 🙇"); }
      if (act === "flower") { await post({ kind: "flower" }); burst(); say("送你一朵小花 🌹"); }
    } catch { say("没发出去，网络好像不太好 😢"); }
    posting = false;
  });

  $("#note-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const ta = ev.target.querySelector("textarea"), text = ta.value.trim();
    if (!text) return;
    try { await post({ kind: "note", box: await seal(text) }); ta.value = ""; ev.target.hidden = true; say("纸条寄出去了 💌"); sfx("chime"); }
    catch { say("纸条没寄出去 😢"); }
  });

  // 生气模式下点它 = 揍一下（scene3d 派发 nest:tap；2D 版点 #pet 也一样）
  function hit(x, y) {
    if (window.NEST_MODE !== "angry") return false;
    const w = WEAPONS[weapon];
    pendingHits++; combo++;
    clearTimeout(comboTimer); comboTimer = setTimeout(() => { combo = 0; $("#combo").textContent = ""; }, 1500);
    $("#combo").textContent = combo > 1 ? `${combo} 连击！` : "";
    window.NEST3D && window.NEST3D.react("hit");
    sfx("thud"); buzz(30);
    pow(x, y, w.emoji);
    say(["呜…", "我错了我错了 😭", "轻点轻点！", "痛痛痛 😵", "再也不敢了…", "饶命啊～"][Math.floor(Math.random() * 6)]);
    render();
    if (state().anger <= 0) { flushHits().then(() => post({ kind: "calm" })).then(() => { say("气全消了！抱抱 🌈"); burst(); }).catch(() => {}); return true; }
    clearTimeout(hitTimer); hitTimer = setTimeout(flushHits, 2000);
    return true;
  }
  async function flushHits() {
    clearTimeout(hitTimer);
    if (!pendingHits) return;
    const n = pendingHits; pendingHits = 0;
    try { await post({ kind: "hit", item: weapon, n }); } catch { pendingHits += n; }
  }
  function pow(x, y, emoji) {
    const el = document.createElement("span");
    el.className = "pow"; el.textContent = Math.random() < 0.5 ? emoji : ["💥", "💫", "啪！", "咚！"][Math.floor(Math.random() * 4)];
    el.style.left = x + "px"; el.style.top = y + "px";
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 700);
  }
  addEventListener("nest:tap", (ev) => { if (ev.detail.what === "pet") hit(ev.detail.x, ev.detail.y); });
  $("#pet").addEventListener("click", (ev) => hit(ev.clientX, ev.clientY), true);
  addEventListener("pagehide", flushHits);

  /* ------------------------------------------------------------ 网页推送（Zilong 的安卓 Chrome） */
  function idb() {
    return new Promise((ok, bad) => {
      const r = indexedDB.open("nest", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("kv");
      r.onsuccess = () => ok(r.result); r.onerror = () => bad(r.error);
    });
  }
  async function idbSet(k, v) { const d = await idb(); return new Promise((ok) => { const x = d.transaction("kv", "readwrite"); x.objectStore("kv").put(v, k); x.oncomplete = ok; x.onerror = ok; }); }
  const vapidKey = () => { const s = (window.NEST_VAPID || "").replace(/-/g, "+").replace(/_/g, "/"); return Uint8Array.from(atob(s + "=".repeat((4 - s.length % 4) % 4)), (c) => c.charCodeAt(0)); };

  async function checkPush() {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !window.NEST_VAPID) { pushState = "unsupported"; return; }
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      pushState = reg && (await reg.pushManager.getSubscription()) && Notification.permission === "granted" ? "on" : "off";
    } catch { pushState = "off"; }
  }
  async function enablePush() {
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") { say("没拿到通知权限：在浏览器设置里允许这个网站发通知再试一次"); return; }
      const reg = await navigator.serviceWorker.register("sw.js");
      await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidKey() }));
      // 给 service worker 用：令牌、解纸条的密钥、从哪条开始算"新动态"
      await idbSet("token", await getToken());
      await idbSet("key", b64e(await crypto.subtle.exportKey("raw", await key())));
      await idbSet("lastId", lastId);
      const r = await fetch(API + "/subscribe", { method: "POST", headers: { authorization: "Bearer " + (await getToken()), "content-type": "application/json" }, body: JSON.stringify({ who: "me", sub: sub.toJSON() }) });
      if (!r.ok) throw new Error("subscribe " + r.status);
      pushState = "on"; render();
      say("通知开好了 🔔 马上发一条测试");
      pushTest();
    } catch (e) { say("开启通知失败：" + (e.message || e)); }
  }
  async function pushTest() {
    try {
      const r = await fetch(API + "/push-test", { method: "POST", headers: { authorization: "Bearer " + (await getToken()) } });
      const j = await r.json();
      say(j.sent ? "测试推送已发出，看看手机通知栏 📱" : "没有发出去：可能需要重新开启通知");
      if (!j.sent) { pushState = "off"; render(); }
    } catch { say("测试推送失败，网络好像不太好"); }
  }

  /* ------------------------------------------------------------ boot：解锁后才开始 */
  async function start() {
    if (started || !(await key())) return;
    started = true;
    if (me === "me") await checkPush();
    render();
    await poll(true);
    setInterval(() => { if (!document.hidden) poll(); }, 12000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) poll(); });
  }
  addEventListener("nest:update", start);
  if (window.NEST) start(); // 演示模式下页面可能已经先渲染好了
})();
