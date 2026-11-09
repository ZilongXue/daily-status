// 岛上的"演员"：她的小猫 + 小马（她的角色），两只角色之间的互动编排，钓鱼，和海里游的鱼（图鉴里钓到过的）。
// scene3d.js 创建它并每帧调用 update；对外的接口挂在 window.NEST3D 上（见 scene3d.js 底部）。
import * as THREE from "three";
import { buildKitten, buildPony, ponyWalk, ponyIdle, setRiding } from "./her3d.js?v=9";
import { buildCatch, animateCatch as swim, buildRod, buildBobber, bobberIdle, bobberBite, buildSchoolFish, schoolTick } from "./fish3d.js?v=9";

const UP = new THREE.Vector3(0, 1, 0);
const RARITY_COL = { common: 0xffffff, rare: 0x6fc3ff, epic: 0xc28bff, legend: 0xffcf3f };
export const KITTEN_SCALE = 0.68;
const PONY_SCALE = 0.66;
const GAP = 0.64;   // 两只角色互动时的距离跟着角色一起缩
const SPEED = 0.72; // 走路速度也慢一点（腿短了）

export function createCast(ctx) {
  const { world, toon, outlined, tag, W, DOCK, SEA_Y, dino, textSprite, screenOf } = ctx;
  const setFocus = ctx.setFocus || (() => {}), clearFocus = ctx.clearFocus || (() => {});
  const lerp = (a, b, k) => a + (b - a) * k;
  const lerpAngle = (a, b, k) => { let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI; if (d < -Math.PI) d += Math.PI * 2; return a + d * k; };
  let T = 0; // 当前时间（秒），update 里更新

  /* ------------------------------------------------------------ 小猫 + 小马 */
  const kitten = buildKitten({ toon, outlined });
  kitten.root.scale.setScalar(KITTEN_SCALE);
  const pony = buildPony({ toon, outlined });
  pony.root.scale.setScalar(PONY_SCALE);
  tag(kitten.root, "her");
  tag(pony.root, "pony");
  world.add(kitten.root, pony.root);
  const HER_HOME = new THREE.Vector3(-0.45, 0, 1.6);
  const PONY_HOME = new THREE.Vector3(-1.8, 0, 0.5);
  kitten.root.position.copy(HER_HOME);
  pony.root.position.copy(PONY_HOME);

  // 演员：位置 / 目标 / 速度 / 朝向，move() 返回一个走到了才 resolve 的 promise
  const mkActor = (obj, speed) => ({ obj, target: obj.root.position.clone(), speed, face: null, walking: false, arrive: null });
  const her = mkActor(kitten, 1.7 * SPEED), horse = mkActor(pony, 1.3 * SPEED);
  function move(a, p, speed) {
    a.target.copy(p).setY(0);
    a.speedNow = speed ? speed * SPEED : a.speed;
    return new Promise((res) => { a.arrive = res; });
  }
  const wait = (s) => new Promise((res) => waits.push({ at: T + s, res }));
  const waits = [];

  // 心情气泡（emoji 精灵），挂在小猫头顶
  const MOOD_EMOJI = { happy: "😊", tired: "😮‍💨", miss: "🥺", angry: "😤", sleepy: "😪" };
  const moodSprite = textSprite("😊", "#000", 96);
  moodSprite.scale.setScalar(0.3);
  moodSprite.visible = false;
  world.add(moodSprite);
  const zz = [0, 1, 2].map(() => { const s = textSprite("Z", "#6f7ad6"); s.visible = false; world.add(s); return s; });
  const prop = textSprite("🩴", "#000", 96); // 手上拿的东西（武器 / 食物 / 花）
  prop.scale.setScalar(0.27); prop.visible = false;
  world.add(prop);
  const hearts = Array.from({ length: 8 }, () => { const s = textSprite("♥", "#ff6b8b"); s.visible = false; s.userData.t0 = -10; world.add(s); return s; });
  const stars = Array.from({ length: 10 }, () => { const s = textSprite("✦", "#ffc93c"); s.visible = false; s.userData.t0 = -10; world.add(s); return s; });
  function burst(list, at, n = 5, spread = 0.6) {
    let k = 0;
    for (const s of list) {
      if (T - s.userData.t0 < 1.3) continue;
      s.userData = { t0: T + k * 0.08, at: at.clone(), dx: (Math.random() - 0.5) * spread, dz: (Math.random() - 0.5) * spread };
      if (++k >= n) break;
    }
  }
  function setProp(emoji) {
    if (!emoji) { prop.visible = false; return; }
    const c = prop.material.map.image, g = c.getContext("2d");
    g.clearRect(0, 0, c.width, c.height);
    g.font = `${c.width * 0.8}px "Apple Color Emoji","Noto Color Emoji",sans-serif`;
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(emoji, c.width / 2, c.height / 2);
    prop.material.map.needsUpdate = true;
    prop.visible = true;
  }
  function setEmoji(sprite, emoji) {
    const c = sprite.material.map.image, g = c.getContext("2d");
    g.clearRect(0, 0, c.width, c.height);
    g.font = `${c.width * 0.8}px "Apple Color Emoji","Noto Color Emoji",sans-serif`;
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(emoji, c.width / 2, c.height / 2);
    sprite.material.map.needsUpdate = true;
  }

  /* ------------------------------------------------------------ 状态（social.js 喂进来） */
  const S = {
    online: false,     // 她在线（最近 3 分钟内打开过页面，或者她自己就是看的人）
    asleep: false,     // 她点了"我睡啦"还没点"我醒啦"
    mood: null,        // 最近 12 小时的心情
    riding: false,     // 骑在小马上
    busy: false,       // 正在演一段互动（这时不闲逛）
    pose: "stand",     // stand | sit | curl
  };
  let wanderAt = 3, manualUntil = 0;
  // 她自己点草地（或者实时同步过来）让小猫走过去；之后 20 秒内不自己乱逛
  function walkHer(p) {
    if (F.state !== "idle" && F.fisher === "her") return;
    if (S.busy) return;
    if (S.riding) seatKitten(false);
    her.face = null;
    her.target.copy(p).setY(0);
    her.speedNow = her.speed * 1.2;
    manualUntil = T + 20;
  }

  function seatKitten(on) {
    S.riding = on;
    if (on) {
      pony.saddle.add(kitten.root);
      kitten.root.position.set(0, 0, 0);
      kitten.root.rotation.set(0, 0, 0);
      kitten.root.scale.setScalar(1); // saddle 自带 0.75 的缩放
      setRiding(kitten, true);
    } else {
      const p = pony.saddle.getWorldPosition(new THREE.Vector3());
      world.worldToLocal(p);
      setRiding(kitten, false);
      world.add(kitten.root);
      kitten.root.position.set(p.x, 0, p.z).add(new THREE.Vector3(0.4, 0, 0.2));
      kitten.root.scale.setScalar(KITTEN_SCALE);
      her.target.copy(kitten.root.position);
    }
  }

  /* ------------------------------------------------------------ 互动编排 */
  // 走到某个演员面前：站在对方朝向我们这一侧、离开 gap 的地方
  const nearPoint = (from, to, gap) => {
    const d = new THREE.Vector3().subVectors(from, to).setY(0);
    if (d.lengthSq() < 1e-4) d.set(0, 0, 1);
    return to.clone().add(d.setLength(gap));
  };
  const dinoPos = () => dino.root().position.clone().setY(0);
  const herPos = () => (S.riding ? world.worldToLocal(pony.saddle.getWorldPosition(new THREE.Vector3())) : kitten.root.position.clone()).setY(0);
  let queue = Promise.resolve();
  function enqueue(fn) {
    queue = queue.then(async () => {
      S.busy = true;
      setFocus(() => herPos().add(dinoPos()).multiplyScalar(0.5).setY(0.4), 5.2);
      try { await fn(); } catch (e) { console.warn(e); }
      clearFocus();
      S.busy = false; wanderAt = T + 4;
      dino.face(null); her.face = null; // 演完各自转回镜头
    });
    return queue;
  }
  async function herGoToDino(gap = 1.05) {
    if (S.riding) { seatKitten(false); await wait(0.25); }
    S.pose = "stand";
    const p = nearPoint(kitten.root.position, dinoPos(), gap * GAP);
    her.face = null;
    await move(her, p, 2.4);
    her.face = () => dinoPos();
    dino.face(() => kitten.root.position);
  }
  async function dinoGoToHer(gap = 1.15) {
    const p = nearPoint(dinoPos(), herPos(), gap * GAP);
    await dino.go(p);
    dino.face(() => herPos());
    her.face = () => dinoPos();
  }
  const anim = { kind: "", t0: -10, dur: 0 }; // 小猫自己的小动作
  const kAnim = (kind, dur) => { anim.kind = kind; anim.t0 = T; anim.dur = dur; return wait(dur); };
  const headOf = (o) => o.head.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.28, 0));

  const PLAYS = {
    // 她 → 他
    async hit(item) {
      await herGoToDino(0.95);
      setProp(item || "👊");
      for (let i = 0; i < 3; i++) { await kAnim("swing", 0.32); dino.react("hit"); burst(stars, world.worldToLocal(headOf(dino.parts())), 3, 0.5); }
      setProp(null);
      await wait(0.4);
    },
    async feed(item) {
      setProp(item || "🍙");
      await herGoToDino(0.95);
      await kAnim("give", 0.5);
      setProp(null);
      dino.react("eat");
      await wait(1.4);
    },
    async hug() {
      await herGoToDino(0.62);
      dino.react("love");
      await kAnim("hug", 1.8);
      burst(hearts, world.worldToLocal(headOf(dino.parts())), 6, 0.8);
      await wait(0.4);
    },
    async pat() {
      await herGoToDino(0.75);
      await kAnim("pat", 1.4);
      dino.react("blush");
      burst(hearts, world.worldToLocal(headOf(dino.parts())), 3);
      await wait(0.4);
    },
    async kiss() {
      await herGoToDino(0.6);
      await kAnim("kiss", 0.9);
      dino.react("love");
      burst(hearts, world.worldToLocal(headOf(dino.parts())), 7, 0.9);
      await wait(0.8);
    },
    async highfive() {
      await herGoToDino(0.85);
      dino.react("wave");
      await kAnim("highfive", 0.8);
      burst(stars, world.worldToLocal(headOf(kitten)).add(new THREE.Vector3(0, -0.2, 0)), 6, 0.7);
      await wait(0.6);
    },
    async poke() {
      await herGoToDino(0.85);
      await kAnim("poke", 0.9);
      dino.react(dino.sleeping() ? "stir" : "jump");
      await wait(0.5);
    },
    async ride() { // 骑小马绕岛一圈
      if (!S.riding) {
        const sp = nearPoint(kitten.root.position, pony.root.position.clone().setY(0), 0.55 * GAP);
        await move(her, sp, 2.2);
        await kAnim("hop", 0.4);
        seatKitten(true);
      }
      const a0 = Math.atan2(pony.root.position.z, pony.root.position.x);
      for (let i = 1; i <= 12; i++) {
        const a = a0 + (i / 12) * Math.PI * 2;
        await move(horse, new THREE.Vector3(Math.cos(a) * 2.2, 0, Math.sin(a) * 2.2), 2.0);
      }
      await move(horse, PONY_HOME, 1.6);
      burst(hearts, world.worldToLocal(headOf(kitten)), 3);
      await wait(0.6);
      seatKitten(false);
    },
    // 他 → 她
    async me_pat() {
      await dinoGoToHer(0.95);
      dino.react("wave");
      await kAnim("blush", 1.4);
      burst(hearts, world.worldToLocal(headOf(kitten)), 4);
      await wait(0.4);
    },
    async me_hug() {
      await dinoGoToHer(0.7);
      dino.react("love");
      await kAnim("hug", 1.8);
      burst(hearts, world.worldToLocal(headOf(kitten)), 6, 0.8);
    },
    async me_kiss() {
      await dinoGoToHer(0.65);
      dino.react("love");
      await kAnim("blush", 1.2);
      burst(hearts, world.worldToLocal(headOf(kitten)), 7, 0.9);
    },
    async me_highfive() {
      await dinoGoToHer(0.9);
      dino.react("wave");
      await kAnim("highfive", 0.8);
      burst(stars, world.worldToLocal(headOf(kitten)), 6, 0.7);
    },
    async me_poke() {
      await dinoGoToHer(0.9);
      dino.react("jump");
      await kAnim(S.asleep ? "stir" : "startle", 0.9);
    },
    async me_ride() { await PLAYS.ride(); },
    async flower() { // 他送花：恐龙叼着花走过去
      await dinoGoToHer(1.0);
      await kAnim("blush", 1.2);
      burst(hearts, world.worldToLocal(headOf(kitten)), 5);
    },
    async tuck() { // 她给他盖被子：小猫跑到床边拍一拍
      await herGoToDino(0.8);
      await kAnim("pat", 1.3);
      dino.react(dino.sleeping() ? "stir" : "blush");
      burst(hearts, world.worldToLocal(headOf(dino.parts())), 5, 0.7);
      await wait(0.5);
    },
    async me_tuck() { // 他给她盖被子：恐龙走过去摸摸头
      await dinoGoToHer(0.9);
      dino.react("love");
      await kAnim("blush", 1.3);
      burst(hearts, world.worldToLocal(headOf(kitten)), 5, 0.7);
    },
    async sorry() { // 他认错：恐龙走过去鞠躬
      await dinoGoToHer(1.1);
      dino.react("bow");
      await wait(1.9);
    },
  };
  function play(kind, who, item) {
    const key = who === "me" && PLAYS["me_" + kind] ? "me_" + kind : kind;
    const fn = PLAYS[key];
    if (!fn) return Promise.resolve();
    return enqueue(() => fn(item));
  }

  /* ------------------------------------------------------------ 钓鱼 */
  const rod = buildRod({ toon, outlined });
  const bob = buildBobber({ toon, outlined });
  rod.root.visible = false;
  bob.root.visible = false;
  world.add(bob.root);
  const lineGeo = new THREE.BufferGeometry().setFromPoints(Array.from({ length: 12 }, () => new THREE.Vector3()));
  const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }));
  line.visible = false;
  line.frustumCulled = false;
  world.add(line);
  const glow = new THREE.PointLight(0xffffff, 0, 3.5, 1.5);
  world.add(glow);
  const beamMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.55, 3.2, 20, 1, true), beamMat);
  beam.visible = false;
  world.add(beam);
  const ROD_REST = 1.0;
  const F = { state: "idle", fisher: null, bobT: 0, caught: null, pull: null };
  let bobFrom = new THREE.Vector3(), bobTo = DOCK.bobber.clone();

  function holdRod(who) {
    const parts = who === "her" ? kitten : dino.parts();
    const arm = parts.arms[1];
    arm.add(rod.root);
    rod.root.position.set(0.02, -0.18, 0.1);
    rod.root.rotation.set(ROD_REST, 0, 0);
    rod.root.scale.setScalar(1 / (who === "her" ? KITTEN_SCALE : dino.scale()) * 0.95);
    rod.root.visible = true;
  }
  function dropRod() { rod.root.removeFromParent(); rod.root.visible = false; }

  // 返回 { reel() }：鱼咬钩以后调用 reel(result) 拉上来
  async function fish(whoReal, request) {
    if (F.state !== "idle") return null;
    // 他在床上睡着时，换小猫替他去钓
    const who = whoReal === "me" && dino.sleeping() ? "her" : whoReal;
    F.state = "walking";
    F.fisher = who;
    if (who === "her" && S.riding) seatKitten(false);
    const go = (p) => (who === "her" ? move(her, p, 2.4) : dino.go(p));
    const faceSea = () => DOCK.tip.clone().add(DOCK.dir);
    if (who === "her") her.face = null; else dino.face(null);
    // 先发请求（结果在服务器抽），同时走去码头
    const res = request();
    await go(DOCK.base);
    await go(DOCK.tip);
    if (who === "her") her.face = faceSea; else dino.face(faceSea);
    holdRod(who);
    await wait(0.3);
    // 甩竿
    F.state = "casting";
    F.castT = T;
    rod.tip.getWorldPosition(bobFrom); world.worldToLocal(bobFrom);
    bob.root.visible = true; line.visible = true;
    await wait(0.9);
    W.splash(bobTo, 0.6);
    F.state = "waiting";
    let result;
    try { result = await res; } catch (e) { result = { error: e.message || "失败" }; }
    if (result.error) {
      await wait(0.8);
      await endFishing(who);
      return result;
    }
    await wait(1.4 + Math.random() * 2.2);
    F.state = "bite";
    F.biteT = T;
    W.splash(bobTo, 1);
    dispatchEvent(new CustomEvent("nest:fish-bite", { detail: { ...screenOf(world.localToWorld(bobTo.clone())) } }));
    // 等"拉"：最多 2.2 秒，不拉也会自己拉上来（差点跑了）
    const pulled = await Promise.race([new Promise((r) => { F.pull = () => r(true); }), wait(2.2).then(() => false)]);
    F.pull = null;
    F.state = "reeling";
    F.reelT = T;
    const it = buildCatch(result.catch, { toon, outlined });
    F.caught = it;
    it.root.position.copy(bobTo);
    world.add(it.root);
    const col = RARITY_COL[result.rarity] || 0xffffff;
    glow.color.setHex(col); beamMat.color.setHex(col);
    W.splash(bobTo, 1.6);
    bob.root.visible = false;
    await wait(1.0);
    F.state = "reveal";
    F.revealT = T;
    if (result.rarity === "epic" || result.rarity === "legend") burst(stars, it.root.position.clone(), 10, 1.4);
    const at = screenOf(world.localToWorld(it.root.position.clone()));
    dispatchEvent(new CustomEvent("nest:fish-reveal", { detail: { ...result, quick: pulled, ...at } }));
    await wait(result.rarity === "legend" ? 3.4 : 2.6);
    // 鱼放回海里（以后在浅水区游）；其他东西"噗"一下收进背包
    F.state = "release";
    F.relT = T;
    await wait(0.9);
    world.remove(it.root);
    F.caught = null;
    addSwimmer(result.catch);
    await endFishing(who);
    return result;
  }
  async function endFishing(who) {
    line.visible = false; bob.root.visible = false;
    dropRod();
    glow.intensity = 0; beam.visible = false;
    F.state = "walking";
    if (who === "her") { her.face = null; await move(her, DOCK.base, 2.2); await move(her, HER_HOME, 1.8); }
    else { dino.face(null); await dino.go(DOCK.base); await dino.go(dino.home()); }
    F.state = "idle"; F.fisher = null;
  }
  function pull() { if (F.pull) { F.pull(); return true; } return false; }

  /* ------------------------------------------------------------ 浅水区游泳的鱼（钓到过的鱼都会在这里） */
  const swimmers = [];
  const FISHY = new Set(["crucian", "clown", "puffer", "shrimp", "koi", "jelly", "octopus", "whale", "turtle", "goldkoi"]);
  function addSwimmer(id) {
    if (!FISHY.has(id) || swimmers.filter((s) => s.id === id).length >= 2 || swimmers.length >= 14) return;
    const it = buildCatch(id, { toon, outlined });
    it.root.scale.setScalar(id === "whale" ? 1.6 : 1.1);
    it.root.traverse((o) => { o.raycast = () => {}; });
    world.add(it.root);
    swimmers.push({ id, it, r: 4.75 + Math.random() * 0.9, a: Math.random() * Math.PI * 2, sp: (0.12 + Math.random() * 0.1) * (Math.random() < 0.5 ? -1 : 1), y: id === "jelly" ? -0.12 : -0.2, ph: Math.random() * 6 });
  }
  function setBook(book) {
    for (const id of Object.keys(book || {})) {
      const have = swimmers.filter((s) => s.id === id).length;
      const want = Math.min(2, book[id]);
      for (let i = have; i < want; i++) addSwimmer(id);
    }
  }

  const schools = [0xffb27a, 0x8fd3ff, 0xffe17a].map((c, i) => {
    const g = new THREE.Group();
    for (let k = 0; k < 7; k++) {
      const f = buildSchoolFish(c);
      f.position.set((k % 3) * 0.18 - 0.2, -(k % 2) * 0.06, Math.floor(k / 3) * 0.16 - 0.15);
      f.raycast = () => {};
      g.add(f);
    }
    g.userData = { r: 5.6 + i * 0.6, a: i * 2.1, sp: (i % 2 ? -1 : 1) * (0.1 + i * 0.03) };
    world.add(g);
    return g;
  });

  /* ------------------------------------------------------------ 每帧 */
  const tmp = new THREE.Vector3();
  function stepActor(a, dt, root) {
    tmp.subVectors(a.target, root.position); tmp.y = 0;
    const d = tmp.length();
    a.walking = d > 0.04;
    if (a.walking) {
      root.position.addScaledVector(tmp.normalize(), Math.min(d, dt * (a.speedNow || a.speed)));
      root.rotation.y = lerpAngle(root.rotation.y, Math.atan2(tmp.x, tmp.z), 0.2);
    } else {
      if (a.arrive) { const r = a.arrive; a.arrive = null; r(); }
      const f = a.face && a.face();
      if (f) { tmp.subVectors(f, root.position); root.rotation.y = lerpAngle(root.rotation.y, Math.atan2(tmp.x, tmp.z), 0.12); }
    }
  }
  let blinkAt = 2;

  function update(t, dt, sky, cameraLocal) {
    T = t;
    for (let i = waits.length - 1; i >= 0; i--) if (t >= waits[i].at) { waits[i].res(); waits.splice(i, 1); }

    // ---- 闲逛：在线时小猫在家附近溜达，小马在草地上慢慢走
    if (!S.busy && F.state === "idle" && t > wanderAt && t > manualUntil) {
      wanderAt = t + 5 + Math.random() * 6;
      if (!S.asleep && !S.riding && S.online) {
        const a = Math.random() * Math.PI * 2, r = 0.3 + Math.random() * 0.8;
        her.target.copy(HER_HOME).add(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
        her.face = null;
      }
      if (!S.riding && !S.asleep && Math.random() < 0.6) {
        const a = Math.random() * Math.PI * 2, r = Math.random() * 0.7;
        horse.target.copy(PONY_HOME).add(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
      }
    }
    // 不在线 / 睡着：小猫趴在小马背上睡觉，小马在家待着
    const napping = (S.asleep || !S.online) && !S.busy && F.fisher !== "her" && T > manualUntil;
    if (napping && !S.riding) {
      if (kitten.root.parent === world && kitten.root.position.distanceTo(pony.root.position) > 0.7) {
        her.target.copy(nearPoint(kitten.root.position, pony.root.position.clone().setY(0), 0.5 * GAP));
        if (!her.walking && !her.arrive) { her.face = null; move(her, her.target, 1.6).then(() => { if ((S.asleep || !S.online) && !S.busy) seatKitten(true); }); }
      }
    }
    if (!napping && S.riding && !S.busy) seatKitten(false);
    if (napping && !S.busy) horse.target.copy(PONY_HOME);

    if (!S.riding) stepActor(her, dt, kitten.root);
    stepActor(horse, dt, pony.root);

    // ---- 小马
    if (horse.walking) ponyWalk(pony, t * (horse.speedNow > 1.5 ? 9 : 6), 1);
    else { ponyWalk(pony, 0, 0); ponyIdle(pony, t); }
    pony.root.position.y = 0;

    // ---- 小猫的身体
    const K = kitten, since = t - anim.t0, act = since < anim.dur ? anim.kind : "";
    const sleepy = S.riding && napping;
    let y = 0, sx = 1, sy = 1, rx = 0, rz = 0, ry = 0;
    if (her.walking && !S.riding) { y = Math.abs(Math.sin(t * 12)) * 0.12; rz = Math.sin(t * 12) * 0.08; }
    else if (sleepy) { const b = Math.sin(t * 1.5) * 0.5 + 0.5; sy = 0.95 + b * 0.04; rx = 0.35; }
    else if (S.mood === "happy") { const p = (t * 1.2) % 1; y = Math.max(0, Math.sin(p * Math.PI)) * 0.25; }
    else if (S.mood === "tired" || S.mood === "sleepy") { rx = 0.12; sy = 0.95 + Math.sin(t * 1.4) * 0.02; }
    else if (S.mood === "angry") { const b = Math.sin(t * 9) * 0.5 + 0.5; sx = 1.05 + b * 0.03; sy = 0.97; }
    else { rz = Math.sin(t * 1.7) * 0.05; sy = 1 + Math.sin(t * 3.4) * 0.015; }
    if (act === "swing") { const k = since / anim.dur; rx -= Math.sin(k * Math.PI) * 0.35; y += 0.05; }
    if (act === "hug") { rx += 0.25; sx *= 1.04; }
    if (act === "kiss") { y += Math.sin(Math.min(1, since / 0.5) * Math.PI) * 0.35; rx += 0.2; }
    if (act === "hop") { y += Math.sin(since / anim.dur * Math.PI) * 0.5; }
    if (act === "highfive") { y += Math.sin(Math.min(1, since / 0.4) * Math.PI) * 0.3; }
    if (act === "blush") { rz += Math.sin(since * 10) * 0.08; }
    if (act === "startle") { y += Math.sin(Math.min(1, since / 0.4) * Math.PI) * 0.4; sy *= 1.05; }
    if (act === "stir") { sy *= 1 + Math.sin(since * 12) * 0.04; }
    if (act === "give") { rx += 0.15; }
    K.body.position.y = y;
    K.body.scale.set(sx, sy, sx);
    K.body.rotation.set(rx, ry, rz);
    if (S.riding && horse.walking) K.body.position.y += Math.abs(Math.sin(t * 9)) * 0.04;

    // 手
    K.arms.forEach((a, i) => {
      const s = i ? 1 : -1, base = s * 0.25;
      let z = base, x = 0;
      if (act === "swing" && i === 1) { z = 2.2 - Math.sin(since / anim.dur * Math.PI) * 1.6; }
      else if (act === "pat" && i === 1) { z = 2.5; x = -0.5 + Math.sin(since * 16) * 0.25; }
      else if (act === "hug") { z = s * 1.3; x = -0.9; }
      else if (act === "highfive" && i === 1) { z = 2.6; }
      else if (act === "give" || (act === "kiss" && i === 1)) { z = s * 0.6; x = -1.2; }
      else if (act === "poke" && i === 1) { z = 0.8; x = -1.3 + Math.sin(since * 20) * 0.2; }
      else if (F.fisher === "her" && i === 1 && F.state !== "walking") { z = 0.5; x = -0.6; }
      else if (S.mood === "happy" && !sleepy) { z = base + s * (0.25 + Math.sin(t * 7 + i) * 0.2); }
      if (S.riding && !act) return;
      a.rotation.z = lerp(a.rotation.z, z, 0.3);
      a.rotation.x = lerp(a.rotation.x, x, 0.3);
    });
    // 头：看镜头，偶尔歪头；想你的时候看恐龙
    let yawT = Math.sin(t * 0.45) * 0.2;
    if (S.mood === "miss" && !S.busy) {
      const lp = K.body.worldToLocal(dino.root().getWorldPosition(new THREE.Vector3()));
      yawT = Math.max(-0.8, Math.min(0.8, Math.atan2(lp.x, lp.z)));
    }
    K.head.rotation.y = lerp(K.head.rotation.y, sleepy ? 0 : yawT, 0.1);
    K.head.rotation.z = S.mood === "miss" ? 0.18 : Math.sin(t * 0.8) * 0.06;
    K.head.rotation.x = sleepy ? 0.25 : 0;
    // 表情
    let eyes = "open";
    if (sleepy) eyes = "sleep";
    else if (act === "hug" || act === "kiss" || act === "blush" || act === "pat" || S.mood === "happy") eyes = "happy";
    else if (act === "startle" || act === "swing") eyes = "wide";
    else if (S.mood === "tired" || S.mood === "sleepy" || S.mood === "angry") eyes = "half";
    if (!sleepy && eyes === "open" && t > blinkAt) { eyes = "sleep"; if (t > blinkAt + 0.13) blinkAt = t + 2 + Math.random() * 3; }
    K.setEyes(eyes);
    if (K.blushMat) K.blushMat.opacity = act === "blush" || act === "hug" || act === "kiss" || S.mood === "miss" ? 0.95 : 0.5;
    if (K.tail) K.tail.rotation.y = Math.sin(t * (S.mood === "happy" ? 6 : 2)) * (sleepy ? 0.1 : 0.35);
    if (K.sweat) K.sweat.visible = S.mood === "tired" && !sleepy;
    if (K.cap) K.cap.visible = false;
    if (K.bubble) K.bubble.visible = sleepy && S.asleep;
    if (K.bubble && K.bubble.visible) K.bubble.scale.setScalar(0.4 + Math.sin(((t * 0.45) % 1) * Math.PI) * 1.1);
    if (K.yawn) K.yawn.visible = S.mood === "sleepy" && !sleepy && Math.sin(t * 0.6) > 0.9;

    // ---- 头顶：心情 / Zzz / 手上的东西
    const hh = world.worldToLocal(headOf(K));
    moodSprite.visible = !!S.mood && !sleepy && !S.busy;
    if (moodSprite.visible) moodSprite.position.set(hh.x + 0.2, hh.y + 0.15 + Math.sin(t * 2) * 0.04, hh.z);
    zz.forEach((s, i) => {
      s.visible = sleepy;
      if (!sleepy) return;
      const p = (t * 0.3 + i / 3) % 1;
      s.position.set(hh.x + 0.13 + p * 0.33, hh.y + p * 0.6, hh.z);
      s.material.opacity = Math.sin(p * Math.PI) * (S.asleep ? 1 : 0.6);
      s.scale.setScalar(0.12 + p * 0.13);
    });
    if (prop.visible) {
      const hand = K.arms[1].getWorldPosition(new THREE.Vector3());
      world.worldToLocal(hand);
      prop.position.set(hand.x, hand.y + 0.2, hand.z);
    }
    for (const list of [hearts, stars]) for (const s of list) {
      const p = (t - s.userData.t0) / 1.3;
      s.visible = p >= 0 && p < 1 && !!s.userData.at;
      if (!s.visible) continue;
      s.position.set(s.userData.at.x + s.userData.dx * 0.65 * (0.5 + p), s.userData.at.y + p * 0.65, s.userData.at.z + s.userData.dz * 0.65 * (0.5 + p));
      s.material.opacity = Math.sin(p * Math.PI);
      s.scale.setScalar(0.14 + p * 0.1);
    }

    // ---- 钓鱼
    if (F.state !== "idle" && F.state !== "walking") {
      const tip = rod.tip.getWorldPosition(new THREE.Vector3()); world.worldToLocal(tip);
      if (F.state === "casting") {
        const k = Math.min(1, (t - F.castT) / 0.9);
        rod.root.rotation.x = ROD_REST - Math.sin(k * Math.PI) * 1.4;
        bob.root.position.lerpVectors(bobFrom, bobTo, k);
        bob.root.position.y = lerp(bobFrom.y, SEA_Y, k) + Math.sin(k * Math.PI) * 1.4;
      } else if (F.state === "waiting") { bob.root.position.copy(bobTo); bobberIdle(bob, t); rod.root.rotation.x = ROD_REST + Math.sin(t * 1.3) * 0.03; }
      else if (F.state === "bite") { bob.root.position.copy(bobTo); bobberBite(bob, t - F.biteT); rod.root.rotation.x = ROD_REST + 0.15 + Math.sin(t * 25) * 0.08; }
      else if (F.state === "reeling" && F.caught) {
        const k = Math.min(1, (t - F.reelT) / 1.0);
        rod.root.rotation.x = ROD_REST - Math.sin(k * Math.PI * 0.5) * 0.9;
        const dst = hh.clone().add(new THREE.Vector3(0, 0.9, 0)).lerp(DOCK.tip.clone().add(DOCK.dir.clone().multiplyScalar(0.6)).setY(1.6), 0.4);
        F.caught.root.position.lerpVectors(bobTo, dst, k * k * (3 - 2 * k));
        F.caught.root.position.y += Math.sin(k * Math.PI) * 1.2;
        F.caught.root.rotation.y = t * 6;
        swim(F.caught, t, 3);
        glow.position.copy(F.caught.root.position); glow.intensity = 3 * k;
      } else if ((F.state === "reveal" || F.state === "release") && F.caught) {
        const c = F.caught.root;
        if (F.state === "reveal") {
          c.position.y += Math.sin(t * 2.5) * 0.002;
          c.rotation.y = lerpAngle(c.rotation.y % (Math.PI * 2), Math.atan2(cameraLocal.x - c.position.x, cameraLocal.z - c.position.z), 0.08); // 侧面朝镜头
          const k = Math.min(1, (t - F.revealT) / 0.6);
          c.scale.setScalar(1 + Math.sin(k * Math.PI) * 0.4 + 0.3 * k);
          if (F.caught.openLid) F.caught.openLid(Math.min(1, (t - F.revealT) / 0.8));
          if (F.caught.puff) F.caught.puff(Math.min(1, (t - F.revealT) / 0.5));
          beam.visible = true;
          beam.position.set(c.position.x, c.position.y - 0.4, c.position.z);
          beamMat.opacity = 0.35 * k;
          swim(F.caught, t, 1.5);
        } else {
          const k = Math.min(1, (t - F.relT) / 0.9);
          c.position.lerp(bobTo.clone().setY(SEA_Y - 0.3), k * 0.25);
          c.scale.setScalar(Math.max(0.01, 1.3 * (1 - k)));
          beamMat.opacity = 0.35 * (1 - k);
          glow.intensity = 3 * (1 - k);
          if (k >= 1) W.splash(bobTo, 1);
        }
        glow.position.copy(c.position);
      }
      // 鱼线：竿尖垂到浮漂，中间往下坠
      const end = F.caught && F.state !== "reveal" && F.state !== "release" ? F.caught.root.position : world.worldToLocal(bob.top.getWorldPosition(new THREE.Vector3()));
      const pts = lineGeo.attributes.position;
      for (let i = 0; i < 12; i++) {
        const k = i / 11;
        const sag = F.state === "casting" ? 0 : Math.sin(k * Math.PI) * 0.35;
        pts.setXYZ(i, lerp(tip.x, end.x, k), lerp(tip.y, end.y, k) - sag, lerp(tip.z, end.z, k));
      }
      pts.needsUpdate = true;
      line.visible = F.state !== "reveal" && F.state !== "release";
    }

    // ---- 浅水区的鱼
    schoolTick(t);
    for (const g of schools) {
      const u = g.userData; u.a += u.sp * dt;
      g.position.set(Math.cos(u.a) * u.r, SEA_Y - 0.22 + Math.sin(t + u.r) * 0.03, Math.sin(u.a) * u.r);
      g.rotation.y = -(u.a + Math.sign(u.sp) * Math.PI / 2);
    }
    for (const s of swimmers) {
      s.a += s.sp * dt;
      const x = Math.cos(s.a) * s.r, z = Math.sin(s.a) * s.r;
      s.it.root.position.set(x, SEA_Y + s.y + Math.sin(t * 1.2 + s.ph) * 0.04, z);
      // 鱼头朝 +x：转到沿切线方向游
      const dir = Math.sign(s.sp);
      s.it.root.rotation.y = -(s.a + dir * Math.PI / 2);
      swim(s.it, t + s.ph, 1);
    }
  }

  function setState(next) {
    if ("online" in next) S.online = next.online;
    if ("asleep" in next) S.asleep = next.asleep;
    if ("mood" in next) {
      S.mood = next.mood || null;
      if (S.mood) setEmoji(moodSprite, MOOD_EMOJI[S.mood] || "💭");
    }
  }

  return {
    update, play, setState, fish, pull, setBook, walkHer,
    fishing: () => F.state !== "idle",
    kittenScreen: () => screenOf(world.localToWorld(world.worldToLocal(headOf(kitten)))),
    kitten, pony,
  };
}
