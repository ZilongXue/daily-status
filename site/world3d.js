// 小岛的"世界"：地形（草地 + 岩层 + 沙滩）、海、瀑布、草丛、远处的小岛、云、蝴蝶 / 海鸥 / 萤火虫 / 跳出水的小鱼、钓鱼码头。
// 全部程序生成，没有外部模型。scene3d.js 负责小伙伴和互动，这里只管环境。
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { buildMainIsland, buildWater, heightAt as mainHeight, POOL, MAP, PATH_LINES, softRock } from "./island3d.js?v=16";
import { buildHome, glowSprite, STONE_PATH, HOME, season } from "./home3d.js?v=16";
import { cloudGeometry } from "./weather3d.js?v=16";

// 二维值噪声（草丛成片、石头摆放用）
const hash2 = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
function vnoise2(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy), b = hash2(ix + 1, iy), c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function segD(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(px - ax - dx * t, pz - az - dz * t);
}
const lineD = (x, z, pts) => { let d = Infinity; for (let i = 0; i < pts.length - 1; i++) d = Math.min(d, segD(x, z, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1])); return d; };

export const SEA_Y = -0.85;   // 海面高度（草地表面是 y = 0）
export const ISLAND_R = 3.25; // 草地的最小半径（装饰的位置都按这个算）

// 码头：从岛的正前方偏右伸进海里。钓鱼的小伙伴站在 DOCK.tip，朝 DOCK.dir 看。
const DOCK_A = Math.atan2(3.05, 0.75); // 角度（从 +x 量起）
const DOCK_DIR = new THREE.Vector3(Math.cos(DOCK_A), 0, Math.sin(DOCK_A));
export const DOCK = {
  dir: DOCK_DIR,
  base: DOCK_DIR.clone().multiplyScalar(2.45),
  tip: DOCK_DIR.clone().multiplyScalar(6.2),
  bobber: DOCK_DIR.clone().multiplyScalar(7.9).setY(SEA_Y),
};

const angDist = (a, b) => Math.abs(((a - b + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
const bump = (d, w) => Math.max(0, 1 - (d / w) ** 2);

// 一维循环噪声：给岛的边缘一点起伏
const hash1 = (n) => { const s = Math.sin(n * 127.1) * 43758.5453; return s - Math.floor(s); };
function rimNoise(a, seed = 0) {
  let v = 0, amp = 1, tot = 0;
  for (const f of [3, 7, 13]) {
    const x = (a / (Math.PI * 2)) * f, i = Math.floor(x), u = x - i, s = u * u * (3 - 2 * u);
    v += amp * (hash1((i % f) + seed * 31 + f) * (1 - s) + hash1(((i + 1) % f) + seed * 31 + f) * s);
    tot += amp; amp *= 0.5;
  }
  return v / tot; // 0..1
}
// 把圆柱的侧面按角度往外推（只往外推，保证草地半径 ≥ ISLAND_R）
function wobble(geo, amt, seed, rMin = 0.5) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), r = Math.hypot(x, z);
    if (r < rMin) continue;
    const k = 1 + amt * rimNoise(Math.atan2(z, x) + Math.PI, seed);
    p.setX(i, x * k); p.setZ(i, z * k);
  }
  geo.computeVertexNormals();
  return geo;
}


/* ---------------------------------------------------------------- 高度场小岛
   一整块连续的地形：中间是平的草地（y = H），往外先是一段坡（缓坡是草，陡崖是一层层岩石），
   再是沙滩，然后慢慢没入浅水。海岸线按角度起伏，所以不是一个规整的圆。 */
