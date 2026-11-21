// 小岛上空的局部天气（程序化 Three.js，没有外部素材），Q 版卡通风，手机上也要跑得动。
//   createWeather({ parent, center, radius, top, seaY, toon }) → { setKind(kind), update(t, dt), group }
//     kind: "clear" | "cloudy" | "rain" | "storm" | "snow" | "fog"，切换时约 1 秒淡入淡出
//   buildRainbow({ from, to, height })  → { root, setVisible(on), update(t) }
//   buildCityLights({ count, radius, toon }) → { root, setNight(k) }
import * as THREE from "three";

const V3 = THREE.Vector3;
export const WEATHER_KINDS = ["clear", "cloudy", "rain", "storm", "snow", "fog"];

/* ---------------------------------------------------------------- shared helpers */
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const smooth = (t) => t * t * (3 - 2 * t);
const toward = (v, target, step) => (v < target ? Math.min(target, v + step) : Math.max(target, v - step));
const easeOutBack = (t) => { const c = 1.6; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; };

function canvasTex(size, draw) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  draw(c.getContext("2d"), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
let TEX = null;
function textures() {
  if (TEX) return TEX;
  const radial = (stops) => canvasTex(64, (g, s) => {
    const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    for (const [o, c] of stops) gr.addColorStop(o, c);
    g.fillStyle = gr; g.fillRect(0, 0, s, s);
  });
  TEX = {
    // 雪花：中间实心的小圆点，边缘软一点（看起来像棉花糖粒）
    flake: radial([[0, "rgba(255,255,255,1)"], [0.45, "rgba(255,255,255,1)"], [0.62, "rgba(255,255,255,0.5)"], [1, "rgba(255,255,255,0)"]]),
    glow: radial([[0, "rgba(255,240,200,1)"], [0.25, "rgba(255,214,140,0.8)"], [1, "rgba(255,190,110,0)"]]),
    sparkle: canvasTex(64, (g, s) => {
      const c = s / 2;
      const gr = g.createRadialGradient(c, c, 0, c, c, c * 0.5);
      gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = gr; g.fillRect(0, 0, s, s);
      g.fillStyle = "#fff";
      g.beginPath();
      for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2, r = i % 2 ? c * 0.12 : c * 0.95; g.lineTo(c + Math.sin(a) * r, c - Math.cos(a) * r); }
      g.fill();
    }),
    // 雾：几团叠在一起的软圆
    fog: canvasTex(128, (g, s) => {
      for (const [x, y, r] of [[0.5, 0.55, 0.42], [0.3, 0.6, 0.3], [0.7, 0.58, 0.3], [0.45, 0.42, 0.28], [0.62, 0.45, 0.25]]) {
        const gr = g.createRadialGradient(x * s, y * s, 0, x * s, y * s, r * s);
        gr.addColorStop(0, "rgba(255,255,255,0.55)"); gr.addColorStop(1, "rgba(255,255,255,0)");
        g.fillStyle = gr; g.fillRect(0, 0, s, s);
      }
    }),
    // 卡通闪电 ⚡：黄色锯齿 + 深色描边（和 toon 描边一个颜色）
    bolts: [0, 1, 2].map((seed) => canvasTex(128, (g, s) => {
      const R = rng(seed * 97 + 5);
      const pts = [];
      let x = 0.5 + (R() - 0.5) * 0.15;
      pts.push([x, 0.02]);
      const steps = 4;
      for (let i = 1; i <= steps; i++) { x = 0.5 + (i % 2 ? 1 : -1) * (0.12 + R() * 0.1); pts.push([x, i / steps * 0.96 + 0.02]); }
      // 宽度沿路径变细：画成一条粗折线带
      const W = (u) => (1 - u) * 0.09 + 0.02;
      const left = [], right = [];
      for (let i = 0; i < pts.length; i++) {
        const [px, py] = pts[i], u = i / (pts.length - 1);
        left.push([px - W(u), py]); right.push([px + W(u), py]);
      }
      g.lineJoin = "round";
      g.beginPath();
      [...left, ...right.reverse()].forEach(([px, py], i) => (i ? g.lineTo(px * s, py * s) : g.moveTo(px * s, py * s)));
      g.closePath();
      g.lineWidth = s * 0.045; g.strokeStyle = "#4a2f25"; g.stroke();
      g.fillStyle = "#fff27a"; g.fill();
      g.beginPath();
      left.forEach(([px, py], i) => (i ? g.lineTo((px + 0.035) * s, py * s) : g.moveTo((px + 0.035) * s, py * s)));
      g.lineWidth = s * 0.02; g.strokeStyle = "#fffdf0"; g.stroke();
    })),
  };
  return TEX;
}

