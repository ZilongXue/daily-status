// 小菜园的 Q 版模型（Three.js r170）：菜地、7 种作物 × 4 个阶段、小水壶、浇水水珠、收获时的闪光。
// 全部用基础几何体程序化搭出来；同一株作物里同色同描边的零件合并成一个网格（手机友好）。
// 材质和描边由调用方传进来的 toon() / outlined() 决定，和小岛保持一致。
//
// 尺寸（单位和岛面一致，岛半径 3.25）：
//   菜地默认 3×2 格，每格 0.6；整块约 1.94 × 1.34，边框高 0.14。
//   作物占地 ≤ 0.55 × 0.55；成熟高度 0.3–0.5，向日葵约 0.9。原点在作物根部（土面）。
//   水壶长约 0.35，原点在提手顶上（手握的地方），壶嘴朝 +x。
// 枯萎：作物用 morph target 做“蔫了”的姿势（低头、叶子耷拉、往一边歪），颜色也变灰黄，
//       所以 setWilted 不增加网格数，切换时可以平滑过渡（需要每帧调用 root.userData.anim(t)）。
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/* ---------------------------------------------------------------- catalog */
export const CROPS = {
  tomato: { name: "小番茄", emoji: "🍅", color: 0xff5a4e },
  strawberry: { name: "草莓", emoji: "🍓", color: 0xff4f6d },
  carrot: { name: "胡萝卜", emoji: "🥕", color: 0xff9a3c },
  sunflower: { name: "向日葵", emoji: "🌻", color: 0xffd23f },
  tulip: { name: "郁金香", emoji: "🌷", color: 0xff8fb3 },
  pumpkin: { name: "南瓜", emoji: "🎃", color: 0xffa03a },
  poinsettia: { name: "圣诞红", emoji: "🌺", color: 0xe8414f },
};

/* ---------------------------------------------------------------- palette */
const SOIL = 0x8a5c3a, SOIL_DK = 0x6b4630, SOIL_LT = 0x9e6c47, CLOD = 0x5e3d28;
const WOOD = 0xd8a46e, WOOD_DK = 0xb27c4f, CREAM = 0xfff3e2;
const LEAF = 0x6fcf86, LEAF_DK = 0x4fae6a, LEAF_LT = 0x9ade8a, STEM = 0x58b873;
const LN = 0.012, LN_S = 0.008; // 描边粗细：主体 / 小零件

/* ---------------------------------------------------------------- geometry helpers */
const _e = new THREE.Euler(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
// 变换矩阵：先缩放，再按 x（滚）→ z（仰角）→ y（朝向）旋转，最后平移
function M(p = [0, 0, 0], r = [0, 0, 0], s = 1) {
  _e.set(r[0], r[1], r[2], "YZX");
  _q.setFromEuler(_e);
  if (typeof s === "number") _s.set(s, s, s); else _s.set(s[0], s[1], s[2]);
  return new THREE.Matrix4().compose(_v.set(p[0], p[1], p[2]), _q, _s);
}
const xf = (geo, p, r, s) => geo.applyMatrix4(M(p, r, s));
const sph = (ws = 12, hs = 9) => new THREE.SphereGeometry(1, ws, hs);
const ell = (rx, ry, rz, ws = 12, hs = 9) => sph(ws, hs).scale(rx, ry, rz);

// 从 a 到 b 的小圆柱（茎、杆）
function seg(a, b, ra, rb, n = 7) {
  const A = V(...a), B = V(...b), d = B.clone().sub(A), len = d.length();
  const g = new THREE.CylinderGeometry(rb, ra, len, n, 1);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), d.normalize()));
  return g.translate(A.x, A.y, A.z);
}

// 叶片：根部在原点，沿 +x 伸出，尖头，宽度方向 z，厚度方向 y；cup>0 叶缘往 +y 翘，tip 让叶尖往下弯一点
function leafGeo(len, wid, { thick = 0.24, cup = 0.3, tip = 0.12, ws = 10, hs = 6 } = {}) {
  const g = sph(ws, hs);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const f = x > 0 ? Math.pow(1 - x, 0.42) : 1;
    const t = (x + 1) / 2, zz = z * f;
    p.setXYZ(i, t * len, (y * f * thick + cup * zz * zz) * wid / 2 - tip * len * t * t, zz * wid / 2);
  }
  g.computeVertexNormals();
  return g;
}

// 有棱的南瓜：8 道沟，上下压扁，顶上一个小凹
function pumpkinGeo(r, flat = 0.7) {
  const g = sph(40, 16);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const phi = Math.atan2(z, x);
    const groove = Math.pow(1 - Math.abs(Math.sin(4 * phi)), 5);
    const k = 1 - 0.11 * groove * (1 - y * y);
    x *= k; z *= k;
    y = y * flat - 0.18 * Math.max(0, y - 0.75) * 4 * flat;
    p.setXYZ(i, x * r, y * r, z * r);
  }
  g.computeVertexNormals();
  return g;
}

// 草莓：上圆下尖（+y 是蒂那头）
const berryK = (y) => 0.48 + 0.52 * (y + 1) / 2;
function berryGeo(r) {
  const g = sph(12, 10);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i), k = berryK(y);
    p.setXYZ(i, p.getX(i) * k * r, y * 1.18 * r, p.getZ(i) * k * r);
  }
  g.computeVertexNormals();
  return g;
}
function berryPt(r, th, ph, lift = 0) {
  const y = Math.cos(th), s = Math.sin(th), k = berryK(y);
  return [Math.cos(ph) * s * k * (r + lift), y * 1.18 * r, Math.sin(ph) * s * k * (r + lift)];
}

// 只留 position / normal，并保证有索引，这样不同几何体可以合并
function prep(g) {
  for (const n of Object.keys(g.attributes)) if (n !== "position" && n !== "normal") g.deleteAttribute(n);
  if (!g.index) g.setIndex([...Array(g.attributes.position.count).keys()]);
  if (!g.attributes.normal) g.computeVertexNormals();
  return g;
}
const mergeAll = (list) => (list.length === 1 ? list[0] : mergeGeometries(list, false));

/* ---------------------------------------------------------------- kit：收集零件，按（分组, 颜色, 描边）合并 */
// group: "sway" 会随风摆、会枯萎；"base" 固定不动（土堆、木桩）；"fixed" 不动但枯萎时会变色（南瓜、胡萝卜）
function makeKit(w) {
  const parts = [];
  const stack = [new THREE.Matrix4()];
  const k = {
    w,
    parts,
    add(geo, color, line = LN, group = "sway") {
      prep(geo).applyMatrix4(stack[stack.length - 1]);
      parts.push({ geo, color, line, group });
      return geo;
    },
    push(p, r, s) { stack.push(stack[stack.length - 1].clone().multiply(M(p, r, s))); },
    pop() { stack.pop(); },
  };
  return k;
}

