// 第五版的岛上玩法（场景部分）：扭蛋机、高台菜地、圣诞季、两座岛的天气、对面的城市岛（灯 / 标牌 / 夜色）、同时在线的彩虹桥、小猫换装。
// 模型都在各自的模块里（gacha3d / farm3d / xmas3d / outfit3d / weather3d），这里只负责摆放和编排。
// 任何一个模块加载失败都只会少那一块，不影响别的。
import * as THREE from "three";
import { FARM, heightAt } from "./island3d.js?v=15";

const V = "?v=15";
const load = (m) => import(`./${m}.js${V}`).catch((e) => { console.warn(m, e); return null; });
export const GACHA_SPOT = { x: 2.95, z: 1.75 };

export async function createExtras(ctx) {
  const { world, toon, outlined, tag, W, cast, dino, textSprite, screenOf } = ctx;
  const setFocus = ctx.setFocus || (() => {}), clearFocus = ctx.clearFocus || (() => {});
  const mctx = { toon, outlined };
  const [G, F, X, O, WX] = await Promise.all(["gacha3d", "farm3d", "xmas3d", "outfit3d", "weather3d"].map(load));
  const updaters = [];
  let T = 0;
  const waits = [];
  const wait = (s) => new Promise((r) => waits.push({ at: T + s, r }));

  /* ------------------------------------------------------------ 扭蛋机 */
  let machine = null;
  if (G) {
    machine = G.buildGachaMachine(mctx);
    machine.root.position.set(GACHA_SPOT.x, 0, GACHA_SPOT.z);
    machine.root.rotation.y = Math.atan2(-GACHA_SPOT.x * 0.6, 3 - GACHA_SPOT.z * 0.3);
    machine.root.scale.setScalar(0.85);
    world.add(tag(machine.root, "gacha"));
  }
  let spinning = null;
  async function gachaSpin(result) {
    if (!machine || !G) { dispatchEvent(new CustomEvent("nest:gacha-reveal", { detail: result })); return; }
    const COLS = { common: [0xffd1dc, 0xffffff], rare: [0x9fd3ff, 0xffffff], epic: [0xd5b3ff, 0xfff2a8] };
    const [c1, c2] = COLS[result.rarity] || COLS.common;
    const cap = G.buildCapsule(c1, c2, mctx);
    const t0 = T;
    spinning = { k: 0 };
    setFocus(new THREE.Vector3(GACHA_SPOT.x, 0.9, GACHA_SPOT.z), 6.5);
    // 转把手
    await new Promise((r) => { spinning.done = r; spinning.t0 = T; });
    // 胶囊从出口滚出来、跳起来、打开
    const start = new THREE.Vector3(0, 0.28, 0.42).applyMatrix4(machine.root.matrixWorld);
    world.worldToLocal(start);
    cap.root.position.copy(start);
    cap.root.scale.setScalar(0.35);
    world.add(cap.root);
    const top = start.clone().add(new THREE.Vector3(0, 1.3, 0.6));
    const t1 = T;
    await new Promise((r) => updaters.push(function jump(t) {
      const k = Math.min(1, (t - t1) / 0.8);
      cap.root.position.lerpVectors(start, top, k);
      cap.root.position.y = start.y + Math.sin(k * Math.PI * 0.5) * 1.3;
      cap.root.rotation.z = k * Math.PI * 3;
      cap.root.scale.setScalar(0.35 + 0.35 * k);
      if (k >= 1) { updaters.splice(updaters.indexOf(jump), 1); r(); }
    }));
    // 打开，里面的东西冒出来
    let preview = null;
    if (G.GACHA_DECOR && G.GACHA_DECOR[result.prize]) {
      try { preview = G.buildGachaDecor(result.prize, mctx).root; preview.scale.setScalar(0.45); } catch {}
    }
    if (!preview) {
      const emoji = result.prize === "seeds" ? "🌱" : "⭐";
      preview = textSprite(emoji, "#000", 96);
      paintEmoji(preview, emoji);
      preview.scale.setScalar(0.5);
    }
    preview.position.copy(top).add(new THREE.Vector3(0, 0.1, 0));
    world.add(preview);
    const t2 = T;
    await new Promise((r) => updaters.push(function open(t) {
      const k = Math.min(1, (t - t2) / 0.6);
      cap.top.rotation.x = -2 * k;
      preview.position.y = top.y + 0.1 + k * 0.45;
      preview.rotation.y = t * 1.5;
      if (k >= 1) { updaters.splice(updaters.indexOf(open), 1); r(); }
    }));
    const at = screenOf(world.localToWorld(preview.position.clone()));
    dispatchEvent(new CustomEvent("nest:gacha-reveal", { detail: { ...result, ...at } }));
    await wait(2.4);
    clearFocus();
    world.remove(cap.root); world.remove(preview);
    void t0;
  }

  /* ------------------------------------------------------------ 菜地（高台上） */
  let plot = null;
  const crops = [];
  const fy = heightAt(FARM.x, FARM.z);
  if (F) {
    plot = F.buildFarmPlot({ cols: 3, rows: 2, cell: 0.6, ...mctx });
    plot.root.position.set(FARM.x, fy, FARM.z);
    plot.root.rotation.y = 0.12;
    world.add(tag(plot.root, "farm"));
  }
  function setFarm(state) {
    if (!plot || !F || !state) return;
    state.plots.forEach((p, i) => {
      const cell = plot.cells[i];
      if (!cell) return;
      const stage = !p ? -1 : p.ready ? 3 : Math.min(2, Math.floor((p.watered / p.need) * 3));
      const key = p ? `${p.crop}:${stage}:${p.wilted}` : "";
      if (crops[i] && crops[i].key === key) return;
      if (crops[i]) { cell.remove(crops[i].obj.root); crops[i] = null; }
      if (!p) return;
      try {
        const c = F.buildCrop(p.crop, stage, mctx);
        c.setWilted && c.setWilted(!!p.wilted);
        cell.add(c.root);
        crops[i] = { key, obj: c };
      } catch (e) { console.warn("crop", e); }
    });
  }
  async function farmWater(i) {
    if (!plot || !F) return;
    const can = F.buildWateringCan(mctx);
    const drops = F.buildWaterDrops();
    const cell = plot.cells[i];
    const p = cell.getWorldPosition(new THREE.Vector3());
    world.worldToLocal(p);
    can.root.position.copy(p).add(new THREE.Vector3(-0.32, 0.55, 0));
    world.add(can.root, drops.root);
    setFocus(p.clone().setY(p.y + 0.2), 6.5);
    const t0 = T, sp = new THREE.Vector3();
    let played = false;
    await new Promise((r) => updaters.push(function tilt(t, dt) {
      const k = (t - t0) / 1.9;
      can.root.rotation.z = -Math.min(1, k * 3) * 0.65 + Math.sin(t * 8) * 0.04;
      can.spout.getWorldPosition(sp); world.worldToLocal(sp);
      drops.root.position.copy(sp);
      drops.fall = Math.max(0.1, sp.y - p.y);
      if (k > 0.22 && !played) { drops.play(); played = true; }
      drops.update(dt);
      if (k >= 1) { updaters.splice(updaters.indexOf(tilt), 1); r(); }
    }));
    world.remove(can.root, drops.root);
    setTimeout(clearFocus, 600);
  }
  async function farmHarvest(i, emoji) {
    if (!plot || !F) return;
    const pop = F.buildHarvestPop(mctx);
    plot.cells[i].add(pop.root);
    pop.play(emoji);
    const t0 = T;
    await new Promise((r) => updaters.push(function h(t, dt) {
      pop.update(dt);
      if (t - t0 > 1.6) { updaters.splice(updaters.indexOf(h), 1); r(); }
    }));
    plot.cells[i].remove(pop.root);
  }
  // 浇水 / 种地时把高台顶上那块的屏幕位置给页面（弹提示用）
  const farmScreen = () => (plot ? screenOf(plot.root.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.6, 0))) : null);

  /* ------------------------------------------------------------ 圣诞季 */
  const xmasGroup = new THREE.Group();
  xmasGroup.visible = false;
  world.add(xmasGroup);
  let xmasTree = null, dinoHat = null;
  if (X) {
    xmasTree = X.buildXmasTree(mctx);
    xmasTree.root.position.set(-1.25, 0, 2.15);
    xmasGroup.add(tag(xmasTree.root, "xmas"));
    const gifts = X.buildGiftPile(mctx);
    gifts.root.position.set(-0.75, 0, 2.45);
    gifts.root.scale.setScalar(0.8);
    xmasGroup.add(gifts.root);
    for (const [x, z] of [[0.95, 1.55], [0.2, 1.75], [1.0, 2.55], [0.3, 2.85]]) {
      const c = X.buildCandyCane(mctx);
      c.root.position.set(x, 0, z);
      c.root.rotation.y = x * 4;
      c.root.scale.setScalar(0.8);
      xmasGroup.add(c.root);
    }
  }
  let xmasOn = false;
  function setXmas(on) {
    xmasOn = !!on;
    xmasGroup.visible = xmasOn && !!X;
    // 小恐龙戴圣诞帽
    const P = dino.parts && dino.parts();
    if (X && P && xmasOn && !dinoHat) {
      dinoHat = X.buildSantaHat(mctx).root;
      dinoHat.position.set(0, 0.36, 0.02);
      dinoHat.rotation.z = -0.18;
      P.head.add(dinoHat);
    }
    if (dinoHat) dinoHat.visible = xmasOn;
    applyOutfits();
    applyWeather();
  }
  // 换小伙伴（恐龙 / 猫 / 企鹅 / 小鸡）以后帽子要重新戴
  addEventListener("nest:species", () => { dinoHat = null; if (xmasOn) setXmas(true); });

  /* ------------------------------------------------------------ 小猫换装 */
  let worn = {};
  function applyOutfits() {
    if (!O || !cast) return;
    const ids = Object.keys(worn).filter((k) => worn[k]);
    const hasHead = ids.some((k) => O.OUTFITS[k] && O.OUTFITS[k].slot === "head");
    if (xmasOn && !hasHead) ids.push("santa_hat"); // 圣诞季没戴帽子就送一顶圣诞帽
    try { O.dressKitten(cast.kitten, ids, mctx); } catch (e) { console.warn("outfit", e); }
  }
  function setOutfits(map) { worn = map || {}; applyOutfits(); }

  /* ------------------------------------------------------------ 天气：主岛 = 看的人那边；对面的岛 = 对方那边 */
  const far = W.far;
  let mainW = null, farW = null, lights = null, rainbow = null, label = null;
  if (WX) {
    mainW = WX.createWeather({ parent: world, center: new THREE.Vector3(0, 0, -0.6), radius: 6.5, top: 8.5, seaY: W.SEA_Y, toon, landR: 4.2 });
    farW = WX.createWeather({ parent: world, center: far.center.clone(), radius: 3.2, top: 3.4 + far.topY, seaY: W.SEA_Y, toon, landR: 2.6, flashLight: false });
    lights = WX.buildCityLights({ count: 16, radius: 2.2, toon });
    lights.root.position.set(far.center.x, far.topY + 0.02, far.center.z);
    world.add(lights.root);
    rainbow = WX.buildRainbow({ from: new THREE.Vector3(1.2, 1.6, -5.6), to: new THREE.Vector3(far.center.x - 0.8, far.topY + 0.2, far.center.z + 2.2), height: 4.2 });
    world.add(rainbow.root);
    rainbow.setVisible(false);
  }
  // 对面岛上的标牌
  const labelCanvas = document.createElement("canvas");
  labelCanvas.width = 512; labelCanvas.height = 128;
  const labelTex = new THREE.CanvasTexture(labelCanvas);
  labelTex.colorSpace = THREE.SRGBColorSpace;
  label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTex, transparent: true, depthWrite: false }));
  label.scale.set(4.2, 1.05, 1);
  label.position.set(far.center.x, far.topY + 3.2, far.center.z);
  label.visible = false;
  label.raycast = () => {};
  world.add(label);
  function drawLabel(text) {
    const g = labelCanvas.getContext("2d");
    g.clearRect(0, 0, 512, 128);
    g.font = `700 44px ui-rounded, "PingFang SC", system-ui, sans-serif`;
    const w = Math.min(500, g.measureText(text).width + 48);
    g.fillStyle = "rgba(255,255,255,0.88)";
    g.beginPath(); g.roundRect((512 - w) / 2, 22, w, 84, 42); g.fill();
    g.fillStyle = "#5a4636"; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(text, 256, 66);
    labelTex.needsUpdate = true;
  }
  let worldState = null;
  const farMat = far.mesh && far.mesh.material;
  const farDay = new THREE.Color(0xffffff), farNight = new THREE.Color(0x6a76b8);
  let farNightK = 0, farNightTarget = 0;
  function applyWeather() {
    const s = worldState || {};
    const mine = s.mine, theirs = s.theirs;
    if (mainW) mainW.setKind(mine && mine.kind !== "clear" && mine.kind !== "cloudy" ? mine.kind : xmasOn ? "snow" : mine ? mine.kind : "clear");
    if (farW) farW.setKind(theirs ? theirs.kind : "clear");
    farNightTarget = theirs && !theirs.isDay ? 1 : 0;
    if (rainbow) rainbow.setVisible(!!s.bothOnline);
    if (theirs) {
      const icon = { clear: theirs.isDay ? "☀️" : "🌙", cloudy: "☁️", rain: "🌧", storm: "⛈", snow: "❄️", fog: "🌫" }[theirs.kind] || "";
      drawLabel(`${s.theirName || "对方"}那边 · ${theirs.temp}°C ${icon}`);
      label.visible = true;
    }
  }
  function setWorld(s) { worldState = s; applyWeather(); }

  /* ------------------------------------------------------------ 每帧 */
  function update(t, dt) {
    T = t;
    for (let i = waits.length - 1; i >= 0; i--) if (t >= waits[i].at) { waits[i].r(); waits.splice(i, 1); }
    for (const u of [...updaters]) u(t, dt);
    if (machine && G) {
      if (spinning) {
        const k = Math.min(1, (t - spinning.t0) / 1.3);
        G.machineSpin(machine, k);
        if (k >= 1) { const d = spinning.done; spinning = null; d && d(); }
      } else G.machineIdle(machine, t);
    }
    for (const c of crops) if (c && c.obj.root.userData.anim) c.obj.root.userData.anim(t);
    if (xmasTree && xmasGroup.visible && xmasTree.root.userData.anim) xmasTree.root.userData.anim(t);
    if (mainW) mainW.update(t, dt);
    if (farW) farW.update(t, dt);
    if (rainbow) rainbow.update(t);
    farNightK += (farNightTarget - farNightK) * Math.min(1, dt * 1.5);
    if (lights) lights.setNight(farNightK);
    if (farMat && farMat.color) farMat.color.copy(farDay).lerp(farNight, farNightK * 0.75);
    if (label.visible) label.position.y = far.topY + 3.2 + Math.sin(t * 1.2) * 0.08;
  }

  function paintEmoji(sprite, emoji) {
    const c = sprite.material.map.image, g = c.getContext("2d");
    g.clearRect(0, 0, c.width, c.height);
    g.font = `${c.width * 0.8}px "Apple Color Emoji","Noto Color Emoji",sans-serif`;
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(emoji, c.width / 2, c.height / 2);
    sprite.material.map.needsUpdate = true;
  }

  return {
    update, gachaSpin, setFarm, farmWater, farmHarvest, farmScreen, setXmas, setOutfits, setWorld,
    gachaHas: (id) => !!(G && G.GACHA_DECOR && G.GACHA_DECOR[id]),
    buildGachaDecor: (id) => G.buildGachaDecor(id, mctx),
    busy: () => !!spinning,
  };
}
