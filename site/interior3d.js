// 小木屋里面（娃娃屋剖面）：地板 + 后墙 + 两侧墙，没有前墙；镜头在前面稍高一点。
// 是新功能的入口：灶台做饭、孵蛋窝、照片墙、水族箱、储物架、信箱、食谱、出门。
// 不动的东西按材质合并成几块（顶点色），每个热点一块自己的材质（方便单独高亮）。
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { glowSprite } from "./home3d.js?v=15";

export const INTERIOR_IDS = ["stove", "incubator", "photowall", "aquarium", "shelf", "mailbox", "recipes", "door"];
// 推荐的热点标签（HTML 标签用）
export const INTERIOR_LABELS = {
  stove: "🍲 小厨房", incubator: "🥚 孵蛋窝", photowall: "📷 照片墙", aquarium: "🐠 水族箱",
  shelf: "🎒 储物架", mailbox: "💌 信箱", recipes: "📖 食谱", door: "🚪 出门",
};

/* ---------------------------------------------------------------- 尺寸 / 布局 */
const RW = 1.7; // 室内半宽
const BACK = -1.2, FRONT = 1.3; // 后墙内表面 / 地板前沿
const WH = 2.0, WT = 0.12, OUT = RW + WT; // 墙高、墙厚
const APEX = 2.9; // 山墙尖
const WIN = { x: 0.36, y: 1.3, w: 0.64, h: 0.62 }; // 后墙窗洞
const POS = {
  // 后排：储物架（左后角）、食谱（照片墙下）、沙发（窗下）、门 + 墙上的信箱
  // 前排（矮的）：灶台（左前）、孵蛋窝、地毯和垫子、水族箱（右前）
  stove: [-1.28, 0.55, 0.6], incubator: [-0.2, 0.48, 0], photowall: [-0.6, BACK, 0], recipes: [-0.6, -0.84, 0.1],
  door: [1.14, BACK, 0], mailbox: [1.53, -0.78, -1.22], aquarium: [1.16, 0.84, -0.3], shelf: [-1.27, -0.95, 0.2],
};

/* ---------------------------------------------------------------- 颜色 */
const C = {
  wall: 0xfff0da, gable: 0xffe6dc, cut: 0xc8915f, siding: 0xb07e52, wains: 0xf6d9b8, wainsLine: 0xe8c39c,
  plank: [0xe3ac72, 0xd99e63, 0xe8b57e, 0xdca468], slab: 0xa8774e, stone: [0xe6dccf, 0xd9cdbf, 0xefe6da],
  roof: 0xee7d84, roofDark: 0xd98a8a, ridge: 0xc75d68, door: 0x9a6a43, gold: 0xffd36b,
  pink: 0xffb3c4, mint: 0x9fd8c4, butter: 0xffd98a, lilac: 0xc9b6ff, sky: 0x9fd3ff, peach: 0xffc2a3,
  leaf: [0x6fc283, 0x86d39a, 0x5cb276], pot: 0xe08a5e, dot: 0xffd9d6,
};

/* ---------------------------------------------------------------- 工具 */
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();

function xf(pos, rot, scl, out) {
  _e.set(rot ? rot[0] : 0, rot ? rot[1] : 0, rot ? rot[2] : 0);
  _q.setFromEuler(_e);
  if (scl == null) _s.set(1, 1, 1); else if (typeof scl === "number") _s.setScalar(scl); else _s.set(scl[0], scl[1], scl[2]);
  _v.set(pos[0], pos[1], pos[2]);
  return out.compose(_v, _q, _s);
}

// 圆角盒子：球拆成 8 份往外推（法线直接用球的，卡通光照下很圆润）
function rbox(w, h, d, r = 0.03) {
  r = Math.max(0.002, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4));
  const g = new THREE.SphereGeometry(r, 16, 8);
  const p = g.attributes.position, hx = w / 2 - r, hy = h / 2 - r, hz = d / 2 - r, e = r * 1e-3;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    p.setXYZ(i, x + (x > e ? hx : x < -e ? -hx : 0), y + (y > e ? hy : y < -e ? -hy : 0), z + (z > e ? hz : z < -e ? -hz : 0));
  }
  return g;
}
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt, rb, h, s = 14) => new THREE.CylinderGeometry(rt, rb, h, s);
const sph = (r, ws = 12, hs = 8) => new THREE.SphereGeometry(r, ws, hs);
const tor = (R, r, rs = 8, ts = 20, arc = Math.PI * 2) => new THREE.TorusGeometry(R, r, rs, ts, arc);
// 半圆柱（拱顶），轴沿 z，弧在上面
const halfCyl = (r, d, s = 16) => new THREE.CylinderGeometry(r, r, d, s, 1, false, -Math.PI / 2, Math.PI).rotateX(-Math.PI / 2);
function heartGeo(s = 1, depth = 0.02) {
  const h = new THREE.Shape();
  h.moveTo(0, -0.05);
  h.bezierCurveTo(-0.07, 0.0, -0.07, 0.05, -0.035, 0.055);
  h.bezierCurveTo(-0.012, 0.058, 0, 0.04, 0, 0.03);
  h.bezierCurveTo(0, 0.04, 0.012, 0.058, 0.035, 0.055);
  h.bezierCurveTo(0.07, 0.05, 0.07, 0.0, 0, -0.05);
  return new THREE.ExtrudeGeometry(h, { depth, bevelEnabled: false, curveSegments: 6 }).scale(s, s, 1);
}
// 固定种子的随机数（每次进屋长得一样）
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

// 烘焙器：一堆小几何体 → 按描边粗细分组合并成一块，颜色烤进顶点色
class Baker {
  constructor() { this.parts = new Map(); this.base = new THREE.Matrix4(); }
  frame(pos, rot, scl) { if (!pos) this.base.identity(); else xf(pos, rot, scl, this.base); return this; }
  add(geo, color, pos = [0, 0, 0], rot, scl, line = 0.01) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    geo.dispose();
    for (const k of Object.keys(g.attributes)) if (k !== "position" && k !== "normal") g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    g.applyMatrix4(xf(pos, rot, scl, _m));
    g.applyMatrix4(this.base);
    const n = g.attributes.normal, p = g.attributes.position, cnt = p.count, col = new Float32Array(cnt * 3);
    const fn = typeof color === "function";
    if (!fn) _c.setHex(color);
    for (let i = 0; i < cnt; i++) {
      if (fn) _c.setHex(color(n.getX(i), n.getY(i), n.getZ(i), p.getX(i), p.getY(i), p.getZ(i)));
      col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b;
    }
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    line = line <= 0 ? 0 : line < 0.0075 ? 0.006 : line < 0.0135 ? 0.011 : 0.017; // 描边粗细只分 3 档（每档 = 2 次绘制）
    if (!this.parts.has(line)) this.parts.set(line, []);
    this.parts.get(line).push(g);
    return this;
  }
  build(mat, parent, outlined) {
    const out = [];
    for (const [line, list] of this.parts) {
      const geo = mergeGeometries(list, false);
      for (const g of list) g.dispose();
      geo.computeBoundingBox();
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.userData.baked = true;
      if (line > 0) outlined(mesh, line);
      parent.add(mesh);
      out.push(mesh);
    }
    this.parts.clear();
    return out;
  }
}

// 画布贴图
function canvasTex(w, h, draw) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function softTex() {
  return canvasTex(64, 64, (x) => {
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.35, "rgba(255,255,255,0.6)"); g.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  });
}
// 窗外：白天 = 蓝天白云 + 海 + 远处小岛；夜里 = 星星月亮 + 深海 + 月光倒影
function skyTex(night) {
  return canvasTex(256, 256, (x) => {
    const hz = 158, r = rng(night ? 7 : 3);
    let g = x.createLinearGradient(0, 0, 0, hz);
    if (night) { g.addColorStop(0, "#161b46"); g.addColorStop(1, "#43468a"); } else { g.addColorStop(0, "#86cbff"); g.addColorStop(1, "#e4f5ff"); }
    x.fillStyle = g; x.fillRect(0, 0, 256, hz);
    if (night) {
      for (let i = 0; i < 70; i++) {
        const sx = r() * 256, sy = r() * (hz - 10), sz = r() < 0.15 ? 2.2 : 1.1;
        x.fillStyle = `rgba(255,${240 + r() * 15 | 0},${200 + r() * 55 | 0},${0.55 + r() * 0.45})`;
        x.beginPath(); x.arc(sx, sy, sz, 0, Math.PI * 2); x.fill();
      }
      // 两颗十字亮星
      x.fillStyle = "#fff6cf";
      for (const [sx, sy] of [[60, 40], [196, 70]]) { x.fillRect(sx - 6, sy - 1, 12, 2); x.fillRect(sx - 1, sy - 6, 2, 12); }
      // 弯月
      x.fillStyle = "#fff3c4"; x.beginPath(); x.arc(176, 52, 20, 0, Math.PI * 2); x.fill();
      x.fillStyle = "#1d2350"; x.beginPath(); x.arc(186, 45, 18, 0, Math.PI * 2); x.fill();
    } else {
      x.fillStyle = "#fff4c2"; x.beginPath(); x.arc(196, 48, 20, 0, Math.PI * 2); x.fill();
      x.fillStyle = "rgba(255,255,255,0.95)";
      for (const [cx, cy, s] of [[64, 56, 1], [150, 96, 0.75], [230, 118, 0.6]]) {
        for (const [dx, dy, rr] of [[-16, 4, 12], [0, -4, 16], [16, 4, 12], [0, 6, 13]]) { x.beginPath(); x.arc(cx + dx * s, cy + dy * s, rr * s, 0, Math.PI * 2); x.fill(); }
      }
    }
    // 远处小岛（剪影）
    x.fillStyle = night ? "#2c3266" : "#9fd6b8";
    x.beginPath(); x.ellipse(70, hz, 46, 16, 0, Math.PI, 0); x.fill();
    x.fillStyle = night ? "#343a72" : "#b6e2c7";
    x.beginPath(); x.ellipse(40, hz, 22, 9, 0, Math.PI, 0); x.fill();
    // 海
    g = x.createLinearGradient(0, hz, 0, 256);
    if (night) { g.addColorStop(0, "#2a3672"); g.addColorStop(1, "#121a42"); } else { g.addColorStop(0, "#6fd0ec"); g.addColorStop(1, "#2f9cc8"); }
    x.fillStyle = g; x.fillRect(0, hz, 256, 256 - hz);
    // 波光
    x.fillStyle = night ? "rgba(255,240,180,0.55)" : "rgba(255,255,255,0.7)";
    for (let i = 0; i < 14; i++) {
      const wy = hz + 8 + r() * 86, wx = night ? 176 + (r() - 0.5) * (14 + (wy - hz) * 0.5) : r() * 256;
      x.fillRect(wx - 8, wy, 16 + r() * 10, 2);
    }
  });
}

