// 两个原创 Q 版角色（程序化 Three.js，没有外部模型）：
//   buildKitten —— 奶油色小猫（她的化身），接口和 pet3d.js 的 buildPet 完全一致
//   buildPony   —— 薄荷色小马（她的坐骑），带 saddle 挂点，小猫可以骑上去
// 都朝 +z，脚 / 蹄子在 y=0。
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const K = { // kitten palette
  fur: 0xfff3e4, belly: 0xfffcf6, peach: 0xffc9b5, inner: 0xffadc4, nose: 0xff8fae,
  bow: 0xff86b4, bowDark: 0xf0649a, collar: 0xff9cc6, bell: 0xffd257,
};
const P = { // pony palette
  body: 0xc3efdc, snout: 0xeafff5, maneA: 0xd5b8ff, maneB: 0xffb9dc, hoof: 0xb59ad8,
  inner: 0xffb7cf, pad: 0xffb3cf, trim: 0xffffff, star: 0xffe073,
};

/* ---------------------------------------------------------------- noise, textures, helpers */
const hash = (i, j, k) => { const s = Math.sin(i * 127.1 + j * 311.7 + k * 74.7) * 43758.5453; return s - Math.floor(s); };
const sm = (t) => t * t * (3 - 2 * t);
function vnoise(x, y, z) {
  const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z);
  const u = sm(x - i), v = sm(y - j), w = sm(z - k);
  const L = (a, b, t) => a + (b - a) * t;
  const c = (a, b, d) => hash(i + a, j + b, k + d);
  return 2 * L(L(L(c(0, 0, 0), c(1, 0, 0), u), L(c(0, 1, 0), c(1, 1, 0), u), v),
    L(L(c(0, 0, 1), c(1, 0, 1), u), L(c(0, 1, 1), c(1, 1, 1), u), v), w) - 1;
}
// 毛团：单位球沿法线用噪声推一推（鬃毛 / 尾巴用）
function fuzzSphere(ws, hs, amp = 0.08, seed = 0) {
  const g = new THREE.SphereGeometry(1, ws, hs);
  const p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const d = 0.65 * vnoise(v.x * 2.6 + seed, v.y * 2.6, v.z * 2.6) + 0.35 * vnoise(v.x * 7, v.y * 7 + seed, v.z * 7);
    v.multiplyScalar(1 + amp * d);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

let TEX = null;
function textures() {
  if (TEX) return TEX;
  const canvasTex = (w, h, draw, rx = 1, ry = 1, wrap = true) => {
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    draw(cv.getContext("2d"), w, h);
    const t = new THREE.CanvasTexture(cv);
    if (wrap) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); }
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  let seed = 11;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  // 短绒毛：很多短短的细线，亮暗交错但对比很低，配 bumpMap 有一点毛绒感
  const fur = (g, w, h) => {
    g.fillStyle = "#f7f7f7"; g.fillRect(0, 0, w, h);
    g.lineCap = "round";
    for (let n = 0; n < 2200; n++) {
      const x = rnd() * w, y = rnd() * h, a = Math.PI / 2 + (rnd() - 0.5) * 0.9, l = 3 + rnd() * 5;
      const c = 232 + rnd() * 23 | 0;
      g.strokeStyle = `rgb(${c},${c},${c})`;
      g.lineWidth = 1 + rnd() * 1.4;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
    }
  };
  // 闪亮大眼睛：深色外圈 + 上暗下亮的虹膜渐变 + 瞳孔 + 两个大高光 + 小星星
  const eye = (top, bottom, dark) => (g, w) => {
    const c = w / 2;
    const ell = (x, y, rx, ry, rot = 0) => { g.beginPath(); g.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2); g.fill(); };
    g.fillStyle = dark; ell(c, c, c - 2, c - 2);
    const gr = g.createLinearGradient(0, w * 0.18, 0, w * 0.95);
    gr.addColorStop(0, top); gr.addColorStop(1, bottom);
    g.fillStyle = gr; ell(c, c + w * 0.07, w * 0.37, w * 0.38);
    g.fillStyle = dark; ell(c, c + w * 0.02, w * 0.19, w * 0.22);
    g.fillStyle = "rgba(255,255,255,0.45)"; ell(c, w * 0.8, w * 0.2, w * 0.07);
    g.fillStyle = "#ffffff";
    ell(w * 0.67, w * 0.32, w * 0.15, w * 0.17, -0.5);
    ell(w * 0.33, w * 0.72, w * 0.07, w * 0.07);
    // 四角小星星
    const sx = w * 0.3, sy = w * 0.34, r = w * 0.085;
    g.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2, rr = i % 2 ? r * 0.28 : r;
      g.lineTo(sx + Math.cos(a) * rr, sy + Math.sin(a) * rr);
    }
    g.closePath(); g.fill();
  };
  TEX = {
    fur: canvasTex(256, 256, fur, 6, 3),
    furFine: canvasTex(256, 256, fur, 3, 1.5),
    kittenEye: canvasTex(128, 128, eye("#2c3f8f", "#8fd0ff", "#1f1d3d"), 1, 1, false),
    ponyEye: canvasTex(128, 128, eye("#4a2f7a", "#d6a8ff", "#251a3a"), 1, 1, false),
  };
  return TEX;
}

