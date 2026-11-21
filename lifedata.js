// 小岛生活（v15）的游戏数据：背包里的东西、菜谱、宠物蛋、岛民、出海、突发事件、图鉴奖励。
// 纯数据，没有 import —— 网页和后端（worker/src/life.js）共用这一份；概率和奖励以后端为准。

// ---------------------------------------------------------------- 食材（鱼以外的东西）
// [名字, 图标, 分类]。分类用来配菜谱（菜谱里写 "#veg" 表示任意蔬菜）。
export const GOODS = {
  // 菜地
  tomato: ["小番茄", "🍅", "veg"], carrot: ["胡萝卜", "🥕", "veg"], pumpkin: ["南瓜", "🎃", "veg"],
  strawberry: ["草莓", "🍓", "fruit"], sunflower: ["葵花籽", "🌻", "grain"], tulip: ["郁金香", "🌷", "flower"], poinsettia: ["圣诞红", "🌺", "flower"],
  // 出海 / 岛民送的
  rice: ["大米", "🍚", "grain"], salt: ["海盐", "🧂", "spice"], kelp: ["海带", "🌿", "sea"], clam: ["花蛤", "🐚", "sea"],
  honey: ["蜂蜜", "🍯", "sweet"], milk: ["牛奶", "🥛", "dairy"],
  sakura: ["樱花瓣", "🌸", "flower"], matcha: ["抹茶粉", "🍵", "spice"],
  snowberry: ["雪莓", "🫐", "fruit"], chili: ["火山辣椒", "🌶️", "spice"], cocoa: ["可可豆", "🫘", "sweet"],
  // 突发事件
  starbit: ["星星碎片", "✨", "magic"], pearl: ["珍珠", "🫧", "magic"],
};
export const GOOD_TAGS = { veg: "蔬菜", fruit: "水果", grain: "谷物", flower: "花", sea: "海货", sweet: "甜的", dairy: "奶", spice: "调料", magic: "魔法材料", fish: "鱼", shell: "虾蟹贝" };

// ---------------------------------------------------------------- 菜谱
// in：2–3 个格子，每格是具体 id，或 "#分类"（"#fish" = 任意能吃的鱼，"#shell" = 虾蟹贝）。顺序无所谓。
// tag：给宠物蛋的"口味"（决定孵出什么）。q：好吃程度 1–3（出海补给、岛民的报酬会用到）。
export const RECIPES = {
  fish_soup: { name: "番茄鱼汤", emoji: "🍲", in: ["tomato", "#fish"], tag: "sea", q: 1 },
  salt_fish: { name: "盐烤鱼", emoji: "🐟", in: ["#fish", "salt"], tag: "sea", q: 1 },
  sushi: { name: "寿司", emoji: "🍣", in: ["rice", "#fish"], tag: "sea", q: 2 },
  kelp_soup: { name: "海带汤", emoji: "🥣", in: ["kelp", "salt"], tag: "sea", q: 1 },
  seafood_pot: { name: "海鲜锅", emoji: "🥘", in: ["#shell", "#shell", "kelp"], tag: "sea", q: 3 },
  fried_rice: { name: "虾仁炒饭", emoji: "🍛", in: ["rice", "#shell", "carrot"], tag: "sea", q: 2 },
  clam_soup: { name: "花蛤汤", emoji: "🍜", in: ["clam", "salt"], tag: "sea", q: 1 },
  salad: { name: "田园沙拉", emoji: "🥗", in: ["#veg", "#veg"], tag: "land", q: 1 },
  pumpkin_soup: { name: "南瓜浓汤", emoji: "🥣", in: ["pumpkin", "milk"], tag: "land", q: 2 },
  carrot_cake: { name: "胡萝卜蛋糕", emoji: "🍰", in: ["carrot", "milk", "honey"], tag: "land", q: 3 },
  onigiri: { name: "饭团", emoji: "🍙", in: ["rice", "salt"], tag: "land", q: 1 },
  fruit_bowl: { name: "水果捞", emoji: "🍧", in: ["#fruit", "#fruit"], tag: "sweet", q: 1 },
  strawberry_milk: { name: "草莓牛奶", emoji: "🥤", in: ["strawberry", "milk"], tag: "sweet", q: 2 },
  cookie: { name: "葵花籽饼干", emoji: "🍪", in: ["sunflower", "honey"], tag: "sweet", q: 2 },
  chocolate: { name: "手工巧克力", emoji: "🍫", in: ["cocoa", "honey"], tag: "sweet", q: 2 },
  hot_cocoa: { name: "热可可", emoji: "☕", in: ["cocoa", "milk"], tag: "sweet", q: 2 },
  flower_tea: { name: "花草茶", emoji: "🫖", in: ["#flower", "honey"], tag: "flower", q: 1 },
  sakura_mochi: { name: "樱花团子", emoji: "🍡", in: ["sakura", "rice"], tag: "flower", q: 2 },
  matcha_latte: { name: "抹茶拿铁", emoji: "🍵", in: ["matcha", "milk"], tag: "flower", q: 2 },
  snow_icecream: { name: "雪莓冰淇淋", emoji: "🍨", in: ["snowberry", "milk"], tag: "cold", q: 2 },
  snow_parfait: { name: "雪山芭菲", emoji: "🍨", in: ["snowberry", "#fruit", "honey"], tag: "cold", q: 3 },
  hotpot: { name: "火山麻辣锅", emoji: "🌶️", in: ["chili", "#fish", "#veg"], tag: "hot", q: 3 },
  spicy_shell: { name: "香辣小海鲜", emoji: "🦀", in: ["chili", "#shell"], tag: "hot", q: 2 },
  star_candy: { name: "星星糖", emoji: "🍬", in: ["starbit", "honey"], tag: "star", q: 2 },
  star_soup: { name: "星光汤", emoji: "💫", in: ["starbit", "#fish", "milk"], tag: "star", q: 3 },
  pearl_pudding: { name: "珍珠布丁", emoji: "🍮", in: ["pearl", "milk", "honey"], tag: "star", q: 3 },
  xmas_cookie: { name: "圣诞花饼干", emoji: "🎄", in: ["poinsettia", "sunflower"], tag: "flower", q: 2 },
};
export const DARK_DISH = { id: "dark", name: "黑暗料理", emoji: "🌑", tag: "dark", q: 0 };

