// 圣诞装饰的 Q 版模型（Three.js r170）：全部程序化搭出来，没有外部模型。
// 风格和小岛一致：toon() 三阶材质 + outlined() 黑色反向外壳描边，颜色走粉嫩路线。
// 约定：地面 y=0，所有东西站在地面上，正面朝 +z。
// 省性能：同一种描边粗细的小零件用顶点色合并成一个 mesh（toon 材质 vertexColors），每件装饰几个到二十来个 mesh。
//
// 文件末尾的 kit() 是一套小工具（几何变换 / 合并 / 圆角盒子 / 星星 / 爱心 / 眼睛……），gacha3d.js 也在用。
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const TAU = Math.PI * 2;
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ================================================================ geometry helpers */
export function rng(seed = 7) {
  let s = Math.floor(seed) % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

// 把几何体缩放 s → 旋转 r（欧拉角），然后（可选）把本地 +z 转到 n 方向 → 平移到 p
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _e = new THREE.Euler(), _M = new THREE.Matrix4();
const _S = V3(), _P = V3(), _Z = V3(0, 0, 1);
export function X(geo, o = {}) {
  if (o.s != null) typeof o.s === "number" ? _S.setScalar(o.s) : _S.set(o.s[0], o.s[1], o.s[2]);
  else _S.set(1, 1, 1);
  _q.identity();
  if (o.r) _q.setFromEuler(_e.set(o.r[0], o.r[1], o.r[2], o.order || "XYZ"));
  if (o.n) { _q2.setFromUnitVectors(_Z, _P.copy(o.n).normalize()); _q.premultiply(_q2); }
  if (o.p) o.p.isVector3 ? _P.copy(o.p) : _P.set(o.p[0], o.p[1], o.p[2]);
  else _P.set(0, 0, 0);
  return geo.applyMatrix4(_M.compose(_P, _q, _S));
}

export const sph = (r, ws = 14, hs = 10) => new THREE.SphereGeometry(r, ws, hs);
export const ell = (rx, ry, rz, ws = 14, hs = 10) => new THREE.SphereGeometry(1, ws, hs).scale(rx, ry, rz);
export const hemi = (r, ws = 14, hs = 6) => new THREE.SphereGeometry(r, ws, hs, 0, TAU, 0, Math.PI / 2);
export const cyl = (rt, rb, h, rs = 12, open = false) => new THREE.CylinderGeometry(rt, rb, h, rs, 1, open);
export const cone = (r, h, rs = 10) => new THREE.ConeGeometry(r, h, rs);
export const tor = (R, r, rs = 8, ts = 20, arc = TAU) => new THREE.TorusGeometry(R, r, rs, ts, arc);
export const lathe = (pts, seg = 16) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(Math.max(0, r), y)), seg);

// 两点之间的一根圆棍（绳子、木棍）
const _up = V3(0, 1, 0);
export function rod(a, b, r, rs = 6, rb = r) {
  const A = a.isVector3 ? a : V3(...a), B = b.isVector3 ? b : V3(...b);
  const d = B.clone().sub(A), L = d.length();
  const g = cyl(r, rb, L, rs, true).translate(0, L / 2, 0);
  g.applyQuaternion(_q.setFromUnitVectors(_up, d.normalize()));
  return g.translate(A.x, A.y, A.z);
}

// 圆角盒子：顶点按「内盒 + 半径」投影，法线连续，描边干净
export function roundBox(w, h, d, r, seg = 3) {
  r = Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4);
  const A = [w / 2 - r, h / 2 - r, d / 2 - r], n = seg * 2 + 1;
  const g = new THREE.BoxGeometry(1, 1, 1, n, n, n);
  const p = g.attributes.position, nr = g.attributes.normal;
  const map = (u, a) => {
    const k = Math.round((u + 0.5) * n);
    if (k <= seg) return -a - r + r * (k / seg);
    return a + r * ((k - (n - seg)) / seg);
  };
  const v = V3(), c = V3(), dd = V3();
  for (let i = 0; i < p.count; i++) {
    v.set(map(p.getX(i), A[0]), map(p.getY(i), A[1]), map(p.getZ(i), A[2]));
    c.set(clamp(v.x, -A[0], A[0]), clamp(v.y, -A[1], A[1]), clamp(v.z, -A[2], A[2]));
    dd.subVectors(v, c);
    const L = dd.length();
    if (L > 1e-6) { dd.divideScalar(L); p.setXYZ(i, c.x + dd.x * r, c.y + dd.y * r, c.z + dd.z * r); nr.setXYZ(i, dd.x, dd.y, dd.z); }
    else p.setXYZ(i, v.x, v.y, v.z);
  }
  return g;
}

// 重新算法线，并把同一位置（接缝、极点）的法线平均掉
export function weld(geo) {
  geo.computeVertexNormals();
  const p = geo.attributes.position, n = geo.attributes.normal, m = new Map();
  for (let i = 0; i < p.count; i++) {
    const k = Math.round(p.getX(i) * 1e4) + "," + Math.round(p.getY(i) * 1e4) + "," + Math.round(p.getZ(i) * 1e4);
    let a = m.get(k);
    if (!a) m.set(k, (a = [0, 0, 0, []]));
    a[0] += n.getX(i); a[1] += n.getY(i); a[2] += n.getZ(i); a[3].push(i);
  }
  for (const a of m.values()) {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    for (const i of a[3]) n.setXYZ(i, a[0] / l, a[1] / l, a[2] / l);
  }
  return geo;
}