// 椭球表面上的点 / 法线
const ellZ = (c, r, x, y) => c.z + r.z * Math.sqrt(Math.max(0, 1 - ((x - c.x) / r.x) ** 2 - ((y - c.y) / r.y) ** 2));
const ellN = (c, r, p) => new THREE.Vector3((p.x - c.x) / r.x ** 2, (p.y - c.y) / r.y ** 2, (p.z - c.z) / r.z ** 2).normalize();
const ZAX = new THREE.Vector3(0, 0, 1);
// 贴到椭球正面 (x, y) 处，朝外
function stick(obj, c, r, x, y, lift = 0.01) {
  const p = new THREE.Vector3(x, y, ellZ(c, r, x, y));
  const n = ellN(c, r, p);
  obj.position.copy(p).addScaledVector(n, lift);
  obj.quaternion.setFromUnitVectors(ZAX, n);
  return obj;
}
// 贴到椭球上沿 dir 方向的那个点
function onEll(obj, c, r, dir, lift = 0.01) {
  const d = dir.clone().normalize();
  const t = 1 / Math.sqrt((d.x / r.x) ** 2 + (d.y / r.y) ** 2 + (d.z / r.z) ** 2);
  const p = c.clone().addScaledVector(d, t);
  const n = ellN(c, r, p);
  obj.position.copy(p).addScaledVector(n, lift);
  obj.quaternion.setFromUnitVectors(ZAX, n);
  return obj;
}
// 把一堆同材质的小零件烤成一个 Mesh（省 draw call，手机上更顺）。build(g) 往 g 里随便摆。
function bake(material, build) {
  const tmp = new THREE.Group();
  build(tmp);
  tmp.updateMatrixWorld(true);
  const geos = [];
  tmp.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry.clone().applyMatrix4(o.matrixWorld);
    for (const k of Object.keys(g.attributes)) if (!["position", "normal", "uv", "color"].includes(k)) g.deleteAttribute(k);
    geos.push(g);
  });
  return new THREE.Mesh(mergeGeometries(geos, false), material);
}
// 椭圆片，弯成球面的弧度（眼睛 / 腮红贴脸）
function bentDisc(rx, ry, R = 0.5, seg = 28) {
  const g = new THREE.CircleGeometry(1, seg);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) * rx, y = p.getY(i) * ry;
    p.setXYZ(i, x, y, -(x * x + y * y) / (2 * R));
  }
  return g;
}
// 按 y 给顶点上色（上 c1 → 下 c2），用来做耳尖 / 爪尖的渐变
function vgrad(geo, c1, c2, y1, y2, axis = "y") {
  const p = geo.attributes.position, a = new THREE.Color(c1), b = new THREE.Color(c2), c = new THREE.Color();
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const v = axis === "y" ? p.getY(i) : axis === "z" ? p.getZ(i) : p.getX(i);
    const t = Math.min(1, Math.max(0, (v - y1) / (y2 - y1)));
    c.copy(a).lerp(b, sm(t));
    col.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return geo;
}
// 粗细渐变的管子（尾巴）：f(u) 给出 u∈[0,1] 处的半径倍数；可选按 u 上色
function taperTube(curve, seg, radius, rseg, f, colors) {
  const g = new THREE.TubeGeometry(curve, seg, radius, rseg, false);
  const p = g.attributes.position, v = new THREE.Vector3(), c = new THREE.Vector3();
  const col = colors ? new Float32Array(p.count * 3) : null;
  const tmpC = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const ring = Math.floor(i / (rseg + 1)), u = ring / seg;
    curve.getPointAt(u, c);
    v.fromBufferAttribute(p, i).sub(c).multiplyScalar(f(u)).add(c);
    p.setXYZ(i, v.x, v.y, v.z);
    if (col) { colors(u, tmpC); col.set([tmpC.r, tmpC.g, tmpC.b], i * 3); }
  }
  if (col) g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

