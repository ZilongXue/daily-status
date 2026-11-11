// 扭蛋机 + 扭蛋 + 扭蛋限定装饰的 Q 版模型（Three.js r170），全部程序化，没有外部模型。
// 约定：地面 y=0，正面朝 +z；装饰占地约 1×1 以内、高 0.6–1.6，和小岛上现有装饰同一个比例。
// 会动的部分放在 root.userData.anim = (t) => {...}（t 是秒）。
import * as THREE from "three";
import {
  kit, X, rng, sph, ell, hemi, cyl, cone, tor, lathe, rod, roundBox, weld, tube, starGeo, heartGeo,
  stripeByAngle, merge, caneGeo, caneTex, rowTex, eyeInto, smileGeo, onBall,
  buildXmasTree, xmasTreeTick, buildSnowmanFamily,
} from "./xmas3d.js?v=16";

const TAU = Math.PI * 2;
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const DARK = 0x2b1d18;

/* ================================================================ catalog */
export const GACHA_RARITY = {
  common: { name: "普通", color: "#8ea4ba", weight: 60 },
  rare: { name: "稀有", color: "#3fa2ff", weight: 30 },
  epic: { name: "史诗", color: "#b06bff", weight: 10 },
};

export const GACHA_DECOR = {
  paper_lantern: { name: "纸灯笼", emoji: "🏮", rarity: "common" },
  pinwheel: { name: "小风车花", emoji: "🌸", rarity: "common" },
  mushroom_lamp: { name: "蘑菇灯", emoji: "🍄", rarity: "common" },
  bird_house: { name: "小鸟屋", emoji: "🐦", rarity: "common" },
  cat_tower: { name: "猫爬架", emoji: "🐱", rarity: "rare" },
  hammock: { name: "吊床", emoji: "😴", rarity: "rare" },
  star_lamp: { name: "星星灯", emoji: "⭐", rarity: "rare" },
  carousel: { name: "小旋转木马", emoji: "🎠", rarity: "epic" },
  hot_air_heart: { name: "爱心热气球", emoji: "🎈", rarity: "epic" },
  xmas_tree: { name: "圣诞树", emoji: "🎄", rarity: "rare", season: "xmas" },
  reindeer: { name: "小驯鹿", emoji: "🦌", rarity: "epic", season: "xmas" },
  gingerbread: { name: "姜饼屋", emoji: "🍪", rarity: "rare", season: "xmas" },
  snow_family: { name: "雪人一家", emoji: "⛄", rarity: "rare", season: "xmas" },
  candy_lane: { name: "拐杖糖小路", emoji: "🍭", rarity: "common", season: "xmas" },
};

// 按稀有度权重抽一个；season 不对的限定款不进池子
export function rollGachaDecor(rnd = Math.random, season = null) {
  const ids = Object.keys(GACHA_DECOR).filter((id) => !GACHA_DECOR[id].season || GACHA_DECOR[id].season === season);
  const per = (r) => ids.filter((j) => GACHA_DECOR[j].rarity === r).length;
  const w = ids.map((id) => GACHA_RARITY[GACHA_DECOR[id].rarity].weight / per(GACHA_DECOR[id].rarity));
  let r = rnd() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < ids.length; i++) if ((r -= w[i]) < 0) return ids[i];
  return ids[0];
}

/* ================================================================ 玻璃罩材质（自带一圈描边色的菲涅尔边） */
function glassMat() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { tint: { value: new THREE.Color(0xdaf3ff) }, rim: { value: new THREE.Color(0x4a2f25) }, glow: { value: 0 } },
    vertexShader: `varying vec3 vN; varying vec3 vV;
      void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 tint; uniform vec3 rim; uniform float glow; varying vec3 vN; varying vec3 vV;
      void main() {
        float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
        vec3 c = mix(tint, vec3(1.0), glow * 0.5);
        float a = 0.1 + 0.42 * smoothstep(0.35, 0.72, f) + glow * 0.15;
        if (f > 0.8) { c = rim; a = 1.0; }
        gl_FragColor = vec4(c, a);
        #include <colorspace_fragment>
      }`,
  });
}

/* ================================================================ 扭蛋机 */
const CAP_COLS = [0xff8fab, 0xffd36b, 0x8fd3ff, 0x9fe0c8, 0xc3a6ff, 0xffb38a, 0xfffaf5, 0xff6b8b];

export function buildGachaMachine(T) {
  const K = kit(T);
  const root = new THREE.Group();
  const body = new THREE.Group(); // 弹跳 / 压扁都动这个，root 留给调用方摆位置
  root.add(body);
  const big = [], small = [], flat = [];
  // 底座 + 机身
  big.push([roundBox(0.72, 0.07, 0.62, 0.03).translate(0, 0.035, 0), 0xf58fb0]);
  big.push([roundBox(0.64, 0.5, 0.54, 0.09).translate(0, 0.32, 0), 0xffb6cb]);
  // 正面奶油色面板
  big.push([roundBox(0.5, 0.4, 0.04, 0.05).translate(0, 0.3, 0.262), 0xfff3e2]);
  // 领口（金色杯口托着玻璃罩）
  big.push([lathe([[0.2, 0.555], [0.29, 0.56], [0.3, 0.6], [0.27, 0.64], [0.22, 0.64]], 28), 0xffd36b]);
  // 摇把后面的圆盘
  big.push([cyl(0.155, 0.155, 0.025, 24).rotateX(Math.PI / 2).translate(0, 0.37, 0.29), 0xfffaf5]);
  // 出口托盘
  big.push([roundBox(0.25, 0.05, 0.1, 0.022).translate(0, 0.095, 0.31), 0x9fe0c8]);
  // 右边投币口
  small.push([roundBox(0.075, 0.11, 0.025, 0.012).translate(0.195, 0.4, 0.287), 0xd9dde8]);
  flat.push([new THREE.BoxGeometry(0.014, 0.065, 0.01).translate(0.195, 0.4, 0.3), 0x3a2a28]);
  // 左边爱心贴纸
  const hs = heartGeo(0.085, 0.012, 16, 10);
  small.push([hs.translate(-0.195, 0.41, 0.289), 0xff6b8b]);
  // 领口一圈小灯
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU;
    flat.push([sph(0.017, 6, 4).translate(Math.cos(a) * 0.3, 0.6, Math.sin(a) * 0.3), i % 2 ? 0xfff2a0 : 0xffc2d6]);
  }
  // 出口：深色洞
  flat.push([roundBox(0.19, 0.11, 0.02, 0.03).translate(0, 0.17, 0.276), 0x3a2a28]);
  // 顶盖 + 星星招牌的小杆
  big.push([lathe([[0, 1.115], [0.1, 1.11], [0.125, 1.08], [0.12, 1.06], [0.0, 1.06]], 20), 0x9fe0c8]);
  small.push([cyl(0.016, 0.016, 0.08, 6).translate(0, 1.15, 0), 0xfffaf5]);
  body.add(K.part(big, 0.022), K.part(small, 0.012), K.flat(flat));

  // 玻璃罩 + 里面的扭蛋
  const dome = new THREE.Group();
  dome.position.y = 0.8;
  const glass = new THREE.Mesh(sph(0.29, 32, 22), glassMat());
  glass.renderOrder = 2;
  glass.castShadow = false;
  glass.userData.noShadow = true;
  dome.add(glass);
  const shine = new THREE.Mesh(tube([[-0.13, 0.21, 0.135], [-0.19, 0.12, 0.18], [-0.205, 0.0, 0.195]].map((p) => V3(...p).setLength(0.284)), (t) => 0.004 + 0.011 * Math.sin(t * Math.PI), 12, 6),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false }));
  shine.renderOrder = 3;
  dome.add(shine);
  const dot = new THREE.Mesh(sph(0.014, 6, 4), shine.material);
  dot.position.copy(V3(-0.07, 0.24, 0.15).setLength(0.285));
  dot.renderOrder = 3;
  dome.add(dot);
  const capsules = new THREE.Group();
  const rnd = rng(5), placed = [];
  for (let tries = 0; placed.length < 15 && tries < 600; tries++) {
    const p = V3((rnd() - 0.5) * 0.44, -0.17 + rnd() * 0.22, (rnd() - 0.5) * 0.44);
    if (p.length() > 0.215) continue;
    if (placed.some((q) => q.distanceTo(p) < 0.115)) continue;
    placed.push(p);
  }
  placed.sort((a, b) => a.y - b.y);
  const layers = [[], []];
  placed.forEach((p, i) => {
    const o = { r: [rnd() * TAU, rnd() * TAU, rnd() * TAU], p };
    const r = 0.064, a = CAP_COLS[i % CAP_COLS.length], b = CAP_COLS[(i * 3 + 2) % CAP_COLS.length];
    const L = layers[i % 2];
    L.push([X(new THREE.SphereGeometry(r, 10, 4, 0, TAU, 0, Math.PI / 2), o), a]);
    L.push([X(new THREE.SphereGeometry(r, 10, 4, 0, TAU, Math.PI / 2, Math.PI / 2), o), b === a ? 0xfffaf5 : b]);
    L.push([X(tor(r, 0.008, 3, 12).rotateX(Math.PI / 2), o), 0xfffaf5]);
  });
  for (const L of layers) capsules.add(K.part(L, 0.009));
  dome.add(capsules);
  body.add(dome);

  // 摇把：绕 z 转的 pivot
  const crank = new THREE.Group();
  crank.position.set(0, 0.37, 0.302);
  crank.add(K.part([
    [cyl(0.122, 0.122, 0.055, 24).rotateX(Math.PI / 2).translate(0, 0, 0.028), 0xb9a3ff],
    [roundBox(0.25, 0.062, 0.06, 0.028).translate(0, 0, 0.075), 0xfffaf5],
    [sph(0.03, 10, 8).translate(0.1, 0, 0.11), 0xff8fab],
    [sph(0.03, 10, 8).translate(-0.1, 0, 0.11), 0xff8fab],
  ], 0.02));
  body.add(crank);

  // 出口：chute 放在洞口前面（扭蛋从这里滚出来），flap 是上沿的小门
  const chute = new THREE.Group();
  chute.position.set(0, 0.17, 0.3);
  const flap = new THREE.Group();
  flap.position.set(0, 0.055, -0.01);
  const fm = K.one(roundBox(0.18, 0.1, 0.014, 0.025).translate(0, -0.05, 0), 0xbfeee0, 0.012, { transparent: true, opacity: 0.82 });
  flap.add(fm);
  chute.add(flap);
  chute.userData.flap = flap;
  body.add(chute);

  // 顶上的星星招牌（light：自己的 emissive 材质 + 光晕）
  const sign = new THREE.Group();
  sign.position.y = 1.24;
  const light = K.one(starGeo(0.085, 0.045, 0.03, 0.022), 0xffe066, 0.015, { emissive: 0xffb300, emissiveIntensity: 0.5 });
  sign.add(light);
  const halo = K.halo(0xffe27a, 0.45, 0.45);
  halo.position.z = -0.03;
  sign.add(halo);
  light.userData.halo = halo;
  body.add(sign);

  const m = { root, body, crank, dome, glass, capsules, chute, light, sign };
  machineIdle(m, 0);
  return m;
}