// 沿曲线的管子；rf(t) 给出半径（t ∈ [0,1]），可以做两头尖的月牙、鹿角
export function tube(pts, r, ts = 24, rs = 8, closed = false) {
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => (p.isVector3 ? p : V3(...p))), closed, "centripetal");
  const rf = typeof r === "function" ? r : null;
  const g = new THREE.TubeGeometry(curve, ts, rf ? 1 : r, rs, closed);
  if (rf) {
    const p = g.attributes.position, c = V3(), v = V3();
    for (let j = 0; j <= ts; j++) {
      curve.getPointAt(j / ts, c);
      const k = rf(j / ts);
      for (let i = 0; i <= rs; i++) {
        const idx = j * (rs + 1) + i;
        v.fromBufferAttribute(p, idx).sub(c).multiplyScalar(k).add(c);
        p.setXYZ(idx, v.x, v.y, v.z);
      }
    }
  }
  return g;
}

// 胖胖的五角星（中心在原点，正面朝 +z）
export function starGeo(R, r, depth, bevel, points = 5) {
  const s = new THREE.Shape();
  for (let i = 0; i < points * 2; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / points, rr = i % 2 ? r : R;
    i ? s.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : s.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.85, bevelSegments: 3, curveSegments: 4 });
  g.translate(0, 0, -depth / 2);
  return g;
}

// 鼓鼓的爱心（像枕头）：单位球按爱心轮廓拉伸。宽 w、厚 d，中心在原点，尖朝 -y，正面 +z。
// 返回的 geometry.userData.surfZ(x, y) 给出正面那一点的 z，用来贴眼睛、腮红。
let HEART_R = null;
function heartTable() {
  if (HEART_R) return HEART_R;
  const N = 360, R = new Float32Array(N), cy = -2.5;
  for (let i = 0; i < 4096; i++) {
    const t = (i / 4096) * TAU;
    const x = 16 * Math.sin(t) ** 3, y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t) - cy;
    const a = Math.atan2(y, x), b = Math.floor(((a + TAU) % TAU) / TAU * N) % N;
    R[b] = Math.max(R[b], Math.hypot(x, y));
  }
  for (let k = 0; k < 2; k++) for (let i = 0; i < N; i++) if (!R[i]) R[i] = (R[(i + N - 1) % N] + R[(i + 1) % N]) / 2;
  HEART_R = (a) => {
    const f = (((a + TAU) % TAU) / TAU) * N, i = Math.floor(f) % N, j = (i + 1) % N, u = f - Math.floor(f);
    return R[i] * (1 - u) + R[j] * u;
  };
  return HEART_R;
}
export function heartGeo(w, d, ws = 32, hs = 20) {
  const H = heartTable(), k = w / 32;
  const g = new THREE.SphereGeometry(1, ws, hs).rotateX(Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const R = H(Math.atan2(y, x)) * k;
    p.setXYZ(i, x * R, y * R, z * d * 0.5);
  }
  weld(g);
  g.userData.surfZ = (x, y) => {
    const R = H(Math.atan2(y, x)) * k, q = Math.hypot(x, y) / R;
    return d * 0.5 * Math.sqrt(Math.max(0, 1 - q * q));
  };
  return g;
}

// 沿 y 轴往 +x 弯（圣诞帽的尖）：脊线角度 phi(t) = bend·t^pow
export function bendY(geo, H, bend, pow = 2) {
  const N = 64, C = [[0, 0]];
  for (let i = 1; i <= N; i++) {
    const t = (i - 0.5) / N, a = bend * t ** pow;
    const [x, y] = C[i - 1];
    C.push([x + Math.sin(a) * H / N, y + Math.cos(a) * H / N]);
  }
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = clamp(p.getY(i) / H, 0, 1), f = t * N, j = Math.min(N - 1, Math.floor(f)), u = f - j;
    const cx = C[j][0] * (1 - u) + C[j + 1][0] * u, cy = C[j][1] * (1 - u) + C[j + 1][1] * u;
    const a = bend * t ** pow, dx = p.getX(i);
    p.setXYZ(i, cx + dx * Math.cos(a), cy - dx * Math.sin(a), p.getZ(i));
  }
  return weld(geo);
}
export function bendTip(H, bend, pow = 2) { // 弯完之后尖端的位置和朝向
  const N = 64; let x = 0, y = 0, a = 0;
  for (let i = 1; i <= N; i++) { a = bend * ((i - 0.5) / N) ** pow; x += Math.sin(a) * H / N; y += Math.cos(a) * H / N; }
  return { p: V3(x, y, 0), dir: V3(Math.sin(bend), Math.cos(bend), 0) };
}