// 一片叶子：base 根部位置，yaw 朝向，elev 仰角（枯萎时往下耷拉 droop）
function leaf(k, color, base, yaw, elev, len, wid, o = {}) {
  const e = Math.max(-1.35, elev - (o.droop ?? 0.85) * k.w);
  return k.add(xf(leafGeo(len, wid, o), base, [o.roll || 0, yaw, e]), color, o.line ?? LN_S);
}
// 一团圆圆的叶丛（番茄）：枯萎时往下塌一点
function blob(k, color, x, y, z, r, line = LN) {
  const w = k.w;
  return k.add(xf(sph(12, 9), [x * (1 + 0.15 * w), y * (1 - 0.12 * w), z * (1 + 0.15 * w)], [0, 0, 0], [r, r * (0.9 - 0.18 * w), r]), color, line);
}
const mound = (k, r = 0.1, h = 0.04, color = SOIL_LT) => k.add(ell(r, h, r, 12, 6), color, LN_S, "base");
// 小高光（白色，不描边）
const shine = (k, p, r, group = "sway") => k.add(xf(sph(6, 4), p, [0, 0, 0.6], [r, r * 0.7, r * 0.5]), 0xffffff, 0, group);

/* ---------------------------------------------------------------- crop builders */
// 每个阶段一个函数 (k, C)；k.w = 0 是正常姿势，1 是枯萎姿势。两次调用必须加同样的零件（顺序、几何体都一样）。

function seedStage(k, C) {
  mound(k, 0.11, 0.045);
  for (const [x, z] of [[-0.035, 0.02], [0.02, 0.04], [0.0, -0.03]]) k.add(xf(sph(6, 4), [x, 0.04, z], [0, 0, 0], [0.013, 0.009, 0.011]), CREAM, 0, "base");
  // 小牌子：木签 + 作物颜色的小圆牌
  const w = k.w;
  k.push([0.07, 0, -0.03], [0, 0, -0.12 - 0.25 * w]);
  k.add(new THREE.CylinderGeometry(0.008, 0.01, 0.15, 6).translate(0, 0.075, 0), WOOD_DK, LN_S);
  k.add(xf(new THREE.CylinderGeometry(0.035, 0.035, 0.014, 14), [0, 0.15, 0.008], [Math.PI / 2, 0, 0]), C.color, LN_S);
  k.add(xf(sph(6, 4), [-0.01, 0.158, 0.017], [0, 0, 0], [0.01, 0.01, 0.004]), 0xffffff, 0);
  k.pop();
}

function sproutStage(k, C) {
  mound(k, 0.09, 0.035);
  const w = k.w, top = [0.025 * w, 0.1 - 0.025 * w, 0];
  k.add(seg([0, 0, 0], top, 0.012, 0.009, 6), STEM, LN_S);
  for (const s of [0, Math.PI]) leaf(k, C.leaf || LEAF, top, s + 0.15, 0.5, 0.085, 0.065, { droop: 1.1, cup: 0.5, tip: 0.05, line: LN_S });
}