// 平时：扭蛋轻轻晃、招牌慢慢转着发光
export function machineIdle(m, t) {
  m.body.position.y = 0;
  m.body.scale.set(1, 1, 1);
  m.crank.rotation.z = 0;
  m.chute.userData.flap.rotation.x = 0;
  m.capsules.children.forEach((c, i) => { c.position.set(0, Math.sin(t * 1.3 + i * 2.1) * 0.004, 0); c.rotation.set(0, Math.sin(t * 0.7 + i) * 0.04, 0); });
  m.sign.rotation.y = Math.sin(t * 0.9) * 0.4;
  m.sign.scale.setScalar(1);
  m.light.material.emissiveIntensity = 0.45 + Math.sin(t * 2.2) * 0.15;
  m.light.userData.halo.material.opacity = 0.4 + Math.sin(t * 2.2) * 0.1;
  m.glass.material.uniforms.glow.value = 0;
}

// 扭一次：k 从 0 到 1。摇把转一圈、扭蛋哗啦啦、机器弹两下、最后出口小门打开
export function machineSpin(m, k) {
  k = Math.max(0, Math.min(1, k));
  const ease = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
  m.crank.rotation.z = -ease * TAU;
  const shake = Math.sin(Math.PI * Math.min(1, k * 1.15)) ** 0.7;
  m.capsules.children.forEach((c, i) => {
    const ph = i * 1.7;
    c.position.set(Math.sin(k * 47 + ph) * 0.012 * shake, Math.abs(Math.sin(k * 31 + ph)) * 0.03 * shake, Math.cos(k * 39 + ph) * 0.01 * shake);
    c.rotation.set(Math.sin(k * 23 + ph) * 0.25 * shake, Math.sin(k * 29 + ph) * 0.6 * shake, Math.sin(k * 19 + ph) * 0.25 * shake);
  });
  // 两下弹跳 + 落地压扁
  const hop = Math.max(0, Math.sin(k * Math.PI * 4)) * (1 - k) * 0.06;
  const sq = Math.sin(k * Math.PI * 8) * (1 - k) * 0.05;
  m.body.position.y = hop;
  m.body.scale.set(1 + sq, 1 - sq, 1 + sq);
  m.chute.userData.flap.rotation.x = k > 0.72 ? -Math.sin(((k - 0.72) / 0.28) * Math.PI) * 1.1 : 0;
  m.sign.rotation.y = ease * TAU * 2;
  m.sign.scale.setScalar(1 + Math.sin(k * Math.PI) * 0.25);
  const flash = Math.abs(Math.sin(k * Math.PI * 6));
  m.light.material.emissiveIntensity = 0.5 + flash * 0.8;
  m.light.userData.halo.material.opacity = 0.45 + flash * 0.4;
  m.glass.material.uniforms.glow.value = Math.sin(k * Math.PI) * 0.6;
}

/* ================================================================ 扭蛋 */
// 直径 0.32；原点在扭蛋底部（放在地上 y=0）；top 是后沿的铰链，top.rotation.x 往 -2 转就打开
export function buildCapsule(colorTop, colorBottom, T) {
  const K = kit(T);
  const R = 0.16;
  const root = new THREE.Group();
  const side = { side: THREE.DoubleSide };
  const bottom = K.one(new THREE.SphereGeometry(R, 22, 8, 0, TAU, Math.PI / 2, Math.PI / 2), colorBottom, 0.018, side);
  bottom.position.y = R;
  root.add(bottom);
  // 里面一层奶油色的「隔板」，打开时能看到
  const inner = K.one(cyl(R * 0.97, R * 0.97, 0.012, 22).translate(0, -0.008, 0), 0xfff3e2, 0);
  bottom.add(inner);
  const band = K.one(tor(R * 0.995, 0.014, 6, 32).rotateX(Math.PI / 2), 0xfffaf5, 0.008);
  bottom.add(band);
  const top = new THREE.Group();
  top.position.set(0, R, -R);
  const lid = K.one(new THREE.SphereGeometry(R, 22, 8, 0, TAU, 0, Math.PI / 2), colorTop, 0.018, { side: THREE.DoubleSide, transparent: true, opacity: 0.92 });
  lid.position.z = R;
  top.add(lid);
  // 盖子上的高光 + 小星星贴纸
  const hl = K.flat([[ell(0.038, 0.02, 0.01, 10, 6).rotateZ(0.6).rotateX(-0.5).translate(-0.07, 0.11, 0.08), 0xffffff]]);
  lid.add(hl);
  const st = K.one(starGeo(0.03, 0.016, 0.006, 0.006).rotateX(-0.75).translate(0.05, 0.108, 0.1), 0xfffaf5, 0.008);
  lid.add(st);
  root.add(top);
  return { root, top };
}

/* ================================================================ 限定装饰 */
const WOOD = 0xc58f5a, WOOD_D = 0x8a5a3b, CREAM = 0xfff3e2, WHITE = 0xfffaf5, GOLD = 0xffd36b;
const GRASS = [0x7fd88e, 0x6fcf86];

