// 主岛（第四版地形）：按"设计好的轮廓"生成，而不是在圆上加噪声。
//   - 海岸线 COAST、草地 MEADOW、后面的高台 UPPER 都是手摆的闭合样条，所以有海湾、岬角、码头那一侧的突出。
//   - 高度 = 沙滩 / 水下坡 / 草地（y = 0，角色和装饰都站在这一层）/ 高台（y = 1.5，带一个小山包）几层取最大值，
//     每层的边缘宽度不一样：正面是缓坡沙滩，两侧是矮崖，后面是从海里直接立起来的高崖，高台左端有一条缓坡上去。
//   - 高台前沿有一道大瀑布，落进水潭，再变成一条弯弯的小河流进海里，河上有一座小木桥。
//   - 颜色按坡度：平的是草（有深浅色块和小土路），陡的是一层层岩石（顶点带一点起伏），低处是沙子和湿沙。
import * as THREE from "three";

export const SEA_Y = -0.85;
const UPPER_H = 1.5;

/* ---------------------------------------------------------------- 设计好的轮廓（x, z）；z 正方向朝默认镜头 */
const COAST = [[0.3, 5.4], [2.0, 5.1], [3.7, 4.0], [5.0, 2.4], [5.4, 0.6], [5.3, -1.1], [5.0, -2.7], [4.4, -4.0], [3.6, -5.1], [2.5, -6.2],
  [0.8, -6.65], [-1.4, -6.55], [-3.3, -5.85], [-4.7, -4.6], [-5.4, -3.0], [-5.55, -1.2], [-5.3, 0.6], [-4.7, 2.1], [-3.8, 3.3], [-2.5, 4.3], [-1.0, 5.1]];
const MEADOW = [[0.0, 3.75], [1.3, 3.65], [2.5, 3.1], [3.5, 2.15], [4.05, 0.95], [4.15, -0.4], [3.95, -1.6], [3.5, -2.55], [2.5, -3.35], [1.0, -3.75],
  [-0.6, -3.85], [-2.1, -3.55], [-3.3, -2.75], [-4.0, -1.5], [-4.1, -0.2], [-3.7, 0.75], [-2.85, 1.15], [-2.55, 2.2], [-1.7, 3.15]];
const UPPER = [[-3.0, -3.3], [-1.8, -3.35], [-0.6, -3.65], [0.6, -3.8], [1.55, -3.6], [2.3, -3.75], [3.15, -4.3], [3.05, -5.5], [1.2, -6.05],
  [-1.3, -6.0], [-3.2, -5.2], [-4.3, -4.1]];
// 小河：瀑布下面的水潭 → 绕过右后方 → 入海
export const POOL = { x: -1.25, z: -2.95, r: 0.55 };
const SPRING = { x: -1.7, z: -4.8, r: 0.42 }; // 高台上的泉水小池
const RIVER = [[-1.25, -2.95], [-1.95, -2.75], [-2.6, -2.35], [-3.1, -1.75], [-3.55, -1.1], [-4.1, -0.7], [-4.8, -0.45], [-5.6, -0.3], [-6.3, -0.2]];
// 高台上的小泉眼 → 瀑布口
const CREEK = [[-1.6, -4.45], [-1.42, -4.05], [-1.25, -3.68]];
export const FALL_TOP = { x: -1.25, z: -3.54 };
export const BRIDGE = { x: -3.1, z: -1.75 };
// 土路：家 → 码头，家 → 床，家 → 小桥
const PATHS = [[[0.35, 0.75], [0.5, 1.6], [0.6, 2.45], [0.75, 3.4]], [[0.35, 0.75], [-0.4, 0.15], [-1.1, -0.35], [-2.0, -0.95], [-2.65, -1.35]], [[0.35, 0.75], [1.2, 0.2], [2.0, -0.2]]];

/* ---------------------------------------------------------------- 小工具 */
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const hash2 = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
function vnoise(x, y) {
  const i = Math.floor(x), j = Math.floor(y), u = x - i, v = y - j, su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
  const a = hash2(i, j), b = hash2(i + 1, j), c = hash2(i, j + 1), d = hash2(i + 1, j + 1);
  return (a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv) * 2 - 1;
}
const fbm = (x, y) => vnoise(x, y) * 0.6 + vnoise(x * 2.1 + 5, y * 2.1) * 0.3 + vnoise(x * 4.3, y * 4.3 + 9) * 0.1;

