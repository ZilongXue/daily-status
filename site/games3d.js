// 三个小游戏的 Q 版道具（Three.js r170）：寻宝（宝箱、挖土堆、小铲子、藏宝标记）、钓鱼大赛（奖杯、记分牌）、默契问答（爱心罐）。
// 全部程序化搭出来，没有外部资源；同一个道具里同色同描边的零件合并成一个网格。
// 材质和描边由调用方传进来的 toon() / outlined() 决定，和小岛保持一致。
//
// 约定：root 原点在地面接触点，+Y 朝上，正面朝 +Z。
//   宝箱 0.46 宽 × 0.33 高（关着）× 0.31 深；盖子铰链在后上沿。
//   土堆直径约 0.66，洞直径约 0.28；小旗插在 +x 那边，高 0.36。
//   小铲子长 0.39：原点在握把横杆中间，铲杆沿 −Y，铲面朝 ±Z。
//   奖杯 0.41 高，底座 0.22 × 0.17；记分牌 0.9 宽 × 1.0 高；爱心罐 0.38 高；藏宝标记直径 0.5（贴地）。
// 这些道具都会动 / 变色 / 出现消失，所以 root.userData.dynamic = true（小岛的静态合批会跳过它们）。
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const TAU = Math.PI * 2;
const LN = 0.013, LN_S = 0.008; // 描边：主体 / 小零件
const FONT = "'PingFang SC','Hiragino Sans GB','Microsoft YaHei','Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji',sans-serif";
const EMOJI_FONT = "'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji',sans-serif";

/* ---------------------------------------------------------------- palette */
const WOOD = 0xc98a55, WOOD_DK = 0x9a6440, WOOD_LT = 0xdcaa74;
const GOLD = 0xffcf4a, GOLD_LT = 0xfff0a8;
const SOIL = 0x8a5c3a, SOIL_DK = 0x5e3d28, SOIL_LT = 0x9e6c47, HOLE = 0x2e1c12;
const CREAM = 0xfff3e2, PINK = 0xff8fab, PINK_DK = 0xff5c8a;
const METAL = 0xd5dde3, METAL_DK = 0xa9b4bd;

/* ---------------------------------------------------------------- geometry helpers */
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const sph = (r, ws = 12, hs = 9) => new THREE.SphereGeometry(r, ws, hs);
const ell = (rx, ry, rz, ws = 12, hs = 9) => new THREE.SphereGeometry(1, ws, hs).scale(rx, ry, rz);
const cyl = (rt, rb, h, n = 12) => new THREE.CylinderGeometry(rt, rb, h, n);
const lathe = (pts, n = 24) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), n);
const _e = new THREE.Euler(), _q = new THREE.Quaternion(), _p = V(), _s = V();
// 先缩放、再旋转（XYZ）、最后平移
function xf(geo, p = [0, 0, 0], r = [0, 0, 0], s = 1) {
  _q.setFromEuler(_e.set(r[0], r[1], r[2]));
  if (typeof s === "number") _s.set(s, s, s); else _s.set(s[0], s[1], s[2]);
  return geo.applyMatrix4(new THREE.Matrix4().compose(_p.set(p[0], p[1], p[2]), _q, _s));
}
// a → b 的小圆柱
function seg(a, b, ra, rb = ra, n = 7) {
  const A = V(...a), d = V(...b).sub(A), len = d.length();
  const g = new THREE.CylinderGeometry(rb, ra, len, n, 1).translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), d.normalize()));
  return g.translate(A.x, A.y, A.z);
}
// 圆角盒子：边缘两段圆角，法线顺着圆角方向（卡通光照下看着软）
function roundBox(w, h, d, r, k = 2) {
  const n = 2 * k + 1;
  const g = new THREE.BoxGeometry(1, 1, 1, n, n, n);
  const p = g.attributes.position, nm = g.attributes.normal;
  const half = [w / 2, h / 2, d / 2];
  const map = (u, hf) => {
    const i = Math.round((u + 0.5) * n);
    if (i <= k) return -hf + r * (i / k);
    if (i >= n - k) return hf - r * ((n - i) / k);
    return -(hf - r) + (2 * (hf - r)) * ((i - k) / (n - 2 * k));
  };
  const v = V(), inner = V(), dir = V();
  for (let i = 0; i < p.count; i++) {
    v.set(map(p.getX(i), half[0]), map(p.getY(i), half[1]), map(p.getZ(i), half[2]));
    inner.set(
      THREE.MathUtils.clamp(v.x, -half[0] + r, half[0] - r),
      THREE.MathUtils.clamp(v.y, -half[1] + r, half[1] - r),
      THREE.MathUtils.clamp(v.z, -half[2] + r, half[2] - r));
    dir.subVectors(v, inner);
    if (dir.lengthSq() > 1e-12) { dir.normalize(); v.copy(inner).addScaledVector(dir, r); nm.setXYZ(i, dir.x, dir.y, dir.z); }
    p.setXYZ(i, v.x, v.y, v.z);
  }
  return g;
}
// 胖胖的爱心（正面朝 +z，高约 2s）
function heartGeo(s, depth = 0.45) {
  const sh = new THREE.Shape();
  sh.moveTo(0, -0.95);
  sh.bezierCurveTo(0.25, -0.62, 1.0, -0.25, 1.0, 0.3);
  sh.bezierCurveTo(1.0, 0.9, 0.32, 1.02, 0, 0.55);
  sh.bezierCurveTo(-0.32, 1.02, -1.0, 0.9, -1.0, 0.3);
  sh.bezierCurveTo(-1.0, -0.25, -0.25, -0.62, 0, -0.95);
  const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: true, bevelThickness: 0.22, bevelSize: 0.16, bevelSegments: 2, curveSegments: 6 });
  g.translate(0, 0, -depth / 2);
  return g.scale(s, s, s);
}
// 五角星（正面朝 +z）
function starGeo(ro, ri, depth) {
  const sh = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + (i / 10) * TAU, r = i % 2 ? ri : ro;
    if (i === 0) sh.moveTo(Math.cos(a) * r, Math.sin(a) * r); else sh.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: true, bevelThickness: depth * 0.4, bevelSize: depth * 0.3, bevelSegments: 1 });
  return g.translate(0, 0, -depth / 2);
}
// 只留 position / normal，并保证有索引，这样不同几何体可以合并
function prep(g) {
  for (const n of Object.keys(g.attributes)) if (n !== "position" && n !== "normal") g.deleteAttribute(n);
  if (!g.index) g.setIndex([...Array(g.attributes.position.count).keys()]);
  if (!g.attributes.normal) g.computeVertexNormals();
  g.clearGroups();
  return g;
}
const mergeAll = (list) => (list.length === 1 ? list[0] : mergeGeometries(list, false));
const noRay = (o) => { o.traverse((n) => { n.raycast = () => {}; }); return o; };
const smooth = (x) => { x = THREE.MathUtils.clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const easeBack = (x) => { const c = 1.9; x = THREE.MathUtils.clamp(x, 0, 1); return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };

/* ---------------------------------------------------------------- kit：收集零件，按（颜色, 描边）合并 */
function makeKit({ toon, outlined }) {
  const mats = new Map();
  const mat = (color) => { let m = mats.get(color); if (!m) mats.set(color, (m = toon(color))); return m; };
  let parts = new Map();
  const K = {
    mat,
    add(geo, color, line = LN) {
      const key = `${color}|${line}`;
      if (!parts.has(key)) parts.set(key, { color, line, list: [] });
      parts.get(key).list.push(prep(geo));
      return geo;
    },
    // 把攒下的零件合并成网格挂到 parent 上，然后清空（下一组零件用）
    flush(parent) {
      for (const p of parts.values()) {
        let m = new THREE.Mesh(mergeAll(p.list), mat(p.color));
        if (p.line > 0) m = outlined(m, p.line);
        parent.add(m);
      }
      parts = new Map();
      return parent;
    },
    // 单独一个网格（要单独改颜色 / 发光的零件）
    one(geo, material, line = LN) {
      let m = new THREE.Mesh(geo, material);
      if (line > 0) m = outlined(m, line);
      return m;
    },
  };
  return K;
}

/* ---------------------------------------------------------------- shared textures */
let _halo = null, _spark = null;
function haloTex() {
  if (_halo) return _halo;
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const g = c.getContext("2d");
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.35, "rgba(255,255,255,0.55)"); gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  _halo = new THREE.CanvasTexture(c); _halo.colorSpace = THREE.SRGBColorSpace;
  return _halo;
}
// 四角星闪光
function sparkTex() {
  if (_spark) return _spark;
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const g = c.getContext("2d");
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 14);
  gr.addColorStop(0, "rgba(255,255,255,0.9)"); gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  g.fillStyle = "#fff";
  g.beginPath();
  g.moveTo(32, 2); g.quadraticCurveTo(35, 29, 62, 32); g.quadraticCurveTo(35, 35, 32, 62);
  g.quadraticCurveTo(29, 35, 2, 32); g.quadraticCurveTo(29, 29, 32, 2);
  g.fill();
  _spark = new THREE.CanvasTexture(c); _spark.colorSpace = THREE.SRGBColorSpace;
  return _spark;
}
function glowSprite(tex, color, size, opacity = 1, additive = true) {
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color, transparent: true, opacity, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending }));
  sp.scale.setScalar(size);
  sp.raycast = () => {};
  sp.userData.noShadow = true;
  return sp;
}
// 贴纸 / 告示用的画布材质：卡通光照 + 一点点自发光（黄昏也看得清字）
function canvasMat(toon, w, h, glow = 0.3) {
  const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const material = toon(0xffffff, { map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: glow });
  return { cv, g: cv.getContext("2d"), tex, material };
}
// 文字太长就缩字号
function fitFont(g, text, weight, size, maxW, family = FONT) {
  let s = size;
  for (; s > 12; s -= 2) { g.font = `${weight} ${s}px ${family}`; if (g.measureText(text).width <= maxW) break; }
  return s;
}

