// 参数化的"鱼生成器"（Three.js r170）：60 种渔获的 Q 版模型。
// - 15 种老渔获直接交给 fish3d.js 的 buildCatch（手工模型）。
// - 45 种新渔获 = 原型（archetype）+ 参数 + 小配件（extras），外观表 G 在本文件里（玩法数据在 fishdata.js）。
// 约定和 buildCatch 一样：会游的鱼头朝 +x、侧面 +z；物件正面朝 +z；最长边约 0.5，包围盒居中。
// 性能：静态部件全部烘成顶点色、合并成一个网格（一个 toon 顶点色材质），只有会动的尾巴 / 鳍单独成网格；
//       每条鱼 ≤ 8 个 draw call（含描边）。材质按 toon 函数缓存在模块里，多条鱼共用。
import * as THREE from "three";
import { mergeGeometries, mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { buildCatch, CATCH, swim, shine } from "./fish3d.js?v=16";
import { FISH } from "./fishdata.js?v=16";

/* ================================================================ 小工具 */
const TAU = Math.PI * 2;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const sstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const _col = new THREE.Color();
const LIN = new Map(); // hex → 线性空间 rgb（顶点色要线性值）
function L(hex) {
  let v = LIN.get(hex);
  if (!v) { _col.setHex(hex); v = [_col.r, _col.g, _col.b]; LIN.set(hex, v); }
  return v;
}
// 两个 sRGB hex 按 t 混合，结果还是 hex（用在烘焙腮红 / 渐变）
function mixHex(a, b, t) {
  const ca = new THREE.Color(a), cb = new THREE.Color(b);
  return ca.lerp(cb, t).getHex();
}
const DARK = 0x2b1d18, WHITE = 0xffffff, PINK = 0xff8fa8, MOUTH = 0xff8fa3;

function TRS(p = [0, 0, 0], r = [0, 0, 0], s = 1) {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(r[0], r[1], r[2]));
  const sc = Array.isArray(s) ? V(...s) : V(s, s, s);
  return new THREE.Matrix4().compose(V(...p), q, sc);
}
// 把本地 +z 对准表面法线 n，放到 p（可选绕法线转 spin、缩放 s）
function onSurf(sp, lift = 0, spin = 0, s = 1) {
  const up = Math.abs(sp.n.y) > 0.95 ? V(1, 0, 0) : V(0, 1, 0);
  const m = new THREE.Matrix4().lookAt(sp.n, V(), up);
  if (spin) m.multiply(new THREE.Matrix4().makeRotationZ(spin));
  if (s !== 1) m.multiply(new THREE.Matrix4().makeScale(...(Array.isArray(s) ? s : [s, s, s])));
  m.setPosition(sp.p.clone().addScaledVector(sp.n, lift));
  return m;
}
const ell = (rx, ry, rz, ws = 14, hs = 10) => new THREE.SphereGeometry(1, ws, hs).scale(rx, ry, rz);
const sph = (r, ws = 12, hs = 8) => new THREE.SphereGeometry(r, ws, hs);
const cone = (r, h, n = 8) => new THREE.ConeGeometry(r, h, n);
const cyl = (r0, r1, h, n = 10) => new THREE.CylinderGeometry(r0, r1, h, n);

// 渐细的管子（须、触手、尾巴、胡子）
function taperTube(pts, r0, r1, tub = 12, rad = 6) {
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => V(...p)));
  const g = new THREE.TubeGeometry(curve, tub, 1, rad, false);
  const p = g.attributes.position, c = V(), v = V();
  for (let j = 0; j <= tub; j++) {
    curve.getPointAt(j / tub, c);
    const r = r0 + (r1 - r0) * (j / tub);
    for (let i = 0; i <= rad; i++) {
      const idx = j * (rad + 1) + i;
      v.fromBufferAttribute(p, idx).sub(c).multiplyScalar(r).add(c);
      p.setXYZ(idx, v.x, v.y, v.z);
    }
  }
  // 两头封口：加小球
  const a = curve.getPointAt(0), b = curve.getPointAt(1);
  return mergeAll([g, sph(r0, 8, 6).translate(a.x, a.y, a.z), sph(Math.max(r1, 0.002), 8, 6).translate(b.x, b.y, b.z)]);
}
function strip(g) {
  for (const k of Object.keys(g.attributes)) if (k !== "position" && k !== "normal") g.deleteAttribute(k);
  return g;
}
function mergeAll(list) {
  const gs = list.map((g) => { strip(g); if (!g.attributes.normal) g.computeVertexNormals(); return g.index ? g : mergeVertices(g); });
  return mergeGeometries(gs);
}
// 去掉 uv/法线 → 合并重合顶点 → 重算平滑法线（变形后的球没有接缝）
function smooth(g) {
  for (const k of Object.keys(g.attributes)) if (k !== "position") g.deleteAttribute(k);
  const m = mergeVertices(g, 1e-5);
  m.computeVertexNormals();
  return m;
}

/* ================================================================ 顶点色累加器 */
// 每个"部件网格"一个 Acc：add() 把几何体变换好、烘上颜色；mesh() 合并成一个网格 + 一层描边。
// line = true 的部件才进描边（眼睛、腮红、花纹这些贴片不描边）。
class Acc {
  constructor() { this.g = []; this.l = []; }
  add(geo, color, m = null, line = false) {
    let g = strip(geo);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.index) g = mergeVertices(g);
    if (m) g.applyMatrix4(m);
    const pos = g.attributes.position, nor = g.attributes.normal, n = pos.count;
    const arr = new Float32Array(n * 3);
    if (typeof color === "function") {
      const p = V(), q = V();
      for (let i = 0; i < n; i++) {
        p.fromBufferAttribute(pos, i); q.fromBufferAttribute(nor, i);
        arr.set(L(color(p, q)), i * 3);
      }
    } else {
      const c = L(color);
      for (let i = 0; i < n; i++) arr.set(c, i * 3);
    }
    g.setAttribute("color", new THREE.BufferAttribute(arr, 3));
    this.g.push(g);
    if (line) this.l.push(g);
    return g;
  }
  get empty() { return !this.g.length; }
  mesh(mat, outlined, thick) {
    if (!this.g.length) return null;
    const geo = mergeGeometries(this.g);
    const m = new THREE.Mesh(geo, mat);
    if (thick && this.l.length) {
      const lg = this.l.length === this.g.length ? geo : mergeGeometries(this.l);
      const tmp = new THREE.Mesh(lg);
      outlined(tmp, thick);
      const ol = tmp.children[tmp.children.length - 1];
      m.add(ol);
      if (lg !== geo) lg.dispose();
    }
    this.g = []; this.l = [];
    return m;
  }
}

/* ================================================================ 共享材质（模块级缓存） */
const MATS = new WeakMap(); // toon 函数 → { vc, glow: Map }
const SHARED = new Set(); // 共享的材质，缩略图清理时不要 dispose
function mats(toon) {
  let m = MATS.get(toon);
  if (!m) {
    m = { vc: toon(0xffffff, { vertexColors: true }), glow: new Map() };
    SHARED.add(m.vc);
    MATS.set(toon, m);
  }
  return m;
}
function glowMat(toon, color, k = 0.3) {
  const m = mats(toon);
  const key = color + ":" + k;
  let g = m.glow.get(key);
  if (!g) {
    g = toon(0xffffff, { vertexColors: true, emissive: color, emissiveIntensity: k });
    g.userData.base = k;
    m.glow.set(key, g);
    SHARED.add(g);
  }
  return g;
}
let FACE = null; // 不受光的眼睛 / 腮红（发光的鱼用，眼睛不被自发光染色）
function faceMat() {
  if (!FACE) { FACE = new THREE.MeshBasicMaterial({ vertexColors: true }); SHARED.add(FACE); }
  return FACE;
}
const SPARK_MATS = new Map();
function sparkMat(c) {
  let m = SPARK_MATS.get(c);
  if (!m) { m = new THREE.MeshBasicMaterial({ color: c }); SPARK_MATS.set(c, m); SHARED.add(m); }
  return m;
}
let STAR4 = null;
function star4Geo() { // 和 fish3d 一样的四角小闪光
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
let HALO_TEX = null;
const HALO_MATS = new Map();
function haloMat(color) {
  if (!HALO_TEX) {
    const cv = document.createElement("canvas");
    cv.width = cv.height = 64;
    const g = cv.getContext("2d");
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, "rgba(255,255,255,1)");
    gr.addColorStop(0.35, "rgba(255,255,255,0.55)");
    gr.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
    HALO_TEX = new THREE.CanvasTexture(cv);
    HALO_TEX.colorSpace = THREE.SRGBColorSpace;
  }
  let m = HALO_MATS.get(color);
  if (!m) { m = new THREE.SpriteMaterial({ map: HALO_TEX, color, transparent: true, opacity: 0.45, depthWrite: false }); HALO_MATS.set(color, m); SHARED.add(m); }
  return m;
}

/* ================================================================ 身体形状：超椭球 + 后半身收窄 */
// 单位球上的点 → 超椭球（p=2 普通椭球，p 越大越方）→ x<0 那半按 taper 收窄
function deformBlob(g, R, T = 0, p = 2, sc = 1) {
  const a = g.attributes.position;
  for (let i = 0; i < a.count; i++) {
    let x = a.getX(i), y = a.getY(i), z = a.getZ(i);
    if (p !== 2) {
      const t = Math.pow(Math.abs(x) ** p + Math.abs(y) ** p + Math.abs(z) ** p, -1 / p);
      x *= t; y *= t; z *= t;
    }
    const k = x < 0 ? 1 - T * x * x : 1;
    a.setXYZ(i, x * R[0] * sc, y * R[1] * k * sc, z * R[2] * k * sc);
  }
  return g;
}
const blobGeo = (R, T = 0, p = 2, ws = 26, hs = 18, sc = 1) => smooth(deformBlob(new THREE.SphereGeometry(1, ws, hs), R, T, p, sc));
// 球面上 x ∈ [xa, xb] 的一圈（竖条纹）；ph0/phL 限制只画上半圈之类
function bandGeo(xa, xb, ws = 26, ph0 = 0, phL = TAU) {
  const t0 = Math.acos(Math.min(1, xb)), t1 = Math.acos(Math.max(-1, xa));
  return new THREE.SphereGeometry(1, ws, 4, ph0, phL, t0, t1 - t0).rotateZ(-Math.PI / 2);
}
// 球面上 y ∈ [ya, yb] 的一圈（横条纹 / 肚皮）
function hbandGeo(ya, yb, ws = 26) {
  const t0 = Math.acos(Math.min(1, yb)), t1 = Math.acos(Math.max(-1, ya));
  return new THREE.SphereGeometry(1, ws, 4, 0, TAU, t0, t1 - t0);
}
// 超椭球表面：fx, fy 是相对坐标，s = ±1 选 +z / -z 面
function blobPt(B, fx, fy, s = 1) {
  const { R, T, p } = B;
  const a = 1 - Math.abs(fx) ** p - Math.abs(fy) ** p;
  const fz = a > 0 ? a ** (1 / p) : 0;
  return blobAt(B, fx, fy, s * fz);
}
function blobAt(B, ux, uy, uz) {
  const { R, T, p } = B;
  const k = ux < 0 ? 1 - T * ux * ux : 1;
  const P = V(ux * R[0], uy * R[1] * k, uz * R[2] * k);
  const g = (u) => Math.sign(u) * Math.abs(u) ** (p - 1);
  const n = V(g(ux) / R[0], g(uy) / (R[1] * k), g(uz) / (R[2] * k));
  if (n.lengthSq() < 1e-9) n.set(0, 0, Math.sign(uz) || 1);
  return { p: P, n: n.normalize() };
}
function blobDir(B, dx, dy, dz) {
  const d = V(dx, dy, dz).normalize(), p = B.p;
  const t = Math.pow(Math.abs(d.x) ** p + Math.abs(d.y) ** p + Math.abs(d.z) ** p, -1 / p);
  return blobAt(B, d.x * t, d.y * t, d.z * t);
}

/* ================================================================ 小部件 */
// 黑豆眼 + 两个高光（本地 +z 朝外）；s = -1 时高光镜像，两边的高光都朝前
function eyeParts(acc, m, r, s = 1, style = "dot") {
  if (style === "sleepy" || style === "happy") {
    const arc = new THREE.TorusGeometry(r * 0.8, r * 0.2, 5, 12, Math.PI);
    if (style === "sleepy") arc.rotateZ(Math.PI); // ∪ 闭着眼
    acc.add(arc.translate(0, style === "sleepy" ? r * 0.2 : -r * 0.2, r * 0.1), DARK, m);
    return;
  }
  acc.add(ell(r, r * 1.12, r * 0.55, 14, 10), DARK, m);
  acc.add(sph(r * 0.36, 8, 6).translate(s * r * 0.3, r * 0.42, r * 0.4), WHITE, m);
  acc.add(sph(r * 0.17, 6, 4).translate(-s * r * 0.3, -r * 0.4, r * 0.42), WHITE, m);
}
function eyeOn(ctx, sp, r, s, style) { eyeParts(ctx.face, onSurf(sp, -r * 0.12), r, s, style); }
function blushOn(ctx, sp, r, color) { ctx.face.add(ell(r, r * 0.62, r * 0.25, 10, 6), color, onSurf(sp, 0.001)); }
// 贴在表面上的扁圆点（斑点、色块、鳞片）
function dotOn(acc, sp, rx, ry, color, spin = 0, lift = -0.1) {
  acc.add(ell(rx, ry, Math.min(rx, ry) * 0.28, 10, 7), color, onSurf(sp, Math.min(rx, ry) * lift, spin));
}

// 胸鳍：会扇（单独网格，pivot.userData.s 给 swim() 用），或者烘死在身体里（预算不够时）
function pecFin(ctx, p, s, L, W, color, tilt = 0.55) {
  const geo = () => ell(L, W, 0.01, 10, 6).translate(-L * 0.85, 0, 0);
  if (ctx.finMode === "static") {
    ctx.body.add(geo(), color, new THREE.Matrix4().compose(p, new THREE.Quaternion().setFromEuler(new THREE.Euler(0, s * 0.45, tilt, "XYZ")), V(1, 1, 1)), true);
    return;
  }
  const piv = new THREE.Group();
  piv.position.copy(p);
  piv.rotation.z = tilt;
  piv.userData.s = s;
  const a = new Acc();
  a.add(geo(), color, null, true);
  ctx.fins.push({ piv, acc: a });
}