const B = {
  tomato: [
    (k) => { // 2：长个子，绿番茄 + 小黄花
      mound(k);
      k.add(xf(new THREE.BoxGeometry(0.022, 0.36, 0.022), [0.0, 0.17, -0.08], [0, 0, 0.04]), WOOD, LN_S, "base");
      k.add(seg([0, 0, 0], [0, 0.26, -0.03], 0.013, 0.01), STEM, LN_S);
      blob(k, LEAF, 0.06, 0.12, 0.0, 0.075);
      blob(k, LEAF_DK, -0.07, 0.17, -0.01, 0.075);
      blob(k, LEAF, 0.0, 0.26, -0.02, 0.07);
      for (const [x, y, z] of [[0.07, 0.08, 0.07], [-0.06, 0.15, 0.07]]) k.add(xf(sph(10, 8), [x, y * (1 - 0.15 * k.w), z], [0, 0, 0], [0.032, 0.029, 0.032]), 0xa8dd7a, LN_S);
      for (const [x, y, z] of [[0.04, 0.22, 0.065], [-0.08, 0.24, 0.03], [0.09, 0.18, 0.0]]) k.add(xf(sph(6, 4), [x, y * (1 - 0.12 * k.w), z], [0, 0, 0], 0.016), 0xffe066, 0);
    },
    (k) => { // 3：成熟，红红的小番茄
      mound(k);
      k.add(xf(new THREE.BoxGeometry(0.024, 0.52, 0.024), [0.0, 0.25, -0.09], [0, 0, 0.03]), WOOD, LN_S, "base");
      k.add(xf(new THREE.TorusGeometry(0.02, 0.005, 4, 10), [0.0, 0.32, -0.08], [Math.PI / 2, 0, 0]), CREAM, 0, "base");
      k.add(seg([0, 0, 0], [0, 0.4, -0.04], 0.015, 0.011), STEM, LN_S);
      blob(k, LEAF, 0.09, 0.15, 0.0, 0.095);
      blob(k, LEAF_DK, -0.09, 0.2, -0.02, 0.1);
      blob(k, LEAF, -0.01, 0.31, -0.03, 0.1);
      blob(k, LEAF_DK, 0.05, 0.42, -0.02, 0.075);
      blob(k, LEAF_DK, 0.03, 0.12, -0.08, 0.08);
      const w = k.w;
      [[0.11, 0.1, 0.09, 0.056], [-0.1, 0.15, 0.09, 0.054], [0.06, 0.27, 0.1, 0.055], [-0.07, 0.34, 0.07, 0.048], [0.15, 0.24, -0.01, 0.046]].forEach(([x, y, z, r]) => {
        const p = [x, y * (1 - 0.15 * w) - 0.01 * w, z];
        k.add(xf(sph(12, 9), p, [0, 0, 0], [r, r * 0.88, r]), CROPS.tomato.color, LN_S);
        k.add(xf(new THREE.CylinderGeometry(0.004, r * 0.6, 0.012, 5), [p[0], p[1] + r * 0.85, p[2]]), LEAF_DK, 0);
        shine(k, [p[0] - r * 0.35, p[1] + r * 0.4, p[2] + r * 0.65], r * 0.22);
      });
    },
  ],

  strawberry: [
    (k) => { // 2：小叶丛 + 小白花 + 一颗青草莓
      mound(k);
      trefoils(k, [[0, 0.16, 0.08], [2.1, 0.14, 0.075], [4.2, 0.15, 0.08]]);
      flower(k, [0.1, 0.1, 0.07], 0.022);
      flower(k, [-0.11, 0.12, 0.03], 0.02);
      const p = [0.02, 0.045 + 0.01 * (1 - k.w), 0.12];
      k.add(xf(berryGeo(0.03), p), 0xd8efb6, LN_S);
      k.add(xf(new THREE.CylinderGeometry(0.003, 0.02, 0.008, 6), [p[0], p[1] + 0.035, p[2]]), LEAF_DK, 0);
    },
    (k) => { // 3：成熟，草莓垂在稻草上
      k.add(new THREE.CylinderGeometry(0.21, 0.23, 0.02, 16).translate(0, 0.008, 0), 0xf2d58a, LN_S, "base");
      mound(k, 0.08, 0.04);
      trefoils(k, [[0.3, 0.3, 0.1], [1.5, 0.26, 0.095], [2.8, 0.29, 0.1], [4.0, 0.25, 0.09], [5.2, 0.27, 0.095]]);
      flower(k, [-0.04, 0.2, 0.1], 0.024);
      const w = k.w;
      [[0.6, 0.15], [1.9, 0.14], [3.5, 0.15], [5.0, 0.135]].forEach(([a, R], i) => {
        const r = 0.046 + (i % 2) * 0.006;
        const p = [Math.sin(a) * R, 0.07 - 0.015 * w, Math.cos(a) * R];
        k.add(seg([p[0] * 0.4, 0.16 * (1 - 0.3 * w), p[2] * 0.4], [p[0], p[1] + r * 1.2, p[2]], 0.005, 0.004, 5), STEM, 0);
        k.push(p, [0, a, 0.25 * (i % 2 ? 1 : -1)]);
        k.add(berryGeo(r), CROPS.strawberry.color, LN_S);
        k.add(xf(new THREE.CylinderGeometry(0.004, r * 0.75, 0.01, 6), [0, r * 1.18, 0]), LEAF_DK, 0);
        // 小种子
        for (let j = 0; j < 9; j++) {
          const th = 1.0 + (j % 3) * 0.48, ph = (j / 9) * Math.PI * 2 + (j % 3) * 0.5;
          k.add(xf(sph(4, 3), berryPt(r, th, ph, 0.002), [0, 0, 0], 0.0055), 0xfff0a0, 0);
        }
        shine(k, [-r * 0.25, r * 0.45, r * 0.6], r * 0.2);
        k.pop();
      });
    },
  ],

  carrot: [
    (k) => { // 2：叶子长出来，橙色的头刚冒尖
      k.add(ell(0.1, 0.03, 0.1, 12, 6), SOIL_LT, LN_S, "base");
      k.add(carrotGeo(0.05, 0.03), CROPS.carrot.color, LN_S, "base");
      fronds(k, 5, 0.16, 0.06, 0.06, 0.035);
    },
    (k) => { // 3：成熟，胖胖的橙色肩膀露出土
      k.add(ell(0.15, 0.03, 0.15, 14, 6), SOIL_LT, LN_S, "base");
      k.add(carrotGeo(0.105, 0.085), CROPS.carrot.color, LN, "fixed");
      for (const y of [0.022, 0.05]) k.add(xf(new THREE.TorusGeometry(0.104 - y * 0.25, 0.004, 4, 18, Math.PI * 0.7), [0, y, 0], [Math.PI / 2, 0, 0.6 + y * 20]), 0xe0762a, 0, "fixed");
      shine(k, [-0.045, 0.075, 0.06], 0.02, "base");
      fronds(k, 6, 0.22, 0.09, 0.09, 0.085);
      leaf(k, LEAF, [0, 0.085, 0], 0.3, 1.2, 0.12, 0.07, { cup: 0.3, droop: 1.6 });
      leaf(k, LEAF_DK, [0, 0.085, 0], 3.4, 1.15, 0.11, 0.065, { cup: 0.3, droop: 1.6 });
    },
  ],

  sunflower: [
    (k) => { // 2：长高，顶上一个还没开的花苞
      mound(k);
      const w = k.w, top = [0.02 * w, 0.44 - 0.03 * w, 0];
      k.add(seg([0, 0, 0], [0.006, 0.22, 0], 0.016, 0.014), STEM, LN_S);
      k.add(seg([0.006, 0.22, 0], top, 0.014, 0.012), STEM, LN_S);
      leaf(k, LEAF, [0.004, 0.14, 0], 0.4, 0.35, 0.13, 0.1, { cup: 0.35 });
      leaf(k, LEAF_DK, [0.006, 0.27, 0], Math.PI + 0.3, 0.3, 0.12, 0.09, { cup: 0.35 });
      k.push(top, [0, 0, -0.9 * w]);
      k.add(xf(sph(12, 9), [0, 0.04, 0], [0, 0, 0], [0.055, 0.05, 0.055]), LEAF_DK, LN_S);
      for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; k.add(xf(new THREE.ConeGeometry(0.014, 0.04, 5), [Math.cos(a) * 0.022, 0.085, Math.sin(a) * 0.022], [0, -a, -0.35]), CROPS.sunflower.color, 0); }
      k.pop();
    },
    (k) => { // 3：大花盘
      mound(k);
      const w = k.w;
      const top = [0.03 * w, 0.68 - 0.07 * w, 0.01 + 0.08 * w];
      k.add(seg([0, 0, 0], [0.012, 0.36, 0], 0.024, 0.02), STEM, LN_S);
      k.add(seg([0.012, 0.36, 0], top, 0.02, 0.017), STEM, LN_S);
      leaf(k, LEAF, [0.006, 0.18, 0], 0.5, 0.3, 0.17, 0.13, { cup: 0.35 });
      leaf(k, LEAF_DK, [0.01, 0.32, 0], Math.PI + 0.4, 0.28, 0.16, 0.12, { cup: 0.35 });
      leaf(k, LEAF, [0.014, 0.47, 0], 2.0, 0.35, 0.13, 0.1, { cup: 0.35 });
      // 花盘朝 +z，稍微仰头；枯萎时低头
      k.push([top[0], top[1] + 0.06 - 0.1 * w, top[2] + 0.02 + 0.07 * w], [-0.28 + 1.5 * w, 0, -0.2 * w]);
      k.add(xf(new THREE.CylinderGeometry(0.11, 0.08, 0.035, 14), [0, 0, -0.025], [Math.PI / 2, 0, 0]), LEAF_DK, LN_S);
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        k.add(xf(leafGeo(0.105, 0.055, { thick: 0.35, cup: 0.15, tip: 0.0 }), [Math.cos(a) * 0.07, Math.sin(a) * 0.07, -0.004], [Math.PI / 2, 0, a]), CROPS.sunflower.color, LN_S);
      }
      for (let i = 0; i < 12; i++) {
        const a = ((i + 0.5) / 12) * Math.PI * 2;
        k.add(xf(leafGeo(0.085, 0.05, { thick: 0.35, cup: 0.15, tip: 0.0 }), [Math.cos(a) * 0.065, Math.sin(a) * 0.065, -0.016], [Math.PI / 2, 0, a]), 0xffb52e, LN_S);
      }
      k.add(xf(new THREE.CylinderGeometry(0.082, 0.082, 0.03, 18), [0, 0, 0.004], [Math.PI / 2, 0, 0]), 0x8a5a3b, LN_S);
      k.add(ell(0.078, 0.078, 0.022, 16, 8).translate(0, 0, 0.018), 0x6e4329, 0);
      for (let i = 0; i < 13; i++) {
        const a = i * 2.4, r = 0.017 * Math.sqrt(i + 0.6);
        k.add(xf(sph(4, 3), [Math.cos(a) * r, Math.sin(a) * r, 0.036 - r * r * 1.5], [0, 0, 0], [0.007, 0.007, 0.004]), 0xc08a55, 0);
      }
      k.pop();
    },
  ],

  tulip: [
    (k) => { // 2：长叶子 + 绿花苞
      mound(k);
      bladeLeaves(k, 0.15);
      [[0, 0.2, -0.02], [0.07, 0.17, 0.05], [-0.07, 0.15, 0.04]].forEach(([x, h, z]) => {
        const w = k.w, b = [x * (1 + w), h * (1 - 0.2 * w), z * (1 + w)];
        k.add(seg([x * 0.3, 0, z * 0.3], b, 0.01, 0.008, 6), STEM, LN_S);
        k.push(b, [0, Math.atan2(-z, x), -0.8 * w]);
        k.add(xf(sph(10, 8), [0, 0.03, 0], [0, 0, 0], [0.026, 0.04, 0.026]), 0xb7e59a, LN_S);
        k.pop();
      });
    },
    (k) => { // 3：三朵郁金香（粉、红、黄）
      mound(k);
      bladeLeaves(k, 0.2);
      [[0, 0.33, -0.03, 0xff8fb3], [0.08, 0.27, 0.05, 0xff5d6e], [-0.08, 0.24, 0.05, 0xffd166]].forEach(([x, h, z, c]) => {
        const w = k.w, b = [x * (1 + 0.9 * w), h * (1 - 0.18 * w), z * (1 + 0.9 * w)];
        k.add(seg([x * 0.25, 0, z * 0.25], b, 0.011, 0.009, 6), STEM, LN_S);
        const out = Math.atan2(-z, x);
        k.push(b, [0, out, -(0.1 + 1.0 * w) * (x === 0 ? -1 : 1)]);
        k.add(xf(sph(12, 9), [0, 0.048, 0], [0, 0, 0], [0.043, 0.055, 0.043]), c, LN_S);
        for (let i = 0; i < 3; i++) {
          const a = (i / 3) * Math.PI * 2 + 0.5;
          k.add(xf(leafGeo(0.1, 0.068, { thick: 0.4, cup: 0.55, tip: -0.05 }), [Math.cos(a) * 0.014, 0.0, -Math.sin(a) * 0.014], [0, a, 1.22]), c, LN_S);
        }
        k.pop();
      });
    },
  ],

  pumpkin: [
    (k) => { // 2：藤叶 + 小青南瓜 + 喇叭黄花
      k.add(ell(0.12, 0.03, 0.12, 12, 6), SOIL_LT, LN_S, "base");
      leaf(k, LEAF, [-0.02, 0.03, -0.02], 2.3, 0.3, 0.13, 0.12, { cup: 0.4, tip: 0.05, droop: 0.5 });
      leaf(k, LEAF_DK, [0.0, 0.03, -0.02], 0.7, 0.35, 0.12, 0.11, { cup: 0.4, tip: 0.05, droop: 0.5 });
      leaf(k, LEAF, [0.0, 0.03, 0.0], 4.2, 0.25, 0.11, 0.1, { cup: 0.4, tip: 0.05, droop: 0.5 });
      k.add(xf(pumpkinGeo(0.065, 0.78), [0.05, 0.045, 0.07]), 0xa8d77a, LN_S);
      k.add(seg([0.05, 0.09, 0.07], [0.06, 0.12, 0.07], 0.008, 0.006, 5), 0x7a9a4a, 0);
      const w = k.w;
      k.push([-0.07, 0.04, 0.08], [0, 0.6, 0.9 - 0.9 * w]);
      k.add(new THREE.CylinderGeometry(0.035, 0.008, 0.06, 8, 1, false).translate(0, 0.03, 0), 0xffd84d, LN_S);
      k.pop();
    },
    (k) => { // 3：大胖南瓜
      k.add(ell(0.15, 0.03, 0.15, 14, 6), SOIL_LT, LN_S, "base");
      leaf(k, LEAF, [-0.05, 0.03, -0.06], 2.4, 0.35, 0.15, 0.14, { cup: 0.4, tip: 0.05, droop: 0.6 });
      leaf(k, LEAF_DK, [0.05, 0.03, -0.06], 0.75, 0.4, 0.14, 0.13, { cup: 0.4, tip: 0.05, droop: 0.6 });
      const P = CROPS.pumpkin.color;
      k.add(xf(pumpkinGeo(0.165, 0.7), [0, 0.105, 0.01]), P, LN, "fixed");
      shine(k, [-0.07, 0.18, 0.11], 0.022, "base");
      const w = k.w;
      k.add(seg([0, 0.2, 0.01], [0.012, 0.255, 0.01], 0.022, 0.016, 7), 0x7f9a4c, LN_S);
      k.add(seg([0.012, 0.255, 0.01], [0.045 + 0.02 * w, 0.305 - 0.05 * w, 0.01], 0.016, 0.012, 7), 0x7f9a4c, LN_S);
      k.add(xf(new THREE.TorusGeometry(0.028, 0.005, 4, 12, Math.PI * 1.6), [-0.04, 0.245 - 0.03 * w, 0.03], [0, 0.4, 0.3]), STEM, 0);
    },
  ],

  poinsettia: [
    (k) => { // 2：绿叶丛，中间的叶子刚开始泛红
      mound(k);
      k.add(seg([0, 0, 0], [0, 0.14, 0], 0.014, 0.012), STEM, LN_S);
      for (let i = 0; i < 5; i++) leaf(k, i % 2 ? LEAF_DK : 0x3f9a5a, [0, 0.08, 0], (i / 5) * Math.PI * 2, 0.25, 0.12, 0.075, { cup: 0.3 });
      for (let i = 0; i < 4; i++) leaf(k, 0xf08a7a, [0, 0.14, 0], (i / 4) * Math.PI * 2 + 0.4, 0.55, 0.07, 0.045, { cup: 0.3 });
    },
    (k) => { // 3：红色的苞片像一颗星星
      mound(k);
      k.add(seg([0, 0, 0], [0, 0.22, 0], 0.016, 0.014), STEM, LN_S);
      for (let i = 0; i < 6; i++) leaf(k, i % 2 ? 0x3f9a5a : LEAF_DK, [0, 0.12, 0], (i / 6) * Math.PI * 2 + 0.25, 0.2, 0.15, 0.085, { cup: 0.3, droop: 0.7 });
      for (let i = 0; i < 7; i++) leaf(k, CROPS.poinsettia.color, [0, 0.22, 0], (i / 7) * Math.PI * 2, 0.42, 0.16, 0.08, { cup: 0.35, thick: 0.32, droop: 1.0 });
      for (let i = 0; i < 5; i++) leaf(k, 0xff6b78, [0, 0.245, 0], ((i + 0.5) / 5) * Math.PI * 2, 0.75, 0.11, 0.06, { cup: 0.35, thick: 0.32, droop: 1.0 });
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2, r = i ? 0.02 : 0;
        const w = k.w;
        k.add(xf(sph(6, 4), [Math.cos(a) * r + 0.01 * w, 0.27 - 0.03 * w, Math.sin(a) * r], [0, 0, 0], 0.011), 0xffd84d, 0);
      }
    },
  ],
};