// 用了水潭里的鱼做菜，额外带 "pond" 口味（孵六角恐龙）
// ---------------------------------------------------------------- 宠物蛋
// 喂 3 次菜就能孵；孵什么看喂过的口味里哪个最多（平手或没有 → 小黄鸭）。两个人都喂过，闪光概率翻倍。
export const EGG_FEEDS = 3, EGG_MIN_HOURS = 12, INCUBATOR_SLOTS = 2;
export const HATCH = { sea: "seal", land: "bunny", sweet: "hedgehog", flower: "fawn", cold: "arcticfox", hot: "salamander", star: "starpuff", pond: "axolotl", dark: "duckling" };
export const PETS = {
  seal: { name: "小海豹", emoji: "🦭" }, bunny: { name: "小兔", emoji: "🐰" }, hedgehog: { name: "小刺猬", emoji: "🦔" },
  fawn: { name: "小鹿", emoji: "🦌" }, arcticfox: { name: "北极狐", emoji: "🦊" }, salamander: { name: "小火蜥", emoji: "🦎" },
  starpuff: { name: "星星团子", emoji: "⭐" }, axolotl: { name: "六角恐龙", emoji: "🩷" }, duckling: { name: "小黄鸭", emoji: "🐥" },
};
export const SHINY_P = 0.05;
export const EGG_PATTERNS = ["speckle", "stripe", "heart", "star", "sea", "flower", "snow", "flame"];
export const PETS_ON_ISLAND = 6; // 岛上最多同时出来逛的宠物，其余在小屋里睡觉