/* ================================================================ 尾巴形状（尾巴本地坐标：原点在尾柄，往 -x 伸） */
function lobe(acc, L, W, th, ang, color, dist = 0.42) {
  acc.add(ell(L * 0.5, W, th, 12, 8), color, TRS([-L * dist * Math.cos(ang), L * dist * Math.sin(ang), 0], [0, 0, -ang]), true);
}
const TAILS = {
  fan: (a, L, c) => { for (const s of [1, -1]) lobe(a, L, L * 0.23, 0.012, s * 0.55, c); },
  fork: (a, L, c) => { for (const s of [1, -1]) lobe(a, L * 1.1, L * 0.14, 0.011, s * 0.72, c, 0.45); },
  crescent: (a, L, c) => {
    for (const s of [1, -1]) lobe(a, L * 1.25, L * 0.1, 0.011, s * 0.95, c, 0.42);
    a.add(ell(L * 0.18, L * 0.12, 0.016), c, TRS([-L * 0.08, 0, 0]), true);
  },
  round: (a, L, c) => { a.add(ell(L * 0.48, L * 0.4, 0.012, 14, 8), c, TRS([-L * 0.42, 0, 0]), true); },
  lyre: (a, L, c, c2) => {
    for (const s of [1, -1]) lobe(a, L * 1.3, L * 0.2, 0.011, s * 0.42, c, 0.42);
    a.add(ell(L * 0.32, L * 0.15, 0.012), c2 ?? c, TRS([-L * 0.25, 0, 0]), true);
  },
  shark: (a, L, c) => {
    lobe(a, L * 1.25, L * 0.15, 0.014, 0.85, c, 0.42);
    lobe(a, L * 0.7, L * 0.13, 0.014, -0.75, c, 0.42);
  },
  petal: (a, L, c, c2) => {
    for (let i = 0; i < 5; i++) {
      const ang = -0.75 + (i * 1.5) / 4;
      a.add(ell(L * 0.32, L * 0.14, 0.011, 12, 8), i % 2 ? c2 ?? c : c, TRS([-L * 0.42 * Math.cos(ang), L * 0.42 * Math.sin(ang), 0], [0, 0, -ang]), true);
    }
  },
  flame: (a, L, c, c2, c3) => { // 三片火苗：上下两片 + 中间一片，颜色由外向内
    const fl = (len, w, ang, col, z = 0) => {
      const g = new THREE.SphereGeometry(1, 12, 8);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) { // 水滴形：-x 端尖
        const x = p.getX(i), k = x < 0 ? 1 + x * 0.85 : 1;
        p.setXYZ(i, x, p.getY(i) * k, p.getZ(i) * k);
      }
      g.computeVertexNormals();
      a.add(g.scale(len, w, 0.013), col, TRS([-len * Math.cos(ang), len * Math.sin(ang), z], [0, 0, -ang]), true);
    };
    for (const s of [1, -1]) fl(L * 0.55, L * 0.2, s * 0.6, c);
    fl(L * 0.62, L * 0.17, 0, c2 ?? c, 0.004);
    if (c3) for (const s of [1, -1]) fl(L * 0.32, L * 0.1, s * 0.35, c3, 0.008);
  },
  clavus: (a, L, c) => { // 翻车鱼的"舵鳍"：一排小圆瓣
    for (let i = -2; i <= 2; i++) a.add(ell(L * 0.18, L * 0.14, 0.014, 10, 6), c, TRS([-L * 0.12 + Math.abs(i) * L * 0.04, i * L * 0.22, 0]), true);
  },
  slice: (a, L, c) => { // 一片西瓜：红瓤 + 绿皮 + 黑籽
    const R = L * 0.55;
    const red = new THREE.CylinderGeometry(R, R, 0.03, 18, 1, false, Math.PI, Math.PI).rotateX(Math.PI / 2);
    a.add(red, 0xff6f7d, TRS([-0.01, 0, 0], [0, 0, 0]), true);
    const rind = new THREE.TorusGeometry(R, 0.016, 6, 18, Math.PI).rotateZ(Math.PI / 2);
    a.add(rind, 0x5aa84a, TRS([-0.01, 0, 0]), true);
    const white = new THREE.TorusGeometry(R * 0.9, 0.008, 4, 18, Math.PI).rotateZ(Math.PI / 2);
    a.add(white.scale(1, 1, 1.9), 0xf6ffe8, TRS([-0.01, 0, 0]));
    for (const [x, y] of [[-0.45, 0.35], [-0.6, -0.1], [-0.35, -0.4], [-0.25, 0.05], [-0.7, 0.25]]) {
      for (const s of [1, -1]) a.add(ell(0.009, 0.005, 0.004, 6, 4), DARK, TRS([x * R - 0.01, y * R, s * 0.016], [0, 0, 0.5]));
    }
  },
  tassel: (a, L, c, c2) => { // 灯笼穗子：金绳 + 结 + 红穗
    a.add(cyl(0.007, 0.007, L * 0.35, 6).rotateZ(Math.PI / 2), c2, TRS([-L * 0.17, 0, 0]), true);
    a.add(sph(0.022, 10, 8), c2, TRS([-L * 0.36, 0, 0]), true);
    for (let i = 0; i < 5; i++) {
      const ang = -0.35 + i * 0.175;
      a.add(cone(0.012, L * 0.5, 6).rotateZ(Math.PI / 2), c, TRS([-L * 0.36 - L * 0.25 * Math.cos(ang), -L * 0.25 * Math.sin(ang), (i - 2) * 0.004], [0, 0, ang]), true);
    }
  },
  tadpole: (a, L, c, c2) => { // 蝌蚪长尾：扁扁的一条
    const g = taperTube([[0, 0, 0], [-L * 0.3, L * 0.03, 0], [-L * 0.6, -L * 0.03, 0], [-L * 0.95, L * 0.05, 0]], 0.04, 0.008, 16, 8);
    a.add(g.scale(1, 1.1, 0.4), c, null, true);
    a.add(ell(L * 0.5, L * 0.17, 0.007, 14, 6), c2 ?? c, TRS([-L * 0.55, 0.005, 0]), true);
  },
  phoenix: (a, L, c, c2, c3) => { // 长长的凤尾：五根飘带 + 末端圆羽
    const cols = [c, c2, c3, c2, c];
    for (let i = 0; i < 5; i++) {
      const ang = -0.5 + i * 0.25, len = L * (i === 2 ? 1.25 : 1.0 - Math.abs(i - 2) * 0.1);
      const end = [-len * Math.cos(ang), len * Math.sin(ang), (i - 2) * 0.006];
      a.add(taperTube([[0, 0, end[2]], [end[0] * 0.5, end[1] * 0.4 + 0.02 * (i - 2), end[2]], end], 0.012, 0.006, 10, 5), cols[i], null, true);
      a.add(ell(0.032, 0.02, 0.008, 10, 6), cols[(i + 2) % 5], TRS(end, [0, 0, -ang]), true);
    }
  },
  stem: (a, L, c) => { a.add(taperTube([[0.01, 0, 0], [-L * 0.3, -0.005, 0], [-L * 0.6, 0.02, 0]], 0.009, 0.006, 8, 5), c, null, true); },
  fabric: (a, L, c, c2) => { // 鲤鱼旗的布尾巴：两片分叉
    for (const s of [1, -1]) {
      const g = ell(L * 0.5, L * 0.2, 0.012, 14, 8);
      a.add(g, s > 0 ? c : c2 ?? c, TRS([-L * 0.45, s * L * 0.18, 0], [0, 0, -s * 0.3]), true);
    }
  },
};
function buildTail(ctx, spec, at) {
  if (!spec) return;
  const [shape, L, c, c2, c3] = spec;
  const t = new THREE.Group();
  t.position.copy(at);
  ctx.tailG = t;
  TAILS[shape](ctx.tail, L, c, c2, c3);
}

/* ================================================================ 背鳍 / 臀鳍 */
function finShape(ctx, f, B) {
  const { t, c } = f;
  const R = B.R;
  const top = (fx) => blobPt(B, fx, 0.97, 1).p.setZ(0);
  if (t === "fin") {
    const p = top(f.x ?? -0.05);
    ctx.body.add(ell(f.L ?? 0.08, f.H ?? 0.05, 0.011, 12, 8), c, TRS([p.x, p.y - 0.004, 0], [0, 0, f.tilt ?? -0.3]), true);
  } else if (t === "sail") { // 旗鱼的大帆
    const p = top(0.1);
    ctx.body.add(ell(0.15, 0.1, 0.01, 16, 8), c, TRS([p.x - 0.03, p.y + 0.02, 0], [0, 0, -0.15]), true);
    for (const [x, y] of [[0.05, 0.06], [-0.04, 0.08], [-0.1, 0.04], [0.0, 0.03]]) {
      for (const s of [1, -1]) ctx.body.add(ell(0.014, 0.014, 0.004, 8, 6), f.c2, TRS([p.x - 0.03 + x, p.y + 0.02 + y * 0.9, s * 0.009]));
    }
  } else if (t === "shark") { // 三角背鳍
    const p = top(0.0);
    const g = cone(0.055, 0.1, 14).scale(1, 1, 0.22);
    ctx.body.add(g, c, TRS([p.x - 0.01, p.y + 0.03, 0], [0, 0, 0.35]), true);
  } else if (t === "spiky") { // 一排小尖刺
    for (let i = 0; i < (f.n ?? 4); i++) {
      const fx = 0.35 - i * 0.22;
      const sp = blobPt(B, fx, 0.98, 1);
      sp.p.z = 0;
      ctx.body.add(cone(0.024, 0.06, 6).scale(1, 1, 0.5), i % 2 && f.c2 ? f.c2 : c, TRS([sp.p.x, sp.p.y + 0.012, 0], [0, 0, 0.25]), true);
    }
  } else if (t === "trail") { // 神仙鱼那种拖得长长的鳍（上下各一）
    for (const s of [1, -1]) {
      const sp = blobPt(B, -0.05, s * 0.97, 1);
      ctx.body.add(ell(0.04, 0.13, 0.011, 12, 10), c, TRS([sp.p.x - 0.05, s * (sp.p.y + 0.06), 0], [0, 0, s * 0.7]), true);
    }
  } else if (t === "tall") { // 翻车鱼：上下两片又高又大的鳍
    for (const s of [1, -1]) {
      ctx.body.add(ell(0.05, 0.11, 0.014, 12, 10), c, TRS([-R[0] * 0.5, s * (R[1] * 0.85 + 0.07), 0], [0, 0, s * 0.3]), true);
    }
  } else if (t === "petal") {
    const p = top(-0.05);
    for (const [dx, ang] of [[0.03, -0.2], [-0.03, -0.75]]) ctx.body.add(ell(0.05, 0.026, 0.01, 12, 8), c, TRS([p.x + dx, p.y + 0.02, 0], [0, 0, ang + 1.2]), true);
  } else if (t === "flame") {
    const p = top(0.0);
    const cols = [c, f.c2 ?? c, c];
    for (let i = 0; i < 3; i++) ctx.body.add(cone(0.03, 0.08, 8).scale(1, 1, 0.3), cols[i], TRS([p.x + 0.05 - i * 0.05, p.y + 0.02, 0], [0, 0, 0.45]), true);
  }
}

/* ================================================================ 花纹 */
function pattern(ctx, pt, B) {
  const [type, c] = pt;
  const R = B.R;
  const shell = (g, sc) => ctx.body.add(smooth(deformBlob(g, R, B.T, B.p, sc)), c);
  if (type === "band") { // 竖条纹 [[xa, xb]...], 可选只画上半圈
    for (const [a, b] of pt[2]) shell(bandGeo(a, b, 28, pt[3] ?? 0, pt[4] ?? TAU), 1.016);
  } else if (type === "hline") { // 横条纹（一圈）
    shell(hbandGeo(pt[2], pt[3], 30), 1.014);
  } else if (type === "spots") { // [[fx, fy, r, spin?, sides?]]
    for (const [fx, fy, r, spin = 0, sides = 2, ry] of pt[2]) {
      for (const s of sides === 2 ? [1, -1] : [sides]) dotOn(ctx.body, blobPt(B, fx, fy, s), r, ry ?? r * 0.85, c, s * spin);
    }
  } else if (type === "scales") { // 一排排小鳞片（开口朝头的弧）
    const rows = pt[2] ?? [[0.32, [0.3, 0.05, -0.2, -0.45]], [0.0, [0.42, 0.17, -0.08, -0.33, -0.58]], [-0.32, [0.3, 0.05, -0.2, -0.45]]];
    const r = pt[3] ?? 0.022;
    for (const [fy, xs] of rows) {
      for (const fx of xs) {
        for (const s of [1, -1]) {
          const sp = blobPt(B, fx, fy, s);
          const arc = new THREE.TorusGeometry(r, r * 0.2, 4, 10, Math.PI).rotateZ(Math.PI / 2 * s); // 弧朝后
          ctx.body.add(arc, c, onSurf(sp, 0.0));
        }
      }
    }
  } else if (type === "dashes") { // 青花鱼背上的波浪纹（上半身的一道道短斜线）
    for (let i = 0; i < 7; i++) {
      const fx = 0.45 - i * 0.16;
      for (const s of [1, -1]) {
        dotOn(ctx.body, blobPt(B, fx, 0.6, s), 0.008, 0.04, c, s * (i % 2 ? 0.45 : -0.25));
        dotOn(ctx.body, blobPt(B, fx - 0.05, 0.86, s), 0.007, 0.025, c, s * (i % 2 ? -0.3 : 0.4));
      }
    }
  } else if (type === "rainbow") { // 一条条彩虹色竖带（连续铺满前 3/4 个身子）
    const cols = pt[1], n = cols.length, x0 = 0.7, x1 = -0.75, w = (x0 - x1) / n;
    for (let i = 0; i < n; i++) ctx.body.add(smooth(deformBlob(bandGeo(x0 - (i + 1) * w, x0 - i * w + 0.004, 28), R, B.T, B.p, 1.016)), cols[i]);
  } else if (type === "meridian") { // 西瓜纹 / 灯笼骨：经过首尾（或上下）两极的一圈圈
    const n = pt[2], axis = pt[3] ?? "x", w = pt[4] ?? 0.02;
    for (let i = 0; i < n; i++) {
      const g = new THREE.TorusGeometry(1, w, 5, 40);
      if (axis === "x") g.rotateX((i * Math.PI) / n);
      else g.rotateY((i * Math.PI) / n);
      const p = g.attributes.position;
      for (let j = 0; j < p.count; j++) { // 贴着身体：每个点按身体轮廓缩放
        const v = V(p.getX(j), p.getY(j), p.getZ(j));
        const sp = blobDir(B, v.x, v.y, v.z);
        const k = sp.p.length() * 1.012;
        v.normalize().multiplyScalar(k);
        p.setXYZ(j, v.x, v.y, v.z);
      }
      ctx.body.add(smooth(g), c);
    }
  } else if (type === "flowers") { // 五瓣小花
    for (const [fx, fy, r] of pt[2]) {
      for (const s of [1, -1]) {
        const m = onSurf(blobPt(B, fx, fy, s), 0.0);
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * TAU + 0.3;
          ctx.body.add(ell(r * 0.55, r * 0.36, r * 0.15, 8, 6), c, m.clone().multiply(TRS([Math.cos(a) * r * 0.55, Math.sin(a) * r * 0.55, 0], [0, 0, a])));
        }
        ctx.body.add(sph(r * 0.28, 8, 6).scale(1, 1, 0.5), pt[3] ?? 0xffe27a, m.clone().multiply(TRS([0, 0, r * 0.06])));
      }
    }
  }
}

