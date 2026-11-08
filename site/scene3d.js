// 小窝的 3D 浮空小岛（Three.js r170）。加载失败或 WebGL 不可用时什么都不做，页面保留 2D 版。
// 和 app.js 的约定：app.js 把数据放在 window.NEST 并派发 "nest:update"；
// 这里点到东西时派发 "nest:tap" {what, x, y}，换小伙伴时派发 "nest:species" {kind}。
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { buildPet, SPECIES } from "./pet3d.js";

const params = new URLSearchParams(location.search);
const sceneEl = document.getElementById("scene");
const host = document.getElementById("scene3d");
if (params.has("flat") || !host) throw new Error("3D disabled");

const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
const PIXEL = 3; // 像素模式下，一个渲染像素 = 3 个 CSS 像素
const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} } };
let pixelMode = store.get("nest.pixel") === "px";

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
renderer.setClearColor(0x000000, 0);
host.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
camera.position.set(0, 4.6, 11.5);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.9, 0);
controls.enablePan = false;
controls.enableZoom = false;
controls.enableDamping = true;
controls.minPolarAngle = controls.maxPolarAngle = 1.17; // 转盘：只能左右转
controls.autoRotate = !REDUCED;
controls.autoRotateSpeed = 0.5;
renderer.domElement.style.touchAction = "pan-y"; // 竖着划照常滚动页面，横着划转小岛
let resumeTimer = 0;
controls.addEventListener("start", () => { controls.autoRotate = false; clearTimeout(resumeTimer); });
controls.addEventListener("end", () => { resumeTimer = setTimeout(() => { controls.autoRotate = !REDUCED; }, 6000); });

/* ---------------------------------------------------------------- materials */
const grad = new THREE.DataTexture(new Uint8Array([110, 185, 255]), 3, 1, THREE.RedFormat);
grad.minFilter = grad.magFilter = THREE.NearestFilter;
grad.needsUpdate = true;
const toon = (color, extra = {}) => new THREE.MeshToonMaterial({ color, gradientMap: grad, ...extra });
const OUTLINE = 0x4a2f25;

function outlined(mesh, thickness = 0.04) {
  const g = mesh.geometry.clone();
  for (const k of Object.keys(g.attributes)) if (k !== "position") g.deleteAttribute(k);
  const m = mergeVertices(g, 1e-4);
  m.computeVertexNormals();
  const mat = new THREE.MeshBasicMaterial({ color: OUTLINE, side: THREE.BackSide });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.thickness = { value: thickness };
    sh.vertexShader = "uniform float thickness;\n" + sh.vertexShader.replace(
      "#include <begin_vertex>", "#include <begin_vertex>\ntransformed += normalize(normal) * thickness;");
  };
  const o = new THREE.Mesh(m, mat);
  o.raycast = () => {};
  mesh.add(o);
  return mesh;
}

/* ---------------------------------------------------------------- island */
const world = new THREE.Group();
scene.add(world);
const tappables = [];
const tag = (obj, what) => { obj.traverse((o) => { o.userData.what = what; }); tappables.push(obj); return obj; };
const ISLAND_R = 3.25;

const top = outlined(new THREE.Mesh(new THREE.CylinderGeometry(ISLAND_R, 3.05, 0.5, 18), toon(0x9ad978)), 0.04);
top.position.y = -0.25;
const dirt = outlined(new THREE.Mesh(new THREE.ConeGeometry(3.05, 3.4, 18), toon(0xc08a5e)), 0.04);
dirt.rotation.x = Math.PI;
dirt.position.y = -0.5 - 1.7;
world.add(tag(top, "ground"), dirt);
for (const [x, y, z, s] of [[1.6, -1.4, 1.3, 0.35], [-1.2, -2.1, 1.0, 0.28], [0.3, -2.8, 0.7, 0.22], [-1.9, -0.9, -1.1, 0.3]]) {
  const r = outlined(new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), toon(0xa59a90)), 0.03);
  r.position.set(x, y, z);
  world.add(r);
}

