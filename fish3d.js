// 钓鱼小游戏的 Q 版模型（Three.js r170）：全部用基础几何体程序化搭出来，没有外部模型。
// 尺寸：每件渔获最长边约 0.5，包围盒中心在原点。
// 朝向：会游的鱼 / 虾 / 鲸 / 龟 头朝 +x（游动方向），+z 是身体侧面；
//       水母、章鱼、物件（靴子、瓶子、宝箱、贝壳、星星）脸 / 正面朝 +z，上方 +y。
// 材质和描边由调用方传进来的 toon() / outlined() 决定，和小岛保持一致。
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/* ---------------------------------------------------------------- catalog */
export const RARITY = {
  common: { name: "普通", color: "#8ea4ba", weight: 58 },
  rare: { name: "稀有", color: "#3fa2ff", weight: 27 },
  epic: { name: "史诗", color: "#b06bff", weight: 11 },
  legend: { name: "传说", color: "#ffa51f", weight: 4 },
};

// kind: "fish" = 会游（swim() 有效），"item" = 物件（swim() 什么都不做）
export const CATCH = {
  crucian: { name: "小鲫鱼", emoji: "🐟", rarity: "common", kind: "fish", color: 0xb3c8e8, belly: 0xf4f7fc, fin: 0x91abd9 },
  clown: { name: "小丑鱼", emoji: "🐠", rarity: "common", kind: "fish", color: 0xffa04a, stripe: 0xffffff, edge: 0x5a3a2c, fin: 0xff8a3a },
  puffer: { name: "河豚", emoji: "🐡", rarity: "common", kind: "fish", color: 0xffdd80, belly: 0xfffaf0, spot: 0xe8b75c, spike: 0xfff2c8, fin: 0xffc44a },
  shrimp: { name: "小虾", emoji: "🦐", rarity: "common", kind: "fish", color: 0xff9c88, stripe: 0xffc3b4 },
  boot: { name: "旧靴子", emoji: "👢", rarity: "common", kind: "item", color: 0xa97c5d, sole: 0x6f4f3b, cuff: 0x8d6248, weed: 0x7ccf78, patch: 0xd9b48a },
  koi: { name: "锦鲤", emoji: "🎏", rarity: "rare", kind: "fish", color: 0xfffaf3, patch: 0xff5e57, patch2: 0xffa14a, fin: 0xffe6da },
  jelly: { name: "小水母", emoji: "🪼", rarity: "rare", kind: "fish", color: 0xd9bcff, glow: 0xa77bff, core: 0xffd2f0, arm: 0xffc2e4 },
  octopus: { name: "小章鱼", emoji: "🐙", rarity: "rare", kind: "fish", color: 0xff9dba, spot: 0xffc9da },
  bottle: { name: "漂流瓶", emoji: "🍾", rarity: "rare", kind: "item", color: 0xbaf0e6, cork: 0xc99665, note: 0xfff3d2, ribbon: 0xff6b7a },
  whale: { name: "迷你鲸鱼", emoji: "🐳", rarity: "epic", kind: "fish", color: 0x84b8f3, belly: 0xf3f8ff, spout: 0xc4ecff },
  turtle: { name: "小海龟", emoji: "🐢", rarity: "epic", kind: "fish", color: 0x8ccf76, skin: 0xd2eba2, plate: 0xb8e69c, rim: 0x6db463 },
  chest: { name: "宝箱", emoji: "🧰", rarity: "epic", kind: "item", color: 0xc98a52, band: 0xffd25c, gem: 0xff6fae, coin: 0xffd84d },
  goldkoi: { name: "金锦鲤", emoji: "✨", rarity: "legend", kind: "fish", color: 0xffd347, patch: 0xfff3b8, fin: 0xffe9a0, glow: 0xffa800 },
  mermaid: { name: "小美人鱼的珍珠", emoji: "🦪", rarity: "legend", kind: "item", color: 0xffc3dc, inner: 0xfff2f7, pearl: 0xfffbfd, glow: 0xffa8dc },
  star: { name: "坠落的星星", emoji: "🌠", rarity: "legend", kind: "item", color: 0xffe066, glow: 0xffae00 },
};

// 按稀有度权重抽一条（rnd 返回 [0,1)）
export function rollCatch(rnd = Math.random) {
  const ids = Object.keys(CATCH);
  const w = ids.map((id) => RARITY[CATCH[id].rarity].weight / ids.filter((j) => CATCH[j].rarity === CATCH[id].rarity).length);
  let r = rnd() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < ids.length; i++) if ((r -= w[i]) < 0) return ids[i];
  return ids[0];
}

/* ---------------------------------------------------------------- shared bits */
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const lerp = (a, b, t) => a + (b - a) * t;
let SH = null;
function shared() {
  if (SH) return SH;
  SH = {
    dark: new THREE.MeshBasicMaterial({ color: 0x2b1d18 }),
    white: new THREE.MeshBasicMaterial({ color: 0xffffff }),
    blush: new THREE.MeshBasicMaterial({ color: 0xff8fa8, transparent: true, opacity: 0.55, depthWrite: false }),
    hi: new THREE.SphereGeometry(1, 8, 6),
    drop: new THREE.SphereGeometry(1, 6, 4),
  };
  return SH;
}

const ell = (rx, ry, rz, ws = 16, hs = 12) => new THREE.SphereGeometry(1, ws, hs).scale(rx, ry, rz);

// 单位球 → 前胖后瘦的椭球（x<0 那半收窄），法线按椭球近似重算，没有接缝
function eggify(g, rx, ry, rz, taper) {
  const p = g.attributes.position, n = g.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = x < 0 ? 1 - taper * x * x : 1;
    p.setXYZ(i, x * rx, y * ry * k, z * rz * k);
    const nx = x / rx, ny = y / (ry * k), nz = z / (rz * k), l = Math.hypot(nx, ny, nz) || 1;
    n.setXYZ(i, nx / l, ny / l, nz / l);
  }
  return g;
}
const egg = (rx, ry, rz, taper = 0.35, ws = 20, hs = 14) => eggify(new THREE.SphereGeometry(1, ws, hs), rx, ry, rz, taper);
// 单位球的下半片（肚皮）：theta 从 from·π 到 π
const capGeo = (from = 0.6, ws = 20) => new THREE.SphereGeometry(1, ws, 5, 0, Math.PI * 2, Math.PI * from, Math.PI * (1 - from));
// 单位球上 x ∈ [xa, xb] 的一圈（条纹）
function bandGeo(xa, xb, ws = 20) {
  const t0 = Math.acos(Math.min(1, xb)), t1 = Math.acos(Math.max(-1, xa));
  return new THREE.SphereGeometry(1, ws, 3, 0, Math.PI * 2, t0, t1 - t0).rotateZ(-Math.PI / 2);
}

// 椭球侧面上的点：fx / fy 是相对半径的坐标，s = ±1 选 +z / -z 那面
function side(R, fx, fy, s = 1) {
  const p = V(fx * R[0], fy * R[1], s * R[2] * Math.sqrt(Math.max(0, 1 - fx * fx - fy * fy)));
  return { p, n: V(p.x / R[0] ** 2, p.y / R[1] ** 2, p.z / R[2] ** 2).normalize() };
}
// 椭球表面沿方向 d 的点
function surf(R, dx, dy, dz) {
  const d = V(dx, dy, dz).normalize();
  const p = d.multiplyScalar(1 / Math.hypot(d.x / R[0], d.y / R[1], d.z / R[2]));
  return { p, n: V(p.x / R[0] ** 2, p.y / R[1] ** 2, p.z / R[2] ** 2).normalize() };
}
const _m = new THREE.Matrix4(), _o = V(), _up = V();
function orient(obj, n) { // 让 obj 的本地 +z 朝 n
  _up.set(0, 1, 0);
  if (Math.abs(n.y) > 0.95) _up.set(1, 0, 0);
  _m.lookAt(n, _o.set(0, 0, 0), _up);
  obj.quaternion.setFromRotationMatrix(_m);
  return obj;
}
function put(obj, sp, lift = 0) { obj.position.copy(sp.p).addScaledVector(sp.n, lift); return orient(obj, sp.n); }

// 黑豆眼 + 两个高光（本地 +z 朝外）；s = -1 时高光镜像，鱼两边的高光都朝前
function eye(r, s = 1) {
  const S = shared();
  const g = new THREE.Group();
  const ball = new THREE.Mesh(ell(r, r * 1.12, r * 0.55, 14, 10), S.dark);
  const h1 = new THREE.Mesh(S.hi, S.white);
  h1.scale.setScalar(r * 0.36);
  h1.position.set(s * r * 0.3, r * 0.42, r * 0.4);
  const h2 = new THREE.Mesh(S.hi, S.white);
  h2.scale.setScalar(r * 0.17);
  h2.position.set(-s * r * 0.3, -r * 0.4, r * 0.42);
  g.add(ball, h1, h2);
  return g;
}
const blushMesh = (r) => new THREE.Mesh(ell(r, r * 0.62, r * 0.25, 10, 6), shared().blush);
function smile(r, tube = 0.006, arc = Math.PI) {
  const m = new THREE.Mesh(new THREE.TorusGeometry(r, tube, 5, 12, arc), shared().dark);
  m.rotation.z = Math.PI + (Math.PI - arc) / 2; // ∪
  return m;
}