// 草莓的三出复叶：[朝向, 高度, 伸出半径]
function trefoils(k, list) {
  const w = k.w;
  list.forEach(([a, h, R], i) => {
    const tip = [Math.sin(a) * R * (1 + 0.6 * w), h * (1 - 0.35 * w), Math.cos(a) * R * (1 + 0.6 * w)];
    k.add(seg([0, 0.01, 0], tip, 0.007, 0.005, 5), STEM, 0);
    const yaw = a - Math.PI / 2;
    for (const d of [-0.75, 0, 0.75]) leaf(k, i % 2 ? LEAF_DK : LEAF, tip, yaw + d, 0.25 - Math.abs(d) * 0.25, 0.075, 0.068, { cup: 0.35, tip: 0.04, droop: 0.9 });
  });
}
// 草莓的小白花
function flower(k, p, r) {
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    k.add(xf(sph(6, 4), [p[0] + Math.cos(a) * r, p[1], p[2] + Math.sin(a) * r], [0, 0, 0], [r * 0.75, r * 0.35, r * 0.75]), 0xffffff, 0);
  }
  k.add(xf(sph(6, 4), [p[0], p[1] + r * 0.2, p[2]], [0, 0, 0], r * 0.5), 0xffe066, 0);
}
// 胡萝卜：大部分埋在土里，头顶露出 peek 高
function carrotGeo(r, peek) {
  const pts = [[0, -0.22], [r * 0.35, -0.16], [r * 0.75, -0.07], [r, 0.0], [r * 0.97, peek * 0.5], [r * 0.8, peek * 0.9], [r * 0.4, peek * 1.08], [0, peek * 1.12]];
  return new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), 14);
}
// 胡萝卜缨子：n 根，每根一条茎 + 几片小叶
function fronds(k, n, h, R, lr, y0 = 0.05) {
  const w = k.w;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + 0.3, hh = h * (0.8 + 0.2 * ((i * 7) % 3) / 2);
    const rr = R * (0.5 + 0.5 * ((i * 5) % 3) / 2) * (1 + 1.0 * w);
    const tip = [Math.cos(a) * rr, y0 + hh * (1 - 0.45 * w), Math.sin(a) * rr];
    const mid = [tip[0] * 0.45, y0 + (tip[1] - y0) * 0.6, tip[2] * 0.45];
    k.add(seg([0, y0 - 0.01, 0], mid, 0.008, 0.006, 5), STEM, 0);
    k.add(seg(mid, tip, 0.006, 0.004, 5), STEM, 0);
    const col = i % 2 ? LEAF : LEAF_DK;
    const yaw = -a;
    leaf(k, col, mid, yaw + 0.8, 0.45, lr * 0.8, lr * 0.55, { cup: 0.3, droop: 0.9 });
    leaf(k, col, mid, yaw - 0.8, 0.45, lr * 0.8, lr * 0.55, { cup: 0.3, droop: 0.9 });
    leaf(k, col, tip, yaw + 0.5, 0.75, lr * 0.85, lr * 0.55, { cup: 0.3, droop: 1.2 });
    leaf(k, col, tip, yaw - 0.5, 0.75, lr * 0.85, lr * 0.55, { cup: 0.3, droop: 1.2 });
  }
}
// 郁金香的长叶子
function bladeLeaves(k, len) {
  [[0.3, 1.05], [2.4, 0.95], [4.3, 1.1]].forEach(([yaw, e], i) => leaf(k, i % 2 ? 0x7ccf8f : 0x68c27e, [0, 0.01, 0], yaw, e, len, len * 0.32, { cup: 0.5, tip: 0.18, droop: 0.9, line: LN_S }));
}