// 闭合样条 → 折线，带符号距离（里面为负）
function polyFrom(pts, closed = true, n = 200) {
  const curve = new THREE.CatmullRomCurve3(pts.map(([x, z]) => new THREE.Vector3(x, 0, z)), closed, "centripetal");
  return curve.getSpacedPoints(n).map((p) => [p.x, p.z]);
}
function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / L));
  return Math.hypot(px - ax - dx * t, pz - az - dz * t);
}
function makeSDF(poly) {
  // 粗筛：包围盒外面直接用到包围盒的距离下界，省点算力
  return (x, z) => {
    let d = Infinity, inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [ax, az] = poly[j], [bx, bz] = poly[i];
      const s = segDist(x, z, ax, az, bx, bz);
      if (s < d) d = s;
      if ((az > z) !== (bz > z) && x < ((bx - ax) * (z - az)) / (bz - az) + ax) inside = !inside;
    }
    return inside ? -d : d;
  };
}
function makeLineDist(poly) {
  return (x, z) => {
    let d = Infinity, t = 0, best = 0, acc = 0;
    for (let i = 1; i < poly.length; i++) {
      const [ax, az] = poly[i - 1], [bx, bz] = poly[i];
      const s = segDist(x, z, ax, az, bx, bz);
      const len = Math.hypot(bx - ax, bz - az);
      if (s < d) { d = s; best = acc; }
      acc += len;
    }
    return d;
  };
}

/* ---------------------------------------------------------------- 高度 */
const coastSD = makeSDF(polyFrom(COAST));
const meadowSD = makeSDF(polyFrom(MEADOW));
const upperSD = makeSDF(polyFrom(UPPER));
const riverPoly = polyFrom(RIVER, false, 80), creekPoly = polyFrom(CREEK, false, 20);
const riverD = makeLineDist(riverPoly), creekD = makeLineDist(creekPoly);
const pathDs = PATHS.map((p) => makeLineDist(polyFrom(p, false, 30)));

// 不带河道的地形（河面高度也用它）
function landH(x, z) {
  const dC = coastSD(x, z);
  // 沙滩 / 水下：海岸线上正好是海面
  let h = dC <= 0 ? SEA_Y + 0.2 * smooth(0, 1.1, -dC) : SEA_Y - Math.min(1.5, 0.35 * dC + 0.22 * dC * dC);
  // 草地：正面缓（坡宽 1.25），两侧矮崖（0.32）
  const wM = 0.32 + 0.93 * smooth(-0.6, 2.2, z) * (1 - smooth(3.2, 4.2, Math.abs(x)) * 0.6);
  const dM = meadowSD(x, z) + fbm(x * 0.9, z * 0.9) * 0.08;
  if (dM < wM) {
    const k = 1 - smooth(0, wM, dM);
    h = Math.max(h, h + (0 - h) * (wM > 0.6 ? k : Math.pow(k, 0.55)));
  }
  // 高台：边缘陡（0.3），左端一条缓坡（坡宽 1.9），中间偏后一个小山包
  const wU = 0.3 + 1.6 * smooth(-2.9, -3.9, x);
  const dU = upperSD(x, z) + fbm(x * 1.3 + 3, z * 1.3) * 0.07;
  if (dU < wU) {
    const k = 1 - smooth(0, wU, dU);
    const hill = 0.75 * Math.exp(-((x + 0.9) ** 2 + (z + 5.0) ** 2) / 1.6) + 0.35 * Math.exp(-((x - 2.4) ** 2 + (z + 5.1) ** 2) / 0.6);
    const top = UPPER_H + hill * smooth(0.1, -0.9, dU);
    const base = h;
    const prof = wU > 1 ? k * k * (3 - 2 * k) : Math.pow(k, 0.5);
    h = Math.max(h, base + (top - base) * prof);
  }
  return h;
}
function carve(x, z, h) {
  // 水潭
  const dp = Math.hypot(x - POOL.x, z - POOL.z);
  if (dp < POOL.r + 0.35) h = Math.min(h, h - 0.42 * (1 - smooth(POOL.r * 0.6, POOL.r + 0.35, dp)));
  // 小河：越往下游越宽
  const dr = riverD(x, z);
  if (dr < 0.55) h -= 0.3 * (1 - smooth(0.16, 0.42, dr));
  // 高台上的小溪
  const dk = creekD(x, z);
  if (dk < 0.45 && h > 1.2) h -= 0.18 * (1 - smooth(0.14, 0.34, dk));
  const ds = Math.hypot(x - SPRING.x, z - SPRING.z);
  if (ds < SPRING.r + 0.25 && h > 1.2) h -= 0.22 * (1 - smooth(SPRING.r * 0.6, SPRING.r + 0.25, ds));
  return h;
}
export const heightAt = (x, z) => carve(x, z, landH(x, z));