const D = {
  /* ------------------------------------------------ 纸灯笼：T 字木架两边各挂一只，会轻轻晃 */
  paper_lantern(K, root) {
    const big = [];
    big.push([roundBox(0.3, 0.08, 0.26, 0.03).translate(0, 0.04, 0), 0xb5aaa0]);
    big.push([roundBox(0.075, 1.04, 0.075, 0.025).translate(0, 0.6, 0), WOOD]);
    big.push([roundBox(0.74, 0.07, 0.075, 0.028).translate(0, 1.08, 0), WOOD]);
    big.push([sph(0.05, 10, 8).translate(0, 1.13, 0), GOLD]);
    for (const s of [-1, 1]) big.push([sph(0.035, 8, 6).translate(s * 0.38, 1.08, 0), GOLD]);
    root.add(K.part(big, 0.022));
    const lanterns = [];
    [[-1, 0xff6b6b, 0xff3a3a], [1, 0xffa0b8, 0xff6f96]].forEach(([s, col, em], i) => {
      const piv = new THREE.Group();
      piv.position.set(s * 0.29, 1.045, 0);
      // 纸灯笼：扁圆、一道道竹骨
      const pts = [];
      for (let j = 0; j <= 14; j++) { const a = -Math.PI / 2 + (Math.PI * j) / 14; pts.push([0.165 * Math.cos(a), 0.135 * Math.sin(a)]); }
      const g = lathe(pts, 40);
      const p = g.attributes.position;
      for (let v = 0; v < p.count; v++) { const x = p.getX(v), z = p.getZ(v), k = 1 + 0.035 * Math.abs(Math.cos(Math.atan2(z, x) * 5)); p.setX(v, x * k); p.setZ(v, z * k); }
      weld(g);
      const body = K.one(g.translate(0, -0.29, 0), col, 0.02, { emissive: em, emissiveIntensity: 0.3 });
      piv.add(body);
      piv.add(K.part([
        [cyl(0.004, 0.004, 0.11, 4).translate(0, -0.055, 0), 0x6b5446],
        [cyl(0.055, 0.07, 0.04, 14).translate(0, -0.135, 0), GOLD],
        [cyl(0.07, 0.055, 0.04, 14).translate(0, -0.445, 0), GOLD],
        [sph(0.022, 8, 6).translate(0, -0.475, 0), GOLD],
        [cyl(0.014, 0.032, 0.1, 10).translate(0, -0.54, 0), col],
        [tor(0.016, 0.006, 4, 10).rotateX(Math.PI / 2).translate(0, -0.5, 0), GOLD],
      ], 0.012));
      const halo = K.halo(em, 0.75, 0.35);
      halo.position.y = -0.29;
      piv.add(halo);
      root.add(piv);
      lanterns.push({ piv, body, halo, ph: i * 2.1 });
    });
    root.userData.anim = (t) => {
      for (const l of lanterns) {
        l.piv.rotation.z = Math.sin(t * 1.4 + l.ph) * 0.09;
        l.piv.rotation.x = Math.sin(t * 1.05 + l.ph) * 0.05;
        const k = 0.5 + 0.5 * Math.sin(t * 2.3 + l.ph);
        l.body.material.emissiveIntensity = 0.24 + k * 0.14;
        l.halo.material.opacity = l.halo.userData.base * (0.75 + k * 0.4);
      }
    };
  },

  /* ------------------------------------------------ 小风车花：花盆里插三朵会转的花瓣风车 */
  pinwheel(K, root) {
    const base = [];
    base.push([lathe([[0, 0], [0.15, 0], [0.175, 0.03], [0.2, 0.2], [0.225, 0.215], [0.225, 0.27], [0.19, 0.275], [0.0, 0.255]], 24), 0xffb38a]);
    base.push([tor(0.21, 0.018, 6, 24).rotateX(Math.PI / 2).translate(0, 0.14, 0), WHITE]);
    base.push([cyl(0.19, 0.19, 0.02, 20).translate(0, 0.258, 0), 0x7a5235]);
    const heads = [
      { foot: [-0.06, 0.26, 0.0], top: [-0.2, 0.92, 0.0], cols: [0xff8fab, WHITE], spd: 2.1 },
      { foot: [0.06, 0.26, -0.02], top: [0.21, 0.8, -0.02], cols: [0x8fd3ff, 0xfff2a0], spd: -1.6 },
      { foot: [0.0, 0.26, 0.07], top: [0.0, 0.62, 0.13], cols: [0xc3a6ff, 0xffd1e3], spd: 2.7 },
    ];
    const spin = [];
    for (const h of heads) {
      base.push([rod(h.foot, h.top, 0.012, 5), CREAM]);
      const mid = V3(...h.foot).lerp(V3(...h.top), 0.45);
      base.push([ell(0.06, 0.02, 0.03, 8, 6).rotateZ(0.5).translate(mid.x + 0.045, mid.y, mid.z), GRASS[0]]);
      const g = new THREE.Group();
      g.position.set(h.top[0], h.top[1], h.top[2] + 0.02);
      const petals = [];
      for (let i = 0; i < 6; i++) {
        petals.push([X(ell(0.085, 0.048, 0.014, 12, 8).translate(0.085, 0, 0).rotateX(0.55), { r: [0, 0, (i * TAU) / 6] }), h.cols[i % 2]]);
      }
      petals.push([sph(0.03, 10, 8).scale(1, 1, 0.7).translate(0, 0, 0.012), GOLD]);
      g.add(K.part(petals, 0.011));
      g.userData.spd = h.spd;
      root.add(g);
      spin.push(g);
    }
    root.add(K.part(base, 0.02));
    root.userData.anim = (t) => { for (const g of spin) g.rotation.z = t * g.userData.spd; };
  },

  /* ------------------------------------------------ 蘑菇灯：会呼吸的大蘑菇，斑点和小窗会发光，旁边一朵蘑菇宝宝 */
  mushroom_lamp(K, root) {
    const big = [], small = [], flat = [];
    big.push([lathe([[0, 0], [0.155, 0], [0.165, 0.04], [0.145, 0.2], [0.125, 0.38], [0.115, 0.5], [0, 0.5]], 20), CREAM]);
    small.push([roundBox(0.09, 0.14, 0.03, 0.04).translate(0, 0.07, 0.152), WOOD_D]);
    small.push([sph(0.012, 6, 4).translate(0.025, 0.07, 0.17), GOLD]);
    small.push([tor(0.045, 0.012, 6, 16).translate(0, 0.27, 0.142), WOOD]);
    flat.push([cyl(0.04, 0.04, 0.01, 14).rotateX(Math.PI / 2).translate(0, 0.27, 0.14), 0xffe9a8]);
    flat.push([new THREE.BoxGeometry(0.008, 0.08, 0.004).translate(0, 0.27, 0.146), WOOD]);
    flat.push([new THREE.BoxGeometry(0.08, 0.008, 0.004).translate(0, 0.27, 0.146), WOOD]);
    // 小蘑菇宝宝
    const bx = 0.27, bz = 0.2;
    big.push([lathe([[0, 0], [0.05, 0], [0.045, 0.1], [0, 0.1]], 12).translate(bx, 0, bz), CREAM]);
    big.push([lathe([[0, 0.085], [0.1, 0.085], [0.105, 0.1], [0.08, 0.15], [0, 0.17]], 16).translate(bx, 0, bz), 0x9fe0c8]);
    for (const [dx, dz] of [[0.03, 0.05], [-0.04, 0.04], [0.0, -0.06]]) small.push([sph(0.017, 6, 4).scale(1, 0.5, 1).translate(bx + dx, 0.147, bz + dz), WHITE]);
    // 小草叶
    for (const [x, z] of [[-0.22, 0.12], [0.18, -0.16], [-0.12, -0.2]]) for (let i = 0; i < 3; i++) small.push([ell(0.018, 0.055, 0.01, 6, 5).rotateZ((i - 1) * 0.5).translate(x + (i - 1) * 0.022, 0.04, z), GRASS[i % 2]]);
    root.add(K.part(big, 0.02), K.part(small, 0.01), K.flat(flat));
    // 大伞盖（会呼吸）+ 发光的斑点和菌褶
    const cap = new THREE.Group();
    cap.position.y = 0.45;
    const prof = [[0.3, 0.0], [0.37, 0.02], [0.395, 0.07], [0.37, 0.17], [0.29, 0.26], [0.16, 0.32], [0, 0.34]];
    cap.add(K.one(lathe(prof, 28), 0xff7d8c, 0.024));
    const on = (sv, th) => { // 伞盖表面上的点：sv 是轮廓上的位置，th 是方位角（π/2 = 正面）
      const i = Math.min(prof.length - 2, Math.floor(sv)), u = sv - i, a = prof[i], b = prof[i + 1];
      const r = a[0] + (b[0] - a[0]) * u, y = a[1] + (b[1] - a[1]) * u, dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy);
      return { p: V3(r * Math.cos(th), y, r * Math.sin(th)), n: V3((dy / l) * Math.cos(th), -dx / l, (dy / l) * Math.sin(th)) };
    };
    const spots = [];
    const F = Math.PI / 2;
    [[4.5, F + 0.15, 0.06], [3.3, F - 0.75, 0.05], [3.4, F + 0.85, 0.045], [2.3, F, 0.04], [4.3, F + 2.2, 0.055], [3.4, -F, 0.06],
      [4.1, F - 2.1, 0.05], [2.4, F + 1.7, 0.04], [2.5, F - 1.5, 0.04], [5.5, 0.4, 0.05], [2.4, -F + 0.9, 0.04]].forEach(([sv, th, r]) => {
      const o = on(sv, th);
      spots.push([X(ell(r, r, r * 0.3, 10, 6), { n: o.n, p: o.p.addScaledVector(o.n, 0.004) }), 0xfffbe6]);
    });
    const sm = new THREE.Mesh(merge(spots.map((x) => x[0])), new THREE.MeshBasicMaterial({ color: 0xfffbe6 }));
    cap.add(sm);
    const gm = new THREE.MeshBasicMaterial({ color: 0xfff0b0 });
    const gills = new THREE.Mesh(lathe([[0, 0.05], [0.12, 0.035], [0.3, 0.003]], 28), gm);
    cap.add(gills);
    const halo = K.halo(0xffd77a, 1.1, 0.38);
    halo.position.set(0, 0.0, 0.05);
    cap.add(halo);
    root.add(cap);
    root.userData.anim = (t) => {
      const k = 0.5 + 0.5 * Math.sin(t * 1.6);
      cap.scale.set(1 + k * 0.025, 1 - k * 0.03, 1 + k * 0.025);
      gm.color.setHex(0xfff0b0).multiplyScalar(0.88 + k * 0.12);
      sm.material.color.setHex(0xfffbe6).multiplyScalar(0.9 + k * 0.1);
      halo.material.opacity = 0.28 + k * 0.18;
    };
  },

  /* ------------------------------------------------ 小鸟屋：木杆上的小房子，屋顶站一只会蹦的小黄鸟 */
  bird_house(K, root) {
    const big = [], small = [], flat = [];
    big.push([sph(0.2, 16, 10).scale(1, 0.32, 1), GRASS[0]]);
    big.push([roundBox(0.07, 0.76, 0.07, 0.022).translate(0, 0.4, 0), WOOD]);
    big.push([roundBox(0.38, 0.04, 0.36, 0.015).translate(0, 0.77, 0), WOOD]);
    big.push([roundBox(0.3, 0.28, 0.28, 0.04).translate(0, 0.93, 0), 0x9fdcc0]);
    const gable = new THREE.Shape();
    gable.moveTo(-0.15, 0); gable.lineTo(0.15, 0); gable.lineTo(0, 0.13); gable.closePath();
    big.push([new THREE.ExtrudeGeometry(gable, { depth: 0.26, bevelEnabled: false }).translate(0, 1.05, -0.13), 0x9fdcc0]);
    for (const s of [-1, 1]) big.push([roundBox(0.25, 0.035, 0.37, 0.015).rotateZ(-s * 0.72).translate(s * 0.095, 1.125, 0), 0xff8a6b]);
    small.push([tor(0.056, 0.012, 6, 18).translate(0, 0.94, 0.142), WHITE]);
    flat.push([cyl(0.052, 0.052, 0.01, 16).rotateX(Math.PI / 2).translate(0, 0.94, 0.138), 0x3a2a28]);
    small.push([cyl(0.012, 0.012, 0.08, 6).rotateX(Math.PI / 2).translate(0, 0.86, 0.17), WOOD_D]);
    small.push([heartGeo(0.055, 0.012, 14, 8).translate(0, 1.09, 0.135), 0xff8fab]);
    // 小花
    for (const [x, z, c] of [[0.13, 0.11, 0xff8fab], [-0.12, 0.12, 0xffd36b], [0.05, -0.14, 0xc3a6ff]]) {
      small.push([cyl(0.006, 0.006, 0.08, 4).translate(x, 0.08, z), GRASS[1]]);
      for (let i = 0; i < 5; i++) { const a = (i / 5) * TAU; small.push([sph(0.018, 6, 4).translate(x + Math.cos(a) * 0.02, 0.125, z + Math.sin(a) * 0.02), c]); }
      small.push([sph(0.013, 6, 4).translate(x, 0.128, z), WHITE]);
    }
    root.add(K.part(big, 0.02), K.part(small, 0.01), K.flat(flat));
    // 小鸟
    const bird = new THREE.Group();
    bird.position.set(0.0, 1.2, 0.02);
    const B = [], F = [];
    B.push([ell(0.07, 0.065, 0.075, 14, 10).translate(0, 0.06, 0), 0xffe27a]);
    B.push([ell(0.05, 0.045, 0.035, 10, 8).translate(0, 0.04, 0.045), 0xfff6d0]);
    for (const s of [-1, 1]) B.push([ell(0.02, 0.04, 0.05, 8, 6).rotateX(0.4).translate(s * 0.066, 0.06, -0.01), 0xffc94a]);
    B.push([ell(0.03, 0.012, 0.05, 8, 6).rotateX(-0.6).translate(0, 0.1, -0.08), 0xffc94a]);
    B.push([cone(0.018, 0.035, 6).rotateX(Math.PI / 2).translate(0, 0.075, 0.09), 0xff9a4a]);
    B.push([ell(0.012, 0.008, 0.02, 6, 4).translate(0, 0.123, 0.0), 0xffc94a]);
    for (const s of [-1, 1]) eyeInto(F, 0.011, V3(s * 0.035, 0.09, 0.064), V3(s * 0.5, 0.1, 1));
    bird.add(K.part(B, 0.01), K.flat(F));
    bird.add(K.blushes([-1, 1].map((s) => X(ell(0.012, 0.007, 0.004, 8, 4), { n: V3(s * 0.7, 0, 1), p: [s * 0.05, 0.072, 0.058] }))));
    root.add(bird);
    root.userData.anim = (t) => {
      const c = t % 2.6;
      bird.position.y = 1.2 + (c < 0.35 ? Math.sin((c / 0.35) * Math.PI) * 0.05 : 0);
      bird.rotation.z = Math.sin(t * 1.7) * 0.15;
      bird.rotation.y = Math.sin(t * 0.6) * 0.5;
    };
  },

  /* ------------------------------------------------ 猫爬架：麻绳柱、猫窝洞、猫耳朵窝、晃来晃去的逗猫球 */
  cat_tower(K, root) {
    const big = [], small = [], flat = [];
    const PAD = 0xcdb8ff, PINK = 0xffb6cb;
    big.push([roundBox(0.84, 0.06, 0.6, 0.025).translate(0, 0.03, 0), 0xb8e6d2]);
    // 猫窝（右边）
    big.push([roundBox(0.38, 0.34, 0.38, 0.06).translate(0.2, 0.23, -0.02), PINK]);
    flat.push([cyl(0.085, 0.085, 0.01, 18).rotateX(Math.PI / 2).translate(0.2, 0.215, 0.172), 0x4a3238]);
    small.push([tor(0.09, 0.016, 6, 22).translate(0.2, 0.215, 0.172), WHITE]);
    // 肉垫贴纸
    flat.push([cyl(0.022, 0.022, 0.006, 10).rotateX(Math.PI / 2).translate(0.2, 0.345, 0.172), 0xff8fab]);
    for (let i = 0; i < 3; i++) flat.push([cyl(0.009, 0.009, 0.006, 8).rotateX(Math.PI / 2).translate(0.2 + (i - 1) * 0.02, 0.37 + (i === 1 ? 0.005 : 0), 0.172), 0xff8fab]);
    // 麻绳柱：一圈一圈深浅交替
    const post = (x, z, y0, y1) => {
      const n = 9, h = (y1 - y0) / n;
      for (let i = 0; i < n; i++) big.push([cyl(0.055, 0.055, h, 12).translate(x, y0 + h * (i + 0.5), z), i % 2 ? 0xe6c79a : 0xd4ae7a]);
    };
    post(-0.24, -0.02, 0.06, 0.68);
    post(0.2, -0.02, 0.4, 0.98);
    const pad = (r) => lathe([[0, 0], [r - 0.02, 0], [r, 0.015], [r, 0.035], [r - 0.02, 0.05], [0, 0.05]], 22);
    big.push([pad(0.2).translate(-0.24, 0.68, -0.02), PAD]);
    // 顶上的猫耳朵窝
    big.push([pad(0.21).translate(0.2, 0.98, -0.02), PAD]);
    big.push([tor(0.165, 0.055, 8, 24).rotateX(Math.PI / 2).translate(0.2, 1.06, -0.02), PINK]);
    big.push([cyl(0.15, 0.15, 0.03, 18).translate(0.2, 1.035, -0.02), 0xfff0f5]);
    for (const s of [-1, 1]) {
      const a = -Math.PI / 2 + s * 0.6, x = 0.2 + Math.cos(a) * 0.17, z = -0.02 + Math.sin(a) * 0.17;
      big.push([cone(0.065, 0.12, 4).rotateY(Math.PI / 4).rotateX(-0.25).rotateZ(-s * 0.2).translate(x, 1.14, z), PINK]);
    }
    // 毛线球
    small.push([sph(0.06, 12, 10).translate(-0.27, 0.12, 0.2), 0xff8fab]);
    small.push([tor(0.06, 0.006, 4, 18).rotateY(0.6).translate(-0.27, 0.12, 0.2), 0xffd1e3]);
    small.push([tor(0.06, 0.006, 4, 18).rotateX(1.1).translate(-0.27, 0.12, 0.2), 0xffd1e3]);
    small.push([tube([[-0.22, 0.08, 0.24], [-0.14, 0.065, 0.27], [-0.05, 0.065, 0.23]], 0.006, 10, 4), 0xff8fab]);
    root.add(K.part(big, 0.02), K.part(small, 0.01), K.flat(flat));
    // 逗猫球：挂在平台边上晃
    const toy = new THREE.Group();
    toy.position.set(-0.1, 0.68, 0.1);
    toy.add(K.part([
      [cyl(0.004, 0.004, 0.2, 4).translate(0, -0.1, 0), 0x6b5446],
      [sph(0.035, 10, 8).translate(0, -0.22, 0), GOLD],
      [ell(0.012, 0.04, 0.008, 6, 4).rotateZ(0.4).translate(0.012, -0.265, 0), 0xff8fab],
      [ell(0.012, 0.04, 0.008, 6, 4).rotateZ(-0.4).translate(-0.012, -0.265, 0), 0x8fd3ff],
    ], 0.008));
    root.add(toy);
    root.userData.anim = (t) => { toy.rotation.z = Math.sin(t * 2.2) * 0.3; toy.rotation.x = Math.sin(t * 1.5) * 0.15; };
  },

  /* ------------------------------------------------ 吊床：两根木桩之间一张彩虹条纹吊床，枕头 + 小爱心抱枕，轻轻荡 */
  hammock(K, root) {
    const big = [], small = [];
    const HY = 0.64;
    for (const s of [-1, 1]) {
      big.push([sph(0.13, 12, 8).scale(1, 0.35, 1).translate(s * 0.44, 0, 0), GRASS[s > 0 ? 0 : 1]]);
      big.push([cyl(0.04, 0.05, 0.78, 10).translate(s * 0.44, 0.39, 0), WOOD]);
      big.push([sph(0.052, 10, 8).translate(s * 0.44, 0.8, 0), WOOD_D]);
      // 桩顶冒出的两片小叶子
      big.push([ell(0.05, 0.016, 0.025, 8, 6).rotateZ(0.5).translate(s * 0.44 + 0.04, 0.86, 0), GRASS[0]]);
      big.push([ell(0.05, 0.016, 0.025, 8, 6).rotateZ(-0.5).translate(s * 0.44 - 0.04, 0.86, 0), GRASS[1]]);
      small.push([tor(0.024, 0.008, 4, 10).rotateY(Math.PI / 2).translate(s * 0.41, HY, 0), 0x6b5446]);
    }
    root.add(K.part(big, 0.02), K.part(small, 0.008));
    const swing = new THREE.Group();
    swing.position.y = HY;
    // 布：弯过的薄盒子（两头收拢、两边翘起）
    const L = 0.33, W = 0.15, sag = 0.19;
    const g = new THREE.BoxGeometry(L * 2, 0.035, W * 2, 22, 1, 8);
    const p = g.attributes.position;
    const yAt = (x, z) => -0.07 - sag * (1 - (x / L) ** 2) + 0.07 * (z / W) ** 2 * (1 - 0.7 * (x / L) ** 2);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i), u = x / L;
      p.setXYZ(i, x, y + yAt(x, z), z * (1 - 0.6 * u * u));
    }
    g.computeVertexNormals();
    swing.add(K.tex([g], rowTex([0xff9fb8, WHITE, 0x8fd8c0, 0xffe08a, WHITE, 0xc3a6ff]), 0.014));
    const parts = [];
    for (const s of [-1, 1]) for (const z of [-0.055, 0, 0.055]) parts.push([rod([s * 0.4, 0, 0], [s * L * 0.99, yAt(L * 0.99, 0) + 0.012, z], 0.005, 4), 0xf3e3c3]);
    // 枕头 + 爱心抱枕
    parts.push([roundBox(0.13, 0.065, 0.17, 0.03).rotateZ(-0.5).translate(-0.2, yAt(-0.2, 0) + 0.06, 0), 0xe8dcff]);
    const hg = heartGeo(0.12, 0.05, 18, 12).rotateX(-1.1).rotateY(0.3);
    parts.push([hg.translate(0.05, yAt(0.05, 0) + 0.05, 0.01), 0xff6b8b]);
    swing.add(K.part(parts, 0.011));
    root.add(swing);
    root.userData.anim = (t) => { swing.rotation.x = Math.sin(t * 1.2) * 0.13; };
  },

  /* ------------------------------------------------ 星星灯：云朵底座 + 弯钩灯杆，挂着一颗睡脸发光星，旁边一弯小月亮 */
  star_lamp(K, root) {
    const big = [], small = [];
    const CLOUD = 0xf3eeff;
    [[0, 0.08, 0, 0.17], [-0.15, 0.06, 0.04, 0.12], [0.15, 0.06, 0.03, 0.13], [0.03, 0.06, 0.14, 0.11], [-0.05, 0.07, -0.12, 0.12], [0.1, 0.05, -0.1, 0.1]].forEach(([x, y, z, r]) => big.push([sph(r, 14, 10).scale(1, 0.78, 1).translate(x, y, z), CLOUD]));
    const pole = [[0, 0.1, 0], [0, 0.6, 0], [0, 1.08, 0]];
    for (let i = 1; i <= 10; i++) { const a = Math.PI - (i / 10) * Math.PI; pole.push([0.14 + 0.14 * Math.cos(a), 1.08 + 0.14 * Math.sin(a), 0]); }
    pole.push([0.28, 1.04, 0]);
    big.push([tube(pole, 0.022, 48, 8), GOLD]);
    big.push([sph(0.03, 8, 6).translate(0.28, 1.035, 0), GOLD]);
    big.push([sph(0.045, 10, 8).translate(0, 0.14, 0), GOLD]);
    // 小月亮（两头尖）
    const moon = [];
    for (let i = 0; i <= 12; i++) { const a = -2.0 + (i / 12) * 4.0; moon.push([Math.cos(a) * 0.1, Math.sin(a) * 0.1, 0]); }
    const mg = tube(moon, (t) => 0.008 + 0.045 * Math.sin(t * Math.PI) ** 0.8, 20, 10);
    big.push([mg.rotateZ(Math.PI).translate(-0.12, 0.33, 0.04), 0xfff3b0]);
    root.add(K.part(big, 0.02));
    const mf = [];
    mf.push([smileGeo(0.016, 0.005, V3(-0.165, 0.34, 0.085), V3(0, 0, 1)), DARK]);
    root.add(K.flat(mf));
    // 星星（摆动）
    const piv = new THREE.Group();
    piv.position.set(0.28, 1.02, 0);
    piv.add(K.part([[cyl(0.004, 0.004, 0.1, 4).translate(0, -0.05, 0), 0x6b5446]], 0));
    const star = new THREE.Group();
    star.position.y = -0.25;
    const sm = K.one(starGeo(0.15, 0.085, 0.06, 0.035), 0xffe066, 0.02, { emissive: 0xffb800, emissiveIntensity: 0.45 });
    star.add(sm);
    const f = [], zf = 0.068;
    // 睡眼 ∩ ∩ + 小嘴 ∪
    for (const s of [-1, 1]) f.push([tor(0.022, 0.0065, 4, 12, Math.PI).translate(s * 0.05, -0.005, zf), DARK]);
    f.push([smileGeo(0.016, 0.005, V3(0, -0.04, zf), V3(0, 0, 1)), DARK]);
    star.add(K.flat(f));
    star.add(K.blushes([-1, 1].map((s) => ell(0.024, 0.014, 0.004, 10, 6).translate(s * 0.08, -0.03, zf - 0.002))));
    const halo = K.halo(0xffe27a, 0.8, 0.45);
    halo.position.z = -0.04;
    star.add(halo);
    piv.add(star);
    root.add(piv);
    // 几颗闪闪
    const sparkMat = new THREE.MeshBasicMaterial({ color: 0xfff2a0 });
    const sparks = [[0.5, 0.95, 0.05], [0.08, 0.72, 0.12], [0.46, 0.55, -0.02]].map(([x, y, z], i) => {
      const m = new THREE.Mesh(starGeo(0.03, 0.012, 0.004, 0.004, 4), sparkMat);
      m.position.set(x, y, z);
      m.userData.ph = i * 2.1;
      root.add(m);
      return m;
    });
    root.userData.anim = (t) => {
      piv.rotation.z = Math.sin(t * 1.1) * 0.08;
      star.rotation.y = Math.sin(t * 0.7) * 0.35;
      const k = 0.5 + 0.5 * Math.sin(t * 2);
      sm.material.emissiveIntensity = 0.38 + k * 0.2;
      halo.material.opacity = 0.35 + k * 0.2;
      for (const s of sparks) { const v = Math.max(0.05, Math.sin(t * 2.4 + s.userData.ph)); s.scale.setScalar(v); s.rotation.z = t * 0.8; }
    };
  },

  /* ------------------------------------------------ 小旋转木马：条纹伞顶 + 三匹上下跑的小马 */
  carousel(K, root) {
    const base = [];
    base.push([lathe([[0, 0], [0.47, 0], [0.49, 0.025], [0.49, 0.085], [0.47, 0.11], [0, 0.11]], 32), 0x9fe0c8]);
    base.push([tor(0.49, 0.018, 6, 40).rotateX(Math.PI / 2).translate(0, 0.055, 0), GOLD]);
    base.push([cyl(0.44, 0.44, 0.012, 32).translate(0, 0.114, 0), CREAM]);
    root.add(K.part(base, 0.022));
    const spin = new THREE.Group();
    root.add(spin);
    // 中柱（粉白相间）+ 镜鼓
    const poles = [];
    for (let i = 0; i < 8; i++) poles.push([cyl(0.06, 0.06, 0.1, 12).translate(0, 0.17 + i * 0.1, 0), i % 2 ? WHITE : 0xff9fb8]);
    poles.push([cyl(0.15, 0.15, 0.1, 16).translate(0, 0.96, 0), 0xffd1e3]);
    poles.push([tor(0.15, 0.015, 6, 24).rotateX(Math.PI / 2).translate(0, 0.91, 0), GOLD]);
    const R = 0.32, horses = [];
    const HC = [[WHITE, 0xff9fd0, 0xff6b8b], [0xfff0c2, 0xc3a6ff, 0x8fd3ff], [0xd8ecff, 0x9fe0c8, 0xffd36b]];
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * TAU, x = Math.cos(a) * R, z = -Math.sin(a) * R;
      poles.push([cyl(0.012, 0.012, 0.92, 6).translate(x, 0.58, z), GOLD]);
      const [body, mane, saddle] = HC[i];
      const h = new THREE.Group();
      h.position.set(x, 0.5, z);
      h.rotation.y = a + Math.PI / 2;
      const P = [];
      P.push([ell(0.105, 0.07, 0.065, 14, 10), body]);
      P.push([ell(0.06, 0.05, 0.05, 12, 8).rotateZ(-0.6).translate(0.085, 0.06, 0), body]);
      P.push([ell(0.065, 0.058, 0.055, 12, 10).translate(0.12, 0.12, 0), body]);
      P.push([ell(0.04, 0.034, 0.042, 10, 8).translate(0.175, 0.095, 0), 0xffe4ec]);
      for (const s of [-1, 1]) P.push([cone(0.018, 0.05, 6).rotateX(s * 0.3).translate(0.105, 0.19, s * 0.025), body]);
      for (let k = 0; k < 4; k++) P.push([sph(0.026, 8, 6).translate(0.09 - k * 0.03, 0.17 - k * 0.025, 0), mane]);
      P.push([ell(0.05, 0.02, 0.022, 8, 6).rotateZ(0.9).translate(-0.12, 0.0, 0), mane]);
      P.push([ell(0.055, 0.025, 0.07, 10, 6).translate(-0.01, 0.06, 0), saddle]);
      for (const [lx, lz, rz] of [[0.06, 0.035, 0.6], [0.06, -0.035, 0.4], [-0.06, 0.035, -0.5], [-0.06, -0.035, -0.3]]) {
        P.push([cyl(0.017, 0.015, 0.11, 6).translate(0, -0.05, 0).rotateZ(rz).translate(lx, -0.03, lz), body]);
      }
      for (const s of [-1, 1]) P.push([sph(0.011, 6, 4).translate(0.14, 0.135, s * 0.048), DARK]);
      h.add(K.part(P, 0.011));
      h.userData.ph = i * 2.1;
      spin.add(h);
      horses.push(h);
    }
    spin.add(K.part(poles, 0.016));
    // 伞顶：粉白条纹 + 一圈荷叶边 + 顶上小旗
    const canopy = [];
    canopy.push([stripeByAngle(lathe([[0, 1.005], [0.56, 1.005], [0.555, 1.03], [0.5, 1.12], [0.36, 1.25], [0.18, 1.33], [0, 1.36]], 16), 16, [0xff9fb8, WHITE]), null]);
    for (let i = 0; i < 16; i++) {
      const a = ((i + 0.5) / 16) * TAU;
      canopy.push([X(ell(0.075, 0.06, 0.02, 10, 6).translate(0, -0.02, 0), { n: V3(Math.cos(a), 0, Math.sin(a)), p: [Math.cos(a) * 0.55, 1.0, Math.sin(a) * 0.55] }), i % 2 ? 0xffd36b : 0xff9fb8]);
    }
    canopy.push([sph(0.045, 10, 8).translate(0, 1.38, 0), GOLD]);
    canopy.push([cyl(0.008, 0.008, 0.14, 4).translate(0, 1.45, 0), GOLD]);
    const flagS = new THREE.Shape();
    flagS.moveTo(0, 0); flagS.lineTo(0.1, -0.03); flagS.lineTo(0, -0.06); flagS.closePath();
    canopy.push([new THREE.ExtrudeGeometry(flagS, { depth: 0.008, bevelEnabled: false }).translate(0.005, 1.52, -0.004), 0xff6b8b]);
    spin.add(K.part(canopy, 0.018));
    // 伞边的小灯
    const bulbs = [];
    for (let i = 0; i < 16; i++) { const a = (i / 16) * TAU; bulbs.push([sph(0.016, 6, 4).translate(Math.cos(a) * 0.565, 1.02, Math.sin(a) * 0.565), i % 2 ? 0xfff2a0 : 0xffd1e3]); }
    const bm = K.flat(bulbs);
    bm.material = new THREE.MeshBasicMaterial({ vertexColors: true });
    spin.add(bm);
    root.userData.anim = (t) => {
      spin.rotation.y = t * 0.55;
      for (const h of horses) { h.position.y = 0.5 + Math.sin(t * 2.2 + h.userData.ph) * 0.06; h.rotation.z = Math.sin(t * 2.2 + h.userData.ph + 1) * 0.08; }
      bm.material.color.setScalar(0.85 + 0.15 * Math.sin(t * 6));
    };
  },

  /* ------------------------------------------------ 爱心热气球：笑脸爱心气球 + 小篮子，绳子拴在地上的木桩 */
  hot_air_heart(K, root) {
    const ground = [];
    ground.push([sph(0.11, 12, 8).scale(1, 0.3, 1).translate(0.3, 0, 0.22), GRASS[0]]);
    ground.push([cyl(0.022, 0.028, 0.14, 8).translate(0.3, 0.07, 0.22), WOOD]);
    ground.push([tor(0.03, 0.01, 4, 10).rotateX(Math.PI / 2).translate(0.3, 0.12, 0.22), 0xf3e3c3]);
    root.add(K.part(ground, 0.014));
    const bal = new THREE.Group();
    root.add(bal);
    const parts = [];
    // 篮子
    parts.push([stripeByAngle(lathe([[0, 0.43], [0.1, 0.43], [0.125, 0.47], [0.135, 0.58], [0.115, 0.58], [0.0, 0.57]], 14), 14, [0xc58f5a, 0xd8a46e]), null]);
    parts.push([tor(0.135, 0.018, 6, 20).rotateX(Math.PI / 2).translate(0, 0.585, 0), 0x8a5a3b]);
    for (const s of [-1, 1]) {
      parts.push([rod([s * 0.11, 0.56, 0.06], [s * 0.15, 0.48, 0.1], 0.003, 3), 0xf3e3c3]);
      parts.push([ell(0.03, 0.035, 0.03, 8, 6).translate(s * 0.15, 0.46, 0.1), 0xe8d2a8]);
    }
    // 气球（爱心）
    const W = 0.7, Dp = 0.42, cy = 1.08;
    const hg = heartGeo(W, Dp, 36, 22);
    const surf = hg.userData.surfZ;
    parts.push([hg.translate(0, cy, 0), 0xff8fb1]);
    for (const [x, z] of [[-0.1, 0.1], [0.1, 0.1], [-0.1, -0.1], [0.1, -0.1]]) parts.push([rod([x, 0.58, z], [x * 1.25, 0.86, z * 1.1], 0.004, 3), 0xf3e3c3]);
    parts.push([tor(0.08, 0.016, 6, 16).rotateX(Math.PI / 2).translate(0, 0.84, 0), GOLD]);
    bal.add(K.part(parts, 0.018));
    const F = [];
    for (const s of [-1, 1]) { const x = s * 0.1, y = 0.05; eyeInto(F, 0.03, V3(x, cy + y, surf(x, y + 0.0) - 0.004), V3(s * 0.15, 0.1, 1)); }
    F.push([smileGeo(0.03, 0.008, V3(0, cy - 0.03, surf(0, -0.03) + 0.002), V3(0, 0, 1)), DARK]);
    F.push([ell(0.06, 0.035, 0.01, 10, 6).rotateZ(0.5).translate(-0.17, cy + 0.17, surf(-0.17, 0.17) - 0.005), 0xffffff]);
    bal.add(K.flat(F));
    bal.add(K.blushes([-1, 1].map((s) => X(ell(0.04, 0.024, 0.008, 10, 6), { n: V3(s * 0.25, 0, 1), p: [s * 0.18, cy - 0.01, surf(s * 0.18, -0.01) - 0.002] }))));
    // 拴绳（每帧拉直）
    const tether = K.one(cyl(0.004, 0.004, 1, 4, true).translate(0, 0.5, 0), 0xf3e3c3, 0);
    root.add(tether);
    const A = V3(0.3, 0.12, 0.22), B = V3(), dir = V3(), q = new THREE.Quaternion(), UP = V3(0, 1, 0);
    root.userData.anim = (t) => {
      bal.position.y = Math.sin(t * 0.9) * 0.05;
      bal.rotation.z = Math.sin(t * 0.7) * 0.04;
      bal.rotation.y = Math.sin(t * 0.5) * 0.12;
      B.set(0.12, 0.47, 0.08).applyEuler(bal.rotation).add(bal.position);
      dir.subVectors(B, A);
      tether.position.copy(A);
      tether.quaternion.copy(q.setFromUnitVectors(UP, dir.clone().normalize()));
      tether.scale.set(1, dir.length(), 1);
    };
    root.userData.anim(0);
  },

  /* ------------------------------------------------ 圣诞树 */
  xmas_tree(K, root) {
    const t = buildXmasTree(K.T);
    root.add(t.root);
    root.userData.anim = (s) => xmasTreeTick(t, s);
  },

  /* ------------------------------------------------ 小驯鹿：红鼻子会亮、会眨眼、歪头 */
  reindeer(K, root) {
    const FUR = 0xc8946a, BELLY = 0xfff0dc, HOOF = 0x6b4a3a;
    const big = [], small = [];
    big.push([ell(0.21, 0.2, 0.25, 18, 14).translate(0, 0.36, -0.02), FUR]);
    big.push([ell(0.14, 0.13, 0.08, 14, 10).translate(0, 0.33, 0.17), BELLY]);
    for (const [x, z] of [[0.11, 0.1], [-0.11, 0.1], [0.11, -0.13], [-0.11, -0.13]]) {
      big.push([cyl(0.055, 0.05, 0.2, 10).translate(x, 0.13, z), FUR]);
      small.push([cyl(0.052, 0.058, 0.045, 10).translate(x, 0.022, z), HOOF]);
    }
    small.push([sph(0.055, 10, 8).translate(0, 0.42, -0.27), WHITE]);
    // 项圈 + 铃铛
    small.push([tor(0.15, 0.03, 6, 22).rotateX(Math.PI / 2 - 0.35).translate(0, 0.53, 0.06), 0xff5d6c]);
    small.push([sph(0.045, 10, 8).translate(0, 0.47, 0.215), GOLD]);
    small.push([new THREE.BoxGeometry(0.05, 0.006, 0.01).translate(0, 0.455, 0.258), 0x8a6a2a]);
    root.add(K.part(big, 0.022), K.part(small, 0.012));
    // 头
    const head = new THREE.Group();
    head.position.set(0, 0.58, 0.08);
    const hc = V3(0, 0.16, 0.04), hr = 0.23;
    const HB = [], HS = [], AN = [];
    HB.push([sph(hr, 20, 14).translate(hc.x, hc.y, hc.z), FUR]);
    HB.push([ell(0.12, 0.085, 0.09, 14, 10).translate(0, 0.08, 0.22), BELLY]);
    for (const s of [-1, 1]) {
      HB.push([ell(0.095, 0.04, 0.055, 10, 8).rotateZ(s * 0.5).translate(s * 0.22, 0.26, 0.0), FUR]);
      HS.push([ell(0.06, 0.02, 0.035, 8, 6).rotateZ(s * 0.5).translate(s * 0.225, 0.263, 0.02), 0xffc2d0]);
      // 鹿角：一根主枝 + 两个小叉，两头圆圆的
      const r = (t) => 0.026 - 0.01 * t;
      AN.push([tube([[s * 0.08, 0.34, 0.0], [s * 0.13, 0.46, -0.02], [s * 0.2, 0.56, -0.01], [s * 0.24, 0.62, 0.0]], r, 14, 7), 0xf0d2a0]);
      AN.push([tube([[s * 0.12, 0.44, -0.02], [s * 0.07, 0.52, 0.0], [s * 0.065, 0.57, 0.0]], 0.017, 8, 6), 0xf0d2a0]);
      AN.push([tube([[s * 0.19, 0.545, -0.01], [s * 0.28, 0.56, 0.0], [s * 0.31, 0.6, 0.0]], 0.015, 8, 6), 0xf0d2a0]);
      AN.push([sph(0.016, 6, 5).translate(s * 0.24, 0.62, 0), 0xf0d2a0]);
      AN.push([sph(0.017, 6, 5).translate(s * 0.065, 0.57, 0), 0xf0d2a0]);
      AN.push([sph(0.015, 6, 5).translate(s * 0.31, 0.6, 0), 0xf0d2a0]);
    }
    HS.push([smileGeo(0.03, 0.007, V3(0, 0.045, 0.3), V3(0, -0.3, 1)), DARK]);
    head.add(K.part(HB, 0.022), K.part(AN, 0.012), K.part(HS, 0));
    // 眼睛：每只一个 mesh，原点在眼睛中心，眨眼 = scale.y
    const eyes = [-1, 1].map((s) => {
      const e = onBall(hc, hr, s * 0.38, 0.22, 0.9);
      const L = [];
      eyeInto(L, 0.038, V3(), e.n);
      const m = K.flat(L);
      m.position.copy(e.p);
      head.add(m);
      return m;
    });
    head.add(K.blushes([-1, 1].map((s) => { const b = onBall(hc, hr, s * 0.62, -0.02, 0.78, 0.002); return X(ell(0.04, 0.024, 0.01, 10, 6), { n: b.n, p: b.p }); })));
    // 红鼻子
    const nose = K.one(sph(0.05, 14, 10), 0xff4d5e, 0.014, { emissive: 0xff2030, emissiveIntensity: 0.4 });
    nose.position.set(0, 0.115, 0.31);
    const nh = K.halo(0xff5a6a, 0.3, 0.4);
    nose.add(nh);
    head.add(nose);
    root.add(head);
    root.userData.anim = (t) => {
      head.rotation.z = Math.sin(t * 0.8) * 0.07;
      head.rotation.x = Math.sin(t * 0.55) * 0.04;
      const c = (t + 1.2) % 3.6, b = c < 0.16 ? 1 - Math.sin((c / 0.16) * Math.PI) * 0.9 : 1;
      for (const e of eyes) e.scale.y = b;
      const k = 0.5 + 0.5 * Math.sin(t * 3);
      nose.material.emissiveIntensity = 0.3 + k * 0.5;
      nh.material.opacity = 0.25 + k * 0.35;
      nh.scale.setScalar(0.26 + k * 0.08);
    };
  },

  /* ------------------------------------------------ 姜饼屋：糖霜屋顶、软糖屋脊、薄荷糖、拐杖糖门框、小姜饼人、烟囱冒烟 */
  gingerbread(K, root) {
    const GB = 0xc98a52, ICE = 0xfffaf5, CHOC = 0x7a4a2e;
    const base = [], body = [], roof = [], small = [], glow = [];
    base.push([lathe([[0, 0], [0.44, 0], [0.47, 0.02], [0.45, 0.045], [0, 0.05]], 28), 0xf3f7ff]);
    const y0 = 0.045;
    const hs = new THREE.Shape();
    hs.moveTo(-0.27, 0); hs.lineTo(0.27, 0); hs.lineTo(0.27, 0.34); hs.lineTo(0, 0.55); hs.lineTo(-0.27, 0.34); hs.closePath();
    body.push([new THREE.ExtrudeGeometry(hs, { depth: 0.36, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.02, bevelSegments: 2 }).translate(0, y0, -0.18), GB]);
    // 屋顶糖霜
    const ang = Math.atan2(0.21, 0.27), len = Math.hypot(0.27, 0.21) + 0.1;
    for (const s of [-1, 1]) {
      roof.push([roundBox(len, 0.06, 0.5, 0.028).rotateZ(-s * ang).translate(s * 0.135 + s * 0.022, y0 + 0.445 + 0.03, 0), ICE]);
      for (let i = 0; i < 6; i++) {
        const z = -0.2 + i * 0.08;
        small.push([ell(0.022, 0.035, 0.022, 8, 6).translate(s * 0.33, y0 + 0.3, z), ICE]);
      }
    }
    // 烟囱
    roof.push([roundBox(0.09, 0.17, 0.09, 0.015).translate(0.13, y0 + 0.55, -0.08), 0xe07a6a]);
    roof.push([roundBox(0.11, 0.035, 0.11, 0.016).translate(0.13, y0 + 0.645, -0.08), ICE]);
    // 屋脊软糖
    [0xff8fab, 0x9fe0c8, 0xffd36b, 0xc3a6ff, 0xff6b6b].forEach((c, i) => small.push([hemi(0.038, 10, 5).translate(0, y0 + 0.6, -0.18 + i * 0.09), c]));
    // 门：巧克力拱门 + 糖霜边
    const fz = 0.18 + 0.025;
    small.push([roundBox(0.14, 0.2, 0.025, 0.05).translate(0, y0 + 0.1, fz), CHOC]);
    small.push([tor(0.075, 0.011, 5, 14, Math.PI).translate(0, y0 + 0.13, fz + 0.012), ICE]);
    for (const s of [-1, 1]) small.push([cyl(0.011, 0.011, 0.13, 5).translate(s * 0.075, y0 + 0.065, fz + 0.012), ICE]);
    small.push([sph(0.013, 6, 4).translate(0.035, y0 + 0.09, fz + 0.018), GOLD]);
    // 窗：暖光 + 糖霜十字
    for (const s of [-1, 1]) {
      const x = s * 0.165, y = y0 + 0.25;
      glow.push([new THREE.BoxGeometry(0.09, 0.09, 0.01).translate(x, y, fz), 0xffe9a8]);
      small.push([new THREE.BoxGeometry(0.1, 0.014, 0.014).translate(x, y, fz + 0.006), ICE]);
      small.push([new THREE.BoxGeometry(0.014, 0.1, 0.014).translate(x, y, fz + 0.006), ICE]);
      for (const d of [-1, 1]) { small.push([new THREE.BoxGeometry(0.11, 0.016, 0.016).translate(x, y + d * 0.05, fz + 0.006), ICE]); small.push([new THREE.BoxGeometry(0.016, 0.11, 0.016).translate(x + d * 0.05, y, fz + 0.006), ICE]); }
    }
    // 墙脚一圈波浪糖霜
    const wave = [];
    for (let i = 0; i <= 24; i++) { const x = -0.29 + (i / 24) * 0.58; wave.push([x, y0 + 0.04 + 0.012 * Math.sin(i * 1.6), fz + 0.004]); }
    small.push([tube(wave, 0.011, 48, 5), ICE]);
    // 薄荷糖
    const mint = (x, y, r) => [stripeByAngle(cyl(r, r, 0.016, 16).rotateX(Math.PI / 2).rotateY(Math.PI / 2), 8, [0xff5a6e, ICE]).rotateY(-Math.PI / 2).translate(x, y, fz + 0.006), null];
    small.push(mint(0, y0 + 0.43, 0.045));
    for (const s of [-1, 1]) small.push(mint(s * 0.165, y0 + 0.12, 0.03));
    root.add(K.part(base, 0.018), K.part(body, 0.022), K.part(roof, 0.02), K.part(small, 0.009), K.flat(glow));
    // 门边两根小拐杖糖
    const canes = [];
    for (const s of [-1, 1]) canes.push(X(caneGeo(0.17, 0.035, 0.012), { r: [0, s > 0 ? Math.PI : 0, 0], p: [s * 0.1, y0, fz + 0.03] }));
    root.add(K.tex(canes, caneTex(0xff5a6e), 0.008));
    // 小姜饼人
    const man = [], icing = [];
    const mx = 0.36, mz = 0.16, mo = { r: [0, -0.5, 0], p: [mx, y0, mz] };
    man.push([X(ell(0.05, 0.05, 0.022, 12, 8).translate(0, 0.19, 0), mo), GB]);
    man.push([X(ell(0.05, 0.06, 0.024, 12, 8).translate(0, 0.1, 0), mo), GB]);
    for (const s of [-1, 1]) {
      man.push([X(ell(0.022, 0.045, 0.02, 8, 6).rotateZ(s * 1.0).translate(s * 0.06, 0.13, 0), mo), GB]);
      man.push([X(ell(0.024, 0.045, 0.02, 8, 6).rotateZ(s * 0.25).translate(s * 0.028, 0.035, 0), mo), GB]);
      icing.push([X(sph(0.008, 6, 4).translate(s * 0.017, 0.2, 0.022), mo), 0x3a2a28]);
    }
    for (const y of [0.12, 0.085]) icing.push([X(sph(0.01, 6, 4).translate(0, y, 0.024), mo), 0xff6b8b]);
    icing.push([X(smileGeo(0.016, 0.004, V3(0, 0.18, 0.023), V3(0, 0, 1)), mo), ICE]);
    root.add(K.part(man, 0.01), K.flat(icing));
    // 烟
    const smokeMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false });
    const puffs = [0, 1, 2].map((i) => { const m = new THREE.Mesh(sph(0.04, 10, 8), smokeMat.clone()); m.userData.ph = i / 3; root.add(m); return m; });
    root.userData.anim = (t) => {
      for (const p of puffs) {
        const k = (t * 0.35 + p.userData.ph) % 1;
        p.position.set(0.13 + Math.sin(k * 5 + p.userData.ph * 6) * 0.03, y0 + 0.68 + k * 0.35, -0.08);
        p.scale.setScalar(0.6 + k * 0.9);
        p.material.opacity = 0.8 * Math.sin(k * Math.PI);
      }
    };
  },

  /* ------------------------------------------------ 雪人一家 */
  snow_family(K, root) {
    root.add(buildSnowmanFamily(K.T).root);
  },

  /* ------------------------------------------------ 拐杖糖小路：一排 5 根拐杖糖当路边栏杆 + 雪堆 + 一串彩色踏脚石 */
  candy_lane(K, root) {
    const red = [], mint = [], pink = [], small = [];
    const BOW = [0x58b873, 0xff5d6c, 0xffd36b, 0x58b873, 0xc3a6ff];
    const list = [red, mint, red, pink, red];
    const H = [0.46, 0.6, 0.5, 0.63, 0.47];
    for (let i = 0; i < 5; i++) {
      const x = -0.42 + i * 0.21 + 0.06, z = i % 2 ? -0.22 : -0.1, h = H[i];
      const o = { r: [0, 0, 0], p: [x, 0, z] };
      const g = caneGeo(h, 0.065, 0.03);
      const e = g.userData.end;
      list[i].push(X(g, o));
      small.push([X(sph(0.03, 10, 8).translate(e.x, e.y, e.z), o), WHITE]);
      const y = h * 0.72, f = 0.034, bow = BOW[i];
      for (const s of [-1, 1]) small.push([X(tor(0.032, 0.012, 6, 12).scale(1, 0.75, 0.7).rotateZ(s * 0.5).translate(s * 0.029, y + 0.011, f), o), bow]);
      for (const s of [-1, 1]) small.push([X(new THREE.BoxGeometry(0.02, 0.06, 0.01).rotateZ(s * 0.35).translate(s * 0.018, y - 0.03, f), o), bow]);
      small.push([X(sph(0.015, 8, 6).translate(0, y, f + 0.004), o), bow]);
      small.push([ell(0.07, 0.035, 0.065, 12, 8).translate(x, 0, z), 0xf6f9ff]);
    }
    // 踏脚石小路（从左后弯到右前）
    [[-0.38, 0.12, 0xffd1e3], [-0.17, 0.2, 0xd8ecff], [0.05, 0.15, 0xfff2c2], [0.25, 0.24, 0xe0d4ff], [0.42, 0.16, 0xd2f2e2]].forEach(([x, z, c], i) => {
      const r = i % 2 ? 0.075 : 0.068;
      small.push([lathe([[0, 0], [r, 0], [r + 0.01, 0.012], [r - 0.005, 0.026], [0, 0.028]], 14).scale(1, 1, 0.82).translate(x, 0, z), c]);
    });
    for (const [x, z, r] of [[-0.06, 0.32, 0.035], [0.36, 0.38, 0.03], [-0.42, 0.3, 0.028]]) small.push([sph(r, 8, 6).scale(1, 0.5, 1).translate(x, 0, z), 0xf6f9ff]);
    root.add(K.tex(red, caneTex(0xff5a6e), 0.016), K.tex(mint, caneTex(0x5cc98a), 0.016), K.tex(pink, caneTex(0xff8fc6), 0.016), K.part(small, 0.01));
  },
};

export function buildGachaDecor(id, T) {
  const K = kit(T);
  const root = new THREE.Group();
  root.userData.item = id;
  if (D[id]) D[id](K, root);
  return { root };
}