// 规律树
const tree = new THREE.Group();
const trunk = outlined(new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 0.8, 8), toon(0x8a5a3b)), 0.03);
trunk.position.y = 0.4;
const leaves = [[0.72, 1.2], [0.56, 1.62], [0.38, 1.98]].map(([r, y], i) => {
  const m = outlined(new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), toon(i % 2 ? 0x6fcf86 : 0x58b873)), 0.035);
  m.position.y = y;
  m.scale.y = 0.8;
  return m;
});
tree.add(trunk, ...leaves);
tree.position.set(1.95, 0, -1.25);
world.add(tag(tree, "tree"));

// 小床
const bed = new THREE.Group();
const frame = outlined(new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.28, 1.15), toon(0xd39a6a)), 0.035);
frame.position.y = 0.14;
const headboard = outlined(new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.75, 1.15), toon(0xc0875a)), 0.035);
headboard.position.set(-0.95, 0.37, 0);
const mattress = outlined(new THREE.Mesh(new THREE.BoxGeometry(1.78, 0.14, 1.05), toon(0xfff6ea)), 0.03);
mattress.position.y = 0.35;
const pillow = outlined(new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.14, 0.7), toon(0xffffff)), 0.03);
pillow.position.set(-0.66, 0.49, 0);
const blanket = outlined(new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.08, 1.09), toon(0xff9bb3)), 0.03);
blanket.position.set(0.32, 0.46, 0);
bed.add(frame, headboard, mattress, pillow, blanket);
bed.position.set(-1.55, 0, -0.85);
bed.rotation.y = 0.35;
world.add(tag(bed, "bed"));

// 床头小灯：晚上亮
const lamp = new THREE.Group();
const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.9, 6), toon(0x6b5446));
pole.position.y = 0.45;
const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffe9a8 }));
bulb.position.y = 0.98;
const lampLight = new THREE.PointLight(0xffc870, 0, 4, 1.5);
lampLight.position.y = 1.0;
lamp.add(pole, bulb, lampLight);
lamp.position.set(-2.6, 0, 0.1);
world.add(lamp);

// 花：今天的活动量，开花数 = strain（0–21）
const flowers = new THREE.Group();
const PETALS = [0xff8fab, 0xffd166, 0xc3a6ff, 0xff9e7a, 0x8fd3ff, 0xffffff];
const flowerList = [];
for (let i = 0; i < 21; i++) {
  const a = (i / 21) * Math.PI * 2 + 0.15;
  const r = 2.62 + (i % 2) * 0.22;
  const f = new THREE.Group();
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.34, 5), toon(0x3f9a55));
  stem.position.y = 0.17;
  const bloom = new THREE.Group();
  const petalMat = toon(PETALS[i % PETALS.length]);
  for (let k = 0; k < 5; k++) {
    const p = new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 6), petalMat);
    const pa = (k / 5) * Math.PI * 2;
    p.position.set(Math.cos(pa) * 0.09, 0, Math.sin(pa) * 0.09);
    p.scale.set(1, 0.5, 1);
    bloom.add(p);
  }
  const heart = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), toon(0xffe37a));
  heart.position.y = 0.02;
  bloom.add(heart);
  bloom.position.y = 0.38;
  const bud = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), toon(0x5fae5f));
  bud.position.y = 0.36;
  f.add(stem, bloom, bud);
  f.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
  f.userData.phase = Math.random() * Math.PI * 2;
  flowers.add(f);
  flowerList.push({ f, bloom, bud, open: 0, target: 0 });
}
world.add(tag(flowers, "flowers"));

// 电量水晶：恢复
const crystalMat = toon(0xf4b33a, { emissive: 0xf4b33a, emissiveIntensity: 0.55 });
const crystal = outlined(new THREE.Mesh(new THREE.OctahedronGeometry(0.24, 0), crystalMat), 0.03);
crystal.scale.y = 1.5;
const crystalLight = new THREE.PointLight(0xf4b33a, 2.5, 3.5, 1.5);
const crystalWrap = new THREE.Group();
crystalWrap.add(crystal, crystalLight);
world.add(tag(crystalWrap, "crystal"));

