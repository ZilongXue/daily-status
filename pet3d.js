// 原创 Q 版小伙伴：全部用 Three.js 基础几何体现搭，没有外部模型。
// 朝向 +z，站立高度约 1.5。返回各个可动的部件，动画逻辑在 scene3d.js。
import * as THREE from "three";

export const SPECIES = {
  cat: { name: "猫猫", emoji: "🐱", body: 0xffb877, belly: 0xfff3e2, inner: 0xffa9b8, feet: 0xfff3e2, nose: 0xff8fa3, stripe: 0xf29a52 },
  penguin: { name: "企鹅", emoji: "🐧", body: 0x44507a, belly: 0xffffff, beak: 0xffa53d, feet: 0xffa53d },
  chick: { name: "小鸡", emoji: "🐥", body: 0xffd84d, belly: 0xffeb94, beak: 0xff9f2e, feet: 0xff9f2e },
};

export function buildPet(kind, { toon, outlined }) {
  const S = SPECIES[kind] || SPECIES.cat;
  const mk = (geo, color, line = 0.028) => outlined(new THREE.Mesh(geo, toon(color)), line);
  const dark = new THREE.MeshBasicMaterial({ color: 0x2b1d18 });
  const white = new THREE.MeshBasicMaterial({ color: 0xffffff });

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  // 身体
  const torso = mk(new THREE.SphereGeometry(0.5, 22, 16), S.body);
  torso.scale.set(1.0, 0.86, 0.92);
  torso.position.y = 0.43;
  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.36, 18, 12), toon(S.belly));
  belly.scale.set(kind === "penguin" ? 1.12 : 1, 0.92, 0.55);
  belly.position.set(0, 0.4, 0.27);
  body.add(torso, belly);

  // 脚
  const feet = [-1, 1].map((s) => {
    const f = mk(new THREE.SphereGeometry(0.13, 12, 8), S.feet, 0.02);
    f.scale.set(1, 0.5, 1.35);
    f.position.set(s * 0.21, 0.05, 0.16);
    body.add(f);
    return f;
  });

  // 手 / 翅膀（可以挥）
  const arms = [-1, 1].map((s) => {
    const pivot = new THREE.Group();
    pivot.position.set(s * 0.43, 0.55, 0.05);
    const a = mk(new THREE.SphereGeometry(0.13, 12, 8), kind === "cat" ? S.belly : S.body, 0.022);
    if (kind === "cat") a.scale.set(0.75, 1, 0.75);
    else a.scale.set(0.45, 1.25, 0.8);
    a.position.set(s * 0.03, -0.12, 0);
    pivot.add(a);
    pivot.rotation.z = s * (kind === "cat" ? 0.25 : 0.35);
    body.add(pivot);
    return pivot;
  });

  // 头（看向手指 / 歪头都动这个）
  const head = new THREE.Group();
  head.position.y = 0.97;
  body.add(head);
  const skull = mk(new THREE.SphereGeometry(0.5, 26, 18), S.body, 0.03);
  skull.scale.set(1.1, 0.94, 0.98);
  head.add(skull);
  if (kind === "penguin") {
    const face = new THREE.Mesh(new THREE.SphereGeometry(0.42, 20, 14), toon(0xffffff));
    face.scale.set(1.12, 0.82, 0.62);
    face.position.set(0, -0.04, 0.24);
    head.add(face);
  }
  if (kind === "cat") {
    for (const x of [-0.12, 0, 0.12]) {
      const st = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.05), toon(S.stripe));
      st.position.set(x, 0.44, 0.08 - Math.abs(x) * 0.3);
      st.rotation.x = -0.35;
      head.add(st);
    }
  }

  // 耳朵 / 头顶的毛
  const ears = [];
  if (kind === "cat") {
    for (const s of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(s * 0.3, 0.34, 0.02);
      pivot.rotation.z = -s * 0.32;
      const e = mk(new THREE.ConeGeometry(0.17, 0.32, 4), S.body, 0.025);
      e.rotation.y = Math.PI / 4;
      e.position.y = 0.12;
      const inner = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.2, 4), toon(S.inner));
      inner.rotation.y = Math.PI / 4;
      inner.position.set(0, 0.09, 0.05);
      pivot.add(e, inner);
      head.add(pivot);
      ears.push(pivot);
    }
  } else if (kind === "chick") {
    for (const [x, rz, h] of [[-0.06, 0.4, 0.2], [0.04, -0.15, 0.26], [0.12, -0.6, 0.18]]) {
      const pivot = new THREE.Group();
      pivot.position.set(x, 0.42, 0);
      pivot.rotation.z = rz;
      const tuft = mk(new THREE.ConeGeometry(0.05, h, 6), S.body, 0.02);
      tuft.position.y = h / 2;
      pivot.add(tuft);
      head.add(pivot);
      ears.push(pivot);
    }
  }

  // 眼睛：睁开 / 开心 ^ ^ / 睡着 ‿ ‿
  const eyes = [-1, 1].map((s) => {
    const g = new THREE.Group();
    g.position.set(s * 0.19, 0.02, 0.44);
    const open = new THREE.Group();
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.075, 14, 10), dark);
    ball.scale.set(1, 1.15, 0.55);
    const hi = new THREE.Mesh(new THREE.SphereGeometry(0.026, 8, 6), white);
    hi.position.set(0.025, 0.035, 0.04);
    const hi2 = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 4), white);
    hi2.position.set(-0.02, -0.03, 0.04);
    open.add(ball, hi, hi2);
    const arc = new THREE.TorusGeometry(0.06, 0.016, 6, 14, Math.PI);
    const happy = new THREE.Mesh(arc, dark);           // ∩ = ^
    const sleep = new THREE.Mesh(arc, dark);           // ∪ = ‿
    sleep.rotation.z = Math.PI;
    sleep.position.y = 0.02;
    g.add(open, happy, sleep);
    head.add(g);
    return { g, open, happy, sleep };
  });

  // 腮红
  const blushMat = new THREE.MeshBasicMaterial({ color: 0xff8fa8, transparent: true, opacity: 0.55, depthWrite: false });
  const blush = [-1, 1].map((s) => {
    const b = new THREE.Mesh(new THREE.CircleGeometry(0.075, 16), blushMat);
    b.position.set(s * 0.33, -0.09, 0.4);
    b.rotation.y = s * 0.55;
    b.scale.set(1.25, 0.8, 1);
    head.add(b);
    return b;
  });

  // 嘴：猫是 ω，企鹅 / 小鸡是喙；打哈欠时张开
  const mouth = new THREE.Group();
  mouth.position.set(0, -0.12, 0.47);
  head.add(mouth);
  if (kind === "cat") {
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), toon(S.nose));
    nose.scale.set(1.3, 0.8, 0.8);
    nose.position.set(0, 0.06, 0.01);
    const w = new THREE.TorusGeometry(0.035, 0.011, 5, 10, Math.PI);
    const l = new THREE.Mesh(w, dark), r = new THREE.Mesh(w, dark);
    l.rotation.z = r.rotation.z = Math.PI;
    l.position.x = -0.035; r.position.x = 0.035;
    mouth.add(nose, l, r);
  } else {
    const beak = mk(new THREE.ConeGeometry(0.07, 0.14, 8), S.beak, 0.018);
    beak.rotation.x = Math.PI / 2;
    beak.scale.set(1.3, 1, 0.8);
    beak.position.set(0, 0.04, 0.04);
    mouth.add(beak);
  }
  const yawn = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), new THREE.MeshBasicMaterial({ color: 0x8a3b3b }));
  yawn.scale.set(1, 1.2, 0.4);
  yawn.position.set(0, kind === "cat" ? -0.03 : -0.06, 0.02);
  yawn.visible = false;
  mouth.add(yawn);

  // 尾巴
  const tail = new THREE.Group();
  tail.position.set(0, 0.28, -0.4);
  if (kind === "cat") {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.05, 0.12, -0.18), new THREE.Vector3(0.12, 0.4, -0.25),
      new THREE.Vector3(0.18, 0.62, -0.12), new THREE.Vector3(0.1, 0.72, 0.0)]);
    tail.add(mk(new THREE.TubeGeometry(curve, 24, 0.065, 8, false), S.body, 0.025));
    const tip = mk(new THREE.SphereGeometry(0.068, 10, 8), S.stripe, 0.02);
    tip.position.set(0.1, 0.72, 0);
    tail.add(tip);
  } else {
    const t = mk(new THREE.ConeGeometry(0.12, 0.2, 6), S.body, 0.02);
    t.rotation.x = -Math.PI / 2 - 0.5;
    t.position.set(0, 0, -0.04);
    tail.add(t);
  }
  body.add(tail);

  // 睡帽、鼻涕泡、汗滴
  const cap = new THREE.Group();
  const capCone = mk(new THREE.ConeGeometry(0.3, 0.6, 14), 0x7c8cf0, 0.025);
  capCone.position.y = 0.28;
  const pom = mk(new THREE.SphereGeometry(0.08, 10, 8), 0xffffff, 0.02);
  pom.position.set(0, 0.6, 0);
  const brim = mk(new THREE.TorusGeometry(0.29, 0.05, 6, 18), 0xffffff, 0.02);
  brim.rotation.x = Math.PI / 2;
  cap.add(capCone, pom, brim);
  cap.position.set(0.08, 0.34, -0.02);
  cap.rotation.z = -0.45;
  cap.visible = false;
  head.add(cap);

  const bubble = new THREE.Mesh(new THREE.SphereGeometry(0.09, 14, 10),
    new THREE.MeshToonMaterial({ color: 0xbfe6ff, transparent: true, opacity: 0.7 }));
  bubble.position.set(0.1, -0.08, 0.5);
  bubble.visible = false;
  head.add(bubble);

  const sweat = new THREE.Group();
  const drop = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), toon(0x9fd8ff));
  const dropTop = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.08, 10), toon(0x9fd8ff));
  dropTop.position.y = 0.05;
  sweat.add(drop, dropTop);
  sweat.position.set(0.4, 0.2, 0.25);
  sweat.visible = false;
  head.add(sweat);

  function setEyes(state) {
    for (const e of eyes) {
      e.open.visible = state === "open" || state === "half" || state === "wide";
      e.happy.visible = state === "happy";
      e.sleep.visible = state === "sleep";
      const k = state === "wide" ? 1.3 : 1;
      e.open.scale.set(k, state === "half" ? 0.45 : k, 1);
    }
  }
  setEyes("open");

  root.traverse((o) => { o.userData.what = "pet"; });
  return { root, body, head, eyes, arms, ears, tail, feet, blush, blushMat, mouth, yawn, cap, bubble, sweat, setEyes, height: 1.5 };
}