// 给几何体刷顶点色
function paint(geo, hex) {
  const c = new THREE.Color(hex), n = geo.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  geo.setAttribute("color", new THREE.BufferAttribute(a, 3));
  return geo;
}
// 按三角形所在的角度刷条纹（伞顶、薄荷糖、编织篮）——非索引几何，颜色不会糊
export function stripeByAngle(geo, n, colors, off = 0) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const p = g.attributes.position, a = new Float32Array(p.count * 3), cs = colors.map((c) => new THREE.Color(c));
  for (let i = 0; i < p.count; i += 3) {
    const x = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3, z = (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3;
    const k = Math.floor(((Math.atan2(z, x) + off + TAU * 2) % TAU) / TAU * n) % n, c = cs[k % cs.length];
    for (let j = 0; j < 3; j++) { a[(i + j) * 3] = c.r; a[(i + j) * 3 + 1] = c.g; a[(i + j) * 3 + 2] = c.b; }
  }
  g.setAttribute("color", new THREE.BufferAttribute(a, 3));
  g.userData.painted = true;
  return g;
}
export function merge(geos) {
  let list = geos;
  if (list.some((g) => !g.index)) list = list.map((g) => (g.index ? g.toNonIndexed() : g));
  const names = Object.keys(list[0].attributes).filter((n) => list.every((g) => g.attributes[n]));
  for (const g of list) {
    for (const n of Object.keys(g.attributes)) if (!names.includes(n)) g.deleteAttribute(n);
    g.morphAttributes = {};
    g.clearGroups();
  }
  return mergeGeometries(list, false);
}

/* ================================================================ textures */
let TEX = {};
function canvasTex(key, w, h, draw) {
  if (TEX[key]) return TEX[key];
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  draw(cv.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return (TEX[key] = t);
}
const css = (hex) => "#" + hex.toString(16).padStart(6, "0");
// 拐杖糖的斜条纹：一格里 bands 条
export function caneTex(color, bands = 2) {
  return canvasTex("cane" + color + "_" + bands, 128, 128, (g, w, h) => {
    g.fillStyle = "#fffaf5"; g.fillRect(0, 0, w, h);
    g.fillStyle = css(color);
    const step = w / bands;
    for (let k = -bands; k < bands * 2; k++) {
      const x0 = k * step;
      g.beginPath(); g.moveTo(x0, 0); g.lineTo(x0 + step * 0.5, 0); g.lineTo(x0 + step * 0.5 + w, h); g.lineTo(x0 + w, h); g.closePath(); g.fill();
    }
  });
}
// 横条纹（v 方向）：吊床布
export function rowTex(colors) {
  return canvasTex("rows" + colors.join("_"), 8, 64, (g, w, h) => {
    colors.forEach((c, i) => { g.fillStyle = css(c); g.fillRect(0, (i * h) / colors.length, w, h / colors.length + 1); });
  });
}
export function haloTex() {
  return canvasTex("halo", 64, 64, (g) => {
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, "rgba(255,255,255,1)");
    gr.addColorStop(0.35, "rgba(255,255,255,0.5)");
    gr.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  });
}

/* ================================================================ kit：材质缓存 + 零件拼装 */
const KITS = new WeakMap();
export function kit(T) {
  let K = KITS.get(T.toon);
  if (K) return K;
  const cache = new Map();
  const memo = (key, make) => { let m = cache.get(key); if (!m) cache.set(key, (m = make())); return m; };
  const vc = () => memo("vc", () => T.toon(0xffffff, { vertexColors: true }));
  const basic = (hex) => memo("b" + hex, () => new THREE.MeshBasicMaterial({ color: hex }));
  const flatVc = () => memo("fvc", () => new THREE.MeshBasicMaterial({ vertexColors: true }));
  const blush = () => memo("blush", () => new THREE.MeshBasicMaterial({ color: 0xff8fa8, transparent: true, opacity: 0.55, depthWrite: false }));
  const texMat = (tex, side) => memo("t" + tex.uuid + (side || 0), () => T.toon(0xffffff, { map: tex, ...(side ? { side } : {}) }));
  const outl = (m, line) => (line ? T.outlined(m, line) : m);
  const prep = ([g, c]) => (c == null || g.userData.painted ? g : paint(g, c));
  K = {
    T, vc, basic, flatVc, blush, texMat,
    // 一个 mesh：geo + 颜色（toon，缓存材质）
    one: (geo, hex, line = 0.022, extra) => outl(new THREE.Mesh(geo, extra ? T.toon(hex, extra) : memo("c" + hex, () => T.toon(hex))), line),
    // 一堆 [geo, color] 合成一个顶点色 toon mesh
    part: (items, line = 0.022) => outl(new THREE.Mesh(merge(items.map(prep)), vc()), line),
    // 不受光的顶点色 mesh（眼睛、高光、发光的窗）
    flat: (items) => new THREE.Mesh(merge(items.map(prep)), flatVc()),
    // 同一张贴图的 geo 合成一个 mesh
    tex: (geos, tex, line = 0.02, side) => outl(new THREE.Mesh(merge(geos), texMat(tex, side)), line),
    blushes: (geos) => { const m = new THREE.Mesh(merge(geos), blush()); m.renderOrder = 1; return m; },
    halo(color, size, opacity = 0.5) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex(), color, transparent: true, opacity, depthWrite: false }));
      sp.scale.setScalar(size);
      sp.userData.base = opacity;
      sp.raycast = () => {};
      return sp;
    },
  };
  KITS.set(T.toon, K);
  return K;
}