/* ---------------------------------------------------------------- sprites: Zzz, sparkles, hearts */
function textSprite(text, color, size = 64) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  g.font = `800 ${size * 0.8}px Nunito, sans-serif`;
  g.textAlign = "center"; g.textBaseline = "middle";
  g.lineWidth = size * 0.1; g.strokeStyle = "#ffffff"; g.strokeText(text, size / 2, size / 2);
  g.fillStyle = color; g.fillText(text, size / 2, size / 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false }));
  s.raycast = () => {};
  return s;
}
const zzz = [0, 1, 2].map(() => { const s = textSprite("Z", "#6f7ad6"); s.visible = false; world.add(s); return s; });
const sparks = Array.from({ length: 7 }, () => { const s = textSprite("✦", "#ffc93c"); s.visible = false; world.add(s); return s; });
const floatHearts = Array.from({ length: 6 }, () => { const s = textSprite("♥", "#ff6b8b"); s.visible = false; s.userData.t0 = -10; world.add(s); return s; });

/* ---------------------------------------------------------------- lights */
const hemi = new THREE.HemisphereLight(0xdff3ff, 0x6f8f5a, 1.6);
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(5, 8, 6);
const fill = new THREE.DirectionalLight(0xffffff, 0.6); // 跟着相机的柔光，夜里也看得清脸
fill.position.set(0, 0.4, 1);
camera.add(fill);
scene.add(hemi, sun, camera);

const SKY = {
  dawn: { hemi: [0xffd9c2, 0x7f9a66, 1.6], sun: [0xffb07a, 2.0], lamp: 0.4, fill: 0.8 },
  day: { hemi: [0xe3f4ff, 0x76a060, 1.8], sun: [0xffffff, 2.2], lamp: 0, fill: 0.5 },
  dusk: { hemi: [0xffc1a8, 0x6a7f5a, 1.4], sun: [0xff9a6b, 1.7], lamp: 1.2, fill: 0.9 },
  night: { hemi: [0x7a84d8, 0x2a3f50, 1.1], sun: [0xaab8ff, 0.7], lamp: 3.2, fill: 1.5 },
};
function hisHour(d) {
  const m = /^([+-])(\d\d):(\d\d)$/.exec((d && d.tz) || "+00:00");
  const off = m ? (m[1] === "-" ? -1 : 1) * (+m[2] * 60 + +m[3]) : 0;
  const t = new Date(Date.now() + off * 60000);
  return t.getUTCHours() + t.getUTCMinutes() / 60;
}
function applySky(h) {
  const k = h >= 5 && h < 7.5 ? "dawn" : h >= 7.5 && h < 17 ? "day" : h >= 17 && h < 19.5 ? "dusk" : "night";
  const s = SKY[k];
  hemi.color.setHex(s.hemi[0]); hemi.groundColor.setHex(s.hemi[1]); hemi.intensity = s.hemi[2];
  sun.color.setHex(s.sun[0]); sun.intensity = s.sun[1];
  lampLight.intensity = s.lamp;
  fill.intensity = s.fill;
  bulb.material.color.setHex(s.lamp > 1 ? 0xffe08a : 0xf3eee0);
}

/* ---------------------------------------------------------------- pet */
let pet = null;
let kind = SPECIES[store.get("nest.species")] ? store.get("nest.species") : "cat";
const PET_SCALE = 1.4; // 小伙伴是主角，比岛上的东西大一号
const home = new THREE.Vector3(0.35, 0, 0.75);
const walkTo = home.clone();

function setSpecies(k) {
  if (pet) {
    world.remove(pet.root);
    pet.root.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    const i = tappables.indexOf(pet.root);
    if (i >= 0) tappables.splice(i, 1);
  }
  kind = SPECIES[k] ? k : "cat";
  store.set("nest.species", kind);
  pet = buildPet(kind, { toon, outlined });
  pet.root.position.copy(walkTo);
  world.add(pet.root);
  tappables.push(pet.root);
  placePet(true);
  document.querySelectorAll("[data-species]").forEach((b) => b.classList.toggle("on", b.dataset.species === kind));
  dispatchEvent(new CustomEvent("nest:species", { detail: { kind } }));
}

/* ---------------------------------------------------------------- state from data */
const BAND_HEX = { green: 0x3fbf7f, yellow: 0xf4b33a, red: 0xef5d5d };
let mood = "chill";

