// 岛上的小生命（v15「小岛生活」），全部程序生成，没有外部模型：
//   buildPet     —— 蛋里孵出来的小宠物：9 种，每种 3 个普通色 + 1 个稀有闪光色
//   buildVisitor —— 来岛上串门的 8 位访客（Q 版直立小动物，各带一件标志性小道具）
//   buildEgg     —— 8 种花纹的宠物蛋（会摇、会裂、顶壳会掀开）
//   buildBoat    —— 奶油色小帆船（粉色腰线，帆上一颗爱心）
// 省 draw call 的做法：一只角色的所有部件按顶点色烤进「一个蒙皮网格」，头 / 耳朵 / 尾巴 / 腿 / 眼睛 / 嘴
// 各挂一根骨头（刚性绑定：一个顶点只跟一根骨头），描边也是同一副骨架的蒙皮网格，所以描边跟着一起动。
// 一只宠物 = 主体 + 描边 + 脸（眼睛 / 嘴 / 腮红 / 闪光色的发光点缀，不受光）= 3 次绘制；闪光色再 +1（星星粒子）。
// 朝向 +z，脚在 y=0。几何体 / 材质都按种类缓存，多只同种宠物共享；update() 里不分配内存。
import * as THREE from "three";
import { mergeGeometries, mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

/* ================================================================ 小工具 */
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const sstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const TAU = Math.PI * 2;
const HIDE = 1e-4;
const _ca = new THREE.Color(), _cb = new THREE.Color();
// 两色渐变（返回共享的 Color，调用方要马上用掉）
const mix = (a, b, t) => _ca.setHex(a).lerp(_cb.setHex(b), clamp01(t));
const blend = (a, b, t) => mix(a, b, t).getHex();

function mat4(p = [0, 0, 0], r = [0, 0, 0], s = 1) {
  const sc = typeof s === "number" ? [s, s, s] : s;
  return new THREE.Matrix4().compose(V(p[0], p[1], p[2]),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(r[0] || 0, r[1] || 0, r[2] || 0)), V(sc[0], sc[1], sc[2]));
}
// 只留位置，焊接缝合处的顶点再算平滑法线（球的接缝 / 自己变形过的几何体用）
function smooth(g) {
  for (const k of Object.keys(g.attributes)) if (k !== "position") g.deleteAttribute(k);
  const m = mergeVertices(g, 1e-5);
  m.computeVertexNormals();
  return m;
}
// 平面小图形（在 xy 平面上，之后由 decal 贴到曲面上）
const flatOnly = (g) => { for (const k of Object.keys(g.attributes)) if (k !== "position") g.deleteAttribute(k); if (!g.index) g.setIndex([...Array(g.attributes.position.count).keys()]); return g; };
const ellG = (rx, ry, cx = 0, cy = 0, seg = 20) => flatOnly(new THREE.CircleGeometry(1, seg).scale(rx, ry, 1).translate(cx, cy, 0));
const arcG = (R, w, a0, len, cx = 0, cy = 0, seg = 12) => flatOnly(new THREE.RingGeometry(R - w / 2, R + w / 2, seg, 1, a0, len).translate(cx, cy, 0));
const polyG = (pts) => flatOnly(new THREE.ShapeGeometry(new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)))));
const joinG = (...gs) => mergeGeometries(gs.map(flatOnly), false);
function heartG(s, cx = 0, cy = 0) {
  const pts = [];
  for (let i = 0; i < 28; i++) {
    const t = (i / 28) * TAU;
    pts.push([cx + (s * 16 * Math.sin(t) ** 3) / 17, cy + (s * (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t))) / 17 + s * 0.1]);
  }
  return polyG(pts);
}
function starG(R, r, n = 5, cx = 0, cy = 0, rot = 0) {
  const pts = [];
  for (let i = 0; i < n * 2; i++) {
    const a = Math.PI / 2 + rot + (i * Math.PI) / n, rr = i % 2 ? r : R;
    pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
  }
  return polyG(pts);
}
const rectG = (w, h, cx = 0, cy = 0, rot = 0) => flatOnly(new THREE.PlaneGeometry(w, h).rotateZ(rot).translate(cx, cy, 0));
function snowG(R) {
  const parts = [];
  for (let i = 0; i < 3; i++) parts.push(rectG(R * 2, R * 0.22, 0, 0, (i * Math.PI) / 3));
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3, cx = Math.cos(a) * R * 0.6, cy = Math.sin(a) * R * 0.6;
    parts.push(rectG(R * 0.6, R * 0.16, cx, cy, a + 0.9), rectG(R * 0.6, R * 0.16, cx, cy, a - 0.9));
  }
  return joinG(...parts);
}
function flowerG(R) {
  const ps = [];
  for (let i = 0; i < 5; i++) { const a = Math.PI / 2 + (i * TAU) / 5; ps.push(ellG(R * 0.5, R * 0.5, Math.cos(a) * R * 0.55, Math.sin(a) * R * 0.55, 12)); }
  return joinG(...ps);
}
// 小亮星（闪光色额头上的四角星）
const sparkG = (R) => starG(R, R * 0.32, 4);

// 椭球（c 中心，r 半径）：给正面 (x, y) 处算出从中心出发的方向
function front(e, x, y) {
  const [cx, cy, cz] = e.c, [rx, ry, rz] = e.r;
  const q = Math.max(0, 1 - ((x - cx) / rx) ** 2 - ((y - cy) / ry) ** 2);
  return [x - cx, y - cy, rz * Math.sqrt(q)];
}

/* ================================================================ 材质缓存（按调用方的 toon / outlined 函数分组） */
const CACHE = new WeakMap();
function cached(fn, key, make) {
  let m = CACHE.get(fn);
  if (!m) CACHE.set(fn, (m = new Map()));
  if (!m.has(key)) m.set(key, make());
  return m.get(key);
}
const vcMat = (toon, key = "vc", extra = {}) => cached(toon, key, () => toon(0xffffff, { vertexColors: true, ...extra }));
let FACE_MAT = null; // 眼睛 / 嘴 / 发光点缀：不受光，颜色最准
const faceMat = () => FACE_MAT || (FACE_MAT = new THREE.MeshBasicMaterial({ vertexColors: true }));
// 借调用方 outlined() 生成的描边材质（颜色 / 厚度 / 合批标记都和场景里一致），套到蒙皮网格上
function lineMat(outlined, th) {
  return cached(outlined, "line" + th, () => {
    const probe = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.01, 0.01), new THREE.MeshBasicMaterial());
    outlined(probe, th);
    const o = probe.children[0];
    return o && o.material ? o.material : null;
  });
}
function radialTex(stops) {
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const x = c.getContext("2d"), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  for (const [k, a] of stops) g.addColorStop(k, `rgba(255,255,255,${a})`);
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  return t;
}
let SPARK_MAT = null; // 闪光色身边一闪一闪的小星星（Points，一只 1 次绘制）
function sparkMat() {
  if (SPARK_MAT) return SPARK_MAT;
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const x = c.getContext("2d");
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 30);
  g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.18, "rgba(255,255,255,0.8)"); g.addColorStop(0.45, "rgba(255,255,255,0.1)"); g.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  x.fillStyle = "#fff";
  x.beginPath();
  for (let i = 0; i < 8; i++) { const a = (i * Math.PI) / 4, r = i % 2 ? 4 : 30; x.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r); }
  x.fill();
  SPARK_MAT = new THREE.PointsMaterial({ map: new THREE.CanvasTexture(c), size: 0.07, sizeAttenuation: true, vertexColors: true,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  return SPARK_MAT;
}
const HALO = new Map(); // 星星团子的光晕（叠加混合的贴片）
function haloMat(color) {
  if (!HALO.has(color)) {
    if (!HALO.tex) HALO.tex = radialTex([[0, 0.9], [0.3, 0.45], [1, 0]]);
    HALO.set(color, new THREE.SpriteMaterial({ map: HALO.tex, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.4 }));
  }
  return HALO.get(color);
}

/* ================================================================ Kit：往里摆零件（单位尺寸，高约 1），最后按比例烤成蒙皮网格 */
const _p = V(), _n = V(), _c = new THREE.Color();
class Kit {
  constructor() { this.bones = []; this.idx = {}; this.parts = []; }
  bone(name, parent, p) {
    this.idx[name] = this.bones.length;
    this.bones.push({ name, parent: parent == null ? -1 : this.idx[parent], p: p.slice() });
    return this;
  }
  // o: { color: hex | (p, n) => hex|Color, bone, layer: "main"|"face", out(描边), m: Matrix4, skin: (p) => [boneA, boneB, wB] }
  add(geo, o = {}) {
    const g = geo;
    for (const k of Object.keys(g.attributes)) if (k !== "position" && k !== "normal") g.deleteAttribute(k);
    if (!g.index) g.setIndex([...Array(g.attributes.position.count).keys()]);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (o.m) g.applyMatrix4(o.m);
    const P = g.attributes.position, N = g.attributes.normal, n = P.count;
    const col = new Float32Array(n * 3), si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    const bi = this.idx[o.bone || "body"] ?? 0;
    const fn = typeof o.color === "function" ? o.color : null;
    if (!fn) _c.setHex(o.color ?? 0xff00ff);
    for (let i = 0; i < n; i++) {
      _p.fromBufferAttribute(P, i); _n.fromBufferAttribute(N, i);
      if (fn) { const r = fn(_p, _n); if (typeof r === "number") _c.setHex(r); else _c.copy(r); }
      col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b;
      if (o.skin) { const s = o.skin(_p); si[i * 4] = s[0]; si[i * 4 + 1] = s[1]; sw[i * 4] = 1 - s[2]; sw[i * 4 + 1] = s[2]; }
      else { si[i * 4] = bi; sw[i * 4] = 1; }
    }
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(si, 4));
    g.setAttribute("skinWeight", new THREE.BufferAttribute(sw, 4));
    const layer = o.layer || "main";
    this.parts.push({ g, layer, out: layer === "main" && o.out !== false });
    return this;
  }
  ball(c, r, color, bone, o = {}) {
    const g = new THREE.SphereGeometry(1, o.ws || 18, o.hs || 12, ...(o.part || []));
    return this.add(g, { ...o, color, bone, m: mat4(c, o.rot, r) });
  }
  cone(c, rad, h, color, bone, o = {}) {
    return this.add(new THREE.ConeGeometry(rad, h, o.seg || 12), { ...o, color, bone, m: mat4(c, o.rot, o.scl || 1) });
  }
  cyl(c, rt, rb, h, color, bone, o = {}) {
    return this.add(new THREE.CylinderGeometry(rt, rb, h, o.seg || 16, 1, !!o.open, ...(o.theta || [])), { ...o, color, bone, m: mat4(c, o.rot, o.scl || 1) });
  }
  torus(c, R, tube, color, bone, o = {}) {
    return this.add(new THREE.TorusGeometry(R, tube, o.rs || 6, o.ts || 22, o.arc || TAU), { ...o, color, bone, m: mat4(c, o.rot, o.scl || 1) });
  }
  box(c, s, color, bone, o = {}) {
    return this.add(new THREE.BoxGeometry(s[0], s[1], s[2]), { ...o, color, bone, m: mat4(c, o.rot, 1) });
  }
  // a → b 的小胶囊（手杖 / 背带 / 腿）
  stick(a, b, rad, color, bone, o = {}) {
    const A = V(...a), B = V(...b), d = B.clone().sub(A), len = d.length();
    const g = new THREE.CapsuleGeometry(rad, Math.max(0.001, len), 3, o.seg || 8);
    const m = new THREE.Matrix4().compose(A.clone().add(B).multiplyScalar(0.5),
      new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), d.normalize()), V(1, 1, 1));
    return this.add(g, { ...o, color, bone, m });
  }
  // 平面小图形贴到椭球 e 的 dir 方向上（顺着曲面弯），默认放进不受光的「脸」层
  decal(e, dir, flat, color, bone, o = {}) {
    const C = V(...e.c), R = V(...e.r), d = V(...dir).normalize();
    const tt = 1 / Math.sqrt((d.x / R.x) ** 2 + (d.y / R.y) ** 2 + (d.z / R.z) ** 2);
    const A = C.clone().addScaledVector(d, tt);
    const nrm = (q, out) => out.set((q.x - C.x) / R.x ** 2, (q.y - C.y) / R.y ** 2, (q.z - C.z) / R.z ** 2).normalize();
    const n0 = nrm(A, V());
    const t1 = V().crossVectors(V(0, 1, 0), n0);
    if (t1.lengthSq() < 1e-6) t1.set(1, 0, 0);
    t1.normalize();
    const t2 = V().crossVectors(n0, t1);
    if (o.spin) { t1.applyAxisAngle(n0, o.spin); t2.applyAxisAngle(n0, o.spin); }
    const g = flat.clone ? flat.clone() : flat;
    const P = g.attributes.position, nor = new Float32Array(P.count * 3);
    const lift = o.lift ?? 0.006, q = V(), nn = V();
    for (let i = 0; i < P.count; i++) {
      q.copy(A).addScaledVector(t1, P.getX(i)).addScaledVector(t2, P.getY(i)).sub(C);
      const s = 1 / Math.sqrt((q.x / R.x) ** 2 + (q.y / R.y) ** 2 + (q.z / R.z) ** 2);
      q.multiplyScalar(s).add(C);
      nrm(q, nn);
      q.addScaledVector(nn, lift);
      P.setXYZ(i, q.x, q.y, q.z);
      nor.set([nn.x, nn.y, nn.z], i * 3);
    }
    g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
    return this.add(g, { layer: "face", out: false, ...o, color, bone });
  }
}

// 烤：按层合并、整体缩放到世界尺寸；描边网格只留位置 + 蒙皮，焊点后重算法线
function bakeKit(kit, S) {
  const sm = new THREE.Matrix4().makeScale(S, S, S);
  const merge = (f) => {
    const list = kit.parts.filter(f).map((p) => p.g);
    if (!list.length) return null;
    const g = list.length === 1 ? list[0].clone() : mergeGeometries(list, false);
    g.applyMatrix4(sm);
    return g;
  };
  const main = merge((p) => p.layer === "main");
  const face = merge((p) => p.layer === "face");
  let line = merge((p) => p.layer === "main" && p.out);
  if (line) {
    for (const k of Object.keys(line.attributes)) if (!["position", "skinIndex", "skinWeight"].includes(k)) line.deleteAttribute(k);
    line = mergeVertices(line, 1e-4);
    line.computeVertexNormals();
  }
  main.computeBoundingSphere();
  const sphere = main.boundingSphere.clone();
  sphere.radius *= 1.35;
  return { main, face, line, sphere, S, bones: kit.bones.map((b) => ({ name: b.name, parent: b.parent, p: b.p.map((v) => v * S) })) };
}

// 一份烤好的 spec → 一个实例（骨骼每只一套，几何体 / 材质共享）
function instantiate(spec, mats) {
  const root = new THREE.Group(), rig = new THREE.Group();
  root.add(rig);
  const bones = spec.bones.map((b) => { const o = new THREE.Bone(); o.name = b.name; return o; });
  spec.bones.forEach((b, i) => {
    const o = bones[i];
    if (b.parent < 0) { o.position.fromArray(b.p); rig.add(o); }
    else { const pp = spec.bones[b.parent].p; o.position.set(b.p[0] - pp[0], b.p[1] - pp[1], b.p[2] - pp[2]); bones[b.parent].add(o); }
  });
  const skel = new THREE.Skeleton(bones);
  rig.updateMatrixWorld(true);
  const meshes = [];
  const mk = (geo, mat, tap) => {
    if (!geo || !mat) return null;
    const m = new THREE.SkinnedMesh(geo, mat);
    rig.add(m);
    m.bind(skel);
    m.boundingSphere = spec.sphere;
    if (!tap) m.raycast = () => {};
    meshes.push(m);
    return m;
  };
  const main = mk(spec.main, mats.main, true);
  const line = mk(spec.line, mats.line, false);
  const face = mk(spec.face, faceMat(), false);
  const B = {};
  for (const b of bones) B[b.name] = b;
  return { root, rig, bones: B, main, line, face, skel };
}

function tagAll(root, what, id) {
  root.userData.dynamic = true; // batch3d 不要碰
  root.traverse((o) => { o.userData.what = what; o.userData.id = id; });
}

/* ================================================================ 动画：几个状态的姿势按权重平滑混合 */
const STATES = ["idle", "walk", "hop", "sleep", "eat", "happy", "wave", "talk"];
const SI = Object.fromEntries(STATES.map((s, i) => [s, i]));
// 通道
const Y = 0, SQ = 1, PITCH = 2, ROLL = 3, LEAN = 4, HX = 5, HY = 6, HZ = 7, EAR = 8, EARZ = 9, TAILX = 10, TAILY = 11,
  LA = 12, LB = 13, AL = 14, AR = 15, AXL = 16, AXR = 17, TUCK = 18, EYEC = 19, EYEH = 20, MOUTH = 21, NCH = 22;