// 一条渐细的管子（触手、须、海草）
function taperTube(pts, r0, r1, tub = 10, rad = 6) {
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => V(...p)));
  const g = new THREE.TubeGeometry(curve, tub, 1, rad, false);
  const p = g.attributes.position, c = V(), v = V();
  for (let j = 0; j <= tub; j++) {
    curve.getPointAt(j / tub, c);
    const r = lerp(r0, r1, j / tub);
    for (let i = 0; i <= rad; i++) {
      const idx = j * (rad + 1) + i;
      v.fromBufferAttribute(p, idx).sub(c).multiplyScalar(r).add(c);
      p.setXYZ(idx, v.x, v.y, v.z);
    }
  }
  return g;
}

// 四角小闪光（立体的，任何角度都看得到）
let STAR4 = null;
function star4Geo() {
  if (STAR4) return STAR4;
  const ring = [];
  for (let i = 0; i < 8; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / 4, r = i % 2 ? 0.26 : 1;
    ring.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  const pos = [];
  for (let i = 0; i < 8; i++) {
    const a = ring[i], b = ring[(i + 1) % 8];
    pos.push(0, 0, 0.2, a[0], a[1], 0, b[0], b[1], 0);
    pos.push(0, 0, -0.2, b[0], b[1], 0, a[0], a[1], 0);
  }
  STAR4 = new THREE.BufferGeometry();
  STAR4.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  return STAR4;
}
let HALO = null;
function haloTex() {
  if (HALO) return HALO;
  const cv = document.createElement("canvas");
  cv.width = cv.height = 64;
  const g = cv.getContext("2d");
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, "rgba(255,255,255,1)");
  gr.addColorStop(0.35, "rgba(255,255,255,0.55)");
  gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  HALO = new THREE.CanvasTexture(cv);
  HALO.colorSpace = THREE.SRGBColorSpace;
  return HALO;
}
function addHalo(o, color, size, opacity = 0.5) {
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex(), color, transparent: true, opacity, depthWrite: false }));
  sp.scale.setScalar(size);
  sp.userData.base = opacity;
  sp.raycast = () => {};
  o.sway.add(sp);
  o.halo = sp;
}
function addSparkles(o, n, rad, color = 0xfff6b0, seed = 3) {
  const mat = new THREE.MeshBasicMaterial({ color });
  let s = seed;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(star4Geo(), mat);
    const a = (i / n) * Math.PI * 2 + rnd() * 0.6, y = (rnd() - 0.5) * rad * 1.1;
    const r = rad * (0.8 + rnd() * 0.35);
    m.position.set(Math.cos(a) * r, y, Math.sin(a) * r * 0.6 + 0.05);
    m.userData.ph = rnd() * 6.28;
    m.userData.s = 0.022 + rnd() * 0.018;
    m.raycast = () => {};
    o.sway.add(m);
    o.sparkles.push(m);
  }
}

// 半透明的东西（水母、玻璃瓶）：描边放到透明队列里、排在本体之后，就只在轮廓上可见
function glassy(mesh, outlined, line) {
  mesh.renderOrder = 2;
  outlined(mesh, line);
  const ol = mesh.children[mesh.children.length - 1];
  ol.material.transparent = true;
  ol.renderOrder = 3;
  return mesh;
}

/* ---------------------------------------------------------------- fish parts */
function fishEyes(o, R, fx, fy, r) {
  o.eyes = [1, -1].map((s) => {
    const e = eye(r, s);
    put(e, side(R, fx, fy, s), -r * 0.12);
    o.body.add(e);
    return e;
  });
}
function sideBlush(o, R, fx, fy, r) {
  for (const s of [1, -1]) o.body.add(put(blushMesh(r), side(R, fx, fy, s), 0.002));
}
function lips(o, k, R, color = 0xff8fa3, r = 0.016, fy = -0.15) {
  const l = k.mk(new THREE.TorusGeometry(r, r * 0.5, 6, 12), color, 0);
  l.rotation.y = Math.PI / 2;
  l.position.set(R[0] * 0.975, fy * R[1], 0);
  o.body.add(l);
  return l;
}
function dorsal(o, k, R, color, L = 0.08, H = 0.055, x = -0.01, tilt = -0.3) {
  const d = k.mk(ell(L, H, 0.011, 12, 8), color, 0.008);
  d.position.set(x, R[1] * 0.9, 0);
  d.rotation.z = tilt;
  o.body.add(d);
  return d;
}
function pecFins(o, k, R, fx, fy, color, L = 0.055, W = 0.032) {
  for (const s of [1, -1]) {
    const piv = new THREE.Group();
    piv.position.copy(side(R, fx, fy, s).p);
    piv.rotation.z = 0.55;
    piv.userData.s = s;
    const f = k.mk(ell(L, W, 0.01, 10, 6), color, 0.008);
    f.position.x = -L * 0.85;
    piv.add(f);
    o.body.add(piv);
    o.fins.push(piv);
  }
}
function tailFan(k, L, spread, color, thick = 0.012, line = 0.009) {
  const g = new THREE.Group();
  for (const s of [1, -1]) {
    const lobe = k.mk(ell(L * 0.5, L * 0.23, thick, 12, 8), color, line);
    lobe.position.set(-L * 0.42 * Math.cos(spread), s * L * 0.42 * Math.sin(spread), 0);
    lobe.rotation.z = -s * spread;
    g.add(lobe);
  }
  return g;
}
function addTail(o, x, y = 0) {
  const t = new THREE.Group();
  t.position.set(x, y, 0);
  o.body.add(t);
  o.tail = t;
  return t;
}

/* ---------------------------------------------------------------- builders */
const B = {};

B.crucian = (o, k, C) => {
  const R = [0.18, 0.12, 0.075], T = 0.35;
  o.body.add(k.mk(egg(...R, T), C.color, 0.013));
  o.body.add(k.mk(eggify(capGeo(0.6), R[0] * 1.012, R[1] * 1.012, R[2] * 1.04, T), C.belly, 0));
  // 背上一道浅色亮光
  const glint = new THREE.Mesh(ell(0.05, 0.012, 0.006, 8, 4), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75 }));
  put(glint, side(R, 0.05, 0.55, 1), 0.001);
  glint.rotateZ(0.12);
  o.body.add(glint);
  fishEyes(o, R, 0.58, 0.2, 0.046);
  sideBlush(o, R, 0.3, -0.3, 0.026);
  lips(o, k, R);
  dorsal(o, k, R, C.fin);
  pecFins(o, k, R, 0.22, -0.35, C.fin);
  addTail(o, -R[0] * 0.86).add(tailFan(k, 0.16, 0.55, C.fin));
};

B.clown = (o, k, C) => {
  const R = [0.16, 0.13, 0.082], T = 0.3;
  o.body.add(k.mk(egg(...R, T), C.color, 0.013));
  for (const [a, b] of [[0.18, 0.36], [-0.2, 0.0], [-0.74, -0.62]]) {
    o.body.add(k.mk(eggify(bandGeo(a - 0.035, b + 0.035), R[0] * 1.02, R[1] * 1.02, R[2] * 1.03, T), C.edge, 0));
    o.body.add(k.mk(eggify(bandGeo(a, b), R[0] * 1.025, R[1] * 1.03, R[2] * 1.045, T), C.stripe, 0));
  }
  fishEyes(o, R, 0.6, 0.2, 0.046);
  sideBlush(o, R, 0.5, -0.38, 0.022);
  lips(o, k, R, 0xff7f6e);
  const d = dorsal(o, k, R, C.fin, 0.09, 0.05, -0.02, -0.15);
  d.add(k.mk(ell(0.02, 0.05, 0.012, 8, 6), C.stripe, 0)).position.set(-0.01, 0, 0);
  pecFins(o, k, R, 0.25, -0.35, C.fin);
  const tail = addTail(o, -R[0] * 0.86);
  tail.add(tailFan(k, 0.14, 0.6, C.fin));
};