// ---------------------------------------------------------------- 岛民来访
// 每天（北京时间）来 1–2 位（周末 2–3 位），各带一个请求。好感满 MOVE_IN 就搬到岛上住，之后每天往信箱里塞一样小礼物。
export const MOVE_IN = 5;
export const VISITORS = {
  gull: { name: "海鸥船长", likes: ["sea"], hi: ["哟！今天的风正好～", "我在海上漂了三天，馋死啦"], thanks: "好吃！下次出海我给你们带好东西", gift: ["kelp", "salt", "clam"] },
  tortoise: { name: "龟爷爷", likes: ["land"], hi: ["慢慢来，不着急…", "年纪大了，就想吃口热乎的"], thanks: "好孩子，好孩子", gift: ["rice", "honey"] },
  otter: { name: "水獭小哥", likes: ["sea", "fish"], hi: ["你们这儿的鱼看起来很肥嘛！", "我能摸摸你的鱼竿吗"], thanks: "嘿嘿，这个我要藏起来慢慢吃", gift: ["clam", "pearl"] },
  bear: { name: "熊妈妈", likes: ["sweet"], hi: ["家里的小熊想吃点甜的", "蜂蜜……有蜂蜜的味道吗？"], thanks: "小熊一定开心坏了", gift: ["honey", "milk"] },
  frog: { name: "青蛙诗人", likes: ["flower"], hi: ["呱，今天的云像一首诗", "我在找灵感…和点心"], thanks: "呱！我要为它写一首诗", gift: ["tulip", "sakura"] },
  squirrel: { name: "松鼠邮差", likes: ["sweet", "land"], hi: ["有你们的信～啊不对，我是来要吃的", "送了一上午信，饿扁了"], thanks: "下次的信我第一个送你们家！", gift: ["sunflower", "cocoa"] },
  piglet: { name: "小猪厨师", likes: ["hot", "sea"], hi: ["听说你们小屋的锅很好用？", "让我尝尝你们的手艺！"], thanks: "这火候…可以出师了！", gift: ["chili", "salt", "rice"] },
  owl: { name: "猫头鹰博士", likes: ["star", "cold"], hi: ["我在研究这片海的鱼类", "夜里的岛很安静，适合思考"], thanks: "很有研究价值，谢谢", gift: ["starbit", "snowberry"] },
};
// 请求种类：dish（某道菜，或某种口味的任意菜）/ fish（某种鱼，可能要求尺寸）/ goods（2 份某样食材）
export const VISIT_REWARD = { dish: [4, 7], fish: [3, 6], goods: [2, 4] };

// ---------------------------------------------------------------- 出海
// 每次带 1–3 道菜当补给（好吃程度加起来越高，带回的东西越多）。同一时间只有一条船在外面。
export const VOYAGE = {
  near: { name: "近海", emoji: "🌊", hours: 3, miles: 10, loot: ["kelp", "clam", "salt", "rice", "honey"], fish: [] },
  sakura: { name: "樱花岛", emoji: "🌸", hours: 6, miles: 20, unlock: 30, loot: ["sakura", "matcha", "rice", "honey", "strawberry"], fish: "far:sakura" },
  snow: { name: "雪岛", emoji: "❄️", hours: 6, miles: 20, unlock: 80, loot: ["milk", "snowberry", "honey"], fish: "far:snow" },
  volcano: { name: "火山岛", emoji: "🌋", hours: 6, miles: 25, unlock: 150, loot: ["chili", "cocoa", "salt"], fish: "far:volcano" },
};
export const VOYAGE_EGG_P = 0.15, VOYAGE_FISH_P = 0.4;

// ---------------------------------------------------------------- 突发事件
// 每天（北京时间）大约六成的日子会有一件，北京时间 9 点到 19 点之间开始，持续 14 小时（两边的白天都能碰上）。
export const EVENTS = {
  typhoon: { name: "台风来了", emoji: "🌀", w: 2, spots: 3, desc: "快把三处松动的地方加固好！两个人都动手有额外奖励" },
  parrot: { name: "偷东西的鹦鹉", emoji: "🦜", w: 2, hits: 5, desc: "它叼走了背包里的东西！点它 5 下让它还回来" },
  meteor: { name: "流星雨", emoji: "🌠", w: 2, per: 5, desc: "星星碎片掉在岛上了，每人能捡 5 颗" },
  lowtide: { name: "大退潮", emoji: "🐚", w: 2.5, per: 6, desc: "沙滩上露出好多贝壳，每人能捡 6 个" },
  whale: { name: "鲸鱼路过", emoji: "🐋", w: 1.5, desc: "一头大鲸鱼游到了码头边，摸摸它（每人一次）" },
};
export const EVENT_P = 0.6, EVENT_HOURS = 14;

// ---------------------------------------------------------------- 图鉴奖励（两个人一起凑）
export const BOOK_MILESTONES = [
  { n: 10, reward: { egg: "sea" }, text: "一颗海浪花纹的蛋" },
  { n: 20, reward: { aquarium: 1 }, text: "小屋里的水族箱" },
  { n: 30, reward: { stars: 20 }, text: "20 颗星星" },
  { n: 40, reward: { egg: "star" }, text: "一颗星星花纹的蛋" },
  { n: 50, reward: { stars: 50 }, text: "50 颗星星" },
  { n: 60, reward: { pet: "starpuff" }, text: "一只闪光的星星团子" },
];

// ---------------------------------------------------------------- 开局
export const STARTER = { bag: { rice: 3, salt: 3, milk: 2, honey: 2 }, eggs: ["speckle"] };
export const PHOTO_LIMITS = { thumb: 60000, full: 700000, perDay: 30 };