function jump(c, p, h) { // 一次跳：起跳拉长 → 空中 → 落地压扁
  if (p < 0.62) { const k = p / 0.62; c[Y] += h * 4 * k * (1 - k); c[SQ] += 0.1 * (1 - 2 * k); c[LA] += 0.5 * Math.sin(Math.PI * k); c[LB] += 0.5 * Math.sin(Math.PI * k); }
  else { const k = (p - 0.62) / 0.38; c[SQ] -= 0.16 * Math.sin(Math.PI * k); }
}

function pose(s, t, c, P) {
  c.fill(0);
  c[LEAN] = P.lean || 0;
  const br = Math.sin(t * 2.1);
  const fl = P.float ? 0.2 + 0.04 * Math.sin(t * 1.9) : 0;
  switch (s) {
    case 0: // idle
      c[Y] = fl;
      c[SQ] = 0.022 * br; c[HX] = 0.05 * Math.sin(t * 0.8); c[HZ] = 0.07 * Math.sin(t * 0.53); c[HY] = 0.16 * Math.sin(t * 0.31);
      c[TAILY] = 0.3 * P.tail * Math.sin(t * 1.7);
      c[EAR] = 0.35 * P.ear * Math.max(0, Math.sin(t * 1.3)) ** 12;
      c[AL] = c[AR] = 0.04 * br;
      if (P.float) { c[AL] = c[AR] = 0.18 * Math.sin(t * 2.2); c[ROLL] = 0.06 * Math.sin(t * 1.1); }
      break;
    case 1: { // walk（原地的动作，位置由调用方移动）
      const w = t * (P.step || 9), s1 = Math.sin(w), ac = Math.abs(Math.cos(w));
      switch (P.gait) {
        case "hop": jump(c, (t * 1.9) % 1, 0.2); c[HX] = -0.06; c[EAR] = 0.25 * P.ear * Math.sin(t * 1.9 * TAU); c[TAILY] = 0.2 * Math.sin(t * 12); break;
        case "waddle": c[ROLL] = 0.16 * s1; c[LA] = 0.55 * s1; c[LB] = -0.55 * s1; c[Y] = 0.03 * ac; c[AL] = c[AR] = 0.25 + 0.25 * Math.abs(s1); c[TAILY] = 0.35 * Math.sin(2 * w); c[HZ] = -0.08 * s1; break;
        case "slide": c[PITCH] = 0.08 * s1; c[Y] = 0.035 * Math.max(0, s1); c[AL] = c[AR] = 0.3 + 0.4 * s1; c[TAILX] = 0.3 * Math.cos(w); c[HX] = -0.06 * s1; c[SQ] = 0.04 * s1; break;
        case "float": c[Y] = 0.24 + 0.05 * Math.sin(t * 2.4); c[ROLL] = 0.14 * Math.sin(t * 3); c[PITCH] = 0.12; c[AL] = c[AR] = 0.4 * Math.sin(t * 6); c[LA] = 0.4 * s1; c[LB] = -0.4 * s1; break;
        case "crawl": c[LA] = 0.6 * s1; c[LB] = -0.6 * s1; c[HY] = 0.14 * s1; c[TAILY] = -0.4 * s1; c[ROLL] = 0.04 * s1; c[Y] = 0.012 * ac; break;
        case "biped":
          c[LA] = 0.55 * s1; c[LB] = -0.55 * s1; c[AXL] = -0.5 * s1; c[AXR] = 0.5 * s1; c[AL] = c[AR] = 0.08;
          c[Y] = 0.025 * ac; c[ROLL] = 0.05 * s1; c[HZ] = -0.04 * s1; c[TAILY] = 0.3 * P.tail * Math.sin(2 * w); break;
        default: // trot
          c[LA] = 0.65 * s1; c[LB] = -0.65 * s1; c[Y] = 0.035 * ac; c[HX] = 0.05 * Math.sin(2 * w); c[ROLL] = 0.04 * s1; c[TAILY] = 0.45 * P.tail * Math.sin(2 * w); c[EAR] = 0.1 * P.ear * s1;
      }
      break;
    }
    case 2: // hop：原地蹦蹦
      jump(c, (t * 1.6) % 1, P.float ? 0.12 : 0.26); c[Y] += fl; c[EAR] = 0.3 * P.ear * Math.sin(t * 1.6 * TAU); c[TAILY] = 0.3 * P.tail * Math.sin(t * 14);
      c[AL] = c[AR] = 0.4 + 0.3 * Math.sin(t * 1.6 * TAU);
      break;
    case 3: // sleep：缩成一团、闭眼、慢慢呼吸
      c[TUCK] = 1; c[EYEC] = 1; c[SQ] = -0.09 + 0.025 * Math.sin(t * 1.3); c[Y] = -(P.drop || 0) + (P.float ? 0.03 : 0);
      c[HX] = P.sleepHx ?? 0.3; c[HZ] = 0.2; c[EAR] = 0.55 * P.ear; c[TAILY] = 0.9 * P.tail; c[TAILX] = 0.1 * P.tail; c[AL] = c[AR] = -0.12;
      break;
    case 4: // eat：低头啃啃
      c[Y] = fl * 0.5;
      c[HX] = (P.eatHx ?? 0.45) + 0.1 * Math.sin(t * 10); c[LEAN] += 0.1; c[MOUTH] = 0.5 + 0.5 * Math.sin(t * 10);
      c[TAILY] = 0.3 * P.tail * Math.sin(t * 4); c[EAR] = -0.1 * P.ear; c[AL] = c[AR] = 0.15;
      if (P.noHead) c[PITCH] = 0.25 + 0.06 * Math.sin(t * 10);
      break;
    case 5: // happy：小跳 + 压扁 + 眯眼笑
      jump(c, (t * 1.5) % 1, P.float ? 0.14 : 0.22); c[Y] += fl;
      c[EYEH] = 1; c[MOUTH] = 0.85; c[TAILY] = 0.6 * P.tail * Math.sin(t * 16);
      c[EAR] = -0.2 * P.ear; c[EARZ] = 0.15 * P.ear * Math.sin(t * 16); c[HZ] = 0.1 * Math.sin(t * 4.7);
      c[AL] = c[AR] = (P.happyArm ?? 0.8) + 0.25 * Math.sin(t * 12);
      break;
    case 6: { // wave：举起一只手挥一挥
      const sw = P.waveArm === "L" ? AL : AR, sx = P.waveArm === "L" ? AXL : AXR;
      c[sw] = 2.45 + 0.35 * Math.sin(t * 9); c[sx] = -0.25;
      c[HZ] = P.waveArm === "L" ? -0.12 : 0.12; c[HX] = -0.05; c[ROLL] = 0.03 * Math.sin(t * 4.5); c[MOUTH] = 0.35; c[SQ] = 0.015 * br; c[EYEH] = 1;
      c[TAILY] = 0.4 * P.tail * Math.sin(t * 6); c[Y] = fl;
      break;
    }
    case 7: { // talk：嘴一张一合、点点头、手比划
      const g = Math.max(0, Math.sin(t * 2.6));
      c[MOUTH] = clamp01(0.45 + 0.65 * Math.sin(t * 13) * Math.sin(t * 3.3 + 1));
      c[HX] = 0.06 * Math.sin(t * 4.5); c[HZ] = 0.08 * Math.sin(t * 1.7); c[SQ] = 0.015 * br;
      c[AL] = 0.25 + 0.25 * g; c[AXL] = -0.55 * g; c[AXR] = -0.3 * Math.max(0, Math.sin(t * 2.6 + 2)); c[AR] = 0.15; c[Y] = fl;
      c[TAILY] = 0.2 * P.tail * Math.sin(t * 2);
      break;
    }
  }
  if (P.armK) { c[AL] *= P.armK; c[AR] *= P.armK; c[AXL] *= P.armK; c[AXR] *= P.armK; }
  if (P.holdL) { c[AXL] *= 0.15; c[AL] *= 0.15; }
  if (P.holdR) { c[AXR] *= 0.15; c[AR] *= 0.15; }
}

class Anim {
  constructor(inst, prof, S, allowed) {
    this.i = inst; this.P = prof; this.S = S; this.allowed = allowed;
    this.w = new Float32Array(STATES.length);
    this.acc = new Float32Array(NCH); this.tmp = new Float32Array(NCH);
    this.cur = -1; this.seed = Math.random() * 20;
    const b = inst.bones;
    this.b = b;
    this.legA = ["legFL", "legBR", "legL"].map((n) => b[n]).filter(Boolean);
    this.legB = ["legFR", "legBL", "legR"].map((n) => b[n]).filter(Boolean);
  }
  update(t, dt, state) {
    let s = SI[state];
    if (s === undefined || !this.allowed.includes(s)) s = 0;
    const w = this.w;
    if (this.cur < 0) { w.fill(0); w[s] = 1; }
    this.cur = s;
    const k = 1 - Math.exp(-Math.min(0.1, dt || 0) * 7);
    let sum = 0;
    for (let i = 0; i < w.length; i++) {
      w[i] += ((i === s ? 1 : 0) - w[i]) * k;
      if (i !== s && w[i] < 0.003) w[i] = 0;
      sum += w[i];
    }
    const acc = this.acc, tmp = this.tmp, tt = t + this.seed;
    acc.fill(0);
    for (let i = 0; i < w.length; i++) {
      if (!w[i]) continue;
      pose(i, tt, tmp, this.P);
      for (let j = 0; j < NCH; j++) acc[j] += tmp[j] * (w[i] / sum);
    }
    this.apply(tt);
  }
  apply(t) {
    const c = this.acc, b = this.b, rig = this.i.rig, S = this.S;
    rig.position.y = c[Y] * S;
    rig.scale.set(1 - c[SQ] * 0.55, 1 + c[SQ], 1 - c[SQ] * 0.55);
    rig.rotation.set(c[PITCH], 0, c[ROLL]);
    if (b.body) b.body.rotation.x = c[LEAN];
    if (b.head) b.head.rotation.set(c[HX], c[HY], c[HZ]);
    if (b.earL) b.earL.rotation.set(-c[EAR], 0, c[EARZ]);
    if (b.earR) b.earR.rotation.set(-c[EAR], 0, -c[EARZ]);
    if (b.tail) b.tail.rotation.set(c[TAILX], c[TAILY], 0);
    const tk = 1 - 0.5 * c[TUCK];
    for (const l of this.legA) { l.rotation.x = c[LA]; l.scale.setScalar(tk); }
    for (const l of this.legB) { l.rotation.x = c[LB]; l.scale.setScalar(tk); }
    if (b.armL) b.armL.rotation.set(c[AXL], 0, -c[AL]);
    if (b.armR) b.armR.rotation.set(c[AXR], 0, c[AR]);
    const closed = c[EYEC] > 0.5, happy = !closed && c[EYEH] > 0.5;
    const blink = (t % 3.7) < 0.12 ? 0.1 : 1;
    if (b.eyeO) b.eyeO.scale.set(closed || happy ? HIDE : 1, closed || happy ? HIDE : blink, 1);
    if (b.eyeC) b.eyeC.scale.setScalar(closed ? 1 : HIDE);
    if (b.eyeH) b.eyeH.scale.setScalar(happy ? 1 : HIDE);
    if (b.mouth) {
      const m = c[MOUTH];
      if (this.P.beak) b.mouth.rotation.x = m * 0.45;
      else b.mouth.scale.set(m > 0.05 ? 0.6 + 0.4 * m : HIDE, Math.max(HIDE, m), 1);
    }
    if (this.P.extra) this.P.extra(this, t, c);
  }
}

/* ================================================================ 脸：眼睛（睁 / 闭 / 笑）、嘴、腮红 */
const EYE = 0x2b2230, MOUTHC = 0x5a3640, ORAL = 0x9a3e52, TONGUE = 0xff8fa3, PINK = 0xff9fb8;
function addFace(k, e, o) {
  const { ex, ey, erx, ery } = o;
  const zf = e.c[2] + front(e, 0, ey)[2];
  k.bone("eyeO", "head", [0, ey, zf]).bone("eyeC", "head", [0, ey, zf]).bone("eyeH", "head", [0, ey, zf]);
  const eyeCol = o.eyeColor ?? EYE;
  for (const s of [-1, 1]) {
    const ee = o.eyeE ? o.eyeE(s) : e, d = o.eyeE ? [0, o.eyeDy || 0, 1] : front(e, s * ex, ey), spin = (o.tilt || 0) * s;
    k.decal(ee, d, ellG(erx, ery), eyeCol, "eyeO", { lift: 0.006, spin });
    if (o.iris) k.decal(ee, d, ellG(erx * 0.62, ery * 0.42, 0, -ery * 0.42), o.iris, "eyeO", { lift: 0.009, spin });
    k.decal(ee, d, ellG(erx * 0.4, erx * 0.4, erx * 0.3, ery * 0.36), 0xffffff, "eyeO", { lift: 0.012, spin });
    k.decal(ee, d, ellG(erx * 0.17, erx * 0.17, -erx * 0.3, -ery * 0.4), 0xffffff, "eyeO", { lift: 0.012, spin });
    // 睡着：‿
    k.decal(ee, d, arcG(erx * 0.85, erx * 0.34, Math.PI + 0.35, Math.PI - 0.7, 0, ery * 0.25), eyeCol, "eyeC", { lift: 0.006, spin });
    // 开心：∩（^ ^）
    k.decal(ee, d, arcG(erx * 0.85, erx * 0.36, 0.3, Math.PI - 0.6, 0, -ery * 0.3), eyeCol, "eyeH", { lift: 0.006, spin });
  }
  // 腮红：脸色和粉色调一调（不透明，省一层透明排序）
  if (o.bx) for (const s of [-1, 1]) k.decal(e, front(e, s * o.bx, o.by), ellG(o.brx || 0.06, o.bry || 0.035), blend(o.skin ?? 0xffffff, o.blushC ?? PINK, 0.6), "head", { lift: 0.004 });
  // 嘴
  if (o.my != null) {
    const mw = o.mw || 0.03, md = front(e, 0, o.my), mz = e.c[2] + md[2];
    const mc = o.mouthC ?? MOUTHC;
    if (o.mouth === "w") k.decal(e, md, joinG(arcG(mw * 0.5, mw * 0.28, Math.PI, Math.PI, -mw * 0.5, 0, 8), arcG(mw * 0.5, mw * 0.28, Math.PI, Math.PI, mw * 0.5, 0, 8)), mc, "head", { lift: 0.005 });
    else if (o.mouth === "smile") k.decal(e, md, arcG(mw, mw * 0.28, Math.PI + 0.45, Math.PI - 0.9, 0, mw * 0.6, 14), mc, "head", { lift: 0.005 });
    if (o.open !== false) {
      k.bone("mouth", "head", [0, o.my - mw * 0.3, mz]);
      k.decal(e, md, ellG(mw * 0.85, mw * 0.95, 0, -mw * 0.3), ORAL, "mouth", { lift: 0.008 });
      k.decal(e, md, ellG(mw * 0.55, mw * 0.4, 0, -mw * 0.8), TONGUE, "mouth", { lift: 0.01 });
    }
  }
}