B.puffer = (o, k, C) => {
  const R0 = 0.17;
  const torso = k.mk(new THREE.SphereGeometry(R0, 22, 16), C.color, 0.013);
  const belly = new THREE.Mesh(capGeo(0.58).scale(R0 * 1.01, R0 * 1.01, R0 * 1.01), k.mat(C.belly));
  torso.add(belly);
  for (const d of [[-0.2, 1, 0.3], [0.25, 0.9, -0.4], [-0.5, 0.6, 0.7], [-0.55, 0.65, -0.65], [0.1, 0.7, 0.75], [0.15, 0.75, -0.7]]) {
    const sp = new THREE.Mesh(ell(0.026, 0.026, 0.008, 8, 6), k.mat(C.spot));
    put(sp, surf([R0, R0, R0], ...d), 0.0);
    torso.add(sp);
  }
  // 刺：合成一个网格，挂在身体里。瘪的时候缩进身体里看不见，鼓起来才冒出来
  const dirs = [];
  const N = 30;
  for (let i = 0; i < N; i++) {
    const y = 1 - (2 * (i + 0.5)) / N, r = Math.sqrt(1 - y * y), a = i * 2.39996;
    const d = V(Math.cos(a) * r, y, Math.sin(a) * r);
    if (d.x > 0.45 || d.y < -0.85) continue; // 脸和肚子底不长刺
    dirs.push(d);
  }
  const spikeGeos = dirs.map((d) => {
    const g = new THREE.ConeGeometry(0.018, 0.05, 5).rotateX(Math.PI / 2).translate(0, 0, R0 + 0.012);
    return g.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), d)));
  });
  const spikes = k.mk(mergeGeometries(spikeGeos), C.spike, 0.006);
  torso.add(spikes);
  o.body.add(torso);

  const eyes = [1, -1].map((s) => { const e = eye(0.05, s); o.body.add(e); return e; });
  const blush = [1, -1].map(() => { const b = blushMesh(0.028); o.body.add(b); return b; });
  const mouth = k.mk(new THREE.TorusGeometry(0.016, 0.008, 6, 12), 0xff8fa3, 0);
  o.body.add(mouth);
  const fins = [1, -1].map((s) => {
    const piv = new THREE.Group();
    piv.rotation.z = 0.4;
    piv.userData.s = s;
    const f = k.mk(ell(0.045, 0.03, 0.009, 10, 6), C.fin, 0.008);
    f.position.x = -0.04;
    piv.add(f);
    o.body.add(piv);
    o.fins.push(piv);
    return piv;
  });
  const top = k.mk(ell(0.05, 0.04, 0.009, 10, 6), C.fin, 0.008);
  top.rotation.z = -0.4;
  o.body.add(top);
  const tail = addTail(o, 0);
  tail.add(tailFan(k, 0.1, 0.6, C.fin, 0.01, 0.008));

  // k = 0 瘪着（扁扁的椭圆），1 = 气鼓鼓的大圆球
  o.puff = (p) => {
    p = Math.min(1, Math.max(0, p));
    const s = [lerp(1.08, 1.3, p), lerp(0.82, 1.3, p), lerp(0.78, 1.3, p)];
    torso.scale.set(...s);
    spikes.scale.setScalar(lerp(0.7, 1, p));
    const R = s.map((v) => v * R0);
    const ek = 1 + 0.12 * p;
    eyes.forEach((e, i) => { const sg = i ? -1 : 1; put(e, surf(R, 0.62, 0.38, sg * 0.68), -0.006); e.scale.setScalar(ek); });
    blush.forEach((b, i) => put(b, surf(R, 0.55, -0.2, (i ? -1 : 1) * 0.8), 0.003));
    mouth.position.set(R[0] * 0.985, -R[1] * 0.12, 0);
    mouth.rotation.set(0, Math.PI / 2, 0);
    mouth.scale.set(1, lerp(1, 0.7, p), 1); // 鼓起来嘴变成小 o
    fins.forEach((f) => f.position.copy(surf(R, 0.2, -0.3, f.userData.s).p));
    top.position.set(-R[0] * 0.25, R[1] * 0.96, 0);
    top.scale.setScalar(1 - 0.3 * p);
    o.tail.position.set(-R[0] * 0.96, 0, 0);
    o.puffK = p;
  };
  o.puff(0);
};

B.shrimp = (o, k, C) => {
  const segs = [ // [x, y, r]，从头往尾巴卷
    [0.035, 0.045, 0.072], [-0.045, 0.035, 0.066], [-0.11, 0.005, 0.058],
    [-0.155, -0.045, 0.049], [-0.175, -0.1, 0.04], [-0.17, -0.15, 0.032]];
  const head = k.mk(ell(0.1, 0.07, 0.068, 16, 12), C.color, 0.012);
  head.position.set(0.12, 0.05, 0);
  head.rotation.z = 0.12;
  o.body.add(head);
  const rost = k.mk(new THREE.ConeGeometry(0.018, 0.08, 6).rotateZ(-Math.PI / 2), C.color, 0.007);
  rost.position.set(0.225, 0.085, 0);
  rost.rotation.z = 0.35;
  o.body.add(rost);
  const tail = addTail(o, segs[2][0], segs[2][1]);
  segs.forEach(([x, y, r], i) => {
    const m = k.mk(ell(r, r * 0.95, r * 0.92, 14, 10), i % 2 ? C.stripe : C.color, 0.011);
    if (i >= 3) { m.position.set(x - segs[2][0], y - segs[2][1], 0); tail.add(m); } else { m.position.set(x, y, 0); o.body.add(m); }
  });
  // 尾扇
  const fan = new THREE.Group();
  fan.position.set(-0.165 - segs[2][0], -0.18 - segs[2][1], 0);
  for (const a of [-0.55, 0, 0.55]) {
    const l = k.mk(ell(0.045, 0.02, 0.01, 10, 6), C.stripe, 0.007);
    l.position.set(Math.cos(a + 0.6) * 0.035, -Math.sin(a + 0.6) * 0.035 * 0.3 - 0.015, 0);
    l.rotation.z = -(a + 0.6) - 0.3;
    fan.add(l);
  }
  tail.add(fan);
  // 小腿
  for (const [x, y] of [[0.06, -0.025], [0.0, -0.035], [-0.06, -0.035]]) {
    const leg = k.mk(new THREE.CylinderGeometry(0.008, 0.006, 0.05, 5), C.stripe, 0);
    leg.position.set(x, y - 0.015, 0.025);
    leg.rotation.z = -0.3;
    o.body.add(leg);
    o.legs = (o.legs || []).concat(leg);
  }
  // 眼睛（短眼柄上的大黑豆）
  o.eyes = [1, -1].map((s) => {
    const stalk = k.mk(new THREE.CylinderGeometry(0.009, 0.011, 0.04, 6), C.color, 0);
    stalk.position.set(0.15, 0.115, s * 0.03);
    stalk.rotation.set(s * -0.4, 0, -0.25);
    o.body.add(stalk);
    const e = eye(0.032, s);
    e.position.set(0.16, 0.14, s * 0.042);
    orient(e, V(0.35, 0.25, s).normalize());
    o.body.add(e);
    return e;
  });
  const hc = V(0.12, 0.05, 0);
  for (const s of [1, -1]) {
    const b = put(blushMesh(0.022), surf([0.1, 0.07, 0.068], 0.5, -0.3, s * 0.8));
    b.position.add(hc);
    o.body.add(b);
  }
  // 两根长须
  o.antennae = [1, -1].map((s) => {
    const piv = new THREE.Group();
    piv.position.set(0.2, 0.08, s * 0.02);
    piv.add(k.mk(taperTube([[0, 0, 0], [0.05, 0.08, s * 0.01], [0.0, 0.17, s * 0.03], [-0.12, 0.21, s * 0.05], [-0.22, 0.18, s * 0.06]], 0.006, 0.003, 14, 4), C.color, 0));
    o.body.add(piv);
    return piv;
  });
  o.tailAxis = "z";
  o.tailAmp = 0.22;
  o.onSwim = (w) => {
    o.antennae.forEach((a, i) => { a.rotation.z = Math.sin(w * 3 + i) * 0.08; });
    o.legs.forEach((l, i) => { l.rotation.z = -0.3 + Math.sin(w * 14 + i * 1.3) * 0.35; });
  };
};

B.boot = (o, k, C) => {
  const leg = k.mk(new THREE.CylinderGeometry(0.085, 0.095, 0.27, 14), C.color, 0.012);
  leg.position.set(-0.07, 0.235, 0);
  const foot = k.mk(new THREE.CapsuleGeometry(0.085, 0.18, 4, 12).rotateZ(Math.PI / 2), C.color, 0.012);
  foot.scale.set(1, 0.95, 1.08);
  foot.position.set(0.03, 0.09, 0);
  const toe = k.mk(ell(0.095, 0.075, 0.095, 14, 10), C.color, 0.012);
  toe.position.set(0.17, 0.085, 0);
  const sole = k.mk(new THREE.CapsuleGeometry(0.09, 0.27, 3, 12).rotateZ(Math.PI / 2), C.sole, 0.012);
  sole.scale.set(1, 0.24, 1.1);
  sole.position.set(0.06, 0.012, 0);
  const heel = k.mk(new THREE.BoxGeometry(0.1, 0.04, 0.17), C.sole, 0.01);
  heel.position.set(-0.08, 0.02, 0);
  const cuff = k.mk(new THREE.TorusGeometry(0.085, 0.022, 8, 18), C.cuff, 0.01);
  cuff.rotation.x = Math.PI / 2;
  cuff.position.set(-0.07, 0.37, 0);
  const hole = new THREE.Mesh(new THREE.CircleGeometry(0.075, 16), k.mat(0x4a3226));
  hole.rotation.x = -Math.PI / 2;
  hole.position.set(-0.07, 0.369, 0);
  o.body.add(leg, foot, toe, sole, heel, cuff, hole);
  // 补丁 + 鞋带
  const patch = k.mk(new THREE.BoxGeometry(0.06, 0.06, 0.012), C.patch, 0.006);
  patch.position.set(-0.07, 0.24, 0.093);
  patch.rotation.z = 0.2;
  o.body.add(patch);
  // 鞋带：鞋面正前方一排小叉
  const laceMat = k.mat(0xfff6ea);
  for (let i = 0; i < 3; i++) {
    for (const s of [1, -1]) {
      const lace = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.011, 0.085), laceMat);
      lace.position.set(0.024, 0.18 + i * 0.05, 0);
      lace.rotation.x = s * 0.55;
      o.body.add(lace);
    }
  }
  // 挂着的海草
  const weed = k.mk(taperTube([[-0.03, 0.37, 0.05], [0.0, 0.4, 0.07], [0.04, 0.33, 0.09], [0.035, 0.24, 0.1], [0.06, 0.17, 0.1]], 0.016, 0.009, 14, 5), C.weed, 0.006);
  const weed2 = k.mk(taperTube([[-0.12, 0.37, -0.02], [-0.16, 0.36, 0.02], [-0.18, 0.28, 0.03], [-0.17, 0.2, 0.06]], 0.013, 0.008, 10, 5), C.weed, 0.006);
  o.body.add(weed, weed2);
  // 一滴水
  const drip = new THREE.Group();
  const dr = new THREE.Mesh(new THREE.SphereGeometry(0.017, 10, 8), k.mat(0x9fd8ff));
  const dt = new THREE.Mesh(new THREE.ConeGeometry(0.017, 0.028, 10), k.mat(0x9fd8ff));
  dt.position.y = 0.017;
  drip.add(dr, dt);
  drip.position.set(0.24, 0.0, 0.05);
  o.body.add(drip);
  o.body.rotation.z = 0.08;
};

