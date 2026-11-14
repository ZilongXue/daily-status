// 毛绒小恐龙：照着一只真实的玩偶，用 Three.js 基础几何体程序化搭出来，没有外部模型。
// 接口和 pet3d.js 的 buildPet 返回值一致：朝向 +z，站立高度约 1.5，脚在 y=0。
// 外形：淡黄绿色的梨形一坨（头身一体），半睁的困困眼、白色毡布小尖牙、
// 芥末黄的罗纹游泳圈、白肚皮、背上一串深绿色圆片背刺、小短手小短脚小短尾巴。
import * as THREE from "three";

const C = {
  fur: 0xd3e29c, belly: 0xf6f3e8, ring: 0xf7cf38, spine: 0x4f7a3a,
  rim: 0x3c6a2a, lid: 0x77a046, white: 0xfbfaf2, pupil: 0x232323, fang: 0xffffff,
};

/* ---------------------------------------------------------------- noise + textures */
const hash = (i, j, k) => { const s = Math.sin(i * 127.1 + j * 311.7 + k * 74.7) * 43758.5453; return s - Math.floor(s); };
const sm = (t) => t * t * (3 - 2 * t);
function vnoise(x, y, z) { // 3D value noise, [-1, 1]
  const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z);
  const u = sm(x - i), v = sm(y - j), w = sm(z - k);
  const L = (a, b, t) => a + (b - a) * t;
  const c = (a, b, d) => hash(i + a, j + b, k + d);
  return 2 * L(L(L(c(0, 0, 0), c(1, 0, 0), u), L(c(0, 1, 0), c(1, 1, 0), u), v),
    L(L(c(0, 0, 1), c(1, 0, 1), u), L(c(0, 1, 1), c(1, 1, 1), u), v), w) - 1;
}

let TEX = null; // 只生成一次，换小伙伴时复用
function textures() {
  if (TEX) return TEX;
  const canvasTex = (w, h, draw, rx, ry) => {
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    draw(cv.getContext("2d"), w, h);
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(rx, ry);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  // 羊羔绒：一堆小卷卷，亮的暗的交错
  const fleece = (g, w, h) => {
    g.fillStyle = "#e4e4e4"; g.fillRect(0, 0, w, h);
    for (let n = 0; n < 1600; n++) {
      const x = rnd() * w, y = rnd() * h, r = 2 + rnd() * 4, l = 190 + rnd() * 65 | 0;
      g.strokeStyle = `rgb(${l},${l},${l})`;
      g.lineWidth = 1.5 + rnd() * 2;
      g.beginPath(); g.arc(x, y, r, rnd() * 6.3, rnd() * 6.3 + 2 + rnd() * 3); g.stroke();
    }
  };
  // 游泳圈的斜纹罗纹布
  const twill = (g, w, h) => {
    g.fillStyle = "#ffffff"; g.fillRect(0, 0, w, h);
    g.strokeStyle = "#dedede"; g.lineWidth = 3;
    for (let x = -h; x < w + h; x += 8) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + h, h); g.stroke(); }
  };
  TEX = { fur: canvasTex(256, 256, fleece, 7, 4), fleck: canvasTex(256, 256, fleece, 2, 1), twill: canvasTex(64, 64, twill, 20, 2) };
  return TEX;
}

// 毛茸茸的球：单位球顶点沿法线用噪声推一推，轮廓就不规则了；法线保持光滑，细节交给 bumpMap
function fuzzSphere(ws, hs, amp = 0.05, seed = 0) {
  const g = new THREE.SphereGeometry(1, ws, hs);
  const p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const d = 0.6 * vnoise(v.x * 3 + seed, v.y * 3, v.z * 3) + 0.4 * vnoise(v.x * 11, v.y * 11 + seed, v.z * 11);
    v.multiplyScalar(1 + amp * d);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  return g;
}

// 椭球表面上的点 / 法线（c = 中心，r = 半径）
const ellZ = (c, r, x, y) => c.z + r.z * Math.sqrt(Math.max(0, 1 - ((x - c.x) / r.x) ** 2 - ((y - c.y) / r.y) ** 2));
const ellN = (c, r, p) => new THREE.Vector3((p.x - c.x) / r.x ** 2, (p.y - c.y) / r.y ** 2, (p.z - c.z) / r.z ** 2).normalize();
const ZAX = new THREE.Vector3(0, 0, 1);
// 把一个平面贴片放到椭球表面（朝外，略微浮起）
function stick(obj, c, r, x, y, lift = 0.03) {
  const p = new THREE.Vector3(x, y, ellZ(c, r, x, y));
  const n = ellN(c, r, p);
  obj.position.copy(p).addScaledVector(n, lift);
  obj.quaternion.setFromUnitVectors(ZAX, n);
  return obj;
}
// 平面 Shape 弯成球面（贴合脸的弧度）
function bentShape(pts, R = 0.42) {
  const g = new THREE.ShapeGeometry(new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y))));
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setZ(i, -(p.getX(i) ** 2 + p.getY(i) ** 2) / (2 * R));
  return g;
}

