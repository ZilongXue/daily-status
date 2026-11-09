// 高台上的小木屋（视觉中心）+ 从草地爬上去的小木梯 + 踏脚石小路，还有一个通用的"灯光晕"小精灵。
// 全部程序生成；不动的部分交给 batch3d 合批，窗户 / 烟囱的烟 / 光晕标了 dynamic。
import * as THREE from "three";

export const HOME = { x: -0.7, z: -4.45, rotY: 0.15, s: 0.85 }; // 小木屋中心（高台上），门朝镜头（+z）
export const LADDER = { x: -0.3 }; // 木梯所在的 x（z 运行时沿着崖壁找）
// 踏脚石：家（小伙伴站的地方）→ 木梯脚
export const STONE_PATH = [[0.35, 0.75], [0.12, -0.35], [0.15, -1.45], [-0.15, -2.45], [-0.3, -3.05]];

// 季节（按看的人本地月份；?season=spring|summer|autumn|winter 可以强制，调试用）
export function season(d = new Date()) {
  const q = new URLSearchParams(location.search).get("season");
  if (q && ["spring", "summer", "autumn", "winter"].includes(q)) return q;
  const m = d.getMonth() + 1;
  return m >= 3 && m <= 5 ? "spring" : m >= 6 && m <= 8 ? "summer" : m >= 9 && m <= 11 ? "autumn" : "winter";
}

// 暖色光晕（夜里给灯、窗户用）：一张径向渐变贴图 + 叠加混合，不用真的点光源
let glowTexCache = null;
function glowTex() {
  if (glowTexCache) return glowTexCache;
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const x = c.getContext("2d"), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.25, "rgba(255,255,255,0.55)"); g.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  glowTexCache = new THREE.CanvasTexture(c);
  return glowTexCache;
}
export function glowSprite(color = 0xffc870, size = 1) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
  s.scale.setScalar(size);
  s.raycast = () => {};
  s.userData.dynamic = true;
  s.userData.noShadow = true;
  return s;
}