function koiLike(o, k, C, gold) {
  const R = [0.18, 0.105, 0.075], T = 0.45;
  const ex = gold ? { emissive: C.glow, emissiveIntensity: 0.32 } : null;
  const bodyMat = ex ? k.mat(C.color, ex) : k.mat(C.color);
  const finMat = ex ? k.mat(C.fin, { emissive: C.glow, emissiveIntensity: 0.22 }) : k.mat(C.fin);
  if (ex) o.glowMats.push(bodyMat, finMat);
  o.body.add(k.mk(egg(...R, T), bodyMat, 0.013));
  // 色斑：压扁的椭球贴在身体上
  const patches = gold
    ? [[[0.55, 0.85, 0.3], 0.05, C.patch], [[-0.15, 1, 0.5], 0.06, C.patch], [[-0.2, 0.9, -0.6], 0.06, C.patch], [[-0.55, 0.4, 0.9], 0.04, C.patch]]
    : [[[0.6, 1, 0], 0.055, C.patch], [[0.0, 1, 0.45], 0.065, C.patch2], [[-0.05, 0.95, -0.5], 0.06, C.patch2],
      [[-0.25, 0.35, 1], 0.055, C.patch], [[-0.15, 0.45, -1], 0.05, C.patch], [[-0.62, 0.7, 0.3], 0.04, C.patch]];
  for (const [d, a, c] of patches) {
    const m = new THREE.Mesh(ell(a, a * 0.75, a * 0.22, 12, 8), ex ? k.mat(c, { emissive: C.glow, emissiveIntensity: 0.15 }) : k.mat(c));
    const sp = surf(R, ...d);
    if (d[0] < 0) { const kk = 1 - T * (sp.p.x / R[0]) ** 2; sp.p.y *= kk; sp.p.z *= kk; } // 跟着后半身收窄
    put(m, sp, -a * 0.1);
    o.body.add(m);
  }
  fishEyes(o, R, 0.6, 0.18, 0.044);
  sideBlush(o, R, 0.34, -0.32, 0.024);
  lips(o, k, R, gold ? 0xff9a5a : 0xff8fa3, 0.015);
  // 两根小胡须
  for (const s of [1, -1]) {
    o.body.add(k.mk(taperTube([[R[0] * 0.95, -0.02, s * 0.012], [R[0] + 0.02, -0.035, s * 0.03], [R[0] + 0.01, -0.06, s * 0.045]], 0.005, 0.003, 6, 4), gold ? 0xffb347 : 0xffa07a, 0));
  }
  const d = k.mk(ell(0.11, 0.045, 0.011, 14, 8), finMat, 0.008);
  d.position.set(-0.04, R[1] * 0.88, 0);
  d.rotation.z = -0.12;
  o.body.add(d);
  pecFins(o, k, R, 0.2, -0.4, finMat, 0.07, 0.04);
  // 飘逸的长尾巴（蝴蝶锦鲤）
  const tail = addTail(o, -R[0] * 0.85);
  const fan = tailFan(k, 0.22, 0.42, finMat, 0.011, 0.009);
  tail.add(fan);
  const mid = k.mk(ell(0.06, 0.03, 0.012, 10, 6), finMat, 0.008);
  mid.position.x = -0.04;
  tail.add(mid);
  if (gold) {
    // 小皇冠，传说的身份
    const crown = new THREE.Group();
    const cm = k.mat(0xffe680, { emissive: 0xffb000, emissiveIntensity: 0.4 });
    o.glowMats.push(cm);
    const band = k.mk(new THREE.CylinderGeometry(0.03, 0.034, 0.02, 10, 1, true), cm, 0.005);
    band.material.side = THREE.DoubleSide;
    crown.add(band);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const sp = k.mk(new THREE.ConeGeometry(0.008, 0.022, 4), cm, 0);
      sp.position.set(Math.cos(a) * 0.031, 0.02, Math.sin(a) * 0.031);
      crown.add(sp);
    }
    const jewel = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 6), k.mat(0xff6fae, { emissive: 0xff3d8a, emissiveIntensity: 0.4 }));
    jewel.position.set(0.0, 0.0, 0.034);
    crown.add(jewel);
    crown.position.copy(surf(R, 0.55, 1, 0).p).add(V(0, 0.012, 0));
    crown.rotation.z = -0.35;
    crown.scale.setScalar(1.45);
    o.body.add(crown);
  }
}
B.koi = (o, k, C) => koiLike(o, k, C, false);
B.goldkoi = (o, k, C) => koiLike(o, k, C, true);

B.jelly = (o, k, C) => {
  const RB = [0.17, 0.15, 0.17];
  const bellMat = k.mat(C.color, { transparent: true, opacity: 0.62, emissive: C.glow, emissiveIntensity: 0.25 });
  o.glowMats.push(bellMat);
  const bellG = new THREE.Group();
  const bell = glassy(new THREE.Mesh(new THREE.SphereGeometry(1, 20, 9, 0, Math.PI * 2, 0, Math.PI * 0.58).scale(...RB), bellMat), k.outlined, 0.011);
  const coreMat = k.mat(C.core, { emissive: 0xff8fd0, emissiveIntensity: 0.5 });
  o.glowMats.push(coreMat);
  const core = new THREE.Mesh(ell(0.085, 0.065, 0.085, 14, 10), coreMat);
  core.position.y = 0.025;
  const rim = k.mk(new THREE.TorusGeometry(0.163, 0.017, 6, 26), 0xe8d6ff, 0.008);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = -0.037;
  bellG.add(core, bell, rim);
  // 顶上的小斑点
  for (const d of [[0.3, 1, 0.2], [-0.35, 0.9, 0.3], [0.05, 0.85, -0.5]]) {
    const sp = new THREE.Mesh(ell(0.022, 0.022, 0.006, 8, 6), k.mat(0xfff0ff));
    bellG.add(put(sp, surf(RB, ...d), 0.002));
  }
  o.eyes = [1, -1].map((s) => {
    const e = eye(0.034, 1);
    bellG.add(put(e, surf(RB, s * 0.36, 0.02, 1), 0.002));
    return e;
  });
  for (const s of [1, -1]) bellG.add(put(blushMesh(0.024), surf(RB, s * 0.62, -0.12, 1), 0.004));
  const sm = smile(0.016, 0.005);
  bellG.add(put(sm, surf(RB, 0, -0.08, 1), 0.003));
  sm.rotateZ(Math.PI);
  o.body.add(bellG);
  o.bell = bellG;
  // 触手：四根细的 + 两根粉色口腕
  o.tentacles = [];
  const addT = (x, z, pts, r0, r1, color) => {
    const piv = new THREE.Group();
    piv.position.set(x, -0.03, z);
    piv.add(k.mk(taperTube(pts, r0, r1, 12, 5), color, 0.005));
    o.body.add(piv);
    o.tentacles.push(piv);
  };
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    addT(Math.cos(a) * 0.11, Math.sin(a) * 0.11, [[0, 0, 0], [0.015, -0.07, 0], [-0.015, -0.14, 0], [0.012, -0.21, 0], [0, -0.26, 0]], 0.01, 0.004, 0xe9d4ff);
  }
  for (const s of [1, -1]) {
    addT(s * 0.035, 0.02, [[0, 0, 0], [s * 0.02, -0.06, 0.01], [-s * 0.01, -0.12, 0.0], [s * 0.015, -0.18, 0.01]], 0.022, 0.009, C.arm);
  }
  addHalo(o, C.glow, 0.75, 0.35);
  o.onSwim = (w) => {
    const p = Math.sin(w * 3);
    bellG.scale.set(1 - 0.06 * p, 1 + 0.08 * p, 1 - 0.06 * p);
    o.tentacles.forEach((t, i) => { t.rotation.z = Math.sin(w * 3 - 1 - i) * 0.18; t.rotation.x = Math.cos(w * 2.6 - i) * 0.12; });
    o.sway.position.y = Math.max(0, p) * 0.02;
  };
  o.tail = null;
};