/* ================================================================ 1. 宝箱 */
// buildChest({ toon, outlined }) → { root, lid, setOpen(k), update(t, dt) }
// 0.46 宽，正面（锁）朝 +z。setOpen(0..1)：盖子绕后上沿往后掀开到约 110°，金币堆和粉色爱心信慢慢升起来。
// update(t, dt)：打开超过一半时金币一闪一闪、上面飘几颗小星星。
export function buildChest({ toon, outlined }) {
  const K = makeKit({ toon, outlined });
  const W = 0.44, H = 0.22, D = 0.3, R = D / 2, FL = 0.74; // 盖子是压扁的半圆柱
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  // 箱身 + 木板缝
  K.add(roundBox(W, H, D, 0.022).translate(0, H / 2, 0), WOOD);
  for (const y of [0.075, 0.145]) K.add(new THREE.BoxGeometry(W - 0.03, 0.007, 0.006).translate(0, y, D / 2 + 0.001), WOOD_DK, 0);
  for (const y of [0.075, 0.145]) K.add(new THREE.BoxGeometry(W - 0.03, 0.007, 0.006).translate(0, y, -D / 2 - 0.001), WOOD_DK, 0);
  // 金边：底边、上沿、两条竖箍
  K.add(roundBox(W + 0.014, 0.032, D + 0.014, 0.01).translate(0, 0.016, 0), GOLD);
  K.add(roundBox(W + 0.014, 0.026, D + 0.014, 0.008).translate(0, H - 0.011, 0), GOLD);
  for (const x of [-0.145, 0.145]) K.add(roundBox(0.036, H - 0.02, D + 0.01, 0.006).translate(x, H / 2, 0), GOLD, 0);
  // 里面（打开才看得见）
  K.add(new THREE.BoxGeometry(W - 0.04, 0.004, D - 0.04).translate(0, H + 0.003, 0), 0x4a2c1c, 0);
  // 爱心锁：挂在正面中间，带钥匙孔
  K.add(heartGeo(0.034, 0.5).translate(0, H - 0.075, D / 2 + 0.022), GOLD, LN_S);
  K.add(xf(new THREE.TorusGeometry(0.018, 0.006, 5, 10, Math.PI), [0, H - 0.05, D / 2 + 0.022]), GOLD_LT, LN_S);
  K.add(cyl(0.007, 0.007, 0.01, 8).rotateX(Math.PI / 2).translate(0, H - 0.07, D / 2 + 0.042), 0x4a2c1c, 0);
  K.add(new THREE.BoxGeometry(0.006, 0.016, 0.01).translate(0, H - 0.081, D / 2 + 0.042), 0x4a2c1c, 0);
  // 小高光
  K.add(ell(0.012, 0.008, 0.004, 6, 4).translate(-0.012, H - 0.06, D / 2 + 0.043), 0xffffff, 0);
  K.flush(body);

  // 盖子：pivot 在后上沿，盖子沿 +z 铺过去
  const lid = new THREE.Group();
  lid.position.set(0, H, -D / 2);
  const dome = (r, w) => new THREE.CylinderGeometry(r, r, w, 18, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).scale(1, FL, 1).translate(0, 0, R);
  K.add(dome(R, W), WOOD);
  K.add(new THREE.BoxGeometry(W - 0.01, 0.006, D - 0.01).translate(0, -0.004, R), 0x4a2c1c, 0); // 盖子底面（打开时是深色的里子）
  for (const x of [-0.145, 0.145]) K.add(dome(R + 0.007, 0.036).translate(x, 0, 0), GOLD, LN_S);
  K.add(roundBox(W + 0.014, 0.022, D + 0.014, 0.008).translate(0, 0.011, R), GOLD);
  // 锁扣（关着时压在爱心锁上面）
  K.add(roundBox(0.05, 0.05, 0.014, 0.01).translate(0, -0.004, D + 0.012), GOLD, LN_S);
  K.add(ell(0.016, 0.006, 0.003, 6, 4).translate(-0.06, 0.08, R * 0.55 + 0.06).rotateX(-0.6), 0xffffff, 0);
  K.flush(lid);
  body.add(lid);

  // 宝藏：发光金币堆 + 爱心信
  const treasure = new THREE.Group();
  treasure.position.y = H;
  const pileMat = toon(0xf5b52e, { emissive: 0xff9a00, emissiveIntensity: 0.22 });
  const coinMat = toon(0xffe066, { emissive: 0xffb000, emissiveIntensity: 0.3 });
  const pile = new THREE.Mesh(ell(0.18, 0.07, 0.12, 16, 8).translate(0, -0.005, 0), pileMat);
  treasure.add(outlined(pile, LN_S));
  const coinGeos = [];
  const coinSpots = [[-0.11, 0.035, 0.05, 0.4, 0.3], [-0.04, 0.062, 0.02, -0.2, 0.1], [0.06, 0.055, 0.06, 0.3, -0.4], [0.12, 0.03, -0.02, -0.5, 0.2],
    [-0.08, 0.05, -0.05, 0.1, 0.6], [0.02, 0.07, -0.04, 0.5, 0.0], [0.1, 0.045, 0.04, -0.2, -0.3], [-0.14, 0.02, -0.03, 0.6, 0.2]];
  for (const [x, y, z, rx, rz] of coinSpots) coinGeos.push(prep(xf(cyl(0.026, 0.026, 0.008, 12), [x, y, z], [rx, 0, rz])));
  // 一小摞
  for (let i = 0; i < 3; i++) coinGeos.push(prep(cyl(0.024, 0.024, 0.008, 12).translate(-0.135 + i * 0.002, 0.04 + i * 0.01, 0.075)));
  treasure.add(outlined(new THREE.Mesh(mergeAll(coinGeos), coinMat), 0.006));
  // 宝石
  const gem = (c, p, s) => K.add(xf(new THREE.OctahedronGeometry(1, 0), p, [0.3, 0.5, 0.2], [s, s * 1.3, s]), c, LN_S);
  gem(0x7fe3ff, [0.14, 0.055, 0.035], 0.022);
  gem(0xc79bff, [-0.025, 0.075, 0.065], 0.018);
  // 爱心封口的信：斜插在金币里
  const ENV = M4([0.03, 0.085, -0.035], [-0.42, 0.18, 0.08]);
  K.add(roundBox(0.12, 0.08, 0.008, 0.006).applyMatrix4(ENV), 0xffd6e2, LN_S);
  // 信封的 V 形折线 + 爱心封口
  for (const s of [1, -1]) K.add(xf(new THREE.BoxGeometry(0.07, 0.005, 0.003), [s * 0.029, 0.019, 0.0045], [0, 0, s * -0.5]).applyMatrix4(ENV), 0xf08aa8, 0);
  K.add(heartGeo(0.0115, 0.6).translate(0, 0.004, 0.0075).applyMatrix4(ENV), 0xe8365f, 0);
  K.flush(treasure);
  body.add(treasure);

  // 暖光 + 小星星
  const halo = glowSprite(haloTex(), 0xffc866, 0.62, 0);
  halo.position.set(0, H + 0.1, 0);
  body.add(halo);
  const sparks = [];
  const sparkSpots = [[-0.12, 0.13, 0.06], [0.05, 0.2, 0.02], [0.15, 0.11, -0.02], [-0.03, 0.15, 0.09], [0.1, 0.24, 0.07], [-0.15, 0.22, -0.02]];
  for (const [x, y, z] of sparkSpots) {
    const s = glowSprite(sparkTex(), 0xfff2b0, 0.06, 0);
    s.position.set(x, H + y, z);
    s.visible = false;
    body.add(s);
    sparks.push(s);
  }

  let open = 0;
  const api = {
    root, lid, body,
    setOpen(k) {
      open = THREE.MathUtils.clamp(k, 0, 1);
      lid.rotation.x = -THREE.MathUtils.degToRad(110) * open;
      const rise = smooth((open - 0.12) / 0.55);
      treasure.visible = rise > 0.001;
      treasure.scale.set(0.85 + 0.15 * rise, Math.max(0.001, rise), 0.85 + 0.15 * rise);
      halo.material.opacity = 0.55 * rise;
      halo.visible = rise > 0.001;
    },
    update(t) {
      const on = smooth((open - 0.5) / 0.3);
      coinMat.emissiveIntensity = 0.28 + on * (0.1 + 0.1 * Math.sin(t * 3.1));
      pileMat.emissiveIntensity = 0.2 + on * (0.06 + 0.06 * Math.sin(t * 2.2 + 1));
      halo.material.opacity = 0.55 * smooth((open - 0.12) / 0.55) * (0.88 + 0.12 * Math.sin(t * 2.3));
      sparks.forEach((s, i) => {
        const ph = (t * 0.9 + i * 0.37) % 1;
        const k = Math.sin(ph * Math.PI) ** 2 * on;
        s.visible = k > 0.01;
        s.material.opacity = k;
        s.scale.setScalar(0.025 + 0.04 * k);
        s.material.rotation = t * 1.5 + i;
        s.position.y = H + sparkSpots[i][1] + ph * 0.05;
      });
    },
  };
  api.setOpen(0);
  root.userData.dynamic = true;
  root.userData.what = "chest";
  return api;
}
function M4(p, r) { return new THREE.Matrix4().compose(V(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)), V(1, 1, 1)); }

