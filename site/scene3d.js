// 小窝的 3D 浮空小岛（Three.js r170）。加载失败或 WebGL 不可用时什么都不做，页面保留 2D 版。
// 和 app.js 的约定：app.js 把数据放在 window.NEST 并派发 "nest:update"；这里点到东西时派发 "nest:tap" {what, x, y}。
import * as THREE from "three";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

const params = new URLSearchParams(location.search);
const sceneEl = document.getElementById("scene");
const host = document.getElementById("scene3d");
if (params.has("flat") || !host) throw new Error("3D disabled");

const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
const PIXEL = 3; // 像素模式下，一个渲染像素 = 3 个 CSS 像素
const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} } };
let pixelMode = store.get("nest.pixel") !== "hd";

const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: "low-power" });
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
controls.autoRotateSpeed = 0.7;
renderer.domElement.style.touchAction = "pan-y"; // 竖着划照常滚动页面，横着划转小岛
let resumeTimer = 0;
controls.addEventListener("start", () => { controls.autoRotate = false; clearTimeout(resumeTimer); });
controls.addEventListener("end", () => { resumeTimer = setTimeout(() => { controls.autoRotate = !REDUCED; }, 5000); });

/* ---------------------------------------------------------------- materials */
const grad = new THREE.DataTexture(new Uint8Array([95, 175, 255]), 3, 1, THREE.RedFormat);
grad.minFilter = grad.magFilter = THREE.NearestFilter;
grad.needsUpdate = true;
const toon = (color, extra = {}) => new THREE.MeshToonMaterial({ color, gradientMap: grad, ...extra });
const OUTLINE = 0x3a2219;

function outlined(mesh, thickness = 0.045) {
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

const top = outlined(new THREE.Mesh(new THREE.CylinderGeometry(3.25, 3.05, 0.5, 14), toon(0x8fd16f)), 0.04);
top.position.y = -0.25;
const dirt = outlined(new THREE.Mesh(new THREE.ConeGeometry(3.05, 3.4, 14), toon(0xb07c52)), 0.04);
dirt.rotation.x = Math.PI;
dirt.position.y = -0.5 - 1.7;
world.add(top, dirt);
for (const [x, y, z, s] of [[1.6, -1.4, 1.3, 0.35], [-1.2, -2.1, 1.0, 0.28], [0.3, -2.8, 0.7, 0.22], [-1.9, -0.9, -1.1, 0.3]]) {
  const r = outlined(new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), toon(0x9a8f86)), 0.03);
  r.position.set(x, y, z);
  world.add(r);
}

// 小树：作息规律度
const tree = new THREE.Group();
const trunk = outlined(new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 0.8, 6), toon(0x8a5a3b)), 0.03);
trunk.position.y = 0.4;
const leaves1 = outlined(new THREE.Mesh(new THREE.ConeGeometry(0.75, 1.1, 7), toon(0x4fae6b)), 0.035);
leaves1.position.y = 1.15;
const leaves2 = outlined(new THREE.Mesh(new THREE.ConeGeometry(0.55, 0.85, 7), toon(0x5fc27a)), 0.035);
leaves2.position.y = 1.65;
tree.add(trunk, leaves1, leaves2);
tree.position.set(1.95, 0, -1.25);
world.add(tag(tree, "tree"));

// 小床：昨晚睡眠
const bed = new THREE.Group();
const frame = outlined(new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.28, 1.05), toon(0xc28a5c)), 0.035);
frame.position.y = 0.14;
const head = outlined(new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.7, 1.05), toon(0xb07a4f)), 0.035);
head.position.set(-0.95, 0.35, 0);
const mattress = outlined(new THREE.Mesh(new THREE.BoxGeometry(1.78, 0.14, 0.95), toon(0xfff6ea)), 0.03);
mattress.position.y = 0.35;
const pillow = outlined(new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.12, 0.62), toon(0xffffff)), 0.03);
pillow.position.set(-0.68, 0.48, 0);
const blanket = outlined(new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.08, 0.99), toon(0xff8a6b)), 0.03);
blanket.position.set(0.3, 0.45, 0);
bed.add(frame, head, mattress, pillow, blanket);
bed.position.set(-1.55, 0, -0.85);
bed.rotation.y = 0.35;
world.add(tag(bed, "bed"));