/* ================================================================ 主函数 */
export function buildInterior({ toon, outlined }) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 60);
  const own = { tex: [], mats: [] }; // 自己创建的贴图（dispose 用）
  const BG_DAY = new THREE.Color(0xfbe6d6), BG_NIGHT = new THREE.Color(0x2b2746);
  scene.background = BG_DAY.clone();

  /* ---------- 光：天光 + 暖色主光 + 跟着镜头的柔光 */
  const hemi = new THREE.HemisphereLight(0xfff1e0, 0xd8b49a, 1.35);
  const key = new THREE.DirectionalLight(0xffe4c4, 2.0);
  key.position.set(-1.0, 5, 6);
  const fill = new THREE.DirectionalLight(0xfff4ea, 0.45);
  fill.position.set(0, 0.4, 1);
  camera.add(fill);
  scene.add(hemi, key, camera);
  const L = {
    hemiSky: [new THREE.Color(0xfff1e0), new THREE.Color(0x9b92d8)], hemiGround: [new THREE.Color(0xd8b49a), new THREE.Color(0x4b3752)],
    hemiI: [1.35, 1.12], key: [new THREE.Color(0xffe4c4), new THREE.Color(0xffc58e)], keyI: [2.0, 1.45], fillI: [0.45, 0.4],
  };

  const root = new THREE.Group();
  scene.add(root);
  const staticMat = toon(0xffffff, { vertexColors: true });
  const S = new Baker(); // 不动的装饰

  /* ---------- 房子结构 */
  const backCol = (nx, ny, nz) => (ny > 0.5 ? C.cut : nz > 0.5 ? C.wall : C.siding);
  const sideCol = (sgn) => (nx, ny, nz) => (ny > 0.5 || nz > 0.5 ? C.cut : nx * sgn > 0.5 ? C.wall : C.siding);
  const wz = BACK - WT / 2, wl = WIN.x - WIN.w / 2, wr = WIN.x + WIN.w / 2, wb = WIN.y - WIN.h / 2, wt = WIN.y + WIN.h / 2;
  S.add(box(wl + OUT, WH, WT), backCol, [(-OUT + wl) / 2, WH / 2, wz], null, null, 0.016);
  S.add(box(OUT - wr, WH, WT), backCol, [(wr + OUT) / 2, WH / 2, wz], null, null, 0.016);
  S.add(box(WIN.w, wb, WT), backCol, [WIN.x, wb / 2, wz], null, null, 0);
  S.add(box(WIN.w, WH - wt, WT), backCol, [WIN.x, (wt + WH) / 2, wz], null, null, 0);
  for (const sg of [-1, 1]) {
    S.add(box(WT, WH, FRONT - BACK), sideCol(-sg), [sg * (RW + WT / 2), WH / 2, (FRONT + BACK) / 2], null, null, 0.016);
    // 剖面前沿的木柱 + 墙顶木梁
    S.add(rbox(WT + 0.05, WH + 0.06, 0.08, 0.02), C.siding, [sg * (RW + WT / 2), WH / 2 + 0.01, FRONT], null, null, 0.014);
    S.add(rbox(WT + 0.06, 0.07, FRONT - BACK + WT + 0.04, 0.02), C.siding, [sg * (RW + WT / 2), WH + 0.03, (FRONT + BACK - WT) / 2], null, null, 0.014);
    // 墙角柱
    S.add(box(0.07, WH, 0.07), C.siding, [sg * (RW - 0.03), WH / 2, BACK + 0.03], null, null, 0.01);
  }
  S.add(rbox(2 * OUT + 0.06, 0.07, WT + 0.06, 0.02), C.siding, [0, WH + 0.03, wz], null, null, 0.014);
  // 山墙（三角）+ 阁楼小圆窗的框
  {
    const sh = new THREE.Shape();
    sh.moveTo(-OUT, WH + 0.06); sh.lineTo(OUT, WH + 0.06); sh.lineTo(0, APEX); sh.closePath();
    S.add(new THREE.ExtrudeGeometry(sh, { depth: WT, bevelEnabled: false }), (nx, ny, nz) => (nz > 0.5 ? C.gable : C.siding), [0, 0, BACK - WT], null, null, 0.016);
    S.add(tor(0.17, 0.025, 8, 24), 0xfffaf2, [0, 2.4, BACK + 0.01], null, null, 0.008);
    S.add(box(0.33, 0.02, 0.02), 0xfffaf2, [0, 2.4, BACK + 0.012], null, null, 0);
    S.add(box(0.02, 0.33, 0.02), 0xfffaf2, [0, 2.4, BACK + 0.012], null, null, 0);
    // 山墙上横的木板纹
    for (let y = WH + 0.2; y < APEX - 0.1; y += 0.16) {
      const half = OUT * (APEX - y) / (APEX - WH - 0.06) - 0.06;
      S.add(box(half * 2, 0.012, 0.006), 0xf5d2c6, [0, y, BACK + 0.003], null, null, 0);
    }
  }
  // 粉色屋顶（只剖到后面一截，前面露出来）+ 屋脊
  {
    const dx = OUT, dy = APEX - WH - 0.06, len = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
    const roofCol = (nx, ny) => (ny > 0.35 ? C.roof : ny < -0.35 ? C.roofDark : 0xe56f78);
    for (const sg of [-1, 1]) {
      const ux = -sg * dx / len, uy = dy / len; // 沿坡向上
      const cx = sg * OUT / 2 - ux * 0.13 + (-uy * sg) * 0.0, cy = WH + 0.06 + dy / 2 - uy * 0.13;
      const nx = sg * uy, ny = dx / len; // 坡面外法线
      S.add(box(len + 0.32, 0.12, 0.78), roofCol, [cx + nx * 0.06, cy + ny * 0.06, BACK - WT - 0.14 + 0.39], [0, 0, -sg * a], null, 0.02);
    }
    S.add(rbox(0.16, 0.12, 0.8, 0.04), C.ridge, [0, APEX + 0.08, BACK - WT - 0.14 + 0.39], null, null, 0.014);
  }
  // 地板：木板（错缝）+ 地板厚度 + 前面一排小石头地基
  {
    const r = rng(11), n = 14, pw = (2 * RW) / n;
    S.add(box(2 * OUT, 0.15, FRONT - BACK + WT), (nx, ny) => (ny > 0.5 ? C.plank[1] : C.slab), [0, -0.095, (FRONT + BACK - WT) / 2], null, null, 0.016);
    for (let i = 0; i < n; i++) {
      const x = -RW + pw * (i + 0.5), seam = BACK + 0.5 + r() * 1.4;
      S.add(box(pw - 0.008, 0.02, seam - BACK - 0.006), C.plank[i % 4], [x, -0.01, (BACK + seam) / 2], null, null, 0);
      S.add(box(pw - 0.008, 0.02, FRONT - seam - 0.006), C.plank[(i + 2) % 4], [x, -0.01, (seam + FRONT) / 2], null, null, 0);
    }
    S.add(box(2 * OUT - 0.04, 0.16, FRONT - BACK + WT - 0.04), C.stone[1], [0, -0.25, (FRONT + BACK - WT) / 2], null, null, 0.012);
    const sn = 13, sw = (2 * OUT) / sn;
    for (let i = 0; i < sn; i++) {
      S.add(rbox(sw - 0.03, 0.12, 0.05, 0.035), C.stone[i % 3], [-OUT + sw * (i + 0.5), -0.25 + ((i % 2) - 0.5) * 0.015, FRONT + 0.01], null, null, 0.008);
    }
  }
  // 护墙板（下半截木板）+ 腰线 + 踢脚线
  {
    const wy = 0.55;
    S.add(box(2 * RW, wy, 0.015), C.wains, [0, wy / 2, BACK + 0.008], null, null, 0);
    S.add(box(2 * RW, 0.035, 0.035), C.cut, [0, wy + 0.01, BACK + 0.018], null, null, 0.006);
    S.add(box(2 * RW, 0.07, 0.03), C.siding, [0, 0.035, BACK + 0.015], null, null, 0);
    for (let x = -RW + 0.2; x < RW - 0.05; x += 0.2) S.add(box(0.012, wy - 0.08, 0.006), C.wainsLine, [x, wy / 2 + 0.03, BACK + 0.017], null, null, 0);
    for (const sg of [-1, 1]) {
      const x = sg * (RW - 0.008);
      S.add(box(0.015, wy, FRONT - BACK), C.wains, [x, wy / 2, (FRONT + BACK) / 2], null, null, 0);
      S.add(box(0.035, 0.035, FRONT - BACK), C.cut, [sg * (RW - 0.018), wy + 0.01, (FRONT + BACK) / 2], null, null, 0.006);
      S.add(box(0.03, 0.07, FRONT - BACK), C.siding, [sg * (RW - 0.015), 0.035, (FRONT + BACK) / 2], null, null, 0);
      for (let z = BACK + 0.2; z < FRONT - 0.05; z += 0.2) S.add(box(0.006, wy - 0.08, 0.012), C.wainsLine, [sg * (RW - 0.017), wy / 2 + 0.03, z], null, null, 0);
    }
  }
  // 墙纸上的小圆点
  {
    const dot = () => new THREE.CircleGeometry(0.022, 8);
    let k = 0;
    for (let y = 0.72; y < WH - 0.05; y += 0.24, k++) {
      for (let x = -RW + 0.12 + (k % 2) * 0.13; x < RW - 0.05; x += 0.26) {
        if (x > wl - 0.06 && x < wr + 0.06 && y > wb - 0.06 && y < wt + 0.06) continue; // 窗洞
        S.add(dot(), C.dot, [x, y, BACK + 0.002], null, null, 0);
      }
      for (const sg of [-1, 1]) for (let z = BACK + 0.15 + (k % 2) * 0.13; z < FRONT - 0.05; z += 0.26) {
        S.add(dot(), C.dot, [sg * (RW - 0.002), y, z], [0, -sg * Math.PI / 2, 0], null, 0);
      }
    }
  }

  /* ---------- 窗户（窗框 + 窗台小花盆 + 窗帘杆；窗外画在 skyMesh 上） */
  {
    const F = 0xfffaf2, fz = BACK + 0.025;
    S.add(rbox(WIN.w + 0.1, 0.05, 0.06, 0.015), F, [WIN.x, wt + 0.025, fz], null, null, 0.008);
    S.add(rbox(WIN.w + 0.1, 0.05, 0.06, 0.015), F, [WIN.x, wb - 0.025, fz], null, null, 0.008);
    S.add(rbox(0.05, WIN.h + 0.1, 0.06, 0.015), F, [wl - 0.025, WIN.y, fz], null, null, 0.008);
    S.add(rbox(0.05, WIN.h + 0.1, 0.06, 0.015), F, [wr + 0.025, WIN.y, fz], null, null, 0.008);
    S.add(box(0.025, WIN.h, 0.03), F, [WIN.x, WIN.y, BACK - 0.03], null, null, 0.005);
    S.add(box(WIN.w, 0.025, 0.03), F, [WIN.x, WIN.y, BACK - 0.03], null, null, 0.005);
    S.add(rbox(WIN.w + 0.2, 0.04, 0.16, 0.015), C.cut, [WIN.x, wb - 0.06, BACK + 0.07], null, null, 0.01);
    [[-0.2, 0xff8fab], [0.2, 0xffd166]].forEach(([dx, fc]) => {
      S.add(cyl(0.045, 0.035, 0.07, 10), C.pot, [WIN.x + dx, wb - 0.005, BACK + 0.08], null, null, 0.006);
      S.add(sph(0.045, 10, 6), C.leaf[1], [WIN.x + dx, wb + 0.05, BACK + 0.08], null, [1, 0.8, 1], 0.006);
      S.add(sph(0.025, 8, 6), fc, [WIN.x + dx + 0.015, wb + 0.09, BACK + 0.1], null, null, 0.005);
      S.add(sph(0.022, 8, 6), fc, [WIN.x + dx - 0.025, wb + 0.075, BACK + 0.09], null, null, 0.005);
    });
    S.add(cyl(0.012, 0.012, WIN.w + 0.62, 8), C.siding, [WIN.x, wt + 0.1, BACK + 0.1], [0, 0, Math.PI / 2], null, 0.006);
    for (const sg of [-1, 1]) S.add(sph(0.03, 10, 8), C.gold, [WIN.x + sg * (WIN.w / 2 + 0.31), wt + 0.1, BACK + 0.1], null, null, 0.006);
  }
  // 窗帘（会轻轻晃）：两片有褶的厚布，挂在杆上
  const curtainMat = toon(0xffbccb);
  const curtains = [];
  {
    const g = new THREE.BoxGeometry(0.22, 0.78, 0.03, 12, 1, 1);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i);
      const flare = 1 + (0.39 - y) * 0.25; // 下摆张开一点
      p.setX(i, x * flare);
      p.setZ(i, p.getZ(i) + Math.sin((x / 0.22) * Math.PI * 4) * 0.018);
    }
    g.computeVertexNormals();
    g.translate(0, -0.39, 0);
    for (const sg of [-1, 1]) {
      const piv = new THREE.Group();
      piv.position.set(WIN.x + sg * 0.37, wt + 0.08, BACK + 0.11);
      const m = outlined(new THREE.Mesh(g, curtainMat), 0.008);
      piv.add(m);
      // 绑带
      const tie = outlined(new THREE.Mesh(tor(0.06, 0.012, 6, 16), toon(0xff8fab)), 0.005);
      tie.position.set(0, -0.5, 0.0);
      tie.rotation.x = Math.PI / 2;
      tie.scale.set(1.15, 0.6, 1);
      piv.add(tie);
      root.add(piv);
      curtains.push(piv);
    }
  }

  /* ---------- 厨房角（左墙，灶台后面）：瓷砖、挂勺子的横杆、放杯子的小搁板 */
  {
    S.frame([-RW, 0, 0.45], [0, Math.PI / 2, 0]); // 局部 +z = 朝屋里
    for (let i = 0; i < 6; i++) for (let j = 0; j < 4; j++) {
      S.add(box(0.098, 0.098, 0.012), (i + j) % 2 ? 0xffd0d8 : 0xfff8ef, [-0.25 + i * 0.1, 0.65 + j * 0.1, 0.006], null, null, 0);
    }
    S.add(cyl(0.01, 0.01, 0.46, 6), C.siding, [0, 1.08, 0.05], [0, 0, Math.PI / 2], null, 0.004);
    S.add(cyl(0.008, 0.008, 0.18, 6), 0xe8c49a, [-0.15, 0.98, 0.05], null, null, 0.004);
    S.add(sph(0.035, 10, 6), 0xe8c49a, [-0.15, 0.88, 0.05], null, [1, 0.6, 1], 0.005);
    S.add(cyl(0.008, 0.008, 0.16, 6), 0xe8c49a, [0, 0.99, 0.05], null, null, 0.004);
    S.add(rbox(0.06, 0.07, 0.01, 0.01), 0xe8c49a, [0, 0.88, 0.05], null, null, 0.005);
    S.add(cyl(0.01, 0.01, 0.1, 6), 0x7a5a4a, [0.15, 1.02, 0.05], null, null, 0.004);
    S.add(cyl(0.065, 0.065, 0.02, 16), 0xff9f8a, [0.15, 0.91, 0.05], [Math.PI / 2, 0, 0], null, 0.006);
    S.add(rbox(0.44, 0.03, 0.15, 0.01), C.cut, [-0.04, 1.36, 0.075], null, null, 0.008);
    for (const sx of [-0.15, 0.1]) S.add(box(0.02, 0.07, 0.1), C.siding, [-0.04 + sx, 1.31, 0.05], null, null, 0.004);
    [[-0.19, 0xffb3c4], [-0.08, 0xa8e0cc], [0.03, 0xffd98a]].forEach(([dx, c]) => {
      S.add(cyl(0.035, 0.032, 0.075, 12), c, [dx, 1.413, 0.08], null, null, 0.005);
      S.add(tor(0.018, 0.007, 6, 10), c, [dx + 0.04, 1.413, 0.08], null, null, 0.003);
    });
    S.add(cyl(0.035, 0.03, 0.05, 10), C.pot, [0.12, 1.4, 0.08], null, null, 0.005);
    S.add(sph(0.045, 10, 6), C.leaf[0], [0.12, 1.45, 0.08], null, [1, 0.9, 1], 0.005);
    S.frame();
  }

  /* ---------- 沙发（窗下）+ 抱枕 + 毯子 */
  {
    const cx = WIN.x, cz = -0.95, G = 0xa9d8b8, G2 = 0xc4e8cf;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) S.add(cyl(0.025, 0.02, 0.06, 6), 0x7a5a3e, [cx + sx * 0.42, 0.03, cz + sz * 0.18], null, null, 0.004);
    S.add(rbox(1.0, 0.18, 0.5, 0.06), G, [cx, 0.15, cz], null, null, 0.012);
    S.add(rbox(1.0, 0.42, 0.16, 0.07), G, [cx, 0.42, cz - 0.2], null, null, 0.012);
    for (const sx of [-1, 1]) S.add(rbox(0.15, 0.32, 0.52, 0.07), G, [cx + sx * 0.47, 0.3, cz], null, null, 0.012);
    for (const sx of [-1, 1]) S.add(rbox(0.38, 0.09, 0.42, 0.04), G2, [cx + sx * 0.19, 0.27, cz + 0.03], null, null, 0.008);
    S.add(rbox(0.2, 0.2, 0.08, 0.07), 0xfff3e2, [cx - 0.28, 0.42, cz - 0.08], [0.1, 0, 0.2], null, 0.008);
    S.add(heartGeo(2.2, 0.06), 0xff8fab, [cx - 0.05, 0.47, cz - 0.12], [0.12, 0, -0.1], null, 0.008);
    // 粉色毯子搭在右扶手上
    S.add(rbox(0.2, 0.025, 0.46, 0.012), 0xffc2cf, [cx + 0.47, 0.475, cz], null, null, 0.006);
    S.add(rbox(0.025, 0.26, 0.4, 0.012), 0xffc2cf, [cx + 0.56, 0.35, cz], null, null, 0.006);
    for (let i = 0; i < 4; i++) S.add(box(0.21, 0.006, 0.03), 0xffe8ee, [cx + 0.47, 0.49, cz - 0.15 + i * 0.1], null, null, 0);
  }

  /* ---------- 地毯 */
  {
    const rx = 0.3, rz = 0.22;
    S.add(cyl(0.86, 0.86, 0.012, 40), 0xf6b3c0, [rx, 0.006, rz], null, [1, 1, 0.72], 0);
    S.add(cyl(0.72, 0.72, 0.012, 40), 0xfff3e2, [rx, 0.009, rz], null, [1, 1, 0.72], 0);
    S.add(cyl(0.6, 0.6, 0.012, 40), 0xf9c8d2, [rx, 0.012, rz], null, [1, 1, 0.72], 0);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      S.add(cyl(0.035, 0.035, 0.012, 8), 0xfff3e2, [rx + Math.cos(a) * 0.48, 0.015, rz + Math.sin(a) * 0.48 * 0.72], null, null, 0);
    }
  }

  /* ---------- 宠物小垫子（3 个）*/
  const petBeds = [];
  [[WIN.x + 0.19, 0.315, -0.92, C.lilac], [0.3, 0.012, 0.12, C.peach], [0.36, 0.012, 0.7, 0xaee6cf]].forEach(([x, y, z, col]) => {
    S.add(tor(0.13, 0.055, 8, 20), col, [x, y + 0.04, z], [Math.PI / 2, 0, 0], [1, 1, 0.75], 0.008);
    S.add(cyl(0.14, 0.14, 0.04, 20), 0xfff6ec, [x, y + 0.02, z], null, null, 0.006);
    const slot = new THREE.Object3D();
    slot.position.set(x, y + 0.04, z);
    root.add(slot);
    petBeds.push(slot);
  });
  const visitorSpot = new THREE.Object3D();
  visitorSpot.position.set(-0.64, 0, 0.98);
  visitorSpot.rotation.y = 0.25;
  root.add(visitorSpot);

  /* ---------- 盆栽 */
  {
    const plant = (x, z, s, big) => {
      S.add(cyl(0.11 * s, 0.085 * s, 0.18 * s, 12), C.pot, [x, 0.09 * s, z], null, null, 0.008);
      S.add(tor(0.105 * s, 0.018 * s, 6, 14), 0xc8714a, [x, 0.18 * s, z], [Math.PI / 2, 0, 0], null, 0.005);
      if (big) {
        [[0, 0.36, 0, 0.13], [-0.1, 0.3, 0.04, 0.1], [0.1, 0.32, 0.03, 0.1], [0.02, 0.5, -0.02, 0.1], [-0.06, 0.45, 0.06, 0.08]].forEach(([dx, dy, dz, r], i) => {
          S.add(sph(r * s, 12, 8), C.leaf[i % 3], [x + dx * s, dy * s, z + dz * s], null, [1, 0.9, 1], 0.008);
        });
      } else {
        S.add(new THREE.CapsuleGeometry(0.05 * s, 0.14 * s, 4, 10), 0x7ccf8e, [x, 0.3 * s, z], null, null, 0.008);
        S.add(new THREE.CapsuleGeometry(0.03 * s, 0.06 * s, 4, 8), 0x7ccf8e, [x + 0.07 * s, 0.32 * s, z], [0, 0, -0.9], null, 0.006);
        S.add(sph(0.035 * s, 8, 6), 0xff8fab, [x, 0.42 * s, z], null, null, 0.005);
      }
    };
    plant(1.5, -0.98, 0.85, true);
    plant(-1.52, 1.12, 1, false);
  }

  /* ---------- 门上方的爱心相框 */
  {
    const [dx] = POS.door;
    S.add(cyl(0.12, 0.12, 0.02, 24), 0xfff8ee, [dx, 1.5, BACK + 0.012], [Math.PI / 2, 0, 0], null, 0);
    S.add(tor(0.12, 0.02, 8, 24), C.cut, [dx, 1.5, BACK + 0.02], null, null, 0.006);
    S.add(heartGeo(1.5, 0.02), 0xff6b8b, [dx, 1.5, BACK + 0.02], null, null, 0.006);
  }

  /* ---------- 吊灯（屋脊上挂下来）+ 灯泡 + 光晕 */
  const shadeMat = toon(0xffe6a8, { emissive: 0xffc870, emissiveIntensity: 0 });
  const bulbMat = new THREE.MeshBasicMaterial({ color: 0xfff1c4 });
  const bulbGeos = [];
  const glows = {};
  const addBulb = (x, y, z, r) => { const g = sph(r, 10, 8); g.translate(x, y, z); bulbGeos.push(g); };
  {
    const px = 0, py = 2.2, pz = -0.85;
    S.add(cyl(0.008, 0.008, APEX - 0.1 - py, 6), 0x5a4a3c, [px, (APEX - 0.1 + py) / 2, pz], null, null, 0);
    const shade = outlined(new THREE.Mesh(cyl(0.06, 0.18, 0.14, 18).translate(px, py, pz), shadeMat), 0.01);
    root.add(shade);
    addBulb(px, py - 0.08, pz, 0.05);
    glows.pendant = glowSprite(0xffc870, 1.1);
    glows.pendant.position.set(px, py - 0.12, pz);
    root.add(glows.pendant);
  }

  /* ---------- 彩灯串（后墙顶上，三段垂下来） */
  const fairy = (() => {
    const xs = [-RW + 0.06, -RW / 3, RW / 3, RW - 0.06], y0 = 1.92, sag = 0.12, z = BACK + 0.04;
    const pts = [], wire = [];
    for (let s = 0; s < 3; s++) {
      const xa = xs[s], xb = xs[s + 1];
      for (let i = 0; i <= 20; i++) { const u = i / 20; wire.push(new THREE.Vector3(xa + (xb - xa) * u, y0 - sag * (1 - (2 * u - 1) ** 2), z)); }
      for (let i = 1; i < 8; i++) { const u = i / 8; pts.push([xa + (xb - xa) * u, y0 - sag * (1 - (2 * u - 1) ** 2) - 0.03, z + 0.01]); }
    }
    S.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(wire), 90, 0.006, 4), 0x5a4a3c, [0, 0, 0], null, null, 0);
    const N = pts.length, cols = [0xffe08a, 0xff9fb8, 0xa8f0d0, 0xc9b6ff, 0xffc58a];
    const im = new THREE.InstancedMesh(sph(0.026, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }), N);
    const base = new Float32Array(N * 3), pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      xf(pts[i], null, null, _m);
      im.setMatrixAt(i, _m);
      _c.setHex(cols[i % cols.length]);
      im.setColorAt(i, _c);
      base[i * 3] = _c.r; base[i * 3 + 1] = _c.g; base[i * 3 + 2] = _c.b;
      pos[i * 3] = pts[i][0]; pos[i * 3 + 1] = pts[i][1]; pos[i * 3 + 2] = pts[i][2] + 0.01;
    }
    im.instanceColor.setUsage(THREE.DynamicDrawUsage);
    im.computeBoundingSphere();
    root.add(im);
    const soft = softTex(); own.tex.push(soft);
    const pg = new THREE.BufferGeometry();
    pg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const pc = new THREE.BufferAttribute(new Float32Array(base), 3);
    pc.setUsage(THREE.DynamicDrawUsage);
    pg.setAttribute("color", pc);
    const pts3 = new THREE.Points(pg, new THREE.PointsMaterial({ size: 0.42, map: soft, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.5 }));
    pts3.raycast = () => {};
    root.add(pts3);
    return { im, base, pc, N, pts: pts3, soft };
  })();

  /* ================================================================ 热点 */
  const hot = {}; // id → { root, mat, meshes, anchor, proxy }
  const mkHot = (id, pos, ry) => {
    const g = new THREE.Group();
    g.position.set(pos[0], 0, pos[1]);
    g.rotation.y = ry || 0;
    root.add(g);
    const mat = toon(0xffffff, { vertexColors: true, emissive: 0xffe3b8, emissiveIntensity: 0 });
    hot[id] = { root: g, mat, meshes: [], anchor: new THREE.Vector3() };
    return { id, g, b: new Baker(), mat };
  };
  const finish = (h, parent = h.g) => { hot[h.id].meshes.push(...h.b.build(h.mat, parent, outlined)); };

  /* ---------- 灶台：薄荷绿小炉子 + 一锅汤 */
  const stove = mkHot("stove", [POS.stove[0], POS.stove[1]], POS.stove[2]);
  const fireMat = new THREE.MeshBasicMaterial({ color: 0xff9a3c });
  let potBubbles, steam = [];
  const steamOrigin = new THREE.Vector3();
  {
    const b = stove.b, M = 0x8fd3c1, M2 = 0x74bca8, L1 = 0.012;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add(cyl(0.028, 0.022, 0.08, 8), 0x5d4b4b, [sx * 0.21, 0.04, sz * 0.14], null, null, 0.005);
    b.add(rbox(0.56, 0.46, 0.42, 0.07), M, [0, 0.31, 0], null, null, L1);
    b.add(rbox(0.6, 0.05, 0.46, 0.02), 0x5b4a4a, [0, 0.56, 0], null, null, L1);
    b.add(rbox(0.38, 0.27, 0.03, 0.035), M2, [0, 0.28, 0.21], null, null, 0.006);
    b.add(tor(0.075, 0.016, 8, 20), C.gold, [0, 0.27, 0.228], null, null, 0.005);
    b.add(rbox(0.2, 0.022, 0.03, 0.01), C.gold, [0, 0.39, 0.235], null, null, 0.004);
    for (const sx of [-1, 0, 1]) b.add(sph(0.022, 10, 6), C.gold, [sx * 0.13, 0.47, 0.215], null, null, 0.004);
    // 汤锅
    b.add(cyl(0.155, 0.135, 0.17, 18), 0xf28b6b, [0, 0.67, 0], null, null, L1);
    b.add(tor(0.155, 0.018, 8, 22), 0xe0705a, [0, 0.755, 0], [Math.PI / 2, 0, 0], null, 0.004);
    for (const sx of [-1, 1]) b.add(tor(0.035, 0.012, 6, 12), 0xe0705a, [sx * 0.17, 0.7, 0], [0, Math.PI / 2, 0], null, 0.004);
    b.add(cyl(0.14, 0.14, 0.01, 18), 0xffc36b, [0, 0.735, 0], null, null, 0);
    b.add(cyl(0.012, 0.012, 0.3, 6), 0xe0b07a, [0.06, 0.82, -0.02], [0, 0, -0.45], null, 0.004);
    b.add(sph(0.022, 8, 6), 0xffffff, [0.1, 0.81, 0.06], null, null, 0.004); // 汤里的小丸子
    // 火（炉门圆窗里，一闪一闪）
    const fire = new THREE.Mesh(new THREE.CircleGeometry(0.064, 20), fireMat);
    fire.position.set(0, 0.27, 0.226);
    stove.g.add(fire);
    glows.fire = glowSprite(0xff8a3c, 0.55);
    glows.fire.position.set(0, 0.27, 0.3);
    stove.g.add(glows.fire);
    // 汤里冒的泡泡
    potBubbles = new THREE.InstancedMesh(sph(0.03, 8, 6), toon(0xfff0c8), 6);
    potBubbles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    potBubbles.frustumCulled = false;
    stove.g.add(potBubbles);
    finish(stove);
    // 热气
    const soft = fairy.soft;
    for (let i = 0; i < 5; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: soft, color: 0xffffff, transparent: true, depthWrite: false, opacity: 0 }));
      sp.raycast = () => {};
      sp.userData.p = i / 5;
      root.add(sp);
      steam.push(sp);
    }
  }

  /* ---------- 孵蛋窝：木凳上的草窝 + 弯脖子暖灯 */
  const incubator = mkHot("incubator", [POS.incubator[0], POS.incubator[1]], POS.incubator[2]);
  const eggSlots = [];
  {
    const b = incubator.b;
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.5;
      b.add(cyl(0.022, 0.022, 0.29, 6), C.siding, [Math.cos(a) * 0.12, 0.145, Math.sin(a) * 0.12], [Math.sin(a) * 0.12, 0, -Math.cos(a) * 0.12], null, 0.005);
    }
    b.add(cyl(0.21, 0.2, 0.05, 20), C.cut, [0, 0.3, 0], null, null, 0.01);
    b.add(cyl(0.215, 0.215, 0.02, 20), 0xffc2cf, [0, 0.33, 0], null, null, 0.006);
    for (let i = 0; i < 8; i++) { // 毯子边上的小绒球
      const a = (i / 8) * Math.PI * 2;
      b.add(sph(0.018, 6, 4), 0xffffff, [Math.cos(a) * 0.215, 0.325, Math.sin(a) * 0.215], null, null, 0);
    }
    b.add(tor(0.15, 0.06, 8, 20), 0xe2b866, [0, 0.38, 0], [Math.PI / 2, 0, 0], [1, 1, 0.9], 0.01);
    b.add(cyl(0.15, 0.15, 0.03, 18), 0xf2d58c, [0, 0.36, 0], null, null, 0);
    const r = rng(5);
    for (let i = 0; i < 10; i++) {
      const a = r() * Math.PI * 2;
      b.add(box(0.09, 0.01, 0.01), 0xd6a650, [Math.cos(a) * 0.17, 0.43 + r() * 0.02, Math.sin(a) * 0.17], [0, a + 1.2 + r(), (r() - 0.5) * 0.6], null, 0);
    }
    // 暖灯：底座 + 杆 + 横臂 + 粉色灯罩
    const lx = 0.05, lz = -0.27;
    b.add(cyl(0.09, 0.1, 0.03, 16), 0x9e8f86, [lx, 0.015, lz], null, null, 0.006);
    b.add(cyl(0.018, 0.018, 0.86, 8), 0xb8aaa2, [lx, 0.44, lz], null, null, 0.005);
    b.add(sph(0.03, 8, 6), 0xb8aaa2, [lx, 0.87, lz], null, null, 0.005);
    b.add(cyl(0.016, 0.016, Math.hypot(0.27, 0.06), 8), 0xb8aaa2, [lx / 2, 0.87, lz / 2], [0, Math.atan2(lz, -lx), Math.PI / 2], null, 0.005);
    b.add(cyl(0.016, 0.016, 0.06, 8), 0xb8aaa2, [0, 0.84, 0], null, null, 0.005);
    b.add(new THREE.SphereGeometry(0.12, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2), 0xff9fb0, [0, 0.72, 0], null, [1, 0.85, 1], 0.01);
    b.add(tor(0.12, 0.012, 6, 20), 0xff8aa0, [0, 0.72, 0], [Math.PI / 2, 0, 0], null, 0.004);
    finish(incubator);
    const ip = incubator.g.position;
    addBulb(ip.x, 0.69, ip.z, 0.045);
    glows.incubator = glowSprite(0xffb060, 0.8);
    glows.incubator.position.set(0, 0.55, 0);
    incubator.g.add(glows.incubator);
    for (const sx of [-0.068, 0.068]) {
      const s = new THREE.Object3D();
      s.position.set(sx, 0.37, 0.01);
      incubator.g.add(s);
      eggSlots.push(s);
    }
  }

  /* ---------- 照片墙：6 个彩色相框（大小不一，有点歪） */
  const photowall = mkHot("photowall", [POS.photowall[0], 0], 0);
  const FR = [[-0.3, 1.63, 0.26, 0.2, C.pink, 0.04], [0, 1.66, 0.2, 0.26, C.mint, -0.03], [0.3, 1.62, 0.26, 0.2, C.butter, 0.02],
    [-0.29, 1.28, 0.2, 0.26, C.lilac, -0.03], [0.01, 1.3, 0.26, 0.2, C.sky, 0.03], [0.3, 1.27, 0.22, 0.22, C.peach, -0.02]];
  const photos = [];
  let phPortrait, phLand;
  {
    const b = photowall.b;
    const placeholder = (w, h) => canvasTex(w, h, (x) => {
      x.fillStyle = "#fff7ef"; x.fillRect(0, 0, w, h);
      x.strokeStyle = "#f3c4cf"; x.lineWidth = 4; x.setLineDash([10, 7]);
      x.strokeRect(10, 10, w - 20, h - 20);
      x.fillStyle = "#f7b8c6"; x.font = `${Math.round(Math.min(w, h) * 0.38)}px system-ui, sans-serif`;
      x.textAlign = "center"; x.textBaseline = "middle"; x.fillText("♥", w / 2, h / 2 + 4);
    });
    phLand = placeholder(128, 100); phPortrait = placeholder(100, 128);
    own.tex.push(phLand, phPortrait);
    FR.forEach(([x, y, w, h, col, rz], i) => {
      b.add(rbox(w + 0.07, h + 0.07, 0.035, 0.018), col, [x, y, BACK + 0.018], [0, 0, rz], null, 0.008);
      b.add(sph(0.012, 6, 4), 0xff6b8b, [x - Math.sin(rz) * (h / 2 + 0.035), y + Math.cos(rz) * (h / 2 + 0.035), BACK + 0.04], null, null, 0); // 小图钉
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, map: w >= h ? phLand : phPortrait });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
      m.position.set(x, y, BACK + 0.037);
      m.rotation.z = rz;
      photowall.g.add(m);
      photos.push({ mesh: m, mat, aspect: w / h, tex: null, src: null, pending: false });
    });
    finish(photowall);
  }
  // 照片墙最上面一串小彩旗
  {
    const x0 = POS.photowall[0], n = 7;
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1), x = x0 - 0.42 + u * 0.84, y = 1.86 - 0.05 * (1 - (2 * u - 1) ** 2);
      const tri = new THREE.CylinderGeometry(0.04, 0.04, 0.005, 3).rotateX(Math.PI / 2).rotateZ(Math.PI / 2 + Math.PI / 6 * 0);
      S.add(tri, [C.pink, C.butter, C.mint, C.lilac][i % 4], [x, y - 0.03, BACK + 0.02], [0, 0, -Math.PI / 2], [1, 1.3, 1], 0);
    }
  }

  /* ---------- 食谱：小圆桌上一本摊开的书 */
  const recipes = mkHot("recipes", [POS.recipes[0], POS.recipes[1]], POS.recipes[2]);
  {
    const b = recipes.b;
    b.add(cyl(0.13, 0.15, 0.03, 16), C.siding, [0, 0.015, 0], null, null, 0.006);
    b.add(cyl(0.035, 0.035, 0.45, 8), C.siding, [0, 0.24, 0], null, null, 0.006);
    b.add(cyl(0.22, 0.21, 0.04, 22), C.cut, [0, 0.48, 0], null, null, 0.01);
    b.add(cyl(0.19, 0.19, 0.006, 22), 0xffffff, [0, 0.503, 0], null, null, 0);
    // 书架子 + 书（往后倒一点，朝着镜头）
    b.add(box(0.05, 0.12, 0.05), C.siding, [0, 0.56, -0.07], [-0.5, 0, 0], null, 0.004);
    b.frame([0, 0.6, 0.0], [-0.95, 0, 0]);
    b.add(rbox(0.44, 0.29, 0.025, 0.012), 0xd9645a, [0, 0, -0.012], null, null, 0.008);
    for (const sg of [-1, 1]) {
      b.add(box(0.2, 0.265, 0.014), 0xfff8ea, [sg * 0.103, 0, 0.006], [0, -sg * 0.14, 0], null, 0.005);
      for (let j = 0; j < 5; j++) {
        const lw = sg < 0 && j < 2 ? 0.06 : 0.13;
        b.add(box(lw, 0.01, 0.004), 0xc9a98e, [sg * 0.103 + (sg < 0 && j < 2 ? 0.035 : 0), -0.085 + j * 0.035 - (j < 2 ? 0 : 0), 0.016 + sg * 0], [0, -sg * 0.14, 0], null, 0);
      }
    }
    // 左页画了一个小蛋糕
    b.add(cyl(0.032, 0.032, 0.03, 12), 0xffb3c4, [-0.14, 0.075, 0.03], [Math.PI / 2, 0, 0], [1, 1, 0.3], 0);
    b.add(sph(0.01, 6, 4), 0xff5b6b, [-0.14, 0.105, 0.032], null, null, 0);
    b.add(box(0.016, 0.1, 0.004), 0xff5b6b, [0.0, -0.17, 0.012], null, null, 0); // 书签带
    b.frame();
    // 旁边一个小杯子插着木勺
    b.add(cyl(0.04, 0.035, 0.08, 12), 0xa8e0cc, [0.15, 0.545, 0.08], null, null, 0.005);
    b.add(cyl(0.008, 0.008, 0.14, 6), 0xe0b07a, [0.16, 0.6, 0.08], [0, 0, -0.2], null, 0.003);
    b.add(sph(0.02, 8, 6), 0xe0b07a, [0.175, 0.67, 0.08], null, [1, 1.4, 0.6], 0.003);
    finish(recipes);
  }

  /* ---------- 门：拱形木门（出门） */
  const door = mkHot("door", [POS.door[0], POS.door[1]], 0);
  {
    const b = door.b;
    b.add(box(0.64, 0.86, 0.03), 0xe8c49a, [0, 0.43, 0.015], null, null, 0.008);
    b.add(halfCyl(0.32, 0.03, 20), 0xe8c49a, [0, 0.86, 0.015], null, null, 0.008);
    b.add(box(0.52, 0.86, 0.05), C.door, [0, 0.43, 0.04], null, null, 0.01);
    b.add(halfCyl(0.26, 0.05, 20), C.door, [0, 0.86, 0.04], null, null, 0.01);
    for (const sx of [-0.13, 0, 0.13]) b.add(box(0.012, 0.95, 0.006), 0x86593a, [sx, 0.52, 0.066], null, null, 0);
    b.add(tor(0.085, 0.02, 8, 22), C.gold, [0, 0.9, 0.07], null, null, 0.006);
    b.add(sph(0.032, 10, 8), C.gold, [0.18, 0.46, 0.08], null, null, 0.006);
    b.add(rbox(0.08, 0.1, 0.012, 0.01), C.gold, [0.18, 0.46, 0.067], null, null, 0);
    // 门口地垫（带小爱心）
    b.add(rbox(0.6, 0.02, 0.32, 0.03), 0xe6a96b, [0, 0.012, 0.25], null, null, 0.006);
    b.add(rbox(0.5, 0.006, 0.24, 0.02), 0xf2c48e, [0, 0.024, 0.25], null, null, 0);
    b.add(heartGeo(1.2, 0.006), 0xff8fab, [0, 0.03, 0.26], [-Math.PI / 2, 0, 0], null, 0);
    finish(door);
  }

  /* ---------- 信箱：门边墙上挂着的粉红小信箱，插着一封信 */
  const mailbox = mkHot("mailbox", [POS.mailbox[0], POS.mailbox[1]], POS.mailbox[2]);
  {
    const b = mailbox.b, R = 0xf47c7c;
    // 挂在右墙上（离地高一点，前排的东西挡不住）：木背板 + 小托架
    b.add(rbox(0.32, 0.32, 0.03, 0.03), C.cut, [0, 0.95, -0.175], null, null, 0.008);
    b.add(rbox(0.3, 0.03, 0.34, 0.012), C.siding, [0, 0.835, 0], null, null, 0.006);
    for (const sx of [-0.1, 0.1]) b.add(box(0.025, 0.1, 0.12), C.siding, [sx, 0.78, -0.11], [-0.6, 0, 0], null, 0.004);
    b.frame([0, 0.35, 0]);
    b.add(rbox(0.24, 0.14, 0.32, 0.03), R, [0, 0.5, 0], null, null, 0.01);
    b.add(halfCyl(0.12, 0.32, 18), R, [0, 0.57, 0], null, null, 0.01);
    b.add(halfCyl(0.125, 0.02, 18), 0xffa3a3, [0, 0.57, 0.16], null, null, 0.005);
    b.add(rbox(0.25, 0.14, 0.02, 0.02), 0xffa3a3, [0, 0.5, 0.16], null, null, 0.005);
    b.add(box(0.13, 0.016, 0.01), 0x6b3f3f, [0, 0.6, 0.172], null, null, 0);
    b.add(heartGeo(0.9, 0.01), 0xffffff, [0, 0.49, 0.17], null, null, 0);
    // 小旗子（竖起来 = 有信）
    b.add(box(0.015, 0.2, 0.015), 0xffd166, [0.135, 0.62, -0.06], null, null, 0.004);
    b.add(box(0.012, 0.06, 0.09), 0xffd166, [0.135, 0.69, -0.01], null, null, 0.004);
    // 插在投信口的信封 + 红色心形封蜡
    b.add(box(0.15, 0.1, 0.008), 0xfffaf0, [0, 0.66, 0.15], [-0.25, 0, 0.08], null, 0.004);
    b.add(cyl(0.018, 0.018, 0.008, 10), 0xff5b6b, [0.0, 0.67, 0.158], [Math.PI / 2 - 0.25, 0, 0], null, 0);
    b.frame();
    finish(mailbox);
  }

  /* ---------- 水族箱：木柜 + 玻璃缸（解锁前：空柜子 + 小盆栽 + 问号牌） */
  const aquarium = mkHot("aquarium", [POS.aquarium[0], POS.aquarium[1]], POS.aquarium[2]);
  const TANK = { w: 0.8, h: 0.46, d: 0.38, y: 0.67 };
  const tankGroup = new THREE.Group(), lockedGroup = new THREE.Group();
  aquarium.g.add(tankGroup, lockedGroup);
  const fishGroup = new THREE.Group();
  fishGroup.position.set(0, TANK.y, 0);
  tankGroup.add(fishGroup);
  let aqBubbles;
  {
    const b = aquarium.b;
    b.add(rbox(0.86, 0.42, 0.42, 0.04), C.cut, [0, 0.21, 0], null, null, 0.01);
    for (const sx of [-1, 1]) {
      b.add(rbox(0.38, 0.3, 0.02, 0.025), 0xe8c49a, [sx * 0.2, 0.21, 0.21], null, null, 0.005);
      b.add(sph(0.018, 8, 6), C.gold, [sx * 0.04, 0.23, 0.225], null, null, 0.004);
    }
    finish(aquarium);
    // 缸
    const t = new Baker(), A = 0x7fc8b5, { w, h, d, y } = TANK;
    t.add(rbox(w + 0.04, 0.04, d + 0.04, 0.015), A, [0, y - h / 2 - 0.01, 0], null, null, 0.008);
    t.add(rbox(w + 0.04, 0.035, d + 0.04, 0.015), A, [0, y + h / 2 + 0.01, 0], null, null, 0.008);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) t.add(box(0.026, h, 0.026), A, [sx * w / 2, y, sz * d / 2], null, null, 0.005);
    t.add(rbox(0.5, 0.03, 0.2, 0.012), 0xe8f6f0, [0, y + h / 2 + 0.04, -0.04], null, null, 0.005);
    t.add(box(w - 0.02, 0.05, d - 0.02), 0xf3dfb0, [0, y - h / 2 + 0.025, 0], null, null, 0);
    const r = rng(9);
    for (let i = 0; i < 14; i++) {
      t.add(sph(0.022, 6, 4), [0xffb3c4, 0xfff3e2, 0xc9b6ff, 0x9fd3ff][i % 4], [(r() - 0.5) * (w - 0.08), y - h / 2 + 0.05, (r() - 0.5) * (d - 0.08)], null, [1, 0.6, 1], 0);
    }
    [[-0.3, -0.08, 0.2], [-0.24, 0.06, 0.13], [0.26, -0.1, 0.17], [0.32, 0.05, 0.24], [0.05, -0.12, 0.1]].forEach(([sx, sz, hh], i) => {
      t.add(new THREE.CapsuleGeometry(0.018, hh, 4, 8), C.leaf[i % 3], [sx, y - h / 2 + 0.05 + hh / 2, sz], [0, 0, (i % 2 ? 0.15 : -0.15)], null, 0.004);
    });
    // 小城堡 + 贝壳
    t.add(cyl(0.045, 0.05, 0.12, 10), 0xffc2cf, [-0.12, y - h / 2 + 0.1, -0.08], null, null, 0.005);
    t.add(new THREE.ConeGeometry(0.055, 0.07, 10), 0xff8fab, [-0.12, y - h / 2 + 0.195, -0.08], null, null, 0.005);
    t.add(new THREE.SphereGeometry(0.035, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), 0xfff0e8, [0.14, y - h / 2 + 0.05, 0.08], null, [1, 0.7, 1], 0.004);
    t.build(aquarium.mat, tankGroup, outlined).forEach((m) => hot.aquarium.meshes.push(m));
    // 玻璃 + 水（半透明）
    const glass = new THREE.Mesh(box(w, h, d), new THREE.MeshBasicMaterial({ color: 0xd8f6ff, transparent: true, opacity: 0.16, depthWrite: false }));
    glass.position.y = y;
    glass.renderOrder = 2;
    const water = new THREE.Mesh(box(w - 0.02, h - 0.07, d - 0.02), new THREE.MeshBasicMaterial({ color: 0x5cc8ef, transparent: true, opacity: 0.42, depthWrite: false }));
    water.position.y = y - 0.03;
    water.renderOrder = 1;
    glass.raycast = water.raycast = () => {};
    tankGroup.add(water, glass);
    // 玻璃上的两道高光
    const gl = new Baker();
    gl.add(box(0.018, 0.16, 0.002), 0xffffff, [-0.3, y + 0.1, d / 2 + 0.002], [0, 0, -0.6], null, 0);
    gl.add(box(0.01, 0.1, 0.002), 0xffffff, [-0.26, y + 0.12, d / 2 + 0.002], [0, 0, -0.6], null, 0);
    const glintMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.6, depthWrite: false });
    gl.build(glintMat, tankGroup, outlined).forEach((m) => { m.renderOrder = 3; });
    // 气泡
    aqBubbles = new THREE.InstancedMesh(sph(0.012, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 }), 6);
    aqBubbles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    aqBubbles.frustumCulled = false;
    aqBubbles.renderOrder = 1;
    tankGroup.add(aqBubbles);
    // 解锁前：小盆栽 + 问号牌
    const lk = new Baker();
    lk.add(cyl(0.08, 0.065, 0.12, 12), C.pot, [0.2, 0.48, 0], null, null, 0.006);
    [[0, 0.6, 0, 0.08], [-0.06, 0.57, 0.02, 0.06], [0.06, 0.58, 0.01, 0.06]].forEach(([dx, yy, dz, rr], i) => lk.add(sph(rr, 10, 8), C.leaf[i % 3], [0.2 + dx, yy, dz], null, null, 0.006));
    lk.add(rbox(0.24, 0.22, 0.025, 0.03), 0xfff3e2, [-0.15, 0.57, 0.02], [-0.2, 0, 0], null, 0.008);
    lk.add(box(0.02, 0.18, 0.02), C.siding, [-0.15, 0.5, -0.03], [0.25, 0, 0], null, 0.004);
    lk.build(aquarium.mat, lockedGroup, outlined).forEach((m) => hot.aquarium.meshes.push(m));
    const qTex = canvasTex(128, 128, (x) => {
      x.fillStyle = "#9fd3ff"; x.beginPath(); x.arc(64, 64, 56, 0, Math.PI * 2); x.fill();
      x.fillStyle = "#ffffff"; x.font = "bold 84px system-ui, sans-serif"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText("?", 64, 70);
    });
    own.tex.push(qTex);
    const q = new THREE.Mesh(new THREE.PlaneGeometry(0.17, 0.17), new THREE.MeshBasicMaterial({ map: qTex, transparent: true }));
    q.position.set(-0.15, 0.57, 0.036);
    q.rotation.x = -0.2;
    lockedGroup.add(q);
  }
  tankGroup.visible = false;

  /* ---------- 储物架：罐子、篮子、麻袋，顶上一个小背包 */
  const shelf = mkHot("shelf", [POS.shelf[0], POS.shelf[1]], POS.shelf[2]);
  {
    const b = shelf.b, Wd = 0xd6a774, H = 1.25;
    for (const sx of [-1, 1]) b.add(box(0.04, H, 0.34), Wd, [sx * 0.36, H / 2, 0], null, null, 0.008);
    b.add(rbox(0.8, 0.045, 0.38, 0.015), Wd, [0, H, 0], null, null, 0.008);
    for (const y of [0.04, 0.45, 0.85]) b.add(box(0.7, 0.03, 0.32), Wd, [0, y, 0], null, null, 0.006);
    b.add(box(0.72, H, 0.02), 0xc08a5a, [0, H / 2, -0.16], null, null, 0.006);
    b.add(rbox(0.8, 0.05, 0.03, 0.015), C.roof, [0, H - 0.04, 0.18], null, null, 0.005);
    // 下层：两只麻袋
    [[-0.17, 0.12, 0xe2cfa8, 1], [0.16, 0.105, 0xd9c49e, 0.88]].forEach(([x, r, col, s]) => {
      b.add(sph(r, 14, 10), col, [x, 0.055 + r * 1.05, 0.0], null, [1, 1.1, 0.9], 0.008);
      b.add(cyl(0.04 * s, 0.06 * s, 0.07, 10), col, [x, 0.055 + r * 2.1 + 0.02, 0], null, null, 0.005);
      b.add(tor(0.045 * s, 0.01, 6, 12), 0xa0704a, [x, 0.055 + r * 2.1, 0], [Math.PI / 2, 0, 0], null, 0);
      b.add(cyl(0.035 * s, 0.035 * s, 0.005, 12), 0xffffff, [x, 0.055 + r * 1.1, r * 0.92], [Math.PI / 2, 0, 0], null, 0);
    });
    // 中层：苹果篮 + 面包篮
    [[-0.17, 0xff6b6b, true], [0.17, 0xe8b070, false]].forEach(([x, col, apples]) => {
      b.add(cyl(0.13, 0.1, 0.11, 14), 0xd9a35f, [x, 0.52, 0], null, null, 0.008);
      b.add(tor(0.13, 0.014, 6, 16), 0xc08a4a, [x, 0.575, 0], [Math.PI / 2, 0, 0], null, 0);
      b.add(tor(0.1, 0.01, 6, 14, Math.PI), 0xc08a4a, [x, 0.575, 0], null, null, 0.004);
      if (apples) [[-0.05, 0.6, 0.03], [0.05, 0.6, 0.02], [0, 0.63, -0.04]].forEach(([dx, y, dz]) => {
        b.add(sph(0.048, 10, 8), col, [x + dx, y, dz], null, null, 0.005);
        b.add(box(0.008, 0.03, 0.008), 0x6b4a2a, [x + dx, y + 0.055, dz], null, null, 0);
      });
      else [[-0.04, 0.03], [0.04, -0.03]].forEach(([dx, dz]) => b.add(new THREE.CapsuleGeometry(0.035, 0.08, 4, 8), col, [x + dx, 0.6, dz], [0, 0.5, Math.PI / 2], null, 0.005));
    });
    // 上层：三罐果酱 / 蜂蜜 / 薄荷糖
    [[-0.22, 0xff8fab, 0.15], [0, 0xffc94d, 0.18], [0.22, 0x9be0c4, 0.14]].forEach(([x, col, hh]) => {
      b.add(cyl(0.06, 0.06, hh, 14), col, [x, 0.865 + hh / 2, 0], null, null, 0.006);
      b.add(cyl(0.062, 0.062, 0.045, 14), 0xfffaf0, [x, 0.865 + hh * 0.45, 0], null, null, 0);
      b.add(cyl(0.066, 0.066, 0.035, 14), x < 0 ? 0xff6b6b : x > 0 ? 0x7fc8b5 : C.gold, [x, 0.865 + hh + 0.017, 0], null, null, 0.005);
    });
    // 顶上：小背包
    b.add(rbox(0.28, 0.27, 0.16, 0.07), 0xffb26b, [0.02, H + 0.155, 0], null, null, 0.01);
    b.add(rbox(0.29, 0.11, 0.17, 0.045), 0xff9a50, [0.02, H + 0.25, 0.008], null, null, 0.006);
    b.add(rbox(0.16, 0.1, 0.04, 0.03), 0xff9a50, [0.02, H + 0.11, 0.085], null, null, 0.006);
    b.add(rbox(0.04, 0.03, 0.01, 0.008), C.gold, [0.02, H + 0.2, 0.095], null, null, 0);
    b.add(tor(0.04, 0.012, 6, 12, Math.PI), 0xd9773a, [0.02, H + 0.29, 0], null, null, 0.004);
    finish(shelf);
  }

  /* ---------- 灯泡（一块合并）+ 窗外天空（窗、阁楼圆窗、门上圆窗共用一张贴图） */
  {
    const bulbs = new THREE.Mesh(mergeGeometries(bulbGeos, false), bulbMat);
    bulbGeos.forEach((g) => g.dispose());
    bulbs.raycast = () => {};
    root.add(bulbs);
  }
  const skyDay = skyTex(false), skyNight = skyTex(true);
  own.tex.push(skyDay, skyNight);
  const skyMat = new THREE.MeshBasicMaterial({ map: skyDay });
  {
    const a = new THREE.PlaneGeometry(WIN.w + 0.02, WIN.h + 0.02).translate(WIN.x, WIN.y, BACK - 0.06);
    const b2 = new THREE.CircleGeometry(0.16, 24).translate(0, 2.4, BACK + 0.004);
    const c2 = new THREE.CircleGeometry(0.075, 20).translate(POS.door[0], 0.9, BACK + 0.068);
    const sky = new THREE.Mesh(mergeGeometries([a, b2, c2], false), skyMat);
    [a, b2, c2].forEach((g) => g.dispose());
    sky.raycast = () => {};
    root.add(sky);
  }

  /* ---------- 静态装饰合批 */
  S.build(staticMat, root, outlined);

  /* ---------- 热点：userData、点击用的隐形盒子、标签锚点 */
  scene.updateMatrixWorld(true);
  const proxies = [];
  const _b = new THREE.Box3(), _b2 = new THREE.Box3();
  const proxyMat = new THREE.MeshBasicMaterial({ visible: false });
  for (const id of INTERIOR_IDS) {
    const h = hot[id];
    _b.makeEmpty();
    for (const m of h.meshes) {
      // 网格在热点组里的局部包围盒（tank/locked 组没有额外变换）
      _b2.copy(m.geometry.boundingBox);
      _b.union(_b2);
    }
    if (id === "photowall") for (const p of photos) { _b2.setFromCenterAndSize(p.mesh.position, _v.set(0.3, 0.3, 0.02)); _b.union(_b2); }
    _b.expandByScalar(0.03);
    const size = _b.getSize(new THREE.Vector3()), ctr = _b.getCenter(new THREE.Vector3());
    if (id === "photowall") { size.z = 0.25; ctr.z = BACK + 0.125; }
    if (id === "door") { size.z = Math.max(size.z, 0.25); ctr.z = size.z / 2; }
    const px = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), proxyMat);
    px.position.copy(ctr);
    h.root.add(px);
    h.proxy = px;
    proxies.push(px);
    // 标签锚点：包围盒顶上中间
    h.anchor.set(ctr.x, _b.max.y + 0.06, ctr.z);
    if (id === "door") h.anchor.set(0, 0.62, 0.08); // 门的标签贴在门板中间（不和旁边的信箱抢位置）
    h.root.updateMatrixWorld(true);
    h.root.localToWorld(h.anchor);
    h.root.userData.what = "hotspot";
    h.root.userData.id = id;
    h.root.traverse((o) => { o.userData.what = "hotspot"; o.userData.id = id; });
  }
  // 水族箱没解锁时，锚点低一点（只有柜子 + 牌子）
  hot.aquarium.anchorLocked = new THREE.Vector3(-0.1, 0.74, 0);
  hot.aquarium.root.localToWorld(hot.aquarium.anchorLocked);
  hot.aquarium.anchorOpen = hot.aquarium.anchor.clone();

  // 热气起点（世界坐标）
  steamOrigin.set(0, 0.76, 0);
  stove.g.localToWorld(steamOrigin);

  /* ================================================================ 镜头 */
  const fitPts = [
    [-OUT, -0.32, FRONT + 0.05], [OUT, -0.32, FRONT + 0.05], [-OUT - 0.3, WH + 0.1, BACK - 0.3], [OUT + 0.3, WH + 0.1, BACK - 0.3],
    [0, APEX + 0.16, BACK - 0.2], [-OUT, WH + 0.08, FRONT], [OUT, WH + 0.08, FRONT],
  ].map((p) => new THREE.Vector3(...p));
  const target = new THREE.Vector3();
  let viewW = 1, viewH = 1;
  function resize(w, h) {
    viewW = w; viewH = h;
    const aspect = w / Math.max(1, h), portrait = aspect < 0.9;
    camera.aspect = aspect;
    camera.fov = portrait ? 26 : 28;
    const elev = portrait ? 0.36 : 0.24;
    const mx = portrait ? 0.985 : 0.9, my = portrait ? 0.92 : 0.88;
    // 竖屏时前面两个角允许稍微出画（只有墙柱）
    fitPts[0].x = portrait ? -OUT + 0.12 : -OUT; fitPts[1].x = portrait ? OUT - 0.12 : OUT;
    fitPts[2].x = portrait ? -OUT - 0.1 : -OUT - 0.3; fitPts[3].x = portrait ? OUT + 0.1 : OUT + 0.3;
    target.set(0, 1.05, 0.05);
    let dist = 9;
    camera.updateProjectionMatrix();
    for (let it = 0; it < 6; it++) {
      camera.position.set(0, target.y + Math.sin(elev) * dist, target.z + Math.cos(elev) * dist);
      camera.lookAt(target);
      camera.updateMatrixWorld(true);
      let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
      for (const p of fitPts) {
        _v.copy(p).project(camera);
        x0 = Math.min(x0, _v.x); x1 = Math.max(x1, _v.x); y0 = Math.min(y0, _v.y); y1 = Math.max(y1, _v.y);
      }
      const s = Math.max(Math.max(-x0, x1) / mx, (y1 - y0) / 2 / my);
      const tn = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      target.y += ((y1 + y0) / 2) * dist * tn * Math.cos(elev) * 0.9;
      dist *= s;
    }
    camera.position.set(0, target.y + Math.sin(elev) * dist, target.z + Math.cos(elev) * dist);
    camera.lookAt(target);
    camera.updateMatrixWorld(true);
  }
  resize(1280, 800);

  /* ================================================================ 状态 / 每帧 */
  let nightWant = 0, night = 0, cookWant = 0, cookK = 0, hiId = null, aqOpen = false;
  const fireA = new THREE.Color(0xff6a2a), fireB = new THREE.Color(0xffd36b), photoDay = new THREE.Color(0xffffff), photoNight = new THREE.Color(0xd8cde6);
  const _p = new THREE.Vector3(), _sc = new THREE.Vector3();

  function update(t, dt) {
    const k = Math.min(1, dt * 2.5);
    night += (nightWant - night) * k;
    cookK += (cookWant - cookK) * k;
    // 光
    hemi.color.lerpColors(L.hemiSky[0], L.hemiSky[1], night);
    hemi.groundColor.lerpColors(L.hemiGround[0], L.hemiGround[1], night);
    hemi.intensity = L.hemiI[0] + (L.hemiI[1] - L.hemiI[0]) * night;
    key.color.lerpColors(L.key[0], L.key[1], night);
    key.intensity = L.keyI[0] + (L.keyI[1] - L.keyI[0]) * night;
    fill.intensity = L.fillI[0] + (L.fillI[1] - L.fillI[0]) * night;
    scene.background.lerpColors(BG_DAY, BG_NIGHT, night);
    const wantMap = night > 0.5 ? skyNight : skyDay;
    if (skyMat.map !== wantMap) { skyMat.map = wantMap; }
    shadeMat.emissiveIntensity = 0.1 + 0.55 * night;
    glows.pendant.material.opacity = 0.18 + 0.7 * night;
    glows.incubator.material.opacity = 0.42 + 0.25 * night + Math.sin(t * 1.6) * 0.08;
    for (let i = 0; i < photos.length; i++) photos[i].mat.color.lerpColors(photoDay, photoNight, night);
    // 炉火一闪一闪；做饭时更旺
    const f = 0.7 + 0.16 * Math.sin(t * 13.1) + 0.1 * Math.sin(t * 7.3 + 1.3) + 0.04 * Math.sin(t * 23.7);
    fireMat.color.lerpColors(fireA, fireB, f * (0.55 + 0.45 * cookK));
    glows.fire.material.opacity = (0.3 + 0.4 * cookK + 0.2 * night) * f;
    // 彩灯闪
    const ca = fairy.im.instanceColor.array, pa = fairy.pc.array, bright = 0.55 + 0.45 * night;
    for (let i = 0; i < fairy.N; i++) {
      const tw = 0.6 + 0.4 * (0.5 + 0.5 * Math.sin(t * 2.1 + i * 1.73));
      for (let j = 0; j < 3; j++) {
        const v = fairy.base[i * 3 + j];
        ca[i * 3 + j] = Math.min(1, v * (0.65 + 0.35 * tw) + 0.15 * night);
        pa[i * 3 + j] = v * tw * bright;
      }
    }
    fairy.im.instanceColor.needsUpdate = true;
    fairy.pc.needsUpdate = true;
    // 窗帘
    curtains[0].rotation.z = Math.sin(t * 0.9) * 0.025;
    curtains[0].rotation.x = 0.03 + Math.sin(t * 0.7) * 0.03;
    curtains[1].rotation.z = Math.sin(t * 0.9 + 1.7) * 0.025;
    curtains[1].rotation.x = 0.03 + Math.sin(t * 0.7 + 2.1) * 0.03;
    // 热气：平时一点点，做饭时一大团
    const sp = 0.25 + 0.35 * cookK;
    for (let i = 0; i < steam.length; i++) {
      const s = steam[i], p = (t * sp + s.userData.p) % 1;
      s.position.set(steamOrigin.x + Math.sin(t * 1.3 + i * 2.1) * 0.05 * p, steamOrigin.y + p * (0.45 + 0.35 * cookK), steamOrigin.z + Math.cos(t + i) * 0.02);
      s.scale.setScalar((0.12 + p * 0.32) * (0.85 + 0.75 * cookK));
      s.material.opacity = Math.sin(p * Math.PI) * (0.25 + 0.65 * cookK);
    }
    // 汤里的泡泡
    for (let i = 0; i < 6; i++) {
      const p = (t * (1.1 + i * 0.13) + i * 0.37) % 1, a = i * 1.05 + 0.3, r = 0.03 + (i % 3) * 0.035;
      const sc = cookK * Math.sin(p * Math.PI) * (0.7 + (i % 2) * 0.5);
      _p.set(Math.cos(a) * r, 0.738 + p * 0.012, Math.sin(a) * r);
      _sc.setScalar(Math.max(0.0001, sc));
      _q.identity();
      _m.compose(_p, _q, _sc);
      potBubbles.setMatrixAt(i, _m);
    }
    potBubbles.instanceMatrix.needsUpdate = true;
    // 水族箱气泡
    if (aqOpen) {
      for (let i = 0; i < 6; i++) {
        const p = (t * 0.35 + i / 6) % 1;
        _p.set(0.3 + Math.sin(t * 3 + i) * 0.012, TANK.y - 0.17 + p * 0.34, -0.1);
        _sc.setScalar(0.6 + p * 0.6);
        _q.identity();
        _m.compose(_p, _q, _sc);
        aqBubbles.setMatrixAt(i, _m);
      }
      aqBubbles.instanceMatrix.needsUpdate = true;
    }
    // 高亮的热点轻轻发光
    if (hiId) hot[hiId].mat.emissiveIntensity = 0.14 + 0.24 * (0.5 + 0.5 * Math.sin(t * 4.5));
    // 照片：贴图加载好了再裁切
    for (let i = 0; i < photos.length; i++) if (photos[i].pending) cropPhoto(photos[i]);
  }

  /* ---------- 照片 */
  function imgSize(tex) {
    const im = tex && tex.image;
    if (!im) return null;
    const w = im.videoWidth || im.naturalWidth || im.width, h = im.videoHeight || im.naturalHeight || im.height;
    return w && h ? [w, h] : null;
  }
  function cropPhoto(p) {
    const sz = imgSize(p.tex);
    if (!sz) return;
    const ia = sz[0] / sz[1], fa = p.aspect;
    if (ia > fa) { p.tex.repeat.set(fa / ia, 1); p.tex.offset.set((1 - fa / ia) / 2, 0); }
    else { p.tex.repeat.set(1, ia / fa); p.tex.offset.set(0, (1 - ia / fa) / 2); }
    p.pending = false;
  }
  function setPhotos(textures = []) {
    photos.forEach((p, i) => {
      if (p.tex) { p.tex.dispose(); p.tex = null; }
      const src = textures[i];
      if (src && src.isTexture) {
        const tx = src.clone(); // 不改调用方的贴图（共享同一份图片数据）
        tx.colorSpace = THREE.SRGBColorSpace;
        tx.wrapS = tx.wrapT = THREE.ClampToEdgeWrapping;
        tx.needsUpdate = true;
        p.tex = tx;
        p.pending = true;
        cropPhoto(p);
        p.mat.map = tx;
      } else {
        p.mat.map = p.aspect >= 1 ? phLand : phPortrait;
      }
      p.mat.needsUpdate = true;
    });
  }

  /* ---------- 点击 / 标签 */
  const ray = new THREE.Raycaster(), _ndc = new THREE.Vector2(), _hits = [];
  function pick(nx, ny) {
    _ndc.set(nx, ny);
    ray.setFromCamera(_ndc, camera);
    _hits.length = 0;
    ray.intersectObjects(proxies, false, _hits);
    return _hits.length ? _hits[0].object.userData.id : null;
  }
  function hotspotScreen(id, w = viewW, h = viewH, out = { x: 0, y: 0 }) {
    const hs = hot[id];
    if (!hs) return null;
    const a = id === "aquarium" ? (aqOpen ? hs.anchorOpen : hs.anchorLocked) : hs.anchor;
    _v.copy(a).project(camera);
    out.x = (_v.x + 1) / 2 * w;
    out.y = (1 - _v.y) / 2 * h;
    return out;
  }
  function highlight(id) {
    if (hiId && hot[hiId]) hot[hiId].mat.emissiveIntensity = 0;
    hiId = id && hot[id] ? id : null;
  }
  function setAquariumVisible(v) {
    aqOpen = !!v;
    tankGroup.visible = aqOpen;
    lockedGroup.visible = !aqOpen;
  }
  setAquariumVisible(false);
  setPhotos([]);

  function dispose() {
    for (const p of photos) if (p.tex) p.tex.dispose();
    const mats = new Set();
    scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => mats.add(m));
    });
    mats.forEach((m) => m.dispose());
    for (const t of own.tex) t.dispose();
    proxyMat.dispose();
  }

  return {
    scene, camera, root, resize, update, pick, hotspotScreen, highlight,
    setNight(v) { nightWant = v ? 1 : 0; },
    cook(k) { cookWant = Math.max(0, Math.min(1, +k || 0)); },
    setPhotos, setAquariumVisible, dispose,
    ids: INTERIOR_IDS, labels: INTERIOR_LABELS,
    slots: {
      incubator: eggSlots,
      aquarium: { group: fishGroup, w: TANK.w - 0.06, h: TANK.h - 0.12, d: TANK.d - 0.06 },
      petBeds,
      visitorSpot,
    },
  };
}