const C3 = (h) => new THREE.Color(h);
const PAL = {
  grass: [C3(0x9ad978), C3(0x8ccf6c), C3(0xa6e084)], grassDark: C3(0x74bd5f),
  strata: [C3(0xcf9a6a), C3(0xe6bd88), C3(0xb69a86), C3(0xd9a877)],
  sand: C3(0xf7e2ae), wet: C3(0xe3c98f), shallow: C3(0xbfcf9e), deep: C3(0x6fa8a0),
};
export function makeIsland({ R0, H = 0, seed = 1, cliff = () => 0, wob = 0.14, slope = [1.35, 0.32], beach = [0.75, 0.12], rMax = 9, segs = 160, grassy = 1 }) {
  const beachY = SEA_Y + 0.1;
  const edge = (a) => R0 * (1 + wob * rimNoise(a + Math.PI, seed));
  function height(r, a) {
    const e = edge(a), c = cliff(a);
    if (r <= e) return H;
    const w = slope[0] + (slope[1] - slope[0]) * c;
    const x = (r - e) / w;
    if (x < 1) {
      const s = c > 0.5 ? Math.pow(x, 0.75 + 0.5 * (1 - c)) * (1.1 - 0.1 * x) : x * x * (3 - 2 * x);
      const bumpy = c * 0.05 * Math.sin(a * 37 + r * 9) * Math.sin(x * Math.PI);
      return H + (beachY - H) * Math.min(1, s) + bumpy;
    }
    const bw = beach[0] + (beach[1] - beach[0]) * c, r2 = r - e - w;
    if (r2 < bw) return beachY - r2 * 0.14;
    const r3 = r2 - bw;
    return Math.max(SEA_Y - 1.4, beachY - bw * 0.14 - r3 * 0.5 - r3 * r3 * 0.12);
  }
  // 环：中间稀，海岸附近密，远处再稀
  const rings = [];
  for (let r = 0.0; r < R0 * 0.8; r += 0.45) rings.push(r);
  for (let r = R0 * 0.8; r < R0 * (1 + wob) + slope[0] + beach[0] + 1.2; r += 0.07) rings.push(r);
  for (let r = rings[rings.length - 1] + 0.3; r <= rMax; r += 0.5) rings.push(r);
  const pos = [], col = [], snow = [], idx = [];
  const tmpC = new THREE.Color();
  for (let i = 0; i < rings.length; i++) {
    const r = rings[i];
    const n = i === 0 ? 1 : segs;
    for (let k = 0; k < n; k++) {
      const a = (k / segs) * Math.PI * 2;
      const x = Math.cos(a) * r, z = Math.sin(a) * r, y = height(r, a);
      pos.push(x, y, z);
      // 颜色：按高度和陡峭程度
      const e = edge(a), c = cliff(a);
      let sn = 0;
      if (y >= H - 0.02 && r <= e + 0.05) {
        const v = rimNoise(a * 3 + r * 0.7, seed + 7);
        tmpC.copy(PAL.grass[Math.floor(v * 2.99)]);
        if (grassy < 1) tmpC.lerp(PAL.sand, 1 - grassy);
        sn = 1;
      } else if (y > beachY + 0.04) {
        const depth = (H - y) / Math.max(0.01, H - beachY); // 0 顶 .. 1 底
        if (c > 0.45) {
          const band = Math.floor((H - y) / 0.2 + rimNoise(a * 4, seed + 3) * 0.8);
          tmpC.copy(PAL.strata[((band % 4) + 4) % 4]);
          if (depth < 0.08) tmpC.copy(PAL.grassDark); // 崖顶一圈草皮边
        } else {
          tmpC.copy(PAL.grassDark).lerp(PAL.grass[0], 0.4);
          tmpC.lerp(PAL.sand, Math.max(0, (depth - 0.6) / 0.4));
          sn = 1 - depth;
        }
        if (grassy < 1 && c <= 0.45) tmpC.lerp(PAL.sand, 1 - grassy);
      } else if (y > SEA_Y - 0.02) {
        tmpC.copy(PAL.sand);
      } else {
        const d = Math.min(1, (SEA_Y - y) / 1.0);
        tmpC.copy(PAL.wet).lerp(PAL.shallow, Math.min(1, d * 1.6)).lerp(PAL.deep, Math.max(0, d - 0.4));
      }
      col.push(tmpC.r, tmpC.g, tmpC.b);
      snow.push(sn);
    }
  }
  // 三角形
  const start = (i) => (i === 0 ? 0 : 1 + (i - 1) * segs);
  for (let k = 0; k < segs; k++) idx.push(0, start(1) + ((k + 1) % segs), start(1) + k);
  for (let i = 1; i < rings.length - 1; i++) {
    const a0 = start(i), b0 = start(i + 1);
    for (let k = 0; k < segs; k++) {
      const k1 = (k + 1) % segs;
      idx.push(a0 + k, a0 + k1, b0 + k, a0 + k1, b0 + k1, b0 + k);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute("snowable", new THREE.Float32BufferAttribute(snow, 1));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  // 海岸线：每个角度上地形穿过海面的半径（给海面的白浪用）
  function shoreR(a) {
    let lo = 0, hi = rMax;
    for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (height(m, a) > SEA_Y) lo = m; else hi = m; }
    return lo;
  }
  return { geo, height, edge, shoreR };
}

// 地形材质：顶点色 + 卡通光照 + 下雪时草地部分变白。
// 陡坡（岩壁）的颜色不用顶点色：网格是 0.085 一格的高度场，一面崖只有两三个顶点高，顶点色会被拉成一条条竖纹。
// 改成在像素里按"世界高度"算水平的岩层：一层一层颜色交替，每层底下一道暗缝、顶上一道亮边，边界带一点噪声起伏。
const ROCK = [0xc79a72, 0xdcb486, 0xb08a6e, 0xd1a47a, 0xa89486].map((h) => new THREE.Color(h));
function terrainMaterial(toon, snowU) {
  const m = toon(0xffffff, { vertexColors: true });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uSnow = snowU;
    sh.uniforms.uRock = { value: ROCK };
    sh.vertexShader = "attribute float snowable;\nvarying float vSnow;\nvarying vec3 vWPos;\nvarying vec3 vWN;\n" + sh.vertexShader.replace("#include <begin_vertex>",
      "#include <begin_vertex>\nvSnow = snowable;\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWN = normalize(mat3(modelMatrix) * objectNormal);");
    sh.fragmentShader = `uniform float uSnow; uniform vec3 uRock[5];
varying float vSnow; varying vec3 vWPos; varying vec3 vWN;
float th(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float tn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(th(i), th(i + vec2(1.0, 0.0)), f.x), mix(th(i + vec2(0.0, 1.0)), th(i + vec2(1.0, 1.0)), f.x), f.y); }
` + sh.fragmentShader.replace("#include <color_fragment>", `#include <color_fragment>
{
  float rockK = smoothstep(0.7, 0.56, normalize(vWN).y) * smoothstep(${(SEA_Y + 0.12).toFixed(2)}, ${(SEA_Y + 0.3).toFixed(2)}, vWPos.y);
  if (rockK > 0.001) {
    float b = (vWPos.y - ${SEA_Y.toFixed(2)}) / 0.27 + tn(vWPos.xz * 1.6) * 0.55 + tn(vWPos.xz * 5.0) * 0.12;
    float band = floor(b), f = fract(b);
    int bi = int(mod(band, 5.0));
    vec3 rc = uRock[0];
    if (bi == 1) rc = uRock[1]; else if (bi == 2) rc = uRock[2]; else if (bi == 3) rc = uRock[3]; else if (bi == 4) rc = uRock[4];
    rc *= 0.93 + 0.12 * tn(vec2(vWPos.x * 4.0 + vWPos.z * 3.0, vWPos.y * 7.0));
    rc *= mix(0.74, 1.0, smoothstep(0.0, 0.1, f));   // 每层底下的暗缝
    rc = mix(rc, rc * 1.12, smoothstep(0.86, 0.95, f)); // 每层顶上的亮边
    diffuseColor.rgb = mix(diffuseColor.rgb, rc, rockK);
  }
}
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.94, 0.96, 1.0), uSnow * vSnow);`);
  };
  m.customProgramCacheKey = () => "terrain-strata";
  return m;
}