// 床头小灯：晚上亮
const lamp = new THREE.Group();
const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.9, 5), toon(0x6b5446));
pole.position.y = 0.45;
const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffe9a8 }));
bulb.position.y = 0.98;
const lampLight = new THREE.PointLight(0xffc870, 0, 4, 1.5);
lampLight.position.y = 1.0;
lamp.add(pole, bulb, lampLight);
lamp.position.set(-2.55, 0, 0.05);
world.add(lamp);

// 花：今天的活动量，开花数 = strain（0–21）
const flowers = new THREE.Group();
const PETALS = [0xff8fab, 0xffd166, 0xc3a6ff, 0xff9e7a, 0x8fd3ff, 0xffffff];
const flowerList = [];
for (let i = 0; i < 21; i++) {
  const a = (i / 21) * Math.PI * 2 + 0.15;
  const r = 2.62 + (i % 2) * 0.22;
  const f = new THREE.Group();
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.34, 4), toon(0x3f9a55));
  stem.position.y = 0.17;
  const bloom = outlined(new THREE.Mesh(new THREE.IcosahedronGeometry(0.13, 0), toon(PETALS[i % PETALS.length])), 0.025);
  bloom.position.y = 0.38;
  const bud = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 4), toon(0x5fae5f));
  bud.position.y = 0.36;
  f.add(stem, bloom, bud);
  f.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
  f.userData.phase = Math.random() * Math.PI * 2;
  flowers.add(f);
  flowerList.push({ f, bloom, bud, open: 0, target: 0 });
}
world.add(tag(flowers, "flowers"));

/* ---------------------------------------------------------------- pet */
const petRoot = new THREE.Group();
const petBody = new THREE.Group();
petRoot.add(petBody);
world.add(petRoot);
let petMesh = null, petHeight = 1.5, palette = null, paletteAlt = null;

const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.75, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.16, depthWrite: false }));
shadow.rotation.x = -Math.PI / 2;
shadow.position.y = 0.01;
shadow.scale.set(1, 1.6, 1);
petRoot.add(shadow);

// 电量水晶：恢复
const crystalMat = toon(0xf4b33a, { emissive: 0xf4b33a, emissiveIntensity: 0.55 });
const crystal = outlined(new THREE.Mesh(new THREE.OctahedronGeometry(0.26, 0), crystalMat), 0.03);
crystal.scale.y = 1.5;
const crystalLight = new THREE.PointLight(0xf4b33a, 2.5, 3.5, 1.5);
const crystalWrap = new THREE.Group();
crystalWrap.add(crystal, crystalLight);
world.add(tag(crystalWrap, "crystal"));

const loadTex = (url) => new Promise((ok, bad) => new THREE.TextureLoader().load(url, (t) => {
  t.colorSpace = THREE.SRGBColorSpace; t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; ok(t);
}, undefined, bad));
const loadObj = (url) => new Promise((ok, bad) => new OBJLoader().load(url, ok, undefined, bad));

/* ---------------------------------------------------------------- sprites: Zzz, sparkles */
function textSprite(text, color, size = 64) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  g.font = `800 ${size * 0.8}px Nunito, sans-serif`;
  g.textAlign = "center"; g.textBaseline = "middle";
  g.lineWidth = size * 0.1; g.strokeStyle = "#ffffff"; g.strokeText(text, size / 2, size / 2);
  g.fillStyle = color; g.fillText(text, size / 2, size / 2);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false }));
  s.raycast = () => {};
  return s;
}
const zzz = [0, 1, 2].map(() => { const s = textSprite("Z", "#6f7ad6"); s.visible = false; world.add(s); return s; });
const sparks = Array.from({ length: 7 }, () => { const s = textSprite("✦", "#ffc93c"); s.visible = false; world.add(s); return s; });

/* ---------------------------------------------------------------- lights */
const hemi = new THREE.HemisphereLight(0xdff3ff, 0x6f8f5a, 1.6);
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(5, 8, 6);
// 跟着相机的柔光，保证小浣熊在夜里也看得清
const fill = new THREE.DirectionalLight(0xffffff, 0.6);
fill.position.set(0, 0.4, 1);
camera.add(fill);
scene.add(hemi, sun, camera);

