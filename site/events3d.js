// 小岛随机事件的画面层：台风 / 偷东西的鹦鹉 / 流星雨 / 大退潮 / 鲸鱼路过，外加航海发现的三座远岛（樱花岛 / 雪岛 / 火山岛）。
// 这里只管"看得见的东西 + 点击目标"，游戏逻辑由集成方（scene3d.js / social.js）负责。全部程序生成，没有外部素材。
//
//   const ev = createEvents({ scene, world, toon, outlined, heightAt, camera, SEA_Y, DOCK });
//   ev.start("typhoon"); ev.update(t, dt) 每帧调用；ev.pick(raycaster) → { kind, target, index } | null
//   world = scene3d 里的 world 组（THREE.Group，事件的东西都挂在它下面）；传 createWorld 的返回值也行（会挂到 env.parent）。
//   没有事件时：所有东西都从场景里摘掉（0 次绘制），update() 直接返回。
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { POOL } from "./island3d.js?v=16";
import { HOME, glowSprite } from "./home3d.js?v=16";

const REDUCED = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const ISLE_SEA_Y = -0.85;

/* ================================================================ 小工具 */
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const _c = new THREE.Color();
const noRay = () => {};
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const easeOut = (x) => 1 - Math.pow(1 - clamp01(x), 3);
const wrap = (d) => ((((d + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;
const angDist = (a, b) => Math.abs(((a - b + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
function mulberry(a) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// 一个零件：变换 + 烤进顶点色（只留 position / normal / color，方便 mergeGeometries）
// color 可以是 hex，或 (x, y, z, ny) => hex（用零件自己坐标系里的位置 / 法线）
function part(geo, color, p = [0, 0, 0], r = [0, 0, 0], s = 1) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  for (const k of Object.keys(g.attributes)) if (k !== "position" && k !== "normal") g.deleteAttribute(k);
  if (!g.attributes.normal) g.computeVertexNormals();
  const pos = g.attributes.position, nrm = g.attributes.normal, n = pos.count, col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    _c.setHex(typeof color === "function" ? color(pos.getX(i), pos.getY(i), pos.getZ(i), nrm.getY(i)) : color);
    col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b;
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  if (typeof s === "number") _s.set(s, s, s); else _s.set(s[0], s[1], s[2]);
  g.applyMatrix4(_m4.compose(_p.set(p[0], p[1], p[2]), _q.setFromEuler(_e.set(r[0], r[1], r[2])), _s));
  return g;
}
const merge = (list) => mergeGeometries(list, false);

// 顶点色卡通材质：每个 toon 函数一份（同一个 scene 共用）
const VC = new WeakMap();
function vcMat(toon) {
  if (!VC.has(toon)) VC.set(toon, toon(0xffffff, { vertexColors: true }));
  return VC.get(toon);
}
// InstancedMesh 的描边：和 outlined() 同一个外壳材质，但按实例画（共用 instanceMatrix）
function outlineInstanced(im, outlined, th) {
  const tmp = outlined(new THREE.Mesh(im.geometry), th);
  const o = tmp.children[0];
  const oi = new THREE.InstancedMesh(o.geometry, o.material, im.count);
  oi.instanceMatrix = im.instanceMatrix;
  oi.raycast = noRay;
  oi.frustumCulled = false;
  im.add(oi);
  im.userData.outline = oi;
  return im;
}
function setInstCount(im, n) { im.count = n; if (im.userData.outline) im.userData.outline.count = n; }

// 画布贴图（emoji、"!"、"嘎！"），按 key 缓存
const TEX = new Map();
function canvasTex(key, w, h, draw) {
  if (TEX.has(key)) return TEX.get(key);
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  TEX.set(key, t);
  return t;
}
const emojiTex = (e) => canvasTex("emoji:" + e, 128, 128, (g) => {
  g.font = "92px 'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji',sans-serif";
  g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(e, 64, 70);
});
const alertTex = () => canvasTex("alert", 128, 128, (g) => {
  g.fillStyle = "rgba(74,47,37,0.35)"; g.beginPath(); g.arc(66, 70, 52, 0, Math.PI * 2); g.fill();
  g.fillStyle = "#ffcf3f"; g.strokeStyle = "#ffffff"; g.lineWidth = 9;
  g.beginPath(); g.arc(64, 64, 50, 0, Math.PI * 2); g.fill(); g.stroke();
  g.fillStyle = "#6b3a23"; g.font = "900 78px ui-rounded, system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText("!", 64, 68);
});
const wordTex = (s, color) => canvasTex("word:" + s + color, 192, 96, (g) => {
  g.font = "900 64px ui-rounded, 'PingFang SC', system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
  g.lineWidth = 12; g.strokeStyle = "#ffffff"; g.lineJoin = "round"; g.strokeText(s, 96, 50);
  g.fillStyle = color; g.fillText(s, 96, 50);
});
function sprite(tex, size, { depthTest = true, order = 0 } = {}) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest }));
  s.scale.setScalar(size);
  s.renderOrder = order;
  s.raycast = noRay;
  return s;
}

// 点精灵（一次绘制画很多颗）：大小按世界单位，颜色带透明度；star = 十字星芒的强度
function makeSparks(max, { additive = false, star = 0, order = 0 } = {}) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(max * 3), size = new Float32Array(max), col = new Float32Array(max * 4);
  const aPos = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
  const aSize = new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage);
  const aCol = new THREE.BufferAttribute(col, 4).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute("position", aPos); geo.setAttribute("aSize", aSize); geo.setAttribute("aCol", aCol);
  geo.setDrawRange(0, 0);
  const u = { uScale: { value: 500 }, uStar: { value: star } };
  const mat = new THREE.ShaderMaterial({
    uniforms: u, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    vertexShader: `attribute float aSize; attribute vec4 aCol; uniform float uScale; varying vec4 vC;
      void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vC = aCol;
        gl_PointSize = aSize * uScale / max(0.2, -mv.z); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uStar; varying vec4 vC;
      void main(){ vec2 p = gl_PointCoord - 0.5; float d = length(p);
        float a = smoothstep(0.5, 0.0, d); a *= a;
        float s = max(0.0, 1.0 - abs(p.x) * 16.0) * max(0.0, 1.0 - abs(p.y) * 2.1) + max(0.0, 1.0 - abs(p.y) * 16.0) * max(0.0, 1.0 - abs(p.x) * 2.1);
        a = max(a, s * uStar);
        if (a < 0.01) discard;
        gl_FragColor = vec4(vC.rgb, vC.a * a); }`,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false; pts.raycast = noRay; pts.renderOrder = order;
  const v2 = new THREE.Vector2();
  pts.onBeforeRender = (r, s, cam) => { r.getDrawingBufferSize(v2); u.uScale.value = (v2.y * 0.5) / Math.tan(THREE.MathUtils.degToRad(cam.fov || 32) * 0.5); };
  let n = 0;
  return {
    obj: pts,
    begin() { n = 0; },
    push(x, y, z, sz, hex, a) {
      if (n >= max) return;
      pos[n * 3] = x; pos[n * 3 + 1] = y; pos[n * 3 + 2] = z; size[n] = sz;
      // ShaderMaterial 不做色彩空间转换：直接用 sRGB 数值
      col[n * 4] = ((hex >> 16) & 255) / 255; col[n * 4 + 1] = ((hex >> 8) & 255) / 255; col[n * 4 + 2] = (hex & 255) / 255; col[n * 4 + 3] = a;
      n++;
    },
    end() { geo.setDrawRange(0, n); aPos.needsUpdate = aSize.needsUpdate = aCol.needsUpdate = true; pts.visible = n > 0; },
  };
}

// 一次性的小爆炸（贴贝壳、碎片、扶好东西、羽毛）：所有事件共用一套粒子
function makeBurst() {
  const MAX = REDUCED ? 40 : 90;
  const sp = makeSparks(MAX, { star: 0.55, order: 3 });
  const list = [];
  return {
    obj: sp.obj,
    emit(x, y, z, colors, n = 12, speed = 1.6, up = 1.2, size = 0.16) {
      if (REDUCED) n = Math.ceil(n / 2);
      for (let i = 0; i < n; i++) {
        if (list.length >= MAX) list.shift();
        const a = Math.random() * Math.PI * 2, v = speed * (0.45 + Math.random() * 0.55);
        list.push({ x, y, z, vx: Math.cos(a) * v, vy: up * (0.6 + Math.random() * 0.8), vz: Math.sin(a) * v, age: 0, life: 0.55 + Math.random() * 0.4, hex: colors[i % colors.length], size: size * (0.7 + Math.random() * 0.6) });
      }
    },
    update(dt) {
      sp.begin();
      for (let i = list.length - 1; i >= 0; i--) {
        const p = list[i];
        p.age += dt;
        if (p.age >= p.life) { list.splice(i, 1); continue; }
        p.vy -= 4.2 * dt; p.vx *= 1 - 1.8 * dt; p.vz *= 1 - 1.8 * dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        const k = p.age / p.life;
        sp.push(p.x, p.y, p.z, p.size * (1 - k * 0.5), p.hex, 1 - k * k);
      }
      sp.end();
    },
    clear() { list.length = 0; sp.begin(); sp.end(); },
  };
}

// 挂在镜头上的东西：每次画之前把世界矩阵换成 镜头矩阵 × 自己的局部矩阵（不会比镜头慢一帧）
function camAnchor(obj) {
  obj.frustumCulled = false;
  obj.onBeforeRender = (r, s, cam) => { obj.matrixWorld.multiplyMatrices(cam.matrixWorld, obj.matrix); };
  return obj;
}

/* ================================================================ 事件 */
export function createEvents({ scene, world, toon, outlined, heightAt, camera, SEA_Y = ISLE_SEA_Y, DOCK }) {
  const parent = world && world.isObject3D ? world : (world && world.env && world.env.parent) || scene;
  const vc = vcMat(toon);
  const mk = (geo, line = 0.012) => { const m = outlined(new THREE.Mesh(geo, vc), line); m.raycast = noRay; return m; };
  const burst = makeBurst();
  const DIR = DOCK.dir.clone().setY(0).normalize();
  const PERP = new THREE.Vector3(DIR.z, 0, -DIR.x); // 码头的右手边（默认镜头看过去是 +x 那侧）
  const DOCK_A = Math.atan2(DIR.z, DIR.x);
  const DOCK_RY = Math.atan2(DIR.x, DIR.z);

  // 海岸线半径表（按角度），退潮、碎片落点用；第一次用到才算
  let shore = null;
  const SHORE_N = 160;
  function shoreTable() {
    if (shore) return shore;
    shore = new Float32Array(SHORE_N);
    for (let i = 0; i < SHORE_N; i++) {
      const a = (i / SHORE_N) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      let r = 8;
      while (r > 1 && heightAt(ca * r, sa * r) <= SEA_Y) r -= 0.12;
      let lo = r, hi = r + 0.12;
      for (let k = 0; k < 8; k++) { const m = (lo + hi) / 2; if (heightAt(ca * m, sa * m) > SEA_Y) lo = m; else hi = m; }
      shore[i] = lo;
    }
    return shore;
  }
  function shoreR(a) {
    const t = shoreTable(), f = (((a / (Math.PI * 2)) % 1) + 1) % 1 * SHORE_N, i = Math.floor(f), k = f - i;
    return t[i % SHORE_N] * (1 - k) + t[(i + 1) % SHORE_N] * k;
  }
  // 草地上一块空地（避开水潭、树、床、小伙伴的家）
  const AVOID = [[POOL.x, POOL.z, 1.0], [1.95, -1.25, 0.8], [-1.55, -0.85, 1.15], [0.35, 0.75, 0.6]];
  function meadowSpot(rng) {
    for (let k = 0; k < 80; k++) {
      const x = -3.6 + rng() * 7.4, z = -3.2 + rng() * 6.6;
      if (Math.hypot(x, z) > 3.7 || Math.abs(heightAt(x, z)) > 0.004) continue;
      if (AVOID.some(([ax, az, r]) => Math.hypot(x - ax, z - az) < r)) continue;
      return new THREE.Vector3(x, 0, z);
    }
    return new THREE.Vector3(0.9 * rng(), 0, 1.6);
  }
  // 沙滩上一块平的沙子（避开码头）
  function beachSpot(rng) {
    for (let k = 0; k < 80; k++) {
      const a = rng() * Math.PI * 2;
      if (angDist(a, DOCK_A) < 0.28) continue;
      const r = shoreR(a) - 0.25 - rng() * 0.45, x = Math.cos(a) * r, z = Math.sin(a) * r, y = heightAt(x, z);
      if (y < SEA_Y + 0.02 || y > SEA_Y + 0.24) continue;
      if (Math.abs(heightAt(x + 0.12, z) - y) > 0.05 || Math.abs(heightAt(x, z + 0.12) - y) > 0.05) continue;
      return new THREE.Vector3(x, y, z);
    }
    return null;
  }

  const mods = {};
  let cur = null, T = 0;
  const api = { skyDim: 0 };
  let dimTarget = 0;

  /* ------------------------------------------------------------ 台风 */
  function buildTyphoon() {
    const root = new THREE.Group();
    const WIND = new THREE.Vector3(-1, 0, -0.35).normalize();
    const SIDE = new THREE.Vector3(-WIND.z, 0, WIND.x);
    const st = { intensity: 1, fade: 0, gustAt: 3, gust: 0, gustT0: -9, travel: 0 };

    // 雨：一个实例化的细长四边形，位置全在顶点着色器里算（CPU 每帧只改两个 uniform）
    const NRAIN = REDUCED ? 240 : 900;
    const quad = new THREE.PlaneGeometry(1, 1);
    const rainGeo = new THREE.InstancedBufferGeometry();
    rainGeo.index = quad.index; rainGeo.setAttribute("position", quad.attributes.position);
    const seeds = new Float32Array(NRAIN * 4), rr = mulberry(7);
    for (let i = 0; i < NRAIN; i++) {
      let x, z;
      do { x = rr() * 2 - 1; z = rr() * 2 - 1; } while (x * x + z * z > 1);
      seeds.set([x, z, rr(), 0.6 + rr() * 0.6], i * 4);
    }
    rainGeo.setAttribute("seed", new THREE.InstancedBufferAttribute(seeds, 4));
    rainGeo.instanceCount = NRAIN;
    const rainU = { uT: { value: 0 }, uWind: { value: new THREE.Vector3() }, uA: { value: 0 }, uCol: { value: new THREE.Color(0xe6f2ff) } };
    const rain = new THREE.Mesh(rainGeo, new THREE.ShaderMaterial({
      uniforms: rainU, transparent: true, depthWrite: false,
      vertexShader: `attribute vec4 seed; uniform float uT; uniform vec3 uWind; uniform float uA; varying float vA;
        void main(){
          float H = 8.2, B = ${SEA_Y.toFixed(2)};
          float k = fract(seed.z - uT * 10.5 / H);
          vec3 c = vec3(seed.x * 8.5 + uWind.x * H * (k - 0.5), B + k * H, seed.y * 8.5 + uWind.z * H * (k - 0.5));
          vec3 dir = normalize(vec3(-uWind.x, -1.0, -uWind.z));
          vec4 wc = modelMatrix * vec4(c, 1.0);
          vec3 side = normalize(cross(dir, normalize(cameraPosition - wc.xyz)));
          vec3 wp = wc.xyz + dir * position.y * seed.w * 0.62 + side * position.x * 0.024;
          vA = (position.y + 0.5) * smoothstep(0.0, 0.06, k) * smoothstep(1.0, 0.9, k) * uA;
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        }`,
      fragmentShader: `uniform vec3 uCol; varying float vA; void main(){ gl_FragColor = vec4(uCol, vA * 0.62); }`,
    }));
    rain.frustumCulled = false; rain.raycast = noRay; rain.renderOrder = 2;
    root.add(rain);

    // 雨点打在海面 / 草地上的小圈（同样全在着色器里）
    const NRIP = REDUCED ? 24 : 70;
    const ripQuad = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const ripGeo = new THREE.InstancedBufferGeometry();
    ripGeo.index = ripQuad.index; ripGeo.setAttribute("position", ripQuad.attributes.position); ripGeo.setAttribute("uv", ripQuad.attributes.uv);
    const rp = new Float32Array(NRIP * 4);
    for (let i = 0, k = 0; i < NRIP && k < 4000; k++) {
      const a = rr() * Math.PI * 2, r = Math.sqrt(rr()) * 8.5, x = Math.cos(a) * r, z = Math.sin(a) * r, h = heightAt(x, z);
      let y;
      if (h < SEA_Y - 0.03) y = SEA_Y + 0.02;
      else if (Math.abs(h) < 0.003 && r < 3.6) y = 0.015;
      else continue;
      rp.set([x, y, z, rr()], i * 4); i++;
    }
    ripGeo.setAttribute("rp", new THREE.InstancedBufferAttribute(rp, 4));
    ripGeo.instanceCount = NRIP;
    const ripU = { uT: { value: 0 }, uA: { value: 0 } };
    const ripples = new THREE.Mesh(ripGeo, new THREE.ShaderMaterial({
      uniforms: ripU, transparent: true, depthWrite: false,
      vertexShader: `attribute vec4 rp; uniform float uT; varying vec2 vUv; varying float vK;
        void main(){ float k = fract(uT * 1.25 + rp.w * 7.0); vK = k; vUv = uv;
          vec3 p = rp.xyz + position * (0.06 + k * 0.42);
          gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(p, 1.0); }`,
      fragmentShader: `uniform float uA; varying vec2 vUv; varying float vK;
        void main(){ float d = length(vUv - 0.5) * 2.0;
          float ring = smoothstep(0.62, 0.8, d) * (1.0 - smoothstep(0.86, 1.0, d));
          float a = ring * (1.0 - vK) * uA * 0.75; if (a < 0.01) discard;
          gl_FragColor = vec4(1.0, 1.0, 1.0, a); }`,
    }));
    ripples.frustumCulled = false; ripples.raycast = noRay; ripples.renderOrder = 2;
    root.add(ripples);

    // 被风卷着跑的叶子
    const NLEAF = REDUCED ? 10 : 28;
    const leafGeo = new THREE.SphereGeometry(0.1, 6, 4).scale(1, 0.22, 0.55);
    const leaves = new THREE.InstancedMesh(leafGeo, toon(0xffffff, { side: THREE.DoubleSide }), NLEAF);
    const LC = [0x5fae5f, 0x7fc66a, 0x9ad35f, 0xf2b84b, 0xe8874b];
    const leafSeed = [];
    for (let i = 0; i < NLEAF; i++) {
      leaves.setColorAt(i, _c.setHex(LC[i % LC.length]));
      leafSeed.push({ lane: (rr() * 2 - 1) * 4.5, h: 0.3 + rr() * 2.4, sp: 0.7 + rr() * 0.6, ph: rr(), w: rr() * 6 });
    }
    leaves.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    leaves.frustumCulled = false; leaves.raycast = noRay;
    root.add(leaves);

    // 阵风：屏幕上划过几道白色的"风线"（尾巴卷一个圈），挂在镜头上
    const swGeo = (() => {
      const pts = [], N = 48;
      for (let i = 0; i <= N; i++) {
        const u = i / N;
        if (u < 0.7) pts.push([-1.3 + (u / 0.7) * 1.9, Math.sin(u * 7) * 0.03]);
        else { const a = -Math.PI / 2 + ((u - 0.7) / 0.3) * Math.PI * 1.6; pts.push([0.6 + Math.cos(a) * 0.17, 0.17 + Math.sin(a) * 0.17]); }
      }
      const pos = [], uvs = [], idx = [];
      pts.forEach(([x, y], i) => {
        const [x2, y2] = pts[Math.min(N, i + 1)], [x0, y0] = pts[Math.max(0, i - 1)];
        let tx = x2 - x0, ty = y2 - y0; const L = Math.hypot(tx, ty) || 1; tx /= L; ty /= L;
        const w = 0.022 * Math.sin(Math.PI * Math.min(1, (i / N) * 1.15 + 0.05));
        pos.push(x - ty * w, y + tx * w, 0, x + ty * w, y - tx * w, 0);
        uvs.push(i / N, 0, i / N, 1);
        if (i < N) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      });
      const g = new THREE.InstancedBufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
      g.setIndex(idx);
      return g;
    })();
    const NSW = 3;
    const swInst = new Float32Array(NSW * 4), swProg = new Float32Array(NSW);
    const swAttr = new THREE.InstancedBufferAttribute(swInst, 4).setUsage(THREE.DynamicDrawUsage);
    const swPAttr = new THREE.InstancedBufferAttribute(swProg, 1).setUsage(THREE.DynamicDrawUsage);
    swGeo.setAttribute("inst", swAttr); swGeo.setAttribute("prog", swPAttr);
    swGeo.instanceCount = NSW;
    const swoosh = camAnchor(new THREE.Mesh(swGeo, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, depthTest: false,
      vertexShader: `attribute vec4 inst; attribute float prog; varying float vU; varying float vP;
        void main(){ vU = uv.x; vP = prog;
          float c = cos(inst.w), s = sin(inst.w);
          vec2 p = position.xy * inst.z; p = vec2(p.x * c - p.y * s, p.x * s + p.y * c);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p + inst.xy, -6.0, 1.0); }`,
      fragmentShader: `varying float vU; varying float vP;
        void main(){ float a = smoothstep(vP - 0.55, vP - 0.2, vU) * step(vU, vP) * smoothstep(1.35, 1.0, vP);
          if (a < 0.01) discard; gl_FragColor = vec4(1.0, 1.0, 1.0, a * 0.9); }`,
    })));
    swoosh.renderOrder = 40; swoosh.raycast = noRay;
    root.add(swoosh);

    // 天色：屏幕上半部压一层阴沉的灰蓝（远处的海 / 天边像要下暴雨），挂在镜头上
    const dimU = { uA: { value: 0 } };
    const overlay = camAnchor(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      uniforms: dimU, transparent: true, depthWrite: false, depthTest: false,
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: `uniform float uA; varying vec2 vUv;
        void main(){ float a = uA * (0.1 + 0.42 * smoothstep(0.5, 1.0, vUv.y) + 0.12 * smoothstep(0.55, 0.0, vUv.y) * abs(vUv.x - 0.5) * 2.0);
          gl_FragColor = vec4(0.2, 0.25, 0.33, a); }`,
    })));
    overlay.renderOrder = 30; overlay.raycast = noRay;
    root.add(overlay);

    // 三个要加固的地方：小木屋正面窗户上一块被风吹得哐哐拍的松木板（窗板）、码头上盖着油布的木箱、规律树旁边盖着油布的柴堆
    // 小木屋那个点的原点 = 窗户正前方的地面（房子坐标 (0.22, 0, 0.62)），朝向和房子一样
    const homeY = heightAt(HOME.x, HOME.z) - 0.02;
    const cottageP = new THREE.Vector3(0.22 * HOME.s, 0, 0.62 * HOME.s).applyAxisAngle(new THREE.Vector3(0, 1, 0), HOME.rotY).add(new THREE.Vector3(HOME.x, homeY, HOME.z));
    const dockP = DOCK.base.clone().addScaledVector(DIR, 1.45).addScaledVector(PERP, -0.08); dockP.y = 0.02;
    const treeP = new THREE.Vector3(2.62, 0, -0.42);
    const SPOTS = [
      { name: "cottage", p: cottageP, ry: HOME.rotY, type: "plank", s: 1, tap: [0, 0.38, -0.12] },
      { name: "dock", p: dockP, ry: DOCK_RY + 0.3, type: "tarp", tarp: 0x6aa9e9, s: 1.3, tap: [0, 0.2, 0] },
      { name: "tree", p: treeP, ry: 0.5, type: "tarp", tarp: 0xf2b84b, s: 1.3, tap: [0, 0.2, 0] },
    ];
    const WOOD = 0xc99a6b, WOOD_DK = 0xa8784e, ROPE = 0x8b6a4a, SAND = 0xdcc290, SAND_DK = 0xc7aa75;
    const sandbag = (x, z, ry, y = 0) => [
      part(new THREE.CapsuleGeometry(0.055, 0.12, 4, 8), SAND, [x, y + 0.04, z], [0, ry, Math.PI / 2], [1, 0.62, 1]),
      part(new THREE.SphereGeometry(0.022, 6, 4), SAND_DK, [x + Math.cos(ry) * 0.12, y + 0.05, z - Math.sin(ry) * 0.12]),
    ];
    const WIN_Y = 0.48 * HOME.s, WIN_Z = (0.44 - 0.62) * HOME.s, WIN_W = 0.27 * HOME.s; // 窗户中心（在这个点的坐标里）
    const spots = SPOTS.map((S, i) => {
      const g = new THREE.Group();
      g.position.copy(S.p); g.rotation.y = S.ry;
      root.add(g);
      const inner = new THREE.Group();
      inner.scale.setScalar(S.s);
      g.add(inner);
      let base, flap, flapMesh, braced, markerY;
      if (S.type === "plank") {
        // 墙根一小摞木板 + 窗户上一块只钉住一边、被风吹得一开一合的窗板（铰链在窗户右边）
        const pile = [
          part(new THREE.BoxGeometry(0.34, 0.03, 0.09), WOOD, [0.28, 0.015, -0.02], [0, 0.25, 0]),
          part(new THREE.BoxGeometry(0.32, 0.03, 0.09), WOOD_DK, [0.27, 0.045, -0.03], [0, -0.1, 0]),
        ];
        base = mk(merge(pile), 0.008);
        flap = new THREE.Group();
        flap.position.set(WIN_W / 2, WIN_Y, WIN_Z + 0.02);
        const board = (dx) => [
          part(new THREE.BoxGeometry(WIN_W, WIN_W * 0.46, 0.022), WOOD, [dx - WIN_W / 2, WIN_W * 0.24, 0]),
          part(new THREE.BoxGeometry(WIN_W, WIN_W * 0.46, 0.022), WOOD_DK, [dx - WIN_W / 2, -WIN_W * 0.24, 0]),
          part(new THREE.BoxGeometry(0.03, WIN_W * 0.95, 0.03), 0x8a6040, [dx - 0.02, 0, 0.012]),
        ];
        flapMesh = mk(merge(board(0)), 0.008);
        flap.add(flapMesh);
        braced = mk(merge([
          ...pile.slice(0, 1),
          ...board(WIN_W / 2).map((gg) => gg.translate(0, WIN_Y, WIN_Z + 0.02)),
          part(new THREE.BoxGeometry(WIN_W * 1.45, 0.045, 0.025), WOOD_DK, [0, WIN_Y, WIN_Z + 0.045], [0, 0, 0.62]),
          part(new THREE.BoxGeometry(WIN_W * 1.45, 0.045, 0.025), WOOD_DK, [0, WIN_Y, WIN_Z + 0.05], [0, 0, -0.62]),
          ...[[-0.6, 0.6], [0.6, 0.6], [-0.6, -0.6], [0.6, -0.6]].map(([sx, sy]) => part(new THREE.SphereGeometry(0.012, 6, 4), 0x6b6b6b, [sx * WIN_W * 0.5, WIN_Y + sy * WIN_W * 0.38, WIN_Z + 0.065])),
          ...sandbag(-0.14, 0.02, 0.1), ...sandbag(0.12, 0.04, -0.15), ...sandbag(-0.01, 0.03, 0.05, 0.065),
        ]), 0.008);
        markerY = 0.98;
      } else {
        // 木箱（柴堆）+ 一角被风掀起来、呼啦啦拍的油布（铰点在后边）
        const crate = S.name === "tree"
          ? [0, 1, 2].flatMap((k) => [part(new THREE.CylinderGeometry(0.06, 0.06, 0.42, 8), k % 2 ? WOOD_DK : WOOD, [-0.14 + k * 0.13, 0.06, 0], [Math.PI / 2, 0, 0]),
            part(new THREE.CylinderGeometry(0.06, 0.06, 0.42, 8), k % 2 ? WOOD : WOOD_DK, [-0.08 + k * 0.13, 0.17, 0], [Math.PI / 2, 0, 0])].slice(0, k === 2 ? 1 : 2))
          : [part(new THREE.BoxGeometry(0.34, 0.26, 0.3), WOOD, [0, 0.13, 0]), part(new THREE.BoxGeometry(0.36, 0.03, 0.32), WOOD_DK, [0, 0.2, 0])];
        base = mk(merge([...crate,
          part(new THREE.BoxGeometry(0.4, 0.02, 0.17), S.tarp, [0, S.name === "tree" ? 0.235 : 0.275, -0.08]),
        ]), 0.008);
        flap = new THREE.Group();
        flap.position.set(0, S.name === "tree" ? 0.235 : 0.275, 0.0);
        flapMesh = mk(merge([
          part(new THREE.BoxGeometry(0.42, 0.018, 0.24), S.tarp, [0, 0, 0.12]),
          part(new THREE.BoxGeometry(0.42, 0.02, 0.025), 0xffffff, [0, 0.003, 0.225]),
        ]), 0.008);
        flap.add(flapMesh);
        const topY = S.name === "tree" ? 0.235 : 0.275;
        braced = mk(merge([...crate,
          part(new THREE.BoxGeometry(0.46, 0.022, 0.38), S.tarp, [0, topY + 0.005, 0]),
          part(new THREE.BoxGeometry(0.03, 0.04, 0.4), ROPE, [-0.1, topY + 0.02, 0]),
          part(new THREE.BoxGeometry(0.03, 0.04, 0.4), ROPE, [0.1, topY + 0.02, 0]),
          part(new THREE.BoxGeometry(0.48, 0.04, 0.03), ROPE, [0, topY + 0.02, 0.08]),
          ...sandbag(-0.3, 0.05, 1.4), ...sandbag(0.3, -0.04, 1.7), ...sandbag(0.02, 0.27, 0.1), ...sandbag(-0.05, -0.27, -0.1),
        ]), 0.008);
        markerY = 0.66;
      }
      braced.visible = false;
      inner.add(base, flap, braced);
      const marker = sprite(alertTex(), 0.4, { depthTest: false, order: 60 });
      marker.position.set(0, markerY * S.s, 0);
      g.add(marker);
      return { ...S, g, base, flap, braced, marker, markerY: markerY * S.s, isBraced: false, tBrace: -9, ph: i * 1.7 };
    });
    root.add(burst.obj);

    const tmpW = new THREE.Vector3(), camQ = new THREE.Quaternion(), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), ps = new THREE.Vector3(), sc = new THREE.Vector3();
    function setIntensity(k) { st.intensity = clamp01(k); }
    function setBraced(i, on) {
      const s = spots[i];
      if (!s || s.isBraced === !!on) return;
      s.isBraced = !!on; s.tBrace = T;
      s.base.visible = s.flap.visible = s.marker.visible = !on;
      s.braced.visible = !!on;
      if (on) {
        const w = s.g.localToWorld(tmpW.set(s.tap[0], s.tap[1], s.tap[2]));
        parent.worldToLocal(w);
        burst.emit(w.x, w.y, w.z, [0xfff1c9, 0xe8d3a3, 0xffffff], 14, 1.4, 1.0, 0.18);
      }
    }
    return {
      root, spots, setIntensity, setBraced,
      start() { st.fade = 0; st.gustAt = T + 2.5; st.gust = 0; spots.forEach((s, i) => setBraced(i, false)); st.intensity = 1; },
      stop() {},
      targets() {
        return spots.map((s, i) => ({ target: "spot", index: i, braced: s.isBraced, pos: s.g.localToWorld(new THREE.Vector3(...s.tap)), r: 0.5 }));
      },
      where(target, i) { const s = spots[i]; return s ? s.p.clone().setY(s.p.y + s.markerY) : null; },
      update(T, dt) {
        const K = st.intensity;
        st.fade = Math.min(1, st.fade + dt / 2.2);
        const F = st.fade * K;
        dimTarget = 0.78 * K;
        // 阵风：每隔几秒一阵，持续 ~1.8 秒
        if (T > st.gustAt) { st.gustT0 = T; st.gustAt = T + 4.5 + Math.random() * 4.5; }
        const gk = (T - st.gustT0) / 1.8;
        st.gust = gk >= 0 && gk < 1 ? Math.sin(gk * Math.PI) : 0;
        const wind = (0.55 + 0.45 * K) * (1 + 1.4 * st.gust);
        st.travel += dt * wind;
        // 雨
        rainU.uT.value = T;
        rainU.uA.value = F;
        rainU.uWind.value.copy(WIND).multiplyScalar(-(0.16 + 0.12 * K + 0.22 * st.gust)); // 着色器里是"往 -uWind 方向斜"
        rainGeo.instanceCount = Math.max(1, Math.round(NRAIN * (0.35 + 0.65 * K)));
        ripU.uT.value = T; ripU.uA.value = F;
        dimU.uA.value = st.fade * (0.45 + 0.55 * K);
        // 叶子
        leafSeed.forEach((s, i) => {
          const u = (s.ph + st.travel * s.sp * 0.075) % 1;
          const along = -9 + u * 18;
          ps.copy(WIND).multiplyScalar(along).addScaledVector(SIDE, s.lane + Math.sin(u * 11 + s.w) * 0.5);
          ps.y = s.h + Math.sin(u * 9 + s.w * 2) * 0.45 + Math.sin(T * 3 + i) * 0.08;
          e.set(T * 3.1 + i, T * 2.3 + s.w, T * 4.2 + i * 2);
          const edge = Math.min(1, u / 0.06, (1 - u) / 0.06);
          sc.setScalar(Math.max(0.001, edge * (0.8 + K * 0.4)));
          leaves.setMatrixAt(i, m4.compose(ps, q.setFromEuler(e), sc));
        });
        leaves.count = Math.max(1, Math.round(NLEAF * (0.4 + 0.6 * K)));
        leaves.instanceMatrix.needsUpdate = true;
        // 风线：按风在屏幕上的方向摆
        swoosh.visible = st.gust > 0.02 && !REDUCED;
        if (swoosh.visible) {
          camQ.copy(camera.quaternion).invert();
          tmpW.copy(WIND).applyQuaternion(camQ);
          const ang = Math.atan2(tmpW.y, tmpW.x);
          const hy = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * 6, hx = hy * camera.aspect;
          for (let i = 0; i < NSW; i++) {
            const ox = [-0.35, 0.25, -0.05][i] * hx, oy = [0.35, 0.05, -0.4][i] * hy;
            swInst[i * 4] = ox; swInst[i * 4 + 1] = oy; swInst[i * 4 + 2] = 0.9 + i * 0.25; swInst[i * 4 + 3] = ang;
            swProg[i] = gk * 1.6 - i * 0.12;
          }
          swAttr.needsUpdate = swPAttr.needsUpdate = true;
        }
        // 加固点：油布 / 木板跟着风拍，"!" 一跳一跳
        spots.forEach((s) => {
          if (s.isBraced) {
            const k = (T - s.tBrace) / 0.35;
            s.braced.scale.setScalar(k < 1 ? 1 + Math.sin(k * Math.PI) * 0.18 : 1);
            return;
          }
          const flutter = Math.sin(T * 13 + s.ph) * 0.5 + Math.sin(T * 21 + s.ph * 2) * 0.3;
          const lift = (0.25 + 0.75 * K) * (0.5 + 0.9 * st.gust);
          if (s.type === "plank") s.flap.rotation.y = 0.12 + lift * (0.9 + 0.35 * flutter) * Math.pow(Math.abs(Math.sin(T * 2.4 + s.ph)), 0.6);
          else s.flap.rotation.x = -lift * (0.55 + 0.35 * flutter);
          const p = (T * 1.6 + s.ph) % 1;
          s.marker.scale.setScalar(0.4 * (1 + 0.14 * Math.sin(T * 6 + s.ph)));
          s.marker.position.y = s.markerY + Math.abs(Math.sin(p * Math.PI)) * 0.07;
        });
      },
    };
  }

  /* ------------------------------------------------------------ 鹦鹉 */
  function buildParrot() {
    const root = new THREE.Group();
    const bird = new THREE.Group();
    bird.rotation.order = "YXZ";
    root.add(bird);
    const RED = 0xff5f5f, YEL = 0xffd166, BLUE = 0x4ea8ff, GREEN = 0x6fd28a, IVORY = 0xfff1d0;
    const body = mk(merge([
      part(new THREE.SphereGeometry(0.13, 16, 12), (x, y, z, ny) => (ny < -0.35 && z > -0.06 ? YEL : RED), [0, 0, 0], [0, 0, 0], [0.88, 0.92, 1.12]),
      part(new THREE.SphereGeometry(0.11, 16, 12), RED, [0, 0.1, 0.12]),
      part(new THREE.SphereGeometry(0.042, 10, 8), 0xffffff, [0.062, 0.115, 0.185], [0, 0, 0], [0.55, 1, 1]),
      part(new THREE.SphereGeometry(0.042, 10, 8), 0xffffff, [-0.062, 0.115, 0.185], [0, 0, 0], [0.55, 1, 1]),
      part(new THREE.ConeGeometry(0.048, 0.1, 10), IVORY, [0, 0.08, 0.235], [1.95, 0, 0]),
      part(new THREE.SphereGeometry(0.03, 8, 6), 0x5a4a42, [0, 0.045, 0.215]),
      part(new THREE.ConeGeometry(0.022, 0.1, 6), YEL, [0, 0.215, 0.11], [-0.5, 0, 0]),
      part(new THREE.ConeGeometry(0.02, 0.085, 6), BLUE, [0.025, 0.205, 0.08], [-0.75, 0, -0.3]),
      part(new THREE.ConeGeometry(0.02, 0.085, 6), RED, [-0.025, 0.205, 0.08], [-0.75, 0, 0.3]),
      part(new THREE.ConeGeometry(0.04, 0.3, 6), BLUE, [0, -0.03, -0.27], [-Math.PI / 2 - 0.2, 0, 0], [1, 1, 0.35]),
      part(new THREE.ConeGeometry(0.035, 0.26, 6), RED, [0.035, -0.02, -0.24], [-Math.PI / 2 - 0.15, 0.3, 0], [1, 1, 0.35]),
      part(new THREE.ConeGeometry(0.035, 0.24, 6), YEL, [-0.035, -0.02, -0.23], [-Math.PI / 2 - 0.15, -0.3, 0], [1, 1, 0.35]),
      part(new THREE.SphereGeometry(0.026, 6, 5), 0xc8958a, [0.045, -0.115, 0.03]),
      part(new THREE.SphereGeometry(0.026, 6, 5), 0xc8958a, [-0.045, -0.115, 0.03]),
    ]), 0.011);
    const eyeParts = [];
    for (const s of [-1, 1]) {
      eyeParts.push(part(new THREE.SphereGeometry(0.024, 10, 8), 0x2b2230, [s * 0.075, 0.125, 0.19], [0, 0, 0], [0.55, 1.15, 0.85]));
      eyeParts.push(part(new THREE.SphereGeometry(0.008, 6, 4), 0xffffff, [s * 0.087, 0.137, 0.2]));
      eyeParts.push(part(new THREE.SphereGeometry(0.022, 8, 6), 0xff9fb5, [s * 0.088, 0.08, 0.155], [0, 0, 0], [0.4, 0.7, 1]));
    }
    const eyes = new THREE.Mesh(merge(eyeParts), vc);
    eyes.raycast = noRay;
    const wingGeo = merge([
      part(new THREE.SphereGeometry(0.12, 14, 8), (x) => (x < -0.04 ? RED : x < 0.05 ? YEL : BLUE), [0.13, 0, 0], [0, 0, 0], [1.35, 0.17, 0.72]),
      part(new THREE.SphereGeometry(0.07, 10, 6), GREEN, [0.27, -0.005, -0.03], [0, 0.3, 0], [1.1, 0.16, 0.6]),
    ]);
    const wings = [1, -1].map((s) => {
      const piv = new THREE.Group();
      piv.position.set(s * 0.07, 0.045, 0.0);
      const w = mk(wingGeo, 0.009);
      if (s < 0) w.rotation.y = Math.PI;
      piv.add(w);
      bird.add(piv);
      return piv;
    });
    bird.add(body, eyes);
    bird.scale.setScalar(1.3);
    const carry = sprite(emojiTex("🧦"), 0.34);
    carry.visible = false;
    root.add(carry);
    const squawk = sprite(wordTex("嘎！", "#ff6b4a"), 0.5, { order: 5 });
    squawk.scale.set(0.5, 0.25, 1);
    squawk.visible = false;
    root.add(squawk);
    root.add(burst.obj);

    // 落脚点：规律树顶、小木屋屋脊、码头尽头的小灯笼
    const lanternLocal = new THREE.Vector3(0.3, 0, DOCK.tip.length() - DOCK.base.length() + 0.4).applyAxisAngle(new THREE.Vector3(0, 1, 0), DOCK_RY).add(DOCK.base);
    const ridge = new THREE.Vector3(-0.22 * HOME.s, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), HOME.rotY).add(new THREE.Vector3(HOME.x, 0, HOME.z));
    const PERCH = [
      new THREE.Vector3(1.97, 2.42, -1.25),
      new THREE.Vector3(ridge.x, heightAt(HOME.x, HOME.z) - 0.02 + 1.31 * HOME.s + 0.2, ridge.z),
      new THREE.Vector3(lanternLocal.x, 0.78, lanternLocal.z),
    ];
    const st = { mode: "fly", t0: 0, until: 0, from: new THREE.Vector3(), to: new THREE.Vector3(), ctrl: new THREE.Vector3(), perch: 0, hitT: -9, carry: null,
      drop: null, leaveRes: null, leaveDir: new THREE.Vector3(), a0: 0, heading: 0 };
    const loopPos = (t, out) => {
      const a = st.a0 + t * 0.42, R = 4.4 + 0.55 * Math.sin(t * 0.5);
      return out.set(Math.cos(a) * R, 2.35 + 0.35 * Math.sin(t * 0.9), -0.6 + Math.sin(a) * R);
    };
    const bez = (a, c, b, k, out) => out.copy(a).multiplyScalar((1 - k) * (1 - k)).addScaledVector(c, 2 * k * (1 - k)).addScaledVector(b, k * k);
    const pos = new THREE.Vector3(), prev = new THREE.Vector3(), tmp = new THREE.Vector3(), vel = new THREE.Vector3();

    function setCarry(e, { drop = true } = {}) {
      if (!e && st.carry && drop && carry.visible) {
        st.drop = { p: carry.position.clone(), vy: 0, t0: T, land: -1 };
      } else if (!e) carry.visible = false;
      st.carry = e || null;
      if (e) { carry.material.map = emojiTex(e); carry.material.needsUpdate = true; carry.visible = true; carry.material.opacity = 1; st.drop = null; }
    }
    function hit() {
      st.hitT = T;
      squawk.visible = true;
      const p = bird.position;
      burst.emit(p.x, p.y + 0.1, p.z, [RED, YEL, BLUE, GREEN], 14, 1.8, 1.1, 0.13);
      if (st.mode === "perch" || st.mode === "toPerch") takeoff();
    }
    function takeoff() {
      st.mode = "takeoff"; st.t0 = T; st.until = T + 1.8;
      st.from.copy(bird.position); loopPos(st.until, st.to);
      st.ctrl.copy(st.from).lerp(st.to, 0.5); st.ctrl.y += 1.0;
    }
    function leave() {
      return new Promise((res) => {
        if (cur !== "parrot") { res(); return; }
        st.mode = "leave"; st.t0 = T; st.leaveRes = res;
        st.leaveDir.set(bird.position.x, 0, bird.position.z + 0.6).normalize();
        if (st.leaveDir.lengthSq() < 0.5) st.leaveDir.set(1, 0, 0);
        st.from.copy(bird.position);
      });
    }
    return {
      root, setCarry, hit, leave,
      start() {
        st.a0 = Math.random() * Math.PI * 2;
        st.mode = "enter"; st.t0 = T; st.until = T + 2.4; st.hitT = -9; st.drop = null;
        loopPos(st.until, st.to);
        st.from.copy(st.to).setY(4.5).add(tmp.set(st.to.x, 0, st.to.z).normalize().multiplyScalar(6));
        st.ctrl.copy(st.from).lerp(st.to, 0.6); st.ctrl.y += 0.5;
        bird.position.copy(st.from); prev.copy(st.from);
        setCarry(null, { drop: false });
        squawk.visible = false;
      },
      stop() { if (st.leaveRes) { const r = st.leaveRes; st.leaveRes = null; r(); } },
      targets() { return [{ target: "parrot", index: 0, pos: bird.getWorldPosition(new THREE.Vector3()), r: 0.6 }]; },
      where() { return bird.position.clone().setY(bird.position.y + 0.35); },
      update(T, dt) {
        prev.copy(bird.position);
        let perched = false;
        const m = st.mode;
        if (m === "enter" || m === "takeoff" || m === "toPerch") {
          const k = clamp01((T - st.t0) / (st.until - st.t0));
          bez(st.from, st.ctrl, st.to, m === "toPerch" ? easeOut(k) : k, pos);
          if (k >= 1) {
            if (m === "toPerch") { st.mode = "perch"; st.t0 = T; st.until = T + 3.5 + Math.random() * 2; }
            else { st.mode = "fly"; st.t0 = T; st.until = T + 6 + Math.random() * 4; }
          }
          perched = m === "toPerch" && k > 0.85;
        } else if (m === "fly") {
          loopPos(T, pos);
          if (T > st.until && !st.carry) { // 叼着东西的时候不落脚（一直绕圈，方便点到）
            st.mode = "toPerch"; st.t0 = T; st.until = T + 2.2;
            st.perch = (st.perch + 1 + Math.floor(Math.random() * 2)) % PERCH.length;
            st.from.copy(pos); st.to.copy(PERCH[st.perch]);
            st.ctrl.copy(st.from).lerp(st.to, 0.5); st.ctrl.y = Math.max(st.from.y, st.to.y) + 0.6;
          } else if (T > st.until) st.until = T + 3;
        } else if (m === "perch") {
          pos.copy(PERCH[st.perch]);
          perched = true;
          if (T > st.until) takeoff();
        } else if (m === "leave") {
          const k = (T - st.t0) / 3;
          pos.copy(st.from).addScaledVector(st.leaveDir, k * k * 14 + k * 3);
          pos.y = st.from.y + k * 3.2;
          bird.scale.setScalar(1.3 * (1 - smooth(0.7, 1, k)));
          if (k >= 1) { stopKind("parrot"); return; }
        }
        bird.position.copy(pos);
        // 朝向：飞的时候看速度方向，落脚的时候转向镜头
        vel.subVectors(pos, prev);
        const sp = vel.length() / Math.max(dt, 1e-3);
        if (perched || sp < 0.15) {
          const cw = camera.getWorldPosition(tmp); parent.worldToLocal(cw);
          const want = Math.atan2(cw.x - pos.x, cw.z - pos.z);
          st.heading += ((((want - st.heading + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) - Math.PI) * 0.08;
        } else {
          const want = Math.atan2(vel.x, vel.z);
          st.heading += ((((want - st.heading + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) - Math.PI) * 0.2;
        }
        const hk = (T - st.hitT) / 0.9, hitting = hk >= 0 && hk < 1;
        bird.rotation.y = st.heading;
        bird.rotation.x = perched ? -0.45 + Math.sin(T * 3) * 0.05 : -clamp01(vel.y / Math.max(dt, 1e-3) * 0.3) * 0.4;
        bird.rotation.z = perched ? 0 : 0.28 * Math.sin(T * 0.8);
        if (hitting) { bird.rotation.z += Math.sin(hk * 40) * 0.5 * (1 - hk); bird.position.y += Math.sin(hk * Math.PI) * 0.25; }
        if (st.mode !== "leave") bird.scale.setScalar(1.3 * (hitting ? 1 + Math.sin(hk * Math.PI * 3) * 0.12 * (1 - hk) : 1));
        // 翅膀：飞 = 扇，滑翔 = 平展，落脚 = 收起来贴在身上
        const flapSpeed = hitting ? 34 : 17;
        const glide = !perched && Math.sin(T * 0.7) > 0.55 && st.mode === "fly";
        wings.forEach((w, i) => {
          const s = i ? -1 : 1;
          if (perched && !hitting) { w.rotation.set(0, s * 1.35, -s * 0.15 + s * Math.sin(T * 2) * 0.03); }
          else { w.rotation.set(0, 0, s * (glide ? 0.12 + Math.sin(T * 3) * 0.05 : Math.sin(T * flapSpeed) * 0.85)); }
        });
        // 叼着的东西挂在脚下；放下的东西掉到地上
        if (st.carry) {
          carry.position.copy(bird.position); carry.position.y -= 0.3;
          carry.material.rotation = Math.sin(T * 4) * 0.25;
        }
        if (st.drop) {
          const d = st.drop;
          const gy = Math.max(SEA_Y, heightAt(d.p.x, d.p.z)) + 0.15;
          if (d.land < 0) { d.vy -= 9 * dt; d.p.y += d.vy * dt; if (d.p.y <= gy) { d.p.y = gy; d.land = T; } }
          carry.position.copy(d.p);
          const fk = d.land < 0 ? 0 : (T - d.land) / 1.2;
          carry.material.opacity = 1 - clamp01(fk);
          if (fk >= 1) { carry.visible = false; carry.material.opacity = 1; st.drop = null; }
        }
        squawk.visible = hitting;
        if (hitting) {
          squawk.position.copy(bird.position); squawk.position.y += 0.4 + hk * 0.35;
          squawk.material.opacity = 1 - smooth(0.6, 1, hk);
        }
      },
    };
  }

  /* ------------------------------------------------------------ 流星雨 */
  function buildMeteor() {
    const root = new THREE.Group();
    // 流星：挂在镜头上，在画面上半部（远处的海和天边）划过；一个 InstancedMesh
    const NMET = REDUCED ? 3 : 8;
    const streakTex = canvasTex("streak", 256, 32, (g) => {
      const gr = g.createLinearGradient(0, 0, 256, 0);
      gr.addColorStop(0, "rgba(255,255,255,0)"); gr.addColorStop(0.7, "rgba(255,250,235,0.55)"); gr.addColorStop(1, "rgba(255,255,255,1)");
      g.fillStyle = gr;
      g.beginPath(); g.moveTo(0, 16); g.lineTo(240, 9); g.arc(240, 16, 7, -Math.PI / 2, Math.PI / 2); g.lineTo(0, 16); g.fill();
      const h = g.createRadialGradient(238, 16, 0, 238, 16, 16);
      h.addColorStop(0, "rgba(255,255,255,1)"); h.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = h; g.fillRect(212, 0, 44, 32);
    });
    const metGeo = new THREE.PlaneGeometry(1, 1).translate(-0.5, 0, 0);
    const mets = camAnchor(new THREE.InstancedMesh(metGeo, new THREE.MeshBasicMaterial({ map: streakTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }), NMET));
    mets.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mets.raycast = noRay; mets.renderOrder = 4;
    for (let i = 0; i < NMET; i++) mets.setColorAt(i, _c.setRGB(0, 0, 0));
    root.add(mets);
    const MC = [0xffffff, 0xfff1b8, 0xffd1e8, 0xcfe6ff];
    const met = Array.from({ length: NMET }, () => ({ on: false, t0: 0, dur: 1, x: 0, y: 0, dx: 0, dy: 0, len: 1, col: 0xffffff, big: false }));
    const st = { nextAt: 0, dirA: -2.5 };

    // 星星碎片：落到草地 / 沙滩上，一闪一闪，点了收集
    const MAXF = 12;
    const shape = new THREE.Shape();
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + Math.PI / 2, r = i % 2 ? 0.055 : 0.13;
      if (i) shape.lineTo(Math.cos(a) * r, Math.sin(a) * r); else shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    const starGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.04, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 2 }).translate(0, 0, -0.02);
    const frags = new THREE.InstancedMesh(starGeo, toon(0xffffff, { emissive: 0xffd76a, emissiveIntensity: 0.6 }), MAXF);
    frags.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    frags.frustumCulled = false; frags.raycast = noRay;
    outlineInstanced(frags, outlined, 0.012);
    setInstCount(frags, 0);
    root.add(frags);
    const glow = makeSparks(MAXF * 6, { additive: true, star: 0.8, order: 4 });
    root.add(glow.obj, burst.obj);
    const FC = [0xfff3a0, 0xffc6e0, 0xbff0ff, 0xd9c8ff];
    const GC = [0xffd76a, 0xff9fca, 0x8fd8ff, 0xb9a0ff];
    let list = [];
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), ps = new THREE.Vector3(), sc = new THREE.Vector3(), from = new THREE.Vector3();
    const FALL = new THREE.Vector3(2.2, 6.5, -1.6);

    function spawnFragments(n, seed) {
      const rng = mulberry(seed == null ? (Math.random() * 1e9) | 0 : seed);
      n = Math.max(0, Math.min(MAXF, n | 0));
      list = [];
      for (let i = 0; i < n; i++) {
        let p = null;
        for (let k = 0; k < 20; k++) {
          const c = rng() < 0.65 ? meadowSpot(rng) : beachSpot(rng);
          if (c && list.every((f) => f.p.distanceTo(c) > 0.75)) { p = c; break; }
        }
        if (!p) p = meadowSpot(rng);
        list.push({ p, pos: p.clone(), shown: false, t0: T + i * 0.35 + rng() * 0.2, state: "fall", tp: 0, col: i % FC.length });
        frags.setColorAt(i, _c.setHex(FC[i % FC.length]));
      }
      if (frags.instanceColor) frags.instanceColor.needsUpdate = true;
      setInstCount(frags, n);
      return list.map((f) => f.p.clone());
    }
    function collect(i) {
      const f = list[i];
      if (!f || f.state === "pop" || f.state === "gone") return null;
      f.state = "pop"; f.tp = T;
      burst.emit(f.p.x, f.p.y + 0.2, f.p.z, [FC[f.col], GC[f.col], 0xffffff], 18, 2.0, 1.4, 0.17);
      return f.p.clone().setY(f.p.y + 0.2);
    }
    function spawnMeteor(i, now) {
      const m = met[i];
      m.on = true; m.t0 = now; m.big = Math.random() < 0.18;
      m.dur = (m.big ? 1.35 : 0.85) + Math.random() * 0.35;
      m.x = -0.75 + Math.random() * 1.5; m.y = 0.35 + Math.random() * 0.6;
      const a = st.dirA + (Math.random() - 0.5) * 0.35, sp = (m.big ? 0.75 : 0.55) + Math.random() * 0.3;
      m.dx = Math.cos(a) * sp; m.dy = Math.sin(a) * sp;
      m.len = (m.big ? 0.62 : 0.42) + Math.random() * 0.14;
      m.col = MC[(Math.random() * MC.length) | 0];
    }
    return {
      root, spawnFragments, collect,
      start() {
        st.nextAt = T + 0.3; st.dirA = Math.random() < 0.5 ? -2.55 : -0.6;
        met.forEach((m) => { m.on = false; });
        list = []; setInstCount(frags, 0);
      },
      stop() {},
      targets() {
        return list.map((f, i) => (f.state === "idle" || (f.state === "fall" && f.shown) ? { target: "fragment", index: i, pos: parent.localToWorld((f.shown ? f.pos : f.p).clone()), r: 0.42 } : null)).filter(Boolean);
      },
      where(target, i) { const f = list[i]; return f ? f.p.clone().setY(f.p.y + 0.3) : null; },
      update(T, dt) {
        dimTarget = 0;
        // ---- 流星
        if (T > st.nextAt) {
          const i = met.findIndex((m) => !m.on);
          if (i >= 0) spawnMeteor(i, T);
          st.nextAt = T + (REDUCED ? 1.0 : 0.22) + Math.random() * (REDUCED ? 1.2 : 0.55);
        }
        const D = 30, hy = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * D, hx = hy * camera.aspect;
        met.forEach((m, i) => {
          if (!m.on) { mets.setMatrixAt(i, m4.makeScale(0, 0, 0)); return; }
          const k = (T - m.t0) / m.dur;
          if (k >= 1) { m.on = false; mets.setMatrixAt(i, m4.makeScale(0, 0, 0)); return; }
          const x = (m.x + m.dx * k) * hx, y = (m.y + m.dy * k) * hy;
          const ang = Math.atan2(m.dy * hy, m.dx * hx);
          const L = m.len * hy * Math.min(1, k * 3.5) * (1 - smooth(0.75, 1, k) * 0.7);
          const br = k < 0.12 ? k / 0.12 : 1 - Math.pow((k - 0.12) / 0.88, 2);
          ps.set(x, y, -D); q.setFromAxisAngle(_p.set(0, 0, 1), ang); sc.set(Math.max(0.001, L), hy * (m.big ? 0.075 : 0.055), 1);
          mets.setMatrixAt(i, m4.compose(ps, q, sc));
          mets.setColorAt(i, _c.setHex(m.col).multiplyScalar(br * (m.big ? 1 : 0.85)));
        });
        mets.instanceMatrix.needsUpdate = true;
        if (mets.instanceColor) mets.instanceColor.needsUpdate = true;
        // ---- 碎片
        glow.begin();
        list.forEach((f, i) => {
          let s = 1, y = f.p.y + 0.17;
          if (f.state === "fall") {
            const k = (T - f.t0) / 1.0;
            if (k < 0) { frags.setMatrixAt(i, m4.makeScale(0, 0, 0)); f.shown = false; return; }
            if (k >= 1) {
              f.state = "idle"; f.landT = T;
              burst.emit(f.p.x, f.p.y + 0.05, f.p.z, [FC[f.col], 0xffffff], 8, 1.1, 0.8, 0.12);
            } else {
              const kk = k * k;
              from.copy(f.p).add(FALL);
              ps.lerpVectors(from, f.p, kk); ps.y += 0.17 * kk;
              // 尾巴：沿着来的方向几颗越来越小的光点
              for (let j = 0; j < 5; j++) {
                const kj = Math.max(0, kk - j * 0.035);
                glow.push(from.x + (f.p.x - from.x) * kj, from.y + (f.p.y + 0.17 - from.y) * kj, from.z + (f.p.z - from.z) * kj, 0.7 - j * 0.11, GC[f.col], 0.9 - j * 0.16);
              }
              e.set(0, T * 6, T * 3);
              frags.setMatrixAt(i, m4.compose(ps, q.setFromEuler(e), sc.setScalar(0.9)));
              f.pos.copy(ps); f.shown = true;
              return;
            }
          }
          if (f.state === "gone") { frags.setMatrixAt(i, m4.makeScale(0, 0, 0)); f.shown = false; return; }
          if (f.state === "idle") {
            const lk = (T - f.landT) / 0.45;
            s = lk < 1 ? 1 + Math.sin(lk * Math.PI * 2) * 0.25 * (1 - lk) : 1;
            y += Math.sin(T * 2.2 + i) * 0.04;
          } else if (f.state === "pop") {
            const k = (T - f.tp) / 0.4;
            if (k >= 1) { f.state = "gone"; frags.setMatrixAt(i, m4.makeScale(0, 0, 0)); return; }
            s = k < 0.35 ? 1 + k * 2 : 1.7 * (1 - (k - 0.35) / 0.65);
            y += k * 0.35;
          }
          ps.set(f.p.x, y, f.p.z);
          e.set(0, T * 1.6 + i, Math.sin(T * 1.3 + i) * 0.15);
          frags.setMatrixAt(i, m4.compose(ps, q.setFromEuler(e), sc.setScalar(Math.max(0.001, s))));
          f.pos.copy(ps); f.shown = true;
          const tw = 0.75 + 0.25 * Math.sin(T * 4 + i * 1.7);
          glow.push(ps.x, ps.y, ps.z, 0.85 * tw * s, GC[f.col], f.state === "pop" ? 0.9 * (1 - (T - f.tp) / 0.4) : 0.85);
        });
        glow.end();
        frags.instanceMatrix.needsUpdate = true;
      },
    };
  }

  /* ------------------------------------------------------------ 大退潮 */
  function buildLowtide() {
    const root = new THREE.Group();
    shoreTable();
    const N = 200, rng = mulberry(11);
    const wid = (a) => 1.0 + 0.4 * (Math.sin(a * 3 + 1) * 0.5 + 0.5) + 0.12 * Math.sin(a * 11);
    // 露出来的湿沙滩：贴着海岸线往外一圈（盖在海面上面，海本身不动）；外沿一条白浪
    const pos = [], col = [], idx = [];
    const WET = new THREE.Color(0xcfb07a), DAMP = new THREE.Color(0xbf9e68), EDGE = new THREE.Color(0xa9bf9a), FOAM = new THREE.Color(0xffffff);
    const ringRow = (rOf, y, colOf) => {
      const start = pos.length / 3;
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2, r = rOf(a);
        pos.push(Math.cos(a) * r, y, Math.sin(a) * r);
        const c = colOf(a); col.push(c.r, c.g, c.b);
      }
      return start;
    };
    const strip = (r0, r1) => { for (let i = 0; i < N; i++) { const j = (i + 1) % N; idx.push(r0 + i, r0 + j, r1 + i, r0 + j, r1 + j, r1 + i); } };
    const Y = SEA_Y + 0.012;
    const tc = new THREE.Color();
    // 从老海岸线往外：一道深色的湿痕，再是一棱一棱的沙纹（深浅交替），最外面泛一点水光，然后是新的白浪线
    const rows = [[-0.12, WET], [0.06, DAMP], [0.14, WET], [0.3, DAMP], [0.38, WET], [0.55, DAMP], [0.63, WET], [0.8, DAMP], [0.9, EDGE], [1.0, EDGE]];
    const rowIdx = rows.map(([f, c], k) => ringRow((a) => shoreR(a) + (f < 0 ? f : wid(a) * f + (k % 2 ? 0.03 * Math.sin(a * 17 + k) : 0)), Y, () => c));
    for (let k = 0; k < rowIdx.length - 1; k++) strip(rowIdx[k], rowIdx[k + 1]);
    const r3 = ringRow((a) => shoreR(a) + wid(a) + 0.02, Y + 0.004, () => FOAM);
    const r4 = ringRow((a) => shoreR(a) + wid(a) + 0.13 + 0.04 * Math.sin(a * 23), Y + 0.004, () => FOAM);
    strip(r3, r4);
    // 水洼：几个不规则的浅水坑（同一个网格，颜色烤进去）
    const POOLC = new THREE.Color(0x8fdbd6), POOLL = new THREE.Color(0xc9f1ec);
    const pools = [];
    for (let k = 0; k < 40 && pools.length < 7; k++) {
      const a = rng() * Math.PI * 2;
      if (angDist(a, DOCK_A) < 0.3) continue;
      const r = shoreR(a) + 0.25 + rng() * (wid(a) - 0.55);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (pools.some((p) => Math.hypot(p[0] - x, p[1] - z) < 1.2)) continue;
      pools.push([x, z, 0.16 + rng() * 0.14, a]);
    }
    for (const [x, z, rad, a] of pools) {
      const c0 = pos.length / 3, M = 18;
      pos.push(x, Y + 0.004, z); col.push(POOLL.r, POOLL.g, POOLL.b);
      for (let i = 0; i < M; i++) {
        const b = (i / M) * Math.PI * 2, rr = rad * (1 + 0.22 * Math.sin(b * 3 + a * 5));
        // 沿海岸线方向拉长一点（t = 切线，-n = 朝岛里）
        const u = Math.cos(b) * rr * 1.6, v = Math.sin(b) * rr;
        pos.push(x - Math.sin(a) * u - Math.cos(a) * v, Y + 0.004, z + Math.cos(a) * u - Math.sin(a) * v);
        tc.copy(POOLC); col.push(tc.r, tc.g, tc.b);
      }
      for (let i = 0; i < M; i++) idx.push(c0, c0 + 1 + ((i + 1) % M), c0 + 1 + i);
    }
    const bandGeo = new THREE.BufferGeometry();
    bandGeo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    bandGeo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    bandGeo.setAttribute("normal", new THREE.Float32BufferAttribute(new Float32Array(pos.length).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    bandGeo.setIndex(idx);
    const band = new THREE.Mesh(bandGeo, vc);
    band.raycast = noRay;
    root.add(band);

    // 小石头、海草、海星（不动，合成一个网格）
    const deco = [];
    for (let k = 0, n = 0; k < 120 && n < 26; k++) {
      const a = rng() * Math.PI * 2;
      if (angDist(a, DOCK_A) < 0.2) continue;
      const r = shoreR(a) + 0.15 + rng() * (wid(a) - 0.3), x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (pools.some((p) => Math.hypot(p[0] - x, p[1] - z) < p[2] * 1.6 + 0.08)) continue;
      const kind = n % 3;
      if (kind === 0) deco.push(part(new THREE.SphereGeometry(0.06 + rng() * 0.05, 8, 6), [0xb8ab9c, 0xa89a8b, 0xc9bdb0][n % 3], [x, Y + 0.02, z], [0, rng() * 3, 0], [1.2, 0.55, 1]));
      else if (kind === 1) for (let j = 0; j < 3; j++) deco.push(part(new THREE.ConeGeometry(0.025, 0.14 + rng() * 0.08, 5), [0x4f9a5c, 0x6bb35a, 0x3f8a6a][j], [x + (j - 1) * 0.03, Y + 0.07, z + (j % 2) * 0.03], [(rng() - 0.5) * 0.6, 0, (j - 1) * 0.35]));
      else {
        const sh = new THREE.Shape();
        for (let i = 0; i < 10; i++) { const b = (i / 10) * Math.PI * 2, rr = i % 2 ? 0.03 : 0.075; if (i) sh.lineTo(Math.cos(b) * rr, Math.sin(b) * rr); else sh.moveTo(Math.cos(b) * rr, Math.sin(b) * rr); }
        deco.push(part(new THREE.ExtrudeGeometry(sh, { depth: 0.015, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 1 }), [0xff9e7a, 0xff8fa3, 0xffb36b][n % 3], [x, Y + 0.012, z], [-Math.PI / 2, 0, rng() * 6]));
      }
      n++;
    }
    root.add(mk(merge(deco), 0.008));

    // 小螃蟹：在湿沙上横着走来走去
    const NCRAB = REDUCED ? 2 : 5;
    const crabGeo = merge([
      part(new THREE.SphereGeometry(0.075, 12, 8), 0xff7a5c, [0, 0.04, 0], [0, 0, 0], [1.3, 0.6, 1]),
      ...[-1, 1].flatMap((s) => [
        part(new THREE.SphereGeometry(0.036, 8, 6), 0xff6a4f, [s * 0.1, 0.035, 0.07], [0, 0, 0], [1, 0.8, 1.2]),
        part(new THREE.ConeGeometry(0.018, 0.04, 5), 0xff6a4f, [s * 0.085, 0.04, 0.105], [Math.PI / 2, 0, s * 0.4]),
        part(new THREE.CylinderGeometry(0.008, 0.008, 0.05, 4), 0xff8a6a, [s * 0.03, 0.09, 0.04]),
        part(new THREE.SphereGeometry(0.016, 6, 5), 0x2b2230, [s * 0.03, 0.12, 0.045]),
        ...[0, 1, 2].map((j) => part(new THREE.CylinderGeometry(0.009, 0.007, 0.07, 4), 0xff8a6a, [s * 0.1, 0.02, -0.03 + j * 0.035], [0, 0, s * 1.1])),
      ]),
    ]);
    const crabs = new THREE.InstancedMesh(crabGeo, vc, NCRAB);
    crabs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    crabs.frustumCulled = false; crabs.raycast = noRay;
    outlineInstanced(crabs, outlined, 0.008);
    root.add(crabs);
    const crabSeed = [];
    for (let i = 0, k = 0; i < NCRAB && k < 60; k++) {
      const a = rng() * Math.PI * 2;
      if (angDist(a, DOCK_A) < 0.35 || crabSeed.some((c) => angDist(c.a, a) < 0.6)) continue;
      crabSeed.push({ a, ro: 0.3 + rng() * 0.35, sp: 0.5 + rng() * 0.5, ph: rng() * 6 }); i++;
    }

    // 贝壳（可以捡）：扇贝样子的小圆锥，上面一闪一闪
    const MAXS = 12;
    const shellGeo = (() => {
      const g = new THREE.ConeGeometry(0.1, 0.06, 18, 1);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), z = p.getZ(i), y = p.getY(i);
        if (y < 0) { const a = Math.atan2(z, x), k = 1 + 0.09 * Math.cos(a * 9); p.setX(i, x * k); p.setZ(i, z * k * 0.85); }
      }
      g.translate(0, 0.03, 0);
      g.computeVertexNormals();
      return merge([part(g, 0xffffff), part(new THREE.BoxGeometry(0.06, 0.025, 0.035), 0xffffff, [0, 0.012, -0.095])]);
    })();
    const shells = new THREE.InstancedMesh(shellGeo, toon(0xffffff), MAXS);
    shells.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    shells.frustumCulled = false; shells.raycast = noRay;
    outlineInstanced(shells, outlined, 0.01);
    setInstCount(shells, 0);
    root.add(shells);
    const sparkle = makeSparks(MAXS, { additive: true, star: 1, order: 4 });
    root.add(sparkle.obj, burst.obj);
    const SC = [0xffb3c7, 0xffd1a8, 0xd9c2ff, 0xfff0d6, 0xa8e6e0];
    let list = [];
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), ps = new THREE.Vector3(), sc = new THREE.Vector3();

    function spawnShells(n, seed) {
      const r = mulberry(seed == null ? (Math.random() * 1e9) | 0 : seed);
      n = Math.max(0, Math.min(MAXS, n | 0));
      list = [];
      for (let k = 0; k < 400 && list.length < n; k++) {
        const a = r() * Math.PI * 2;
        if (angDist(a, DOCK_A) < 0.3) continue;
        const rr = shoreR(a) + 0.2 + r() * (wid(a) - 0.4), x = Math.cos(a) * rr, z = Math.sin(a) * rr;
        if (list.some((s) => Math.hypot(s.p.x - x, s.p.z - z) < 1.1)) continue;
        if (pools.some((p) => Math.hypot(p[0] - x, p[1] - z) < p[2] * 1.6 + 0.1)) continue;
        const i = list.length;
        list.push({ p: new THREE.Vector3(x, Y, z), ry: r() * 6.28, state: "idle", tp: 0, col: i % SC.length, t0: T + i * 0.12 });
        shells.setColorAt(i, _c.setHex(SC[i % SC.length]));
      }
      if (shells.instanceColor) shells.instanceColor.needsUpdate = true;
      setInstCount(shells, list.length);
      return list.map((s) => s.p.clone());
    }
    function collect(i) {
      const s = list[i];
      if (!s || s.state !== "idle") return null;
      s.state = "pop"; s.tp = T;
      burst.emit(s.p.x, s.p.y + 0.1, s.p.z, [SC[s.col], 0xffffff, 0x9fe3ff], 14, 1.5, 1.2, 0.14);
      return s.p.clone().setY(s.p.y + 0.15);
    }
    return {
      root, spawnShells, collect,
      start() { list = []; setInstCount(shells, 0); },
      stop() {},
      targets() { return list.map((s, i) => (s.state === "idle" ? { target: "shell", index: i, pos: parent.localToWorld(s.p.clone().setY(s.p.y + 0.05)), r: 0.4 } : null)).filter(Boolean); },
      where(target, i) { const s = list[i]; return s ? s.p.clone().setY(s.p.y + 0.25) : null; },
      update(T) {
        dimTarget = 0;
        crabSeed.forEach((c, i) => {
          const u = Math.sin(T * 0.55 * c.sp + c.ph);
          const walk = u * u * u; // 走走停停
          const a = c.a + walk * 0.16;
          const r = shoreR(a) + c.ro;
          ps.set(Math.cos(a) * r, Y + 0.005 + Math.abs(Math.sin(T * 16 + i)) * 0.012 * Math.abs(Math.cos(T * 0.55 * c.sp + c.ph)), Math.sin(a) * r);
          e.set(0, Math.atan2(Math.cos(a), Math.sin(a)) + Math.sin(T * 9 + i) * 0.06, 0);
          crabs.setMatrixAt(i, m4.compose(ps, q.setFromEuler(e), sc.setScalar(1.8)));
        });
        crabs.instanceMatrix.needsUpdate = true;
        sparkle.begin();
        list.forEach((s, i) => {
          let k = 1, y = s.p.y;
          if (s.state === "gone") { shells.setMatrixAt(i, m4.makeScale(0, 0, 0)); return; }
          const ik = clamp01((T - s.t0) / 0.4);
          k = ik < 1 ? easeOut(ik) * (1 + Math.sin(ik * Math.PI) * 0.3) : 1;
          if (s.state === "pop") {
            const pk = (T - s.tp) / 0.4;
            if (pk >= 1) { s.state = "gone"; shells.setMatrixAt(i, m4.makeScale(0, 0, 0)); return; }
            k = pk < 0.35 ? 1 + pk * 2 : 1.7 * (1 - (pk - 0.35) / 0.65); y += pk * 0.4;
          }
          ps.set(s.p.x, y, s.p.z);
          e.set(0, s.ry, 0);
          shells.setMatrixAt(i, m4.compose(ps, q.setFromEuler(e), sc.setScalar(Math.max(0.001, k * 1.7))));
          if (s.state === "idle") {
            const tw = Math.max(0, Math.sin(T * 2.6 + i * 2.1));
            sparkle.push(s.p.x + 0.05, s.p.y + 0.16, s.p.z, 0.6 * tw * tw + 0.12, 0xffffff, 0.95);
          }
        });
        sparkle.end();
        shells.instanceMatrix.needsUpdate = true;
      },
    };
  }

  /* ------------------------------------------------------------ 鲸鱼 */
  function buildWhale() {
    const root = new THREE.Group();
    const BLUE = 0x77a7ea, BLUE_DK = 0x5f8fd8, BELLY = 0xeef5ff, BELLY_LN = 0xd6e4f7;
    const whale = new THREE.Group();
    whale.rotation.order = "YXZ";
    root.add(whale);
    // 身体 + 尾柄是一整个车削体（不然两块相交的地方描边会画出一道缝）：圆圆的头，往后慢慢收细
    const bodyGeo = (() => {
      const pts = [new THREE.Vector2(0.001, -1.8)];
      for (let i = 0; i <= 40; i++) {
        const t = i / 40, y = -1.75 + t * 2.75;
        const r = t >= 0.62 ? Math.sqrt(Math.max(0, 1 - ((t - 0.62) / 0.38) ** 2)) : 0.13 + 0.87 * Math.pow(Math.sin((Math.PI / 2) * (t / 0.62)), 1.6);
        pts.push(new THREE.Vector2(Math.max(0.001, r), y));
      }
      const g = new THREE.LatheGeometry(pts, 30).rotateX(Math.PI / 2).scale(0.62, 0.55, 1);
      g.computeVertexNormals();
      return g;
    })();
    const body = mk(merge([
      part(bodyGeo, (x, y, z, ny) => (ny < -0.32 + 0.08 * Math.sin(z * 4) && z > -1.2 ? (Math.floor(x * 9 + 100) % 2 ? BELLY : BELLY_LN) : BLUE)),
      part(new THREE.SphereGeometry(0.2, 12, 8), BLUE_DK, [0.5, -0.27, 0.3], [0.2, 0.5, -0.7], [1.5, 0.28, 0.75]),
      part(new THREE.SphereGeometry(0.2, 12, 8), BLUE_DK, [-0.5, -0.27, 0.3], [0.2, -0.5, 0.7], [1.5, 0.28, 0.75]),
    ]), 0.022);
    const face = [];
    for (const s of [-1, 1]) {
      face.push(part(new THREE.SphereGeometry(0.085, 12, 10), 0x2b2230, [s * 0.5, 0.16, 0.5], [0, 0, 0], [0.45, 1.15, 0.85]));
      face.push(part(new THREE.SphereGeometry(0.027, 8, 6), 0xffffff, [s * 0.535, 0.205, 0.525]));
      face.push(part(new THREE.SphereGeometry(0.075, 10, 8), 0xff9fb5, [s * 0.445, 0.02, 0.66], [0, 0, 0], [0.35, 0.6, 1]));
    }
    face.push(part(new THREE.TorusGeometry(0.12, 0.016, 6, 16, Math.PI), 0x3a2a30, [0, 0.02, 0.93], [-0.3, 0, Math.PI], [1, 0.8, 1]));
    face.push(part(new THREE.SphereGeometry(0.05, 8, 6), 0x4f78b8, [0, 0.505, 0.32], [0, 0, 0], [1.4, 0.4, 1]));
    const faceM = new THREE.Mesh(merge(face), vc);
    faceM.raycast = noRay;
    const tail = new THREE.Group();
    tail.position.set(0, 0, -1.72);
    const flukes = mk(merge([
      part(new THREE.SphereGeometry(0.3, 14, 8), BLUE, [0.27, 0, -0.12], [0, 0.45, 0], [1.25, 0.16, 0.6]),
      part(new THREE.SphereGeometry(0.3, 14, 8), BLUE, [-0.27, 0, -0.12], [0, -0.45, 0], [1.25, 0.16, 0.6]),
      part(new THREE.SphereGeometry(0.13, 10, 6), BLUE, [0, 0, -0.02], [0, 0, 0], [1, 0.5, 1]),
    ]), 0.02);
    tail.add(flukes);
    whale.add(body, faceM, tail);
    whale.scale.setScalar(1.15);
    // 喷水：一根水柱 + 顶上一团 + 往四周垂下来的几串水珠（像一棵小椰子树）
    const NF = REDUCED ? 4 : 6, PER = REDUCED ? 2 : 3, NDROP = 2 + NF * PER;
    const drops = new THREE.InstancedMesh(new THREE.SphereGeometry(0.1, 10, 8), toon(0xe4f6ff, { emissive: 0xbfe6ff, emissiveIntensity: 0.4 }), NDROP);
    drops.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    drops.frustumCulled = false; drops.raycast = noRay;
    root.add(drops);
    // 身边一圈白浪 + 往外扩的水波
    const foam = new THREE.Mesh(new THREE.RingGeometry(0.85, 1.05, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75, depthWrite: false }));
    foam.rotation.x = -Math.PI / 2; foam.raycast = noRay; foam.renderOrder = 2;
    const ripple = new THREE.Mesh(new THREE.RingGeometry(0.92, 1.0, 48), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, depthWrite: false }));
    ripple.rotation.x = -Math.PI / 2; ripple.raycast = noRay; ripple.renderOrder = 2;
    root.add(foam, ripple, burst.obj);

    // 位置：码头尽头再往外一点，侧身对着码头
    const HOMEP = DOCK.tip.clone().addScaledVector(DIR, 1.9).addScaledVector(PERP, 1.55).setY(0);
    const HEAD = Math.atan2(-PERP.x, -PERP.z) + 0.25;
    const st = { mode: "rise", t0: 0, spoutAt: 0, spoutT: -9, hitT: -9, leaveRes: null, yaw: HEAD };
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), ps = new THREE.Vector3(), sc = new THREE.Vector3(), bh = new THREE.Vector3();
    const REST = SEA_Y + 0.02;
    function spout() { st.spoutT = T; }
    function hit() {
      st.hitT = T; spout();
      const p = whale.position;
      burst.emit(p.x, p.y + 0.9, p.z, [0xff8fab, 0xffc4d8, 0xffffff], 12, 1.4, 1.6, 0.2);
    }
    function leave() {
      return new Promise((res) => {
        if (cur !== "whale") { res(); return; }
        st.mode = "dive"; st.t0 = T; st.leaveRes = res;
      });
    }
    return {
      root, hit, leave,
      start() {
        st.mode = "rise"; st.t0 = T; st.spoutAt = T + 2.6; st.spoutT = -9; st.hitT = -9; st.yaw = HEAD;
        whale.position.copy(HOMEP).setY(REST - 1.6);
      },
      stop() { if (st.leaveRes) { const r = st.leaveRes; st.leaveRes = null; r(); } },
      targets() { return [{ target: "whale", index: 0, pos: whale.localToWorld(new THREE.Vector3(0, 0.3, 0)), r: 1.25 }]; },
      where() { return whale.position.clone().setY(SEA_Y + 1.0); },
      focus() { return whale.position.clone().setY(SEA_Y + 0.4); },
      update(T, dt) {
        dimTarget = 0;
        // 慢慢转成 3/4 侧身对着镜头（能看到脸，也能看到整个身子）
        if (st.mode !== "dive") {
          const cw = camera.getWorldPosition(bh); parent.worldToLocal(cw);
          const ca = Math.atan2(cw.x - HOMEP.x, cw.z - HOMEP.z);
          const d1 = wrap(ca + 1.05 - st.yaw), d2 = wrap(ca - 1.05 - st.yaw);
          const d = Math.abs(d1) < Math.abs(d2) ? d1 : d2;
          st.yaw += d * Math.min(1, dt * (st.mode === "rise" ? 3 : 0.5));
        }
        let y = REST, pitch = 0, roll = 0, yaw = st.yaw + Math.sin(T * 0.25) * 0.1;
        let tailA = Math.sin(T * 1.6) * 0.22, fwd = 0;
        const m = st.mode;
        if (m === "rise") {
          const k = clamp01((T - st.t0) / 2.4);
          y = REST - 1.6 * (1 - easeOut(k));
          pitch = -0.35 * (1 - k);
          if (k >= 1) {
            st.mode = "idle";
            burst.emit(whale.position.x, SEA_Y + 0.3, whale.position.z, [0xffffff, 0xcdeeff], 16, 2.2, 1.6, 0.2);
          }
        } else if (m === "idle") {
          y = REST + Math.sin(T * 0.9) * 0.05;
          roll = Math.sin(T * 0.7) * 0.04;
          if (T > st.spoutAt) { spout(); st.spoutAt = T + 4 + Math.random() * 2.5; }
        } else if (m === "dive") {
          const k = (T - st.t0) / 3.2;
          pitch = 0.55 * smooth(0, 0.35, k);
          fwd = k * k * 2.2;
          y = REST - smooth(0.15, 1, k) * 2.2;
          tailA = -0.9 * Math.sin(clamp01(k * 1.3) * Math.PI);
          if (k >= 1) { stopKind("whale"); return; }
        }
        const hk = (T - st.hitT) / 1.2;
        if (hk >= 0 && hk < 1) { roll += Math.sin(hk * Math.PI * 4) * 0.16 * (1 - hk); y += Math.sin(hk * Math.PI) * 0.12; tailA += Math.sin(hk * 20) * 0.4 * (1 - hk); }
        whale.position.set(HOMEP.x + Math.sin(yaw) * fwd, y, HOMEP.z + Math.cos(yaw) * fwd);
        whale.rotation.set(pitch, yaw, roll);
        tail.rotation.x = tailA;
        // 喷水
        const sk = (T - st.spoutT) / 1.7;
        drops.visible = sk >= 0 && sk < 1 && m !== "dive";
        if (drops.visible) {
          bh.set(0, 0.52, 0.32); whale.localToWorld(bh); parent.worldToLocal(bh);
          const grow = smooth(0, 0.28, sk), shrink = smooth(0.62, 1, sk), H = 1.2 * grow * (1 - shrink * 0.85);
          ps.copy(bh); ps.y += H / 2;
          drops.setMatrixAt(0, m4.compose(ps, q.identity(), sc.set(0.85 * (1 - shrink * 0.6), Math.max(0.001, H / 0.2), 0.85 * (1 - shrink * 0.6))));
          ps.copy(bh); ps.y += H;
          drops.setMatrixAt(1, m4.compose(ps, q.identity(), sc.setScalar(Math.max(0.001, 1.6 * grow * (1 - shrink)))));
          const spread = smooth(0.12, 0.62, sk);
          for (let f = 0; f < NF; f++) {
            const a = (f / NF) * Math.PI * 2 + 0.4;
            for (let j = 0; j < PER; j++) {
              const u = spread * (0.38 + 0.3 * j) + shrink * 0.25;
              const dd = u * 0.85, drop = u * u * 1.5 - u * 0.4 + shrink * 0.5 * (1 + j * 0.3);
              _p.set(bh.x + Math.cos(a) * dd, bh.y + H - drop, bh.z + Math.sin(a) * dd);
              const sz = (1.15 - j * 0.28) * (spread > 0.01 ? 1 : 0) * (1 - smooth(0.75, 1, sk));
              drops.setMatrixAt(2 + f * PER + j, m4.compose(_p, q.identity(), sc.setScalar(Math.max(0.001, sz))));
            }
          }
          drops.instanceMatrix.needsUpdate = true;
        }
        // 白浪 / 水波（浮在水面上，跟着鲸鱼）
        const above = clamp01((y - (REST - 0.9)) / 0.9);
        foam.visible = above > 0.05;
        foam.position.set(whale.position.x, SEA_Y + 0.02, whale.position.z);
        foam.scale.set(0.9, 1.7, 1).multiplyScalar(0.95 + Math.sin(T * 2) * 0.04);
        foam.rotation.z = yaw;
        foam.material.opacity = 0.7 * above;
        const rk = (T * 0.45) % 1;
        ripple.position.copy(foam.position);
        ripple.rotation.z = yaw;
        ripple.scale.set(1.0 + rk * 1.4, 1.8 + rk * 1.6, 1);
        ripple.material.opacity = 0.55 * (1 - rk) * above;
      },
    };
  }

  const BUILD = { typhoon: buildTyphoon, parrot: buildParrot, meteor: buildMeteor, lowtide: buildLowtide, whale: buildWhale };
  const mod = (k) => mods[k] || (mods[k] = BUILD[k]());

  function stopKind(kind) {
    if (!cur || (kind && kind !== cur)) return;
    const m = mods[cur];
    if (m) { m.stop(); parent.remove(m.root); }
    burst.clear();
    cur = null;
    dimTarget = 0;
  }

  Object.assign(api, {
    start(kind, opts = {}) {
      if (!BUILD[kind]) return;
      if (cur) stopKind();
      const m = mod(kind);
      cur = kind;
      m.root.add(burst.obj);
      parent.add(m.root);
      m.start(opts);
      if (kind === "typhoon" && opts.intensity != null) m.setIntensity(opts.intensity);
      if (kind === "meteor" && opts.fragments) m.spawnFragments(opts.fragments, opts.seed);
      if (kind === "lowtide" && opts.shells) m.spawnShells(opts.shells, opts.seed);
      if (kind === "parrot" && opts.carry) m.setCarry(opts.carry);
    },
    stop: stopKind,
    active: () => cur,
    update(t, dt) {
      if (!cur) {
        if (api.skyDim > 0) api.skyDim = Math.max(0, api.skyDim - (dt || 0.016) * 0.6);
        return;
      }
      dt = Math.min(0.1, dt || 0.016);
      T += dt;
      mods[cur].update(T, dt);
      if (cur) burst.update(dt);
      const d = dimTarget - api.skyDim;
      api.skyDim += Math.sign(d) * Math.min(Math.abs(d), dt * 0.5);
    },
    // 点击：按"离射线多近"挑一个（目标都是小东西或者在动，用半径比网格求交好点）
    pick(raycaster) {
      if (!cur) return null;
      const ray = raycaster.ray;
      let best = null, bestS = Infinity;
      for (const tg of mods[cur].targets()) {
        const d = Math.sqrt(ray.distanceSqToPoint(tg.pos));
        if (d > tg.r) continue;
        const along = _p.subVectors(tg.pos, ray.origin).dot(ray.direction);
        if (along < 0) continue;
        const s = d / tg.r + along * 0.004;
        if (s < bestS) { bestS = s; best = tg; }
      }
      if (!best) return null;
      const out = { kind: cur, target: best.target, index: best.index };
      if (best.braced != null) out.braced = best.braced;
      return out;
    },
    // 当前可以点的目标（调试 / 集成用）：[{ target, index, pos(世界坐标), r }]
    targets: () => (cur ? mods[cur].targets() : []),
    // 某个目标在 world 组里的位置（往上一点，给气泡 / 飘字用；配合 NEST3D.screenAt）
    where(target, index = 0) { return cur && mods[cur].where ? mods[cur].where(target, index) : null; },
    // 台风
    get spots() { return mod("typhoon").spots.map((s) => s.p.clone()); },
    setBraced(i, on) { if (cur === "typhoon") mods.typhoon.setBraced(i, on); },
    setIntensity(k) { if (cur === "typhoon") mods.typhoon.setIntensity(k); },
    // 鹦鹉
    setCarry(e) { if (cur === "parrot") mods.parrot.setCarry(e); },
    // 鹦鹉 / 鲸鱼
    hit() { if (cur === "parrot" || cur === "whale") mods[cur].hit(); },
    leave() { return cur === "parrot" || cur === "whale" ? mods[cur].leave() : Promise.resolve(); },
    focusPoint() { return cur === "whale" ? mods.whale.focus() : cur ? api.where(cur === "typhoon" ? "spot" : cur, 0) : null; },
    // 流星雨 / 退潮
    spawnFragments(n, seed) { return cur === "meteor" ? mods.meteor.spawnFragments(n, seed) : []; },
    spawnShells(n, seed) { return cur === "lowtide" ? mods.lowtide.spawnShells(n, seed) : []; },
    collect(i) { return cur === "meteor" || cur === "lowtide" ? mods[cur].collect(i) : null; },
  });
  return api;
}