// 睁眼 / 开心 / 睡着 / 半睁 / 瞪大 —— 两个角色共用的眼睛
function makeEyes(head, c, r, { x, y, rx, ry, tex, lash = true, line = 0x2a1f33 }) {
  const dark = new THREE.MeshBasicMaterial({ color: line });
  const eyeMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide });
  const disc = bentDisc(rx, ry, r.x);
  const lid = new THREE.TorusGeometry(1, 0.13, 5, 18, Math.PI * 0.86);
  const arc = new THREE.TorusGeometry(rx * 0.8, rx * 0.17, 6, 16, Math.PI);
  const lashGeo = new THREE.ConeGeometry(rx * 0.16, rx * 0.5, 5);
  return [-1, 1].map((s) => {
    const g = new THREE.Group();
    stick(g, c, r, s * x, y, 0.006);
    const open = new THREE.Group();
    const ball = new THREE.Mesh(disc, eyeMat);
    open.add(ball);
    // 上眼线（略粗）+ 眼角两根小睫毛，烤成一个 mesh
    open.add(bake(dark, (b) => {
      const l = new THREE.Mesh(lid, dark);
      l.scale.set(rx * 1.02, ry * 1.02, rx * 0.5);
      l.rotation.z = Math.PI * 0.07;
      l.position.z = 0.004;
      b.add(l);
      if (lash) for (const [a, k] of [[0.42, 1], [0.2, 0.8]]) {
        const m = new THREE.Mesh(lashGeo, dark);
        m.scale.setScalar(k);
        const ang = a * Math.PI;
        m.position.set(s * Math.cos(ang) * rx * 1.08, Math.sin(ang) * ry * 1.05, 0.004);
        m.rotation.z = -s * (Math.PI / 2 - ang) - s * 0.5;
        b.add(m);
      }
    }));
    const happy = new THREE.Mesh(arc, dark);          // ∩ = ^
    happy.position.y = -ry * 0.25;
    happy.scale.set(1, 0.9, 0.4);
    const sleep = new THREE.Mesh(arc, dark);          // ∪ = ‿
    sleep.rotation.z = Math.PI;
    sleep.position.y = ry * 0.2;
    sleep.scale.set(1, 0.7, 0.4);
    g.add(open, happy, sleep);
    head.add(g);
    return { g, open, happy, sleep };
  });
}
function eyeSetter(eyes) {
  return (state) => {
    for (const e of eyes) {
      e.open.visible = state === "open" || state === "half" || state === "wide";
      e.happy.visible = state === "happy";
      e.sleep.visible = state === "sleep";
      const k = state === "wide" ? 1.18 : 1;
      e.open.scale.set(k, state === "half" ? 0.5 : k, 1);
      e.open.position.y = state === "half" ? -0.02 : 0;
    }
  };
}