function update() {
  const N = window.NEST;
  if (!N || !N.data) return;
  const d = N.data;
  const prev = mood;
  mood = N.mood || "chill";
  const t = d.today || {};
  const rec = t.recovery ?? 50;
  const c = BAND_HEX[t.band] ?? 0xb9a89c;
  crystalMat.color.setHex(c); crystalMat.emissive.setHex(c); crystalLight.color.setHex(c);
  const k = 0.65 + 0.75 * (rec / 100);
  crystal.scale.set(k, k * 1.5, k);
  crystalLight.intensity = 1 + 3 * (rec / 100);
  // 没有活动数据（被藏起来了）时，花只是装饰
  const n = t.strain == null ? 9 : Math.max(0, Math.min(21, Math.round(t.strain || 0)));
  flowerList.forEach((x, i) => { x.target = i < n ? 1 : 0; });
  applySky(hisHour(d));
  if (prev !== mood) placePet();
}
addEventListener("nest:update", update);
setInterval(() => window.NEST && applySky(hisHour(window.NEST.data)), 60000);

const UP = new THREE.Vector3(0, 1, 0);
// 躺姿：头朝枕头（床的 -x），脸朝上偏向一侧；镜头转到另一边时它会翻个身，让你总能看到脸
const lie = (side) => {
  const y = new THREE.Vector3(-1, 0, 0), z = new THREE.Vector3(0, 0.8, 0.6 * side).normalize();
  const x = new THREE.Vector3().crossVectors(y, z).normalize();
  z.crossVectors(x, y).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
};
const LIE = { 1: lie(1), [-1]: lie(-1) };
let lieSide = 1;
const bedQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), bed.rotation.y);

function placePet(force) {
  if (!pet) return;
  const sleeping = mood === "sleep";
  pet.cap.visible = sleeping;
  pet.bubble.visible = sleeping;
  pet.sweat.visible = mood === "tired";
  if (sleeping) {
    // 侧躺在床上：头朝枕头（床的 -x），脸朝上偏向床外侧
    pet.root.position.copy(bed.position).add(new THREE.Vector3(0.5, 0.62, 0).applyAxisAngle(UP, bed.rotation.y));
    pet.root.quaternion.copy(bedQ).multiply(LIE[lieSide]);
    pet.root.scale.setScalar(0.85);
  } else if (force || pet.root.scale.x !== PET_SCALE) {
    pet.root.position.copy(walkTo);
    pet.root.rotation.set(0, 0, 0);
    pet.root.scale.setScalar(PET_SCALE);
  }
}

/* ---------------------------------------------------------------- interaction */
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const pointer = { x: 0, y: 0, active: false, last: 0 };
let downAt = null, holdTimer = 0, holding = false, holdHeartTimer = 0;
let react = { kind: "", t0: -10 };

function pick(e) {
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  return ray.intersectObjects(tappables, true)[0];
}
function screenOf(v) {
  const p = v.clone().project(camera), r = renderer.domElement.getBoundingClientRect();
  return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height };
}
function headWorld() { return pet.head.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.35, 0)); }

renderer.domElement.addEventListener("pointermove", (e) => {
  const r = renderer.domElement.getBoundingClientRect();
  pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
  pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  pointer.active = true; pointer.last = performance.now();
  if (downAt && Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 8) { clearTimeout(holdTimer); stopHold(); }
});
renderer.domElement.addEventListener("pointerleave", () => { pointer.active = false; });
renderer.domElement.addEventListener("pointerdown", (e) => {
  downAt = [e.clientX, e.clientY];
  const r = renderer.domElement.getBoundingClientRect();
  pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
  pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  pointer.active = true; pointer.last = performance.now();
  const hit = pick(e);
  if (hit && hit.object.userData.what === "pet") {
    holdTimer = setTimeout(() => { holding = true; holdHeartTimer = 0; dispatchEvent(new CustomEvent("nest:tap", { detail: { what: "pet-hold", ...screenOf(headWorld()) } })); }, 450);
  }
});
function stopHold() { holding = false; }
addEventListener("pointerup", () => { clearTimeout(holdTimer); if (holding) { stopHold(); downAt = null; } });
renderer.domElement.addEventListener("pointerup", (e) => {
  if (!downAt || holding) return;
  const moved = Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 8;
  downAt = null;
  if (moved) return;
  const hit = pick(e);
  if (!hit) return;
  const what = hit.object.userData.what;
  if (what === "ground") {
    if (mood === "sleep") { dispatchEvent(new CustomEvent("nest:tap", { detail: { what: "ground-sleep", x: e.clientX, y: e.clientY } })); return; }
    const p = world.worldToLocal(hit.point.clone());
    p.y = 0;
    if (p.length() > ISLAND_R - 0.9) p.setLength(ISLAND_R - 0.9);
    walkTo.copy(p);
    return;
  }
  if (what === "pet") {
    const kinds = mood === "sleep" ? ["stir"] : ["jump", "wave", "blush", "spin"];
    react = { kind: kinds[Math.floor(Math.random() * kinds.length)], t0: clock.elapsedTime };
    const h = screenOf(headWorld());
    dispatchEvent(new CustomEvent("nest:tap", { detail: { what: "pet", react: react.kind, x: h.x, y: h.y } }));
    return;
  }
  dispatchEvent(new CustomEvent("nest:tap", { detail: { what, x: e.clientX, y: e.clientY } }));
});