/* ================================================================ 宠物 */
export const PET_LOOKS = {
  seal: { name: "小海豹", variants: [
    { name: "奶白", fur: 0xf7f5ef, muzzle: 0xffffff, flip: 0xdedad0, nose: 0x3b2c30 },
    { name: "灰灰", fur: 0xc3cad6, muzzle: 0xeef1f6, flip: 0xa4adbb, nose: 0x3b2c30 },
    { name: "芝麻", fur: 0xf1e8da, muzzle: 0xfffaf2, flip: 0xd6cab6, nose: 0x3b2c30, spot: 0x9a918b },
    { name: "极光", shiny: true, fur: 0xc4ecff, fur2: 0xe6d4ff, muzzle: 0xf6fbff, flip: 0x9cc8f4, nose: 0x36406e, accent: 0x8ffff0 },
  ] },
  bunny: { name: "小兔", variants: [
    { name: "奶白", fur: 0xfffaf4, belly: 0xffffff, inner: 0xffc2d3, nose: 0xff8fae, tail: 0xffffff },
    { name: "灰灰", fur: 0xc9c3cb, belly: 0xf1edf0, inner: 0xf6bfd0, nose: 0xe57f9f, tail: 0xf6f3f5 },
    { name: "焦糖", fur: 0xe3b07e, belly: 0xfbe8d2, inner: 0xffc6c9, nose: 0xe9839a, tail: 0xfff4e6 },
    { name: "樱花", shiny: true, fur: 0xffd2e4, fur2: 0xfff2f8, belly: 0xfff6fa, inner: 0xff79b6, nose: 0xff6fa5, tail: 0xffffff, accent: 0xffe27a },
  ] },
  hedgehog: { name: "小刺猬", variants: [
    { name: "栗子", spike: 0x8a5f45, tip: 0xc89a74, face: 0xfbe6cc, nose: 0x3b2a26 },
    { name: "奶茶", spike: 0xb08a6c, tip: 0xe6cdb0, face: 0xfff1e0, nose: 0x4a3530 },
    { name: "可可", spike: 0x5e4438, tip: 0x9a7a66, face: 0xf3dcc4, nose: 0x2e2220 },
    { name: "星光", shiny: true, spike: 0x7d6fc4, tip: 0xc9bbff, face: 0xfdf0ff, nose: 0x3a2f5c, accent: 0xfff27a },
  ] },
  fawn: { name: "小鹿", variants: [
    { name: "小栗", fur: 0xcf9561, belly: 0xfbead6, spot: 0xfffaf0, inner: 0xffcfbf, nose: 0x3b2a26, hoof: 0x6e4c3a },
    { name: "奶咖", fur: 0xdcb891, belly: 0xfff4e6, spot: 0xffffff, inner: 0xffd6c8, nose: 0x4a3530, hoof: 0x8a6650 },
    { name: "可可", fur: 0x9c6b4c, belly: 0xf0d9c0, spot: 0xf8ead8, inner: 0xf4b9a8, nose: 0x2e2220, hoof: 0x4e3428 },
    { name: "月光", shiny: true, fur: 0xe9e6ff, fur2: 0xcfe6ff, belly: 0xffffff, spot: 0x8ff3ff, inner: 0xffd2ec, nose: 0x5a5288, hoof: 0x8a86b8, accent: 0x9ff6ff },
  ] },
  arcticfox: { name: "北极狐", variants: [
    { name: "雪白", fur: 0xfbfcff, chest: 0xffffff, inner: 0xffc9d6, tip: 0xe9eef8, nose: 0x3b2c30 },
    { name: "银灰", fur: 0xc9d0dc, chest: 0xf3f5fa, inner: 0xf4c0ce, tip: 0xffffff, nose: 0x34303a },
    { name: "岩灰", fur: 0x9e938b, chest: 0xe6ddd4, inner: 0xe8b6b0, tip: 0xf2ece6, nose: 0x2e2620 },
    { name: "冰晶", shiny: true, fur: 0xdaf3ff, fur2: 0xb9e4ff, chest: 0xffffff, inner: 0xb8f0ff, tip: 0x7fe9ff, nose: 0x2f4a6e, accent: 0x7ff0ff },
  ] },
  salamander: { name: "小火蜥", variants: [
    { name: "橘子", body: 0xff9a4f, belly: 0xffdc82, spot: 0xffe9a6, crest: 0xf0583f, flame: 0xffa52e, flame2: 0xfff07a },
    { name: "樱桃", body: 0xf2655a, belly: 0xffc98e, spot: 0xffe0b0, crest: 0xc73a3a, flame: 0xff8a2a, flame2: 0xffe36a },
    { name: "蜜桃", body: 0xffa58c, belly: 0xffe6b5, spot: 0xfff2d8, crest: 0xf06c64, flame: 0xffb03a, flame2: 0xfff4a0 },
    { name: "蓝焰", shiny: true, body: 0x5ac8e8, belly: 0xc9f6ff, spot: 0xeaffff, crest: 0x3a7fd6, flame: 0x52b8ff, flame2: 0xd8fbff, accent: 0xb0f4ff },
  ] },
  starpuff: { name: "星星团子", variants: [
    { name: "柠檬", body: 0xffe57a, edge: 0xffc94a, glow: 0xffd45a, cheek: 0xffa3a3 },
    { name: "樱花", body: 0xffcfe3, edge: 0xff9fc6, glow: 0xff9fcf, cheek: 0xff7fa8 },
    { name: "薄荷", body: 0xc4f5dd, edge: 0x8fe0bd, glow: 0x8fffd0, cheek: 0xff9fb8 },
    { name: "银河", shiny: true, body: 0xb6b2ff, edge: 0x7f8dff, glow: 0xa98bff, cheek: 0xff9fe0, accent: 0xfff6a8 },
  ] },
  axolotl: { name: "六角恐龙", variants: [
    { name: "樱粉", body: 0xffc4d2, belly: 0xffe6ec, gill: 0xff6f9a, fin: 0xffd9e3 },
    { name: "奶白", body: 0xfcf3ef, belly: 0xffffff, gill: 0xff8fae, fin: 0xfff6f2 },
    { name: "芒果", body: 0xffdc9a, belly: 0xfff2d2, gill: 0xff9a6a, fin: 0xffeab8 },
    { name: "星空", shiny: true, body: 0x6f7ee6, fur2: 0x9a74e0, belly: 0xb9c2ff, gill: 0x7ffff0, fin: 0x9aa8ff, accent: 0xfff6a8 },
  ] },
  duckling: { name: "小黄鸭", variants: [
    { name: "小黄", down: 0xffe06a, wing: 0xffd04a, bill: 0xff9a3c, feet: 0xff9a3c },
    { name: "奶白", down: 0xfff7e2, wing: 0xf2e6c8, bill: 0xffa04a, feet: 0xffa04a },
    { name: "麦芽", down: 0xd9c29a, wing: 0xb89f78, bill: 0xf2924a, feet: 0xf2924a },
    { name: "晚霞", shiny: true, down: 0xffb3c8, fur2: 0xffd88a, wing: 0xff8fb6, bill: 0xffc24a, feet: 0xffb04a, accent: 0xfff2a0 },
  ] },
};

// 闪光色：身体按高度从 fur → fur2 渐变
const furGrad = (v, base, lo = 0.1, hi = 0.9) => (v.fur2 ? (p) => mix(base, v.fur2, (p.y - lo) / (hi - lo)) : base);
// 肚皮色：正面偏下的地方渐变成浅色
const bellyMix = (base, belly, c, r, zk = 0.35, yTop = 0.7) => (p, n) => {
  const t = sstep(zk, zk + 0.35, n.z) * (1 - sstep(c[1] + r[1] * (yTop - 0.5), c[1] + r[1] * yTop, p.y));
  return typeof base === "function" ? _ca.copy(base(p, n)).lerp(_cb.setHex(belly), t) : mix(base, belly, t);
};
// 闪光色额头上的小亮星
function shinyMark(k, e, v, y) { if (v.shiny) k.decal(e, front(e, 0, y), sparkG(0.05), v.accent, "head", { lift: 0.008 }); }

