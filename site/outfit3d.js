// 小猫的换装（程序化 Three.js，没有外部模型）。
//   attachOutfit(kitten, id, { toon, outlined }) → { root, remove() }
//   dressKitten(kitten, ids, ctx)                → 一次换一整套（每个部位最多一件）
// head / face 挂在 kitten.head 上（坐标系 = her3d.js 的头：椭球中心在原点，半径 0.56 × 0.48 × 0.5，朝 +z），
// neck 挂在 kitten.body 上（脖子那圈在 y≈0.62）。跟着头 / 身体走，所以站着、骑马、睡觉低头都不用额外处理。
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

export const OUTFITS = {
  santa_hat: { name: "圣诞帽", emoji: "🎅", slot: "head" },
  beanie: { name: "毛线帽", emoji: "🧶", slot: "head" },
  flower_crown: { name: "花环", emoji: "🌸", slot: "head" },
  beret: { name: "贝雷帽", emoji: "🎨", slot: "head" },
  witch_hat: { name: "小巫师帽", emoji: "🧙", slot: "head" },
  crown: { name: "小王冠", emoji: "👑", slot: "head" },
  bunny_ears: { name: "兔耳发箍", emoji: "🐰", slot: "head" },
  round_glasses: { name: "圆眼镜", emoji: "👓", slot: "face" },
  heart_sunglasses: { name: "爱心墨镜", emoji: "😎", slot: "face" },
  red_scarf: { name: "红围巾", emoji: "🧣", slot: "neck" },
  knit_scarf: { name: "条纹毛线围巾", emoji: "🧶", slot: "neck" },
  bow_tie: { name: "领结", emoji: "🎀", slot: "neck" },
};

const V3 = THREE.Vector3;
const HR = new V3(0.56, 0.48, 0.5); // 和 her3d.js 的头一致
const ZAX = new V3(0, 0, 1);

/* ---------------------------------------------------------------- helpers */
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
// 沿法线推一推：毛茸茸的球 / 帽檐
function fuzz(geo, amp, freq = 7, seed = 0) {
  geo = mergeNormals(geo);
  const p = geo.attributes.position, n = geo.attributes.normal, v = new V3(), nn = new V3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i); nn.fromBufferAttribute(n, i);
    const d = 0.6 * vnoise(v.x * freq + seed, v.y * freq, v.z * freq) + 0.4 * vnoise(v.x * freq * 2.3, v.y * freq * 2.3 + seed, v.z * freq * 2.3);
    v.addScaledVector(nn, amp * d);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}