export function buildHome({ toon, outlined, heightAt, tag }) {
  const mk = (geo, color, line = 0.025, extra) => outlined(new THREE.Mesh(geo, toon(color, extra)), line);
  const root = new THREE.Group();
  const y0 = heightAt(HOME.x, HOME.z);

  /* ---------------- 小木屋 */
  const house = new THREE.Group();
  const W = 1.0, D = 0.82, H = 0.62;
  const base = mk(new THREE.BoxGeometry(W + 0.14, 0.12, D + 0.14), 0xcbb9a5, 0.025);
  base.position.y = 0.06;
  const walls = mk(new THREE.BoxGeometry(W, H, D), 0xfff0da, 0.03);
  walls.position.y = 0.12 + H / 2;
  house.add(base, walls);
  // 木头角柱 + 腰线
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const p = mk(new THREE.BoxGeometry(0.08, H + 0.02, 0.08), 0xb07e52, 0.015);
    p.position.set(sx * (W / 2), 0.12 + H / 2, sz * (D / 2));
    house.add(p);
  }
  const belt = mk(new THREE.BoxGeometry(W + 0.04, 0.05, D + 0.04), 0xc8915f, 0.012);
  belt.position.y = 0.12 + H * 0.42;
  house.add(belt);
  // 屋顶：三棱柱（坡顶），四边都出檐
  const roofR = 0.66;
  const roofGeo = new THREE.CylinderGeometry(roofR, roofR, W + 0.26, 3, 1);
  roofGeo.rotateZ(Math.PI / 2); // 三棱柱横过来（轴沿 x）
  roofGeo.rotateX(-Math.PI / 2); // 再转到棱朝上、底边水平
  roofGeo.scale(1, 0.62, 1);
  const roof = mk(roofGeo, 0xee7d84, 0.035);
  roof.position.y = 0.12 + H + roofR * 0.62 * 0.5 - 0.02;
  house.add(roof);
  // 屋脊一条深色木条
  const ridge = mk(new THREE.BoxGeometry(W + 0.32, 0.06, 0.08), 0xc75d68, 0.012);
  ridge.position.y = roof.position.y + roofR * 0.62 - 0.03;
  house.add(ridge);
  // 烟囱
  const chim = mk(new THREE.BoxGeometry(0.15, 0.36, 0.15), 0xc8765a, 0.02);
  chim.position.set(0.28, roof.position.y + 0.22, -0.12);
  const chimTop = mk(new THREE.BoxGeometry(0.2, 0.05, 0.2), 0xa95f48, 0.012);
  chimTop.position.set(0.28, chim.position.y + 0.2, -0.12);
  house.add(chim, chimTop);
  // 门 + 门把手 + 小雨棚
  const door = mk(new THREE.BoxGeometry(0.27, 0.42, 0.04), 0x9a6a43, 0.015);
  door.position.set(-0.18, 0.12 + 0.21, D / 2 + 0.01);
  const arch = mk(new THREE.CylinderGeometry(0.135, 0.135, 0.04, 14, 1, false, -Math.PI / 2, Math.PI), 0x9a6a43, 0.012);
  arch.rotation.x = Math.PI / 2;
  arch.position.set(-0.18, 0.12 + 0.42, D / 2 + 0.01);
  const knob = mk(new THREE.SphereGeometry(0.022, 8, 6), 0xffd36b, 0.006);
  knob.position.set(-0.09, 0.32, D / 2 + 0.04);
  const awning = mk(new THREE.BoxGeometry(0.42, 0.04, 0.2), 0xee7d84, 0.012);
  awning.position.set(-0.18, 0.12 + 0.6, D / 2 + 0.09);
  awning.rotation.x = 0.35;
  house.add(door, arch, knob, awning);
  // 小心形门牌
  const heartShape = new THREE.Shape();
  heartShape.moveTo(0, -0.05);
  heartShape.bezierCurveTo(-0.07, -0.0, -0.07, 0.05, -0.035, 0.055);
  heartShape.bezierCurveTo(-0.012, 0.058, 0, 0.04, 0, 0.03);
  heartShape.bezierCurveTo(0, 0.04, 0.012, 0.058, 0.035, 0.055);
  heartShape.bezierCurveTo(0.07, 0.05, 0.07, 0.0, 0, -0.05);
  const heart = mk(new THREE.ExtrudeGeometry(heartShape, { depth: 0.02, bevelEnabled: false }), 0xff6b8b, 0.008);
  heart.position.set(-0.18, 0.47, D / 2 + 0.035);
  heart.scale.setScalar(0.9);
  house.add(heart);
  // 窗户：白天是淡蓝玻璃，晚上亮暖黄灯（发光 + 光晕）
  const winMat = new THREE.MeshToonMaterial({ color: 0xcfeaff, gradientMap: toon(0xffffff).gradientMap, emissive: 0xffc35a, emissiveIntensity: 0 });
  const windows = [];
  const addWindow = (x, y, z, ry) => {
    const g = new THREE.Group();
    const frame = mk(new THREE.BoxGeometry(0.24, 0.24, 0.035), 0xffffff, 0.012);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.04), winMat);
    const barV = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.18, 0.045), toon(0xffffff));
    const barH = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.02, 0.045), toon(0xffffff));
    glass.userData.dynamic = true;
    g.add(frame, glass, barV, barH);
    g.position.set(x, y, z);
    g.rotation.y = ry;
    // 窗台花箱
    const box = mk(new THREE.BoxGeometry(0.26, 0.06, 0.07), 0xb07e52, 0.01);
    box.position.set(0, -0.15, 0.04);
    g.add(box);
    [0xff8fab, 0xffd166, 0xc3a6ff].forEach((c, i) => {
      const f = mk(new THREE.SphereGeometry(0.03, 8, 6), c, 0.006);
      f.position.set(-0.07 + i * 0.07, -0.1, 0.05);
      g.add(f);
    });
    const glow = glowSprite(0xffc35a, 0.75);
    glow.position.set(0, 0, 0.12);
    g.add(glow);
    windows.push(glow);
    house.add(g);
  };
  addWindow(0.22, 0.12 + 0.36, D / 2 + 0.01, 0);
  addWindow(W / 2 + 0.01, 0.12 + 0.36, 0.05, Math.PI / 2);
  addWindow(-W / 2 - 0.01, 0.12 + 0.36, 0.05, -Math.PI / 2);
  // 门口：小地垫、门边的小灯笼
  const mat = mk(new THREE.BoxGeometry(0.3, 0.015, 0.16), 0xe6a96b, 0.006);
  mat.position.set(-0.18, 0.13, D / 2 + 0.16);
  house.add(mat);
  const lanternPole = mk(new THREE.CylinderGeometry(0.015, 0.015, 0.5, 6), 0x7a5a3e, 0.006);
  lanternPole.position.set(-0.47, 0.37, D / 2 + 0.2);
  const lanternBulb = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), new THREE.MeshBasicMaterial({ color: 0xf3eee0 }));
  lanternBulb.position.set(-0.47, 0.64, D / 2 + 0.2);
  lanternBulb.userData.dynamic = true;
  const lanternGlow = glowSprite(0xffc870, 0.9);
  lanternGlow.position.copy(lanternBulb.position);
  house.add(lanternPole, lanternBulb, lanternGlow);

  house.position.set(HOME.x, y0 - 0.02, HOME.z);
  house.rotation.y = HOME.rotY;
  house.scale.setScalar(HOME.s);
  root.add(tag ? tag(house, "house") : house);

  // 烟囱的烟：几团白球慢慢往上飘、变大、变淡
  const smokeMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false });
  const smoke = Array.from({ length: 4 }, (_, i) => {
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), smokeMat.clone());
    s.userData = { p: i / 4, dynamic: true };
    s.raycast = () => {};
    root.add(s);
    return s;
  });
  const chimWorld = new THREE.Vector3(0.28, chimTop.position.y + 0.04, -0.12).multiplyScalar(HOME.s).applyAxisAngle(new THREE.Vector3(0, 1, 0), HOME.rotY).add(house.position);

  /* ---------------- 木梯：沿崖壁从草地爬上高台 */
  // 沿着 x = LADDER.x 从前往后找：最后一个"还在草地上"的点 和 第一个"到了高台上"的点
  let zBot = -3.0, zTop = -3.9;
  for (let z = -2.8; z > -4.4; z -= 0.02) { if (heightAt(LADDER.x, z) < 0.05) zBot = z; }
  for (let z = -4.4; z < -2.8; z += 0.02) { if (heightAt(LADDER.x, z) > 1.42) zTop = z; }
  const topY = heightAt(LADDER.x, zTop);
  const ladder = new THREE.Group();
  const lean = Math.atan2(zBot + 0.18 - zTop, topY + 0.25); // 顶端靠在崖边，底脚离开崖根一点
  const len = Math.hypot(topY + 0.25, zBot + 0.18 - zTop);
  for (const sx of [-1, 1]) {
    const rail = mk(new THREE.BoxGeometry(0.05, len, 0.05), 0xb07e52, 0.012);
    rail.position.set(sx * 0.15, len / 2, 0);
    ladder.add(rail);
  }
  const rungs = Math.round(len / 0.2);
  for (let i = 1; i < rungs; i++) {
    const r = mk(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 6), 0xc8915f, 0.008);
    r.rotation.z = Math.PI / 2;
    r.position.set(0, (i / rungs) * len, 0.0);
    ladder.add(r);
  }
  ladder.position.set(LADDER.x, -0.02, zBot + 0.18);
  ladder.rotation.x = -lean;
  root.add(ladder);

  /* ---------------- 踏脚石：家 → 木梯脚；还有高台上 木梯顶 → 门口 */
  const stoneCols = [0xe9dfd2, 0xddd2c4, 0xf0e8dc];
  let si = 0;
  const lay = (pts, yOf, every = 0.36) => {
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      const L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(L / every));
      for (let k = i === 0 ? 1 : 0; k < n; k++) {
        const t = k / n, x = ax + (bx - ax) * t, z = az + (bz - az) * t;
        const ox = -(bz - az) / L, oz = (bx - ax) / L, side = si % 2 ? 1 : -1;
        const r = 0.12 + ((si * 37) % 10) / 160;
        const st = mk(new THREE.CylinderGeometry(r, r * 1.06, 0.05, 12), stoneCols[si % 3], 0.012);
        st.scale.z = 0.8;
        st.position.set(x + ox * side * 0.06, yOf(x, z) + 0.012, z + oz * side * 0.06);
        st.rotation.y = si * 1.3;
        st.receiveShadow = true;
        root.add(st);
        si++;
      }
    }
  };
  lay(STONE_PATH, () => 0);
  const doorWorld = new THREE.Vector3(-0.18, 0, D / 2 + 0.3).multiplyScalar(HOME.s).applyAxisAngle(new THREE.Vector3(0, 1, 0), HOME.rotY).add(house.position);
  lay([[LADDER.x, zTop - 0.05], [(LADDER.x + doorWorld.x) / 2, (zTop + doorWorld.z) / 2 - 0.05], [doorWorld.x, doorWorld.z]], (x, z) => heightAt(x, z), 0.3);

  /* ---------------- 每帧：烟、夜灯 */
  let lit = 0, want = 0;
  function update(t, dt) {
    smoke.forEach((s) => {
      const p = (t * 0.18 + s.userData.p) % 1;
      s.position.set(chimWorld.x + Math.sin(t * 0.7 + s.userData.p * 6) * 0.06 + p * 0.15, chimWorld.y + p * 0.9, chimWorld.z - p * 0.05);
      s.scale.setScalar(0.6 + p * 1.6);
      s.material.opacity = Math.sin(p * Math.PI) * 0.55;
    });
    lit += (want - lit) * Math.min(1, dt * 2);
    winMat.emissiveIntensity = lit * 1.2;
    winMat.color.setHex(lit > 0.5 ? 0xffe2a0 : 0xcfeaff);
    for (const g of windows) g.material.opacity = lit * 0.75;
    lanternGlow.material.opacity = lit * 0.85;
    lanternBulb.material.color.setHex(lit > 0.5 ? 0xffe08a : 0xf3eee0);
  }
  // 地图 / 走路要避开的范围
  return { root, update, setNight(k) { want = k; }, door: doorWorld, ladder: { x: LADDER.x, zBot, zTop } };
}