/* ---------------------------------------------------------------- materials & wilt */
const _hsl = {};
function wiltColor(hex) {
  const c = new THREE.Color(hex);
  c.getHSL(_hsl);
  let { h, s, l } = _hsl;
  if (h > 0.18 && h < 0.5) { h = 0.13 + (h - 0.18) * 0.3; s *= 0.58; l *= 0.88; } // 绿 → 枯黄
  else { s *= 0.62; l *= 0.88; }
  return new THREE.Color().setHSL(h, s, l);
}
// 弯腰：越高的地方越往 +x 歪、往下沉
function bend(geo, H, a) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i), u = Math.max(0, y / H);
    p.setXYZ(i, p.getX(i) + a * H * u * u, y * 0.95 - a * 0.35 * H * u * u * u, p.getZ(i));
  }
}
const BEND = { tomato: 0.16, strawberry: 0.1, carrot: 0.1, sunflower: 0.12, tulip: 0.14, pumpkin: 0.05, poinsettia: 0.1 };
const LEAFC = { tulip: 0x7ccf8f, carrot: LEAF, poinsettia: 0x3f9a5a };

/* ---------------------------------------------------------------- public: crops */
// buildCrop(id, stage, { toon, outlined }) → { root, setWilted(on, smooth = true), wilted, size, height, id, stage }
// root 原点在土面（作物根部），放到 buildFarmPlot 的 cells[i] 下面即可。
// 每帧调用 root.userData.anim(t)（t 是秒）：轻轻摆动；setWilted 的平滑过渡也靠它推进。
export function buildCrop(id, stage, { toon, outlined }) {
  if (!CROPS[id]) id = "tomato";
  stage = Math.max(0, Math.min(3, stage | 0));
  const C = { ...CROPS[id], leaf: LEAFC[id] };
  const fn = stage === 0 ? seedStage : stage === 1 ? sproutStage : B[id][stage - 2];
  const kF = makeKit(0), kW = makeKit(1);
  fn(kF, C);
  fn(kW, C);

  const root = new THREE.Group();
  const sway = new THREE.Group();
  root.add(sway);
  const groups = new Map();
  kF.parts.forEach((p, i) => {
    const key = `${p.group}|${p.color}|${p.line}`;
    if (!groups.has(key)) groups.set(key, { ...p, f: [], w: [] });
    groups.get(key).f.push(p.geo);
    groups.get(key).w.push(kW.parts[i].geo);
  });
  const size = new THREE.Box3();
  for (const g of groups.values()) for (const geo of g.f) { geo.computeBoundingBox(); size.union(geo.boundingBox); }
  const H = Math.max(0.12, size.max.y);
  const bendA = BEND[id] * (stage === 0 ? 1.2 : stage === 1 ? 2.2 : 1);

  const mats = new Map(), wiltMats = [], meshes = [];
  for (const g of groups.values()) {
    const geo = mergeAll(g.f), gw = mergeAll(g.w);
    if (g.group === "sway") bend(gw, H, bendA);
    const a = geo.attributes.position.array, b = gw.attributes.position.array;
    const d = new Float32Array(a.length);
    let moved = false;
    for (let i = 0; i < a.length; i++) { d[i] = b[i] - a[i]; if (Math.abs(d[i]) > 1e-5) moved = true; }
    if (moved) { geo.morphAttributes.position = [new THREE.BufferAttribute(d, 3)]; geo.morphTargetsRelative = true; }
    const mk = `${g.group}|${g.color}`;
    if (!mats.has(mk)) {
      const m = toon(g.color);
      mats.set(mk, m);
      if (g.group !== "base" && g.color !== 0xffffff) { m.userData.c0 = m.color.clone(); m.userData.c1 = wiltColor(g.color); wiltMats.push(m); }
    }
    let mesh = new THREE.Mesh(geo, mats.get(mk));
    if (g.line > 0) mesh = outlined(mesh, g.line);
    (g.group === "sway" ? sway : root).add(mesh);
    mesh.traverse((o) => { if (o.morphTargetInfluences) meshes.push(o); });
  }

  let w = 0, target = 0, lastT = null;
  const apply = (v) => {
    const e = v * v * (3 - 2 * v);
    for (const m of meshes) m.morphTargetInfluences[0] = e;
    for (const m of wiltMats) m.color.copy(m.userData.c0).lerp(m.userData.c1, e);
  };
  const ph = Math.random() * Math.PI * 2, spd = 0.9 + Math.random() * 0.3;
  const amp = stage === 0 ? 0.02 : 0.045;
  root.userData.anim = (t) => {
    const dt = lastT === null ? 0 : Math.min(0.1, Math.max(0, t - lastT));
    lastT = t;
    if (w !== target) { w = target > w ? Math.min(target, w + dt / 0.9) : Math.max(target, w - dt / 0.9); apply(w); }
    const a = amp * (1 - 0.6 * w);
    sway.rotation.z = Math.sin(t * 1.5 * spd + ph) * a;
    sway.rotation.x = Math.sin(t * 1.1 * spd + ph * 1.7) * a * 0.6;
  };
  root.userData.cropId = id;
  root.userData.stage = stage;
  return {
    root, id, stage,
    size: size.getSize(V()), // 包围盒尺寸（胡萝卜含埋在土里的部分）
    height: size.max.y, // 土面以上的高度
    get wilted() { return target === 1; },
    setWilted(on, smooth = true) {
      target = on ? 1 : 0;
      if (!smooth || lastT === null) { w = target; apply(w); }
    },
  };
}