B.octopus = (o, k, C) => {
  const RH = [0.15, 0.155, 0.145];
  const head = k.mk(egg(0.155, 0.15, 0.145, 0, 22, 16).rotateZ(Math.PI / 2), C.color, 0.013);
  head.position.y = 0.06;
  o.body.add(head);
  const hc = V(0, 0.06, 0);
  const at = (obj, d, lift = 0) => { put(obj, surf(RH, ...d), lift); obj.position.add(hc); o.body.add(obj); return obj; };
  for (const [d, r] of [[[0.4, 0.85, -0.4], 0.03], [[-0.5, 0.8, -0.2], 0.024], [[-0.15, 1, 0.3], 0.022], [[0.6, 0.7, 0.35], 0.018]]) {
    at(new THREE.Mesh(ell(r, r, r * 0.25, 10, 6), k.mat(C.spot)), d, 0.001);
  }
  o.eyes = [1, -1].map((s) => at(eye(0.045, 1), [s * 0.36, -0.08, 1], -0.004));
  for (const s of [1, -1]) at(blushMesh(0.03), [s * 0.66, -0.3, 1], 0.004);
  const mouth = k.mk(new THREE.TorusGeometry(0.014, 0.007, 6, 12), 0xff6f96, 0);
  at(mouth, [0, -0.36, 1], 0.004);
  // 六条卷卷的触手
  o.tentacles = [];
  const tg = taperTube([[0, 0, 0], [0.05, -0.06, 0], [0.12, -0.085, 0], [0.17, -0.055, 0], [0.18, -0.005, 0], [0.155, 0.02, 0]], 0.042, 0.009, 14, 7);
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3; // 正前方（+z）留空，露出小嘴
    const piv = new THREE.Group();
    piv.position.set(Math.cos(a) * 0.07, -0.04, Math.sin(a) * 0.07);
    piv.rotation.y = -a;
    piv.userData.base = 0;
    piv.add(k.mk(tg, C.color, 0.01));
    o.body.add(piv);
    o.tentacles.push(piv);
  }
  o.onSwim = (w) => {
    o.tentacles.forEach((t, i) => { t.rotation.z = Math.sin(w * 4 + i * 1.05) * 0.22; });
    o.sway.position.y = Math.sin(w * 2) * 0.015;
    head.scale.set(1 - 0.03 * Math.sin(w * 4), 1 + 0.04 * Math.sin(w * 4), 1);
  };
  o.tail = null;
};

B.bottle = (o, k, C) => {
  const prof = [[0, 0], [0.075, 0], [0.093, 0.016], [0.098, 0.045], [0.098, 0.2], [0.088, 0.24], [0.055, 0.268], [0.038, 0.295], [0.035, 0.335], [0.043, 0.345], [0.043, 0.362], [0.034, 0.37], [0, 0.37]];
  const lathe = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 14).rotateZ(-Math.PI / 2);
  const glassMat = k.mat(C.color, { transparent: true, opacity: 0.42 });
  const glass = glassy(new THREE.Mesh(lathe, glassMat), k.outlined, 0.01);
  const cork = k.mk(new THREE.CylinderGeometry(0.03, 0.036, 0.065, 12).rotateZ(-Math.PI / 2), C.cork, 0.008);
  cork.position.x = 0.385;
  // 卷起来的信 + 红丝带
  const note = k.mk(new THREE.CylinderGeometry(0.036, 0.036, 0.17, 14).rotateZ(Math.PI / 2), C.note, 0.007);
  note.position.set(0.135, -0.05, 0.0);
  note.rotation.y = 0.12;
  const curl = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.005, 5, 14), k.mat(0xe8d3a4));
  curl.rotation.y = Math.PI / 2;
  curl.position.x = 0.087;
  note.add(curl);
  const rib = k.mk(new THREE.TorusGeometry(0.038, 0.007, 6, 16), C.ribbon, 0);
  rib.rotation.y = Math.PI / 2;
  const bow = new THREE.Group();
  for (const s of [1, -1]) {
    const l = k.mk(ell(0.018, 0.011, 0.006, 8, 6), C.ribbon, 0.004);
    l.position.set(0, 0.012, s * 0.016);
    l.rotation.x = s * 0.5;
    bow.add(l);
  }
  bow.position.set(0, 0.036, 0);
  rib.add(bow);
  note.add(rib);
  // 玻璃上的高光
  const hl = new THREE.Mesh(ell(0.08, 0.009, 0.004, 10, 4), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }));
  hl.position.set(0.12, 0.062, 0.073);
  hl.rotation.x = -0.7;
  const hl2 = new THREE.Mesh(ell(0.012, 0.007, 0.004, 6, 4), hl.material);
  hl2.position.set(0.235, 0.058, 0.074);
  hl2.rotation.x = -0.7;
  // 一点点沙子
  const sand = new THREE.Mesh(ell(0.1, 0.025, 0.06, 12, 6), k.mat(0xffe4a8));
  sand.position.set(0.1, -0.082, 0);
  o.body.add(note, sand, cork, glass, hl, hl2);
  o.body.rotation.z = 0.18;
};

B.whale = (o, k, C) => {
  const R = [0.2, 0.15, 0.145], T = 0.55;
  o.body.add(k.mk(egg(...R, T), C.color, 0.014));
  o.body.add(k.mk(eggify(capGeo(0.58), R[0] * 1.012, R[1] * 1.012, R[2] * 1.03, T), C.belly, 0));
  fishEyes(o, R, 0.5, -0.12, 0.04);
  sideBlush(o, R, 0.45, -0.4, 0.028);
  for (const s of [1, -1]) {
    const sm = smile(0.03, 0.0055, Math.PI * 0.6);
    put(sm, side(R, 0.78, -0.3, s), 0.002);
    sm.rotateZ(Math.PI * 1.0 + 0.4 * s);
    o.body.add(sm);
  }
  // 小鳍
  for (const s of [1, -1]) {
    const piv = new THREE.Group();
    piv.position.copy(side(R, 0.15, -0.55, s).p);
    piv.rotation.set(0, 0, 0.7);
    piv.userData.s = s;
    const f = k.mk(ell(0.06, 0.02, 0.035, 10, 6), C.color, 0.008);
    f.position.set(-0.045, 0, s * 0.012);
    piv.add(f);
    o.body.add(piv);
    o.fins.push(piv);
  }
  // 尾巴：尾柄 + 横着的尾鳍（上下拍）
  const tail = addTail(o, -R[0] * 0.8, 0.015);
  const stalk = k.mk(egg(0.07, 0.042, 0.036, 0.5, 12, 8), C.color, 0.01);
  stalk.position.set(-0.04, 0.012, 0);
  stalk.rotation.z = -0.45;
  tail.add(stalk);
  // 尾鳍两片往上翘成 V，侧面看也认得出是鲸鱼尾巴
  const fl = new THREE.Group();
  fl.position.set(-0.095, 0.045, 0);
  fl.rotation.z = -0.55;
  for (const s of [1, -1]) {
    const lobe = new THREE.Group();
    lobe.rotation.x = -s * 0.75;
    const m = k.mk(ell(0.075, 0.015, 0.036, 12, 6), C.color, 0.009);
    const a = 0.7;
    m.position.set(-0.06 * Math.cos(a), 0, s * 0.06 * Math.sin(a));
    m.rotation.y = s * a;
    lobe.add(m);
    fl.add(lobe);
  }
  tail.add(fl);
  // 喷水
  const spout = new THREE.Group();
  spout.position.set(0.06, R[1] * 0.97, 0);
  const sm = k.mat(C.spout);
  const stem = k.mk(new THREE.CylinderGeometry(0.008, 0.014, 0.07, 8), sm, 0.006);
  stem.position.y = 0.035;
  spout.add(stem);
  for (const [x, y, r] of [[0, 0.08, 0.022], [-0.03, 0.07, 0.016], [0.03, 0.07, 0.016], [-0.045, 0.045, 0.011], [0.045, 0.045, 0.011]]) {
    const d = k.mk(new THREE.SphereGeometry(r, 10, 8), sm, 0.006);
    d.position.set(x, y, 0);
    spout.add(d);
  }
  o.body.add(spout);
  o.spout = spout;
  o.tailAxis = "z";
  o.tailAmp = 0.3;
  o.swayAxis = "z";
  o.onSwim = (w) => { spout.scale.set(1, 0.85 + 0.2 * Math.abs(Math.sin(w * 2.2)), 1); };
};