function fixSeams(geo) {
  const p = geo.attributes.position, n = geo.attributes.normal;
  const map = new Map(), v = new V3();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    let e = map.get(key); if (!e) map.set(key, e = { n: new V3(), idx: [] });
    e.n.add(v.fromBufferAttribute(n, i)); e.idx.push(i);
  }
  for (const e of map.values()) { e.n.normalize(); for (const i of e.idx) n.setXYZ(i, e.n.x, e.n.y, e.n.z); }
  return geo;
}
// 一朵蓬松的卡通云：一个闭合的网格（几个圆球的“径向外壳”，底部压平），半透明淡入时不会看到内部的面
export function cloudGeometry(seed = 1, size = 1) {
  const R = rng(seed * 131 + 7);
  const puffs = [[0, 0.12, 0, 0.62]];
  const n = 5 + Math.floor(R() * 2);
  for (let i = 0; i < n; i++) {
    const side = i % 2 ? 1 : -1, k = Math.floor(i / 2);
    puffs.push([side * (0.42 + k * 0.32 + R() * 0.1), 0.02 + R() * 0.16 - k * 0.07, (R() - 0.5) * 0.35, 0.5 - k * 0.1 + R() * 0.06]);
  }
  puffs.push([0.18 * (R() > 0.5 ? 1 : -1), 0.38, -0.05, 0.42]);
  const geo = new THREE.SphereGeometry(1, 56, 28);
  const p = geo.attributes.position, d = new V3(), c = new V3();
  for (let i = 0; i < p.count; i++) {
    d.fromBufferAttribute(p, i).normalize();
    // 软并集（log-sum-exp）：球和球之间的凹缝是圆的，toon 光照下不会像石头
    let sum = 0;
    for (const [x, y, z, r] of puffs) {
      c.set(x, y, z);
      const b = d.dot(c), disc = b * b - (c.lengthSq() - r * r);
      if (disc >= 0) sum += Math.exp(14 * (b + Math.sqrt(disc)));
    }
    const best = Math.log(Math.max(sum, 1e-9)) / 14;
    const v = d.clone().multiplyScalar(best);
    v.z *= 0.75;
    if (v.y < -0.2) v.y = -0.2 + (v.y + 0.2) * 0.15; // 平底
    p.setXYZ(i, v.x * size, v.y * size, v.z * size);
  }
  geo.computeVertexNormals();
  return fixSeams(geo);
}

/* ================================================================ WEATHER */
const KINDS = {
  //          clouds  rain  snow  fog  dark
  clear:  { cloud: 0, rain: 0, snow: 0, fog: 0, color: 0xffffff },
  cloudy: { cloud: 1, rain: 0, snow: 0, fog: 0, color: 0xfbfcff },
  rain:   { cloud: 1, rain: 1, snow: 0, fog: 0, color: 0xc9d0de },
  storm:  { cloud: 1, rain: 1, snow: 0, fog: 0, color: 0x8b8fa8, storm: 1 },
  snow:   { cloud: 1, rain: 0, snow: 1, fog: 0, color: 0xeef1fa },
  fog:    { cloud: 0, rain: 0, snow: 0, fog: 1, color: 0xffffff },
};

