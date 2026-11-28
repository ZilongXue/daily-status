// 钓鱼大赛 2.0（v17）的规则数据：网页和后端（worker/src/games.js）共用一份。
// 一场比赛：每人 5 竿，可以选码头 / 水潭，挂鱼饵；咬钩后玩收线小游戏（收得好鱼更大）；
// 5 条鱼最后按组合加分；每人 2 次"放生再来"；两个人一起把鱼王的体力打空，它浮上来以后谁先钓上来谁拿大奖。
// （不 import fishdata.js：网页那边带 ?v= 版本号，后端不带，两边各自把 FISH 传进来）

export const DERBY = {
  casts: 5, ttlH: 24, releases: 2,
  kingHp: [160, 220], kingBonus: 120, kingStars: 5, kingRegen: 0.3, // 鱼王跑掉后恢复 30% 体力
  pts: { common: 10, rare: 25, epic: 60, legend: 150 }, junkPts: 3,
};

// 鱼饵：背包里做好的菜按口味变成不同的饵；每场比赛每人还送一张随机的
export const BAITS = {
  sea: { name: "海鲜饵", emoji: "🦐", desc: "稀有以上的鱼更容易上钩（×2）" },
  star: { name: "星光饵", emoji: "✨", desc: "史诗 ×2、传说 ×4 容易上钩" },
  sweet: { name: "甜甜饵", emoji: "🍯", desc: "收线时绿条更宽，钓上来的鱼更大" },
  double: { name: "双钩饵", emoji: "🪝", desc: "一竿钓两条，每条分数 ×0.6（组合算两条）" },
  dark: { name: "神秘饵", emoji: "🌀", desc: "所有鱼一样容易上钩：可能是传说，也可能是靴子" },
};
export const TAG_BAIT = { sea: "sea", pond: "sea", star: "star", sweet: "sweet", flower: "sweet", land: "double", hot: "double", cold: "double", dark: "dark" };
export const FREE_BAITS = [["sea", 4], ["sweet", 4], ["double", 3], ["star", 1.5], ["dark", 1.5]];

// 鱼王：比赛开始时定一条，体力两个人共享
export const KINGS = ["goldkoi", "rainbow", "moonfish", "phoenix"];

// 收线小游戏的手感参数在 reel.js 里（只有网页用）

// 组合（同一类里只算最高的那个，比如三连就不再算对子）
export const COMBOS = [
  { id: "trips", group: "same", name: "三连", emoji: "🎰", pts: 45, desc: "同一种鱼钓到 3 条" },
  { id: "pair", group: "same", name: "对子", emoji: "👯", pts: 15, desc: "同一种鱼钓到 2 条" },
  { id: "rainbow4", group: "rar", name: "彩虹全家福", emoji: "🌈", pts: 100, desc: "普通、稀有、史诗、传说各一条" },
  { id: "rainbow3", group: "rar", name: "三色", emoji: "🎨", pts: 20, desc: "凑齐 3 种稀有度" },
  { id: "rare3", name: "好运连连", emoji: "💎", pts: 35, desc: "3 条稀有及以上" },
  { id: "spots", name: "两头跑", emoji: "🏞", pts: 25, desc: "码头、水潭各钓到 2 条" },
  { id: "big3", name: "大个子", emoji: "📏", pts: 30, desc: "3 条比平常大 20% 以上" },
  { id: "perfect3", name: "收线大师", emoji: "🎯", pts: 30, desc: "3 次完美收线（鱼一直在绿条里）" },
  { id: "shell3", name: "海鲜大餐", emoji: "🦀", pts: 30, desc: "3 条贝壳 / 甲壳类" },
  { id: "junk2", name: "破烂王", emoji: "👢", pts: 15, desc: "钓上 2 件不是鱼的东西" },
];

// 一个人钓到的所有鱼（双钩一竿算两条）→ 达成的组合 + 每个组合还差多少（给面板提示用）
export function fishOf(casts) {
  const out = [];
  (casts || []).forEach((c, i) => {
    if (c.fish) out.push(...c.fish.map((x) => ({ ...x, cast: i })));
    else if (c.f) out.push({ f: c.f, rarity: c.rarity, cm: c.cm, spot: c.spot || "sea", perfect: false, big: false, cast: i });
  });
  return out;
}
export function combosOf(casts, FISH) {
  const fish = fishOf(casts);
  const count = (pred) => fish.filter(pred).length;
  const same = Math.max(0, ...Object.values(fish.reduce((m, x) => ((m[x.f] = (m[x.f] || 0) + 1), m), {})));
  const rars = new Set(fish.map((x) => x.rarity)).size;
  const prog = {
    trips: [same, 3], pair: [same, 2], rainbow4: [rars, 4], rainbow3: [rars, 3],
    rare3: [count((x) => x.rarity !== "common"), 3],
    spots: [Math.min(count((x) => x.spot === "sea"), count((x) => x.spot === "pool")), 2],
    big3: [count((x) => x.big), 3], perfect3: [new Set(fish.filter((x) => x.perfect).map((x) => x.cast)).size, 3],
    shell3: [count((x) => FISH[x.f] && FISH[x.f].food === "shell"), 3], junk2: [count((x) => FISH[x.f] && FISH[x.f].kind === "item"), 2],
  };
  const got = [], seen = new Set();
  for (const c of COMBOS) {
    const [n, need] = prog[c.id];
    if (n >= need && !(c.group && seen.has(c.group))) { got.push(c.id); if (c.group) seen.add(c.group); }
  }
  return { got, bonus: got.reduce((a, id) => a + COMBOS.find((c) => c.id === id).pts, 0), prog };
}