/* ---------------------------------------------------------------- build */
export function buildDino({ toon, outlined }) {
  const T = textures();
  const furMat = (color, map = T.fur) => toon(color, { map, bumpMap: map, bumpScale: 1.1 });
  const fuzz = (ws, hs, amp, seed, color, line = 0.02, map) => outlined(new THREE.Mesh(fuzzSphere(ws, hs, amp, seed), furMat(color, map)), line);
  const basic = (color) => new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
  const flat = (color) => toon(color, { side: THREE.DoubleSide });

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  // ---- 下半身（梨形的下半，比头宽一点）
  const BC = new THREE.Vector3(0, 0.47, 0), BR = new THREE.Vector3(0.53, 0.45, 0.48);
  const torso = fuzz(40, 28, 0.06, 1, C.fur, 0.02);
  torso.scale.copy(BR); torso.position.copy(BC);
  body.add(torso);

  // 白肚皮
  const belly = fuzz(20, 14, 0.05, 4, C.belly, 0.015, T.fleck);
  belly.scale.set(0.31, 0.24, 0.07);
  stick(belly, BC, BR, 0, 0.35, -0.045);
  belly.quaternion.identity();
  body.add(belly);

  // 芥末黄游泳圈（斜纹罗纹），稍微歪一点
  const ringGeo = new THREE.TorusGeometry(0.5, 0.105, 12, 40);
  const ring = outlined(new THREE.Mesh(ringGeo, toon(C.ring, { map: T.twill, bumpMap: T.twill, bumpScale: 0.8 })), 0.018);
  ring.rotation.set(Math.PI / 2 + 0.1, 0.07, 0);
  ring.scale.set(1.02, 0.95, 1.0);
  ring.position.set(0, 0.64, 0.0);
  body.add(ring);

  // ---- 脚
  const feet = [-1, 1].map((s) => {
    const f = fuzz(16, 10, 0.08, 6 + s, C.fur, 0.018);
    f.scale.set(0.15, 0.1, 0.18);
    f.position.set(s * 0.22, 0.07, 0.24);
    body.add(f);
    return f;
  });

  // ---- 小短手（pivot 转 z 就是挥手）
  const arms = [-1, 1].map((s) => {
    const pivot = new THREE.Group();
    pivot.position.set(s * 0.44, 0.5, 0.1);
    const a = fuzz(14, 10, 0.08, 9 + s, C.fur, 0.018);
    a.scale.set(0.11, 0.15, 0.12);
    a.position.set(s * 0.04, -0.09, 0);
    pivot.add(a);
    pivot.rotation.z = s * 0.35;
    body.add(pivot);
    return pivot;
  });

  // ---- 背刺：深绿色扁圆片，从头顶一路排到尾巴（y 轴对齐表面法线，薄的方向是 x）
  const spineGeo = new THREE.SphereGeometry(1, 12, 8);
  const spineMat = toon(C.spine);
  const plate = (parent, c, r, th, size, lift = 0.02) => {
    const p = new THREE.Vector3(0, c.y + r.y * Math.cos(th), c.z - r.z * Math.sin(th));
    const n = ellN(c, r, p);
    const m = outlined(new THREE.Mesh(spineGeo, spineMat), 0.012);
    m.scale.set(0.03, size, size * 1.05);
    m.position.copy(p).addScaledVector(n, lift);
    m.rotation.x = Math.atan2(n.z, n.y);
    parent.add(m);
  };
  for (const [th, s] of [[1.6, 0.06], [1.85, 0.065], [2.12, 0.06]]) plate(body, BC, BR, th, s);

  // ---- 小短尾巴（rotation.y 摇）
  const tail = new THREE.Group();
  tail.position.set(0, 0.2, -0.36);
  const tailIn = new THREE.Group(); // 往后下方耷拉
  tailIn.position.set(0, -0.03, -0.12);
  tailIn.rotation.x = -0.3;
  const TR = new THREE.Vector3(0.17, 0.15, 0.28);
  const tailM = fuzz(18, 12, 0.07, 12, C.fur, 0.02);
  tailM.scale.copy(TR);
  tailIn.add(tailM);
  tail.add(tailIn);
  body.add(tail);
  for (const [th, s] of [[0.8, 0.05], [1.2, 0.045]]) plate(tailIn, new THREE.Vector3(), TR, th, s);

  // ---- 头（上半身；看向 / 歪头都动这个）
  const head = new THREE.Group();
  head.position.y = 0.95;
  body.add(head);
  const HC = new THREE.Vector3(0, 0.05, 0.01), HR = new THREE.Vector3(0.5, 0.47, 0.47);
  const skull = fuzz(40, 28, 0.06, 2, C.fur, 0.022);
  skull.scale.copy(HR); skull.position.copy(HC);
  head.add(skull);
  for (const [th, s] of [[-0.12, 0.06], [0.2, 0.07], [0.52, 0.075], [0.85, 0.075], [1.18, 0.07], [1.5, 0.065]]) plate(head, HC, HR, th, s);

  // ---- 眼睛：深绿描边的椭圆，上下眼皮（绿）夹着一条白带 + 小黑眼珠
  const EA = 0.126, EB = 0.094;
  const top = (x) => EB * Math.sqrt(Math.max(0, 1 - (x / EA) ** 2));
  const xs = Array.from({ length: 17 }, (_, i) => -EA + (2 * EA * i) / 16);
  const ellipse = (a, b) => Array.from({ length: 28 }, (_, i) => [a * Math.cos((i / 28) * 6.283), b * Math.sin((i / 28) * 6.283)]);
  const upperLid = (edge, droop) => bentShape([...xs.map((x) => [x, top(x)]),
    ...xs.slice().reverse().map((x) => [x, Math.min(top(x), edge - droop * (1 - (x / EA) ** 2))])]);
  const lowerLid = (edge) => bentShape([...xs.map((x) => [x, Math.max(-top(x), edge + 0.012 * (1 - (x / EA) ** 2))]),
    ...xs.slice().reverse().map((x) => [x, -top(x)])]);
  // 每种状态：上眼皮下沿、下眼皮上沿、眼珠大小
  const LIDS = {
    open: { up: upperLid(0.024, 0.012), lo: lowerLid(-0.04), py: -0.008, pr: 1 },
    half: { up: upperLid(0.0, 0.006), lo: lowerLid(-0.042), py: -0.022, pr: 0.9 },
    wide: { up: upperLid(0.072, 0.0), lo: lowerLid(-0.082), py: 0.0, pr: 1.35 },
  };
  const rimGeo = bentShape(ellipse(EA + 0.017, EB + 0.017));
  const fillGeo = bentShape(ellipse(EA, EB));
  const pupilGeo = bentShape(ellipse(0.018, 0.021));
  const lidMat = flat(C.lid), rimMat = flat(C.rim), darkMat = basic(0x2f4a22);
  const arc = new THREE.TorusGeometry(0.075, 0.012, 6, 16, Math.PI);
  const eyes = [-1, 1].map((s) => {
    const g = new THREE.Group();
    stick(g, HC, HR, s * 0.13, 0.27, 0.035);
    g.rotateZ(s * -0.06);
    g.add(new THREE.Mesh(rimGeo, rimMat));
    const open = new THREE.Group();
    const white = new THREE.Mesh(fillGeo, basic(C.white));
    white.position.z = 0.003;
    const pupil = new THREE.Mesh(pupilGeo, basic(C.pupil));
    pupil.position.set(-s * 0.03, 0, 0.006);
    const up = new THREE.Mesh(LIDS.open.up, lidMat), lo = new THREE.Mesh(LIDS.open.lo, lidMat);
    up.position.z = lo.position.z = 0.009;
    open.add(white, pupil, up, lo);
    open.userData = { pupil, up, lo };
    const closed = (rz, y) => {
      const c = new THREE.Group();
      const fill = new THREE.Mesh(fillGeo, lidMat);
      fill.position.z = 0.003;
      const a = new THREE.Mesh(arc, darkMat);
      a.rotation.z = rz; a.position.set(0, y, 0.012); a.scale.set(1, 0.75, 0.3);
      c.add(fill, a);
      return c;
    };
    const happy = closed(0, -0.025);         // ∩ = ^
    const sleep = closed(Math.PI, 0.02);     // ∪ = ‿
    g.add(open, happy, sleep);
    head.add(g);
    return { g, open, happy, sleep };
  });

  // ---- 腮红
  const blushMat = new THREE.MeshBasicMaterial({ color: 0xff8fa8, transparent: true, opacity: 0.55, depthWrite: false });
  const blush = [-1, 1].map((s) => {
    const b = new THREE.Mesh(new THREE.CircleGeometry(0.07, 16), blushMat);
    stick(b, HC, HR, s * 0.31, 0.02, 0.045);
    b.scale.set(1.3, 0.8, 1);
    head.add(b);
    return b;
  });

  // ---- 嘴：一条宽宽的嘴缝，几颗白毡布小尖牙往下戳
  const MY = -0.1;
  const mouth = new THREE.Group();
  const mc = new THREE.Vector3(0, MY, ellZ(HC, HR, 0, MY) + 0.03);
  mouth.position.copy(mc);
  head.add(mouth);
  const my = (x) => MY + 0.035 * (x / 0.3) ** 2 + 0.008 * Math.sin(x * 30);
  const mpts = Array.from({ length: 13 }, (_, i) => {
    const x = -0.3 + (0.6 * i) / 12, y = my(x);
    const p = new THREE.Vector3(x, y, ellZ(HC, HR, x, y));
    return p.addScaledVector(ellN(HC, HR, p), 0.03).sub(mc);
  });
  mouth.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(mpts), 24, 0.009, 5, false), basic(0x6f8a45)));
  const fangMat = toon(C.fang, { side: THREE.DoubleSide });
  for (const [x, w, h, k] of [[-0.22, 0.13, 0.09, -0.3], [-0.1, 0.09, 0.065, 0.1], [0.05, 0.08, 0.05, 0.2], [0.16, 0.12, 0.08, -0.15], [0.27, 0.08, 0.06, 0.3]]) {
    const f = new THREE.Mesh(bentShape([[-w / 2, 0.006], [w / 2, 0.006], [w * k * 0.4, -h]]), fangMat);
    const y = my(x);
    stick(f, HC, HR, x, y, 0.036);
    f.position.sub(mc);
    mouth.add(f);
  }
  const yawn = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), new THREE.MeshBasicMaterial({ color: 0x6b2f2f }));
  yawn.scale.set(1.3, 1, 0.3);
  yawn.position.set(0, -0.035, 0.0);
  yawn.visible = false;
  mouth.add(yawn);

  // ---- 睡帽、鼻涕泡、汗滴
  const cap = new THREE.Group();
  const capCone = outlined(new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.6, 14), toon(0x7c8cf0)), 0.025);
  capCone.position.y = 0.28;
  const pom = outlined(new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), toon(0xffffff)), 0.02);
  pom.position.set(0, 0.6, 0);
  const brim = outlined(new THREE.Mesh(new THREE.TorusGeometry(0.31, 0.055, 6, 18), toon(0xffffff)), 0.02);
  brim.rotation.x = Math.PI / 2;
  cap.add(capCone, pom, brim);
  cap.position.set(0.08, 0.46, -0.04);
  cap.rotation.z = -0.4;
  cap.visible = false;
  head.add(cap);

  const bubble = new THREE.Mesh(new THREE.SphereGeometry(0.09, 14, 10),
    new THREE.MeshToonMaterial({ color: 0xbfe6ff, transparent: true, opacity: 0.7 }));
  stick(bubble, HC, HR, 0.08, -0.04, 0.09);
  bubble.visible = false;
  head.add(bubble);

  const sweat = new THREE.Group();
  const drop = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), toon(0x9fd8ff));
  const dropTop = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.08, 10), toon(0x9fd8ff));
  dropTop.position.y = 0.05;
  sweat.add(drop, dropTop);
  sweat.position.set(0.42, 0.2, 0.22);
  sweat.visible = false;
  head.add(sweat);

  // open = 它天生的半睁困困眼；half 更困；wide = 眼皮往后缩（吓一跳）
  function setEyes(state) {
    const L = LIDS[state];
    for (const e of eyes) {
      e.open.visible = !!L;
      e.happy.visible = state === "happy";
      e.sleep.visible = state === "sleep";
      if (!L) continue;
      const { pupil, up, lo } = e.open.userData;
      up.geometry = L.up; lo.geometry = L.lo;
      pupil.position.y = L.py;
      pupil.scale.setScalar(L.pr);
    }
  }
  setEyes("open");

  root.traverse((o) => { o.userData.what = "pet"; });
  return { root, body, head, eyes, arms, ears: [], tail, feet, blush, blushMat, mouth, yawn, cap, bubble, sweat, setEyes, height: 1.5 };
}