/* ================================================================ 小配件 */
const X = {
  whiskers(ctx, B, c = 0xffa07a) {
    for (const s of [1, -1]) ctx.body.add(taperTube([[B.R[0] * 0.95, -0.02, s * 0.012], [B.R[0] + 0.02, -0.035, s * 0.03], [B.R[0] + 0.01, -0.06, s * 0.045]], 0.005, 0.003, 6, 4), c);
  },
  barbels(ctx, B, c = 0x8a7b6e) { // 鲶鱼四根长胡子（弯弯地往后飘）
    const R = B.R;
    for (const s of [1, -1]) {
      ctx.body.add(taperTube([[R[0] * 0.9, -0.005, s * 0.03], [R[0] + 0.03, 0.01, s * 0.07], [R[0] + 0.0, -0.015, s * 0.11], [R[0] - 0.06, -0.04, s * 0.12], [R[0] - 0.11, -0.03, s * 0.11]], 0.008, 0.004, 14, 5), c, null, true);
      ctx.body.add(taperTube([[R[0] * 0.85, -0.045, s * 0.03], [R[0] + 0.01, -0.075, s * 0.05], [R[0] - 0.03, -0.1, s * 0.07], [R[0] - 0.07, -0.095, s * 0.075]], 0.006, 0.003, 10, 4), c, null, true);
    }
  },
  mustache(ctx, B, c = 0x5a3b2a) { // 两撇卷卷的小胡子：从嘴上方分开，沿着脸颊往后卷起来（侧面也看得到）
    for (const s of [1, -1]) {
      const pts = [[0.995, -0.12], [0.95, -0.28], [0.85, -0.36], [0.74, -0.27], [0.7, -0.1], [0.75, -0.02], [0.8, -0.1]].map(([x, y]) => {
        const sp = blobPt(B, x, y, s);
        return sp.p.addScaledVector(sp.n, 0.01).toArray();
      });
      ctx.face.add(taperTube(pts, 0.02, 0.008, 22, 8), c, null);
    }
  },
  monocle(ctx, B) { // 金边单片眼镜（+z 那只眼睛）
    const sp = blobPt(B, ...ctx.eyeAt, 1);
    const m = onSurf(sp, 0.012);
    ctx.face.add(new THREE.TorusGeometry(ctx.eyeR * 1.45, 0.006, 6, 20), 0xffd25c, m);
    ctx.face.add(taperTube([[0, -ctx.eyeR * 1.45, 0], [0.01, -0.07, -0.01], [-0.03, -0.09, -0.03], [-0.07, -0.05, -0.05]], 0.003, 0.003, 10, 4), 0xffd25c, m);
  },
  lure(ctx, B) { // 头顶的灯泡（发光的部分单独一个网格）
    const R = B.R;
    const top = blobPt(B, 0.45, 0.85, 1).p.setZ(0);
    const end = [R[0] + 0.07, top.y + 0.07, 0];
    ctx.body.add(taperTube([[top.x, top.y - 0.01, 0], [top.x + 0.03, top.y + 0.08, 0], [R[0] + 0.03, top.y + 0.13, 0], end], 0.008, 0.006, 14, 5), mixHex(ctx.P.c, DARK, 0.25), null, true);
    ctx.body.add(cyl(0.018, 0.022, 0.03, 10), 0xc4c8d6, TRS([end[0], end[1] - 0.012, 0]), true);
    for (const y of [-0.006, -0.016]) ctx.body.add(new THREE.TorusGeometry(0.02, 0.004, 4, 12).rotateX(Math.PI / 2), 0x9da3b8, TRS([end[0], end[1] + y, 0]));
    ctx.glowAcc.add(sph(0.042, 14, 10).scale(1, 1.1, 1), 0xfff2a6, TRS([end[0], end[1] + 0.035, 0]), true);
    ctx.glowAcc.add(sph(0.012, 6, 4), 0xffffff, TRS([end[0] + 0.015, end[1] + 0.05, 0.03]));
  },
  sword(ctx, B, c = 0x5a72b0) {
    const R = B.R;
    ctx.body.add(cone(0.017, 0.2, 10).rotateZ(-Math.PI / 2), c, TRS([R[0] + 0.085, -0.008, 0], [0, 0, 0.04]), true);
  },
  hammer(ctx, B) { // 锤头：横着的一根，眼睛长在两头
    const R = B.R, c = ctx.P.c;
    const x = R[0] * 0.72;
    ctx.body.add(blobGeo([0.055, 0.032, 0.15], 0, 2.4, 20, 12), c, TRS([x, 0.012, 0]), true);
    for (const s of [1, -1]) {
      const sp = { p: V(x + 0.012, 0.018, s * 0.14), n: V(0.45, 0.15, s).normalize() };
      eyeOn(ctx, sp, 0.026, s);
      blushOn(ctx, { p: V(x + 0.035, -0.005, s * 0.085), n: V(0.6, -0.1, s * 0.8).normalize() }, 0.018, ctx.blushC);
    }
  },
  tricorn(ctx, B) { // 海盗三角帽 + 骷髅小白点
    const R = B.R, c = 0x3d3652;
    const top = blobPt(B, 0.25, 0.9, 1).p.setZ(0);
    const m = TRS([top.x, top.y + 0.01, 0], [0, 0, -0.12]);
    ctx.body.add(blobGeo([0.1, 0.022, 0.095], 0, 2, 20, 10), c, m, true);
    ctx.body.add(blobGeo([0.065, 0.055, 0.065], 0, 2.4, 18, 12), c, m.clone().multiply(TRS([0, 0.035, 0])), true);
    for (const s of [1, -1]) ctx.body.add(sph(0.032, 10, 8).scale(1.2, 0.7, 0.5), c, m.clone().multiply(TRS([-0.02, 0.02, s * 0.085], [s * 0.6, 0, 0])), true);
    ctx.body.add(ell(0.075, 0.009, 0.075, 18, 4), 0xffd25c, m.clone().multiply(TRS([0, 0.012, 0])));
    ctx.body.add(sph(0.017, 10, 8).scale(1, 1, 0.4), 0xffffff, m.clone().multiply(TRS([0.04, 0.045, 0.045], [0, 0.85, 0])));
  },
  eyepatch(ctx, B) { // 眼罩：盖住 +z 那只眼睛，带子绕头一圈
    const sp = blobPt(B, ...ctx.eyeAt, 1);
    ctx.face.add(ell(ctx.eyeR * 1.35, ctx.eyeR * 1.25, 0.008, 14, 8), 0x2d2a3a, onSurf(sp, 0.002));
    const R = B.R, fx = ctx.eyeAt[0];
    const g = new THREE.TorusGeometry(1, 0.007, 5, 36).rotateY(Math.PI / 2);
    const k = Math.sqrt(1 - fx * fx);
    ctx.face.add(g.scale(1, R[1] * k * 1.03, R[2] * k * 1.06), 0x2d2a3a, TRS([fx * R[0], 0, 0], [0, 0, -0.55]));
    ctx.skipEye = 1;
  },
  earring(ctx, B) {
    const sp = blobPt(B, 0.25, -0.35, 1);
    ctx.face.add(new THREE.TorusGeometry(0.014, 0.004, 5, 12), 0xffd25c, onSurf(sp, 0.01).multiply(TRS([0, -0.012, 0], [Math.PI / 2, 0, 0])));
  },
  crest(ctx, B) { // 火凤鱼头顶的三根火焰羽冠
    const top = blobPt(B, 0.4, 0.9, 1).p.setZ(0);
    const cols = [0xffe36b, 0xffa53d, 0xff6a4a];
    cols.forEach((c, i) => {
      ctx.body.add(cone(0.02, 0.09 - i * 0.012, 8).scale(1, 1, 0.5), c, TRS([top.x - i * 0.035, top.y + 0.035, 0], [0, 0, 0.35 + i * 0.25]), true);
      ctx.body.add(sph(0.016, 8, 6), c, TRS([top.x - i * 0.035 - Math.sin(0.35 + i * 0.25) * 0.045, top.y + 0.035 + Math.cos(0.35 + i * 0.25) * 0.045, 0]), true);
    });
  },
  horn(ctx, B) { // 螺旋独角
    const R = B.R;
    const sp = blobDir(B, 1, 0.75, 0);
    const m = new THREE.Matrix4().compose(sp.p, new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), V(0.75, 0.66, 0).normalize()), V(1, 1, 1));
    ctx.body.add(cone(0.022, 0.16, 10).translate(0, 0.075, 0), 0xfff4d6, m, true);
    for (let i = 0; i < 4; i++) ctx.body.add(new THREE.TorusGeometry(0.019 - i * 0.004, 0.0035, 4, 10).rotateX(Math.PI / 2 + 0.3), 0xffc8e0, m.clone().multiply(TRS([0, 0.02 + i * 0.03, 0])));
  },
  scarf(ctx, B, c = 0xff6b7a, c2 = 0xffffff) { // 围巾：绕"脖子"一圈 + 两截飘在背后的围巾尾巴（红白条）
    const R = B.R, fx = 0.15, k = Math.sqrt(1 - fx * fx);
    const g = new THREE.TorusGeometry(1, 0.2, 8, 30).rotateY(Math.PI / 2);
    ctx.body.add(g.scale(0.17, R[1] * k * 1.02, R[2] * k * 1.02), c, TRS([fx * R[0], 0, 0]), true);
    for (const [len, ang, z] of [[0.07, 0.35, 0.03], [0.055, 0.05, 0.045]]) {
      const m = TRS([fx * R[0] - len * 0.85, R[1] * k * 0.55 - Math.sin(ang) * len * 0.5, z], [0, 0, ang]);
      ctx.body.add(blobGeo([len, 0.022, 0.01], 0, 3, 14, 8), c, m, true);
      for (const t of [-0.4, 0.2]) ctx.body.add(blobGeo([0.008, 0.023, 0.011], 0, 3, 6, 6), c2, m.clone().multiply(TRS([t * len, 0, 0])));
    }
  },
  butter(ctx, B) {
    const top = blobPt(B, 0.0, 0.99, 1).p.setZ(0);
    ctx.body.add(blobGeo([0.045, 0.014, 0.04], 0, 4, 16, 10), 0xfff27a, TRS([top.x + 0.02, top.y + 0.01, 0], [0, 0.4, 0.05]), true);
  },
  lid(ctx, B) { // 奶茶杯盖 + 吸管
    const R = B.R;
    ctx.body.add(blobGeo([R[0] * 0.92, 0.045, R[2] * 0.92], 0, 2.2, 22, 12), 0xfffaf0, TRS([0, R[1] * 0.92, 0]), true);
    ctx.body.add(new THREE.TorusGeometry(1, 0.06, 5, 30).rotateX(Math.PI / 2).scale(R[0] * 0.95, 1, R[2] * 0.95), 0xfffaf0, TRS([0, R[1] * 0.86, 0]), true);
    ctx.body.add(cyl(0.017, 0.017, 0.2, 10), 0xff8fb4, TRS([-0.03, R[1] + 0.07, 0], [0, 0, 0.3]), true);
    for (let i = 0; i < 3; i++) ctx.body.add(new THREE.TorusGeometry(0.0175, 0.004, 4, 10).rotateX(Math.PI / 2), 0xffffff, TRS([-0.03 - (0.03 + i * 0.04) * Math.sin(0.3), R[1] + 0.07 + (0.03 + i * 0.04) * Math.cos(0.3) - 0.06, 0], [0, 0, 0.3]));
  },
  seal(ctx, B) { // 水墨鲤身上的红印章
    const sp = blobPt(B, -0.3, 0.1, 1);
    ctx.body.add(new THREE.BoxGeometry(0.04, 0.04, 0.006), 0xe0473f, onSurf(sp, 0.0, 0.1));
    ctx.body.add(new THREE.BoxGeometry(0.022, 0.006, 0.004), 0xffe7dc, onSurf(sp, 0.004, 0.1).multiply(TRS([0, 0.006, 0])));
    ctx.body.add(new THREE.BoxGeometry(0.006, 0.022, 0.004), 0xffe7dc, onSurf(sp, 0.004, 0.1).multiply(TRS([0, -0.004, 0])));
  },
  nightcap(ctx, B) { // 睡帽：软软地往后耷拉 + 白绒球
    const top = blobPt(B, 0.15, 0.95, 1).p.setZ(0);
    const g = taperTube([[0, 0, 0], [-0.01, 0.07, 0], [-0.06, 0.12, 0], [-0.13, 0.1, 0]], 0.075, 0.012, 16, 12);
    ctx.body.add(g, 0x8ea2ee, TRS([top.x, top.y - 0.02, 0], [0, 0, 0.15]), true);
    ctx.body.add(new THREE.TorusGeometry(0.075, 0.022, 6, 22).rotateX(Math.PI / 2), 0xffffff, TRS([top.x, top.y - 0.02, 0], [0, 0, 0.15]), true);
    ctx.body.add(sph(0.03, 12, 8), 0xffffff, TRS([top.x - 0.13 + 0.02, top.y + 0.1 - 0.0, 0]), true);
    for (const [x, y, z] of [[-0.02, 0.06, 0.05], [-0.06, 0.1, 0.035], [0.015, 0.03, -0.06]]) ctx.body.add(sph(0.008, 6, 4), 0xfff3a0, TRS([top.x + x, top.y + y - 0.02, z]));
  },
  frogeyes(ctx, B) { // 头顶两个鼓包，眼睛长在上面
    const R = B.R, c = ctx.P.c;
    for (const s of [1, -1]) {
      const c0 = V(R[0] * 0.38, R[1] * 0.82, s * R[2] * 0.42);
      ctx.body.add(sph(0.05, 14, 10), c, TRS([c0.x, c0.y, c0.z]), true);
      const n = V(0.55, 0.45, s * 0.7).normalize();
      eyeOn(ctx, { p: c0.clone().addScaledVector(n, 0.05), n }, 0.03, s);
    }
    ctx.skipEye = 2;
  },
  legs(ctx, B) { // 蝌蚪刚长出来的两条小后腿（小小的）
    const R = B.R, c = mixHex(ctx.P.c, 0xffffff, 0.15);
    for (const s of [1, -1]) {
      ctx.body.add(taperTube([[-R[0] * 0.5, -R[1] * 0.55, s * R[2] * 0.55], [-R[0] * 0.75, -R[1] * 0.85, s * R[2] * 0.7]], 0.014, 0.011, 6, 6), c, null, true);
      ctx.body.add(ell(0.018, 0.007, 0.015, 8, 6), c, TRS([-R[0] * 0.8, -R[1] * 0.92, s * R[2] * 0.72]), true);
    }
  },
  skirt(ctx, B) { // 鲷鱼烧的"裙边"：模具缝挤出来的一圈薄面皮
    const R = B.R;
    ctx.body.add(blobGeo([R[0] * 1.03, R[1] * 1.07, 0.012], B.T * 0.9, 2, 30, 10), 0xf6c97f, null, true);
  },
  bean(ctx, B) { // 嘴边漏出来的红豆馅
    const R = B.R;
    ctx.face.add(ell(0.02, 0.014, 0.022, 10, 8), 0x8c3b3b, TRS([R[0] * 0.95, -0.025, 0.01]));
  },
  icehl(ctx, B) { // 冰块上的高光 + 顶上一层霜
    const R = B.R;
    for (const s of [1, -1]) {
      ctx.body.add(ell(0.05, 0.008, 0.004, 10, 4), 0xffffff, TRS([-0.03, 0.07, s * R[2] * 1.005], [0, 0, 0.6]));
      ctx.body.add(ell(0.018, 0.007, 0.004, 8, 4), 0xffffff, TRS([0.03, 0.105, s * R[2] * 1.005], [0, 0, 0.6]));
    }
    ctx.body.add(blobGeo([R[0] * 0.8, 0.012, R[2] * 0.8], 0, 4, 16, 6), 0xffffff, TRS([0, R[1] * 0.995, 0]));
    for (const [x, y, r] of [[-0.06, -0.06, 0.012], [-0.09, -0.02, 0.008], [-0.03, -0.1, 0.007]]) for (const s of [1, -1]) ctx.body.add(sph(r, 8, 6).scale(1, 1, 0.4), 0xf4fbff, TRS([x, y, s * R[2] * 1.0]));
  },
  cracks(ctx, B) { // 熔岩的发光裂纹
    const list = [[0.3, 0.45, 0.5], [0.05, 0.6, -0.4], [-0.25, 0.35, 0.8], [-0.1, -0.1, -0.2], [0.25, -0.25, 1.1], [-0.45, 0.05, 0.3], [-0.35, -0.4, -0.7], [0.1, 0.2, 1.4]];
    for (const [fx, fy, spin] of list) {
      for (const s of [1, -1]) {
        dotOn(ctx.body, blobPt(B, fx, fy, s), 0.007, 0.034, 0xff8a3d, s * spin, -0.05);
        dotOn(ctx.body, blobPt(B, fx + 0.04, fy + 0.05, s), 0.005, 0.02, 0xffd36b, s * (spin + 0.9), -0.05);
      }
    }
  },
  ribs(ctx, B) { // 透明鱼的骨头：一根脊椎 + 几根肋骨
    const R = B.R;
    for (const s of [1, -1]) {
      for (let i = 0; i < 6; i++) {
        const fx = 0.32 - i * 0.16;
        dotOn(ctx.body, blobPt(B, fx, 0.0, s), 0.005, 0.04 - i * 0.003, 0xa6d4ef, 0.0, -0.1);
      }
      ctx.body.add(ell(R[0] * 0.75, 0.006, 0.004, 14, 4), 0x8cc6e8, onSurf(blobPt(B, -0.05, 0.02, s), -0.001));
    }
  },
  calyx(ctx, B) { // 辣椒蒂：头顶的绿色小帽 + 弯弯的梗
    const top = blobPt(B, 0.2, 0.95, 1).p.setZ(0);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU;
      ctx.body.add(ell(0.04, 0.012, 0.022, 10, 6), 0x6cc35a, TRS([top.x + Math.cos(a) * 0.028, top.y + 0.0, Math.sin(a) * 0.028], [0, -a, -0.35]), true);
    }
    ctx.body.add(taperTube([[top.x, top.y, 0], [top.x - 0.005, top.y + 0.05, 0], [top.x - 0.04, top.y + 0.075, 0]], 0.012, 0.009, 8, 6), 0x5aa84a, null, true);
  },
  brows(ctx, B) { // 生气的小眉毛 + 一滴汗
    for (const s of [1, -1]) {
      const sp = blobPt(B, ctx.eyeAt[0] + 0.05, ctx.eyeAt[1] + 0.3, s);
      ctx.face.add(new THREE.BoxGeometry(0.035, 0.008, 0.006), DARK, onSurf(sp, 0.003, s * -0.4));
    }
    const sw = blobPt(B, 0.1, 0.6, 1);
    ctx.face.add(sph(0.012, 8, 6).scale(1, 1.3, 0.6), 0x9fdcff, onSurf(sw, 0.006));
  },
  sprinkles(ctx, pts) {
    const cols = [0xffffff, 0x8fd3ff, 0xfff07a, 0xb7f09a, 0xc8a8ff];
    pts.forEach((m, i) => ctx.body.add(cyl(0.005, 0.005, 0.022, 5), cols[i % cols.length], m));
  },
};