// 接缝处顶点重合但法线不同会让 fuzz 裂开：先用平均法线
function mergeNormals(geo) {
  const p = geo.attributes.position, n = geo.attributes.normal;
  const map = new Map(), v = new V3();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(4)},${p.getY(i).toFixed(4)},${p.getZ(i).toFixed(4)}`;
    let e = map.get(key); if (!e) map.set(key, e = { n: new V3(), idx: [] });
    e.n.add(v.fromBufferAttribute(n, i)); e.idx.push(i);
  }
  for (const e of map.values()) { e.n.normalize(); for (const i of e.idx) n.setXYZ(i, e.n.x, e.n.y, e.n.z); }
  return geo;
}
// 把一堆零件烤成一个 Mesh。零件的 userData.color 会变成顶点色（这时材质要 vertexColors: true）。
function bake(material, build) {
  const tmp = new THREE.Group();
  build(tmp);
  tmp.updateMatrixWorld(true);
  let geos = [];
  const colored = [];
  tmp.traverse((o) => { if (o.isMesh) colored.push(o.userData.color != null); });
  const anyColor = colored.some(Boolean);
  tmp.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry.clone().applyMatrix4(o.matrixWorld);
    for (const k of Object.keys(g.attributes)) if (!["position", "normal", "uv"].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (anyColor) {
      const c = new THREE.Color(o.userData.color ?? 0xffffff), n = g.attributes.position.count;
      const a = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
      g.setAttribute("color", new THREE.BufferAttribute(a, 3));
    }
    geos.push(g);
  });
  if (geos.some((g) => !g.index)) geos = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  return new THREE.Mesh(mergeGeometries(geos, false), material);
}
const part = (geo, color) => { const m = new THREE.Mesh(geo); if (color != null) m.userData.color = color; return m; };
// 粗细可变的管子：沿 points 的平滑曲线，r(u) 给出半径；flatZ 把截面在 z 方向压扁（平面曲线做成丝带 / 兔耳）
function sweep(points, seg, rseg, r, { closed = false, flatZ = 1 } = {}) {
  const curve = new THREE.CatmullRomCurve3(points, closed, "catmullrom", 0.5);
  const g = new THREE.TubeGeometry(curve, seg, 1, rseg, closed);
  const p = g.attributes.position, c = new V3(), v = new V3();
  for (let i = 0; i <= seg; i++) {
    const u = i / seg;
    curve.getPointAt(closed && i === seg ? 0 : u, c);
    const k = r(u);
    for (let j = 0; j <= rseg; j++) {
      const idx = i * (rseg + 1) + j;
      v.fromBufferAttribute(p, idx).sub(c).multiplyScalar(k);
      v.z *= flatZ;
      p.setXYZ(idx, c.x + v.x, c.y + v.y, c.z + v.z);
    }
  }
  g.computeVertexNormals();
  return g;
}
// 头表面：方位角 az（0 = 正前方，+π/2 = 右边 +x）、高度 y 处的点和法线，沿法线抬起 lift
function headAt(az, y, lift = 0) {
  const f = Math.sqrt(Math.max(0, 1 - (y / HR.y) ** 2));
  const p = new V3(HR.x * f * Math.sin(az), y, HR.z * f * Math.cos(az));
  const n = new V3(p.x / HR.x ** 2, p.y / HR.y ** 2, p.z / HR.z ** 2).normalize();
  return { p: p.addScaledVector(n, lift), n };
}
// 眼镜腿：从镜框外沿 (x, z) 出发，贴着头侧（抬起一点）往后绕到 az≈80°
function templeArm(s, x, z, y, r) {
  const a0 = Math.atan2(x, z), pts = [new V3(s * x, y, z)];
  for (let i = 1; i <= 6; i++) {
    const az = a0 + (1.4 - a0) * (i / 6);
    const p = headAt(az, y, 0.018).p;
    pts.push(new V3(s * p.x, y, p.z));
  }
  return sweep(pts, 24, 6, () => r);
}
const face = (obj, n) => { obj.quaternion.setFromUnitVectors(ZAX, n); return obj; };
function heartShape(w, h, scale = 1, cy = 0) {
  const pts = [];
  for (let i = 0; i < 64; i++) {
    const t = (i / 64) * Math.PI * 2;
    const x = 16 * Math.sin(t) ** 3;
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    pts.push(new THREE.Vector2((x / 32) * w * scale, ((y + 2.5) / 29) * h * scale + cy));
  }
  return pts;
}

/* ---------------------------------------------------------------- the catalog */
// 每个 builder 返回 { root, hide?: ["bow"|"bell"] }，root 已经摆在挂点坐标系里
const BUILD = {
  santa_hat({ toon, mk }) {
    const root = new THREE.Group();
    const R = 0.19;
    // 红色帽身：从帽檐往上，再软软地垂向右边（避开左耳的蝴蝶结）
    const body = mk(sweep([new V3(0, 0, 0), new V3(0.005, 0.16, 0), new V3(0.06, 0.31, 0), new V3(0.19, 0.38, 0.01), new V3(0.3, 0.3, 0.02)],
      40, 16, (u) => R * Math.max(0.12, 1 - u) ** 0.85 + 0.008), toon(0xf05a63), 0.018);
    const brim = mk(fuzz(new THREE.TorusGeometry(R + 0.005, 0.068, 10, 36).rotateX(Math.PI / 2), 0.018, 9), toon(0xffffff), 0.018);
    brim.position.y = 0.02;
    const pom = mk(fuzz(new THREE.SphereGeometry(0.075, 14, 10), 0.015, 12, 3), toon(0xffffff), 0.016);
    pom.position.set(0.31, 0.27, 0.02);
    root.add(body, brim, pom);
    root.position.set(0.0, 0.415, -0.01);
    root.rotation.set(-0.12, 0, -0.1);
    return { root };
  },

  beanie({ toon, mk }) {
    const root = new THREE.Group();
    const TH = 0.4 * Math.PI;
    // 帽身：比头大一圈的半球，竖着一道道针织纹（toon 阶梯光正好显出纹路）
    const dome = new THREE.SphereGeometry(1, 40, 14, 0, Math.PI * 2, 0, TH);
    const p = dome.attributes.position, v = new V3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const az = Math.atan2(v.x, v.z), k = 1 + 0.022 * Math.cos(az * 22) * Math.min(1, Math.hypot(v.x, v.z) * 2.5);
      p.setXYZ(i, v.x * 0.565 * k, v.y * 0.5, v.z * 0.525 * k);
    }
    dome.computeVertexNormals();
    root.add(mk(dome, toon(0xffb0c4), 0.02));
    // 罗纹帽边
    const y0 = 0.5 * Math.cos(TH) + 0.01, s = Math.sin(TH) * 0.985;
    const ring = [];
    for (let i = 0; i < 48; i++) { const a = (i / 48) * Math.PI * 2; ring.push(new V3(0.565 * s * Math.sin(a), y0, 0.525 * s * Math.cos(a))); }
    const band = mk(sweep(ring, 96, 10, (u) => 0.058 * (1 + 0.1 * Math.cos(u * Math.PI * 2 * 30)), { closed: true }), toon(0xfff0f4), 0.016);
    root.add(band);
    // 毛球
    const pom = mk(fuzz(new THREE.SphereGeometry(0.11, 16, 12), 0.022, 10, 5), toon(0xffffff), 0.018);
    pom.position.set(0, 0.54, -0.01);
    root.add(pom);
    root.position.set(0, 0.02, 0);
    root.rotation.set(-0.16, 0, 0);
    return { root, hide: ["bow"] };
  },

  flower_crown({ toon, mk }) {
    const root = new THREE.Group();
    // 绕头一圈：额头上方 → 耳朵下面 → 后脑勺（前后高、两边低，正好躲开两只耳朵）
    const ringY = (az) => 0.29 - 0.18 * Math.sin(az) ** 2 + 0.035 * (1 - Math.cos(az)) / 2;
    const vine = [];
    for (let i = 0; i < 40; i++) { const az = (i / 40) * Math.PI * 2; vine.push(headAt(az, ringY(az), 0.012).p); }
    root.add(mk(sweep(vine, 120, 6, () => 0.022, { closed: true }), toon(0x7cc68a), 0.012));
    const COLS = [0xffa6c9, 0xfff3f6, 0xffc89e, 0xc9b6ff, 0xffa6c9, 0xfff3f6];
    const flowers = [], N = 11;
    for (let i = 0; i < N; i++) {
      const az = ((i + 0.5) / N) * Math.PI * 2 - Math.PI / N + 0.0001;
      const front = Math.cos(az); // 前面的花大一点
      const size = 0.06 + 0.022 * Math.max(0, front);
      flowers.push({ az, size, col: COLS[i % COLS.length] });
    }
    const petalGeo = new THREE.SphereGeometry(1, 10, 7);
    root.add(mk(bake(toon(0xffffff, { vertexColors: true }), (g) => {
      for (const f of flowers) {
        const { p, n } = headAt(f.az, ringY(f.az), 0.03);
        const fl = face(new THREE.Group(), n);
        fl.position.copy(p);
        fl.rotateZ(f.az * 2.3);
        for (let k = 0; k < 5; k++) {
          const a = (k / 5) * Math.PI * 2;
          const pt = part(petalGeo, f.col);
          pt.scale.set(f.size * 0.62, f.size * 0.48, f.size * 0.3);
          pt.position.set(Math.cos(a) * f.size * 0.62, Math.sin(a) * f.size * 0.62, 0);
          pt.rotation.z = a;
          fl.add(pt);
        }
        g.add(fl);
      }
    }), 0.01));
    // 花心 + 小叶子
    root.add(bake(toon(0xffffff, { vertexColors: true }), (g) => {
      for (const f of flowers) {
        const { p, n } = headAt(f.az, ringY(f.az), 0.03 + f.size * 0.25);
        const c = face(part(new THREE.SphereGeometry(f.size * 0.36, 10, 7), 0xffd75e), n);
        c.position.copy(p); c.scale.z = 0.6;
        g.add(c);
      }
      for (let i = 0; i < flowers.length; i++) {
        const az = flowers[i].az + Math.PI / flowers.length;
        const { p, n } = headAt(az, ringY(az), 0.02);
        for (const s of [-1, 1]) {
          const l = face(new THREE.Group(), n);
          l.position.copy(p);
          const leaf = part(new THREE.SphereGeometry(1, 8, 6), 0x8fd694);
          leaf.scale.set(0.05, 0.022, 0.012);
          leaf.position.x = s * 0.04;
          leaf.rotation.z = s * 0.4;
          l.add(leaf);
          g.add(l);
        }
      }
    }));
    return { root };
  },

  beret({ toon, mk }) {
    const root = new THREE.Group();
    // 扁扁的软饼，边缘鼓一圈，歪戴在右耳那边
    const geo = new THREE.SphereGeometry(1, 36, 18);
    const p = geo.attributes.position, v = new V3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const rr = Math.hypot(v.x, v.z);
      const y = v.y > 0 ? v.y * (0.09 + 0.07 * (1 - rr)) : v.y * 0.04;
      p.setXYZ(i, v.x * 0.335, y, v.z * 0.32);
    }
    geo.computeVertexNormals();
    root.add(mk(geo, toon(0x7fa8ec), 0.018));
    const band = mk(new THREE.TorusGeometry(0.27, 0.022, 8, 40).rotateX(Math.PI / 2), toon(0x6a92d8), 0.012);
    band.position.y = -0.02;
    const stem = mk(new THREE.CylinderGeometry(0.012, 0.022, 0.07, 8), toon(0x6a92d8), 0.01);
    stem.position.set(0, 0.16, 0); stem.rotation.z = -0.5;
    root.add(band, stem);
    root.position.set(0.07, 0.43, 0.0);
    root.rotation.set(-0.15, 0, -0.38);
    return { root };
  },

  witch_hat({ toon, mk }) {
    const root = new THREE.Group();
    // 帽檐做成前后长、左右窄的椭圆，正好塞在两只耳朵中间
    const brimGeo = new THREE.CylinderGeometry(1, 1, 0.03, 36);
    brimGeo.scale(0.24, 1, 0.33);
    const brim = mk(brimGeo, toon(0x9b87e0), 0.014);
    const cone = mk(sweep([new V3(0, 0, 0), new V3(0, 0.18, 0), new V3(-0.02, 0.36, 0), new V3(0.06, 0.5, 0), new V3(0.17, 0.53, 0)],
      40, 16, (u) => 0.165 * Math.max(0.06, 1 - u) ** 1.05 + 0.006), toon(0x9b87e0), 0.016);
    const band = mk(new THREE.CylinderGeometry(0.162, 0.168, 0.05, 24, 1, true), toon(0xffa6c9, { side: THREE.DoubleSide }), 0.01);
    band.position.y = 0.04;
    // 金色小星星
    const st = new THREE.Shape();
    for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2, r = i % 2 ? 0.022 : 0.05; i ? st.lineTo(Math.sin(a) * r, Math.cos(a) * r) : st.moveTo(0, r); }
    const star = mk(new THREE.ExtrudeGeometry(st, { depth: 0.012, bevelEnabled: true, bevelSize: 0.006, bevelThickness: 0.006, bevelSegments: 1 }), toon(0xffd75e, { emissive: 0x3a2a00 }), 0.008);
    star.position.set(0.0, 0.2, 0.135); star.rotation.x = -0.12;
    root.add(brim, cone, band, star);
    root.position.set(0.0, 0.445, -0.01);
    root.rotation.set(-0.14, 0, -0.06);
    return { root };
  },

  crown({ toon, mk }) {
    const root = new THREE.Group();
    const gold = toon(0xffd166, { emissive: 0x3a2400 });
    root.add(mk(bake(gold, (g) => {
      // 一圈有厚度的金环 + 5 个尖尖，尖上一颗小金球
      g.add(new THREE.Mesh(new THREE.LatheGeometry([
        new THREE.Vector2(0.15, 0), new THREE.Vector2(0.172, 0), new THREE.Vector2(0.178, 0.02), new THREE.Vector2(0.172, 0.085),
        new THREE.Vector2(0.15, 0.085), new THREE.Vector2(0.15, 0)], 28)));
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const sp = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.12, 4));
        sp.position.set(Math.sin(a) * 0.162, 0.14, Math.cos(a) * 0.162);
        sp.rotation.y = a;
        sp.scale.z = 0.5;
        const ball = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 6));
        ball.position.set(Math.sin(a) * 0.162, 0.205, Math.cos(a) * 0.162);
        g.add(sp, ball);
      }
    }), 0.012));
    root.add(bake(toon(0xffffff, { vertexColors: true, emissive: 0x222222 }), (g) => {
      const C = [0xff6b9b, 0x7ec8ff, 0x8be0a4, 0xc9a6ff, 0xff9f6b];
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const gem = part(new THREE.SphereGeometry(0.024, 10, 8), C[i]);
        gem.position.set(Math.sin(a) * 0.178, 0.045, Math.cos(a) * 0.178);
        gem.scale.set(1, 1.1, 0.6);
        gem.rotation.y = a;
        g.add(gem);
      }
    }));
    root.position.set(0.02, 0.42, 0.0);
    root.rotation.set(-0.1, 0, -0.14);
    root.scale.setScalar(1.2);
    return { root };
  },

  bunny_ears({ toon, mk }) {
    const root = new THREE.Group();
    // 发箍：贴着头顶、在猫耳前面跨过去
    const ZB = 0.17, arc = [];
    for (let i = 0; i <= 20; i++) {
      const x = -0.49 + (i / 20) * 0.98;
      const y2 = 1 - (x / HR.x) ** 2 - (ZB / HR.z) ** 2;
      const y = HR.y * Math.sqrt(Math.max(0, y2)) + 0.02;
      arc.push(new V3(x, y, ZB + 0.012 * (1 - Math.abs(x) * 2)));
    }
    root.add(mk(sweep(arc, 60, 8, () => 0.026), toon(0xff9cc6), 0.012));
    // 两只长耳朵（右边那只半路折下来）
    const earPts = (flop) => flop
      ? [new V3(0, 0, 0), new V3(0.01, 0.16, 0), new V3(0.03, 0.29, 0), new V3(0.12, 0.37, 0), new V3(0.24, 0.33, 0)]
      : [new V3(0, 0, 0), new V3(0.0, 0.14, 0), new V3(-0.01, 0.28, 0), new V3(0.0, 0.42, 0)];
    const prof = (R) => (u) => R * (u < 0.15 ? 0.55 + 0.45 * sm(u / 0.15) : u > 0.78 ? Math.sqrt(Math.max(0.0001, 1 - ((u - 0.78) / 0.22) ** 2)) : 1);
    for (const s of [-1, 1]) {
      const flop = s > 0;
      const ear = new THREE.Group();
      const pts = earPts(flop);
      ear.add(mk(sweep(pts, 30, 12, prof(0.074), { flatZ: 0.42 }), toon(0xffffff), 0.016));
      const inner = new THREE.Mesh(sweep(pts.map((q) => q.clone()), 30, 10, prof(0.042), { flatZ: 0.3 }), toon(0xffb3cf));
      inner.position.z = 0.016;
      ear.add(inner);
      ear.position.set(s * 0.115, 0.42, ZB + 0.005);
      ear.rotation.set(-0.1, 0, -s * 0.18 + (flop ? -0.08 : 0));
      root.add(ear);
    }
    return { root };
  },

  round_glasses({ toon, mk }) {
    const root = new THREE.Group();
    const R = 0.135, ZC = 0.5, YAW = 0.32, EX = 0.205, EY = -0.035;
    const frameMat = toon(0x8a5a44);
    root.add(mk(bake(frameMat, (g) => {
      for (const s of [-1, 1]) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(R, 0.016, 8, 32));
        ring.position.set(s * EX, EY, ZC);
        ring.rotation.y = s * YAW;
        g.add(ring);
        // 镜腿：从镜框外沿贴着脸侧往后绕到耳朵下面
        g.add(new THREE.Mesh(templeArm(s, EX + R * Math.cos(YAW), ZC - R * Math.sin(YAW), EY + 0.01, 0.012)));
      }
      const bridge = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.013, 6, 14, Math.PI));
      bridge.position.set(0, EY + 0.015, ZC + 0.03);
      bridge.scale.y = 0.6;
      g.add(bridge);
    }), 0.01));
    // 很淡的镜片 + 一道斜斜的高光
    const lensMat = new THREE.MeshBasicMaterial({ color: 0xdff1ff, transparent: true, opacity: 0.18, depthWrite: false });
    const glintMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false });
    const lens = bake(lensMat, (g) => {
      for (const s of [-1, 1]) {
        const l = new THREE.Mesh(new THREE.CircleGeometry(R, 28));
        l.position.set(s * EX, EY, ZC + 0.002); l.rotation.y = s * YAW;
        g.add(l);
      }
    });
    const glint = bake(glintMat, (g) => {
      for (const s of [-1, 1]) {
        const holder = new THREE.Group();
        holder.position.set(s * EX, EY, ZC + 0.006); holder.rotation.y = s * YAW;
        for (const [dx, dy, w] of [[-0.045, 0.05, 0.022], [-0.008, 0.075, 0.012]]) {
          const st = new THREE.Mesh(new THREE.CapsuleGeometry(w * 0.5, 0.05, 2, 6));
          st.scale.z = 0.05;
          st.position.set(dx, dy, 0); st.rotation.z = -0.75;
          holder.add(st);
        }
        g.add(holder);
      }
    });
    lens.renderOrder = 2; glint.renderOrder = 3;
    root.add(lens, glint);
    return { root };
  },

  heart_sunglasses({ toon, mk }) {
    const root = new THREE.Group();
    const W = 0.3, H = 0.27, ZC = 0.505, YAW = 0.32, EX = 0.205, EY = -0.03;
    const outer = heartShape(W, H), inner = heartShape(W, H, 0.74, H * 0.03);
    const frameShape = new THREE.Shape(outer);
    frameShape.holes.push(new THREE.Path(inner.slice().reverse()));
    const frameGeo = new THREE.ExtrudeGeometry(frameShape, { depth: 0.022, bevelEnabled: true, bevelSize: 0.008, bevelThickness: 0.008, bevelSegments: 2, curveSegments: 4 });
    frameGeo.translate(0, 0, -0.011);
    root.add(mk(bake(toon(0xff6fae), (g) => {
      for (const s of [-1, 1]) {
        const f = new THREE.Mesh(frameGeo);
        f.position.set(s * EX, EY, ZC); f.rotation.y = s * YAW;
        g.add(f);
        g.add(new THREE.Mesh(templeArm(s, EX + W * 0.47 * Math.cos(YAW), ZC - W * 0.47 * Math.sin(YAW), EY + 0.05, 0.013)));
      }
      const bridge = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.014, 6, 14, Math.PI));
      bridge.position.set(0, EY + 0.04, ZC + 0.02); bridge.scale.y = 0.55;
      g.add(bridge);
    }), 0.01));
    const lensMat = new THREE.MeshBasicMaterial({ color: 0xc23c7a, transparent: true, opacity: 0.82, depthWrite: false });
    const lens = bake(lensMat, (g) => {
      for (const s of [-1, 1]) {
        const l = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(inner), 6));
        l.position.set(s * EX, EY, ZC); l.rotation.y = s * YAW;
        g.add(l);
      }
    });
    const glint = bake(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false }), (g) => {
      for (const s of [-1, 1]) {
        const holder = new THREE.Group();
        holder.position.set(s * EX, EY, ZC + 0.006); holder.rotation.y = s * YAW;
        const a = new THREE.Mesh(new THREE.CapsuleGeometry(0.012, 0.05, 2, 6)); a.scale.z = 0.05;
        a.position.set(-0.05, 0.04, 0); a.rotation.z = -0.7;
        const b = new THREE.Mesh(new THREE.CircleGeometry(0.012, 8)); b.position.set(-0.012, 0.075, 0);
        holder.add(a, b);
        g.add(holder);
      }
    });
    lens.renderOrder = 2; glint.renderOrder = 3;
    root.add(lens, glint);
    return { root };
  },

  red_scarf(ctx) { return scarf(ctx, false); },
  knit_scarf(ctx) { return scarf(ctx, true); },

  bow_tie({ toon, mk }) {
    const root = new THREE.Group();
    // 两片中间捏紧的蝴蝶翅膀 + 中间一个小结
    const lobe = new THREE.SphereGeometry(1, 16, 12);
    const p = lobe.attributes.position, v = new V3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const t = (v.x + 1) / 2; // 0 = 结那头, 1 = 外沿
      const k = 0.35 + 0.65 * Math.sqrt(t);
      p.setXYZ(i, t * 0.105, v.y * 0.065 * k, v.z * 0.028 * (0.6 + 0.4 * k));
    }
    lobe.computeVertexNormals();
    const col = 0x7cb8ff;
    root.add(mk(bake(toon(col), (g) => {
      for (const s of [-1, 1]) {
        const m = new THREE.Mesh(lobe);
        m.scale.x = s; m.rotation.z = s * 0.06;
        g.add(m);
      }
    }), 0.012));
    const knot = mk(new THREE.SphereGeometry(0.034, 12, 10), toon(0x5d9ff0), 0.01);
    knot.scale.set(0.95, 1.1, 0.75); knot.position.z = 0.012;
    root.add(knot);
    root.add(bake(new THREE.MeshBasicMaterial({ color: 0xffffff }), (g) => {
      for (const [x, y] of [[-0.075, 0.018], [-0.05, -0.025], [0.06, 0.02], [0.085, -0.018]]) {
        const d = new THREE.Mesh(new THREE.CircleGeometry(0.009, 8));
        d.position.set(x, y, 0.03);
        g.add(d);
      }
    }));
    root.position.set(0, 0.565, 0.4);
    root.rotation.set(-0.22, 0, 0);
    root.scale.setScalar(1.35);
    return { root, hide: ["bell"] };
  },
};

// 围巾：一圈胖胖的软管绕脖子（压住项圈），右前方打个结，两条尾巴垂在胸前
function scarf({ toon, mk }, knit) {
  const root = new THREE.Group();
  const STR = [0xff9fb8, 0xfff4e6, 0x8fd8c4, 0xfff4e6];
  const RED = 0xf2585e, RED2 = 0xd94850;
  const mat = knit ? toon(0xffffff, { vertexColors: true }) : toon(RED);
  const colorize = (geo, f) => {
    if (!knit) return geo;
    const pp = geo.attributes.position, a = new Float32Array(pp.count * 3), c = new THREE.Color();
    for (let i = 0; i < pp.count; i++) { c.setHex(f(i, pp)); a.set([c.r, c.g, c.b], i * 3); }
    geo.setAttribute("color", new THREE.BufferAttribute(a, 3));
    return geo;
  };
  // 脖子那一圈：y≈0.62，前低后高一点，胖瘦有点起伏像软软的布
  const ring = [];
  const NR = 40;
  for (let i = 0; i < NR; i++) {
    const a = (i / NR) * Math.PI * 2;
    ring.push(new V3(0.392 * Math.sin(a), 0.625 - 0.035 * Math.cos(a), 0.36 * Math.cos(a) + 0.015));
  }
  const SEG = 120, RS = 12;
  const wrapGeo = sweep(ring, SEG, RS, (u) => 0.085 * (1 + 0.1 * Math.sin(u * Math.PI * 2 * 3 + 0.5)) * (knit ? 1 + 0.05 * Math.cos(u * Math.PI * 2 * 40) : 1), { closed: true });
  colorize(wrapGeo, (i) => STR[Math.floor((Math.floor(i / (RS + 1)) / SEG) * 24) % 4]);
  root.add(mk(wrapGeo, mat, 0.018));
  // 结 + 两条尾巴（在 x≈0.17 的胸前，顺着肚子的弧度往下垂）
  const tails = new THREE.Group();
  tails.position.set(0.17, 0.585, 0.4);
  const knot = mk(knit ? colorize(new THREE.SphereGeometry(0.075, 14, 10), () => STR[0]) : new THREE.SphereGeometry(0.075, 14, 10), mat, 0.016);
  knot.scale.set(1, 0.9, 0.7);
  tails.add(knot);
  const tailGeo = (len, w) => {
    const g = new THREE.BoxGeometry(w, len, 0.04, 2, 12, 1);
    g.translate(0, -len / 2, 0);
    const pp = g.attributes.position, v = new V3();
    for (let i = 0; i < pp.count; i++) {
      v.fromBufferAttribute(pp, i);
      const t = -v.y / len;
      v.x *= 1 + 0.25 * t;              // 越往下越宽一点
      v.z += -0.06 * t * t * 0 + 0.035 * Math.sin(t * Math.PI); // 贴着肚子鼓出来
      pp.setXYZ(i, v.x, v.y, v.z);
    }
    g.computeVertexNormals();
    colorize(g, (i, q) => STR[Math.floor(((-q.getY(i)) / len) * 6) % 4]);
    return g;
  };
  const LEN = knit ? [0.32, 0.27] : [0.28, 0.23];
  for (const [i, s] of [[0, -1], [1, 1]]) {
    const t = mk(tailGeo(LEN[i], 0.1), mat, 0.014);
    t.position.set(s * 0.025, -0.02, -0.005 + i * 0.012);
    t.rotation.set(-0.12, 0, s * 0.2 + 0.05);
    tails.add(t);
    // 流苏
    const fr = bake(knit ? toon(STR[2]) : toon(RED2), (g) => {
      for (let k = 0; k < 4; k++) {
        const c = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.006, 0.05, 5));
        c.position.set(-0.047 + k * 0.031, -LEN[i] - 0.02, 0.0);
        g.add(c);
      }
    });
    fr.position.copy(t.position); fr.rotation.copy(t.rotation);
    tails.add(fr);
  }
  tails.rotation.set(0, 0.35, 0);
  root.add(tails);
  return { root, hide: ["bell"] };
}

/* ---------------------------------------------------------------- attach / dress */
// 被衣服挡住的小零件（蝴蝶结、铃铛）：引用计数，脱下来再恢复
function hidePart(kitten, name) {
  const o = kitten[name];
  if (!o) return () => {};
  const u = o.userData;
  if (!u.outfitHide) { u.outfitHide = 0; u.outfitWasVisible = o.visible; }
  u.outfitHide++;
  o.visible = false;
  return () => {
    u.outfitHide = Math.max(0, u.outfitHide - 1);
    if (!u.outfitHide) o.visible = u.outfitWasVisible;
  };
}

export function attachOutfit(kitten, id, { toon, outlined }) {
  const def = OUTFITS[id];
  if (!def) throw new Error(`unknown outfit: ${id}`);
  // mk(geometry, material, line) 或 mk(已经烤好的 mesh, line)
  const mk = (geo, mat, line = 0.016) => (geo.isMesh ? outlined(geo, typeof mat === "number" ? mat : 0.016) : outlined(new THREE.Mesh(geo, mat), line));
  const { root, hide = [] } = BUILD[id]({ toon, outlined, mk });
  root.name = `outfit:${id}`;
  root.userData.outfit = id;
  const what = kitten.root?.userData?.what;
  root.traverse((o) => { o.castShadow = o.isMesh && !o.material?.transparent && o.material?.side !== THREE.BackSide; if (what) o.userData.what = what; });
  const parent = def.slot === "neck" ? kitten.body : kitten.head;
  parent.add(root);
  const restores = hide.map((n) => hidePart(kitten, n));
  let gone = false;
  return {
    root, id, slot: def.slot,
    remove() {
      if (gone) return;
      gone = true;
      root.parent?.remove(root);
      restores.forEach((f) => f());
      root.traverse((o) => {
        if (!o.isMesh) return;
        o.geometry.dispose();
        for (const m of [].concat(o.material)) m.dispose();
      });
    },
  };
}

const worn = new WeakMap();
// 脱掉之前通过 dressKitten 穿的所有东西，再穿上 ids（每个部位只留最后一件）。返回 { head?, face?, neck? } 句柄。
export function dressKitten(kitten, ids, ctx) {
  for (const h of worn.get(kitten) || []) h.remove();
  const bySlot = {};
  for (const id of ids || []) if (OUTFITS[id]) bySlot[OUTFITS[id].slot] = id;
  const out = {};
  const list = [];
  for (const [slot, id] of Object.entries(bySlot)) { out[slot] = attachOutfit(kitten, id, ctx); list.push(out[slot]); }
  worn.set(kitten, list);
  return out;
}