/* ================================================================ KITTEN */
export function buildKitten({ toon, outlined }) {
  const T = textures();
  const fur = (color, map = T.fur, extra = {}) => toon(color, { map, bumpMap: map, bumpScale: 0.25, ...extra });
  const vfur = (map = T.furFine) => fur(0xffffff, map, { vertexColors: true });
  const mk = (geo, mat, line = 0.022) => outlined(new THREE.Mesh(geo, mat), line);

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  // ---- 身体：矮矮的小团子 + 白肚皮
  const BC = new THREE.Vector3(0, 0.4, 0), BR = new THREE.Vector3(0.44, 0.4, 0.4);
  const torso = mk(new THREE.SphereGeometry(1, 26, 18), fur(K.fur), 0.026);
  torso.scale.copy(BR); torso.position.copy(BC);
  body.add(torso);
  const belly = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 12), fur(K.belly, T.furFine));
  belly.scale.set(0.24, 0.21, 0.07);
  stick(belly, BC, BR, 0, 0.36, -0.035);
  body.add(belly);

  // ---- 脚：每只是一个 Group（里面一个小脚丫 + 骑马时才显示的小腿）
  const footGeo = vgrad(new THREE.SphereGeometry(1, 14, 10), K.fur, K.peach, 0.2, -1, "z");
  footGeo.scale(-1, 1, -1); // 让前端偏桃色
  const legGeo = new THREE.CapsuleGeometry(0.085, 0.14, 3, 10);
  const beanMat = toon(K.inner);
  const feet = [-1, 1].map((s) => {
    const g = new THREE.Group();
    g.position.set(s * 0.2, 0.06, 0.17);
    const f = mk(footGeo, vfur(), 0.018);
    f.scale.set(0.13, 0.075, 0.16);
    g.add(f);
    const leg = mk(legGeo, fur(K.fur, T.furFine), 0.018);
    leg.position.set(0, 0.13, -0.06);
    leg.rotation.x = 0.35;
    leg.visible = false;
    g.add(leg);
    g.userData = { leg, rest: g.position.clone() };
    body.add(g);
    return g;
  });

  // ---- 手：圆圆的小爪，掌心有粉色肉垫（挥手 / 拍拍时能看到）
  const pawGeo = vgrad(new THREE.SphereGeometry(1, 14, 10), K.fur, K.peach, 0.3, -0.9);
  const arms = [-1, 1].map((s) => {
    const pivot = new THREE.Group();
    pivot.position.set(s * 0.37, 0.56, 0.12);
    const a = mk(pawGeo, vfur(), 0.02);
    a.scale.set(0.105, 0.14, 0.105);
    a.position.set(s * 0.025, -0.11, 0);
    pivot.add(a);
    pivot.add(bake(beanMat, (g) => {
      const pad = new THREE.Mesh(new THREE.SphereGeometry(0.032, 10, 6), beanMat);
      pad.scale.set(1, 0.85, 0.4);
      pad.position.set(s * 0.025, -0.15, 0.1);
      g.add(pad);
      for (const dx of [-0.032, 0, 0.032]) {
        const b = new THREE.Mesh(new THREE.SphereGeometry(0.013, 6, 4), beanMat);
        b.position.set(s * 0.025 + dx, -0.105 + Math.abs(dx) * 0.4, 0.095);
        g.add(b);
      }
    }));
    pivot.rotation.z = s * 0.3;
    body.add(pivot);
    return pivot;
  });
  const paw = arms[1];

  // ---- 项圈 + 小铃铛（bell.rotation.z 摇一摇就是叮铃）
  const collar = mk(new THREE.TorusGeometry(0.35, 0.04, 8, 30), toon(K.collar), 0.016);
  collar.rotation.x = Math.PI / 2 + 0.12;
  collar.scale.set(1.04, 1, 1);
  collar.position.set(0, 0.68, 0.02);
  body.add(collar);
  const bell = new THREE.Group();
  bell.position.set(0, 0.665, 0.39);
  const bellMat = toon(K.bell, { emissive: 0x3a2a00 });
  const ball = mk(new THREE.SphereGeometry(0.062, 14, 10), bellMat, 0.014);
  ball.position.y = -0.065;
  const loop = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.009, 5, 10), bellMat);
  loop.position.y = -0.002;
  const slit = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.01, 0.02), new THREE.MeshBasicMaterial({ color: 0x6b4a10 }));
  slit.position.set(0, -0.085, 0.05);
  slit.rotation.x = -0.6;
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 4), slit.material);
  dot.position.set(0, -0.1, 0.045);
  bell.add(ball, loop, slit, dot);
  body.add(bell);

  // ---- 尾巴：长长的 S 形，越往尖越细一点，尖端桃色
  const tail = new THREE.Group();
  tail.position.set(0, 0.24, -0.34);
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.1, 0.02, -0.18), new THREE.Vector3(0.26, 0.16, -0.26),
    new THREE.Vector3(0.3, 0.42, -0.22), new THREE.Vector3(0.16, 0.62, -0.2), new THREE.Vector3(0.12, 0.82, -0.28),
    new THREE.Vector3(0.24, 0.94, -0.3)]);
  const ca = new THREE.Color(K.fur), cb = new THREE.Color(K.peach);
  const tailGeo = taperTube(curve, 40, 0.06, 8, (u) => 1 - 0.25 * u,
    (u, out) => out.copy(ca).lerp(cb, sm(Math.min(1, Math.max(0, (u - 0.72) / 0.22)))));
  tail.add(mk(tailGeo, vfur(), 0.02));
  const tip = mk(new THREE.SphereGeometry(0.046, 10, 8), fur(K.peach, T.furFine), 0.018);
  tip.position.copy(curve.getPointAt(1));
  tail.add(tip);
  body.add(tail);

  // ---- 头
  const head = new THREE.Group();
  head.position.y = 0.98;
  body.add(head);
  const HC = new THREE.Vector3(0, 0, 0), HR = new THREE.Vector3(0.56, 0.48, 0.5);
  const skull = mk(new THREE.SphereGeometry(1, 30, 22), fur(K.fur), 0.03);
  skull.scale.copy(HR);
  head.add(skull);
  // 两腮的蓬毛
  const tuftGeo = new THREE.ConeGeometry(0.075, 0.24, 8);
  for (const s of [-1, 1]) {
    for (const [y, rz, k] of [[-0.1, 0.35, 1], [-0.22, 0.9, 0.85]]) {
      const t = mk(tuftGeo, fur(K.fur, T.furFine), 0.02);
      t.position.set(s * 0.52, y, 0.1);
      t.rotation.set(0, 0, -s * (Math.PI / 2 + rz - 0.3));
      t.scale.set(k, k, k * 0.7);
      head.add(t);
    }
  }
  // 头顶一小撮呆毛
  for (const [x, rz, h] of [[-0.05, 0.35, 0.12], [0.04, -0.2, 0.15]]) {
    const t = mk(new THREE.ConeGeometry(0.045, h, 7), fur(K.fur, T.furFine), 0.016);
    t.position.set(x, 0.47, 0.06);
    t.rotation.set(0.25, 0, rz);
    head.add(t);
  }

  // ---- 耳朵：圆锥压扁一点，耳尖桃粉渐变，里面是粉色
  const earGeo = vgrad(new THREE.ConeGeometry(0.18, 0.34, 12), K.fur, K.peach, -0.05, 0.17);
  const innerGeo = vgrad(new THREE.ConeGeometry(0.11, 0.22, 10), 0xffd0de, K.inner, -0.1, 0.1);
  const ears = [-1, 1].map((s) => {
    const pivot = new THREE.Group();
    pivot.position.set(s * 0.3, 0.33, 0.0);
    pivot.rotation.z = -s * 0.3;
    const e = mk(earGeo, vfur(T.furFine), 0.024);
    e.scale.set(1, 1, 0.62);
    e.position.y = 0.13;
    const inner = new THREE.Mesh(innerGeo, toon(0xffffff, { vertexColors: true }));
    inner.scale.set(1, 1, 0.4);
    inner.position.set(0, 0.1, 0.06);
    pivot.add(e, inner);
    head.add(pivot);
    return pivot;
  });

  // ---- 蝴蝶结：别在左耳根（-x 那只，镜头里在左边）
  const bow = new THREE.Group();
  const bowMat = toon(K.bow), bowDark = toon(K.bowDark);
  const lobeGeo = new THREE.SphereGeometry(1, 14, 10);
  bow.add(outlined(bake(bowMat, (g) => {
    for (const s of [-1, 1]) {
      const lobe = new THREE.Mesh(lobeGeo);
      lobe.scale.set(0.1, 0.07, 0.045);
      lobe.position.set(s * 0.085, 0.012, 0);
      lobe.rotation.z = s * 0.28;
      const ribbon = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6));
      ribbon.scale.set(0.022, 0.055, 0.012);
      ribbon.position.set(s * 0.035, -0.06, -0.005);
      ribbon.rotation.z = s * 0.35;
      g.add(lobe, ribbon);
    }
  }), 0.014));
  bow.add(outlined(bake(bowDark, (g) => {
    for (const s of [-1, 1]) {
      const fold = new THREE.Mesh(lobeGeo);
      fold.scale.set(0.04, 0.03, 0.02);
      fold.position.set(s * 0.05, 0.004, 0.035);
      g.add(fold);
    }
    const knot = new THREE.Mesh(new THREE.SphereGeometry(0.038, 10, 8));
    knot.scale.set(1, 1, 0.8);
    g.add(knot);
  }), 0.012));
  // 白色小圆点
  bow.add(bake(toon(0xffffff), (g) => {
    for (const [x, y] of [[-0.11, 0.03], [-0.07, -0.02], [0.08, 0.035], [0.12, -0.01]]) {
      const d = new THREE.Mesh(new THREE.CircleGeometry(0.011, 8));
      d.position.set(x, y, 0.046);
      g.add(d);
    }
  }));
  bow.position.set(0.02, 0.05, 0.075);
  bow.rotation.set(-0.15, 0.1, 0.35);
  ears[0].add(bow);

  // ---- 眼睛：亮晶晶的大眼睛（蓝色虹膜 + 高光 + 小星星 + 睫毛）
  const eyes = makeEyes(head, HC, HR, { x: 0.205, y: -0.035, rx: 0.105, ry: 0.125, tex: T.kittenEye });

  // ---- 腮红
  const blushMat = new THREE.MeshBasicMaterial({ color: 0xff8fb0, transparent: true, opacity: 0.55, depthWrite: false });
  const blushGeo = bentDisc(0.085, 0.052, 0.5, 18);
  const blush = [-1, 1].map((s) => {
    const b = new THREE.Mesh(blushGeo, blushMat);
    stick(b, HC, HR, s * 0.34, -0.15, 0.008);
    head.add(b);
    return b;
  });

  // ---- 胡须：两边各两根细细的
  const whiskerMat = new THREE.MeshBasicMaterial({ color: 0xc9a79a });
  const whiskerGeo = new THREE.CylinderGeometry(0.0055, 0.0035, 0.17, 4);
  whiskerGeo.translate(0, 0.085, 0);
  head.add(bake(whiskerMat, (g) => {
    for (const s of [-1, 1]) {
      for (const [y, a] of [[-0.1, 0.14], [-0.15, -0.08]]) {
        const anchor = stick(new THREE.Group(), HC, HR, s * 0.43, y, -0.01);
        const w = new THREE.Mesh(whiskerGeo);
        w.rotation.set(0, -s * 0.3, -s * (Math.PI / 2 - a));
        anchor.add(w);
        g.add(anchor);
      }
    }
  }));

  // ---- 嘴：粉鼻头 + ω
  const mouth = new THREE.Group();
  stick(mouth, HC, HR, 0, -0.15, 0.006);
  head.add(mouth);
  const dark = new THREE.MeshBasicMaterial({ color: 0x5a3640 });
  const nose = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 6), toon(K.nose));
  nose.scale.set(0.034, 0.022, 0.02);
  nose.position.set(0, 0.04, 0.005);
  const w = new THREE.TorusGeometry(0.032, 0.0095, 5, 10, Math.PI);
  const ml = new THREE.Mesh(w, dark), mr = new THREE.Mesh(w, dark);
  ml.rotation.z = mr.rotation.z = Math.PI;
  ml.position.set(-0.032, 0.012, 0); mr.position.set(0.032, 0.012, 0);
  mouth.add(nose, ml, mr);
  const yawnGeo = new THREE.SphereGeometry(0.05, 10, 8);
  yawnGeo.scale(1, 1.15, 0.35);
  const yawn = new THREE.Mesh(yawnGeo, new THREE.MeshBasicMaterial({ color: 0x9a3e52 }));
  yawn.position.set(0, -0.025, 0.004);
  yawn.visible = false;
  mouth.add(yawn);

  // ---- 睡帽、鼻涕泡、汗滴（scene3d.js 会开关它们）
  const cap = new THREE.Group();
  const capCone = mk(new THREE.ConeGeometry(0.28, 0.56, 14), toon(0xb9a6ff), 0.025);
  capCone.position.y = 0.26;
  const pom = mk(new THREE.SphereGeometry(0.08, 10, 8), toon(0xffffff), 0.02);
  pom.position.set(0, 0.56, 0);
  const brim = mk(new THREE.TorusGeometry(0.27, 0.05, 6, 18), toon(0xffffff), 0.02);
  brim.rotation.x = Math.PI / 2;
  cap.add(capCone, pom, brim);
  cap.position.set(0.06, 0.36, -0.06);
  cap.rotation.z = -0.4;
  cap.visible = false;
  head.add(cap);

  const bubble = new THREE.Mesh(new THREE.SphereGeometry(0.09, 14, 10),
    new THREE.MeshToonMaterial({ color: 0xbfe6ff, transparent: true, opacity: 0.7 }));
  stick(bubble, HC, HR, 0.1, -0.12, 0.09);
  bubble.visible = false;
  head.add(bubble);

  const sweat = new THREE.Group();
  const drop = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), toon(0x9fd8ff));
  const dropTop = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.08, 10), toon(0x9fd8ff));
  dropTop.position.y = 0.05;
  sweat.add(drop, dropTop);
  sweat.position.set(0.44, 0.2, 0.22);
  sweat.visible = false;
  head.add(sweat);

  const setEyes = eyeSetter(eyes);
  setEyes("open");

  root.traverse((o) => { o.userData.what = "pet"; });
  return { root, body, head, eyes, arms, ears, tail, feet, blush, blushMat, mouth, yawn, cap, bubble, sweat, setEyes, height: 1.5, bow, bell, paw };
}