/* ---------------------------------------------------------------- public: plot */
// buildFarmPlot({ cols, rows, cell, toon, outlined }) → { root, cells, width, depth, surfaceY }
// root 原点在菜地中心，底面 y = 0。cells 按行排：cells[row * cols + col]，row 0 在 -z（后面），col 0 在 -x。
// 每个 cell 是土垄顶上的一个空 Object3D，把 buildCrop(...).root 加进去就行。小木牌在左后角。
export function buildFarmPlot({ cols = 3, rows = 2, cell = 0.6, toon, outlined } = {}) {
  const parts = new Map();
  const add = (geo, color, line = 0.015) => {
    const key = `${color}|${line}`;
    if (!parts.has(key)) parts.set(key, { color, line, list: [] });
    parts.get(key).list.push(prep(geo));
  };
  const W = cols * cell, D = rows * cell, T = 0.07, H = 0.14, soilY = 0.075;
  // 底土
  add(new THREE.BoxGeometry(W + 0.02, soilY, D + 0.02).translate(0, soilY / 2, 0), SOIL_DK, 0);
  // 木边框（四块板）+ 板缝
  add(new THREE.BoxGeometry(W + T * 2, H, T).translate(0, H / 2, D / 2 + T / 2), WOOD);
  add(new THREE.BoxGeometry(W + T * 2, H, T).translate(0, H / 2, -D / 2 - T / 2), WOOD);
  add(new THREE.BoxGeometry(T, H, D).translate(W / 2 + T / 2, H / 2, 0), WOOD);
  add(new THREE.BoxGeometry(T, H, D).translate(-W / 2 - T / 2, H / 2, 0), WOOD);
  for (let c = 1; c < cols; c++) for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.012, H * 0.7, 0.01).translate(-W / 2 + c * cell, H * 0.45, s * (D / 2 + T + 0.002)), WOOD_DK, 0);
  for (let r = 1; r < rows; r++) for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.01, H * 0.7, 0.012).translate(s * (W / 2 + T + 0.002), H * 0.45, -D / 2 + r * cell), WOOD_DK, 0);
  // 四个角柱
  const P = T * 1.35;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(new THREE.BoxGeometry(P, H + 0.035, P).translate(sx * (W / 2 + T / 2), (H + 0.035) / 2, sz * (D / 2 + T / 2)), WOOD_DK);
  // 土垄：每行一条，圆滚滚的
  const R = cell * 0.36, ridgeH = R * 0.36;
  const surfaceY = soilY + ridgeH * 0.92;
  for (let r = 0; r < rows; r++) {
    const z = (r - (rows - 1) / 2) * cell;
    const g = new THREE.CapsuleGeometry(R, Math.max(0.01, W - R * 2 - 0.06), 4, 12);
    g.rotateZ(Math.PI / 2).scale(1, 0.36, 1).translate(0, soilY, z);
    add(g, SOIL);
  }
  // 垄沟里的小土块
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let r = 0; r <= rows; r++) {
    const z = (r - rows / 2) * cell;
    for (let i = 0; i < cols * 2; i++) {
      const s = 0.016 + rnd() * 0.014;
      add(xf(new THREE.DodecahedronGeometry(1, 0), [-W / 2 + (i + 0.5 + (rnd() - 0.5) * 0.6) * (W / (cols * 2)), soilY + 0.004, z + (r === 0 ? 0.05 : r === rows ? -0.05 : (rnd() - 0.5) * 0.06)], [rnd() * 3, rnd() * 3, 0], [s, s * 0.7, s]), CLOD, 0);
    }
  }
  // 左后角的小木牌：木桩（并到角柱的颜色里）+ 奶油色牌子 + 画上去的小芽和小爱心
  const sx = -W / 2 - T / 2, sz = -D / 2 - T / 2;
  add(new THREE.BoxGeometry(0.035, 0.36, 0.035).translate(sx + 0.02, 0.18, sz), WOOD_DK);
  const board = new THREE.BoxGeometry(0.24, 0.13, 0.025);
  add(xf(board, [sx + 0.03, 0.34, sz + 0.03], [0, -0.15, 0.06]), CREAM, 0.012);
  const signM = M([sx + 0.03, 0.34, sz + 0.03], [0, -0.15, 0.06]);
  const icon = [
    xf(new THREE.CylinderGeometry(0.006, 0.006, 0.05, 5), [-0.05, -0.02, 0.016]),
    xf(leafGeo(0.04, 0.03, { thick: 0.5, cup: 0, tip: 0 }), [-0.05, 0.004, 0.016], [Math.PI / 2, 0, 0.5]),
    xf(leafGeo(0.04, 0.03, { thick: 0.5, cup: 0, tip: 0 }), [-0.05, 0.004, 0.016], [Math.PI / 2, 0, Math.PI - 0.5]),
  ];
  for (const g of icon) add(g.applyMatrix4(signM), LEAF_DK, 0);
  const heart = [ell(0.016, 0.016, 0.006, 8, 6).translate(-0.011, 0.006, 0), ell(0.016, 0.016, 0.006, 8, 6).translate(0.011, 0.006, 0), xf(new THREE.ConeGeometry(0.023, 0.03, 4), [0, -0.012, 0], [Math.PI, Math.PI / 4, 0], [1, 1, 0.3])];
  for (const g of heart) add(g.translate(0.045, 0.0, 0.016).applyMatrix4(signM), 0xff8fab, 0);
  // 外面的几簇小草
  for (const [x, z] of [[W / 2 + T + 0.04, D / 2 + 0.02], [-W / 2 - T - 0.05, 0.1], [W * 0.15, D / 2 + T + 0.04], [W / 2 + T + 0.03, -D / 2 + 0.1]]) {
    for (let i = 0; i < 3; i++) add(xf(new THREE.ConeGeometry(0.016, 0.07 + i * 0.015, 5), [x + (i - 1) * 0.022, 0.035 + i * 0.007, z + (i % 2) * 0.012], [0, 0, (i - 1) * 0.35]), LEAF, 0.008);
  }

  const root = new THREE.Group();
  for (const p of parts.values()) {
    let m = new THREE.Mesh(mergeAll(p.list), toon(p.color));
    if (p.line > 0) m = outlined(m, p.line);
    root.add(m);
  }
  const cells = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const o = new THREE.Object3D();
    o.position.set((c - (cols - 1) / 2) * cell, surfaceY, (r - (rows - 1) / 2) * cell);
    o.userData.cell = { index: r * cols + c, col: c, row: r };
    root.add(o);
    cells.push(o);
  }
  root.userData.what = "farm";
  return { root, cells, width: W + T * 2, depth: D + T * 2, surfaceY };
}