export function createWeather({ parent, center = new V3(), radius = 6.5, top = 5, seaY = -0.85, toon, landR, flashLight = true, seed = 1 } = {}) {
  const T = textures();
  const R = rng(seed * 7919 + 13);
  const S = radius / 6.5;                    // 尺寸比例（主岛 = 1）
  const area = Math.min(1, S * S);
  const group = new THREE.Group();
  group.name = "weather";
  group.position.copy(center);
  parent?.add(group);
  const sea = seaY - center.y;                // 本地坐标里的海面
  const cloudY = top * 0.8;
  const baseY = cloudY - 0.08 * top;          // 云底：雨雪从这里落下
  const spawnR = radius * 0.8;
  landR = landR ?? radius * 0.5;
  const mkToon = toon || ((c, e = {}) => new THREE.MeshToonMaterial({ color: c, ...e }));
  const noRay = (o) => { o.raycast = () => {}; return o; };

  // ---------------------------------------------------------- 云
  const cloudMat = mkToon(0xffffff, { transparent: true, opacity: 0, depthWrite: true, emissive: 0x000000 });
  const cloudCol = new THREE.Color(0xffffff), cloudTarget = new THREE.Color(0xffffff);
  const clouds = [];
  const CN = 3;
  for (let i = 0; i < CN; i++) {
    const size = radius * (i === 2 ? 0.12 : 0.15) * (0.9 + R() * 0.2);
    const m = noRay(new THREE.Mesh(cloudGeometry(seed * 10 + i, size), cloudMat));
    m.userData = { size, a: (i / CN) * Math.PI * 2 + R() * 0.6, r: radius * (0.18 + R() * 0.17), y: cloudY + (R() - 0.5) * top * 0.08, ph: R() * 6, sp: 0.03 + R() * 0.02 };
    m.rotation.y = R() * Math.PI;
    m.visible = false;
    group.add(m);
    clouds.push(m);
  }

  // ---------------------------------------------------------- 雨：便宜的 LineSegments，上端透明下端亮
  const RN = Math.max(60, Math.round(400 * area));
  const rPos = new Float32Array(RN * 6), rCol = new Float32Array(RN * 8), rVel = new Float32Array(RN);
  const rainLen = 0.5 * Math.max(0.5, S) * (top / 5);
  // 雨雪从云底下落：每滴挑一朵云，落在它的“影子”范围里（云还没出来时就撒在整片区域）
  const spawnXZ = (i, out) => {
    const m = clouds[i % CN];
    const a = R() * Math.PI * 2, r = Math.sqrt(R());
    if (m.visible) {
      const k = m.scale.x * m.userData.size * 1.35;
      out[0] = m.position.x + Math.cos(a) * r * k * 1.25; out[1] = m.position.z + Math.sin(a) * r * k * 0.8;
    } else { out[0] = Math.cos(a) * r * spawnR; out[1] = Math.sin(a) * r * spawnR; }
    return out;
  };
  const xz = [0, 0];
  const dropXZ = (i) => { spawnXZ(i, xz); rPos[i * 6] = xz[0]; rPos[i * 6 + 2] = xz[1]; };
  for (let i = 0; i < RN; i++) {
    dropXZ(i);
    rPos[i * 6 + 1] = sea + R() * (baseY - sea);
    rVel[i] = (top * 1.6 + R() * top * 0.5);
    rCol.set([0.93, 0.97, 1, 1, 0.85, 0.92, 1, 0], i * 8); // 下端（雨滴头）亮，上端淡出
  }
  const rGeo = new THREE.BufferGeometry();
  rGeo.setAttribute("position", new THREE.BufferAttribute(rPos, 3).setUsage(THREE.DynamicDrawUsage));
  rGeo.setAttribute("color", new THREE.BufferAttribute(rCol, 4));
  const rainMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, depthWrite: false });
  const rain = noRay(new THREE.LineSegments(rGeo, rainMat));
  rain.frustumCulled = false;
  rain.renderOrder = 2; // 在海面（renderOrder 1，半透明）之后画
  rain.visible = false;
  group.add(rain);

  // ---------------------------------------------------------- 海面上的小水花圈（InstancedMesh，一次 draw call，扩散在 shader 里算）
  const SN = Math.max(10, Math.round(36 * area));
  const ringGeo = new THREE.RingGeometry(0.72, 1, 20).rotateX(-Math.PI / 2);
  const aT = new THREE.InstancedBufferAttribute(new Float32Array(SN).fill(-1), 1).setUsage(THREE.DynamicDrawUsage);
  ringGeo.setAttribute("aT", aT);
  const splashMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uOpacity: { value: 0 }, uSize: { value: 0.2 * Math.max(0.55, S) }, uColor: { value: new THREE.Color(0xf4fbff) } },
    vertexShader: `attribute float aT; varying float vT; uniform float uSize;
      void main() { vT = aT; float k = aT < 0.0 ? 0.0 : uSize * (0.25 + 0.75 * aT);
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position * k, 1.0); }`,
    fragmentShader: `varying float vT; uniform float uOpacity; uniform vec3 uColor;
      void main() { if (vT < 0.0) discard; gl_FragColor = vec4(uColor, uOpacity * (1.0 - vT) * 0.9); }`,
  });
  const splashes = noRay(new THREE.InstancedMesh(ringGeo, splashMat, SN));
  splashes.frustumCulled = false;
  splashes.renderOrder = 2;
  splashes.visible = false;
  const tmpM = new THREE.Matrix4();
  for (let i = 0; i < SN; i++) splashes.setMatrixAt(i, tmpM.makeTranslation(0, sea + 0.02, 0));
  group.add(splashes);
  let nextSplash = 0;
  const spawnSplash = (x, z) => {
    const i = nextSplash; nextSplash = (nextSplash + 1) % SN;
    splashes.setMatrixAt(i, tmpM.makeTranslation(x, sea + 0.02, z));
    splashes.instanceMatrix.needsUpdate = true;
    aT.array[i] = 0;
  };

  // ---------------------------------------------------------- 雪：Points + 圆圆的软雪花
  const FN = Math.max(60, Math.round(400 * area));
  const fPos = new Float32Array(FN * 3), fVel = new Float32Array(FN), fPh = new Float32Array(FN);
  for (let i = 0; i < FN; i++) {
    spawnXZ(i, xz); fPos[i * 3] = xz[0]; fPos[i * 3 + 2] = xz[1];
    fPos[i * 3 + 1] = sea + R() * (baseY - sea);
    fVel[i] = (0.35 + R() * 0.35) * (top / 5) * 1.2; fPh[i] = R() * 6.28;
  }
  const fGeo = new THREE.BufferGeometry();
  fGeo.setAttribute("position", new THREE.BufferAttribute(fPos, 3).setUsage(THREE.DynamicDrawUsage));
  const snowMat = new THREE.PointsMaterial({ size: 0.3 * Math.max(0.6, S), map: T.flake, transparent: true, opacity: 0, depthWrite: false, color: 0xffffff });
  const snow = noRay(new THREE.Points(fGeo, snowMat));
  snow.frustumCulled = false;
  snow.renderOrder = 2;
  snow.visible = false;
  group.add(snow);

  // ---------------------------------------------------------- 雾：几团大大的半透明 sprite，低低地飘
  const fogs = [];
  // depthTest 关掉：不然 sprite 和草地 / 海面相交的地方会切出硬边；雾本来就是一层盖在上面的纱
  const fogMat = new THREE.SpriteMaterial({ map: T.fog, transparent: true, opacity: 0, depthWrite: false, depthTest: false, color: 0xf6f3ff });
  const FOGN = 6;
  for (let i = 0; i < FOGN; i++) {
    const sp = noRay(new THREE.Sprite(fogMat));
    const sz = radius * (0.6 + R() * 0.3);
    sp.scale.set(sz * 1.5, sz * 0.6, 1);
    // 锚点在贴图下沿：sprite 从海面往上长，不会被海面切出一条硬边
    sp.center.set(0.5, 0.12);
    sp.userData = { a: (i / FOGN) * Math.PI * 2, r: radius * (0.3 + R() * 0.45), y: sea + top * 0.02 * R(), sp: (R() > 0.5 ? 1 : -1) * (0.04 + R() * 0.04) };
    sp.visible = false;
    sp.renderOrder = 2;
    group.add(sp);
    fogs.push(sp);
  }

  // ---------------------------------------------------------- 闪电：卡通锯齿 sprite + 一下亮光
  const boltMats = T.bolts.map((map) => new THREE.SpriteMaterial({ map, transparent: true, depthWrite: false }));
  const bolt = noRay(new THREE.Sprite(boltMats[0]));
  const boltH = cloudY - Math.max(sea, 0) - 0.3;
  bolt.scale.set(boltH * 0.4, boltH, 1);
  bolt.visible = false;
  group.add(bolt);
  let flash = null;
  if (flashLight) {
    flash = new THREE.PointLight(0xe6eeff, 0, radius * 3.2, 1.2);
    flash.position.set(0, baseY, 0);
    group.add(flash);
  }
  let strikeAt = 1.5, strikeT0 = -9;

  // ---------------------------------------------------------- 状态 / 过渡
  let kind = "clear";
  const lv = { cloud: 0, rain: 0, snow: 0, fog: 0, storm: 0 };
  function setKind(k) {
    if (!KINDS[k]) k = "clear";
    kind = k;
    cloudTarget.setHex(KINDS[k].color);
    if (k === "storm") strikeAt = 0.6;
  }

  let clock = 0;
  function update(t, dt) {
    dt = Math.min(0.1, Math.max(0, dt || 0));
    clock += dt;
    const K = KINDS[kind];
    const step = dt; // 1 秒走完
    lv.cloud = toward(lv.cloud, K.cloud, step);
    lv.rain = toward(lv.rain, K.rain, step);
    lv.snow = toward(lv.snow, K.snow, step);
    lv.fog = toward(lv.fog, K.fog, step);
    lv.storm = toward(lv.storm, K.storm ? 1 : 0, step);
    cloudCol.lerp(cloudTarget, Math.min(1, dt * 3));

    // 云
    const c = smooth(lv.cloud);
    for (const [i, m] of clouds.entries()) {
      m.visible = c > 0.002;
      if (!m.visible) continue;
      const u = m.userData;
      const a = u.a + t * u.sp;
      m.position.set(Math.cos(a) * u.r, u.y + Math.sin(t * 0.6 + u.ph) * top * 0.015, Math.sin(a) * u.r);
      const k = 0.35 + 0.65 * easeOutBack(Math.min(1, c * (1 + i * 0.12)) ** 0.8);
      m.scale.set(k * (1 + Math.sin(t * 0.9 + u.ph) * 0.02), k * (1 + Math.sin(t * 1.1 + u.ph) * 0.03), k);
    }
    cloudMat.opacity = Math.min(1, c * 1.3);
    cloudMat.color.copy(cloudCol);

    // 雨
    const rk = lv.rain;
    rain.visible = splashes.visible = rk > 0.002;
    if (rain.visible) {
      const active = Math.ceil(RN * rk);
      const speed = 1 + 0.3 * lv.storm, wind = (0.1 + 0.15 * lv.storm);
      const len = rainLen * (1 + 0.3 * lv.storm);
      for (let i = 0; i < active; i++) {
        const o = i * 6;
        const vy = rVel[i] * speed;
        let y = rPos[o + 1] - vy * dt;
        rPos[o] += vy * wind * dt;
        if (y < sea) {
          const x = rPos[o], z = rPos[o + 2];
          if (x * x + z * z > landR * landR && R() < 0.5) spawnSplash(x, z);
          dropXZ(i);
          rPos[o] -= baseY * wind * 0.5;
          y = baseY - R() * 0.3;
        }
        rPos[o + 1] = y;
        rPos[o + 3] = rPos[o] - len * wind; rPos[o + 4] = y + len; rPos[o + 5] = rPos[o + 2];
      }
      rGeo.attributes.position.needsUpdate = true;
      rGeo.setDrawRange(0, active * 2);
      rainMat.opacity = Math.min(1, rk * 1.5) * 0.85;
      splashMat.uniforms.uOpacity.value = rk;
      for (let i = 0; i < SN; i++) if (aT.array[i] >= 0) { aT.array[i] += dt / 0.45; if (aT.array[i] > 1) aT.array[i] = -1; }
      aT.needsUpdate = true;
    }

    // 雪
    const sk = lv.snow;
    snow.visible = sk > 0.002;
    if (snow.visible) {
      const active = Math.ceil(FN * sk);
      for (let i = 0; i < active; i++) {
        const o = i * 3;
        let y = fPos[o + 1] - fVel[i] * dt;
        fPos[o] += Math.sin(t * 1.3 + fPh[i]) * dt * 0.18 * Math.max(0.5, S);
        fPos[o + 2] += Math.cos(t * 1.1 + fPh[i]) * dt * 0.12 * Math.max(0.5, S);
        if (y < sea) {
          spawnXZ(i, xz); fPos[o] = xz[0]; fPos[o + 2] = xz[1];
          y = baseY - R() * 0.3;
        }
        fPos[o + 1] = y;
      }
      fGeo.attributes.position.needsUpdate = true;
      fGeo.setDrawRange(0, active);
      snowMat.opacity = Math.min(1, sk * 1.5);
    }

    // 雾
    const fk = smooth(lv.fog);
    fogMat.opacity = fk * 0.6;
    for (const sp of fogs) {
      sp.visible = fk > 0.002;
      if (!sp.visible) continue;
      const u = sp.userData, a = u.a + t * u.sp;
      sp.position.set(Math.cos(a) * u.r, u.y + Math.sin(t * 0.4 + u.a) * top * 0.02, Math.sin(a) * u.r);
    }

    // 闪电：每 3~7 秒劈一下，亮-灭-亮
    let fl = 0;
    if (kind === "storm" && lv.storm > 0.6 && clock > strikeAt) {
      strikeT0 = clock;
      strikeAt = clock + 3 + R() * 4;
      bolt.material = boltMats[Math.floor(R() * boltMats.length)];
      // 从某朵云的肚子底下劈下来
      const m = clouds[Math.floor(R() * CN)], k = m.userData.size * 0.5;
      bolt.position.set(m.position.x + (R() - 0.5) * k, m.position.y - m.userData.size * 0.12 - boltH / 2, m.position.z + (R() - 0.5) * k * 0.5);
      bolt.scale.x = boltH * 0.4 * (R() > 0.5 ? 1 : -1);
      if (flash) flash.position.set(bolt.position.x, baseY, bolt.position.z);
    }
    const st = clock - strikeT0;
    if (st < 0.5) fl = st < 0.09 ? 1 : st < 0.15 ? 0.15 : st < 0.3 ? 0.85 : (0.5 - st) / 0.2 * 0.5;
    bolt.visible = st < 0.3 && (st < 0.09 || st > 0.15);
    if (flash) flash.intensity = fl * 14 * Math.max(0.6, S);
    cloudMat.emissive.setRGB(fl * 0.55, fl * 0.55, fl * 0.6);
  }

  setKind("clear");
  return { setKind, update, group, get kind() { return kind; } };
}