// 骑马坐姿：小腿露出来垂在小马两侧，小手往前搭在鬃毛上。on=false 恢复站姿。
export function setRiding(k, on) {
  k.feet.forEach((g, i) => {
    const s = i ? 1 : -1;
    const { leg, rest } = g.userData;
    leg.visible = on;
    if (on) {
      g.position.set(s * 0.47, -0.05, 0.13);
      g.rotation.set(0.5, 0, s * 0.55);
      leg.position.set(-s * 0.02, 0.12, -0.07);
      leg.rotation.set(0.3, 0, 0.1 * s);
    } else {
      g.position.copy(rest);
      g.rotation.set(0, 0, 0);
    }
  });
  k.arms.forEach((a) => { a.rotation.x = on ? -0.6 : 0; });
  k.tail.rotation.x = on ? -0.35 : 0;
}

/* ================================================================ PONY */
export const SADDLE_SCALE = 0.75;
export function buildPony({ toon, outlined }) {
  const T = textures();
  const fur = (color, map = T.fur) => toon(color, { map, bumpMap: map, bumpScale: 0.22 });
  const mk = (geo, mat, line = 0.022) => outlined(new THREE.Mesh(geo, mat), line);
  const maneMats = [fur(P.maneA, T.furFine), fur(P.maneB, T.furFine)];
  // 一簇毛团：按颜色交替，同色的烤成一个 mesh 再描边
  const puffs = (parent, list, seed) => [0, 1].map((c) => {
    const m = outlined(bake(maneMats[c], (g) => list.forEach(([x, y, z, r], i) => {
      if (i % 2 !== c) return;
      const p = new THREE.Mesh(fuzzSphere(14, 10, 0.12, seed + i));
      p.scale.setScalar(r);
      p.position.set(x, y, z);
      g.add(p);
    })), 0.018);
    parent.add(m);
    return m;
  });

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  // ---- 圆滚滚的身子
  const BC = new THREE.Vector3(0, 0.68, -0.02), BR = new THREE.Vector3(0.42, 0.38, 0.56);
  const barrel = mk(new THREE.SphereGeometry(1, 28, 20), fur(P.body), 0.026);
  barrel.scale.copy(BR); barrel.position.copy(BC);
  body.add(barrel);
  // 白白的胸口
  const chest = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), fur(P.snout, T.furFine));
  chest.scale.set(0.18, 0.16, 0.07);
  onEll(chest, BC, BR, new THREE.Vector3(0, -0.1, 1), -0.04);
  body.add(chest);

  // ---- 马鞍垫：粉色小毯子，白色滚边 + 小绒球
  const SADDLE_Z = -0.12;
  const pad = new THREE.Group();
  const capT = 0.62;
  const padGeo = new THREE.SphereGeometry(1, 24, 6, 0, Math.PI * 2, 0, capT);
  const padMesh = mk(padGeo, fur(P.pad, T.furFine), 0.014);
  padMesh.scale.set(BR.x * 1.04, BR.y * 1.06, BR.z * 0.62);
  pad.add(padMesh);
  const edge = [];
  for (let i = 0; i <= 48; i++) {
    const ph = (i / 48) * Math.PI * 2;
    edge.push(new THREE.Vector3(Math.sin(capT) * Math.cos(ph) * BR.x * 1.05, Math.cos(capT) * BR.y * 1.07, Math.sin(capT) * Math.sin(ph) * BR.z * 0.63));
  }
  const trimMat = toon(P.trim);
  pad.add(outlined(bake(trimMat, (g) => {
    g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(edge, true), 48, 0.022, 6, true)));
    for (const ph of [0, Math.PI]) {
      for (const k of [-0.35, 0, 0.35]) {
        const a = ph + k * (ph ? -1 : 1);
        const pom = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6));
        pom.position.set(Math.sin(capT) * Math.cos(a) * BR.x * 1.06, Math.cos(capT) * BR.y * 1.07 - 0.04, Math.sin(capT) * Math.sin(a) * BR.z * 0.63);
        g.add(pom);
      }
    }
  }), 0.012));
  pad.position.set(0, BC.y, SADDLE_Z);
  body.add(pad);

  // 鞍座挂点：小猫的 root 挂这里
  const saddle = new THREE.Group();
  saddle.position.set(0, BC.y + BR.y * 0.97 - 0.05, SADDLE_Z);
  saddle.scale.setScalar(SADDLE_SCALE); // 小猫原尺寸 1.5 高，骑上来缩一点才和小马比例协调
  body.add(saddle);

  // ---- 屁股上的小星星
  const star = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + (i / 10) * Math.PI * 2, r = i % 2 ? 0.035 : 0.075;
    if (i === 0) star.moveTo(Math.cos(a) * r, Math.sin(a) * r); else star.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const starGeo = new THREE.ShapeGeometry(star);
  const starMat = toon(P.star, { side: THREE.DoubleSide });
  body.add(bake(starMat, (g) => {
    for (const s of [-1, 1]) {
      const m = new THREE.Mesh(starGeo);
      onEll(m, BC, BR, new THREE.Vector3(s, 0.05, -0.75), 0.005);
      m.rotateZ(s * 0.3);
      g.add(m);
    }
  }));

  // ---- 四条小短腿（pivot 在肩 / 胯，绕 x 转）+ 紫色小蹄子
  const legGeo = new THREE.CapsuleGeometry(0.118, 0.16, 4, 12);
  const hoofGeo = new THREE.CylinderGeometry(0.115, 0.132, 0.1, 14);
  const legMat = fur(P.body, T.furFine), hoofMat = toon(P.hoof);
  const legs = [[1, 1], [-1, 1], [1, -1], [-1, -1]].map(([sz, sx]) => { // fl, fr, bl, br
    const pivot = new THREE.Group();
    // 小马自己的左边是 +x（朝 +z 时）
    pivot.position.set(sx * 0.2, 0.42, BC.z + sz * 0.3);
    const leg = mk(legGeo, legMat, 0.02);
    leg.position.y = -0.19;
    const hoof = mk(hoofGeo, hoofMat, 0.018);
    hoof.position.y = -0.37;
    pivot.add(leg, hoof);
    root.add(pivot);
    return pivot;
  });

  // ---- 尾巴：一串毛团，往后往下卷
  const tail = new THREE.Group();
  tail.position.set(0, BC.y + 0.12, BC.z - BR.z + 0.04);
  puffs(tail, [[0, 0.02, -0.05, 0.11], [0, -0.06, -0.17, 0.12], [0.02, -0.19, -0.23, 0.12], [-0.01, -0.32, -0.2, 0.105], [0.02, -0.42, -0.12, 0.085]], 20);
  body.add(tail);

  // ---- 脖子 + 头
  const neck = new THREE.Group();
  neck.position.set(0, 0.9, BC.z + 0.38);
  neck.rotation.x = 0.32;
  neck.userData.base = 0.32;
  body.add(neck);
  const neckMesh = mk(new THREE.CapsuleGeometry(0.17, 0.2, 4, 12), fur(P.body), 0.022);
  neckMesh.position.set(0, 0.16, 0);
  neck.add(neckMesh);

  const head = new THREE.Group();
  head.position.set(0, 0.42, 0.1);
  neck.add(head);
  const HC = new THREE.Vector3(0, 0, 0), HR = new THREE.Vector3(0.34, 0.32, 0.33);
  const skull = mk(new THREE.SphereGeometry(1, 28, 20), fur(P.body), 0.026);
  skull.scale.copy(HR);
  head.add(skull);
  // 抵消脖子前倾，让脸正对前方
  head.rotation.x = -0.32;
  // 鼻吻：浅色的椭球
  const SC = new THREE.Vector3(0, -0.12, 0.19), SR = new THREE.Vector3(0.21, 0.15, 0.2);
  const snout = mk(new THREE.SphereGeometry(1, 22, 14), fur(P.snout, T.furFine), 0.02);
  snout.scale.copy(SR); snout.position.copy(SC);
  head.add(snout);
  const nostrilMat = new THREE.MeshBasicMaterial({ color: 0x8a7a9a });
  head.add(bake(nostrilMat, (g) => {
    for (const s of [-1, 1]) {
      const n = new THREE.Mesh(bentDisc(0.018, 0.012, 0.2, 10));
      stick(n, SC, SR, s * 0.07, -0.08, 0.004);
      n.rotateZ(s * 0.4);
      g.add(n);
    }
  }));
  const mouthMat = new THREE.MeshBasicMaterial({ color: 0x5a4060 });
  const smile = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.008, 5, 12, Math.PI), mouthMat);
  stick(smile, SC, SR, 0, -0.18, 0.004);
  smile.rotateZ(Math.PI);
  head.add(smile);

  // 眼睛：温柔的紫色大眼睛 + 长睫毛
  const eyes = makeEyes(head, HC, HR, { x: 0.15, y: 0.04, rx: 0.075, ry: 0.09, tex: T.ponyEye });
  const blushMat = new THREE.MeshBasicMaterial({ color: 0xff9ab8, transparent: true, opacity: 0.5, depthWrite: false });
  const blush = [-1, 1].map((s) => {
    const b = new THREE.Mesh(bentDisc(0.055, 0.032, 0.35, 16), blushMat);
    stick(b, HC, HR, s * 0.25, -0.07, 0.008);
    head.add(b);
    return b;
  });

  // 耳朵
  const earGeo = new THREE.ConeGeometry(0.085, 0.2, 10);
  const ears = [-1, 1].map((s) => {
    const pivot = new THREE.Group();
    pivot.position.set(s * 0.19, 0.24, -0.03);
    pivot.rotation.set(0, 0, -s * 0.4);
    const e = mk(earGeo, fur(P.body, T.furFine), 0.018);
    e.scale.set(1, 1, 0.65);
    e.position.y = 0.08;
    const inner = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.13, 8), toon(P.inner));
    inner.scale.set(1, 1, 0.4);
    inner.position.set(0, 0.065, 0.035);
    pivot.add(e, inner);
    head.add(pivot);
    return pivot;
  });

  // 鬃毛：头顶刘海 + 后脑勺 + 沿着脖子后面
  const mane = new THREE.Group();
  head.add(mane);
  puffs(mane, [[0.0, 0.3, 0.06, 0.11], [0.1, 0.25, 0.16, 0.09], [-0.08, 0.27, 0.15, 0.075], [0.15, 0.17, 0.22, 0.065],
    [0, 0.27, -0.12, 0.12], [0, 0.14, -0.26, 0.12]], 40);
  const neckMane = new THREE.Group();
  neck.add(neckMane);
  puffs(neckMane, [[0, 0.22, -0.2, 0.11], [0, 0.08, -0.19, 0.1], [0, -0.04, -0.15, 0.085]], 60);
  mane.userData.neck = neckMane;

  const setEyes = eyeSetter(eyes);
  setEyes("open");

  root.traverse((o) => { o.userData.what = "pony"; });
  return { root, body, head, neck, legs, mane, tail, eyes, ears, blush, blushMat, setEyes, saddle, pad, height: 1.1 };
}