const PET = {
  seal(k, v) {
    k.bone("body", null, [0, 0.3, 0]).bone("head", "body", [0, 0.42, 0.1])
      .bone("armL", "body", [-0.26, 0.2, 0.12]).bone("armR", "body", [0.26, 0.2, 0.12]).bone("tail", "body", [0, 0.14, -0.48]);
    const fur = furGrad(v, v.fur, 0, 0.9);
    const BE = { c: [0, 0.28, -0.08], r: [0.34, 0.28, 0.4] };
    k.ball(BE.c, BE.r, bellyMix(fur, v.muzzle, BE.c, BE.r, 0.2, 0.55), "body", { ws: 24, hs: 16 });
    k.ball([0, 0.15, -0.42], [0.2, 0.14, 0.2], fur, "body");
    if (v.spot) for (const d of [[0.6, 0.6, -0.3], [-0.5, 0.75, -0.5], [0.2, 0.9, -0.6], [-0.75, 0.3, 0.1], [0.8, 0.25, -0.65]]) k.decal(BE, d, ellG(0.04, 0.032), v.spot, "body", { layer: "main", out: false });
    if (v.shiny) for (const d of [[0.5, 0.7, -0.3], [-0.45, 0.8, -0.5], [0.1, 0.95, -0.65]]) k.decal(BE, d, sparkG(0.055), v.accent, "body", { lift: 0.008 });
    for (const s of [-1, 1]) {
      k.ball([s * 0.1, 0.07, -0.62], [0.1, 0.03, 0.075], v.flip, "tail", { rot: [0, s * 0.6, s * 0.15] });
      k.ball([s * 0.35, 0.09, 0.15], [0.11, 0.035, 0.08], v.flip, s < 0 ? "armL" : "armR", { rot: [0, -s * 0.35, s * 0.5] });
    }
    const HE = { c: [0, 0.6, 0.12], r: [0.32, 0.29, 0.29] };
    k.ball(HE.c, HE.r, fur, "head", { ws: 26, hs: 18 });
    for (const s of [-1, 1]) {
      const pc = [s * 0.06, 0.5, 0.375], pr = [0.07, 0.056, 0.05];
      k.ball(pc, pr, v.muzzle, "head");
      for (const [dx, dy] of [[0.35, 0.2], [0.6, -0.15], [0.25, -0.4]]) k.decal({ c: pc, r: pr }, [s * dx, dy, 1], ellG(0.008, 0.008, 0, 0, 8), 0x9a8a88, "head", { lift: 0.003 });
    }
    k.ball([0, 0.55, 0.41], [0.036, 0.026, 0.024], v.nose, "head", { out: false });
    addFace(k, HE, { ex: 0.135, ey: 0.63, erx: 0.06, ery: 0.074, skin: v.fur, bx: 0.205, by: 0.535, brx: 0.055, bry: 0.032, my: 0.452, mw: 0.026, mouth: "smile" });
    shinyMark(k, HE, v, 0.78);
    return { S: 0.27, prof: { gait: "slide", step: 7, tail: 0.6, ear: 0, drop: 0.0, sleepHx: 0.38, happyArm: 0.9 } };
  },

  bunny(k, v) {
    k.bone("body", null, [0, 0.27, 0]).bone("head", "body", [0, 0.42, 0.02])
      .bone("earL", "head", [-0.12, 0.86, -0.02]).bone("earR", "head", [0.12, 0.86, -0.02]).bone("tail", "body", [0, 0.24, -0.27])
      .bone("legFL", "body", [-0.12, 0.13, 0.13]).bone("legFR", "body", [0.12, 0.13, 0.13]).bone("legBL", "body", [-0.17, 0.12, -0.06]).bone("legBR", "body", [0.17, 0.12, -0.06]);
    const fur = furGrad(v, v.fur, 0.1, 1.2);
    const BE = { c: [0, 0.26, -0.02], r: [0.26, 0.24, 0.25] };
    k.ball(BE.c, BE.r, bellyMix(fur, v.belly, BE.c, BE.r, 0.3, 0.75), "body");
    for (const s of [-1, 1]) {
      k.ball([s * 0.11, 0.055, 0.16], [0.065, 0.055, 0.075], fur, s < 0 ? "legFL" : "legFR");
      k.ball([s * 0.17, 0.05, 0.0], [0.075, 0.05, 0.13], fur, s < 0 ? "legBL" : "legBR");
    }
    k.ball([0, 0.27, -0.29], 0.085, v.shiny ? v.accent : v.tail, "tail", v.shiny ? { layer: "face" } : {});
    const HE = { c: [0, 0.62, 0.02], r: [0.35, 0.3, 0.3] };
    k.ball(HE.c, HE.r, fur, "head", { ws: 26, hs: 18 });
    // 耳朵：左耳竖着，右耳软软地往外耷拉（垂耳兔的一半）
    for (const s of [-1, 1]) {
      const bone = s < 0 ? "earL" : "earR", lop = s > 0;
      const rot = lop ? [0.1, 0, -1.05] : [-0.12, 0, 0.18];
      const base = [s * 0.12, 0.86, -0.02];
      const m = mat4(base, rot, 1);
      const at = (x, y, z) => V(x, y, z).applyMatrix4(m).toArray();
      k.ball(at(0, 0.2, 0), [0.075, 0.23, 0.05], fur, bone, { rot });
      k.ball(at(0, 0.2, 0.03), [0.042, 0.16, 0.025], v.inner, bone, { rot, out: false, layer: v.shiny ? "face" : "main" });
    }
    for (const s of [-1, 1]) k.ball([s * 0.07, 0.52, 0.28], [0.075, 0.06, 0.05], v.belly, "head", { out: false });
    addFace(k, HE, { ex: 0.145, ey: 0.63, erx: 0.058, ery: 0.072, skin: v.fur, bx: 0.235, by: 0.53, my: 0.5, mw: 0.026, mouth: "w" });
    k.decal(HE, front(HE, 0, 0.555), ellG(0.032, 0.022), v.nose, "head", { lift: 0.03 });
    shinyMark(k, HE, v, 0.79);
    return { S: 0.205, prof: { gait: "hop", tail: 0.4, ear: 1, drop: 0.07, happyArm: 0 } };
  },

  hedgehog(k, v) {
    k.bone("body", null, [0, 0.32, 0]).bone("head", "body", [0, 0.32, 0.12])
      .bone("earL", "head", [-0.17, 0.5, 0.2]).bone("earR", "head", [0.17, 0.5, 0.2])
      .bone("legFL", "body", [-0.14, 0.1, 0.14]).bone("legFR", "body", [0.14, 0.1, 0.14]).bone("legBL", "body", [-0.15, 0.1, -0.14]).bone("legBR", "body", [0.15, 0.1, -0.14]);
    const BE = { c: [0, 0.35, -0.05], r: [0.38, 0.33, 0.37] };
    k.ball(BE.c, BE.r, (p, n) => mix(v.spike, v.face, sstep(0.1, 0.5, n.z) * sstep(-0.05, -0.5, n.y)), "body", { ws: 24, hs: 16 });
    // 背上的刺：绕着「往后上方」的轴一圈一圈排，软软的圆锥，根部深、尖尖浅
    const up = V(0, 1, 0), m = new THREE.Matrix4(), q = new THREE.Quaternion();
    const ax = V(0, 0.55, -1).normalize(), e1 = V(1, 0, 0), e2 = V().crossVectors(ax, e1).normalize();
    let cnt = 0;
    for (let ring = 0; ring <= 6; ring++) {
      const al = (ring / 6) * 1.45, num = ring ? Math.round((TAU * Math.sin(al)) / 0.36) : 1;
      for (let j = 0; j < num; j++) {
        const be = (j / num) * TAU + ring * 0.4;
        const d = ax.clone().multiplyScalar(Math.cos(al)).addScaledVector(e1, Math.sin(al) * Math.cos(be)).addScaledVector(e2, Math.sin(al) * Math.sin(be));
        if (d.y < -0.32 || (d.z > 0.12 && d.y < 0.45)) continue;
        const tt = 1 / Math.sqrt((d.x / BE.r[0]) ** 2 + (d.y / BE.r[1]) ** 2 + (d.z / BE.r[2]) ** 2);
        const p = V(...BE.c).addScaledVector(d, tt);
        const nn = V((p.x - BE.c[0]) / BE.r[0] ** 2, (p.y - BE.c[1]) / BE.r[1] ** 2, (p.z - BE.c[2]) / BE.r[2] ** 2).normalize();
        nn.lerp(ax, 0.3).normalize(); // 刺顺着往后倒
        q.setFromUnitVectors(up, nn);
        const h = 0.15;
        m.compose(p.clone().addScaledVector(nn, h * 0.25), q, V(1, 1, 1));
        const g = new THREE.ConeGeometry(0.068, h, 6);
        g.applyMatrix4(m);
        const base = p.clone();
        k.add(g, { color: (pp) => mix(v.spike, v.tip, (pp.distanceTo(base) - 0.03) / (h * 0.7)), bone: "body" });
        if (v.shiny && cnt++ % 3 === 0) k.ball(p.clone().addScaledVector(nn, h * 0.78).toArray(), 0.022, v.accent, "body", { layer: "face", ws: 6, hs: 4 });
      }
    }
    const HE = { c: [0, 0.33, 0.2], r: [0.27, 0.24, 0.21] };
    k.ball(HE.c, HE.r, v.face, "head", { ws: 22, hs: 16 });
    k.ball([0, 0.29, 0.4], [0.085, 0.07, 0.09], v.face, "head");
    k.ball([0, 0.305, 0.49], 0.035, v.nose, "head", { out: false });
    for (const s of [-1, 1]) {
      k.ball([s * 0.19, 0.51, 0.2], [0.06, 0.06, 0.035], v.face, s < 0 ? "earL" : "earR", { rot: [0, 0, s * 0.3] });
      k.ball([s * 0.19, 0.51, 0.225], [0.035, 0.035, 0.015], blend(v.face, PINK, 0.5), s < 0 ? "earL" : "earR", { rot: [0, 0, s * 0.3], out: false });
      k.ball([s * 0.15, 0.05, 0.16], [0.055, 0.05, 0.065], v.face, s < 0 ? "legFL" : "legFR");
      k.ball([s * 0.16, 0.05, -0.13], [0.055, 0.05, 0.065], v.face, s < 0 ? "legBL" : "legBR");
    }
    addFace(k, HE, { ex: 0.11, ey: 0.37, erx: 0.05, ery: 0.062, skin: v.face, bx: 0.17, by: 0.28, brx: 0.045, bry: 0.028, my: 0.215, mw: 0.022, mouth: "smile" });
    shinyMark(k, HE, v, 0.49);
    return { S: 0.265, prof: { gait: "trot", step: 13, tail: 0, ear: 0.6, drop: 0.05, sleepHx: 0.45, happyArm: 0 } };
  },

  fawn(k, v) {
    k.bone("body", null, [0, 0.36, 0]).bone("head", "body", [0, 0.5, 0.14])
      .bone("earL", "head", [-0.2, 0.8, 0.1]).bone("earR", "head", [0.2, 0.8, 0.1]).bone("tail", "body", [0, 0.42, -0.27])
      .bone("legFL", "body", [-0.1, 0.27, 0.13]).bone("legFR", "body", [0.1, 0.27, 0.13]).bone("legBL", "body", [-0.1, 0.27, -0.15]).bone("legBR", "body", [0.1, 0.27, -0.15]);
    const fur = furGrad(v, v.fur, 0.2, 1.0);
    const BE = { c: [0, 0.37, -0.01], r: [0.2, 0.16, 0.27] };
    k.ball(BE.c, BE.r, (p, n) => (typeof fur === "function" ? _ca.copy(fur(p)) : _ca.setHex(fur)).lerp(_cb.setHex(v.belly), sstep(-0.1, -0.6, n.y)), "body", { ws: 22, hs: 14 });
    for (const d of [[0.55, 0.75, 0.1], [-0.55, 0.75, 0.1], [0.5, 0.7, -0.45], [-0.5, 0.7, -0.45], [0.1, 1, -0.25], [-0.15, 0.95, 0.35], [0.8, 0.45, -0.15], [-0.8, 0.45, -0.15]])
      k.decal(BE, d, ellG(0.03, 0.03), v.spot, "body", v.shiny ? { lift: 0.006 } : { layer: "main", out: false });
    for (const [n, x, z] of [["legFL", -0.1, 0.13], ["legFR", 0.1, 0.13], ["legBL", -0.1, -0.15], ["legBR", 0.1, -0.15]]) {
      k.stick([x, 0.3, z], [x, 0.07, z], 0.042, fur, n);
      k.ball([x, 0.045, z + 0.01], [0.05, 0.045, 0.055], v.hoof, n);
    }
    k.ball([0, 0.45, -0.31], [0.05, 0.07, 0.04], v.belly, "tail", { rot: [-0.6, 0, 0] });
    k.ball([0, 0.47, 0.11], [0.085, 0.13, 0.085], fur, "head", { rot: [0.35, 0, 0] });
    const HE = { c: [0, 0.68, 0.16], r: [0.27, 0.24, 0.24] };
    k.ball(HE.c, HE.r, fur, "head", { ws: 24, hs: 16 });
    k.ball([0, 0.6, 0.35], [0.12, 0.085, 0.1], v.belly, "head");
    k.ball([0, 0.635, 0.44], [0.035, 0.025, 0.022], v.nose, "head", { out: false });
    for (const s of [-1, 1]) {
      const bone = s < 0 ? "earL" : "earR", rot = [0, s * -0.3, s * -0.45];
      k.ball([s * 0.33, 0.83, 0.1], [0.14, 0.055, 0.04], fur, bone, { rot });
      k.ball([s * 0.33, 0.83, 0.13], [0.09, 0.03, 0.015], v.inner, bone, { rot, out: false });
      // 头顶两个小鹿角包
      k.ball([s * 0.09, 0.9, 0.12], [0.03, 0.04, 0.03], blend(v.fur, 0x6e4c3a, 0.35), "head");
    }
    for (const [x, y] of [[-0.06, 0.82], [0.07, 0.84]]) k.decal(HE, front(HE, x, y), ellG(0.022, 0.022), v.spot, "head", v.shiny ? {} : { layer: "main", out: false });
    addFace(k, HE, { ex: 0.12, ey: 0.69, erx: 0.055, ery: 0.07, skin: v.fur, bx: 0.19, by: 0.6, brx: 0.045, bry: 0.028, my: 0.565, mw: 0.022, mouth: "w" });
    shinyMark(k, HE, v, 0.77);
    return { S: 0.285, prof: { gait: "trot", step: 10, tail: 1, ear: 1, drop: 0.13, happyArm: 0 } };
  },

  arcticfox(k, v) {
    k.bone("body", null, [0, 0.26, 0]).bone("head", "body", [0, 0.44, 0.04])
      .bone("earL", "head", [-0.16, 0.8, 0.0]).bone("earR", "head", [0.16, 0.8, 0.0]).bone("tail", "body", [0, 0.2, -0.26])
      .bone("legFL", "body", [-0.11, 0.12, 0.12]).bone("legFR", "body", [0.11, 0.12, 0.12]).bone("legBL", "body", [-0.14, 0.12, -0.12]).bone("legBR", "body", [0.14, 0.12, -0.12]);
    const fur = furGrad(v, v.fur, 0.0, 1.0);
    k.ball([0, 0.25, -0.03], [0.23, 0.21, 0.26], fur, "body");
    k.ball([0, 0.32, 0.13], [0.16, 0.15, 0.12], v.chest, "body");
    for (const s of [-1, 1]) {
      k.ball([s * 0.11, 0.06, 0.15], [0.06, 0.065, 0.07], fur, s < 0 ? "legFL" : "legFR");
      k.ball([s * 0.15, 0.06, -0.1], [0.065, 0.06, 0.085], fur, s < 0 ? "legBL" : "legBR");
    }
    // 大尾巴：从身后绕到右边、往上翘，正面也看得见；尖尖是浅色
    const tailC = [[0.1, 0.15, -0.32, 0.1, 0.09, 0.12], [0.22, 0.2, -0.24, 0.125, 0.115, 0.125], [0.3, 0.31, -0.1, 0.11, 0.115, 0.105]];
    tailC.forEach(([x, y, z, a, b, c], i) => k.ball([x, y, z], [a, b, c], i === 2 ? v.tip : fur, "tail", i === 2 && v.shiny ? { layer: "face" } : {}));
    const HE = { c: [0, 0.6, 0.03], r: [0.31, 0.25, 0.26] };
    k.ball(HE.c, HE.r, fur, "head", { ws: 26, hs: 18 });
    for (const s of [-1, 1]) {
      for (const [y, rz, sc] of [[0.53, 0.5, 0.85], [0.46, 0.95, 0.7]]) k.cone([s * 0.29, y, 0.06], 0.065, 0.16, fur, "head", { rot: [0, 0, -s * (Math.PI / 2 + rz - 0.4)], scl: [sc, sc, sc * 0.7] });
      const bone = s < 0 ? "earL" : "earR";
      k.cone([s * 0.2, 0.9, -0.02], 0.125, 0.29, fur, bone, { rot: [-0.08, 0, s * -0.36], scl: [1, 1, 0.5] });
      k.cone([s * 0.195, 0.88, 0.012], 0.078, 0.19, v.inner, bone, { rot: [-0.08, 0, s * -0.36], scl: [1, 1, 0.4], out: false, layer: v.shiny ? "face" : "main" });
    }
    // 尖尖的小狐狸嘴
    k.ball([0, 0.525, 0.25], [0.1, 0.072, 0.15], v.chest, "head", { rot: [0.12, 0, 0] });
    k.ball([0, 0.54, 0.395], [0.034, 0.026, 0.024], v.nose, "head", { out: false });
    addFace(k, HE, { ex: 0.13, ey: 0.62, erx: 0.054, ery: 0.068, skin: v.fur, bx: 0.215, by: 0.53, brx: 0.05, bry: 0.03, tilt: -0.15 });
    shinyMark(k, HE, v, 0.75);
    return { S: 0.245, prof: { gait: "trot", step: 11, tail: 1, ear: 1, drop: 0.06, happyArm: 0 } };
  },

  salamander(k, v) {
    k.bone("body", null, [0, 0.2, 0]).bone("head", "body", [0, 0.3, 0.1]).bone("tail", "body", [0, 0.2, -0.32]).bone("flame", "tail", [0.4, 0.31, -0.24])
      .bone("legFL", "body", [-0.16, 0.12, 0.06]).bone("legFR", "body", [0.16, 0.12, 0.06]).bone("legBL", "body", [-0.16, 0.12, -0.22]).bone("legBR", "body", [0.16, 0.12, -0.22]);
    const BE = { c: [0, 0.21, -0.1], r: [0.2, 0.16, 0.27] };
    k.ball(BE.c, BE.r, (p, n) => mix(v.body, v.belly, sstep(-0.1, -0.5, n.y)), "body");
    for (const [n, s, z] of [["legFL", -1, 0.07], ["legFR", 1, 0.07], ["legBL", -1, -0.22], ["legBR", 1, -0.22]]) {
      k.ball([s * 0.2, 0.06, z], [0.085, 0.05, 0.07], v.body, n, { rot: [0, 0, s * 0.45] });
      for (const dz of [-0.035, 0, 0.035]) k.ball([s * 0.27, 0.025, z + dz + 0.02], 0.022, v.body, n, { out: false, ws: 8, hs: 6 });
    }
    k.ball([0.05, 0.17, -0.42], [0.11, 0.085, 0.13], v.body, "tail", { rot: [0, 0.4, 0] });
    k.ball([0.18, 0.17, -0.45], [0.085, 0.07, 0.09], v.body, "tail", { rot: [0, 1.2, 0] });
    k.ball([0.3, 0.2, -0.37], [0.06, 0.056, 0.07], v.body, "tail");
    k.ball([0.37, 0.26, -0.27], [0.045, 0.05, 0.045], v.body, "tail");
    // 尾巴尖的小火苗（不受光，看起来在发光）
    k.add(smooth(new THREE.SphereGeometry(1, 12, 10).translate(0, 0.25, 0)).applyMatrix4(mat4([0.4, 0.31, -0.24], [0, 0, 0], [0.065, 0.1, 0.065])),
      { color: (p) => mix(v.flame2, v.flame, (p.y - 0.29) / 0.12), bone: "flame", layer: "face" });
    k.cone([0.4, 0.415, -0.24], 0.045, 0.09, v.flame, "flame", { layer: "face", seg: 8 });
    const HE = { c: [0, 0.4, 0.15], r: [0.33, 0.24, 0.27] };
    k.ball(HE.c, HE.r, (p, n) => mix(v.body, v.belly, sstep(-0.3, -0.8, n.y)), "head", { ws: 26, hs: 16 });
    // 头顶一串小火焰冠
    for (const [z, y, r] of [[0.2, 0.64, 0.065], [0.07, 0.625, 0.058], [-0.04, 0.58, 0.048]]) k.ball([0, y, z], [0.04, r * 1.3, r], v.crest, "head", { rot: [-0.35, 0, 0] });
    for (const [x, y] of [[-0.2, 0.5], [0.22, 0.48], [0.17, 0.55]]) k.decal(HE, front(HE, x, y), ellG(0.022, 0.022), v.spot, "head", v.shiny ? { lift: 0.006 } : { layer: "main", out: false });
    for (const d of [[0.5, 0.8, -0.4], [-0.5, 0.8, -0.2], [0.3, 0.9, 0.2]]) k.decal(BE, d, ellG(0.03, 0.03), v.spot, "body", v.shiny ? { color: v.accent } : { layer: "main", out: false });
    addFace(k, HE, { ex: 0.135, ey: 0.44, erx: 0.06, ery: 0.074, skin: v.body, bx: 0.23, by: 0.35, brx: 0.05, bry: 0.03, my: 0.315, mw: 0.04, mouth: "smile" });
    shinyMark(k, HE, v, 0.57);
    return {
      S: 0.31,
      prof: { gait: "crawl", step: 10, tail: 1, ear: 0, drop: 0.04, sleepHx: 0.2, happyArm: 0,
        extra(a, t) { const f = a.b.flame; if (f) f.scale.set(1 + 0.12 * Math.sin(t * 17), 1 + 0.22 * Math.sin(t * 13 + 1), 1); } },
    };
  },

  starpuff(k, v) {
    const C = [0, 0.5, 0], R = 0.34, ZK = 0.62;
    const lobes = { earL: Math.PI / 2, armR: Math.PI / 2 - TAU / 5, armL: Math.PI / 2 + TAU / 5, legL: Math.PI / 2 + (2 * TAU) / 5, legR: Math.PI / 2 - (2 * TAU) / 5 };
    k.bone("body", null, C).bone("head", "body", C);
    for (const [n, a] of Object.entries(lobes)) k.bone(n, "head", [C[0] + Math.cos(a) * R * 0.75, C[1] + Math.sin(a) * R * 0.75, 0]);
    // 圆滚滚的五角星：球的赤道一圈按角度往外推出五个圆角
    const g = new THREE.SphereGeometry(1, 48, 28);
    g.rotateX(Math.PI / 2);
    const P = g.attributes.position;
    for (let i = 0; i < P.count; i++) {
      const x = P.getX(i), y = P.getY(i), z = P.getZ(i), rho = Math.hypot(x, y), th = Math.atan2(y, x);
      const pk = ((Math.cos(5 * (th - Math.PI / 2)) + 1) / 2) ** 2.2;
      const f = 1 + 0.5 * pk * rho * rho;
      P.setXYZ(i, C[0] + x * R * f, C[1] + y * R * f, z * R * ZK * (1 - 0.18 * pk * rho * rho));
    }
    const star = smooth(g);
    const names = Object.keys(lobes), idx = names.map((n) => k.idx[n]), hi = k.idx.head;
    const skin = (p) => {
      const x = p.x - C[0], y = p.y - C[1], th = Math.atan2(y, x), r = Math.hypot(x, y);
      let best = 0, bw = 0;
      names.forEach((n, j) => { const w = sstep(0.55, 0.95, Math.cos(th - lobes[n])) * sstep(R * 0.7, R * 1.15, r); if (w > bw) { bw = w; best = j; } });
      return [hi, idx[best], bw];
    };
    const body = (p) => mix(v.body, v.edge, sstep(R * 0.75, R * 1.5, Math.hypot(p.x - C[0], p.y - C[1])));
    k.add(star, { color: body, skin });
    const HE = { c: C, r: [R, R, R * ZK] };
    addFace(k, HE, { ex: 0.1, ey: 0.535, erx: 0.05, ery: 0.064, skin: v.body, bx: 0.175, by: 0.47, brx: 0.045, bry: 0.027, blushC: v.cheek, my: 0.455, mw: 0.026, mouth: "smile" });
    if (v.shiny) for (const [x, y, s] of [[-0.2, 0.68, 0.035], [0.22, 0.36, 0.03], [0.05, 0.72, 0.025], [-0.24, 0.38, 0.025]]) k.decal(HE, front(HE, x, y), sparkG(s), v.accent, "head", { lift: 0.008 });
    return { S: 0.26, glow: v.glow, prof: { gait: "float", tail: 0, ear: 0.4, float: true, sleepHx: 0.25, eatHx: 0.3, happyArm: 0.9, armK: 0.35 } };
  },

  axolotl(k, v) {
    k.bone("body", null, [0, 0.2, 0]).bone("head", "body", [0, 0.3, 0.08])
      .bone("earL", "head", [-0.28, 0.45, 0.1]).bone("earR", "head", [0.28, 0.45, 0.1]).bone("tail", "body", [0, 0.2, -0.33])
      .bone("legFL", "body", [-0.16, 0.12, 0.04]).bone("legFR", "body", [0.16, 0.12, 0.04]).bone("legBL", "body", [-0.15, 0.12, -0.22]).bone("legBR", "body", [0.15, 0.12, -0.22]);
    const body = v.fur2 ? (p) => mix(v.body, v.fur2, -p.z * 1.5) : v.body;
    const BE = { c: [0, 0.2, -0.12], r: [0.2, 0.15, 0.27] };
    k.ball(BE.c, BE.r, (p, n) => (typeof body === "function" ? _ca.copy(body(p)) : _ca.setHex(body)).lerp(_cb.setHex(v.belly), sstep(-0.1, -0.6, n.y)), "body");
    k.ball([0, 0.33, -0.22], [0.025, 0.06, 0.17], v.fin, "body", { out: false });
    k.ball([0, 0.23, -0.5], [0.045, 0.13, 0.2], v.fin, "tail");
    k.ball([0, 0.2, -0.42], [0.09, 0.09, 0.14], body, "tail");
    for (const [n, s, z] of [["legFL", -1, 0.05], ["legFR", 1, 0.05], ["legBL", -1, -0.22], ["legBR", 1, -0.22]]) k.ball([s * 0.2, 0.06, z], [0.07, 0.04, 0.05], body, n, { rot: [0, 0, s * 0.5] });
    const HE = { c: [0, 0.38, 0.14], r: [0.36, 0.24, 0.28] };
    k.ball(HE.c, HE.r, (p, n) => (typeof body === "function" ? _ca.copy(body(p)) : _ca.setHex(body)).lerp(_cb.setHex(v.belly), sstep(-0.3, -0.8, n.y)), "head", { ws: 28, hs: 16 });
    // 腮：两边各三根羽毛状的小枝（挂在 ear 骨头上一起摆）
    for (const s of [-1, 1]) {
      const bone = s < 0 ? "earL" : "earR", base = [s * 0.29, 0.45, 0.1];
      [[0.25, 0.2], [0.95, 0.19], [1.6, 0.17]].forEach(([a, len], j) => {
        const dir = V(s * Math.sin(a), Math.cos(a), -0.15).normalize();
        const end = V(...base).addScaledVector(dir, len);
        k.stick(base, end.toArray(), 0.026, v.gill, bone, v.shiny ? { layer: "face" } : {});
        for (let f = 1; f <= 3; f++) {
          const p = V(...base).addScaledVector(dir, (len * f) / 3.4);
          k.ball([p.x + s * 0.005, p.y - 0.022, p.z + 0.012], [0.026, 0.02, 0.018], v.gill, bone, v.shiny ? { layer: "face", ws: 8, hs: 6 } : { out: j !== 9, ws: 8, hs: 6 });
        }
      });
    }
    addFace(k, HE, { ex: 0.165, ey: 0.42, erx: 0.048, ery: 0.058, skin: v.body, bx: 0.25, by: 0.34, brx: 0.05, bry: 0.03, my: 0.31, mw: 0.075, mouth: "smile" });
    if (v.shiny) for (const d of [[0.4, 0.9, -0.3], [-0.5, 0.8, -0.1], [0.1, 1, 0.2], [-0.2, 0.9, -0.6]]) k.decal(BE, d, ellG(0.022, 0.022), v.accent, "body", { lift: 0.006 });
    shinyMark(k, HE, v, 0.55);
    return { S: 0.33, prof: { gait: "crawl", step: 9, tail: 1, ear: 1, drop: 0.04, sleepHx: 0.2, happyArm: 0 } };
  },

  duckling(k, v) {
    k.bone("body", null, [0, 0.28, 0]).bone("head", "body", [0, 0.52, 0.05]).bone("tail", "body", [0, 0.34, -0.28])
      .bone("armL", "body", [-0.27, 0.38, 0]).bone("armR", "body", [0.27, 0.38, 0]).bone("legL", "body", [-0.11, 0.1, 0.04]).bone("legR", "body", [0.11, 0.1, 0.04]);
    const down = furGrad(v, v.down, 0.1, 1.0);
    k.ball([0, 0.28, -0.02], [0.3, 0.27, 0.31], down, "body", { ws: 22, hs: 16 });
    k.cone([0, 0.38, -0.33], 0.075, 0.15, down, "tail", { rot: [-1.15, 0, 0] });
    for (const s of [-1, 1]) {
      const bone = s < 0 ? "armL" : "armR";
      k.ball([s * 0.3, 0.27, -0.02], [0.06, 0.13, 0.15], (p) => (v.shiny ? mix(v.wing, v.accent, (0.24 - p.y) / 0.1) : v.wing), bone, { rot: [0.2, 0, s * 0.3] });
      const leg = s < 0 ? "legL" : "legR";
      k.ball([s * 0.11, 0.06, 0.04], [0.035, 0.05, 0.035], v.feet, leg, { out: false });
      k.ball([s * 0.11, 0.02, 0.11], [0.075, 0.022, 0.08], v.feet, leg);
    }
    const HE = { c: [0, 0.67, 0.06], r: [0.25, 0.24, 0.24] };
    k.ball(HE.c, HE.r, down, "head", { ws: 24, hs: 16 });
    for (const [rz, h] of [[-0.45, 0.1], [0, 0.13], [0.45, 0.1]]) k.cone([Math.sin(rz) * 0.04, 0.93, 0.04], 0.028, h, v.shiny ? v.accent : v.down, "head", v.shiny ? { rot: [0, 0, -rz], layer: "face" } : { rot: [0, 0, -rz] });
    // 扁扁的嘴（下半片挂在 mouth 骨头上，开心 / 吃东西时张开）
    k.ball([0, 0.61, 0.29], [0.11, 0.035, 0.085], v.bill, "head", { rot: [0.15, 0, 0] });
    k.bone("mouth", "head", [0, 0.585, 0.23]);
    k.ball([0, 0.583, 0.28], [0.09, 0.025, 0.07], blend(v.bill, 0x8a3a2a, 0.25), "mouth", { rot: [0.1, 0, 0] });
    addFace(k, HE, { ex: 0.1, ey: 0.7, erx: 0.052, ery: 0.064, skin: v.down, bx: 0.165, by: 0.6, brx: 0.045, bry: 0.028 });
    shinyMark(k, HE, v, 0.83);
    return { S: 0.235, prof: { gait: "waddle", step: 10, tail: 0.5, ear: 0, drop: 0.05, beak: true, happyArm: 1.1, sleepHx: 0.35 } };
  },
};