B.turtle = (o, k, C) => {
  const RS = [0.18, 0.12, 0.15];
  const shell = k.mk(new THREE.SphereGeometry(1, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(...RS), C.color, 0.013);
  shell.position.y = 0.0;
  const rim = k.mk(ell(0.195, 0.036, 0.165, 20, 8), C.rim, 0.011);
  o.body.add(shell, rim);
  // 龟壳上的小格子
  const plateG = new THREE.CylinderGeometry(1, 1, 1, 6).rotateX(Math.PI / 2);
  const plate = (d, a) => {
    const m = new THREE.Mesh(plateG, k.mat(C.plate));
    m.scale.set(a, a, 0.012);
    put(m, surf(RS, ...d), 0.0);
    o.body.add(m);
  };
  plate([0, 1, 0], 0.05);
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; plate([Math.cos(a) * 0.9, 0.55, Math.sin(a) * 0.9], 0.038); }
  // 头
  const head = new THREE.Group();
  head.position.set(0.16, 0.0, 0);
  const RHd = [0.075, 0.064, 0.064];
  const skull = k.mk(ell(...RHd, 16, 12), C.skin, 0.011);
  skull.position.set(0.06, 0.015, 0);
  head.add(skull);
  const hc = skull.position;
  o.eyes = [1, -1].map((s) => {
    const e = eye(0.03, s);
    put(e, side(RHd, 0.42, 0.2, s), -0.003);
    e.position.add(hc);
    head.add(e);
    return e;
  });
  for (const s of [1, -1]) {
    const b = put(blushMesh(0.018), side(RHd, 0.2, -0.38, s), 0.002);
    b.position.add(hc);
    head.add(b);
  }
  const sm = smile(0.016, 0.0045);
  sm.rotation.set(0, Math.PI / 2, Math.PI);
  sm.position.set(hc.x + RHd[0] * 0.97, hc.y - 0.022, 0);
  head.add(sm);
  o.body.add(head);
  o.head = head;
  // 四只鳍状脚
  const flipper = (x, z, L, W, dx, dz, s, front) => {
    const piv = new THREE.Group();
    piv.position.set(x, -0.01, z);
    piv.userData.s = s;
    piv.userData.front = front;
    const f = k.mk(ell(L, 0.016, W, 12, 6), C.skin, 0.009);
    const b = Math.atan2(-dz, dx);
    f.rotation.y = b;
    f.position.set(dx * L * 0.85, 0, dz * L * 0.85);
    piv.add(f);
    o.body.add(piv);
    o.fins.push(piv);
  };
  for (const s of [1, -1]) {
    flipper(0.08, s * 0.12, 0.1, 0.042, -0.45, s * 0.89, s, true);
    flipper(-0.11, s * 0.1, 0.055, 0.032, -0.8, s * 0.6, s, false);
  }
  const tail = addTail(o, -0.18, -0.005);
  const tt = k.mk(new THREE.ConeGeometry(0.022, 0.05, 6).rotateZ(Math.PI / 2), C.skin, 0.007);
  tt.position.x = -0.02;
  tail.add(tt);
  o.tailAmp = 0.35;
  o.swayAmp = 0.4;
  o.onSwim = (w) => {
    for (const f of o.fins) {
      const s = f.userData.s;
      f.rotation.x = s * Math.sin(w * 4 + (f.userData.front ? 0 : 1.6)) * (f.userData.front ? 0.45 : 0.3);
      f.rotation.y = f.userData.front ? s * Math.cos(w * 4) * 0.25 : 0;
    }
    head.rotation.z = Math.sin(w * 2) * 0.08;
    head.position.x = 0.16 + Math.sin(w * 2) * 0.006;
  };
  o.finsCustom = true;
};

B.chest = (o, k, C) => {
  const W = 0.44, H = 0.2, D = 0.28, LR = D / 2;
  const box = k.mk(new THREE.BoxGeometry(W, H, D), C.color, 0.012);
  box.position.y = H / 2;
  o.body.add(box);
  const seam = new THREE.Mesh(new THREE.BoxGeometry(W * 0.98, 0.007, 0.004), k.mat(0x9a6438));
  seam.position.set(0, H * 0.5, D / 2 + 0.002);
  o.body.add(seam);
  const gold = k.mat(C.band, { emissive: 0x7a5200, emissiveIntensity: 0.15 });
  for (const x of [-0.15, 0.15]) {
    const b = k.mk(new THREE.BoxGeometry(0.045, H + 0.006, D + 0.012), gold, 0.006);
    b.position.set(x, H / 2, 0);
    o.body.add(b);
  }
  const trim = k.mk(new THREE.BoxGeometry(W + 0.014, 0.03, D + 0.014), gold, 0.006);
  trim.position.y = 0.015;
  o.body.add(trim);
  // 箱子里的宝贝：一堆金币（合成一个网格）+ 一颗发光宝石
  const coins = [];
  for (const [x, y, z, rx, rz] of [[0, 0.21, 0, 0, 0], [0.06, 0.212, 0.03, 0.2, 0.1], [-0.07, 0.21, -0.02, -0.1, 0.25], [0.02, 0.225, -0.04, 0.4, -0.2],
    [-0.03, 0.228, 0.04, -0.3, 0.1], [0.11, 0.208, -0.05, 0.1, 0.3], [-0.12, 0.208, 0.05, 0.2, -0.2], [0.0, 0.24, 0.0, 0.25, 0.35]]) {
    const g = new THREE.CylinderGeometry(0.034, 0.034, 0.01, 12);
    g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, 0, rz)));
    coins.push(g.translate(x, y, z));
  }
  o.body.add(k.mk(mergeGeometries(coins), k.mat(C.coin, { emissive: 0x7a5200, emissiveIntensity: 0.2 }), 0.005));
  const gemMat = k.mat(C.gem, { emissive: 0xff3d8a, emissiveIntensity: 0.45 });
  o.glowMats.push(gemMat);
  const gem = k.mk(new THREE.OctahedronGeometry(0.045, 0).scale(1, 1.3, 1), gemMat, 0.006);
  gem.position.set(0.0, 0.29, 0.0);
  gem.rotation.y = 0.5;
  o.body.add(gem);
  o.gem = gem;
  // 盖子：铰链在后上沿，lid.rotation.x 往负方向转就打开
  const lid = new THREE.Group();
  lid.position.set(0, H, -D / 2);
  const lidIn = new THREE.Group();
  lidIn.position.z = D / 2;
  const domeM = k.mat(C.color, { side: THREE.DoubleSide });
  const dome = k.mk(new THREE.CylinderGeometry(LR, LR, W, 16, 1, false, 0, Math.PI).rotateZ(Math.PI / 2), domeM, 0.012);
  lidIn.add(dome);
  for (const x of [-0.15, 0.15]) {
    const b = k.mk(new THREE.CylinderGeometry(LR + 0.006, LR + 0.006, 0.045, 16, 1, false, 0, Math.PI).rotateZ(Math.PI / 2), gold, 0.006);
    b.position.x = x;
    lidIn.add(b);
  }
  const lock = k.mk(new THREE.BoxGeometry(0.07, 0.075, 0.022), gold, 0.006);
  lock.position.set(0, -0.005, LR + 0.006);
  const key = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.01, 10).rotateX(Math.PI / 2), shared().dark);
  key.position.set(0, -0.002, 0.011);
  const slot = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.02, 0.01), shared().dark);
  slot.position.set(0, -0.014, 0.011);
  lock.add(key, slot);
  lidIn.add(lock);
  lid.add(lidIn);
  o.body.add(lid);
  o.lid = lid;
  o.openLid = (p) => { lid.rotation.x = -1.9 * Math.min(1, Math.max(0, p)); };
};

B.mermaid = (o, k, C) => {
  // 扇贝壳：半球压扁，沿着角度加起伏 → 一道道棱 + 波浪边
  const shellGeo = (top) => {
    const g = new THREE.SphereGeometry(1, 54, 7, 0, Math.PI * 2, top ? 0 : Math.PI / 2, Math.PI / 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const a = Math.atan2(x, z); // 0 = 正前方
      const h = Math.sqrt(1 - y * y); // 离壳顶的距离（0 顶点 → 1 边缘）
      const rib = Math.abs(Math.cos(a * 4.5)); // 9 道棱
      const fan = z < 0 ? 1 + 0.4 * z : 1; // 后面收窄成扇形，铰链处窄
      const r = 1 + 0.07 * rib * h;
      p.setXYZ(i, x * 0.21 * r * fan, y * (top ? 0.11 : 0.08) * (1 - 0.12 * h + 0.12 * rib * h), z * 0.19 * r);
    }
    g.computeVertexNormals();
    return g;
  };
  const shellMat = k.mat(C.color);
  const lining = (g, flip) => {
    const m = new THREE.Mesh(g.clone().scale(0.94, 0.85, 0.94), k.mat(C.inner, { side: THREE.BackSide }));
    if (flip) m.position.y = 0.002;
    return m;
  };
  const botG = shellGeo(false);
  const bottom = k.mk(botG, shellMat, 0.011);
  bottom.add(lining(botG));
  o.body.add(bottom);
  // 珍珠
  const pearlMat = k.mat(C.pearl, { emissive: C.glow, emissiveIntensity: 0.35 });
  o.glowMats.push(pearlMat);
  const pearl = k.mk(new THREE.SphereGeometry(0.055, 18, 14), pearlMat, 0.007);
  pearl.position.set(0, 0.015, 0.02);
  const phl = new THREE.Mesh(shared().hi, shared().white);
  phl.scale.setScalar(0.014);
  phl.position.set(0.018, 0.028, 0.04);
  pearl.add(phl);
  o.body.add(pearl);
  o.pearl = pearl;
  // 后面的小铰链
  // 后面的小铰链（扇贝的两只"小耳朵"）
  for (const s of [1, -1]) {
    const ear = k.mk(ell(0.04, 0.012, 0.028, 10, 6), C.color, 0.007);
    ear.position.set(s * 0.035, -0.004, -0.19);
    ear.rotation.y = s * 0.5;
    o.body.add(ear);
  }
  // 上壳（lid）：铰链在后面，rotation.x 往负方向转就打开
  const lid = new THREE.Group();
  lid.position.set(0, 0.0, -0.18);
  const topG = shellGeo(true);
  const top = k.mk(topG, shellMat, 0.011);
  top.add(lining(topG, true));
  top.position.z = 0.18;
  lid.add(top);
  o.body.add(lid);
  o.lid = lid;
  o.openLid = (p) => { lid.rotation.x = -1.15 * Math.min(1, Math.max(0, p)); };
  o.openLid(0.3); // 默认微微张开，珍珠露个脸
  o.body.rotation.x = 0.25; // 稍微往前倾，正面看得到贝壳里面
  addHalo(o, C.glow, 0.7, 0.4);
  addSparkles(o, 6, 0.27, 0xfff3ff, 11);
};