/* ================================================================ RAINBOW */
const RAINBOW = [0xffadad, 0xffd6a5, 0xfdffb6, 0xcaffbf, 0x9bf6ff, 0xbdb2ff];

export function buildRainbow({ from, to, height = 3, toon, sparkles = true } = {}) {
  const root = new THREE.Group();
  root.name = "rainbow";
  from = from.clone(); to = to.clone();
  const mid = from.clone().add(to).multiplyScalar(0.5);
  const xAxis = to.clone().sub(from);
  const half = xAxis.length() / 2;
  xAxis.normalize();
  const yAxis = new V3(0, 1, 0).addScaledVector(xAxis, -xAxis.y).normalize();
  const zAxis = new V3().crossVectors(xAxis, yAxis);
  root.position.copy(mid);
  root.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis));

  // 6 条细细的弧，从外（红）到内（紫），合成一个 mesh；aU 记录沿弧的位置，出现时从一头“画”到另一头
  const w = Math.min(half, height) * 0.055;
  const SEG = 64, RS = 8;
  const pos = [], col = [], us = [], idx = [];
  const c = new THREE.Color();
  RAINBOW.forEach((hex, b) => {
    c.setHex(hex);
    const a = half - b * w * 1.75, h = height - b * w * 1.75, r = w * 0.95;
    const base = pos.length / 3;
    for (let i = 0; i <= SEG; i++) {
      const u = i / SEG, th = Math.PI * (1 - u); // u=0 在 from 那头
      const px = a * Math.cos(th), py = h * Math.sin(th);
      // 椭圆法线（截面方向）
      const nx = Math.cos(th) / a, ny = Math.sin(th) / h, nl = Math.hypot(nx, ny);
      for (let j = 0; j <= RS; j++) {
        const phi = (j / RS) * Math.PI * 2;
        const cr = Math.cos(phi) * r, cz = Math.sin(phi) * r * 0.55;
        pos.push(px + (nx / nl) * cr, py + (ny / nl) * cr, cz);
        col.push(c.r, c.g, c.b);
        us.push(u);
      }
    }
    for (let i = 0; i < SEG; i++) for (let j = 0; j < RS; j++) {
      const p0 = base + i * (RS + 1) + j, p1 = p0 + RS + 1;
      idx.push(p0, p1, p0 + 1, p1, p1 + 1, p0 + 1);
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute("aU", new THREE.Float32BufferAttribute(us, 1));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const reveal = { value: 0 };
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uReveal = reveal;
    sh.vertexShader = "attribute float aU;\nvarying float vU;\n" + sh.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\nvU = aU;");
    sh.fragmentShader = "uniform float uReveal;\nvarying float vU;\n" + sh.fragmentShader.replace("#include <clipping_planes_fragment>", "#include <clipping_planes_fragment>\nif (vU > uReveal) discard;");
  };
  const arc = new THREE.Mesh(geo, mat);
  arc.raycast = () => {};
  arc.renderOrder = 1;
  root.add(arc);

  // 两头各一朵小白云
  const puffs = [];
  const cloudMat = (toon || ((cc, e) => new THREE.MeshToonMaterial({ color: cc, ...e })))(0xffffff, { transparent: true, opacity: 0 });
  for (const s of [-1, 1]) {
    const m = new THREE.Mesh(cloudGeometry(40 + s, w * 5), cloudMat);
    m.position.set(s * (half - w * 4), w * 1.2, 0);
    m.raycast = () => {};
    root.add(m);
    puffs.push(m);
  }

  // 沿着彩虹滑过的小星星
  let spark = null;
  const SPN = 9;
  const spPos = new Float32Array(SPN * 3);
  if (sparkles) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(spPos, 3));
    spark = new THREE.Points(g, new THREE.PointsMaterial({ size: w * 3.2, map: textures().sparkle, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xfff6d8 }));
    spark.frustumCulled = false;
    spark.raycast = () => {};
    root.add(spark);
  }

  let on = false, k = 0, rev = 0, last = null;
  root.visible = false;
  return {
    root,
    setVisible(v) { on = !!v; },
    update(t) {
      const dt = last == null ? 0 : Math.min(0.1, Math.max(0, t - last));
      last = t;
      k = toward(k, on ? 1 : 0, dt);
      rev = on ? Math.min(1, rev + dt / 1.3) : (k <= 0 ? 0 : rev);
      root.visible = k > 0.002;
      if (!root.visible) return;
      const o = smooth(k);
      mat.opacity = o * 0.88;
      reveal.value = smooth(rev) * 1.001;
      cloudMat.opacity = o;
      puffs.forEach((p, i) => { const s = 0.4 + 0.6 * easeOutBack(o); p.scale.setScalar(s * (1 + Math.sin(t * 1.2 + i * 2) * 0.03)); });
      if (spark) {
        spark.material.opacity = o * (0.6 + 0.4 * Math.sin(t * 5) ** 2);
        for (let i = 0; i < SPN; i++) {
          const u = ((t * 0.09 + i / SPN) % 1) * reveal.value;
          const band = i % 6, a = half - band * w * 1.75, h = height - band * w * 1.75, th = Math.PI * (1 - u);
          spPos.set([a * Math.cos(th), h * Math.sin(th) + Math.sin(t * 3 + i) * w * 0.4, w * 0.8], i * 3);
        }
        spark.geometry.attributes.position.needsUpdate = true;
      }
    },
  };
}