const PET_SPECS = new Map();
function petSpec(species, vi) {
  const key = species + ":" + vi;
  if (PET_SPECS.has(key)) return PET_SPECS.get(key);
  const v = PET_LOOKS[species].variants[vi];
  const k = new Kit();
  const r = PET[species](k, v);
  const spec = { ...bakeKit(k, r.S), prof: r.prof, glow: r.glow, shiny: !!v.shiny, v };
  PET_SPECS.set(key, spec);
  return spec;
}
const PET_STATES = [SI.idle, SI.walk, SI.hop, SI.sleep, SI.eat, SI.happy];
const PET_LINE = 0.008;

// 闪光色：身边绕着转的三颗小星星（一个 Points，一次绘制）
function addSparkles(parent, h, color) {
  const n = 3, geo = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  geo.boundingSphere = new THREE.Sphere(V(0, h * 0.6, 0), h * 1.5);
  const pts = new THREE.Points(geo, sparkMat());
  pts.raycast = () => {};
  parent.add(pts);
  const base = new THREE.Color(color);
  return (t) => {
    for (let i = 0; i < n; i++) {
      const a = t * 0.9 + (i * TAU) / n, r = h * (0.62 + 0.12 * Math.sin(t * 1.3 + i));
      pos[i * 3] = Math.cos(a) * r; pos[i * 3 + 1] = h * (0.45 + 0.35 * Math.sin(t * 0.7 + i * 2.1)); pos[i * 3 + 2] = Math.sin(a) * r;
      const tw = Math.max(0, Math.sin(t * 3.1 + i * 2.4)) ** 2;
      col[i * 3] = base.r * tw; col[i * 3 + 1] = base.g * tw; col[i * 3 + 2] = base.b * tw;
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
  };
}

// variant：0..3 的序号，或者颜色名（"奶白" / "樱花" …）
export function buildPet(species, variant = 0, { toon, outlined }) {
  const look = PET_LOOKS[species];
  if (!look) throw new Error("unknown pet " + species);
  let vi = typeof variant === "number" ? variant : look.variants.findIndex((x) => x.name === variant);
  if (!(vi >= 0 && vi < look.variants.length)) vi = 0;
  const spec = petSpec(species, vi);
  const mats = {
    main: spec.glow ? vcMat(toon, "glow" + spec.glow, { emissive: spec.glow, emissiveIntensity: 0.38 }) : vcMat(toon),
    line: lineMat(outlined, PET_LINE),
  };
  const inst = instantiate(spec, mats);
  const anim = new Anim(inst, spec.prof, spec.S, PET_STATES);
  let halo = null, spark = null;
  if (spec.glow) {
    halo = new THREE.Sprite(haloMat(spec.glow));
    halo.scale.setScalar(spec.S * 1.6);
    halo.position.y = spec.S * 0.5;
    halo.raycast = () => {};
    inst.rig.add(halo);
  }
  if (spec.shiny) spark = addSparkles(inst.root, spec.S, spec.v.accent);
  const { root } = inst;
  root.userData.variant = vi;
  root.userData.shiny = spec.shiny;
  tagAll(root, "pet", species);
  return {
    root, species, variant: vi, shiny: spec.shiny, height: spec.S,
    update(t, dt, state = "idle") {
      anim.update(t, dt, state);
      if (halo) halo.scale.setScalar(spec.S * (1.55 + 0.12 * Math.sin(t * 2.3)));
      if (spark) spark(t);
    },
  };
}

/* ================================================================ 访客 */
export const VISITOR_LOOKS = {
  gull: { name: "海鸥船长" }, tortoise: { name: "龟爷爷" }, otter: { name: "水獭小哥" }, bear: { name: "熊妈妈" },
  frog: { name: "青蛙诗人" }, squirrel: { name: "松鼠邮差" }, piglet: { name: "小猪厨师" }, owl: { name: "猫头鹰博士" },
};

// 访客通用骨架：身体 / 头 / 两只手 / 两条腿（单位尺寸：高约 1）
function biped(k, o = {}) {
  const hy = o.neck ?? 0.5, sy = o.shoulder ?? 0.42, sx = o.sx ?? 0.22;
  k.bone("body", null, [0, 0.3, 0]).bone("head", "body", [0, hy, 0.0])
    .bone("armL", "body", [-sx, sy, 0.02]).bone("armR", "body", [sx, sy, 0.02])
    .bone("legL", "body", [-0.1, 0.14, 0.0]).bone("legR", "body", [0.1, 0.14, 0.0]);
}
function limbs(k, col, o = {}) {
  const sx = o.sx ?? 0.22, sy = o.shoulder ?? 0.42, al = o.armLen ?? 0.12;
  for (const s of [-1, 1]) {
    if (!o.noArms) k.ball([s * (sx + 0.035), sy - al * 0.8, 0.03], [0.062, al, 0.062], o.arm ?? col, s < 0 ? "armL" : "armR", { rot: [0, 0, s * 0.22] });
    k.ball([s * 0.1, 0.06, 0.03], o.foot || [0.08, 0.065, 0.095], o.feet ?? col, s < 0 ? "legL" : "legR");
  }
}

const VIS = {
  gull(k) {
    biped(k, { neck: 0.5, sx: 0.23 });
    const W = 0xfbfbf8, GR = 0xbac4ce, NAVY = 0x3a5683, GOLD = 0xffcf4a, BEAK = 0xffc44a, FEET = 0xffa25a;
    const BE = { c: [0, 0.3, 0], r: [0.22, 0.25, 0.21] };
    k.ball(BE.c, BE.r, W, "body", { ws: 22, hs: 16 });
    // 海军蓝小外套（前面敞开一道 V）
    k.ball(BE.c, BE.r.map((x) => x * 1.04), NAVY, "body", { ws: 24, hs: 14, part: [Math.PI / 2 + 0.42, TAU - 0.84, 0.95, Math.PI - 0.95] });
    for (const [s, y] of [[-1, 0.32], [1, 0.32], [-1, 0.2], [1, 0.2]]) k.ball([s * 0.095, y, 0.21], 0.018, GOLD, "body", { out: false, ws: 8, hs: 6 });
    for (const s of [-1, 1]) {
      const bone = s < 0 ? "armL" : "armR";
      k.ball([s * 0.25, 0.3, -0.01], [0.06, 0.15, 0.11], (p) => mix(GR, 0x56606c, (0.24 - p.y) / 0.09), bone, { rot: [0.1, 0, s * 0.2] });
      k.stick([s * 0.09, 0.12, 0.02], [s * 0.09, 0.03, 0.04], 0.022, FEET, s < 0 ? "legL" : "legR", { out: false });
      k.ball([s * 0.09, 0.02, 0.08], [0.07, 0.022, 0.085], FEET, s < 0 ? "legL" : "legR");
    }
    k.cone([0, 0.18, -0.22], 0.08, 0.14, GR, "body", { rot: [-1.9, 0, 0], scl: [1, 1, 0.5] });
    const HE = { c: [0, 0.7, 0.0], r: [0.27, 0.25, 0.25] };
    k.ball(HE.c, HE.r, W, "head", { ws: 24, hs: 18 });
    // 嘴：上半片在头上，下半片挂在 mouth 骨头上（说话时一张一合）
    k.cone([0, 0.655, 0.3], 0.065, 0.17, BEAK, "head", { rot: [Math.PI / 2 + 0.25, 0, 0], scl: [1.1, 1, 0.55] });
    k.bone("mouth", "head", [0, 0.64, 0.2]);
    k.cone([0, 0.625, 0.28], 0.05, 0.12, blend(BEAK, 0xd08a2a, 0.3), "mouth", { rot: [Math.PI / 2 + 0.1, 0, 0], scl: [1, 1, 0.45] });
    // 船长帽：白帽顶 + 蓝帽箍 + 黑帽檐 + 金徽章
    k.cyl([0, 0.925, -0.015], 0.215, 0.2, 0.09, W, "head", { rot: [-0.12, 0, 0] });
    k.ball([0, 0.975, -0.02], [0.245, 0.06, 0.245], W, "head", { rot: [-0.12, 0, 0] });
    k.cyl([0, 0.895, -0.01], 0.206, 0.206, 0.045, NAVY, "head", { rot: [-0.12, 0, 0], out: false });
    k.cyl([0, 0.875, 0.13], 0.17, 0.17, 0.018, 0x2b3445, "head", { rot: [-0.05, 0, 0], theta: [-1.2, 2.4] });
    k.ball([0, 0.905, 0.205], [0.035, 0.035, 0.012], GOLD, "head", { out: false, rot: [-0.12, 0, 0] });
    addFace(k, HE, { ex: 0.1, ey: 0.73, erx: 0.048, ery: 0.06, skin: W, bx: 0.165, by: 0.64, brx: 0.045, bry: 0.026 });
    // 两撇灰眉毛（老船长）
    for (const s of [-1, 1]) k.decal(HE, front(HE, s * 0.11, 0.81), ellG(0.045, 0.014), 0x8a929c, "head", { spin: s * -0.25, lift: 0.006 });
    return { S: 0.5, prof: { gait: "biped", tail: 0.3, ear: 0, beak: true } };
  },

  tortoise(k) {
    biped(k, { neck: 0.5, sx: 0.22 });
    const SK = 0xa6cf8c, SH = 0xb98a58, PL = 0xdcb27c, RIM = 0x8e6a45, BELLY = 0xf1e0b2, WOOD = 0x9a6a43, GL = 0x5a3d2b;
    k.ball([0, 0.3, 0.02], [0.21, 0.24, 0.19], BELLY, "body", { ws: 20, hs: 14 });
    for (const y of [0.22, 0.32, 0.42]) k.decal({ c: [0, 0.3, 0.02], r: [0.21, 0.24, 0.19] }, front({ c: [0, 0.3, 0.02], r: [0.21, 0.24, 0.19] }, 0, y), rectG(0.16, 0.012), blend(BELLY, RIM, 0.35), "body", { layer: "main", out: false });
    // 背上的壳：一个往后偏的大椭球，正面边缘深一点，上面一圈六边形的浅色甲片
    const SE = { c: [0, 0.33, -0.09], r: [0.27, 0.3, 0.21] };
    k.ball(SE.c, SE.r, (p, n) => mix(SH, RIM, sstep(0.1, 0.6, n.z)), "body", { ws: 24, hs: 16 });
    k.decal(SE, [0, 0.15, -1], new THREE.CircleGeometry(0.085, 6), PL, "body", { layer: "main", out: false, lift: 0.004 });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      k.decal(SE, [Math.cos(a) * 0.75, 0.15 + Math.sin(a) * 0.7, -0.75], new THREE.CircleGeometry(0.06, 6), PL, "body", { layer: "main", out: false, lift: 0.004, spin: 0.5 });
    }
    k.decal(SE, [0, 1, -0.2], new THREE.CircleGeometry(0.07, 6), PL, "body", { layer: "main", out: false, lift: 0.004 });
    limbs(k, SK, { sx: 0.22 });
    k.ball([0, 0.12, -0.27], [0.04, 0.035, 0.06], SK, "body");
    const HE = { c: [0, 0.69, 0.03], r: [0.26, 0.23, 0.23] };
    k.ball(HE.c, HE.r, SK, "head", { ws: 24, hs: 18 });
    // 白眉毛 + 小白胡子
    for (const s of [-1, 1]) k.ball([s * 0.105, 0.815, 0.2], [0.065, 0.026, 0.035], 0xffffff, "head", { rot: [0, 0, s * -0.3] });
    k.cone([0, 0.5, 0.2], 0.05, 0.1, 0xffffff, "head", { rot: [Math.PI + 0.35, 0, 0] });
    // 圆眼镜
    for (const s of [-1, 1]) {
      const d = front(HE, s * 0.1, 0.71), p = V(...HE.c).add(V(...d));
      k.torus([p.x, p.y, p.z + 0.035], 0.07, 0.011, GL, "head", { rot: [0, s * 0.35, 0], out: false, rs: 5, ts: 18 });
    }
    k.stick([-0.035, 0.725, 0.265], [0.035, 0.725, 0.265], 0.008, GL, "head", { out: false });
    addFace(k, HE, { ex: 0.1, ey: 0.705, erx: 0.042, ery: 0.05, skin: SK, bx: 0.18, by: 0.62, brx: 0.045, bry: 0.026, my: 0.6, mw: 0.03, mouth: "smile" });
    // 拐杖（右手）
    k.stick([0.3, 0.26, 0.1], [0.33, 0.01, 0.14], 0.016, WOOD, "armR");
    k.torus([0.27, 0.27, 0.1], 0.035, 0.016, WOOD, "armR", { arc: Math.PI, rot: [0, 0, 0.1], rs: 5, ts: 10 });
    return { S: 0.47, prof: { gait: "biped", step: 6, tail: 0.3, ear: 0, lean: 0.08, holdR: true, waveArm: "L" } };
  },

  otter(k) {
    biped(k, { neck: 0.5, sx: 0.21 });
    const BR = 0x9b6b4a, CR = 0xf0dcc0, DK = 0x7a5238, NOSE = 0x3d2a24, SHELL = 0xffb6a8, SHD = 0xff8a80;
    const BE = { c: [0, 0.3, 0], r: [0.21, 0.26, 0.19] };
    k.ball(BE.c, BE.r, bellyMix(BR, CR, BE.c, BE.r, 0.35, 0.85), "body", { ws: 22, hs: 16 });
    k.ball([0, 0.12, -0.25], [0.075, 0.055, 0.17], BR, "body", { rot: [0.35, 0, 0] });
    limbs(k, BR, { sx: 0.21, feet: DK, noArms: true });
    // 右手垂着；左手抱着贝壳放在胸前
    k.ball([0.245, 0.33, 0.03], [0.058, 0.115, 0.058], BR, "armR", { rot: [0, 0, 0.22] });
    k.ball([-0.13, 0.37, 0.15], [0.055, 0.1, 0.055], BR, "armL", { rot: [-1.0, 0, -0.9] });
    const SC = [-0.02, 0.38, 0.235];
    k.ball(SC, [0.085, 0.075, 0.03], SHELL, "armL", { rot: [-0.2, 0, 0.15] });
    for (const a of [-0.9, -0.45, 0, 0.45, 0.9]) k.box([SC[0] + Math.sin(a) * 0.035, SC[1] + Math.cos(a) * 0.03, SC[2] + 0.026], [0.012, 0.075, 0.01], SHD, "armL", { rot: [-0.2, 0, -a + 0.15], out: false });
    k.ball([SC[0] + 0.01, SC[1] - 0.07, SC[2]], [0.03, 0.018, 0.02], SHD, "armL");
    k.ball([0.0, 0.33, 0.24], [0.048, 0.04, 0.04], BR, "armL");
    const HE = { c: [0, 0.69, 0.0], r: [0.27, 0.23, 0.24] };
    k.ball(HE.c, HE.r, BR, "head", { ws: 24, hs: 18 });
    k.ball([0, 0.62, 0.17], [0.15, 0.095, 0.1], CR, "head");
    k.ball([0, 0.665, 0.265], [0.04, 0.028, 0.022], NOSE, "head", { out: false });
    for (const s of [-1, 1]) {
      k.ball([s * 0.22, 0.83, -0.01], [0.05, 0.05, 0.03], BR, s < 0 ? "head" : "head");
      for (const [dx, dy] of [[0.5, 0.25], [0.7, -0.05]]) k.decal({ c: [0, 0.62, 0.17], r: [0.15, 0.095, 0.1] }, [s * dx, dy, 0.8], ellG(0.009, 0.009, 0, 0, 8), 0x8a6a58, "head", { lift: 0.003 });
    }
    addFace(k, HE, { ex: 0.1, ey: 0.73, erx: 0.045, ery: 0.056, skin: BR, bx: 0.18, by: 0.66, brx: 0.04, bry: 0.024 });
    k.bone("mouth", "head", [0, 0.585, 0.26]);
    k.decal({ c: [0, 0.62, 0.17], r: [0.15, 0.095, 0.1] }, [0, -0.45, 1], arcG(0.022, 0.008, Math.PI + 0.4, Math.PI - 0.8, 0, 0.012), MOUTHC, "head", { lift: 0.004 });
    k.decal({ c: [0, 0.62, 0.17], r: [0.15, 0.095, 0.1] }, [0, -0.55, 1], ellG(0.022, 0.024), ORAL, "mouth", { lift: 0.006 });
    return { S: 0.5, prof: { gait: "biped", tail: 0.8, ear: 0, holdL: true, waveArm: "R" } };
  },

  bear(k) {
    biped(k, { neck: 0.54, sx: 0.27, shoulder: 0.46 });
    const FUR = 0xc98f5c, MZ = 0xf3dcc0, AP = 0xffa8c5, FR = 0xffffff, NOSE = 0x4a2f2a;
    const BE = { c: [0, 0.32, 0], r: [0.27, 0.28, 0.24] };
    k.ball(BE.c, BE.r, FUR, "body", { ws: 24, hs: 16 });
    // 围裙：前面一片稍大的弧面 + 胸前小围兜 + 下摆一圈白色荷叶边 + 心形小口袋
    const AR = BE.r.map((x) => x * 1.035);
    k.ball(BE.c, AR, AP, "body", { ws: 24, hs: 14, part: [Math.PI / 2 - 0.95, 1.9, 1.35, 1.25] });
    k.ball(BE.c, AR, AP, "body", { ws: 12, hs: 8, part: [Math.PI / 2 - 0.55, 1.1, 0.72, 0.7] });
    for (let i = 0; i <= 8; i++) {
      const ph = Math.PI / 2 - 0.92 + (i / 8) * 1.84, th = 2.6;
      const x = -Math.cos(ph) * Math.sin(th) * AR[0], z = Math.sin(ph) * Math.sin(th) * AR[2], y = BE.c[1] + Math.cos(th) * AR[1];
      k.ball([x * 1.04, y, z * 1.04], 0.03, FR, "body", { out: false, ws: 8, hs: 6 });
    }
    for (const s of [-1, 1]) k.stick([s * 0.1, 0.5, 0.17], [s * 0.18, 0.56, -0.05], 0.016, AP, "body", { out: false });
    k.decal({ c: BE.c, r: AR }, front({ c: BE.c, r: AR }, 0.06, 0.24), heartG(0.045), FR, "body", { layer: "main", out: false, lift: 0.004 });
    limbs(k, FUR, { sx: 0.27, shoulder: 0.46, armLen: 0.13, foot: [0.09, 0.07, 0.1] });
    const HE = { c: [0, 0.75, 0], r: [0.3, 0.26, 0.27] };
    k.ball(HE.c, HE.r, FUR, "head", { ws: 26, hs: 18 });
    for (const s of [-1, 1]) {
      k.ball([s * 0.22, 0.95, -0.02], [0.085, 0.085, 0.05], FUR, "head");
      k.ball([s * 0.22, 0.95, 0.01], [0.05, 0.05, 0.03], MZ, "head", { out: false });
    }
    k.ball([0, 0.665, 0.2], [0.12, 0.085, 0.09], MZ, "head");
    k.ball([0, 0.7, 0.285], [0.04, 0.028, 0.025], NOSE, "head", { out: false });
    // 耳边一朵小花
    for (let i = 0; i < 5; i++) { const a = (i / 5) * TAU; k.ball([0.29 + Math.cos(a) * 0.03, 0.9 + Math.sin(a) * 0.03, 0.08], 0.024, 0xffd1e0, "head", { out: false, ws: 8, hs: 6 }); }
    k.ball([0.29, 0.9, 0.095], 0.018, 0xffd54a, "head", { out: false, ws: 8, hs: 6 });
    addFace(k, HE, { ex: 0.115, ey: 0.79, erx: 0.045, ery: 0.056, skin: FUR, bx: 0.2, by: 0.69, brx: 0.05, bry: 0.028, my: 0.625, mw: 0.028, mouth: "w" });
    return { S: 0.53, prof: { gait: "biped", step: 7, tail: 0.2, ear: 0 } };
  },

  frog(k) {
    biped(k, { neck: 0.47, sx: 0.22, shoulder: 0.38 });
    const G = 0x8fd16f, BELLY = 0xeaf6c8, BER = 0xb5475f, SC = 0xf2c14e, BOOK = 0x5a8fd6;
    const BE = { c: [0, 0.27, 0], r: [0.23, 0.23, 0.2] };
    k.ball(BE.c, BE.r, bellyMix(G, BELLY, BE.c, BE.r, 0.3, 0.8), "body", { ws: 22, hs: 16 });
    limbs(k, G, { sx: 0.22, shoulder: 0.38, noArms: true, foot: [0.09, 0.03, 0.11] });
    // 右手垂着；左手捧着小诗集
    k.ball([0.255, 0.27, 0.03], [0.058, 0.11, 0.058], G, "armR", { rot: [0, 0, 0.22] });
    k.ball([-0.15, 0.3, 0.14], [0.052, 0.09, 0.052], G, "armL", { rot: [-1.1, 0, -0.7] });
    k.box([-0.03, 0.3, 0.23], [0.15, 0.17, 0.035], BOOK, "armL", { rot: [-0.25, 0.25, 0.1] });
    k.box([-0.026, 0.3, 0.226], [0.135, 0.155, 0.036], 0xfffaf0, "armL", { rot: [-0.25, 0.25, 0.1], out: false });
    k.box([-0.03, 0.3, 0.24], [0.15, 0.17, 0.012], BOOK, "armL", { rot: [-0.25, 0.25, 0.1], out: false });
    k.ball([-0.08, 0.27, 0.25], [0.04, 0.035, 0.035], G, "armL");
    const HE = { c: [0, 0.6, 0.0], r: [0.31, 0.21, 0.25] };
    k.ball(HE.c, HE.r, (p, n) => mix(G, BELLY, sstep(-0.4, -0.9, n.y)), "head", { ws: 26, hs: 16 });
    // 头顶两个眼包，眼睛长在上面
    const EB = { c: [0, 0.77, 0.07], r: [0.25, 0.1, 0.11] };
    for (const s of [-1, 1]) k.ball([s * 0.14, 0.77, 0.07], [0.11, 0.1, 0.11], G, "head");
    // 围巾：脖子一圈 + 垂下来的一截
    k.torus([0, 0.45, 0.0], 0.19, 0.045, SC, "body", { rot: [Math.PI / 2, 0, 0], scl: [1, 1, 0.92], ts: 24 });
    k.ball([0.1, 0.34, 0.19], [0.05, 0.1, 0.02], SC, "body", { rot: [0.25, 0, 0.2] });
    for (let i = 0; i < 3; i++) k.box([0.07 + i * 0.022, 0.235, 0.215], [0.012, 0.03, 0.01], 0xfff2c8, "body", { rot: [0.25, 0, 0.2], out: false });
    // 贝雷帽（斜戴）
    k.ball([0.05, 0.84, -0.09], [0.22, 0.06, 0.2], BER, "head", { rot: [-0.25, 0, -0.28] });
    k.cyl([0.08, 0.905, -0.1], 0.012, 0.016, 0.04, BER, "head", { rot: [-0.25, 0, -0.28], out: false });
    // 眼睛：每只眼包正面一只
    k.bone("eyeO", "head", [0, 0.78, 0.17]).bone("eyeC", "head", [0, 0.78, 0.17]).bone("eyeH", "head", [0, 0.78, 0.17]);
    for (const s of [-1, 1]) {
      const e = { c: [s * 0.14, 0.77, 0.07], r: [0.11, 0.1, 0.11] }, d = [0, 0.1, 1];
      k.decal(e, d, ellG(0.05, 0.06), EYE, "eyeO", { lift: 0.006 });
      k.decal(e, d, ellG(0.02, 0.02, 0.015, 0.022), 0xffffff, "eyeO", { lift: 0.012 });
      k.decal(e, d, ellG(0.008, 0.008, -0.015, -0.024), 0xffffff, "eyeO", { lift: 0.012 });
      k.decal(e, d, arcG(0.042, 0.017, Math.PI + 0.35, Math.PI - 0.7, 0, 0.015), EYE, "eyeC", { lift: 0.006 });
      k.decal(e, d, arcG(0.042, 0.018, 0.3, Math.PI - 0.6, 0, -0.018), EYE, "eyeH", { lift: 0.006 });
    }
    void EB;
    for (const s of [-1, 1]) k.decal(HE, front(HE, s * 0.21, 0.58), ellG(0.05, 0.028), blend(G, PINK, 0.6), "head", { lift: 0.004 });
    // 大大的笑嘴
    k.decal(HE, front(HE, 0, 0.56), arcG(0.12, 0.016, Math.PI + 0.55, Math.PI - 1.1, 0, 0.07, 18), 0x3f6a34, "head", { lift: 0.005 });
    k.bone("mouth", "head", [0, 0.51, HE.c[2] + front(HE, 0, 0.51)[2]]);
    k.decal(HE, front(HE, 0, 0.51), ellG(0.045, 0.035), ORAL, "mouth", { lift: 0.008 });
    k.decal(HE, front(HE, 0, 0.51), ellG(0.03, 0.016, 0, -0.016), TONGUE, "mouth", { lift: 0.01 });
    return { S: 0.5, prof: { gait: "biped", step: 8, tail: 0, ear: 0, holdL: true, waveArm: "R" } };
  },

  squirrel(k) {
    biped(k, { neck: 0.49, sx: 0.21 });
    k.bone("tail", "body", [0, 0.16, -0.17]);
    const FUR = 0xd9884a, CR = 0xf8e4c6, DK = 0xa8602f, BAG = 0x6fa36b, FLAP = 0x58895a, STRAP = 0x8a5a3a;
    const BE = { c: [0, 0.29, 0], r: [0.21, 0.25, 0.19] };
    k.ball(BE.c, BE.r, bellyMix(FUR, CR, BE.c, BE.r, 0.35, 0.85), "body", { ws: 22, hs: 16 });
    limbs(k, FUR, { sx: 0.21, feet: DK });
    // 蓬松大尾巴：四段往上卷到脑袋后面，尖端浅色
    [[0.08, 0.2, -0.3, 0.13, 0.13, 0.12], [0.18, 0.42, -0.38, 0.165, 0.16, 0.13], [0.24, 0.66, -0.32, 0.15, 0.14, 0.12], [0.2, 0.83, -0.2, 0.1, 0.1, 0.09]]
      .forEach(([x, y, z, a, b, c], i) => k.ball([x, y, z], [a, b, c], i === 3 ? blend(FUR, CR, 0.6) : FUR, "tail"));
    // 斜挎邮包：背带一圈 + 右胯上的包 + 露出半截的信
    k.torus([0, 0.32, 0.0], 0.215, 0.016, STRAP, "body", { rot: [Math.PI / 2, 0.75, 0], scl: [1, 0.94, 1], out: false, ts: 28 });
    k.box([0.19, 0.18, 0.11], [0.17, 0.14, 0.07], BAG, "body", { rot: [0, 0.55, 0] });
    k.box([0.195, 0.215, 0.118], [0.175, 0.075, 0.075], FLAP, "body", { rot: [0, 0.55, 0], out: false });
    k.ball([0.225, 0.19, 0.16], [0.02, 0.02, 0.008], 0xffd54a, "body", { rot: [0, 0.55, 0], out: false, ws: 8, hs: 6 });
    k.box([0.15, 0.27, 0.095], [0.1, 0.07, 0.008], 0xffffff, "body", { rot: [0, 0.55, 0.15] });
    k.ball([0.152, 0.272, 0.105], [0.016, 0.014, 0.006], 0xff5d73, "body", { rot: [0, 0.55, 0], out: false, ws: 8, hs: 6 });
    const HE = { c: [0, 0.68, 0.01], r: [0.27, 0.24, 0.24] };
    k.ball(HE.c, HE.r, FUR, "head", { ws: 24, hs: 18 });
    for (const s of [-1, 1]) {
      k.ball([s * 0.125, 0.6, 0.175], [0.07, 0.055, 0.05], CR, "head");
      k.cone([s * 0.15, 0.92, -0.02], 0.065, 0.15, (p) => mix(FUR, DK, (p.y - 0.9) / 0.06), "head", { rot: [0, 0, -s * 0.25], scl: [1, 1, 0.6] });
    }
    k.ball([0, 0.65, 0.245], [0.032, 0.024, 0.02], 0x4a2f2a, "head", { out: false });
    addFace(k, HE, { ex: 0.11, ey: 0.71, erx: 0.047, ery: 0.058, skin: FUR, bx: 0.19, by: 0.63, brx: 0.04, bry: 0.024, my: 0.6, mw: 0.022, mouth: "w" });
    return { S: 0.5, prof: { gait: "biped", step: 10, tail: 0.8, ear: 0 } };
  },

  piglet(k) {
    biped(k, { neck: 0.5, sx: 0.23 });
    k.bone("tail", "body", [0, 0.22, -0.2]);
    const PK = 0xffc2cc, SN = 0xff9fb0, NOS = 0x9a4a5e, W = 0xffffff, RED = 0xff6b6b, WOOD = 0xc8915f;
    const BE = { c: [0, 0.3, 0], r: [0.24, 0.25, 0.21] };
    k.ball(BE.c, BE.r, PK, "body", { ws: 22, hs: 16 });
    limbs(k, PK, { sx: 0.23, feet: blend(PK, 0x9a4a5e, 0.25) });
    k.torus([0, 0.25, -0.24], 0.035, 0.012, PK, "tail", { arc: Math.PI * 1.6, rot: [0, Math.PI / 2, 0], rs: 5, ts: 14 });
    // 红领巾 + 前面一个小结
    k.torus([0, 0.47, 0.0], 0.17, 0.03, RED, "body", { rot: [Math.PI / 2, 0, 0], ts: 24 });
    k.cone([0, 0.4, 0.17], 0.06, 0.11, RED, "body", { rot: [Math.PI + 0.3, 0, 0], scl: [1, 1, 0.4] });
    // 右手拿着木勺
    k.stick([0.27, 0.24, 0.07], [0.3, 0.46, 0.13], 0.012, WOOD, "armR");
    k.ball([0.305, 0.5, 0.14], [0.04, 0.05, 0.02], WOOD, "armR", { rot: [0.3, 0, -0.1] });
    const HE = { c: [0, 0.68, 0.0], r: [0.29, 0.25, 0.25] };
    k.ball(HE.c, HE.r, PK, "head", { ws: 26, hs: 18 });
    k.cyl([0, 0.62, 0.25], 0.085, 0.09, 0.07, SN, "head", { rot: [Math.PI / 2 - 0.1, 0, 0], scl: [1, 1, 0.78] });
    for (const s of [-1, 1]) k.ball([s * 0.032, 0.623, 0.287], [0.016, 0.022, 0.01], NOS, "head", { out: false, ws: 8, hs: 6 });
    for (const s of [-1, 1]) k.cone([s * 0.19, 0.88, 0.05], 0.08, 0.14, PK, "head", { rot: [0.5, 0, -s * 0.7], scl: [1, 1, 0.45] });
    // 厨师帽：帽箍 + 蓬蓬的帽顶
    k.cyl([0, 0.9, -0.02], 0.185, 0.18, 0.11, W, "head", { rot: [-0.1, 0, 0] });
    k.add(smooth(mergeGeometries([[0, 1.05, -0.03, 0.15], [-0.1, 1.0, -0.02, 0.11], [0.1, 1.0, -0.02, 0.11], [0, 1.0, 0.08, 0.11], [0, 1.0, -0.12, 0.11]]
      .map(([x, y, z, r]) => new THREE.SphereGeometry(r, 14, 10).translate(x, y, z)), false)), { color: W, bone: "head", m: mat4([0, 0, 0], [-0.1, 0, 0]) });
    addFace(k, HE, { ex: 0.12, ey: 0.73, erx: 0.045, ery: 0.056, skin: PK, bx: 0.2, by: 0.62, brx: 0.05, bry: 0.028, my: 0.535, mw: 0.026, mouth: "smile", blushC: 0xff7f9a });
    return { S: 0.46, prof: { gait: "biped", step: 9, tail: 0.6, ear: 0 } };
  },

  owl(k) {
    biped(k, { neck: 0.55, sx: 0.25, shoulder: 0.5 });
    k.bone("tail", "head", [0.19, 1.03, 0.11]); // 学士帽的流苏，挂在头上一起甩
    const BR = 0xa98468, CH = 0xefdcc0, CHV = 0xc9a882, DISC = 0xf5e6cc, BEAK = 0xf2a64a, BLK = 0x34303d, GOLD = 0xffcf4a;
    const BE = { c: [0, 0.34, 0], r: [0.26, 0.31, 0.23] };
    k.ball(BE.c, BE.r, bellyMix(BR, CH, BE.c, BE.r, 0.4, 0.8), "body", { ws: 24, hs: 16 });
    for (const [x, y] of [[-0.06, 0.38], [0.06, 0.38], [0, 0.3], [-0.08, 0.24], [0.08, 0.24], [0, 0.18]]) k.decal(BE, front(BE, x, y), arcG(0.028, 0.012, Math.PI + 0.5, Math.PI - 1.0, 0, 0.012, 8), CHV, "body", { layer: "main", out: false });
    for (const s of [-1, 1]) {
      k.ball([s * 0.27, 0.36, -0.01], [0.07, 0.17, 0.13], (p) => mix(BR, 0x7a5c48, (0.3 - p.y) / 0.12), s < 0 ? "armL" : "armR", { rot: [0.1, 0, s * 0.18] });
      k.ball([s * 0.09, 0.03, 0.1], [0.065, 0.03, 0.06], BEAK, s < 0 ? "legL" : "legR");
    }
    const HE = { c: [0, 0.75, 0], r: [0.3, 0.25, 0.25] };
    k.ball(HE.c, HE.r, BR, "head", { ws: 26, hs: 18 });
    for (const s of [-1, 1]) {
      k.ball([s * 0.11, 0.75, 0.17], [0.13, 0.13, 0.07], DISC, "head", { out: false });
      k.cone([s * 0.2, 0.95, 0.02], 0.05, 0.12, BR, "head", { rot: [0, 0, -s * 0.5], scl: [1, 1, 0.6] });
    }
    k.cone([0, 0.68, 0.25], 0.035, 0.08, BEAK, "head", { rot: [Math.PI - 0.5, 0, 0], scl: [1, 1, 0.7] });
    addFace(k, HE, { eyeE: (s) => ({ c: [s * 0.11, 0.75, 0.17], r: [0.13, 0.13, 0.07] }), eyeDy: 0.05, ex: 0.11, ey: 0.76, erx: 0.06, ery: 0.064, iris: 0xd9963a, skin: DISC, bx: 0.2, by: 0.68, brx: 0.04, bry: 0.022 });
    // 单片眼镜（右眼）+ 小链子
    k.torus([0.11, 0.765, 0.255], 0.072, 0.011, GOLD, "head", { rot: [0, 0.3, 0], out: false, rs: 5, ts: 20 });
    k.stick([0.165, 0.715, 0.245], [0.2, 0.55, 0.2], 0.005, GOLD, "head", { out: false });
    // 学士帽：帽身 + 方板（斜成菱形朝前）+ 顶扣 + 流苏
    k.cyl([0, 0.97, -0.02], 0.17, 0.19, 0.08, BLK, "head");
    k.box([0, 1.02, -0.02], [0.34, 0.025, 0.34], BLK, "head", { rot: [0, Math.PI / 4, 0] });
    k.ball([0, 1.04, -0.02], [0.025, 0.012, 0.025], GOLD, "head", { out: false });
    k.stick([0.19, 1.03, 0.11], [0.2, 0.93, 0.12], 0.007, GOLD, "tail", { out: false });
    k.cone([0.2, 0.9, 0.12], 0.02, 0.05, GOLD, "tail", { out: false });
    return { S: 0.47, prof: { gait: "biped", step: 7, tail: 0, ear: 0, beak: false,
      extra(a, t, c) { const tb = a.b.tail; if (tb) tb.rotation.set(0.25 * Math.sin(t * 2.3) - c[HX], 0, 0.3 * Math.sin(t * 1.7) - c[ROLL] * 2); } } };
  },
};