/* ================================================================ 2. 挖土堆 */
// buildDigMound({ toon, outlined }) → { root, setBand(band), update(t, dt), pop(t0) }
// 土堆直径约 0.66，中间深色洞（直径约 0.28）；+x 那边插一面小三角旗（0.36 高）。
// setBand("hot"|"warm"|"cool"|"cold"|"found") 改旗子颜色；pop(t0) 之后每帧 update(t)：土堆弹一下、几块土飞出来。
// t / t0 用同一个时钟（秒）。小旗每帧随风轻轻摆（也要 update）。
export const BAND_COLORS = { hot: 0xff5a3c, warm: 0xffb340, cool: 0x8ec9ff, cold: 0x4a7bd6, found: 0xffd34d };
export function buildDigMound({ toon, outlined }) {
  const K = makeKit({ toon, outlined });
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  // 不太圆的土堆：按角度轻轻起伏（三层用同一个函数，接缝对得上）
  const wob = (a) => 1 + 0.055 * Math.sin(3 * a + 1.1) + 0.035 * Math.sin(5 * a + 0.3);
  const lumpy = (g) => {
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i), f = wob(Math.atan2(z, x)); p.setX(i, x * f); p.setZ(i, z * f); }
    g.computeVertexNormals();
    return g;
  };
  K.add(lumpy(lathe([[0.33, 0.0], [0.31, 0.02], [0.27, 0.05], [0.22, 0.072], [0.19, 0.076], [0.165, 0.066]], 28)), SOIL);
  K.add(lumpy(lathe([[0.165, 0.066], [0.152, 0.045], [0.143, 0.02], [0.136, 0.004]], 28)), SOIL_DK, LN_S);
  K.add(lumpy(new THREE.CircleGeometry(0.14, 28).rotateX(-Math.PI / 2).translate(0, 0.004, 0)), HOLE, 0);
  // 散落的小土块、小石子
  for (const [x, z, s] of [[-0.28, 0.12, 0.03], [0.05, 0.31, 0.026], [-0.18, -0.25, 0.032], [0.3, -0.12, 0.022], [-0.33, -0.05, 0.02]]) {
    K.add(xf(new THREE.IcosahedronGeometry(1, 0), [x, s * 0.4, z], [x * 3, z * 5, 0], [s, s * 0.7, s]), SOIL_LT, LN_S);
  }
  K.add(xf(new THREE.IcosahedronGeometry(1, 0), [0.21, 0.02, 0.24], [0.4, 0.2, 0], [0.026, 0.018, 0.022]), 0xc9c2b8, LN_S);
  // 草
  for (const [x, z] of [[-0.36, 0.18], [0.36, 0.06], [0.0, -0.36]]) {
    for (let i = 0; i < 3; i++) K.add(xf(cyl(0, 0.014, 0.06 + i * 0.014, 5), [x + (i - 1) * 0.02, 0.03 + i * 0.007, z + (i % 2) * 0.012], [0, 0, (i - 1) * 0.35]), 0x6fcf86, LN_S);
  }
  K.flush(body);
  // 小旗杆
  const pole = new THREE.Group();
  pole.position.set(0.27, 0, 0.1);
  pole.rotation.z = -0.07;
  K.add(cyl(0.007, 0.008, 0.35, 6).translate(0, 0.175, 0), WOOD_LT, LN_S);
  K.add(sph(0.014, 8, 6).translate(0, 0.355, 0), CREAM, LN_S);
  K.flush(pole);
  body.add(pole);
  // 三角旗（单独材质，换颜色）
  const flagMat = toon(BAND_COLORS.cool);
  const sh = new THREE.Shape();
  sh.moveTo(0, 0.045); sh.lineTo(0.14, 0.004); sh.lineTo(0, -0.045); sh.lineTo(0, 0.045);
  const fg = new THREE.ExtrudeGeometry(sh, { depth: 0.008, bevelEnabled: false });
  fg.translate(0.007, 0, -0.004);
  const fp = fg.attributes.position;
  for (let i = 0; i < fp.count; i++) fp.setZ(i, fp.getZ(i) + 0.012 * Math.sin(fp.getX(i) * 30));
  fg.computeVertexNormals();
  const flagPivot = new THREE.Group();
  flagPivot.position.y = 0.3;
  const flag = outlined(new THREE.Mesh(fg, flagMat), LN_S);
  flagPivot.add(flag);
  pole.add(flagPivot);

  // 飞起来的土块（一个 InstancedMesh）
  const NC = 10;
  const clods = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), toon(SOIL_LT), NC);
  clods.visible = false;
  clods.frustumCulled = false;
  clods.raycast = () => {};
  clods.userData.noShadow = true;
  root.add(clods);
  const C = Array.from({ length: NC }, (_, i) => {
    const a = (i / NC) * TAU + (i % 3) * 0.4;
    const sp = 0.35 + ((i * 37) % 10) / 22;
    return { a, vx: Math.cos(a) * sp, vz: Math.sin(a) * sp, vy: 1.1 + ((i * 53) % 10) / 16, s: 0.014 + ((i * 29) % 10) / 800, spin: i * 1.7 };
  });
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e3 = new THREE.Euler(), pv = V(), sc = V();
  let popT = null;
  const DUR = 0.95;

  const api = {
    root, body, flag,
    band: "cool",
    setBand(band) {
      api.band = band;
      flagMat.color.setHex(BAND_COLORS[band] ?? BAND_COLORS.cool);
      flagMat.emissive.setHex(band === "found" ? 0x7a5200 : 0x000000);
    },
    pop(t0) { popT = t0; clods.visible = true; },
    update(t) {
      flagPivot.rotation.y = Math.sin(t * 2.6) * 0.28 + Math.sin(t * 4.1) * 0.08;
      if (popT == null) return;
      const e = t - popT;
      if (e < 0) return;
      // 土堆：先压扁一下再弹起来（带回弹）
      const k = Math.min(1, e / 0.42);
      const s = 0.55 + 0.45 * easeBack(k);
      body.scale.set(1 + (1 - s) * 0.4, s, 1 + (1 - s) * 0.4);
      // 土块：抛物线，落地停住，最后缩没
      C.forEach((c, i) => {
        const tt = Math.max(0, e - (i % 3) * 0.03);
        let y = 0.04 + c.vy * tt - 2.6 * tt * tt;
        const land = y <= 0.015 && tt > 0.1;
        const ft = land ? (c.vy + Math.sqrt(c.vy * c.vy + 4 * 2.6 * 0.025)) / (2 * 2.6) : tt;
        if (land) y = 0.015;
        pv.set(c.vx * ft * 0.7, y, c.vz * ft * 0.7);
        const life = 1 - smooth((e - 0.65) / 0.3);
        q.setFromEuler(e3.set(c.spin + ft * 8, ft * 5, 0));
        clods.setMatrixAt(i, m4.compose(pv, q, sc.set(c.s, c.s * 0.75, c.s).multiplyScalar(Math.max(0.0001, life * Math.min(1, tt * 20)))));
      });
      clods.instanceMatrix.needsUpdate = true;
      if (e > DUR) { popT = null; clods.visible = false; body.scale.set(1, 1, 1); }
    },
  };
  api.setBand("cool");
  root.userData.dynamic = true;
  root.userData.what = "dig";
  return api;
}