// 黑豆眼：深色椭球 + 两颗高光，本地 +z 朝外。push 进 dark / white 两个列表（flat 合并）
export function eyeInto(L, r, at, n) {
  const o = { n, p: at };
  L.push([X(ell(r, r * 1.15, r * 0.5, 12, 8), o), 0x2b1d18]);
  L.push([X(sph(r * 0.36, 8, 6).translate(r * 0.32, r * 0.42, r * 0.42), o), 0xffffff]);
  L.push([X(sph(r * 0.17, 6, 4).translate(-r * 0.3, -r * 0.42, r * 0.44), o), 0xffffff]);
}
// 小笑嘴 ∪
export function smileGeo(r, tube = 0.008, at, n) {
  const g = tor(r, tube, 4, 12, Math.PI).rotateZ(Math.PI);
  return X(g, { n, p: at });
}
// 球面上的点（中心 c、半径 r（或 [rx,ry,rz]）、方向 d）
export function onBall(c, r, dx, dy, dz, lift = 0) {
  const R = Array.isArray(r) ? r : [r, r, r];
  const d = V3(dx, dy, dz).normalize();
  const p = V3(d.x * R[0], d.y * R[1], d.z * R[2]);
  const n = V3(p.x / R[0] ** 2, p.y / R[1] ** 2, p.z / R[2] ** 2).normalize();
  return { p: p.addScaledVector(n, lift).add(c.isVector3 ? c : V3(...c)), n };
}

// 礼物盒：盒子进 big，丝带和蝴蝶结进 small
export function giftInto(big, small, { x = 0, y = 0, z = 0, w, h, d, ry = 0, col, rib }) {
  const at = (g, p) => X(g.translate(p[0], p[1], p[2]), { r: [0, ry, 0], p: [x, y, z] });
  big.push([at(roundBox(w, h, d, Math.min(0.03, w * 0.12)), [0, h / 2, 0]), col]);
  const t = Math.min(0.05, w * 0.2);
  small.push([at(new THREE.BoxGeometry(w + 0.008, h + 0.008, t), [0, h / 2, 0]), rib]);
  small.push([at(new THREE.BoxGeometry(t, h + 0.008, d + 0.008), [0, h / 2, 0]), rib]);
  const b = Math.min(0.055, w * 0.24);
  for (const s of [-1, 1]) small.push([at(tor(b * 0.7, b * 0.28, 6, 12).scale(1, 0.8, 0.7).rotateZ(s * 0.55), [s * b * 0.75, h + b * 0.5, 0]), rib]);
  small.push([at(sph(b * 0.38, 8, 6), [0, h + b * 0.25, 0]), rib]);
}

/* ================================================================ 圣诞树 */
// 一层树冠：鼓鼓的圆锥，底边一圈波浪（像蓬松的枝叶）
function tierGeo(r, h, waves, phase) {
  const pts = [[0, 0.07], [r * 0.55, 0.03], [r * 0.86, 0.0], [r * 0.98, 0.025], [r, 0.07]];
  const N = 12;
  for (let i = 1; i <= N; i++) { const s = i / N; pts.push([i === N ? 0 : r * Math.pow(1 - s, 0.72), 0.07 + (h - 0.07) * s]); }
  const g = lathe(pts, 36);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const w = clamp(1 - y / 0.2, 0, 1), c = Math.cos(Math.atan2(z, x) * waves + phase);
    const k = 1 + 0.075 * w * c;
    p.setXYZ(i, x * k, y - 0.035 * w * (0.5 + 0.5 * c), z * k);
  }
  return weld(g);
}

