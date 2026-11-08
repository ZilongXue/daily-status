// 小岛装饰、下雪、小伙伴等级饰品。
// 每件装饰有固定的位置；有 GLB 模型（vendor/decor/catalog.json）就用模型，没有就用这里程序画的版本。
import * as THREE from "three";

// 固定摆放位置（岛面 y=0，半径 3.25）。避开床（-1.55,-0.85）、树（1.95,-1.25）、花瓶（1.35,1.45）、小伙伴的家（0.35,0.75）。
const SPOTS = {
  cabin: [-0.2, -2.05, 0.2], windmill: [2.35, 0.55, -1.2], sakura: [-2.15, 1.35, 0], pond: [-0.75, 1.85, 0],
  swing: [0.95, -2.15, 0.3], tent: [1.75, -2.75, -0.3], balloon: [2.5, -2.3, 0], campfire: [-0.85, 0.45, 0],
  telescope: [2.45, -0.4, -1.6], snowman: [2.0, 2.05, -0.6], bench: [1.0, -0.95, 0.2], lamppost: [-0.3, -2.8, 0],
  mailbox: [2.75, 1.0, -1.3], gifts: [1.55, -0.65, 0.4], fence: [0.2, -2.85, 0], mushrooms: [-1.45, 2.4, 0],
  flowers_bed: [-2.65, 0.85, 1.2], lights: [0, 0, 0],
};