const SKY = {
  dawn: { hemi: [0xffd9c2, 0x7f9a66, 1.5], sun: [0xffb07a, 2.0], lamp: 0.4 },
  day: { hemi: [0xe3f4ff, 0x76a060, 1.7], sun: [0xffffff, 2.3], lamp: 0 },
  dusk: { hemi: [0xffc1a8, 0x6a7f5a, 1.3], sun: [0xff9a6b, 1.7], lamp: 1.2 },
  night: { hemi: [0x6a74c8, 0x253a4a, 1.0], sun: [0xaab8ff, 0.7], lamp: 3.2 },
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
  fill.intensity = k === "night" ? 1.4 : k === "day" ? 0.4 : 0.8;
  bulb.material.color.setHex(s.lamp > 1 ? 0xffe08a : 0xf3eee0);
}

/* ---------------------------------------------------------------- state from data */
const BAND_HEX = { green: 0x3fbf7f, yellow: 0xf4b33a, red: 0xef5d5d };
let mood = "chill", recovery = 50;

function update() {
  const N = window.NEST;
  if (!N || !N.data) return;
  const d = N.data;
  mood = N.mood || "chill";
  const t = d.today || {};
  recovery = t.recovery ?? 50;
  const c = BAND_HEX[t.band] ?? 0xb9a89c;
  crystalMat.color.setHex(c); crystalMat.emissive.setHex(c); crystalLight.color.setHex(c);
  const k = 0.65 + 0.75 * (recovery / 100);
  crystal.scale.set(k, k * 1.5, k);
  crystalLight.intensity = 1 + 3 * (recovery / 100);
  const n = Math.max(0, Math.min(21, Math.round(t.strain || 0)));
  flowerList.forEach((x, i) => { x.target = i < n ? 1 : 0; });
  if (petMesh) petMesh.material.map = mood === "happy" && paletteAlt ? paletteAlt : palette;
  applySky(hisHour(d));
  placePet();
}
addEventListener("nest:update", update);
setInterval(() => window.NEST && applySky(hisHour(window.NEST.data)), 60000);

function placePet() {
  if (mood === "sleep") {
    // 躺到床上
    petRoot.position.copy(bed.position).add(new THREE.Vector3(0.12, 0.42, 0));
    petRoot.rotation.set(0, bed.rotation.y + Math.PI / 2, 0);
    petRoot.scale.setScalar(0.62);
    shadow.visible = false;
  } else {
    petRoot.position.set(0.35, 0, 0.75);
    petRoot.rotation.set(0, -0.35, 0);
    petRoot.scale.setScalar(1);
    shadow.visible = true;
  }
}