export function buildXmasTree(T) {
  const K = kit(T);
  const root = new THREE.Group();
  const big = [], small = [], hi = [];
  // 树裙（红丝绒 + 白毛边）、树干
  big.push([lathe([[0, 0.004], [0.46, 0.004], [0.48, 0.018], [0.46, 0.034], [0, 0.04]], 28), 0xe85a64]);
  big.push([tor(0.47, 0.03, 8, 32).rotateX(Math.PI / 2).translate(0, 0.03, 0), 0xfffaf5]);
  big.push([cyl(0.075, 0.1, 0.32, 10).translate(0, 0.17, 0), 0x8a5a3b]);
  // 三层树冠：y0, 高, 半径, 颜色, 波浪数
  const tiers = [[0.24, 0.62, 0.53, 0x58b873, 9], [0.6, 0.52, 0.43, 0x62c27c, 8], [0.92, 0.46, 0.31, 0x72d08a, 7]];
  const radAt = ([y0, h, r], y) => { const s = clamp((y - y0 - 0.07) / (h - 0.07), 0, 1); return r * Math.pow(1 - s, 0.72); };
  const normAt = ([y0, h, r], y, a) => {
    const s = clamp((y - y0 - 0.07) / (h - 0.07), 0, 0.98), dr = (-0.72 * r * Math.pow(1 - s, -0.28)) / (h - 0.07);
    return V3(Math.cos(a), -dr, Math.sin(a)).normalize();
  };
  tiers.forEach((tr, i) => big.push([tierGeo(tr[2], tr[1], tr[4], i * 1.3).translate(0, tr[0], 0), tr[3]]));

  // 彩带（每层一圈下垂的波浪）、灯泡挂在波浪的高点、彩球挂在低点
  const ORN = [0xff5d6c, 0xffcf4a, 0x7cc6ff, 0xff9fd0, 0xc3a6ff];
  const lights = [];
  const bulbCols = [0xfff2a0, 0xff8fab, 0x9fe8ff, 0xb8f5a0, 0xffc58f];
  let bi = 0;
  const swags = [[tiers[0], 6, 0.3, 0.1, 0.2], [tiers[1], 5, 0.27, 0.09, 1.1], [tiers[2], 4, 0.25, 0.08, 0.4]];
  for (const [ti, [tr, N, lyA, dip, ph]] of swags.entries()) {
    const M = N * 10, pts = [];
    for (let i = 0; i < M; i++) {
      const a = (i / M) * TAU + ph, f = (i % 10) / 10, dy = Math.sin(f * Math.PI);
      const y = tr[0] + lyA - dip * dy, rr = radAt(tr, y) + 0.025 + 0.012 * dy;
      pts.push(V3(Math.cos(a) * rr, y, Math.sin(a) * rr));
    }
    small.push([tube(pts, 0.014, Math.round(M * 1.5), 6, true), 0xffd36b]);
    for (let i = 0; i < N; i++) {
      // 灯泡：波浪高点
      const a0 = (i / N) * TAU + ph, y0 = tr[0] + lyA;
      const n0 = normAt(tr, y0, a0), r0 = radAt(tr, y0);
      const bulb = new THREE.Mesh(ell(0.036, 0.046, 0.036, 8, 6), new THREE.MeshBasicMaterial({ color: bulbCols[bi % bulbCols.length] }));
      bulb.position.set(Math.cos(a0) * r0, y0, Math.sin(a0) * r0).addScaledVector(n0, 0.055);
      bulb.userData.blink = bi;
      bulb.userData.color = bulbCols[bi % bulbCols.length];
      bi++;
      lights.push(bulb);
      root.add(bulb);
      small.push([cyl(0.018, 0.018, 0.03, 6).rotateX(Math.PI / 2).translate(0, 0, -0.03).applyQuaternion(_q.setFromUnitVectors(_Z, n0)).translate(bulb.position.x, bulb.position.y, bulb.position.z), 0x6b8f6a]);
      // 彩球：波浪低点下面一点
      const a1 = ((i + 0.5) / N) * TAU + ph, y1 = tr[0] + lyA - dip - 0.075;
      const n1 = normAt(tr, y1, a1), r1 = radAt(tr, y1);
      const c = V3(Math.cos(a1) * r1, y1, Math.sin(a1) * r1).addScaledVector(n1, 0.045);
      const R = 0.052 - (tr === tiers[2] ? 0.008 : 0);
      small.push([sph(R, 10, 8).translate(c.x, c.y, c.z), ORN[(i * 2 + ti * 3) % ORN.length]]);
      small.push([cyl(0.017, 0.017, 0.022, 6).translate(c.x, c.y + R + 0.004, c.z), 0xffd36b]);
      hi.push([sph(R * 0.28, 6, 4).translate(c.x + n1.x * R * 0.55 - 0.012, c.y + R * 0.45, c.z + n1.z * R * 0.55), 0xffffff]);
    }
  }

  // 底下的礼物
  giftInto(big, small, { x: 0.33, z: 0.3, w: 0.21, h: 0.19, d: 0.21, ry: 0.35, col: 0xff8fab, rib: 0xfffaf5 });
  giftInto(big, small, { x: -0.35, z: 0.27, w: 0.24, h: 0.17, d: 0.19, ry: -0.4, col: 0x8fd3ff, rib: 0xff6b8b });
  giftInto(big, small, { x: 0.02, z: 0.44, w: 0.16, h: 0.14, d: 0.16, ry: 0.12, col: 0xc3a6ff, rib: 0xffd166 });

  root.add(K.part(big, 0.024), K.part(small, 0.011), K.flat(hi));

  // 顶上的星星（自己的材质，调用方可以调 emissiveIntensity）
  const star = new THREE.Group();
  star.position.y = 1.5;
  const sm = K.one(starGeo(0.12, 0.062, 0.035, 0.028), 0xffd84a, 0.016, { emissive: 0xffb300, emissiveIntensity: 0.55 });
  star.add(sm);
  const halo = K.halo(0xffe27a, 0.62, 0.5);
  halo.position.z = -0.02;
  star.add(halo);
  star.userData.mesh = sm;
  star.userData.halo = halo;
  root.add(star);
  root.userData.anim = (t) => xmasTreeTick({ lights, star }, t);
  return { root, lights, star };
}