/* ---------------------------------------------------------------- 网格 */
const C = (h) => new THREE.Color(h);
const PAL = {
  grass: [C(0x9ad978), C(0x8fd06e), C(0xa9e284), C(0x86c765)], grassTop: C(0xb4e48c), grassEdge: C(0x6cb95a),
  path: C(0xead2a0), rock: [C(0xc79a72), C(0xdcb486), C(0xb08a6e), C(0xd1a47a), C(0xa89486)],
  sand: C(0xf6e0ab), wet: C(0xdcc38c), shallow: C(0xbfcf9e), deep: C(0x76aea6),
};

export function buildMainIsland({ material }) {
  const X0 = -7, X1 = 7, Z0 = -8, Z1 = 7, STEP = 0.085;
  const nx = Math.round((X1 - X0) / STEP) + 1, nz = Math.round((Z1 - Z0) / STEP) + 1;
  const pos = new Float32Array(nx * nz * 3);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = X0 + i * STEP, z = Z0 + j * STEP, k = (j * nx + i) * 3;
    pos[k] = x; pos[k + 1] = heightAt(x, z); pos[k + 2] = z;
  }
  const idx = [];
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
    // 交替对角线，坡面不会出现一排排斜纹
    if ((i + j) % 2) idx.push(a, c, b, b, c, d); else idx.push(a, c, d, a, d, b);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  // 陡坡上的顶点往外鼓一点点，岩壁就有起伏，不像一张拉伸的皮
  const nrm = geo.attributes.normal;
  for (let v = 0; v < nx * nz; v++) {
    const ny = nrm.getY(v);
    if (ny > 0.62) continue;
    const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
    const n = vnoise(x * 3.1 + y * 2.3, z * 3.1 - y * 1.7) * 0.5 + vnoise(x * 7 + y * 5, z * 7) * 0.25;
    const s = (0.62 - ny) * 0.17 * n;
    pos[v * 3] += nrm.getX(v) * s; pos[v * 3 + 2] += nrm.getZ(v) * s;
  }
  geo.computeVertexNormals();

  // 顶点色
  const col = new Float32Array(nx * nz * 3), snow = new Float32Array(nx * nz), c = new THREE.Color();
  for (let v = 0; v < nx * nz; v++) {
    const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2], ny = nrm.getY(v);
    let sn = 0;
    if (y < SEA_Y - 0.02) {
      const d = Math.min(1, (SEA_Y - y) / 1.2);
      c.copy(PAL.wet).lerp(PAL.shallow, Math.min(1, d * 1.7)).lerp(PAL.deep, Math.max(0, d - 0.35) * 1.4);
    } else if (y < SEA_Y + 0.24 && ny > 0.55) {
      c.copy(PAL.sand);
      if (y < SEA_Y + 0.05) c.lerp(PAL.wet, 0.55);
    } else if (ny < 0.68) {
      // 岩层：按高度分带，带子边界有一点噪声；越陡越"石头"
      const band = Math.floor((y - SEA_Y) / 0.27 + vnoise(x * 1.7, z * 1.7) * 0.45);
      c.copy(PAL.rock[((band % 5) + 5) % 5]);
      const shade = 0.92 + 0.12 * vnoise(x * 6, y * 6 + z * 3);
      c.multiplyScalar(shade);
      if (ny > 0.5) c.lerp(PAL.grassEdge, (ny - 0.5) / 0.18 * 0.8); // 崖顶过渡到草
    } else {
      // 草地：大块的深浅色斑 + 高台更亮一点
      const p = fbm(x * 0.45 + 11, z * 0.45);
      const g = PAL.grass[Math.max(0, Math.min(3, Math.floor((p * 0.5 + 0.5) * 4)))];
      c.copy(g);
      if (y > 1.0) c.lerp(PAL.grassTop, 0.4);
      if (ny < 0.85) c.lerp(PAL.grassEdge, (0.85 - ny) / 0.17 * 0.7);
      if (y < -0.05 && y > SEA_Y + 0.2) c.lerp(PAL.sand, smooth(-0.1, SEA_Y + 0.25, y) * 0.9); // 草地往沙滩过渡
      // 小土路
      if (Math.abs(y) < 0.02) {
        let dp = Infinity;
        for (const f of pathDs) dp = Math.min(dp, f(x, z));
        if (dp < 0.24) c.lerp(PAL.path, (1 - smooth(0.12, 0.24, dp + vnoise(x * 5, z * 5) * 0.05)) * 0.95);
      }
      sn = 1;
    }
    col[v * 3] = c.r; col[v * 3 + 1] = c.g; col[v * 3 + 2] = c.b;
    snow[v] = sn;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  geo.setAttribute("snowable", new THREE.BufferAttribute(snow, 1));
  const mesh = new THREE.Mesh(geo, material);
  mesh.receiveShadow = true;

  // 海岸半径：沿每个角度从外往里找第一个高于海面的点
  function shoreR(a) {
    const ca = Math.cos(a), sa = Math.sin(a);
    for (let r = 9; r > 0; r -= 0.05) if (landH(ca * r, sa * r) > SEA_Y) {
      let lo = r, hi = r + 0.05;
      for (let i = 0; i < 12; i++) { const m = (lo + hi) / 2; if (landH(ca * m, sa * m) > SEA_Y) lo = m; else hi = m; }
      return lo;
    }
    return 0;
  }
  return { mesh, height: heightAt, shoreR, meadowSD, upperSD, riverD, coastSD };
}

