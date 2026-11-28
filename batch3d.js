// 静态合批：把场景里"永远不动、不变色"的小物件（河边石子、芦苇、码头木板、远处小岛上的树……）
// 按材质合成几个大网格，描边也烤进一个网格。几百次绘制 → 个位数。
//
// 怎么判断"不动"：先记下候选物件的世界矩阵，等动画真正跑过 2.5 秒（不是墙上时间，页面在后台/没滚到时不算），
// 再比一遍，矩阵变过的（海鸥、蝴蝶、转的灯塔光……）就留着原样。另外只收这几类材质：
//   - 纯色卡通材质（没有贴图、不透明、不发光、没改 shader）
//   - outlined() 生成的描边（只有它的主体也被合并时才合）
// 原物件不删：材质换成一个"不画"的材质，点击检测（raycast）照常能点到，代码里对它的引用也不会坏。
// 标了 userData.dynamic 的物件（和它的子孙）一律跳过。
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const HIDDEN = new THREE.MeshBasicMaterial({ visible: false });
const DEFAULT_OBC = THREE.Material.prototype.onBeforeCompile;
const SETTLE = 2.5; // 秒（动画时间）

function plainToon(m) {
  return m && m.isMeshToonMaterial && m.visible && !m.map && !m.bumpMap && !m.normalMap && !m.alphaMap && !m.emissiveMap
    && !m.transparent && m.opacity === 1 && !m.vertexColors && !m.wireframe && m.side === THREE.FrontSide
    && m.onBeforeCompile === DEFAULT_OBC && m.emissive.getHex() === 0;
}
const isOutline = (o) => o.isMesh && o.material && o.material.userData && o.material.userData.outline != null;

function shownUpTo(o, root) {
  for (let p = o; p && p !== root; p = p.parent) if (!p.visible || p.userData.dynamic) return false;
  return true;
}

export function createBatcher(root, { enabled = true } = {}) {
  let cands = null, t0 = 0, done = !enabled, merged = [];

  function collect() {
    const list = [];
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || isOutline(o)) return;
      if (!plainToon(o.material) || !o.geometry || !o.geometry.attributes.position) return;
      if (!shownUpTo(o, root)) return;
      list.push({ o, m: o.matrixWorld.clone() });
    });
    return list;
  }

  const same = (a, b) => { for (let i = 0; i < 16; i++) if (Math.abs(a.elements[i] - b.elements[i]) > 1e-6) return false; return true; };

  // 每帧（在 animate 之后、render 之前）调一下；t 是动画时间
  function tick(t) {
    if (done) return;
    if (!cands) { cands = collect(); t0 = t; return; }
    if (t - t0 < SETTLE) return;
    done = true;
    root.updateMatrixWorld(true);
    const still = cands.filter(({ o, m }) => o.parent && shownUpTo(o, root) && plainToon(o.material) && same(m, o.matrixWorld));
    cands = null;
    build(still.map((c) => c.o));
  }

  function build(meshes) {
    const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
    const rel = new THREE.Matrix4();
    const groups = new Map(), lines = new Map();
    const add = (map, key, mk, g) => { if (!map.has(key)) map.set(key, { mk, geos: [] }); map.get(key).geos.push(g); };

    for (const o of meshes) {
      const m = o.material;
      rel.multiplyMatrices(inv, o.matrixWorld);
      const key = [m.gradientMap ? m.gradientMap.uuid : "-", m.flatShading, o.castShadow, o.receiveShadow, m.fog].join("|");
      add(groups, key, () => {
        const mm = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: m.gradientMap, vertexColors: true, flatShading: m.flatShading, fog: m.fog });
        const mesh = new THREE.Mesh(undefined, mm);
        mesh.castShadow = o.castShadow; mesh.receiveShadow = o.receiveShadow;
        return mesh;
      }, prepSolid(o.geometry, rel, m.color));
      // 它的描边
      for (const c of o.children) {
        if (!isOutline(c) || !c.visible) continue;
        const lm = c.material;
        const lrel = new THREE.Matrix4().multiplyMatrices(inv, c.matrixWorld);
        add(lines, lm.color.getHex() + "|" + lm.fog, () => new THREE.Mesh(undefined, new THREE.MeshBasicMaterial({ color: lm.color, side: THREE.BackSide, fog: lm.fog })),
          prepOutline(c.geometry, lrel, lm.userData.outline));
        c.material = HIDDEN;
      }
      o.material = HIDDEN;
      o.castShadow = false;
    }

    for (const map of [groups, lines]) for (const { mk, geos } of map.values()) {
      const g = mergeGeometries(geos, false);
      geos.forEach((x) => x.dispose());
      if (!g) continue;
      g.computeBoundingSphere();
      const mesh = mk();
      mesh.geometry = g;
      mesh.raycast = () => {};
      mesh.matrixAutoUpdate = false;
      mesh.userData.batched = true;
      root.add(mesh);
      merged.push(mesh);
    }
    stats = { meshes: meshes.length, draws: merged.length };
  }
  let stats = null;

  return { tick, get done() { return done; }, get stats() { return stats; } };
}

// 实体：只留 position / normal，加上顶点色（= 原材质颜色，线性空间），烤进相对矩阵
function prepSolid(src, matrix, color) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", src.attributes.position.clone());
  if (src.attributes.normal) g.setAttribute("normal", src.attributes.normal.clone());
  else g.computeVertexNormals();
  g.setIndex(indexOf(src));
  g.applyMatrix4(matrix);
  if (matrix.determinant() < 0) flipWinding(g);
  const n = g.attributes.position.count, col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = color.r; col[i * 3 + 1] = color.g; col[i * 3 + 2] = color.b; }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return g;
}

// 描边：和 outlined() 的 shader 一样，在物体自己的坐标里沿法线外推 thickness，再烤进矩阵
function prepOutline(src, matrix, thickness) {
  const p = src.attributes.position, nrm = src.attributes.normal;
  const pos = new Float32Array(p.count * 3), v = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    if (nrm) { n.fromBufferAttribute(nrm, i); if (n.lengthSq() > 0) v.addScaledVector(n.normalize(), thickness); }
    pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setIndex(indexOf(src));
  g.applyMatrix4(matrix);
  if (matrix.determinant() < 0) flipWinding(g);
  return g;
}

function indexOf(src) {
  if (src.index) return src.index.clone();
  const n = src.attributes.position.count, idx = new Uint32Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  return new THREE.BufferAttribute(idx, 1);
}

// 镜像缩放会把三角形的正反面翻过来，换一下顺序
function flipWinding(g) {
  const a = g.index.array;
  for (let i = 0; i + 2 < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; }
}