const VIS_SPECS = new Map();
const VIS_STATES = [SI.idle, SI.walk, SI.wave, SI.happy, SI.talk];
const VIS_LINE = 0.011;
export function buildVisitor(id, { toon, outlined }) {
  if (!VIS[id]) throw new Error("unknown visitor " + id);
  if (!VIS_SPECS.has(id)) {
    const k = new Kit();
    const r = VIS[id](k);
    const spec = { ...bakeKit(k, r.S), prof: { happyArm: 2.2, ...r.prof } };
    const hb = spec.bones.find((b) => b.name === "head");
    spec.top = 0;
    const P = spec.main.attributes.position;
    for (let i = 0; i < P.count; i++) spec.top = Math.max(spec.top, P.getY(i));
    VIS_SPECS.set(id, spec);
    void hb;
  }
  const spec = VIS_SPECS.get(id);
  const inst = instantiate(spec, { main: vcMat(toon), line: lineMat(outlined, VIS_LINE) });
  const anim = new Anim(inst, spec.prof, spec.S, VIS_STATES);
  const { root } = inst;
  root.userData.headY = spec.top + 0.03; // 对话气泡挂这儿
  tagAll(root, "visitor", id);
  return { root, id, height: spec.top, update(t, dt, state = "idle") { anim.update(t, dt, state); } };
}