/* ---------------------------------------------------------------- 水：瀑布、水潭、小河、小溪 */
export function buildWater({ toon, outlined }) {
  const g = new THREE.Group();
  const U = { uT: { value: 0 } };
  const flow = (speed, alpha = 0.92, foamEdge = 0.14) => new THREE.ShaderMaterial({
    uniforms: U, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }",
    fragmentShader: `varying vec2 vUv; uniform float uT;
      void main(){
        float s = fract(vUv.y * 2.2 - uT * ${speed.toFixed(2)} + sin(vUv.x * 9.0 + vUv.y * 3.0) * 0.12);
        float s2 = fract(vUv.y * 5.3 - uT * ${(speed * 1.6).toFixed(2)} + vUv.x * 0.7);
        vec3 c = mix(vec3(0.40, 0.78, 0.92), vec3(0.58, 0.88, 0.97), smoothstep(0.35, 0.65, s) * 0.8);
        c = mix(c, vec3(0.95, 0.99, 1.0), smoothstep(0.8, 0.95, s2) * 0.75);
        float e = min(vUv.x, 1.0 - vUv.x);
        c = mix(vec3(1.0), c, smoothstep(0.0, ${foamEdge.toFixed(2)}, e));
        gl_FragColor = vec4(c, ${alpha.toFixed(2)});
      }`,
  });
  // 沿折线铺一条水面带子：y 用（没挖河道的）地形高度往下一点
  function ribbon(poly, w0, w1, yOf, mat) {
    const pts = [], uvs = [], idx = [];
    let acc = 0;
    for (let i = 0; i < poly.length; i++) {
      const [x, z] = poly[i], [px, pz] = poly[Math.max(0, i - 1)], [nx2, nz2] = poly[Math.min(poly.length - 1, i + 1)];
      const tx = nx2 - px, tz = nz2 - pz, L = Math.hypot(tx, tz) || 1;
      const ox = -tz / L, oz = tx / L, w = (w0 + (w1 - w0) * (i / (poly.length - 1))) / 2;
      if (i) acc += Math.hypot(x - poly[i - 1][0], z - poly[i - 1][1]);
      const y = yOf(x, z, i);
      pts.push(x + ox * w, y, z + oz * w, x - ox * w, y, z - oz * w);
      uvs.push(0, acc, 1, acc);
      if (i) { const a = (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(idx);
    const m = new THREE.Mesh(geo, mat);
    m.raycast = () => {};
    m.renderOrder = 2;
    return m;
  }
  // 小河：河面跟着地势往下走，入海处贴着海面
  const riverY = (x, z) => Math.max(SEA_Y + 0.015, Math.min(-0.1, landH(x, z) - 0.12));
  g.add(ribbon(riverPoly, 0.5, 0.8, riverY, flow(0.55, 0.9)));
  // 高台上的小溪
  g.add(ribbon(creekPoly, 0.42, 0.56, (x, z) => landH(x, z) - 0.08, flow(0.8, 0.92, 0.18)));
  // 水潭
  const pool = new THREE.Mesh(new THREE.CircleGeometry(POOL.r + 0.06, 36), new THREE.ShaderMaterial({
    uniforms: U, transparent: true, depthWrite: false,
    vertexShader: "varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }",
    fragmentShader: `varying vec2 vP; uniform float uT;
      void main(){
        float r = length(vP);
        vec3 c = mix(vec3(0.45, 0.82, 0.93), vec3(0.32, 0.68, 0.86), smoothstep(0.0, 0.6, r));
        float ring = step(0.82, fract(r * 3.0 - uT * 0.6)) * (1.0 - smoothstep(0.2, 0.68, r));
        c = mix(c, vec3(0.9, 0.97, 1.0), ring * 0.7 + (1.0 - smoothstep(0.52, 0.68, r)) * 0.0);
        c = mix(c, vec3(1.0), smoothstep(0.58, 0.68, r) * 0.9);
        gl_FragColor = vec4(c, 0.93);
      }`,
  }));
  pool.rotation.x = -Math.PI / 2;
  pool.position.set(POOL.x, -0.11, POOL.z);
  pool.raycast = () => {};
  g.add(pool);
  // 高台上的泉水小池：水面 + 一圈大小不一的圆石
  const sy = landH(SPRING.x, SPRING.z);
  const spring = new THREE.Mesh(new THREE.CircleGeometry(SPRING.r + 0.04, 28), pool.material);
  spring.rotation.x = -Math.PI / 2;
  spring.position.set(SPRING.x, sy - 0.1, SPRING.z);
  spring.scale.setScalar(0.95);
  spring.raycast = () => {};
  g.add(spring);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + 0.3;
    if (Math.abs(((a - Math.atan2(CREEK[1][1] - SPRING.z, CREEK[1][0] - SPRING.x) + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 0.45) continue; // 出水口空着
    const r = outlined(new THREE.Mesh(new THREE.DodecahedronGeometry(0.09 + (i % 3) * 0.035, 0), toon(i % 2 ? 0xc4bab0 : 0xb1a69b)), 0.018);
    r.position.set(SPRING.x + Math.cos(a) * (SPRING.r + 0.08), sy - 0.03, SPRING.z + Math.sin(a) * (SPRING.r + 0.08));
    r.rotation.set(i, i * 2, 0);
    r.scale.y = 0.75;
    g.add(r);
  }

  // 河岸：鹅卵石沿着两岸、芦苇一丛丛长在弯道和水潭边、水潭里几片荷叶
  const rnd = (() => { let sd = 3; return () => (sd = (sd * 16807) % 2147483647) / 2147483647; })();
  const pebbleCols = [0xc9bfb3, 0xb6aa9c, 0xd8cfc3, 0xa99d90];
  const bank = (poly, w0, w1, every, yOf) => {
    for (let i = 1; i < poly.length - 1; i += every) {
      const [x, z] = poly[i], [px, pz] = poly[i - 1], [nx2, nz2] = poly[i + 1];
      const tx = nx2 - px, tz = nz2 - pz, L = Math.hypot(tx, tz) || 1, w = (w0 + (w1 - w0) * (i / (poly.length - 1))) / 2;
      for (const side of [-1, 1]) {
        if (rnd() < 0.35) continue;
        const off = w + 0.06 + rnd() * 0.12, bx = x - (tz / L) * off * side, bz = z + (tx / L) * off * side;
        const r = outlined(new THREE.Mesh(new THREE.DodecahedronGeometry(0.045 + rnd() * 0.06, 0), toon(pebbleCols[Math.floor(rnd() * 4)])), 0.012);
        r.position.set(bx, yOf(bx, bz) - 0.01, bz);
        r.scale.y = 0.6; r.rotation.set(rnd() * 3, rnd() * 3, 0);
        g.add(r);
      }
    }
  };
  bank(riverPoly, 0.5, 0.8, 3, (x, z) => heightAt(x, z));
  bank(creekPoly, 0.42, 0.56, 2, (x, z) => heightAt(x, z));
  const reedGeo = new THREE.ConeGeometry(0.018, 0.42, 4); reedGeo.translate(0, 0.21, 0);
  const reedMat = toon(0x6fae55), tipMat = toon(0x9a6a43);
  const reeds = (x, z, n) => {
    const y = heightAt(x, z);
    for (let i = 0; i < n; i++) {
      const r = new THREE.Mesh(reedGeo, reedMat);
      r.position.set(x + (rnd() - 0.5) * 0.25, y - 0.02, z + (rnd() - 0.5) * 0.25);
      r.rotation.set((rnd() - 0.5) * 0.35, 0, (rnd() - 0.5) * 0.35);
      r.scale.y = 0.7 + rnd() * 0.6;
      if (i % 2 === 0) { // 香蒲的小棒头
        const tip = new THREE.Mesh(new THREE.CapsuleGeometry(0.026, 0.07, 2, 6), tipMat);
        tip.position.y = 0.38; r.add(tip);
      }
      r.raycast = () => {};
      g.add(r);
    }
  };
  for (const [x, z, n] of [[-0.6, -2.55, 6], [-1.85, -2.35, 5], [-2.25, -3.05, 4], [-3.6, -1.65, 5], [-2.75, -1.45, 4], [-4.15, -1.05, 4]]) reeds(x, z, n);
  const padMat = toon(0x6cc06a, { side: THREE.DoubleSide });
  for (const [dx, dz, s, flower] of [[0.18, 0.12, 1, 1], [-0.22, 0.05, 0.8, 0], [0.02, -0.25, 0.9, 0]]) {
    const pad = new THREE.Mesh(new THREE.CircleGeometry(0.12, 14, 0.3, Math.PI * 2 - 0.6), padMat);
    pad.rotation.x = -Math.PI / 2; pad.rotation.z = dx * 9;
    pad.position.set(POOL.x + dx, -0.095, POOL.z + dz);
    pad.scale.setScalar(s);
    pad.raycast = () => {};
    g.add(pad);
    if (flower) {
      const f = new THREE.Group();
      for (let k = 0; k < 6; k++) {
        const pt = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), toon(0xffb7cf));
        pt.scale.set(0.6, 0.5, 1.2);
        const a = (k / 6) * Math.PI * 2;
        pt.position.set(Math.cos(a) * 0.04, 0.02, Math.sin(a) * 0.04);
        pt.rotation.y = -a;
        f.add(pt);
      }
      const ctr = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), toon(0xffe37a));
      ctr.position.y = 0.04; f.add(ctr);
      f.position.set(POOL.x + dx, -0.09, POOL.z + dz);
      g.add(f);
    }
  }

  // 瀑布：从高台边上往前鼓出去再落进水潭，宽 0.75、高 1.6
  const FW = 0.6, FH = UPPER_H + 0.1 + 0.11;
  const fallGeo = new THREE.PlaneGeometry(FW, FH, 6, 14);
  { const p = fallGeo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), k = (FH / 2 - y) / FH; // 0 顶 .. 1 底
      p.setZ(i, 0.42 * Math.sin(Math.min(1, k * 1.25) * Math.PI * 0.5) + 0.05 * Math.sin(x * 9) * k);
      p.setY(i, UPPER_H - 0.06 - k * FH);
      p.setX(i, x * (1 + 0.3 * k));
    } }
  const fallMat = flow(1.6, 0.94, 0.16);
  fallMat.fragmentShader = fallMat.fragmentShader.replace("gl_FragColor", "c = mix(c, vec3(1.0), smoothstep(0.9, 0.97, vUv.y) + smoothstep(0.12, 0.0, vUv.y) * 0.9);\n        gl_FragColor");
  const fall = new THREE.Mesh(fallGeo, fallMat);
  // 朝向：沿河潭方向（从瀑布口指向水潭）
  const fdx = POOL.x - FALL_TOP.x, fdz = POOL.z - FALL_TOP.z;
  fall.position.set(FALL_TOP.x, 0, FALL_TOP.z);
  fall.rotation.y = Math.atan2(fdx, fdz);
  fall.raycast = () => {};
  fall.renderOrder = 3;
  g.add(fall);
  // 瀑布脚下的水花 + 水雾
  const foam = Array.from({ length: 9 }, (_, i) => {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false }));
    b.userData.p = i / 9; b.raycast = () => {};
    g.add(b);
    return b;
  });
  const foot = new THREE.Vector3(FALL_TOP.x + Math.sin(fall.rotation.y) * 0.45, -0.1, FALL_TOP.z + Math.cos(fall.rotation.y) * 0.45);
  const mistTex = (() => {
    const cv = document.createElement("canvas"); cv.width = cv.height = 64;
    const x = cv.getContext("2d"), gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, "rgba(255,255,255,0.75)"); gr.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(cv);
  })();
  const mist = Array.from({ length: 4 }, (_, i) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: mistTex, transparent: true, depthWrite: false }));
    s.userData.p = i / 4; s.raycast = () => {};
    g.add(s);
    return s;
  });

  // 小木桥（拱形），横跨小河
  const bridge = new THREE.Group();
  const wood = [0xc99a6b, 0xb88a5c];
  for (let i = 0; i < 9; i++) {
    const t = (i - 4) / 4, plank = outlined(new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.06, 0.15), toon(wood[i % 2])), 0.012);
    plank.position.set(0, 0.06 + 0.24 * (1 - t * t), t * 0.66);
    plank.rotation.x = -t * 0.45;
    bridge.add(plank);
  }
  for (const s of [-1, 1]) {
    for (let i = 0; i < 5; i++) {
      const t = (i - 2) / 2, post = outlined(new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.28, 6), toon(0x9a6f4a)), 0.01);
      post.position.set(s * 0.29, 0.2 + 0.24 * (1 - t * t) + 0.08, t * 0.66);
      bridge.add(post);
    }
    const rail = new THREE.CatmullRomCurve3([-1, -0.5, 0, 0.5, 1].map((t) => new THREE.Vector3(s * 0.29, 0.36 + 0.24 * (1 - t * t), t * 0.68)));
    bridge.add(outlined(new THREE.Mesh(new THREE.TubeGeometry(rail, 16, 0.022, 5), toon(0xb07e52)), 0.008));
  }
  // 桥垂直于河的走向
  const bi = riverPoly.findIndex(([x, z]) => Math.hypot(x - BRIDGE.x, z - BRIDGE.z) < 0.12);
  const [ax, az] = riverPoly[Math.max(0, bi - 2)], [bx, bz] = riverPoly[Math.min(riverPoly.length - 1, bi + 2)];
  bridge.position.set(BRIDGE.x, -0.06, BRIDGE.z);
  bridge.rotation.y = Math.atan2(bx - ax, bz - az) + Math.PI / 2;
  g.add(bridge);

  function update(t) {
    U.uT.value = t;
    foam.forEach((b, i) => {
      const p = (t * 0.9 + b.userData.p) % 1, a = i * 2.1;
      b.position.set(foot.x + Math.cos(a) * p * 0.5, -0.08 + Math.sin(p * Math.PI) * 0.22, foot.z + Math.sin(a) * p * 0.4);
      b.scale.setScalar(0.5 + p * 1.1);
      b.material.opacity = (1 - p) * 0.95;
    });
    mist.forEach((s, i) => {
      const p = (t * 0.25 + s.userData.p) % 1;
      s.position.set(foot.x + Math.sin(i * 2) * 0.2, 0.05 + p * 0.9, foot.z + Math.cos(i * 2) * 0.15);
      s.scale.setScalar(0.6 + p * 1.0);
      s.material.opacity = Math.sin(p * Math.PI) * 0.55;
    });
  }
  return { group: g, update, bridge };
}