/* ================================================================ 外观表：原型 + 参数 + 配件 */
// a 原型 · R 半径 · T 后半身收窄 · p 方度 · c 主色 · back 背色（渐变）· belly 肚皮 · fin 鳍色
// tail [形状, 长, 色...] · dorsal 背鳍 · pat 花纹 · eye [fx, fy, r] · mouth · x 配件 · glow 发光色（传说）
const G = {
  /* ---------- sea ---------- */
  sardine: { a: "fish", R: [0.21, 0.07, 0.05], T: 0.4, c: 0xb0d2ef, back: 0x6f9fd6, belly: 0xf4f8fd, fin: 0xc4dbf2,
    tail: ["fork", 0.15], dorsal: { t: "fin", L: 0.05, H: 0.035 }, eye: [0.62, 0.12, 0.033],
    pat: [["spots", 0x4c6fae, [[0.25, 0.22, 0.013], [0.05, 0.25, 0.013], [-0.15, 0.25, 0.012], [-0.35, 0.22, 0.011], [-0.52, 0.18, 0.01]]]] },
  mackerel: { a: "fish", R: [0.22, 0.082, 0.06], T: 0.45, c: 0xcfe7e6, back: 0x5aa8bd, belly: 0xf6fafa, fin: 0x9fcfd6,
    tail: ["crescent", 0.15], dorsal: { t: "spiky", n: 3 }, eye: [0.62, 0.12, 0.034], pat: [["dashes", 0x2f6f86]] },
  toast: { a: "fish", R: [0.19, 0.17, 0.07], T: 0, p: 4.5, c: 0xc98a4c, fin: 0xd99a5a, faceR: [0.172, 0.15, 0.078],
    panel: 0xffe6b0, tail: ["round", 0.1], eye: [0.42, 0.18, 0.036], mouth: "smile", x: ["butter"] },
  mustache: { a: "fish", R: [0.19, 0.12, 0.085], T: 0.35, c: 0xd2bfa6, back: 0xa08a72, belly: 0xf6eddf, fin: 0xb59e84,
    tail: ["round", 0.12], dorsal: { t: "fin" }, eye: [0.55, 0.22, 0.038], mouth: "none",
    pat: [["spots", 0xe8dac6, [[0.1, 0.55, 0.018], [-0.2, 0.5, 0.015], [-0.45, 0.4, 0.012], [0.25, -0.1, 0.012]]]], x: ["mustache", "monocle"] },
  crab: { a: "crab", c: 0xff8a66, belly: 0xffd2b8, claw: 0xff7552 },
  flounder: { a: "flat", c: 0xdcc39c, belly: 0xfffaf0, frill: 0xc7a97e, spot: 0xb39168 },
  donut: { a: "ring", dough: 0xf2bd7c, icing: 0xff9ec6 },
  cloud: { a: "cloud" },
  garden: { a: "eel", c: 0xfff8ee, spot: 0x4a3f3a, len: 0.48, r: 0.048 },
  seahorse: { a: "seahorse", c: 0xffbb6b, belly: 0xffe2ad, fin: 0xfff0c8 },
  angelfish: { a: "fish", R: [0.13, 0.14, 0.05], T: 0.2, c: 0xfff1a6, belly: 0xfffbe6, fin: 0xffe27a,
    tail: ["fan", 0.12], dorsal: { t: "trail", c: 0x7a8fe0 }, eye: [0.55, 0.18, 0.034],
    pat: [["band", 0x6b84d6, [[0.32, 0.5], [-0.15, 0.02], [-0.62, -0.46]]]] },
  squid: { a: "squid", c: 0xfff0ea, spot: 0xffa8bf, fin: 0xffd6e0 },
  bulb: { a: "fish", R: [0.16, 0.145, 0.13], T: 0.25, c: 0x7181bd, belly: 0xb3bfe6, fin: 0x8e9dd6,
    tail: ["fan", 0.1], eye: [0.55, 0.3, 0.045], mouth: "grin", x: ["lure"], glowPart: 0xffd84a,
    pat: [["spots", 0x8f9ed6, [[0.0, 0.6, 0.02], [-0.3, 0.5, 0.016], [-0.1, 0.3, 0.012]]]] },
  manta: { a: "ray", c: 0x6378ad, belly: 0xf5f7ff, spot: 0xdfe6ff },
  watermelon: { a: "fish", R: [0.17, 0.135, 0.12], T: 0.25, c: 0x96d872, fin: 0x7cc45a, belly: 0xc8f0a8,
    tail: ["slice", 0.17], eye: [0.55, 0.2, 0.04], mouth: "lips", lips: 0xff6f7d, pat: [["meridian", 0x3f8f45, 5, "x", 0.028]] },
  sunfish: { a: "fish", R: [0.16, 0.16, 0.06], T: 0, c: 0xbac9e4, back: 0x93a8cf, belly: 0xeef2fa, fin: 0x9fb2d6,
    tail: ["clavus", 0.16], dorsal: { t: "tall" }, eye: [0.55, 0.2, 0.034], mouth: "o", noPec: false,
    pat: [["spots", 0xdde6f5, [[0.1, 0.4, 0.02], [-0.25, 0.2, 0.026], [0.0, -0.3, 0.018], [-0.5, -0.1, 0.015]]]] },
  swordfish: { a: "fish", R: [0.18, 0.07, 0.055], T: 0.45, c: 0x86a6dc, back: 0x4e6fae, belly: 0xeef3fb, fin: 0x6a88c8,
    tail: ["crescent", 0.15], dorsal: { t: "sail", c: 0x5a7cc4, c2: 0x9fc0f0 }, eye: [0.62, 0.15, 0.032], x: ["sword"],
    pat: [["band", 0xb3c9ef, [[0.2, 0.26], [-0.05, 0.01], [-0.3, -0.24]], -Math.PI / 2, Math.PI]] },
  hammer: { a: "fish", R: [0.19, 0.08, 0.07], T: 0.5, c: 0xb6c5d8, belly: 0xf6f8fb, fin: 0xa3b4cb,
    tail: ["shark", 0.15], dorsal: { t: "shark" }, eye: null, mouth: "smile", x: ["hammer"], blushAt: false },
  pirate: { a: "fish", R: [0.17, 0.125, 0.09], T: 0.3, c: 0xff9a7e, belly: 0xfff1e0, fin: 0xff8366,
    tail: ["fan", 0.13], eye: [0.55, 0.15, 0.04], mouth: "smile", x: ["tricorn", "eyepatch", "earring"],
    pat: [["hline", 0xffffff, -0.42, -0.3], ["hline", 0xffffff, -0.72, -0.6]] },
  rainbow: { a: "fish", R: [0.19, 0.105, 0.072], T: 0.4, c: 0xffffff, belly: 0xffffff, fin: 0xf1e8ff, glow: 0xffb4e6,
    tail: ["lyre", 0.2, 0xe3d6ff, 0xffd6ec], dorsal: { t: "fin", c: 0xe8dcff, L: 0.1, H: 0.05 }, eye: [0.62, 0.17, 0.04],
    pat: [["rainbow", [0xff7f93, 0xffb36b, 0xffe66b, 0x8fdc7f, 0x74c0ff, 0xb08fff]]], sparkle: 0xfff6ff },

  /* ---------- pool ---------- */
  carp: { a: "fish", R: [0.2, 0.12, 0.085], T: 0.4, c: 0xe6b766, back: 0xb88640, belly: 0xfff1cc, fin: 0xd99f55,
    tail: ["fan", 0.15], dorsal: { t: "fin", L: 0.11, H: 0.04 }, eye: [0.6, 0.18, 0.04], x: ["whiskers"], pat: [["scales", 0xc28b44]] },
  minnow: { a: "fish", R: [0.18, 0.058, 0.042], T: 0.4, c: 0xe2ebf2, back: 0xa9bccc, belly: 0xffffff, fin: 0xffe08a,
    tail: ["fork", 0.13], dorsal: { t: "fin", L: 0.04, H: 0.03, c: 0xffe08a }, eye: [0.62, 0.12, 0.032], pat: [["hline", 0x7f93b0, -0.1, 0.06]] },
  mitten: { a: "mitten", c: 0xff7f86, c2: 0xffffff },
  trout: { a: "fish", R: [0.2, 0.086, 0.062], T: 0.4, c: 0xc2d1a3, back: 0x8ea477, belly: 0xfff4ec, fin: 0xc9d6a8,
    tail: ["fan", 0.14], dorsal: { t: "fin", L: 0.05 }, eye: [0.6, 0.15, 0.034],
    pat: [["hline", 0xff9fb4, -0.18, 0.1], ["spots", 0x5b5a4a, [[0.25, 0.6, 0.008], [0.05, 0.7, 0.008], [-0.15, 0.55, 0.008], [-0.35, 0.7, 0.007], [-0.1, 0.85, 0.007], [-0.5, 0.45, 0.007], [0.15, 0.4, 0.007]]]] },
  tadpole: { a: "fish", R: [0.12, 0.11, 0.105], T: 0.1, c: 0x6f7fa6, back: 0x56638a, belly: 0xc3cde6, fin: 0x6f7fa6,
    tail: ["tadpole", 0.3, 0x6f7fa6, 0xa9b6d9], eye: [0.5, 0.28, 0.046], noPec: true, x: ["legs"], tailAmp: 0.6 },
  catfish: { a: "fish", R: [0.21, 0.09, 0.085], T: 0.55, p: 2.2, c: 0xa79a8c, back: 0x76695e, belly: 0xefe6da, fin: 0x8e8073,
    tail: ["round", 0.13], dorsal: { t: "fin", L: 0.04, H: 0.035 }, eye: [0.62, 0.3, 0.026], mouth: "wide", x: ["barbels"] },
  snail: { a: "snail", shell: 0xd9965a, stripe: 0xfbe3bb, c: 0xc9d6c0 },
  leaf: { a: "leaf", c: 0xf5a54d, c2: 0xe8673a, vein: 0xc9543a },
  rivercrab: { a: "crab", c: 0x8f9a62, belly: 0xd8d6a8, claw: 0x7f8a55, hairy: 0x5b4636 },
  frogfish: { a: "fish", R: [0.15, 0.12, 0.135], T: 0.2, c: 0xa6d881, belly: 0xf2f6c4, fin: 0x8cc66c,
    tail: ["fan", 0.1], eye: [0.55, 0.3, 0.03], mouth: "wide", x: ["frogeyes"],
    pat: [["spots", 0x76b45f, [[-0.05, 0.6, 0.02], [-0.35, 0.45, 0.016], [-0.2, 0.15, 0.013], [0.1, 0.35, 0.012]]]] },
  bubbletea: { a: "fish", R: [0.14, 0.15, 0.12], T: 0.1, p: 3, c: 0xeccfa6, back: 0xf7e6cb, backAt: 0.2, fin: 0xddb487,
    tail: ["fan", 0.1], eye: [0.5, 0.25, 0.036], x: ["lid"], dorsalNone: true,
    pat: [["spots", 0x4a3226, [[0.25, -0.65, 0.022], [-0.05, -0.7, 0.022], [-0.35, -0.6, 0.02], [0.1, -0.45, 0.02], [-0.2, -0.42, 0.02], [-0.55, -0.35, 0.018]]]] },
  inkcarp: { a: "fish", R: [0.2, 0.11, 0.075], T: 0.45, c: 0xfbf8f1, ink: 0x3c3c48, fin: 0x7a7a88, belly: 0xffffff,
    tail: ["lyre", 0.2, 0x6c6c78, 0x9a9aa6], dorsal: { t: "fin", L: 0.1, H: 0.045, c: 0x5a5a66 }, eye: [0.6, 0.18, 0.04], x: ["whiskers", "seal"],
    pat: [["spots", 0x8a8a96, [[0.2, 0.55, 0.014], [-0.05, 0.75, 0.01], [0.35, 0.35, 0.009]]]] },
  lantern: { a: "fish", R: [0.15, 0.135, 0.135], T: 0.05, c: 0xff6b5e, fin: 0xff8a6e, glowBody: 0xff9a3c,
    tail: ["tassel", 0.16, 0xff4f4f, 0xffd25c], eye: [0.55, 0.12, 0.04], mouth: "smile",
    pat: [["meridian", 0xd8443c, 4, "y", 0.018], ["hline", 0xffd25c, 0.82, 1.0], ["hline", 0xffd25c, -1.0, -0.82]] },
  moonfish: { a: "fish", R: [0.17, 0.17, 0.075], T: 0, c: 0xfff1a8, belly: 0xfff1a8, fin: 0xfff6c8, glow: 0xffd84a,
    tail: ["fan", 0.11], eye: [0.45, 0.15, 0.04], eyeStyle: "sleepy", mouth: "smile", x: ["nightcap"], sparkle: 0xfffbd0,
    pat: [["spots", 0xf0d77c, [[-0.2, 0.45, 0.03], [-0.45, -0.15, 0.022], [0.05, -0.45, 0.018], [-0.15, -0.1, 0.014], [-0.6, 0.3, 0.015]]]] },

  /* ---------- far ---------- */
  petal: { a: "fish", R: [0.18, 0.1, 0.07], T: 0.4, c: 0xffcadb, back: 0xff9fbe, belly: 0xfff3f7, fin: 0xffdbe6,
    tail: ["petal", 0.14, 0xffb3cb, 0xffe3ec], dorsal: { t: "petal", c: 0xffb3cb }, eye: [0.6, 0.18, 0.038],
    pat: [["flowers", 0xffffff, [[0.0, 0.25, 0.04], [-0.42, -0.1, 0.03]]]] },
  dango: { a: "dango" },
  streamer: { a: "streamer", c: 0x8fb8ff, c2: 0xffffff, c3: 0xff8f8f },
  taiyaki: { a: "fish", R: [0.2, 0.13, 0.048], T: 0.3, c: 0xe8ab62, back: 0xd18a44, fin: 0xe39b55,
    tail: ["fan", 0.14], dorsal: { t: "fin", L: 0.1, H: 0.035 }, eye: [0.6, 0.2, 0.038], x: ["skirt", "bean"],
    pat: [["scales", 0xc47c3a, null, 0.026]] },
  icecube: { a: "fish", R: [0.15, 0.15, 0.14], T: 0, p: 5, c: 0xd2f0ff, fin: 0xb2e2ff,
    tail: ["fan", 0.13], eye: [0.42, 0.18, 0.036], mouth: "o", x: ["icehl"], dorsalNone: true, pec: [-0.2, -0.62] },
  snowman: { a: "snowman" },
  glassfish: { a: "fish", R: [0.2, 0.09, 0.065], T: 0.4, c: 0xe4f6ff, belly: 0xffffff, fin: 0xcdeeff,
    tail: ["fan", 0.14], dorsal: { t: "spiky", c: 0xbde6fb, c2: 0xe6f7ff, n: 3 }, eye: [0.6, 0.15, 0.036], x: ["ribs"] },
  unicorn: { a: "fish", R: [0.2, 0.1, 0.08], T: 0.45, c: 0xccd5ff, back: 0xa8b4f2, belly: 0xffffff, fin: 0xb7c2f8,
    tail: ["crescent", 0.15], dorsal: { t: "fin", L: 0.06 }, eye: [0.58, 0.15, 0.036], x: ["horn", "scarf"],
    pat: [["spots", 0xe8ecff, [[-0.2, 0.5, 0.016], [-0.45, 0.3, 0.013], [0.05, 0.62, 0.012]]]] },
  lavafish: { a: "fish", R: [0.2, 0.105, 0.08], T: 0.4, c: 0x6a5b66, back: 0x463a42, belly: 0x8a7a84, fin: 0xff8a3d,
    tail: ["flame", 0.16, 0xff7a3a, 0xffc04d], dorsal: { t: "spiky", c: 0x463a42, n: 4 }, eye: [0.6, 0.18, 0.036], x: ["cracks"] },
  chili: { a: "chili", c: 0xff5a4a },
  phoenix: { a: "fish", R: [0.18, 0.1, 0.075], T: 0.4, c: 0xff8a4c, back: 0xffc04d, backAt: 0.0, belly: 0xfff0c8, fin: 0xffb347, glow: 0xff7a1a,
    tail: ["phoenix", 0.24, 0xff5a3c, 0xffa53d, 0xffe36b], dorsal: { t: "flame", c: 0xff6a3c, c2: 0xffd04d }, eye: [0.6, 0.18, 0.038],
    x: ["crest"], sparkle: 0xffe8a0 },
};