/* ---------------------------------------------------------------- loop */
const clock = new THREE.Clock();
let visible = true, last = 0, blinkAt = 2, lastT = 0, yawnAt = 6;
new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(host);

function resize() {
  const w = host.clientWidth, h = host.clientHeight;
  if (!w || !h) return;
  renderer.setPixelRatio(pixelMode ? 1 / PIXEL : Math.min(devicePixelRatio || 1, 2));
  renderer.setSize(w, h);
  renderer.domElement.style.imageRendering = pixelMode ? "pixelated" : "auto";
  camera.aspect = w / h;
  camera.position.setLength(w < 500 ? 13 : 11);
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(host);

const tmp = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const lerp = (a, b, k) => a + (b - a) * k;
const ease = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);

function animate(t, dt) {
  if (!pet) return;
  const P = pet, sleep = mood === "sleep";
  const since = t - react.t0;

  // ---- 走路（点草地它会跑过去）
  let walking = false;
  if (!sleep) {
    tmp.subVectors(walkTo, P.root.position); tmp.y = 0;
    const dist = tmp.length();
    if (dist > 0.05) {
      walking = true;
      const step = Math.min(dist, dt * (mood === "tired" ? 0.8 : 1.6));
      P.root.position.addScaledVector(tmp.normalize(), step);
      const yaw = Math.atan2(tmp.x, tmp.z);
      P.root.rotation.y = lerpAngle(P.root.rotation.y, yaw, 0.2);
    } else {
      // 停下来以后慢慢转向镜头
      const cam = camera.getWorldPosition(new THREE.Vector3());
      const toCam = world.worldToLocal(cam).sub(P.root.position);
      P.root.rotation.y = lerpAngle(P.root.rotation.y, Math.atan2(toCam.x, toCam.z), 0.04);
    }
  }

  // ---- 身体
  let y = 0, sx = 1, sy = 1, rz = 0, rx = 0, ry = 0;
  if (sleep) {
    const b = Math.sin(t * 1.6) * 0.5 + 0.5;
    sy = 0.97 + b * 0.04; sx = 1 + b * 0.02;
  } else if (walking) {
    y = Math.abs(Math.sin(t * 11)) * 0.13;
    rz = Math.sin(t * 11) * 0.08;
  } else if (mood === "tired") {
    const b = Math.sin(t * 1.4) * 0.5 + 0.5;
    sy = 0.93 + b * 0.04; sx = 1.02 + b * 0.02; rx = 0.1;
  } else if (mood === "happy") {
    const p = (t * 1.3) % 1;
    y = Math.max(0, Math.sin(p * Math.PI)) * 0.45;
    const sq = p < 0.1 || p > 0.92 ? 0.12 : 0;
    sx = 1 + sq; sy = 1 - sq;
  } else {
    rz = Math.sin(t * 1.8) * 0.05;
    sy = 1 + Math.sin(t * 3.6) * 0.015;
  }
  // 点它的反应
  if (since < 1.2) {
    const k = since / 1.2;
    if (react.kind === "jump") { y += Math.sin(Math.min(1, since / 0.6) * Math.PI) * 0.9; }
    if (react.kind === "spin") { y += Math.sin(Math.min(1, since / 0.7) * Math.PI) * 0.5; ry = ease(since / 0.7) * Math.PI * 2; }
    if (react.kind === "blush") { rz += Math.sin(k * Math.PI * 3) * 0.12; }
    if (react.kind === "stir") { sy *= 1 + Math.sin(k * Math.PI * 4) * 0.04; }
  }
  if (holding) { rz += Math.sin(t * 7) * 0.08; sy *= 0.96; }
  P.body.position.y = y;
  P.body.scale.set(sx, sy, sx);
  P.body.rotation.set(rx, ry, rz);

  // ---- 头：看向手指 / 鼠标（2 秒没动就看镜头）
  let yawT = 0, pitchT = 0;
  if (!sleep) {
    if (pointer.active && performance.now() - pointer.last < 2500) {
      ndc.set(pointer.x, pointer.y);
      ray.setFromCamera(ndc, camera);
      const target = ray.ray.at(camera.position.distanceTo(P.root.getWorldPosition(tmp)) * 0.85, new THREE.Vector3());
      const local = P.body.worldToLocal(target).sub(P.head.position);
      yawT = Math.max(-0.7, Math.min(0.7, Math.atan2(local.x, local.z)));
      pitchT = Math.max(-0.35, Math.min(0.35, -Math.atan2(local.y, Math.hypot(local.x, local.z))));
    } else {
      yawT = Math.sin(t * 0.4) * 0.15;
    }
  }
  if (holding) { pitchT = 0.15; }
  P.head.rotation.y = lerp(P.head.rotation.y, yawT, 0.12);
  P.head.rotation.x = lerp(P.head.rotation.x, pitchT, 0.12);
  P.head.rotation.z = holding ? Math.sin(t * 5) * 0.18 : (mood === "chill" ? Math.sin(t * 0.9) * 0.08 : 0);

  // ---- 表情
  let eyes = "open";
  if (sleep) eyes = since < 0.8 && react.kind === "stir" ? "half" : "sleep";
  else if (holding || mood === "happy") eyes = "happy";
  else if (mood === "tired") eyes = "half";
  if (since < 1.2 && !sleep) eyes = since < 0.35 ? "wide" : "happy";
  if (!sleep && eyes !== "happy" && t > blinkAt) { eyes = "sleep"; if (t > blinkAt + 0.13) blinkAt = t + 2 + Math.random() * 3.5; }
  // 累的时候偶尔打哈欠
  let yawning = false;
  if (mood === "tired" && !holding) {
    if (t > yawnAt) { yawning = true; eyes = "sleep"; if (t > yawnAt + 1.6) yawnAt = t + 6 + Math.random() * 6; }
  }
  P.setEyes(eyes);
  P.yawn.visible = yawning;
  if (yawning) P.yawn.scale.setScalar(0.6 + Math.sin(Math.min(1, (t - yawnAt) / 1.6) * Math.PI) * 0.8);
  P.blushMat.opacity = holding || (react.kind === "blush" && since < 2) ? 0.95 : 0.55;

  // ---- 手、耳朵、尾巴
  const waving = react.kind === "wave" && since < 1.6;
  P.arms.forEach((a, i) => {
    const s = i ? 1 : -1;
    const base = s * (kind === "cat" ? 0.25 : 0.35);
    if (waving && i === 1) a.rotation.z = 2.4 + Math.sin(t * 14) * 0.4;
    else if (mood === "happy" && !sleep) a.rotation.z = base + s * (0.3 + Math.sin(t * 8 + i) * 0.25);
    else a.rotation.z = lerp(a.rotation.z, base, 0.2);
  });
  P.ears.forEach((e, i) => {
    const twitch = Math.sin(t * 0.7 + i * 2) > 0.97 ? 0.25 : 0;
    e.rotation.x = mood === "tired" || sleep ? 0.35 : -twitch;
  });
  const wag = mood === "happy" || holding ? 7 : 2.2;
  P.tail.rotation.y = Math.sin(t * wag) * (sleep ? 0.08 : 0.35);

  // ---- 鼻涕泡、汗滴
  if (sleep) {
    const camLocal = bed.worldToLocal(camera.getWorldPosition(new THREE.Vector3()));
    if (Math.abs(camLocal.z) > 1.5) lieSide = camLocal.z > 0 ? 1 : -1;
    P.root.quaternion.slerp(tmpQ.copy(bedQ).multiply(LIE[lieSide]), 0.04);
    const b = (t * 0.45) % 1;
    const popped = react.kind === "stir" && since < 1.5;
    P.bubble.visible = !popped;
    P.bubble.scale.setScalar(0.4 + Math.sin(b * Math.PI) * 1.2);
  }
  if (mood === "tired") P.sweat.position.y = 0.2 + Math.sin(t * 2.5) * 0.03;

  // ---- 水晶
  const head = headWorld();
  world.worldToLocal(head);
  crystalWrap.position.set(head.x - 0.15, head.y + (sleep ? 0.9 : 1.05) + Math.sin(t * 2) * 0.08, head.z - 0.25);
  crystal.rotation.y = t * 1.2;

  // ---- 花
  for (const x of flowerList) {
    x.open += (x.target - x.open) * 0.05;
    x.bloom.scale.setScalar(Math.max(0.001, x.open));
    x.bud.visible = x.open < 0.5;
    x.f.rotation.z = Math.sin(t * 1.5 + x.f.userData.phase) * 0.08;
  }

  // ---- Zzz / 星星 / 爱心
  zzz.forEach((s, i) => {
    s.visible = sleep;
    if (!sleep) return;
    const p = (t * 0.32 + i / 3) % 1;
    s.position.set(head.x + 0.3 + p * 0.6, head.y + 0.3 + p * 1.2, head.z + 0.1);
    s.material.opacity = Math.sin(p * Math.PI);
    s.scale.setScalar(0.22 + p * 0.25);
  });
  sparks.forEach((s, i) => {
    s.visible = mood === "happy";
    if (!s.visible) return;
    const a = t * 0.8 + (i / sparks.length) * Math.PI * 2;
    s.position.set(P.root.position.x + Math.cos(a) * 1.15, 0.5 + (i % 3) * 0.45 + Math.sin(t * 2 + i) * 0.1, P.root.position.z + Math.sin(a) * 1.15);
    const tw = Math.sin(t * 4 + i * 1.7) * 0.5 + 0.5;
    s.material.opacity = tw; s.scale.setScalar(0.16 + tw * 0.14);
  });
  if (holding && t - holdHeartTimer > 0.35) {
    holdHeartTimer = t;
    const s = floatHearts.find((h) => t - h.userData.t0 > 1.4);
    if (s) { s.userData.t0 = t; s.userData.dx = (Math.random() - 0.5) * 0.6; }
  }
  floatHearts.forEach((s) => {
    const p = (t - s.userData.t0) / 1.4;
    s.visible = p >= 0 && p < 1;
    if (!s.visible) return;
    s.position.set(head.x + s.userData.dx, head.y + 0.4 + p * 0.9, head.z + 0.2);
    s.material.opacity = Math.sin(p * Math.PI);
    s.scale.setScalar(0.22 + p * 0.12);
  });
}
function lerpAngle(a, b, k) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}