B.star = (o, k, C) => {
  const sh = new THREE.Shape();
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 0.125 : 0.235;
    pts.push(new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r));
  }
  // 圆角星：每个角用二次曲线带过去
  const tt = (i) => (i % 2 ? 0.18 : 0.3);
  const n = pts.length;
  const A = (i) => pts[i].clone().lerp(pts[(i - 1 + n) % n], tt(i));
  const Bp = (i) => pts[i].clone().lerp(pts[(i + 1) % n], tt(i));
  sh.moveTo(Bp(0).x, Bp(0).y);
  for (let j = 1; j <= n; j++) {
    const i = j % n, a = A(i), b = Bp(i);
    sh.lineTo(a.x, a.y);
    sh.quadraticCurveTo(pts[i].x, pts[i].y, b.x, b.y);
  }
  const depth = 0.05, bt = 0.045;
  const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: true, bevelThickness: bt, bevelSize: 0.035, bevelSegments: 3, curveSegments: 4 });
  g.translate(0, 0, -depth / 2);
  const mat = k.mat(C.color, { emissive: C.glow, emissiveIntensity: 0.35 });
  o.glowMats.push(mat);
  const body = k.mk(g, mat, 0.012);
  o.body.add(body);
  const fz = depth / 2 + bt;
  o.eyes = [1, -1].map((s) => {
    const e = eye(0.03, 1);
    e.position.set(s * 0.055, 0.025, fz - 0.004);
    o.body.add(e);
    return e;
  });
  for (const s of [1, -1]) {
    const b = blushMesh(0.026);
    b.position.set(s * 0.1, -0.02, fz + 0.001);
    o.body.add(b);
  }
  const sm = smile(0.022, 0.0065);
  sm.position.set(0, -0.012, fz + 0.002);
  o.body.add(sm);
  o.body.rotation.z = -0.12;
  addHalo(o, C.glow, 0.85, 0.45);
  addSparkles(o, 7, 0.3, 0xfffbd0, 5);
};

/* ---------------------------------------------------------------- public API */
// 返回 { root, sway, body, tail, fins, eyes, sparkles, glowMats, kind, id, size, ... }，
// 外加各自的部件：puffer.puff(k)，chest / mermaid 的 lid + openLid(k)，jelly.bell，octopus/jelly.tentacles，whale.spout，turtle.head。
export function buildCatch(id, { toon, outlined }) {
  const C = CATCH[id] || CATCH.crucian;
  id = CATCH[id] ? id : "crucian";
  const cache = new Map();
  const mat = (c, extra) => {
    if (extra) return toon(c, extra);
    if (!cache.has(c)) cache.set(c, toon(c));
    return cache.get(c);
  };
  const k = {
    mat, outlined,
    mk: (geo, c, line = 0.012) => {
      const m = new THREE.Mesh(geo, typeof c === "number" ? mat(c) : c);
      return line ? outlined(m, line) : m;
    },
  };
  const root = new THREE.Group();
  const sway = new THREE.Group();
  const body = new THREE.Group();
  root.add(sway);
  sway.add(body);
  const o = { id, kind: C.kind, root, sway, body, tail: null, fins: [], eyes: [], sparkles: [], glowMats: [], swims: C.kind === "fish" };
  B[id](o, k, C);
  // 包围盒居中（闪光和光晕不算）
  const box = new THREE.Box3().setFromObject(body);
  const c = box.getCenter(V());
  body.position.sub(c);
  o.size = box.getSize(V());
  for (const m of o.glowMats) m.userData.base = m.emissiveIntensity;
  root.userData.catchId = id;
  root.traverse((n) => { n.userData.what = "catch"; });
  return o;
}

// 游泳：尾巴摆 + 身体反向轻摇 + 鳍扇动。物件（kind: "item"）什么都不做。
export function swim(o, t, speed = 1) {
  if (!o || !o.swims) return;
  const w = t * speed;
  if (o.tail) o.tail.rotation[o.tailAxis || "y"] = Math.sin(w * 9) * (o.tailAmp ?? 0.45);
  const ax = o.swayAxis || "y";
  o.sway.rotation[ax] = Math.sin(w * 9 - 1.3) * 0.08 * (o.swayAmp ?? 1);
  o.sway.position.y = Math.sin(w * 2.2) * 0.01;
  if (!o.finsCustom) o.fins.forEach((f, i) => { f.rotation.y = f.userData.s * (0.35 + 0.3 * Math.sin(w * 10 + i)); });
  if (o.onSwim) o.onSwim(w);
}

// 闪光 / 自发光呼吸（传说渔获、水母、宝石）。没有这些的东西调用也无害。
export function shine(o, t) {
  if (!o) return;
  for (const s of o.sparkles) {
    const p = Math.max(0, Math.sin(t * 2.4 + s.userData.ph));
    s.scale.setScalar(s.userData.s * (0.1 + p * p));
    s.rotation.z = t * 1.2 + s.userData.ph;
  }
  for (const m of o.glowMats) m.emissiveIntensity = m.userData.base * (0.75 + 0.35 * Math.sin(t * 3));
  if (o.halo) o.halo.material.opacity = o.halo.userData.base * (0.8 + 0.25 * Math.sin(t * 2.2));
  if (o.gem) o.gem.rotation.y = t * 1.5;
}

// 一步到位：swim + shine
export function animateCatch(o, t, speed = 1) { swim(o, t, speed); shine(o, t); }

/* ---------------------------------------------------------------- rod */
// 竿子沿本地 +y，原点在握把底部；绕线轮和导环在 +x 一侧（往 +x 抛竿时它们在下面）。
export function buildRod({ toon, outlined }) {
  const mk = (geo, c, line = 0.01) => { const m = new THREE.Mesh(geo, typeof c === "number" ? toon(c) : c); return line ? outlined(m, line) : m; };
  const root = new THREE.Group();
  const grip = mk(new THREE.CylinderGeometry(0.03, 0.034, 0.26, 12), 0xff9fb8, 0.01);
  grip.position.y = 0.15;
  const butt = mk(new THREE.SphereGeometry(0.036, 12, 8), 0xff7fa3, 0.01);
  butt.position.y = 0.02;
  for (const y of [0.07, 0.15, 0.23]) {
    const r = new THREE.Mesh(new THREE.TorusGeometry(0.032, 0.006, 5, 14), toon(0xfff3f6));
    r.rotation.x = Math.PI / 2;
    r.position.y = y;
    root.add(r);
  }
  const seat = mk(new THREE.CylinderGeometry(0.024, 0.026, 0.06, 10), 0xffffff, 0.008);
  seat.position.y = 0.31;
  root.add(grip, butt, seat);
  // 绕线轮
  const reel = new THREE.Group();
  reel.position.set(0.06, 0.31, 0);
  const arm = mk(new THREE.BoxGeometry(0.04, 0.014, 0.014), 0xcfd8f5, 0.006);
  arm.position.x = -0.022;
  const spool = mk(new THREE.CylinderGeometry(0.04, 0.04, 0.03, 14).rotateX(Math.PI / 2), 0x8fc7ff, 0.008);
  spool.position.x = 0.015;
  const cap = mk(new THREE.CylinderGeometry(0.022, 0.022, 0.012, 12).rotateX(Math.PI / 2), 0xffffff, 0.005);
  cap.position.set(0.015, 0, 0.02);
  const handle = new THREE.Group();
  handle.position.set(0.015, 0, -0.022);
  const hArm = mk(new THREE.BoxGeometry(0.05, 0.01, 0.008), 0xcfd8f5, 0.004);
  hArm.position.x = 0.022;
  const knob = mk(new THREE.SphereGeometry(0.014, 10, 8), 0xff7fa3, 0.005);
  knob.position.set(0.045, 0, -0.01);
  handle.add(hArm, knob);
  reel.add(arm, spool, cap, handle);
  root.add(reel);
  // 竿身：白色，带浅蓝缠线，导环在 +x 一侧
  const len = 0.76;
  const blank = mk(new THREE.CylinderGeometry(0.008, 0.017, len, 8), 0xfff8ee, 0.007);
  blank.position.y = 0.34 + len / 2;
  root.add(blank);
  for (const f of [0.08, 0.36, 0.62, 0.86]) {
    const y = 0.34 + len * f, r = lerp(0.017, 0.008, f);
    const wrap = new THREE.Mesh(new THREE.CylinderGeometry(r + 0.003, r + 0.003, 0.018, 8), toon(0x8fc7ff));
    wrap.position.y = y;
    root.add(wrap);
    const g = new THREE.Mesh(new THREE.TorusGeometry(0.012 * (1 - f * 0.4), 0.003, 4, 10), toon(0xd8dde8));
    g.rotation.y = Math.PI / 2;
    g.position.set(r + 0.012, y, 0);
    root.add(g);
  }
  const tipBall = mk(new THREE.SphereGeometry(0.014, 10, 8), 0xff6b7a, 0.005);
  tipBall.position.y = 0.34 + len;
  root.add(tipBall);
  const tip = new THREE.Object3D();
  tip.position.y = 0.34 + len + 0.01;
  root.add(tip);
  root.traverse((n) => { n.userData.what = "rod"; });
  return { root, tip, reel, handle, length: tip.position.y };
}