/* ---------------------------------------------------------------- tap */
const ray = new THREE.Raycaster();
let downAt = null, pokeT = -10;
renderer.domElement.addEventListener("pointerdown", (e) => { downAt = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener("pointerup", (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 8) return;
  const r = renderer.domElement.getBoundingClientRect();
  ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
  const hit = ray.intersectObjects(tappables, true)[0];
  if (!hit) return;
  const what = hit.object.userData.what;
  if (what === "pet") pokeT = clock.elapsedTime;
  dispatchEvent(new CustomEvent("nest:tap", { detail: { what, x: e.clientX, y: e.clientY } }));
});

/* ---------------------------------------------------------------- loop */
const clock = new THREE.Clock();
let visible = true, last = 0;
new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(host);

function resize() {
  const w = host.clientWidth, h = host.clientHeight;
  if (!w || !h) return;
  renderer.setPixelRatio(pixelMode ? 1 / PIXEL : Math.min(devicePixelRatio || 1, 2));
  renderer.setSize(w, h);
  renderer.domElement.style.imageRendering = pixelMode ? "pixelated" : "auto";
  camera.aspect = w / h;
  camera.position.setLength(w < 500 ? 13.5 : 11.5);
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(host);

function animate(t) {
  const sleep = mood === "sleep";
  // 宠物
  let y = 0, sx = 1, sy = 1, rz = 0, rx = 0;
  if (sleep || mood === "tired") {
    const b = Math.sin(t * 1.7) * 0.5 + 0.5;
    sy = 0.93 + b * 0.05; sx = 1.02 + b * 0.02;
    rx = sleep ? 0 : 0.12;
  } else if (mood === "happy") {
    const p = (t * 1.6) % 1;
    y = Math.max(0, Math.sin(p * Math.PI)) * 0.55;
    const squash = p < 0.12 || p > 0.9 ? 0.12 : 0;
    sx = 1 + squash; sy = 1 - squash;
  } else {
    rz = Math.sin(t * 1.9) * 0.06;
    sy = 1 + Math.sin(t * 3.8) * 0.015;
  }
  const dp = t - pokeT;
  let spin = 0;
  if (dp < 0.7) { y += Math.sin((dp / 0.7) * Math.PI) * 0.8; spin = (dp / 0.7) * Math.PI * 2; }
  petBody.position.y = y;
  petBody.scale.set(sx, sy, sx);
  petBody.rotation.set(rx, spin, rz);
  if (sleep) petBody.rotation.z = Math.PI / 2 * 0.98, petBody.position.y = 0.0;
  shadow.scale.set(1 - y * 0.4, 1.6 - y * 0.6, 1);

  // 水晶
  const top = petRoot.position.y + petHeight * petRoot.scale.y;
  crystalWrap.position.set(sleep ? 0.2 : petRoot.position.x - 0.1, (sleep ? 1.9 : top + 0.75) + Math.sin(t * 2) * 0.08, sleep ? 0.6 : petRoot.position.z - 0.2);
  crystal.rotation.y = t * 1.2;

  // 花
  for (const x of flowerList) {
    x.open += (x.target - x.open) * 0.05;
    x.bloom.scale.setScalar(Math.max(0.001, x.open));
    x.bud.visible = x.open < 0.5;
    x.f.rotation.z = Math.sin(t * 1.5 + x.f.userData.phase) * 0.08;
  }

  // Zzz
  zzz.forEach((s, i) => {
    s.visible = sleep || mood === "tired";
    if (!s.visible) return;
    const p = ((t * 0.35 + i / 3) % 1);
    const base = petRoot.position.clone();
    s.position.set(base.x + 0.4 + p * 0.6, base.y + (sleep ? 0.6 : petHeight * 0.9) + p * 1.3, base.z + 0.2);
    s.material.opacity = Math.sin(p * Math.PI);
    s.scale.setScalar(0.25 + p * 0.25);
  });
  // 星星
  sparks.forEach((s, i) => {
    s.visible = mood === "happy";
    if (!s.visible) return;
    const a = t * 0.8 + (i / sparks.length) * Math.PI * 2;
    s.position.set(petRoot.position.x + Math.cos(a) * 1.3, 0.6 + (i % 3) * 0.45 + Math.sin(t * 2 + i) * 0.1, petRoot.position.z + Math.sin(a) * 1.3);
    const tw = Math.sin(t * 4 + i * 1.7) * 0.5 + 0.5;
    s.material.opacity = tw; s.scale.setScalar(0.18 + tw * 0.14);
  });
}

function loop(now) {
  requestAnimationFrame(loop);
  if (!visible || document.hidden) return;
  if (now - last < 1000 / 40) return; // 最多 40fps，省电
  last = now;
  const t = clock.getElapsedTime();
  if (!REDUCED) animate(t); else animate(0);
  controls.update();
  renderer.render(scene, camera);
}

/* ---------------------------------------------------------------- pixel / HD toggle */
const btn = document.getElementById("px-toggle");
function syncBtn() { if (btn) btn.textContent = pixelMode ? "像素" : "高清"; }
if (btn) btn.addEventListener("click", () => { pixelMode = !pixelMode; store.set("nest.pixel", pixelMode ? "px" : "hd"); syncBtn(); resize(); });
syncBtn();

/* ---------------------------------------------------------------- boot */
(async () => {
  const [obj, pal, palAlt] = await Promise.all([
    loadObj("assets/3d/monster_48.obj"), loadTex("assets/3d/monster_48.png"), loadTex("assets/3d/monster_48_alt.png").catch(() => null),
  ]);
  palette = pal; paletteAlt = palAlt;
  const src = obj.children.find((c) => c.isMesh);
  const g = src.geometry;
  g.computeBoundingBox();
  const bb = g.boundingBox;
  const s = 1.5 / (bb.max.y - bb.min.y);
  g.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
  g.scale(s, s, s);
  petHeight = 1.5;
  petMesh = outlined(new THREE.Mesh(g, toon(0xffffff, { map: palette })), 0.04);
  petBody.add(tag(petMesh, "pet"));
  placePet();
  update();
  resize();
  requestAnimationFrame(loop);
  sceneEl.classList.add("has3d");
  sceneEl.classList.remove("loading3d");
})().catch((e) => { console.warn("3D 场景没加载成功，用 2D 版", e); host.remove(); });