/* ================================================================ 原型 */
const A = {};

// 通用"鱼"：超椭球身体 + 肚皮 + 花纹 + 眼睛嘴巴腮红 + 背鳍 + 胸鳍 + 尾巴 + 配件
A.fish = (ctx, P) => {
  const B = { R: P.R, T: P.T ?? 0.35, p: P.p ?? 2 };
  const R = B.R;
  const back = P.back, at = P.backAt ?? 0.25;
  const ink = P.ink;
  const paint = ink
    ? (p) => mixHex(P.c, ink, clamp01(sstep(-0.15, -0.95, p.x / R[0]) * 0.95 + sstep(0.55, 1.05, p.y / R[1]) * 0.7))
    : back ? (p) => mixHex(P.c, back, sstep(at, 0.95, p.y / R[1])) : P.c;
  ctx.body.add(blobGeo(R, B.T, B.p, 28, 20), paint, null, true);
  if (P.belly) ctx.body.add(smooth(deformBlob(hbandGeo(-1, -0.42, 28), R, B.T, B.p, 1.012)), P.belly);
  if (P.panel) { // 吐司：两面的软面包
    const FB = { R: P.faceR, T: 0, p: B.p };
    ctx.body.add(blobGeo(P.faceR, 0, B.p, 26, 18), P.panel);
    ctx.FB = FB;
  }
  for (const pt of P.pat || []) pattern(ctx, pt, B);
  const F = ctx.FB || B; // 脸贴在哪个表面上
  ctx.eyeAt = P.eye ? [P.eye[0], P.eye[1]] : [0.6, 0.18];
  ctx.eyeR = P.eye ? P.eye[2] : 0.04;
  ctx.blushC = mixHex(ctx.P.belly ?? P.c, PINK, 0.5);
  for (const x of P.x || []) X[x](ctx, F);
  if (P.eye) {
    [1, -1].forEach((s, i) => {
      if (ctx.skipEye === 2 || (ctx.skipEye === 1 && s === 1)) return;
      eyeOn(ctx, blobPt(F, P.eye[0], P.eye[1], s), P.eye[2], s, P.eyeStyle);
    });
  }
  if (P.blushAt !== false && ctx.skipEye !== 2) {
    for (const s of [1, -1]) blushOn(ctx, blobPt(F, Math.max(0.15, P.eye ? P.eye[0] - 0.28 : 0.3), (P.eye ? P.eye[1] : 0.18) - 0.48, s), 0.024, ctx.blushC);
  }
  mouth(ctx, F, P.mouth ?? "lips", P.lips);
  if (P.dorsal && !P.dorsalNone) finShape(ctx, { c: P.fin, ...P.dorsal }, B);
  const pp = P.pec ?? (R[1] / R[0] > 0.75 ? [-0.05, -0.5] : [0.2, -0.38]);
  if (!P.noPec) for (const s of [1, -1]) pecFin(ctx, blobPt(B, pp[0], pp[1], s).p, s, 0.055 * (R[1] > 0.12 ? 1.1 : 1), 0.03, P.fin);
  const tx = -R[0] * 0.86;
  buildTail(ctx, P.tail && [P.tail[0], P.tail[1], P.tail[2] ?? P.fin, P.tail[3], P.tail[4]], V(B.p > 3 ? -R[0] * 0.97 : tx, 0, 0));
  if (P.tailAmp) ctx.o.tailAmp = P.tailAmp;
};

function mouth(ctx, B, type, lipC = MOUTH) {
  const R = B.R;
  if (type === "none") return;
  if (type === "lips") {
    const g = new THREE.TorusGeometry(0.016, 0.008, 6, 12).rotateY(Math.PI / 2);
    const sp = blobDir(B, 1, -0.15, 0);
    ctx.face.add(g, lipC, TRS([sp.p.x - 0.004, sp.p.y, 0]));
  } else if (type === "o") {
    const sp = blobDir(B, 1, -0.2, 0);
    ctx.face.add(new THREE.TorusGeometry(0.012, 0.005, 6, 12).rotateY(Math.PI / 2), DARK, TRS([sp.p.x, sp.p.y, 0]));
  } else { // smile / wide / grin：沿着脸前面的一道 ∪
    const w = type === "smile" ? 0.45 : 0.75, dy = type === "smile" ? 0.1 : 0.16;
    const pts = [];
    for (let i = 0; i <= 8; i++) {
      const t = -1 + i / 4;
      const sp = blobDir(B, 1, -0.22 - dy * (1 - t * t), t * w);
      pts.push(sp.p.addScaledVector(sp.n, 0.002).toArray());
    }
    ctx.face.add(taperTube(pts, type === "smile" ? 0.005 : 0.007, type === "smile" ? 0.005 : 0.007, 16, 5), DARK);
    if (type === "grin") {
      for (let i = 1; i < 8; i += 2) {
        const sp = blobDir(B, 1, -0.22 - dy * (1 - (-1 + i / 4) ** 2) + 0.06, (-1 + i / 4) * w);
        const m = new THREE.Matrix4().compose(sp.p, new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), V(0, -1, 0)), V(1, 1, 1));
        ctx.face.add(cone(0.01, 0.024, 5), 0xffffff, m.premultiply(new THREE.Matrix4().makeTranslation(0, -0.0, 0)));
      }
    }
  }
}

// 螃蟹：脸朝 +z（和章鱼一样正对镜头），扁扁的壳 + 眼柄 + 六条腿（静态）+ 两只举起来会开合的钳子
A.crab = (ctx, P) => {
  const R = [0.15, 0.08, 0.105];
  const B = { R, T: 0, p: 2.3 };
  ctx.body.add(blobGeo(R, 0, 2.3, 28, 18), (p) => (p.y < -0.025 ? P.belly : P.c), null, true);
  for (const [fx, fz, r] of [[0.0, 0.0, 0.02], [-0.45, -0.3, 0.014], [0.45, -0.3, 0.014], [-0.25, 0.4, 0.012], [0.25, 0.4, 0.012]]) dotOn(ctx.body, blobDir(B, fx, 1, fz), r, r, mixHex(P.c, 0xffffff, 0.35));
  for (const s of [1, -1]) {
    // 眼柄 + 眼睛（朝前）
    ctx.body.add(cyl(0.012, 0.015, 0.07, 8), P.c, TRS([s * 0.05, 0.09, 0.05], [0.25, 0, s * -0.15]), true);
    eyeOn(ctx, { p: V(s * 0.056, 0.135, 0.07), n: V(s * 0.15, 0.2, 1).normalize() }, 0.032, 1);
    blushOn(ctx, blobDir(B, s * 0.55, -0.05, 0.8), 0.024, mixHex(P.c, PINK, 0.45));
    // 三条腿：往两边、往下弯
    for (let i = 0; i < 3; i++) {
      const z = 0.04 - i * 0.045, x = s * 0.13;
      ctx.body.add(taperTube([[x, -0.02, z], [x + s * 0.07, 0.01, z - 0.01], [x + s * 0.11, -0.07, z - 0.02]], 0.015, 0.009, 8, 6), P.claw, null, true);
    }
    // 钳子（单独网格，pivot 在肩膀；整只举在前面）
    const piv = new THREE.Group();
    piv.position.set(s * 0.12, 0.0, 0.07);
    piv.userData.s = s;
    const a = new Acc();
    a.add(taperTube([[0, 0, 0], [s * 0.035, 0.03, 0.03], [s * 0.05, 0.07, 0.04]], 0.017, 0.015, 8, 6), P.claw, null, true);
    a.add(ell(0.045, 0.055, 0.036, 14, 10), P.claw, TRS([s * 0.055, 0.115, 0.045], [0, 0, s * -0.2]), true);
    a.add(ell(0.013, 0.032, 0.02, 10, 6), P.claw, TRS([s * 0.03, 0.17, 0.045], [0, 0, s * 0.35]), true);
    a.add(ell(0.012, 0.028, 0.018, 10, 6), P.claw, TRS([s * 0.075, 0.168, 0.045], [0, 0, s * -0.35]), true);
    if (P.hairy) for (let i = 0; i < 10; i++) {
      const a2 = i * 2.4;
      a.add(sph(0.017, 8, 6), P.hairy, TRS([s * (0.055 + Math.cos(a2) * 0.035), 0.075 + (i / 10) * 0.05, 0.045 + Math.sin(a2) * 0.03]), true);
    }
    ctx.fins.push({ piv, acc: a });
  }
  const sm = [];
  for (let i = 0; i <= 6; i++) { const t = -1 + i / 3; const sp = blobDir(B, t * 0.3, -0.25 - 0.12 * (1 - t * t), 1); sm.push(sp.p.addScaledVector(sp.n, 0.002).toArray()); }
  ctx.face.add(taperTube(sm, 0.005, 0.005, 10, 5), DARK);
  ctx.o.finsCustom = true;
  ctx.o.onSwim = (w) => {
    for (const f of ctx.o.fins) f.rotation.z = -f.userData.s * Math.max(0, Math.sin(w * 5 + (f.userData.s > 0 ? 0 : 1.5))) * 0.3;
    ctx.o.sway.position.x = Math.sin(w * 3) * 0.015; // 横着走
    ctx.o.sway.rotation.y = 0;
  };
};

// 比目鱼：趴着的扁椭圆，两只眼睛都在上面，四周一圈裙边鳍
A.flat = (ctx, P) => {
  const R = [0.2, 0.04, 0.13];
  const B = { R, T: 0.2, p: 2 };
  ctx.body.add(blobGeo(R, 0.2, 2, 28, 16), (p) => (p.y > -0.004 ? P.c : P.belly), null, true);
  ctx.body.add(blobGeo([0.215, 0.011, 0.155], 0.25, 2, 30, 8), P.frill, TRS([-0.01, -0.004, 0]), true);
  for (const [dx, dz, r] of [[-0.2, 0.3, 0.02], [0.0, -0.45, 0.018], [-0.45, -0.1, 0.022], [0.2, 0.35, 0.014], [-0.55, 0.45, 0.012], [-0.25, -0.5, 0.014]]) {
    dotOn(ctx.body, blobDir(B, dx, 1, dz), r, r * 0.85, P.spot);
  }
  // 两只眼睛挤在上面这一侧（朝上、稍微朝前）
  eyeOn(ctx, blobDir(B, 0.62, 1, 0.38), 0.032, 1);
  eyeOn(ctx, blobDir(B, 0.72, 1, -0.12), 0.03, 1);
  blushOn(ctx, blobDir(B, 0.5, 0.6, 0.85), 0.022, mixHex(P.c, PINK, 0.5));
  const sm = [];
  for (let i = 0; i <= 6; i++) { const t = i / 6; const sp = blobDir(B, 1, 0.1 - 0.4 * Math.sin(t * Math.PI), 0.15 + t * 0.35); sm.push(sp.p.addScaledVector(sp.n, 0.002).toArray()); }
  ctx.face.add(taperTube(sm, 0.005, 0.005, 10, 5), DARK);
  buildTail(ctx, ["fan", 0.12, P.frill], V(-R[0] * 0.92, 0, 0));
  ctx.tail.g.forEach((g) => g.rotateX(Math.PI / 2)); // 尾巴横过来
  ctx.o.tailAxis = "z";
  ctx.o.tailAmp = 0.35;
  ctx.o.swayAxis = "z";
  ctx.tilt = [0.85, 0, 0]; // 趴着的鱼：往镜头这边侧一点，看得到背上的两只眼睛
};

// 甜甜圈：竖着的圆环，两面都有糖霜 + 彩色糖针
A.ring = (ctx, P) => {
  const RR = 0.13, tr = 0.068;
  const g = new THREE.TorusGeometry(RR, tr, 18, 40);
  const iced = (p) => {
    const c = V(p.x, p.y, 0).normalize().multiplyScalar(RR);
    const l = p.clone().sub(c);
    const ang = Math.atan2(p.y, p.x);
    return Math.abs(l.z) / tr > 0.32 + 0.12 * Math.sin(ang * 9);
  };
  ctx.body.add(g, (p) => (iced(p) ? P.icing : P.dough), null, true);
  const ms = [];
  for (let i = 0; i < 22; i++) {
    const ang = i * 2.399 + 0.3, s = i % 2 ? 1 : -1;
    const rr = RR + Math.sin(i * 1.7) * tr * 0.4;
    if (Math.cos(ang) > 0.55 && Math.abs(Math.sin(ang)) < 0.5) continue; // 脸那块留空
    const p = V(Math.cos(ang) * rr, Math.sin(ang) * rr, 0);
    const dz = Math.sqrt(Math.max(0, tr * tr - (rr - RR) ** 2));
    ms.push(TRS([p.x, p.y, s * (dz + 0.002)], [Math.PI / 2, 0, ang * 3.1]));
  }
  X.sprinkles(ctx, ms);
  for (const s of [1, -1]) {
    const face = (ang, rr) => { const p = V(Math.cos(ang) * rr, Math.sin(ang) * rr, 0); const dz = Math.sqrt(Math.max(0, tr * tr - (rr - RR) ** 2)); return { p: p.setZ(s * dz), n: V((rr - RR) / tr * Math.cos(ang) + 0.25, (rr - RR) / tr * Math.sin(ang), s * dz / tr).normalize() }; };
    eyeOn(ctx, face(0.32, RR + 0.01), 0.032, s);
    blushOn(ctx, face(0.08, RR + 0.045), 0.02, mixHex(P.icing, PINK, 0.5));
    const pts = [];
    for (let i = 0; i <= 6; i++) { const t = -1 + i / 3; const f = face(-0.05 + t * 0.12, RR - 0.005 - 0.012 * (1 - t * t)); pts.push(f.p.addScaledVector(f.n, 0.003).toArray()); }
    ctx.face.add(taperTube(pts, 0.005, 0.005, 10, 5), DARK);
  }
  for (const s of [1, -1]) pecFin(ctx, V(0.05, -RR - tr * 0.6, s * 0.03), s, 0.04, 0.022, P.dough);
  buildTail(ctx, ["fan", 0.12, P.icing], V(-RR - tr * 0.85, 0, 0));
};