/* ================================================================ 3. 小铲子 */
// buildShovel({ toon, outlined }) → { root }
// 长 0.39：原点在 D 形握把横杆中间（手握的地方），铲杆沿 −Y，铲头在最下面（y≈−0.39），铲面朝 ±Z。
export function buildShovel({ toon, outlined }) {
  const K = makeKit({ toon, outlined });
  const root = new THREE.Group();
  // 握把：粉色套 + 两根斜撑
  K.add(cyl(0.015, 0.015, 0.085, 10).rotateZ(Math.PI / 2), 0xff8a8a);
  for (const s of [1, -1]) K.add(seg([s * 0.043, 0, 0], [s * 0.009, -0.068, 0], 0.009, 0.01, 6), WOOD, LN_S);
  // 杆（顶上一个小木节把两根斜撑收住）
  K.add(cyl(0.011, 0.012, 0.19, 8).translate(0, -0.155, 0), WOOD);
  K.add(ell(0.02, 0.016, 0.016, 10, 6).translate(0, -0.068, 0), WOOD, LN_S);
  // 金属箍 + 铲头
  K.add(cyl(0.016, 0.02, 0.04, 10).translate(0, -0.255, 0), METAL_DK, LN_S);
  K.add(roundBox(0.1, 0.014, 0.018, 0.006).translate(0, -0.272, 0), METAL_DK, LN_S);
  const sh = new THREE.Shape();
  sh.moveTo(-0.05, 0); sh.lineTo(0.05, 0);
  sh.bezierCurveTo(0.056, -0.055, 0.042, -0.095, 0, -0.118);
  sh.bezierCurveTo(-0.042, -0.095, -0.056, -0.055, -0.05, 0);
  const blade = new THREE.ExtrudeGeometry(sh, { depth: 0.005, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 1, curveSegments: 6 });
  blade.translate(0, 0, -0.0025);
  const bp = blade.attributes.position;
  for (let i = 0; i < bp.count; i++) bp.setZ(i, bp.getZ(i) - 3.2 * bp.getX(i) ** 2); // 微微凹
  blade.computeVertexNormals();
  K.add(blade.translate(0, -0.272, 0), METAL);
  // 铲面高光
  K.add(xf(ell(0.007, 0.03, 0.002, 6, 4), [-0.022, -0.31, 0.0045], [0, 0, 0.15]), 0xffffff, 0);
  K.flush(root);
  root.userData.dynamic = true;
  root.userData.what = "shovel";
  return { root };
}