export function createDecor({ world, toon, outlined, tag, tree, top, leaves, getPet }) {
  const mk = (geo, color, line = 0.025) => outlined(new THREE.Mesh(geo, toon(color)), line);
  const built = {}; // id -> Group（已经在岛上的）
  let catalog = {};
  let gltfLoader = null;

  // ---------------------------------------------------------- 程序画的装饰
  const P = {
    lights(g) { // 串灯：绕着规律树一圈一圈
      const cols = [0xff6b8b, 0xffd166, 0x8fd3ff, 0xc3a6ff, 0x9be38a];
      for (let i = 0; i < 26; i++) {
        const a = i * 0.9, y = 0.9 + i * 0.045, r = 0.78 - i * 0.017;
        const b = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshBasicMaterial({ color: cols[i % cols.length] }));
        b.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
        b.userData.blink = i;
        g.add(b);
      }
      g.position.copy(tree.position);
    },
    gifts(g) {
      [[0, 0, 0.36, 0xff8fab, 0xffd166], [0.38, 0.05, 0.26, 0x8fd3ff, 0xff6b8b], [0.12, 0.36, 0.22, 0xc3a6ff, 0xffffff]].forEach(([x, z, s, c, rib]) => {
        const box = mk(new THREE.BoxGeometry(s, s, s), c);
        box.position.set(x, s / 2 + (x === 0.12 ? 0.36 : 0), z);
        const r1 = new THREE.Mesh(new THREE.BoxGeometry(s * 1.02, s * 1.02, s * 0.18), toon(rib));
        const r2 = new THREE.Mesh(new THREE.BoxGeometry(s * 0.18, s * 1.02, s * 1.02), toon(rib));
        box.add(r1, r2);
        g.add(box);
      });
    },
    snowman(g) {
      const w = 0xffffff;
      const b1 = mk(new THREE.SphereGeometry(0.42, 16, 12), w); b1.position.y = 0.4;
      const b2 = mk(new THREE.SphereGeometry(0.3, 16, 12), w); b2.position.y = 0.95;
      const nose = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.22, 8), toon(0xff8a3d)); nose.rotation.x = Math.PI / 2; nose.position.set(0, 0.97, 0.32);
      const hat = mk(new THREE.CylinderGeometry(0.17, 0.2, 0.26, 12), 0x3d4a6b); hat.position.y = 1.32;
      const brim = mk(new THREE.CylinderGeometry(0.3, 0.3, 0.04, 16), 0x3d4a6b); brim.position.y = 1.2;
      const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.06, 8, 18), toon(0xff6b6b)); scarf.rotation.x = Math.PI / 2; scarf.position.y = 0.72;
      g.add(b1, b2, nose, hat, brim, scarf);
      for (const x of [-0.1, 0.1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 4), new THREE.MeshBasicMaterial({ color: 0x2b1d18 })); e.position.set(x, 1.05, 0.27); g.add(e); }
    },
    mushrooms(g) {
      [[0, 0, 1], [0.3, 0.15, 0.7], [-0.25, 0.2, 0.6]].forEach(([x, z, s]) => {
        const stem = mk(new THREE.CylinderGeometry(0.07 * s, 0.09 * s, 0.3 * s, 8), 0xfff3e2); stem.position.set(x, 0.15 * s, z);
        const cap = mk(new THREE.SphereGeometry(0.22 * s, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), 0xff5d5d); cap.position.set(x, 0.28 * s, z);
        for (let i = 0; i < 4; i++) { const d = new THREE.Mesh(new THREE.SphereGeometry(0.035 * s, 6, 4), toon(0xffffff)); const a = i * 1.6; d.position.set(x + Math.cos(a) * 0.13 * s, 0.4 * s, z + Math.sin(a) * 0.13 * s); g.add(d); }
        g.add(stem, cap);
      });
    },
    flowers_bed(g) {
      const box = mk(new THREE.BoxGeometry(1.0, 0.22, 0.5), 0xc08a5e); box.position.y = 0.11;
      const soil = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.04, 0.42), toon(0x7a5235)); soil.position.y = 0.22;
      g.add(box, soil);
      const cols = [0xff8fab, 0xffd166, 0xc3a6ff, 0xff9e7a, 0xffffff];
      for (let i = 0; i < 8; i++) {
        const f = new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 6), toon(cols[i % cols.length]));
        f.position.set(-0.36 + (i % 4) * 0.24, 0.34, i < 4 ? -0.1 : 0.1);
        g.add(f);
      }
    },
    fence(g) {
      for (let i = 0; i < 6; i++) { const p = mk(new THREE.BoxGeometry(0.1, 0.5, 0.08), 0xd8a46e); p.position.set(-0.75 + i * 0.3, 0.25, 0); g.add(p); }
      for (const y of [0.18, 0.38]) { const r = mk(new THREE.BoxGeometry(1.7, 0.07, 0.05), 0xc58f5a); r.position.set(0, y, 0.05); g.add(r); }
    },
    campfire(g) {
      for (let i = 0; i < 3; i++) { const l = mk(new THREE.CylinderGeometry(0.06, 0.06, 0.6, 6), 0x8a5a3b); l.rotation.z = Math.PI / 2; l.rotation.y = i * Math.PI / 3; l.position.y = 0.07; g.add(l); }
      for (let i = 0; i < 7; i++) { const s = mk(new THREE.DodecahedronGeometry(0.08, 0), 0x9a8f86); const a = i / 7 * Math.PI * 2; s.position.set(Math.cos(a) * 0.36, 0.05, Math.sin(a) * 0.36); g.add(s); }
      const flame = new THREE.Group();
      [[0xff6b2b, 0.2, 0.5], [0xffb02e, 0.14, 0.38], [0xffe27a, 0.08, 0.24]].forEach(([c, r, h]) => { const f = new THREE.Mesh(new THREE.ConeGeometry(r, h, 8), new THREE.MeshBasicMaterial({ color: c })); f.position.y = 0.12 + h / 2; flame.add(f); });
      flame.userData.flame = true;
      const light = new THREE.PointLight(0xff9a3d, 2.2, 3.5, 1.6); light.position.y = 0.5; light.userData.flicker = true;
      g.add(flame, light);
    },
    pond(g) {
      const rim = mk(new THREE.CylinderGeometry(0.75, 0.8, 0.08, 20), 0xa59a90, 0.02); rim.position.y = 0.03; rim.scale.z = 0.7;
      const water = new THREE.Mesh(new THREE.CylinderGeometry(0.66, 0.66, 0.06, 20), toon(0x7cc8ff)); water.position.y = 0.06; water.scale.z = 0.7;
      g.add(rim, water);
      const duck = new THREE.Group();
      const body = mk(new THREE.SphereGeometry(0.13, 12, 10), 0xffe04d, 0.015); body.scale.set(1.2, 0.8, 1);
      const head = mk(new THREE.SphereGeometry(0.08, 10, 8), 0xffe04d, 0.015); head.position.set(0.1, 0.12, 0);
      const beak = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.07, 6), toon(0xff8a3d)); beak.rotation.z = -Math.PI / 2; beak.position.set(0.2, 0.11, 0);
      duck.add(body, head, beak); duck.position.y = 0.14; duck.userData.duck = true;
      g.add(duck);
    },
    balloon(g) {
      const env = mk(new THREE.SphereGeometry(0.55, 18, 14), 0xff8fab); env.scale.y = 1.15; env.position.y = 2.2;
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.05, 6, 20), toon(0xffd166)); band.rotation.x = Math.PI / 2; band.position.y = 2.05;
      const basket = mk(new THREE.CylinderGeometry(0.2, 0.16, 0.22, 10), 0xc08a5e); basket.position.y = 1.25;
      g.add(env, band, basket);
      for (const [x, z] of [[0.16, 0.16], [-0.16, 0.16], [0.16, -0.16], [-0.16, -0.16]]) { const r = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.55, 4), toon(0x6b5446)); r.position.set(x * 1.5, 1.6, z * 1.5); g.add(r); }
      g.userData.float = true;
    },
    lamppost(g) {
      const pole = mk(new THREE.CylinderGeometry(0.05, 0.07, 1.4, 8), 0x3d4a6b); pole.position.y = 0.7;
      const head = mk(new THREE.BoxGeometry(0.26, 0.3, 0.26), 0x3d4a6b); head.position.y = 1.5;
      const glass = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.22, 0.2), new THREE.MeshBasicMaterial({ color: 0xffe9a8 })); glass.position.y = 1.5;
      const l = new THREE.PointLight(0xffd27a, 1.5, 3, 1.6); l.position.y = 1.5; l.userData.night = true;
      g.add(pole, head, glass, l);
    },
    bench(g) {
      const seat = mk(new THREE.BoxGeometry(1.0, 0.07, 0.34), 0xd8a46e); seat.position.y = 0.36;
      const back = mk(new THREE.BoxGeometry(1.0, 0.3, 0.06), 0xd8a46e); back.position.set(0, 0.6, -0.15);
      g.add(seat, back);
      for (const x of [-0.42, 0.42]) for (const z of [-0.12, 0.12]) { const l = mk(new THREE.BoxGeometry(0.06, 0.36, 0.06), 0x8a5a3b); l.position.set(x, 0.18, z); g.add(l); }
    },
    mailbox(g) {
      const post = mk(new THREE.BoxGeometry(0.1, 0.7, 0.1), 0x8a5a3b); post.position.y = 0.35;
      const box = mk(new THREE.BoxGeometry(0.3, 0.28, 0.42), 0xff6b6b); box.position.y = 0.82;
      const flag = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.16, 0.1), toon(0xffd166)); flag.position.set(0.17, 0.92, 0.05);
      g.add(post, box, flag);
    },
    swing(g) {
      for (const x of [-0.55, 0.55]) { const p = mk(new THREE.CylinderGeometry(0.05, 0.06, 1.5, 8), 0x8a5a3b); p.position.set(x, 0.75, 0); g.add(p); }
      const bar = mk(new THREE.CylinderGeometry(0.05, 0.05, 1.25, 8), 0x8a5a3b); bar.rotation.z = Math.PI / 2; bar.position.y = 1.5;
      const seatG = new THREE.Group(); seatG.position.y = 1.5; seatG.userData.swing = true;
      for (const x of [-0.18, 0.18]) { const r = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.0, 4), toon(0x6b5446)); r.position.set(x, -0.5, 0); seatG.add(r); }
      const seat = mk(new THREE.BoxGeometry(0.45, 0.05, 0.22), 0xff8fab); seat.position.y = -1.0; seatG.add(seat);
      g.add(bar, seatG);
    },
    tent(g) {
      const t = mk(new THREE.ConeGeometry(0.75, 1.1, 4), 0x8fd3ff); t.rotation.y = Math.PI / 4; t.position.y = 0.55;
      const door = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.6, 3), toon(0x3d4a6b)); door.position.set(0, 0.3, 0.4); door.rotation.y = Math.PI;
      const flag = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.1, 0.01), toon(0xff6b8b)); flag.position.set(0.09, 1.2, 0);
      g.add(t, door, flag);
    },
    telescope(g) {
      for (let i = 0; i < 3; i++) { const l = mk(new THREE.CylinderGeometry(0.02, 0.025, 0.8, 5), 0x6b5446); const a = i / 3 * Math.PI * 2; l.position.set(Math.cos(a) * 0.15, 0.38, Math.sin(a) * 0.15); l.rotation.set(Math.sin(a) * 0.3, 0, -Math.cos(a) * 0.3); g.add(l); }
      const tube = mk(new THREE.CylinderGeometry(0.08, 0.12, 0.8, 12), 0xc3a6ff); tube.rotation.z = -1.0; tube.position.set(0.1, 0.9, 0);
      g.add(tube);
    },
    sakura(g) {
      const trunk = mk(new THREE.CylinderGeometry(0.1, 0.16, 1.0, 8), 0x8a5a3b); trunk.position.y = 0.5;
      g.add(trunk);
      [[0, 1.35, 0, 0.6], [0.35, 1.15, 0.15, 0.42], [-0.32, 1.2, -0.1, 0.45], [0.05, 1.7, 0.05, 0.4]].forEach(([x, y, z, r], i) => {
        const m = mk(new THREE.SphereGeometry(r, 14, 10), i % 2 ? 0xffc2d6 : 0xffa9c6, 0.03); m.position.set(x, y, z); g.add(m);
      });
      g.userData.petals = true;
    },
    windmill(g) {
      const tower = mk(new THREE.CylinderGeometry(0.28, 0.42, 1.6, 8), 0xfff3e2); tower.position.y = 0.8;
      const roof = mk(new THREE.ConeGeometry(0.38, 0.45, 8), 0xff8a6b); roof.position.y = 1.82;
      const hub = new THREE.Group(); hub.position.set(0, 1.5, 0.38); hub.userData.spin = true;
      for (let i = 0; i < 4; i++) { const b = mk(new THREE.BoxGeometry(0.16, 0.8, 0.03), 0xffffff, 0.015); b.position.y = 0.42; const arm = new THREE.Group(); arm.rotation.z = i * Math.PI / 2; arm.add(b); hub.add(arm); }
      g.add(tower, roof, hub);
    },
    cabin(g) {
      const base = mk(new THREE.BoxGeometry(1.4, 0.9, 1.0), 0xd8a46e); base.position.y = 0.45;
      const roof = mk(new THREE.ConeGeometry(1.05, 0.7, 4), 0xff8a6b); roof.rotation.y = Math.PI / 4; roof.position.y = 1.25; roof.scale.z = 0.8;
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.5, 0.02), toon(0x8a5a3b)); door.position.set(0, 0.25, 0.51);
      const win = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.22, 0.02), new THREE.MeshBasicMaterial({ color: 0xffe9a8 })); win.position.set(0.42, 0.55, 0.51);
      const chim = mk(new THREE.BoxGeometry(0.16, 0.36, 0.16), 0xa59a90); chim.position.set(0.35, 1.45, -0.15);
      g.add(base, roof, door, win, chim);
    },
  };

  const has = (id) => !!(P[id] || catalog[id]);

  async function loadCatalog() {
    try {
      const r = await fetch("vendor/decor/catalog.json", { cache: "no-cache" });
      if (!r.ok) return;
      for (const c of await r.json()) catalog[c.id] = c;
      ({ GLTFLoader: gltfLoader } = await import("three/addons/loaders/GLTFLoader.js"));
    } catch { catalog = catalog || {}; }
  }

  function toonify(root) {
    root.traverse((o) => {
      if (!o.isMesh) return;
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      o.material = toon(m && m.color ? m.color.getHex() : 0xffffff, m && m.map ? { map: m.map } : {});
      if (o.geometry && o.geometry.attributes.position.count < 4000) outlined(o, 0.02);
    });
    return root;
  }

  async function build(id) {
    const g = new THREE.Group();
    g.userData.item = id;
    const spot = SPOTS[id] || [0, 0, 0];
    g.position.set(spot[0], 0, spot[1]);
    g.rotation.y = spot[2];
    const c = catalog[id];
    if (c && gltfLoader && id !== "lights") {
      try {
        const gltf = await new gltfLoader().loadAsync("vendor/decor/" + c.file);
        const m = toonify(gltf.scene);
        m.scale.setScalar(c.scale || 1);
        m.position.y = c.y || 0;
        m.rotation.y = c.rotY || 0;
        g.add(m);
        if (id === "campfire") { // 模型只有石头和柴，补一团会跳的火
          const fire = new THREE.Group(); P.campfire(fire);
          fire.children.filter((o) => !o.userData.flame && !o.userData.flicker).forEach((o) => fire.remove(o));
          fire.position.y = 0.05; g.add(fire);
        }
        if (id === "balloon") { m.position.y += 0.9; g.userData.float = true; }
      } catch { if (P[id]) P[id](g); }
    } else if (P[id]) P[id](g);
    if (id === "lights") g.position.copy(tree.position);
    tag(g, "decor");
    g.traverse((o) => { o.userData.item = id; });
    g.scale.setScalar(0.001);
    g.userData.grow = 0;
    return g;
  }

  let want = new Set();
  async function setDecor(list) {
    want = new Set(list.filter(has));
    for (const id of Object.keys(built)) if (!want.has(id)) { world.remove(built[id]); delete built[id]; }
    for (const id of want) {
      if (built[id]) continue;
      built[id] = true; // 占位，避免重复加载
      const g = await build(id);
      if (!want.has(id)) { delete built[id]; continue; }
      built[id] = g;
      world.add(g);
    }
  }

  // ---------------------------------------------------------- 下雪
  let snowOn = false;
  const N = 500;
  const pos = new Float32Array(N * 3), speed = new Float32Array(N);
  for (let i = 0; i < N; i++) { pos[i * 3] = (Math.random() - 0.5) * 11; pos[i * 3 + 1] = Math.random() * 7 - 0.5; pos[i * 3 + 2] = (Math.random() - 0.5) * 11; speed[i] = 0.35 + Math.random() * 0.5; }
  const sg = new THREE.BufferGeometry(); sg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const flake = (() => { const c = document.createElement("canvas"); c.width = c.height = 32; const x = c.getContext("2d"); const gr = x.createRadialGradient(16, 16, 0, 16, 16, 16); gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(1, "rgba(255,255,255,0)"); x.fillStyle = gr; x.fillRect(0, 0, 32, 32); return new THREE.CanvasTexture(c); })();
  const snow = new THREE.Points(sg, new THREE.PointsMaterial({ size: 0.13, map: flake, transparent: true, depthWrite: false }));
  snow.visible = false; snow.raycast = () => {};
  world.add(snow);
  const grassCol = top.material.color.clone(), snowCol = new THREE.Color(0xf3f7ff);
  const leafCols = leaves.map((l) => l.material.color.clone());
  let cover = 0;
  function setSnow(on) { snowOn = !!on; snow.visible = snowOn; }

  // ---------------------------------------------------------- 等级饰品（Lv2 头上的小花、Lv3 围巾、Lv4+ 皇冠）
  let lv = 1, accFor = null;
  function accessories(p) {
    if (p.acc) p.head.remove(p.acc), p.body.remove(p.scarf);
    const acc = new THREE.Group();
    if (lv >= 2) {
      const f = new THREE.Group();
      for (let i = 0; i < 5; i++) { const pt = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), toon(0xff8fab)); const a = i / 5 * Math.PI * 2; pt.position.set(Math.cos(a) * 0.07, Math.sin(a) * 0.07, 0); pt.scale.z = 0.5; f.add(pt); }
      const c = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), toon(0xffd166)); c.position.z = 0.02; f.add(c);
      f.position.set(-0.28, 0.4, 0.22); f.rotation.set(-0.5, -0.4, 0);
      acc.add(f);
    }
    if (lv >= 4) {
      const crown = new THREE.Group();
      const ring = mk(new THREE.CylinderGeometry(0.2, 0.22, 0.12, 12, 1, true), 0xffd166, 0.015);
      ring.material.side = THREE.DoubleSide;
      crown.add(ring);
      for (let i = 0; i < 5; i++) { const s = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.14, 4), toon(0xffd166)); const a = i / 5 * Math.PI * 2; s.position.set(Math.cos(a) * 0.19, 0.12, Math.sin(a) * 0.19); crown.add(s); const gem = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 4), new THREE.MeshBasicMaterial({ color: [0xff6b8b, 0x8fd3ff, 0x9be38a][i % 3] })); gem.position.set(Math.cos(a) * 0.21, 0.02, Math.sin(a) * 0.21); crown.add(gem); }
      crown.position.set(0.05, 0.5, 0); crown.rotation.z = -0.12;
      acc.add(crown);
    }
    p.head.add(acc); p.acc = acc;
    if (lv >= 3) {
      const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.07, 8, 24), toon(0xff6b6b));
      scarf.rotation.x = Math.PI / 2; scarf.position.y = 0.82;
      const tail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.3, 0.05), toon(0xff6b6b)); tail.position.set(0.22, 0.66, 0.36); tail.rotation.z = 0.3;
      const sg2 = new THREE.Group(); sg2.add(scarf, tail); p.body.add(sg2); p.scarf = sg2;
    }
    accFor = p;
  }
  function setLevel(n) { lv = n; const p = getPet(); if (p) accessories(p); }

  // ---------------------------------------------------------- 每帧
  function update(t, dt, night) {
    const p = getPet();
    if (p && accFor !== p) accessories(p);
    for (const g of Object.values(built)) {
      if (g === true) continue;
      if (g.userData.grow < 1) { g.userData.grow = Math.min(1, g.userData.grow + dt * 1.8); const k = g.userData.grow; g.scale.setScalar(Math.max(0.001, 1 + Math.sin(k * Math.PI) * 0.15 * (1 - k) - (1 - k))); }
      g.traverse((o) => {
        if (o.userData.spin) o.rotation.z = t * 1.2;
        if (o.userData.swing) o.rotation.x = Math.sin(t * 1.6) * 0.35;
        if (o.userData.flame) { o.scale.set(1 + Math.sin(t * 13) * 0.08, 1 + Math.sin(t * 9) * 0.15, 1); }
        if (o.userData.flicker) o.intensity = 1.8 + Math.sin(t * 17) * 0.4;
        if (o.userData.night) o.intensity = night ? 1.6 : 0;
        if (o.userData.duck) { o.position.x = Math.cos(t * 0.5) * 0.3; o.position.z = Math.sin(t * 0.5) * 0.2; o.rotation.y = -t * 0.5 + Math.PI / 2; }
        if (o.userData.blink != null) o.visible = Math.sin(t * 3 + o.userData.blink) > -0.3;
        if (o.userData.float && o === g) o.position.y = Math.sin(t * 0.8) * 0.12;
      });
    }
    // 雪
    cover += ((snowOn ? 1 : 0) - cover) * Math.min(1, dt * 0.4);
    top.material.color.copy(grassCol).lerp(snowCol, cover * 0.75);
    leaves.forEach((l, i) => l.material.color.copy(leafCols[i]).lerp(snowCol, cover * 0.45));
    if (snowOn) {
      const a = sg.attributes.position;
      for (let i = 0; i < N; i++) {
        let y = a.array[i * 3 + 1] - speed[i] * dt;
        a.array[i * 3] += Math.sin(t + i) * dt * 0.15;
        if (y < -0.3) y = 6.5;
        a.array[i * 3 + 1] = y;
      }
      a.needsUpdate = true;
    }
  }

  return { loadCatalog, has, setDecor, setSnow, setLevel, update };
}