// 一团团小球拼起来的：云朵
A.cloud = (ctx) => {
  const puffs = [[0, 0, 0, 0.12], [0.1, 0.02, 0, 0.09], [-0.1, 0.03, 0, 0.1], [0.03, 0.09, 0, 0.09], [-0.06, 0.1, 0, 0.075], [0.15, -0.03, 0, 0.06], [-0.16, -0.03, 0, 0.065], [0, -0.05, 0.03, 0.09], [0, -0.05, -0.03, 0.09]];
  const paint = (p) => mixHex(0xffffff, 0xd6dcf5, sstep(0.02, -0.11, p.y));
  for (const [x, y, z, r] of puffs) ctx.body.add(sph(r, 18, 14).scale(1, 0.92, 0.85).translate(x, y, z), paint, null, true);
  for (const s of [1, -1]) {
    eyeOn(ctx, { p: V(0.11, 0.025, s * 0.072), n: V(0.4, 0.1, s).normalize() }, 0.032, s);
    blushOn(ctx, { p: V(0.13, -0.025, s * 0.07), n: V(0.5, -0.1, s).normalize() }, 0.02, 0xffc4d2);
  }
  ctx.face.add(taperTube([[0.205, -0.015, 0.02], [0.21, -0.03, 0], [0.205, -0.015, -0.02]], 0.005, 0.005, 8, 5), DARK);
  // 尾巴：三朵小云
  ctx.tail.add(sph(0.05, 12, 10), paint, TRS([-0.03, 0.03, 0]), true);
  ctx.tail.add(sph(0.045, 12, 10), paint, TRS([-0.04, -0.035, 0]), true);
  ctx.tail.add(sph(0.035, 12, 10), paint, TRS([-0.075, 0.0, 0]), true);
  const t = new THREE.Group();
  t.position.set(-0.2, 0.0, 0);
  ctx.tailG = t;
  // 一滴小雨点（像在流口水 / 下雨）
  ctx.body.add(sph(0.014, 8, 6).scale(1, 1.3, 1), 0x9fd8ff, TRS([0.05, -0.16, 0.02]));
};

// 花园鳗：一根直直的长管子，前半身静止，后半身是尾巴
A.eel = (ctx, P) => {
  const r = P.r, len = P.len;
  const head = len * 0.5;
  ctx.body.add(blobGeo([0.06, r * 1.15, r * 1.1], 0, 2, 18, 12), P.c, TRS([head - 0.04, 0.005, 0]), true);
  ctx.body.add(cyl(r, r, head, 14, 1).rotateZ(Math.PI / 2), P.c, TRS([head / 2 - 0.03, 0, 0]), true);
  ctx.tail.add(taperTube([[0.0, 0, 0], [-len * 0.2, 0.01, 0], [-len * 0.4, -0.005, 0], [-len * 0.52, 0.0, 0]], r, r * 0.35, 16, 12), P.c, null, true);
  const spots = [[0.12, 0.6], [0.05, -0.3], [0.17, -0.6], [-0.0, 0.8], [0.09, 0.2]];
  for (const [x, a] of spots) for (const s of [1, -1]) ctx.body.add(ell(0.011, 0.011, 0.004, 8, 6), P.spot, onSurf({ p: V(x, Math.sin(a) * r, s * Math.cos(a) * r), n: V(0, Math.sin(a), s * Math.cos(a)) }, -0.001));
  for (const [x, a] of [[-0.06, 0.4], [-0.13, -0.5], [-0.19, 0.6]]) for (const s of [1, -1]) ctx.tail.add(ell(0.01, 0.01, 0.004, 8, 6), P.spot, onSurf({ p: V(x, Math.sin(a) * r * 0.75, s * Math.cos(a) * r * 0.75), n: V(0, Math.sin(a), s * Math.cos(a)) }, -0.001));
  const HB = { R: [0.06, r * 1.15, r * 1.1], T: 0, p: 2 };
  const hc = V(head - 0.04, 0.005, 0);
  for (const s of [1, -1]) {
    const e = blobPt(HB, 0.35, 0.3, s); e.p.add(hc);
    eyeOn(ctx, e, 0.024, s);
    const b = blobPt(HB, 0.2, -0.35, s); b.p.add(hc);
    blushOn(ctx, b, 0.014, mixHex(P.c, PINK, 0.5));
  }
  const m = blobDir(HB, 1, -0.25, 0); m.p.add(hc);
  ctx.face.add(new THREE.TorusGeometry(0.008, 0.004, 5, 10).rotateY(Math.PI / 2), MOUTH, TRS([m.p.x, m.p.y, 0]));
  ctx.body.add(ell(0.03, 0.012, 0.005, 10, 6), 0xfff0d0, TRS([0.0, r * 0.95, 0], [0, 0, 0.0]), true); // 小背鳍
  const t = new THREE.Group();
  t.position.set(0.0, 0, 0);
  ctx.tailG = t;
  ctx.o.tailAmp = 0.35;
};

// 鲤鱼旗：空心的布管子，前面张着圆嘴，大圆眼睛，布尾巴分叉
A.streamer = (ctx, P) => {
  const r = 0.09, L = 0.3;
  const prof = [];
  for (let i = 10; i >= 0; i--) { const t = i / 10; prof.push(new THREE.Vector2(r * (1 - 0.35 * t * t) + 0.004 * Math.sin(t * 12), -t * L)); }
  const g = new THREE.LatheGeometry(prof, 24).rotateZ(-Math.PI / 2); // 沿 x 轴，从 0 往 -x
  ctx.body.add(g, (p) => (p.y > r * 0.4 * (1 + p.x / L) ? mixHex(P.c, 0x5f86d6, 0.5) : P.c), TRS([0.12, 0, 0]), true);
  const gin = new THREE.LatheGeometry(prof.map((v) => new THREE.Vector2(v.x * 0.92, v.y)), 24).rotateZ(-Math.PI / 2);
  // 内壁（反过来的面），看进嘴里是深色
  const idx = gin.index.array;
  for (let i = 0; i < idx.length; i += 3) { const t = idx[i]; idx[i] = idx[i + 2]; idx[i + 2] = t; }
  gin.computeVertexNormals();
  ctx.body.add(gin, 0x4b5f8f, TRS([0.12, 0, 0]));
  ctx.body.add(new THREE.TorusGeometry(r * 1.02, 0.014, 8, 26).rotateY(Math.PI / 2), P.c2, TRS([0.12, 0, 0]), true);
  // 鳞片：白色弧
  for (const [x, a] of [[0.0, 0.4], [-0.07, -0.2], [-0.07, 0.95], [0.0, -0.75], [-0.14, 0.35], [-0.14, -0.6]]) {
    for (const s of [1, -1]) {
      const rr = r * (1 - 0.35 * ((0.12 - x) / L) ** 2);
      const sp = { p: V(x, Math.sin(a) * rr, s * Math.cos(a) * rr), n: V(0, Math.sin(a), s * Math.cos(a)) };
      ctx.body.add(new THREE.TorusGeometry(0.026, 0.006, 4, 10, Math.PI).rotateZ(Math.PI / 2 * s), P.c2, onSurf(sp, 0.002));
    }
  }
  // 大圆眼睛：白圈 + 黑眼珠
  for (const s of [1, -1]) {
    const sp = { p: V(0.07, 0.03, s * r * 0.98), n: V(0.1, 0.25, s).normalize() };
    ctx.face.add(ell(0.036, 0.036, 0.008, 14, 8), WHITE, onSurf(sp, 0.002));
    ctx.face.add(new THREE.TorusGeometry(0.036, 0.004, 5, 18), P.c3, onSurf(sp, 0.004));
    eyeParts(ctx.face, onSurf(sp, 0.004), 0.022, s);
    blushOn(ctx, { p: V(0.09, -0.04, s * r * 0.94), n: V(0.2, -0.3, s).normalize() }, 0.018, 0xffb0c0);
  }
  buildTail(ctx, ["fabric", 0.2, P.c, mixHex(P.c, 0xffffff, 0.35)], V(0.12 - L + 0.01, 0, 0));
  ctx.o.tailAmp = 0.5;
  ctx.o.onSwim = (w) => { ctx.o.body.scale.y = 1 + Math.sin(w * 4) * 0.03; };
};

// 辣椒鱼：弯弯的红辣椒，粗的一头是脑袋，尖尖往下翘是尾巴
A.chili = (ctx, P) => {
  const B = { R: [0.12, 0.09, 0.085], T: 0.1, p: 2 };
  ctx.body.add(blobGeo(B.R, 0.1, 2, 26, 18), P.c, TRS([0.06, 0, 0]), true);
  ctx.tail.add(taperTube([[0.02, 0, 0], [-0.07, -0.01, 0], [-0.15, -0.05, 0], [-0.21, -0.12, 0], [-0.22, -0.17, 0]], 0.075, 0.012, 20, 14), P.c, null, true);
  ctx.tail.add(ell(0.05, 0.008, 0.004, 10, 4), 0xffb0a0, TRS([-0.08, 0.055, 0.03], [0, 0, -0.15])); // 高光
  const sh = { R: B.R, T: B.T, p: 2 };
  const off = V(0.06, 0, 0);
  const wrap = (sp) => { sp.p.add(off); return sp; };
  ctx.eyeAt = [0.55, 0.15]; ctx.eyeR = 0.034;
  for (const s of [1, -1]) {
    eyeOn(ctx, wrap(blobPt(sh, 0.55, 0.15, s)), 0.034, s);
    blushOn(ctx, wrap(blobPt(sh, 0.35, -0.35, s)), 0.02, mixHex(P.c, PINK, 0.5));
    const sp = wrap(blobPt(sh, 0.62, 0.5, s));
    ctx.face.add(new THREE.BoxGeometry(0.035, 0.008, 0.006), DARK, onSurf(sp, 0.003, s * -0.45));
  }
  ctx.face.add(sph(0.012, 8, 6).scale(1, 1.4, 0.6), 0x9fdcff, onSurf(wrap(blobPt(sh, 0.15, 0.6, 1)), 0.006));
  const pts = [];
  for (let i = 0; i <= 8; i++) { const t = -1 + i / 4; const sp = wrap(blobDir(sh, 1, -0.25 - 0.06 * Math.sin(t * 6), t * 0.4)); pts.push(sp.p.addScaledVector(sp.n, 0.002).toArray()); }
  ctx.face.add(taperTube(pts, 0.005, 0.005, 16, 5), DARK); // 波浪嘴（辣！）
  const shB = { R: B.R, T: B.T, p: 2 };
  const top = blobPt(shB, 0.0, 0.95, 1).p.setZ(0).add(off);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU;
    ctx.body.add(ell(0.045, 0.012, 0.024, 10, 6), 0x6cc35a, TRS([top.x + Math.cos(a) * 0.03, top.y - 0.002, Math.sin(a) * 0.03], [0, -a, -0.3]), true);
  }
  ctx.body.add(taperTube([[top.x, top.y, 0], [top.x - 0.005, top.y + 0.05, 0], [top.x - 0.045, top.y + 0.075, 0]], 0.013, 0.009, 8, 6), 0x5aa84a, null, true);
  for (const s of [1, -1]) pecFin(ctx, V(0.05, -0.05, s * 0.06), s, 0.045, 0.024, 0xff7a6a);
  const t = new THREE.Group();
  t.position.set(-0.04, 0, 0);
  ctx.tailG = t;
  ctx.o.tailAmp = 0.3;
};

// 蝠鲼：宽宽的菱形身子，两片大翅膀上下扇，细长尾巴
A.ray = (ctx, P) => {
  const R = [0.13, 0.045, 0.1];
  const B = { R, T: 0.2, p: 2 };
  const paint = (p, n) => (n.y > -0.15 ? P.c : P.belly);
  ctx.body.add(blobGeo(R, 0.2, 2, 26, 16), paint, null, true);
  for (const s of [1, -1]) {
    ctx.body.add(ell(0.035, 0.012, 0.016, 10, 6), P.c, TRS([R[0] + 0.01, -0.005, s * 0.055], [0, s * 0.4, 0.3]), true); // 头鳍
    eyeOn(ctx, blobDir(B, 0.85, 0.3, s * 0.6), 0.028, s);
    blushOn(ctx, blobDir(B, 0.85, -0.1, s * 0.45), 0.018, mixHex(P.c, PINK, 0.45));
    for (const [fx, fz] of [[-0.1, 0.4], [0.2, 0.25], [-0.4, 0.2]]) dotOn(ctx.body, blobDir(B, fx, 1, s * fz), 0.014, 0.012, P.spot);
    // 翅膀
    const piv = new THREE.Group();
    piv.position.set(0.0, 0.0, s * R[2] * 0.8);
    piv.userData.s = s;
    const a = new Acc();
    const g = new THREE.SphereGeometry(1, 18, 10);
    const pa = g.attributes.position;
    for (let i = 0; i < pa.count; i++) { // 往外越来越尖、往后掠
      const x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i);
      const out = (z + 1) / 2; // 0 根部 → 1 翼尖
      pa.setXYZ(i, x * 0.12 * (1 - out * 0.75) - out * out * 0.06, y * 0.02 * (1 - out * 0.6), z * 0.12);
    }
    g.computeVertexNormals();
    const wing = s > 0 ? g.translate(0, 0, 0.1) : g.rotateY(Math.PI).rotateY(0).scale(-1, 1, 1);
    if (s < 0) { // 镜像后翻转三角形朝向
      const ix = wing.index.array;
      for (let i = 0; i < ix.length; i += 3) { const t = ix[i]; ix[i] = ix[i + 2]; ix[i + 2] = t; }
      wing.translate(0, 0, -0.1);
      wing.computeVertexNormals();
    }
    a.add(wing, paint, null, true);
    ctx.fins.push({ piv, acc: a });
  }
  const sm = [];
  for (let i = 0; i <= 6; i++) { const t = -1 + i / 3; const sp = blobDir(B, 1, -0.4 - 0.15 * (1 - t * t), t * 0.35); sm.push(sp.p.addScaledVector(sp.n, 0.002).toArray()); }
  ctx.face.add(taperTube(sm, 0.005, 0.005, 10, 5), DARK);
  ctx.tail.add(taperTube([[0, 0, 0], [-0.08, 0.005, 0], [-0.17, 0.02, 0]], 0.012, 0.004, 10, 5), P.c, null, true);
  const t = new THREE.Group();
  t.position.set(-R[0] * 0.85, 0, 0);
  ctx.tailG = t;
  ctx.o.finsCustom = true;
  ctx.o.tailAmp = 0.25;
  ctx.tilt = [0.7, 0, 0.1];
  ctx.o.onSwim = (w) => {
    for (const f of ctx.o.fins) f.rotation.x = -f.userData.s * Math.sin(w * 3.2) * 0.38;
    ctx.o.sway.position.y = Math.sin(w * 3.2 - 1) * 0.012;
  };
};