/* ================================================================ 4. 奖杯 */
// buildTrophy({ toon, outlined }) → { root, setLabel(text), update(t) }
// 0.41 高：木底座 0.22 × 0.17（0.115 高）+ 金杯两边带耳朵。牌子在底座正面（+z），字是画布贴图。
// update(t)：金杯慢慢闪光，杯口边上不时亮一颗四角星。
export function buildTrophy({ toon, outlined }) {
  const K = makeKit({ toon, outlined });
  const root = new THREE.Group();
  K.add(roundBox(0.22, 0.05, 0.17, 0.014).translate(0, 0.025, 0), WOOD_DK);
  K.add(roundBox(0.18, 0.066, 0.14, 0.012).translate(0, 0.083, 0), WOOD);
  K.add(roundBox(0.166, 0.054, 0.006, 0.004).translate(0, 0.083, 0.07), GOLD, LN_S); // 牌子金框
  K.flush(root);
  // 金杯（一个材质，update 里调发光）
  const cupMat = toon(GOLD, { emissive: 0xffa000, emissiveIntensity: 0.18 });
  const cupGeos = [
    lathe([[0, 0.116], [0.064, 0.116], [0.066, 0.126], [0.05, 0.138], [0.026, 0.146], [0.017, 0.165], [0.016, 0.182],
      [0.028, 0.19], [0.03, 0.2], [0.02, 0.212], [0.032, 0.222], [0.07, 0.244], [0.091, 0.285], [0.1, 0.34], [0.103, 0.392],
      [0.112, 0.4], [0.108, 0.41], [0.094, 0.404], [0.088, 0.38], [0.0, 0.365]], 26),
    xf(new THREE.TorusGeometry(0.046, 0.011, 6, 14, Math.PI), [0.094, 0.322, 0], [0, 0, -Math.PI / 2]),
    xf(new THREE.TorusGeometry(0.046, 0.011, 6, 14, Math.PI), [-0.094, 0.322, 0], [0, 0, Math.PI / 2]),
  ].map(prep);
  const cup = outlined(new THREE.Mesh(mergeAll(cupGeos), cupMat), LN);
  root.add(cup);
  // 杯身上的星星 + 高光
  K.add(xf(starGeo(0.034, 0.015, 0.01), [0, 0.31, 0.094], [-0.12, 0, 0]), GOLD_LT, LN_S);
  K.add(xf(ell(0.008, 0.04, 0.004, 6, 4), [-0.058, 0.325, 0.075], [0.1, -0.65, 0.1]), 0xffffff, 0);
  K.add(xf(ell(0.005, 0.012, 0.003, 6, 4), [-0.05, 0.268, 0.068], [0.1, -0.65, 0.2]), 0xffffff, 0);
  K.flush(root);
  // 牌子
  const P = canvasMat(toon, 512, 128, 0.3);
  const plaque = new THREE.Mesh(new THREE.PlaneGeometry(0.152, 0.038), P.material);
  plaque.position.set(0, 0.083, 0.0752);
  root.add(plaque);
  // 闪光
  const spark = glowSprite(sparkTex(), 0xfffbe0, 0.1, 0);
  spark.position.set(0.085, 0.405, 0.05);
  root.add(spark);
  const glow = glowSprite(haloTex(), 0xffe08a, 0.34, 0);
  glow.position.set(0, 0.31, -0.02);
  root.add(glow);

  const api = {
    root, cup,
    setLabel(text = "") {
      const g = P.g;
      g.clearRect(0, 0, 512, 128);
      const gr = g.createLinearGradient(0, 0, 0, 128);
      gr.addColorStop(0, "#fff4c9"); gr.addColorStop(1, "#f7d77c");
      g.fillStyle = gr; g.fillRect(0, 0, 512, 128);
      g.fillStyle = "#5a3a26"; g.textAlign = "center"; g.textBaseline = "middle";
      fitFont(g, text, "bold", 76, 470);
      g.fillText(text, 256, 68);
      P.tex.needsUpdate = true;
    },
    update(t) {
      const w = Math.sin(t * 1.4);
      cupMat.emissiveIntensity = 0.16 + 0.12 * Math.max(0, w) ** 2;
      glow.material.opacity = 0.18 + 0.14 * Math.max(0, w) ** 2;
      const ph = (t / 2.6) % 1;
      const k = ph < 0.3 ? Math.sin((ph / 0.3) * Math.PI) : 0;
      spark.visible = k > 0.01;
      spark.material.opacity = k;
      spark.scale.setScalar(0.03 + 0.09 * k);
      spark.material.rotation = t * 2;
    },
  };
  api.setLabel("冠军");
  root.userData.dynamic = true;
  root.userData.what = "trophy";
  return api;
}