// 走路：对角小跑（fl+br 一组，fr+bl 一组）。phase 弧度一直往上加即可，amount 0..1（可以渐入渐出）。
// 只动 legs.rotation.x、body.position.y / rotation.z、neck.rotation.x、tail.rotation.x，和 ponyIdle 不打架。
export function ponyWalk(p, phase, amount = 1) {
  const a = Math.max(0, Math.min(1, amount));
  const sw = Math.sin(phase) * 0.55 * a;
  p.legs[0].rotation.x = sw; p.legs[3].rotation.x = sw;
  p.legs[1].rotation.x = -sw; p.legs[2].rotation.x = -sw;
  p.body.position.y = Math.abs(Math.sin(phase)) * 0.045 * a;
  p.body.rotation.z = Math.sin(phase) * 0.03 * a;
  p.neck.rotation.x = p.neck.userData.base + Math.sin(phase * 2 + 0.6) * 0.07 * a;
  p.tail.rotation.x = Math.sin(phase * 2) * 0.15 * a;
}

// 待机：呼吸、隔一会儿甩一下尾巴、耳朵抖一抖、头轻轻歪。t 是秒。
// 只动 body.scale、tail.rotation.y、ears.rotation、head.rotation.z/y。
export function ponyIdle(p, t) {
  const b = Math.sin(t * 1.9) * 0.5 + 0.5;
  p.body.scale.set(1 + b * 0.012, 1 + b * 0.018, 1 + b * 0.008);
  // 每 ~5 秒甩一次尾巴
  const sp = (t % 5.3) / 5.3, env = sp < 0.18 ? Math.sin((sp / 0.18) * Math.PI) : 0;
  p.tail.rotation.y = Math.sin(t * 11) * 0.45 * env;
  // 耳朵：左右交替偶尔抖一下
  p.ears.forEach((e, i) => {
    const q = ((t + i * 2.1) % 4.1) / 4.1, k = q < 0.06 ? Math.sin((q / 0.06) * Math.PI) : 0;
    e.rotation.x = -0.5 * k;
    e.rotation.z = (i ? 1 : -1) * -0.4 + (i ? -1 : 1) * 0.25 * k;
  });
  p.head.rotation.z = Math.sin(t * 0.7) * 0.05;
  p.head.rotation.y = Math.sin(t * 0.45) * 0.08;
}
