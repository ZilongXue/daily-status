// 小游戏在 3D 场景里的部分：藏宝（挖坑、小旗、宝箱）、钓鱼大赛的计分牌、奖杯、默契罐。
// 模型在 games3d.js；这里负责摆放、走过去挖、和服务器状态同步。
import * as THREE from "three";
import { buildChest, buildDigMound, buildShovel, buildTrophy, buildScoreboard, buildHeartJar, buildHideMarker } from "./games3d.js?v=14";

const FISH_NAME = { crucian: ["鲫鱼", "🐟"], clown: ["小丑鱼", "🐠"], puffer: ["河豚", "🐡"], shrimp: ["小虾", "🦐"], koi: ["锦鲤", "🎏"], jelly: ["水母", "🪼"], octopus: ["章鱼", "🐙"], turtle: ["海龟", "🐢"] };
const BAND_TEXT = { hot: "🔥 超烫！", warm: "♨️ 有点暖", cool: "🌬 有点凉", cold: "❄️ 好冷…", found: "💰 挖到啦！" };
const RECENT = 3 * 3600000; // 结束 3 小时内还留着土堆 / 宝箱

export function createPlay(ctx) {
  const { world, toon, outlined, W, cast, dino, setFocus, clearFocus } = ctx;
  let names = { me: "他", her: "她" };
  const M = { toon, outlined };
  const UP = new THREE.Vector3(0, 1, 0);
  const groundY = (x, z) => Math.max(0, W.heightAt(x, z));
  let T = 0;
  const waits = [];
  const wait = (s) => new Promise((res) => waits.push({ at: T + s, res }));

  /* ------------------------------------------------------------ 藏宝 */
  const mounds = new Map(); // key "x,z" → mound
  const huntGroup = new THREE.Group();
  world.add(huntGroup);
  const chest = buildChest(M);
  chest.root.visible = false;
  huntGroup.add(chest.root);
  const marker = buildHideMarker(M);
  marker.root.visible = false;
  marker.root.scale.setScalar(1.7);
  marker.root.traverse((o) => { if (o.material) { o.material.depthTest = false; o.renderOrder = 6; } }); // 透过草也看得见（只有藏宝的人看得到）
  huntGroup.add(marker.root);
  // 结束后"宝藏原来在这"：一根从天上照下来的金色光柱 + 地上一圈大的 X + 一直挂着的牌子。
  // 透过草和树也看得见（不做深度测试），转到哪个角度都一眼能找到。
  const spot = new THREE.Group();
  spot.visible = false;
  spot.userData.dynamic = true;
  spot.name = "huntSpot";
  {
    const beamGeo = new THREE.CylinderGeometry(0.2, 0.34, 3.2, 20, 1, true).translate(0, 1.6, 0);
    const beamMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      uniforms: { uT: { value: 0 }, uC: { value: new THREE.Color(0xffd36b) } },
      vertexShader: "varying float vY; void main(){ vY = position.y / 3.2; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }",
      fragmentShader: "varying float vY; uniform float uT; uniform vec3 uC; void main(){ float a = (1.0 - vY) * (0.55 + 0.15 * sin(uT * 3.0 - vY * 9.0)); gl_FragColor = vec4(uC * a, a); }",
    });
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.renderOrder = 7;
    beam.raycast = () => {};
    spot.add(beam);
    spot.userData.beam = beamMat;
  }
  const spotMark = buildHideMarker(M);
  spotMark.root.scale.setScalar(2.4);
  spotMark.root.traverse((o) => { if (o.material) { o.material.depthTest = false; o.material.color && o.material.color.offsetHSL(0.12, 0.1, 0); o.renderOrder = 6; } });
  spot.add(spotMark.root);
  let spotLabel = null;
  huntGroup.add(spot);
  function showSpot(x, z, text) {
    spot.position.set(x, groundY(x, z) + 0.01, z);
    if (!spotLabel || spotLabel.userData.text !== text) {
      if (spotLabel) { spot.remove(spotLabel); spotLabel.material.map.dispose(); spotLabel.material.dispose(); }
      spotLabel = labelSprite(text, "#c47a00");
      spotLabel.userData.text = text;
      spotLabel.position.y = 1.15;
      spotLabel.scale.set(1.9, 0.475, 1);
      spotLabel.raycast = () => {};
      spot.add(spotLabel);
    }
    spot.visible = true;
  }
  const hideSpot = () => { spot.visible = false; };

  const shovel = buildShovel(M);
  shovel.root.visible = false;
  const bubbles = [];
  let chestAnim = null; // { t0, from, to, open }

  // 一整句话的气泡（白底圆角）
  function setLabel(sp, emoji) {
    const c = sp.material.map.image, g = c.getContext("2d");
    g.clearRect(0, 0, c.width, c.height);
    g.fillStyle = "rgba(255,255,255,0.95)"; g.beginPath(); g.arc(64, 64, 58, 0, Math.PI * 2); g.fill();
    g.font = "72px 'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji',sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(emoji, 64, 70);
    sp.material.map.needsUpdate = true;
  }
  function labelSprite(text, color, round) {
    const c = document.createElement("canvas");
    if (round) { // 圆形的 emoji 牌子（猜拳的手势）
      c.width = c.height = 128;
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, depthTest: false }));
      sp.scale.set(0.55, 0.55, 1);
      sp.renderOrder = 11;
      setLabel(sp, text);
      return sp;
    }
    c.width = 512; c.height = 128;
    const g = c.getContext("2d");
    g.font = "800 56px 'PingFang SC','Hiragino Sans GB','Microsoft YaHei',system-ui,sans-serif";
    const w = Math.min(500, g.measureText(text).width + 56);
    g.fillStyle = "rgba(255,255,255,0.94)";
    g.beginPath(); g.roundRect((512 - w) / 2, 14, w, 100, 50); g.fill();
    g.fillStyle = color; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(text, 256, 66);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, depthTest: false }));
    s.scale.set(2.4, 0.6, 1);
    s.renderOrder = 10;
    return s;
  }
  function bubble(text, at, color = "#5a4636") {
    const s = labelSprite(text, color);
    s.position.copy(at).add(new THREE.Vector3(0, 0.85, 0));
    s.userData.t0 = T;
    s.raycast = () => {};
    world.add(s);
    bubbles.push(s);
  }

  function addMound(d, pop) {
    const key = d.x + "," + d.z;
    let m = mounds.get(key);
    if (!m) {
      m = buildDigMound(M);
      m.root.position.set(d.x, groundY(d.x, d.z), d.z);
      m.root.rotation.y = (d.x * 7 + d.z * 13) % (Math.PI * 2);
      huntGroup.add(m.root);
      mounds.set(key, m);
      if (pop) m.pop(T);
    }
    m.setBand(d.band);
    return m;
  }
  function clearMounds() { for (const m of mounds.values()) huntGroup.remove(m.root); mounds.clear(); }

  // 角色走到坑边、拿铲子挖几下。who = "me"（恐龙）/ "her"（小猫）
  const actorOf = (who) => (who === "her"
    ? { parts: () => cast.kitten, root: () => cast.kitten.root, go: (p) => cast.herGo(p), face: (fn) => cast.herFace(fn), scale: cast.kittenScale }
    : { parts: () => dino.parts(), root: () => dino.root(), go: (p) => dino.go(p), face: (fn) => dino.face(fn), scale: dino.scale() });
  let digging = null; // { arm, t0, dur }
  async function digAt(who, x, z) {
    const a = actorOf(who);
    const hole = new THREE.Vector3(x, 0, z);
    const from = a.root().position.clone().setY(0);
    const dir = from.clone().sub(hole);
    if (dir.lengthSq() < 1e-4) dir.set(0, 0, 1);
    const stand = hole.clone().add(dir.setLength(0.38));
    a.face(null);
    await Promise.race([a.go(stand), wait(6)]);
    a.face(() => hole.clone());
    const arm = a.parts().arms[1];
    arm.add(shovel.root);
    shovel.root.position.set(0.02, -0.16, 0.06);
    shovel.root.scale.setScalar(1 / a.scale);
    shovel.root.visible = true;
    digging = { arm, t0: T, dur: 1.4 };
    await wait(1.4);
    digging = null;
    shovel.root.removeFromParent();
    shovel.root.visible = false;
    arm.rotation.x = 0;
    a.face(null);
  }

  // 宝箱从坑里升起来、打开
  async function revealChest(x, z, { found = true } = {}) {
    chest.root.visible = true;
    const y = groundY(x, z);
    chest.root.position.set(x, y - 0.5, z);
    chest.setOpen(0);
    chestAnim = { t0: T, y0: y - 0.5, y1: y + 0.02 };
    if (!found) showSpot(x, z, "🎁 宝藏藏在这里");
    // 没挖到：镜头拉远一点，让光柱和挖过的坑都在画面里，停久一点
    setFocus(() => world.localToWorld(new THREE.Vector3(x, y + 0.3, z)), found ? 4.8 : 6.5, found ? 6 : 8);
    await wait(1.1);
    chestAnim.open = T;
    bubble(found ? "💰 挖到宝藏啦！" : "差一点！宝藏在这 👀", new THREE.Vector3(x, y + 0.5, z), found ? "#d48a00" : "#6b6b9a");
    await wait(found ? 2.2 : 4.5);
    clearFocus();
  }
  // 藏宝的人：把宝箱埋进去（挖完以后宝箱沉下去）
  async function buryChest(who, x, z) {
    await digAt(who, x, z);
    const y = groundY(x, z);
    chest.root.visible = true;
    chest.setOpen(0.6);
    chest.root.position.set(x, y + 0.02, z);
    chestAnim = { t0: T, y0: y + 0.02, y1: y - 0.55, sink: true };
    await wait(1.2);
    chest.root.visible = false;
    chestAnim = null;
  }
  function previewHide(p) {
    marker.root.visible = !!p;
    if (p) marker.root.position.set(p.x, groundY(p.x, p.z) + 0.01, p.z);
  }

  /* ------------------------------------------------------------ 钓鱼大赛：码头边的计分牌、奖杯 */
  const PERP = new THREE.Vector3(ctx.DOCK.dir.z, 0, -ctx.DOCK.dir.x);
  const board = buildScoreboard(M);
  const bp = ctx.DOCK.base.clone().addScaledVector(PERP, -0.95).addScaledVector(ctx.DOCK.dir, -0.25);
  board.root.position.set(bp.x, groundY(bp.x, bp.z), bp.z);
  board.root.rotation.y = Math.atan2(ctx.DOCK.dir.x, ctx.DOCK.dir.z) - 0.35;
  board.root.scale.setScalar(0.85);
  board.root.visible = false;
  world.add(board.root);

  const trophy = buildTrophy(M);
  trophy.root.position.set(-0.75, 0, -1.4);
  trophy.root.visible = false;
  world.add(trophy.root);

  const jar = buildHeartJar(M);
  jar.root.position.set(1.05, 0, 1.75);
  jar.root.visible = false;
  world.add(jar.root);

  /* ------------------------------------------------------------ 和服务器状态同步 */
  let lastHuntId = null;
  function setGames(g, me, nm) {
    if (nm) names = nm;
    const now = g.now || Date.now();
    // 藏宝
    const h = g.hunt;
    const lastTs = h && h.digs.length ? h.digs[h.digs.length - 1].ts : h ? h.ts : 0;
    const show = h && (h.status === "live" || (h.status !== "cancel" && now - lastTs < RECENT));
    if (!h || h.id !== lastHuntId) { clearMounds(); chest.root.visible = false; hideSpot(); lastHuntId = h ? h.id : null; }
    if (show) {
      for (const d of h.digs) if (!pendingDigs.has(d.x + "," + d.z)) addMound(d, false);
      previewHide(h.status === "live" && h.hider === me && h.x != null ? { x: h.x, z: h.z } : null);
      if (h.status !== "live" && h.x != null && !chestAnim && !chest.root.visible && !pendingDigs.size) {
        chest.root.visible = true;
        chest.root.position.set(h.x, groundY(h.x, h.z) + 0.02, h.z);
        chest.setOpen(1);
      }
      if (h.status === "lost" && h.x != null && !pendingDigs.size) showSpot(h.x, h.z, "🎁 宝藏藏在这里");
      else if (h.status !== "lost") hideSpot();
    } else { clearMounds(); previewHide(null); hideSpot(); if (!chestAnim) chest.root.visible = false; }
    // 钓鱼大赛
    const d = g.derby;
    const showBoard = d && (d.status === "live" || now - (d.until - 24 * 3600000) < 6 * 3600000);
    board.root.visible = !!showBoard;
    if (showBoard) {
      const lucky = FISH_NAME[d.lucky];
      const row = (who) => ({ name: names[who], emoji: who === "her" ? "🐱" : "🦖", pts: d.p[who].total, casts: d.p[who].casts.length, max: d.max });
      board.setScores({ title: "钓鱼大赛", rows: [row("me"), row("her")], lucky: lucky ? { emoji: lucky[1], name: lucky[0] } : null,
        status: d.status === "live" ? "进行中" : "已结束", winner: d.status === "done" ? (d.winner === "me" ? 0 : d.winner === "her" ? 1 : null) : null });
    }
    // 奖杯（7 天）
    trophy.root.visible = !!g.trophy;
    if (g.trophy) trophy.setLabel(`${names[g.trophy.who]} · 钓鱼冠军`);
    // 默契罐
    const q = g.quiz;
    jar.root.visible = !!(q && q.rounds > 0);
    if (q && q.rounds > 0) { jar.setFill(Math.min(1, (q.total % 100) / 100 + (q.total >= 100 && q.total % 100 === 0 ? 1 : 0))); jar.setLabel(`默契 ${q.total}`); }
  }
  const pendingDigs = new Set(); // 本机正在播动画的坑，先别从服务器状态里画出来

  /* ------------------------------------------------------------ 石头剪刀布：头顶冒出手势 */
  const HANDS = ["✊", "✌️", "✋"];
  const handSprite = () => { const sp = labelSprite("✊", "#5a4636", true); sp.visible = false; world.add(sp); return sp; };
  const hands = { me: null, her: null };
  let rpsAnim = null; // { t0, picks: {me, her}, w }
  function headTop(who) {
    const a = actorOf(who), p = a.root().position.clone();
    p.y += who === "her" ? 0.95 : 1.35;
    return p;
  }
  // 摇三下"石头—剪刀—布"，然后亮出来；返回 promise（亮完 1.6 秒）
  async function rpsReveal(round) {
    for (const w of ["me", "her"]) { hands[w] ||= handSprite(); hands[w].visible = true; }
    rpsAnim = { t0: T, round, shown: false };
    await wait(1.25 + 1.6);
    for (const w of ["me", "her"]) hands[w].visible = false;
    rpsAnim = null;
  }
  function rpsTick(t) {
    if (!rpsAnim) return;
    const since = t - rpsAnim.t0, shake = since < 1.25;
    for (const w of ["me", "her"]) {
      const h = hands[w], p = headTop(w);
      h.position.copy(p);
      if (shake) h.position.y += Math.abs(Math.sin(since * Math.PI * 2.4)) * 0.18;
      else if (!rpsAnim.shown) setLabel(h, HANDS[rpsAnim.round[w]]);
      const win = !shake && rpsAnim.round.w === w;
      h.scale.set(win ? 1.15 : 0.9, win ? 1.15 : 0.9, 1);
    }
    if (!shake && !rpsAnim.shown) {
      rpsAnim.shown = true;
      const mid = headTop("me").lerp(headTop("her"), 0.5).setY(1.25); // 两个手势牌的上方
      if (rpsAnim.round.w) bubble(rpsAnim.round.w === "her" ? "她赢了这局！" : "他赢了这局！", mid, "#e2557c");
      else bubble("平局，再来！", mid, "#6b6b9a");
    }
    if (shake && rpsAnim.lastShake !== "✊") { for (const w of ["me", "her"]) setLabel(hands[w], "✊"); rpsAnim.lastShake = "✊"; }
  }

  /* ------------------------------------------------------------ 每帧 */
  function update(t, dt) {
    T = t;
    for (let i = waits.length - 1; i >= 0; i--) if (t >= waits[i].at) { waits[i].res(); waits.splice(i, 1); }
    for (const m of mounds.values()) m.update(t, dt);
    if (marker.root.visible) marker.update(t);
    if (spot.visible) { spotMark.update(t); spot.userData.beam.uniforms.uT.value = t; if (spotLabel) spotLabel.position.y = 1.15 + Math.sin(t * 2) * 0.05; }
    chest.update(t, dt);
    if (chestAnim) {
      const k = Math.min(1, (t - chestAnim.t0) / 1.0), e = 1 - Math.pow(1 - k, 3);
      chest.root.position.y = chestAnim.y0 + (chestAnim.y1 - chestAnim.y0) * e;
      if (chestAnim.open) chest.setOpen(Math.min(1, (t - chestAnim.open) / 0.7));
      if (k >= 1 && (chestAnim.sink || (chestAnim.open && t - chestAnim.open > 0.8))) chestAnim = null;
    }
    if (digging) {
      const p = (t - digging.t0) / digging.dur;
      digging.arm.rotation.x = -0.9 + Math.abs(Math.sin(p * Math.PI * 3)) * 1.3; // 往下铲三下
    }
    for (let i = bubbles.length - 1; i >= 0; i--) {
      const s = bubbles[i], p = (t - s.userData.t0) / 2.6;
      if (p >= 1) { world.remove(s); bubbles.splice(i, 1); continue; }
      s.position.y += dt * 0.12;
      s.material.opacity = p < 0.8 ? 1 : (1 - p) / 0.2;
    }
    if (trophy.root.visible) trophy.update(t);
    if (jar.root.visible) jar.update(t, dt);
    rpsTick(t);
  }

  return {
    update, setGames, digAt, revealChest, buryChest, previewHide, bubble, rpsReveal,
    // 面板上"看看藏在哪"：镜头转过去看几秒
    lookAt(x, z) { setFocus(() => world.localToWorld(new THREE.Vector3(x, groundY(x, z) + 0.3, z)), 6.5, 5); },
    // 本机挖坑：先播动画，结果回来后插小旗
    async localDig(who, x, z, resultP) {
      const key = x + "," + z;
      pendingDigs.add(key);
      const [r] = await Promise.all([resultP.catch((e) => ({ error: e.message })), digAt(who, x, z)]);
      pendingDigs.delete(key);
      if (r.error) return r;
      const m = addMound({ x, z, band: r.band }, true);
      bubble(BAND_TEXT[r.band] || "", new THREE.Vector3(x, groundY(x, z), z));
      if (r.band === "found") await revealChest(x, z, { found: true });
      else if (r.result && r.hunt && r.hunt.x != null) { await wait(1.2); await revealChest(r.hunt.x, r.hunt.z, { found: false }); }
      return r;
    },
    bandText: (b) => BAND_TEXT[b] || "",
    // 对方挖的坑：先登记（服务器状态里先别画），角色走过去一铲一铲挖完再冒土堆；挖到了就开宝箱
    remoteDigs(who, list, end) {
      for (const d of list) pendingDigs.add(d.x + "," + d.z);
      return (async () => {
        for (const d of list) {
          await digAt(who, d.x, d.z);
          pendingDigs.delete(d.x + "," + d.z);
          addMound(d, true);
          bubble(BAND_TEXT[d.band] || "", new THREE.Vector3(d.x, groundY(d.x, d.z), d.z));
        }
        if (end && end.found) await revealChest(end.x, end.z, { found: true });
        else if (end) await revealChest(end.x, end.z, { found: false });
      })();
    },
  };
}