/* ================================================================ 5. 记分牌 */
// buildScoreboard({ toon, outlined }) → { root, panel, setScores(s) }
// 两根木桩撑着的告示板：0.9 宽 × 1.0 高，正面朝 +z；奶油色纸面 0.8 × 0.5（中心 y=0.62），顶上挂一串彩旗。
// s = { title, rows: [{ name, emoji, pts, casts, max }, …×2], lucky: { emoji, name, mult? } | null, status: "进行中"|"已结束"|"", winner: 0|1|null }
// 只有调用 setScores 时才重画。
export function buildScoreboard({ toon, outlined }) {
  const K = makeKit({ toon, outlined });
  const root = new THREE.Group();
  for (const s of [1, -1]) {
    K.add(roundBox(0.06, 0.97, 0.06, 0.014).translate(s * 0.41, 0.485, -0.035), WOOD_DK);
    K.add(sph(0.036, 10, 8).translate(s * 0.41, 0.985, -0.035), WOOD_LT, LN_S);
  }
  K.add(roundBox(0.9, 0.61, 0.045, 0.02).translate(0, 0.625, 0), WOOD);
  K.add(roundBox(0.84, 0.55, 0.01, 0.01).translate(0, 0.62, 0.02), WOOD_DK, 0); // 纸后面的深色衬底，像个框
  // 彩旗串：从左桩顶到右桩顶，往下垂一点
  const N = 9, sag = 0.045, y0 = 0.975, zf = 0.02;
  const pt = (u) => [-0.41 + 0.82 * u, y0 - sag * 4 * u * (1 - u), zf];
  for (let i = 0; i < 12; i++) K.add(seg(pt(i / 12), pt((i + 1) / 12), 0.004, 0.004, 4), CREAM, 0);
  const cols = [0xff8fab, 0xffd166, 0x8fd3ff, 0x9ade8a, 0xc9a7ff];
  for (let i = 0; i < N; i++) {
    const u = (i + 1) / (N + 1), [x, y, z] = pt(u);
    K.add(xf(new THREE.ConeGeometry(0.026, 0.05, 3), [x, y - 0.026, z + 0.004], [Math.PI, 0, 0], [1, 1, 0.3]), cols[i % cols.length], 0.005);
  }
  // 桩底下的小草
  for (const s of [1, -1]) for (let i = 0; i < 3; i++) K.add(xf(cyl(0, 0.014, 0.06 + i * 0.012, 5), [s * 0.41 + (i - 1) * 0.03, 0.03, 0.01 + (i % 2) * 0.01], [0, 0, (i - 1) * 0.4]), 0x6fcf86, LN_S);
  K.flush(root);

  // 纸面：画布 1024×512，逻辑尺寸 1024×640（纵向压 0.8，贴到 0.8×0.5 的面上刚好不变形）
  const LW = 1024, LH = 640;
  const P = canvasMat(toon, 1024, 512, 0.32);
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.5), P.material);
  panel.position.set(0, 0.62, 0.0265);
  root.add(panel);

  const rr = (g, x, y, w, h, r) => { g.beginPath(); g.roundRect(x, y, w, h, r); };
  function draw(s = {}) {
    const g = P.g;
    g.setTransform(1, 0, 0, 512 / LH, 0, 0);
    g.clearRect(0, 0, LW, LH);
    // 纸
    g.fillStyle = "#fff3d6"; rr(g, 0, 0, LW, LH, 0); g.fill();
    g.strokeStyle = "#e6c08f"; g.lineWidth = 5; g.setLineDash([18, 12]);
    rr(g, 22, 22, LW - 44, LH - 44, 22); g.stroke();
    g.setLineDash([]);
    // 图钉
    for (const [x, c] of [[46, "#ff6b6b"], [LW - 46, "#5aa9ff"]]) {
      g.fillStyle = "rgba(90,58,38,0.25)"; g.beginPath(); g.arc(x + 3, 50, 14, 0, TAU); g.fill();
      g.fillStyle = c; g.beginPath(); g.arc(x, 46, 14, 0, TAU); g.fill();
      g.fillStyle = "rgba(255,255,255,0.8)"; g.beginPath(); g.arc(x - 4, 41, 4.5, 0, TAU); g.fill();
    }
    // 标题
    g.textBaseline = "middle"; g.textAlign = "center"; g.fillStyle = "#5a3a26";
    const title = s.title || "";
    fitFont(g, title, "bold", 72, 560);
    g.fillText(title, LW / 2, 84);
    // 状态小标签
    if (s.status) {
      const live = s.status === "进行中";
      g.font = `bold 34px ${FONT}`;
      const tw = g.measureText(s.status).width + 40;
      const x = LW - 60 - tw;
      g.fillStyle = live ? "#6cc57d" : "#b39a80"; rr(g, x, 60, tw, 52, 26); g.fill();
      g.fillStyle = "#fff"; g.textAlign = "center";
      g.fillText(s.status, x + tw / 2, 88);
    }
    // 幸运鱼
    if (s.lucky) {
      const txt = `今日幸运鱼 ${s.lucky.emoji || ""} ${s.lucky.name || ""} ×${s.lucky.mult ?? 2}`;
      g.textAlign = "center";
      const fs = fitFont(g, txt, "bold", 38, 760);
      const tw = g.measureText(txt).width + 56;
      g.fillStyle = "#ffe3a3"; rr(g, LW / 2 - tw / 2, 152 - fs / 2 - 12, tw, fs + 24, (fs + 24) / 2); g.fill();
      g.fillStyle = "#a8572e";
      g.fillText(txt, LW / 2, 154);
    }
    // 两行选手
    const rows = s.rows || [];
    [0, 1].forEach((i) => {
      const r = rows[i];
      if (!r) return;
      const y = 212 + i * 200, h = 178, x = 44, w = LW - 88;
      const win = s.winner === i;
      g.fillStyle = win ? "#ffe9a6" : "#fffaf0"; rr(g, x, y, w, h, 30); g.fill();
      g.strokeStyle = win ? "#f0b030" : "#ead3ad"; g.lineWidth = win ? 7 : 4; rr(g, x, y, w, h, 30); g.stroke();
      // 头像 emoji（白底小圆）
      g.fillStyle = "#ffffff"; g.beginPath(); g.arc(x + 82, y + h / 2, 56, 0, TAU); g.fill();
      g.strokeStyle = win ? "#f0b030" : "#ead3ad"; g.lineWidth = 4; g.stroke();
      g.textAlign = "center"; g.font = `76px ${EMOJI_FONT}`;
      g.fillText(r.emoji || "🙂", x + 82, y + h / 2 + 5);
      if (win) {
        g.save(); g.translate(x + 64, y + 30); g.rotate(-0.3);
        g.font = `58px ${EMOJI_FONT}`; g.fillText("👑", 0, 0);
        g.restore();
      }
      // 名字
      g.textAlign = "left"; g.fillStyle = "#5a3a26";
      const name = r.name || "";
      fitFont(g, name, "bold", 52, 400);
      g.fillText(name, x + 160, y + 58);
      // 次数小圆点
      const max = Math.max(0, Math.min(12, r.max | 0)), used = Math.max(0, Math.min(max, r.casts | 0));
      if (max > 0) {
        const rad = Math.min(17, 380 / (max * 2.7)), step = rad * 2.7;
        for (let k = 0; k < max; k++) {
          const cx = x + 160 + rad + k * step, cy = y + 124;
          g.beginPath(); g.arc(cx, cy, rad, 0, TAU);
          if (k < used) { g.fillStyle = "#ff9f43"; g.fill(); g.strokeStyle = "#d9752a"; g.lineWidth = 3; g.stroke(); }
          else { g.fillStyle = "#fff"; g.fill(); g.strokeStyle = "#d9bf98"; g.lineWidth = 3.5; g.stroke(); }
        }
        g.fillStyle = "#a07a5a"; g.font = `bold 30px ${FONT}`;
        g.fillText(`${used}/${max}`, x + 160 + max * step + 8, y + 126);
      }
      // 大分数
      g.textAlign = "right"; g.fillStyle = win ? "#e0603a" : "#5a3a26";
      g.font = `bold 118px ${FONT}`;
      g.fillText(String(r.pts ?? 0), x + w - 92, y + h / 2 + 6);
      g.font = `bold 38px ${FONT}`; g.fillStyle = "#a07a5a"; g.textAlign = "left";
      g.fillText("分", x + w - 84, y + h / 2 + 30);
    });
    g.setTransform(1, 0, 0, 1, 0, 0);
    P.tex.needsUpdate = true;
  }
  draw({ title: "", rows: [] });
  root.userData.dynamic = true;
  root.userData.what = "scoreboard";
  return { root, panel, setScores: draw };
}