// 默认的闪灯 + 星星动画（gacha 的圣诞树也用这个）
export function xmasTreeTick({ lights, star }, t) {
  for (const b of lights) {
    const k = Math.sin(t * 2.6 + b.userData.blink * 1.7);
    b.visible = k > -0.55;
    b.material.color.setHex(b.userData.color).multiplyScalar(k > 0.4 ? 1 : 0.8);
  }
  star.rotation.y = Math.sin(t * 0.8) * 0.5;
  const s = 1 + Math.sin(t * 2.2) * 0.04;
  star.scale.setScalar(s);
  star.userData.mesh.material.emissiveIntensity = 0.5 + Math.sin(t * 2.2) * 0.15;
  star.userData.halo.material.opacity = star.userData.halo.userData.base * (0.8 + Math.sin(t * 2.2) * 0.25);
}

/* ================================================================ 拐杖糖 */
// 一根拐杖糖的管子（贴图 u 已经按长度放好，条纹 45°）。dir=1 钩子弯向 -x
export function caneGeo(h = 0.6, hook = 0.11, r = 0.036) {
  const pts = [];
  for (let i = 0; i <= 4; i++) pts.push(V3(0, (h * i) / 4, 0));
  for (let i = 1; i <= 10; i++) { const a = (i / 10) * Math.PI; pts.push(V3(-hook + hook * Math.cos(a), h + hook * Math.sin(a), 0)); }
  pts.push(V3(-hook * 2, h - 0.05, 0));
  const g = tube(pts, r, 40, 8);
  const L = h + Math.PI * hook + 0.05, n = Math.max(1, Math.round(L / (TAU * r)));
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * n);
  g.userData.end = V3(-hook * 2, h - 0.05, 0);
  return g;
}
function caneInto(canes, small, { x = 0, z = 0, ry = 0, h = 0.6, hook = 0.11, r = 0.036, bow = 0x58b873, s = 1 }) {
  const o = { s, r: [0, ry, 0], p: [x, 0, z] };
  const g = caneGeo(h, hook, r);
  const e = g.userData.end;
  canes.push(X(g, o));
  small.push([X(sph(r, 10, 8).translate(e.x, e.y, e.z), o), 0xfffaf5]);
  if (bow != null) {
    const y = h * 0.72;
    for (const sd of [-1, 1]) small.push([X(tor(0.04, 0.015, 6, 12).scale(1, 0.75, 0.7).rotateZ(sd * 0.5).translate(sd * 0.035, y + 0.012, r + 0.004), o), bow]);
    for (const sd of [-1, 1]) small.push([X(new THREE.BoxGeometry(0.025, 0.08, 0.012).rotateZ(sd * 0.35).translate(sd * 0.022, y - 0.04, r + 0.006), o), bow]);
    small.push([X(sph(0.017, 8, 6).translate(0, y, r + 0.008), o), bow]);
  }
}

export function buildCandyCane(T) {
  const K = kit(T);
  const root = new THREE.Group();
  const canes = [], small = [];
  caneInto(canes, small, { h: 0.62, hook: 0.12, r: 0.038 });
  small.push([ell(0.1, 0.045, 0.09, 12, 8), 0xf6f9ff]);
  root.add(K.tex(canes, caneTex(0xff5a6e), 0.018), K.part(small, 0.012));
  return { root };
}

/* ================================================================ 花环（挂墙，朝 +z）*/
// 原点在花环中心、墙面上（z=0），整体厚约 0.2
export function buildWreath(T) {
  const K = kit(T);
  const root = new THREE.Group();
  const R = 0.22, big = [], bow = [], small = [], hi = [];
  const rnd = rng(11);
  big.push([tor(R, 0.07, 10, 32).translate(0, 0, 0.075), 0x3f9a5c]);
  const LEAF = [0x58b873, 0x6fcf86, 0x4fae6a];
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * TAU + rnd() * 0.15, rr = R + (i % 2 ? 0.045 : -0.035) + (rnd() - 0.5) * 0.02;
    const s = 0.05 + rnd() * 0.02;
    big.push([ell(s, s, s * 0.75, 8, 6).translate(Math.cos(a) * rr, Math.sin(a) * rr, 0.1 + rnd() * 0.03), LEAF[i % 3]]);
  }
  // 浆果
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + 0.5;
    if (Math.abs(a % TAU - (Math.PI * 1.5)) < 0.5) continue;
    for (let j = 0; j < 3; j++) {
      const b = a + (j - 1) * 0.1, rr = R + (j === 1 ? 0.03 : -0.005);
      small.push([sph(0.022, 8, 6).translate(Math.cos(b) * rr, Math.sin(b) * rr, 0.165), 0xff4d5e]);
      hi.push([sph(0.007, 4, 3).translate(Math.cos(b) * rr - 0.006, Math.sin(b) * rr + 0.008, 0.186), 0xffffff]);
    }
  }
  // 几颗小彩球
  [[2.3, 0xffcf4a], [0.9, 0x7cc6ff], [3.9, 0xff9fd0]].forEach(([a, c]) => {
    const p = V3(Math.cos(a) * (R + 0.01), Math.sin(a) * (R + 0.01), 0.16);
    small.push([sph(0.036, 10, 8).translate(p.x, p.y, p.z), c]);
    hi.push([sph(0.01, 6, 4).translate(p.x - 0.012, p.y + 0.014, p.z + 0.03), 0xffffff]);
  });
  // 下面的大蝴蝶结 + 上面挂起来的丝带
  const by = -R - 0.01;
  for (const s of [-1, 1]) {
    bow.push([tor(0.06, 0.028, 8, 16).scale(1.1, 0.75, 0.7).rotateZ(s * 0.35).translate(s * 0.07, by + 0.02, 0.18), 0xff5d6c]);
    bow.push([roundBox(0.05, 0.14, 0.02, 0.009).rotateZ(s * 0.35).translate(s * 0.045, by - 0.08, 0.17), 0xff5d6c]);
  }
  bow.push([ell(0.035, 0.032, 0.03, 10, 8).translate(0, by + 0.01, 0.195), 0xff5d6c]);
  bow.push([roundBox(0.045, 0.2, 0.012, 0.006).translate(0, R + 0.1, 0.03), 0xff5d6c]);
  for (const s of [-1, 1]) bow.push([tor(0.025, 0.01, 6, 12).scale(1, 0.7, 0.7).rotateZ(s * 0.4).translate(s * 0.025, R + 0.2, 0.04), 0xff5d6c]);
  small.push([sph(0.016, 8, 6).translate(0, R + 0.2, 0.05), 0xffd36b]);
  root.add(K.part(big, 0.018), K.part(bow, 0.014), K.part(small, 0.009), K.flat(hi));
  return { root };
}