// 小鱿鱼：竖着的子弹形外套膜（脸朝 +z，和章鱼一样），顶上两片三角鳍，下面一簇触手
A.squid = (ctx, P) => {
  const prof = [[0, 0.3], [0.035, 0.29], [0.075, 0.24], [0.1, 0.16], [0.11, 0.07], [0.105, -0.01], [0.09, -0.06], [0.06, -0.09], [0, -0.1]].reverse().map(([r, y]) => new THREE.Vector2(r, y));
  const g = smooth(new THREE.LatheGeometry(prof, 24));
  ctx.body.add(g, P.c, null, true);
  ctx.body.add(cone(0.15, 0.13, 4).rotateY(Math.PI / 4).scale(1, 1, 0.16), P.fin, TRS([0, 0.25, 0]), true); // 箭头形的鳍
  for (const [x, y, r] of [[0.03, 0.2, 0.014], [-0.04, 0.13, 0.016], [0.05, 0.09, 0.012], [-0.02, 0.25, 0.01], [0.0, 0.16, 0.012]]) {
    for (const s of [1, -1]) {
      const z = Math.sqrt(Math.max(0, 0.104 ** 2 - x * x)) * (y > 0.2 ? 0.75 : 1);
      dotOn(ctx.body, { p: V(x, y, s * z), n: V(x, 0.15, s * z).normalize() }, r, r, P.spot);
    }
  }
  for (const s of [1, -1]) {
    eyeOn(ctx, { p: V(s * 0.045, 0.01, 0.097), n: V(s * 0.4, 0.05, 1).normalize() }, 0.032, 1);
    blushOn(ctx, { p: V(s * 0.07, -0.035, 0.08), n: V(s * 0.6, -0.2, 0.8).normalize() }, 0.018, 0xffb5c5);
  }
  const sm = [];
  for (let i = 0; i <= 4; i++) { const t = -1 + i / 2; sm.push([t * 0.016, -0.045 - 0.008 * (1 - t * t), 0.098]); }
  ctx.face.add(taperTube(sm, 0.004, 0.004, 8, 4), DARK);
  // 触手：一簇，整体摆
  const tg = new THREE.Group();
  tg.position.set(0, -0.08, 0);
  const a = new Acc();
  for (let i = 0; i < 8; i++) {
    const ang = (i / 8) * TAU + 0.2, rr = 0.055;
    const x0 = Math.cos(ang) * rr, z0 = Math.sin(ang) * rr;
    const out = 0.03;
    a.add(taperTube([[x0, 0, z0], [x0 + Math.cos(ang) * out * 0.6, -0.045, z0 + Math.sin(ang) * out * 0.6], [x0 + Math.cos(ang) * out, -0.08, z0 + Math.sin(ang) * out], [x0 + Math.cos(ang) * out * 1.6, -0.095, z0 + Math.sin(ang) * out * 1.6]], 0.02, 0.008, 10, 6), P.c, null, true);
  }
  for (const s of [1, -1]) a.add(taperTube([[s * 0.02, 0, 0.03], [s * 0.045, -0.07, 0.045], [s * 0.03, -0.12, 0.05], [s * 0.055, -0.15, 0.05]], 0.01, 0.017, 12, 6), P.spot, null, true);
  ctx.tail = a;
  ctx.tailG = tg;
  ctx.tentacles = true;
  ctx.o.onSwim = (w) => {
    tg.rotation.x = Math.sin(w * 3) * 0.12;
    tg.rotation.z = Math.cos(w * 2.4) * 0.08;
    tg.scale.y = 1 - Math.max(0, Math.sin(w * 3)) * 0.1;
    ctx.o.sway.position.y = Math.max(0, Math.sin(w * 3)) * 0.02;
  };
};

// 小海马：竖着、脸朝 +x，S 形身子 + 卷卷尾巴 + 小王冠刺
A.seahorse = (ctx, P) => {
  const chain = [[0.0, 0.14, 0.055], [-0.02, 0.09, 0.06], [-0.015, 0.035, 0.068], [0.0, -0.02, 0.065], [0.0, -0.07, 0.055], [-0.015, -0.11, 0.042]];
  const paint = (p) => (p.x > 0.025 + p.y * 0.1 ? P.belly : P.c);
  for (const [x, y, r] of chain) ctx.body.add(sph(r, 16, 12).scale(1, 1, 0.85), paint, TRS([x, y, 0]), true);
  // 脑袋 + 长嘴
  const hc = V(0.03, 0.2, 0);
  ctx.body.add(sph(0.062, 18, 14).scale(1.05, 0.95, 0.85), P.c, TRS(hc.toArray()), true);
  ctx.body.add(cyl(0.016, 0.022, 0.08, 10).rotateZ(-Math.PI / 2), P.c, TRS([hc.x + 0.08, hc.y - 0.02, 0], [0, 0, -0.15]), true);
  ctx.body.add(new THREE.TorusGeometry(0.013, 0.005, 5, 10).rotateY(Math.PI / 2), MOUTH, TRS([hc.x + 0.12, hc.y - 0.026, 0]));
  for (let i = 0; i < 3; i++) ctx.body.add(cone(0.012, 0.035, 6), P.belly, TRS([hc.x - 0.02 - i * 0.02, hc.y + 0.06 - i * 0.008, 0], [0, 0, 0.3 + i * 0.25]), true);
  for (const [y, r] of [[0.11, 0.05], [0.055, 0.058], [0.0, 0.058], [-0.05, 0.05]]) for (const s of [1, -1]) dotOn(ctx.body, { p: V(-0.02, y, s * r * 0.85), n: V(0, 0, s) }, 0.009, 0.009, 0xffe0a8);
  const HB = { R: [0.065, 0.059, 0.053], T: 0, p: 2 };
  for (const s of [1, -1]) {
    const e = blobPt(HB, 0.3, 0.2, s); e.p.add(hc);
    eyeOn(ctx, e, 0.026, s);
    const b = blobPt(HB, 0.2, -0.4, s); b.p.add(hc);
    blushOn(ctx, b, 0.016, mixHex(P.c, PINK, 0.5));
  }
  // 背鳍（会扇）
  const piv = new THREE.Group();
  piv.position.set(-0.075, 0.03, 0);
  piv.userData.s = 1;
  const a = new Acc();
  a.add(ell(0.04, 0.03, 0.008, 12, 8), P.fin, TRS([-0.025, 0, 0]), true);
  ctx.fins.push({ piv, acc: a });
  // 卷尾巴
  const pts = [];
  for (let i = 0; i <= 14; i++) { const t = i / 14, ang = t * 4.2, rr = 0.06 * (1 - t * 0.7); pts.push([-0.015 - Math.sin(ang) * rr + 0.0, -Math.cos(ang) * rr * 0.9 - 0.03 * (1 - t), 0]); }
  pts.forEach((p) => { p[1] -= 0.04; });
  ctx.tail.add(taperTube(pts.map(([x, y]) => [x + 0.015, y + 0.05, 0]), 0.038, 0.01, 30, 8), P.c, null, true);
  const t = new THREE.Group();
  t.position.set(-0.015, -0.13, 0);
  ctx.tailG = t;
  ctx.o.tailAxis = "z";
  ctx.o.tailAmp = 0.15;
  ctx.o.finsCustom = true;
  ctx.o.onSwim = (w) => { for (const f of ctx.o.fins) f.rotation.y = Math.sin(w * 16) * 0.5; ctx.o.sway.position.y = Math.sin(w * 1.6) * 0.02; };
};

// 樱花团子：三颗团子串在竹签上，三张脸
A.dango = (ctx) => {
  const balls = [[0.12, 0xffb5cc, "dot"], [0.0, 0xfffaf0, "happy"], [-0.12, 0xb5dd8f, "sleepy"]];
  ctx.body.add(cyl(0.011, 0.011, 0.5, 8).rotateZ(Math.PI / 2), 0xd9b27a, TRS([-0.02, 0, 0]), true);
  for (const [x, c, st] of balls) {
    const R = [0.072, 0.07, 0.068];
    ctx.body.add(blobGeo(R, 0, 2, 20, 16), c, TRS([x, 0, 0]), true);
    const B = { R, T: 0, p: 2 };
    for (const s of [1, -1]) {
      const e = blobPt(B, 0.32, 0.18, s); e.p.x += x;
      eyeOn(ctx, e, st === "dot" ? 0.024 : 0.02, s, st);
      const b = blobPt(B, 0.1, -0.32, s); b.p.x += x;
      blushOn(ctx, b, 0.016, mixHex(c, PINK, 0.5));
    }
    const sm = [];
    for (let i = 0; i <= 4; i++) { const t = -1 + i / 2; const sp = blobDir(B, 0.6, -0.2 - 0.08 * (1 - t * t), t * 0.25 + 0.75); sp.p.x += x; sm.push(sp.p.addScaledVector(sp.n, 0.002).toArray()); }
    ctx.face.add(taperTube(sm, 0.0035, 0.0035, 8, 4), DARK);
  }
  for (const s of [1, -1]) pecFin(ctx, V(0.1, -0.05, s * 0.045), s, 0.035, 0.02, 0xffc8d8);
  ctx.tail.add(ell(0.05, 0.022, 0.008, 12, 6), 0x8fcf6a, TRS([-0.04, 0.01, 0], [0, 0, 0.25]), true);
  ctx.tail.add(ell(0.045, 0.02, 0.008, 12, 6), 0xffb5cc, TRS([-0.035, -0.02, 0], [0, 0, -0.4]), true);
  const t = new THREE.Group();
  t.position.set(-0.27, 0, 0);
  ctx.tailG = t;
};

// 雪人鱼：大雪球身子 + 小雪球脑袋、胡萝卜鼻子、红围巾、树枝小手、冰蓝鱼尾
A.snowman = (ctx) => {
  const snow = (p) => mixHex(0xffffff, 0xd8e6f8, sstep(0.0, -0.12, p.y));
  ctx.body.add(sph(0.12, 22, 16), snow, TRS([-0.04, -0.02, 0]), true);
  ctx.body.add(sph(0.085, 20, 14), snow, TRS([0.1, 0.06, 0]), true);
  const hc = V(0.1, 0.06, 0), HB = { R: [0.085, 0.085, 0.085], T: 0, p: 2 };
  ctx.body.add(cone(0.017, 0.08, 10).rotateZ(-Math.PI / 2), 0xff9a3c, TRS([hc.x + 0.11, hc.y - 0.005, 0]), true);
  for (const s of [1, -1]) {
    const e = blobPt(HB, 0.45, 0.25, s); e.p.add(hc);
    eyeOn(ctx, e, 0.022, s);
    const b = blobPt(HB, 0.4, -0.25, s); b.p.add(hc);
    blushOn(ctx, b, 0.016, 0xffc4d2);
  }
  for (const [x, y] of [[0.035, 0.0], [0.04, -0.05]]) for (const s of [1, -1]) ctx.face.add(sph(0.011, 8, 6), 0x3a3540, TRS([x, y, s * 0.108]));
  // 围巾
  ctx.body.add(new THREE.TorusGeometry(0.068, 0.02, 8, 24).rotateY(Math.PI / 2 - 0.5), 0xff6b7a, TRS([0.045, 0.02, 0], [0, 0, -0.6]), true);
  ctx.body.add(blobGeo([0.02, 0.05, 0.012], 0, 3, 12, 8), 0xff6b7a, TRS([0.02, -0.03, 0.065], [0.2, 0, 0.3]), true);
  // 小帽子
  ctx.body.add(cyl(0.045, 0.05, 0.05, 14), 0x5b6fb5, TRS([hc.x - 0.01, hc.y + 0.09, 0], [0, 0, 0.2]), true);
  ctx.body.add(cyl(0.07, 0.07, 0.012, 16), 0x5b6fb5, TRS([hc.x - 0.005, hc.y + 0.067, 0], [0, 0, 0.2]), true);
  // 树枝小手（当胸鳍）
  for (const s of [1, -1]) {
    const piv = new THREE.Group();
    piv.position.set(-0.01, 0.03, s * 0.1);
    piv.rotation.z = 0.3;
    piv.userData.s = s;
    const a = new Acc();
    a.add(cyl(0.007, 0.006, 0.1, 6).rotateZ(Math.PI / 2), 0x8a5a3b, TRS([-0.05, 0.0, s * 0.02], [0, s * 0.5, 0]), true);
    a.add(cyl(0.005, 0.004, 0.035, 5).rotateZ(Math.PI / 2), 0x8a5a3b, TRS([-0.08, 0.015, s * 0.035], [0, s * 0.5, -0.7]), true);
    ctx.fins.push({ piv, acc: a });
  }
  buildTail(ctx, ["fan", 0.12, 0xb2e2ff], V(-0.15, -0.02, 0));
};

// 小田螺：软软的身子 + 背上一个螺旋壳 + 眼柄
A.snail = (ctx, P) => {
  ctx.body.add(blobGeo([0.17, 0.045, 0.07], 0.3, 2, 24, 12), P.c, TRS([0.0, -0.08, 0]), true);
  ctx.body.add(blobGeo([0.06, 0.07, 0.06], 0, 2, 18, 12), P.c, TRS([0.12, -0.03, 0], [0, 0, -0.2]), true);
  // 螺旋壳：扁圆盘 + 两面各一条贴着壳的对数螺旋线
  const sc = V(-0.035, 0.06, 0), SR = [0.11, 0.11, 0.075];
  ctx.body.add(blobGeo(SR, 0, 2, 30, 22), P.shell, TRS(sc.toArray()), true);
  for (const s of [1, -1]) {
    const pts = [];
    for (let i = 0; i <= 40; i++) {
      const th = i * 0.3, rr = 0.012 * Math.exp(th * 0.19);
      if (rr > 0.095) break;
      const x = Math.cos(th) * rr, y = Math.sin(th) * rr * s;
      const z = SR[2] * Math.sqrt(Math.max(0, 1 - (x / SR[0]) ** 2 - (y / SR[1]) ** 2));
      pts.push([sc.x + x, sc.y + y, s * (z + 0.002)]);
    }
    ctx.body.add(taperTube(pts, 0.006, 0.009, 60, 5), P.stripe);
  }
  for (const s of [1, -1]) {
    ctx.body.add(cyl(0.008, 0.01, 0.07, 6), P.c, TRS([0.14 + 0.01, 0.04, s * 0.025], [s * -0.25, 0, -0.35]), true);
    eyeOn(ctx, { p: V(0.17, 0.075, s * 0.034), n: V(0.8, 0.3, s * 0.5).normalize() }, 0.024, s);
    blushOn(ctx, { p: V(0.155, -0.04, s * 0.05), n: V(0.6, 0, s * 0.8).normalize() }, 0.014, mixHex(P.c, PINK, 0.5));
  }
  const sm = [];
  for (let i = 0; i <= 4; i++) { const t = -1 + i / 2; sm.push([0.178 + 0.002 * (1 - t * t), -0.035 - 0.008 * (1 - t * t), t * 0.016]); }
  ctx.face.add(taperTube(sm, 0.004, 0.004, 8, 4), DARK);
  ctx.o.tailAmp = 0;
  ctx.o.onSwim = (w) => { ctx.o.body.scale.x = 1 + Math.sin(w * 3) * 0.03; };
};