/* ================================================================ 6. 爱心罐 */
// buildHeartJar({ toon, outlined }) → { root, setFill(k), setLabel(text), update(t, dt) }
// 0.38 高（玻璃罐 0.335 + 软木塞）：粉色的水位跟着 setFill(0..1) 慢慢涨落（update 里插值），小爱心在水里上下漂。
// 右前方挂一张小纸签（画布贴图，比如 "默契 37"）。玻璃 / 水都是透明的，标了 userData.noShadow。
export function buildHeartJar({ toon, outlined }) {
  const K = makeKit({ toon, outlined });
  const root = new THREE.Group();
  const BOT = 0.012, MAXH = 0.238, RL = 0.108;
  // 小爱心（不透明，先画）
  const hearts = [];
  const hcols = [0xff4f7b, 0xff86a8, 0xffffff, 0xff6b8b, 0xffb3c8];
  const hgeo = heartGeo(0.02);
  const spots = [[-0.05, 0.03, 0.4], [0.045, -0.035, 0.62], [0.0, 0.05, 0.25], [-0.03, -0.05, 0.82], [0.06, 0.035, 0.5]];
  spots.forEach(([x, z, f], i) => {
    const h = outlined(new THREE.Mesh(hgeo, K.mat(hcols[i])), 0.005);
    h.userData.spot = { x, z, f, ph: i * 1.9 };
    h.userData.noShadow = true;
    h.scale.setScalar(0.85 + (i % 3) * 0.15);
    root.add(h);
    hearts.push(h);
  });
  // 粉色的水：侧面 + 浅色水面
  const liquidGeo = cyl(RL, RL - 0.004, 1, 22).translate(0, 0.5, 0);
  const liqSide = toon(0xff7fac, { transparent: true, opacity: 0.72 });
  const liqTop = toon(0xffb8d0, { transparent: true, opacity: 0.85 });
  const liquid = new THREE.Mesh(liquidGeo, [liqSide, liqTop, liqSide]);
  liquid.position.y = BOT;
  liquid.renderOrder = 1;
  liquid.userData.noShadow = true;
  root.add(liquid);
  // 玻璃（边缘更不透明的菲涅尔效果，不描边）
  const glassGeo = lathe([[0, 0.002], [0.1, 0.002], [0.118, 0.012], [0.122, 0.04], [0.122, 0.25], [0.113, 0.284], [0.087, 0.303],
    [0.083, 0.314], [0.09, 0.32], [0.092, 0.33], [0.084, 0.336]], 30);
  const glassMat = new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(0xdff4ff) } },
    vertexShader: `varying vec3 vN; varying vec3 vV;
      void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 color; varying vec3 vN; varying vec3 vV;
      void main() { float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2);
        gl_FragColor = vec4(mix(color, vec3(1.0), f * 0.6), 0.1 + 0.6 * f);
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
  const glass = new THREE.Mesh(glassGeo, glassMat);
  glass.renderOrder = 2;
  glass.userData.noShadow = true;
  root.add(glass);
  // 玻璃上的高光条
  const shine = new THREE.Mesh(
    new THREE.CylinderGeometry(0.1235, 0.1235, 0.17, 6, 1, true, -0.95, 0.22).translate(0, 0.15, 0),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }));
  shine.renderOrder = 3;
  shine.userData.noShadow = true;
  shine.raycast = () => {};
  root.add(shine);
  // 软木塞 + 麻绳
  K.add(cyl(0.078, 0.07, 0.07, 16).translate(0, 0.342, 0), 0xd9a066);
  K.add(cyl(0.07, 0.078, 0.008, 16).translate(0, 0.381, 0), 0xe8b882, LN_S);
  K.add(xf(new THREE.TorusGeometry(0.087, 0.006, 5, 24), [0, 0.302, 0], [Math.PI / 2, 0, 0]), 0xe8d2a8, LN_S);
  // 纸签：麻绳上垂下来，挂在右前方
  const TAG = new THREE.Group();
  const ang = 0.55;
  TAG.position.set(Math.sin(ang) * 0.134, 0.205, Math.cos(ang) * 0.134);
  TAG.rotation.set(0, ang, 0.1);
  K.add(seg([Math.sin(ang) * 0.088, 0.302, Math.cos(ang) * 0.088], [TAG.position.x - 0.008, 0.24, TAG.position.z], 0.0025, 0.0025, 4), 0xe8d2a8, 0);
  K.flush(root);
  K.add(roundBox(0.122, 0.064, 0.006, 0.01).translate(0, 0, -0.004), 0xfff2df, LN_S);
  K.flush(TAG);
  const P = canvasMat(toon, 256, 128, 0.3);
  const tag = new THREE.Mesh(new THREE.PlaneGeometry(0.112, 0.056), P.material);
  tag.position.z = 0.0001;
  TAG.add(tag);
  root.add(TAG);

  let level = 0, target = 0;
  const applyLevel = () => { liquid.scale.y = Math.max(0.002, level * MAXH); liquid.visible = level > 0.004; };
  const api = {
    root, glass, liquid,
    setFill(k) { target = THREE.MathUtils.clamp(k, 0, 1); },
    setLabel(text = "") {
      const g = P.g;
      g.clearRect(0, 0, 256, 128);
      g.fillStyle = "#fff6e6"; g.fillRect(0, 0, 256, 128);
      g.fillStyle = "#e9cfa8"; g.beginPath(); g.arc(22, 64, 9, 0, TAU); g.fill(); // 穿绳的小孔
      g.fillStyle = "#c2456e"; g.textAlign = "center"; g.textBaseline = "middle";
      fitFont(g, text, "bold", 56, 196);
      g.fillText(text, 140, 68);
      P.tex.needsUpdate = true;
    },
    update(t, dt = 1 / 60) {
      level += (target - level) * (1 - Math.exp(-dt * 3.2));
      if (Math.abs(target - level) < 1e-4) level = target;
      applyLevel();
      const top = BOT + level * MAXH;
      liquid.rotation.y = t * 0.2;
      hearts.forEach((h) => {
        const s = h.userData.spot;
        const want = BOT + 0.022 + Math.max(0, top - BOT - 0.05) * s.f;
        h.position.set(s.x + Math.sin(t * 0.8 + s.ph) * 0.006, Math.min(want + Math.sin(t * 1.6 + s.ph) * 0.008, Math.max(BOT + 0.022, top - 0.018)), s.z);
        h.rotation.set(Math.sin(t * 1.1 + s.ph) * 0.25, Math.sin(t * 0.6 + s.ph) * 0.6, Math.sin(t * 0.9 + s.ph) * 0.2);
      });
    },
  };
  api.setLabel("默契");
  api.update(0, 0);
  root.userData.dynamic = true;
  root.userData.what = "heartjar";
  return api;
}

/* ================================================================ 7. 藏宝标记 */
// buildHideMarker() → { root, update(t) }（参数可以传 { toon, outlined }，用不到）
// 只有藏宝的人看得见：贴地的虚线圈（直径 0.5）+ 粉色 X，慢慢转、轻轻呼吸。全透明、不描边、点不到。
export function buildHideMarker() {
  const root = new THREE.Group();
  const ND = 18, segLen = (TAU / ND) * 0.58;
  const dashes = [];
  for (let i = 0; i < ND; i++) dashes.push(prep(new THREE.RingGeometry(0.215, 0.25, 3, 1, (i / ND) * TAU, segLen)));
  const mk = (geo, color, opacity, y) => {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    m.rotation.x = -Math.PI / 2;
    m.position.y = y;
    m.userData.noShadow = true;
    m.userData.base = opacity;
    return m;
  };
  const ring = mk(mergeAll(dashes), 0xff7aa8, 0.85, 0.012);
  const disc = mk(new THREE.CircleGeometry(0.215, 32), 0xffc2d6, 0.22, 0.01);
  // X：一整块十字形（四个圆头），转 45°；不叠两层，半透明也不会中间发深
  const xs = new THREE.Shape(), L = 0.078, w = 0.022;
  xs.moveTo(w, w);
  for (let i = 0; i < 4; i++) {
    const a = (-i * Math.PI) / 2, c = Math.cos(a), s2 = Math.sin(a);
    const P = (x, y) => [x * c - y * s2, x * s2 + y * c];
    xs.lineTo(...P(L, w));
    const [cx, cy] = P(L, 0);
    xs.absarc(cx, cy, w, a + Math.PI / 2, a - Math.PI / 2, true);
    xs.lineTo(...P(w, -w));
  }
  const xg = new THREE.ShapeGeometry(xs, 6).rotateZ(Math.PI / 4);
  const cross = mk(xg, 0xff4f8b, 0.9, 0.014);
  root.add(disc, ring, cross);
  noRay(root);
  root.renderOrder = 1;
  root.userData.dynamic = true;
  root.userData.what = "hidemarker";
  return {
    root,
    update(t) {
      const k = 0.5 + 0.5 * Math.sin(t * 2.6);
      ring.rotation.z = t * 0.35;
      ring.scale.setScalar(1 + 0.04 * k);
      ring.material.opacity = 0.6 + 0.3 * k;
      disc.material.opacity = 0.14 + 0.12 * k;
      cross.scale.setScalar(0.92 + 0.12 * k);
      cross.material.opacity = 0.7 + 0.25 * k;
    },
  };
}