/* ---------------------------------------------------------------- bobber */
// root 放在水面上（root 的 y = 水面）；动画只动 float，水波 ripple 留在水面。
export function buildBobber({ toon, outlined }) {
  const root = new THREE.Group();
  const float = new THREE.Group();
  root.add(float);
  const r = 0.06;
  const red = outlined(new THREE.Mesh(new THREE.SphereGeometry(r, 18, 9, 0, Math.PI * 2, 0, Math.PI / 2), toon(0xff5d5d)), 0.008);
  const white = outlined(new THREE.Mesh(new THREE.SphereGeometry(r, 18, 9, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), toon(0xffffff)), 0.008);
  const band = new THREE.Mesh(new THREE.TorusGeometry(r * 1.0, 0.007, 5, 22), toon(0xfff0c8));
  band.rotation.x = Math.PI / 2;
  const stem = outlined(new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.011, 0.05, 8), toon(0xff5d5d)), 0.005);
  stem.position.y = r + 0.02;
  const knob = outlined(new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), toon(0xffffff)), 0.005);
  knob.position.y = r + 0.048;
  const hl = new THREE.Mesh(shared().hi, shared().white);
  hl.scale.set(0.012, 0.016, 0.006);
  hl.position.set(0.024, 0.038, 0.036);
  hl.lookAt(0.6, 0.9, 0.9);
  const bottom = outlined(new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.003, 0.03, 6), toon(0xffffff)), 0.004);
  bottom.position.y = -r - 0.012;
  float.add(red, white, band, stem, knob, hl, bottom);
  float.position.y = 0.012;
  const top = new THREE.Object3D(); // 鱼线挂这里
  top.position.y = r + 0.06;
  float.add(top);
  // 水波
  const ripMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false });
  const ripple = new THREE.Mesh(new THREE.RingGeometry(0.075, 0.09, 28), ripMat);
  ripple.rotation.x = -Math.PI / 2;
  ripple.position.y = 0.002;
  ripple.raycast = () => {};
  root.add(ripple);
  // 咬钩时溅起来的小水珠
  const drops = [];
  const dropMat = new THREE.MeshBasicMaterial({ color: 0xdff4ff });
  for (let i = 0; i < 5; i++) {
    const d = new THREE.Mesh(shared().drop, dropMat);
    d.scale.setScalar(0.012);
    d.visible = false;
    d.userData.a = (i / 5) * Math.PI * 2 + 0.3;
    root.add(d);
    drops.push(d);
  }
  root.traverse((n) => { n.userData.what = "bobber"; });
  return { root, float, top, ripple, drops, radius: r };
}

// 等鱼：慢慢浮动、轻轻晃，偶尔一圈淡淡的水波
export function bobberIdle(b, t) {
  b.float.position.y = 0.012 + Math.sin(t * 2) * 0.01;
  b.float.rotation.z = Math.sin(t * 1.3) * 0.08;
  b.float.rotation.x = Math.sin(t * 1.7) * 0.06;
  const p = (t * 0.35) % 1;
  b.ripple.scale.setScalar(0.8 + p * 1.6);
  b.ripple.material.opacity = 0.45 * (1 - p);
  for (const d of b.drops) d.visible = false;
}

// 咬钩：t = 咬钩后经过的秒数。一下一下猛地往下拽，每拽一次溅水花、扩一圈水波
export function bobberBite(b, t) {
  const per = 0.62, p = (t % per) / per;
  const dip = p < 0.4 ? Math.sin((p / 0.4) * Math.PI) : 0;
  b.float.position.y = 0.012 - 0.1 * Math.pow(dip, 0.6) + Math.sin(t * 31) * 0.004;
  b.float.rotation.z = Math.sin(t * 23) * 0.18 * (1 - dip * 0.5);
  b.float.rotation.x = Math.cos(t * 19) * 0.12;
  b.ripple.scale.setScalar(0.7 + p * 2.6);
  b.ripple.material.opacity = 0.7 * (1 - p);
  const q = Math.max(0, (p - 0.3) / 0.6); // 浮上来的时候溅起
  for (const d of b.drops) {
    const on = q > 0 && q < 1;
    d.visible = on;
    if (!on) continue;
    const rr = 0.05 + q * 0.09;
    d.position.set(Math.cos(d.userData.a) * rr, 0.01 + Math.sin(q * Math.PI) * 0.09, Math.sin(d.userData.a) * rr);
    d.scale.setScalar(0.013 * (1 - q * 0.6));
  }
}

/* ---------------------------------------------------------------- splash */
// 可复用的小水花：play() 重新开始，每帧 update(dt)；放完自动隐藏。原点在水面。
export function buildSplash({ size = 1, color = 0xe6f6ff } = {}) {
  const root = new THREE.Group();
  root.visible = false;
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.08, 0.105, 28), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.003;
  const ring2Mat = ringMat.clone();
  const ring2 = new THREE.Mesh(ring.geometry, ring2Mat);
  ring2.rotation.x = -Math.PI / 2;
  ring2.position.y = 0.004;
  root.add(ring, ring2);
  const dropMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 });
  const drops = [];
  for (let i = 0; i < 9; i++) {
    const d = new THREE.Mesh(shared().drop, dropMat);
    d.userData.v = V();
    root.add(d);
    drops.push(d);
  }
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.04, 0.05, 14, 1, true), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide }));
  root.add(crown);
  root.scale.setScalar(size);
  root.traverse((n) => { n.raycast = () => {}; });
  let t = 1e9;
  const DUR = 0.8;
  const s = {
    root,
    active: false,
    play() {
      t = 0;
      s.active = true;
      root.visible = true;
      drops.forEach((d, i) => {
        const a = (i / drops.length) * Math.PI * 2 + Math.random() * 0.5;
        const sp = 0.25 + Math.random() * 0.25;
        d.userData.v.set(Math.cos(a) * sp, 0.9 + Math.random() * 0.5, Math.sin(a) * sp);
        d.position.set(Math.cos(a) * 0.03, 0.02, Math.sin(a) * 0.03);
        d.userData.r = 0.012 + Math.random() * 0.01;
      });
    },
    update(dt) {
      if (!s.active) return;
      t += dt;
      const p = t / DUR;
      if (p >= 1) { s.active = false; root.visible = false; return; }
      ring.scale.setScalar(0.6 + p * 2.6);
      ringMat.opacity = 0.85 * (1 - p);
      const p2 = Math.max(0, p - 0.25) / 0.75;
      ring2.scale.setScalar(0.3 + p2 * 1.8);
      ring2Mat.opacity = p > 0.25 ? 0.6 * (1 - p2) : 0;
      const cp = Math.min(1, p * 2.5);
      crown.scale.set(1 + cp * 0.8, Math.sin(Math.min(1, p * 1.6) * Math.PI) * 1.4 + 0.001, 1 + cp * 0.8);
      crown.position.y = crown.scale.y * 0.025;
      crown.material.opacity = 0.7 * (1 - p);
      for (const d of drops) {
        d.userData.v.y -= 3.6 * dt;
        d.position.addScaledVector(d.userData.v, dt * 0.5);
        d.visible = d.position.y > 0;
        d.scale.setScalar(d.userData.r * (1 - p * 0.5));
      }
      dropMat.opacity = Math.min(1, (1 - p) * 2);
    },
  };
  return s;
}

/* ---------------------------------------------------------------- school fish */
// 海里成群游的小鱼：9 个三角形，MeshBasic + 顶点色，没有光照、没有描边。
// 几何体共享，材质按颜色缓存；尾巴在顶点着色器里摆（相位取自世界坐标，所以每条不同步）。
// 每帧调一次 schoolTick(t) 更新时间。长约 0.12，头朝 +x。
const SCHOOL_TIME = { value: 0 };
let SCHOOL_GEO = null;
const SCHOOL_MATS = new Map();
export function schoolTick(t) { SCHOOL_TIME.value = t; }
export function buildSchoolFish(color = 0xffb27a) {
  if (!SCHOOL_GEO) {
    const nose = [0.06, 0, 0], top = [0, 0.024, 0], bot = [0, -0.022, 0], back = [-0.035, 0, 0];
    const R = [0, 0.002, 0.013], L = [0, 0.002, -0.013];
    const t0 = [-0.03, 0, 0], t1 = [-0.065, 0.026, 0], t2 = [-0.065, -0.026, 0];
    const tris = [
      [nose, R, top], [nose, bot, R], [nose, top, L], [nose, L, bot],
      [back, top, R], [back, R, bot], [back, L, top], [back, bot, L],
      [t0, t1, t2],
    ];
    const pos = [], col = [];
    const shade = (p) => (p[1] > 0.01 ? 0.78 : p[1] < -0.01 ? 1.12 : 1);
    for (const tri of tris) for (const p of tri) { pos.push(...p); const c = shade(p); col.push(c, c, c); }
    SCHOOL_GEO = new THREE.BufferGeometry();
    SCHOOL_GEO.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    SCHOOL_GEO.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    SCHOOL_GEO.computeBoundingSphere();
  }
  let mat = SCHOOL_MATS.get(color);
  if (!mat) {
    mat = new THREE.MeshBasicMaterial({ color, vertexColors: true, side: THREE.DoubleSide });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = SCHOOL_TIME;
      sh.vertexShader = "uniform float uTime;\n" + sh.vertexShader.replace("#include <begin_vertex>",
        "#include <begin_vertex>\nfloat ph = modelMatrix[3].x * 7.0 + modelMatrix[3].z * 5.0;\n" +
        "float kk = clamp(-position.x / 0.065, 0.0, 1.0);\ntransformed.z += sin(uTime * 13.0 + ph) * 0.018 * kk * kk;");
    };
    mat.customProgramCacheKey = () => "schoolfish";
    SCHOOL_MATS.set(color, mat);
  }
  const m = new THREE.Mesh(SCHOOL_GEO, mat);
  m.raycast = () => {};
  m.userData.what = "school";
  return m;
}