/* ---------------------------------------------------------------- public: watering can */
// buildWateringCan({ toon, outlined }) → { root, spout }
// 原点在提手顶上（握的地方），壶嘴朝 +x、往上翘。spout 是壶嘴喷头外面一点的空 Object3D，本地 +x 指向出水方向。
// 浇水时绕 z 轴转负角度（比如 -0.6）让壶往前倾。
export function buildWateringCan({ toon, outlined }) {
  const parts = new Map();
  const add = (geo, color, line = 0.012) => {
    const key = `${color}|${line}`;
    if (!parts.has(key)) parts.set(key, { color, line, list: [] });
    parts.get(key).list.push(prep(geo));
  };
  const BODY = 0x8fd3ff, RIM = 0xffffff, ROSE = 0xffd166;
  const r = 0.078, bh = 0.13, by = -0.07 - bh / 2 - 0.004; // 壶身中心
  add(new THREE.CylinderGeometry(r, r * 1.04, bh, 18).translate(0, by, 0), BODY);
  add(ell(r * 0.98, 0.03, r * 0.98, 16, 6).translate(0, by + bh / 2, 0), BODY);
  // 提手：一道弧，从后面跨到前面，最高点在原点
  add(xf(new THREE.TorusGeometry(0.062, 0.012, 6, 16, Math.PI), [0, -0.062, 0]), BODY);
  // 壶嘴
  const a = [0.055, by - 0.035, 0], tip = [0.215, -0.05, 0];
  add(seg(a, tip, 0.017, 0.011, 8), BODY);
  // 白色箍 + 小盖
  add(xf(new THREE.TorusGeometry(r * 1.0, 0.009, 5, 20), [0, by + bh / 2 - 0.012, 0], [Math.PI / 2, 0, 0]), RIM, 0);
  add(xf(new THREE.TorusGeometry(r * 1.04, 0.009, 5, 20), [0, by - bh / 2 + 0.01, 0], [Math.PI / 2, 0, 0]), RIM, 0);
  add(new THREE.CylinderGeometry(0.03, 0.034, 0.016, 12).translate(-0.03, by + bh / 2 + 0.018, 0), RIM, 0.008);
  // 喷头：喇叭口
  const dir = V(tip[0] - a[0], tip[1] - a[1], 0).normalize();
  const qd = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), dir);
  const rose = new THREE.CylinderGeometry(0.034, 0.014, 0.036, 14).translate(0, 0.012, 0).applyQuaternion(qd).translate(...tip);
  add(rose, ROSE);
  const face = new THREE.CylinderGeometry(0.031, 0.031, 0.006, 14).translate(0, 0.031, 0).applyQuaternion(qd).translate(...tip);
  add(face, 0xfff3c4, 0);
  // 两边的小爱心贴纸
  for (const s of [1, -1]) {
    const hz = s * (r + 0.003);
    add(ell(0.013, 0.013, 0.004, 8, 6).translate(-0.0085, by + 0.01, hz), 0xff8fab, 0);
    add(ell(0.013, 0.013, 0.004, 8, 6).translate(0.0085, by + 0.01, hz), 0xff8fab, 0);
    add(xf(new THREE.ConeGeometry(0.0215, 0.024, 4), [0, by - 0.006, hz], [Math.PI, Math.PI / 4, 0], [1, 1, 0.25]), 0xff8fab, 0);
  }
  const root = new THREE.Group();
  for (const p of parts.values()) {
    let m = new THREE.Mesh(mergeAll(p.list), toon(p.color));
    if (p.line > 0) m = outlined(m, p.line);
    root.add(m);
  }
  const spout = new THREE.Object3D();
  spout.position.set(tip[0] + dir.x * 0.04, tip[1] + dir.y * 0.04, 0);
  spout.quaternion.setFromUnitVectors(V(1, 0, 0), dir);
  root.add(spout);
  root.userData.what = "can";
  return { root, spout };
}

/* ---------------------------------------------------------------- public: water drops */
// buildWaterDrops({ fall, count, duration }) → { root, play(), update(dt), active, fall }
// 原点在壶嘴喷头。水珠往 +x 方向斜着落下去，落 fall 的高度后在那里溅一个小水圈。
// fall 可以随时改（s.fall = 壶嘴到土面的高度），水壶动的时候每帧更新一下就行。
// root 不要跟着水壶一起倾斜：放到场景 / 菜地里，每帧把位置设成 spout 的世界坐标，用 root.rotation.y 调方向。
// 两个 InstancedMesh（水珠、水圈），一共 2 次绘制。
export function buildWaterDrops({ fall = 0.42, count = 26, duration = 0.9 } = {}) {
  const root = new THREE.Group();
  root.visible = false;
  const dg = sph(8, 6);
  const dp = dg.attributes.position;
  for (let i = 0; i < dp.count; i++) { const y = dp.getY(i); if (y > 0) { const k = 1 - y * 0.75; dp.setXYZ(i, dp.getX(i) * k, y * 1.6, dp.getZ(i) * k); } }
  dg.computeVertexNormals();
  const drops = new THREE.InstancedMesh(dg, new THREE.MeshBasicMaterial({ color: 0x8fd6ff }), count);
  const NR = 6;
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75, depthWrite: false, side: THREE.DoubleSide });
  const rings = new THREE.InstancedMesh(new THREE.RingGeometry(0.7, 1, 18).rotateX(-Math.PI / 2), ringMat, NR);
  rings.instanceColor = null;
  drops.frustumCulled = rings.frustumCulled = false;
  root.add(drops, rings);
  root.traverse((n) => { n.raycast = () => {}; });
  const D = Array.from({ length: count }, () => ({ p: V(), v: V(), on: false, r: 0.012 }));
  const RG = Array.from({ length: NR }, () => ({ p: V(), t: 9 }));
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = V(), up = V(0, 1, 0), tmp = V();
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  let t = 9, emitted = 0, ri = 0;
  const s = {
    root, active: false, fall,
    play() { t = 0; emitted = 0; s.active = true; root.visible = true; for (const d of D) d.on = false; for (const r of RG) r.t = 9; },
    update(dt) {
      if (!s.active) return;
      t += dt;
      const want = Math.min(count, Math.floor((t / duration) * count));
      while (emitted < want) {
        const d = D[emitted++];
        d.on = true;
        d.p.set(0, 0, (Math.random() - 0.5) * 0.03);
        d.v.set(0.25 + Math.random() * 0.3, 0.0 + Math.random() * 0.25, (Math.random() - 0.5) * 0.4);
        d.r = 0.014 + Math.random() * 0.008;
      }
      let alive = 0;
      D.forEach((d, i) => {
        if (!d.on) { drops.setMatrixAt(i, zero); return; }
        d.v.y -= 3.2 * dt;
        d.p.addScaledVector(d.v, dt);
        if (d.p.y < -s.fall) {
          d.on = false;
          const r = RG[ri++ % NR]; r.p.set(d.p.x, -s.fall + 0.003, d.p.z); r.t = 0;
          drops.setMatrixAt(i, zero);
          return;
        }
        alive++;
        q.setFromUnitVectors(up, tmp.copy(d.v).normalize().negate());
        drops.setMatrixAt(i, m4.compose(d.p, q, sc.setScalar(d.r)));
      });
      let ringsOn = 0;
      RG.forEach((r, i) => {
        r.t += dt;
        const k = r.t / 0.45;
        if (k >= 1) { rings.setMatrixAt(i, zero); return; }
        ringsOn++;
        const rad = 0.015 + k * 0.05;
        rings.setMatrixAt(i, m4.compose(r.p, q.identity(), sc.set(rad, 1, rad)));
      });
      ringMat.opacity = 0.75;
      drops.instanceMatrix.needsUpdate = rings.instanceMatrix.needsUpdate = true;
      if (emitted >= count && !alive && !ringsOn) { s.active = false; root.visible = false; }
    },
  };
  for (let i = 0; i < count; i++) drops.setMatrixAt(i, zero);
  for (let i = 0; i < NR; i++) rings.setMatrixAt(i, zero);
  return s;
}