/* ================================================================ 礼物堆 */
export function buildGiftPile(T) {
  const K = kit(T);
  const root = new THREE.Group();
  const big = [], small = [];
  giftInto(big, small, { x: -0.13, z: -0.06, w: 0.34, h: 0.28, d: 0.32, ry: 0.15, col: 0xff9fb8, rib: 0xfffaf5 });
  giftInto(big, small, { x: 0.23, z: 0.0, w: 0.26, h: 0.22, d: 0.26, ry: -0.3, col: 0x9fe0c8, rib: 0xff6b8b });
  giftInto(big, small, { x: -0.11, y: 0.28, z: -0.05, w: 0.2, h: 0.17, d: 0.2, ry: 0.65, col: 0xffd36b, rib: 0x8fb8ff });
  giftInto(big, small, { x: 0.04, z: 0.27, w: 0.16, h: 0.14, d: 0.16, ry: -0.2, col: 0xc3a6ff, rib: 0xfffaf5 });
  // 圆筒礼盒
  const cx = 0.3, cz = 0.27;
  big.push([cyl(0.085, 0.085, 0.15, 18).translate(cx, 0.075, cz), 0x8fd3ff]);
  big.push([cyl(0.093, 0.093, 0.04, 18).translate(cx, 0.16, cz), 0x8fd3ff]);
  small.push([cyl(0.088, 0.088, 0.03, 18).translate(cx, 0.08, cz), 0xffd36b]);
  for (const s of [-1, 1]) small.push([tor(0.032, 0.012, 6, 12).scale(1, 0.8, 0.7).rotateZ(s * 0.55).translate(cx + s * 0.03, 0.2, cz), 0xffd36b]);
  small.push([sph(0.016, 8, 6).translate(cx, 0.19, cz), 0xffd36b]);
  root.add(K.part(big, 0.022), K.part(small, 0.01));
  return { root };
}