function loop(now) {
  requestAnimationFrame(loop);
  if (!visible || document.hidden) return;
  if (now - last < 1000 / 45) return; // 最多 45fps，省电
  last = now;
  const t = clock.getElapsedTime();
  const dt = Math.min(0.1, t - lastT);
  lastT = t;
  animate(REDUCED ? 0 : t, dt);
  controls.update();
  renderer.render(scene, camera);
}

/* ---------------------------------------------------------------- buttons */
const btn = document.getElementById("px-toggle");
function syncBtn() { if (btn) btn.textContent = pixelMode ? "像素" : "高清"; }
if (btn) btn.addEventListener("click", () => { pixelMode = !pixelMode; store.set("nest.pixel", pixelMode ? "px" : "hd"); syncBtn(); resize(); });
syncBtn();
document.querySelectorAll("[data-species]").forEach((b) => b.addEventListener("click", () => {
  if (b.dataset.species === kind) return;
  setSpecies(b.dataset.species);
  react = { kind: "jump", t0: clock.elapsedTime };
}));

/* ---------------------------------------------------------------- boot */
setSpecies(kind);
update();
resize();
requestAnimationFrame(loop);
sceneEl.classList.add("has3d");
sceneEl.classList.remove("loading3d");
setTimeout(() => document.getElementById("hint")?.classList.add("gone"), 9000);
