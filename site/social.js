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
    qa: "每日一问 📝", tuck_me: "盖被子 🛏", tuck_her: "盖被子 🛏", harvest: "菜地收获 🧺", gacha: "扭蛋 🎰",
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
    const herOnline = me === "her" || (presence.her && Date.now() - presence.her < 3 * 60000);
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
    bits.push(s.asleep ? `😴 ${HER()}睡着了` : online ? `🟢 ${HER()}在岛上` : presence.her ? `${HER()} ${ago(new Date(presence.her).toISOString())}来过` : "");
    if (s.mood && !s.asleep) bits.push(`心情：${MOODS[s.mood][1]} ${MOODS[s.mood][0]}`);
    return bits.filter(Boolean).join(" · ") + st;
  }

  async function renderTimeline() {
    const recent = events.filter((e) => !["place", "move", "seed", "spend"].includes(e.kind) && !(e.kind === "farm" && (e.item || "").startsWith("useseed"))).slice(-15).reverse();
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
      return `<li class="${e.who === me ? "mine" : ""}"><span>${esc(t)}</span><time>${ago(new Date(e.ts).toISOString())}</time></li>`;
    }));
    $("#timeline").innerHTML = lines.filter(Boolean).join("") || `<li class="muted">还没有互动，${me === "her" ? "先喂它点好吃的吧" : `等${HER()}来玩`} ✨</li>`;
  }
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
  }

  async function poll(first) {
    if (fishingNow && !first) return; // 自己钓鱼时先别拉新动态，免得结果在揭晓前就剧透
    try {
      const r = await api("GET", null, "?since=" + lastId + "&who=" + (me || ""));
      const fresh = r.events || [];
      if (r.presence) presence = r.presence;
      if (!fresh.length) { render(); if (first) renderTimeline(); return; }
      events = events.concat(fresh);
      lastId = fresh[fresh.length - 1].id;
      if (fresh.some((e) => ["star", "buy", "place", "fish", "gacha", "farm", "wear", "move", "seed", "spend"].includes(e.kind))) await loadWallet();
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
  const PANELS = { earn: "#earn", shop: "#shop-wrap", book: "#book", gacha: "#gacha", farm: "#farm", wardrobe: "#wardrobe", qa: "#qa" };
  function openPanel(k) {
    panel = panel === k ? null : k;
    for (const [id, sel] of Object.entries(PANELS)) $(sel).hidden = id !== panel;
    document.querySelectorAll("[data-panel]").forEach((b) => b.classList.toggle("on", b.dataset.panel === panel));
    if (panel === "qa") loadQA();
    renderPanels();
  }
  root.addEventListener("click", async (ev) => {
    const b = ev.target.closest("button");
    if (!b) return;
    if (b.dataset.panel) { openPanel(b.dataset.panel); return; }
    if (b.dataset.who) { me = b.dataset.who; store.set(WHO_KEY, me); if (me === "me") await checkPush(); render(); renderTimeline(); return; }
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
      else say(herStatus(s, presence.her && Date.now() - presence.her < 3 * 60000) || `这是${HER()}的小猫 🐱`);
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
      <li>📝 每日一问两个人都答了 <b>+2</b> · 🛏 给对方盖被子 <b>+1</b> · 🧺 菜地收获 <b>+4～9</b> · 🎰 扭蛋偶尔出星星袋</li></ul>
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
    const otherOnline = presence[other] && Date.now() - presence[other] < 3 * 60000;
    R.setWorld({ mine: worldInfo[me], theirs: worldInfo[other], theirName: me === "her" ? "他" : HER(), bothOnline: !!otherOnline });
  }
  addEventListener("nest:tap", (ev) => {
    if (ev.detail.what === "gacha") { if (panel !== "gacha") openPanel("gacha"); say("扭蛋机：每天免费扭一次 🎰"); }
    if (ev.detail.what === "farm") { if (panel !== "farm") openPanel("farm"); say("菜地：记得每天浇水 💧"); }
    if (ev.detail.what === "xmas") { say(["圣诞快乐 🎄", "Merry Christmas ✨", "今年的圣诞树亮啦 🎄"][Math.floor(Math.random() * 3)]); hearts(ev.detail.x, ev.detail.y, 8); }
  });

  /* ------------------------------------------------------------ boot：解锁后才开始 */
  async function start() {
    if (started || !(await key())) return;
    started = true;
    if (me === "me") { await checkPush(); if (pushState === "on") idbSet("herName", HER()).catch(() => {}); }
    render();
    loadWallet();
    addEventListener("nest:3dready", applyWallet);
    if (window.NEST3D && window.NEST3D.extrasReady) window.NEST3D.extrasReady.then(() => { applyWallet(); syncWorld(); });
    loadWorld();
    setInterval(() => { if (!document.hidden) loadWorld(); }, 15 * 60000);
    await poll(true);
    setInterval(() => { if (!document.hidden) poll(); }, 12000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) poll(); });
  }
  addEventListener("nest:update", start);
  if (window.NEST) start(); // 演示模式下页面可能已经先渲染好了
})();