/* ================================================================ 雪人一家 */
function snowmanInto(L, { x, z, ry = 0, s = 1, hat, scarf, arms }) {
  const o = { s, r: [0, ry, 0], p: [x, 0, z] };
  const A = (list, g, c) => list.push([X(g, o), c]);
  A(L.white, ell(0.3, 0.27, 0.29, 16, 12).translate(0, 0.27, 0), 0xffffff);
  const hc = V3(0, 0.68, 0), hr = 0.235;
  A(L.white, sph(hr, 16, 12).translate(0, hc.y, 0), 0xffffff);
  // 脸
  for (const sd of [-1, 1]) {
    const e = onBall(hc, hr, sd * 0.36, 0.14, 0.92);
    const eye = [];
    eyeInto(eye, 0.03, e.p, e.n);
    for (const [g, c] of eye) A(L.face, g, c);
    const b = onBall(hc, hr, sd * 0.62, -0.08, 0.78, 0.002);
    L.blush.push(X(X(ell(0.04, 0.025, 0.01, 10, 6), { n: b.n, p: b.p }), o));
  }
  const m = onBall(hc, hr, 0, -0.32, 0.95);
  A(L.face, smileGeo(0.035, 0.008, m.p, m.n), 0x2b1d18);
  const nz = onBall(hc, hr, 0, -0.05, 1);
  A(L.small, cone(0.034, 0.15, 8).rotateX(Math.PI / 2).translate(nz.p.x, nz.p.y, nz.p.z + 0.06), 0xff8a3d);
  // 扣子
  for (const [dy, dz] of [[0.42, 0.9], [0.12, 0.99]]) {
    const b = onBall([0, 0.27, 0], [0.3, 0.27, 0.29], 0, dy, dz);
    A(L.face, sph(0.026, 8, 6).translate(b.p.x, b.p.y, b.p.z), 0x3a2a28);
  }
  // 围巾
  A(L.big, tor(0.2, 0.052, 8, 22).rotateX(Math.PI / 2).scale(1, 1, 0.95).translate(0, 0.48, 0), scarf);
  A(L.big, roundBox(0.09, 0.2, 0.045, 0.02).rotateZ(0.22).rotateX(-0.25).translate(0.12, 0.38, 0.22), scarf);
  for (const k of [0, 1]) A(L.small, new THREE.BoxGeometry(0.094, 0.018, 0.05).rotateZ(0.22).rotateX(-0.25).translate(0.12 - k * 0.012, 0.32 + k * 0.05, 0.225), 0xfffaf5);
  // 帽子
  if (hat === "top") {
    const h = { r: [0, 0, -0.18], p: [0.02, 0.86, 0] };
    A(L.big, X(cyl(0.21, 0.21, 0.03, 18), h), 0x3d4a6b);
    A(L.big, X(cyl(0.135, 0.145, 0.22, 16).translate(0, 0.12, 0), h), 0x3d4a6b);
    A(L.small, X(cyl(0.148, 0.148, 0.05, 16).translate(0, 0.045, 0), h), 0xff6b6b);
    A(L.small, X(sph(0.03, 8, 6).translate(0.11, 0.06, 0.08), h), 0x58b873);
  } else if (hat === "beanie") {
    A(L.big, hemi(0.24, 16, 6).scale(1, 0.92, 1).translate(0, 0.74, 0), 0xff9fd0);
    A(L.big, tor(0.235, 0.04, 8, 22).rotateX(Math.PI / 2).translate(0, 0.76, 0), 0xfffaf5);
    A(L.big, sph(0.07, 10, 8).translate(0, 0.98, 0), 0xfffaf5);
  } else if (hat === "muffs") {
    A(L.small, tor(0.245, 0.02, 6, 16, Math.PI).translate(0, 0.7, -0.02), 0xc3a6ff);
    for (const sd of [-1, 1]) A(L.big, ell(0.05, 0.075, 0.075, 12, 8).translate(sd * 0.235, 0.7, -0.02), 0xc3a6ff);
  }
  if (arms) for (const sd of [-1, 1]) {
    A(L.small, rod([sd * 0.25, 0.36, 0], [sd * 0.5, 0.56, 0.04], 0.016, 5), 0x8a5a3b);
    A(L.small, rod([sd * 0.42, 0.49, 0.03], [sd * 0.5, 0.48, 0.05], 0.012, 5), 0x8a5a3b);
  }
}

export function buildSnowmanFamily(T) {
  const K = kit(T);
  const root = new THREE.Group();
  const L = { white: [], big: [], small: [], face: [], blush: [] };
  snowmanInto(L, { x: -0.04, z: -0.12, hat: "top", scarf: 0xff6b6b, arms: true });
  snowmanInto(L, { x: 0.37, z: 0.15, ry: -0.35, s: 0.58, hat: "beanie", scarf: 0x9fe0c8 });
  snowmanInto(L, { x: -0.4, z: 0.17, ry: 0.35, s: 0.55, hat: "muffs", scarf: 0xffd36b });
  // 雪地
  L.white.push([ell(0.5, 0.03, 0.34, 20, 8).translate(0, 0, 0.02), 0xf3f7ff]);
  root.add(K.part(L.white, 0.024), K.part(L.big, 0.016), K.part(L.small, 0.01), K.flat(L.face), K.blushes(L.blush));
  return { root };
}

/* ================================================================ 圣诞帽 */
// 原点在帽口中心；帽口半径 ≈0.33，戴在半径 0.5 的头上：放在头的本地 (0, ~0.34, 0)，可以再歪一点 rotation.z。
export function buildSantaHat(T) {
  const K = kit(T);
  const root = new THREE.Group();
  const H = 0.6, bend = 1.9;
  const prof = [[0, 0], [0.31, 0], [0.312, 0.05], [0.29, 0.15], [0.245, 0.27], [0.18, 0.39], [0.11, 0.5], [0.05, 0.57], [0, 0.6]];
  const cone_ = bendY(lathe(prof, 20), H, bend, 2.2);
  const tip = bendTip(H, bend, 2.2);
  root.add(K.one(cone_, 0xff5d6c, 0.022));
  const fluff = [];
  const brim = tor(0.315, 0.075, 10, 32).rotateX(Math.PI / 2);
  const bp = brim.attributes.position; // 毛边：一点点起伏
  for (let i = 0; i < bp.count; i++) {
    const x = bp.getX(i), z = bp.getZ(i), k = 1 + 0.06 * Math.sin(Math.atan2(z, x) * 11) * 0.3;
    bp.setY(i, bp.getY(i) * (1 + 0.08 * Math.sin(Math.atan2(z, x) * 11)));
    bp.setX(i, x * k); bp.setZ(i, z * k);
  }
  weld(brim);
  fluff.push([brim.translate(0, 0.03, 0), 0xfffaf5]);
  const pp = tip.p.clone().addScaledVector(tip.dir, 0.03);
  fluff.push([sph(0.085, 14, 10).translate(pp.x, pp.y, pp.z), 0xfffaf5]);
  root.add(K.part(fluff, 0.02));
  return { root };
}
