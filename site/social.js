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
  // 小岛商店（价格以后端为准，这里只管名字和图标）。没有模型的装饰会用程序画的版本。
  const ITEMS = {
    flowers_bed: ["花坛", "🌷"], mushrooms: ["蘑菇丛", "🍄"], fence: ["小栅栏", "🪵"], mailbox: ["邮筒", "📮"], bench: ["长椅", "🪑"],
    lamppost: ["路灯", "🏮"], lights: ["串灯", "✨"], gifts: ["礼物堆", "🎁"], campfire: ["篝火", "🔥"], snowman: ["雪人", "⛄"],
    snow: ["下雪天", "❄️"], telescope: ["望远镜", "🔭"], swing: ["秋千", "🎠"], tent: ["帐篷", "⛺"], sakura: ["樱花树", "🌸"],
    pond: ["小池塘", "🦆"], balloon: ["热气球", "🎈"], windmill: ["风车", "🌬️"], cabin: ["小木屋", "🏡"],
  };
  const REASONS = {
    welcome: "开张礼包 🎉", bed: "按时睡觉 🛏", sleep7: "睡够 7 小时 😴", green: "恢复满格 💚", regular: "作息规律 📅",
    active: "今天动起来了 🏸", streak3: "连续 3 晚按时睡 🔥", nudge: "一催就睡 🔔", feed: "今天第一次喂食 🍙",
    notes: "纸条往来 💌", calm: "和好奖励 🌈", fish: "钓鱼收获 🎣", mood: "报心情 💭",
    qa: "每日一问 📝", hunt: "岛上藏宝 🗺", derby: "钓鱼大赛 🎣", quiz: "默契考验 💞", tuck_me: "盖被子 🛏", tuck_her: "盖被子 🛏", harvest: "菜地收获 🧺", gacha: "扭蛋 🎰",
  };
  // 她报的心情、两只角色之间的小动作、钓鱼的奖池（名字和图标；概率和星星以后端为准）
  const MOODS = { happy: ["开心", "😊"], tired: ["累了", "😮‍💨"], miss: ["想你", "🥺"], angry: ["有点气", "😤"], sleepy: ["困了", "😪"] };
  const ACTS = { hug: ["抱抱", "🤗"], pat: ["摸摸头", "🫳"], kiss: ["亲一下", "😘"], highfive: ["击掌", "🙌"], poke: ["戳一戳", "👉"], ride: ["骑小马兜风", "🐴"] };
  const CATCH = {
    crucian: ["小鲫鱼", "🐟", "common"], clown: ["小丑鱼", "🐠", "common"], puffer: ["河豚", "🐡", "common"], shrimp: ["小虾", "🦐", "common"], boot: ["旧靴子", "🥾", "common"],
    koi: ["锦鲤", "🎏", "rare"], jelly: ["小水母", "🪼", "rare"], octopus: ["小章鱼", "🐙", "rare"], bottle: ["漂流瓶", "🍾", "rare"],
    whale: ["迷你鲸鱼", "🐳", "epic"], turtle: ["小海龟", "🐢", "epic"], chest: ["宝箱", "🎁", "epic"],
    goldkoi: ["金锦鲤", "✨", "legend"], mermaid: ["美人鱼的珍珠", "🦪", "legend"], star: ["坠落的星星", "🌟", "legend"],
  };
  const RARITY = { common: ["普通", "#8d99a6"], rare: ["稀有", "#2f8fd8"], epic: ["史诗", "#9b59d0"], legend: ["传说", "#e0a000"] };
  const SWEET = ["今天也很想你 💕", "要好好吃饭哦", "等见面那天，一起去海边钓鱼吧 🎣", "你是我钓到过最好的宝贝", "早点睡，梦里见 🌙"];
  // 扭蛋款装饰 / 作物 / 小猫的衣服（名字和图标；概率、价格以后端为准）
  const GACHA_ITEMS = {
    paper_lantern: ["纸灯笼", "🏮", "common"], pinwheel: ["小风车花", "🌀", "common"], mushroom_lamp: ["蘑菇灯", "🍄", "common"], bird_house: ["小鸟屋", "🐦", "common"],
    cat_tower: ["猫爬架", "🐈", "rare"], hammock: ["吊床", "🛏", "rare"], star_lamp: ["星星灯", "🌟", "rare"],
    carousel: ["小旋转木马", "🎠", "epic"], hot_air_heart: ["爱心热气球", "💗", "epic"],
    xmas_tree: ["圣诞树", "🎄", "rare"], reindeer: ["小驯鹿", "🦌", "epic"], gingerbread: ["姜饼屋", "🏠", "rare"], snow_family: ["雪人一家", "⛄", "rare"], candy_lane: ["拐杖糖小路", "🍭", "common"],
  };
  const CROP_INFO = { tomato: ["小番茄", "🍅"], strawberry: ["草莓", "🍓"], carrot: ["胡萝卜", "🥕"], sunflower: ["向日葵", "🌻"], tulip: ["郁金香", "🌷"], pumpkin: ["南瓜", "🎃"], poinsettia: ["圣诞红", "🌺"] };
  const OUTFIT_INFO = {
    santa_hat: ["圣诞帽", "🎅"], beanie: ["毛线帽", "🧶"], flower_crown: ["花环", "🌼"], beret: ["贝雷帽", "🎨"], witch_hat: ["小巫师帽", "🧙"], crown: ["小王冠", "👑"], bunny_ears: ["兔耳发箍", "🐰"],
    round_glasses: ["圆眼镜", "👓"], heart_sunglasses: ["爱心墨镜", "😎"], red_scarf: ["红围巾", "🧣"], knit_scarf: ["条纹围巾", "🧣"], bow_tie: ["领结", "🎀"],
  };
  const isXmasSeason = () => { const q = new URLSearchParams(location.search); if (q.has("xmas")) return true; const d = new Date(), md = (d.getMonth() + 1) * 100 + d.getDate(); return md >= 1120 || md <= 102; };
  const LEVELS = [[0, "小不点"], [20, "小可爱"], [50, "小伙伴"], [100, "小英雄"], [200, "小岛之王"]];
  let wallet = null, nudgedAt = 0, presence = {}, fishingNow = false, worldInfo = null, qaData = null, panel = null, seedPickFor = null;
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
    let full = 0, feedsToday = 0, flowers = 0, mood = null, moodTs = 0, asleep = false;
    const lastNight = {}, lastTuck = {};
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
      if (e.kind === "mood") { mood = e.item; moodTs = e.ts; }
      if (e.kind === "sleep") asleep = now - e.ts < 14 * 3600000;
      if (e.kind === "sleep" || e.kind === "night") lastNight[e.who] = e;
      if (e.kind === "tuck") lastTuck[e.who] = e;
      if (e.kind === "wake") asleep = false;
    }
    if (now - moodTs > 12 * 3600000) mood = null;
    // 能不能给对方盖被子：对方 12 小时内说过晚安，我在那之后还没盖过
    const other = me === "her" ? "me" : "her";
    const n = lastNight[other];
    const canTuck = !!(n && now - n.ts < 12 * 3600000 && !(lastTuck[me] && lastTuck[me].id > n.id));
    // 晚安连击：往回数，每个北京日有人盖过被子就算一天
    const tuckDays = new Set(events.filter((e) => e.kind === "tuck").map((e) => new Date(e.ts + 8 * 3600000).toISOString().slice(0, 10)));
    let streak = 0;
    for (let d = new Date(now + 8 * 3600000); tuckDays.has(d.toISOString().slice(0, 10)) || (streak === 0 && tuckDays.has(new Date(d - 86400000).toISOString().slice(0, 10))); d = new Date(d - 86400000)) if (tuckDays.has(d.toISOString().slice(0, 10))) streak++;
    const meSaidNight = !!(lastNight[me] && now - lastNight[me].ts < 10 * 3600000);
    // 本地还没发出去的连击也算进去，气消条实时动
    if (angry && pendingHits) anger -= WEAPONS[weapon].dmg * pendingHits, hits += pendingHits;
    return { angry, anger: Math.max(0, Math.round(anger)), hits, full: Math.min(100, Math.round(full)), feedsToday, flowers: Math.min(3, flowers), mood, asleep, canTuck, streak, meSaidNight };
  }

  /* ------------------------------------------------------------ rendering */
  const root = $("#social");
  // 她的名字在加密数据里（publish.py 从 state/profile.json 加进去），代码里不出现
  const HER = () => (window.NEST && window.NEST.data && window.NEST.data.names && window.NEST.data.names.her) || "她";
  const whoName = (w) => (w === me ? "我" : w === "me" ? "他" : HER());

  function render() {
    $('[data-who="her"]').textContent = `我是${HER()} 💕`;
    if (!me) { root.hidden = false; $("#who-pick").hidden = false; $("#social-main").hidden = true; return; }
    root.hidden = false; $("#who-pick").hidden = true; $("#social-main").hidden = false;
    const s = state();
    window.NEST_MODE = s.angry && me === "her" ? "angry" : "normal";
    window.NEST3D && window.NEST3D.setAngry(s.angry);
    window.NEST3D && window.NEST3D.setFlowers(s.flowers);
    window.NEST_WHO = me; // scene3d 用：点草地时走的是谁的角色
    const herOnline = me === "her" || isOnline("her");
    window.NEST3D && window.NEST3D.setHer && window.NEST3D.setHer({ online: !!herOnline, asleep: s.asleep, mood: s.mood });
    $("#her-status").innerHTML = herStatus(s, herOnline);
    syncWorld();

    // 气消条
    $("#anger").hidden = !s.angry;
    if (s.angry) {
      $("#anger-fill").style.width = s.anger + "%";
      $("#anger-text").textContent = me === "her" ? `气还剩 ${s.anger}% · 已经揍了 ${s.hits} 下` : `${HER()}在生气！已经揍了你 ${s.hits} 下，气还剩 ${s.anger}%`;
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
      A.push(`<button data-act="nudge">🌙 该睡觉啦</button>`);
      A.push(`<button data-act="acts">💞 互动</button>`, `<button data-act="moods">💭 心情</button>`);
      A.push(s.asleep ? `<button data-act="wake">☀️ 我醒啦</button>` : `<button data-act="sleep">🌙 晚安<small>我去睡啦</small></button>`);
      if (s.canTuck) A.push(`<button data-act="tuck">🛏 给他盖被子</button>`);
      A.push(fishBtn());
    } else {
      A.push(`<button data-act="sorry">🙇 认错</button>`, `<button data-act="flower">🌹 送花</button>`, `<button data-act="note">💌 写纸条</button>`);
      A.push(`<button data-act="acts">💞 互动</button>`, fishBtn());
      A.push(s.meSaidNight ? `<button data-act="night" disabled>🌙 已说晚安</button>` : `<button data-act="night">🌙 晚安</button>`);
      if (s.canTuck) A.push(`<button data-act="tuck">🛏 给${HER()}盖被子</button>`);
      if (pushState !== "unsupported") A.push(pushState === "on" ? `<button data-act="push-test">🔔 通知已开<small>点一下测试</small></button>` : `<button data-act="push">🔔 开启通知</button>`);
    }
    A.push(`<button data-act="mute" class="mini" title="声音">${store.get(MUTE_KEY) === "1" ? "🔇" : "🔈"}</button>`);
    $("#actions").innerHTML = A.join("");
    renderWallet();

    // 武器栏（生气时一直显示）
    if (window.NEST_MODE === "angry") {
      $("#tray").hidden = false;
      $("#tray").className = "tray weapons";
      $("#tray").innerHTML = Object.entries(WEAPONS).map(([k, w]) => `<button data-weapon="${k}" class="${k === weapon ? "on" : ""}">${w.emoji}<small>${w.name}</small></button>`).join("") + `<p class="small muted">选好武器，点小岛上的它</p>`;
    } else if ($("#tray").classList.contains("weapons")) $("#tray").hidden = true;
  }

  function fishBtn() {
    const used = (wallet && wallet.casts && wallet.casts[me]) || 0, R = (wallet && wallet.fishRules) || { free: 3, price: 2, max: 10 };
    const sub = used < R.free ? `免费 ${R.free - used} 次` : used < R.max ? `⭐${R.price} 一竿` : "今天钓完啦";
    return `<button data-act="fish">🎣 钓鱼<small>${sub}</small></button>`;
  }
  function herStatus(s, online) {
    const st = s.streak > 1 ? ` · 🌙 晚安连击 ${s.streak} 天` : "";
    if (me === "her") return (s.mood ? `你现在的心情：${MOODS[s.mood][1]} ${MOODS[s.mood][0]}` : "") + st;
    const bits = [];
    bits.push(s.asleep ? `😴 ${HER()}睡着了` : online ? `🟢 ${HER()}在岛上${rtLive() ? "（实时）" : ""}` : presence.her ? `${HER()} ${ago(new Date(presence.her).toISOString())}来过` : "");
    if (s.mood && !s.asleep) bits.push(`心情：${MOODS[s.mood][1]} ${MOODS[s.mood][0]}`);
    return bits.filter(Boolean).join(" · ") + st;
  }

  // 小日记：全部历史，按天分组；一开始有最近 200 条，"加载更早的"再往前翻（每次 200 条）
  let older = [], olderMore = false, olderLoading = false, tlOpen = false;
  const noteCache = new Map();
  const openCached = async (e) => { if (!noteCache.has(e.id)) noteCache.set(e.id, await open(e.box || "")); return noteCache.get(e.id); };
  const dayKey = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
  function dayLabel(ts) {
    const d = new Date(ts), today = new Date(), y = new Date(Date.now() - 86400000);
    if (dayKey(ts) === dayKey(today)) return "今天";
    if (dayKey(ts) === dayKey(y)) return "昨天";
    return `${d.getMonth() + 1}月${d.getDate()}日 周${"日一二三四五六"[d.getDay()]}${d.getFullYear() !== today.getFullYear() ? ` · ${d.getFullYear()}` : ""}`;
  }
  async function loadOlder() {
    if (olderLoading) return;
    const oldest = (older[0] || events[0] || {}).id;
    if (!oldest) return;
    olderLoading = true;
    try {
      const r = await api("GET", null, "?before=" + oldest);
      older = (r.events || []).concat(older);
      olderMore = !!r.more;
    } catch { say("没加载出来，网络好像不太好 😢"); }
    olderLoading = false;
    renderTimeline();
  }
  async function renderTimeline() {
    const all = older.concat(events).filter((e) => !["place", "move", "seed", "spend"].includes(e.kind) && !(e.kind === "farm" && (e.item || "").startsWith("useseed"))).reverse();
    const lines = await Promise.all(all.map(async (e) => {
      const w = whoName(e.who);
      let t = "";
      if (e.kind === "feed") t = `${w}喂了${(FOODS[e.item] || {}).name || "好吃的"} ${(FOODS[e.item] || {}).emoji || ""}`;
      else if (e.kind === "angry") t = `${w}生气了 😤`;
      else if (e.kind === "hit") t = `${w}用${(WEAPONS[e.item] || WEAPONS.fist).name}揍了 ${e.n || 1} 下 ${(WEAPONS[e.item] || WEAPONS.fist).emoji}`;
      else if (e.kind === "calm") t = `${w}气消了 🌈`;
      else if (e.kind === "sorry") t = `${w}认错了 🙇`;
      else if (e.kind === "flower") t = `${w}送了一朵花 🌹`;
      else if (e.kind === "note") t = `${w}留言：「${await openCached(e)}」`;
      else if (e.kind === "star") t = `小岛收到 ${e.n} 颗星星 ⭐ · ${REASONS[(e.item || "").split(":")[0]] || "奖励"}`;
      else if (e.kind === "buy") t = `${w}给小岛买了${(ITEMS[e.item] || ["新东西", "🎁"])[0]} ${(ITEMS[e.item] || ["", ""])[1]}`;
      else if (e.kind === "nudge") t = e.who === me ? `我催${me === "her" ? "他" : "她"}睡觉啦 🌙` : `${w}催你睡觉啦 🌙`;
      else if (e.kind === "mood") t = `${w}的心情：${(MOODS[e.item] || ["", "💭"])[1]} ${(MOODS[e.item] || ["说不清"])[0]}`;
      else if (e.kind === "sleep") t = `${w}去睡觉啦 😴`;
      else if (e.kind === "wake") t = `${w}醒啦 ☀️`;
      else if (e.kind === "act") t = `${w}${actText(e)}`;
      else if (e.kind === "answer") t = `${w}回答了 ${e.item.slice(5)} 的每日一问 📝`;
      else if (e.kind === "night") t = `${w}说晚安啦 🌙`;
      else if (e.kind === "tuck") t = `${w}给${e.who === me ? (me === "her" ? "他" : HER()) : "你"}盖好了被子 🛏`;
      else if (e.kind === "gacha") { const g = GACHA_ITEMS[e.item]; t = `${w}扭到了${g ? g[0] + " " + g[1] : e.item === "seeds" ? "种子包 🌱" : "星星袋 ⭐"}`; }
      else if (e.kind === "farm") { const [a, c] = (e.item || "").split(":"); const ci = CROP_INFO[c] || ["", "🌱"]; t = a === "plant" ? `${w}种下了${ci[0]} ${ci[1]}` : a === "water" ? `${w}给菜地浇了水 💧` : a === "harvest" ? `${w}收获了${ci[0]} ${ci[1]}` : ""; if (!t) return ""; }
      else if (e.kind === "wear") { const o = OUTFIT_INFO[e.item] || ["衣服", "👗"]; t = e.n ? `${w}给小猫戴上了${o[0]} ${o[1]}` : `${w}给小猫摘掉了${o[0]}`; }
      else if (e.kind === "fish") { const c = CATCH[e.item] || ["神秘的东西", "❓", "common"]; t = `${w}钓到了${c[0]} ${c[1]}${c[2] !== "common" ? `（${RARITY[c[2]][0]}）` : ""}`; }
      else if (e.kind === "hunt") { t = { hide: `${w}在小岛上藏了一个宝藏 🗺`, cancel: `${w}把宝藏收回去了`, found: `${w}挖到了宝藏 💰（${e.n} 铲）`, lost: `宝藏没被挖到，${w}赢了 🗺` }[e.item]; if (!t) return ""; }
      else if (e.kind === "dig") return "";
      else if (e.kind === "derby") { t = e.item === "start" ? `${w}发起了钓鱼大赛 🎣` : e.who === "sys" ? "钓鱼大赛打平了 🤝" : `${w}赢了钓鱼大赛 🏆`; }
      else if (e.kind === "dfish") { if (e.item === "miss") return ""; const c = CATCH[e.item] || ["鱼", "🐟"]; t = `${w}在钓鱼大赛钓到${c[0]} ${c[1]} +${e.n} 分`; }
      else if (e.kind === "quiz") t = `${w}交了今天的默契考验 💞`;
      else if (e.kind === "wishgrant") t = `${w}赢了一张愿望券 🎟`;
      else if (e.kind === "wish") t = `${w}写好了一个愿望 🎟`;
      else if (e.kind === "wishdone") t = `${w}兑现了一个愿望 ✅`;
      else if (e.kind === "rps") { if (e.item === "start") t = `${w}约了一局猜拳 ✊✌️✋${e.n ? "（押愿望券）" : ""}`; else return ""; }
      if (!t) return "";
      const today = dayKey(e.ts) === dayKey(Date.now());
      const tm = today ? ago(new Date(e.ts).toISOString()) : new Date(e.ts).toTimeString().slice(0, 5);
      return { day: dayKey(e.ts), ts: e.ts, html: `<li class="${e.who === me ? "mine" : ""}"><span>${esc(t)}</span><time>${tm}</time></li>` };
    }));
    let out = "", lastDay = null, n = 0;
    for (const l of lines) {
      if (!l) continue;
      if (l.day !== lastDay) { out += `<li class="tl-day">${dayLabel(l.ts)}</li>`; lastDay = l.day; }
      out += l.html; n++;
    }
    const canMore = older.length ? olderMore : firstMore;
    out += canMore ? `<li class="tl-more"><button type="button" data-tl="more">${olderLoading ? "加载中…" : "加载更早的日记 ↓"}</button></li>` : n ? `<li class="tl-end">—— 小窝开张的第一天 ✨ ——</li>` : "";
    $("#timeline").innerHTML = n ? out : `<li class="muted">还没有互动，${me === "her" ? "先喂它点好吃的吧" : `等${HER()}来玩`} ✨</li>`;
    $("#timeline").classList.toggle("open", tlOpen);
    const tb = $("#tl-toggle");
    if (tb) { tb.hidden = n <= 12; tb.textContent = tlOpen ? "收起" : `展开全部（${n} 条）`; }
  }
  let firstMore = false;
  function actText(e) {
    const other = e.who === "her" ? (me === "me" ? "你" : "他") : (me === "her" ? "你" : HER());
    return { hug: `抱了抱${other} 🤗`, pat: `摸了摸${other}的头 🫳`, kiss: `亲了${other}一下 😘`, highfive: `和${other}击了个掌 🙌`, poke: `戳了戳${other} 👉`, ride: "骑着小马绕岛兜风 🐴" }[e.item] || "做了点什么";
  }
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  /* ------------------------------------------------------------ remote events → 动画 */
  async function onRemote(e) {
    if (e.who === me) return;
    const R = window.NEST3D;
    const play = (k, item) => (R && R.play ? R.play(k, e.who, item) : null);
    if (e.kind === "feed") { play("feed", (FOODS[e.item] || {}).emoji) || (R && R.react("eat")); say(`${HER()}喂了你${(FOODS[e.item] || {}).name || "好吃的"} ${(FOODS[e.item] || {}).emoji || ""}`); }
    else if (e.kind === "angry") { say(`⚠️ ${HER()}生气了！快认错！`); }
    else if (e.kind === "hit") { play("hit", (WEAPONS[e.item] || WEAPONS.fist).emoji) || (R && R.react("hit")); say(`${HER()}用${(WEAPONS[e.item] || WEAPONS.fist).name}揍了你 ${e.n || 1} 下 😵`); }
    else if (e.kind === "calm") { play("hug") || (R && R.react("love")); say(`${HER()}气消了 🌈`); }
    else if (e.kind === "sorry") { play("sorry") || (R && R.react("bow")); say("他认错了：对不起 🙇"); }
    else if (e.kind === "flower") { play("flower") || (R && R.react("love")); say("他送了你一朵花 🌹"); burst(); }
    else if (e.kind === "act") { play(e.item); say(`${whoName(e.who)}${actText(e)}`); }
    else if (e.kind === "mood") { say(`${HER()}现在${(MOODS[e.item] || ["有点心情"])[0]} ${(MOODS[e.item] || ["", "💭"])[1]}`); }
    else if (e.kind === "sleep") { say(`${HER()}去睡觉啦 😴 晚安`); }
    else if (e.kind === "wake") { say(`${HER()}醒啦 ☀️`); }
    else if (e.kind === "night") { say(`他说晚安啦 🌙 给他盖个被子吧`); }
    else if (e.kind === "tuck") { play("tuck"); say(`${whoName(e.who)}给你盖好了被子 🛏 晚安～`); }
    else if (e.kind === "answer") { say(`${whoName(e.who)}回答了今天的每日一问 📝`); if (panel === "qa") loadQA(); }
    else if (e.kind === "gacha") { const g = GACHA_ITEMS[e.item]; say(`${whoName(e.who)}扭到了${g ? g[0] + " " + g[1] : "好东西"}`); }
    else if (e.kind === "farm") { const [a, c] = (e.item || "").split(":"); if (a === "water") say(`${whoName(e.who)}给菜地浇了水 💧`); if (a === "harvest") say(`${whoName(e.who)}收获了${(CROP_INFO[c] || ["菜"])[0]} 🧺`); }
    else if (e.kind === "wear") { applyWallet(); }
    else if (e.kind === "fish") {
      const c = CATCH[e.item] || ["神秘的东西", "❓", "common"];
      // 对方钓鱼时，在你这边也演一遍（结果已经定了）
      if (R && R.fish && !R.fishing() && Date.now() - e.ts < 60000) R.fish(e.who, async () => ({ catch: e.item, rarity: c[2], stars: 0, remote: true, who: e.who }));
      else say(`${whoName(e.who)}钓到了${c[0]} ${c[1]}`);
    }
    else if (e.kind === "note") { say(`${whoName(e.who)}的纸条：「${await open(e.box || "")}」`); }
    else if (e.kind === "star") { if (!/^(fish|gacha|harvest):/.test(e.item || "")) { R && R.react("love"); say(`+${e.n} ⭐ ${REASONS[(e.item || "").split(":")[0]] || ""}`); } }
    else if (e.kind === "buy") { R && R.react("love"); say(`${whoName(e.who)}给小岛买了${(ITEMS[e.item] || ["新东西"])[0]} ${(ITEMS[e.item] || ["", "🎁"])[1]}`); }
    else if (e.kind === "nudge") { say(`🌙 ${HER()}催你睡觉啦！现在睡着就能拿 3 颗星星`); }
    else if (e.kind === "hunt" && e.item === "hide") { say(`🗺 ${whoName(e.who)}在小岛上藏了一个宝藏！去「一起玩」挖宝吧`); sfx("chime"); }
    else if (e.kind === "derby" && e.item === "start") { say(`🎣 ${whoName(e.who)}向你发起了钓鱼大赛！去「一起玩」应战`); sfx("chime"); }
    else if (e.kind === "quiz") { say(`💞 ${whoName(e.who)}交了今天的默契考验`); }
    else if (e.kind === "rps" && e.item === "start") { say(`✊ ${whoName(e.who)}约你猜拳！去「一起玩 → 猜拳」出拳`); sfx("chime"); }
    else if (e.kind === "rps" && e.item === "pick") { say(`🤫 ${whoName(e.who)}已经出好拳了`); }
    else if (e.kind === "wish") { say(`🎟 ${whoName(e.who)}写好了一个愿望，去「一起玩 → 愿望券」看看`); }
    else if (e.kind === "wishdone") { say(`✅ ${whoName(e.who)}兑现了你的愿望`); }
    else if (e.kind === "dfish") {
      // 对方在钓鱼大赛里钓了一竿：在我这边也演一遍（结果已经定了）
      const res = e.item === "miss" ? { catch: null, miss: "slow", pts: 0, who: e.who } : { catch: e.item, rarity: (CATCH[e.item] || [0, 0, "common"])[2], pts: e.n, who: e.who, remote: true };
      if (R && R.fish && !R.fishing(e.who) && Date.now() - e.ts < 60000) R.fish(e.who, async () => res, { stay: true, local: false });
      else derbyToast(res, e.who);
    }
  }

  // 同一时间只跑一个拉取：发完动作自己拉一次 + 实时推送也触发一次，两个请求带着同一个 since，
  // 以前会把同一条动态追加两遍（日记里出现两条、对方那边动画也播两遍）。跑的过程中又有人要拉，就跑完再补一次。
  let polling = null, pollAgain = false;
  function poll(first) {
    if (polling) { pollAgain = true; return polling; }
    polling = (async () => {
      do { pollAgain = false; await poll0(first); first = false; } while (pollAgain);
    })().finally(() => { polling = null; });
    return polling;
  }
  async function poll0(first) {
    if (fishingNow && !first) return; // 自己钓鱼时先别拉新动态，免得结果在揭晓前就剧透
    try {
      const r = await api("GET", null, "?since=" + lastId + "&who=" + (me || ""));
      const fresh = (r.events || []).filter((e) => e.id > lastId); // 再保险一次：按 id 去重
      if (first) firstMore = !!r.more;
      if (r.presence) presence = r.presence;
      if (!fresh.length) { render(); if (first) renderTimeline(); return; }
      events = events.concat(fresh);
      lastId = fresh[fresh.length - 1].id;
      if (fresh.some((e) => ["star", "buy", "place", "fish", "gacha", "farm", "wear", "move", "seed", "spend"].includes(e.kind))) await loadWallet();
      if (!first && fresh.some((e) => ["hunt", "dig", "derby", "dfish", "quiz", "wishgrant", "wish", "wishdone", "rps"].includes(e.kind))) loadGames();
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
  const PANELS = { earn: "#earn", shop: "#shop-wrap", book: "#book", gacha: "#gacha", farm: "#farm", wardrobe: "#wardrobe", qa: "#qa", games: "#games" };
  function openPanel(k) {
    panel = panel === k ? null : k;
    for (const [id, sel] of Object.entries(PANELS)) $(sel).hidden = id !== panel;
    document.querySelectorAll("[data-panel]").forEach((b) => b.classList.toggle("on", b.dataset.panel === panel));
    if (panel === "qa") loadQA();
    if (panel === "games") { renderGames(); loadGames(); }
    renderPanels();
  }
  root.addEventListener("click", async (ev) => {
    const b = ev.target.closest("button");
    if (!b) return;
    if (b.dataset.panel) { openPanel(b.dataset.panel); return; }
    if (b.dataset.who) { me = b.dataset.who; store.set(WHO_KEY, me); if (me === "me") await checkPush(); render(); renderTimeline(); startRealtime().catch(() => {}); loadGames(); return; }
    if (b.dataset.weapon) { weapon = b.dataset.weapon; render(); sfx("pop"); return; }
    if (b.dataset.doact) {
      const k = b.dataset.doact;
      $("#tray").hidden = true;
      window.NEST3D && window.NEST3D.play && window.NEST3D.play(k, me);
      sfx("pop");
      post({ kind: "act", item: k }).catch(() => say("没发出去，网络好像不太好 😢"));
      return;
    }
    if (b.dataset.mood) {
      const k = b.dataset.mood;
      $("#tray").hidden = true;
      post({ kind: "mood", item: k }).then(() => { say(`收到～ 现在是「${MOODS[k][0]}」${MOODS[k][1]}`); sfx("chime"); loadWallet(); }).catch(() => say("没发出去，网络好像不太好 😢"));
      return;
    }
    if (b.dataset.food) {
      const s = state();
      if (s.feedsToday >= FEEDS_PER_DAY) { say("今天喂太多啦，明天再来 🙅"); return; }
      const f = FOODS[b.dataset.food], r = b.getBoundingClientRect();
      $("#tray").hidden = true;
      const yum = () => { sfx("chomp"); buzz(20); say(["好吃！还要 😋", "嗷呜一口！", "最喜欢你喂的 💕", "吧唧吧唧…"][Math.floor(Math.random() * 4)]); };
      if (window.NEST3D && window.NEST3D.play) { say("端过去啦～"); window.NEST3D.play("feed", "her", f.emoji).then(yum); }
      else fly(f.emoji, { x: r.left + r.width / 2, y: r.top }, () => { window.NEST3D && window.NEST3D.react("eat"); yum(); });
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
    if (act === "acts" || act === "moods") {
      const t = $("#tray");
      if (!t.hidden && t.classList.contains(act)) { t.hidden = true; return; }
      t.className = "tray " + act; t.hidden = false;
      const list = act === "acts" ? Object.entries(ACTS).filter(([k]) => me === "her" || k !== "ride") : Object.entries(MOODS);
      t.innerHTML = list.map(([k, [n, e]]) => `<button data-${act === "acts" ? "doact" : "mood"}="${k}">${e}<small>${n}</small></button>`).join("");
      return;
    }
    if (act === "fish") { goFish(); return; }
    if (act === "note") { const f = $("#note-form"); f.hidden = !f.hidden; if (!f.hidden) f.querySelector("textarea").focus(); return; }
    posting = true;
    try {
      if (act === "angry") { await post({ kind: "angry" }); say("哼！看我怎么收拾你 😤（选个武器，点它）"); sfx("thud"); }
      if (act === "calm") { await flushHits(); await post({ kind: "calm" }); window.NEST3D && window.NEST3D.react("love"); say("好啦，原谅你了 🌈"); burst(); }
      if (act === "sorry") { const P = window.NEST3D && window.NEST3D.play; P ? P("sorry", "me") : window.NEST3D && window.NEST3D.react("bow"); await post({ kind: "sorry" }); say("对不起，我错了 🙇"); }
      if (act === "flower") { const P = window.NEST3D && window.NEST3D.play; P && P("flower", "me"); await post({ kind: "flower" }); burst(); say("送你一朵小花 🌹"); }
      if (act === "sleep") { await post({ kind: "sleep" }); say("晚安 🌙 小猫趴在小马背上睡啦，等他来给你盖被子"); }
      if (act === "night") { await post({ kind: "night" }); say(`晚安 🌙 等${HER()}来给你盖被子`); }
      if (act === "tuck") { window.NEST3D && window.NEST3D.play && window.NEST3D.play("tuck", me); await post({ kind: "tuck" }); say("被子盖好啦 🛏 +1 ⭐"); sfx("chime"); loadWallet(); }
      if (act === "wake") { await post({ kind: "wake" }); say("早上好 ☀️"); burst(); }
      if (act === "nudge") {
        if (Date.now() - nudgedAt < 20 * 60000) { say("刚催过啦，给他一点时间 🌙"); }
        else { nudgedAt = Date.now(); await post({ kind: "nudge" }); say("已经催他睡觉了 🌙 他 30 分钟内睡着，小岛就能拿 3 颗星星"); sfx("chime"); }
      }
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
    if (combo === 1 && window.NEST3D && window.NEST3D.play) window.NEST3D.play("hit", "her", w.emoji);
    if (rtLive()) RT().sendAct("hit", weapon);
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
  addEventListener("nest:tap", (ev) => {
    if (ev.detail.what !== "decor") return;
    const [name, emoji] = ITEMS[ev.detail.item] || ["装饰", "✨"];
    say(`${emoji} ${name}：用星星换来的 ✨`);
    hearts(ev.detail.x, ev.detail.y, 6);
  });
  addEventListener("nest:tap", (ev) => {
    if (ev.detail.what === "her") {
      const s = state();
      if (me === "her") say(["喵～ 这是你哦 🐱", "小猫在等你陪它玩", "摸摸小猫 💕"][Math.floor(Math.random() * 3)]);
      else say(herStatus(s, isOnline("her")) || `这是${HER()}的小猫 🐱`);
      hearts(ev.detail.x, ev.detail.y, 6);
    }
    if (ev.detail.what === "pony") { say(["小马：咴儿～ 🐴", "小马想去兜风", "小马蹭了蹭你 💕"][Math.floor(Math.random() * 3)]); sfx("pop"); }
    if (ev.detail.what === "sea") sfx("pop");
  });
  $("#pet").addEventListener("click", (ev) => hit(ev.clientX, ev.clientY), true);
  addEventListener("pagehide", flushHits);

  /* ------------------------------------------------------------ 钓鱼：结果在后端抽；这里负责甩竿、咬钩、揭晓 */
  async function goFish() {
    const R = window.NEST3D;
    if (fishingNow || (R && R.fishing && R.fishing())) { say("鱼竿还在水里呢～"); return; }
    const used = (wallet && wallet.casts && wallet.casts[me]) || 0, rules = (wallet && wallet.fishRules) || { free: 3, price: 2, max: 10 };
    if (used >= rules.max) { say("今天钓了好多啦，明天再来 🎣"); return; }
    let pay = false;
    if (used >= rules.free) {
      if (wallet && wallet.balance < rules.price) { say(`今天的免费次数用完了，再钓一竿要 ${rules.price} 颗星星，星星不够哦`); return; }
      if (!confirm(`今天的免费次数用完了，用 ${rules.price} 颗星星再钓一竿？`)) return;
      pay = true;
    }
    fishingNow = true;
    say("走去码头钓鱼啦 🎣");
    const request = async () => {
      const r = await fetch(API + "/fish", { method: "POST", headers: { authorization: "Bearer " + (await getToken()), "content-type": "application/json" }, body: JSON.stringify({ who: me, pay }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return { error: j.error || "api " + r.status };
      return { ...j, who: me };
    };
    try {
      const res = R && R.fish ? await R.fish(me, request) : await request();
      if (res && res.error) say("鱼跑了…（" + res.error + "）");
      else if (res && !(R && R.fish)) await reveal({ detail: res });
    } catch (e) { say("鱼跑了…网络好像不太好 😢"); }
    fishingNow = false;
    await loadWallet(); await poll(); render(); renderTimeline();
  }
  addEventListener("nest:fish-miss", (ev) => { document.querySelectorAll(".bite").forEach((x) => x.remove()); if (ev.detail.pts != null || ev.detail.derby) derbyToast({ catch: null, miss: ev.detail.miss }, ev.detail.who || me); });
  // 咬钩：在浮漂上冒一个"快拉！"
  addEventListener("nest:fish-bite", (ev) => {
    sfx("pop"); buzz([40, 40, 40]);
    const el = document.createElement("button");
    el.className = "bite"; el.textContent = "快拉！🎣";
    el.style.left = ev.detail.x + "px"; el.style.top = ev.detail.y + "px";
    el.onclick = () => { window.NEST3D && window.NEST3D.pullFish(); el.remove(); };
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2300);
  });
  async function reveal(ev) {
    const d = ev.detail, c = CATCH[d.catch] || ["神秘的东西", "❓", d.rarity || "common"], rar = RARITY[d.rarity || c[2]] || RARITY.common;
    document.querySelectorAll(".bite").forEach((x) => x.remove());
    if (d.pts != null) { derbyToast(d, d.who || me); sfx(d.rarity === "common" ? "pop" : "chime"); return; } // 钓鱼大赛：只弹一句，不打断
    if (d.remote) { say(`${whoName(d.who)}钓到了${c[0]} ${c[1]}${c[2] !== "common" ? `（${rar[0]}）` : ""}`); return; }
    let extra = "";
    if (d.catch === "bottle") {
      const txt = d.note && d.note.box ? await open(d.note.box) : SWEET[Math.floor(Math.random() * SWEET.length)];
      extra = `<p class="bottle">${d.note ? `瓶子里是${me === "her" ? "他" : HER()}以前写的纸条：` : "瓶子里有一张小纸条："}<br>「${esc(txt)}」</p>`;
    }
    if (d.catch === "boot") extra = `<p class="muted">……是谁的靴子啊 😂</p>`;
    const card = document.createElement("div");
    card.className = "catch-card r-" + (d.rarity || c[2]);
    card.innerHTML = `<div class="cc-in"><small style="color:${rar[1]}">${"★".repeat({ common: 1, rare: 2, epic: 3, legend: 4 }[d.rarity] || 1)} ${rar[0]}</small>
      <div class="cc-emo">${c[1]}</div><b>${c[0]}</b>
      ${d.first ? `<p class="first">第一次钓到！收进图鉴 📖</p>` : ""}
      ${d.stars ? `<p class="gain">+${d.stars} ⭐</p>` : ""}${d.pity ? `<p class="muted">（保底）</p>` : ""}${extra}
      <button>收下</button></div>`;
    await new Promise((r) => setTimeout(r, d.rarity === "legend" ? 1800 : 1100)); // 先看 3D 里的鱼出水，再弹卡片
    document.body.appendChild(card);
    sfx(d.rarity === "common" ? "pop" : "chime");
    if (d.rarity === "legend" || d.rarity === "epic") { const p = headPos(); hearts(p.x, p.y, 30); }
    card.addEventListener("click", (e) => { if (e.target.tagName === "BUTTON" || e.target === card) card.remove(); });
    setTimeout(() => card.remove(), d.catch === "bottle" ? 20000 : 9000);
  }
  addEventListener("nest:fish-reveal", reveal);

  // 图鉴
  function renderBook() {
    const book = (wallet && wallet.fishbook) || {};
    const ids = Object.keys(CATCH);
    const got = ids.filter((k) => book[k]).length;
    $("#book").innerHTML = `<p class="small">图鉴 ${got} / ${ids.length} · 钓到过的鱼会在浅水区游来游去</p><div class="shop">` + ids.map((k) => {
      const [n, e, r] = CATCH[k], c = book[k];
      return c ? `<div class="item book r-${r}"><span class="emo">${e}</span><b>${n}</b><small style="color:${RARITY[r][1]}">${RARITY[r][0]} · ×${c}</small></div>`
        : `<div class="item book none"><span class="emo">❔</span><b>？？？</b><small style="color:${RARITY[r][1]}">${RARITY[r][0]}</small></div>`;
    }).join("") + `</div>`;
  }

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
      await idbSet("herName", HER());
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

  /* ------------------------------------------------------------ 星星金库 & 商店 */
  async function loadWallet() {
    try {
      const t = await getToken();
      const r = await fetch(API + "/wallet", { headers: { authorization: "Bearer " + t } });
      if (r.ok) wallet = await r.json();
    } catch {}
    applyWallet();
    renderWallet();
  }
  function level(earned) {
    let i = 0;
    while (i + 1 < LEVELS.length && earned >= LEVELS[i + 1][0]) i++;
    return { lv: i + 1, name: LEVELS[i][1], next: LEVELS[i + 1] ? LEVELS[i + 1][0] : null };
  }
  function applyWallet() {
    const R = window.NEST3D;
    if (!wallet || !R) return;
    const shown = Object.entries(wallet.shown || {}).filter(([, v]) => v).map(([k]) => k);
    R.setDecor && R.setDecor(shown.filter((k) => k !== "snow"));
    R.setSnow && R.setSnow(shown.includes("snow"));
    R.setLevel && R.setLevel(level(wallet.earned).lv);
    R.setBook && R.setBook(wallet.fishbook || {});
    R.setDecorPos && R.setDecorPos(wallet.pos || {});
    R.setOutfits && R.setOutfits(wallet.worn || {});
    R.setFarm && R.setFarm(wallet.farm);
  }
  function renderWallet() {
    if (!wallet) return;
    $("#stars").textContent = wallet.balance;
    const L = level(wallet.earned);
    $("#level").textContent = `Lv.${L.lv} ${L.name}` + (L.next ? ` · 再攒 ${L.next - wallet.earned} 颗升级` : " · 满级");
    $("#earn").innerHTML = `<p>星星是你们俩共用的，全部用来装扮小岛：</p><ul>
      <li>🛏 他在约定时间前睡着 <b>+3</b> · 😴 睡够 7 小时 <b>+2</b> · 💚 恢复满格 <b>+1</b> · 📅 作息规律 <b>+1</b></li>
      <li>🏸 今天动起来了 <b>+1</b> · 🔥 连续 3 晚按时睡 <b>+5</b></li>
      <li>🔔 ${HER()}点"该睡觉啦"，他 30 分钟内睡着 <b>+3</b></li>
      <li>🍙 每天第一次喂食 <b>+1</b> · 💌 同一天互相留言 <b>+1</b> · 🌈 吵架后和好 <b>+1</b> · 💭 ${HER()}每天报一次心情 <b>+1</b></li>
      <li>🎣 钓鱼：每人每天免费 3 竿，钓到锦鲤、鲸鱼、海龟、宝箱和传说级的宝贝都有星星，第一次钓到新东西再 <b>+1</b>（连续 14 竿没出史诗，第 15 竿保底）</li>
      <li>📝 每日一问两个人都答了 <b>+2</b> · 🛏 给对方盖被子 <b>+1</b> · 🧺 菜地收获 <b>+4～9</b> · 🎰 扭蛋偶尔出星星袋</li>
      <li>🎮 一起玩：✊ 每天第一局猜拳 <b>+1</b> · 🗺 藏宝挖到 <b>+1～8</b>（铲数越少越多）· 🎣 钓鱼大赛比完 <b>+3</b> · 💞 默契考验 <b>+1～5</b> · 🍀 平时钓到今日幸运鱼 <b>+2</b></li></ul>
      <p class="muted">手环的星星每 10 分钟结算一次。最近入账：${(wallet.recent || []).slice(0, 5).map((x) => `${REASONS[x.item.split(":")[0]] || x.item} +${x.n}`).join(" · ") || "还没有"}</p>`;
    renderPanels();
  }
  function renderPanels() {
    if (!wallet) return;
    if (panel === "book") renderBook();
    if (panel === "gacha") renderGacha();
    if (panel === "farm") renderFarm();
    if (panel === "wardrobe") renderWardrobe();
    if (panel !== "shop") return;
    const owned = new Set(wallet.owned || []), shown = wallet.shown || {}, prices = wallet.prices || {};
    const ids = Object.keys(ITEMS).filter((k) => prices[k] != null && (!window.NEST3D || !window.NEST3D.hasDecor || k === "snow" || window.NEST3D.hasDecor(k)));
    ids.sort((a, b) => prices[a] - prices[b]);
    // 扭蛋得到的装饰也在这里摆 / 收
    for (const k of Object.keys(GACHA_ITEMS)) if (owned.has(k)) ids.unshift(k);
    $("#shop").innerHTML = `<div class="row" style="grid-column: 1 / -1"><button class="bigbtn" data-act="arrange" style="font-size:14px;padding:8px 14px">🛋 布置小岛</button><span class="sub">把装饰拖到喜欢的位置</span></div>` + ids.map((k) => {
      const [name, emoji] = ITEMS[k] || GACHA_ITEMS[k], price = prices[k];
      if (owned.has(k)) return `<button data-place="${k}" class="item owned ${shown[k] ? "on" : ""}"><span class="emo">${emoji}</span><b>${name}</b><small>${shown[k] ? "摆着 · 点一下收起" : "收着 · 点一下摆出来"}</small></button>`;
      const can = wallet.balance >= price;
      return `<button data-buy="${k}" class="item ${can ? "" : "poor"}"><span class="emo">${emoji}</span><b>${name}</b><small>⭐ ${price}</small></button>`;
    }).join("");
  }
  root.addEventListener("click", async (ev) => {
    const b = ev.target.closest("button[data-buy], button[data-place]");
    if (!b || posting) return;
    posting = true;
    try {
      if (b.dataset.buy) {
        const k = b.dataset.buy, [name, emoji] = ITEMS[k] || OUTFIT_INFO[k];
        const price = (wallet.prices || {})[k] ?? (wallet.outfits || {})[k];
        if (wallet && wallet.balance < price) { say(`星星不够哦，还差 ${price - wallet.balance} 颗 ⭐`); }
        else if (confirm(`用 ${price} 颗星星买「${name}」吗？`)) {
          await post({ kind: "buy", item: k });
          await loadWallet();
          say(`买到了${name} ${emoji}！`); burst();
        }
      } else {
        const k = b.dataset.place, on = !(wallet.shown || {})[k];
        await post({ kind: "place", item: k, n: on ? 1 : 0 });
        await loadWallet();
      }
    } catch (e) { say("没成功，网络好像不太好 😢"); }
    posting = false;
  });

  /* ------------------------------------------------------------ 扭蛋 */
  function renderGacha() {
    const R = wallet.gachaRules || { free: 1, price: 3, max: 6 }, used = (wallet.spins || {})[me] || 0;
    const owned = new Set(wallet.owned || []);
    const sub = used < R.free ? "今天还有 1 次免费" : used < R.max ? `再扭一次 ⭐${R.price}` : "今天扭完啦，明天再来";
    const list = Object.entries(GACHA_ITEMS).filter(([, v]) => R.xmas || !["xmas_tree", "reindeer", "gingerbread", "snow_family", "candy_lane"].includes(Object.keys(GACHA_ITEMS).find((k) => GACHA_ITEMS[k] === v)));
    $("#gacha").innerHTML = `<div class="row"><button class="bigbtn" data-act="spin" ${used >= R.max ? "disabled" : ""}>🎰 扭一次</button><span class="sub">${sub}</span></div>
      ${R.xmas ? `<p class="sub">🎄 圣诞季限定款上架中：圣诞树、小驯鹿、姜饼屋、雪人一家、拐杖糖小路</p>` : ""}
      <p class="sub">会扭到小岛限定装饰、种子包或星星袋；重复的装饰自动换成 2 颗星。</p>
      <div class="shop">${list.map(([k, [n, e, r]]) => {
        const id = Object.keys(GACHA_ITEMS).find((x) => GACHA_ITEMS[x][0] === n);
        return `<div class="item book ${owned.has(id) ? "" : "none"} r-${r === "epic" ? "epic" : r === "rare" ? "rare" : "common"}"><span class="emo">${owned.has(id) ? e : "❔"}</span><b>${owned.has(id) ? n : "？？？"}</b><small style="color:${RARITY[r][1]}">${RARITY[r][0]}</small></div>`;
      }).join("")}</div>`;
  }
  let spinningNow = false;
  async function spin() {
    if (spinningNow) return;
    const R = wallet.gachaRules || { free: 1, price: 3, max: 6 }, used = (wallet.spins || {})[me] || 0;
    let pay = false;
    if (used >= R.max) { say("今天扭完啦，明天再来 🎰"); return; }
    if (used >= R.free) {
      if (wallet.balance < R.price) { say(`再扭一次要 ${R.price} 颗星星，星星不够哦`); return; }
      if (!confirm(`今天的免费次数用完了，用 ${R.price} 颗星星再扭一次？`)) return;
      pay = true;
    }
    spinningNow = true;
    try {
      const r = await fetch(API + "/gacha", { method: "POST", headers: { authorization: "Bearer " + (await getToken()), "content-type": "application/json" }, body: JSON.stringify({ who: me, pay }) });
      const j = await r.json();
      if (!r.ok) { say("扭蛋机卡住了…（" + (j.error || r.status) + "）"); spinningNow = false; return; }
      sfx("pop");
      if (window.NEST3D && window.NEST3D.gachaSpin) await window.NEST3D.gachaSpin(j);
      else gachaCard(j);
    } catch { say("扭蛋机卡住了…网络好像不太好 😢"); }
    spinningNow = false;
    await loadWallet(); await poll();
  }
  function gachaCard(d) {
    const g = GACHA_ITEMS[d.prize];
    const rar = RARITY[d.rarity] || RARITY.common;
    let title, emo, extra = "";
    if (g) { title = g[0]; emo = g[1]; extra = d.dup ? `<p class="muted">已经有啦，换成 <b>+2 ⭐</b></p>` : `<p class="first">新装饰！在商店里可以摆出来 🛋</p>`; }
    else if (d.prize === "seeds") { title = "种子包"; emo = "🌱"; extra = `<p>${(d.seeds || []).map((x) => (CROP_INFO[x] || ["", "🌱"])[1] + " " + (CROP_INFO[x] || ["种子"])[0]).join(" · ")}</p><p class="sub">去菜地种下吧</p>`; }
    else { title = "星星袋"; emo = "⭐"; extra = `<p class="gain">+${d.stars} ⭐</p>`; }
    const card = document.createElement("div");
    card.className = "catch-card r-" + (d.rarity === "common" ? "common" : d.rarity);
    card.innerHTML = `<div class="cc-in"><small style="color:${rar[1]}">${"★".repeat({ common: 1, rare: 2, epic: 3 }[d.rarity] || 1)} ${rar[0]}</small><div class="cc-emo">${emo}</div><b>${title}</b>${extra}<button>收下</button></div>`;
    document.body.appendChild(card);
    sfx(d.rarity === "common" ? "pop" : "chime");
    if (d.rarity === "epic") { const p = headPos(); hearts(p.x, p.y, 30); }
    card.addEventListener("click", (e) => { if (e.target.tagName === "BUTTON" || e.target === card) card.remove(); });
    setTimeout(() => card.remove(), 9000);
  }
  addEventListener("nest:gacha-reveal", (ev) => gachaCard(ev.detail));

  /* ------------------------------------------------------------ 菜地 */
  function renderFarm() {
    const F = wallet.farm;
    if (!F) { $("#farm").innerHTML = `<p class="sub">菜地还没开张</p>`; return; }
    const cells = F.plots.map((p, i) => {
      if (!p) return `<div class="farm-cell"><span class="emo">🟫</span><small>空地</small><button data-farm="pick" data-plot="${i}">种点什么</button></div>`;
      const [n, e] = CROP_INFO[p.crop] || ["作物", "🌱"];
      const emo = p.ready ? e : p.watered === 0 ? "🌰" : "🌱";
      const btn = p.ready ? `<button data-farm="harvest" data-plot="${i}">🧺 收获</button>` : p.wateredToday ? `<small>今天浇过了</small>` : `<button data-farm="water" data-plot="${i}">💧 浇水</button>`;
      return `<div class="farm-cell ${p.ready ? "ready" : ""} ${p.wilted ? "wilted" : ""}"><span class="emo">${emo}</span><small>${n} · 💧${p.watered}/${p.need}${p.wilted ? " · 蔫了，快浇水" : ""}</small>${btn}</div>`;
    }).join("");
    let pick = "";
    if (seedPickFor != null) {
      pick = `<p class="sub">在第 ${seedPickFor + 1} 块地种：</p><div class="seed-pick">` + Object.entries(F.crops).filter(([k, c]) => !c.season || F.xmas).map(([k, c]) => {
        const have = (F.seeds || {})[k] || 0, [n, e] = CROP_INFO[k] || [k, "🌱"];
        return `<button data-farm="plant" data-crop="${k}" data-plot="${seedPickFor}">${e}<small>${n}</small><small>${have ? `种子 ×${have}` : `⭐${c.seed}`} · ${c.days} 天</small></button>`;
      }).join("") + `</div>`;
    }
    $("#farm").innerHTML = `<p class="sub">菜地在高台上（瀑布旁边）。每块地每天浇一次水，浇够天数就能收获，收获有星星。两天不浇会蔫，但不会死～</p><div class="farm-grid">${cells}</div>${pick}`;
  }
  async function farmAct(act, plot, crop) {
    try {
      const r = await fetch(API + "/farm", { method: "POST", headers: { authorization: "Bearer " + (await getToken()), "content-type": "application/json" }, body: JSON.stringify({ who: me, act, plot, crop }) });
      const j = await r.json();
      if (!r.ok) { say({ "not enough stars": "星星不够买种子哦", "already watered today": "今天已经浇过啦", "not ready": "还没长好呢" }[j.error] || "没成功：" + j.error); return; }
      const R = window.NEST3D;
      if (act === "plant") { seedPickFor = null; say(`种下了${(CROP_INFO[crop] || ["种子"])[0]} 🌱`); sfx("pop"); }
      if (act === "water") { R && R.farmWater && R.farmWater(plot); say(`浇好水啦 💧（${j.watered}/${j.need}）`); sfx("chime"); }
      if (act === "harvest") { R && R.farmHarvest && R.farmHarvest(plot, (CROP_INFO[j.crop] || ["", "🌱"])[1]); say(`收获了${(CROP_INFO[j.crop] || ["菜"])[0]}！+${j.stars} ⭐`); burst(); }
      await loadWallet(); await poll();
    } catch { say("没成功，网络好像不太好 😢"); }
  }

  /* ------------------------------------------------------------ 衣橱（小猫） */
  function renderWardrobe() {
    const owned = new Set(wallet.owned || []), worn = wallet.worn || {}, prices = wallet.outfits || {};
    $("#wardrobe").innerHTML = `<p class="sub">给${me === "her" ? "你的" : HER() + "的"}小猫换衣服：帽子、眼镜、围巾各能戴一件。${isXmasSeason() ? "圣诞季没戴帽子会自动戴上圣诞帽 🎅" : ""}</p><div class="shop">` +
      Object.keys(OUTFIT_INFO).filter((k) => prices[k] != null).map((k) => {
        const [n, e] = OUTFIT_INFO[k];
        if (owned.has(k)) return `<button data-wear="${k}" class="item owned ${worn[k] ? "on" : ""}"><span class="emo">${e}</span><b>${n}</b><small>${worn[k] ? "戴着 · 点一下摘掉" : "点一下戴上"}</small></button>`;
        return `<button data-buy="${k}" class="item ${wallet.balance >= prices[k] ? "" : "poor"}"><span class="emo">${e}</span><b>${n}</b><small>⭐ ${prices[k]}</small></button>`;
      }).join("") + `</div>`;
  }

  /* ------------------------------------------------------------ 每日一问 */
  async function loadQA() {
    try {
      const r = await fetch(API + "/qa", { headers: { authorization: "Bearer " + (await getToken()) } });
      if (r.ok) qaData = await r.json();
    } catch {}
    renderQA();
  }
  async function renderQA() {
    if (!qaData) { $("#qa").innerHTML = `<p class="sub">加载中…</p>`; return; }
    const other = me === "her" ? "me" : "her", otherName = me === "her" ? "他" : HER();
    const today = qaData.days.find((d) => d.day === qaData.today) || { question: "", answers: [] };
    const mine = today.answers.find((a) => a.who === me), theirs = today.answers.find((a) => a.who === other);
    let body = `<p class="qa-q">📝 ${esc(today.question)}</p>`;
    if (!mine) {
      body += `<form class="qa-form" id="qa-form"><textarea maxlength="300" rows="3" placeholder="写下你的回答（只有你们俩看得到）"></textarea><div class="row" style="margin-top:6px"><button class="bigbtn" type="submit" style="font-size:14px;padding:8px 16px">提交</button>
        <span class="sub">${theirs ? `${otherName}已经答了，你答完就能看到 👀` : "两个人都答完才能看到对方的答案"}</span></div></form>`;
    } else {
      body += `<div class="qa-a"><b>我</b>${esc(await open(mine.box))}</div>`;
      body += theirs ? `<div class="qa-a"><b>${otherName}</b>${esc(await open(theirs.box))}</div>` : `<p class="sub">等${otherName}来答～ 两个人都答完，小岛 +2 ⭐</p>`;
    }
    const past = qaData.days.filter((d) => d.day !== qaData.today && d.answers.length);
    if (past.length) {
      const rows = await Promise.all(past.map(async (d) => {
        const m = d.answers.find((a) => a.who === me), t = d.answers.find((a) => a.who === other);
        const ans = m ? `${m ? `<div class="qa-a"><b>我</b>${esc(await open(m.box))}</div>` : ""}${t ? `<div class="qa-a"><b>${otherName}</b>${esc(await open(t.box))}</div>` : ""}` : `<p class="sub">这天你没答，看不到${otherName}的答案</p>`;
        return `<details><summary>${d.day.slice(5)} · ${esc(d.question)}</summary>${ans}</details>`;
      }));
      body += `<div class="qa-hist"><p class="sub">以前的问答</p>${rows.join("")}</div>`;
    }
    $("#qa").innerHTML = body;
  }
  root.addEventListener("submit", async (ev) => {
    if (ev.target.id !== "qa-form") return;
    ev.preventDefault();
    const ta = ev.target.querySelector("textarea"), text = ta.value.trim();
    if (!text || !qaData) return;
    try { await post({ kind: "answer", item: qaData.today, box: await seal(text) }); say("回答好啦 📝"); sfx("chime"); await loadQA(); loadWallet(); }
    catch { say("没提交上，网络好像不太好 😢"); }
  });

  /* ------------------------------------------------------------ 面板里的按钮：扭蛋 / 菜地 / 衣橱 / 布置 */
  root.addEventListener("click", async (ev) => {
    const b = ev.target.closest("button");
    if (!b) return;
    if (b.dataset.act === "spin") { spin(); return; }
    if (b.dataset.act === "arrange") { startArrange(); return; }
    if (b.dataset.farm) {
      const plot = +b.dataset.plot;
      if (b.dataset.farm === "pick") { seedPickFor = seedPickFor === plot ? null : plot; renderFarm(); return; }
      farmAct(b.dataset.farm, plot, b.dataset.crop);
      return;
    }
    if (b.dataset.wear) {
      const k = b.dataset.wear, on = !(wallet.worn || {})[k];
      try { await post({ kind: "wear", item: k, n: on ? 1 : 0 }); await loadWallet(); sfx("pop"); } catch { say("没换上，网络好像不太好 😢"); }
    }
  });

  /* ------------------------------------------------------------ 布置模式 */
  function startArrange() {
    const R = window.NEST3D;
    if (!R || !R.editStart) return;
    R.editStart();
    $("#edit-bar").hidden = false;
    document.getElementById("scene").scrollIntoView({ behavior: "smooth", block: "center" });
  }
  addEventListener("nest:edit-select", (ev) => {
    const id = ev.detail.item;
    $("#edit-hint").textContent = id ? `${(ITEMS[id] || GACHA_ITEMS[id] || ["装饰"])[0]}：拖到想放的地方` : "点一件装饰，拖到想放的地方";
  });
  $("#edit-bar").addEventListener("click", async (ev) => {
    const b = ev.target.closest("button");
    if (!b) return;
    const R = window.NEST3D;
    if (b.dataset.edit === "rotate") { R.editRotate(); return; }
    const changed = R.editStop();
    $("#edit-bar").hidden = true;
    if (b.dataset.edit === "cancel") { R.setDecorPos(wallet.pos || {}); return; }
    const ids = Object.keys(changed);
    if (!ids.length) return;
    try { for (const id of ids) await api("POST", { who: me, kind: "move", item: id, n: changed[id] }); say("摆好啦 🛋"); await loadWallet(); }
    catch { say("没保存上，网络好像不太好 😢"); }
  });

  /* ------------------------------------------------------------ 两座城市的天气 / 时间 + 圣诞季 */
  async function loadWorld() {
    try {
      const r = await fetch(API + "/world", { headers: { authorization: "Bearer " + (await getToken()) } });
      if (r.ok) worldInfo = await r.json();
    } catch {}
    syncWorld();
  }
  function syncWorld() {
    const R = window.NEST3D;
    if (!R || !me) return;
    R.setXmas && R.setXmas(isXmasSeason());
    if (!worldInfo || !R.setWorld) return;
    const other = me === "her" ? "me" : "her";
    const otherOnline = isOnline(other);
    R.setWorld({ mine: worldInfo[me], theirs: worldInfo[other], theirName: me === "her" ? "他" : HER(), bothOnline: !!otherOnline });
  }
  addEventListener("nest:tap", (ev) => {
    if (ev.detail.what === "gacha") { if (panel !== "gacha") openPanel("gacha"); say("扭蛋机：每天免费扭一次 🎰"); }
    if (ev.detail.what === "farm") { if (panel !== "farm") openPanel("farm"); say("菜地：记得每天浇水 💧"); }
    if (ev.detail.what === "xmas") { say(["圣诞快乐 🎄", "Merry Christmas ✨", "今年的圣诞树亮啦 🎄"][Math.floor(Math.random() * 3)]); hearts(ev.detail.x, ev.detail.y, 8); }
  });

  /* ------------------------------------------------------------ 小游戏：岛上藏宝 / 钓鱼大赛 / 默契大考验 / 愿望券 */
  let games = null, gameTab = "rps", huntMode = null, huntPick = null, quizDraft = null, derbyBusy = false, gamesSeen = null;
  const otherOf = (w) => (w === "me" ? "her" : "me");
  const otherName = () => (me === "her" ? "他" : HER());
  const BAND = { hot: ["🔥", "超烫"], warm: ["♨️", "有点暖"], cool: ["🌬", "有点凉"], cold: ["❄️", "好冷"], found: ["💰", "挖到了"] };
  const SRC = { hunt: "岛上藏宝", derby: "钓鱼大赛", rps: "石头剪刀布" };
  async function gamesApi(body) {
    const r = await fetch(API + "/games", { method: "POST", headers: { authorization: "Bearer " + (await getToken()), "content-type": "application/json" }, body: JSON.stringify({ who: me, ...body }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "api " + r.status);
    return j;
  }
  async function loadGames() {
    if (!me || !API) return;
    try {
      const r = await fetch(API + "/games?who=" + me, { headers: { authorization: "Bearer " + (await getToken()) } });
      if (!r.ok) return;
      const prev = games;
      games = await r.json();
      gamesDiff(prev, games); // 不等动画：数据先刷新，对方的挖坑 / 开宝箱在后台演
    } catch {}
    syncGames3d();
    if (panel === "games") renderGames();
    renderHuntBar();
  }
  function syncGames3d() {
    const R = window.NEST3D;
    if (R && R.setGames && games) R.setGames(games, me, { me: "Zilong", her: HER() });
  }
  // 对方的新动作：在我这边演出来（挖坑、钓鱼）
  function gamesDiff(prev, cur) {
    const R = window.NEST3D;
    if (!prev || !R) return;
    const ph = prev.hunt, ch = cur.hunt;
    if (ch && ph && ch.id === ph.id) {
      const fresh = ch.digs.slice(ph.digs.length);
      const digger = otherOf(ch.hider);
      if (digger !== me && fresh.length && R.remoteDigs) {
        const last = fresh[fresh.length - 1];
        say(`${whoName(digger)}挖了一铲：${BAND[last.band][0]} ${BAND[last.band][1]}`);
        const end = ch.status !== "live" && ch.x != null ? { found: ch.status === "found", x: ch.x, z: ch.z } : null;
        R.remoteDigs(digger, fresh, end).then(() => {
          syncGames3d();
          if (end && end.found) say(`💰 ${whoName(digger)}挖到了你藏的宝藏！愿望券归${whoName(digger)}`);
          if (end && !end.found) say(`🗺 ${whoName(digger)}没找到！宝藏还在你手里，愿望券归你`);
        });
      }
    }
    const pd = prev.derby, cd = cur.derby;
    if (cd && pd && cd.id === pd.id && pd.status === "live" && cd.status === "done") derbyOver(cd);
    const pr = prev.rps, cr = cur.rps;
    if (cr && (!pr || pr.id !== cr.id || cr.rounds.length > pr.rounds.length)) playRounds(cr, pr && pr.id === cr.id ? pr.rounds.length : 0);
    const pq = prev.quiz, cq = cur.quiz;
    if (cq && pq && cq.day === pq.day && !pq.result && cq.result) { say(`💞 默契考验揭晓：${cq.result.score}/10`); sfx("chime"); if (panel !== "games") burst(); }
  }
  function derbyOver(d) {
    const R = window.NEST3D;
    const a = d.p.me.total, b = d.p.her.total;
    const msg = !d.winner ? `🎣 钓鱼大赛平局！${a} : ${b}` : `🏆 ${whoName(d.winner)}赢了钓鱼大赛！${Math.max(a, b)} : ${Math.min(a, b)}，拿到一张愿望券`;
    setTimeout(() => { say(msg); sfx("chime"); if (d.winner === me) burst(); }, 3000); // 等最后一竿的提示先说完
    setTimeout(() => { if (R && R.leaveDock) { R.leaveDock("me"); R.leaveDock("her"); } }, 3500);
  }

  function renderGames() {
    const el = $("#games");
    if (!el) return;
    if (!games) { el.innerHTML = `<p class="sub">加载中…</p>`; loadGames(); return; }
    const tabs = [["rps", "✊ 猜拳"], ["hunt", "🗺 岛上藏宝"], ["derby", "🎣 钓鱼大赛"], ["quiz", "💞 默契考验"], ["wish", "🎟 愿望券"]];
    const todo = (games.wishes || []).filter((w) => (w.who === me && !w.wish) || (w.wish && !w.done && w.who !== me)).length;
    el.innerHTML = `<div class="gtabs">${tabs.map(([k, t]) => `<button type="button" data-gtab="${k}" class="${gameTab === k ? "on" : ""}">${t}${k === "wish" && todo ? `<i class="dot">${todo}</i>` : ""}</button>`).join("")}</div><div id="gbody"></div>`;
    ({ rps: renderRps, hunt: renderHunt, derby: renderDerby, quiz: renderQuiz, wish: renderWish })[gameTab]();
  }

  // ---------------- 石头剪刀布（三局两胜）
  const HAND = [["✊", "石头"], ["✌️", "剪刀"], ["✋", "布"]];
  const rpsShown = new Set(); // 已经演过的局（id:序号），避免自己出拳的回包和轮询各演一遍
  let rpsQueue = Promise.resolve(), rpsBusy = false;
  function renderRps() {
    const m = games.rps, el = $("#gbody"), on = otherName();
    const live = m && m.status === "live";
    let s = "";
    if (!live) {
      if (m && m.status === "done") s += `<p class="gres">上一局：${m.wins[me]} : ${m.wins[otherOf(me)]} · ${m.winner ? (m.winner === me ? "🏆 我赢了" : `${on}赢了`) : "平局"}${m.stake === "wish" && m.winner ? " · 愿望券归" + whoName(m.winner) : ""}</p>`;
      if (m && m.status === "expired") s += `<p class="sub">上一局超过 12 小时没打完，作废了</p>`;
      s += `<p class="sub">三局两胜，两个人都出完拳才揭晓（出拳交给服务器保管，谁也偷看不到）。赢的人走过去敲输的人一下 🔨，每天第一局打完小岛 +1 ⭐。</p>
        <div class="row"><button class="bigbtn" data-rps="challenge" data-stake="none">✊ 约${on}猜拳</button><button class="bigbtn alt" data-rps="challenge" data-stake="wish">🎟 押一张愿望券</button></div>`;
    } else {
      const mine = m.myPick, theirsPicked = m.picked[otherOf(me)];
      s += `<div class="rps-score"><span>我</span><b>${m.wins[me]}</b><i>:</i><b>${m.wins[otherOf(me)]}</b><span>${on}</span></div>
        <p class="sub" style="text-align:center">第 ${m.rounds.length + 1} 局${m.stake === "wish" ? " · 🎟 押了愿望券" : ""} · ${theirsPicked ? `${on}已经出好了 🤫` : isOnline(otherOf(me)) ? `${on}还在想…` : `等${on}上线出拳`}</p>
        <div class="rps-hands">${HAND.map(([e, n], i) => `<button type="button" data-rps="pick" data-r="${i}" class="${mine === i ? "on" : ""}" ${mine != null || rpsBusy ? "disabled" : ""}><span>${e}</span><small>${n}</small></button>`).join("")}</div>
        ${mine != null ? `<p class="gres" style="text-align:center">出了${HAND[mine][1]} ${HAND[mine][0]}，等${on}…</p>` : ""}
        <div class="row" style="justify-content:center"><button class="mini-btn" data-rps="quit">认输</button></div>`;
      if (m.rounds.length) s += `<div class="ghist">${m.rounds.map((r, i) => `<div>第 ${i + 1} 局：我 ${HAND[r[me]][0]} vs ${HAND[r[otherOf(me)]][0]} ${on} · ${r.w ? (r.w === me ? "我赢" : on + "赢") : "平"}</div>`).join("")}</div>`;
    }
    const hist = (games.rpsHist || []).slice(-5).reverse();
    if (hist.length) s += `<div class="ghist"><p class="sub">最近几局（Zilong : ${HER()}）</p>${hist.map((x) => `<div>${new Date(x.id).toLocaleDateString()} · ${x.wins.me} : ${x.wins.her} · ${x.winner ? "🏆 " + whoName(x.winner) : "平局"}${x.stake === "wish" ? " 🎟" : ""}</div>`).join("")}</div>`;
    el.innerHTML = s;
  }
  // 依次演新揭晓的几局：头顶亮手势 → 说结果 → 打完了就让赢的人去敲一下
  function playRounds(m, from) {
    const R = window.NEST3D;
    for (let i = from; i < m.rounds.length; i++) {
      const key = m.id + ":" + i;
      if (rpsShown.has(key)) continue;
      rpsShown.add(key);
      const r = m.rounds[i], last = i === m.rounds.length - 1;
      rpsQueue = rpsQueue.then(async () => {
        const shown = R && R.rpsReveal ? R.rpsReveal(r) : Promise.resolve();
        await new Promise((res) => setTimeout(res, 1300)); // 手势亮出来的那一刻再说结果
        const msg = `${whoName("me")} ${HAND[r.me][0]} vs ${HAND[r.her][0]} ${whoName("her")}：${r.w ? (r.w === me ? "我赢了这局！" : whoName(r.w) + "赢了这局") : "平局，再来一次"}`;
        say(msg); sfx(r.w === me ? "chime" : "pop");
        await shown;
        if (last && m.status === "done") {
          await new Promise((res) => setTimeout(res, 900));
          const sc = `${m.wins[me]}:${m.wins[otherOf(me)]}`;
          say(!m.winner ? "打平了 🤝" : m.winner === me ? `🏆 我赢了！${sc}${m.stake === "wish" ? " · 愿望券到手 🎟" : ""}` : `${whoName(m.winner)}赢了 ${m.wins[m.winner]}:${m.wins[me]}${m.stake === "wish" ? ` · 愿望券归${whoName(m.winner)}` : ""}，准备挨敲 🔨`);
          if (m.winner === me) burst();
          if (m.winner && R && R.play) await R.play("bonk", m.winner);
          loadWallet();
        }
      });
    }
  }
  async function rpsPick(r) {
    if (rpsBusy) return;
    rpsBusy = true;
    try {
      const res = await gamesApi({ game: "rps", op: "pick", r });
      games.rps = res.rps;
      sfx("pop");
      if (res.round) playRounds(res.rps, res.rps.rounds.length - 1);
    } catch (e) { say("没出上拳（" + e.message + "）"); }
    rpsBusy = false;
    renderGames();
  }

  // ---------------- 岛上藏宝
  function renderHunt() {
    const h = games.hunt, el = $("#gbody");
    const live = h && h.status === "live";
    let s = "";
    if (!live) {
      if (h && h.status !== "cancel" && (h.status === "found" || h.status === "lost")) {
        const seeker = otherOf(h.hider);
        s += `<p class="gres">${h.status === "found" ? `💰 ${whoName(seeker)}用了 ${h.digs.length} 铲挖到了${whoName(h.hider)}藏的宝藏` : `🗺 ${whoName(seeker)}挖了 ${h.max} 铲也没找到，宝藏归${whoName(h.hider)}`}</p>`;
        const miss = h.status === "lost" ? nearestMiss(h) : null;
        if (miss) s += `<p class="sub">宝藏在地图上的 <b style="color:#ff2f6d">✕</b> 那里（小岛上有一根金色光柱）。离得最近的是第 ${miss.n} 铲，只差大约 ${miss.steps} 步。</p>`;
        s += huntMap(h);
        if (h.x != null && window.NEST3D && window.NEST3D.huntLook) s += `<div class="row"><button class="mini-btn" data-hunt="look">📍 在小岛上看看藏在哪</button></div>`;
      }
      s += `<p class="sub">一个人把宝箱埋在小岛草地上，另一个人来挖：每一铲都会告诉你离宝藏有多近（🔥 超烫 / ♨️ 有点暖 / 🌬 有点凉 / ❄️ 好冷），挖到第 3、6 铲还有提示。一共 ${8} 铲。<br>挖到了：挖宝的人赢一张愿望券；8 铲都没挖到：藏宝的人赢。两种结果小岛都有星星。</p>
        <div class="row"><button class="bigbtn" data-hunt="hide">🗺 藏一个宝藏给${otherName()}</button></div>`;
    } else if (h.hider === me) {
      s += `<p class="gres">宝藏藏好啦，等${otherName()}来挖 👀（已经挖了 ${h.digs.length}/${h.max} 铲）</p>${digList(h)}${huntMap(h)}`;
      s += h.digs.length ? `` : `<div class="row"><button class="mini-btn" data-hunt="cancel">不藏了</button></div>`;
    } else {
      s += `<p class="gres">${otherName()}在小岛上藏了一个宝藏！还剩 <b>${h.max - h.digs.length}</b> 铲</p>${digList(h)}${h.digs.length ? huntMap(h) : ""}
        <div class="row"><button class="bigbtn" data-hunt="seek">⛏ ${huntMode === "seek" ? "正在挖宝…" : "开始挖宝"}</button></div>`;
    }
    const hist = (games.huntHist || []).slice(-5).reverse();
    if (hist.length) s += `<div class="ghist"><p class="sub">最近几局</p>${hist.map((x) => `<div>${new Date(x.id).toLocaleDateString()} · ${whoName(x.hider)}藏 · ${x.found ? `${x.digs} 铲挖到` : "没挖到"} · 🎟 ${whoName(x.winner)}</div>`).join("")}</div>`;
    el.innerHTML = s;
  }
  function digList(h) {
    if (!h.digs.length && !h.hints.length) return "";
    return `<div class="digs">${h.digs.map((d, i) => `<span class="dig b-${d.band}">${i + 1}. ${BAND[d.band][0]} ${BAND[d.band][1]}</span>`).join("")}</div>${h.hints.map((t) => `<p class="ghint">💡 ${esc(t)}</p>`).join("")}`;
  }
  // 俯视小地图：岛的轮廓 + 地标 + 挖过的坑（按冷热上色、标序号）+ 宝藏位置（藏的人一直看得到；结束后大家都看得到）
  // 下面 = 小岛正面（码头那边），和默认镜头一致
  const MAP_MARKS = [["🌳", 1.95, -1.25], ["🛏", -1.55, -0.85], ["🏡", -0.7, -4.45], ["🌊", -1.25, -3.2], ["🪵", 0.62, 3.3], ["🎰", 2.95, 1.75]];
  const BAND_COL = { hot: "#ef5a3c", warm: "#f2a531", cool: "#5aa0e6", cold: "#5468c4", found: "#e0b000" };
  function huntMap(h) {
    const M = window.NEST3D && window.NEST3D.mapInfo;
    if (!M || !h) return "";
    const pts = (a) => a.map(([x, z]) => `${x.toFixed(2)},${z.toFixed(2)}`).join(" ");
    const showX = h.x != null;
    let s = `<svg class="hmap" viewBox="-6 -7.1 12 13" role="img" aria-label="小岛地图">`;
    s += `<polygon points="${pts(M.COAST)}" fill="#f6e0ab" stroke="#e4c88a" stroke-width=".08"/>`;
    s += `<polygon points="${pts(M.MEADOW)}" fill="#a6dc84"/><polygon points="${pts(M.UPPER)}" fill="#7fc46a" stroke="#b08a6e" stroke-width=".12"/>`;
    s += `<polyline points="${pts(M.RIVER)}" fill="none" stroke="#7cc8f0" stroke-width=".32" stroke-linecap="round"/>`;
    for (const [e, x, z] of MAP_MARKS) s += `<text x="${x}" y="${z}" font-size=".72" text-anchor="middle" dominant-baseline="central" opacity=".85">${e}</text>`;
    h.digs.forEach((d, i) => {
      s += `<circle cx="${d.x}" cy="${d.z}" r=".3" fill="${BAND_COL[d.band] || "#999"}" stroke="#fff" stroke-width=".07"/>`;
      s += `<text x="${d.x}" y="${d.z + 0.02}" font-size=".34" font-weight="800" fill="#fff" text-anchor="middle" dominant-baseline="central">${i + 1}</text>`;
    });
    if (showX) {
      s += `<circle cx="${h.x}" cy="${h.z}" r=".55" fill="none" stroke="#ff4f8b" stroke-width=".1" stroke-dasharray=".18 .12"><animate attributeName="r" values=".45;.7;.45" dur="1.6s" repeatCount="indefinite"/></circle>`;
      s += `<path d="M${h.x - 0.28} ${h.z - 0.28}L${h.x + 0.28} ${h.z + 0.28}M${h.x + 0.28} ${h.z - 0.28}L${h.x - 0.28} ${h.z + 0.28}" stroke="#ff2f6d" stroke-width=".16" stroke-linecap="round"/>`;
    }
    s += `<text x="0" y="5.75" font-size=".46" fill="#8a7a6a" text-anchor="middle">⬇ 正面（码头这边）</text></svg>`;
    let legend = `<div class="hmap-legend"><span style="--c:${BAND_COL.hot}">超烫</span><span style="--c:${BAND_COL.warm}">有点暖</span><span style="--c:${BAND_COL.cool}">有点凉</span><span style="--c:${BAND_COL.cold}">好冷</span>${showX ? `<span class="x">✕ 宝藏</span>` : ""}</div>`;
    return `<div class="hmap-wrap">${s}${legend}</div>`;
  }
  // 没挖到时：最近的一铲差多少（和提示里的"步"一样，1 步 = 0.5）
  function nearestMiss(h) {
    if (h.x == null || !h.digs.length) return null;
    let best = Infinity, idx = 0;
    h.digs.forEach((d, i) => { const r = Math.hypot(d.x - h.x, d.z - h.z); if (r < best) { best = r; idx = i; } });
    return { steps: Math.max(1, Math.round(best / 0.5)), n: idx + 1 };
  }
  function renderHuntBar() {
    const bar = $("#game-bar");
    if (!bar) return;
    const h = games && games.hunt;
    if (huntMode === "seek" && !(h && h.status === "live" && h.hider !== me)) stopHunt();
    if (!huntMode) { bar.hidden = true; return; }
    bar.hidden = false;
    if (huntMode === "hide") {
      bar.innerHTML = huntPick
        ? `<span>藏在这里？可以留一张纸条放进宝箱：</span><input id="hunt-note" maxlength="120" placeholder="（可选）只有${otherName()}挖到才能看到"><button type="button" data-hunt="confirm" class="primary">✓ 藏好了</button><button type="button" data-hunt="stop">取消</button>`
        : `<span>点小岛的草地，选一个藏宝的地方 🗺</span><button type="button" data-hunt="stop">取消</button>`;
    } else {
      const left = h.max - h.digs.length, last = h.digs[h.digs.length - 1];
      bar.innerHTML = `<span>点草地挖一铲 ⛏ 还剩 <b>${left}</b> 铲${last ? ` · 上一铲：${BAND[last.band][0]} ${BAND[last.band][1]}` : ""}${h.hints.length ? `<br>💡 ${esc(h.hints[h.hints.length - 1])}` : ""}</span><button type="button" data-hunt="stop">先不挖了</button>`;
    }
  }
  function startHunt(mode) {
    const R = window.NEST3D;
    if (!R || !R.setTapMode) { say("3D 小岛还没加载好，等一下再试～"); return; }
    huntMode = mode; huntPick = null;
    R.setTapMode(mode === "hide" ? onHidePick : onSeekTap);
    document.getElementById("scene").scrollIntoView({ behavior: "smooth", block: "center" });
    renderHuntBar(); if (panel === "games") renderGames();
  }
  function stopHunt() {
    const R = window.NEST3D;
    huntMode = null; huntPick = null;
    if (R && R.setTapMode) R.setTapMode(null);
    if (R && R.previewHide) R.previewHide(null);
    syncGames3d();
    renderHuntBar();
  }
  function onHidePick(p) {
    huntPick = { x: Math.round(p.x * 100) / 100, z: Math.round(p.z * 100) / 100 };
    window.NEST3D.previewHide(huntPick);
    sfx("pop");
    renderHuntBar();
  }
  let digging = false;
  async function onSeekTap(p) {
    if (digging) return;
    const R = window.NEST3D, h = games && games.hunt;
    if (!h || h.status !== "live") { stopHunt(); return; }
    digging = true;
    const x = Math.round(p.x * 100) / 100, z = Math.round(p.z * 100) / 100;
    const req = gamesApi({ game: "hunt", op: "dig", x, z });
    try {
      const r = await R.localDig(me, x, z, req);
      if (r.error) { say("这一铲没挖下去（" + r.error + "）"); }
      else {
        sfx(r.band === "found" ? "chime" : "pop"); buzz(r.band === "hot" || r.band === "found" ? [30, 40, 30] : 20);
        if (r.hint) say("💡 " + r.hint);
        games.hunt = r.hunt;
        if (r.result) {
          stopHunt();
          if (r.result.found) {
            burst();
            const note = r.hunt.box ? await open(r.hunt.box) : null;
            say(`💰 挖到啦！用了 ${r.hunt.digs.length} 铲`);
            gameCard("💰", "挖到宝藏啦！", `用了 ${r.hunt.digs.length} 铲 · 小岛 +${r.result.stars} ⭐ · 你赢了一张愿望券 🎟`, note ? `宝箱里有${otherName()}的纸条：「${note}」` : "");
          } else say(`铲子用完了…宝藏归${otherName()}啦（小岛 +${r.result.stars} ⭐）`);
          await loadGames(); loadWallet();
        }
      }
    } finally { digging = false; renderHuntBar(); if (panel === "games") renderGames(); }
  }
  async function confirmHide() {
    if (!huntPick) return;
    const R = window.NEST3D, note = ($("#hunt-note") && $("#hunt-note").value.trim()) || "";
    const spot = huntPick;
    try {
      const r = await gamesApi({ game: "hunt", op: "hide", x: spot.x, z: spot.z, box: note ? await seal(note) : undefined });
      huntMode = null; huntPick = null;
      if (R && R.setTapMode) R.setTapMode(null);
      renderHuntBar();
      games.hunt = r.hunt;
      say(`藏好啦 🤫 等${otherName()}来挖`);
      if (R && R.buryChest) await R.buryChest(me, spot.x, spot.z);
      await loadGames();
    } catch (e) { say("没藏上（" + e.message + "）"); }
  }

  // ---------------- 钓鱼大赛
  const FISHN = (f) => (CATCH[f] || ["神秘的东西", "❓"]);
  function renderDerby() {
    const d = games.derby, el = $("#gbody"), lucky = FISHN(games.lucky);
    let s = `<p class="sub">今日幸运鱼：${lucky[1]} <b>${lucky[0]}</b>（比赛里分数 ×2，平时钓到也 +2 ⭐）</p>`;
    if (!d || d.status !== "live") {
      if (d && d.status === "done") s += `<p class="gres">上一场：Zilong ${d.p.me.total} : ${d.p.her.total} ${HER()} · ${d.winner ? `🏆 ${whoName(d.winner)}赢了` : "平局"}</p>`;
      s += `<p class="sub">每人 5 竿，24 小时内打完。同时在线就一起站在码头上钓，看得到对方钓到了什么。<br>浮漂一沉就点「快拉」：0.4 秒内拉起来有「快手」加成（多抽一次取好的），超过 1.5 秒鱼就跑了。<br>赢的人拿一张愿望券，奖杯在岛上摆 7 天；比完小岛 +3 ⭐。</p>
        <div class="row"><button class="bigbtn" data-derby="challenge">🎣 向${otherName()}发起钓鱼大赛</button></div>`;
    } else {
      const mine = d.p[me], theirs = d.p[otherOf(me)], left = d.max - mine.casts.length;
      const row = (who, p) => `<div class="drow"><b>${who === "her" ? "🐱" : "🦖"} ${who === me ? "我" : whoName(who)}</b><span class="dots">${Array.from({ length: d.max }, (_, i) => { const c = p.casts[i]; return `<i class="${c ? (c.f ? "hit" : "miss") : ""}" title="${c ? (c.f ? FISHN(c.f)[0] + " " + c.pts : "跑了") : ""}">${c ? (c.f ? FISHN(c.f)[1] : "💨") : ""}</i>`; }).join("")}</span><b class="pts">${p.total}</b></div>`;
      s += `<div class="derby">${row(me, mine)}${row(otherOf(me), theirs)}</div>
        <p class="sub">还有 ${Math.max(0, Math.round((d.until - Date.now()) / 3600000))} 小时结束 · ${theirs.casts.length >= d.max ? `${otherName()}已经钓完了` : isOnline(otherOf(me)) ? `${otherName()}在线，一起钓吧！` : `等${otherName()}上线来钓`}</p>
        <div class="row">${left > 0 ? `<button class="bigbtn" data-derby="cast" ${derbyBusy ? "disabled" : ""}>🎣 甩一竿（还剩 ${left}）</button>` : `<span class="gres">你钓完啦，等${otherName()}～</span>`}<button class="mini-btn" data-derby="quit">认输</button></div>`;
    }
    const hist = (games.derbyHist || []).slice(-5).reverse();
    if (hist.length) s += `<div class="ghist"><p class="sub">战绩（Zilong : ${HER()}）</p>${hist.map((x) => `<div>${new Date(x.id).toLocaleDateString()} · ${x.me} : ${x.her} · ${x.winner ? "🏆 " + whoName(x.winner) : "平局"}</div>`).join("")}</div>`;
    el.innerHTML = s;
  }
  async function derbyCast() {
    const R = window.NEST3D;
    if (derbyBusy) return;
    if (fishingNow) { say("鱼竿还在水里呢～"); return; }
    derbyBusy = true; renderGames();
    const request = async () => {
      const c = await gamesApi({ game: "derby", op: "cast" });
      return { bite: c.bite, reel: async (react) => {
        const r = await gamesApi({ game: "derby", op: "reel", cid: c.cid, react });
        games.derby = r.derby;
        const x = r.cast;
        return x.f ? { catch: x.f, rarity: x.rarity, pts: x.pts, cm: x.cm, lucky: x.lucky, quick: x.quick, derby: true, who: me } : { catch: null, miss: x.miss, derby: true, who: me };
      } };
    };
    try {
      const res = R && R.fish ? await R.fish(me, request, { derby: true, stay: true, local: true }) : null;
      if (!res && R && R.fish) say("鱼竿还在水里呢～");
      else if (!res && !(R && R.fish)) { // 没有 3D：直接走一遍
        const c = await request(); await new Promise((r) => setTimeout(r, c.bite)); const x = await c.reel(600); derbyToast(x, me);
      } else if (res && res.error) say("没甩出去（" + res.error + "）");
    } catch (e) { say("鱼跑了…网络好像不太好 😢"); }
    derbyBusy = false;
    await loadGames(); loadWallet();
    const d = games.derby;
    if (d && d.status === "live" && d.p[me].casts.length >= d.max && R && R.leaveDock) setTimeout(() => R.leaveDock(me), 2500);
  }
  function derbyToast(d, who) {
    if (!d.catch) { say(`${who === me ? "" : whoName(who)}${d.miss === "early" ? "拉早了，空竿 💨" : "拉慢了，鱼跑了 💨"}`); return; }
    const c = FISHN(d.catch);
    say(`${who === me ? "" : whoName(who) + " "}${c[1]} ${c[0]} ${d.cm ? d.cm + "cm · " : ""}+${d.pts} 分${d.quick ? " ⚡快手" : ""}${d.lucky ? " 🍀幸运鱼 ×2" : ""}`);
  }

  // ---------------- 默契大考验
  function renderQuiz() {
    const q = games.quiz, el = $("#gbody"), on = otherName();
    let s = `<p class="sub">每天 5 道题：先选<b>你自己</b>的答案，再猜<b>${on}</b>会选什么。两个人都交卷才揭晓，猜中一题 +1 默契，满分 10。累计默契 <b>${q.total}</b>（${q.rounds} 天）</p>`;
    if (!q.mine) {
      quizDraft ||= { self: [null, null, null, null, null], guess: [null, null, null, null, null], day: q.day };
      if (quizDraft.day !== q.day) quizDraft = { self: [null, null, null, null, null], guess: [null, null, null, null, null], day: q.day };
      s += q.questions.map((it, i) => `<div class="qz"><p class="qa-q">${i + 1}. ${esc(it.q)}</p>
        <div class="qrow"><small>我选</small>${it.opts.map((o, j) => `<button type="button" data-qz="self" data-i="${i}" data-j="${j}" class="${quizDraft.self[i] === j ? "on" : ""}">${esc(o)}</button>`).join("")}</div>
        <div class="qrow"><small>猜${on}</small>${it.opts.map((o, j) => `<button type="button" data-qz="guess" data-i="${i}" data-j="${j}" class="${quizDraft.guess[i] === j ? "on g" : ""}">${esc(o)}</button>`).join("")}</div></div>`).join("");
      const done = quizDraft.self.every((x) => x != null) && quizDraft.guess.every((x) => x != null);
      s += `<div class="row"><button class="bigbtn" data-qz="submit" ${done ? "" : "disabled"}>交卷 💞</button><span class="sub">${q.theirsDone ? `${on}已经交卷了，就等你 👀` : `${on}还没交卷`}</span></div>`;
    } else if (!q.result) {
      s += `<p class="gres">交卷啦！等${on}交卷就揭晓 ⏳</p>`;
    } else {
      const r = q.result, mine = q.mine, theirs = q.theirs;
      s += `<div class="qscore"><b>${r.score}</b><span>/10 默契</span><small>${r.same} 题你们选的一模一样</small></div>`;
      s += q.questions.map((it, i) => {
        const a = mine.self[i], b = theirs.self[i], ga = mine.guess[i], gb = theirs.guess[i];
        return `<div class="qz done"><p class="qa-q">${i + 1}. ${esc(it.q)}</p>
          <div class="qrev"><span>我：<b>${esc(it.opts[a])}</b></span><span>${on}猜我：${esc(it.opts[gb])} ${gb === a ? "✅" : "❌"}</span></div>
          <div class="qrev"><span>${on}：<b>${esc(it.opts[b])}</b></span><span>我猜${on}：${esc(it.opts[ga])} ${ga === b ? "✅" : "❌"}</span></div></div>`;
      }).join("");
    }
    const hist = (q.hist || []).slice(-7).reverse().filter((x) => x.day !== q.day);
    if (hist.length) s += `<div class="ghist"><p class="sub">最近几天</p>${hist.map((x) => `<div>${x.day.slice(5)} · 默契 ${x.score}/10 · 同款 ${x.same}</div>`).join("")}</div>`;
    el.innerHTML = s;
  }
  async function quizSubmit() {
    if (!quizDraft) return;
    try {
      const r = await gamesApi({ game: "quiz", op: "submit", self: quizDraft.self, guess: quizDraft.guess });
      games.quiz = r.quiz; quizDraft = null;
      if (r.result) { say(`💞 默契 ${r.result.score}/10！小岛 +${r.result.stars} ⭐`); burst(); loadWallet(); }
      else say(`交卷啦，等${otherName()}～`);
      sfx("chime"); renderGames(); syncGames3d();
    } catch (e) { say("没交上（" + e.message + "）"); }
  }

  // ---------------- 愿望券
  async function renderWish() {
    const el = $("#gbody"), list = games.wishes || [];
    let s = `<p class="sub">小游戏的赢家拿到一张愿望券：写下一个愿望（比如「周末陪我看一部电影」），输的人兑现以后点「已兑现」。</p>`;
    if (!list.length) s += `<p class="gres">还没有愿望券，去玩一局吧～</p>`;
    const rows = await Promise.all(list.map(async (w) => {
      const src = SRC[(w.source || "").split(":")[0]] || "小游戏", mineW = w.who === me;
      const head = `<small>🎟 ${src} · ${new Date(w.ts).toLocaleDateString()} · ${mineW ? "我赢的" : whoName(w.who) + "赢的"}</small>`;
      if (!w.wish) return `<div class="wish">${head}${mineW ? `<form class="wish-form" data-grant="${w.id}"><input maxlength="80" placeholder="写一个愿望给${otherName()}…" required><button type="submit">写好了</button></form>` : `<p class="sub">等${whoName(w.who)}写愿望…</p>`}</div>`;
      const text = await open(w.wish.box);
      return `<div class="wish ${w.done ? "done" : ""}">${head}<p class="wtext">「${esc(text)}」</p>${w.done ? `<p class="sub">✅ 已兑现</p>` : mineW ? `<p class="sub">等${otherName()}兑现 ⏳</p>` : `<button type="button" class="mini-btn" data-wishdone="${w.wish.id}">✓ 我兑现了</button>`}</div>`;
    }));
    el.innerHTML = s + rows.join("");
  }

  root.addEventListener("click", async (ev) => {
    const b = ev.target.closest("button");
    if (!b) return;
    if (b.dataset.gtab) { gameTab = b.dataset.gtab; renderGames(); return; }
    if (b.dataset.tl === "more") { loadOlder(); return; }
    if (b.dataset.tl === "toggle") { tlOpen = !tlOpen; renderTimeline(); return; }
    if (b.dataset.rps) {
      const k = b.dataset.rps;
      if (k === "challenge") { try { await gamesApi({ game: "rps", op: "challenge", stake: b.dataset.stake }); say(`✊ 约${otherName()}猜拳啦，三局两胜！`); sfx("chime"); await loadGames(); } catch (e) { say("没约上（" + e.message + "）"); } }
      else if (k === "pick") rpsPick(+b.dataset.r);
      else if (k === "quit") { if (!confirm("真的认输吗？")) return; try { await gamesApi({ game: "rps", op: "quit" }); await loadGames(); } catch (e) { say(e.message); } }
      return;
    }
    if (b.dataset.hunt) {
      const k = b.dataset.hunt;
      if (k === "hide") startHunt("hide");
      else if (k === "seek") startHunt("seek");
      else if (k === "stop") { stopHunt(); if (panel === "games") renderGames(); }
      else if (k === "confirm") confirmHide();
      else if (k === "look") { const h = games && games.hunt; if (h && h.x != null) { document.getElementById("scene").scrollIntoView({ behavior: "smooth", block: "center" }); window.NEST3D.huntLook(h.x, h.z); } }
      else if (k === "cancel") { try { await gamesApi({ game: "hunt", op: "cancel" }); await loadGames(); } catch (e) { say(e.message); } }
      return;
    }
    if (b.dataset.derby) {
      const k = b.dataset.derby;
      if (k === "challenge") { try { await gamesApi({ game: "derby", op: "challenge" }); say(`🎣 已经向${otherName()}发起钓鱼大赛！`); sfx("chime"); await loadGames(); } catch (e) { say("没发起成功（" + e.message + "）"); } }
      else if (k === "cast") derbyCast();
      else if (k === "quit") { if (!confirm("真的要认输吗？对方直接赢走愿望券哦")) return; try { await gamesApi({ game: "derby", op: "quit" }); await loadGames(); } catch (e) { say(e.message); } }
      return;
    }
    if (b.dataset.qz) {
      if (b.dataset.qz === "submit") { quizSubmit(); return; }
      quizDraft[b.dataset.qz][+b.dataset.i] = +b.dataset.j;
      renderQuiz();
      return;
    }
    if (b.dataset.wishdone) {
      try { await post({ kind: "wishdone", item: b.dataset.wishdone }); say("兑现啦 ✅"); sfx("chime"); await loadGames(); } catch (e) { say("没提交上 😢"); }
    }
  });
  root.addEventListener("submit", async (ev) => {
    const f = ev.target.closest(".wish-form");
    if (!f) return;
    ev.preventDefault();
    const text = f.querySelector("input").value.trim();
    if (!text) return;
    try { await post({ kind: "wish", item: f.dataset.grant, box: await seal(text) }); say("愿望写好啦 🎟"); sfx("chime"); await loadGames(); }
    catch { say("没写上，网络好像不太好 😢"); }
  });
  function gameCard(emoji, title, line1, line2) {
    const card = document.createElement("div");
    card.className = "catch-card r-epic";
    card.innerHTML = `<div class="cc-in"><div class="cc-emo">${emoji}</div><b>${esc(title)}</b><p class="gain" style="font-size:14px">${esc(line1)}</p>${line2 ? `<p class="bottle">${esc(line2)}</p>` : ""}<button>好耶</button></div>`;
    document.body.appendChild(card);
    card.addEventListener("click", (e) => { if (e.target.tagName === "BUTTON" || e.target === card) card.remove(); });
    setTimeout(() => card.remove(), 20000);
  }

  /* ------------------------------------------------------------ 实时连接（WebSocket）：走路、在线、新动态秒级同步；断了就靠 12 秒轮询兜底 */
  const RT = () => window.NEST_RT;
  const rtLive = () => !!(RT() && RT().connected);
  function isOnline(who) {
    if (rtLive() && RT().online) return !!RT().online[who];
    return !!(presence[who] && Date.now() - presence[who] < 3 * 60000);
  }
  let rtStarted = false;
  async function startRealtime() {
    const rt = RT();
    if (!rt || !API || !me || rtStarted) return; // 还没选身份就等选了再连
    rtStarted = true;
    rt.on("ev", () => poll());
    rt.on("pos", (m) => { if (m.who !== me && window.NEST3D && window.NEST3D.remoteWalk) window.NEST3D.remoteWalk(m.who, m.x, m.z); });
    rt.on("act", (m) => {
      if (m.who === me || !window.NEST3D) return;
      if (m.kind === "hit") { window.NEST3D.react("hit"); const p = headPos(); pow(p.x, p.y, (WEAPONS[m.item] || WEAPONS.fist).emoji); }
    });
    const onPresence = (m) => {
      const other = me === "her" ? "me" : "her";
      const was = !!(m.prev && m.prev[other]);
      render();
      if (m.online && m.online[other] && !was) say(`${other === "her" ? HER() : "他"}来岛上啦 👋`);
    };
    let last = {};
    rt.on("presence", (online) => { onPresence({ online, prev: last }); last = { ...(online || {}) }; });
    rt.on("welcome", (m) => { last = { ...(m.online || {}) }; render(); });
    rt.on("close", () => render());
    rt.connect({ url: API.replace(/^http/, "ws") + "/rt", token: await getToken(), who: me });
  }
  addEventListener("nest:walk", (ev) => { if (rtLive()) RT().sendPos(ev.detail.x, ev.detail.z); });

  /* ------------------------------------------------------------ boot：解锁后才开始 */
  async function start() {
    if (started || !(await key())) return;
    started = true;
    if (me === "me") { await checkPush(); if (pushState === "on") idbSet("herName", HER()).catch(() => {}); }
    render();
    loadWallet();
    addEventListener("nest:3dready", applyWallet);
    if (window.NEST3D && window.NEST3D.extrasReady) window.NEST3D.extrasReady.then(() => { applyWallet(); syncWorld(); });
    if (window.NEST3D && window.NEST3D.playReady) window.NEST3D.playReady.then(() => syncGames3d());
    addEventListener("nest:playready", () => syncGames3d());
    loadGames();
    loadWorld();
    setInterval(() => { if (!document.hidden) loadWorld(); }, 15 * 60000);
    startRealtime().catch(() => {});
    await poll(true);
    setInterval(() => { if (!document.hidden) poll(); }, 12000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) poll(); });
  }
  addEventListener("nest:update", start);
  if (window.NEST) start(); // 演示模式下页面可能已经先渲染好了
})();