/* ---------------------------------------------------------------- public: harvest pop */
// buildHarvestPop({ toon }) → { root, play(emojiOrCropId?), update(dt), active }
// 原点放在格子的土面上。播放约 1.4 秒：一团白烟、一圈光、星星往外蹦，作物的 emoji 弹上来再淡出。
// play("tomato") 或 play("🍅") 都行；不传就是 ✨。
export function buildHarvestPop({ toon } = {}) {
  const root = new THREE.Group();
  root.visible = false;
  // emoji 贴图（带一圈柔和的白底，在叶子上也看得清）
  const cv = document.createElement("canvas");
  cv.width = cv.height = 128;
  const g2 = cv.getContext("2d");
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const spMat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false });
  const sprite = new THREE.Sprite(spMat);
  sprite.renderOrder = 10;
  const draw = (e) => {
    g2.clearRect(0, 0, 128, 128);
    const gr = g2.createRadialGradient(64, 64, 20, 64, 64, 62);
    gr.addColorStop(0, "rgba(255,255,255,0.95)"); gr.addColorStop(0.7, "rgba(255,255,255,0.75)"); gr.addColorStop(1, "rgba(255,255,255,0)");
    g2.fillStyle = gr;
    g2.beginPath(); g2.arc(64, 64, 62, 0, Math.PI * 2); g2.fill();
    g2.textAlign = "center"; g2.textBaseline = "middle";
    g2.font = "72px 'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji',sans-serif";
    g2.fillText(e, 64, 70);
    tex.needsUpdate = true;
  };
  // 星星（菱形小闪片）
  const NS = 12;
  const starMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false });
  const stars = new THREE.InstancedMesh(new THREE.OctahedronGeometry(1, 0).scale(0.45, 1, 0.45), starMat, NS);
  const starCols = [0xffe066, 0xffffff, 0xffb3c8, 0xffd23f];
  for (let i = 0; i < NS; i++) stars.setColorAt(i, new THREE.Color(starCols[i % starCols.length]));
  // 白烟
  const NP = 6;
  const puffMat = toon ? toon(0xffffff, { transparent: true, emissive: 0x666666 }) : new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true });
  const puffs = new THREE.InstancedMesh(sph(10, 8), puffMat, NP);
  // 光圈
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xfff3b0, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 28).rotateX(-Math.PI / 2), ringMat);
  ring.position.y = 0.02;
  stars.frustumCulled = puffs.frustumCulled = false;
  root.add(puffs, ring, stars, sprite);
  root.traverse((n) => { n.raycast = () => {}; });
  const S = Array.from({ length: NS }, (_, i) => ({ a: (i / NS) * Math.PI * 2, up: 0.35 + (i % 3) * 0.25, sp: 0.4 + (i % 4) * 0.1 }));
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e3 = new THREE.Euler(), p = V(), sc = V();
  const DUR = 1.4;
  let t = 9;
  const easeBack = (x) => { const c = 1.9; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };
  const s = {
    root, active: false,
    play(what) {
      draw(CROPS[what] ? CROPS[what].emoji : what || "✨");
      ringMat.color.set(CROPS[what] ? CROPS[what].color : 0xfff3b0).lerp(new THREE.Color(0xffffff), 0.45);
      t = 0; s.active = true; root.visible = true;
      s.update(0);
    },
    update(dt) {
      if (!s.active) return;
      t += dt;
      const k = t / DUR;
      if (k >= 1) { s.active = false; root.visible = false; return; }
      // emoji：弹上来（带回弹），停一下，往上飘着淡出
      const up = Math.min(1, t / 0.45);
      const sz = 0.3 * Math.max(0.001, easeBack(up));
      sprite.scale.set(sz, sz, 1);
      sprite.position.y = 0.12 + 0.3 * (1 - Math.pow(1 - up, 3)) + Math.max(0, t - 0.8) * 0.18;
      spMat.opacity = t < 0.95 ? 1 : Math.max(0, 1 - (t - 0.95) / 0.45);
      // 光圈
      const rk = Math.min(1, t / 0.5);
      ring.scale.setScalar(0.05 + rk * 0.3);
      ringMat.opacity = 0.8 * (1 - rk);
      ring.visible = rk < 1;
      // 星星
      S.forEach((st, i) => {
        const tt = Math.max(0, t - 0.05 - (i % 3) * 0.04);
        const go = 1 - Math.exp(-tt * 4.5);
        const life = Math.max(0, 1 - tt / 0.95);
        p.set(Math.cos(st.a) * go * st.sp * 0.6, 0.12 + go * st.up * 0.7 - tt * tt * 0.3, Math.sin(st.a) * go * st.sp * 0.6);
        const twinkle = 0.75 + 0.25 * Math.sin(tt * 30 + i);
        q.setFromEuler(e3.set(0, tt * 6 + i, 0));
        stars.setMatrixAt(i, m4.compose(p, q, sc.setScalar(0.045 * life * twinkle * Math.min(1, tt * 12))));
      });
      stars.instanceMatrix.needsUpdate = true;
      starMat.opacity = Math.min(1, (1 - k) * 2.5);
      // 白烟：一团小球鼓起来又缩没
      const pk = Math.min(1, t / 0.6);
      for (let i = 0; i < NP; i++) {
        const a = (i / NP) * Math.PI * 2 + 0.4;
        const r = 0.06 + pk * 0.12;
        p.set(Math.cos(a) * r, 0.03 + pk * 0.05 + (i % 2) * 0.02, Math.sin(a) * r);
        puffs.setMatrixAt(i, m4.compose(p, q.identity(), sc.setScalar(Math.max(0.0001, 0.055 * Math.sin(pk * Math.PI) * (1 - 0.2 * (i % 2))))));
      }
      puffs.instanceMatrix.needsUpdate = true;
      puffMat.opacity = 0.95 * (1 - pk * 0.6);
      puffs.visible = pk < 1;
    },
  };
  return s;
}
