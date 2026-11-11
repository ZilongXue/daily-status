// 小岛生活（v15）的 3D 一侧：孵出来的宠物在岛上溜达、来访的岛民站在码头边、出海的小船、突发事件、远方的小岛、小木屋室内。
// 状态全部来自 life-ui.js 拉到的 /life（setState），这里只负责摆出来、动起来、被点到时派发 "nest:tap"。
import * as THREE from "three";
import { buildPet, buildVisitor, buildEgg, buildBoat, PET_LOOKS } from "./critters3d.js?v=15.1";
import { createEvents, buildFarIsland, FAR_SPOTS } from "./events3d.js?v=15.1";
import { buildFish, fishThumbs as renderThumbs } from "./fishgen3d.js?v=15.1";
import { animateCatch } from "./fish3d.js?v=15.1";
import { FISH } from "./fishdata.js?v=15.1";
import { PETS_ON_ISLAND, GOODS } from "./lifedata.js?v=15.1";

const V3 = () => new THREE.Vector3();
const PET_S = 2.2, VIS_S = 1.7, BOAT_S = 2; // 模型是按 1 倍做的；角色实际约 1.0 高（小猫），宠物到它一半、岛民和它差不多

export function createLife3D(ctx) {
  const { scene, world, camera, renderer, controls, toon, outlined, W, DOCK, SEA_Y, decor, screenOf, setFocus, clearFocus, walkable, textSprite } = ctx;
  const deps = { toon, outlined };
  const root = new THREE.Group();
  root.name = "life";
  world.add(root);
  let me = "me", st = null, inside = false, photoMode = false, interior = null, interiorP = null;

  // ---------------------------------------------------------------- 码头边的位置
  const dir = DOCK.dir.clone().setY(0).normalize();
  const perp = new THREE.Vector3(-dir.z, 0, dir.x);
  const boatHome = DOCK.base.clone().setLength(4.5).addScaledVector(perp, 0.95).setY(SEA_Y); // 停在码头中段旁边（镜头里看得到）
  const boatAway = DOCK.tip.clone().addScaledVector(dir, 9).addScaledVector(perp, 2).setY(SEA_Y);
  const visitorSpots = [-1, 0, 1].map((i) => walkable(DOCK.base.clone().multiplyScalar(0.72).addScaledVector(perp, i * 0.8)));

  // ---------------------------------------------------------------- 小船
  const boat = buildBoat(deps);
  boat.root.scale.setScalar(BOAT_S);
  boat.root.position.copy(boatHome);
  boat.root.rotation.y = Math.atan2(dir.z, dir.x) * -1;
  tagAll(boat.root, "boat", "boat");
  root.add(boat.root);
  const boatMark = textSprite ? textSprite("📦", "#fff", 48) : null;
  if (boatMark) { boatMark.scale.setScalar(0.4 / BOAT_S); boatMark.position.set(0, 0.62, 0); boatMark.visible = false; boat.root.add(boatMark); }
  let boatT = 0, boatState = "home", boatFrom = boatHome.clone(), boatTo = boatHome.clone(), sailK = 0;

  // ---------------------------------------------------------------- 宠物 / 岛民
  const pets = new Map(); // id → { o, target, wait, state, sp }
  const visitors = new Map(); // id → { o, mark, spot, resident, state }
  const far = new Map();

  function turn(a, b, k) { let d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI; return a + d * k; }
  function tagAll(obj, what, id) { obj.traverse((o) => { o.userData.what = what; o.userData.item = id; }); }
  function randomSpot(r = 2.6) {
    for (let i = 0; i < 20; i++) {
      const a = Math.random() * Math.PI * 2, d = 0.6 + Math.random() * r;
      const p = walkable(new THREE.Vector3(Math.cos(a) * d, 0, Math.sin(a) * d));
      if (p.length() > 0.5) return p;
    }
    return new THREE.Vector3(0.5, 0, 0.5);
  }
  function syncPets(list) {
    const out = list.slice(-PETS_ON_ISLAND);
    const keep = new Set(out.map((p) => p.id));
    for (const [id, p] of pets) if (!keep.has(id)) { root.remove(p.o.root); pets.delete(id); }
    for (const p of out) {
      if (pets.has(p.id)) continue;
      const o = buildPet(p.species, p.variant, deps);
      o.root.scale.setScalar(PET_S);
      tagAll(o.root, "lifepet", p.id);
      o.root.position.copy(randomSpot());
      root.add(o.root);
      pets.set(p.id, { o, target: o.root.position.clone(), wait: Math.random() * 3, state: "idle", sp: 0.28 + Math.random() * 0.12, happy: 0 });
    }
  }
  function syncVisitors(list, residents) {
    const want = new Map();
    list.forEach((v, i) => want.set(v.id, { v, resident: false, spot: visitorSpots[i % visitorSpots.length] }));
    for (const r of residents) if (!want.has(r)) want.set(r, { v: null, resident: true });
    for (const [id, x] of visitors) if (!want.has(id)) { root.remove(x.o.root); visitors.delete(id); }
    for (const [id, w] of want) {
      let x = visitors.get(id);
      if (!x) {
        const o = buildVisitor(id, deps);
        o.root.scale.setScalar(VIS_S);
        tagAll(o.root, "visitor", id);
        root.add(o.root);
        const mark = textSprite ? textSprite("❗", "#fff", 48) : null;
        if (mark) { mark.scale.setScalar(0.3 / VIS_S); mark.position.y = (o.root.userData.headY || 0.5) + 0.18; o.root.add(mark); tagAll(mark, "visitor", id); }
        x = { o, mark, state: "idle", target: null, wait: 0, happyT: -9 };
        o.root.position.copy(w.resident ? randomSpot(2.2) : boatHome.clone().addScaledVector(dir, -0.6).setY(0));
        if (!w.resident) x.target = w.spot.clone(); // 从码头走过来
        visitors.set(id, x);
      }
      x.resident = w.resident;
      x.done = !!(w.v && w.v.done);
      if (!w.resident && w.spot && !x.target && x.o.root.position.distanceTo(w.spot) > 0.05) x.target = w.spot.clone();
      if (x.mark) {
        x.mark.visible = !w.resident && !x.done && !photoMode;
        if (w.v && x.mark.userData.req !== reqEmoji(w.v.req)) { const e = reqEmoji(w.v.req); x.mark.userData.req = e; const s2 = textSprite(e, "#fff", 48); x.mark.material.map = s2.material.map; x.mark.material.needsUpdate = true; }
      }
    }
  }
  function reqEmoji(r) { return r.type === "fish" ? (FISH[r.fish] || {}).emoji || "🐟" : r.type === "dish" ? "🍽" : "🥕"; }
  function syncFar(islands) {
    for (const k of islands) {
      if (far.has(k) || !FAR_SPOTS[k]) continue;
      const f = buildFarIsland(k, deps);
      f.root.position.set(FAR_SPOTS[k].x, 0, FAR_SPOTS[k].z);
      f.root.rotation.y = FAR_SPOTS[k].rotY;
      root.add(f.root);
      far.set(k, f);
    }
  }
  // 被台风吹倒的装饰：歪着放
  let knocked = [];
  function syncKnocked(list) {
    for (const id of knocked) if (!list.includes(id)) { const g = decor.group(id); if (g) { g.rotation.z = 0; g.rotation.x = 0; } }
    knocked = list.slice();
    for (const id of knocked) { const g = decor.group(id); if (g) { g.rotation.z = 0.9; g.rotation.x = 0.2; } }
  }

  // ---------------------------------------------------------------- 突发事件
  const events = createEvents({ scene, world, toon, outlined, heightAt: W.heightAt, camera, SEA_Y, DOCK });
  let evKey = null;
  function syncEvent(e) {
    const live = e && !e.over && Date.now() < e.end && Date.now() >= e.start;
    if (!live) {
      if (evKey) { const k = events.active(); if (k === "parrot" || k === "whale") events.leave(); else events.stop(); }
      evKey = null; return;
    }
    if (evKey !== e.key) {
      events.stop();
      const seed = [...e.key].reduce((a, c) => a + c.charCodeAt(0), 0);
      events.start(e.kind, e.kind === "parrot" ? { carry: e.stolen ? itemEmoji(e.stolen) : null } : {});
      evKey = e.key;
      if (e.kind === "meteor") events.spawnFragments(Math.max(0, e.per - (e.got || 0)), seed);
      if (e.kind === "lowtide") events.spawnShells(Math.max(0, e.per - (e.got || 0)), seed);
      if (e.kind === "whale" && !photoMode) { const p = events.focusPoint(); if (p) setFocus(() => events.focusPoint() || p, 9, 6); }
    }
    if (e.kind === "typhoon") e.braced.forEach((b, i) => events.setBraced(i, !!b));
    if (e.kind === "parrot" && e.returned) events.leave();
  }
  function itemEmoji(k) {
    if (k.startsWith("f:")) return (FISH[k.slice(2)] || {}).emoji || "🐟";
    return (GOODS[k] || [])[1] || "🎁";
  }

  // ---------------------------------------------------------------- 状态
  function setState(s, who) {
    st = s; me = who || me;
    syncPets(s.pets || []);
    syncVisitors(s.visitors || [], s.residents || []);
    syncFar(s.islands || []);
    syncKnocked(s.knocked || []);
    syncEvent(s.event);
    const v = s.voyage;
    const want = !v ? "home" : Date.now() >= v.eta ? "back" : "away";
    if (want !== boatState) {
      if (want === "away") { boatFrom.copy(boat.root.position); boatTo.copy(boatAway); boatT = 0; }
      else { boatFrom.copy(boatState === "away" ? boatAway : boat.root.position); boatTo.copy(boatHome); boatT = boatState === "away" ? 0 : 1; }
      boatState = want;
    }
    if (boatMark) boatMark.visible = want === "back" && !photoMode;
    if (interior) syncInterior();
  }

  // ---------------------------------------------------------------- 每帧
  const tmp = V3();
  function update(t, dt) {
    if (inside) return;
    // 宠物：走到随机点、停一会儿、偶尔蹦一下；晚上睡觉
    const night = ctx.isNight && ctx.isNight();
    for (const [, p] of pets) {
      const o = p.o, pos = o.root.position;
      if (p.happy > 0) { p.happy -= dt; o.update(t, dt, "happy"); continue; }
      if (night) { o.update(t, dt, "sleep"); continue; }
      tmp.subVectors(p.target, pos); tmp.y = 0;
      const d = tmp.length();
      if (d > 0.04) {
        pos.addScaledVector(tmp.normalize(), Math.min(d, dt * p.sp));
        o.root.rotation.y = Math.atan2(tmp.x, tmp.z);
        o.update(t, dt, p.state === "hop" ? "hop" : "walk");
      } else {
        p.wait -= dt;
        o.update(t, dt, p.state === "eat" ? "eat" : "idle");
        if (p.wait <= 0) { p.target.copy(randomSpot()); p.wait = 2 + Math.random() * 5; p.state = Math.random() < 0.25 ? "hop" : Math.random() < 0.2 ? "eat" : "walk"; }
      }
      pos.y = Math.max(0, W.heightAt(pos.x, pos.z));
    }
    // 岛民：走到码头边的位置，面朝镜头；住下来的到处慢慢逛
    for (const [, x] of visitors) {
      const o = x.o, pos = o.root.position;
      if (t - x.happyT < 2.2) { o.update(t, dt, "happy"); continue; }
      if (x.target) {
        tmp.subVectors(x.target, pos); tmp.y = 0;
        const d = tmp.length();
        if (d > 0.04) { pos.addScaledVector(tmp.normalize(), Math.min(d, dt * 0.45)); o.root.rotation.y = Math.atan2(tmp.x, tmp.z); o.update(t, dt, "walk"); pos.y = Math.max(0, W.heightAt(pos.x, pos.z)); continue; }
        x.target = null; x.wait = 3 + Math.random() * 6;
      }
      if (x.resident) { x.wait -= dt; if (x.wait <= 0) x.target = randomSpot(2.4); }
      else { camera.getWorldPosition(tmp); world.worldToLocal(tmp); o.root.rotation.y = turn(o.root.rotation.y, Math.atan2(tmp.x - pos.x, tmp.z - pos.z), 0.08); }
      o.update(t, dt, x.done ? "idle" : Math.sin(t * 0.7 + pos.x * 3) > 0.92 ? "wave" : "idle");
      if (x.mark) x.mark.position.y = (o.root.userData.headY || 0.5) + 0.2 + Math.sin(t * 2.5) * 0.03;
    }
    // 小船
    if (boatT < 1) {
      boatT = Math.min(1, boatT + dt / 6);
      const k = boatT * boatT * (3 - 2 * boatT);
      boat.root.position.lerpVectors(boatFrom, boatTo, k);
      boat.root.visible = !(boatState === "away" && boatT >= 1);
      sailK += ((boatState === "home" && boatT >= 1 ? 0 : 1) - sailK) * Math.min(1, dt * 2);
    } else if (boatState === "away") boat.root.visible = false;
    else sailK += (0 - sailK) * Math.min(1, dt * 2);
    boat.update(t, dt, { sail: sailK });
    if (boatMark && boatMark.visible) boatMark.position.y = 0.62 + Math.sin(t * 3) * 0.03;
    for (const [, f] of far) f.update(t);
    events.update(t, dt);
  }

  // ---------------------------------------------------------------- 点击（岛上）
  function tap(hit, e, ray) {
    if (inside) return true;
    const ev = events.active() ? events.pick(ray) : null;
    if (ev) { if (!ev.braced) dispatch({ what: "evt", kind: ev.kind, index: ev.index ?? 0, x: e.clientX, y: e.clientY }); return true; } // 已经加固好的点：不响应
    if (!hit) return false;
    const what = hit.object.userData.what;
    if (what === "lifepet" || what === "visitor" || what === "boat") {
      const id = hit.object.userData.item;
      if (what === "lifepet") { const p = pets.get(id); if (p) p.happy = 1.6; }
      dispatch({ what, id, x: e.clientX, y: e.clientY });
      return true;
    }
    if (what === "decor" && knocked.includes(hit.object.userData.item)) { dispatch({ what: "knocked", id: hit.object.userData.item, x: e.clientX, y: e.clientY }); return true; }
    return false;
  }
  const dispatch = (detail) => dispatchEvent(new CustomEvent("nest:tap", { detail }));

  // ---------------------------------------------------------------- 动画反馈
  function fx(kind, d = {}) {
    if (kind === "give") { const x = visitors.get(d.visitor); if (x) { x.happyT = performance.now() / 1000; x.done = true; if (x.mark) x.mark.visible = false; } }
    if (kind === "petHappy") { const p = pets.get(d.id); if (p) p.happy = 1.6; }
    if (kind === "brace") events.setBraced(d.i, true);
    if (kind === "shoo") { events.hit(); if (d.done) { events.setCarry(null); setTimeout(() => events.leave(), 900); } }
    if (kind === "collect") events.collect(d.i);
    if (kind === "whale") events.hit();
    if (kind === "sail") { boatFrom.copy(boat.root.position); boatTo.copy(boatAway); boatT = 0; boatState = "away"; boat.root.visible = true; }
    if (kind === "unload" && boatMark) boatMark.visible = false;
    if (kind === "cook" && interior) { cookT = 2.5; }
    if (kind === "feed" && interior) { const e = eggObjs.get(d.egg); if (e) e.wob = 1.2; }
    if (kind === "hatch" && interior) { const e = eggObjs.get(d.egg); if (e) e.hatchT = 0.001; }
  }

  // ---------------------------------------------------------------- 小木屋室内
  const eggObjs = new Map();
  const tankFish = [];
  const homePets = [];
  let photos = [], cookT = 0, labelText = {}, labelBox = null;
  const lpos = { x: 0, y: 0 };
  // 室内热点的小标签（HTML，跟着 3D 位置走）
  function showLabels(on) {
    if (!on) { if (labelBox) labelBox.hidden = true; return; }
    if (!labelBox) {
      labelBox = document.createElement("div");
      labelBox.className = "hs-labels";
      for (const id of interior.ids || Object.keys(labelText)) {
        const b = document.createElement("button");
        b.type = "button"; b.dataset.hs = id;
        b.addEventListener("click", (e) => { e.stopPropagation(); dispatch({ what: "hotspot", id, x: e.clientX, y: e.clientY }); });
        labelBox.appendChild(b);
      }
      renderer.domElement.parentElement.appendChild(labelBox);
    }
    for (const b of labelBox.children) {
      const id = b.dataset.hs;
      b.textContent = id === "aquarium" && !(st && st.aquarium) ? "❓ 水族箱" : id === "mailbox" && st && st.mailReady ? "💌 信箱 •" : (labelText[id] || id);
    }
    labelBox.hidden = photoMode;
  }
  async function ensureInterior() {
    if (interior) return interior;
    interiorP ||= import("./interior3d.js?v=15.1").then(({ buildInterior, INTERIOR_LABELS }) => {
      interior = buildInterior(deps);
      labelText = INTERIOR_LABELS || {};
      syncInterior();
      applyPhotos();
      return interior;
    });
    return interiorP;
  }
  function syncInterior() {
    if (!interior || !st) return;
    // 蛋
    const inc = (st.eggs || []).filter((e) => e.inc);
    for (const [id, e] of eggObjs) if (!inc.some((x) => x.id === id)) { e.o.root.parent && e.o.root.parent.remove(e.o.root); eggObjs.delete(id); }
    inc.forEach((e, i) => {
      if (eggObjs.has(e.id) || !interior.slots.incubator[i]) return;
      const o = buildEgg(e.pattern, deps);
      interior.slots.incubator[i].add(o.root);
      eggObjs.set(e.id, { o, wob: 0, hatchT: 0, full: false });
    });
    for (const e of inc) { const x = eggObjs.get(e.id); if (x) x.full = e.feeds.length >= 3; }
    // 水族箱：钓到过的鱼挑几条
    interior.setAquariumVisible(!!st.aquarium);
    if (st.aquarium && !tankFish.length && ctx.bookIds) {
      const ids = ctx.bookIds().filter((k) => FISH[k] && FISH[k].kind === "fish").sort(() => Math.random() - 0.5).slice(0, 6);
      const A = interior.slots.aquarium;
      for (const k of ids) {
        const f = buildFish(k, deps);
        f.root.scale.setScalar(0.3);
        f.root.position.set((Math.random() - 0.5) * A.w * 0.6, (Math.random() - 0.5) * A.h * 0.5, (Math.random() - 0.5) * A.d * 0.4);
        A.group.add(f.root);
        tankFish.push({ f, ph: Math.random() * 6, sp: 0.3 + Math.random() * 0.3 });
      }
    }
    // 在家睡觉的宠物（岛上逛的之外的）
    const home = (st.pets || []).slice(0, Math.max(0, (st.pets || []).length - PETS_ON_ISLAND)).slice(-interior.slots.petBeds.length);
    if (homePets.map((x) => x.id).join() !== home.map((p) => p.id).join()) {
      for (const x of homePets) x.o.root.parent && x.o.root.parent.remove(x.o.root);
      homePets.length = 0;
      home.forEach((p, i) => { const o = buildPet(p.species, p.variant, deps); interior.slots.petBeds[i].add(o.root); homePets.push({ id: p.id, o }); });
    }
    interior.highlight(st.mailReady ? "mailbox" : null);
    if (inside) showLabels(true);
  }
  function applyPhotos() {
    if (!interior) return;
    const loader = new THREE.TextureLoader();
    const tex = photos.slice(0, 6).map((u) => { const t = loader.load(u); t.colorSpace = THREE.SRGBColorSpace; return t; });
    interior.setPhotos(tex);
  }
  async function enter() {
    if (inside) return;
    await ensureInterior();
    inside = true;
    controls.enabled = false;
    resizeInterior();
    interior.setNight(!!(ctx.isNight && ctx.isNight()));
    showLabels(true);
    dispatchEvent(new CustomEvent("nest:home", { detail: { inside: true } }));
  }
  function exit() {
    if (!inside) return;
    inside = false;
    controls.enabled = true;
    showLabels(false);
    dispatchEvent(new CustomEvent("nest:home", { detail: { inside: false } }));
  }
  function resizeInterior() {
    if (!interior) return;
    const c = renderer.domElement;
    interior.resize(c.clientWidth || c.width, c.clientHeight || c.height);
  }
  function renderInside(t, dt) {
    if (cookT > 0) cookT -= dt;
    interior.cook(cookT > 0 ? 1 : 0.15);
    for (const [, e] of eggObjs) {
      if (e.hatchT > 0) e.hatchT += dt;
      if (e.wob > 0) e.wob -= dt;
      e.o.update(t, dt, { wobble: e.hatchT > 0 ? 1 : e.wob > 0 ? 0.8 : e.full ? 0.25 : 0.06, crack: e.hatchT > 0 ? Math.min(1, e.hatchT / 1.4) : 0 });
    }
    const A = interior.slots.aquarium;
    for (const x of tankFish) {
      const a = t * x.sp + x.ph;
      x.f.root.position.x = Math.sin(a) * A.w * 0.32;
      x.f.root.position.z = Math.cos(a * 0.7) * A.d * 0.18;
      x.f.root.rotation.y = Math.cos(a) > 0 ? 0 : Math.PI;
      animateCatch(x.f, t, 0.6);
    }
    for (const x of homePets) x.o.update(t, dt, "sleep");
    interior.update(t, dt);
    renderer.render(interior.scene, interior.camera);
    if (labelBox && !labelBox.hidden) {
      const c = renderer.domElement, w = c.clientWidth, h = c.clientHeight;
      for (const b of labelBox.children) { interior.hotspotScreen(b.dataset.hs, w, h, lpos); b.style.transform = `translate(${lpos.x | 0}px, ${lpos.y | 0}px) translate(-50%, -100%)`; }
    }
  }
  function tapInside(e) {
    if (!interior) return;
    const r = renderer.domElement.getBoundingClientRect();
    const id = interior.pick(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    if (id) dispatch({ what: "hotspot", id, x: e.clientX, y: e.clientY });
  }

  // ---------------------------------------------------------------- 拍照 / 缩略图
  function setPhotoMode(on) {
    photoMode = !!on;
    if (labelBox && inside) labelBox.hidden = photoMode;
    controls.autoRotate = !on;
    for (const [, x] of visitors) if (x.mark) x.mark.visible = !photoMode && !x.resident && !x.done;
    if (boatMark) boatMark.visible = !photoMode && boatState === "back";
  }
  function snapshot(renderFn) {
    renderFn();
    const src = renderer.domElement, c = document.createElement("canvas");
    c.width = src.width; c.height = src.height;
    c.getContext("2d").drawImage(src, 0, 0);
    return c;
  }

  return {
    _dbg: { events, pets, visitors, boat, interior: () => interior },
    setState, update, tap, fx, enter, exit, inside: () => inside, renderInside, tapInside, resizeInterior,
    setPhotoMode, snapshot,
    setHomePhotos(urls) { photos = urls || []; applyPhotos(); },
    fishThumbs: (ids, opts = {}) => renderThumbs(renderer, ids, deps, 128, opts),
    petLooks: () => PET_LOOKS,
    skyDim: () => events.skyDim || 0,
    homeFocus: (id) => interior && interior.highlight({ cook: "stove", eggs: "incubator", pets: null, recipes: "recipes", mail: "mailbox", album: "photowall" }[id] || null),
  };
}
