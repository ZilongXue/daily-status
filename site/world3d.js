// 小岛的"世界"：地形（草地 + 岩层 + 沙滩）、海、瀑布、草丛、远处的小岛、云、蝴蝶 / 海鸥 / 萤火虫 / 跳出水的小鱼、钓鱼码头。
// 全部程序生成，没有外部模型。scene3d.js 负责小伙伴和互动，这里只管环境。
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

export const SEA_Y = -0.85;   // 海面高度（草地表面是 y = 0）
export const ISLAND_R = 3.25; // 草地的最小半径（装饰的位置都按这个算）

// 码头：从岛的正前方偏右伸进海里。钓鱼的小伙伴站在 DOCK.tip，朝 DOCK.dir 看。
const DOCK_A = Math.atan2(3.05, 0.75); // 角度（从 +x 量起）
const DOCK_DIR = new THREE.Vector3(Math.cos(DOCK_A), 0, Math.sin(DOCK_A));
export const DOCK = {
  dir: DOCK_DIR,
  base: DOCK_DIR.clone().multiplyScalar(2.45),
  tip: DOCK_DIR.clone().multiplyScalar(5.6),
  bobber: DOCK_DIR.clone().multiplyScalar(7.1).setY(SEA_Y),
};

const WF_A = Math.atan2(-1.3, 2.75); // 瀑布的角度（树旁边）
// 哪里是悬崖（0 = 缓坡草地，1 = 陡崖）：岛的背面一大段 + 瀑布那一小段
const angDist = (a, b) => Math.abs(((a - b + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
const bump = (d, w) => Math.max(0, 1 - (d / w) ** 2);
const mainCliff = (a) => Math.min(1, 1.15 * bump(angDist(a, -Math.PI / 2 - 0.25), 1.15) + bump(angDist(a, WF_A), 0.45));

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

// 地形材质：顶点色 + 卡通光照 + 下雪时草地部分变白
function terrainMaterial(toon, snowU) {
  const m = toon(0xffffff, { vertexColors: true });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uSnow = snowU;
    sh.vertexShader = "attribute float snowable;\nvarying float vSnow;\n" + sh.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\nvSnow = snowable;");
    sh.fragmentShader = "uniform float uSnow;\nvarying float vSnow;\n" + sh.fragmentShader.replace("#include <color_fragment>",
      "#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.94, 0.96, 1.0), uSnow * vSnow);");
  };
  return m;
}

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
  const isl = makeIsland({ R0: ISLAND_R, seed: 1, cliff: mainCliff, wob: 0.13 });
  const ground = new THREE.Mesh(isl.geo, terrainMaterial(toon, snowU));
  ground.receiveShadow = true;
  env.add(tag(ground, "ground"));
  // 崖壁上嵌几块大石头，打破平整感
  for (let i = 0; i < 16; i++) {
    const a = -Math.PI / 2 - 1.2 + (i / 15) * 2.6 + (hash1(i) - 0.5) * 0.15;
    if (mainCliff(a) < 0.5) continue;
    const e = isl.edge(a), rr = e + 0.12 + hash1(i + 3) * 0.2;
    const m = mk(new THREE.DodecahedronGeometry(0.16 + hash1(i + 1) * 0.16, 0), i % 3 ? 0xb5a493 : 0xcaa27a, 0.025);
    m.position.set(Math.cos(a) * rr, isl.height(rr, a) + 0.05, Math.sin(a) * rr);
    m.rotation.set(hash1(i + 5) * 3, hash1(i + 6) * 3, 0);
    m.scale.y = 0.8;
    env.add(m);
  }
  // 沙滩上的小石头和贝壳（顺着真实的海岸线摆）
  const shellCols = [0xffc4d0, 0xfff1e0, 0xffd9a8];
  for (let i = 0; i < 18; i++) {
    const a = i * 2.39 + 0.4;
    if (angDist(a, DOCK_A) < 0.2 || mainCliff(a) > 0.4) continue;
    const r = isl.shoreR(a) - 0.25 - hash1(i + 9) * 0.35;
    const isShell = i % 3 === 0;
    const m = isShell ? mk(new THREE.ConeGeometry(0.07, 0.06, 7), shellCols[i % 3], 0.015)
      : mk(new THREE.DodecahedronGeometry(0.07 + hash1(i) * 0.09, 0), 0xb7ada4, 0.02);
    m.position.set(Math.cos(a) * r, isl.height(r, a) + 0.03, Math.sin(a) * r);
    m.rotation.set(hash1(i + 3) * 3, hash1(i + 4) * 3, 0);
    env.add(m);
  }

  // 雾：远处的小岛有点空气感（颜色跟天色走）
  scene.fog = new THREE.Fog(0xbfe8ff, 22, 42);

  /* ------------------------------------------------------------ 海 */
  const SHORE_N = 512;
  const shoreData = new Float32Array(SHORE_N);
  for (let i = 0; i < SHORE_N; i++) shoreData[i] = isl.shoreR((i / SHORE_N) * Math.PI * 2 - Math.PI);
  const shoreTex = new THREE.DataTexture(shoreData, SHORE_N, 1, THREE.RedFormat, THREE.FloatType);
  shoreTex.needsUpdate = true;
  const seaU = {
    uT: { value: 0 }, uShore: { value: shoreTex },
    uShallow: { value: new THREE.Color(0x7ce6d8) }, uDeep: { value: new THREE.Color(0x3d9ee6) },
    uFoam: { value: new THREE.Color(0xffffff) }, uFar: { value: new THREE.Color(0xbfe8ff) },
  };
  const SEA_COLS = {
    dawn: [0x8fded2, 0x5a92d6, 0xffd9c2], day: [0x7ce6d8, 0x3d9ee6, 0xbfe8ff],
    dusk: [0x86c4cc, 0x4f6fb0, 0xffc1a8], night: [0x2f7088, 0x1b3160, 0x34407a],
  };
  const sea = new THREE.Mesh(new THREE.CircleGeometry(34, 96), new THREE.ShaderMaterial({
    uniforms: seaU, transparent: true, depthWrite: false,
    vertexShader: `varying vec2 vP; void main(){ vec4 w = modelMatrix * vec4(position,1.); vP = w.xz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `
      varying vec2 vP; uniform float uT; uniform sampler2D uShore; uniform vec3 uShallow, uDeep, uFoam, uFar;
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
        col = mix(col, uFoam, max(foam, max(ring*0.9, glint*0.7)));
        col = mix(col, uFar, smoothstep(6.0, 20.0, r) * 0.65);
        float a0 = max(foam, mix(0.42, 0.95, smoothstep(0.0, 3.0, d)));
        gl_FragColor = vec4(col, (1.0 - smoothstep(16.0, 30.0, r)) * a0);
      }`,
  }));
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = SEA_Y;
  sea.renderOrder = 1;
  env.add(tag(sea, "sea"));
  updaters.push((t) => { seaU.uT.value = t; });

  /* ------------------------------------------------------------ 瀑布：树旁边的小泉眼，流过草地，从崖边落进海里 */
  const wfEdge = isl.edge(WF_A);
  const wfDir = new THREE.Vector3(Math.cos(WF_A), 0, Math.sin(WF_A));
  const flowU = { uT: { value: 0 } };
  const flowMat = (along) => new THREE.ShaderMaterial({
    uniforms: flowU, transparent: true,
    vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }",
    fragmentShader: `varying vec2 vUv; uniform float uT;
      void main(){
        float v = ${along === "y" ? "vUv.y" : "vUv.x"}, u = ${along === "y" ? "vUv.x" : "vUv.y"};
        float s = fract(v*3.0 + uT*${along === "y" ? "1.8" : "-0.9"} + sin(u*12.0)*0.08);
        vec3 c = mix(vec3(0.55,0.88,0.98), vec3(0.83,0.97,1.0), step(0.6, s));
        float edge = smoothstep(0.0, 0.12, u) * smoothstep(1.0, 0.88, u);
        c = mix(vec3(1.0), c, edge);
        gl_FragColor = vec4(c, 0.93);
      }`,
  });
  // 泉眼：一圈小石头围着
  const spring = new THREE.Group();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2, r = mk(new THREE.DodecahedronGeometry(0.11, 0), 0xb9b0a6, 0.02);
    r.position.set(Math.cos(a) * 0.24, 0.05, Math.sin(a) * 0.24);
    spring.add(r);
  }
  const pool = new THREE.Mesh(new THREE.CircleGeometry(0.22, 16), flowMat("x"));
  pool.rotation.x = -Math.PI / 2; pool.position.y = 0.04;
  spring.add(pool);
  spring.position.copy(wfDir).multiplyScalar(2.55);
  env.add(tag(spring, "spring"));
  // 溪流：从泉眼到崖边
  const streamLen = wfEdge - 2.55 + 0.05;
  const stream = new THREE.Mesh(new THREE.PlaneGeometry(streamLen, 0.24), flowMat("x"));
  stream.rotation.set(-Math.PI / 2, 0, -WF_A);
  stream.position.copy(wfDir).multiplyScalar(2.55 + streamLen / 2).setY(0.02);
  env.add(stream);
  // 瀑布本身：一片从崖边往下弯的水帘
  const fallGeo = new THREE.PlaneGeometry(0.32, 1.0, 1, 8);
  { const p = fallGeo.attributes.position;
    for (let i = 0; i < p.count; i++) { const y = p.getY(i), k = 0.5 - y; p.setZ(i, 0.25 * k * k + 0.05); p.setY(i, y - 0.5); } }
  const fall = new THREE.Mesh(fallGeo, flowMat("y"));
  fall.material.side = THREE.DoubleSide;
  fall.position.copy(wfDir).multiplyScalar(wfEdge + 0.02).setY(0.02);
  fall.rotation.y = Math.PI / 2 - WF_A;
  env.add(fall);
  // 瀑布底下的水花
  const foamBalls = Array.from({ length: 5 }, (_, i) => {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true }));
    b.userData.p = i / 5;
    env.add(b);
    return b;
  });
  const fallFoot = wfDir.clone().multiplyScalar(isl.shoreR(WF_A) + 0.1).setY(SEA_Y);
  updaters.push((t) => {
    flowU.uT.value = t;
    foamBalls.forEach((b, i) => {
      const p = (t * 0.8 + b.userData.p) % 1;
      const a = i * 1.3;
      b.position.set(fallFoot.x + Math.cos(a) * p * 0.35, SEA_Y + 0.05 + Math.sin(p * Math.PI) * 0.18, fallFoot.z + Math.sin(a) * p * 0.35);
      b.scale.setScalar(0.6 + p);
      b.material.opacity = 1 - p;
    });
  });

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
  lantern.add(lPole, lBox, lLight);
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
  const TUFTS = 230;
  const grass = new THREE.InstancedMesh(tuftGeo, grassMat, TUFTS);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3();
  const gc = [0x5fb85a, 0x6fc865, 0x83d470, 0x4fa54f].map((c) => new THREE.Color(c));
  let n = 0, seed = 1;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  while (n < TUFTS) {
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * (isl.edge(a) - 0.12);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (Math.hypot(x - 0.35, z - 0.75) < 0.7) continue;         // 小伙伴的家
    if (Math.hypot(x + 1.55, z + 0.85) < 1.05) continue;        // 床
    if (angDist(Math.atan2(z, x), WF_A) < 0.2 && r > 2.2) continue; // 溪流
    ps.set(x, 0, z);
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
  for (const [x, z, s] of [[-2.95, -1.25, 0.9], [3.05, -0.15, 0.75], [-1.05, 2.95, 0.8], [1.85, 2.75, 0.65]]) {
    const b = new THREE.Group();
    for (const [dx, dy, dz, r, c] of [[0, 0.2, 0, 0.3, 0x5fae5f], [0.24, 0.14, 0.06, 0.22, 0x6fc06a], [-0.2, 0.13, 0.08, 0.2, 0x58a85a]]) {
      const m = mk(new THREE.SphereGeometry(r, 12, 9), c, 0.025);
      m.position.set(dx, dy, dz); m.scale.y = 0.85;
      b.add(m);
    }
    b.position.set(x, 0, z); b.scale.setScalar(s);
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
  tower.add(lampHouse, roof, beamPivot, hut, hutRoof);
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
  const far = islet(4, -17, { R0: 3.0, H: SEA_Y + 1.4, seed: 31, cliff: (a) => 0.3 + 0.5 * bump(angDist(a, Math.PI / 2), 1.2), wob: 0.25, slope: [1.6, 0.5], beach: [0.8, 0.3] });
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
  perch.position.y = reef.userData.topY + 0.05;
  perch.scale.setScalar(0.9);
  reef.add(perch);

  /* ------------------------------------------------------------ 云 */
  const clouds = new THREE.Group();
  const cloudMat = toon(0xffffff, { emissive: 0xffffff, emissiveIntensity: 0.25 });
  for (let i = 0; i < 6; i++) {
    const c = new THREE.Group();
    const puffs = 4 + (i % 3);
    for (let k = 0; k < puffs; k++) {
      const r = 0.45 + hash1(i * 7 + k) * 0.4;
      const m = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), cloudMat);
      m.position.set((k - puffs / 2) * 0.55, Math.sin(k * 1.7) * 0.15 + (k % 2 ? 0.2 : 0), hash1(k + i) * 0.3);
      m.scale.y = 0.75;
      c.add(m);
    }
    const a = (i / 6) * Math.PI * 2 + 0.4, R = 13 + (i % 3) * 3;
    c.position.set(Math.cos(a) * R, 3.6 + (i % 3) * 0.9, Math.sin(a) * R);
    c.lookAt(0, c.position.y, 0);
    c.scale.setScalar(0.9 + (i % 2) * 0.5);
    clouds.add(c);
  }
  env.add(clouds);
  updaters.push((t, dt) => { clouds.rotation.y += dt * 0.012; });

  /* ------------------------------------------------------------ 海鸥（白天绕圈） */
  const gulls = [0, 1].map((i) => { const g = makeGull(mk); g.userData.i = i; env.add(g); return g; });
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
    b.userData = { wings, i };
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
    const [s, d, f] = SEA_COLS[k] || SEA_COLS.day;
    seaU.uShallow.value.setHex(s); seaU.uDeep.value.setHex(d); seaU.uFar.value.setHex(f);
    scene.fog.color.setHex(f);
    cloudMat.color.setHex(k === "night" ? 0x8c94c8 : k === "dusk" ? 0xffd6c8 : 0xffffff);
    cloudMat.emissive.setHex(k === "night" ? 0x2a3060 : 0xffffff);
    cloudMat.emissiveIntensity = k === "night" ? 0.3 : 0.22;
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

  return { top, ground, sea, dock, env, update, setSky, splash, SEA_Y, heightAt: (x, z) => isl.height(Math.hypot(x, z), Math.atan2(z, x)) };
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