const SEASON = season();
export function createWorld({ scene, world, toon, outlined, tag }) {
  const env = new THREE.Group();
  world.add(env);
  const updaters = [];
  const mk = (geo, color, line = 0.03, extra) => outlined(new THREE.Mesh(geo, toon(color, extra)), line);

  /* ------------------------------------------------------------ 地形 */
  // decor3d 下雪时会把 top.material.color 往白色插值；这里用一个"代理"颜色接住它，反推出积雪比例
  const GRASS0 = new THREE.Color(0x9ad978), SNOWC = new THREE.Color(0xf3f7ff);
  const top = { material: { color: GRASS0.clone() } };
  const snowU = { value: 0 };
  updaters.push(() => { snowU.value = Math.max(0, Math.min(1, (top.material.color.r - GRASS0.r) / (SNOWC.r - GRASS0.r))); });
  const isl = buildMainIsland({ material: terrainMaterial(toon, snowU) });
  const ground = isl.mesh;
  env.add(tag(ground, "ground"));
  // 沙滩：几小堆大小不一的圆石（不是一圈等距的碎石），几枚贝壳、海星，两根浮木。都顺着真实的海岸线摆，避开码头和河口。
  const shellCols = [0xffc4d0, 0xfff1e0, 0xffd9a8];
  const onBeach = (a, inset) => {
    const r = isl.shoreR(a) - inset, x = Math.cos(a) * r, z = Math.sin(a) * r, y = mainHeight(x, z);
    if (angDist(a, DOCK_A) < 0.2 || isl.riverD(x, z) < 0.8 || y > SEA_Y + 0.3) return null;
    return { x, y, z };
  };
  const rockCols = [0xc2b6a8, 0xb3a596, 0xd0c5b8];
  [0.9, 2.2, 3.3, 4.4, 5.6].forEach((a0, gi) => { // 5 小堆，每堆 2–3 块
    for (let k = 0; k < 2 + (gi % 2); k++) {
      const p = onBeach(a0 + k * 0.07, 0.35 + k * 0.12);
      if (!p) continue;
      const r = (k === 0 ? 0.17 : 0.09) + hash1(gi * 5 + k) * 0.06;
      const m = mk(softRock(r, gi * 3 + k), rockCols[(gi + k) % 3], 0.02);
      m.position.set(p.x, p.y + r * 0.35, p.z);
      m.rotation.y = gi + k;
      env.add(m);
    }
  });
  [1.5, 2.8, 3.9, 5.1, 6.0].forEach((a, i) => { // 贝壳
    const p = onBeach(a, 0.5);
    if (!p) return;
    const m = mk(new THREE.ConeGeometry(0.07, 0.06, 7), shellCols[i % 3], 0.015);
    m.position.set(p.x, p.y + 0.03, p.z);
    m.rotation.set(0.3, a * 3, 0.2);
    env.add(m);
  });
  const starShape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2, rr = i % 2 ? 0.045 : 0.11;
    if (i) starShape.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); else starShape.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  const starGeo = new THREE.ExtrudeGeometry(starShape, { depth: 0.025, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 2 }).rotateX(-Math.PI / 2);
  [[2.45, 0.45, 0xff9e7a], [4.7, 0.4, 0xffb36b], [0.35, 0.55, 0xff8fa3]].forEach(([a, inset, c]) => { // 海星
    const p = onBeach(a, inset);
    if (!p) return;
    const m = mk(starGeo, c, 0.012);
    m.position.set(p.x, p.y + 0.005, p.z);
    m.rotation.y = a * 2;
    env.add(m);
  });
  [[3.55, 0.55, 0.55], [5.35, 0.5, 0.42]].forEach(([a, inset, L], i) => { // 浮木
    const p = onBeach(a, inset);
    if (!p) return;
    const log = mk(new THREE.CapsuleGeometry(0.055, L, 4, 8), 0xb9a48c, 0.015);
    log.rotation.set(Math.PI / 2, 0, a + 1.2 + i);
    log.position.set(p.x, p.y + 0.05, p.z);
    const twig = mk(new THREE.CylinderGeometry(0.02, 0.025, 0.2, 5), 0xa8937a, 0.008);
    twig.position.set(0.04, 0.1 - L * 0.3, 0); twig.rotation.z = -0.9;
    log.add(twig);
    env.add(log);
  });
  // 海里几块大圆石（有的半露出水面），两块顶上长了苔藓
  for (const [x, z, s, moss] of [[-5.9, -2.2, 0.5, 1], [-5.4, -3.6, 0.32, 0], [4.9, -4.6, 0.45, 1], [5.8, -3.2, 0.3, 0], [-4.2, 3.9, 0.35, 0]]) {
    const m = mk(softRock(s, x * 3, 0.72), 0xb5a797, 0.03);
    m.position.set(x, SEA_Y + s * 0.12, z);
    m.rotation.y = x;
    if (moss) {
      const cap = mk(new THREE.SphereGeometry(s * 0.72, 14, 6, 0, Math.PI * 2, 0, Math.PI * 0.32), 0x7cb565, 0.015);
      cap.position.y = s * 0.72 * 0.62 - s * 0.72 * 0.95 + s * 0.5;
      cap.scale.y = 0.8;
      m.add(cap);
    }
    env.add(m);
  }

  // 崖顶垂下来的一圈草帘 + 崖面上嵌着的几块突出的石头（沿草地、高台的轮廓找"往外一步就掉下去"的地方）
  {
    const fr = [], rocks = [];
    const edgeScan = (poly, top) => {
      const pts = [];
      for (let i = 0; i < poly.length; i++) {
        const [ax, az] = poly[i], [bx, bz] = poly[(i + 1) % poly.length], L = Math.hypot(bx - ax, bz - az);
        for (let t = 0; t < L; t += 0.11) pts.push([ax + ((bx - ax) * t) / L, az + ((bz - az) * t) / L, (bz - az) / L, -(bx - ax) / L]);
      }
      for (const [x0, z0, nx0, nz0] of pts) {
        // 往外的方向 = 更低的那一边
        let nx = nx0, nz = nz0;
        if (mainHeight(x0 + nx * 0.4, z0 + nz * 0.4) > mainHeight(x0 - nx * 0.4, z0 - nz * 0.4)) { nx = -nx; nz = -nz; }
        let x = x0 - nx * 0.4, z = z0 - nz * 0.4, h0 = mainHeight(x, z);
        if (Math.abs(h0 - top) > 0.06) continue;
        let k = 0;
        while (k < 30 && mainHeight(x + nx * 0.03, z + nz * 0.03) > top - 0.04) { x += nx * 0.03; z += nz * 0.03; k++; }
        const below = mainHeight(x + nx * 0.25, z + nz * 0.25);
        if (top - below < 0.3) continue; // 不是崖，是缓坡
        if (isl.riverD(x, z) < 0.5 || Math.hypot(x - DOCK.base.x, z - DOCK.base.z) < 0.7) continue;
        fr.push([x, top, z, nx, nz]);
        // 崖面中段：嵌一块石头（隔一段放一块）
        if (hash1(x * 13 + z * 7) > 0.84) {
          let mx = x, mz = z;
          for (let j = 0; j < 30 && mainHeight(mx, mz) > (top + Math.max(SEA_Y, below)) / 2; j++) { mx += nx * 0.025; mz += nz * 0.025; }
          rocks.push([mx, mainHeight(mx, mz), mz, nx, nz]);
        }
      }
    };
    edgeScan(MAP.UPPER, mainHeight(-0.5, -5.0));
    edgeScan(MAP.MEADOW, 0);
    const blade = new THREE.ConeGeometry(0.05, 0.24, 4);
    blade.rotateX(Math.PI); // 尖朝下
    blade.translate(0, -0.12, 0); // 根在 y = 0，尖在 y = -0.24
    const PER = 3, n = fr.length * PER;
    const fringeMat = toon(0xffffff);
    fringeMat.onBeforeCompile = (sh) => { // 下雪时跟着变白
      sh.uniforms.uSnow = snowU;
      sh.fragmentShader = "uniform float uSnow;\n" + sh.fragmentShader.replace("#include <color_fragment>",
        "#include <color_fragment>\n diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.96, 1.0), uSnow * 0.85);");
    };
    fringeMat.customProgramCacheKey = () => "fringe-snow";
    const fringe = new THREE.InstancedMesh(blade, fringeMat, n);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), ps = new THREE.Vector3();
    const cols = [0x5fa652, 0x6bb35a, 0x579a4c].map((c) => new THREE.Color(c));
    let i = 0;
    for (const [x, y, z, nx, nz] of fr) for (let k = 0; k < PER; k++) {
      const j = hash1(i * 3.7), off = (k - 1) * 0.035;
      ps.set(x + nx * 0.02 - nz * off, y + 0.03, z + nz * 0.02 + nx * off);
      e.set(0, Math.atan2(nx, nz), 0, "YXZ");
      e.x = -(0.25 + j * 0.35); // 往下垂、尖稍微往外翘
      q.setFromEuler(e);
      const L = 0.55 + j * 0.8;
      sc.set(0.8 + j * 0.4, L, 0.8);
      fringe.setMatrixAt(i, m4.compose(ps, q, sc));
      fringe.setColorAt(i, cols[i % 3]);
      i++;
    }
    fringe.raycast = () => {};
    fringe.userData.dynamic = true;
    env.add(fringe);
    rocks.forEach(([x, y, z, nx, nz], i) => {
      const r = 0.14 + hash1(i + 0.5) * 0.12;
      const m = mk(softRock(r, i + 20, 0.6), [0xb59a80, 0xc8a882, 0xa89080][i % 3], 0.02);
      m.position.set(x - nx * r * 0.3, y, z - nz * r * 0.3);
      m.rotation.y = Math.atan2(nx, nz);
      env.add(m);
    });
  }

  // 雾：远处的小岛有点空气感（颜色跟天色走）
  scene.fog = new THREE.Fog(0xc4e9ff, 24, 46);

  /* ------------------------------------------------------------ 海 */
  const SHORE_N = 512;
  const shoreData = new Float32Array(SHORE_N);
  for (let i = 0; i < SHORE_N; i++) shoreData[i] = isl.shoreR((i / SHORE_N) * Math.PI * 2 - Math.PI);
  const shoreTex = new THREE.DataTexture(shoreData, SHORE_N, 1, THREE.RedFormat, THREE.FloatType);
  shoreTex.needsUpdate = true;
  // 太阳 / 月亮在天上的"画面位置"（低低地挂在天边），海面上的倒影光带、天空里的日月都用它
  const SUN_DIR = new THREE.Vector3(-0.42, 0.26, -1).normalize();
  const seaU = {
    uT: { value: 0 }, uShore: { value: shoreTex },
    uShallow: { value: new THREE.Color(0x7ce6d8) }, uDeep: { value: new THREE.Color(0x3d9ee6) },
    uFoam: { value: new THREE.Color(0xffffff) }, uFar: { value: new THREE.Color(0xbfe8ff) },
    uSunDir: { value: SUN_DIR }, uSpec: { value: new THREE.Color(0xfff6d8) }, uSpecK: { value: 0.6 }, uGlint: { value: 0.7 },
  };
  // [浅水, 深水, 远处(=天边), 倒影颜色, 倒影强度, 闪点强度, 浪花]
  const SEA_COLS = {
    dawn: [0x8fded2, 0x5a92d6, 0xffd9c2, 0xffd2a8, 0.75, 0.5, 0xffffff], day: [0x7ce6d8, 0x3d9ee6, 0xc4e9ff, 0xfff6d8, 0.55, 0.65, 0xffffff],
    dusk: [0x86c4cc, 0x4f6fb0, 0xffc1a8, 0xffb07a, 0.85, 0.35, 0xfff0e6], night: [0x245c78, 0x13244c, 0x26305e, 0xdfe6ff, 0.7, 0.1, 0x7f8cc0],
  };
  const sea = new THREE.Mesh(new THREE.CircleGeometry(48, 96), new THREE.ShaderMaterial({
    uniforms: seaU, transparent: true, depthWrite: false,
    vertexShader: `varying vec2 vP; varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.); vP = w.xz; vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `
      varying vec2 vP; varying vec3 vW; uniform float uT; uniform sampler2D uShore; uniform vec3 uShallow, uDeep, uFoam, uFar;
      uniform vec3 uSunDir, uSpec; uniform float uSpecK, uGlint;
      void main(){
        float r = length(vP), a = atan(vP.y, vP.x);
        float n = sin(vP.x*1.3 + uT*0.7)*0.5 + sin(vP.y*1.6 - uT*0.55)*0.5;
        float d = r - texture2D(uShore, vec2((a + 3.14159265) / 6.2831853, 0.5)).r;
        float depth = clamp((d + n*0.35) / 5.0, 0., 1.);
        depth = floor(depth*4.0 + 0.5) / 4.0;             // 卡通色阶
        vec3 col = mix(uShallow, uDeep, depth);
        float edge = 0.18 + 0.07*sin(a*9.0 + uT*1.4) + 0.04*sin(a*23.0 - uT);
        float foam = (1.0 - step(edge, d)) * step(-0.05, d); // 贴着沙滩的白浪
        float ph = fract(uT*0.22);
        float ring = (1.0 - step(0.045, abs(d - 0.32 - ph*1.1))) * step(0.5, fract(a*6.0/6.2832 + uT*0.05 + n*0.1)) * (1.0 - ph);
        float glint = step(0.93, sin(vP.x*3.1 + uT*1.1 + n) * sin(vP.y*2.7 - uT*0.9)) * (1.0 - smoothstep(4., 14., d));
        col = mix(col, uFoam, max(foam, max(ring*0.9, glint*uGlint)));
        // 日 / 月的倒影：小浪的法线 + 反射，量化成一块块亮斑，连成一条朝着日月的光带
        vec3 nw = normalize(vec3(cos(vP.x*2.3 + uT*1.2)*0.09 + cos(vP.y*3.1 - uT*0.8)*0.06, 1.0, cos(vP.y*2.1 + uT)*0.09 + cos((vP.x+vP.y)*2.7 - uT*1.3)*0.05));
        vec3 R = reflect(normalize(vW - cameraPosition), nw);
        float sp = pow(max(dot(R, uSunDir), 0.0), 40.0);
        float streak = step(0.35, sp * (0.75 + 0.25 * sin(vP.x*9.0 + vP.y*7.0 + uT*2.0))) * step(0.0, d);
        col = mix(col, uFar, smoothstep(8.0, 30.0, r) * 0.8);
        col = mix(col, uSpec, streak * uSpecK);
        float a0 = max(foam, mix(0.42, 0.95, smoothstep(0.0, 3.0, d)));
        gl_FragColor = vec4(col, max(streak * uSpecK, (1.0 - smoothstep(30.0, 46.0, r)) * a0));
      }`,
  }));
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = SEA_Y;
  sea.renderOrder = 1;
  env.add(tag(sea, "sea"));
  updaters.push((t) => { seaU.uT.value = t; });

  /* ------------------------------------------------------------ 瀑布、水潭、小河、小桥（island3d.js） */
  const water = buildWater({ toon, outlined });
  env.add(water.group);
  updaters.push((t) => water.update(t));

  /* ------------------------------------------------------------ 高台上的树 */
  const roundTree = (r, c1, c2) => {
    const g = new THREE.Group();
    const tr = mk(new THREE.CylinderGeometry(0.07, 0.11, 0.6, 7), 0x8a5a3b, 0.02);
    tr.position.y = 0.3;
    g.add(tr);
    for (const [dx, dy, dz, rr, c] of [[0, 0.85, 0, r, c1], [r * 0.55, 0.72, r * 0.2, r * 0.7, c2], [-r * 0.5, 0.75, r * 0.15, r * 0.68, c2], [0.05, 1.1, -r * 0.3, r * 0.65, c1]]) {
      const m = mk(new THREE.SphereGeometry(rr, 14, 10), c, 0.03);
      m.position.set(dx, dy, dz); m.scale.y = 0.88;
      g.add(m);
    }
    return g;
  };
  const pine = (h, c) => {
    const g = new THREE.Group();
    const tr = mk(new THREE.CylinderGeometry(0.05, 0.08, 0.3, 6), 0x8a5a3b, 0.015);
    tr.position.y = 0.15; g.add(tr);
    for (let i = 0; i < 3; i++) {
      const cn = mk(new THREE.ConeGeometry(0.42 - i * 0.1, h * 0.45, 9), c, 0.025);
      cn.position.y = 0.35 + i * h * 0.24; g.add(cn);
    }
    return g;
  };
  for (const [x, z, kind, s] of [[-2.45, -4.35, "r", 1.0], [-0.3, -5.7, "r", 1.05], [2.65, -4.85, "r", 0.85], [-3.0, -4.75, "p", 1.0],
    [2.3, -5.55, "p", 1.1], [-1.1, -5.6, "p", 0.9], [-2.6, -5.4, "r", 0.8]]) {
    const SEASON_TREE = { autumn: [[0xe9a03b, 0xf2c14e], [0xd9673a, 0xef8a4a]], spring: [[0xf7a8c4, 0xffc4d8]] }[SEASON];
    const tint = kind === "r" && SEASON_TREE && (x * 7 + z * 3) % 2 < 1.1 ? SEASON_TREE[Math.abs(Math.round(x)) % SEASON_TREE.length] : null;
    const t = kind === "r" ? roundTree(0.48, tint ? tint[0] : 0x5cb86d, tint ? tint[1] : 0x6fcf86) : pine(1.3, 0x4fa86a);
    t.position.set(x, mainHeight(x, z) - 0.03, z);
    t.scale.setScalar(s);
    t.rotation.y = x * 3;
    env.add(t);
  }

  /* ------------------------------------------------------------ 高台上的小木屋 + 木梯 + 踏脚石（home3d.js） */
  const home = buildHome({ toon, outlined, heightAt: mainHeight, tag });
  env.add(home.root);
  updaters.push((t, dt) => home.update(t, dt));

  /* ------------------------------------------------------------ 码头 */
  const dock = new THREE.Group();
  const plankMat = [0xc99a6b, 0xb88a5c];
  const len = DOCK.tip.length() - DOCK.base.length() + 0.5;
  for (let i = 0; i < Math.round(len / 0.24); i++) {
    const p = mk(new THREE.BoxGeometry(0.62, 0.07, 0.2), plankMat[i % 2], 0.015);
    p.position.set(0, -0.02, 0.12 + i * 0.24);
    p.rotation.z = (hash1(i) - 0.5) * 0.04;
    dock.add(p);
  }
  for (const s of [-1, 1]) for (const z of [0.5, 1.6, 2.7, len - 0.1]) {
    const post = mk(new THREE.CylinderGeometry(0.05, 0.06, 1.6, 7), 0x9a6f4a, 0.015);
    post.position.set(s * 0.3, -0.75, z);
    dock.add(post);
  }
  const lantern = new THREE.Group(); // 码头尽头的小灯笼，晚上亮
  const lPole = mk(new THREE.CylinderGeometry(0.025, 0.025, 0.55, 6), 0x7a5a3e, 0.012);
  lPole.position.y = 0.27;
  const lBox = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffe2a0 }));
  lBox.position.y = 0.58;
  const lLight = new THREE.PointLight(0xffc870, 0, 3, 1.6);
  lLight.position.y = 0.6;
  const lGlow = glowSprite(0xffc870, 1.1);
  lGlow.position.y = 0.58;
  lBox.userData.dynamic = true;
  lantern.add(lPole, lBox, lLight, lGlow);
  lantern.position.set(0.3, 0, len - 0.1);
  dock.add(lantern);
  dock.position.copy(DOCK.base);
  dock.rotation.y = Math.atan2(DOCK.dir.x, DOCK.dir.z);
  env.add(tag(dock, "dock"));

  /* ------------------------------------------------------------ 草丛（实例化，跟着风摆） */
  const blade = new THREE.ConeGeometry(0.035, 0.24, 3);
  blade.translate(0, 0.12, 0);
  const tuftGeo = mergeGeometries([0, 1, 2].map((i) => {
    const g = blade.clone(); const a = (i / 3) * Math.PI * 2;
    g.rotateZ(0.28); g.rotateY(a); g.scale(1, 0.8 + i * 0.15, 1);
    return g;
  }));
  const grassMat = toon(0xffffff);
  const windU = { value: 0 };
  grassMat.onBeforeCompile = (sh) => {
    sh.uniforms.uWind = windU;
    sh.uniforms.uSnow = snowU;
    sh.fragmentShader = "uniform float uSnow;\n" + sh.fragmentShader.replace("#include <color_fragment>",
      "#include <color_fragment>\n diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.96, 1.0), uSnow);");
    sh.vertexShader = "uniform float uWind;\n" + sh.vertexShader.replace("#include <begin_vertex>", `#include <begin_vertex>
      vec3 ip = vec3(0.);
      #ifdef USE_INSTANCING
        ip = instanceMatrix[3].xyz;
      #endif
      float hh = max(position.y, 0.) * 4.0;
      transformed.x += sin(uWind*1.9 + ip.x*1.7 + ip.z*1.1) * hh*hh * 0.035;
      transformed.z += cos(uWind*1.5 + ip.z*1.9) * hh*hh * 0.02;`);
  };
  const TUFTS = 320;
  const grass = new THREE.InstancedMesh(tuftGeo, grassMat, TUFTS);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3();
  const gc = [0x5aa955, 0x68b85e, 0x7bc56a, 0x4c9a4c].map((c) => new THREE.Color(c));
  let n = 0, seed = 1;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  while (n < TUFTS) {
    const x = -4.3 + rnd() * 8.6, z = -6.2 + rnd() * 10.2;
    const h = mainHeight(x, z);
    const onMeadow = Math.abs(h) < 0.004 && isl.meadowSD(x, z) < -0.15;
    const onUpper = h > 1.45 && isl.upperSD(x, z) < -0.25;
    if (!onMeadow && !onUpper) continue;
    if (isl.riverD(x, z) < 0.65 || Math.hypot(x - POOL.x, z - POOL.z) < 1.0) continue;
    // 成片地长：噪声低的地方空着（草坪），高的地方一丛挨一丛；小路、踏脚石、小木屋周围不长
    const clump = vnoise2(x * 0.9 + 3, z * 0.9 - 1) * 0.75 + vnoise2(x * 2.3, z * 2.3) * 0.25;
    if (clump < 0.5 || (clump < 0.6 && rnd() < 0.6)) continue;
    if (lineD(x, z, STONE_PATH) < 0.32 || PATH_LINES.some((pl) => lineD(x, z, pl) < 0.3)) continue;
    if (Math.hypot(x - HOME.x, z - HOME.z) < 0.85) continue;
    const r = Math.hypot(x, z);
    if (Math.hypot(x - 0.35, z - 0.75) < 0.7) continue;         // 小伙伴的家
    if (Math.hypot(x + 1.55, z + 0.85) < 1.05) continue;        // 床
    ps.set(x, h, z);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6.3);
    const s = 0.7 + rnd() * 0.7;
    sc.set(s, s * (0.8 + rnd() * 0.5), s);
    grass.setMatrixAt(n, m4.compose(ps, q, sc));
    grass.setColorAt(n, gc[n % gc.length]);
    n++;
  }
  grass.receiveShadow = true;
  grass.raycast = () => {};
  env.add(grass);
  updaters.push((t) => { windU.value = t; });

  /* ------------------------------------------------------------ 小灌木 */
  for (const [x, z, s] of [[-3.75, 0.35, 0.9], [3.6, -0.6, 0.8], [-1.35, 3.1, 0.8], [2.1, 2.9, 0.7], [-2.5, -3.9, 0.85], [-0.35, -4.0, 0.7], [2.85, -4.05, 0.7], [3.3, -2.2, 0.6]]) {
    const b = new THREE.Group();
    for (const [dx, dy, dz, r, c] of [[0, 0.2, 0, 0.3, 0x5fae5f], [0.24, 0.14, 0.06, 0.22, 0x6fc06a], [-0.2, 0.13, 0.08, 0.2, 0x58a85a]]) {
      const m = mk(new THREE.SphereGeometry(r, 12, 9), c, 0.025);
      m.position.set(dx, dy, dz); m.scale.y = 0.85;
      b.add(m);
    }
    b.position.set(x, mainHeight(x, z), z); b.scale.setScalar(s);
    b.rotation.y = Math.atan2(x, z);
    env.add(b);
  }

  /* ------------------------------------------------------------ 远处的小岛：灯塔岛、椰子树岛、远山岛、小礁石（同一个地形生成器） */
  const islet = (x, z, opts) => {
    const it = makeIsland({ segs: 72, rMax: opts.R0 + 3.2, ...opts });
    const g = new THREE.Group();
    const m = new THREE.Mesh(it.geo, terrainMaterial(toon, snowU));
    m.raycast = () => {};
    g.add(m);
    // 白浪圈
    const sr = it.shoreR(0.3), foam = new THREE.Mesh(new THREE.RingGeometry(sr - 0.05, sr + 0.16, 48), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, depthWrite: false }));
    foam.rotation.x = -Math.PI / 2; foam.position.y = SEA_Y + 0.015;
    foam.raycast = () => {};
    g.add(foam);
    updaters.push((t) => { foam.material.opacity = 0.45 + Math.sin(t * 1.3 + x) * 0.2; foam.scale.setScalar(1 + Math.sin(t * 1.3 + x) * 0.03); });
    g.position.set(x, 0, z);
    g.userData = { it, topY: opts.H };
    env.add(g);
    return g;
  };
  const cone = (r, h, c) => mk(new THREE.ConeGeometry(r, h, 9), c, 0.02);
  // 灯塔岛：岩石小岛，崖很陡
  const lh = islet(-9.5, -7.5, { R0: 1.5, H: SEA_Y + 1.15, seed: 11, cliff: () => 0.75, wob: 0.18, slope: [0.9, 0.35], beach: [0.5, 0.2] });
  const tower = new THREE.Group();
  [0xffffff, 0xff7b8a, 0xffffff, 0xff7b8a].forEach((c, i) => {
    const seg = mk(new THREE.CylinderGeometry(0.3 - i * 0.035, 0.34 - i * 0.035, 0.4, 16), c, 0.02);
    seg.position.y = 0.2 + i * 0.4;
    tower.add(seg);
  });
  const lampHouse = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.26, 12), new THREE.MeshBasicMaterial({ color: 0xfff1b8 }));
  lampHouse.position.y = 1.73;
  const roof = mk(new THREE.ConeGeometry(0.3, 0.32, 14), 0xff7b8a, 0.02);
  roof.position.y = 2.02;
  const beam = new THREE.Mesh(new THREE.ConeGeometry(0.6, 5, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0xfff1b8, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide }));
  beam.rotation.z = Math.PI / 2; beam.position.x = 2.5;
  const beamPivot = new THREE.Group();
  beamPivot.position.y = 1.73; beamPivot.add(beam);
  const hut = mk(new THREE.BoxGeometry(0.45, 0.35, 0.4), 0xfff3e0, 0.02);
  hut.position.set(0.5, 0.17, 0.15);
  const hutRoof = mk(new THREE.ConeGeometry(0.38, 0.28, 4), 0x6f9fd8, 0.02);
  hutRoof.position.set(0.5, 0.48, 0.15); hutRoof.rotation.y = Math.PI / 4;
  const lhGlow = glowSprite(0xfff1b8, 2.2);
  lhGlow.position.y = 1.73;
  lampHouse.userData.dynamic = true;
  tower.add(lampHouse, roof, beamPivot, hut, hutRoof, lhGlow);
  tower.position.y = lh.userData.topY;
  lh.add(tower);
  for (const [dx, dz] of [[-0.8, 0.4], [-0.5, -0.8]]) { const tr = cone(0.28, 0.7, 0x4fae6a); tr.position.set(dx, lh.userData.topY + 0.35, dz); lh.add(tr); }

  // 椰子树岛：平平的沙洲，两棵椰子树 + 一把小伞
  const palmIs = islet(10.5, -4.5, { R0: 1.3, H: SEA_Y + 0.38, seed: 21, wob: 0.2, slope: [1.0, 1.0], beach: [0.9, 0.9], grassy: 0.25 });
  const makePalm = (lean) => {
    const palm = new THREE.Group();
    for (let i = 0; i < 7; i++) {
      const seg = mk(new THREE.CylinderGeometry(0.06, 0.075, 0.22, 7), 0xb9895a, 0.015);
      seg.position.set(i * i * 0.008 * lean, 0.11 + i * 0.2, 0);
      palm.add(seg);
    }
    const crownX = 36 * 0.008 * lean;
    for (let i = 0; i < 7; i++) {
      const leaf = mk(new THREE.SphereGeometry(0.45, 10, 6), i % 2 ? 0x5fbf6a : 0x4fae5f, 0.02);
      leaf.scale.set(1, 0.1, 0.32);
      const a = (i / 7) * Math.PI * 2;
      leaf.position.set(crownX + Math.cos(a) * 0.36, 1.35, Math.sin(a) * 0.36);
      leaf.rotation.set(0, -a, -0.4);
      palm.add(leaf);
    }
    for (let i = 0; i < 3; i++) {
      const c = mk(new THREE.SphereGeometry(0.07, 8, 6), 0x8a5a3b, 0.012);
      c.position.set(crownX + (i - 1) * 0.08, 1.24, (i % 2) * 0.08 - 0.04);
      palm.add(c);
    }
    return palm;
  };
  const p1 = makePalm(1); p1.position.set(-0.3, palmIs.userData.topY, 0.1);
  const p2 = makePalm(-1); p2.position.set(0.45, palmIs.userData.topY, -0.35); p2.scale.setScalar(0.8); p2.rotation.y = 2;
  const umb = new THREE.Group();
  const stick = mk(new THREE.CylinderGeometry(0.02, 0.02, 0.6, 6), 0xffffff, 0.01);
  stick.position.y = 0.3;
  const shade = mk(new THREE.ConeGeometry(0.4, 0.18, 10), 0xff8fab, 0.015);
  shade.position.y = 0.62;
  umb.add(stick, shade);
  umb.position.set(0.5, palmIs.userData.topY, 0.6);
  umb.rotation.z = 0.15;
  palmIs.add(p1, p2, umb);

  // 远山岛：远处一座大一点的绿岛，有小山和一排树（雾让它有距离感）
  const far = islet(4, -15.5, { R0: 3.0, H: SEA_Y + 1.4, seed: 31, cliff: (a) => 0.3 + 0.5 * bump(angDist(a, Math.PI / 2), 1.2), wob: 0.25, slope: [1.6, 0.5], beach: [0.8, 0.3] });
  const hill = mk(new THREE.SphereGeometry(1.7, 20, 14), 0x8fd072, 0.03);
  hill.scale.set(1.2, 0.75, 1); hill.position.set(-0.6, far.userData.topY, -0.8);
  const hill2 = mk(new THREE.SphereGeometry(1.1, 18, 12), 0x9ad978, 0.03);
  hill2.scale.set(1.1, 0.8, 1); hill2.position.set(1.4, far.userData.topY, -0.2);
  far.add(hill, hill2);
  for (let i = 0; i < 9; i++) {
    const a = 0.9 + i * 0.35, r = 2.2;
    const tr = cone(0.3 + hash1(i) * 0.15, 0.9 + hash1(i + 2) * 0.5, i % 2 ? 0x4fae6a : 0x5fbf6a);
    tr.position.set(Math.cos(a) * r, far.userData.topY + 0.4, Math.sin(a) * r);
    far.add(tr);
  }

  // 小礁石，上面站一只海鸥
  const reef = islet(7.0, 7.0, { R0: 0.45, H: SEA_Y + 0.5, seed: 41, cliff: () => 0.8, wob: 0.3, slope: [0.4, 0.25], beach: [0.2, 0.1] });
  const perch = makeGull(mk);
  perch.userData.dynamic = true; // 偶尔扇一下翅膀，别被合批冻住
  perch.position.y = reef.userData.topY + 0.05;
  perch.scale.setScalar(0.9);
  reef.add(perch);

  /* ------------------------------------------------------------ 天空：一个大球罩住整个场景（渐变 + 日月 + 夜里的星星）
     天边的颜色 = 海的远处颜色 = 雾的颜色，海和天在天边接上，看不到"海的圆边"。 */
  const skyU = {
    uTop: { value: new THREE.Color() }, uMid: { value: new THREE.Color() }, uHor: { value: new THREE.Color() },
    uSunDir: { value: SUN_DIR }, uDiskC: { value: new THREE.Color() }, uGlowC: { value: new THREE.Color() },
    uDisk: { value: 0.9992 }, uMoon: { value: 0 }, uStars: { value: 0 }, uT: { value: 0 },
  };
  const SKY_COLS = { // 顶、中、（天边取 SEA_COLS 的远处色）、日月、光晕、日月大小
    day: [0x5aaeef, 0x9dd4ff, 0xfff8dc, 0xfff1c0, 0.9994],
    dawn: [0x8aa0dc, 0xf3b9ae, 0xffe6b8, 0xffc49a, 0.9991],
    dusk: [0x5560b4, 0xf09888, 0xffc48a, 0xff9a6b, 0.999],
    night: [0x0b1032, 0x1a2156, 0xfdf6d8, 0x8f9ad8, 0.9993],
  };
  const skyDome = new THREE.Mesh(new THREE.SphereGeometry(56, 40, 20), new THREE.ShaderMaterial({
    uniforms: skyU, side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: "varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }",
    fragmentShader: `varying vec3 vW; uniform vec3 uTop, uMid, uHor, uSunDir, uDiskC, uGlowC; uniform float uDisk, uMoon, uStars, uT;
      float h3(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
      void main(){
        vec3 d = normalize(vW - cameraPosition);
        float h = d.y;
        vec3 c = mix(uHor, uMid, smoothstep(-0.01, 0.16, h));
        c = mix(c, uTop, smoothstep(0.16, 0.62, h));
        float sd = dot(d, uSunDir);
        c += uGlowC * pow(max(sd, 0.0), 10.0) * 0.45 + uGlowC * pow(max(sd, 0.0), 80.0) * 0.35;
        float disk = smoothstep(uDisk - 0.00025, uDisk, sd);
        // 月牙：再挖掉一个错开一点的圆
        float bite = smoothstep(uDisk - 0.00025, uDisk, dot(d, normalize(uSunDir + vec3(0.016, 0.012, 0.0)))) * uMoon;
        c = mix(c, uDiskC, disk * (1.0 - bite));
        // 星星：方向空间里分格子，少数格子里有一颗，一闪一闪；越靠近天边越淡
        if (uStars > 0.01) {
          vec3 g = d * 90.0, cell = floor(g);
          float r = h3(cell);
          if (r > 0.985) {
            vec3 ctr = cell + 0.5 + (vec3(h3(cell + 1.3), h3(cell + 2.7), h3(cell + 4.1)) - 0.5) * 0.6;
            float st = smoothstep(0.22, 0.0, length(g - ctr)) * (0.6 + 0.4 * sin(uT * (1.5 + r * 20.0) + r * 50.0));
            c += vec3(1.0, 0.97, 0.88) * st * uStars * smoothstep(0.04, 0.25, h) * (1.0 - disk);
          }
        }
        gl_FragColor = vec4(c, 1.0); // 和海、雾一样不做色彩空间转换，天边才接得上
      }`,
  }));
  skyDome.renderOrder = -10;
  skyDome.frustumCulled = false;
  skyDome.raycast = () => {};
  skyDome.userData.dynamic = true;
  env.add(skyDome);
  updaters.push((t) => { skyU.uT.value = t; });

  /* ------------------------------------------------------------ 云：蓬松的一整团（和天气里的云同一个生成器），远远地绕着岛飘 */
  const clouds = new THREE.Group();
  const cloudMat = toon(0xffffff, { emissive: 0xffffff, emissiveIntensity: 0.25 });
  for (let i = 0; i < 7; i++) {
    const c = new THREE.Mesh(cloudGeometry(i + 3, 1), cloudMat);
    c.raycast = () => {};
    const a = (i / 7) * Math.PI * 2 + 0.4, R = 17 + (i % 3) * 4;
    c.position.set(Math.cos(a) * R, 3.2 + (i % 3) * 1.1, Math.sin(a) * R);
    c.lookAt(0, c.position.y, 0);
    c.scale.setScalar(1.3 + (i % 2) * 0.7);
    clouds.add(c);
  }
  clouds.userData.dynamic = true;
  env.add(clouds);
  updaters.push((t, dt) => { clouds.rotation.y += dt * 0.012; });

  /* ------------------------------------------------------------ 海鸥（白天绕圈） */
  const gulls = [0, 1].map((i) => { const g = makeGull(mk); g.userData.i = i; g.userData.dynamic = true; env.add(g); return g; });
  /* ------------------------------------------------------------ 蝴蝶（白天） */
  const flyCols = [0xffa6c9, 0xffe17a, 0xb9a7ff];
  const butterflies = flyCols.map((c, i) => {
    const b = new THREE.Group();
    const wingGeo = new THREE.CircleGeometry(0.09, 10);
    wingGeo.scale(1, 1.25, 1);
    const wings = [-1, 1].map((s) => {
      const piv = new THREE.Group();
      const w = new THREE.Mesh(wingGeo, toon(c, { side: THREE.DoubleSide }));
      w.position.x = s * 0.085;
      piv.add(w);
      b.add(piv);
      return piv;
    });
    const bod = new THREE.Mesh(new THREE.CapsuleGeometry(0.018, 0.08, 3, 6), toon(0x4a2f25));
    bod.rotation.x = Math.PI / 2;
    b.add(bod);
    b.userData = { wings, i, dynamic: true };
    env.add(b);
    return b;
  });
  /* ------------------------------------------------------------ 萤火虫（晚上） */
  const FF = 26;
  const ffGeo = new THREE.BufferGeometry();
  ffGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(FF * 3), 3));
  const glowTex = (() => {
    const c = document.createElement("canvas"); c.width = c.height = 32;
    const x = c.getContext("2d"), g = x.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, "rgba(255,255,220,1)"); g.addColorStop(0.35, "rgba(230,255,140,0.8)"); g.addColorStop(1, "rgba(200,255,120,0)");
    x.fillStyle = g; x.fillRect(0, 0, 32, 32);
    return new THREE.CanvasTexture(c);
  })();
  const fireflies = new THREE.Points(ffGeo, new THREE.PointsMaterial({ size: 0.22, map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  fireflies.raycast = () => {};
  env.add(fireflies);
  const ffSeed = Array.from({ length: FF }, (_, i) => [hash1(i) * 6.3, 0.8 + hash1(i + 50) * 2.6, 0.2 + hash1(i + 90) * 1.3, 0.3 + hash1(i + 7) * 0.6]);

  /* ------------------------------------------------------------ 偶尔跳出水面的小鱼 */
  const jumper = new THREE.Group();
  const jb = mk(new THREE.SphereGeometry(0.12, 10, 8), 0xff9a6b, 0.015);
  jb.scale.set(1.5, 0.9, 0.7);
  const jt = mk(new THREE.ConeGeometry(0.09, 0.14, 4), 0xff9a6b, 0.012);
  jt.rotation.z = Math.PI / 2; jt.position.x = -0.2;
  jumper.add(jb, jt);
  jumper.visible = false;
  env.add(jumper);
  const ripple = new THREE.Mesh(new THREE.RingGeometry(0.15, 0.22, 24), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false }));
  ripple.rotation.x = -Math.PI / 2;
  ripple.visible = false;
  env.add(ripple);
  let jumpAt = 4, jumpFrom = new THREE.Vector3(), jumpTo = new THREE.Vector3();
  const JUMP = 1.1;

  /* ------------------------------------------------------------ 每帧 */
  let sky = "day";
  function setSky(k) {
    sky = k;
    const [s, d, f, spc, spk, gl, fo] = SEA_COLS[k] || SEA_COLS.day;
    seaU.uShallow.value.setHex(s); seaU.uDeep.value.setHex(d); seaU.uFar.value.setHex(f);
    seaU.uSpec.value.setHex(spc); seaU.uSpecK.value = spk; seaU.uGlint.value = gl; seaU.uFoam.value.setHex(fo);
    water.setNight(k === "night" ? 1 : k === "dusk" ? 0.35 : k === "dawn" ? 0.15 : 0);
    scene.fog.color.setHex(f);
    const [top, mid, dc, gc, dk] = SKY_COLS[k] || SKY_COLS.day;
    skyU.uTop.value.setHex(top); skyU.uMid.value.setHex(mid); skyU.uHor.value.setHex(f);
    skyU.uDiskC.value.setHex(dc); skyU.uGlowC.value.setHex(gc); skyU.uDisk.value = dk;
    skyU.uMoon.value = k === "night" ? 1 : 0;
    skyU.uStars.value = k === "night" ? 1 : k === "dusk" ? 0.25 : 0;
    cloudMat.color.setHex(k === "night" ? 0x8c94c8 : k === "dusk" ? 0xffd6c8 : 0xffffff);
    cloudMat.emissive.setHex(k === "night" ? 0x2a3060 : 0xffffff);
    cloudMat.emissiveIntensity = k === "night" ? 0.3 : 0.22;
    home.setNight(k === "night" ? 1 : k === "dusk" ? 0.7 : k === "dawn" ? 0.35 : 0);
  }
  function update(t, dt) {
    for (const u of updaters) u(t, dt);
    const night = sky === "night", day = !night;
    // 灯塔 / 码头灯
    beam.visible = night || sky === "dusk";
    beamPivot.rotation.y = t * 0.8;
    lLight.intensity = night ? 2.2 : sky === "dusk" ? 1 : 0;
    lBox.material.color.setHex(night || sky === "dusk" ? 0xffd27a : 0xf3eee0);
    lampHouse.material.color.setHex(night ? 0xfff1b8 : 0xf6f1e4);
    const glowK = night ? 1 : sky === "dusk" ? 0.55 : 0;
    lGlow.material.opacity = glowK * (0.8 + Math.sin(t * 2.3) * 0.08);
    lhGlow.material.opacity = glowK * 0.9;
    // 海鸥
    gulls.forEach((g) => {
      g.visible = day;
      if (!day) return;
      const a = t * 0.22 + g.userData.i * 3, R = 6 + g.userData.i * 1.5;
      g.position.set(Math.cos(a) * R, 3.2 + g.userData.i * 0.6 + Math.sin(t * 0.7) * 0.2, Math.sin(a) * R);
      g.rotation.set(0, -a, Math.sin(t) * 0.15);
      g.userData.wings.forEach((w, s) => { w.rotation.x = (s ? 1 : -1) * Math.sin(t * 6 + g.userData.i) * 0.5; });
    });
    perch.userData.wings.forEach((w, s) => { w.rotation.x = (s ? 1 : -1) * (Math.sin(t * 0.5) > 0.96 ? Math.sin(t * 20) * 0.6 : 0.1); });
    // 蝴蝶
    butterflies.forEach((b) => {
      b.visible = sky !== "night";
      if (!b.visible) return;
      const i = b.userData.i, a = t * 0.35 + i * 2.1;
      const r = 1.6 + Math.sin(t * 0.5 + i) * 0.9;
      b.position.set(Math.cos(a) * r, 0.7 + Math.sin(t * 1.3 + i) * 0.3, Math.sin(a * 1.3) * r);
      b.rotation.y = -a;
      const f = Math.sin(t * 18 + i) * 1.0;
      b.userData.wings[0].rotation.y = f; b.userData.wings[1].rotation.y = -f;
    });
    // 萤火虫
    fireflies.visible = night || sky === "dusk";
    if (fireflies.visible) {
      const p = ffGeo.attributes.position;
      ffSeed.forEach(([a0, r, y, sp], i) => {
        const a = a0 + t * sp * 0.3;
        p.setXYZ(i, Math.cos(a) * r + Math.sin(t * sp + i) * 0.2, y + Math.sin(t * sp * 1.7 + i) * 0.25, Math.sin(a) * r);
      });
      p.needsUpdate = true;
      fireflies.material.opacity = (night ? 1 : 0.5) * (0.75 + Math.sin(t * 3) * 0.25);
    }
    // 跳鱼
    if (t > jumpAt && !jumper.visible) {
      const a = Math.random() * Math.PI * 2, r = 5 + Math.random() * 3;
      jumpFrom.set(Math.cos(a) * r, SEA_Y, Math.sin(a) * r);
      jumpTo.set(Math.cos(a + 0.18) * r, SEA_Y, Math.sin(a + 0.18) * r);
      jumper.visible = true; jumper.userData.t0 = t;
    }
    if (jumper.visible) {
      const k = (t - jumper.userData.t0) / JUMP;
      if (k >= 1) { jumper.visible = false; jumpAt = t + 5 + Math.random() * 8; ripple.visible = true; ripple.userData.t0 = t; ripple.position.copy(jumpTo).setY(SEA_Y + 0.01); }
      else {
        jumper.position.lerpVectors(jumpFrom, jumpTo, k);
        jumper.position.y = SEA_Y + Math.sin(k * Math.PI) * 0.9;
        const dir = new THREE.Vector3().subVectors(jumpTo, jumpFrom);
        jumper.rotation.set(0, Math.atan2(-dir.z, dir.x), Math.cos(k * Math.PI) * 0.9);
      }
    }
    if (ripple.visible) {
      const k = (t - ripple.userData.t0) / 1.2;
      ripple.visible = k < 1;
      ripple.scale.setScalar(1 + k * 3);
      ripple.material.opacity = 1 - k;
    }
  }

  // 在海面某处打一圈水花（点海、鱼咬钩时用）
  const splashes = [];
  function splash(p, big = 1) {
    const r = new THREE.Mesh(new THREE.RingGeometry(0.12, 0.18, 24), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false }));
    r.rotation.x = -Math.PI / 2;
    r.position.set(p.x, SEA_Y + 0.02, p.z);
    r.userData = { t0: performance.now(), big };
    env.add(r);
    splashes.push(r);
  }
  updaters.push(() => {
    const now = performance.now();
    for (let i = splashes.length - 1; i >= 0; i--) {
      const r = splashes[i], k = (now - r.userData.t0) / 900;
      if (k >= 1) { env.remove(r); r.geometry.dispose(); r.material.dispose(); splashes.splice(i, 1); continue; }
      r.scale.setScalar(1 + k * 4 * r.userData.big);
      r.material.opacity = 1 - k;
    }
  });

  // 对面那座岛 = 对方的城市（extras3d 往上面加天气、灯、标牌）
  const farInfo = { group: far, center: new THREE.Vector3(4, 0, -15.5), topY: far.userData.topY, mesh: far.children[0], radius: 3.4 };
  return { top, ground, sea, dock, env, update, setSky, splash, SEA_Y, heightAt: mainHeight, far: farInfo, home };
}

function makeGull(mk) {
  const g = new THREE.Group();
  const body = mk(new THREE.SphereGeometry(0.12, 10, 8), 0xffffff, 0.015);
  body.scale.set(1.5, 0.9, 0.9);
  const head = mk(new THREE.SphereGeometry(0.08, 10, 8), 0xffffff, 0.015);
  head.position.set(0.17, 0.07, 0);
  const beak = mk(new THREE.ConeGeometry(0.025, 0.08, 6), 0xffb23d, 0.01);
  beak.rotation.z = -Math.PI / 2; beak.position.set(0.27, 0.06, 0);
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.014, 6, 4), new THREE.MeshBasicMaterial({ color: 0x222222 }));
  eye.position.set(0.21, 0.1, 0.06);
  const eye2 = eye.clone(); eye2.position.z = -0.06;
  g.add(body, head, beak, eye, eye2);
  const wings = [1, -1].map((s) => {
    const piv = new THREE.Group();
    const w = mk(new THREE.BoxGeometry(0.16, 0.025, 0.3), 0xf2f4f8, 0.012);
    w.position.z = s * 0.15;
    piv.add(w);
    piv.position.set(-0.02, 0.05, s * 0.05);
    g.add(piv);
    return piv;
  });
  g.userData.wings = wings;
  return g;
}