// 落叶鱼：两头尖的扁叶子，叶脉 + 叶柄当尾巴
A.leaf = (ctx, P) => {
  const g = new THREE.SphereGeometry(1, 28, 14);
  const pa = g.attributes.position;
  for (let i = 0; i < pa.count; i++) {
    const x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i);
    const k = Math.pow(Math.max(0, 1 - Math.abs(x) ** 1.6), 0.55) / Math.max(0.0001, Math.sqrt(1 - x * x) || 1);
    const kk = Math.min(1.4, isFinite(k) ? k : 1);
    pa.setXYZ(i, x * 0.19, y * 0.11 * kk + x * x * 0.02, z * 0.025 * kk);
  }
  const body = smooth(g);
  ctx.body.add(body, (p) => mixHex(P.c, P.c2, sstep(0.1, -0.18, p.x)), null, true);
  for (const s of [1, -1]) {
    ctx.body.add(ell(0.17, 0.005, 0.004, 16, 4), P.vein, TRS([-0.01, 0.0, s * 0.024]));
    for (const [x, up] of [[0.05, 1], [-0.04, 1], [-0.12, 1], [0.05, -1], [-0.04, -1], [-0.12, -1]]) {
      ctx.body.add(ell(0.035, 0.004, 0.004, 8, 4), P.vein, TRS([x - 0.012, up * 0.03, s * 0.023], [0, 0, up * 0.7]));
    }
    eyeOn(ctx, { p: V(0.09, 0.025, s * 0.024), n: V(0.1, 0.1, s).normalize() }, 0.026, s);
    blushOn(ctx, { p: V(0.07, -0.025, s * 0.024), n: V(0, 0, s) }, 0.016, mixHex(P.c, PINK, 0.45));
    const sm = [];
    for (let i = 0; i <= 4; i++) { const t = -1 + i / 2; sm.push([0.125 + t * 0.012, -0.012 - 0.007 * (1 - t * t), s * 0.0235]); }
    ctx.face.add(taperTube(sm, 0.0035, 0.0035, 8, 4), DARK);
  }
  buildTail(ctx, ["stem", 0.12, 0x9a6a3e], V(-0.185, 0.0, 0));
  ctx.o.tailAmp = 0.3;
};

// 物件：落水的手套（正面朝 +z）
A.mitten = (ctx, P) => {
  const B = { R: [0.11, 0.15, 0.055], T: 0, p: 2.4 };
  ctx.body.add(blobGeo(B.R, 0, 2.4, 24, 18), P.c, TRS([0, 0.03, 0]), true);
  ctx.body.add(blobGeo([0.042, 0.07, 0.045], 0, 2.2, 14, 10), P.c, TRS([0.11, 0.0, 0], [0, 0, -0.55]), true);
  ctx.body.add(blobGeo([0.12, 0.05, 0.065], 0, 4, 22, 10), P.c2, TRS([-0.005, -0.14, 0]), true);
  for (let i = -4; i <= 4; i++) for (const s of [1, -1]) ctx.body.add(ell(0.004, 0.04, 0.004, 4, 6), 0xe6e6ee, TRS([i * 0.026, -0.14, s * 0.064]));
  // 雪花 + 一道白条纹
  ctx.body.add(smooth(deformBlob(hbandGeo(-0.62, -0.48, 26), B.R, 0, 2.4, 1.015)), P.c2, TRS([0, 0.03, 0]));
  const sc = V(-0.005, 0.07, 0.055);
  for (let i = 0; i < 3; i++) ctx.body.add(new THREE.BoxGeometry(0.075, 0.009, 0.006), P.c2, TRS([sc.x, sc.y, sc.z], [0, 0, (i * Math.PI) / 3]));
  for (let i = 0; i < 6; i++) { const a = (i * Math.PI) / 3; ctx.body.add(sph(0.007, 6, 4), P.c2, TRS([sc.x + Math.cos(a) * 0.045, sc.y + Math.sin(a) * 0.045, sc.z])); }
  // 一滴水
  ctx.body.add(sph(0.014, 8, 6).scale(1, 1.3, 1), 0x9fd8ff, TRS([0.13, -0.13, 0.03]));
  ctx.o.body.rotation.z = -0.15;
};

/* ================================================================ 组装 */
function finishGlow(o, P, legend) {
  if (!legend) return;
  const sc = P.sparkle ?? 0xfff6b0;
  // 闪光：两簇（每簇 3 颗合成一个网格），绕着鱼转、一呼一吸（shine() 驱动）
  let s = 7 + (P.c & 0xff);
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let c = 0; c < 2; c++) {
    const gs = [];
    for (let i = 0; i < 3; i++) {
      const a = ((i + c * 0.5) / 3) * TAU + rnd() * 0.6, r = 0.27 + rnd() * 0.06, y = (rnd() - 0.5) * 0.2;
      gs.push(star4Geo().clone().scale(0.03, 0.03, 0.03).translate(Math.cos(a) * r, y + Math.sin(a) * r * 0.55, 0.06 + rnd() * 0.04));
    }
    const m = new THREE.Mesh(mergeGeometries(gs), sparkMat(sc));
    m.userData.ph = c * 3.1 + rnd();
    m.userData.s = 1;
    m.raycast = () => {};
    o.sway.add(m);
    o.sparkles.push(m);
  }
  const sp = new THREE.Sprite(haloMat(P.glow ?? 0xffe066));
  sp.scale.setScalar(0.8);
  sp.userData.base = 0.45;
  sp.raycast = () => {};
  o.sway.add(sp);
  o.halo = sp;
}

function buildGen(id, F, { toon, outlined }) {
  const P = G[id];
  const legend = F.rarity === "legend";
  const root = new THREE.Group(), sway = new THREE.Group(), body = new THREE.Group();
  root.add(sway);
  sway.add(body);
  const o = { id, kind: F.kind, root, sway, body, tail: null, fins: [], eyes: [], sparkles: [], glowMats: [], swims: F.kind === "fish" };
  const glowC = legend ? P.glow : P.glowBody;
  const sepFace = !!glowC;
  const ctx = { o, P, body: new Acc(), tail: new Acc(), face: null, glowAcc: new Acc(), fins: [], tailG: null };
  ctx.face = sepFace ? new Acc() : ctx.body;
  // 预算：身体 2 + (脸 1) + 尾巴 2 + (发光件 2) + (光晕 1 + 闪光 2)；剩下的给胸鳍
  let used = 2 + (sepFace ? 1 : 0) + 2 + (P.glowPart ? 2 : 0) + (legend ? 3 : 0);
  ctx.finMode = 8 - used >= 4 ? "out" : 8 - used >= 2 ? "flat" : "static";
  A[P.a](ctx, P);

  if (ctx.tilt) body.rotation.set(...ctx.tilt);
  const M = mats(toon);
  const bodyMat = glowC ? glowMat(toon, glowC, legend ? 0.28 : 0.35) : M.vc;
  if (glowC) o.glowMats.push(bodyMat);
  body.add(ctx.body.mesh(bodyMat, outlined, P.line ?? 0.012));
  if (sepFace && !ctx.face.empty) body.add(ctx.face.mesh(faceMat(), outlined, 0));
  if (!ctx.glowAcc.empty) {
    const gm = glowMat(toon, P.glowPart, 0.6);
    o.glowMats.push(gm);
    body.add(ctx.glowAcc.mesh(gm, outlined, 0.008));
  }
  if (ctx.tailG) {
    const tm = ctx.tail.mesh(bodyMat, outlined, 0.009);
    if (tm) ctx.tailG.add(tm);
    body.add(ctx.tailG);
    if (ctx.tentacles) o.tentacles = [ctx.tailG];
    else o.tail = ctx.tailG;
  }
  for (const f of ctx.fins) {
    const flat = ctx.finMode !== "out";
    const m = f.acc.mesh(M.vc, outlined, flat ? 0 : 0.008);
    f.piv.add(m);
    body.add(f.piv);
    o.fins.push(f.piv);
  }
  // 包围盒：最长边缩放到 0.5，然后居中
  const box = new THREE.Box3().setFromObject(body);
  const size = box.getSize(V());
  const k = 0.5 / Math.max(size.x, size.y, size.z);
  body.scale.multiplyScalar(k);
  body.position.set(0, 0, 0);
  box.setFromObject(body);
  body.position.sub(box.getCenter(V()));
  o.size = box.getSize(V());
  finishGlow(o, P, legend);
  for (const m of o.glowMats) if (m.userData.base == null) m.userData.base = m.emissiveIntensity;
  root.userData.catchId = id;
  root.userData.id = id;
  root.userData.what = "catch";
  root.traverse((n) => { n.userData.what = "catch"; });
  return o;
}

/* ================================================================ 公开 API */
// 和 fish3d.js 的 buildCatch 同一个返回约定：{ root, sway, body, tail, fins, eyes, sparkles, glowMats, swims, size, kind, id, ... }
// 老的 15 种直接用 buildCatch；未知 id → 小鲫鱼。
export function buildFish(id, deps) {
  if (CATCH[id] || !G[id] || !FISH[id]) {
    const o = buildCatch(CATCH[id] ? id : "crucian", deps);
    o.root.userData.id = o.id;
    o.root.userData.what = "catch";
    return o;
  }
  return buildGen(id, FISH[id], deps);
}

// fish3d.js 里几何体有一部分是模块级共享的（眼睛高光、闪光）：同一种鱼造两次，两次都出现的几何体就是共享的，不能 dispose
let KEEP_GEOS = null;
function keepGeos(deps) {
  if (KEEP_GEOS) return KEEP_GEOS;
  KEEP_GEOS = new Set([STAR4]);
  const geos = (o) => { const set = new Set(); o.root.traverse((n) => { if (n.geometry) set.add(n.geometry); }); return set; };
  for (const id of ["crucian", "star", "jelly"]) {
    const a = buildCatch(id, deps), b = buildCatch(id, deps);
    const gb = geos(b);
    for (const g of geos(a)) if (gb.has(g)) KEEP_GEOS.add(g);
    disposeBuilt(a.root); disposeBuilt(b.root);
  }
  return KEEP_GEOS;
}
// 释放一条临时造出来的鱼：几何体（共享的除外）+ 每个网格自己的材质（描边、老渔获每次新建的 toon 材质）；共享材质不动
function disposeBuilt(root) {
  root.traverse((n) => {
    if (n.isSprite) return;
    if (n.geometry && !(KEEP_GEOS && KEEP_GEOS.has(n.geometry))) n.geometry.dispose();
    const m = n.material;
    if (m && !SHARED.has(m) && (m.isMeshToonMaterial || (m.isMeshBasicMaterial && m.side === THREE.BackSide))) m.dispose();
  });
}

// 缩略图：每条鱼在临时场景里画一张 3/4 侧面的透明 PNG。返回 Map<id, dataURL>。
// opts.silhouette → 灰色剪影（图鉴里没钓到的"???"）。用完把 renderer 的状态全部还原。
export async function fishThumbs(renderer, ids, deps, size = 128, opts = {}) {
  const out = new Map();
  keepGeos(deps);
  const scene = new THREE.Scene();
  const hemi = new THREE.HemisphereLight(0xe3f4ff, 0x9ab08a, 1.9);
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(3, 6, 5);
  const fill = new THREE.DirectionalLight(0xffffff, 0.5);
  fill.position.set(0.5, 0.3, 1);
  scene.add(hemi, sun, fill);
  const sil = new THREE.MeshBasicMaterial({ color: opts.silhouetteColor ?? 0x5d6470 });
  if (opts.silhouette) scene.overrideMaterial = sil;
  const cam = new THREE.PerspectiveCamera(28, 1, 0.05, 20);
  // 2 倍超采样渲染（不用 MSAA：多重采样目标连续读回在部分驱动上会拿到旧数据），再在 2D canvas 里缩小
  const S2 = size * 2;
  const rt = new THREE.WebGLRenderTarget(S2, S2, { type: THREE.UnsignedByteType });
  const px = new Uint8Array(S2 * S2 * 4);
  const big = document.createElement("canvas");
  big.width = big.height = S2;
  const gb = big.getContext("2d");
  const img = gb.createImageData(S2, S2);
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  const g2 = cv.getContext("2d");
  g2.imageSmoothingEnabled = true;
  g2.imageSmoothingQuality = "high";
  // 渲染目标里是线性值（three 只对屏幕做 sRGB 输出），读回来自己转 sRGB
  const enc = new Uint8Array(4096);
  for (let i = 0; i < 4096; i++) { const v = i / 4095; enc[i] = Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055)); }
  const dir = V(0.5, 0.32, 1).normalize();
  const tmpBox = new THREE.Box3(), tmpS = new THREE.Sphere();

  const save = () => ({
    rt: renderer.getRenderTarget(),
    cc: renderer.getClearColor(new THREE.Color()),
    ca: renderer.getClearAlpha(),
    vp: renderer.getViewport(new THREE.Vector4()),
    sc: renderer.getScissor(new THREE.Vector4()),
    st: renderer.getScissorTest(),
    ac: renderer.autoClear,
  });
  const restore = (s) => {
    renderer.setRenderTarget(s.rt);
    renderer.setClearColor(s.cc, s.ca);
    renderer.setViewport(s.vp);
    renderer.setScissor(s.sc);
    renderer.setScissorTest(s.st);
    renderer.autoClear = s.ac;
  };

  const list = [...ids];
  for (let i0 = 0; i0 < list.length; i0 += 6) {
    const st = save();
    try {
      renderer.setRenderTarget(rt);
      renderer.setClearColor(0x000000, 0);
      renderer.setScissorTest(false);
      // 不调 setViewport：它会乘上 pixelRatio（手机上是 2），渲染目标会被放大裁掉；setRenderTarget 已经用了 rt 自己的视口
      renderer.autoClear = true;
      for (const id of list.slice(i0, i0 + 6)) {
        const o = buildFish(id, deps);
        swim(o, 0.42, 1);
        shine(o, 0.35);
        if (o.halo) o.halo.scale.setScalar(0.5); // 缩略图里光晕别被画框切成方块
        if (opts.silhouette) { if (o.halo) o.halo.visible = false; for (const s of o.sparkles) s.visible = false; }
        scene.add(o.root);
        o.root.updateMatrixWorld(true);
        tmpBox.setFromObject(o.body);
        tmpBox.getBoundingSphere(tmpS);
        const dist = (tmpS.radius * 1.06) / Math.sin(THREE.MathUtils.degToRad(14));
        cam.position.copy(tmpS.center).addScaledVector(dir, dist);
        cam.lookAt(tmpS.center);
        renderer.clear();
        renderer.render(scene, cam);
        renderer.readRenderTargetPixels(rt, 0, 0, S2, S2, px);
        const d = img.data;
        for (let y = 0; y < S2; y++) {
          const src = (S2 - 1 - y) * S2 * 4, dst = y * S2 * 4; // 翻转 Y
          for (let x = 0; x < S2 * 4; x += 4) {
            const a = px[src + x + 3];
            d[dst + x + 3] = a;
            if (!a) { d[dst + x] = d[dst + x + 1] = d[dst + x + 2] = 0; continue; }
            const k = 4095 / a; // 反预乘 + 线性 → sRGB
            d[dst + x] = enc[Math.min(4095, (px[src + x] * k) | 0)];
            d[dst + x + 1] = enc[Math.min(4095, (px[src + x + 1] * k) | 0)];
            d[dst + x + 2] = enc[Math.min(4095, (px[src + x + 2] * k) | 0)];
          }
        }
        gb.putImageData(img, 0, 0);
        g2.clearRect(0, 0, size, size);
        g2.drawImage(big, 0, 0, size, size);
        out.set(id, cv.toDataURL("image/png"));
        scene.remove(o.root);
        disposeBuilt(o.root);
      }
    } finally {
      restore(st);
    }
    await new Promise((r) => setTimeout(r, 0));
  }
  rt.dispose();
  sil.dispose();
  return out;
}

export { G as FISH_LOOKS };