/* ================================================================ 远岛 */
// 建议的摆放位置（world 组坐标，root.position.set(x, 0, z)）：和 world3d 的灯塔岛 / 椰子树岛 / 远山岛 / 礁石错开
// rotY 让小岛的"正面"（树、雪人、灌木那一侧）朝着主岛
const farSpot = (x, z) => ({ x, z, rotY: Math.atan2(-x, -z) });
export const FAR_SPOTS = {
  sakura: farSpot(-3.6, 13.4),
  snow: farSpot(-13.8, 3.6),
  volcano: farSpot(-8.6, -13.4),
};

// 小岛地形：中间平顶，往外坡下去是沙滩，再没入浅水；顶点色按高度 / 种类
function farTerrain(toon, { R0, H, seed, top, top2, slope, sand, wob = 0.18 }) {
  const SY = ISLE_SEA_Y, beachY = SY + 0.08, SW = 0.55, BW = 0.45, segs = 44;
  const edge = (a) => R0 * (1 + wob * (Math.sin(a * 3 + seed) * 0.5 + Math.sin(a * 5 + seed * 2) * 0.3 + Math.sin(a * 9 + seed) * 0.2));
  const height = (r, a) => {
    const e = edge(a);
    if (r <= e) return H + 0.03 * Math.sin(a * 4 + r * 3);
    const x = (r - e) / SW;
    if (x < 1) return H + (beachY - H) * (x * x * (3 - 2 * x));
    const r2 = r - e - SW;
    if (r2 < BW) return beachY - r2 * 0.15;
    return Math.max(SY - 0.5, beachY - BW * 0.15 - (r2 - BW) * 0.8);
  };
  const rings = [0, 0.3, 0.6];
  for (let r = 0.85; r < R0 * (1 + wob) + SW + BW + 0.55; r += 0.11) rings.push(r);
  const pos = [], col = [], idx = [], c = new THREE.Color();
  const SHAL = new THREE.Color(0xd9d2a6), DEEP = new THREE.Color(0x7cc8c0);
  rings.forEach((r, i) => {
    const n = i === 0 ? 1 : segs;
    for (let k = 0; k < n; k++) {
      const a = (k / segs) * Math.PI * 2, y = height(r, a);
      pos.push(Math.cos(a) * r, y, Math.sin(a) * r);
      if (y >= H - 0.05) c.setHex((Math.sin(a * 3 + seed) * Math.cos(r * 3.5 + a) > 0.35) ? top2 : top);
      else if (y > beachY + 0.03) c.setHex(slope[Math.floor((y - SY) / 0.16) % slope.length]);
      else if (y > SY - 0.03) c.setHex(sand);
      else c.copy(SHAL).lerp(DEEP, clamp01((SY - y) / 0.8));
      col.push(c.r, c.g, c.b);
    }
  });
  const start = (i) => (i === 0 ? 0 : 1 + (i - 1) * segs);
  for (let k = 0; k < segs; k++) idx.push(0, start(1) + ((k + 1) % segs), start(1) + k);
  for (let i = 1; i < rings.length - 1; i++) {
    const a0 = start(i), b0 = start(i + 1);
    for (let k = 0; k < segs; k++) { const k1 = (k + 1) % segs; idx.push(a0 + k, a0 + k1, b0 + k, a0 + k1, b0 + k1, b0 + k); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, vcMat(toon));
  // 海岸线（白浪圈用）
  let sr = R0;
  for (let r = R0 * 0.5; r < R0 + 3; r += 0.02) if (height(r, 0.3) <= SY) { sr = r; break; }
  return { mesh, shore: sr, H };
}

export function buildFarIsland(kind, { toon, outlined }) {
  const SY = ISLE_SEA_Y;
  const root = new THREE.Group();
  const updaters = [];
  const vc = vcMat(toon);
  const mk = (geo, line = 0.02) => outlined(new THREE.Mesh(geo, vc), line);
  const foamMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, depthWrite: false });
  const addFoam = (r) => {
    const f = new THREE.Mesh(new THREE.RingGeometry(r - 0.04, r + 0.14, 44), foamMat);
    f.rotation.x = -Math.PI / 2; f.position.y = SY + 0.015;
    f.raycast = noRay;
    root.add(f);
    updaters.push((t) => { foamMat.opacity = 0.45 + Math.sin(t * 1.3) * 0.18; f.scale.setScalar(1 + Math.sin(t * 1.3) * 0.03); });
  };
  const rnd = mulberry(kind.length * 17 + 3);

  if (kind === "sakura") {
    const ter = farTerrain(toon, { R0: 1.15, H: SY + 0.5, seed: 2, top: 0x9ad978, top2: 0xf7c6d8, slope: [0x86c464, 0x7cbc5e], sand: 0xf7e2ae });
    root.add(ter.mesh); addFoam(ter.shore);
    const Y = ter.H;
    const PINK = [0xffb7d0, 0xffc9dc, 0xf7a1c0, 0xffd6e4];
    const parts = [];
    const trees = [[-0.35, -0.25, 1.0], [0.45, 0.05, 0.85], [-0.05, 0.5, 0.72]];
    trees.forEach(([x, z, s], i) => {
      parts.push(part(new THREE.CylinderGeometry(0.05 * s, 0.085 * s, 0.6 * s, 7), 0x8a5a4b, [x, Y + 0.3 * s, z], [0, 0, (i - 1) * 0.12]));
      parts.push(part(new THREE.CylinderGeometry(0.025 * s, 0.04 * s, 0.3 * s, 6), 0x8a5a4b, [x + 0.12 * s, Y + 0.55 * s, z], [0, 0, -0.9]));
      for (const [dx, dy, dz, r] of [[0, 0.78, 0, 0.36], [0.26, 0.68, 0.08, 0.27], [-0.25, 0.66, 0.06, 0.27], [0.02, 0.7, -0.24, 0.26], [0.05, 0.98, 0.02, 0.24]]) {
        parts.push(part(new THREE.SphereGeometry(r * s, 12, 9), PINK[(i + Math.round(dx * 10)) & 3], [x + dx * s, Y + dy * s, z + dz * s], [0, 0, 0], [1, 0.85, 1]));
      }
    });
    // 小石灯笼
    const lx = 0.55, lz = 0.55, STONE = 0xcfc8be;
    parts.push(
      part(new THREE.CylinderGeometry(0.08, 0.1, 0.06, 8), STONE, [lx, Y + 0.03, lz]),
      part(new THREE.CylinderGeometry(0.035, 0.035, 0.16, 8), STONE, [lx, Y + 0.14, lz]),
      part(new THREE.BoxGeometry(0.13, 0.11, 0.13), 0xfff1b8, [lx, Y + 0.27, lz]),
      part(new THREE.ConeGeometry(0.13, 0.09, 4), 0xb9b0a5, [lx, Y + 0.37, lz], [0, Math.PI / 4, 0]),
      part(new THREE.SphereGeometry(0.025, 6, 4), STONE, [lx, Y + 0.42, lz]),
    );
    root.add(mk(merge(parts), 0.02));
    const glow = glowSprite(0xffd27a, 0.7);
    glow.position.set(lx, Y + 0.27, lz);
    root.add(glow);
    updaters.push((t) => { glow.material.opacity = 0.55 + Math.sin(t * 2.1) * 0.12; });
    // 飘落的花瓣
    const NP = REDUCED ? 6 : 14;
    const petals = new THREE.InstancedMesh(new THREE.SphereGeometry(0.045, 6, 4).scale(1, 0.25, 0.65), toon(0xffc4d8, { side: THREE.DoubleSide, emissive: 0xff9fc0, emissiveIntensity: 0.15 }), NP);
    petals.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    petals.frustumCulled = false; petals.raycast = noRay;
    root.add(petals);
    const ps = Array.from({ length: NP }, (_, i) => ({ tr: trees[i % 3], a: rnd() * 6.3, r: 0.1 + rnd() * 0.45, sp: 0.08 + rnd() * 0.06, ph: rnd() }));
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3();
    updaters.push((t) => {
      ps.forEach((s, i) => {
        const k = (t * s.sp + s.ph) % 1, [x, z, sz] = s.tr;
        p.set(x + Math.cos(s.a + k * 3) * s.r * (1 + k) + k * 0.5, Y + 0.95 * sz * (1 - k) + 0.03, z + Math.sin(s.a + k * 3) * s.r * (1 + k));
        e.set(Math.sin(t * 2 + i) * 0.9, t + i, Math.cos(t * 1.7 + i) * 0.7);
        sc.setScalar(k > 0.9 ? (1 - k) / 0.1 : 1);
        petals.setMatrixAt(i, m4.compose(p, q.setFromEuler(e), sc));
      });
      petals.instanceMatrix.needsUpdate = true;
    });
  } else if (kind === "snow") {
    const ter = farTerrain(toon, { R0: 1.1, H: SY + 0.35, seed: 5, top: 0xf3f7ff, top2: 0xe4ecf8, slope: [0xc9d6e6, 0xb8c6d8], sand: 0xd8e0ea });
    root.add(ter.mesh); addFoam(ter.shore);
    const Y = ter.H;
    // 雪山：车削出来的山体，雪线以上是白的（雪线有一点起伏）
    const peak = (h, r0, seed) => {
      const pts = [];
      for (let i = 0; i <= 16; i++) { const k = i / 16; pts.push(new THREE.Vector2(Math.max(0.001, r0 * Math.pow(1 - Math.pow(k, 1.5), 0.85) * (1 - 0.1 * Math.sin(k * 7))), k * h)); }
      const g = new THREE.LatheGeometry(pts, 18);
      const pos = g.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), z = pos.getZ(i), y = pos.getY(i), a = Math.atan2(z, x), k = 1 + 0.1 * Math.sin(a * 4 + seed + y * 3);
        pos.setX(i, x * k); pos.setZ(i, z * k);
      }
      g.computeVertexNormals();
      return { g, h, seed };
    };
    const P1 = peak(1.75, 0.85, 1), P2 = peak(1.05, 0.55, 3);
    const peakCol = (P) => (x, y, z) => {
      const a = Math.atan2(z, x), line = P.h * (0.56 + 0.07 * Math.sin(a * 5 + P.seed));
      return y > line ? 0xf7fbff : (Math.floor(y / 0.18) % 2 ? 0x7f8fa8 : 0x93a2bb);
    };
    const parts = [
      part(P1.g, peakCol(P1), [-0.2, Y - 0.05, -0.2]),
      part(P2.g, peakCol(P2), [0.5, Y - 0.05, -0.05], [0, 1, 0]),
    ];
    const pine = (x, z, s) => {
      parts.push(part(new THREE.CylinderGeometry(0.03 * s, 0.045 * s, 0.14 * s, 6), 0x8a5a3b, [x, Y + 0.07 * s, z]));
      for (let i = 0; i < 3; i++) {
        const r = (0.17 - i * 0.04) * s, h = 0.22 * s, y = Y + (0.18 + i * 0.12) * s;
        parts.push(part(new THREE.ConeGeometry(r, h, 8), (px, py) => (py > h * 0.28 ? 0xf7fbff : 0x3f8f68), [x, y, z]));
      }
    };
    pine(0.55, 0.55, 1); pine(-0.6, 0.45, 0.85); pine(0.1, 0.75, 0.75); pine(-0.85, -0.15, 0.7);
    // 小雪人
    parts.push(part(new THREE.SphereGeometry(0.1, 10, 8), 0xffffff, [0.85, Y + 0.09, 0.15]), part(new THREE.SphereGeometry(0.07, 10, 8), 0xffffff, [0.85, Y + 0.24, 0.15]),
      part(new THREE.ConeGeometry(0.018, 0.07, 6), 0xff9a3c, [0.85, Y + 0.24, 0.24], [Math.PI / 2, 0, 0]),
      part(new THREE.CylinderGeometry(0.05, 0.06, 0.06, 10), 0xff6b8b, [0.85, Y + 0.31, 0.15]));
    root.add(mk(merge(parts), 0.02));
    // 小雪
    const NS = REDUCED ? 14 : 36;
    const snow = makeSparks(NS);
    root.add(snow.obj);
    const sd = Array.from({ length: NS }, () => [rnd() * 6.3, Math.sqrt(rnd()) * 1.7, rnd(), 0.1 + rnd() * 0.08]);
    updaters.push((t) => {
      snow.begin();
      sd.forEach(([a, r, ph, sp], i) => {
        const k = (t * sp + ph) % 1;
        snow.push(Math.cos(a + t * 0.2) * r + Math.sin(t + i) * 0.08, Y + 2.3 * (1 - k), Math.sin(a + t * 0.2) * r, 0.09, 0xffffff, 0.9 * Math.min(1, (1 - k) * 5, k * 8));
      });
      snow.end();
    });
  } else if (kind === "volcano") {
    const ter = farTerrain(toon, { R0: 1.15, H: SY + 0.28, seed: 9, top: 0x7cb66a, top2: 0x6aa565, slope: [0x8d7a6e, 0x7d6c62], sand: 0xb3a191 });
    root.add(ter.mesh); addFoam(ter.shore);
    const Y = ter.H;
    // 火山锥：车削，顶上一个凹下去的火山口，口沿偏红
    const pts = [];
    const CH = 1.55, BR = 1.05, TR = 0.3;
    for (let i = 0; i <= 16; i++) { const k = i / 16; pts.push(new THREE.Vector2(BR + (TR - BR) * Math.pow(k, 0.8), k * CH)); }
    pts.push(new THREE.Vector2(TR * 0.8, CH - 0.12), new THREE.Vector2(0.001, CH - 0.2));
    const coneG = new THREE.LatheGeometry(pts, 22);
    const cp = coneG.attributes.position;
    for (let i = 0; i < cp.count; i++) {
      const x = cp.getX(i), z = cp.getZ(i), y = cp.getY(i), a = Math.atan2(z, x), k = 1 + 0.07 * Math.sin(a * 5 + y * 4);
      cp.setX(i, x * k); cp.setZ(i, z * k);
    }
    coneG.computeVertexNormals();
    const parts = [
      part(coneG, (x, y) => (y > CH - 0.14 ? 0xc8604a : y > CH * 0.62 ? 0x6e5c57 : (Math.floor(y / 0.2) % 2 ? 0x8a7468 : 0x7a675d)), [0, Y - 0.05, -0.1]),
    ];
    // 山脚的几丛绿灌木和一棵小椰子
    for (const [x, z, r] of [[0.85, 0.5, 0.2], [-0.8, 0.55, 0.17], [0.15, 0.95, 0.15], [-0.95, -0.1, 0.15]]) parts.push(part(new THREE.SphereGeometry(r, 10, 8), 0x5fae5f, [x, Y + r * 0.5, z], [0, 0, 0], [1, 0.8, 1]));
    root.add(mk(merge(parts), 0.02));
    // 岩浆：火山口里一汪 + 两道顺着山坡流下来的（自发光，一呼一吸）
    const lavaMat = toon(0xff7a2f, { emissive: 0xff5a1f, emissiveIntensity: 0.9 });
    const lavaParts = [part(new THREE.CircleGeometry(TR * 0.82, 16), 0xffffff, [0, Y - 0.05 + CH - 0.13, -0.1], [-Math.PI / 2, 0, 0])];
    for (const a of [0.9, 2.1]) {
      for (let j = 0; j < 5; j++) {
        const k = j / 5, r = TR + (BR - TR) * k * 0.55, y = Y - 0.05 + CH * (1 - k * 0.55) - 0.04;
        lavaParts.push(part(new THREE.SphereGeometry(0.05 - j * 0.004, 8, 6), 0xffffff, [Math.cos(a + j * 0.05) * (r + 0.02), y, -0.1 + Math.sin(a + j * 0.05) * (r + 0.02)], [0, -a, 0.6], [1, 0.4, 1.6]));
      }
    }
    const lava = new THREE.Mesh(merge(lavaParts), lavaMat);
    lava.raycast = noRay;
    root.add(lava);
    const glow = glowSprite(0xff8a3a, 1.5);
    glow.position.set(0, Y + CH + 0.05, -0.1);
    root.add(glow);
    // 烟：几团灰白的球从火山口慢慢冒出来、变大、飘走
    const NSM = REDUCED ? 4 : 7;
    const smoke = new THREE.InstancedMesh(new THREE.SphereGeometry(0.2, 10, 8), toon(0xe6e1dc, { transparent: true, opacity: 0.85, emissive: 0x9a8f88, emissiveIntensity: 0.15 }), NSM);
    smoke.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    smoke.frustumCulled = false; smoke.raycast = noRay;
    root.add(smoke);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
    updaters.push((t) => {
      const pulse = 0.5 + 0.5 * Math.sin(t * 1.7);
      lavaMat.emissiveIntensity = 0.75 + 0.35 * pulse;
      glow.material.opacity = 0.35 + 0.25 * pulse;
      for (let i = 0; i < NSM; i++) {
        const k = (t * 0.09 + i / NSM) % 1;
        p.set(Math.sin(k * 3 + i) * 0.12 + k * 0.7, Y + CH + 0.05 + k * 1.6, -0.1 + Math.cos(k * 2 + i) * 0.1 - k * 0.2);
        sc.setScalar(Math.max(0.001, (0.45 + k * 1.3) * Math.min(1, k * 6) * (1 - smooth(0.75, 1, k))));
        smoke.setMatrixAt(i, m4.compose(p, q.identity(), sc));
      }
      smoke.instanceMatrix.needsUpdate = true;
    });
  }
  root.userData.what = "farisland";
  root.userData.id = kind;
  root.traverse((o) => { o.userData.what = "farisland"; o.userData.id = kind; });
  return { root, update(t) { for (const u of updaters) u(t || 0); } };
}