/* ================================================================ 蛋 */
export const EGG_PATTERNS = ["speckle", "stripe", "heart", "star", "sea", "flower", "snow", "flame"];
const EGG_A = 0.043, EGG_B = 0.06, EGG_N = 48, TEETH = 8;
// 球面方向 (θ 绕 y，θ=0 朝 +z；φ 从底 0 到顶 π) → 蛋壳上的点（下胖上尖）
function eggPt(th, ph, out, lift = 0) {
  const ny = -Math.cos(ph), s = Math.sin(ph), k = (1 - 0.13 * ny) * (1 + lift);
  return out.set(s * Math.sin(th) * EGG_A * k, EGG_B + ny * EGG_B * (1 + lift), s * Math.cos(th) * EGG_A * k);
}
// 裂缝：锯齿线（θ 每 3 列一个折点，正好落在顶点上）
const crackPh = (th) => {
  const u = (((th / TAU) * TEETH * 2) % 2 + 2) % 2; // 0..2
  const tri = u < 1 ? u : 2 - u;
  return 1.83 + 0.16 * (tri * 2 - 1);
};
// 一块蛋壳网格：θ 一圈 N 列，φ 从 lo(θ) 到 hi(θ) 共 rows 行；inner = 内壁（法线朝里）
function shellGrid(lo, hi, rows, lift, inner) {
  const pos = [], idx = [], p = V(), N = EGG_N;
  for (let j = 0; j <= rows; j++) for (let i = 0; i <= N; i++) {
    const th = (i / N) * TAU, a = lo(th), b = hi(th);
    eggPt(th, a + ((b - a) * j) / rows, p, lift);
    pos.push(p.x, p.y, p.z);
  }
  for (let j = 0; j < rows; j++) for (let i = 0; i < N; i++) {
    const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1;
    if (inner) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return smooth(g);
}
// 两条边线之间的一圈窄带（条纹 / 海浪 / 火焰用），稍微浮在蛋壳外面
function bandGrid(lo, hi, lift = 0.012, N = 96) {
  let span = 0;
  for (let i = 0; i < N; i++) span = Math.max(span, hi((i / N) * TAU) - lo((i / N) * TAU));
  const rows = Math.max(2, Math.ceil(span / 0.07)); // 行数够密，弦不会切进蛋壳里
  const pos = [], idx = [], p = V();
  for (let j = 0; j <= rows; j++) for (let i = 0; i <= N; i++) {
    const th = (i / N) * TAU, a = lo(th), b = hi(th);
    eggPt(th, a + ((b - a) * j) / rows, p, lift);
    pos.push(p.x, p.y, p.z);
  }
  for (let j = 0; j < rows; j++) for (let i = 0; i < N; i++) {
    const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
// 平面小图形贴到蛋壳 (θ, φ) 处
function eggDecal(flat, th, ph, lift = 0.012, spin = 0) {
  const g = flat.clone(), P = g.attributes.position, p0 = V(), p1 = V(), p2 = V(), q = V();
  eggPt(th, ph, p0); eggPt(th + 0.01, ph, p1); eggPt(th, ph + 0.01, p2);
  const Lt = p1.distanceTo(p0) / 0.01, Lp = p2.distanceTo(p0) / 0.01, cs = Math.cos(spin), sn = Math.sin(spin);
  for (let i = 0; i < P.count; i++) {
    const u = P.getX(i) * cs - P.getY(i) * sn, v = P.getX(i) * sn + P.getY(i) * cs;
    eggPt(th + u / Lt, ph + v / Lp, q, lift);
    P.setXYZ(i, q.x, q.y, q.z);
  }
  g.computeVertexNormals();
  return g;
}
let rngS = 1;
const rnd = () => ((rngS = (rngS * 16807) % 2147483647) / 2147483647);
// 每种花纹：底色渐变（下 → 上）+ 往上贴的东西 deco(add)；add(geo, color, ph) 自动按高度分给上 / 下半壳
const EGG = {
  speckle: { lo: 0xffe9c4, hi: 0xfff8ea, deco(add) { for (let i = 0; i < 20; i++) { const r = 0.006 + rnd() * 0.005; add(ellG(r, r * (0.75 + rnd() * 0.3)), [0xb9875a, 0x8fbf84, 0xf08f8a][i % 3], null, rnd() * 3); } } },
  stripe: { lo: 0xc4ecd8, hi: 0xeefaf3, deco(add, band) {
    band((th) => 0.95 + 0.07 * Math.sin(th * 8), (th) => 1.17 + 0.07 * Math.sin(th * 8), 0xff9fbe);
    band((th) => 0.52 + 0.05 * Math.sin(th * 8 + 1.5), (th) => 0.66 + 0.05 * Math.sin(th * 8 + 1.5), 0xb9a6ff);
    band((th) => 2.28, (th) => 2.42, 0xffd86a);
    band(() => 1.38, () => 1.45, 0xb9a6ff);
  } },
  heart: { lo: 0xffd3e1, hi: 0xfff2f6, deco(add) { for (let i = 0; i < 10; i++) add(heartG(0.013 + rnd() * 0.006), i % 2 ? 0xff5c8a : 0xff92b8, null, (rnd() - 0.5) * 0.6); } },
  star: { lo: 0x9fb0f6, hi: 0xdfe4ff, deco(add) { for (let i = 0; i < 9; i++) { const R = 0.015 + rnd() * 0.006; add(starG(R, R * 0.48, 5), i % 3 ? 0xffcf3a : 0xffffff, null, rnd()); } } },
  sea: { lo: 0xd9f4ff, hi: 0xf2fbff, deco(add, band) {
    band(() => 0.0, (th) => 0.95 + 0.12 * Math.sin(th * 6), 0x4fa8e0);
    band((th) => 0.9 + 0.12 * Math.sin(th * 6), (th) => 1.22 + 0.1 * Math.sin(th * 6 + 1.1), 0x8fd3f2);
    for (let i = 0; i < 12; i++) { const th = (i / 12) * TAU; add(ellG(0.005, 0.003), 0xffffff, 1.24 + 0.1 * Math.sin(th * 6 + 1.1), 0, th); }
    for (let i = 0; i < 5; i++) add(ellG(0.003, 0.003), 0xffffff, 2.3 + rnd() * 0.4);
  } },
  flower: { lo: 0xc9eaa8, hi: 0xf1fadf, deco(add) {
    for (let i = 0; i < 8; i++) { const th = rnd() * TAU, ph = 0.5 + rnd() * 2.3, R = 0.013 + rnd() * 0.005; add(flowerG(R), i % 2 ? 0xffffff : 0xff9fc2, ph, 0, th); add(ellG(R * 0.34, R * 0.34), 0xffc93a, ph, 0, th, 0.02); }
  } },
  snow: { lo: 0xbcdcfb, hi: 0xf0f7ff, deco(add) { for (let i = 0; i < 8; i++) add(snowG(0.014 + rnd() * 0.005), i % 2 ? 0xffffff : 0x6fb0ec, null, rnd()); } },
  flame: { lo: 0xffb36b, hi: 0xffeeb0, deco(add, band) {
    band(() => 0.0, (th) => 0.9 + 0.45 * (1 - Math.abs(Math.sin(th * 4))) ** 1.6, 0xff6a45);
    band(() => 0.0, (th) => 0.55 + 0.35 * (1 - Math.abs(Math.sin(th * 4 + 0.8))) ** 1.6, 0xffa23a, 0.02);
    for (let i = 0; i < 5; i++) add(ellG(0.004, 0.004), 0xfff6c8, 2.25 + rnd() * 0.5);
  } },
};
const EGG_SPECS = new Map();
function eggSpec(pattern) {
  if (EGG_SPECS.has(pattern)) return EGG_SPECS.get(pattern);
  const P = EGG[pattern] || EGG.speckle;
  rngS = 7 + EGG_PATTERNS.indexOf(pattern) * 131;
  const k = new Kit();
  k.bone("bot", null, [0, 0, 0]).bone("top", "bot", [0, 0.078, 0]);
  const base = (p) => mix(P.lo, P.hi, p.y / (EGG_B * 2));
  const INNER = 0xfffbf0;
  // 外壳（下半 / 上盖）、内壁、断口
  k.add(shellGrid(() => 0, crackPh, 22, 0, false), { color: base, bone: "bot" });
  k.add(shellGrid(crackPh, () => Math.PI, 12, 0, false), { color: base, bone: "top" });
  k.add(shellGrid(() => 0, crackPh, 22, -0.07, true), { color: INNER, bone: "bot", out: false });
  k.add(shellGrid(crackPh, () => Math.PI, 12, -0.07, true), { color: INNER, bone: "top", out: false });
  for (const [bone, sign] of [["bot", 1], ["top", -1]]) {
    const pos = [], idx = [], p = V(), N = EGG_N;
    for (let i = 0; i <= N; i++) {
      const th = (i / N) * TAU, ph = crackPh(th);
      eggPt(th, ph, p, 0); pos.push(p.x, p.y, p.z);
      eggPt(th, ph, p, -0.07); pos.push(p.x, p.y, p.z);
    }
    for (let i = 0; i < N; i++) { const a = i * 2; if (sign > 0) idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); else idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    k.add(g, { color: INNER, bone, out: false });
  }
  // 花纹：落在裂缝附近的就挪开，上下各自跟着自己的半壳
  const which = (ph) => (ph > 2.05 ? "top" : "bot");
  const add = (flat, color, ph = null, spin = 0, th = null, extra = 0) => {
    let p = ph, t = th;
    for (let tries = 0; p === null || (p > 1.55 && p < 2.15); tries++) { p = 0.35 + rnd() * 2.45; if (tries > 40) break; }
    if (t === null) t = rnd() < 0.7 ? (rnd() - 0.5) * 3.4 : rnd() * TAU; // 大部分朝正面，看得见
    if (p > 1.6 && p < 2.1) return;
    k.add(eggDecal(flat, t, p, 0.014 + extra, spin), { color, bone: which(p), out: false });
  };
  const band = (lo, hi, color, extra = 0) => {
    const mid = (lo(0) + hi(0)) / 2;
    k.add(bandGrid(lo, hi, 0.01 + extra), { color, bone: which(mid), out: false });
  };
  P.deco(add, band);
  const spec = bakeKit(k, 1);
  // 裂缝线：沿锯齿边的一条深色细带，从正面往两边长（drawRange 控制长度）
  const pos = [], idx = [], p = V(), segs = [];
  for (let i = 0; i < EGG_N; i++) segs.push(i);
  const dist = (i) => { const th = ((i + 0.5) / EGG_N) * TAU; return Math.min(th, TAU - th); };
  segs.sort((a, b) => dist(a) - dist(b));
  const W = 0.08;
  for (const i of segs) {
    const base = pos.length / 3;
    for (const ii of [i, i + 1]) {
      const th = (ii / EGG_N) * TAU, ph = crackPh(th);
      eggPt(th, ph - W, p, 0.01); pos.push(p.x, p.y, p.z);
      eggPt(th, ph + W, p, 0.01); pos.push(p.x, p.y, p.z);
    }
    idx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
  }
  spec.crackPos = new THREE.Float32BufferAttribute(pos, 3);
  spec.crackIdx = new THREE.Uint16BufferAttribute(idx, 1);
  EGG_SPECS.set(pattern, spec);
  return spec;
}
let CRACK_MAT = null;
export function buildEgg(pattern, { toon, outlined }) {
  const spec = eggSpec(pattern);
  const inst = instantiate(spec, { main: vcMat(toon, "vcDS", { side: THREE.DoubleSide }), line: lineMat(outlined, 0.005) });
  const cg = new THREE.BufferGeometry();
  cg.setAttribute("position", spec.crackPos);
  cg.setIndex(spec.crackIdx);
  cg.computeBoundingSphere();
  const crackMesh = new THREE.Mesh(cg, CRACK_MAT || (CRACK_MAT = new THREE.MeshBasicMaterial({ color: 0x5a3a2c, side: THREE.DoubleSide })));
  crackMesh.raycast = () => {};
  crackMesh.visible = false;
  inst.rig.add(crackMesh);
  const { root, rig, bones } = inst, top = bones.top;
  const total = spec.crackIdx.count;
  tagAll(root, "egg", pattern);
  return {
    root, pattern,
    update(t, dt, { wobble = 0, crack = 0 } = {}) {
      const w = clamp01(wobble), ck = clamp01(crack);
      const burst = 0.35 + 0.65 * Math.max(0, Math.sin(t * 2.2)) ** 2;
      rig.rotation.z = w * 0.3 * Math.sin(t * 11) * burst;
      rig.rotation.x = w * 0.12 * Math.sin(t * 8.3 + 1) * burst;
      rig.position.y = w > 0.6 ? (w - 0.6) * 0.04 * Math.max(0, Math.sin(t * 5.5)) : 0;
      const n = Math.floor((ck * total) / 6) * 6;
      crackMesh.visible = n > 0;
      cg.setDrawRange(0, n);
      const open = sstep(0.85, 1, ck);
      top.position.y = spec.bones[1].p[1] + open * 0.035;
      top.position.x = open * 0.01;
      top.rotation.z = -open * 0.5;
      top.rotation.x = -open * 0.15;
    },
  };
}

/* ================================================================ 小帆船 */
const BOAT = { cream: 0xfff6e4, pink: 0xff8fb1, deck: 0xdcab7c, wood: 0xb07e52, sail: 0xfffaf0, heart: 0xff6f9a, flag: 0xff8fb1, glass: 0x8fd3f2 };
let BOAT_GEO = null;
const sheer = (u) => 0.12 + 0.08 * Math.max(0, u) ** 2 + 0.025 * Math.max(0, -u) ** 2;
function hullPt(x, y, z, out, lift = 0) { // 单位下半球 → 船身：前尖后圆，船头翘
  const u = x, X = x * 0.45, Z = z * 0.2 * (1 - 0.6 * Math.max(0, u) ** 2) * (1 - 0.1 * Math.max(0, -u) ** 2);
  const s = sheer(u), Yv = s + y * (s + 0.1);
  return out.set(X * (1 + lift), Yv, Z * (1 + lift * 2));
}
function boatGeos() {
  if (BOAT_GEO) return BOAT_GEO;
  const k = new Kit();
  k.bone("b", null, [0, 0, 0]);
  const C = BOAT;
  // 船身：下半球变形；下水线以下浅蓝
  const g = new THREE.SphereGeometry(1, 40, 14, 0, TAU, Math.PI / 2, Math.PI / 2);
  const P = g.attributes.position, q = V();
  for (let i = 0; i < P.count; i++) { hullPt(P.getX(i), P.getY(i), P.getZ(i), q); P.setXYZ(i, q.x, q.y, q.z); }
  k.add(smooth(g), { color: (p) => (p.y < 0.005 ? 0x9fd6ee : C.cream), bone: "b" });
  // 粉色腰线（贴在船身外的一圈窄带）
  const band = new THREE.SphereGeometry(1, 48, 2, 0, TAU, Math.PI / 2 + 0.22, 0.2);
  const BP = band.attributes.position;
  for (let i = 0; i < BP.count; i++) { hullPt(BP.getX(i), BP.getY(i), BP.getZ(i), q, 0.012); BP.setXYZ(i, q.x, q.y, q.z); }
  k.add(smooth(band), { color: C.pink, bone: "b", out: false });
  // 船舷一圈粉色扶手
  const rim = [];
  for (let i = 0; i < 64; i++) { const a = (i / 64) * TAU; hullPt(Math.cos(a), 0, Math.sin(a), q); rim.push(q.clone()); }
  k.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rim, true), 80, 0.018, 6, true), { color: C.pink, bone: "b" });
  // 甲板
  const deck = new THREE.Shape();
  rim.forEach((p, i) => (i ? deck.lineTo(p.x * 0.97, -p.z * 0.94) : deck.moveTo(p.x * 0.97, -p.z * 0.94)));
  const dg = new THREE.ShapeGeometry(deck, 4);
  dg.rotateX(-Math.PI / 2);
  dg.translate(0, 0.1, 0);
  k.add(dg, { color: (p) => (Math.abs(((p.z * 40) % 1 + 1) % 1 - 0.5) < 0.06 ? blend(C.deck, 0x8a5a3a, 0.35) : C.deck), bone: "b", out: false });
  // 圆窗 ×2（船头两侧）+ 船尾挂的救生圈
  for (const s of [-1, 1]) for (const x of [0.12, 0.24]) {
    const pc = hullPt(x / 0.45, -0.25, s * Math.sqrt(Math.max(0, 1 - (x / 0.45) ** 2 - 0.0625)), V(), 0.02);
    k.torus([pc.x, pc.y, pc.z], 0.022, 0.007, C.wood, "b", { rot: [0, s < 0 ? Math.PI : 0, 0], out: false, rs: 4, ts: 12 });
    k.add(new THREE.CircleGeometry(0.02, 12).rotateY(s < 0 ? Math.PI : 0).translate(pc.x, pc.y, pc.z + s * 0.002), { color: C.glass, bone: "b", out: false });
  }
  const lb = hullPt(-0.72, -0.15, Math.sqrt(1 - 0.72 ** 2 - 0.15 ** 2), V(), 0.03);
  k.add(new THREE.TorusGeometry(0.045, 0.014, 6, 16), { color: (p) => ((Math.floor(((Math.atan2(p.y - lb.y, p.x - lb.x) + TAU) % TAU) / (TAU / 8)) % 2) ? C.pink : 0xffffff), bone: "b", m: mat4([lb.x, lb.y, lb.z + 0.012], [0, 0, 0]) });
  // 桅杆 + 顶上小球 + 横杆 + 前支索
  k.cyl([0.08, 0.5, 0], 0.016, 0.021, 0.8, C.wood, "b", { seg: 10 });
  k.ball([0.08, 0.91, 0], 0.024, 0xffd54a, "b", { ws: 10, hs: 8 });
  k.cyl([-0.11, 0.21, 0], 0.013, 0.013, 0.42, C.wood, "b", { rot: [0, 0, Math.PI / 2], seg: 8 });
  k.stick([0.08, 0.86, 0], [0.4, 0.21, 0], 0.004, 0x8a7060, "b", { out: false, seg: 4 });
  const hull = bakeKit(k, 1);
  // 帆：桅杆 + 横杆夹着的三角帆，鼓一点；正反两面都有爱心
  const sk = new Kit();
  sk.bone("b", null, [0, 0, 0]);
  const XM = 0.065, FOOT = 0.38, HT = 0.6, BEL = 0.045, n = 12, m = 10;
  const sx = (i, j) => XM - FOOT * (1 - i / n) * (j / m), sy = (i) => 0.02 + HT * (i / n);
  const env = (x, y) => { const v = clamp01((y - 0.02) / HT), w = (XM - x) / Math.max(1e-3, FOOT * (1 - v)); return Math.sin(Math.PI * clamp01(w)) * Math.sin(Math.PI * (0.12 + 0.88 * v)) * (1 - v) ** 0.3; };
  const bz = (x, y) => BEL * env(x, y), TH = 0.007;
  for (const side of [1, -1]) {
    const sp = [], si = [];
    for (let i = 0; i <= n; i++) for (let j = 0; j <= m; j++) { const x = sx(i, j), y = sy(i), e = env(x, y); sp.push(x, y, BEL * e + side * TH * e); }
    for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) {
      const a = i * (m + 1) + j, b = a + 1, c = a + m + 1, d = c + 1;
      if (side < 0) si.push(a, b, c, b, d, c); else si.push(a, c, b, b, c, d);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute("position", new THREE.Float32BufferAttribute(sp, 3));
    sg.setIndex(si);
    sg.computeVertexNormals();
    sk.add(sg, { color: (p) => (p.y > 0.045 && p.y < 0.075 ? 0xffd9e6 : C.sail), bone: "b" });
    const hg = heartG(0.062, -0.075, 0.17);
    const HP = hg.attributes.position;
    for (let i = 0; i < HP.count; i++) { const x = HP.getX(i), y = HP.getY(i), e = env(x, y); HP.setXYZ(i, x, y, BEL * e + side * (TH * e + 0.003)); }
    if (side < 0) { const ix = hg.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i]; ix[i] = ix[i + 1]; ix[i + 1] = t; } }
    hg.computeVertexNormals();
    sk.add(hg, { color: C.heart, bone: "b", out: false });
  }
  const sail = bakeKit(sk, 1);
  // 收起来时卷在横杆上的帆布卷
  const fk = new Kit();
  fk.bone("b", null, [0, 0, 0]);
  fk.add(new THREE.CapsuleGeometry(0.028, 0.32, 3, 8), { color: C.sail, bone: "b", m: mat4([-0.105, 0, 0], [0, 0, Math.PI / 2], [1, 1, 1]) });
  for (const x of [-0.2, -0.05]) fk.torus([x, 0, 0], 0.03, 0.006, C.pink, "b", { rot: [0, Math.PI / 2, 0], out: false, ts: 12, rs: 4 });
  const furl = bakeKit(fk, 1);
  // 桅顶小旗
  const flag = polyG([[0, 0], [0.12, -0.025], [0, -0.06]]);
  const fl = new Kit(); fl.bone("b", null, [0, 0, 0]);
  fl.add(flag, { color: C.flag, bone: "b" });
  BOAT_GEO = { hull, sail, furl, flag: bakeKit(fl, 1) };
  return BOAT_GEO;
}
export function buildBoat({ toon, outlined }) {
  const G = boatGeos();
  const mat = vcMat(toon, "vcDS", { side: THREE.DoubleSide });
  const plain = (spec, line) => {
    const m = new THREE.Mesh(spec.main, mat);
    if (line) {
      // 描边：直接用烤好的（只有位置）几何体 + 借来的描边材质，不用再焊一遍
      const lm = lineMat(outlined, line);
      if (lm && spec.line) { const o = new THREE.Mesh(spec.line, lm); o.raycast = () => {}; m.add(o); }
    }
    return m;
  };
  const root = new THREE.Group(), body = new THREE.Group();
  root.add(body);
  body.add(plain(G.hull, 0.012));
  const sailPivot = new THREE.Group();
  sailPivot.position.set(0, 0.21, 0);
  const sail = plain(G.sail, 0.009);
  sailPivot.add(sail);
  body.add(sailPivot);
  const furl = plain(G.furl, 0.008);
  furl.position.set(0, 0.235, 0);
  body.add(furl);
  const flag = plain(G.flag, 0);
  flag.position.set(0.09, 0.9, 0);
  body.add(flag);
  tagAll(root, "boat", "boat");
  return {
    root, length: 0.9,
    update(t, dt, { sail: s = 0 } = {}) {
      const k = clamp01(s);
      body.position.y = 0.012 * Math.sin(t * 1.6);
      body.rotation.x = 0.05 * Math.sin(t * 1.1);
      body.rotation.z = 0.03 * Math.sin(t * 1.3 + 1);
      sailPivot.scale.set(0.35 + 0.65 * k, Math.max(0.02, k), 1 + (0.15 * Math.sin(t * 2.3) - 0.6 + 0.6 * k) * k);
      sail.visible = k > 0.03;
      furl.visible = k < 0.97;
      furl.scale.set(1, 1 - 0.7 * k, 1 - 0.7 * k);
      flag.rotation.y = 0.35 * Math.sin(t * 5) - 0.2;
    },
  };
}