/* ================================================================ CITY LIGHTS */
// 小岛顶上的一小撮房子 + 路灯；setNight(k) 把窗户和灯一起点亮（k: 0 → 1）。根节点的 y=0 就是地面。
export function buildCityLights({ count = 8, radius = 1.5, toon, seed = 3 } = {}) {
  const R = rng(seed * 313 + 1);
  const root = new THREE.Group();
  root.name = "cityLights";
  const mkToon = toon || ((c, e = {}) => new THREE.MeshToonMaterial({ color: c, ...e }));
  const u = Math.min(2, Math.max(0.35, radius / 2)) * 0.22; // 一栋小房子的宽
  // 撒点：互相别挤
  const spots = [];
  for (let tries = 0; spots.length < count && tries < 400; tries++) {
    const a = R() * Math.PI * 2, r = Math.sqrt(R()) * radius * 0.85;
    const p = new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r);
    if (spots.every((q) => q.distanceTo(p) > u * 1.5)) spots.push(p);
  }
  const WALL = [0xfff1dc, 0xffd9e4, 0xd8f3e6, 0xe4dcff, 0xfff6c9];
  const ROOF = [0xff8f8f, 0x8fb8ff, 0xffb36b, 0xc49bff, 0x7fcfa8];
  const parts = { walls: [], roofs: [], lit: [] };
  const glowPts = [];
  const add = (list, geo, color, m) => { geo.applyMatrix4(m); const n = geo.attributes.position.count, a = new Float32Array(n * 3), c = new THREE.Color(color); for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3); geo.setAttribute("color", new THREE.BufferAttribute(a, 3)); for (const k of Object.keys(geo.attributes)) if (!["position", "normal", "color"].includes(k)) geo.deleteAttribute(k); list.push(geo.index ? geo.toNonIndexed() : geo); };
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), Y = new V3(0, 1, 0);
  const at = (x, y, z, ry = 0, s = new V3(1, 1, 1)) => M.clone().compose(new V3(x, y, z), Q.clone().setFromAxisAngle(Y, ry), s);
  spots.forEach((p, i) => {
    const ry = Math.atan2(p.x, p.y) + (R() - 0.5) * 0.6; // 大致朝外
    const lamp = i % 3 === 2;
    if (lamp) {
      // 小路灯：细柱子 + 圆灯泡
      const h = u * 1.3;
      add(parts.walls, new THREE.CylinderGeometry(u * 0.05, u * 0.07, h, 6), 0x8a6a5a, at(p.x, h / 2, p.y));
      add(parts.lit, new THREE.SphereGeometry(u * 0.17, 10, 8), 0xffffff, at(p.x, h + u * 0.08, p.y));
      glowPts.push(p.x, h + u * 0.08, p.y);
      return;
    }
    const w = u * (0.8 + R() * 0.4), d = w * (0.8 + R() * 0.3), h = u * (0.7 + R() * 0.6);
    add(parts.walls, new THREE.BoxGeometry(w, h, d), WALL[i % WALL.length], at(p.x, h / 2, p.y, ry));
    const roof = new THREE.ConeGeometry(1, 1, 4);
    add(parts.roofs, roof, ROOF[(i * 3) % ROOF.length], at(p.x, h + u * 0.28, p.y, ry + Math.PI / 4, new V3(Math.max(w, d) * 0.78, u * 0.56, Math.max(w, d) * 0.78)));
    // 窗户：前面两扇、其余三面各一扇
    const win = (lx, ly, lz, rot) => {
      const g = new THREE.PlaneGeometry(u * 0.24, u * 0.28);
      const local = new THREE.Matrix4().compose(new V3(lx, ly, lz), new THREE.Quaternion().setFromAxisAngle(Y, rot), new V3(1, 1, 1));
      add(parts.lit, g, 0xffffff, at(p.x, 0, p.y, ry).multiply(local));
    };
    const wy = h * 0.55;
    win(-w * 0.22, wy, d / 2 + 0.002, 0); win(w * 0.22, wy, d / 2 + 0.002, 0);
    win(0, wy, -d / 2 - 0.002, Math.PI);
    win(w / 2 + 0.002, wy, 0, Math.PI / 2); win(-w / 2 - 0.002, wy, 0, -Math.PI / 2);
    const fwd = new V3(Math.sin(ry), 0, Math.cos(ry));
    glowPts.push(p.x + fwd.x * d * 0.55, wy, p.y + fwd.z * d * 0.55);
  });
  const merge = (list) => {
    const g = new THREE.BufferGeometry();
    let n = 0; for (const x of list) n += x.attributes.position.count;
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
    let o = 0;
    for (const x of list) { pos.set(x.attributes.position.array, o * 3); nor.set(x.attributes.normal.array, o * 3); col.set(x.attributes.color.array, o * 3); o += x.attributes.position.count; }
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    return g;
  };
  const walls = new THREE.Mesh(merge(parts.walls), mkToon(0xffffff, { vertexColors: true }));
  const roofs = new THREE.Mesh(merge(parts.roofs), mkToon(0xffffff, { vertexColors: true }));
  walls.castShadow = roofs.castShadow = true;
  const DAY = new THREE.Color(0x7d8299), NIGHT = new THREE.Color(0xffd27a);
  const litMat = new THREE.MeshBasicMaterial({ color: DAY.clone(), side: THREE.DoubleSide });
  const lit = new THREE.Mesh(merge(parts.lit), litMat);
  const gGeo = new THREE.BufferGeometry();
  gGeo.setAttribute("position", new THREE.Float32BufferAttribute(glowPts, 3));
  const glowMat = new THREE.PointsMaterial({ size: u * 3, map: textures().glow, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  const glow = new THREE.Points(gGeo, glowMat);
  glow.visible = false;
  for (const o of [walls, roofs, lit, glow]) { o.raycast = () => {}; root.add(o); }

  function setNight(k) {
    k = Math.min(1, Math.max(0, k));
    litMat.color.copy(DAY).lerp(NIGHT, k);
    glowMat.opacity = k * 0.9;
    glow.visible = k > 0.01;
  }
  setNight(0);
  return { root, setNight };
}
